/**
 * NEXUS INTELLIGENCE LAYER — RAILWAY COMPATIBILITY EVALUATOR (Phase 2A)
 * 
 * Evaluates project compatibility for deployment on Railway:
 * - Optimal for Fullstack and Multi-Service architectures (Nixpacks build engine).
 * - Instant provisioning of PostgreSQL, MySQL, Redis, and MongoDB database plugins.
 * - Supports persistent volumes for SQLite and containerized workloads.
 */

const {
  PROVIDER_IDS,
  PROVIDER_DISPLAY_NAMES,
  SUITABILITY,
  CONFIDENCE,
  COMPUTE_SERVICE_TYPE,
  DATABASE_STRATEGY,
  createPlatformRecommendation,
} = require('../PlatformRecommendation');

class RailwayEvaluator {
  constructor() {
    this.providerId = PROVIDER_IDS.RAILWAY;
    this.displayName = PROVIDER_DISPLAY_NAMES[this.providerId];
  }

  /**
   * Evaluates a DeploymentReport against Railway capabilities
   * @param {Object} report - DeploymentReport struct
   * @returns {Object} PlatformRecommendation
   */
  evaluate(report = {}) {
    if (!report || typeof report !== 'object') {
      return createPlatformRecommendation({
        providerId: this.providerId,
        displayName: this.displayName,
        suitability: SUITABILITY.INCOMPATIBLE,
        score: 0,
        confidence: CONFIDENCE.LOW,
        reasons: ['Malformed or missing deployment report.'],
      });
    }

    const { frontend, backend, database, project, findings = [] } = report;
    let score = 50;
    let confidence = CONFIDENCE.HIGH;
    let serviceType = COMPUTE_SERVICE_TYPE.UNSUPPORTED;
    let buildCommand = null;
    let startCommand = null;
    let outputDir = null;
    let rootDir = null;

    const reasons = [];
    const blockers = [];
    const warnings = [];

    let dbStrategy = DATABASE_STRATEGY.NOT_REQUIRED;
    let dbRecommendedProvider = null;
    let dbRationale = 'No database detected.';

    // 1. Unknown / Empty Project
    if (!frontend?.detected && !backend?.detected && !database?.detected && !project?.hasDocker) {
      return createPlatformRecommendation({
        providerId: this.providerId,
        displayName: this.displayName,
        suitability: SUITABILITY.INCOMPATIBLE,
        score: 10,
        confidence: CONFIDENCE.LOW,
        reasons: ['Insufficient repository evidence to determine Railway compatibility.'],
      });
    }

    // 2. Evaluate Compute Target
    if (backend?.detected && frontend?.detected) {
      // Fullstack
      score = 94;
      serviceType = COMPUTE_SERVICE_TYPE.WEB_SERVICE;
      buildCommand = backend.buildScript || frontend.buildScript;
      startCommand = backend.startCommand;
      reasons.push('Full-stack architecture natively supported via Railway Nixpacks multi-service environment.');
    } else if (backend?.detected) {
      // Standalone backend
      serviceType = COMPUTE_SERVICE_TYPE.WEB_SERVICE;
      buildCommand = backend.buildScript;
      startCommand = backend.startCommand;

      if (backend.runtime === 'node') {
        score = 92;
        reasons.push(`Railway Nixpacks auto-builds and manages ${backend.framework || 'Node.js'} backend services.`);
      } else if (backend.runtime === 'python') {
        score = 92;
        reasons.push(`Native Python support for ${backend.framework || 'Python'} with automatic dependency caching.`);
      }
    } else if (frontend?.detected) {
      // Frontend only
      serviceType = COMPUTE_SERVICE_TYPE.STATIC_SITE;
      buildCommand = frontend.buildScript;
      outputDir = frontend.outputDirectory;
      score = 86;
      reasons.push(`Railway deploys ${frontend.framework || 'frontend'} apps with automatic Nginx static file serving.`);
    } else if (project?.hasDocker) {
      serviceType = COMPUTE_SERVICE_TYPE.DOCKER_CONTAINER;
      score = 90;
      reasons.push('Custom Dockerfile detected: Railway builds and deploys container images automatically.');
    }

    // 3. Evaluate Host Binding & Port Handling
    if (backend?.detected) {
      const rule01Finding = findings.find((f) => f.ruleId === 'RULE-01');
      if (backend.hostBinding === '127.0.0.1' || backend.hostBinding === 'localhost' || (rule01Finding && rule01Finding.severity === 'BLOCKER')) {
        score = 20;
        blockers.push({
          code: 'RAILWAY_LOOPBACK_BINDING',
          title: 'Loopback Host Binding Incompatible',
          message: 'Server binds to "127.0.0.1". Railway edge proxy routes public HTTP requests only to services listening on 0.0.0.0.',
          recommendation: 'Configure your server to bind to 0.0.0.0 (e.g. app.listen(port, "0.0.0.0")).',
        });
      } else if (backend.isHostBindingSafe) {
        reasons.push('Cloud-compatible 0.0.0.0 host binding verified.');
      }

      const portStr = String(backend.port || '');
      if (portStr.includes('PORT')) {
        reasons.push('Backend dynamically binds to Railway-injected $PORT.');
      } else if (/^\d+$/.test(portStr)) {
        warnings.push({
          code: 'RAILWAY_HARDCODED_PORT',
          title: 'Static Port Specified',
          message: `Server uses static port ${portStr}. Railway injects dynamic $PORT; ensure server binds to process.env.PORT.`,
          recommendation: `Use process.env.PORT || ${portStr}.`,
        });
      }
    }

    // 4. Evaluate Database Strategy (Railway's Plugin Ecosystem)
    if (database?.detected) {
      if (database.technology === 'postgresql') {
        dbStrategy = DATABASE_STRATEGY.CO_LOCATED;
        dbRecommendedProvider = 'railway_postgres';
        dbRationale = 'Provision one-click Railway PostgreSQL plugin with private networking and DATABASE_URL.';
        reasons.push('One-click PostgreSQL plugin provisioning with automatic environment variable injection.');
        score = Math.min(100, score + 4);
      } else if (database.technology === 'mysql') {
        dbStrategy = DATABASE_STRATEGY.CO_LOCATED;
        dbRecommendedProvider = 'railway_mysql';
        dbRationale = 'Provision one-click Railway MySQL plugin with private networking.';
        reasons.push('Native Railway MySQL plugin supported.');
      } else if (database.technology === 'redis') {
        dbStrategy = DATABASE_STRATEGY.CO_LOCATED;
        dbRecommendedProvider = 'railway_redis';
        dbRationale = 'Provision one-click Railway Redis plugin for in-memory caching.';
      } else if (database.isSQLite) {
        dbStrategy = DATABASE_STRATEGY.PERSISTENT_VOLUME;
        dbRecommendedProvider = 'railway_volume';
        dbRationale = 'Attach a Railway Volume to preserve SQLite database file across deploys.';
        warnings.push({
          code: 'RAILWAY_SQLITE_VOLUME_REQUIRED',
          title: 'Railway Persistent Volume Required for SQLite',
          message: 'Railway containers are ephemeral by default. Attach a Railway Volume to keep SQLite data intact.',
          recommendation: 'Attach a Railway Volume mount or provision a Railway PostgreSQL plugin.',
        });
      } else {
        dbStrategy = DATABASE_STRATEGY.MANAGED_EXTERNAL;
        dbRecommendedProvider = 'managed_cloud_db';
        dbRationale = `Connect to external ${database.technology} database.`;
      }
    }

    // 5. Monorepo Considerations
    if (project?.isMonorepo) {
      rootDir = backend?.path || frontend?.path || null;
      reasons.push('Railway project environments support deploying multiple services from a single monorepo repository.');
    }

    return createPlatformRecommendation({
      providerId: this.providerId,
      displayName: this.displayName,
      score,
      confidence,
      computeTarget: {
        serviceType,
        rootDir,
        buildCommand,
        startCommand,
        outputDir,
      },
      databaseTarget: {
        strategy: dbStrategy,
        recommendedProvider: dbRecommendedProvider,
        rationale: dbRationale,
      },
      reasons,
      blockers,
      warnings,
    });
  }
}

module.exports = RailwayEvaluator;
