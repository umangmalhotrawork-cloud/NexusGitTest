/**
 * NEXUS INTELLIGENCE LAYER — MODULE ENTRYPOINT (Phase 2 & Phase 4)
 * 
 * Clean module boundary exporting:
 * 1. SoftwareEvidenceLayer (Read-only software intelligence facade)
 * 2. PreflightEstimator / PreflightCostEstimator (Deterministic pre-agent token, cost, tool & scope estimator)
 * 3. BreakageCorrelator (Diagnostic breakage correlation)
 * 4. Type contracts, pricing catalog, and constants
 */

const types = require('./types');
const { SoftwareEvidenceLayer, softwareEvidenceLayer } = require('./SoftwareEvidenceLayer');
const { PreflightEstimator, preflightEstimator } = require('./PreflightEstimator');
const { PreflightCostEstimator, preflightCostEstimator } = require('./PreflightCostEstimator');
const { BreakageCorrelator, breakageCorrelator } = require('./BreakageCorrelator');
const {
  DECISION_STATUS,
  DECISION_CONFIDENCE,
  DECISION_PROVENANCE_SOURCE,
  generateDecisionId,
  createDecisionRecord,
} = require('./DecisionRecord');
const { DecisionReplayEngine, decisionReplayEngine } = require('./DecisionReplayEngine');

const {
  SCENARIO_TYPES,
  SIMULATION_MODES,
  SIMULATION_STATUS,
  SIMULATION_SEVERITY,
  SIMULATION_CONFIDENCE,
  generateSimulationId,
  createSimulationReport,
} = require('./SimulationReport');
const { FutureBugSimulator, futureBugSimulator } = require('./FutureBugSimulator');

module.exports = {
  // Types & Catalog
  ...types,
  types,

  // Software Evidence Layer
  SoftwareEvidenceLayer,
  softwareEvidenceLayer,

  // Preflight Estimator (Phase 4)
  PreflightEstimator,
  preflightEstimator,

  // Preflight Cost Estimator (Phase 2 Compatibility)
  PreflightCostEstimator,
  preflightCostEstimator,

  // Breakage Correlator (Why Did This Break?)
  BreakageCorrelator,
  breakageCorrelator,

  // Decision Replay & Architectural Memory (Phase 5)
  DECISION_STATUS,
  DECISION_CONFIDENCE,
  DECISION_PROVENANCE_SOURCE,
  generateDecisionId,
  createDecisionRecord,
  DecisionReplayEngine,
  decisionReplayEngine,

  // Future Bug Simulator (Phase 6)
  SCENARIO_TYPES,
  SIMULATION_MODES,
  SIMULATION_STATUS,
  SIMULATION_SEVERITY,
  SIMULATION_CONFIDENCE,
  generateSimulationId,
  createSimulationReport,
  FutureBugSimulator,
  futureBugSimulator,
};
