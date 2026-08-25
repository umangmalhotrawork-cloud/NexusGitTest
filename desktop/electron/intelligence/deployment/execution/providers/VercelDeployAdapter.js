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

const VERCEL_URL_REGEX = /https:\/\/[a-zA-Z0-9_\-.]+\.vercel\.app/g;
const GENERIC_HTTPS_URL_REGEX = /https:\/\/[a-zA-Z0-9_\-.]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?/g;

class VercelDeployAdapter {
  constructor() {
    this.providerId = 'vercel';
    this.displayName = 'Vercel';
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
   * Prepares sanitized environment variables with decrypted token
   * @param {string} decryptedToken
   * @returns {Object}
   */
  prepareEnvironment(decryptedToken) {
    if (!decryptedToken || typeof decryptedToken !== 'string') {
      throw new Error('Vercel token is missing or invalid.');
    }

    return {
      ...process.env,
      VERCEL_TOKEN: decryptedToken,
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

    // 1. Search for vercel.app domains
    const vercelMatches = outputText.match(VERCEL_URL_REGEX);
    if (vercelMatches && vercelMatches.length > 0) {
      // Return last matching URL as production alias is usually printed last
      return vercelMatches[vercelMatches.length - 1];
    }

    // 2. Search for generic https URLs if vercel.app is custom-aliased
    const genericMatches = outputText.match(GENERIC_HTTPS_URL_REGEX);
    if (genericMatches && genericMatches.length > 0) {
      const candidate = genericMatches[genericMatches.length - 1];
      if (candidate.startsWith('https://') && !candidate.includes('vercel.com/docs') && !candidate.includes('github.com')) {
        return candidate;
      }
    }

    return null;
  }
}

module.exports = VercelDeployAdapter;
