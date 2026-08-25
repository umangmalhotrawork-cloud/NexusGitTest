/**
 * NEXUS INTELLIGENCE LAYER — RENDER COMPATIBILITY EVALUATOR (Phase 2A)
 * 
 * Evaluates project compatibility for deployment on Render:
 * - Optimal for persistent Node.js and Python Web Services (Express, Fastify, FastAPI, Flask, Django).
 * - Native support for Render Managed PostgreSQL databases.
 * - Supports Static Sites for compiled frontends.
 * - Enforces cloud host binding (0.0.0.0) and dynamic $PORT routing.
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

class RenderEvaluator {
  constructor() {
    this.providerId = PROVIDER_IDS.RENDER;
    this.displayName = PROVIDER_DISPLAY_NAMES[this.providerId];
  }

  /**
   * Evaluates a DeploymentReport against Render capabilities
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
        reasons: ['Insufficient repository evidence to determine Render compatibility.'],
      });
    }

    // 2. Evaluate Backend Web Service (Render's Core Strength)
    if (backend?.detected) {
      serviceType = COMPUTE_SERVICE_TYPE.WEB_SERVICE;
      buildCommand = backend.buildScript || (backend.runtime === 'node' ? 'npm install' : 'pip install -r requirements.txt');
      startCommand = backend.startCommand;

      if (backend.runtime === 'node') {
        score = 92;
        reasons.push(`Native Node.js persistent Web Service execution for ${backend.framework || 'Node.js'} backend.`);
      } else if (backend.runtime === 'python') {
        score = 94;
        reasons.push(`Native Python Web Service hosting for ${backend.framework || 'Python'} with automatic WSGI/ASGI runner.`);
      }

      // Check Host Binding from Phase 1 Findings / Descriptor
      const rule01Finding = findings.find((f) => f.ruleId === 'RULE-01');
      if (backend.hostBinding === '127.0.0.1' || backend.hostBinding === 'localhost' || (rule01Finding && rule01Finding.severity === 'BLOCKER')) {
        score = 20;
        blockers.push({
          code: 'RENDER_LOOPBACK_HOST_BINDING',
          title: 'Cannot Receive Cloud Ingress on Render',
          message: 'Backend server explicitly binds to "127.0.0.1". Render routing proxy cannot forward external HTTP traffic to the container unless bound to 0.0.0.0.',
          recommendation: 'Update server listen call to bind to "0.0.0.0" (e.g. app.listen(port, "0.0.0.0")).',
        });
      } else if (backend.isHostBindingSafe) {
        reasons.push(`Server binds to cloud-compatible network interface (${backend.hostBinding || '0.0.0.0'}).`);
      } else if (backend.hostBinding === 'UNKNOWN') {
        confidence = CONFIDENCE.MEDIUM;
        warnings.push({
          code: 'RENDER_UNKNOWN_HOST_BINDING',
          title: 'Host Binding Inferred',
          message: 'Server host binding could not be definitively verified from static source code. Ensure server listens on 0.0.0.0 in production.',
          recommendation: 'Verify app.listen specifies host "0.0.0.0".',
        });
      }

      // Check Port Configuration
      const portStr = String(backend.port || '');
      if (portStr.includes('PORT') || portStr.includes('process.env.PORT')) {
        reasons.push('Server dynamically respects Render-assigned $PORT environment variable.');
      } else if (/^\d+$/.test(portStr)) {
        warnings.push({
          code: 'RENDER_HARDCODED_PORT',
          title: 'Hardcoded Port Detected',
          message: `Backend uses static port ${portStr}. Render injects a dynamic $PORT environment variable on launch.`,
          recommendation: `Update server to use process.env.PORT || ${portStr}.`,
        });
      }

      // Check Missing Start Command
      if (!backend.startCommand) {
        score = Math.min(score, 30);
        blockers.push({
          code: 'RENDER_MISSING_START_COMMAND',
          title: 'Missing Production Start Command',
          message: 'Render requires a designated start command (e.g. "node server.js" or "npm start") to launch the Web Service.',
          recommendation: 'Add a "start" script to package.json or specify the start command in render.yaml.',
        });
      }
    } else if (frontend?.detected) {
      // 3. Static Site (Frontend Only)
      serviceType = COMPUTE_SERVICE_TYPE.STATIC_SITE;
      buildCommand = frontend.buildScript;
      outputDir = frontend.outputDirectory;

      if (frontend.framework === 'nextjs' && !frontend.isStaticExport) {
        score = 80;
        serviceType = COMPUTE_SERVICE_TYPE.WEB_SERVICE;
        startCommand = 'npm start (next start)';
        reasons.push('Next.js SSR can run on Render as a continuous Node Web Service.');
      } else {
        score = 88;
        reasons.push(`Render Static Site deployment for ${frontend.framework || 'frontend'} build artifacts.`);
      }
    }

    // 4. Evaluate Database Strategy
    if (database?.detected) {
      if (database.technology === 'postgresql') {
        dbStrategy = DATABASE_STRATEGY.CO_LOCATED;
        dbRecommendedProvider = 'render_postgres';
        dbRationale = 'Provision a Render Managed PostgreSQL database instance with automatic DATABASE_URL injection.';
        reasons.push('Seamless integration with Render Managed PostgreSQL instances.');
        score = Math.min(100, score + 4);
      } else if (database.isSQLite) {
        dbStrategy = DATABASE_STRATEGY.PERSISTENT_VOLUME;
        dbRecommendedProvider = 'render_disks';
        dbRationale = 'Attach a Render Persistent Disk (/var/data) to persist SQLite database file across restarts.';
        warnings.push({
          code: 'RENDER_SQLITE_DISK_REQUIRED',
          title: 'Render Persistent Disk Required for SQLite',
          message: 'Standard Render Web Services use ephemeral disks. To preserve SQLite data across deploys, attach a Render Persistent Disk.',
          recommendation: 'Configure a Render Disk attached to your service mount path or migrate to Render Managed PostgreSQL.',
        });
      } else if (database.technology === 'redis') {
        dbStrategy = DATABASE_STRATEGY.CO_LOCATED;
        dbRecommendedProvider = 'render_redis';
        dbRationale = 'Provision a Render Managed Redis instance with internal private networking.';
      } else {
        dbStrategy = DATABASE_STRATEGY.MANAGED_EXTERNAL;
        dbRecommendedProvider = 'managed_cloud_db';
        dbRationale = `Connect to external managed ${database.technology} via environment variable.`;
      }
    }

    // 5. Monorepo Considerations
    if (project?.isMonorepo) {
      rootDir = backend?.path || frontend?.path || null;
      reasons.push(`Monorepo detected: specify Root Directory "${rootDir || 'apps/api'}" in Render dashboard.`);
    }

    // 6. Docker presence
    if (project?.hasDocker && !backend?.detected) {
      serviceType = COMPUTE_SERVICE_TYPE.DOCKER_CONTAINER;
      score = 88;
      reasons.push('Dockerfile detected: Render can build and deploy custom containerized Web Services.');
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

module.exports = RenderEvaluator;
