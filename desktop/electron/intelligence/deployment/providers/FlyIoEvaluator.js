/**
 * NEXUS INTELLIGENCE LAYER — FLY.IO COMPATIBILITY EVALUATOR (Phase 2A)
 * 
 * Evaluates project compatibility for deployment on Fly.io:
 * - Optimal for Container-Native (Docker) microVM workloads and global distribution.
 * - Specialized support for SQLite via Fly Persistent Volumes and LiteFS.
 * - Supports persistent Node.js and Python backend services.
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

class FlyIoEvaluator {
  constructor() {
    this.providerId = PROVIDER_IDS.FLYIO;
    this.displayName = PROVIDER_DISPLAY_NAMES[this.providerId];
  }

  /**
   * Evaluates a DeploymentReport against Fly.io capabilities
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
    let confidence = project?.hasDocker ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM;
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
        reasons: ['Insufficient repository evidence to determine Fly.io compatibility.'],
      });
    }

    // 2. Evaluate Docker & Backend Capabilities
    if (project?.hasDocker) {
      score = 95;
      serviceType = COMPUTE_SERVICE_TYPE.DOCKER_CONTAINER;
      reasons.push('Custom Dockerfile detected: Fly.io deploys and runs container images directly on global microVMs.');
    } else if (backend?.detected) {
      serviceType = COMPUTE_SERVICE_TYPE.WEB_SERVICE;
      startCommand = backend.startCommand;
      buildCommand = backend.buildScript;

      if (backend.runtime === 'node' || backend.runtime === 'python') {
        score = 88;
        reasons.push(`Fly.io automatically containerizes and runs ${backend.framework || backend.runtime} applications.`);
      }
    } else if (frontend?.detected) {
      serviceType = COMPUTE_SERVICE_TYPE.STATIC_SITE;
      buildCommand = frontend.buildScript;
      outputDir = frontend.outputDirectory;
      score = 72;
      reasons.push('Fly.io can host static sites via embedded web servers (e.g. GoStatic / Nginx).');
      warnings.push({
        code: 'FLYIO_STATIC_HEURISTIC',
        title: 'Static Frontend Requires Web Server Wrapper',
        message: 'Fly.io runs full virtual machines. For purely static frontend apps, dedicated CDN providers (Vercel/Netlify) offer simpler deployment.',
        recommendation: 'Use Vercel or Netlify for static frontends, or wrap with Nginx for Fly.io.',
      });
    }

    // 3. Evaluate Host Binding
    if (backend?.detected) {
      const rule01Finding = findings.find((f) => f.ruleId === 'RULE-01');
      if (backend.hostBinding === '127.0.0.1' || backend.hostBinding === 'localhost' || (rule01Finding && rule01Finding.severity === 'BLOCKER')) {
        score = 20;
        blockers.push({
          code: 'FLYIO_LOOPBACK_BINDING',
          title: 'Fly.io Proxy Ingress Blocked',
          message: 'Server listens on 127.0.0.1. Fly.io edge proxy forwards traffic to the internal microVM port on 0.0.0.0.',
          recommendation: 'Update server listen call to bind to 0.0.0.0.',
        });
      }
    }

    // 4. Evaluate Database Strategy (Fly's SQLite & Volume Advantage)
    if (database?.detected) {
      if (database.isSQLite) {
        dbStrategy = DATABASE_STRATEGY.PERSISTENT_VOLUME;
        dbRecommendedProvider = 'fly_volumes';
        dbRationale = 'Fly Persistent Volumes provide fast NVMe storage ideal for single-node SQLite databases and LiteFS clusters.';
        reasons.push('Excellent SQLite support: Fly Persistent Volumes enable durable local embedded database storage.');
        score = Math.min(100, score + 6);
      } else if (database.technology === 'postgresql') {
        dbStrategy = DATABASE_STRATEGY.MANAGED_EXTERNAL;
        dbRecommendedProvider = 'fly_postgres';
        dbRationale = 'Deploy a Fly Postgres app cluster or connect to an external managed Postgres instance.';
        reasons.push('Compatible with Fly Postgres clusters or external managed PostgreSQL.');
      } else {
        dbStrategy = DATABASE_STRATEGY.MANAGED_EXTERNAL;
        dbRecommendedProvider = 'managed_cloud_db';
        dbRationale = `Connect to external managed ${database.technology} database.`;
      }
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

module.exports = FlyIoEvaluator;
