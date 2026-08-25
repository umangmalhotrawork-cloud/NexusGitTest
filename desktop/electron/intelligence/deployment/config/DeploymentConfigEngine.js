/**
 * NEXUS INTELLIGENCE LAYER — DEPLOYMENT CONFIG ENGINE (Phase 2C)
 * 
 * Orchestrates deterministic deployment configuration preview, diffing,
 * validation, and safe atomic writes to the workspace.
 * 
 * STRICT INVARIANTS:
 * - 100% deterministic, 0 LLM/API tokens.
 * - Strict workspace path containment.
 * - Stale preview detection via content hash comparison.
 * - Safe atomic write with backup on existing files.
 * - Secret sanitization via secretFilter.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const secretFilter = require('../../../../security/secretFilter');
const { deploymentInspector: defaultDeploymentInspector } = require('../DeploymentInspector');

const VercelConfigGenerator = require('./VercelConfigGenerator');
const RenderConfigGenerator = require('./RenderConfigGenerator');
const RailwayConfigGenerator = require('./RailwayConfigGenerator');
const FlyIoConfigGenerator = require('./FlyIoConfigGenerator');
const NetlifyConfigGenerator = require('./NetlifyConfigGenerator');
const DockerConfigGenerator = require('./DockerConfigGenerator');

class DeploymentConfigEngine {
  constructor(options = {}) {
    this.deploymentInspector = options.deploymentInspector || defaultDeploymentInspector;
    this.generators = new Map();
    this.registerDefaultGenerators();
  }

  /**
   * Registers default config generators
   */
  registerDefaultGenerators() {
    this.registerGenerator(new VercelConfigGenerator());
    this.registerGenerator(new RenderConfigGenerator());
    this.registerGenerator(new RailwayConfigGenerator());
    this.registerGenerator(new FlyIoConfigGenerator());
    this.registerGenerator(new NetlifyConfigGenerator());
    this.registerGenerator(new DockerConfigGenerator());
  }

  /**
   * Registers a generator
   * @param {Object} generator
   */
  registerGenerator(generator) {
    if (generator && typeof generator.providerId === 'string' && typeof generator.generate === 'function') {
      this.generators.set(generator.providerId, generator);
    }
  }

  /**
   * Computes SHA-256 hash of a string
   * @param {string} str
   * @returns {string}
   */
  computeHash(str = '') {
    return crypto.createHash('sha256').update(str || '', 'utf8').digest('hex');
  }

  /**
   * Computes structured line diff between old and new text
   * @param {string} oldText
   * @param {string} newText
   * @returns {Object}
   */
  computeStructuredDiff(oldText = '', newText = '') {
    if (!oldText && !newText) {
      return { added: 0, removed: 0, unchanged: 0, lines: [] };
    }

    const oldLines = oldText ? oldText.split('\n') : [];
    const newLines = newText ? newText.split('\n') : [];

    if (!oldText) {
      return {
        added: newLines.length,
        removed: 0,
        unchanged: 0,
        lines: newLines.map((l, idx) => ({ type: 'added', line: idx + 1, content: l })),
      };
    }

    const diffLines = [];
    let added = 0;
    let removed = 0;
    let unchanged = 0;

    // Simple line-by-line diff
    const maxLen = Math.max(oldLines.length, newLines.length);
    let oIdx = 0;
    let nIdx = 0;

    while (oIdx < oldLines.length || nIdx < newLines.length) {
      const oLine = oldLines[oIdx];
      const nLine = newLines[nIdx];

      if (oIdx < oldLines.length && nIdx < newLines.length && oLine === nLine) {
        diffLines.push({ type: 'unchanged', line: nIdx + 1, content: nLine });
        unchanged++;
        oIdx++;
        nIdx++;
      } else if (nIdx < newLines.length && (oIdx >= oldLines.length || !oldLines.slice(oIdx).includes(nLine))) {
        diffLines.push({ type: 'added', line: nIdx + 1, content: nLine });
        added++;
        nIdx++;
      } else if (oIdx < oldLines.length) {
        diffLines.push({ type: 'removed', line: oIdx + 1, content: oLine });
        removed++;
        oIdx++;
      } else {
        break;
      }
    }

    return { added, removed, unchanged, lines: diffLines };
  }

  /**
   * Validates generated content format
   * @param {string} format
   * @param {string} content
   * @returns {Object}
   */
  validateFormat(format, content) {
    const errors = [];
    const warnings = [];

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      errors.push('Generated configuration content is empty.');
      return { valid: false, errors, warnings };
    }

    if (format === 'json') {
      try {
        JSON.parse(content);
      } catch (err) {
        errors.push(`JSON syntax error: ${err.message}`);
      }
    } else if (format === 'yaml') {
      // Basic YAML structure checks
      if (content.includes('\t')) {
        errors.push('YAML syntax error: Tabs are not allowed for indentation in YAML.');
      }
      if (!content.includes(':')) {
        warnings.push('YAML content does not appear to contain key-value pairs.');
      }
    } else if (format === 'toml') {
      if (!content.includes('[') && !content.includes('=')) {
        warnings.push('TOML content does not appear to contain tables or key-value assignments.');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validates workspace path boundary
   * @param {string} workspacePath
   * @param {string} targetFile
   * @returns {Object} { valid: boolean, fullPath: string, error?: string }
   */
  resolveAndValidatePath(workspacePath, targetFile) {
    if (!workspacePath || typeof workspacePath !== 'string') {
      return { valid: false, fullPath: '', error: 'Workspace path must be a non-empty string.' };
    }
    if (!targetFile || typeof targetFile !== 'string') {
      return { valid: false, fullPath: '', error: 'Target file must be a non-empty string.' };
    }

    const resolvedWorkspace = path.resolve(workspacePath);
    const resolvedTarget = path.resolve(resolvedWorkspace, targetFile);

    const rel = path.relative(resolvedWorkspace, resolvedTarget);
    if (rel.startsWith('..') || (path.isAbsolute(rel) && !resolvedTarget.startsWith(resolvedWorkspace))) {
      return { valid: false, fullPath: '', error: `Path traversal attempt rejected: ${targetFile} escapes workspace ${workspacePath}` };
    }

    return { valid: true, fullPath: resolvedTarget, workspaceRoot: resolvedWorkspace };
  }

  /**
   * Generates deployment configuration preview
   * @param {string} workspacePath
   * @param {string} providerId
   * @param {Object} [options]
   * @returns {Promise<Object>} ConfigGenerationResult
   */
  async generateConfig(workspacePath, providerId, options = {}) {
    const generator = this.generators.get(providerId);
    if (!generator) {
      throw new Error(`No deployment configuration generator registered for provider: ${providerId}`);
    }

    const pathCheck = this.resolveAndValidatePath(workspacePath, generator.targetFile);
    if (!pathCheck.valid) {
      throw new Error(pathCheck.error);
    }

    // Inspect workspace to get real report and recommendation
    const report = await this.deploymentInspector.inspectWorkspace(workspacePath);
    const recommendation = (report.platformRecommendations || []).find((r) => r.providerId === providerId) || {};

    // Generate content
    const rawResult = generator.generate(report, recommendation, options);

    // Read existing file if present
    let exists = false;
    let existingContent = null;
    let existingContentHash = null;

    if (fs.existsSync(pathCheck.fullPath)) {
      try {
        existingContent = fs.readFileSync(pathCheck.fullPath, 'utf8');
        exists = true;
        existingContentHash = this.computeHash(existingContent);
      } catch (err) {
        rawResult.warnings.push(`Could not read existing file: ${err.message}`);
      }
    }

    // Secret filter sanitization
    const sanitizedContent = secretFilter.sanitizeString(rawResult.content);

    // Validate format
    const validation = this.validateFormat(rawResult.format, sanitizedContent);

    // Compute diff
    const diff = this.computeStructuredDiff(existingContent || '', sanitizedContent);

    return {
      providerId: rawResult.providerId,
      targetFile: rawResult.targetFile,
      format: rawResult.format,
      content: sanitizedContent,
      existingContent,
      exists,
      existingContentHash,
      diff,
      warnings: rawResult.warnings,
      validation,
      generatedFromEvidence: rawResult.generatedFromEvidence,
    };
  }

  /**
   * Applies (writes) generated configuration to workspace atomically with backup
   * @param {string} workspacePath
   * @param {string} providerId
   * @param {Object} [options]
   * @returns {Promise<Object>}
   */
  async applyConfig(workspacePath, providerId, options = {}) {
    const generator = this.generators.get(providerId);
    if (!generator) {
      throw new Error(`No configuration generator found for provider: ${providerId}`);
    }

    const pathCheck = this.resolveAndValidatePath(workspacePath, generator.targetFile);
    if (!pathCheck.valid) {
      throw new Error(pathCheck.error);
    }

    // 1. Re-generate configuration from actual current disk state
    const generated = await this.generateConfig(workspacePath, providerId, options);
    if (!generated.validation.valid) {
      throw new Error(`Generated configuration is invalid: ${generated.validation.errors.join('; ')}`);
    }

    // 2. Stale preview check
    if (options.expectedExistingContentHash !== undefined) {
      if (generated.existingContentHash !== options.expectedExistingContentHash) {
        throw new Error('STALE_PREVIEW_ERROR: Configuration file on disk was modified since preview was generated. Please review a fresh preview before writing.');
      }
    }

    const targetPath = pathCheck.fullPath;
    let backupFile = null;

    // 3. Create backup if file exists
    if (fs.existsSync(targetPath)) {
      const timestamp = Date.now();
      const backupPath = `${targetPath}.nexus-backup-${timestamp}`;
      fs.copyFileSync(targetPath, backupPath);
      backupFile = path.basename(backupPath);
    }

    // 4. Atomic write via temp file rename
    const tempPath = `${targetPath}.tmp-${crypto.randomBytes(4).toString('hex')}`;
    try {
      fs.writeFileSync(tempPath, generated.content, 'utf8');
      fs.renameSync(tempPath, targetPath);
    } catch (err) {
      // Clean up temp file if rename failed
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (_) {}
      }
      throw new Error(`Failed to write configuration file atomically: ${err.message}`);
    }

    return {
      success: true,
      providerId,
      targetFile: generator.targetFile,
      fullPath: targetPath,
      backupFile,
      bytesWritten: Buffer.byteLength(generated.content, 'utf8'),
      timestamp: Date.now(),
    };
  }
}

const deploymentConfigEngine = new DeploymentConfigEngine();

module.exports = {
  DeploymentConfigEngine,
  deploymentConfigEngine,
};
