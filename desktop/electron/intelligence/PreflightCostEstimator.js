/**
 * NEXUS INTELLIGENCE LAYER — PREFLIGHT COST ESTIMATOR (Phase 2 & Phase 4 Compatibility Facade)
 * 
 * Provides backward-compatible preflight cost estimation interface delegating to
 * the authoritative PreflightEstimator.
 */

const { PreflightEstimator, preflightEstimator } = require('./PreflightEstimator');
const { BUDGET_STATUS, CONFIDENCE_LEVELS, getModelPricing } = require('./types');

class PreflightCostEstimator extends PreflightEstimator {
  // Inherits full deterministic token, cost, file, tool, risk and confidence estimation
}

const preflightCostEstimator = new PreflightCostEstimator();

module.exports = {
  PreflightEstimator,
  preflightEstimator,
  PreflightCostEstimator,
  preflightCostEstimator,
};
