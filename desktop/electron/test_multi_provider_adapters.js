/**
 * NEXUS MULTI-PROVIDER DEPLOY ADAPTERS — AUTOMATED TEST SUITE (Phase 4B)
 * 
 * Verifies:
 * - Multi-provider credential storage (Vercel, Render, Netlify, Railway, Fly.io)
 * - SafeStorage encryption & isolation (Zero tokens in renderer IPC)
 * - RenderDeployAdapter REST API execution plans, environment preparation, output extraction
 * - NetlifyDeployAdapter CLI execution plans, argument token isolation, URL extraction
 * - Workspace containment & path traversal protection
 * - Secret sanitization across logs and adapter outputs
 * - 0 LLM tokens, 0 network requests, 0 real cloud calls
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  DeploymentCredentialStore,
  RenderDeployAdapter,
  NetlifyDeployAdapter,
  VercelDeployAdapter,
} = require('./intelligence');
const secretFilter = require('../security/secretFilter');

console.log('\n======================================================');
console.log('  NEXUS MULTI-PROVIDER ADAPTERS — TEST SUITE (Phase 4B)');
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

function createTempDir(prefix = 'nexus-test-adapters-') {
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
    if (!this.available) throw new Error('Encryption unavailable');
    return Buffer.from(`ENC[${plainText}]`, 'utf8');
  }
  decryptString(cipherBuffer) {
    if (!this.available) throw new Error('Decryption unavailable');
    const str = cipherBuffer.toString('utf8');
    const match = str.match(/^ENC\[(.*)\]$/);
    if (!match) throw new Error('Malformed ciphertext');
    return match[1];
  }
}

// -------------------------------------------------------------
// CREDENTIAL STORE TESTS
// -------------------------------------------------------------

runTest('Test 1: Save Vercel credential still works in expanded store', () => {
  const tmpDir = createTempDir();
  try {
    const vaultPath = path.join(tmpDir, 'test_vault.json');
    const store = new DeploymentCredentialStore({
      safeStorage: new MockSafeStorage(true),
      vaultPath,
    });

    const res = store.saveCredential('vercel', { token: 'vcl_token_abc123' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.providerId, 'vercel');
    assert.strictEqual(res.isConnected, true);

    const cred = store.getCredential('vercel');
    assert.strictEqual(cred.token, 'vcl_token_abc123');
  } finally {
    cleanupTempDir(tmpDir);
  }
});

runTest('Test 2: Save Render credential (apiKey)', () => {
  const tmpDir = createTempDir();
  try {
    const vaultPath = path.join(tmpDir, 'test_vault.json');
    const store = new DeploymentCredentialStore({
      safeStorage: new MockSafeStorage(true),
      vaultPath,
    });

    const res = store.saveCredential('render', { apiKey: 'rnd_secret_key_999' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.providerId, 'render');
    assert.strictEqual(res.isConnected, true);

    const cred = store.getCredential('render');
    assert.strictEqual(cred.apiKey, 'rnd_secret_key_999');
  } finally {
    cleanupTempDir(tmpDir);
  }
});

runTest('Test 3: Save Netlify credential (authToken)', () => {
  const tmpDir = createTempDir();
  try {
    const vaultPath = path.join(tmpDir, 'test_vault.json');
    const store = new DeploymentCredentialStore({
      safeStorage: new MockSafeStorage(true),
      vaultPath,
    });

    const res = store.saveCredential('netlify', { authToken: 'nfp_auth_token_777' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.providerId, 'netlify');
    assert.strictEqual(res.isConnected, true);

    const cred = store.getCredential('netlify');
    assert.strictEqual(cred.authToken, 'nfp_auth_token_777');
  } finally {
    cleanupTempDir(tmpDir);
  }
});

runTest('Test 4: Auth status returns only boolean metadata without tokens', () => {
  const tmpDir = createTempDir();
  try {
    const vaultPath = path.join(tmpDir, 'test_vault.json');
    const store = new DeploymentCredentialStore({
      safeStorage: new MockSafeStorage(true),
      vaultPath,
    });

    store.saveCredential('render', { apiKey: 'rnd_secret_key_999' });
    store.saveCredential('netlify', { authToken: 'nfp_auth_token_777' });

    const renderStatus = store.getAuthStatus('render');
    assert.strictEqual(renderStatus.providerId, 'render');
    assert.strictEqual(renderStatus.isConnected, true);
    assert.strictEqual(renderStatus.apiKey, undefined);
    assert.strictEqual(renderStatus.token, undefined);

    const netlifyStatus = store.getAuthStatus('netlify');
    assert.strictEqual(netlifyStatus.providerId, 'netlify');
    assert.strictEqual(netlifyStatus.isConnected, true);
    assert.strictEqual(netlifyStatus.authToken, undefined);
    assert.strictEqual(netlifyStatus.token, undefined);
  } finally {
    cleanupTempDir(tmpDir);
  }
});

runTest('Test 5: Decryption works internally for authorized main-process calls', () => {
  const tmpDir = createTempDir();
  try {
    const vaultPath = path.join(tmpDir, 'test_vault.json');
    const store = new DeploymentCredentialStore({
      safeStorage: new MockSafeStorage(true),
      vaultPath,
    });

    store.saveCredential('railway', { token: 'railway_tok_xyz' });
    const cred = store.getCredential('railway');
    assert.strictEqual(cred.token, 'railway_tok_xyz');
  } finally {
    cleanupTempDir(tmpDir);
  }
});

runTest('Test 6: Renderer payloads never contain plaintext credentials on disk', () => {
  const tmpDir = createTempDir();
  try {
    const vaultPath = path.join(tmpDir, 'test_vault.json');
    const store = new DeploymentCredentialStore({
      safeStorage: new MockSafeStorage(true),
      vaultPath,
    });

    store.saveCredential('render', { apiKey: 'rnd_very_sensitive_key_12345' });
    const diskContent = fs.readFileSync(vaultPath, 'utf8');

    assert.ok(!diskContent.includes('rnd_very_sensitive_key_12345'), 'Plaintext must not exist on disk');
  } finally {
    cleanupTempDir(tmpDir);
  }
});

runTest('Test 7: Secure storage unavailable fails closed', () => {
  const tmpDir = createTempDir();
  try {
    const vaultPath = path.join(tmpDir, 'test_vault.json');
    const store = new DeploymentCredentialStore({
      safeStorage: new MockSafeStorage(false), // Disabled
      vaultPath,
    });

    assert.throws(() => {
      store.saveCredential('render', { apiKey: 'rnd_key' });
    }, /SECURE_STORAGE_UNAVAILABLE/);
  } finally {
    cleanupTempDir(tmpDir);
  }
});

// -------------------------------------------------------------
// RENDER ADAPTER TESTS
// -------------------------------------------------------------

runTest('Test 8: Render adapter builds correct normalized execution plan', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'api-service' }));
    fs.writeFileSync(path.join(tmp, 'render.yaml'), 'services:\n  - type: web\n');

    const adapter = new RenderDeployAdapter();
    const plan = adapter.resolveExecutionPlan({
      workspacePath: tmp,
      serviceId: 'svc_api',
      buildCommand: 'npm run build',
      startCommand: 'npm start',
    });

    assert.strictEqual(plan.type, 'API');
    assert.strictEqual(plan.providerId, 'render');
    assert.strictEqual(plan.serviceName, 'svc_api');
    assert.strictEqual(plan.endpoint, 'https://api.render.com/v1/services');
    assert.strictEqual(plan.payload.buildCommand, 'npm run build');
    assert.strictEqual(plan.payload.startCommand, 'npm start');
  } finally {
    cleanupTempDir(tmp);
  }
});

runTest('Test 9: Render API credential goes through environment/secure main process only', () => {
  const adapter = new RenderDeployAdapter();
  const env = adapter.prepareEnvironment({ apiKey: 'rnd_my_api_key_123' }, { DATABASE_URL: 'postgres://localhost/db' });

  assert.strictEqual(env.RENDER_API_KEY, 'rnd_my_api_key_123');
  assert.strictEqual(env.DATABASE_URL, 'postgres://localhost/db');
  assert.strictEqual(env.CI, '1');
});

runTest('Test 10: Render adapter enforces root directory containment and rejects traversal', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'root' }));
    const adapter = new RenderDeployAdapter();

    assert.throws(() => {
      adapter.resolveExecutionPlan({
        workspacePath: tmp,
        rootDir: '../../outside',
      });
    }, /Path traversal rejected/);
  } finally {
    cleanupTempDir(tmp);
  }
});

runTest('Test 11: Render adapter passes dynamic environment inputs safely', () => {
  const adapter = new RenderDeployAdapter();
  const env = adapter.prepareEnvironment({ apiKey: 'rnd_token' }, {
    DATABASE_URL: 'postgres://user:pass@host:5432/mydb',
    PORT: '8080',
  });

  assert.strictEqual(env.DATABASE_URL, 'postgres://user:pass@host:5432/mydb');
  assert.strictEqual(env.PORT, '8080');
});

runTest('Test 12: Mock successful Render response extracts service ID', () => {
  const adapter = new RenderDeployAdapter();
  const resData = {
    service: {
      id: 'srv-c8abc12345def678',
      name: 'api-service',
      serviceDetails: { url: 'https://api-service.onrender.com' },
    },
  };

  const outputs = adapter.extractOutputs('', resData);
  assert.strictEqual(outputs.serviceId, 'srv-c8abc12345def678');
  assert.strictEqual(outputs.liveUrl, 'https://api-service.onrender.com');
});

runTest('Test 13: Mock successful Render response extracts live URL from log text', () => {
  const adapter = new RenderDeployAdapter();
  const logText = `
    ==> Building service...
    ==> Uploading artifacts...
    ==> Service is live at: https://nexus-api-stage.onrender.com
  `;

  const outputs = adapter.extractOutputs(logText);
  assert.strictEqual(outputs.liveUrl, 'https://nexus-api-stage.onrender.com');
});

runTest('Test 14: Mock API failure becomes normalized adapter failure message', () => {
  const adapter = new RenderDeployAdapter();
  const errStr = adapter.formatApiError(401, { message: 'Invalid API Key provided.' });

  assert.ok(errStr.includes('401'));
  assert.ok(errStr.includes('Invalid API Key provided.'));
});

// -------------------------------------------------------------
// NETLIFY ADAPTER TESTS
// -------------------------------------------------------------

runTest('Test 15: Netlify adapter resolves correct target directory and publish dir', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'frontend-app' }));
    fs.writeFileSync(path.join(tmp, 'netlify.toml'), '[build]\n  publish = "dist"\n');
    fs.mkdirSync(path.join(tmp, 'dist'), { recursive: true });

    const adapter = new NetlifyDeployAdapter();
    const plan = adapter.resolveExecutionPlan({
      workspacePath: tmp,
      outputDirectory: 'dist',
    });

    assert.strictEqual(plan.type, 'CLI');
    assert.strictEqual(plan.providerId, 'netlify');
    assert.ok(plan.args.includes('--prod'));
    assert.ok(plan.args.includes('--dir=dist'));
  } finally {
    cleanupTempDir(tmp);
  }
});

runTest('Test 16: NETLIFY_AUTH_TOKEN never appears in CLI arguments', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'frontend-app' }));
    fs.writeFileSync(path.join(tmp, 'netlify.toml'), '[build]\n');

    const adapter = new NetlifyDeployAdapter();
    const plan = adapter.resolveExecutionPlan({ workspacePath: tmp });

    for (const arg of plan.args) {
      assert.ok(!arg.includes('auth'), 'Auth token must not be in args');
      assert.ok(!arg.includes('nfp_'), 'Token string must not be in args');
    }
  } finally {
    cleanupTempDir(tmp);
  }
});

runTest('Test 17: CLI environment contains Netlify token only inside main process', () => {
  const adapter = new NetlifyDeployAdapter();
  const env = adapter.prepareEnvironment({ authToken: 'nfp_secure_netlify_token_999' }, { VITE_API_URL: 'https://api.com' });

  assert.strictEqual(env.NETLIFY_AUTH_TOKEN, 'nfp_secure_netlify_token_999');
  assert.strictEqual(env.VITE_API_URL, 'https://api.com');
  assert.strictEqual(env.CI, '1');
});

runTest('Test 18: Mock Netlify logs produce BUILDING, UPLOADING, DEPLOYING states', () => {
  const adapter = new NetlifyDeployAdapter();

  assert.strictEqual(adapter.parseProgressState('Creating an optimized production build...'), 'BUILDING');
  assert.strictEqual(adapter.parseProgressState('Uploading files to CDN...'), 'UPLOADING');
  assert.strictEqual(adapter.parseProgressState('Site deploy was successful!'), 'DEPLOYING');
});

runTest('Test 19: Valid Netlify URL is extracted from output', () => {
  const adapter = new NetlifyDeployAdapter();
  const output = `
    Deploying to live URL...
    Website URL: https://nexus-client-stage.netlify.app
  `;

  const res = adapter.extractOutputs(output);
  assert.strictEqual(res.liveUrl, 'https://nexus-client-stage.netlify.app');
});

runTest('Test 20: Invalid or documentation URLs are rejected by Netlify adapter', () => {
  const adapter = new NetlifyDeployAdapter();
  const output = `
    Read docs at https://netlify.com/docs/deployments
    Dashboard: https://app.netlify.com/teams/nexus/overview
  `;

  const res = adapter.extractOutputs(output);
  assert.strictEqual(res.liveUrl, null);
});

runTest('Test 21: Netlify root directory traversal is strictly rejected', () => {
  const tmp = createTempDir();
  try {
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'root' }));
    const adapter = new NetlifyDeployAdapter();

    assert.throws(() => {
      adapter.resolveExecutionPlan({
        workspacePath: tmp,
        rootDir: '../../../etc',
      });
    }, /Path traversal rejected/);
  } finally {
    cleanupTempDir(tmp);
  }
});

runTest('Test 22: Netlify missing configuration is rejected with CONFIGURATION_MISSING', () => {
  const tmp = createTempDir();
  try {
    const adapter = new NetlifyDeployAdapter();
    assert.throws(() => {
      adapter.resolveExecutionPlan({ workspacePath: tmp });
    }, /CONFIGURATION_MISSING/);
  } finally {
    cleanupTempDir(tmp);
  }
});

// -------------------------------------------------------------
// SECURITY & SANITIZATION TESTS
// -------------------------------------------------------------

runTest('Test 23: Secrets are sanitized from log chunks', () => {
  const rawLog = 'Authorization: Bearer rnd_secret_key_12345_test and nfp_token_67890';
  const cleanLog = secretFilter.sanitizeString(rawLog);

  assert.ok(!cleanLog.includes('rnd_secret_key_12345_test'));
});

runTest('Test 24: Secrets do not appear in formatted adapter errors', () => {
  const adapter = new RenderDeployAdapter();
  const err = adapter.formatApiError(500, { error: 'Failed connecting to postgres://admin:supersecretpwd@db.host/db' });

  assert.ok(!err.includes('supersecretpwd'));
});

runTest('Test 25: Secrets do not appear in adapter extraction outputs', () => {
  const adapter = new RenderDeployAdapter();
  const outputs = adapter.extractOutputs('Deployed https://safe-app.onrender.com');

  assert.strictEqual(outputs.liveUrl, 'https://safe-app.onrender.com');
  assert.strictEqual(outputs.connectionString, null);
});

console.log(`\nMulti-Provider Adapters Results: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
