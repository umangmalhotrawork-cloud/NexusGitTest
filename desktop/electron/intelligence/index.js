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

const {
  DEPLOYMENT_STATUS,
  FINDING_SEVERITY,
  FINDING_CATEGORY,
  generateFindingId,
  createFinding,
  createDeploymentReport,
} = require('./deployment/DeploymentReport');
const { ProjectDetector, projectDetector } = require('./deployment/ProjectDetector');
const { RuleEngine, ruleEngine } = require('./deployment/RuleEngine');
const { DeploymentInspector, deploymentInspector } = require('./deployment/DeploymentInspector');

const {
  SUITABILITY,
  CONFIDENCE: RECOMMENDATION_CONFIDENCE,
  PROVIDER_IDS,
  PROVIDER_DISPLAY_NAMES,
  COMPUTE_SERVICE_TYPE,
  DATABASE_STRATEGY,
  scoreToSuitability,
  createPlatformRecommendation,
} = require('./deployment/PlatformRecommendation');
const {
  PlatformCompatibilityEngine,
  platformCompatibilityEngine,
} = require('./deployment/PlatformCompatibilityEngine');

const VercelConfigGenerator = require('./deployment/config/VercelConfigGenerator');
const RenderConfigGenerator = require('./deployment/config/RenderConfigGenerator');
const RailwayConfigGenerator = require('./deployment/config/RailwayConfigGenerator');
const FlyIoConfigGenerator = require('./deployment/config/FlyIoConfigGenerator');
const NetlifyConfigGenerator = require('./deployment/config/NetlifyConfigGenerator');
const DockerConfigGenerator = require('./deployment/config/DockerConfigGenerator');
const {
  DeploymentConfigEngine,
  deploymentConfigEngine,
} = require('./deployment/config/DeploymentConfigEngine');

const {
  DeploymentCredentialStore,
  deploymentCredentialStore,
} = require('./deployment/credentials/DeploymentCredentialStore');
const {
  DEPLOYMENT_STATES,
  DeploymentExecutor,
  deploymentExecutor,
} = require('./deployment/execution/DeploymentExecutor');
const VercelDeployAdapter = require('./deployment/execution/providers/VercelDeployAdapter');

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

  // Deployment Intelligence (Phase 1)
  DEPLOYMENT_STATUS,
  FINDING_SEVERITY,
  FINDING_CATEGORY,
  generateFindingId,
  createFinding,
  createDeploymentReport,
  ProjectDetector,
  projectDetector,
  RuleEngine,
  ruleEngine,
  DeploymentInspector,
  deploymentInspector,

  // Platform Compatibility (Phase 2A)
  SUITABILITY,
  RECOMMENDATION_CONFIDENCE,
  PROVIDER_IDS,
  PROVIDER_DISPLAY_NAMES,
  COMPUTE_SERVICE_TYPE,
  DATABASE_STRATEGY,
  scoreToSuitability,
  createPlatformRecommendation,
  PlatformCompatibilityEngine,
  platformCompatibilityEngine,

  // Deployment Configuration Preview & Generation (Phase 2C)
  VercelConfigGenerator,
  RenderConfigGenerator,
  RailwayConfigGenerator,
  FlyIoConfigGenerator,
  NetlifyConfigGenerator,
  DockerConfigGenerator,
  DeploymentConfigEngine,
  deploymentConfigEngine,

  // Deployment Credentials & Execution (Phase 3A)
  DeploymentCredentialStore,
  deploymentCredentialStore,
  DEPLOYMENT_STATES,
  DeploymentExecutor,
  deploymentExecutor,
  VercelDeployAdapter,
};
