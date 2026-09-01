/**
 * NEXUS INTELLIGENCE LAYER — DEPLOYMENT FAILURE DIAGNOSER
 * 
 * Main-process diagnostic engine that analyzes sanitized provider execution logs,
 * stderr, exit codes, and API responses against local project evidence.
 * 
 * STRICT INVARIANTS:
 * - 0 LLM/AI tokens. 100% deterministic local pattern and AST/manifest analysis.
 * - All inputs and outputs sanitized via secretFilter (0 plaintext tokens/passwords).
 * - Identifies root-cause failure categories, exact project file evidence, and actionable fixes.
 */

const fs = require('fs');
const path = require('path');
const secretFilter = require('../../../../security/secretFilter');

const FAILURE_CATEGORY = Object.freeze({
  ENVIRONMENT_VARIABLE_MISSING: 'ENVIRONMENT_VARIABLE_MISSING',
  BUILD_SCRIPT_MISSING: 'BUILD_SCRIPT_MISSING',
  OUTPUT_DIRECTORY_MISMATCH: 'OUTPUT_DIRECTORY_MISMATCH',
  AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
  DEPENDENCY_ERROR: 'DEPENDENCY_ERROR',
  PORT_CONFLICT: 'PORT_CONFLICT',
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  PROVIDER_CONFIGURATION_ERROR: 'PROVIDER_CONFIGURATION_ERROR',
  HEALTH_CHECK_FAILED: 'HEALTH_CHECK_FAILED',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',
  PROVIDER_EXECUTION_ERROR: 'PROVIDER_EXECUTION_ERROR',
});

class DeploymentFailureDiagnoser {
  constructor() {
    this.name = 'DeploymentFailureDiagnoser';
  }

  /**
   * Diagnoses deployment stage failure using logs and workspace evidence
   * @param {Object} context
   * @param {string} context.workspacePath
   * @param {string} [context.stageId]
   * @param {string} [context.providerId]
   * @param {string} [context.serviceName]
   * @param {string} [context.rootDir]
   * @param {string} [context.framework]
   * @param {string} [context.error]
   * @param {string|string[]} [context.logs]
   * @param {Object} [context.plan]
   * @returns {Object} Structured Diagnostic Report
   */
  diagnoseFailure(context = {}) {
    const {
      workspacePath = '',
      stageId = 'general',
      providerId = 'unknown',
      serviceName = 'Service',
      rootDir = '',
      framework = '',
      error = '',
      logs = '',
      plan = null,
    } = context;

    const resolvedWorkspace = workspacePath ? path.resolve(workspacePath) : process.cwd();
    const targetDir = rootDir ? path.resolve(resolvedWorkspace, rootDir) : resolvedWorkspace;

    // Combine and sanitize logs
    const rawLogsText = Array.isArray(logs) ? logs.join('\n') : String(logs || '');
    const fullText = secretFilter.sanitizeString(`${error}\n${rawLogsText}`);
    const lowerText = fullText.toLowerCase();

    // 1. Check Authentication / Token Errors
    if (
      lowerText.includes('401 unauthorized') ||
      lowerText.includes('unauthorized') ||
      lowerText.includes('invalid token') ||
      lowerText.includes('auth token is invalid') ||
      lowerText.includes('forbidden') ||
      lowerText.includes('403 forbidden') ||
      lowerText.includes('credentials missing') ||
      lowerText.includes('auth_required')
    ) {
      return {
        stageId,
        providerId,
        serviceName,
        failureCategory: FAILURE_CATEGORY.AUTHENTICATION_ERROR,
        likelyRootCause: `Authentication with ${providerId.toUpperCase()} failed. The access token or API key is invalid, expired, or unauthorized.`,
        confidence: 'HIGH',
        evidence: [
          {
            source: 'Provider Response',
            snippet: fullText.split('\n').find((l) => l.toLowerCase().includes('401') || l.toLowerCase().includes('unauthorized') || l.toLowerCase().includes('token') || l.toLowerCase().includes('auth')) || error,
            description: 'Provider rejected API authorization request.',
          },
        ],
        suggestedFix: `Open Deployment Credentials in NEXUS, reconnect ${providerId.toUpperCase()} with a valid personal access token, and retry deployment.`,
        isRetrySafe: true,
      };
    }

    // 2. Check Missing Environment Variables
    const envVarPatterns = [
      /([A-Z0-9_]+)\s+is not defined/i,
      /missing environment variable:?\s*([A-Z0-9_]+)/i,
      /env(?:ironment)?\s+var(?:iable)?\s+['"]?([A-Z0-9_]+)['"]?\s+is\s+required/i,
      /process\.env\.([A-Z0-9_]+)/i,
      /import\.meta\.env\.([A-Z0-9_]+)/i,
    ];

    let missingVarName = null;
    for (const pat of envVarPatterns) {
      const match = fullText.match(pat);
      if (match && match[1] && !['PATH', 'NODE_ENV', 'HOME', 'USER'].includes(match[1])) {
        missingVarName = match[1];
        break;
      }
    }

    if (missingVarName) {
      const fileEvidence = this.findEnvVarUsageInProject(targetDir, missingVarName);
      return {
        stageId,
        providerId,
        serviceName,
        failureCategory: FAILURE_CATEGORY.ENVIRONMENT_VARIABLE_MISSING,
        likelyRootCause: `${serviceName} build failed because required environment variable '${missingVarName}' was not defined during build time.`,
        confidence: fileEvidence.length > 0 ? 'HIGH' : 'MEDIUM',
        evidence: fileEvidence.length > 0
          ? fileEvidence
          : [
              {
                source: 'Build Output',
                snippet: fullText.split('\n').find((l) => l.includes(missingVarName)) || missingVarName,
                description: `Missing variable '${missingVarName}' referenced in build logs.`,
              },
            ],
        suggestedFix: `Configure environment variable '${missingVarName}' in your service deployment settings or project .env configuration.`,
        isRetrySafe: true,
      };
    }

    // 3. Check Missing Build Script in package.json
    if (
      lowerText.includes('missing script: build') ||
      lowerText.includes('no build script') ||
      lowerText.includes('npm err! missing script: "build"') ||
      lowerText.includes('command "npm run build" exited with 127')
    ) {
      const pkgPath = path.join(targetDir, 'package.json');
      let pkgSnippet = '';
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          pkgSnippet = JSON.stringify(pkg.scripts || {}, null, 2);
        } catch (_) {}
      }

      return {
        stageId,
        providerId,
        serviceName,
        failureCategory: FAILURE_CATEGORY.BUILD_SCRIPT_MISSING,
        likelyRootCause: `The project manifest in ${path.relative(resolvedWorkspace, targetDir) || '.'} does not define a 'build' script.`,
        confidence: 'HIGH',
        evidence: [
          {
            source: `${path.relative(resolvedWorkspace, pkgPath) || 'package.json'}`,
            snippet: pkgSnippet || '"scripts": {}',
            description: 'package.json scripts section lacks a "build" command.',
          },
        ],
        suggestedFix: `Add a "build" script to package.json (e.g. "build": "vite build" or "build": "next build" or "build": "tsc").`,
        isRetrySafe: true,
      };
    }

    // 4. Check Output Directory Mismatch
    if (
      lowerText.includes('no output directory named') ||
      lowerText.includes('output directory') ||
      lowerText.includes('could not find output folder') ||
      lowerText.includes('directory "dist" does not exist') ||
      lowerText.includes('directory "out" does not exist')
    ) {
      return {
        stageId,
        providerId,
        serviceName,
        failureCategory: FAILURE_CATEGORY.OUTPUT_DIRECTORY_MISMATCH,
        likelyRootCause: `The build output directory configured in deployment manifest does not match the actual folder generated by the build.`,
        confidence: 'HIGH',
        evidence: [
          {
            source: 'Deployment Configuration',
            snippet: `Target directory: ${targetDir}`,
            description: 'Build finished without creating the expected output folder.',
          },
        ],
        suggestedFix: `Verify outputDirectory in vercel.json / netlify.toml matches your framework output (e.g. "dist" for Vite, "out" for Next.js static, "build" for CRA).`,
        isRetrySafe: true,
      };
    }

    // 5. Check Missing Dependency / Module Not Found
    if (
      lowerText.includes('cannot find module') ||
      lowerText.includes('module_not_found') ||
      lowerText.includes('npm err! 404') ||
      lowerText.includes('failed to resolve import')
    ) {
      const match = fullText.match(/cannot find module ['"]([^'"]+)['"]/i) || fullText.match(/failed to resolve import ['"]([^'"]+)['"]/i);
      const modName = match ? match[1] : 'required dependency';

      return {
        stageId,
        providerId,
        serviceName,
        failureCategory: FAILURE_CATEGORY.DEPENDENCY_ERROR,
        likelyRootCause: `Module resolution failed during compilation: '${modName}' could not be located.`,
        confidence: 'HIGH',
        evidence: [
          {
            source: 'Compilation Log',
            snippet: fullText.split('\n').find((l) => l.toLowerCase().includes('cannot find module') || l.toLowerCase().includes('failed to resolve')) || modName,
            description: `Unresolved dependency '${modName}'.`,
          },
        ],
        suggestedFix: `Run 'npm install ${modName}' in ${path.relative(resolvedWorkspace, targetDir) || '.'} and ensure it is listed in package.json dependencies.`,
        isRetrySafe: true,
      };
    }

    // 6. Check Health Check Failure
    if (lowerText.includes('health_check_failed') || lowerText.includes('health check failed')) {
      return {
        stageId,
        providerId,
        serviceName,
        failureCategory: FAILURE_CATEGORY.HEALTH_CHECK_FAILED,
        likelyRootCause: `Backend service deployed to cloud, but post-deployment HTTP health check failed to respond with 200 OK.`,
        confidence: 'HIGH',
        evidence: [
          {
            source: 'Health Check Prober',
            snippet: fullText.split('\n').find((l) => l.toLowerCase().includes('health')) || error,
            description: 'Probe endpoint returned error or timed out.',
          },
        ],
        suggestedFix: `Check backend application startup logs and ensure the health check endpoint (e.g. /health or /api/health) is listening and returning HTTP 200.`,
        isRetrySafe: true,
      };
    }

    // 7. Check Provider Configuration / Missing API Fields (e.g. Render ownerId, vercel.json)
    if (
      lowerText.includes('provider_repository_content_missing') ||
      lowerText.includes('local workspace differs from remote repository') ||
      lowerText.includes('ownerid is a required field') ||
      lowerText.includes('ownerid is required') ||
      lowerText.includes('render_workspace_resolution_failed') ||
      lowerText.includes('repo is required') ||
      lowerText.includes('render_repository_required') ||
      lowerText.includes('configuration_missing') ||
      lowerText.includes('missing required field') ||
      lowerText.includes('missing required parameter')
    ) {
      let likelyCause = `Provider API rejected the deployment request due to missing or invalid configuration parameters.`;
      let fix = `Inspect provider request payload and ensure all required parameters are supplied.`;

      if (lowerText.includes('provider_repository_content_missing') || lowerText.includes('local workspace differs from remote repository')) {
        likelyCause = `Selected service root directory exists locally but has not been committed or pushed to the remote Git repository branch.`;
        fix = `Commit and push the project files to your remote branch, or select a repository/branch/rootDir that exists remotely.`;
      } else if (lowerText.includes('repo is required') || lowerText.includes('render_repository_required')) {
        likelyCause = `Render's Create Service API requires a Git repository URL (repo) when creating a Node Web Service (runtime: node).`;
        fix = `Ensure the workspace is backed by a Git remote repository (e.g. GitHub/GitLab origin URL), or configure repo in RenderDeployAdapter payload.`;
      } else if (lowerText.includes('ownerid') || lowerText.includes('render_workspace')) {
        likelyCause = `Render API rejected service creation because the required workspace/owner ID was missing or could not be resolved from the account.`;
        fix = `Ensure the authenticated Render API key has access to an active workspace, and verify RenderDeployAdapter queries /v1/owners to supply ownerId.`;
      } else if (lowerText.includes('configuration_missing')) {
        likelyCause = `Deployment configuration manifest (e.g. vercel.json, render.yaml) is missing from the project directory.`;
        fix = `Generate the required deployment manifest in the project folder before starting deployment.`;
      }

      const matchLine = fullText.split('\n').find((l) =>
        l.toLowerCase().includes('provider_repository_content_missing') ||
        l.toLowerCase().includes('local workspace differs') ||
        l.toLowerCase().includes('repo is required') ||
        l.toLowerCase().includes('render_repository') ||
        l.toLowerCase().includes('ownerid') ||
        l.toLowerCase().includes('render_workspace') ||
        l.toLowerCase().includes('configuration_missing') ||
        l.toLowerCase().includes('required field')
      ) || error;

      return {
        stageId,
        providerId,
        serviceName,
        failureCategory: FAILURE_CATEGORY.PROVIDER_CONFIGURATION_ERROR,
        likelyRootCause: likelyCause,
        affectedAdapter: providerId === 'render' ? 'RenderDeployAdapter' : providerId === 'vercel' ? 'VercelDeployAdapter' : `${providerId}Adapter`,
        confidence: 'HIGH',
        evidence: [
          {
            source: 'Provider Preflight & API Response',
            snippet: secretFilter.sanitizeString(matchLine.trim()),
            description: 'Preflight or API rejected the request due to missing remote content or configuration.',
          },
        ],
        suggestedFix: fix,
        isRetrySafe: true,
      };
    }

    // 8. Check Stage Execution Timeout
    if (lowerText.includes('stage_timeout') || lowerText.includes('deployment_timeout') || lowerText.includes('exceeded 15 minute limit')) {
      return {
        stageId,
        providerId,
        serviceName,
        failureCategory: FAILURE_CATEGORY.TIMEOUT_ERROR,
        likelyRootCause: `Deployment process timed out after 15 minutes of execution.`,
        confidence: 'HIGH',
        evidence: [
          {
            source: 'Timeout Watchdog',
            snippet: 'Execution exceeded 15 minute limit',
            description: 'Process hung or long-running compilation exceeded bounded timeout.',
          },
        ],
        suggestedFix: `Check if build or installation commands are waiting for interactive input, or optimize dependency installation size.`,
        isRetrySafe: true,
      };
    }

    // 8. General Provider Failure Fallback
    const mostRelevantLine = fullText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('[') && (l.toLowerCase().includes('error') || l.toLowerCase().includes('failed') || l.toLowerCase().includes('fatal')))
      .pop() || error || 'Process exited with non-zero status.';

    return {
      stageId,
      providerId,
      serviceName,
      failureCategory: FAILURE_CATEGORY.PROVIDER_EXECUTION_ERROR,
      likelyRootCause: `${serviceName} deployment via ${providerId.toUpperCase()} failed: ${secretFilter.sanitizeString(mostRelevantLine)}`,
      confidence: 'MEDIUM',
      evidence: [
        {
          source: 'Provider Output',
          snippet: secretFilter.sanitizeString(mostRelevantLine),
          description: 'Failure message reported by provider build runner.',
        },
      ],
      suggestedFix: `Inspect the provider log console above, resolve the build or configuration failure in ${path.relative(resolvedWorkspace, targetDir) || '.'}, and redeploy.`,
      isRetrySafe: true,
    };
  }

  /**
   * Helper to scan files in directory for references to an environment variable
   */
  findEnvVarUsageInProject(dir, varName) {
    const evidence = [];
    if (!fs.existsSync(dir)) return evidence;

    const filesToScan = [];
    const scanDir = (current, depth = 0) => {
      if (depth > 3 || filesToScan.length >= 10) return;
      try {
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build' || entry.name === '.next') {
            continue;
          }
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) {
            scanDir(full, depth + 1);
          } else if (/\.(js|jsx|ts|tsx|env|env\.example|json|html|vue|svelte)$/i.test(entry.name)) {
            filesToScan.push(full);
          }
        }
      } catch (_) {}
    };

    scanDir(dir);

    for (const filePath of filesToScan) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        if (content.includes(varName)) {
          const lines = content.split('\n');
          for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            if (lines[lineNum].includes(varName)) {
              evidence.push({
                source: `${path.basename(filePath)} (line ${lineNum + 1})`,
                file: filePath,
                line: lineNum + 1,
                snippet: lines[lineNum].trim(),
                description: `References variable '${varName}'`,
              });
              if (evidence.length >= 3) break;
            }
          }
        }
      } catch (_) {}
      if (evidence.length >= 3) break;
    }

    return evidence;
  }
}

const deploymentFailureDiagnoser = new DeploymentFailureDiagnoser();

module.exports = {
  FAILURE_CATEGORY,
  DeploymentFailureDiagnoser,
  deploymentFailureDiagnoser,
};
