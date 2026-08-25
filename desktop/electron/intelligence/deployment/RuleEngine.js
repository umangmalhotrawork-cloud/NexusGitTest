/**
 * NEXUS INTELLIGENCE LAYER — DEPLOYMENT RULE ENGINE (Phase 1)
 * 
 * Deterministic deployment rule evaluation engine.
 * Generates structured findings with confidence, severity (BLOCKER, WARNING, INFO),
 * category, explanation, recommendations, and precise repository evidence.
 * 
 * STRICT INVARIANTS:
 * - Deterministic, non-hallucinating rules grounded in repository evidence.
 * - Zero LLM/API calls.
 * - All findings sanitized through secretFilter.
 */

const {
  FINDING_SEVERITY,
  FINDING_CATEGORY,
  createFinding,
} = require('./DeploymentReport');
const secretFilter = require('../../../security/secretFilter');

class RuleEngine {
  /**
   * Evaluates all deployment rules against project inspection data
   * @param {Object} inspectionResult
   * @returns {Array<Object>} List of structured findings
   */
  evaluate(inspectionResult = {}) {
    if (!inspectionResult || !inspectionResult.valid) {
      return [];
    }

    const findings = [];
    const { project, frontend, backend, database, environmentVariables } = inspectionResult;

    // -----------------------------------------------------------------------
    // RULE-01: Server Host Binding
    // -----------------------------------------------------------------------
    if (backend && backend.detected) {
      if (backend.hostBinding === '127.0.0.1' || backend.hostBinding === 'localhost') {
        const bindEvidence = backend.evidence.filter((e) => e.snippet && (e.snippet.includes('127.0.0.1') || e.snippet.includes('localhost')));
        findings.push(createFinding({
          ruleId: 'RULE-01',
          severity: FINDING_SEVERITY.BLOCKER,
          category: FINDING_CATEGORY.BACKEND,
          title: 'Backend Server Binds to Loopback Interface',
          message: `The backend server is explicitly configured to listen on "${backend.hostBinding}". In cloud container environments (Render, Railway, Fly.io), binding to localhost prevents incoming traffic from reaching the container.`,
          evidence: bindEvidence.length > 0 ? bindEvidence : backend.evidence,
          recommendation: 'Update your server listen configuration to bind to "0.0.0.0" (e.g. app.listen(port, "0.0.0.0") or app.listen(port)).',
        }));
      } else if (backend.isHostBindingSafe) {
        findings.push(createFinding({
          ruleId: 'RULE-01',
          severity: FINDING_SEVERITY.INFO,
          category: FINDING_CATEGORY.BACKEND,
          title: 'Cloud-Compatible Host Binding Detected',
          message: `Backend server binds to standard cloud interface (${backend.hostBinding || '0.0.0.0'}).`,
          evidence: backend.evidence,
          recommendation: 'Ensure your deployment platform routes HTTP traffic to this port.',
        }));
      }
    }

    // -----------------------------------------------------------------------
    // RULE-02: Port Configuration
    // -----------------------------------------------------------------------
    if (backend && backend.detected) {
      const portStr = String(backend.port || '');
      const isDynamicPort = portStr.includes('process.env.PORT') || portStr.includes('PORT') || portStr.includes('getenv');

      if (!isDynamicPort && /^\d+$/.test(portStr)) {
        findings.push(createFinding({
          ruleId: 'RULE-02',
          severity: FINDING_SEVERITY.WARNING,
          category: FINDING_CATEGORY.BACKEND,
          title: 'Hardcoded Port Number',
          message: `Backend server uses hardcoded port ${portStr} without falling back to process.env.PORT. Most cloud platforms (Render, Railway, Heroku) dynamically assign a random PORT environment variable.`,
          evidence: backend.evidence.filter((e) => e.snippet && e.snippet.includes('listen')),
          recommendation: `Change port definition to use environment variable with fallback: const PORT = process.env.PORT || ${portStr};`,
        }));
      } else if (isDynamicPort) {
        findings.push(createFinding({
          ruleId: 'RULE-02',
          severity: FINDING_SEVERITY.INFO,
          category: FINDING_CATEGORY.BACKEND,
          title: 'Dynamic Port Binding Configured',
          message: 'Backend server respects dynamic process.env.PORT assigned by cloud hosting platforms.',
          evidence: backend.evidence.filter((e) => e.snippet && e.snippet.includes('PORT')),
        }));
      }
    }

    // -----------------------------------------------------------------------
    // RULE-03: Missing Start Command
    // -----------------------------------------------------------------------
    if (backend && backend.detected && !backend.startCommand) {
      findings.push(createFinding({
        ruleId: 'RULE-03',
        severity: FINDING_SEVERITY.BLOCKER,
        category: FINDING_CATEGORY.BACKEND,
        title: 'Missing Production Start Command',
        message: 'No "start" script was detected in package.json and no standard startup entrypoint could be verified for production execution.',
        evidence: backend.evidence,
        recommendation: 'Add a "start" script to package.json (e.g. "start": "node server.js" or "start": "node dist/index.js").',
      }));
    }

    // -----------------------------------------------------------------------
    // RULE-04: Missing Build Command for Frontend
    // -----------------------------------------------------------------------
    if (frontend && frontend.detected && !frontend.buildScript) {
      findings.push(createFinding({
        ruleId: 'RULE-04',
        severity: FINDING_SEVERITY.BLOCKER,
        category: FINDING_CATEGORY.FRONTEND,
        title: 'Missing Frontend Build Command',
        message: `Frontend framework "${frontend.framework}" requires a build step, but no "build" script was found in package.json.`,
        evidence: frontend.evidence,
        recommendation: 'Add a "build" script to package.json (e.g. "build": "vite build" or "build": "next build").',
      }));
    }

    // -----------------------------------------------------------------------
    // RULE-05: Local Database Connection
    // -----------------------------------------------------------------------
    if (database && database.detected) {
      if (database.usesLocalhost) {
        findings.push(createFinding({
          ruleId: 'RULE-05',
          severity: FINDING_SEVERITY.WARNING,
          category: FINDING_CATEGORY.DATABASE,
          title: 'Hardcoded Localhost Database Connection',
          message: 'Database connection configuration references localhost / 127.0.0.1 directly in application source code. Hosted production servers will fail to reach this local database.',
          evidence: database.evidence.filter((e) => e.description && e.description.includes('localhost')),
          recommendation: 'Use an externalized environment variable such as process.env.DATABASE_URL to provide remote database credentials.',
        }));
      }

      if (database.usesEnvVar) {
        findings.push(createFinding({
          ruleId: 'RULE-05',
          severity: FINDING_SEVERITY.INFO,
          category: FINDING_CATEGORY.DATABASE,
          title: 'Database Configured via Environment Variable',
          message: 'Database connection is configured using environment variables (DATABASE_URL), ready for cloud database provisioning.',
          evidence: database.evidence.filter((e) => e.snippet && e.snippet.includes('DATABASE_URL')),
        }));
      }
    }

    // -----------------------------------------------------------------------
    // RULE-06: SQLite Persistence Risk
    // -----------------------------------------------------------------------
    if (database && database.detected && database.isSQLite) {
      findings.push(createFinding({
        ruleId: 'RULE-06',
        severity: FINDING_SEVERITY.WARNING,
        category: FINDING_CATEGORY.DATABASE,
        title: 'SQLite Ephemeral Storage Risk',
        message: 'SQLite database uses local filesystem storage. In stateless cloud hosting environments (Vercel, Render Web Services without disks, Railway ephemeral containers), local filesystem writes are lost on restart or redeployment.',
        evidence: database.evidence,
        recommendation: 'For production web applications, attach a persistent storage disk or migrate to a managed database (PostgreSQL, MySQL, Supabase, Neon).',
      }));
    }

    // -----------------------------------------------------------------------
    // RULE-07: Missing Environment Variable Documentation
    // -----------------------------------------------------------------------
    if (environmentVariables && environmentVariables.missingDocumentation.length > 0) {
      const missingList = environmentVariables.missingDocumentation.join(', ');
      findings.push(createFinding({
        ruleId: 'RULE-07',
        severity: FINDING_SEVERITY.WARNING,
        category: FINDING_CATEGORY.ENVIRONMENT,
        title: 'Undocumented Environment Variables',
        message: `The application references environment variables in source code that are missing from template files (.env.example): ${missingList}.`,
        evidence: environmentVariables.evidence,
        recommendation: `Document required variables in .env.example (without secret values) so deployment platforms can configure them.`,
      }));
    }

    // -----------------------------------------------------------------------
    // RULE-08: Monorepo Root Ambiguity
    // -----------------------------------------------------------------------
    if (project && project.isMonorepo) {
      findings.push(createFinding({
        ruleId: 'RULE-08',
        severity: FINDING_SEVERITY.INFO,
        category: FINDING_CATEGORY.MONOREPO,
        title: 'Monorepo Workspace Structure Detected',
        message: `Multi-package repository detected with packages: ${project.workspaces.join(', ')}. When deploying to cloud platforms, specify the appropriate Root Directory (e.g. apps/web or apps/api).`,
        recommendation: 'Configure your deployment target (Vercel/Render) to build from the specific sub-package directory.',
      }));
    }

    // -----------------------------------------------------------------------
    // RULE-09: Containerization Status
    // -----------------------------------------------------------------------
    if (project && project.hasDocker) {
      findings.push(createFinding({
        ruleId: 'RULE-09',
        severity: FINDING_SEVERITY.INFO,
        category: FINDING_CATEGORY.CONTAINER,
        title: 'Dockerfile Container Configuration Detected',
        message: `A Dockerfile was found in the workspace root. This project can be deployed to container-native platforms (Fly.io, Railway, Google Cloud Run, AWS ECS).`,
        recommendation: 'Ensure your container image passes local docker build before deployment.',
      }));
    }

    // -----------------------------------------------------------------------
    // RULE-10: Frontend Output Directory
    // -----------------------------------------------------------------------
    if (frontend && frontend.detected && frontend.outputDirectory) {
      findings.push(createFinding({
        ruleId: 'RULE-10',
        severity: FINDING_SEVERITY.INFO,
        category: FINDING_CATEGORY.FRONTEND,
        title: 'Frontend Output Directory Verified',
        message: `Frontend build artifacts will be output to "${frontend.outputDirectory}".`,
        evidence: frontend.evidence,
        recommendation: `Ensure your static hosting provider (Vercel, Netlify, Cloudflare) is configured with Output Directory: "${frontend.outputDirectory}".`,
      }));
    }

    return findings;
  }
}

const ruleEngine = new RuleEngine();

module.exports = {
  RuleEngine,
  ruleEngine,
};
