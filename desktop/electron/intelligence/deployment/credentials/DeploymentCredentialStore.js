/**
 * NEXUS INTELLIGENCE LAYER — DEPLOYMENT CREDENTIAL STORE (Phase 3A & 4B)
 * 
 * Secure credential storage for deployment providers (Vercel, Render, Netlify, Railway, Fly.io):
 * - Uses Electron safeStorage (macOS Keychain, Linux Secret Service, Windows DPAPI).
 * - Fails closed if secure storage is unavailable. Never stores plaintext tokens.
 * - Stored in app.getPath('userData')/nexus_deployment_vault.json.
 * - Never returns raw or decrypted tokens across IPC boundaries.
 * 
 * STRICT INVARIANTS:
 * - 0 LLM tokens, 100% deterministic local encryption/decryption.
 * - Fails closed on unavailable encryption or invalid schemas.
 * - Renderer IPC methods return only boolean connection metadata.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const secretFilter = require('../../../../security/secretFilter');

let electronApp = null;
let electronSafeStorage = null;

try {
  const electron = require('electron');
  electronApp = electron.app;
  electronSafeStorage = electron.safeStorage;
} catch (e) {}

const ALLOWED_PROVIDERS = new Set([
  'vercel',
  'render',
  'netlify',
  'railway',
  'flyio',
]);

class DeploymentCredentialStore {
  constructor(options = {}) {
    this.app = options.app || electronApp;
    this.safeStorage = options.safeStorage || electronSafeStorage;
    this.customVaultPath = options.vaultPath || null;
    this._resolvedVaultPath = null;
  }

  /**
   * Checks if OS-level encryption is available
   * @returns {boolean}
   */
  isEncryptionAvailable() {
    try {
      return Boolean(
        this.safeStorage &&
        typeof this.safeStorage.isEncryptionAvailable === 'function' &&
        this.safeStorage.isEncryptionAvailable()
      );
    } catch (e) {
      return false;
    }
  }

  /**
   * Tests if a directory exists and is writable
   * @param {string} dir
   * @returns {boolean}
   */
  isDirWritable(dir) {
    if (!dir || typeof dir !== 'string') return false;
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const testFile = path.join(dir, `.nexus-write-test-${process.pid}-${Date.now()}`);
      fs.writeFileSync(testFile, 'ok', 'utf8');
      fs.unlinkSync(testFile);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Resolves persistent vault JSON file path
   * @returns {string}
   */
  getVaultFilePath() {
    if (this.customVaultPath) {
      return this.customVaultPath;
    }
    if (this._resolvedVaultPath) {
      return this._resolvedVaultPath;
    }

    const candidateDirs = [];
    if (process.env.NEXUS_USERDATA_DIR) {
      candidateDirs.push(process.env.NEXUS_USERDATA_DIR);
    }
    if (process.env.ECHO_RECOVERY_DIR) {
      candidateDirs.push(process.env.ECHO_RECOVERY_DIR);
    }

    if (this.app && typeof this.app.getPath === 'function') {
      try {
        const userData = this.app.getPath('userData');
        if (userData) candidateDirs.push(userData);
      } catch (e) {}
    }

    try {
      const homeDir = os.homedir();
      candidateDirs.push(path.join(homeDir, 'Library', 'Application Support', 'echo-nullity'));
      candidateDirs.push(path.join(homeDir, 'Library', 'Application Support', 'NEXUS'));
    } catch (_) {}

    candidateDirs.push(path.join(process.cwd(), '.nexus-recovery'));

    for (const dir of candidateDirs) {
      if (this.isDirWritable(dir)) {
        this._resolvedVaultPath = path.join(dir, 'nexus_deployment_vault.json');
        return this._resolvedVaultPath;
      }
    }

    this._resolvedVaultPath = path.join(process.cwd(), '.nexus-recovery', 'nexus_deployment_vault.json');
    return this._resolvedVaultPath;
  }

  /**
   * Reads raw vault file from disk
   * @returns {Object}
   */
  readVault() {
    const vaultPath = this.getVaultFilePath();
    try {
      if (!fs.existsSync(vaultPath)) return {};
      const raw = fs.readFileSync(vaultPath, 'utf8');
      if (!raw || !raw.trim()) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  /**
   * Writes encrypted vault file to disk
   * @param {Object} vault
   */
  writeVault(vault) {
    const vaultPath = this.getVaultFilePath();
    try {
      const dir = path.dirname(vaultPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(vaultPath, JSON.stringify(vault, null, 2), 'utf8');
    } catch (err) {
      throw new Error(`Failed to persist deployment credentials vault: ${err.message}`);
    }
  }

  /**
   * Validates and extracts provider-specific token string
   * @param {string} providerId
   * @param {Object} credential
   * @returns {string}
   */
  validateCredentialPayload(providerId, credential) {
    if (!ALLOWED_PROVIDERS.has(providerId)) {
      throw new Error(`Unsupported deployment provider: ${providerId}`);
    }

    if (!credential || typeof credential !== 'object') {
      throw new Error('Invalid credential: a non-empty credential object is required.');
    }

    let rawToken = null;

    if (providerId === 'vercel') {
      rawToken = credential.token;
      if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
        throw new Error('Invalid credential: a non-empty token string is required.');
      }
    } else if (providerId === 'render') {
      rawToken = credential.apiKey || credential.token;
      if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
        throw new Error('Invalid credential: Render requires a non-empty apiKey string.');
      }
    } else if (providerId === 'netlify') {
      rawToken = credential.authToken || credential.token;
      if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
        throw new Error('Invalid credential: Netlify requires a non-empty authToken string.');
      }
    } else if (providerId === 'railway' || providerId === 'flyio') {
      rawToken = credential.token || credential.apiKey;
      if (!rawToken || typeof rawToken !== 'string' || !rawToken.trim()) {
        throw new Error(`Invalid credential: ${providerId} requires a non-empty token string.`);
      }
    }

    return rawToken.trim();
  }

  /**
   * Saves provider credential securely
   * @param {string} providerId - Supported provider ('vercel', 'render', 'netlify', 'railway', 'flyio')
   * @param {Object} credential - { token | apiKey | authToken: string }
   * @returns {Object} { success: boolean, providerId: string, isConnected: boolean }
   */
  saveCredential(providerId, credential) {
    const token = this.validateCredentialPayload(providerId, credential);

    if (!this.isEncryptionAvailable()) {
      throw new Error('SECURE_STORAGE_UNAVAILABLE: Secure credential storage (Electron safeStorage) is unavailable on this system.');
    }

    const encryptedHex = this.safeStorage.encryptString(token).toString('hex');

    const vault = this.readVault();
    vault[providerId] = {
      enc: encryptedHex,
      updatedAt: Date.now(),
    };

    this.writeVault(vault);

    return {
      success: true,
      providerId,
      isConnected: true,
    };
  }

  /**
   * Retrieves decrypted credential strictly for internal main-process execution
   * NEVER expose this method across IPC to the renderer!
   * @param {string} providerId
   * @returns {Object|null}
   */
  getCredential(providerId) {
    if (!ALLOWED_PROVIDERS.has(providerId)) {
      return null;
    }

    if (!this.isEncryptionAvailable()) {
      return null;
    }

    const vault = this.readVault();
    const entry = vault[providerId];
    if (!entry || !entry.enc) {
      return null;
    }

    try {
      const decryptedToken = this.safeStorage.decryptString(Buffer.from(entry.enc, 'hex'));
      if (!decryptedToken || typeof decryptedToken !== 'string') {
        return null;
      }

      if (providerId === 'render') {
        return { apiKey: decryptedToken, token: decryptedToken };
      }
      if (providerId === 'netlify') {
        return { authToken: decryptedToken, token: decryptedToken };
      }
      return { token: decryptedToken };
    } catch (err) {
      return null;
    }
  }

  /**
   * Removes provider credential
   * @param {string} providerId
   * @returns {Object} { success: boolean, providerId: string, isConnected: false }
   */
  removeCredential(providerId) {
    if (!ALLOWED_PROVIDERS.has(providerId)) {
      throw new Error(`Unsupported deployment provider: ${providerId}`);
    }

    const vault = this.readVault();
    if (vault[providerId]) {
      delete vault[providerId];
      this.writeVault(vault);
    }

    return {
      success: true,
      providerId,
      isConnected: false,
    };
  }

  /**
   * Safe status check for renderer IPC
   * @param {string} providerId
   * @returns {Object} { providerId: string, isConnected: boolean }
   */
  getAuthStatus(providerId) {
    if (!ALLOWED_PROVIDERS.has(providerId)) {
      return { providerId, isConnected: false };
    }

    if (!this.isEncryptionAvailable()) {
      return { providerId, isConnected: false, error: 'SECURE_STORAGE_UNAVAILABLE' };
    }

    const vault = this.readVault();
    const isConnected = Boolean(vault[providerId] && vault[providerId].enc);

    return {
      providerId,
      isConnected,
    };
  }
}

const deploymentCredentialStore = new DeploymentCredentialStore();

module.exports = {
  ALLOWED_PROVIDERS,
  DeploymentCredentialStore,
  deploymentCredentialStore,
};
