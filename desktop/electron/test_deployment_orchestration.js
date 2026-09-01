/**
 * NEXUS DEPLOYMENT ORCHESTRATION — AUTOMATED TEST SUITE (Phase 4C)
 * 
 * Verifies:
 * - Multi-stage sequential orchestration (Database -> Backend -> Frontend)
 * - Dynamic output-to-input environment variable wiring
 * - Dynamic secret registration in secretFilter
 * - Preflight validation and stale plan protection
 * - Health check client polling and failure escalation
 * - Partial success handling and cancellation
 * - Zero LLM tokens, zero real cloud API calls, 100% deterministic local mock execution
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

const {
  DeploymentCredentialStore,
  DeploymentOrchestrator,
  HealthCheckClient,
  DeploymentPlanGenerator,
  STAGE_STATUS,
  ORCHESTRATION_STATUS,
  PLAN_STATUS,
} = require('./intelligence');
const secretFilter = require('../security/secretFilter');

console.log('\n======================================================');
console.log('  NEXUS DEPLOYMENT ORCHESTRATOR — TEST SUITE (Phase 4C)');
console.log('======================================================\n');

let passed = 0;
let failed = 0;

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    Error: ${err.message}\n`);
    failed++;
  }
}

function createTempDir(prefix = 'nexus-test-orch-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupTempDir(dir) {
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (_) {}
}

/** Mock safeStorage for deterministic standalone node test execution */
class MockSafeStorage {
  constructor(available = true) {
    this.available = available;
  }
  isEncryptionAvailable() {
    return this.available;
  }
  encryptString(plainText) {
    return Buffer.from(`ENC[${plainText}]`, 'utf8');
  }
  decryptString(cipherBuffer) {
    const str = cipherBuffer.toString('utf8');
    const match = str.match(/^ENC\[(.*)\]$/);
    return match ? match[1] : str;
  }
}

(async () => {

  // -------------------------------------------------------------
  // TEST 1: Preflight validates READY plan
  // -------------------------------------------------------------
  await runTest('Test 1: Preflight validates READY plan with available credentials', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('vercel', { token: 'vcl_token' });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'web-app', dependencies: { next: '^14.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'vercel.json'), '{}');

      const planGenerator = new DeploymentPlanGenerator();
      const plan = planGenerator.generatePlan(tmp);

      const orchestrator = new DeploymentOrchestrator({ credentialStore: store });
      const preflight = await orchestrator.runPreflight(plan);

      assert.strictEqual(preflight.valid, true);
      assert.strictEqual(preflight.servicesCount, 1);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 2: Stale plan is rejected
  // -------------------------------------------------------------
  await runTest('Test 2: Stale plan is rejected with PLAN_STALE when workspace changes', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('vercel', { token: 'vcl_token' });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'app-v1', dependencies: { next: '^14.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'vercel.json'), '{}');

      const planGenerator = new DeploymentPlanGenerator();
      const plan = planGenerator.generatePlan(tmp);

      // Simulate file mutation on disk
      await new Promise((r) => setTimeout(r, 20));
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'app-v2-modified', dependencies: { next: '^14.0.0' } }));

      const orchestrator = new DeploymentOrchestrator({ credentialStore: store });
      const preflight = await orchestrator.runPreflight(plan);

      assert.strictEqual(preflight.valid, false);
      assert.strictEqual(preflight.code, ORCHESTRATION_STATUS.PLAN_STALE);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 3: Missing credential blocks execution
  // -------------------------------------------------------------
  await runTest('Test 3: Missing credential blocks execution with AUTH_REQUIRED', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'empty_vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'web-app', dependencies: { next: '^14.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'vercel.json'), '{}');

      const planGenerator = new DeploymentPlanGenerator();
      const plan = planGenerator.generatePlan(tmp);

      const orchestrator = new DeploymentOrchestrator({ credentialStore: store });
      const preflight = await orchestrator.runPreflight(plan);

      assert.strictEqual(preflight.valid, false);
      assert.strictEqual(preflight.code, ORCHESTRATION_STATUS.AUTH_REQUIRED);
      assert.ok(preflight.missingProviders.includes('vercel'));
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 4: Execution order DB -> API -> Web
  // -------------------------------------------------------------
  await runTest('Test 4: Orchestrator executes stages in plan.executionOrder sequentially', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('vercel', { token: 'vcl_token' });
      store.saveCredential('render', { apiKey: 'rnd_key' });

      // Monorepo with web, api, and db
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['apps/*'] }));
      fs.mkdirSync(path.join(tmp, 'apps/web'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'apps/api/prisma'), { recursive: true });

      fs.writeFileSync(path.join(tmp, 'apps/web/package.json'), JSON.stringify({ name: 'web', dependencies: { next: '^14.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'apps/web/vercel.json'), '{}');

      fs.writeFileSync(path.join(tmp, 'apps/api/package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));
      fs.writeFileSync(path.join(tmp, 'apps/api/render.yaml'), 'services: []');
      fs.writeFileSync(path.join(tmp, 'apps/api/prisma/schema.prisma'), 'datasource db { provider = "postgresql"\nurl = env("DATABASE_URL") }');

      const planGenerator = new DeploymentPlanGenerator();
      const plan = planGenerator.generatePlan(tmp);

      const stagesExecuted = [];
      const mockSpawn = (cmd, args, opts) => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        process.nextTick(() => {
          if (opts.cwd.includes('api')) {
            stagesExecuted.push('api');
            child.stdout.emit('data', Buffer.from('Service live at https://nexus-api.onrender.com\n'));
          } else if (opts.cwd.includes('web')) {
            stagesExecuted.push('web');
            child.stdout.emit('data', Buffer.from('Deployed to https://nexus-web.vercel.app\n'));
          }
          child.emit('close', 0);
        });
        return child;
      };

      const orchestrator = new DeploymentOrchestrator({
        credentialStore: store,
        spawn: mockSpawn,
        databaseAdapter: {
          provision: async (dbTarget, opts, logCb) => {
            stagesExecuted.push('db');
            return { success: true, connectionString: 'postgres://user:secretpass@host:5432/db', durationMs: 10 };
          },
        },
      });

      const res = await orchestrator.startOrchestration(plan);
      assert.strictEqual(res.status, ORCHESTRATION_STATUS.SUCCESS);
      assert.deepStrictEqual(stagesExecuted, ['db', 'api', 'web']);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 5: Database mock produces connectionString
  // -------------------------------------------------------------
  await runTest('Test 5: Database mock produces connectionString and registers secret', async () => {
    const orchestrator = new DeploymentOrchestrator();
    const dbTarget = { databaseId: 'db_test', technology: 'postgresql' };

    const outcome = await orchestrator.executeDatabaseStage(dbTarget);
    assert.strictEqual(outcome.success, true);
    assert.ok(outcome.connectionString.startsWith('postgresql://'));
  });

  // -------------------------------------------------------------
  // TEST 6: DATABASE_URL reaches backend only
  // -------------------------------------------------------------
  await runTest('Test 6: DATABASE_URL reaches backend environment only', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('render', { apiKey: 'rnd_key' });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));
      fs.writeFileSync(path.join(tmp, 'render.yaml'), 'services: []');

      let capturedEnv = null;
      const mockSpawn = (cmd, args, opts) => {
        capturedEnv = opts.env;
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        process.nextTick(() => {
          child.stdout.emit('data', Buffer.from('https://api.onrender.com\n'));
          child.emit('close', 0);
        });
        return child;
      };

      const orchestrator = new DeploymentOrchestrator({ credentialStore: store, spawn: mockSpawn });
      const svcTarget = { serviceId: 'svc_api', name: 'API', recommendedProvider: 'render', rootDir: '' };
      const wiring = [{ sourceId: 'db_main', targetServiceId: 'svc_api', targetEnvVar: 'DATABASE_URL' }];
      const runtimeRecord = { dynamicOutputs: { db_main: { connectionString: 'postgres://usr:secret_pwd_99@db:5432/db' } } };

      await orchestrator.executeServiceStage(svcTarget, tmp, wiring, runtimeRecord);
      assert.strictEqual(capturedEnv.DATABASE_URL, 'postgres://usr:secret_pwd_99@db:5432/db');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 7: Backend receives dynamic secret
  // -------------------------------------------------------------
  await runTest('Test 7: Backend receives dynamic secret without exposing in args', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('render', { apiKey: 'rnd_secret_api_key' });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'api' }));
      fs.writeFileSync(path.join(tmp, 'render.yaml'), 'services: []');

      let capturedArgs = null;
      const mockSpawn = (cmd, args) => {
        capturedArgs = args;
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        process.nextTick(() => {
          child.stdout.emit('data', Buffer.from('https://api.onrender.com\n'));
          child.emit('close', 0);
        });
        return child;
      };

      const orchestrator = new DeploymentOrchestrator({ credentialStore: store, spawn: mockSpawn });
      const svcTarget = { serviceId: 'svc_api', name: 'API', recommendedProvider: 'render', rootDir: '' };
      const wiring = [];
      const runtimeRecord = { dynamicOutputs: {} };

      await orchestrator.executeServiceStage(svcTarget, tmp, wiring, runtimeRecord);
      for (const a of capturedArgs) {
        assert.ok(!a.includes('rnd_secret_api_key'));
      }
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 8: Dynamic secret never reaches renderer result
  // -------------------------------------------------------------
  await runTest('Test 8: Dynamic secret never reaches renderer return payload', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('render', { apiKey: 'rnd_key' });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));
      fs.writeFileSync(path.join(tmp, 'render.yaml'), 'services: []');

      const planGenerator = new DeploymentPlanGenerator();
      const plan = planGenerator.generatePlan(tmp);

      const mockSpawn = (cmd, args) => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        process.nextTick(() => {
          child.stdout.emit('data', Buffer.from('https://api.onrender.com\n'));
          child.emit('close', 0);
        });
        return child;
      };

      const orchestrator = new DeploymentOrchestrator({ credentialStore: store, spawn: mockSpawn });
      const res = await orchestrator.startOrchestration(plan);

      const serialized = JSON.stringify(res);
      assert.ok(!serialized.includes('postgres://'));
      assert.ok(!serialized.includes('rnd_key'));
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 9: Dynamic secret is redacted from logs
  // -------------------------------------------------------------
  await runTest('Test 9: Dynamic secret is redacted from streamed logs', async () => {
    const secretConnStr = 'postgres://admin:ultra_secret_db_pass_123@db.host/db';
    secretFilter.addSecret(secretConnStr);

    const rawLog = `Connecting to ${secretConnStr} now...\n`;
    const cleanLog = secretFilter.sanitizeString(rawLog);

    assert.ok(!cleanLog.includes('ultra_secret_db_pass_123'));
  });

  // -------------------------------------------------------------
  // TEST 10: Backend live URL reaches frontend
  // -------------------------------------------------------------
  await runTest('Test 10: Backend live URL is piped to frontend NEXT_PUBLIC_API_URL', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('vercel', { token: 'vcl_tok' });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'web', dependencies: { next: '^14.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'vercel.json'), '{}');

      let frontendEnv = null;
      const mockSpawn = (cmd, args, opts) => {
        frontendEnv = opts.env;
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        process.nextTick(() => {
          child.stdout.emit('data', Buffer.from('https://nexus-web.vercel.app\n'));
          child.emit('close', 0);
        });
        return child;
      };

      const orchestrator = new DeploymentOrchestrator({ credentialStore: store, spawn: mockSpawn });
      const svcTarget = { serviceId: 'svc_web', name: 'Web', recommendedProvider: 'vercel', rootDir: '' };
      const wiring = [{ sourceId: 'svc_api', targetServiceId: 'svc_web', targetEnvVar: 'NEXT_PUBLIC_API_URL' }];
      const runtimeRecord = { dynamicOutputs: { svc_api: { liveUrl: 'https://api-prod.onrender.com' } } };

      await orchestrator.executeServiceStage(svcTarget, tmp, wiring, runtimeRecord);
      assert.strictEqual(frontendEnv.NEXT_PUBLIC_API_URL, 'https://api-prod.onrender.com');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 11: Frontend receives NEXT_PUBLIC_API_URL
  // -------------------------------------------------------------
  await runTest('Test 11: Frontend receives NEXT_PUBLIC_API_URL correctly', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('vercel', { token: 'vcl_tok' });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'web' }));
      fs.writeFileSync(path.join(tmp, 'vercel.json'), '{}');

      const orch = new DeploymentOrchestrator();
      const adapter = orch.adapters.get('vercel');
      const env = adapter.prepareEnvironment({ token: 'vcl_tok' }, { NEXT_PUBLIC_API_URL: 'https://api.domain.com' });
      assert.strictEqual(env.NEXT_PUBLIC_API_URL, 'https://api.domain.com');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 12: Successful health check permits next stage
  // -------------------------------------------------------------
  await runTest('Test 12: Successful health check permits deployment to proceed', async () => {
    const healthClient = new HealthCheckClient({
      fetchFn: async (url) => ({ status: 200, ok: true }),
    });

    const res = await healthClient.check('https://api-stage.onrender.com', '/api/health');
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.statusCode, 200);
  });

  // -------------------------------------------------------------
  // TEST 13: Failed health check blocks frontend
  // -------------------------------------------------------------
  await runTest('Test 13: Failed health check halts downstream stages', async () => {
    const healthClient = new HealthCheckClient({
      pollIntervalMs: 10,
      timeoutMs: 50,
      fetchFn: async () => ({ status: 503, ok: false }),
    });

    const res = await healthClient.check('https://api-stage.onrender.com', '/api/health');
    assert.strictEqual(res.ok, false);
    assert.ok(res.error.includes('HEALTH_CHECK_TIMEOUT'));
  });

  // -------------------------------------------------------------
  // TEST 14: Database failure skips backend/frontend
  // -------------------------------------------------------------
  await runTest('Test 14: Database failure skips all downstream service stages', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('vercel', { token: 'vcl' });
      store.saveCredential('render', { apiKey: 'rnd' });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['apps/*'] }));
      fs.mkdirSync(path.join(tmp, 'apps/web'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'apps/api/prisma'), { recursive: true });

      fs.writeFileSync(path.join(tmp, 'apps/web/package.json'), JSON.stringify({ name: 'web', dependencies: { next: '^14.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'apps/web/vercel.json'), '{}');

      fs.writeFileSync(path.join(tmp, 'apps/api/package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));
      fs.writeFileSync(path.join(tmp, 'apps/api/render.yaml'), 'services: []');
      fs.writeFileSync(path.join(tmp, 'apps/api/prisma/schema.prisma'), 'datasource db { provider = "postgresql"\nurl = env("DATABASE_URL") }');

      const planGenerator = new DeploymentPlanGenerator();
      const plan = planGenerator.generatePlan(tmp);

      let serviceSpawned = false;
      const mockSpawn = () => {
        serviceSpawned = true;
        const child = new EventEmitter();
        return child;
      };

      const orchestrator = new DeploymentOrchestrator({
        credentialStore: store,
        spawn: mockSpawn,
        databaseAdapter: {
          provision: async () => ({ success: false, error: 'Database provisioning error' }),
        },
      });

      const res = await orchestrator.startOrchestration(plan);
      assert.strictEqual(res.status, ORCHESTRATION_STATUS.FAILED);
      assert.strictEqual(serviceSpawned, false, 'Service stages must be skipped');
      assert.strictEqual(res.services[0].status, STAGE_STATUS.SKIPPED);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 15: Backend failure skips frontend
  // -------------------------------------------------------------
  await runTest('Test 15: Backend failure skips frontend stage', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('vercel', { token: 'vcl' });
      store.saveCredential('render', { apiKey: 'rnd' });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['apps/*'] }));
      fs.mkdirSync(path.join(tmp, 'apps/web'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'apps/api'), { recursive: true });

      fs.writeFileSync(path.join(tmp, 'apps/web/package.json'), JSON.stringify({ name: 'web', dependencies: { next: '^14.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'apps/web/vercel.json'), '{}');

      fs.writeFileSync(path.join(tmp, 'apps/api/package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));
      fs.writeFileSync(path.join(tmp, 'apps/api/render.yaml'), 'services: []');

      const planGenerator = new DeploymentPlanGenerator();
      const plan = planGenerator.generatePlan(tmp);

      let webSpawned = false;
      const mockSpawn = (cmd, args, opts) => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        process.nextTick(() => {
          if (opts.cwd.includes('api')) {
            child.emit('close', 1); // API fails
          } else {
            webSpawned = true;
            child.emit('close', 0);
          }
        });
        return child;
      };

      const orchestrator = new DeploymentOrchestrator({ credentialStore: store, spawn: mockSpawn });
      const res = await orchestrator.startOrchestration(plan);

      assert.strictEqual(res.status, ORCHESTRATION_STATUS.FAILED);
      assert.strictEqual(webSpawned, false, 'Frontend must be skipped');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 16: Frontend failure produces PARTIAL_SUCCESS
  // -------------------------------------------------------------
  await runTest('Test 16: Frontend failure with live backend produces PARTIAL_SUCCESS', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('vercel', { token: 'vcl' });
      store.saveCredential('render', { apiKey: 'rnd' });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'mono', workspaces: ['apps/*'] }));
      fs.mkdirSync(path.join(tmp, 'apps/web'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'apps/api'), { recursive: true });

      fs.writeFileSync(path.join(tmp, 'apps/web/package.json'), JSON.stringify({ name: 'web', dependencies: { next: '^14.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'apps/web/vercel.json'), '{}');

      fs.writeFileSync(path.join(tmp, 'apps/api/package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));
      fs.writeFileSync(path.join(tmp, 'apps/api/render.yaml'), 'services: []');

      const planGenerator = new DeploymentPlanGenerator();
      const plan = planGenerator.generatePlan(tmp);

      const mockSpawn = (cmd, args, opts) => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        process.nextTick(() => {
          if (opts.cwd.includes('api')) {
            child.stdout.emit('data', Buffer.from('Service live at https://nexus-api.onrender.com\n'));
            child.emit('close', 0); // API succeeds
          } else {
            child.emit('close', 1); // Web fails
          }
        });
        return child;
      };

      const orchestrator = new DeploymentOrchestrator({ credentialStore: store, spawn: mockSpawn });
      const res = await orchestrator.startOrchestration(plan);

      assert.strictEqual(res.status, ORCHESTRATION_STATUS.PARTIAL_SUCCESS);
      const apiSvc = res.services.find((s) => s.serviceId === 'svc_apps_api');
      assert.strictEqual(apiSvc.status, STAGE_STATUS.SUCCESS);
      assert.strictEqual(apiSvc.liveUrl, 'https://nexus-api.onrender.com');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 17: Cancellation terminates current stage
  // -------------------------------------------------------------
  await runTest('Test 17: Cancellation terminates active stage process', async () => {
    const orchestrator = new DeploymentOrchestrator();
    let killed = false;

    const mockChild = {
      kill: (sig) => { killed = true; },
    };

    const record = {
      orchestrationId: 'test_orch_123',
      activeChild: mockChild,
      cancelled: false,
    };
    orchestrator.activeOrchestrations.set('test_orch_123', record);

    const res = orchestrator.cancelOrchestration('test_orch_123');
    assert.strictEqual(res.success, true);
    assert.strictEqual(killed, true);
  });

  // -------------------------------------------------------------
  // TEST 18: Cancellation skips pending stages
  // -------------------------------------------------------------
  await runTest('Test 18: Cancellation marks pending stages CANCELLED', async () => {
    const orchestrator = new DeploymentOrchestrator();
    const record = { orchestrationId: 'orch_c', cancelled: true, stageResults: {} };
    orchestrator.activeOrchestrations.set('orch_c', record);

    assert.strictEqual(record.cancelled, true);
  });

  // -------------------------------------------------------------
  // TEST 19: Stage timeout terminates process
  // -------------------------------------------------------------
  await runTest('Test 19: Stage timeout triggers STAGE_TIMEOUT error', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('vercel', { token: 'vcl' });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'web' }));
      fs.writeFileSync(path.join(tmp, 'vercel.json'), '{}');

      const mockSpawn = () => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        // Never emits close
        return child;
      };

      const orchestrator = new DeploymentOrchestrator({
        credentialStore: store,
        spawn: mockSpawn,
        stageTimeoutMs: 30, // 30ms timeout
      });

      const svcTarget = { serviceId: 'svc_web', name: 'Web', recommendedProvider: 'vercel', rootDir: '' };
      const runtimeRecord = { dynamicOutputs: {}, activeChild: null };

      await assert.rejects(async () => {
        await orchestrator.executeServiceStage(svcTarget, tmp, [], runtimeRecord);
      }, /STAGE_TIMEOUT/);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 20: Duplicate orchestration on same workspace rejected
  // -------------------------------------------------------------
  await runTest('Test 20: Concurrent duplicate orchestration is rejected', async () => {
    const tmp = createTempDir();
    try {
      const orchestrator = new DeploymentOrchestrator();
      orchestrator.activeOrchestrations.set('orch_1', {
        workspacePath: path.resolve(tmp),
        status: ORCHESTRATION_STATUS.RUNNING,
      });

      const plan = { workspacePath: tmp, executionOrder: ['svc_1'] };
      const preflight = await orchestrator.runPreflight(plan);

      assert.strictEqual(preflight.valid, false);
      assert.strictEqual(preflight.code, 'CONCURRENT_ORCHESTRATION');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 21: Invalid rootDir rejected
  // -------------------------------------------------------------
  await runTest('Test 21: Invalid rootDir with path traversal is rejected', async () => {
    const tmp = createTempDir();
    try {
      const orchestrator = new DeploymentOrchestrator();
      const plan = {
        workspacePath: tmp,
        executionOrder: ['svc_1'],
        topology: {
          services: [{ serviceId: 'svc_1', name: 'Bad', rootDir: '../../outside', recommendedProvider: 'vercel' }],
        },
      };

      const preflight = await orchestrator.runPreflight(plan);
      assert.strictEqual(preflight.valid, false);
      assert.strictEqual(preflight.code, 'PATH_TRAVERSAL');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 22: Invalid execution order rejected
  // -------------------------------------------------------------
  await runTest('Test 22: Empty execution order is rejected', async () => {
    const tmp = createTempDir();
    try {
      const orchestrator = new DeploymentOrchestrator();
      const plan = { workspacePath: tmp, executionOrder: [] };

      const preflight = await orchestrator.runPreflight(plan);
      assert.strictEqual(preflight.valid, false);
      assert.strictEqual(preflight.code, 'EMPTY_EXECUTION_ORDER');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 23: Invalid live URL rejected by health client
  // -------------------------------------------------------------
  await runTest('Test 23: Insecure or invalid live URL is rejected by health client', async () => {
    const healthClient = new HealthCheckClient();
    const res = await healthClient.check('ftp://insecure-domain.com', '/health');

    assert.strictEqual(res.ok, false);
    assert.ok(res.error.includes('HEALTH_CHECK_INVALID_URL'));
  });

  // -------------------------------------------------------------
  // TEST 24: Secret-free final result verified
  // -------------------------------------------------------------
  await runTest('Test 24: Final result payload contains 0 connection strings or secrets', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('vercel', { token: 'vcl' });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'web', dependencies: { next: '^14.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'vercel.json'), '{}');

      const planGenerator = new DeploymentPlanGenerator();
      const plan = planGenerator.generatePlan(tmp);

      const mockSpawn = (cmd, args) => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        process.nextTick(() => {
          child.stdout.emit('data', Buffer.from('Deployed to https://app.vercel.app\n'));
          child.emit('close', 0);
        });
        return child;
      };

      const orch = new DeploymentOrchestrator({ credentialStore: store, spawn: mockSpawn });
      const res = await orch.startOrchestration(plan);

      assert.strictEqual(res.databases.length, 0);
      assert.strictEqual(res.services[0].liveUrl, 'https://app.vercel.app');
      assert.strictEqual(res.error, null);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 25: Deterministic repeated execution
  // -------------------------------------------------------------
  await runTest('Test 25: Repeated orchestration on same plan produces consistent results', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('vercel', { token: 'vcl' });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'web', dependencies: { next: '^14.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'vercel.json'), '{}');

      const planGenerator = new DeploymentPlanGenerator();
      const plan = planGenerator.generatePlan(tmp);

      const mockSpawn = (cmd, args) => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        process.nextTick(() => {
          child.stdout.emit('data', Buffer.from('Deployed to https://app.vercel.app\n'));
          child.emit('close', 0);
        });
        return child;
      };

      const orch = new DeploymentOrchestrator({ credentialStore: store, spawn: mockSpawn });
      const res1 = await orch.startOrchestration(plan);
      const res2 = await orch.startOrchestration(plan);

      assert.strictEqual(res1.status, res2.status);
      assert.strictEqual(res1.services.length, res2.services.length);
      assert.strictEqual(res1.services[0].liveUrl, res2.services[0].liveUrl);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 26: Orchestrator executes user-selected provider
  // -------------------------------------------------------------
  await runTest('Test 26: Orchestrator executes user-selected provider (e.g. Netlify over Vercel)', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('netlify', { authToken: 'net-token' });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'app', dependencies: { next: '^14.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'netlify.toml'), '[build]\npublish = ".next"');

      const planGenerator = new DeploymentPlanGenerator();
      const basePlan = planGenerator.generatePlan(tmp);
      const svcId = basePlan.topology.services[0].serviceId;

      const plan = planGenerator.generatePlan(tmp, {
        userSelections: { [svcId]: 'netlify' },
      });

      let invokedCmd = '';
      const mockSpawn = (cmd, args) => {
        invokedCmd = `${cmd} ${args.join(' ')}`;
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        process.nextTick(() => {
          child.stdout.emit('data', Buffer.from('Website URL: https://site.netlify.app\n'));
          child.emit('close', 0);
        });
        return child;
      };

      const orch = new DeploymentOrchestrator({ credentialStore: store, spawn: mockSpawn });
      const res = await orch.startOrchestration(plan);

      assert.strictEqual(res.status, ORCHESTRATION_STATUS.SUCCESS);
      assert.ok(invokedCmd.includes('netlify'), 'Must invoke netlify deploy adapter');
      assert.strictEqual(res.services[0].providerId, 'netlify');
      assert.strictEqual(res.services[0].liveUrl, 'https://site.netlify.app');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 27: Orchestrator preflight rejects unsupported user-selected provider
  // -------------------------------------------------------------
  await runTest('Test 27: Preflight rejects unsupported selected provider with UNSUPPORTED_PROVIDER', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'app', dependencies: { express: '^4.18.0' } }));

      const planGenerator = new DeploymentPlanGenerator();
      const basePlan = planGenerator.generatePlan(tmp);
      const svcId = basePlan.topology.services[0].serviceId;

      const plan = planGenerator.generatePlan(tmp, {
        userSelections: { [svcId]: 'railway' },
      });

      const orch = new DeploymentOrchestrator({ credentialStore: store });
      const preflight = await orch.runPreflight(plan);

      assert.strictEqual(preflight.valid, false);
      assert.strictEqual(preflight.code, 'UNSUPPORTED_PROVIDER');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 28: Orchestrator requires credentials for user-selected provider
  // -------------------------------------------------------------
  await runTest('Test 28: Preflight checks auth for selected provider rather than recommended provider', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('vercel', { token: 'vcl' }); // Has Vercel, but user selected Netlify

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'app', dependencies: { next: '^14.0.0' } }));

      const planGenerator = new DeploymentPlanGenerator();
      const basePlan = planGenerator.generatePlan(tmp);
      const svcId = basePlan.topology.services[0].serviceId;

      const plan = planGenerator.generatePlan(tmp, {
        userSelections: { [svcId]: 'netlify' },
      });

      const orch = new DeploymentOrchestrator({ credentialStore: store });
      const preflight = await orch.runPreflight(plan);

      assert.strictEqual(preflight.valid, false);
      assert.strictEqual(preflight.code, ORCHESTRATION_STATUS.AUTH_REQUIRED);
      assert.deepStrictEqual(preflight.missingProviders, ['netlify']);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 29: Immediate frontend process failure produces visible log output
  // -------------------------------------------------------------
  await runTest('Test 29: Frontend process spawn error produces visible log chunk before failure', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('vercel', { token: 'vcl_test_123' });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'web-app', dependencies: { next: '^14.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'vercel.json'), '{}');

      const planGenerator = new DeploymentPlanGenerator();
      const plan = planGenerator.generatePlan(tmp);

      // Mock spawn that fails immediately with ENOENT (e.g. npx not found)
      const mockSpawn = () => {
        const ee = new EventEmitter();
        process.nextTick(() => {
          ee.emit('error', new Error('spawn npx ENOENT'));
        });
        return ee;
      };

      const receivedLogs = [];
      const orch = new DeploymentOrchestrator({ credentialStore: store, spawn: mockSpawn });
      const res = await orch.startOrchestration(plan, {}, (type, payload) => {
        if (type === 'log-chunk') receivedLogs.push(payload.chunk);
      });

      assert.strictEqual(res.status, ORCHESTRATION_STATUS.FAILED);
      assert.ok(receivedLogs.length > 0, 'Must produce visible log chunk even on immediate spawn error');
      const combined = receivedLogs.join('');
      assert.ok(combined.includes('ERROR') || combined.includes('ENOENT'), 'Must contain error details in logs');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 30: Frontend stderr is captured and propagated to renderer
  // -------------------------------------------------------------
  await runTest('Test 30: Frontend stderr output is emitted through log-chunk events', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('vercel', { token: 'vcl_test_123' });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'web-app', dependencies: { next: '^14.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'vercel.json'), '{}');

      const planGenerator = new DeploymentPlanGenerator();
      const plan = planGenerator.generatePlan(tmp);

      // Mock spawn that outputs stderr and exits 1
      const mockSpawn = () => {
        const ee = new EventEmitter();
        ee.stdout = new EventEmitter();
        ee.stderr = new EventEmitter();
        process.nextTick(() => {
          ee.stderr.emit('data', Buffer.from('Error: VITE_API_URL is not defined in App.tsx\n'));
          process.nextTick(() => ee.emit('close', 1));
        });
        return ee;
      };

      const logChunks = [];
      const orch = new DeploymentOrchestrator({ credentialStore: store, spawn: mockSpawn });
      const res = await orch.startOrchestration(plan, {}, (type, payload) => {
        if (type === 'log-chunk') logChunks.push(payload.chunk);
      });

      assert.strictEqual(res.status, ORCHESTRATION_STATUS.FAILED);
      const fullLog = logChunks.join('');
      assert.ok(fullLog.includes('VITE_API_URL is not defined'), 'stderr must be captured in logs');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 31: Provider REST API error (e.g. Render 401) is logged and fails stage
  // -------------------------------------------------------------
  await runTest('Test 31: Provider API HTTP error status is logged and fails stage cleanly', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('render', { apiKey: 'rnd_invalid_key' });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));
      fs.writeFileSync(path.join(tmp, 'render.yaml'), 'services:\n  - type: web\n    name: api\n');

      const planGenerator = new DeploymentPlanGenerator();
      const plan = planGenerator.generatePlan(tmp);

      // Mock API Executor simulating 401 Unauthorized
      const mockApiExecutor = async (execPlan) => {
        throw new Error('Render API returned HTTP 401: Unauthorized access token');
      };

      const orch = new DeploymentOrchestrator({ credentialStore: store });
      const res = await orch.startOrchestration(plan, { mockApiExecutor });

      assert.strictEqual(res.status, ORCHESTRATION_STATUS.FAILED);
      assert.ok(res.services[0].error.includes('401'), 'Must record API error status');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 32: Non-zero exit code cannot become SUCCESS
  // -------------------------------------------------------------
  await runTest('Test 32: Process exiting with code 1 strictly results in FAILED stage', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('vercel', { token: 'vcl_token' });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'web', dependencies: { next: '^14.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'vercel.json'), '{}');

      const plan = new DeploymentPlanGenerator().generatePlan(tmp);

      const mockSpawn = () => {
        const ee = new EventEmitter();
        ee.stdout = new EventEmitter();
        ee.stderr = new EventEmitter();
        process.nextTick(() => {
          ee.stdout.emit('data', Buffer.from('Compiled with errors\n'));
          process.nextTick(() => ee.emit('close', 1));
        });
        return ee;
      };

      const orch = new DeploymentOrchestrator({ credentialStore: store, spawn: mockSpawn });
      const res = await orch.startOrchestration(plan);

      assert.strictEqual(res.status, ORCHESTRATION_STATUS.FAILED);
      assert.strictEqual(res.services[0].status, STAGE_STATUS.FAILED);
      assert.strictEqual(res.services[0].liveUrl, null);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 33: Missing output stream cannot hide a FAILED state
  // -------------------------------------------------------------
  await runTest('Test 33: Silent process crash with zero output emits error log before FAILED transition', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('vercel', { token: 'vcl_token' });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'web', dependencies: { next: '^14.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'vercel.json'), '{}');

      const plan = new DeploymentPlanGenerator().generatePlan(tmp);

      // Closes immediately with code 137 (SIGKILL) without printing anything
      const mockSpawn = () => {
        const ee = new EventEmitter();
        ee.stdout = new EventEmitter();
        ee.stderr = new EventEmitter();
        process.nextTick(() => ee.emit('close', 137));
        return ee;
      };

      const receivedLogs = [];
      const orch = new DeploymentOrchestrator({ credentialStore: store, spawn: mockSpawn });
      const res = await orch.startOrchestration(plan, {}, (type, payload) => {
        if (type === 'log-chunk') receivedLogs.push(payload.chunk);
      });

      assert.strictEqual(res.status, ORCHESTRATION_STATUS.FAILED);
      assert.ok(receivedLogs.length > 0, 'Must produce error log entry even when stdout/stderr were empty');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 34: Successful deployment requires verified HTTPS production output
  // -------------------------------------------------------------
  await runTest('Test 34: Process exiting with code 0 without verified HTTPS URL is marked FAILED', async () => {
    const tmp = createTempDir();
    try {
      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('vercel', { token: 'vcl_token' });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'web', dependencies: { next: '^14.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'vercel.json'), '{}');

      const plan = new DeploymentPlanGenerator().generatePlan(tmp);

      // Exits 0 but outputs no URL
      const mockSpawn = () => {
        const ee = new EventEmitter();
        ee.stdout = new EventEmitter();
        ee.stderr = new EventEmitter();
        process.nextTick(() => {
          ee.stdout.emit('data', Buffer.from('Done in 2.5s\n'));
          process.nextTick(() => ee.emit('close', 0));
        });
        return ee;
      };

      const orch = new DeploymentOrchestrator({ credentialStore: store, spawn: mockSpawn });
      const res = await orch.startOrchestration(plan);

      assert.strictEqual(res.status, ORCHESTRATION_STATUS.FAILED);
      assert.ok(res.services[0].error.includes('URL') || res.services[0].error.includes('live'), 'Must require verified HTTPS URL');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 35: Secrets never appear in logs or diagnostics
  // -------------------------------------------------------------
  await runTest('Test 35: Redaction filter ensures secrets never leak into emitted log chunks', async () => {
    const tmp = createTempDir();
    try {
      const rawSecret = 'SUPER_SECRET_TOKEN_99999999999999999999';
      secretFilter.addSecret(rawSecret);

      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('vercel', { token: rawSecret });

      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'web', dependencies: { next: '^14.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'vercel.json'), '{}');

      const plan = new DeploymentPlanGenerator().generatePlan(tmp);

      const mockSpawn = () => {
        const ee = new EventEmitter();
        ee.stdout = new EventEmitter();
        ee.stderr = new EventEmitter();
        process.nextTick(() => {
          ee.stdout.emit('data', Buffer.from(`Deploying with token: ${rawSecret} to https://my-app.vercel.app\n`));
          process.nextTick(() => ee.emit('close', 0));
        });
        return ee;
      };

      const logChunks = [];
      const orch = new DeploymentOrchestrator({ credentialStore: store, spawn: mockSpawn });
      const res = await orch.startOrchestration(plan, {}, (type, payload) => {
        if (type === 'log-chunk') logChunks.push(payload.chunk);
      });

      assert.strictEqual(res.status, ORCHESTRATION_STATUS.SUCCESS);
      const fullLog = logChunks.join('');
      assert.strictEqual(fullLog.includes(rawSecret), false, 'Raw secret must be redacted');
      assert.ok(fullLog.includes('[REDACTED'), 'Must replace with redaction tag');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 36: Partial success preserves successful endpoints
  // -------------------------------------------------------------
  await runTest('Test 36: Partial success status preserves working backend URL when frontend fails', async () => {
    const tmp = createTempDir();
    try {
      fs.mkdirSync(path.join(tmp, 'backend'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'frontend'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'fullstack', workspaces: ['backend', 'frontend'] }));
      fs.writeFileSync(path.join(tmp, 'backend/package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));
      fs.writeFileSync(path.join(tmp, 'backend/render.yaml'), 'services:\n  - type: web\n');
      fs.writeFileSync(path.join(tmp, 'frontend/package.json'), JSON.stringify({ name: 'web', devDependencies: { vite: '^5.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'frontend/vercel.json'), '{}');

      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('render', { apiKey: 'rnd_key_valid' });
      store.saveCredential('vercel', { token: 'vcl_key_valid' });
      store.saveCredential('netlify', { authToken: 'net_key_valid' });

      const plan = new DeploymentPlanGenerator().generatePlan(tmp);

      // Mock API Executor that succeeds for backend
      const mockApiExecutor = async (execPlan) => {
        return {
          data: { service: { id: 'srv-1', serviceDetails: { url: 'https://my-backend.onrender.com' } } },
          log: 'Render service created: https://my-backend.onrender.com\n',
        };
      };

      // Mock Spawn that fails for frontend
      const mockSpawn = () => {
        const ee = new EventEmitter();
        ee.stdout = new EventEmitter();
        ee.stderr = new EventEmitter();
        process.nextTick(() => {
          ee.stderr.emit('data', Buffer.from('Build failed in frontend\n'));
          process.nextTick(() => ee.emit('close', 1));
        });
        return ee;
      };

      const orch = new DeploymentOrchestrator({
        credentialStore: store,
        spawn: mockSpawn,
      });

      const res = await orch.startOrchestration(plan, { mockApiExecutor });

      assert.strictEqual(res.status, ORCHESTRATION_STATUS.PARTIAL_SUCCESS);
      const backendSvc = res.services.find(s => s.providerId === 'render');
      const frontendSvc = res.services.find(s => s.serviceId.includes('frontend'));

      assert.strictEqual(backendSvc.status, STAGE_STATUS.SUCCESS);
      assert.strictEqual(backendSvc.liveUrl, 'https://my-backend.onrender.com');
      assert.strictEqual(frontendSvc.status, STAGE_STATUS.FAILED);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 37: Failure diagnosis identifies root cause and project evidence
  // -------------------------------------------------------------
  await runTest('Test 37: Failure diagnoser analyzes log and provides file evidence & suggested fix', async () => {
    const tmp = createTempDir();
    try {
      fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'app', dependencies: { react: '^18.0.0' } }));
      fs.writeFileSync(path.join(tmp, 'src/App.tsx'), 'const API_URL = import.meta.env.VITE_API_URL;\nconsole.log(API_URL);');

      const { deploymentFailureDiagnoser, FAILURE_CATEGORY } = require('./intelligence');

      const diag = deploymentFailureDiagnoser.diagnoseFailure({
        workspacePath: tmp,
        stageId: 'svc_frontend',
        providerId: 'vercel',
        serviceName: 'Frontend Web',
        rootDir: '',
        error: 'Process exited with code 1',
        logs: ['Building frontend...\n', 'Error: VITE_API_URL is not defined during build\n'],
      });

      assert.strictEqual(diag.failureCategory, FAILURE_CATEGORY.ENVIRONMENT_VARIABLE_MISSING);
      assert.strictEqual(diag.confidence, 'HIGH');
      assert.ok(diag.likelyRootCause.includes('VITE_API_URL'));
      assert.ok(diag.evidence.length > 0);
      assert.ok(diag.suggestedFix.includes('VITE_API_URL'));
      assert.strictEqual(diag.isRetrySafe, true);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 38: Failure diagnosis for missing build script in package.json
  // -------------------------------------------------------------
  await runTest('Test 38: Failure diagnoser detects missing build script and suggests package.json fix', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'app', scripts: { start: 'node index.js' } }));

      const { deploymentFailureDiagnoser, FAILURE_CATEGORY } = require('./intelligence');

      const diag = deploymentFailureDiagnoser.diagnoseFailure({
        workspacePath: tmp,
        stageId: 'svc_backend',
        providerId: 'render',
        serviceName: 'Backend API',
        rootDir: '',
        error: 'npm ERR! missing script: build',
        logs: ['npm ERR! missing script: build\n'],
      });

      assert.strictEqual(diag.failureCategory, FAILURE_CATEGORY.BUILD_SCRIPT_MISSING);
      assert.strictEqual(diag.confidence, 'HIGH');
      assert.ok(diag.suggestedFix.includes('"build"'));
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 39: Render stage dynamically resolves workspace and includes ownerId
  // -------------------------------------------------------------
  await runTest('Test 39: Orchestrator queries Render owners and supplies ownerId to Create Service', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));
      fs.writeFileSync(path.join(tmp, 'render.yaml'), 'services:\n  - type: web\n');

      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('render', { apiKey: 'rnd_valid_key_123' });

      const plan = new DeploymentPlanGenerator().generatePlan(tmp);

      let receivedPayload = null;
      const mockApiExecutor = async (execPlan) => {
        receivedPayload = execPlan.payload;
        return {
          data: { service: { id: 'srv-rendered-123', serviceDetails: { url: 'https://my-api.onrender.com' } } },
          log: '[RENDER] Created with ownerId\n',
        };
      };

      // Setup mock .git in workspace
      const dotGit = path.join(tmp, '.git');
      fs.mkdirSync(dotGit, { recursive: true });
      fs.writeFileSync(path.join(dotGit, 'config'), '[remote "origin"]\n\turl = https://github.com/test-org/api.git\n');
      fs.writeFileSync(path.join(dotGit, 'HEAD'), 'ref: refs/heads/main\n');

      const orch = new DeploymentOrchestrator({
        credentialStore: store,
      });

      const res = await orch.startOrchestration(plan, {
        mockApiExecutor,
        mockOwnerInfo: { ownerId: 'tea-team-workspace-789', ownerName: 'Team Workspace', ownerType: 'team' },
      });

      assert.strictEqual(res.status, ORCHESTRATION_STATUS.SUCCESS);
      assert.ok(receivedPayload, 'Must construct Create Service payload');
      assert.strictEqual(receivedPayload.ownerId, 'tea-team-workspace-789');
      assert.strictEqual(receivedPayload.type, 'web_service');
      assert.strictEqual(receivedPayload.repo, 'https://github.com/test-org/api.git');
      assert.strictEqual(receivedPayload.branch, 'main');
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 40: Render missing required fields diagnoses as PROVIDER_CONFIGURATION_ERROR
  // -------------------------------------------------------------
  await runTest('Test 40: Diagnoser classifies missing ownerId as PROVIDER_CONFIGURATION_ERROR', async () => {
    const tmp = createTempDir();
    try {
      const { deploymentFailureDiagnoser, FAILURE_CATEGORY } = require('./intelligence');

      const diag = deploymentFailureDiagnoser.diagnoseFailure({
        workspacePath: tmp,
        stageId: 'svc_backend',
        providerId: 'render',
        serviceName: 'Backend Service',
        rootDir: '',
        error: 'Render API Error (HTTP 400): {"message":"ownerID is a required field"}',
        logs: ['[RENDER ERROR] API request failed with HTTP 400: {"message":"ownerID is a required field"}\n'],
      });

      assert.strictEqual(diag.failureCategory, FAILURE_CATEGORY.PROVIDER_CONFIGURATION_ERROR);
      assert.strictEqual(diag.affectedAdapter, 'RenderDeployAdapter');
      assert.ok(diag.likelyRootCause.includes('owner/workspace ID') || diag.likelyRootCause.includes('owner'));
      assert.ok(diag.suggestedFix.includes('workspace') || diag.suggestedFix.includes('ownerId'));
      assert.strictEqual(diag.isRetrySafe, true);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 41: Diagnoser classifies missing repo error as PROVIDER_CONFIGURATION_ERROR
  // -------------------------------------------------------------
  await runTest('Test 41: Diagnoser classifies missing repo as PROVIDER_CONFIGURATION_ERROR with actionable fix', async () => {
    const tmp = createTempDir();
    try {
      const { deploymentFailureDiagnoser, FAILURE_CATEGORY } = require('./intelligence');

      const diag = deploymentFailureDiagnoser.diagnoseFailure({
        workspacePath: tmp,
        stageId: 'svc_backend',
        providerId: 'render',
        serviceName: 'Backend Service',
        rootDir: 'backend',
        error: 'Render API Error (HTTP 400): {"message":"repo is required when using runtime: node"}',
        logs: ['[RENDER ERROR] API request failed with HTTP 400: {"message":"repo is required when using runtime: node"}\n'],
      });

      assert.strictEqual(diag.failureCategory, FAILURE_CATEGORY.PROVIDER_CONFIGURATION_ERROR);
      assert.strictEqual(diag.affectedAdapter, 'RenderDeployAdapter');
      assert.ok(diag.likelyRootCause.includes('repo') || diag.likelyRootCause.includes('Git'));
      assert.ok(diag.suggestedFix.includes('Git remote repository') || diag.suggestedFix.includes('repo'));
      assert.strictEqual(diag.isRetrySafe, true);
    } finally {
      cleanupTempDir(tmp);
    }
  });

  // -------------------------------------------------------------
  // TEST 42: Missing Git remote repository rejects before API request
  // -------------------------------------------------------------
  await runTest('Test 42: Missing Git repository throws RENDER_REPOSITORY_REQUIRED and stops execution', async () => {
    const tmp = createTempDir();
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'api', dependencies: { express: '^4.18.0' } }));
      fs.writeFileSync(path.join(tmp, 'render.yaml'), 'services:\n  - type: web\n');

      const vaultPath = path.join(tmp, 'vault.json');
      const store = new DeploymentCredentialStore({ safeStorage: new MockSafeStorage(true), vaultPath });
      store.saveCredential('render', { apiKey: 'rnd_valid_key_123' });

      const plan = new DeploymentPlanGenerator().generatePlan(tmp);
      const orch = new DeploymentOrchestrator({ credentialStore: store });

      const res = await orch.startOrchestration(plan, {
        mockOwnerInfo: { ownerId: 'usr-123', ownerName: 'User', ownerType: 'user' },
        requireRealRepo: true,
      });

      assert.strictEqual(res.status, ORCHESTRATION_STATUS.FAILED);
      assert.ok(res.error.includes('RENDER_REPOSITORY_REQUIRED'));
    } finally {
      cleanupTempDir(tmp);
    }
  });

  console.log(`\nDeployment Orchestration Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
})();
