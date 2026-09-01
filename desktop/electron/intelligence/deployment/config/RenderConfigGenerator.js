/**
 * NEXUS INTELLIGENCE LAYER — RENDER CONFIG GENERATOR (Phase 2C)
 * 
 * Deterministically generates render.yaml from actual DeploymentReport evidence.
 * 
 * STRICT INVARIANTS:
 * - 100% deterministic, 0 API/LLM tokens.
 * - Grounded in real repository evidence (runtimes, commands, ports, DBs).
 * - Distinguishes detected evidence from configurable defaults.
 */

const secretFilter = require('../../../../security/secretFilter');

function cleanNpmCommand(command, fallback) {
  const value = typeof command === 'string' ? command.trim() : '';
  if (!value) return fallback;
  const match = value.match(/^(npm\s+(?:start|run\s+[A-Za-z0-9:_-]+))\s+\([^()\r\n]+\)$/i);
  return match ? match[1] : value;
}

class RenderConfigGenerator {
  constructor() {
    this.providerId = 'render';
    this.targetFile = 'render.yaml';
    this.format = 'yaml';
  }

  /**
   * Generates render.yaml content
   * @param {Object} report - DeploymentReport
   * @param {Object} recommendation - PlatformRecommendation
   * @param {Object} [options]
   * @returns {Object}
   */
  generate(report = {}, recommendation = {}, options = {}) {
    const { frontend, backend, database, computeTarget = {} } = report;
    const warnings = [];
    const generatedFromEvidence = [];

    const lines = [
      '# Render Blueprint Specification',
      '# Generated deterministically by NEXUS Deployment Intelligence',
      '',
      'services:',
    ];

    if (backend?.detected) {
      const isNode = backend.runtime === 'node';
      const isPython = backend.runtime === 'python';
      const serviceName = options.serviceName || 'api-service';
      const runtimeEnv = isNode ? 'node' : isPython ? 'python' : 'docker';

      lines.push(`  - type: web`);
      lines.push(`    name: ${serviceName}`);
      lines.push(`    runtime: ${runtimeEnv}`);
      lines.push(`    plan: free # Configurable default`);

      generatedFromEvidence.push(`backend.runtime: ${backend.runtime}`);
      generatedFromEvidence.push(`backend.framework: ${backend.framework || 'generic'}`);

      // Root Dir
      const rootDir = computeTarget.rootDir || backend.path;
      if (rootDir) {
        lines.push(`    rootDir: ${rootDir}`);
        generatedFromEvidence.push(`computeTarget.rootDir: ${rootDir}`);
      }

      // Build Command
      let buildCmd = 'npm install';
      if (backend.buildScript) {
        buildCmd = cleanNpmCommand(backend.buildScript, 'npm run build');
        generatedFromEvidence.push(`backend.buildScript: ${buildCmd}`);
      } else if (isPython) {
        buildCmd = 'pip install -r requirements.txt';
        generatedFromEvidence.push('backend.runtime (Python): pip install -r requirements.txt');
      }
      lines.push(`    buildCommand: ${buildCmd}`);

      // Start Command
      let startCmd = cleanNpmCommand(backend.startCommand, isNode ? 'npm start' : 'python main.py');
      lines.push(`    startCommand: ${startCmd}`);
      if (backend.startCommand) {
        generatedFromEvidence.push(`backend.startCommand: ${backend.startCommand}`);
      }

      // Environment Variables
      lines.push('    envVars:');
      lines.push('      - key: NODE_ENV');
      lines.push('        value: production');

      if (database?.detected && database.technology === 'postgresql') {
        lines.push('      - key: DATABASE_URL');
        lines.push('        fromDatabase:');
        lines.push('          name: app-postgres');
        lines.push('          property: connectionString');
        generatedFromEvidence.push('database.technology: postgresql -> automatic DATABASE_URL binding');
      }

      // SQLite Persistent Disk
      if (database?.detected && database.isSQLite) {
        lines.push('    disk:');
        lines.push('      name: sqlite-data');
        lines.push('      mountPath: /var/data');
        lines.push('      sizeGB: 1 # Configurable default');
        generatedFromEvidence.push('database.isSQLite: attached persistent disk on /var/data');
      }
    } else if (frontend?.detected) {
      // Frontend Static Site
      const siteName = options.serviceName || 'web-service';
      lines.push(`  - type: web`);
      lines.push(`    name: ${siteName}`);
      lines.push(`    runtime: static`);

      const rootDir = computeTarget.rootDir || frontend.path;
      if (rootDir) {
        lines.push(`    rootDir: ${rootDir}`);
        generatedFromEvidence.push(`computeTarget.rootDir: ${rootDir}`);
      }

      const buildCmd = cleanNpmCommand(frontend.buildScript, 'npm run build');
      lines.push(`    buildCommand: ${buildCmd}`);
      generatedFromEvidence.push(`frontend.buildScript: ${buildCmd}`);

      const publishPath = frontend.outputDirectory || 'dist';
      lines.push(`    staticPublishPath: ${publishPath}`);
      generatedFromEvidence.push(`frontend.outputDirectory: ${publishPath}`);
    }

    // Databases Block
    if (database?.detected && database.technology === 'postgresql') {
      lines.push('');
      lines.push('databases:');
      lines.push('  - name: app-postgres');
      lines.push('    plan: free # Configurable default');
      lines.push('    databaseName: app_prod');
      lines.push('    user: app_user');
      generatedFromEvidence.push('database: Render Managed PostgreSQL definition');
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

module.exports = RenderConfigGenerator;
