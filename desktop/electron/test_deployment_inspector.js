/**
 * NEXUS DEPLOYMENT INSPECTOR — COMPREHENSIVE TEST SUITE
 * Tests Phase 1 deterministic inspection across realistic workspace configurations:
 * - Case A: Frontend (Vite/React)
 * - Case B: Node backend (Express with dynamic PORT)
 * - Case C: Bad host binding (127.0.0.1 blocker)
 * - Case D: PostgreSQL with DATABASE_URL
 * - Case E: Local PostgreSQL (localhost warning)
 * - Case F: SQLite (ephemeral storage warning)
 * - Case G: Monorepo (apps/web + apps/api)
 * - Case H: Unknown project (honest UNKNOWN)
 * - Case I: Regression test for existing intelligence features
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  deploymentInspector,
  projectDetector,
  ruleEngine,
  DEPLOYMENT_STATUS,
  FINDING_SEVERITY,
  FINDING_CATEGORY,
  preflightEstimator,
  breakageCorrelator,
  futureBugSimulator,
  decisionReplayEngine,
} = require('./intelligence');

// Helper to create a temporary isolated test workspace
function createTempWorkspace(prefix = 'test-deploy-ws') {
  const tmpDir = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

// Helper to clean up
function cleanupWorkspace(dir) {
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (_) {}
}

async function runTests() {
  console.log('\n======================================================');
  console.log('  NEXUS DEPLOYMENT INSPECTOR — TEST SUITE');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  function recordPass(testName) {
    console.log(`  ✓ ${testName}`);
    passed++;
  }

  function recordFail(testName, error) {
    console.error(`  ✗ ${testName}`);
    console.error(`    ${error.message}`);
    failed++;
  }

  // -------------------------------------------------------------------------
  // Case A: Frontend (Vite / React)
  // -------------------------------------------------------------------------
  try {
    const ws = createTempWorkspace('case-a-frontend');
    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({
      name: 'my-vite-app',
      version: '1.0.0',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview',
      },
      dependencies: {
        react: '^18.2.0',
        'react-dom': '^18.2.0',
      },
      devDependencies: {
        vite: '^5.0.0',
      },
    }, null, 2));

    fs.writeFileSync(path.join(ws, 'vite.config.ts'), 'export default defineConfig({});');

    const report = await deploymentInspector.inspectWorkspace(ws);

    assert.ok(report.frontend, 'Frontend should be detected');
    assert.strictEqual(report.frontend.detected, true);
    assert.ok(report.frontend.framework.includes('react') || report.frontend.framework.includes('vite'));
    assert.strictEqual(report.frontend.outputDirectory, 'dist');
    assert.ok(report.frontend.buildScript.includes('npm run build'));
    assert.ok(report.overallStatus === DEPLOYMENT_STATUS.READY || report.overallStatus === DEPLOYMENT_STATUS.WARNING);

    cleanupWorkspace(ws);
    recordPass('Case A: Frontend (Vite/React) detected with build script and dist output');
  } catch (err) {
    recordFail('Case A: Frontend (Vite/React)', err);
  }

  // -------------------------------------------------------------------------
  // Case B: Node Backend (Express with dynamic PORT)
  // -------------------------------------------------------------------------
  try {
    const ws = createTempWorkspace('case-b-backend');
    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({
      name: 'my-express-api',
      main: 'server.js',
      scripts: {
        start: 'node server.js',
      },
      dependencies: {
        express: '^4.18.2',
      },
    }, null, 2));

    fs.writeFileSync(path.join(ws, 'server.js'), `
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('OK'));
app.listen(PORT, '0.0.0.0', () => console.log('Listening on port ' + PORT));
    `);

    const report = await deploymentInspector.inspectWorkspace(ws);

    assert.ok(report.backend, 'Backend should be detected');
    assert.strictEqual(report.backend.framework, 'express');
    assert.strictEqual(report.backend.runtime, 'node');
    assert.strictEqual(report.backend.isHostBindingSafe, true);
    assert.strictEqual(report.backend.hostBinding, '0.0.0.0');
    assert.ok(!report.findings.some(f => f.severity === FINDING_SEVERITY.BLOCKER));

    cleanupWorkspace(ws);
    recordPass('Case B: Node backend (Express with dynamic PORT and 0.0.0.0 binding) ready');
  } catch (err) {
    recordFail('Case B: Node backend', err);
  }

  // -------------------------------------------------------------------------
  // Case C: Bad Host Binding (127.0.0.1 Blocker)
  // -------------------------------------------------------------------------
  try {
    const ws = createTempWorkspace('case-c-bad-binding');
    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({
      name: 'bad-binding-api',
      main: 'server.js',
      scripts: { start: 'node server.js' },
      dependencies: { express: '^4.18.2' },
    }, null, 2));

    fs.writeFileSync(path.join(ws, 'server.js'), `
const express = require('express');
const app = express();
app.listen(3000, "127.0.0.1", () => console.log('Server started'));
    `);

    const report = await deploymentInspector.inspectWorkspace(ws);

    assert.ok(report.backend, 'Backend should be detected');
    assert.strictEqual(report.backend.isHostBindingSafe, false);
    assert.strictEqual(report.overallStatus, DEPLOYMENT_STATUS.BLOCKED);

    const blocker = report.findings.find(f => f.ruleId === 'RULE-01' && f.severity === FINDING_SEVERITY.BLOCKER);
    assert.ok(blocker, 'RULE-01 BLOCKER finding must exist');
    assert.ok(blocker.evidence.some(e => e.snippet && e.snippet.includes('127.0.0.1')));

    cleanupWorkspace(ws);
    recordPass('Case C: Bad host binding (127.0.0.1) produces BLOCKER with line/snippet evidence');
  } catch (err) {
    recordFail('Case C: Bad host binding', err);
  }

  // -------------------------------------------------------------------------
  // Case D: PostgreSQL with DATABASE_URL
  // -------------------------------------------------------------------------
  try {
    const ws = createTempWorkspace('case-d-postgres');
    fs.mkdirSync(path.join(ws, 'prisma'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'prisma', 'schema.prisma'), `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
generator client {
  provider = "prisma-client-js"
}
    `);

    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({
      name: 'pg-app',
      dependencies: {
        '@prisma/client': '^5.0.0',
      },
    }, null, 2));

    const report = await deploymentInspector.inspectWorkspace(ws);

    assert.ok(report.database, 'Database should be detected');
    assert.strictEqual(report.database.technology, 'postgresql');
    assert.strictEqual(report.database.ormOrDriver, 'prisma');
    assert.strictEqual(report.database.usesEnvVar, true);
    assert.strictEqual(report.database.usesLocalhost, false);

    cleanupWorkspace(ws);
    recordPass('Case D: PostgreSQL + Prisma with DATABASE_URL detected safely');
  } catch (err) {
    recordFail('Case D: PostgreSQL with DATABASE_URL', err);
  }

  // -------------------------------------------------------------------------
  // Case E: Local PostgreSQL (localhost warning)
  // -------------------------------------------------------------------------
  try {
    const ws = createTempWorkspace('case-e-local-db');
    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({
      name: 'local-db-app',
      main: 'db.js',
      dependencies: { pg: '^8.11.0' },
    }, null, 2));

    fs.writeFileSync(path.join(ws, 'db.js'), `
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: 'postgresql://postgres:secretpassword@localhost:5432/mydb'
});
    `);

    const report = await deploymentInspector.inspectWorkspace(ws);

    assert.ok(report.database, 'Database should be detected');
    assert.strictEqual(report.database.usesLocalhost, true);

    const warning = report.findings.find(f => f.ruleId === 'RULE-05' && f.severity === FINDING_SEVERITY.WARNING);
    assert.ok(warning, 'RULE-05 WARNING for localhost database connection must exist');

    // Ensure password wasn't leaked in plain text
    const jsonStr = JSON.stringify(report);
    assert.ok(!jsonStr.includes('secretpassword'), 'Secret password must never appear in report output');

    cleanupWorkspace(ws);
    recordPass('Case E: Localhost database connection produces WARNING with sanitized evidence');
  } catch (err) {
    recordFail('Case E: Local PostgreSQL', err);
  }

  // -------------------------------------------------------------------------
  // Case F: SQLite Persistence Risk
  // -------------------------------------------------------------------------
  try {
    const ws = createTempWorkspace('case-f-sqlite');
    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({
      name: 'sqlite-app',
      dependencies: { 'better-sqlite3': '^9.0.0' },
    }, null, 2));

    const report = await deploymentInspector.inspectWorkspace(ws);

    assert.ok(report.database, 'Database should be detected');
    assert.strictEqual(report.database.technology, 'sqlite');
    assert.strictEqual(report.database.isSQLite, true);
    assert.strictEqual(report.database.isEphemeralStorageRisk, true);

    const sqliteFinding = report.findings.find(f => f.ruleId === 'RULE-06');
    assert.ok(sqliteFinding, 'RULE-06 SQLite persistence risk finding must exist');
    assert.strictEqual(sqliteFinding.severity, FINDING_SEVERITY.WARNING);

    cleanupWorkspace(ws);
    recordPass('Case F: SQLite detected and persistence warning reported accurately');
  } catch (err) {
    recordFail('Case F: SQLite persistence risk', err);
  }

  // -------------------------------------------------------------------------
  // Case G: Monorepo (apps/web + apps/api)
  // -------------------------------------------------------------------------
  try {
    const ws = createTempWorkspace('case-g-monorepo');
    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({
      name: 'my-monorepo',
      private: true,
      workspaces: ['apps/*'],
    }, null, 2));

    fs.mkdirSync(path.join(ws, 'apps', 'web'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'apps', 'web', 'package.json'), JSON.stringify({
      name: 'web-app',
      scripts: { build: 'next build' },
      dependencies: { next: '^14.0.0', react: '^18.2.0' },
    }, null, 2));

    fs.mkdirSync(path.join(ws, 'apps', 'api'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'apps', 'api', 'package.json'), JSON.stringify({
      name: 'api-service',
      main: 'index.js',
      scripts: { start: 'node index.js' },
      dependencies: { express: '^4.18.2' },
    }, null, 2));
    fs.writeFileSync(path.join(ws, 'apps', 'api', 'index.js'), `
const express = require('express');
const app = express();
app.listen(process.env.PORT || 4000);
    `);

    const report = await deploymentInspector.inspectWorkspace(ws);

    assert.strictEqual(report.project.isMonorepo, true);
    assert.ok(report.frontend, 'Frontend sub-app should be detected');
    assert.strictEqual(report.frontend.framework, 'nextjs');
    assert.ok(report.backend, 'Backend sub-app should be detected');
    assert.strictEqual(report.backend.framework, 'express');

    const monorepoFinding = report.findings.find(f => f.ruleId === 'RULE-08');
    assert.ok(monorepoFinding, 'RULE-08 Monorepo guidance finding must exist');

    cleanupWorkspace(ws);
    recordPass('Case G: Monorepo with separate frontend & backend detected without collapsing');
  } catch (err) {
    recordFail('Case G: Monorepo', err);
  }

  // -------------------------------------------------------------------------
  // Case H: Unknown Project
  // -------------------------------------------------------------------------
  try {
    const ws = createTempWorkspace('case-h-unknown');
    fs.writeFileSync(path.join(ws, 'notes.txt'), 'Just some random notes.');

    const report = await deploymentInspector.inspectWorkspace(ws);

    assert.strictEqual(report.frontend, null);
    assert.strictEqual(report.backend, null);
    assert.strictEqual(report.database, null);
    assert.strictEqual(report.overallStatus, DEPLOYMENT_STATUS.UNKNOWN);

    cleanupWorkspace(ws);
    recordPass('Case H: Unknown project returns honest UNKNOWN status with no hallucinations');
  } catch (err) {
    recordFail('Case H: Unknown project', err);
  }

  // -------------------------------------------------------------------------
  // Case I: Regression Testing on Existing Intelligence Features
  // -------------------------------------------------------------------------
  try {
    // 1. PreflightEstimator
    const estimate = preflightEstimator.estimate({
      prompt: 'Fix the login authentication bug in auth.ts',
      workspacePath: process.cwd(),
      providerId: 'nexus1',
      modelId: 'gemini-2.5-flash',
    });
    assert.ok(estimate.estimatedTotalTokens > 0, 'Preflight total tokens must be > 0');
    assert.ok(estimate.pricingAvailable === true || estimate.pricingAvailable === false);

    // 2. FutureBugSimulator
    const simReport = await futureBugSimulator.simulate('What happens if the database becomes 10x slower?', {
      workspacePath: process.cwd(),
    });
    assert.ok(simReport.simulationId, 'Simulation report must have simulationId');
    assert.ok(simReport.scenarioType, 'Simulation report must have scenarioType');

    // 3. BreakageCorrelator
    const breakage = await breakageCorrelator.correlate({
      rawOutput: 'Error: Cannot find module express',
      workspacePath: process.cwd(),
    });
    assert.ok(breakage.primaryCause, 'Breakage report must have primaryCause');

    // 4. DecisionReplayEngine
    const decisions = decisionReplayEngine.getDecisions({ workspacePath: process.cwd() });
    assert.ok(Array.isArray(decisions), 'Decisions must return an array');

    recordPass('Case I: Regression safety verified (Preflight, Simulator, Breakage, Decision Replay)');
  } catch (err) {
    recordFail('Case I: Regression test', err);
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
