/**
 * NEXUS DEPLOYMENT CONFIG GENERATORS — COMPREHENSIVE TEST SUITE (Phase 2C)
 * 
 * Validates deterministic configuration preview, diffing, validation,
 * and safe atomic writes across all 15 test specifications.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  deploymentConfigEngine,
  createDeploymentReport,
  createPlatformRecommendation,
  SUITABILITY,
  VercelConfigGenerator,
  RenderConfigGenerator,
  RailwayConfigGenerator,
  FlyIoConfigGenerator,
  NetlifyConfigGenerator,
  DockerConfigGenerator,
} = require('./intelligence');

async function runConfigGeneratorTests() {
  console.log('\n======================================================');
  console.log('  NEXUS DEPLOYMENT CONFIG ENGINE — TEST SUITE');
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
  // TEST 1: Next.js Static Frontend -> vercel.json
  // -------------------------------------------------------------------------
  try {
    const generator = new VercelConfigGenerator();
    const report = createDeploymentReport({
      frontend: {
        detected: true,
        framework: 'nextjs',
        isStaticExport: true,
        buildScript: 'npm run build',
        outputDirectory: 'out',
      },
      computeTarget: { rootDir: null },
    });

    const res = generator.generate(report, {});
    assert.strictEqual(res.targetFile, 'vercel.json');
    assert.strictEqual(res.format, 'json');
    const parsed = JSON.parse(res.content);
    assert.strictEqual(parsed.framework, 'nextjs');
    assert.strictEqual(parsed.outputDirectory, 'out');
    assert.strictEqual(parsed.cleanUrls, true);
    assert.ok(res.generatedFromEvidence.some((e) => e.includes('nextjs')));

    recordPass('Test 1: Next.js static frontend generates valid vercel.json with outputDirectory: out');
  } catch (err) {
    recordFail('Test 1: Next.js static frontend -> vercel.json', err);
  }

  // -------------------------------------------------------------------------
  // TEST 2: Vite Static Frontend -> netlify.toml
  // -------------------------------------------------------------------------
  try {
    const generator = new NetlifyConfigGenerator();
    const report = createDeploymentReport({
      frontend: {
        detected: true,
        framework: 'react (vite)',
        isStaticExport: false,
        buildScript: 'npm run build',
        outputDirectory: 'dist',
      },
    });

    const res = generator.generate(report, {});
    assert.strictEqual(res.targetFile, 'netlify.toml');
    assert.ok(res.content.includes('publish = "dist"'));
    assert.ok(res.content.includes('command = "npm run build"'));
    assert.ok(res.content.includes('[[redirects]]'));

    recordPass('Test 2: Vite static frontend generates valid netlify.toml with publish: dist');
  } catch (err) {
    recordFail('Test 2: Vite static frontend -> netlify.toml', err);
  }

  // -------------------------------------------------------------------------
  // TEST 3: Express + PostgreSQL -> render.yaml
  // -------------------------------------------------------------------------
  try {
    const generator = new RenderConfigGenerator();
    const report = createDeploymentReport({
      backend: {
        detected: true,
        runtime: 'node',
        framework: 'express',
        startCommand: 'node server.js',
        buildScript: 'npm install',
        port: 3000,
      },
      database: {
        detected: true,
        technology: 'postgresql',
      },
    });

    const res = generator.generate(report, {});
    assert.strictEqual(res.targetFile, 'render.yaml');
    assert.ok(res.content.includes('runtime: node'));
    assert.ok(res.content.includes('startCommand: node server.js'));
    assert.ok(res.content.includes('DATABASE_URL'));
    assert.ok(res.content.includes('databases:'));

    recordPass('Test 3: Express + PostgreSQL generates valid render.yaml with DATABASE_URL and databases block');
  } catch (err) {
    recordFail('Test 3: Express + PostgreSQL -> render.yaml', err);
  }

  // -------------------------------------------------------------------------
  // TEST 4: Express Backend -> railway.toml
  // -------------------------------------------------------------------------
  try {
    const generator = new RailwayConfigGenerator();
    const report = createDeploymentReport({
      backend: {
        detected: true,
        runtime: 'node',
        framework: 'express',
        startCommand: 'npm start',
        buildScript: 'npm run build',
      },
    });

    const res = generator.generate(report, {});
    assert.strictEqual(res.targetFile, 'railway.toml');
    assert.ok(res.content.includes('builder = "NIXPACKS"'));
    assert.ok(res.content.includes('startCommand = "npm start"'));

    recordPass('Test 4: Express backend generates valid railway.toml with Nixpacks builder');
  } catch (err) {
    recordFail('Test 4: Express backend -> railway.toml', err);
  }

  // -------------------------------------------------------------------------
  // TEST 5: Express + SQLite -> fly.toml with persistence config
  // -------------------------------------------------------------------------
  try {
    const generator = new FlyIoConfigGenerator();
    const report = createDeploymentReport({
      backend: {
        detected: true,
        runtime: 'node',
        port: 3000,
      },
      database: {
        detected: true,
        technology: 'sqlite',
        isSQLite: true,
      },
    });

    const res = generator.generate(report, {}, { appName: 'test-app' });
    assert.strictEqual(res.targetFile, 'fly.toml');
    assert.ok(res.content.includes('internal_port = 3000'));
    assert.ok(res.content.includes('[mounts]'));
    assert.ok(res.content.includes('source = "sqlite_data"'));

    recordPass('Test 5: Express + SQLite generates fly.toml with volume mounts block');
  } catch (err) {
    recordFail('Test 5: Express + SQLite -> fly.toml', err);
  }

  // -------------------------------------------------------------------------
  // TEST 6: Node Backend -> Dockerfile
  // -------------------------------------------------------------------------
  try {
    const generator = new DockerConfigGenerator();
    const report = createDeploymentReport({
      backend: {
        detected: true,
        runtime: 'node',
        port: 3000,
        startCommand: 'npm start',
      },
    });

    const res = generator.generate(report, {});
    assert.strictEqual(res.targetFile, 'Dockerfile');
    assert.ok(res.content.includes('FROM node:20-alpine'));
    assert.ok(res.content.includes('EXPOSE 3000'));
    assert.ok(res.content.includes('CMD ["npm", "start"]'));

    recordPass('Test 6: Node backend generates production Dockerfile with EXPOSE and CMD');
  } catch (err) {
    recordFail('Test 6: Node backend -> Dockerfile', err);
  }

  // -------------------------------------------------------------------------
  // TEST 7: Existing configuration file -> diff generated correctly
  // -------------------------------------------------------------------------
  try {
    const oldText = '{\n  "framework": "old"\n}';
    const newText = '{\n  "framework": "nextjs",\n  "cleanUrls": true\n}';
    const diff = deploymentConfigEngine.computeStructuredDiff(oldText, newText);

    assert.ok(diff.added > 0, 'Diff should record added lines');
    assert.ok(diff.removed > 0, 'Diff should record removed lines');
    assert.ok(Array.isArray(diff.lines) && diff.lines.length > 0);

    recordPass('Test 7: Existing configuration file computes structured line diff');
  } catch (err) {
    recordFail('Test 7: Existing file diff', err);
  }

  // -------------------------------------------------------------------------
  // TEST 8: No existing configuration -> new file preview
  // -------------------------------------------------------------------------
  try {
    const newText = '{\n  "framework": "nextjs"\n}';
    const diff = deploymentConfigEngine.computeStructuredDiff('', newText);

    assert.strictEqual(diff.removed, 0);
    assert.strictEqual(diff.added, 3);
    assert.ok(diff.lines.every((l) => l.type === 'added'));

    recordPass('Test 8: No existing configuration produces 100% added diff lines');
  } catch (err) {
    recordFail('Test 8: New file preview diff', err);
  }

  // -------------------------------------------------------------------------
  // TEST 9: Secret values -> never appear in generated output
  // -------------------------------------------------------------------------
  try {
    const generator = new VercelConfigGenerator();
    const report = createDeploymentReport({
      frontend: {
        detected: true,
        framework: 'nextjs',
        buildScript: 'npm run build --token=ghp_123456789012345678901234567890123456',
      },
    });

    const res = generator.generate(report, {});
    assert.ok(!res.content.includes('ghp_123456789012345678901234567890123456'));

    recordPass('Test 9: Secret values are filtered and sanitized from generated output');
  } catch (err) {
    recordFail('Test 9: Secret filter sanitization', err);
  }

  // -------------------------------------------------------------------------
  // TEST 10: Path traversal attempt -> rejected
  // -------------------------------------------------------------------------
  try {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-test-'));
    const check1 = deploymentConfigEngine.resolveAndValidatePath(tempDir, '../../outside.json');
    assert.strictEqual(check1.valid, false);
    assert.ok(check1.error.includes('escapes workspace'));

    fs.rmSync(tempDir, { recursive: true, force: true });
    recordPass('Test 10: Path traversal attempt (../../) is strictly rejected');
  } catch (err) {
    recordFail('Test 10: Path traversal rejection', err);
  }

  // -------------------------------------------------------------------------
  // TEST 11: Malformed generated config -> validation failure
  // -------------------------------------------------------------------------
  try {
    const val1 = deploymentConfigEngine.validateFormat('json', '{ bad json');
    assert.strictEqual(val1.valid, false);
    assert.ok(val1.errors.length > 0);

    const val2 = deploymentConfigEngine.validateFormat('yaml', 'services:\n\t- tabbed: true');
    assert.strictEqual(val2.valid, false);
    assert.ok(val2.errors.some((e) => e.includes('Tabs are not allowed')));

    recordPass('Test 11: Malformed JSON and tabbed YAML fail format validation');
  } catch (err) {
    recordFail('Test 11: Format validation failure', err);
  }

  // -------------------------------------------------------------------------
  // TEST 12: Stale existing-file hash -> apply rejected
  // -------------------------------------------------------------------------
  try {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-stale-'));
    const testFile = path.join(tempDir, 'vercel.json');
    fs.writeFileSync(testFile, '{"old": true}', 'utf8');

    // Create a mock package.json so inspectWorkspace succeeds
    fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({ name: 'test-pkg' }), 'utf8');

    let threwStale = false;
    try {
      await deploymentConfigEngine.applyConfig(tempDir, 'vercel', {
        expectedExistingContentHash: 'deadbeef_incorrect_hash_99999',
      });
    } catch (err) {
      if (err.message.includes('STALE_PREVIEW_ERROR')) {
        threwStale = true;
      }
    }

    assert.ok(threwStale, 'Engine should reject write when content hash does not match');
    fs.rmSync(tempDir, { recursive: true, force: true });

    recordPass('Test 12: Stale preview hash correctly aborts file write');
  } catch (err) {
    recordFail('Test 12: Stale hash rejection', err);
  }

  // -------------------------------------------------------------------------
  // TEST 13: Monorepo -> rootDir correctly reflected
  // -------------------------------------------------------------------------
  try {
    const generator = new VercelConfigGenerator();
    const report = createDeploymentReport({
      project: { isMonorepo: true },
      frontend: { detected: true, framework: 'nextjs', path: 'apps/web' },
      computeTarget: { rootDir: 'apps/web' },
    });

    const res = generator.generate(report, {});
    const parsed = JSON.parse(res.content);
    assert.strictEqual(parsed.rootDirectory, 'apps/web');

    recordPass('Test 13: Monorepo rootDir correctly propagates to generated configuration');
  } catch (err) {
    recordFail('Test 13: Monorepo rootDir handling', err);
  }

  // -------------------------------------------------------------------------
  // TEST 14: Unknown project -> no fabricated configuration
  // -------------------------------------------------------------------------
  try {
    const generator = new DockerConfigGenerator();
    const report = createDeploymentReport({ overallStatus: 'UNKNOWN' });

    const res = generator.generate(report, {});
    assert.ok(res.warnings.length > 0);
    assert.ok(res.content.includes('FROM alpine:latest'));

    recordPass('Test 14: Unknown project emits explicit warning without fabricated framework code');
  } catch (err) {
    recordFail('Test 14: Unknown project handling', err);
  }

  // -------------------------------------------------------------------------
  // TEST 15: Determinism -> identical input produces identical output
  // -------------------------------------------------------------------------
  try {
    const generator = new RenderConfigGenerator();
    const report = createDeploymentReport({
      backend: { detected: true, runtime: 'python', framework: 'fastapi', startCommand: 'uvicorn main:app' },
    });

    const res1 = generator.generate(report, {});
    const res2 = generator.generate(report, {});
    assert.strictEqual(res1.content, res2.content, 'Generated content must be 100% deterministic');

    recordPass('Test 15: Configuration generation is 100% deterministic across repeated runs');
  } catch (err) {
    recordFail('Test 15: Determinism check', err);
  }

  console.log(`\nDeployment Config Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runConfigGeneratorTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
