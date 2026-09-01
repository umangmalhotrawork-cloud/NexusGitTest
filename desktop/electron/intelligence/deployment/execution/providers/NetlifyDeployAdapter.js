/**
 * NEXUS INTELLIGENCE LAYER — NETLIFY DEPLOY ADAPTER (Phase 4B)
 * 
 * Manages Netlify static frontend CLI execution parameters, environment variables,
 * real-time output parsing, and deployment URL extraction.
 * 
 * STRICT INVARIANTS:
 * - NEVER passes authToken in CLI arguments. Injects NETLIFY_AUTH_TOKEN strictly into child process environment.
 * - Enforces workspace path containment and prevents directory traversal.
 * - Extracts and verifies HTTPS netlify.app / custom domain deployment URLs only.
 * - 0 LLM tokens, 100% deterministic local parameter mapping.
 */

const fs = require('fs');
const path = require('path');
const secretFilter = require('../../../../../security/secretFilter');

const NETLIFY_URL_REGEX = /https:\/\/[a-zA-Z0-9_\-.]+\.netlify\.app/g;
const GENERIC_HTTPS_URL_REGEX = /https:\/\/[a-zA-Z0-9_\-.]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?/g;

class NetlifyDeployAdapter {
  constructor() {
    this.providerId = 'netlify';
    this.displayName = 'Netlify';
  }

  /**
   * Resolves execution command and arguments for Netlify CLI
   * @param {Object} context - { workspacePath, rootDir, serviceId, outputDirectory, buildCommand }
   * @returns {Object} { command: string, args: string[], cwd: string, workspaceRoot: string, publishDir: string }
   */
  resolveExecutionPlan(context = {}) {
    const { workspacePath, rootDir, outputDirectory } = context;
    if (!workspacePath || typeof workspacePath !== 'string') {
      throw new Error('Invalid workspace path for Netlify deployment.');
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

    // Verify netlify.toml or package.json exists in target directory or workspace root
    const configInCwd = path.join(targetCwd, 'netlify.toml');
    const configInRoot = path.join(resolvedWorkspace, 'netlify.toml');
    const pkgInCwd = path.join(targetCwd, 'package.json');

    const hasConfig = fs.existsSync(configInCwd) || fs.existsSync(configInRoot) || fs.existsSync(pkgInCwd);
    if (!hasConfig) {
      throw new Error('CONFIGURATION_MISSING: netlify.toml or frontend manifest not found. Please preview and write netlify.toml.');
    }

    // Resolve output/publish directory (defaults to dist / out / build / .)
    const publishRel = outputDirectory || (fs.existsSync(path.join(targetCwd, 'dist')) ? 'dist' : fs.existsSync(path.join(targetCwd, 'out')) ? 'out' : fs.existsSync(path.join(targetCwd, 'build')) ? 'build' : '.');
    const resolvedPublishDir = path.resolve(targetCwd, publishRel);
    
    // Command uses npx --yes netlify-cli non-interactively
    const isWin = process.platform === 'win32';
    const command = isWin ? 'npx.cmd' : 'npx';
    const args = ['--yes', 'netlify', 'deploy', '--prod', `--dir=${publishRel}`];

    return {
      type: 'CLI',
      providerId: 'netlify',
      command,
      args,
      cwd: targetCwd,
      workspaceRoot: resolvedWorkspace,
      publishDir: publishRel,
    };
  }

  /**
   * Prepares sanitized environment variables with decrypted Netlify token
   * @param {Object|string} decryptedCredential - { authToken: string } or raw string
   * @param {Object} [dynamicInputs] - e.g. { VITE_API_URL: 'https://...' }
   * @returns {Object}
   */
  prepareEnvironment(decryptedCredential, dynamicInputs = {}) {
    let token = null;
    if (typeof decryptedCredential === 'string') {
      token = decryptedCredential;
    } else if (decryptedCredential && typeof decryptedCredential === 'object') {
      token = decryptedCredential.authToken || decryptedCredential.token;
    }

    if (!token || typeof token !== 'string' || !token.trim()) {
      throw new Error('Netlify auth token is missing or invalid.');
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

    return {
      ...process.env,
      PATH: augmentedPath,
      NETLIFY_AUTH_TOKEN: token.trim(),
      ...cleanDynamicInputs,
      CI: '1',
      FORCE_COLOR: '0',
    };
  }

  /**
   * Parses log chunk to identify progress state
   * @param {string} text
   * @returns {string|null} Phase or null
   */
  parseProgressState(text = '') {
    if (!text || typeof text !== 'string') return null;
    const lower = text.toLowerCase();

    if (lower.includes('building') || lower.includes('running build') || lower.includes('creating an optimized production build')) {
      return 'BUILDING';
    }
    if (lower.includes('uploading') || lower.includes('deploying to live url') || lower.includes('uploading files')) {
      return 'UPLOADING';
    }
    if (lower.includes('deploying') || lower.includes('site deploy was successful') || lower.includes('website url:')) {
      return 'DEPLOYING';
    }
    return null;
  }

  /**
   * Extracts verified HTTPS deployment URL from Netlify CLI output
   * @param {string} outputText
   * @returns {Object} { liveUrl: string|null }
   */
  extractOutputs(outputText = '') {
    if (!outputText || typeof outputText !== 'string') {
      return { liveUrl: null };
    }

    // 1. Check for Website URL: / Live URL: / Unique Deploy URL:
    const liveUrlMatch = outputText.match(/(?:Website URL|Live URL|Deploy URL):\s*(https:\/\/[a-zA-Z0-9_\-.]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/i);
    if (liveUrlMatch && liveUrlMatch[1]) {
      const candidate = liveUrlMatch[1].trim();
      if (!candidate.includes('netlify.com/docs') && !candidate.includes('app.netlify.com')) {
        return { liveUrl: candidate };
      }
    }

    // 2. Search for netlify.app domains
    const netlifyMatches = outputText.match(NETLIFY_URL_REGEX);
    if (netlifyMatches && netlifyMatches.length > 0) {
      return { liveUrl: netlifyMatches[netlifyMatches.length - 1] };
    }

    // 3. Search for generic https URLs
    const genericMatches = outputText.match(GENERIC_HTTPS_URL_REGEX);
    if (genericMatches && genericMatches.length > 0) {
      for (let i = genericMatches.length - 1; i >= 0; i--) {
        const candidate = genericMatches[i];
        if (candidate.startsWith('https://') && !candidate.includes('netlify.com/docs') && !candidate.includes('app.netlify.com') && !candidate.includes('github.com')) {
          return { liveUrl: candidate };
        }
      }
    }

    return { liveUrl: null };
  }
}

module.exports = NetlifyDeployAdapter;
