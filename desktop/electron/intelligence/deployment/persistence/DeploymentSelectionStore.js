/**
 * NEXUS INTELLIGENCE LAYER — DEPLOYMENT SELECTION STORE
 * 
 * Durable file-backed persistent storage for user deployment architecture selections:
 * - Persists user selections across Electron application restarts.
 * - Stores state in app.getPath("userData")/nexus_deployment_selections.json.
 * - Strict workspace isolation: selections for workspace A never affect workspace B.
 * - Stores ONLY provider IDs and selection metadata (0 credentials, 0 secrets).
 * 
 * STRICT INVARIANTS:
 * - 0 LLM/AI tokens.
 * - 0 Network calls.
 * - 100% deterministic local JSON file storage.
 * - Fails safely if disk storage is unavailable.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const secretFilter = require("../../../../security/secretFilter");

let electronApp = null;
try {
  const electron = require("electron");
  electronApp = electron.app;
} catch (e) {}

const DEFAULT_STORE_FILENAME = "nexus_deployment_selections.json";

class DeploymentSelectionStore {
  constructor(options = {}) {
    this.app = options.app || electronApp;
    this.customStorePath = options.storePath || null;
    this._resolvedStorePath = null;
    this.cache = new Map();
    this._initialized = false;
  }

  /**
   * Dynamically retrieves the Electron App instance if available
   * @returns {Object|null}
   */
  getApp() {
    if (this.app) return this.app;
    try {
      const electron = require("electron");
      if (electron && electron.app) {
        this.app = electron.app;
        return this.app;
      }
    } catch (_) {}
    return null;
  }

  /**
   * Tests if a directory exists and is writable
   * @param {string} dir
   * @returns {boolean}
   */
  isDirWritable(dir) {
    if (!dir || typeof dir !== "string") return false;
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const testFile = path.join(dir, `.nexus-write-test-${process.pid}-${Date.now()}`);
      fs.writeFileSync(testFile, "ok", "utf8");
      fs.unlinkSync(testFile);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Normalizes and canonicalizes a workspace path across symlinks and platforms
   * @param {string} wsPath
   * @returns {string}
   */
  normalizeWorkspacePath(wsPath) {
    if (!wsPath || typeof wsPath !== "string") return "";
    try {
      const resolved = path.resolve(wsPath);
      if (fs.existsSync(resolved)) {
        try {
          return fs.realpathSync(resolved);
        } catch (_) {
          return resolved;
        }
      }
      return resolved;
    } catch (_) {
      return path.resolve(wsPath);
    }
  }

  /**
   * Resolves the persistent JSON store file path, verifying writability
   * @returns {string}
   */
  getStoreFilePath() {
    if (this.customStorePath) {
      return this.customStorePath;
    }
    if (this._resolvedStorePath) {
      return this._resolvedStorePath;
    }

    const candidateDirs = [];
    if (process.env.NEXUS_USERDATA_DIR) {
      candidateDirs.push(process.env.NEXUS_USERDATA_DIR);
    }
    if (process.env.ECHO_RECOVERY_DIR) {
      candidateDirs.push(process.env.ECHO_RECOVERY_DIR);
    }

    const appInstance = this.getApp();
    if (appInstance && typeof appInstance.getPath === "function") {
      try {
        const userData = appInstance.getPath("userData");
        if (userData) candidateDirs.push(userData);
      } catch (_) {}
    }

    try {
      const homeDir = os.homedir();
      candidateDirs.push(path.join(homeDir, "Library", "Application Support", "echo-nullity"));
      candidateDirs.push(path.join(homeDir, "Library", "Application Support", "NEXUS"));
    } catch (_) {}

    candidateDirs.push(path.join(process.cwd(), ".nexus-recovery"));

    for (const dir of candidateDirs) {
      if (this.isDirWritable(dir)) {
        this._resolvedStorePath = path.join(dir, DEFAULT_STORE_FILENAME);
        return this._resolvedStorePath;
      }
    }

    this._resolvedStorePath = path.join(process.cwd(), ".nexus-recovery", DEFAULT_STORE_FILENAME);
    return this._resolvedStorePath;
  }

  /**
   * Finds any existing persistent store file across candidate directories
   * @returns {string}
   */
  findStoreFile() {
    if (this.customStorePath) return this.customStorePath;
    const primary = this.getStoreFilePath();
    if (fs.existsSync(primary)) return primary;

    const candidateFiles = [];
    const appInstance = this.getApp();
    if (appInstance && typeof appInstance.getPath === "function") {
      try {
        const userData = appInstance.getPath("userData");
        if (userData) candidateFiles.push(path.join(userData, DEFAULT_STORE_FILENAME));
      } catch (_) {}
    }
    candidateFiles.push(path.join(process.cwd(), ".nexus-recovery", DEFAULT_STORE_FILENAME));

    for (const f of candidateFiles) {
      if (fs.existsSync(f)) return f;
    }
    return primary;
  }

  /**
   * Loads all persisted workspace selections from disk into cache
   * @returns {Map<string, Object>}
   */
  loadAll() {
    const filePath = this.findStoreFile();
    this.cache.clear();

    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf-8");
        if (raw && raw.trim()) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.workspaces === "object") {
            for (const [wsPath, record] of Object.entries(parsed.workspaces)) {
              if (record && typeof record === "object") {
                const rawPath = record.workspacePath || wsPath;
                const normPath = this.normalizeWorkspacePath(rawPath);
                const resolvedPath = path.resolve(rawPath);
                const entry = {
                  workspacePath: normPath,
                  selections: record.selections && typeof record.selections === "object" ? record.selections : {},
                  selectionSource: record.selectionSource && typeof record.selectionSource === "object" ? record.selectionSource : {},
                  savedAt: typeof record.savedAt === "number" ? record.savedAt : Date.now(),
                  workspaceEvidenceHash: record.workspaceEvidenceHash || null,
                };
                this.cache.set(normPath, entry);
                if (resolvedPath !== normPath) {
                  this.cache.set(resolvedPath, entry);
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn("[DEPLOYMENT-SELECTION-STORE] Warning reading persistent selections:", err.message);
    }

    this._initialized = true;
    return this.cache;
  }

  /**
   * Ensures the store is loaded
   */
  ensureLoaded() {
    if (!this._initialized) {
      this.loadAll();
    }
  }

  /**
   * Flushes current cache to disk
   * @returns {boolean}
   */
  flushToDisk() {
    const filePath = this.getStoreFilePath();
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const workspacesObj = {};
      for (const [wsPath, record] of this.cache.entries()) {
        const canonicalKey = record.workspacePath || wsPath;
        workspacesObj[canonicalKey] = {
          workspacePath: canonicalKey,
          selections: record.selections,
          selectionSource: record.selectionSource,
          savedAt: record.savedAt,
          workspaceEvidenceHash: record.workspaceEvidenceHash,
        };
      }

      const payload = {
        version: 1,
        updatedAt: Date.now(),
        workspaces: workspacesObj,
      };

      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
      return true;
    } catch (err) {
      console.warn("[DEPLOYMENT-SELECTION-STORE] Warning writing persistent selections:", err.message);
      return false;
    }
  }

  /**
   * Saves user selections for a workspace
   * @param {string} workspacePath
   * @param {Record<string, string>} selections
   * @param {Object} [options]
   * @returns {Object} Saved record
   */
  saveWorkspaceSelections(workspacePath, selections = {}, options = {}) {
    if (!workspacePath || typeof workspacePath !== "string") {
      return null;
    }

    this.ensureLoaded();
    const normPath = this.normalizeWorkspacePath(workspacePath);
    const resolvedPath = path.resolve(workspacePath);
    const existing = this.cache.get(normPath) || this.cache.get(resolvedPath) || {
      workspacePath: normPath,
      selections: {},
      selectionSource: {},
      savedAt: Date.now(),
      workspaceEvidenceHash: null,
    };

    const updatedSelections = { ...existing.selections };
    const updatedSources = { ...existing.selectionSource };

    for (const [key, val] of Object.entries(selections || {})) {
      if (val && typeof val === "string") {
        let sanitizedVal;
        if (key === 'executionSource') {
          sanitizedVal = val.trim().toUpperCase();
        } else if (['repository', 'repo', 'repositoryUrl', 'selectedRepo', 'branch', 'selectedBranch', 'rootDir', 'selectedRootDir', 'projectRoot'].includes(key)) {
          sanitizedVal = secretFilter.sanitizeString(String(val).trim());
        } else {
          sanitizedVal = secretFilter.sanitizeString(String(val).toLowerCase().trim());
        }
        updatedSelections[key] = sanitizedVal;
        updatedSources[key] = "USER";
      }
    }

    const record = {
      workspacePath: normPath,
      selections: updatedSelections,
      selectionSource: updatedSources,
      savedAt: Date.now(),
      workspaceEvidenceHash: options.evidenceHash || existing.workspaceEvidenceHash || null,
    };

    this.cache.set(normPath, record);
    if (resolvedPath !== normPath) {
      this.cache.set(resolvedPath, record);
    }
    this.flushToDisk();

    console.log("[DeploymentSelection] DeploymentSelectionStore.saveWorkspaceSelections", {
      workspace: workspacePath,
      normalizedWorkspace: normPath,
      storePath: this.getStoreFilePath(),
      savedSelections: updatedSelections,
      selectionSource: updatedSources,
    });

    return record;
  }

  /**
   * Retrieves active selections for a workspace
   * @param {string} workspacePath
   * @returns {Object|null}
   */
  getWorkspaceSelections(workspacePath) {
    if (!workspacePath || typeof workspacePath !== "string") {
      return null;
    }

    this.ensureLoaded();
    const normPath = this.normalizeWorkspacePath(workspacePath);
    const resolvedPath = path.resolve(workspacePath);
    const entry = this.cache.get(normPath) || this.cache.get(resolvedPath) || null;

    console.log("[DeploymentSelection] DeploymentSelectionStore.getWorkspaceSelections", {
      workspace: workspacePath,
      normalizedWorkspace: normPath,
      storePath: this.getStoreFilePath(),
      hasEntry: Boolean(entry),
      loadedSelections: entry?.selections || {},
      selectionSource: entry?.selectionSource || {},
    });

    return entry;
  }

  /**
   * Clears saved selections for a workspace
   * @param {string} workspacePath
   * @returns {boolean}
   */
  clearWorkspaceSelections(workspacePath) {
    if (!workspacePath || typeof workspacePath !== "string") {
      return false;
    }

    this.ensureLoaded();
    const normPath = this.normalizeWorkspacePath(workspacePath);
    const resolvedPath = path.resolve(workspacePath);
    const deleted1 = this.cache.delete(normPath);
    const deleted2 = this.cache.delete(resolvedPath);
    const deleted = deleted1 || deleted2;
    if (deleted) {
      this.flushToDisk();
    }

    console.log("[DeploymentSelection] DeploymentSelectionStore.clearWorkspaceSelections", {
      workspace: workspacePath,
      normalizedWorkspace: normPath,
      storePath: this.getStoreFilePath(),
      deleted,
    });

    return deleted;
  }
}

const deploymentSelectionStore = new DeploymentSelectionStore();

module.exports = {
  DeploymentSelectionStore,
  deploymentSelectionStore,
};
