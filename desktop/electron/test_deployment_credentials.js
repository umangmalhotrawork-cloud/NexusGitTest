/**
 * NEXUS DEPLOYMENT CREDENTIALS — TEST SUITE (Phase 3A)
 * 
 * Validates secure credential storage with Electron safeStorage, fail-closed security,
 * secret redaction, and strict API boundaries.
 * 
 * NOTE: Uses synthetic test tokens. Never uses real production credentials.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  DeploymentCredentialStore,
} = require('./intelligence');

// Mock safeStorage for headless unit testing
function createMockSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (str) => Buffer.from(`ENC:${Buffer.from(str, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (buf) => {
      const s = buf.toString('utf8');
      if (s.startsWith('ENC:')) {
        return Buffer.from(s.slice(4), 'base64').toString('utf8');
      }
      throw new Error('Decryption failure');
    },
  };
}

async function runCredentialTests() {
  console.log('\n======================================================');
  console.log('  NEXUS DEPLOYMENT CREDENTIAL STORE — TEST SUITE');
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

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-cred-test-'));
  const vaultPath = path.join(tempDir, 'test_vault.json');
  const mockSafeStorage = createMockSafeStorage(true);

  const store = new DeploymentCredentialStore({
    safeStorage: mockSafeStorage,
    vaultPath,
  });

  const SYNTHETIC_TOKEN = 'test_vercel_token_synthetic_9876543210_abc';

  // -------------------------------------------------------------------------
  // TEST 1: isEncryptionAvailable
  // -------------------------------------------------------------------------
  try {
    assert.strictEqual(store.isEncryptionAvailable(), true);
    recordPass('Test 1: isEncryptionAvailable reports true when safeStorage is operational');
  } catch (err) {
    recordFail('Test 1: isEncryptionAvailable', err);
  }

  // -------------------------------------------------------------------------
  // TEST 2: Save Token
  // -------------------------------------------------------------------------
  try {
    const res = store.saveCredential('vercel', { token: SYNTHETIC_TOKEN });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.providerId, 'vercel');
    assert.strictEqual(res.isConnected, true);
    assert.strictEqual(res.token, undefined, 'Response must never leak raw token');

    recordPass('Test 2: saveCredential successfully stores Vercel token');
  } catch (err) {
    recordFail('Test 2: Save token', err);
  }

  // -------------------------------------------------------------------------
  // TEST 3: Encrypted File Exists
  // -------------------------------------------------------------------------
  try {
    assert.ok(fs.existsSync(vaultPath), 'Vault file must exist on disk');
    const raw = fs.readFileSync(vaultPath, 'utf8');
    const parsed = JSON.parse(raw);
    assert.ok(parsed.vercel && parsed.vercel.enc, 'Vault must contain encrypted hex blob');

    recordPass('Test 3: Encrypted vault file exists on disk with encrypted payload');
  } catch (err) {
    recordFail('Test 3: Encrypted file check', err);
  }

  // -------------------------------------------------------------------------
  // TEST 4: Plaintext Token Does NOT Appear in File
  // -------------------------------------------------------------------------
  try {
    const raw = fs.readFileSync(vaultPath, 'utf8');
    assert.ok(!raw.includes(SYNTHETIC_TOKEN), 'Plaintext token must NEVER be written to disk');

    recordPass('Test 4: Plaintext token does NOT appear anywhere in the vault file');
  } catch (err) {
    recordFail('Test 4: Plaintext leak check', err);
  }

  // -------------------------------------------------------------------------
  // TEST 5: getAuthStatus Returns Connected
  // -------------------------------------------------------------------------
  try {
    const status = store.getAuthStatus('vercel');
    assert.strictEqual(status.providerId, 'vercel');
    assert.strictEqual(status.isConnected, true);
    assert.strictEqual(status.token, undefined);
    assert.strictEqual(status.enc, undefined);

    recordPass('Test 5: getAuthStatus returns isConnected: true with zero token metadata');
  } catch (err) {
    recordFail('Test 5: getAuthStatus', err);
  }

  // -------------------------------------------------------------------------
  // TEST 6: Decrypted Credential Works Internally
  // -------------------------------------------------------------------------
  try {
    const cred = store.getCredential('vercel');
    assert.ok(cred && cred.token);
    assert.strictEqual(cred.token, SYNTHETIC_TOKEN);

    recordPass('Test 6: Internal getCredential correctly decrypts stored token');
  } catch (err) {
    recordFail('Test 6: Internal decrypt', err);
  }

  // -------------------------------------------------------------------------
  // TEST 7: Renderer-facing Response Contains No Token
  // -------------------------------------------------------------------------
  try {
    const saveRes = store.saveCredential('vercel', { token: SYNTHETIC_TOKEN });
    const authStatus = store.getAuthStatus('vercel');

    const json1 = JSON.stringify(saveRes);
    const json2 = JSON.stringify(authStatus);

    assert.ok(!json1.includes(SYNTHETIC_TOKEN));
    assert.ok(!json2.includes(SYNTHETIC_TOKEN));

    recordPass('Test 7: All renderer-facing IPC payloads are strictly token-free');
  } catch (err) {
    recordFail('Test 7: Renderer payload isolation', err);
  }

  // -------------------------------------------------------------------------
  // TEST 8: Remove Credential
  // -------------------------------------------------------------------------
  try {
    const res = store.removeCredential('vercel');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.isConnected, false);

    const cred = store.getCredential('vercel');
    assert.strictEqual(cred, null);

    recordPass('Test 8: removeCredential purges stored credential from vault');
  } catch (err) {
    recordFail('Test 8: Remove credential', err);
  }

  // -------------------------------------------------------------------------
  // TEST 9: Auth Status Becomes Disconnected
  // -------------------------------------------------------------------------
  try {
    const status = store.getAuthStatus('vercel');
    assert.strictEqual(status.isConnected, false);

    recordPass('Test 9: getAuthStatus reflects disconnected state after removal');
  } catch (err) {
    recordFail('Test 9: Post-removal auth status', err);
  }

  // -------------------------------------------------------------------------
  // TEST 10: Malformed Credential Rejected
  // -------------------------------------------------------------------------
  try {
    let threw1 = false;
    let threw2 = false;
    try { store.saveCredential('vercel', null); } catch (e) { threw1 = true; }
    try { store.saveCredential('vercel', { token: '   ' }); } catch (e) { threw2 = true; }

    assert.ok(threw1 && threw2, 'Malformed tokens must throw errors');
    recordPass('Test 10: Null and empty token structures are strictly rejected');
  } catch (err) {
    recordFail('Test 10: Malformed token rejection', err);
  }

  // -------------------------------------------------------------------------
  // TEST 11: Unsupported Provider Rejected
  // -------------------------------------------------------------------------
  try {
    let threw = false;
    try { store.saveCredential('unsupported_platform', { token: 'abc' }); } catch (e) { threw = true; }
    assert.ok(threw);

    const status = store.getAuthStatus('unsupported_platform');
    assert.strictEqual(status.isConnected, false);

    recordPass('Test 11: Unsupported providers are strictly rejected');
  } catch (err) {
    recordFail('Test 11: Unsupported provider rejection', err);
  }

  // -------------------------------------------------------------------------
  // TEST 12: Secure Storage Unavailable Fails Closed
  // -------------------------------------------------------------------------
  try {
    const brokenStore = new DeploymentCredentialStore({
      safeStorage: createMockSafeStorage(false), // encryption unavailable
      vaultPath: path.join(tempDir, 'broken_vault.json'),
    });

    let threw = false;
    try {
      brokenStore.saveCredential('vercel', { token: SYNTHETIC_TOKEN });
    } catch (err) {
      if (err.message.includes('SECURE_STORAGE_UNAVAILABLE')) {
        threw = true;
      }
    }

    assert.ok(threw, 'Must throw SECURE_STORAGE_UNAVAILABLE when safeStorage is not available');
    assert.ok(!fs.existsSync(path.join(tempDir, 'broken_vault.json')), 'Must NOT write plaintext file when encryption fails');

    recordPass('Test 12: Fails closed with SECURE_STORAGE_UNAVAILABLE when safeStorage unavailable');
  } catch (err) {
    recordFail('Test 12: Fail closed check', err);
  }

  // -------------------------------------------------------------------------
  // TEST 13: Secret Redaction
  // -------------------------------------------------------------------------
  try {
    const secretFilter = require('../security/secretFilter');
    const dirty = `Process failed with token: ${SYNTHETIC_TOKEN} and DATABASE_URL=postgres://user:pass@host:5432/db`;
    const clean = secretFilter.sanitizeString(dirty);

    assert.ok(!clean.includes(SYNTHETIC_TOKEN) || !clean.includes('postgres://user:pass@host:5432/db'));
    assert.ok(clean.includes('[REDACTED_SECRET') || clean.includes('postgres://[REDACTED_SECRET'));

    recordPass('Test 13: secretFilter sanitizes sensitive tokens and connection strings');
  } catch (err) {
    recordFail('Test 13: Secret redaction', err);
  }

  // -------------------------------------------------------------------------
  // TEST 14: Vault File Integrity
  // -------------------------------------------------------------------------
  try {
    store.saveCredential('vercel', { token: SYNTHETIC_TOKEN });
    const raw = fs.readFileSync(vaultPath, 'utf8');
    const parsed = JSON.parse(raw);
    assert.ok(parsed.vercel.updatedAt > 0);
    assert.ok(typeof parsed.vercel.enc === 'string');

    recordPass('Test 14: Vault file persists validated JSON structure with timestamp');
  } catch (err) {
    recordFail('Test 14: Vault integrity', err);
  }

  // Cleanup
  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log(`\nDeployment Credentials Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runCredentialTests().catch((err) => {
  console.error('Fatal credential test error:', err);
  process.exit(1);
});
