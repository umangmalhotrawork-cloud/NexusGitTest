/**
 * NEXUS INTELLIGENCE LAYER — VERCEL COMPATIBILITY EVALUATOR (Phase 2A)
 * 
 * Evaluates project compatibility for deployment on Vercel:
 * - Optimal for Next.js (SSR, Edge, Serverless, Static Export).
 * - Strong for static frontends (Vite, React, Vue, Svelte, Astro).
 * - Constrained for long-running stateful Node/Python backend servers.
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

class VercelEvaluator {
  constructor() {
    this.providerId = PROVIDER_IDS.VERCEL;
    this.displayName = PROVIDER_DISPLAY_NAMES[this.providerId];
  }

  /**
   * Evaluates a DeploymentReport against Vercel capabilities
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
        reasons: ['Insufficient repository evidence to determine Vercel compatibility.'],
      });
    }

    // 2. Evaluate Frontend Capabilities
    if (frontend?.detected) {
      buildCommand = frontend.buildScript;
      outputDir = frontend.outputDirectory;

      if (frontend.framework === 'nextjs') {
        if (frontend.isStaticExport) {
          score = 96;
          serviceType = COMPUTE_SERVICE_TYPE.STATIC_SITE;
          reasons.push('Next.js configured for static HTML export with zero server runtime overhead.');
        } else {
          score = 98;
          serviceType = COMPUTE_SERVICE_TYPE.SERVERLESS_APP;
          reasons.push('First-class native hosting for Next.js SSR and Serverless API Routes.');
        }
      } else if (['react (vite)', 'vue (vite)', 'svelte (vite)', 'vite', 'react', 'vue', 'astro', 'sveltekit'].includes(frontend.framework)) {
        score = 92;
        serviceType = COMPUTE_SERVICE_TYPE.STATIC_SITE;
        reasons.push(`High-performance global Edge CDN deployment for ${frontend.framework} build artifacts.`);
      } else {
        score = 80;
        serviceType = COMPUTE_SERVICE_TYPE.STATIC_SITE;
        reasons.push(`Standard static web hosting for ${frontend.framework || 'frontend'} application.`);
      }
    }

    // 3. Evaluate Backend & Persistent Server Constraints
    if (backend?.detected) {
      if (!frontend?.detected) {
        // Standalone backend only (Express, Fastify, NestJS, Python)
        if (backend.runtime === 'python') {
          score = 25;
          serviceType = COMPUTE_SERVICE_TYPE.UNSUPPORTED;
          blockers.push({
            code: 'VERCEL_STANDALONE_PYTHON_SERVER',
            title: 'Standalone Python Server Not Supported',
            message: `Vercel is optimized for frontend and serverless endpoints. Long-running ${backend.framework || 'Python'} WSGI/ASGI web servers require persistent containers.`,
            recommendation: 'Deploy this Python backend to Render, Railway, or Fly.io.',
          });
        } else if (['express', 'fastify', 'nestjs', 'koa', 'hapi'].includes(backend.framework)) {
          score = 35;
          serviceType = COMPUTE_SERVICE_TYPE.UNSUPPORTED;
          warnings.push({
            code: 'VERCEL_LONG_RUNNING_NODE_SERVER',
            title: 'Long-Running Node.js Server Detected',
            message: `Traditional ${backend.framework} servers expect continuous process lifecycles. Vercel executes serverless functions with execution duration limits and no persistent TCP state.`,
            recommendation: 'For standard Express/NestJS APIs, deploy to Render or Railway, or adapt routes into Next.js/Vercel serverless handlers.',
          });
          reasons.push(`Standalone ${backend.framework} API requires serverless adaptation to run on Vercel.`);
        }
      } else {
        // Fullstack: Frontend + Backend detected in workspace
        warnings.push({
          code: 'VERCEL_DUAL_SUB_SERVICE',
          title: 'Frontend + Standalone Backend Architecture',
          message: `Vercel will deploy the frontend (${frontend.framework}), but the companion ${backend.framework || 'backend'} service should be hosted on a persistent platform.`,
          recommendation: 'Host frontend on Vercel and backend API on Render or Railway.',
        });
        score = Math.min(score, 75);
      }
    }

    // 4. Evaluate Database Hosting
    if (database?.detected) {
      if (database.isSQLite) {
        score = Math.min(score, 45);
        warnings.push({
          code: 'VERCEL_SQLITE_STATELESS_DISK',
          title: 'SQLite Ephemeral Storage Risk on Vercel',
          message: 'Vercel serverless lambdas run in stateless ephemeral containers. Local SQLite database writes will be discarded across requests.',
          recommendation: 'Migrate to a managed cloud database such as Neon Serverless Postgres, Supabase, or PlanetScale.',
        });
        dbStrategy = DATABASE_STRATEGY.STATELESS_EPHEMERAL;
        dbRecommendedProvider = 'neon';
        dbRationale = 'SQLite cannot persist data on Vercel serverless functions; managed external Postgres recommended.';
      } else if (database.technology === 'postgresql') {
        dbStrategy = DATABASE_STRATEGY.MANAGED_EXTERNAL;
        dbRecommendedProvider = 'neon';
        dbRationale = 'Connect serverless endpoints to Neon Serverless PostgreSQL or Supabase via DATABASE_URL.';
        reasons.push('PostgreSQL is supported via external connection pooling (Neon / Supabase).');
      } else if (database.technology === 'mongodb') {
        dbStrategy = DATABASE_STRATEGY.MANAGED_EXTERNAL;
        dbRecommendedProvider = 'mongodb_atlas';
        dbRationale = 'Connect via MongoDB Atlas connection URI with connection caching.';
      } else {
        dbStrategy = DATABASE_STRATEGY.MANAGED_EXTERNAL;
        dbRecommendedProvider = 'managed_cloud_db';
        dbRationale = `Use an external managed ${database.technology} provider.`;
      }
    }

    // 5. Consume Phase 1 Rule Findings
    const missingBuild = findings.find((f) => f.ruleId === 'RULE-04');
    if (missingBuild && frontend?.detected) {
      score = Math.min(score, 30);
      blockers.push({
        code: 'MISSING_BUILD_SCRIPT',
        title: 'Missing Frontend Build Command',
        message: 'Vercel requires a package.json "build" script to generate deployment artifacts.',
        recommendation: 'Add a "build" script to package.json (e.g. "build": "vite build" or "build": "next build").',
      });
    }

    // 6. Monorepo Considerations
    if (project?.isMonorepo) {
      rootDir = frontend?.path || null;
      reasons.push(`Monorepo structure detected: configure Root Directory in Vercel project settings (e.g. "${rootDir || 'apps/web'}").`);
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

module.exports = VercelEvaluator;
