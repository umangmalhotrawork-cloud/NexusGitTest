/**
 * NEXUS INTELLIGENCE LAYER — RAILWAY CONFIG GENERATOR (Phase 2C)
 * 
 * Deterministically generates railway.toml from actual DeploymentReport evidence.
 * 
 * STRICT INVARIANTS:
 * - 100% deterministic, 0 API/LLM tokens.
 * - Grounded in real repository evidence (Nixpacks build commands, start scripts).
 */

const secretFilter = require('../../../../security/secretFilter');

class RailwayConfigGenerator {
  constructor() {
    this.providerId = 'railway';
    this.targetFile = 'railway.toml';
    this.format = 'toml';
  }

  /**
   * Generates railway.toml content
   * @param {Object} report - DeploymentReport
   * @param {Object} recommendation - PlatformRecommendation
   * @param {Object} [options]
   * @returns {Object}
   */
  generate(report = {}, recommendation = {}, options = {}) {
    const { frontend, backend, computeTarget = {}, database } = report;
    const warnings = [];
    const generatedFromEvidence = [];

    const lines = [
      '# Railway Configuration',
      '# Generated deterministically by NEXUS Deployment Intelligence',
      '',
      '[build]',
      'builder = "NIXPACKS"',
    ];

    const buildScript = backend?.buildScript || frontend?.buildScript;
    if (buildScript) {
      const cleanBuild = buildScript.replace(/^npm run build \((.*)\)$/, '$1').trim();
      lines.push(`buildCommand = "${cleanBuild}"`);
      generatedFromEvidence.push(`buildScript: ${cleanBuild}`);
    }

    lines.push('');
    lines.push('[deploy]');

    const startCmd = backend?.startCommand ? backend.startCommand.replace(/^npm start \((.*)\)$/, '$1').trim() : (backend?.runtime === 'node' ? 'npm start' : null);
    if (startCmd) {
      lines.push(`startCommand = "${startCmd}"`);
      generatedFromEvidence.push(`backend.startCommand: ${startCmd}`);
    }

    lines.push('restartPolicyType = "ON_FAILURE"');
    lines.push('restartPolicyMaxRetries = 10');

    if (database?.detected) {
      warnings.push(`Project uses ${database.technology}. Provision the companion ${database.technology} plugin in your Railway dashboard.`);
      generatedFromEvidence.push(`database: ${database.technology} dependency noted`);
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

module.exports = RailwayConfigGenerator;
