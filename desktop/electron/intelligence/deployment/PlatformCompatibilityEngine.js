/**
 * NEXUS INTELLIGENCE LAYER — PLATFORM COMPATIBILITY ENGINE (Phase 2A)
 * 
 * Deterministic engine evaluating a Phase 1 DeploymentReport across all registered
 * cloud platforms to produce ranked, evidence-grounded deployment recommendations.
 * 
 * STRICT INVARIANTS:
 * - Zero LLM/API calls. 100% deterministic local computation.
 * - Non-destructive and strictly read-only.
 * - Fault-tolerant: per-provider evaluation isolation so one malformed evaluator
 *   cannot crash the engine.
 */

const {
  SUITABILITY,
  CONFIDENCE,
  createPlatformRecommendation,
} = require('./PlatformRecommendation');

const VercelEvaluator = require('./providers/VercelEvaluator');
const RenderEvaluator = require('./providers/RenderEvaluator');
const RailwayEvaluator = require('./providers/RailwayEvaluator');
const FlyIoEvaluator = require('./providers/FlyIoEvaluator');
const NetlifyEvaluator = require('./providers/NetlifyEvaluator');
const DockerEvaluator = require('./providers/DockerEvaluator');

const SUITABILITY_WEIGHTS = Object.freeze({
  [SUITABILITY.EXCELLENT]: 4,
  [SUITABILITY.GOOD]: 3,
  [SUITABILITY.CONDITIONAL]: 2,
  [SUITABILITY.POOR]: 1,
  [SUITABILITY.INCOMPATIBLE]: 0,
});

const CONFIDENCE_WEIGHTS = Object.freeze({
  [CONFIDENCE.HIGH]: 3,
  [CONFIDENCE.MEDIUM]: 2,
  [CONFIDENCE.LOW]: 1,
});

class PlatformCompatibilityEngine {
  constructor() {
    this.evaluators = new Map();
    this.registerDefaultEvaluators();
  }

  /**
   * Registers standard default platform evaluators
   */
  registerDefaultEvaluators() {
    this.registerEvaluator(new VercelEvaluator());
    this.registerEvaluator(new RenderEvaluator());
    this.registerEvaluator(new RailwayEvaluator());
    this.registerEvaluator(new FlyIoEvaluator());
    this.registerEvaluator(new NetlifyEvaluator());
    this.registerEvaluator(new DockerEvaluator());
  }

  /**
   * Registers a provider evaluator
   * @param {Object} evaluator
   */
  registerEvaluator(evaluator) {
    if (evaluator && typeof evaluator.providerId === 'string' && typeof evaluator.evaluate === 'function') {
      this.evaluators.set(evaluator.providerId, evaluator);
    }
  }

  /**
   * Evaluates a DeploymentReport against all registered platforms
   * @param {Object} report - Phase 1 DeploymentReport
   * @returns {Object} CompatibilityResult with ranked recommendations
   */
  evaluate(report = {}) {
    const evaluatedAt = Date.now();
    const recommendations = [];

    // Safely execute all evaluators in isolation
    for (const [providerId, evaluator] of this.evaluators.entries()) {
      try {
        const result = evaluator.evaluate(report);
        if (result && typeof result === 'object') {
          recommendations.push(result);
        }
      } catch (err) {
        recommendations.push(createPlatformRecommendation({
          providerId,
          suitability: SUITABILITY.INCOMPATIBLE,
          score: 0,
          confidence: CONFIDENCE.LOW,
          reasons: [`Evaluator error: ${err.message || 'Unknown evaluation failure'}`],
        }));
      }
    }

    // Sort recommendations deterministically:
    // 1. Suitability tier (EXCELLENT > GOOD > CONDITIONAL > POOR > INCOMPATIBLE)
    // 2. Score (descending)
    // 3. Confidence (HIGH > MEDIUM > LOW)
    recommendations.sort((a, b) => {
      const suitDiff = (SUITABILITY_WEIGHTS[b.suitability] || 0) - (SUITABILITY_WEIGHTS[a.suitability] || 0);
      if (suitDiff !== 0) return suitDiff;

      const scoreDiff = (b.score || 0) - (a.score || 0);
      if (scoreDiff !== 0) return scoreDiff;

      return (CONFIDENCE_WEIGHTS[b.confidence] || 0) - (CONFIDENCE_WEIGHTS[a.confidence] || 0);
    });

    const topMatch = recommendations.find((r) => r.suitability === SUITABILITY.EXCELLENT || r.suitability === SUITABILITY.GOOD);
    const recommendedProvider = topMatch ? topMatch.providerId : (recommendations[0]?.providerId || null);

    return {
      evaluatedAt,
      recommendedProvider,
      recommendations,
    };
  }
}

const platformCompatibilityEngine = new PlatformCompatibilityEngine();

module.exports = {
  PlatformCompatibilityEngine,
  platformCompatibilityEngine,
};
