/**
 * NEXUS INTELLIGENCE LAYER — PLATFORM RECOMMENDATION CONTRACT (Phase 2A)
 * 
 * Defines structured schemas, suitability tiers, confidence levels,
 * provider IDs, and normalization builders for deployment platform recommendations.
 * 
 * STRICT INVARIANTS:
 * - 100% deterministic and serializable.
 * - Zero secrets or credentials.
 * - Clear separation of Application Compute Target from Database Storage Target.
 */

const crypto = require('crypto');
const secretFilter = require('../../../security/secretFilter');

/**
 * Platform Suitability Tiers
 */
const SUITABILITY = Object.freeze({
  EXCELLENT: 'EXCELLENT',       // 90-100: Native, optimal architectural match
  GOOD: 'GOOD',                 // 75-89: Strong fit with minor/standard configuration
  CONDITIONAL: 'CONDITIONAL',   // 50-74: Viable with notable constraints/trade-offs
  POOR: 'POOR',                 // 25-49: Architectural friction or significant limitations
  INCOMPATIBLE: 'INCOMPATIBLE', // 0-24: Hard deployment blockers or runtime mismatches
});

/**
 * Recommendation Confidence Levels
 */
const CONFIDENCE = Object.freeze({
  HIGH: 'HIGH',       // Strong multi-file repository evidence
  MEDIUM: 'MEDIUM',   // Standard manifests detected; some parameters inferred
  LOW: 'LOW',         // Minimal or ambiguous evidence; conservative evaluation
});

/**
 * Supported Provider IDs
 */
const PROVIDER_IDS = Object.freeze({
  VERCEL: 'vercel',
  RENDER: 'render',
  RAILWAY: 'railway',
  FLYIO: 'flyio',
  NETLIFY: 'netlify',
  DOCKER: 'docker',
});

/**
 * Provider Display Names
 */
const PROVIDER_DISPLAY_NAMES = Object.freeze({
  [PROVIDER_IDS.VERCEL]: 'Vercel',
  [PROVIDER_IDS.RENDER]: 'Render',
  [PROVIDER_IDS.RAILWAY]: 'Railway',
  [PROVIDER_IDS.FLYIO]: 'Fly.io',
  [PROVIDER_IDS.NETLIFY]: 'Netlify',
  [PROVIDER_IDS.DOCKER]: 'Docker (Containerized)',
});

/**
 * Compute Service Types
 */
const COMPUTE_SERVICE_TYPE = Object.freeze({
  STATIC_SITE: 'STATIC_SITE',
  SERVERLESS_APP: 'SERVERLESS_APP',
  WEB_SERVICE: 'WEB_SERVICE',
  BACKGROUND_WORKER: 'BACKGROUND_WORKER',
  DOCKER_CONTAINER: 'DOCKER_CONTAINER',
  UNSUPPORTED: 'UNSUPPORTED',
});

/**
 * Database Hosting Strategy Types
 */
const DATABASE_STRATEGY = Object.freeze({
  CO_LOCATED: 'CO_LOCATED',                 // Provided natively in the same platform
  MANAGED_EXTERNAL: 'MANAGED_EXTERNAL',     // External DB service (Neon, Supabase, Atlas)
  PERSISTENT_VOLUME: 'PERSISTENT_VOLUME',   // Local DB attached to persistent volume
  STATELESS_EPHEMERAL: 'STATELESS_EPHEMERAL', // DB without volume (data loss risk)
  NOT_REQUIRED: 'NOT_REQUIRED',             // No database used in application
});

/**
 * Calculates suitability tier from a bounded 0-100 score
 * @param {number} score
 * @returns {string} SUITABILITY
 */
function scoreToSuitability(score) {
  const s = Math.max(0, Math.min(100, Math.round(score || 0)));
  if (s >= 90) return SUITABILITY.EXCELLENT;
  if (s >= 75) return SUITABILITY.GOOD;
  if (s >= 50) return SUITABILITY.CONDITIONAL;
  if (s >= 25) return SUITABILITY.POOR;
  return SUITABILITY.INCOMPATIBLE;
}

/**
 * Normalizes a platform blocker item
 * @param {Object} item
 * @returns {Object}
 */
function normalizeBlocker(item = {}) {
  return {
    code: secretFilter.sanitizeString(String(item.code || 'BLOCKER').trim()),
    title: secretFilter.sanitizeString(String(item.title || 'Platform Blocker').trim()),
    message: secretFilter.sanitizeString(String(item.message || '').trim()),
    recommendation: item.recommendation
      ? secretFilter.sanitizeString(String(item.recommendation).trim())
      : undefined,
  };
}

/**
 * Normalizes a platform warning item
 * @param {Object} item
 * @returns {Object}
 */
function normalizeWarning(item = {}) {
  return {
    code: secretFilter.sanitizeString(String(item.code || 'WARNING').trim()),
    title: secretFilter.sanitizeString(String(item.title || 'Platform Warning').trim()),
    message: secretFilter.sanitizeString(String(item.message || '').trim()),
    recommendation: item.recommendation
      ? secretFilter.sanitizeString(String(item.recommendation).trim())
      : undefined,
  };
}

/**
 * Creates and normalizes a Platform Recommendation object
 * @param {Object} input
 * @returns {Object} PlatformRecommendation
 */
function createPlatformRecommendation(input = {}) {
  const providerId = input.providerId || 'unknown';
  const displayName = input.displayName || PROVIDER_DISPLAY_NAMES[providerId] || providerId;
  const score = Math.max(0, Math.min(100, Math.round(input.score !== undefined ? input.score : 0)));
  const suitability = input.suitability || scoreToSuitability(score);
  const confidence = input.confidence || CONFIDENCE.MEDIUM;

  const computeTarget = {
    serviceType: input.computeTarget?.serviceType || COMPUTE_SERVICE_TYPE.UNSUPPORTED,
    rootDir: input.computeTarget?.rootDir ? secretFilter.sanitizeString(input.computeTarget.rootDir) : null,
    buildCommand: input.computeTarget?.buildCommand ? secretFilter.sanitizeString(input.computeTarget.buildCommand) : null,
    startCommand: input.computeTarget?.startCommand ? secretFilter.sanitizeString(input.computeTarget.startCommand) : null,
    outputDir: input.computeTarget?.outputDir ? secretFilter.sanitizeString(input.computeTarget.outputDir) : null,
  };

  const databaseTarget = {
    strategy: input.databaseTarget?.strategy || DATABASE_STRATEGY.NOT_REQUIRED,
    recommendedProvider: input.databaseTarget?.recommendedProvider
      ? secretFilter.sanitizeString(input.databaseTarget.recommendedProvider)
      : null,
    rationale: input.databaseTarget?.rationale
      ? secretFilter.sanitizeString(input.databaseTarget.rationale)
      : 'No database storage configuration required.',
  };

  const reasons = Array.isArray(input.reasons)
    ? input.reasons.map((r) => secretFilter.sanitizeString(String(r).trim())).filter(Boolean)
    : [];

  const blockers = Array.isArray(input.blockers)
    ? input.blockers.map(normalizeBlocker)
    : [];

  const warnings = Array.isArray(input.warnings)
    ? input.warnings.map(normalizeWarning)
    : [];

  return {
    providerId,
    displayName,
    suitability,
    score,
    confidence,
    computeTarget,
    databaseTarget,
    reasons,
    blockers,
    warnings,
  };
}

module.exports = {
  SUITABILITY,
  CONFIDENCE,
  PROVIDER_IDS,
  PROVIDER_DISPLAY_NAMES,
  COMPUTE_SERVICE_TYPE,
  DATABASE_STRATEGY,
  scoreToSuitability,
  createPlatformRecommendation,
};
