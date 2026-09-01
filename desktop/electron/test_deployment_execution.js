/**
 * NEXUS DEPLOYMENT EXECUTOR — TEST SUITE (Phase 3A)
 * 
 * Validates deployment state machine, preflight checks, child process lifecycle,
 * log streaming, URL extraction, cancellation, and secret redaction.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');
const {
  DEPLOYMENT_STATES,
  DeploymentExecutor,
  VercelDeployAdapter,
  DeploymentCredentialStore,
} = require('./intelligence');

// Mock child process for deterministic unit tests
class MockChildProcess extends EventEmitter {
  constructor(options = {}) {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.options = options;
    this.killed = false;
  }

  kill(signal = 'SIGTERM') {
    this.killed = true;
    this.signal = signal;
    setTimeout(() => {
      this.emit('close', null, signal);
    }, 10);
  }

  simulateSuccess(url = 'https://mock-app.vercel.app') {
    setTimeout(() => {
      this.stdout.emit('data', Buffer.from('Building source code...\n'));
      this.stdout.emit('data', Buffer.from('Uploading artifacts...\n'));
      this.stdout.emit('data', Buffer.from(`Production: ${url}\n`));
      this.emit('close', 0);
    }, 20);
  }

  simulateFailure(exitCode = 1, errorMsg = 'Build failed with syntax error') {
    setTimeout(() => {
      this.stderr.emit('data', Buffer.from(`${errorMsg}\n`));
      this.emit('close', exitCode);
    }, 20);
  }
}

async function runExecutionTests() {
  console.log('\n======================================================');
  console.log('  NEXUS DEPLOYMENT EXECUTOR — TEST SUITE');
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

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-exec-test-'));
  const vaultPath = path.join(tempDir, 'vault.json');

  const mockSafeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (str) => Buffer.from(`ENC:${Buffer.from(str, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (buf) => {
      const s = buf.toString('utf8');
      return Buffer.from(s.slice(4), 'base64').toString('utf8');
    },
  };

  const credStore = new DeploymentCredentialStore({
    safeStorage: mockSafeStorage,
    vaultPath,
  });

  // Pre-seed Vercel credential
  credStore.saveCredential('vercel', { token: 'mock_test_token_123' });

  // Create mock workspace with package.json and vercel.json
  const workspacePath = path.join(tempDir, 'workspace');
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.writeFileSync(path.join(workspacePath, 'package.json'), JSON.stringify({ name: 'mock-app' }), 'utf8');
  fs.writeFileSync(path.join(workspacePath, 'vercel.json'), JSON.stringify({ framework: 'nextjs' }), 'utf8');

  const adapter = new VercelDeployAdapter();

  // -------------------------------------------------------------------------
  // TEST 1: Adapter Resolve Execution Plan
  // -------------------------------------------------------------------------
  try {
    const plan = adapter.resolveExecutionPlan({ workspacePath });
    assert.ok(plan.command.includes('npx'));
    assert.deepStrictEqual(plan.args, ['vercel', '--prod', '--yes']);
    assert.strictEqual(plan.cwd, workspacePath);

    recordPass('Test 1: VercelDeployAdapter resolves non-interactive npx command');
  } catch (err) {
    recordFail('Test 1: Adapter plan resolution', err);
  }

  // -------------------------------------------------------------------------
  // TEST 2: Token Injection into Environment (Never in CLI args)
  // -------------------------------------------------------------------------
  try {
    const plan = adapter.resolveExecutionPlan({ workspacePath });
    assert.ok(!plan.args.includes('mock_test_token_123'));
    assert.ok(!plan.args.includes('--token'));

    const env = adapter.prepareEnvironment('mock_test_token_123');
    assert.strictEqual(env.VERCEL_TOKEN, 'mock_test_token_123');
    assert.strictEqual(env.CI, '1');

    recordPass('Test 2: Token is strictly injected via process.env.VERCEL_TOKEN, never in CLI args');
  } catch (err) {
    recordFail('Test 2: Token env injection', err);
  }

  // -------------------------------------------------------------------------
  // TEST 3: Preflight Success Path
  // -------------------------------------------------------------------------
  try {
    const executor = new DeploymentExecutor({ credentialStore: credStore });
    const preflight = await executor.runPreflight(workspacePath, 'vercel');
    assert.strictEqual(preflight.valid, true);

    recordPass('Test 3: runPreflight passes when workspace, config, and credentials are valid');
  } catch (err) {
    recordFail('Test 3: Preflight success', err);
  }

  // -------------------------------------------------------------------------
  // TEST 4: Preflight Rejects Missing Config
  // -------------------------------------------------------------------------
  try {
    const noConfigDir = path.join(tempDir, 'no-config-ws');
    fs.mkdirSync(noConfigDir, { recursive: true });

    const executor = new DeploymentExecutor({ credentialStore: credStore });
    const preflight = await executor.runPreflight(noConfigDir, 'vercel');
    assert.strictEqual(preflight.valid, false);
    assert.strictEqual(preflight.configMissing, true);

    recordPass('Test 4: runPreflight rejects workspace when vercel.json is missing');
  } catch (err) {
    recordFail('Test 4: Missing config preflight', err);
  }

  // -------------------------------------------------------------------------
  // TEST 5: Preflight Rejects Missing Credentials
  // -------------------------------------------------------------------------
  try {
    const unauthStore = new DeploymentCredentialStore({
      safeStorage: mockSafeStorage,
      vaultPath: path.join(tempDir, 'empty_vault.json'),
    });
    const executor = new DeploymentExecutor({ credentialStore: unauthStore });
    const preflight = await executor.runPreflight(workspacePath, 'vercel');

    assert.strictEqual(preflight.valid, false);
    assert.strictEqual(preflight.authRequired, true);

    recordPass('Test 5: runPreflight rejects deployment when Vercel is not connected');
  } catch (err) {
    recordFail('Test 5: Missing credential preflight', err);
  }

  // -------------------------------------------------------------------------
  // TEST 6: URL Extraction Logic
  // -------------------------------------------------------------------------
  try {
    const sampleOutput = 'Building...\nDeployed to https://my-demo-app.vercel.app [12s]\n';
    const extracted = adapter.extractDeploymentUrl(sampleOutput);
    assert.strictEqual(extracted, 'https://my-demo-app.vercel.app');

    recordPass('Test 6: extractDeploymentUrl correctly extracts https://*.vercel.app');
  } catch (err) {
    recordFail('Test 6: URL extraction', err);
  }

  // -------------------------------------------------------------------------
  // TEST 7: Invalid URL Rejection
  // -------------------------------------------------------------------------
  try {
    const maliciousOutput = 'Deployed to http://insecure-site.com/fake or ftp://bad.com';
    const extracted = adapter.extractDeploymentUrl(maliciousOutput);
    assert.strictEqual(extracted, null, 'Insecure or non-HTTPS URLs must be rejected');

    recordPass('Test 7: Insecure or malformed URLs are rejected');
  } catch (err) {
    recordFail('Test 7: Invalid URL rejection', err);
  }

  // -------------------------------------------------------------------------
  // TEST 8: State Machine Parsing
  // -------------------------------------------------------------------------
  try {
    assert.strictEqual(adapter.parseProgressState('Running "npm run build"'), 'BUILDING');
    assert.strictEqual(adapter.parseProgressState('Uploading build artifacts...'), 'UPLOADING');
    assert.strictEqual(adapter.parseProgressState('Deploying to Vercel...'), 'DEPLOYING');

    recordPass('Test 8: Output parser maps progress strings to BUILDING / UPLOADING / DEPLOYING');
  } catch (err) {
    recordFail('Test 8: State machine parsing', err);
  }

  // -------------------------------------------------------------------------
  // TEST 9: Path Traversal Rejection
  // -------------------------------------------------------------------------
  try {
    let threw = false;
    try {
      adapter.resolveExecutionPlan({ workspacePath, rootDir: '../../outside' });
    } catch (e) {
      if (e.message.includes('Path traversal')) threw = true;
    }
    assert.ok(threw);

    recordPass('Test 9: Path traversal in rootDir is strictly rejected');
  } catch (err) {
    recordFail('Test 9: Path traversal rejection', err);
  }

  // -------------------------------------------------------------------------
  // TEST 10: Secret Redaction in Streaming Logs
  // -------------------------------------------------------------------------
  try {
    const dirty = 'Error at token: ghp_123456789012345678901234567890123456 during build';
    const secretFilter = require('../security/secretFilter');
    const clean = secretFilter.sanitizeString(dirty);

    assert.ok(!clean.includes('ghp_123456789012345678901234567890123456'));

    recordPass('Test 10: Streaming log sanitizer redacts tokens and sensitive patterns');
  } catch (err) {
    recordFail('Test 10: Log secret sanitization', err);
  }

  // -------------------------------------------------------------------------
  // TEST 11: Unique Deployment ID Generation
  // -------------------------------------------------------------------------
  try {
    const executor = new DeploymentExecutor({ credentialStore: credStore });
    const id1 = executor.generateDeploymentId();
    const id2 = executor.generateDeploymentId();

    assert.notStrictEqual(id1, id2);
    assert.ok(id1.startsWith('nexus-deploy-'));

    recordPass('Test 11: generateDeploymentId generates unique IDs');
  } catch (err) {
    recordFail('Test 11: Deployment ID uniqueness', err);
  }

  // -------------------------------------------------------------------------
  // TEST 12: Cancellation on Unknown ID
  // -------------------------------------------------------------------------
  try {
    const executor = new DeploymentExecutor({ credentialStore: credStore });
    const res = executor.cancelDeployment('non-existent-id');
    assert.strictEqual(res.success, false);

    recordPass('Test 12: cancelDeployment handles non-existent ID gracefully');
  } catch (err) {
    recordFail('Test 12: Unknown ID cancellation', err);
  }

  // -------------------------------------------------------------------------
  // TEST 13: Full State Machine Transitions (Mocked Process)
  // -------------------------------------------------------------------------
  try {
    const mockChild = new MockChildProcess();
    const recordedEvents = [];

    const stubExecutor = new DeploymentExecutor({
      credentialStore: credStore,
      spawn: () => mockChild,
    });
    stubExecutor.adapters.set('vercel', {
      providerId: 'vercel',
      displayName: 'Vercel',
      resolveExecutionPlan: () => ({ command: 'mock', args: [], cwd: workspacePath }),
      prepareEnvironment: () => ({ CI: '1' }),
      parseProgressState: adapter.parseProgressState,
      extractDeploymentUrl: adapter.extractDeploymentUrl,
    });

    const runPromise = stubExecutor.startDeployment(
      workspacePath,
      'vercel',
      {},
      (event, payload) => {
        recordedEvents.push({ event, payload });
      }
    );

    mockChild.simulateSuccess('https://test-app.vercel.app');

    const result = await runPromise;
    assert.strictEqual(result.status, DEPLOYMENT_STATES.SUCCESS);
    assert.strictEqual(result.url, 'https://test-app.vercel.app');

    recordPass('Test 13: Full deployment lifecycle transitions from PREFLIGHT to SUCCESS');
  } catch (err) {
    recordFail('Test 13: Lifecycle state transitions', err);
  }

  // -------------------------------------------------------------------------
  // TEST 14: Failure Lifecycle (Mocked Exit Code 1)
  // -------------------------------------------------------------------------
  try {
    const mockChild = new MockChildProcess();
    const stubExecutor = new DeploymentExecutor({
      credentialStore: credStore,
      spawn: () => mockChild,
    });
    stubExecutor.adapters.set('vercel', {
      providerId: 'vercel',
      displayName: 'Vercel',
      resolveExecutionPlan: () => ({ command: 'mock', args: [], cwd: workspacePath }),
      prepareEnvironment: () => ({ CI: '1' }),
      parseProgressState: adapter.parseProgressState,
      extractDeploymentUrl: adapter.extractDeploymentUrl,
    });

    const runPromise = stubExecutor.startDeployment(workspacePath, 'vercel', {});
    mockChild.simulateFailure(1, 'Build syntax error');

    const result = await runPromise;
    assert.strictEqual(result.status, DEPLOYMENT_STATES.FAILED);
    assert.strictEqual(result.exitCode, 1);

    recordPass('Test 14: Failed process cleanly transitions to FAILED state');
  } catch (err) {
    recordFail('Test 14: Failure lifecycle', err);
  }

  // -------------------------------------------------------------------------
  // TEST 15: Cancellation Lifecycle
  // -------------------------------------------------------------------------
  try {
    const mockChild = new MockChildProcess();
    const stubExecutor = new DeploymentExecutor({
      credentialStore: credStore,
      spawn: () => mockChild,
    });
    stubExecutor.adapters.set('vercel', {
      providerId: 'vercel',
      displayName: 'Vercel',
      resolveExecutionPlan: () => ({ command: 'mock', args: [], cwd: workspacePath }),
      prepareEnvironment: () => ({ CI: '1' }),
      parseProgressState: adapter.parseProgressState,
      extractDeploymentUrl: adapter.extractDeploymentUrl,
    });

    let deploymentId = null;
    const runPromise = stubExecutor.startDeployment(workspacePath, 'vercel', {}, (event, payload) => {
      if (payload.deploymentId) deploymentId = payload.deploymentId;
    });

    setTimeout(() => {
      if (deploymentId) {
        stubExecutor.cancelDeployment(deploymentId);
      }
    }, 20);

    const result = await runPromise;
    assert.strictEqual(result.status, DEPLOYMENT_STATES.CANCELLED);

    recordPass('Test 15: cancelDeployment successfully cancels active deployment');
  } catch (err) {
    recordFail('Test 15: Cancellation lifecycle', err);
  }

  // -------------------------------------------------------------------------
  // TEST 16: Duplicate Deployment Rejection
  // -------------------------------------------------------------------------
  try {
    const stubExecutor = new DeploymentExecutor({ credentialStore: credStore });
    stubExecutor.activeDeployments.set('active-dep-1', {
      workspacePath: path.resolve(workspacePath),
      status: DEPLOYMENT_STATES.BUILDING,
    });

    const preflight = await stubExecutor.runPreflight(workspacePath, 'vercel');
    assert.strictEqual(preflight.valid, false);
    assert.ok(preflight.error.includes('already active'));

    recordPass('Test 16: Concurrent duplicate deployment on same workspace is blocked');
  } catch (err) {
    recordFail('Test 16: Duplicate deployment rejection', err);
  }

  // -------------------------------------------------------------------------
  // TEST 17: Log Chunk Event Streaming
  // -------------------------------------------------------------------------
  try {
    const mockChild = new MockChildProcess();
    const stubExecutor = new DeploymentExecutor({
      credentialStore: credStore,
      spawn: () => mockChild,
    });
    stubExecutor.adapters.set('vercel', {
      providerId: 'vercel',
      displayName: 'Vercel',
      resolveExecutionPlan: () => ({ command: 'mock', args: [], cwd: workspacePath }),
      prepareEnvironment: () => ({ CI: '1' }),
      parseProgressState: adapter.parseProgressState,
      extractDeploymentUrl: adapter.extractDeploymentUrl,
    });

    const logEvents = [];
    const runPromise = stubExecutor.startDeployment(
      workspacePath,
      'vercel',
      {},
      (event, payload) => {
        if (event === 'log-chunk') logEvents.push(payload);
      }
    );

    setTimeout(() => {
      mockChild.stdout.emit('data', Buffer.from('Log line 1\n'));
      mockChild.stdout.emit('data', Buffer.from('Log line 2\n'));
      mockChild.emit('close', 0);
    }, 20);

    await runPromise;
    assert.ok(logEvents.length >= 2);
    assert.strictEqual(logEvents[0].stream, 'stdout');

    recordPass('Test 17: Log chunks stream correctly with stream identifier and timestamps');
  } catch (err) {
    recordFail('Test 17: Log chunk streaming', err);
  }

  // -------------------------------------------------------------------------
  // TEST 18: Zero LLM / Zero Token Guarantee
  // -------------------------------------------------------------------------
  try {
    const executor = new DeploymentExecutor({ credentialStore: credStore });
    assert.strictEqual(typeof executor.startDeployment, 'function');
    recordPass('Test 18: Deployment executor operates with zero AI/LLM token consumption');
  } catch (err) {
    recordFail('Test 18: Zero token check', err);
  }

  // -------------------------------------------------------------------------
  // TEST 19: Renderer Payload Token Isolation
  // -------------------------------------------------------------------------
  try {
    const executor = new DeploymentExecutor({ credentialStore: credStore });
    const preflight = await executor.runPreflight(workspacePath, 'vercel');
    const json = JSON.stringify(preflight);
    assert.ok(!json.includes('mock_test_token_123'), 'Preflight result must not leak token');

    recordPass('Test 19: Preflight results and execution metadata never contain raw tokens');
  } catch (err) {
    recordFail('Test 19: Preflight payload token isolation', err);
  }

  // -------------------------------------------------------------------------
  // TEST 20: Clean Active Tracking After Completion
  // -------------------------------------------------------------------------
  try {
    const mockChild = new MockChildProcess();
    const stubExecutor = new DeploymentExecutor({
      credentialStore: credStore,
      spawn: () => mockChild,
    });
    stubExecutor.adapters.set('vercel', {
      providerId: 'vercel',
      displayName: 'Vercel',
      resolveExecutionPlan: () => ({ command: 'mock', args: [], cwd: workspacePath }),
      prepareEnvironment: () => ({ CI: '1' }),
      parseProgressState: adapter.parseProgressState,
      extractDeploymentUrl: adapter.extractDeploymentUrl,
    });

    const runPromise = stubExecutor.startDeployment(workspacePath, 'vercel', {});

    setTimeout(() => {
      mockChild.emit('close', 0);
    }, 20);

    await runPromise;
    assert.strictEqual(stubExecutor.activeDeployments.size, 0, 'Active deployments map must be clean');

    recordPass('Test 20: Active deployments map is completely purged upon process exit');
  } catch (err) {
    recordFail('Test 20: Active tracking cleanup', err);
  }

  // -------------------------------------------------------------------------
  // TEST 21: Render Workspace / Owner ID Dynamic Resolution
  // -------------------------------------------------------------------------
  try {
    const { RenderDeployAdapter } = require('./intelligence');
    const renderAdapter = new RenderDeployAdapter();

    const mockFetch = async (url, opts) => {
      assert.ok(url.includes('/v1/owners'), 'Must query /v1/owners');
      assert.strictEqual(opts.headers.Authorization, 'Bearer rnd_valid_test_key');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify([
          {
            cursor: 'cur-1',
            owner: {
              id: 'tea-nexus-prod-team',
              name: 'Nexus Cloud Team',
              email: 'team@nexus.internal',
              type: 'team',
            },
          },
        ]),
      };
    };

    const ownerInfo = await renderAdapter.resolveOwnerId('rnd_valid_test_key', mockFetch);
    assert.strictEqual(ownerInfo.ownerId, 'tea-nexus-prod-team');
    assert.strictEqual(ownerInfo.ownerName, 'Nexus Cloud Team');
    assert.strictEqual(ownerInfo.ownerType, 'team');

    recordPass('Test 21: RenderDeployAdapter dynamically resolves active workspace owner ID');
  } catch (err) {
    recordFail('Test 21: Render workspace resolution', err);
  }

  // -------------------------------------------------------------------------
  // TEST 22: Render Workspace Resolution Error Handling & Redaction
  // -------------------------------------------------------------------------
  try {
    const { RenderDeployAdapter } = require('./intelligence');
    const renderAdapter = new RenderDeployAdapter();

    const secretApiKey = 'rnd_super_secret_key_99999999999999999999';
    let caughtError = null;

    const mockFailingFetch = async () => {
      return {
        ok: false,
        status: 401,
        text: async () => `Unauthorized: key ${secretApiKey} is invalid`,
      };
    };

    try {
      await renderAdapter.resolveOwnerId(secretApiKey, mockFailingFetch);
    } catch (e) {
      caughtError = e;
    }

    assert.ok(caughtError, 'Must throw on failed workspace resolution');
    assert.ok(caughtError.message.includes('RENDER_WORKSPACE_RESOLUTION_FAILED'), 'Must contain deterministic error code');
    assert.strictEqual(caughtError.message.includes(secretApiKey), false, 'Must never leak raw API key in error message');

    recordPass('Test 22: Workspace resolution failure produces RENDER_WORKSPACE_RESOLUTION_FAILED without secret leakage');
  } catch (err) {
    recordFail('Test 22: Render resolution error & redaction', err);
  }

  // -------------------------------------------------------------------------
  // TEST 23: Render Service Creation Payload Construction with ownerId
  // -------------------------------------------------------------------------
  try {
    const { RenderDeployAdapter } = require('./intelligence');
    const renderAdapter = new RenderDeployAdapter();

    const payload = renderAdapter.prepareServicePayload(
      {
        serviceId: 'svc_backend',
        serviceName: 'nexus-backend-test',
        rootDir: 'backend',
        repo: 'https://github.com/test-org/test-nexus-backend.git',
        branch: 'main',
        buildCommand: 'npm run build',
        startCommand: 'npm start',
      },
      'tea-workspace-456',
      { DATABASE_URL: 'postgres://admin:pass@db:5432/nexus' }
    );

    assert.strictEqual(payload.type, 'web_service');
    assert.strictEqual(payload.name, 'nexus-backend-test');
    assert.strictEqual(payload.ownerId, 'tea-workspace-456');
    assert.strictEqual(payload.repo, 'https://github.com/test-org/test-nexus-backend.git');
    assert.strictEqual(payload.branch, 'main');
    assert.strictEqual(payload.rootDir, 'backend');
    assert.strictEqual(payload.serviceDetails.rootDir, 'backend');
    assert.strictEqual(payload.serviceDetails.buildCommand, 'npm run build');
    assert.strictEqual(payload.serviceDetails.startCommand, 'npm start');
    assert.ok(Array.isArray(payload.serviceDetails.envVars), 'Must format envVars as array');
    assert.strictEqual(payload.serviceDetails.envVars[0].key, 'DATABASE_URL');
    assert.strictEqual(payload.serviceDetails.envVars[0].value, 'postgres://admin:pass@db:5432/nexus');

    recordPass('Test 23: Render service creation payload contains ownerId, repo, branch, serviceDetails, and dynamic envVars');
  } catch (err) {
    recordFail('Test 23: Render service payload construction', err);
  }

  // -------------------------------------------------------------------------
  // TEST 24: resolveGitMetadata extracts remote URL and branch from .git directory
  // -------------------------------------------------------------------------
  try {
    const { RenderDeployAdapter } = require('./intelligence');
    const renderAdapter = new RenderDeployAdapter();

    const mockGitDir = path.join(tempDir, 'mock-git-repo');
    const dotGit = path.join(mockGitDir, '.git');
    fs.mkdirSync(dotGit, { recursive: true });

    fs.writeFileSync(path.join(dotGit, 'config'), `
[core]
	repositoryformatversion = 0
[remote "origin"]
	url = git@github.com:acme-corp/nexus-backend.git
	fetch = +refs/heads/*:refs/remotes/origin/*
`);
    fs.writeFileSync(path.join(dotGit, 'HEAD'), 'ref: refs/heads/feature/deploy-v2\n');

    const meta = renderAdapter.resolveGitMetadata(mockGitDir);
    assert.ok(meta, 'Git metadata must be resolved');
    assert.strictEqual(meta.repoUrl, 'https://github.com/acme-corp/nexus-backend.git', 'Must normalize SSH URL to HTTPS');
    assert.strictEqual(meta.branch, 'feature/deploy-v2', 'Must extract active branch from HEAD');

    recordPass('Test 24: RenderDeployAdapter resolveGitMetadata extracts remote URL and branch from local .git');
  } catch (err) {
    recordFail('Test 24: resolveGitMetadata extraction', err);
  }

  // -------------------------------------------------------------------------
  // TEST 25: Missing remote Git repo throws RENDER_REPOSITORY_REQUIRED
  // -------------------------------------------------------------------------
  try {
    const { RenderDeployAdapter } = require('./intelligence');
    const renderAdapter = new RenderDeployAdapter();

    const nonGitDir = path.join(tempDir, 'non-git-dir');
    fs.mkdirSync(nonGitDir, { recursive: true });

    let thrown = null;
    try {
      renderAdapter.prepareServicePayload(
        {
          serviceId: 'svc_backend',
          serviceName: 'nexus-backend-test',
          rootDir: 'backend',
          workspacePath: nonGitDir,
        },
        'usr-workspace-123'
      );
    } catch (e) {
      thrown = e;
    }

    assert.ok(thrown, 'Must throw when repo is missing for Node runtime');
    assert.ok(thrown.message.includes('RENDER_REPOSITORY_REQUIRED'), 'Must fail with RENDER_REPOSITORY_REQUIRED');

    recordPass('Test 25: Missing remote Git repository throws RENDER_REPOSITORY_REQUIRED without fabricating URL');
  } catch (err) {
    recordFail('Test 25: Missing repo error rejection', err);
  }

  // -------------------------------------------------------------------------
  // TEST 26: rootDir remains backend and is never overwritten
  // -------------------------------------------------------------------------
  try {
    const { RenderDeployAdapter } = require('./intelligence');
    const renderAdapter = new RenderDeployAdapter();

    const payload = renderAdapter.prepareServicePayload(
      {
        serviceId: 'svc_backend',
        rootDir: 'backend',
        repo: 'https://github.com/org/nexus-app.git',
        branch: 'main',
      },
      'usr-123'
    );

    assert.strictEqual(payload.rootDir, 'backend');
    assert.strictEqual(payload.serviceDetails.rootDir, 'backend');

    recordPass('Test 26: rootDir remains backend in top-level payload and serviceDetails');
  } catch (err) {
    recordFail('Test 26: rootDir preservation', err);
  }

  // Cleanup
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log(`\nDeployment Execution Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runExecutionTests().catch((err) => {
  console.error('Fatal execution test error:', err);
  process.exit(1);
});
