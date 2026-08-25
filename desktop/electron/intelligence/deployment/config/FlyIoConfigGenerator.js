/**
 * NEXUS INTELLIGENCE LAYER — FLY.IO CONFIG GENERATOR (Phase 2C)
 * 
 * Deterministically generates fly.toml from actual DeploymentReport evidence.
 * 
 * STRICT INVARIANTS:
 * - 100% deterministic, 0 API/LLM tokens.
 * - Grounded in real repository evidence (ports, SQLite volumes, start commands).
 */

const secretFilter = require('../../../../security/secretFilter');

class FlyIoConfigGenerator {
  constructor() {
    this.providerId = 'flyio';
    this.targetFile = 'fly.toml';
    this.format = 'toml';
  }

  /**
   * Generates fly.toml content
   * @param {Object} report - DeploymentReport
   * @param {Object} recommendation - PlatformRecommendation
   * @param {Object} [options]
   * @returns {Object}
   */
  generate(report = {}, recommendation = {}, options = {}) {
    const { backend, database, workspacePath = '' } = report;
    const warnings = [];
    const generatedFromEvidence = [];

    const appName = options.appName || 'nexus-app';

    const lines = [
      '# Fly.io App Configuration',
      '# Generated deterministically by NEXUS Deployment Intelligence',
      '',
      `app = "${appName}"`,
      '# primary_region = "iad" # User configuration required: set preferred region',
      '',
      '[http_service]',
    ];

    let internalPort = 8080;
    if (backend?.port && /^\d+$/.test(String(backend.port))) {
      internalPort = parseInt(String(backend.port), 10);
      generatedFromEvidence.push(`backend.port: ${internalPort}`);
    } else if (backend?.runtime === 'node') {
      internalPort = 3000;
      generatedFromEvidence.push('backend.runtime (Node.js default port): 3000');
    } else if (backend?.runtime === 'python') {
      internalPort = 8000;
      generatedFromEvidence.push('backend.runtime (Python default port): 8000');
    }

    lines.push(`  internal_port = ${internalPort}`);
    lines.push('  force_https = true');
    lines.push('  auto_stop_machines = true');
    lines.push('  auto_start_machines = true');
    lines.push('  min_machines_running = 0');

    // SQLite Mounts
    if (database?.detected && database.isSQLite) {
      lines.push('');
      lines.push('[mounts]');
      lines.push('  source = "sqlite_data"');
      lines.push('  destination = "/var/data"');
      generatedFromEvidence.push('database.isSQLite: configured [mounts] volume on /var/data');
    }

    lines.push('');
    lines.push('[[vm]]');
    lines.push('  memory = "1gb"');
    lines.push('  cpu_kind = "shared"');
    lines.push('  cpus = 1');

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

module.exports = FlyIoConfigGenerator;
