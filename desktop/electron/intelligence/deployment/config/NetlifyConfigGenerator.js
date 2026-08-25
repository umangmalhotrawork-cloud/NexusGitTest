/**
 * NEXUS INTELLIGENCE LAYER — NETLIFY CONFIG GENERATOR (Phase 2C)
 * 
 * Deterministically generates netlify.toml from actual DeploymentReport evidence.
 * 
 * STRICT INVARIANTS:
 * - 100% deterministic, 0 API/LLM tokens.
 * - Grounded in real repository evidence (output directory, build commands).
 */

const secretFilter = require('../../../../security/secretFilter');

class NetlifyConfigGenerator {
  constructor() {
    this.providerId = 'netlify';
    this.targetFile = 'netlify.toml';
    this.format = 'toml';
  }

  /**
   * Generates netlify.toml content
   * @param {Object} report - DeploymentReport
   * @param {Object} recommendation - PlatformRecommendation
   * @param {Object} [options]
   * @returns {Object}
   */
  generate(report = {}, recommendation = {}, options = {}) {
    const { frontend, computeTarget = {} } = report;
    const warnings = [];
    const generatedFromEvidence = [];

    const lines = [
      '# Netlify Configuration',
      '# Generated deterministically by NEXUS Deployment Intelligence',
      '',
      '[build]',
    ];

    const publishDir = frontend?.outputDirectory || 'dist';
    lines.push(`  publish = "${publishDir}"`);
    generatedFromEvidence.push(`frontend.outputDirectory: ${publishDir}`);

    if (frontend?.buildScript) {
      const cleanBuild = frontend.buildScript.replace(/^npm run build \((.*)\)$/, '$1').trim();
      lines.push(`  command = "${cleanBuild}"`);
      generatedFromEvidence.push(`frontend.buildScript: ${cleanBuild}`);
    }

    const rootDir = computeTarget.rootDir || frontend?.path;
    if (rootDir) {
      lines.push(`  base = "${rootDir}"`);
      generatedFromEvidence.push(`computeTarget.rootDir: ${rootDir}`);
    }

    // Only add SPA redirects if it is a pure client SPA (not static export)
    if (frontend?.detected && ['react (vite)', 'vue (vite)', 'svelte (vite)', 'create-react-app', 'vite'].includes(frontend.framework) && !frontend.isStaticExport) {
      lines.push('');
      lines.push('[[redirects]]');
      lines.push('  from = "/*"');
      lines.push('  to = "/index.html"');
      lines.push('  status = 200');
      generatedFromEvidence.push('frontend: Client SPA fallback redirect rule added');
    }

    const content = secretFilter.sanitizeString(lines.join('\n') + '\n');

    return {
      providerId: this.providerId,
      targetFile: this.targetFile,
      format: this.format,
      content,
      warnings,
      generatedFromEvidence,
    };
  }
}

module.exports = NetlifyConfigGenerator;
