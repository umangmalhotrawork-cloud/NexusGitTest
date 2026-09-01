/**
 * NEXUS INTELLIGENCE LAYER — VERCEL DEPLOY ADAPTER (Phase 3A)
 * 
 * Manages Vercel CLI invocation parameters, environment variables,
 * real-time output parsing, and deployment URL extraction.
 * 
 * STRICT INVARIANTS:
 * - NEVER passes token in CLI arguments. Uses process.env.VERCEL_TOKEN only.
 * - Enforces workspace path containment.
 * - Extracts and verifies HTTPS deployment URLs only.
 */

const fs = require('fs');
const path = require('path');

const { remoteRepositoryPreflight: defaultRemoteRepositoryPreflight } = require('../../preflight/RemoteRepositoryPreflight');

const VERCEL_URL_REGEX = /https:\/\/[a-zA-Z0-9_\-.]+\.vercel\.app/g;
const GENERIC_HTTPS_URL_REGEX = /https:\/\/[a-zA-Z0-9_\-.]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?/g;

class VercelDeployAdapter {
  constructor(options = {}) {
    this.providerId = 'vercel';
    this.displayName = 'Vercel';
    this.remoteRepositoryPreflight = options.remoteRepositoryPreflight || defaultRemoteRepositoryPreflight;
  }

  /**
   * Resolves execution command and arguments
   * @param {Object} context - { workspacePath, rootDir }
   * @returns {Object} { command: string, args: string[], cwd: string }
   */
  resolveExecutionPlan(context = {}) {
    const { workspacePath, rootDir } = context;
    if (!workspacePath || typeof workspacePath !== 'string') {
      throw new Error('Invalid workspace path for Vercel deployment.');
    }

    const resolvedWorkspace = path.resolve(workspacePath);
    let targetCwd = resolvedWorkspace;

    if (rootDir && typeof rootDir === 'string') {
      const resolvedTarget = path.resolve(resolvedWorkspace, rootDir);
      const rel = path.relative(resolvedWorkspace, resolvedTarget);
      if (rel.startsWith('..') || (path.isAbsolute(rel) && !resolvedTarget.startsWith(resolvedWorkspace))) {
        throw new Error(`Path traversal rejected: rootDir ${rootDir} escapes workspace.`);
      }
      targetCwd = resolvedTarget;
    }

    if (!fs.existsSync(targetCwd)) {
      throw new Error(`Target deployment directory does not exist: ${targetCwd}`);
    }

    // Verify vercel.json exists in target directory or workspace root
    const configInCwd = path.join(targetCwd, 'vercel.json');
    const configInRoot = path.join(resolvedWorkspace, 'vercel.json');
    if (!fs.existsSync(configInCwd) && !fs.existsSync(configInRoot)) {
      throw new Error('CONFIGURATION_MISSING: vercel.json not found. Please preview and write vercel.json before deploying.');
    }

    // Command uses npx vercel non-interactively
    const isWin = process.platform === 'win32';
    const command = isWin ? 'npx.cmd' : 'npx';
    const args = ['vercel', '--prod', '--yes'];

    return {
      command,
      args,
      cwd: targetCwd,
      workspaceRoot: resolvedWorkspace,
    };
  }

  /**
   * Prepares sanitized environment variables with decrypted token and dynamic inputs
   * @param {string|Object} decryptedToken - token string or { token: string }
   * @param {Object} [dynamicInputs] - e.g. { NEXT_PUBLIC_API_URL: '...' }
   * @returns {Object}
   */
  prepareEnvironment(decryptedToken, dynamicInputs = {}) {
    let token = null;
    if (typeof decryptedToken === 'string') {
      token = decryptedToken;
    } else if (decryptedToken && typeof decryptedToken === 'object') {
      token = decryptedToken.token;
    }

    if (!token || typeof token !== 'string' || !token.trim()) {
      throw new Error('Vercel token is missing or invalid.');
    }

    const cleanDynamicInputs = {};
    if (dynamicInputs && typeof dynamicInputs === 'object') {
      for (const [k, v] of Object.entries(dynamicInputs)) {
        if (typeof v === 'string') {
          cleanDynamicInputs[k] = v;
        }
      }
    }

    const existingPath = process.env.PATH || '';
    const augmentedPath = process.platform === 'win32'
      ? existingPath
      : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin', existingPath].filter(Boolean).join(':');

    const os = require('os');
    const vercelConfigDir = path.join(os.tmpdir(), 'nexus-vercel-config');
    try {
      if (!fs.existsSync(vercelConfigDir)) {
        fs.mkdirSync(vercelConfigDir, { recursive: true });
      }
    } catch (_) {}

    return {
      ...process.env,
      PATH: augmentedPath,
      VERCEL_TOKEN: token.trim(),
      VERCEL_GLOBAL_CONFIG_PATH: vercelConfigDir,
      XDG_DATA_HOME: vercelConfigDir,
      XDG_CONFIG_HOME: vercelConfigDir,
      VERCEL_DISABLE_UPDATE_CHECK: '1',
      ...cleanDynamicInputs,
      CI: '1',
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    };
  }

  /**
   * Parses log chunk to identify progress state
   * @param {string} text
   * @returns {string|null} Phase or null
   */
  parseProgressState(text = '') {
    const lower = text.toLowerCase();
    if (lower.includes('building') || lower.includes('running "') || lower.includes('build command')) {
      return 'BUILDING';
    }
    if (lower.includes('uploading') || lower.includes('deploying build artifacts')) {
      return 'UPLOADING';
    }
    if (lower.includes('deploying') || lower.includes('inspecting deployment') || lower.includes('queued')) {
      return 'DEPLOYING';
    }
    return null;
  }

  /**
   * Extracts verified HTTPS deployment URL from output
   * @param {string} outputText
   * @returns {string|null}
   */
  extractDeploymentUrl(outputText = '') {
    if (!outputText || typeof outputText !== 'string') return null;

    // Strip ANSI color escape codes and formatting sequences
    const sanitized = outputText.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').trim();

    // 1. Search for vercel.app domains
    const vercelMatches = sanitized.match(VERCEL_URL_REGEX);
    if (vercelMatches && vercelMatches.length > 0) {
      // Return last matching URL as production alias is usually printed last
      return vercelMatches[vercelMatches.length - 1];
    }

    // 2. Search for generic https URLs if vercel.app is custom-aliased
    const genericMatches = sanitized.match(GENERIC_HTTPS_URL_REGEX);
    if (genericMatches && genericMatches.length > 0) {
      const candidate = genericMatches[genericMatches.length - 1];
      if (candidate.startsWith('https://') && !candidate.includes('vercel.com/docs') && !candidate.includes('github.com')) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * Common adapter contract output extractor
   * @param {string} outputText
   * @param {Object} [responseData]
   * @returns {Object} { liveUrl: string|null }
   */
  extractOutputs(outputText = '', responseData = null) {
    const liveUrl = this.extractDeploymentUrl(outputText);
    return {
      liveUrl,
    };
  }
}

module.exports = VercelDeployAdapter;
