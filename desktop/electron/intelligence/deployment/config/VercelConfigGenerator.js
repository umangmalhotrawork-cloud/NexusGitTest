/**
 * NEXUS INTELLIGENCE LAYER — VERCEL CONFIG GENERATOR (Phase 2C)
 * 
 * Deterministically generates vercel.json from actual DeploymentReport evidence.
 * 
 * STRICT INVARIANTS:
 * - 100% deterministic, 0 API/LLM tokens.
 * - Grounded exclusively in real repository evidence.
 * - Sanitized via secretFilter.
 */

const secretFilter = require('../../../../security/secretFilter');

class VercelConfigGenerator {
  constructor() {
    this.providerId = 'vercel';
    this.targetFile = 'vercel.json';
    this.format = 'json';
  }

  /**
   * Generates vercel.json content
   * @param {Object} report - DeploymentReport
   * @param {Object} recommendation - PlatformRecommendation
   * @param {Object} [options]
   * @returns {Object}
   */
  generate(report = {}, recommendation = {}, options = {}) {
    const { frontend, computeTarget = {}, environmentVariables = {} } = report;
    const warnings = [];
    const generatedFromEvidence = [];

    const config = {
      $schema: 'https://openapi.vercel.sh/vercel.json',
    };

    // 1. Framework configuration
    if (frontend?.detected && frontend.framework) {
      if (frontend.framework === 'nextjs') {
        config.framework = 'nextjs';
        generatedFromEvidence.push('frontend.framework: nextjs');
      } else if (frontend.framework.includes('vite')) {
        config.framework = 'vite';
        generatedFromEvidence.push(`frontend.framework: ${frontend.framework}`);
      } else if (frontend.framework === 'astro') {
        config.framework = 'astro';
        generatedFromEvidence.push('frontend.framework: astro');
      } else if (frontend.framework === 'sveltekit') {
        config.framework = 'sveltekit';
        generatedFromEvidence.push('frontend.framework: sveltekit');
      } else if (frontend.framework === 'create-react-app') {
        config.framework = 'create-react-app';
        generatedFromEvidence.push('frontend.framework: create-react-app');
      }
    }

    // 2. Build command
    if (frontend?.buildScript) {
      const cleanBuild = frontend.buildScript.replace(/^npm run build \((.*)\)$/, '$1').trim();
      config.buildCommand = cleanBuild.startsWith('next ') || cleanBuild.startsWith('vite ') ? undefined : cleanBuild;
      if (config.buildCommand) {
        generatedFromEvidence.push(`frontend.buildScript: ${config.buildCommand}`);
      }
    }

    // 3. Output directory
    if (frontend?.outputDirectory) {
      if (frontend.framework === 'nextjs' && frontend.isStaticExport) {
        config.outputDirectory = frontend.outputDirectory;
        config.cleanUrls = true;
        generatedFromEvidence.push(`frontend.outputDirectory: ${frontend.outputDirectory} (static export)`);
      } else if (frontend.framework !== 'nextjs') {
        config.outputDirectory = frontend.outputDirectory;
        generatedFromEvidence.push(`frontend.outputDirectory: ${frontend.outputDirectory}`);
      }
    }

    // 4. Monorepo root directory
    const rootDir = computeTarget.rootDir || frontend?.path;
    if (rootDir) {
      config.rootDirectory = rootDir;
      generatedFromEvidence.push(`computeTarget.rootDir: ${rootDir}`);
    }

    // Clean undefined fields
    const cleanedConfig = {};
    for (const [k, v] of Object.entries(config)) {
      if (v !== undefined) cleanedConfig[k] = v;
    }

    const formattedContent = JSON.stringify(cleanedConfig, null, 2);
    const sanitizedContent = secretFilter.sanitizeString(formattedContent);

    return {
      providerId: this.providerId,
      targetFile: this.targetFile,
      format: this.format,
      content: sanitizedContent,
      warnings,
      generatedFromEvidence,
    };
  }
}

module.exports = VercelConfigGenerator;
