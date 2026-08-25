/**
 * NEXUS INTELLIGENCE LAYER — SIMULATION REPORT SCHEMA (Phase 6)
 * 
 * Defines structured schema, scenario types, analysis modes, and validation builders
 * for the Future Bug Simulator.
 */

const crypto = require('crypto');

/**
 * 12 Deterministic Scenario Classes
 */
const SCENARIO_TYPES = {
  HIGH_TRAFFIC: 'HIGH_TRAFFIC',
  SLOW_DATABASE: 'SLOW_DATABASE',
  DATABASE_UNAVAILABLE: 'DATABASE_UNAVAILABLE',
  EXPIRED_AUTH_TOKEN: 'EXPIRED_AUTH_TOKEN',
  INVALID_INPUT: 'INVALID_INPUT',
  NULL_OR_MISSING_DATA: 'NULL_OR_MISSING_DATA',
  CONCURRENT_UPDATE: 'CONCURRENT_UPDATE',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  DEPENDENCY_UNAVAILABLE: 'DEPENDENCY_UNAVAILABLE',
  EXTERNAL_API_FAILURE: 'EXTERNAL_API_FAILURE',
  RATE_LIMIT: 'RATE_LIMIT',
  RETRY_DUPLICATION: 'RETRY_DUPLICATION',
  UNKNOWN: 'UNKNOWN',
};

/**
 * 3 Explicit Analysis Modes
 */
const SIMULATION_MODES = {
  STATIC_FORECAST: 'STATIC_FORECAST',
  SANDBOX_SIMULATION: 'SANDBOX_SIMULATION',
  HEURISTIC_INFERENCE: 'HEURISTIC_INFERENCE',
};

/**
 * Report Status
 */
const SIMULATION_STATUS = {
  VERIFIED: 'VERIFIED',
  PREDICTED: 'PREDICTED',
  INCONCLUSIVE: 'INCONCLUSIVE',
};

/**
 * Severity Tiers
 */
const SIMULATION_SEVERITY = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
};

/**
 * Confidence Tiers
 */
const SIMULATION_CONFIDENCE = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
};

/**
 * Generates a unique simulation identifier
 * @returns {string}
 */
function generateSimulationId() {
  const hash = crypto.randomBytes(4).toString('hex');
  return `sim_${Date.now().toString(36)}_${hash}`;
}

/**
 * Creates and validates a FutureBugSimulationReport struct
 * 
 * @param {Object} input
 * @returns {Object} FutureBugSimulationReport
 */
function createSimulationReport(input = {}) {
  const simulationId = input.simulationId || generateSimulationId();
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  const scenarioType = input.scenarioType || SCENARIO_TYPES.UNKNOWN;
  
  const mode = input.mode || SIMULATION_MODES.STATIC_FORECAST;
  const status = input.status || (
    mode === SIMULATION_MODES.SANDBOX_SIMULATION
      ? SIMULATION_STATUS.VERIFIED
      : mode === SIMULATION_MODES.HEURISTIC_INFERENCE
      ? SIMULATION_STATUS.INCONCLUSIVE
      : SIMULATION_STATUS.PREDICTED
  );

  const summary = input.summary || 'Simulation completed.';
  const affectedFiles = Array.isArray(input.affectedFiles) ? [...new Set(input.affectedFiles)] : [];
  const affectedSymbols = Array.isArray(input.affectedSymbols) ? [...new Set(input.affectedSymbols)] : [];
  
  const likelyFailurePoints = Array.isArray(input.likelyFailurePoints)
    ? input.likelyFailurePoints.map((fp) => ({
        file: fp.file || (affectedFiles[0] || 'Unknown'),
        symbol: fp.symbol || undefined,
        line: typeof fp.line === 'number' ? fp.line : undefined,
        description: fp.description || 'Potential failure point',
        risk: fp.risk || SIMULATION_SEVERITY.MEDIUM,
      }))
    : [];

  const expectedBehavior = input.expectedBehavior || 'System processes request under baseline conditions.';
  const failureBehavior = input.failureBehavior || 'Behavior under simulated fault conditions.';
  
  const severity = input.severity || SIMULATION_SEVERITY.MEDIUM;
  let confidence = input.confidence || SIMULATION_CONFIDENCE.MEDIUM;

  // Invariant: Heuristic inference confidence cannot exceed MEDIUM unless supported by hard evidence
  if (mode === SIMULATION_MODES.HEURISTIC_INFERENCE && confidence === SIMULATION_CONFIDENCE.HIGH) {
    confidence = SIMULATION_CONFIDENCE.MEDIUM;
  }

  const evidence = Array.isArray(input.evidence)
    ? input.evidence.map((ev) => ({
        type: ev.type || 'observation',
        source: ev.source || 'STATIC_ANALYSIS',
        description: ev.description || String(ev),
        provenance: ev.provenance || undefined,
      }))
    : [];

  const observedResults = Array.isArray(input.observedResults)
    ? input.observedResults.map((obs) => ({
        executionMethod: obs.executionMethod || 'local_sandbox_runner',
        exitCode: typeof obs.exitCode === 'number' ? obs.exitCode : 0,
        stdout: obs.stdout || '',
        stderr: obs.stderr || '',
        failingTests: Array.isArray(obs.failingTests) ? obs.failingTests : [],
        passed: Boolean(obs.passed),
        durationMs: typeof obs.durationMs === 'number' ? obs.durationMs : 0,
      }))
    : [];

  const suggestedTests = Array.isArray(input.suggestedTests)
    ? input.suggestedTests
    : [];

  const assumptions = Array.isArray(input.assumptions)
    ? input.assumptions
    : [];

  const limitations = Array.isArray(input.limitations)
    ? input.limitations
    : [];

  return {
    simulationId,
    question,
    scenarioType,
    mode,
    status,
    summary,
    affectedFiles,
    affectedSymbols,
    likelyFailurePoints,
    expectedBehavior,
    failureBehavior,
    severity,
    confidence,
    evidence,
    observedResults,
    suggestedTests,
    assumptions,
    limitations,
    createdAt: input.createdAt || Date.now(),
  };
}

module.exports = {
  SCENARIO_TYPES,
  SIMULATION_MODES,
  SIMULATION_STATUS,
  SIMULATION_SEVERITY,
  SIMULATION_CONFIDENCE,
  generateSimulationId,
  createSimulationReport,
};
