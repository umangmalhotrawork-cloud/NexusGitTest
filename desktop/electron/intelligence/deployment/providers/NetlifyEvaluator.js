/**
 * NEXUS INTELLIGENCE LAYER — NETLIFY COMPATIBILITY EVALUATOR (Phase 2A)
 * 
 * Evaluates project compatibility for deployment on Netlify:
 * - Optimal for JAMstack, static frontends (Vite, React, Vue, Svelte, Astro).
 * - Strong for Next.js static HTML export mode.
 * - Incompatible with long-running persistent Node.js / Python backend web servers.
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

class NetlifyEvaluator {
  constructor() {
    this.providerId = PROVIDER_IDS.NETLIFY;
    this.displayName = PROVIDER_DISPLAY_NAMES[this.providerId];
  }

  /**
   * Evaluates a DeploymentReport against Netlify capabilities
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
        reasons: ['Insufficient repository evidence to determine Netlify compatibility.'],
      });
    }

    // 2. Evaluate Frontend (Netlify's Core Strength)
    if (frontend?.detected) {
      buildCommand = frontend.buildScript;
      outputDir = frontend.outputDirectory;

      if (['react (vite)', 'vue (vite)', 'svelte (vite)', 'vite', 'react', 'vue', 'astro'].includes(frontend.framework)) {
        score = 94;
        serviceType = COMPUTE_SERVICE_TYPE.STATIC_SITE;
        reasons.push(`First-class JAMstack static hosting for ${frontend.framework} build output.`);
      } else if (frontend.framework === 'nextjs') {
        if (frontend.isStaticExport) {
          score = 94;
          serviceType = COMPUTE_SERVICE_TYPE.STATIC_SITE;
          reasons.push('Next.js static HTML export mode is natively supported on Netlify CDN.');
        } else {
          score = 80;
          serviceType = COMPUTE_SERVICE_TYPE.SERVERLESS_APP;
          reasons.push('Next.js SSR is supported via Netlify Essential Next.js runtime plugin.');
        }
      } else {
        score = 85;
        serviceType = COMPUTE_SERVICE_TYPE.STATIC_SITE;
        reasons.push(`Standard static site hosting for ${frontend.framework || 'frontend'} build output.`);
      }
    }

    // 3. Evaluate Backend Incompatibilities
    if (backend?.detected) {
      if (!frontend?.detected) {
        // Standalone backend
        score = 20;
        serviceType = COMPUTE_SERVICE_TYPE.UNSUPPORTED;
        blockers.push({
          code: 'NETLIFY_PERSISTENT_SERVER_UNSUPPORTED',
          title: 'Persistent Backend Server Not Supported',
          message: `Netlify is a static and serverless platform. Traditional long-running ${backend.framework || backend.runtime} servers cannot run continuously on Netlify.`,
          recommendation: 'Deploy this backend service to Render, Railway, or Fly.io.',
        });
      } else {
        // Frontend + Backend
        warnings.push({
          code: 'NETLIFY_BACKEND_SEPARATION',
          title: 'Companion Backend Requires Separate Hosting',
          message: `Netlify will host the frontend UI, but the ${backend.framework || 'backend'} API must be hosted separately.`,
          recommendation: 'Deploy the backend to Render/Railway and point Netlify environment variables to the backend API URL.',
        });
        score = Math.min(score, 70);
      }
    }

    // 4. Evaluate Database Strategy
    if (database?.detected) {
      if (database.isSQLite) {
        score = Math.min(score, 40);
        warnings.push({
          code: 'NETLIFY_SQLITE_STATELESS',
          title: 'SQLite Incompatible with Netlify Stateless Edge',
          message: 'Netlify Edge and Function runtime is stateless and has no persistent filesystem storage.',
          recommendation: 'Migrate SQLite data to managed cloud databases (Neon Postgres, Supabase, PlanetScale).',
        });
        dbStrategy = DATABASE_STRATEGY.STATELESS_EPHEMERAL;
      } else {
        dbStrategy = DATABASE_STRATEGY.MANAGED_EXTERNAL;
        dbRecommendedProvider = 'managed_cloud_db';
        dbRationale = `Connect frontend/functions to external ${database.technology} database via environment variables.`;
      }
    }

    // 5. Consume Phase 1 Missing Build Blocker
    const missingBuild = findings.find((f) => f.ruleId === 'RULE-04');
    if (missingBuild && frontend?.detected) {
      score = Math.min(score, 30);
      blockers.push({
        code: 'MISSING_BUILD_SCRIPT',
        title: 'Missing Frontend Build Command',
        message: 'Netlify requires a build script to generate static artifacts for publishing.',
        recommendation: 'Add a "build" script to package.json.',
      });
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

module.exports = NetlifyEvaluator;
