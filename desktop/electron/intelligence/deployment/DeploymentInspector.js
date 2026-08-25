/**
 * NEXUS INTELLIGENCE LAYER — DEPLOYMENT INSPECTOR (Phase 1)
 * 
 * Orchestrator for deterministic workspace deployment inspection:
 * 1. Validates workspace directory boundary.
 * 2. Runs ProjectDetector for manifests, runtimes, frameworks, and entry points.
 * 3. Runs RuleEngine for port bindings, missing build/start commands, DB persistence risks.
 * 4. Assembles, sanitizes, and normalizes a structured DeploymentReport.
 * 
 * STRICT INVARIANTS:
 * - 100% deterministic, 0 API/LLM tokens consumed.
 * - Non-destructive and strictly read-only.
 * - Never leaks secret credentials or connection string passwords.
 */

const fs = require('fs');
const path = require('path');
const { projectDetector: defaultProjectDetector } = require('./ProjectDetector');
const { ruleEngine: defaultRuleEngine } = require('./RuleEngine');
const { platformCompatibilityEngine: defaultPlatformCompatibilityEngine } = require('./PlatformCompatibilityEngine');
const {
  DEPLOYMENT_STATUS,
  createDeploymentReport,
} = require('./DeploymentReport');

class DeploymentInspector {
  constructor(options = {}) {
    this.projectDetector = options.projectDetector || defaultProjectDetector;
    this.ruleEngine = options.ruleEngine || defaultRuleEngine;
    this.platformCompatibilityEngine = options.platformCompatibilityEngine || defaultPlatformCompatibilityEngine;
  }

  /**
   * Inspects a workspace and generates a complete Deployment Report
   * @param {string} workspacePath - Absolute path to workspace root
   * @param {Object} [options]
   * @returns {Promise<Object>} DeploymentReport
   */
  async inspectWorkspace(workspacePath, options = {}) {
    if (!workspacePath || typeof workspacePath !== 'string') {
      return createDeploymentReport({
        workspacePath: '',
        overallStatus: DEPLOYMENT_STATUS.UNKNOWN,
        summary: 'Invalid workspace path provided for deployment inspection.',
        findings: [],
        platformRecommendations: [],
      });
    }

    const normWorkspace = path.resolve(workspacePath);
    if (!fs.existsSync(normWorkspace)) {
      return createDeploymentReport({
        workspacePath: normWorkspace,
        overallStatus: DEPLOYMENT_STATUS.UNKNOWN,
        summary: `Workspace directory does not exist: ${normWorkspace}`,
        findings: [],
        platformRecommendations: [],
      });
    }

    // 1. Run deterministic project detector
    const detectionResult = this.projectDetector.inspect(normWorkspace);
    if (!detectionResult.valid) {
      return createDeploymentReport({
        workspacePath: normWorkspace,
        overallStatus: DEPLOYMENT_STATUS.UNKNOWN,
        summary: detectionResult.error || 'Failed to detect project structure.',
        findings: [],
        platformRecommendations: [],
      });
    }

    // 2. Run deterministic rule engine
    const findings = this.ruleEngine.evaluate(detectionResult);

    // 3. Assemble base deployment report
    const baseReport = createDeploymentReport({
      workspacePath: normWorkspace,
      inspectedAt: Date.now(),
      project: detectionResult.project,
      frontend: detectionResult.frontend,
      backend: detectionResult.backend,
      database: detectionResult.database,
      findings,
      environmentVariables: detectionResult.environmentVariables,
    });

    // 4. Run deterministic platform compatibility engine
    const compatResult = this.platformCompatibilityEngine.evaluate(baseReport);
    baseReport.recommendedProvider = compatResult.recommendedProvider;
    baseReport.platformRecommendations = compatResult.recommendations;

    return baseReport;
  }
}

const deploymentInspector = new DeploymentInspector();

module.exports = {
  DeploymentInspector,
  deploymentInspector,
};
