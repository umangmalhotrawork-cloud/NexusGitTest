/**
 * NEXUS PLATFORM COMPATIBILITY ENGINE — COMPREHENSIVE TEST SUITE (Phase 2A)
 * 
 * Validates deterministic platform scoring across all 12 test specifications:
 * - Test 1: Next.js SSR (Vercel strong)
 * - Test 2: Next.js static export (Vercel/Netlify strong)
 * - Test 3: Vite static frontend (Vercel/Netlify/Render static)
 * - Test 4: Express backend (Render/Railway/Fly.io/Docker > Vercel/Netlify)
 * - Test 5: Express + PostgreSQL + dynamic PORT (Render/Railway strong)
 * - Test 6: Express + PostgreSQL + RULE-01 loopback blocker (Loopback blockers mapped)
 * - Test 7: Python FastAPI (Render/Railway/Fly.io/Docker strong)
 * - Test 8: SQLite persistence requirement (Stateless platforms receive warnings)
 * - Test 9: Dockerized backend (Docker/Fly.io top tier)
 * - Test 10: Monorepo with multiple services (Monorepo root dir awareness)
 * - Test 11: Unknown project (Honest INCOMPATIBLE/LOW confidence)
 * - Test 12: Malformed/partial DeploymentReport (Fault tolerance, 0 crashes)
 */

const assert = require('assert');
const {
  platformCompatibilityEngine,
  SUITABILITY,
  RECOMMENDATION_CONFIDENCE,
  PROVIDER_IDS,
  createDeploymentReport,
  createFinding,
  FINDING_SEVERITY,
  FINDING_CATEGORY,
} = require('./intelligence');

async function runPlatformCompatibilityTests() {
  console.log('\n======================================================');
  console.log('  NEXUS PLATFORM COMPATIBILITY ENGINE — TEST SUITE');
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
  // TEST 1: Next.js SSR
  // -------------------------------------------------------------------------
  try {
    const report = createDeploymentReport({
      workspacePath: '/mock/next-ssr-app',
      frontend: {
        detected: true,
        framework: 'nextjs',
        runtime: 'browser',
        buildScript: 'npm run build (next build)',
        outputDirectory: '.next',
        isStaticExport: false,
        isSSR: true,
        status: 'READY',
      },
    });

    const result = platformCompatibilityEngine.evaluate(report);
    assert.strictEqual(result.recommendedProvider, PROVIDER_IDS.VERCEL);
    const vercel = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.VERCEL);
    assert.strictEqual(vercel.suitability, SUITABILITY.EXCELLENT);
    assert.ok(vercel.score >= 95, `Vercel score should be >= 95, got ${vercel.score}`);
    assert.strictEqual(vercel.computeTarget.serviceType, 'SERVERLESS_APP');

    recordPass('Test 1: Next.js SSR strongly recommends Vercel (EXCELLENT, score >= 95)');
  } catch (err) {
    recordFail('Test 1: Next.js SSR', err);
  }

  // -------------------------------------------------------------------------
  // TEST 2: Next.js Static Export
  // -------------------------------------------------------------------------
  try {
    const report = createDeploymentReport({
      workspacePath: '/mock/next-static-app',
      frontend: {
        detected: true,
        framework: 'nextjs',
        runtime: 'browser',
        buildScript: 'npm run build (next build)',
        outputDirectory: 'out',
        isStaticExport: true,
        isSSR: false,
        status: 'READY',
      },
    });

    const result = platformCompatibilityEngine.evaluate(report);
    const vercel = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.VERCEL);
    const netlify = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.NETLIFY);

    assert.strictEqual(vercel.suitability, SUITABILITY.EXCELLENT);
    assert.strictEqual(netlify.suitability, SUITABILITY.EXCELLENT);
    assert.strictEqual(vercel.computeTarget.serviceType, 'STATIC_SITE');
    assert.strictEqual(netlify.computeTarget.serviceType, 'STATIC_SITE');

    recordPass('Test 2: Next.js static export recommends Vercel and Netlify as static sites');
  } catch (err) {
    recordFail('Test 2: Next.js static export', err);
  }

  // -------------------------------------------------------------------------
  // TEST 3: Vite Static Frontend
  // -------------------------------------------------------------------------
  try {
    const report = createDeploymentReport({
      workspacePath: '/mock/vite-app',
      frontend: {
        detected: true,
        framework: 'react (vite)',
        runtime: 'browser',
        buildScript: 'npm run build (vite build)',
        outputDirectory: 'dist',
        status: 'READY',
      },
    });

    const result = platformCompatibilityEngine.evaluate(report);
    const netlify = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.NETLIFY);
    const vercel = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.VERCEL);
    const render = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.RENDER);

    assert.strictEqual(netlify.suitability, SUITABILITY.EXCELLENT);
    assert.strictEqual(vercel.suitability, SUITABILITY.EXCELLENT);
    assert.strictEqual(render.suitability, SUITABILITY.GOOD);

    recordPass('Test 3: Vite static frontend achieves EXCELLENT/GOOD on Netlify/Vercel/Render');
  } catch (err) {
    recordFail('Test 3: Vite static frontend', err);
  }

  // -------------------------------------------------------------------------
  // TEST 4: Express Backend
  // -------------------------------------------------------------------------
  try {
    const report = createDeploymentReport({
      workspacePath: '/mock/express-api',
      backend: {
        detected: true,
        framework: 'express',
        runtime: 'node',
        entryPoint: 'server.js',
        startCommand: 'npm start (node server.js)',
        port: 'process.env.PORT || 3000',
        hostBinding: '0.0.0.0',
        isHostBindingSafe: true,
        status: 'READY',
      },
    });

    const result = platformCompatibilityEngine.evaluate(report);
    const render = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.RENDER);
    const railway = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.RAILWAY);
    const vercel = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.VERCEL);
    const netlify = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.NETLIFY);

    assert.ok(render.score > vercel.score, `Render (${render.score}) should score higher than Vercel (${vercel.score}) for Express backend`);
    assert.ok(railway.score > netlify.score, `Railway (${railway.score}) should score higher than Netlify (${netlify.score}) for Express backend`);
    assert.strictEqual(netlify.suitability, SUITABILITY.INCOMPATIBLE);

    recordPass('Test 4: Express backend favors Render/Railway/Fly over Vercel/Netlify');
  } catch (err) {
    recordFail('Test 4: Express backend', err);
  }

  // -------------------------------------------------------------------------
  // TEST 5: Express + PostgreSQL + Dynamic PORT
  // -------------------------------------------------------------------------
  try {
    const report = createDeploymentReport({
      workspacePath: '/mock/express-pg-app',
      backend: {
        detected: true,
        framework: 'express',
        runtime: 'node',
        startCommand: 'node index.js',
        port: 'process.env.PORT',
        hostBinding: '0.0.0.0',
        isHostBindingSafe: true,
        status: 'READY',
      },
      database: {
        detected: true,
        technology: 'postgresql',
        ormOrDriver: 'prisma',
        usesEnvVar: true,
        usesLocalhost: false,
        status: 'READY',
      },
    });

    const result = platformCompatibilityEngine.evaluate(report);
    const render = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.RENDER);
    const railway = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.RAILWAY);

    assert.strictEqual(render.suitability, SUITABILITY.EXCELLENT);
    assert.strictEqual(railway.suitability, SUITABILITY.EXCELLENT);
    assert.strictEqual(render.databaseTarget.strategy, 'CO_LOCATED');
    assert.strictEqual(render.databaseTarget.recommendedProvider, 'render_postgres');
    assert.strictEqual(railway.databaseTarget.recommendedProvider, 'railway_postgres');

    recordPass('Test 5: Express + PostgreSQL + dynamic PORT produces EXCELLENT with co-located DB recommendation');
  } catch (err) {
    recordFail('Test 5: Express + PostgreSQL + dynamic PORT', err);
  }

  // -------------------------------------------------------------------------
  // TEST 6: Express + PostgreSQL + RULE-01 Loopback Blocker
  // -------------------------------------------------------------------------
  try {
    const report = createDeploymentReport({
      workspacePath: '/mock/express-bad-host',
      backend: {
        detected: true,
        framework: 'express',
        runtime: 'node',
        startCommand: 'node index.js',
        port: 3000,
        hostBinding: '127.0.0.1',
        isHostBindingSafe: false,
        status: 'BLOCKED',
      },
      findings: [
        createFinding({
          ruleId: 'RULE-01',
          severity: FINDING_SEVERITY.BLOCKER,
          category: FINDING_CATEGORY.BACKEND,
          title: 'Backend Server Binds to Loopback Interface',
          message: 'Server explicitly binds to 127.0.0.1',
          recommendation: 'Bind to 0.0.0.0',
        }),
      ],
    });

    const result = platformCompatibilityEngine.evaluate(report);
    const render = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.RENDER);
    const railway = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.RAILWAY);
    const flyio = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.FLYIO);

    assert.strictEqual(render.suitability, SUITABILITY.INCOMPATIBLE);
    assert.strictEqual(railway.suitability, SUITABILITY.INCOMPATIBLE);
    assert.strictEqual(flyio.suitability, SUITABILITY.INCOMPATIBLE);
    assert.ok(render.blockers.some((b) => b.code.includes('LOOPBACK')));
    assert.ok(railway.blockers.some((b) => b.code.includes('LOOPBACK')));

    recordPass('Test 6: RULE-01 loopback blocker maps directly into platform-specific blockers on Render/Railway/Fly');
  } catch (err) {
    recordFail('Test 6: Loopback blocker mapping', err);
  }

  // -------------------------------------------------------------------------
  // TEST 7: Python FastAPI
  // -------------------------------------------------------------------------
  try {
    const report = createDeploymentReport({
      workspacePath: '/mock/fastapi-app',
      backend: {
        detected: true,
        framework: 'fastapi',
        runtime: 'python',
        startCommand: 'uvicorn main:app --host 0.0.0.0 --port $PORT',
        port: '$PORT',
        hostBinding: '0.0.0.0',
        isHostBindingSafe: true,
        status: 'READY',
      },
    });

    const result = platformCompatibilityEngine.evaluate(report);
    const render = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.RENDER);
    const railway = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.RAILWAY);
    const vercel = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.VERCEL);

    assert.strictEqual(render.suitability, SUITABILITY.EXCELLENT);
    assert.strictEqual(railway.suitability, SUITABILITY.EXCELLENT);
    assert.strictEqual(vercel.suitability, SUITABILITY.POOR);

    recordPass('Test 7: Python FastAPI strongly favors Render/Railway over Vercel/Netlify');
  } catch (err) {
    recordFail('Test 7: Python FastAPI', err);
  }

  // -------------------------------------------------------------------------
  // TEST 8: SQLite + Persistent Storage Requirement
  // -------------------------------------------------------------------------
  try {
    const report = createDeploymentReport({
      workspacePath: '/mock/sqlite-app',
      backend: {
        detected: true,
        framework: 'express',
        runtime: 'node',
        startCommand: 'node app.js',
        hostBinding: '0.0.0.0',
        isHostBindingSafe: true,
        status: 'READY',
      },
      database: {
        detected: true,
        technology: 'sqlite',
        isSQLite: true,
        isEphemeralStorageRisk: true,
        status: 'WARNING',
      },
    });

    const result = platformCompatibilityEngine.evaluate(report);
    const vercel = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.VERCEL);
    const render = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.RENDER);
    const flyio = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.FLYIO);

    assert.strictEqual(vercel.databaseTarget.strategy, 'STATELESS_EPHEMERAL');
    assert.strictEqual(render.databaseTarget.strategy, 'PERSISTENT_VOLUME');
    assert.strictEqual(flyio.databaseTarget.strategy, 'PERSISTENT_VOLUME');
    assert.strictEqual(flyio.databaseTarget.recommendedProvider, 'fly_volumes');
    assert.ok(render.warnings.some((w) => w.code.includes('DISK_REQUIRED')));

    recordPass('Test 8: SQLite persistent volume requirements evaluated accurately across providers');
  } catch (err) {
    recordFail('Test 8: SQLite persistence', err);
  }

  // -------------------------------------------------------------------------
  // TEST 9: Dockerized Backend
  // -------------------------------------------------------------------------
  try {
    const report = createDeploymentReport({
      workspacePath: '/mock/docker-app',
      project: {
        hasDocker: true,
        dockerfile: 'Dockerfile',
        dockerCompose: 'docker-compose.yml',
      },
      backend: {
        detected: true,
        framework: 'custom backend',
        runtime: 'node',
        hostBinding: '0.0.0.0',
        isHostBindingSafe: true,
        status: 'READY',
      },
    });

    const result = platformCompatibilityEngine.evaluate(report);
    const docker = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.DOCKER);
    const flyio = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.FLYIO);

    assert.strictEqual(docker.suitability, SUITABILITY.EXCELLENT);
    assert.strictEqual(flyio.suitability, SUITABILITY.EXCELLENT);
    assert.strictEqual(docker.computeTarget.serviceType, 'DOCKER_CONTAINER');

    recordPass('Test 9: Dockerfile presence boosts Docker and Fly.io to EXCELLENT suitability');
  } catch (err) {
    recordFail('Test 9: Dockerized backend', err);
  }

  // -------------------------------------------------------------------------
  // TEST 10: Monorepo with Multiple Services
  // -------------------------------------------------------------------------
  try {
    const report = createDeploymentReport({
      workspacePath: '/mock/monorepo-app',
      project: {
        isMonorepo: true,
        workspaces: ['apps/web', 'apps/api'],
        packageManager: 'pnpm',
      },
      frontend: {
        detected: true,
        framework: 'nextjs',
        path: 'apps/web',
        status: 'READY',
      },
      backend: {
        detected: true,
        framework: 'fastify',
        path: 'apps/api',
        hostBinding: '0.0.0.0',
        isHostBindingSafe: true,
        status: 'READY',
      },
    });

    const result = platformCompatibilityEngine.evaluate(report);
    const vercel = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.VERCEL);
    const render = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.RENDER);
    const railway = result.recommendations.find((r) => r.providerId === PROVIDER_IDS.RAILWAY);

    assert.ok(vercel.computeTarget.rootDir === 'apps/web' || vercel.reasons.some((r) => r.includes('Root Directory')));
    assert.ok(render.computeTarget.rootDir === 'apps/api' || render.reasons.some((r) => r.includes('Root Directory')));
    assert.strictEqual(railway.suitability, SUITABILITY.EXCELLENT);

    recordPass('Test 10: Monorepo sub-paths correctly propagated to provider rootDir and reasons');
  } catch (err) {
    recordFail('Test 10: Monorepo handling', err);
  }

  // -------------------------------------------------------------------------
  // TEST 11: Unknown Project
  // -------------------------------------------------------------------------
  try {
    const report = createDeploymentReport({
      workspacePath: '/mock/unknown-app',
      overallStatus: 'UNKNOWN',
      summary: 'Insufficient evidence',
    });

    const result = platformCompatibilityEngine.evaluate(report);
    for (const rec of result.recommendations) {
      assert.strictEqual(rec.suitability, SUITABILITY.INCOMPATIBLE);
      assert.strictEqual(rec.confidence, RECOMMENDATION_CONFIDENCE.LOW);
    }

    recordPass('Test 11: Unknown project produces honest INCOMPATIBLE/LOW confidence with no hallucinations');
  } catch (err) {
    recordFail('Test 11: Unknown project', err);
  }

  // -------------------------------------------------------------------------
  // TEST 12: Malformed / Partial DeploymentReport
  // -------------------------------------------------------------------------
  try {
    const malformedReport1 = null;
    const malformedReport2 = {};
    const malformedReport3 = { frontend: { framework: 'invalid' } };

    const res1 = platformCompatibilityEngine.evaluate(malformedReport1);
    const res2 = platformCompatibilityEngine.evaluate(malformedReport2);
    const res3 = platformCompatibilityEngine.evaluate(malformedReport3);

    assert.ok(Array.isArray(res1.recommendations) && res1.recommendations.length === 6);
    assert.ok(Array.isArray(res2.recommendations) && res2.recommendations.length === 6);
    assert.ok(Array.isArray(res3.recommendations) && res3.recommendations.length === 6);

    recordPass('Test 12: Engine gracefully handles null, empty, and partial reports with zero crashes');
  } catch (err) {
    recordFail('Test 12: Malformed report handling', err);
  }

  console.log(`\nPlatform Compatibility Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runPlatformCompatibilityTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
