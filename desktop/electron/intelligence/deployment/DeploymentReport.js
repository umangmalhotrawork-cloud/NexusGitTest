/**
 * NEXUS INTELLIGENCE LAYER — DEPLOYMENT REPORT (Phase 1)
 * 
 * Defines structured schemas, severity levels, status enums, and normalization
 * builders for the Deployment Intelligence subsystem.
 * 
 * STRICT INVARIANTS:
 * - 100% deterministic and serializable.
 * - Zero secrets or credential values (all strings sanitized).
 * - Full evidence traceability (file path, line, column, snippet).
 */

const crypto = require('crypto');
const secretFilter = require('../../../security/secretFilter');

/**
 * Deployment Readiness Status
 */
const DEPLOYMENT_STATUS = Object.freeze({
  READY: 'READY',
  WARNING: 'WARNING',
  BLOCKED: 'BLOCKED',
  UNKNOWN: 'UNKNOWN',
});

/**
 * Finding Severity
 */
const FINDING_SEVERITY = Object.freeze({
  BLOCKER: 'BLOCKER',
  WARNING: 'WARNING',
  INFO: 'INFO',
});

/**
 * Finding Category
 */
const FINDING_CATEGORY = Object.freeze({
  FRONTEND: 'FRONTEND',
  BACKEND: 'BACKEND',
  DATABASE: 'DATABASE',
  ENVIRONMENT: 'ENVIRONMENT',
  MONOREPO: 'MONOREPO',
  CONTAINER: 'CONTAINER',
  GENERAL: 'GENERAL',
});

/**
 * Generates a unique finding ID
 * @param {string} prefix
 * @returns {string}
 */
function generateFindingId(prefix = 'fnd') {
  const hash = crypto.randomBytes(3).toString('hex');
  return `${prefix}_${Date.now().toString(36)}_${hash}`;
}

/**
 * Normalizes an evidence item
 * @param {Object} ev
 * @returns {Object}
 */
function normalizeEvidence(ev = {}) {
  return {
    file: secretFilter.sanitizeString(typeof ev.file === 'string' ? ev.file : (ev.filePath || '')),
    line: typeof ev.line === 'number' && !isNaN(ev.line) ? ev.line : undefined,
    column: typeof ev.column === 'number' && !isNaN(ev.column) ? ev.column : undefined,
    snippet: ev.snippet ? secretFilter.sanitizeString(String(ev.snippet).trim()) : undefined,
    description: ev.description ? secretFilter.sanitizeString(String(ev.description).trim()) : undefined,
  };
}

/**
 * Creates a structured deployment finding
 * @param {Object} input
 * @returns {Object}
 */
function createFinding(input = {}) {
  const id = input.id || generateFindingId(input.ruleId ? input.ruleId.toLowerCase().replace(/[^a-z0-9]/g, '_') : 'fnd');
  const severity = input.severity || FINDING_SEVERITY.INFO;
  const category = input.category || FINDING_CATEGORY.GENERAL;
  const title = secretFilter.sanitizeString(String(input.title || 'Deployment Finding').trim());
  const message = secretFilter.sanitizeString(String(input.message || '').trim());
  const recommendation = input.recommendation
    ? secretFilter.sanitizeString(String(input.recommendation).trim())
    : undefined;

  let evidence = [];
  if (Array.isArray(input.evidence)) {
    evidence = input.evidence.map(normalizeEvidence).filter((e) => e.file || e.description || e.snippet);
  } else if (input.evidence && typeof input.evidence === 'object') {
    evidence = [normalizeEvidence(input.evidence)];
  }

  return {
    id,
    ruleId: input.ruleId ? String(input.ruleId).trim() : undefined,
    severity,
    category,
    title,
    message,
    evidence,
    recommendation,
  };
}

/**
 * Normalizes frontend metadata descriptor
 * @param {Object} input
 * @returns {Object|null}
 */
function normalizeFrontendDescriptor(input = null) {
  if (!input || typeof input !== 'object' || !input.detected) return null;
  return {
    detected: true,
    framework: input.framework || null,
    runtime: input.runtime || 'browser',
    packageManager: input.packageManager || null,
    buildScript: input.buildScript || null,
    outputDirectory: input.outputDirectory || null,
    isStaticExport: Boolean(input.isStaticExport),
    isSSR: Boolean(input.isSSR),
    status: input.status || DEPLOYMENT_STATUS.UNKNOWN,
    path: input.path || null,
    evidence: Array.isArray(input.evidence) ? input.evidence.map(normalizeEvidence) : [],
  };
}

/**
 * Normalizes backend metadata descriptor
 * @param {Object} input
 * @returns {Object|null}
 */
function normalizeBackendDescriptor(input = null) {
  if (!input || typeof input !== 'object' || !input.detected) return null;
  return {
    detected: true,
    framework: input.framework || null,
    runtime: input.runtime || 'node',
    entryPoint: input.entryPoint || null,
    startCommand: input.startCommand || null,
    buildScript: input.buildScript || null,
    port: input.port !== undefined && input.port !== null ? input.port : null,
    hostBinding: input.hostBinding || 'UNKNOWN',
    isHostBindingSafe: input.isHostBindingSafe !== undefined ? Boolean(input.isHostBindingSafe) : false,
    status: input.status || DEPLOYMENT_STATUS.UNKNOWN,
    path: input.path || null,
    evidence: Array.isArray(input.evidence) ? input.evidence.map(normalizeEvidence) : [],
  };
}

/**
 * Normalizes database metadata descriptor
 * @param {Object} input
 * @returns {Object|null}
 */
function normalizeDatabaseDescriptor(input = null) {
  if (!input || typeof input !== 'object' || !input.detected) return null;
  return {
    detected: true,
    technology: input.technology || null,
    ormOrDriver: input.ormOrDriver || null,
    configFile: input.configFile || null,
    migrationStatus: input.migrationStatus || 'unknown',
    usesLocalhost: Boolean(input.usesLocalhost),
    usesEnvVar: Boolean(input.usesEnvVar),
    isSQLite: Boolean(input.isSQLite),
    isEphemeralStorageRisk: Boolean(input.isEphemeralStorageRisk),
    status: input.status || DEPLOYMENT_STATUS.UNKNOWN,
    evidence: Array.isArray(input.evidence) ? input.evidence.map(normalizeEvidence) : [],
  };
}

/**
 * Computes overall status from findings and subsystem statuses
 * @param {Array} findings
 * @param {Object} subsystems
 * @returns {string} DEPLOYMENT_STATUS
 */
function computeOverallStatus(findings = [], subsystems = {}) {
  const hasBlocker = findings.some((f) => f.severity === FINDING_SEVERITY.BLOCKER);
  if (hasBlocker) return DEPLOYMENT_STATUS.BLOCKED;

  const hasSubsystemBlocked = Object.values(subsystems).some(
    (s) => s && s.detected && s.status === DEPLOYMENT_STATUS.BLOCKED
  );
  if (hasSubsystemBlocked) return DEPLOYMENT_STATUS.BLOCKED;

  const hasWarning = findings.some((f) => f.severity === FINDING_SEVERITY.WARNING);
  if (hasWarning) return DEPLOYMENT_STATUS.WARNING;

  const hasSubsystemWarning = Object.values(subsystems).some(
    (s) => s && s.detected && s.status === DEPLOYMENT_STATUS.WARNING
  );
  if (hasSubsystemWarning) return DEPLOYMENT_STATUS.WARNING;

  const hasAnyDetected = Object.values(subsystems).some((s) => s && s.detected);
  if (!hasAnyDetected) return DEPLOYMENT_STATUS.UNKNOWN;

  return DEPLOYMENT_STATUS.READY;
}

/**
 * Creates and normalizes a complete Deployment Report
 * @param {Object} input
 * @returns {Object} DeploymentReport
 */
function createDeploymentReport(input = {}) {
  const workspacePath = input.workspacePath || '';
  const inspectedAt = typeof input.inspectedAt === 'number' ? input.inspectedAt : Date.now();

  const project = {
    isMonorepo: Boolean(input.project?.isMonorepo),
    workspaces: Array.isArray(input.project?.workspaces) ? input.project.workspaces : [],
    packageManager: input.project?.packageManager || null,
    hasDocker: Boolean(input.project?.hasDocker),
    dockerfile: input.project?.dockerfile || null,
    dockerCompose: input.project?.dockerCompose || null,
  };

  const frontend = normalizeFrontendDescriptor(input.frontend);
  const backend = normalizeBackendDescriptor(input.backend);
  const database = normalizeDatabaseDescriptor(input.database);

  const findings = Array.isArray(input.findings)
    ? input.findings.map(createFinding)
    : [];

  const environmentVariables = {
    required: Array.isArray(input.environmentVariables?.required)
      ? [...new Set(input.environmentVariables.required.map((v) => secretFilter.sanitizeString(v).trim()))]
      : [],
    documented: Array.isArray(input.environmentVariables?.documented)
      ? [...new Set(input.environmentVariables.documented.map((v) => secretFilter.sanitizeString(v).trim()))]
      : [],
    missingDocumentation: Array.isArray(input.environmentVariables?.missingDocumentation)
      ? [...new Set(input.environmentVariables.missingDocumentation.map((v) => secretFilter.sanitizeString(v).trim()))]
      : [],
    evidence: Array.isArray(input.environmentVariables?.evidence)
      ? input.environmentVariables.evidence.map(normalizeEvidence)
      : [],
  };

  const overallStatus = input.overallStatus || computeOverallStatus(findings, { frontend, backend, database });

  const summary = input.summary || (
    overallStatus === DEPLOYMENT_STATUS.READY
      ? 'Project is ready for cloud deployment with verified configurations.'
      : overallStatus === DEPLOYMENT_STATUS.WARNING
      ? `Project has ${findings.filter((f) => f.severity === FINDING_SEVERITY.WARNING).length} warning(s) that should be reviewed prior to deployment.`
      : overallStatus === DEPLOYMENT_STATUS.BLOCKED
      ? `Project has ${findings.filter((f) => f.severity === FINDING_SEVERITY.BLOCKER).length} blocker(s) preventing successful cloud deployment.`
      : 'Insufficient repository evidence to determine complete deployment readiness.'
  );

  const platformRecommendations = Array.isArray(input.platformRecommendations)
    ? input.platformRecommendations
    : [];
  const recommendedProvider = input.recommendedProvider || null;

  return {
    workspacePath: secretFilter.sanitizeString(workspacePath),
    inspectedAt,
    overallStatus,
    summary: secretFilter.sanitizeString(summary),
    project,
    frontend,
    backend,
    database,
    findings,
    environmentVariables,
    recommendedProvider,
    platformRecommendations,
  };
}

module.exports = {
  DEPLOYMENT_STATUS,
  FINDING_SEVERITY,
  FINDING_CATEGORY,
  generateFindingId,
  normalizeEvidence,
  createFinding,
  createDeploymentReport,
};
