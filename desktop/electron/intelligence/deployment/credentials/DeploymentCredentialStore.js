/**
 * NEXUS INTELLIGENCE LAYER — DEPLOYMENT CREDENTIAL STORE (Phase 3A)
 * 
 * Secure credential storage for deployment providers (Vercel):
 * - Uses Electron safeStorage (macOS Keychain, Linux Secret Service, Windows DPAPI).
 * - Fails closed if secure storage is unavailable. Never stores plaintext tokens.
 * - Stored in app.getPath('userData')/nexus_deployment_vault.json.
 * - Never returns raw or decrypted tokens across IPC boundaries.
 */

const fs = require('fs');
const path = require('path');
const secretFilter = require('../../../../security/secretFilter');

let electronApp = null;
let electronSafeStorage = null;

try {
  const electron = require('electron');
  electronApp = electron.app;
  electronSafeStorage = electron.safeStorage;
} catch (e) {}

class DeploymentCredentialStore {
  constructor(options = {}) {
    this.app = options.app || electronApp;
    this.safeStorage = options.safeStorage || electronSafeStorage;
    this.customVaultPath = options.vaultPath || null;
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
   * Resolves persistent vault JSON file path
   * @returns {string}
   */
  getVaultFilePath() {
    if (this.customVaultPath) {
      return this.customVaultPath;
    }
    if (this.app && typeof this.app.getPath === 'function') {
      try {
        const userData = this.app.getPath('userData');
        if (userData) {
          return path.join(userData, 'nexus_deployment_vault.json');
        }
      } catch (e) {}
    }
    return path.join(process.cwd(), '.nexus-recovery', 'nexus_deployment_vault.json');
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
   * Saves provider credential securely
   * @param {string} providerId - Supported provider ('vercel')
   * @param {Object} credential - { token: string }
   * @returns {Object} { success: boolean, providerId: string, isConnected: boolean }
   */
  saveCredential(providerId, credential) {
    if (providerId !== 'vercel') {
      throw new Error(`Unsupported deployment provider: ${providerId}`);
    }

    if (!credential || typeof credential !== 'object' || typeof credential.token !== 'string' || !credential.token.trim()) {
      throw new Error('Invalid credential: a non-empty token string is required.');
    }

    if (!this.isEncryptionAvailable()) {
      throw new Error('SECURE_STORAGE_UNAVAILABLE: Secure credential storage (Electron safeStorage) is unavailable on this system.');
    }

    const token = credential.token.trim();
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
   * @returns {Object|null} { token: string } or null
   */
  getCredential(providerId) {
    if (providerId !== 'vercel') {
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
    if (providerId !== 'vercel') {
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
    if (providerId !== 'vercel') {
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
  DeploymentCredentialStore,
  deploymentCredentialStore,
};
