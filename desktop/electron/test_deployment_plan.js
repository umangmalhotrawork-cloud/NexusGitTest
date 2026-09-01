/**
 * NEXUS DEPLOYMENT PLAN GENERATOR — AUTOMATED TEST SUITE (Phase 4A)
 * 
 * Verifies:
 * - Multi-service topology detection across single and monorepo architectures
 * - Database detection and per-service cloud provider mapping
 * - Dependency graph construction and DAG topological sorting
 * - Environment variable wiring (Secret vs Public)
 * - Cycle detection and security blocker rules
 * - Determinism and zero-token operation
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  projectTopologyDetector,
  DeploymentPlanGenerator,
  deploymentPlanGenerator,
  SERVICE_TYPE,
  DATABASE_TECH,
  PLAN_STATUS,
} = require('./intelligence');

console.log('\n======================================================');
console.log('  NEXUS DEPLOYMENT PLAN GENERATOR — TEST SUITE');
console.log('======================================================\n');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}\n`);
    failed++;
  }
}

function createTempDir(prefix = 'nexus-test-plan-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupTempDir(dir) {
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (_) {}
}

// -------------------------------------------------------------
// TEST 1: Single Next.js frontend
// -------------------------------------------------------------
runTest('Test 1: Single Next.js frontend produces one FRONTEND service', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'my-next-app',
      scripts: { build: 'next build', start: 'next start' },
      dependencies: { next: '^14.0.0', react: '^18.2.0' },
    }));

    const topology = projectTopologyDetector.detectTopology(tmp);
    assert.strictEqual(topology.services.length, 1);
    assert.strictEqual(topology.services[0].type, SERVICE_TYPE.FRONTEND);
    assert.ok(topology.services[0].framework === 'next' || topology.services[0].framework === 'nextjs');

    const plan = deploymentPlanGenerator.generatePlan(topology);
    assert.strictEqual(plan.overallStatus, PLAN_STATUS.READY);
    assert.strictEqual(plan.topology.services.length, 1);
    assert.strictEqual(plan.topology.services[0].recommendedProvider, 'vercel');
    assert.strictEqual(plan.executionOrder.length, 1);
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 2: Express backend + PostgreSQL
// -------------------------------------------------------------
runTest('Test 2: Express backend + PostgreSQL produces backend service and database', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'my-api',
      scripts: { start: 'node index.js' },
      dependencies: { express: '^4.18.0', pg: '^8.11.0' },
    }));
    fs.writeFileSync(path.join(tmp, 'index.js'), `
      const express = require('express');
      const app = express();
      const port = process.env.PORT || 3000;
      app.listen(port, '0.0.0.0', () => {});
    `);

    const topology = projectTopologyDetector.detectTopology(tmp);
    assert.strictEqual(topology.services.length, 1);
    assert.strictEqual(topology.services[0].type, SERVICE_TYPE.BACKEND);
    assert.strictEqual(topology.databases.length, 1);
    assert.strictEqual(topology.databases[0].technology, 'postgresql');

    const plan = deploymentPlanGenerator.generatePlan(topology);
    assert.strictEqual(plan.overallStatus, PLAN_STATUS.READY);
    assert.strictEqual(plan.topology.databases.length, 1);
    assert.strictEqual(plan.topology.databases[0].recommendedProvider, 'render_postgres');
    assert.strictEqual(plan.topology.services[0].recommendedProvider, 'render');
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 3: Next.js frontend + Express backend + PostgreSQL
// -------------------------------------------------------------
runTest('Test 3: Web + API + DB produces multi-stage execution order: DB -> API -> Web', () => {
  const tmp = createTempDir();
  try {
    // Setup monorepo
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'fullstack-monorepo',
      workspaces: ['apps/*'],
    }));
    fs.mkdirSync(path.join(tmp, 'apps/web'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'apps/api'), { recursive: true });

    // Web App
    fs.writeFileSync(path.join(tmp, 'apps/web/package.json'), JSON.stringify({
      name: 'web',
      scripts: { build: 'next build' },
      dependencies: { next: '^14.0.0', react: '^18.0.0' },
    }));

    // API App with DB
    fs.writeFileSync(path.join(tmp, 'apps/api/package.json'), JSON.stringify({
      name: 'api',
      scripts: { start: 'node server.js' },
      dependencies: { express: '^4.18.0', pg: '^8.0.0' },
    }));
    fs.writeFileSync(path.join(tmp, 'apps/api/server.js'), `
      const express = require('express');
      const app = express();
      const dbUrl = process.env.DATABASE_URL;
      app.listen(process.env.PORT || 4000, '0.0.0.0');
    `);

    const topology = projectTopologyDetector.detectTopology(tmp);
    assert.strictEqual(topology.services.length, 2);
    assert.strictEqual(topology.databases.length, 1);

    const plan = deploymentPlanGenerator.generatePlan(topology);
    assert.strictEqual(plan.overallStatus, PLAN_STATUS.READY);
    assert.strictEqual(plan.executionOrder.length, 3);

    // DB must precede API, API must precede Web
    const dbIdx = plan.executionOrder.indexOf(plan.topology.databases[0].databaseId);
    const apiIdx = plan.executionOrder.indexOf('svc_apps_api');
    const webIdx = plan.executionOrder.indexOf('svc_apps_web');

    assert.ok(dbIdx >= 0 && apiIdx >= 0 && webIdx >= 0);
    assert.ok(dbIdx < apiIdx, 'Database must be deployed before API');
    assert.ok(apiIdx < webIdx, 'API must be deployed before Web Frontend');
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 4: Frontend + backend with explicit API URL dependency
// -------------------------------------------------------------
runTest('Test 4: Frontend + backend with explicit API URL dependency maps wiring', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'repo',
      workspaces: ['apps/*'],
    }));
    fs.mkdirSync(path.join(tmp, 'apps/web'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'apps/api'), { recursive: true });

    fs.writeFileSync(path.join(tmp, 'apps/web/package.json'), JSON.stringify({
      name: 'client',
      dependencies: { vite: '^5.0.0', react: '^18.0.0' },
    }));
    fs.writeFileSync(path.join(tmp, 'apps/api/package.json'), JSON.stringify({
      name: 'server',
      dependencies: { express: '^4.18.0' },
    }));
    fs.writeFileSync(path.join(tmp, '.env.example'), 'VITE_API_URL=http://localhost:4000\n');

    const plan = deploymentPlanGenerator.generatePlan(tmp);
    const apiWiring = plan.wiring.find((w) => w.targetEnvVar === 'VITE_API_URL' || w.targetEnvVar === 'NEXT_PUBLIC_API_URL');
    assert.ok(apiWiring, 'Must wire API URL to frontend');
    assert.strictEqual(apiWiring.sourceOutput, 'LIVE_URL');
    assert.strictEqual(apiWiring.isSecret, false);
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 5: Backend + DATABASE_URL
// -------------------------------------------------------------
runTest('Test 5: Backend + DATABASE_URL creates secret database wiring', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'api-service',
      dependencies: { express: '^4.18.0', '@prisma/client': '^5.0.0' },
    }));
    fs.mkdirSync(path.join(tmp, 'prisma'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'prisma/schema.prisma'), `
      datasource db {
        provider = "postgresql"
        url      = env("DATABASE_URL")
      }
    `);

    const plan = deploymentPlanGenerator.generatePlan(tmp);
    const dbWiring = plan.wiring.find((w) => w.targetEnvVar === 'DATABASE_URL');
    assert.ok(dbWiring, 'Must create DATABASE_URL wiring');
    assert.strictEqual(dbWiring.sourceOutput, 'CONNECTION_STRING');
    assert.strictEqual(dbWiring.isSecret, true);
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 6: Monorepo: apps/web, apps/api, packages/db
// -------------------------------------------------------------
runTest('Test 6: Monorepo with apps/web, apps/api, and packages/db creates 3 distinct topology nodes', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n  - "packages/*"\n');
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'monorepo-root' }));

    fs.mkdirSync(path.join(tmp, 'apps/web'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'apps/api'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'packages/db/prisma'), { recursive: true });

    fs.writeFileSync(path.join(tmp, 'apps/web/package.json'), JSON.stringify({
      name: 'web-app',
      dependencies: { next: '^14.0.0' },
    }));

    fs.writeFileSync(path.join(tmp, 'apps/api/package.json'), JSON.stringify({
      name: 'api-app',
      dependencies: { express: '^4.18.0' },
    }));

    fs.writeFileSync(path.join(tmp, 'packages/db/package.json'), JSON.stringify({
      name: '@repo/db',
      dependencies: { '@prisma/client': '^5.0.0' },
    }));
    fs.writeFileSync(path.join(tmp, 'packages/db/prisma/schema.prisma'), `
      datasource db {
        provider = "postgresql"
        url      = env("DATABASE_URL")
      }
    `);

    const topology = projectTopologyDetector.detectTopology(tmp);
    assert.strictEqual(topology.services.length, 2);
    assert.strictEqual(topology.databases.length, 1);

    const plan = deploymentPlanGenerator.generatePlan(topology);
    assert.strictEqual(plan.overallStatus, PLAN_STATUS.READY);
    assert.strictEqual(plan.topology.services.length, 2);
    assert.strictEqual(plan.topology.databases.length, 1);
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 7: Multiple frontends
// -------------------------------------------------------------
runTest('Test 7: Multiple frontends are represented independently', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'multi-fe-repo',
      workspaces: ['apps/*'],
    }));

    fs.mkdirSync(path.join(tmp, 'apps/client'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'apps/admin'), { recursive: true });

    fs.writeFileSync(path.join(tmp, 'apps/client/package.json'), JSON.stringify({
      name: 'client-portal',
      dependencies: { next: '^14.0.0' },
    }));

    fs.writeFileSync(path.join(tmp, 'apps/admin/package.json'), JSON.stringify({
      name: 'admin-portal',
      dependencies: { vite: '^5.0.0', react: '^18.0.0' },
    }));

    const topology = projectTopologyDetector.detectTopology(tmp);
    assert.strictEqual(topology.services.length, 2);
    assert.strictEqual(topology.services[0].type, SERVICE_TYPE.FRONTEND);
    assert.strictEqual(topology.services[1].type, SERVICE_TYPE.FRONTEND);

    const plan = deploymentPlanGenerator.generatePlan(topology);
    assert.strictEqual(plan.topology.services.length, 2);
    assert.notStrictEqual(plan.topology.services[0].serviceId, plan.topology.services[1].serviceId);
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 8: Multiple backends
// -------------------------------------------------------------
runTest('Test 8: Multiple backends are represented independently', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'microservices',
      workspaces: ['services/*'],
    }));

    fs.mkdirSync(path.join(tmp, 'services/auth'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'services/billing'), { recursive: true });

    fs.writeFileSync(path.join(tmp, 'services/auth/package.json'), JSON.stringify({
      name: 'auth-service',
      dependencies: { express: '^4.18.0' },
    }));

    fs.writeFileSync(path.join(tmp, 'services/billing/package.json'), JSON.stringify({
      name: 'billing-service',
      dependencies: { fastify: '^4.20.0' },
    }));

    const topology = projectTopologyDetector.detectTopology(tmp);
    assert.strictEqual(topology.services.length, 2);
    assert.strictEqual(topology.services[0].type, SERVICE_TYPE.BACKEND);
    assert.strictEqual(topology.services[1].type, SERVICE_TYPE.BACKEND);

    const plan = deploymentPlanGenerator.generatePlan(topology);
    assert.strictEqual(plan.topology.services.length, 2);
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 9: Unknown relationship
// -------------------------------------------------------------
runTest('Test 9: Unknown relationship produces 0 fabricated dependencies', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'static-site-only',
      dependencies: { next: '^14.0.0' },
    }));

    const plan = deploymentPlanGenerator.generatePlan(tmp);
    assert.strictEqual(plan.dependencies.length, 0, 'Standalone project must have 0 dependencies');
    assert.strictEqual(plan.wiring.length, 0, 'Standalone project must have 0 wiring items');
    assert.strictEqual(plan.executionOrder.length, 1);
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 10: Dependency cycle
// -------------------------------------------------------------
runTest('Test 10: Dependency cycle produces BLOCKED status and empty execution order', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'cycle-repo',
      workspaces: ['apps/*'],
    }));

    fs.mkdirSync(path.join(tmp, 'apps/svc-a'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'apps/svc-b'), { recursive: true });

    fs.writeFileSync(path.join(tmp, 'apps/svc-a/package.json'), JSON.stringify({
      name: 'svc-a',
      dependencies: { express: '^4.18.0' },
    }));

    fs.writeFileSync(path.join(tmp, 'apps/svc-b/package.json'), JSON.stringify({
      name: 'svc-b',
      dependencies: { express: '^4.18.0' },
    }));

    // Inject a circular dependency: A -> B and B -> A
    const customDependencies = [
      { from: 'svc_apps_svc_a', to: 'svc_apps_svc_b', reason: 'Cycle step 1' },
      { from: 'svc_apps_svc_b', to: 'svc_apps_svc_a', reason: 'Cycle step 2' },
    ];

    const plan = deploymentPlanGenerator.generatePlan(tmp, { customDependencies });
    assert.strictEqual(plan.overallStatus, PLAN_STATUS.BLOCKED);
    assert.strictEqual(plan.executionOrder.length, 0);
    assert.ok(plan.blockers.some((b) => /circular dependency/i.test(b)));
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 11: Secret frontend variable
// -------------------------------------------------------------
runTest('Test 11: Secret frontend variable (DATABASE_URL in pure client) emits warning/blocker', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'bad-client',
      dependencies: { vite: '^5.0.0', react: '^18.0.0' },
    }));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src/App.tsx'), 'const db = process.env.DATABASE_URL;');

    const plan = deploymentPlanGenerator.generatePlan(tmp);
    // Should flag security warning or blocker
    assert.ok(plan.warnings.length > 0 || plan.blockers.length > 0);
    assert.ok(plan.warnings.some((w) => /database_url/i.test(w)) || plan.blockers.some((b) => /database_url/i.test(b)));
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 12: Single frontend with no backend
// -------------------------------------------------------------
runTest('Test 12: Single frontend with no backend generates valid standalone READY plan', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'portfolio',
      scripts: { build: 'vite build' },
      dependencies: { vite: '^5.0.0' },
    }));

    const plan = deploymentPlanGenerator.generatePlan(tmp);
    assert.strictEqual(plan.overallStatus, PLAN_STATUS.READY);
    assert.strictEqual(plan.topology.services.length, 1);
    assert.strictEqual(plan.topology.databases.length, 0);
    assert.strictEqual(plan.topology.services[0].recommendedProvider, 'netlify');
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 13: Dockerized backend
// -------------------------------------------------------------
runTest('Test 13: Dockerized backend generates backend/container topology', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'Dockerfile'), `
      FROM node:20-alpine
      WORKDIR /app
      COPY . .
      EXPOSE 8080
      CMD ["node", "server.js"]
    `);

    const topology = projectTopologyDetector.detectTopology(tmp);
    assert.strictEqual(topology.services.length, 1);
    assert.strictEqual(topology.services[0].framework, 'docker');

    const plan = deploymentPlanGenerator.generatePlan(topology);
    assert.strictEqual(plan.overallStatus, PLAN_STATUS.READY);
    assert.strictEqual(plan.topology.services[0].recommendedProvider, 'render');
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 14: Unknown/empty workspace
// -------------------------------------------------------------
runTest('Test 14: Unknown/empty workspace returns honest UNKNOWN plan without hallucinations', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'README.md'), '# Just a readme');

    const plan = deploymentPlanGenerator.generatePlan(tmp);
    assert.strictEqual(plan.overallStatus, PLAN_STATUS.UNKNOWN);
    assert.strictEqual(plan.topology.services.length, 0);
    assert.strictEqual(plan.topology.databases.length, 0);
    assert.strictEqual(plan.executionOrder.length, 0);
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 15: Determinism
// -------------------------------------------------------------
runTest('Test 15: Same workspace evidence produces identical plan structure across multiple runs', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'deterministic-app',
      scripts: { build: 'next build' },
      dependencies: { next: '^14.0.0' },
    }));

    const plan1 = deploymentPlanGenerator.generatePlan(tmp);
    const plan2 = deploymentPlanGenerator.generatePlan(tmp);

    assert.strictEqual(plan1.overallStatus, plan2.overallStatus);
    assert.strictEqual(plan1.topology.services.length, plan2.topology.services.length);
    assert.strictEqual(plan1.topology.services[0].serviceId, plan2.topology.services[0].serviceId);
    assert.strictEqual(plan1.topology.services[0].recommendedProvider, plan2.topology.services[0].recommendedProvider);
    assert.deepStrictEqual(plan1.executionOrder, plan2.executionOrder);
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 16: Framework-Aware Wiring: Vite -> VITE_API_URL
// -------------------------------------------------------------
runTest('Test 16: Vite frontend receives VITE_API_URL from backend LIVE_URL', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'vite-fullstack',
      workspaces: ['frontend', 'backend'],
    }));
    fs.mkdirSync(path.join(tmp, 'frontend'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'backend'), { recursive: true });

    fs.writeFileSync(path.join(tmp, 'frontend/package.json'), JSON.stringify({
      name: 'client',
      dependencies: { react: '^18.0.0' },
      devDependencies: { vite: '^5.0.0' },
    }));
    fs.writeFileSync(path.join(tmp, 'backend/package.json'), JSON.stringify({
      name: 'server',
      dependencies: { express: '^4.18.0' },
    }));

    const plan = deploymentPlanGenerator.generatePlan(tmp);
    const apiWiring = plan.wiring.find((w) => w.sourceOutput === 'LIVE_URL');
    assert.ok(apiWiring, 'Must wire LIVE_URL');
    assert.strictEqual(apiWiring.targetEnvVar, 'VITE_API_URL', 'Vite must receive VITE_API_URL');
    assert.strictEqual(apiWiring.isSecret, false);
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 17: Framework-Aware Wiring: Next.js -> NEXT_PUBLIC_API_URL
// -------------------------------------------------------------
runTest('Test 17: Next.js frontend receives NEXT_PUBLIC_API_URL from backend LIVE_URL', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'next-fullstack',
      workspaces: ['apps/*'],
    }));
    fs.mkdirSync(path.join(tmp, 'apps/web'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'apps/api'), { recursive: true });

    fs.writeFileSync(path.join(tmp, 'apps/web/package.json'), JSON.stringify({
      name: 'client',
      dependencies: { next: '^14.0.0', react: '^18.0.0' },
    }));
    fs.writeFileSync(path.join(tmp, 'apps/api/package.json'), JSON.stringify({
      name: 'server',
      dependencies: { express: '^4.18.0' },
    }));

    const plan = deploymentPlanGenerator.generatePlan(tmp);
    const apiWiring = plan.wiring.find((w) => w.sourceOutput === 'LIVE_URL');
    assert.ok(apiWiring, 'Must wire LIVE_URL');
    assert.strictEqual(apiWiring.targetEnvVar, 'NEXT_PUBLIC_API_URL', 'Next.js must receive NEXT_PUBLIC_API_URL');
    assert.strictEqual(apiWiring.isSecret, false);
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 18: Security: Secret database variables never wired to frontend
// -------------------------------------------------------------
runTest('Test 18: Secret database variables (DATABASE_URL) are never wired to frontend', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'secure-stack',
      workspaces: ['apps/*'],
    }));
    fs.mkdirSync(path.join(tmp, 'apps/web'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'apps/api'), { recursive: true });

    fs.writeFileSync(path.join(tmp, 'apps/web/package.json'), JSON.stringify({
      name: 'client',
      dependencies: { vite: '^5.0.0', react: '^18.0.0' },
    }));
    fs.writeFileSync(path.join(tmp, 'apps/api/package.json'), JSON.stringify({
      name: 'server',
      dependencies: { express: '^4.18.0', pg: '^8.0.0' },
    }));
    fs.writeFileSync(path.join(tmp, 'apps/api/server.js'), 'const db = process.env.DATABASE_URL;');

    const plan = deploymentPlanGenerator.generatePlan(tmp);
    for (const w of plan.wiring) {
      if (w.targetServiceId === 'svc_apps_web' || w.targetServiceId === 'svc_web') {
        assert.notStrictEqual(w.targetEnvVar, 'DATABASE_URL', 'DATABASE_URL must not be wired to frontend');
        assert.strictEqual(w.isSecret, false, 'Frontend wiring must only contain public variables');
      }
    }
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 19: Recommendation remains unchanged after user selection
// -------------------------------------------------------------
runTest('Test 19: Recommendation remains unchanged regardless of user selection', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'vite-app',
      dependencies: { react: '^18.0.0' },
      devDependencies: { vite: '^5.0.0' },
    }));

    const defaultPlan = deploymentPlanGenerator.generatePlan(tmp);
    const customPlan = deploymentPlanGenerator.generatePlan(tmp, {
      userSelections: { svc_web: 'vercel' },
    });

    assert.strictEqual(defaultPlan.topology.services[0].recommendedProvider, customPlan.topology.services[0].recommendedProvider);
    assert.strictEqual(defaultPlan.topology.services[0].score, customPlan.topology.services[0].score);
    assert.strictEqual(defaultPlan.topology.services[0].confidence, customPlan.topology.services[0].confidence);
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 20: User-selected provider differs from recommendation
// -------------------------------------------------------------
runTest('Test 20: User can select Vercel when Netlify is recommended', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'vite-app',
      dependencies: { react: '^18.0.0' },
      devDependencies: { vite: '^5.0.0' },
    }));

    const plan = deploymentPlanGenerator.generatePlan(tmp, {
      userSelections: { svc_web: 'vercel' },
    });

    const svc = plan.topology.services[0];
    assert.strictEqual(svc.recommendedProvider, 'netlify');
    assert.strictEqual(svc.selectedProvider, 'vercel');
    assert.strictEqual(svc.providerDisplayName, 'Vercel');
    assert.strictEqual(svc.executionAvailable, true);
    assert.strictEqual(plan.overallStatus, PLAN_STATUS.READY);
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 21: Selected provider is preserved in DeploymentPlan
// -------------------------------------------------------------
runTest('Test 21: Both recommendedProvider and selectedProvider exist in plan payload', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'app',
      dependencies: { express: '^4.18.0' },
    }));

    const plan = deploymentPlanGenerator.generatePlan(tmp, {
      userSelections: { svc_app: 'render' },
    });

    assert.ok('recommendedProvider' in plan.topology.services[0]);
    assert.ok('selectedProvider' in plan.topology.services[0]);
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 22: Unsupported selected provider produces BLOCKED
// -------------------------------------------------------------
runTest('Test 22: Unsupported selected provider (e.g. Railway) produces BLOCKED status', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'app',
      dependencies: { express: '^4.18.0' },
    }));

    const topology = projectTopologyDetector.detectTopology(tmp);
    const svcId = topology.services[0].serviceId;

    const plan = deploymentPlanGenerator.generatePlan(tmp, {
      userSelections: { [svcId]: 'railway' },
    });

    assert.strictEqual(plan.overallStatus, PLAN_STATUS.BLOCKED);
    assert.strictEqual(plan.topology.services[0].selectedProvider, 'railway');
    assert.strictEqual(plan.topology.services[0].executionAvailable, false);
    assert.ok(plan.blockers.some((b) => b.includes('railway') && b.includes('deployment execution support')));
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 23: Changing frontend provider does not change backend provider
// -------------------------------------------------------------
runTest('Test 23: Changing frontend selection does not mutate backend selection', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'fullstack',
      workspaces: ['apps/*'],
    }));
    fs.mkdirSync(path.join(tmp, 'apps/web'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'apps/api'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'apps/web/package.json'), JSON.stringify({ name: 'web', dependencies: { react: '^18.0.0' }, devDependencies: { vite: '^5.0.0' } }));
    fs.writeFileSync(path.join(tmp, 'apps/api/package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));

    const plan1 = deploymentPlanGenerator.generatePlan(tmp, {
      userSelections: { svc_apps_web: 'vercel' },
    });
    const plan2 = deploymentPlanGenerator.generatePlan(tmp, {
      userSelections: { svc_apps_web: 'netlify' },
    });

    const backend1 = plan1.topology.services.find((s) => s.serviceId === 'svc_apps_api');
    const backend2 = plan2.topology.services.find((s) => s.serviceId === 'svc_apps_api');

    assert.strictEqual(backend1.selectedProvider, 'render');
    assert.strictEqual(backend2.selectedProvider, 'render');
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 24: Changing backend provider does not change frontend provider
// -------------------------------------------------------------
runTest('Test 24: Changing backend selection does not mutate frontend selection', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'fullstack',
      workspaces: ['apps/*'],
    }));
    fs.mkdirSync(path.join(tmp, 'apps/web'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'apps/api'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'apps/web/package.json'), JSON.stringify({ name: 'web', dependencies: { react: '^18.0.0' }, devDependencies: { vite: '^5.0.0' } }));
    fs.writeFileSync(path.join(tmp, 'apps/api/package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));

    const plan = deploymentPlanGenerator.generatePlan(tmp, {
      userSelections: { svc_apps_api: 'railway' },
    });

    const frontend = plan.topology.services.find((s) => s.serviceId === 'svc_apps_web');
    const backend = plan.topology.services.find((s) => s.serviceId === 'svc_apps_api');

    assert.strictEqual(frontend.selectedProvider, 'netlify');
    assert.strictEqual(backend.selectedProvider, 'railway');
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 25: Recommendation scores never change due to user selection
// -------------------------------------------------------------
runTest('Test 25: Recommendation score and confidence are immutable to selections', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'api',
      dependencies: { express: '^4.18.0' },
    }));

    const p1 = deploymentPlanGenerator.generatePlan(tmp);
    const p2 = deploymentPlanGenerator.generatePlan(tmp, { userSelections: { svc_api: 'railway' } });

    assert.strictEqual(p1.topology.services[0].score, p2.topology.services[0].score);
    assert.strictEqual(p1.topology.services[0].confidence, p2.topology.services[0].confidence);
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 26: No silent provider substitution
// -------------------------------------------------------------
runTest('Test 26: Unsupported selection is never silently swapped for a supported provider', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'app',
      dependencies: { express: '^4.18.0' },
    }));

    const topology = projectTopologyDetector.detectTopology(tmp);
    const svcId = topology.services[0].serviceId;

    const plan = deploymentPlanGenerator.generatePlan(tmp, {
      userSelections: { [svcId]: 'railway' },
    });

    assert.strictEqual(plan.topology.services[0].selectedProvider, 'railway');
    assert.notStrictEqual(plan.topology.services[0].selectedProvider, 'render');
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 27: User selection persists across subsequent plan generations without passing options
// -------------------------------------------------------------
runTest('Test 27: User selection persists across subsequent generatePlan calls on same workspace', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'fullstack',
      workspaces: ['apps/*'],
    }));
    fs.mkdirSync(path.join(tmp, 'apps/web'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'apps/api'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'apps/web/package.json'), JSON.stringify({ name: 'web', dependencies: { react: '^18.0.0' }, devDependencies: { vite: '^5.0.0' } }));
    fs.writeFileSync(path.join(tmp, 'apps/api/package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));

    // 1. Initial generation - recommendation selects Netlify for Vite
    const initialPlan = deploymentPlanGenerator.generatePlan(tmp);
    const initialWeb = initialPlan.topology.services.find((s) => s.serviceId === 'svc_apps_web');
    assert.strictEqual(initialWeb.recommendedProvider, 'netlify');
    assert.strictEqual(initialWeb.selectedProvider, 'netlify');
    assert.strictEqual(initialWeb.selectionSource, 'RECOMMENDATION');

    // 2. User changes frontend to Vercel
    const userSelectedPlan = deploymentPlanGenerator.generatePlan(tmp, {
      userSelections: { svc_apps_web: 'vercel' },
    });
    const selectedWeb = userSelectedPlan.topology.services.find((s) => s.serviceId === 'svc_apps_web');
    assert.strictEqual(selectedWeb.recommendedProvider, 'netlify');
    assert.strictEqual(selectedWeb.selectedProvider, 'vercel');
    assert.strictEqual(selectedWeb.selectionSource, 'USER');

    // 3. Reopening / regenerating plan without userSelections parameter must preserve Vercel!
    const reopenedPlan = deploymentPlanGenerator.generatePlan(tmp);
    const reopenedWeb = reopenedPlan.topology.services.find((s) => s.serviceId === 'svc_apps_web');
    const reopenedApi = reopenedPlan.topology.services.find((s) => s.serviceId === 'svc_apps_api');

    assert.strictEqual(reopenedWeb.recommendedProvider, 'netlify');
    assert.strictEqual(reopenedWeb.selectedProvider, 'vercel');
    assert.strictEqual(reopenedWeb.selectionSource, 'USER');
    assert.strictEqual(reopenedApi.selectedProvider, 'render');
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 28: Explicit saveUserSelections and getUserSelections API
// -------------------------------------------------------------
runTest('Test 28: saveUserSelections and getUserSelections manage selections per workspace', () => {
  const tmp = createTempDir();
  try {
    deploymentPlanGenerator.saveUserSelections(tmp, { svc_web: 'vercel', svc_api: 'render' });
    const selections = deploymentPlanGenerator.getUserSelections(tmp);

    assert.strictEqual(selections.svc_web, 'vercel');
    assert.strictEqual(selections.svc_api, 'render');

    deploymentPlanGenerator.clearUserSelections(tmp);
    const cleared = deploymentPlanGenerator.getUserSelections(tmp);
    assert.deepStrictEqual(cleared, {});
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 29: Backend remains Render when frontend is switched to Vercel
// -------------------------------------------------------------
runTest('Test 29: Switching frontend provider does not mutate backend or database selections', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      name: 'mono',
      workspaces: ['apps/*'],
    }));
    fs.mkdirSync(path.join(tmp, 'apps/web'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'apps/api'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'apps/web/package.json'), JSON.stringify({ name: 'web', dependencies: { react: '^18.0.0' }, devDependencies: { vite: '^5.0.0' } }));
    fs.writeFileSync(path.join(tmp, 'apps/api/package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0', pg: '^8.0.0' } }));

    deploymentPlanGenerator.saveUserSelections(tmp, { svc_apps_web: 'vercel' });
    const plan = deploymentPlanGenerator.generatePlan(tmp);

    const web = plan.topology.services.find((s) => s.serviceId === 'svc_apps_web');
    const api = plan.topology.services.find((s) => s.serviceId === 'svc_apps_api');
    const db = plan.topology.databases.find((d) => d.databaseId === 'db_apps_api');

    assert.strictEqual(web.selectedProvider, 'vercel');
    assert.strictEqual(web.selectionSource, 'USER');
    assert.strictEqual(api.selectedProvider, 'render');
    assert.strictEqual(api.selectionSource, 'RECOMMENDATION');
    assert.strictEqual(db.selectedProvider, 'render_postgres');
    assert.strictEqual(db.selectionSource, 'RECOMMENDATION');
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 30: Durable restart simulation (New generator instance restores disk state)
// -------------------------------------------------------------
runTest('Test 30: Restart simulation — selections survive new generator instance from disk', () => {
  const tmp = createTempDir();
  const storePath = path.join(tmp, 'vault-selections.json');
  try {
    const ws = path.join(tmp, 'proj');
    fs.mkdirSync(path.join(ws, 'apps/web'), { recursive: true });
    fs.mkdirSync(path.join(ws, 'apps/api'), { recursive: true });
    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['apps/*'] }));
    fs.writeFileSync(path.join(ws, 'apps/web/package.json'), JSON.stringify({ name: 'web', dependencies: { react: '^18.0.0' }, devDependencies: { vite: '^5.0.0' } }));
    fs.writeFileSync(path.join(ws, 'apps/api/package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));

    // 1. Process A: User chooses Vercel for web
    const generator1 = new DeploymentPlanGenerator({ storePath });
    generator1.generatePlan(ws, { userSelections: { svc_apps_web: 'vercel' } });

    // Verify file exists on disk
    assert.strictEqual(fs.existsSync(storePath), true);

    // 2. Process B: Complete restart simulation — instantiate new generator with same storePath
    const generator2 = new DeploymentPlanGenerator({ storePath });
    const restoredPlan = generator2.generatePlan(ws);

    const web = restoredPlan.topology.services.find((s) => s.serviceId === 'svc_apps_web');
    assert.strictEqual(web.recommendedProvider, 'netlify');
    assert.strictEqual(web.selectedProvider, 'vercel');
    assert.strictEqual(web.selectionSource, 'USER');
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 31: Workspace isolation (Workspace A selections never affect Workspace B)
// -------------------------------------------------------------
runTest('Test 31: Workspace isolation — Workspace A selections never affect Workspace B', () => {
  const tmp = createTempDir();
  const storePath = path.join(tmp, 'vault-selections.json');
  try {
    const wsA = path.join(tmp, 'projA');
    const wsB = path.join(tmp, 'projB');
    fs.mkdirSync(wsA, { recursive: true });
    fs.mkdirSync(wsB, { recursive: true });

    fs.writeFileSync(path.join(wsA, 'package.json'), JSON.stringify({ name: 'web-a', dependencies: { react: '^18.0.0' }, devDependencies: { vite: '^5.0.0' } }));
    fs.writeFileSync(path.join(wsB, 'package.json'), JSON.stringify({ name: 'web-b', dependencies: { react: '^18.0.0' }, devDependencies: { vite: '^5.0.0' } }));

    const generator = new DeploymentPlanGenerator({ storePath });
    // User chooses Vercel for Workspace A
    generator.generatePlan(wsA, { userSelections: { svc_web: 'vercel' } });

    // Workspace B is generated without selections -> Must remain Netlify recommendation
    const planB = generator.generatePlan(wsB);
    const webB = planB.topology.services[0];

    assert.strictEqual(webB.recommendedProvider, 'netlify');
    assert.strictEqual(webB.selectedProvider, 'netlify');
    assert.strictEqual(webB.selectionSource, 'RECOMMENDATION');

    // Workspace A must retain Vercel
    const planA = generator.generatePlan(wsA);
    const webA = planA.topology.services[0];
    assert.strictEqual(webA.selectedProvider, 'vercel');
    assert.strictEqual(webA.selectionSource, 'USER');
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 32: Explicit reset / clear removes persisted override
// -------------------------------------------------------------
runTest('Test 32: Explicit reset removes persisted override and falls back to recommendation', () => {
  const tmp = createTempDir();
  const storePath = path.join(tmp, 'vault-selections.json');
  try {
    const ws = path.join(tmp, 'proj');
    fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'web', dependencies: { react: '^18.0.0' }, devDependencies: { vite: '^5.0.0' } }));

    const generator = new DeploymentPlanGenerator({ storePath });
    generator.generatePlan(ws, { userSelections: { svc_web: 'vercel' } });

    // Explicit clear
    generator.clearUserSelections(ws);

    // Plan generated after clear
    const resetPlan = generator.generatePlan(ws);
    const web = resetPlan.topology.services[0];

    assert.strictEqual(web.recommendedProvider, 'netlify');
    assert.strictEqual(web.selectedProvider, 'netlify');
    assert.strictEqual(web.selectionSource, 'RECOMMENDATION');
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// TEST 33: Persisted selections file contains 0 secrets or tokens
// -------------------------------------------------------------
runTest('Test 33: Persisted selections store contains zero plaintext secrets, tokens, or passwords', () => {
  const tmp = createTempDir();
  const storePath = path.join(tmp, 'vault-selections.json');
  try {
    const ws = path.join(tmp, 'proj');
    fs.mkdirSync(ws, { recursive: true });
    fs.writeFileSync(path.join(ws, 'package.json'), JSON.stringify({ name: 'web', dependencies: { react: '^18.0.0' } }));

    const generator = new DeploymentPlanGenerator({ storePath });
    generator.generatePlan(ws, {
      userSelections: { svc_web: 'vercel' },
    });

    const fileContent = fs.readFileSync(storePath, 'utf-8');
    assert.ok(!fileContent.includes('token'), 'Must not contain token field');
    assert.ok(!fileContent.includes('password'), 'Must not contain password');
    assert.ok(!fileContent.includes('secret'), 'Must not contain secrets');
    assert.ok(!fileContent.includes('apiKey'), 'Must not contain apiKey');
  } finally {
    cleanupTempDir(tmp);
  }
});

console.log(`\nDeployment Plan Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
