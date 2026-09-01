/**
 * NEXUS INTELLIGENCE LAYER — RENDER DEPLOY ADAPTER (Phase 4B)
 * 
 * Manages Render service parameters, REST API request preparation,
 * environment variable wiring (DATABASE_URL), progress parsing, and output extraction.
 * 
 * STRICT INVARIANTS:
 * - NEVER exposes Render API Key in CLI arguments or logs.
 * - Enforces workspace path containment and prevents directory traversal.
 * - Extracts and validates HTTPS onrender.com URLs.
 * - 0 LLM tokens, 100% deterministic local parameter mapping.
 */

const fs = require('fs');
const path = require('path');
const secretFilter = require('../../../../../security/secretFilter');
const { remoteRepositoryPreflight: defaultRemoteRepositoryPreflight } = require('../../preflight/RemoteRepositoryPreflight');

const RENDER_URL_REGEX = /https:\/\/[a-zA-Z0-9_\-.]+\.onrender\.com/g;
const GENERIC_HTTPS_URL_REGEX = /https:\/\/[a-zA-Z0-9_\-.]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?/g;

/**
 * Removes the legacy human-readable annotation that older detection results
 * appended to npm commands.  Provider payloads must contain shell commands,
 * never presentation text such as `npm start (node server.js)`.
 */
function cleanProviderCommand(value, fallback) {
  const command = typeof value === 'string' ? value.trim() : '';
  if (!command) return fallback;
  const annotatedNpmCommand = command.match(/^(npm\s+(?:start|run\s+[A-Za-z0-9:_-]+))\s+\([^()\r\n]+\)$/i);
  return annotatedNpmCommand ? annotatedNpmCommand[1] : command;
}

class RenderDeployAdapter {
  constructor(options = {}) {
    this.providerId = 'render';
    this.displayName = 'Render';
    this.remoteRepositoryPreflight = options.remoteRepositoryPreflight || defaultRemoteRepositoryPreflight;
  }

  /**
   * Resolves target execution plan for Render
   * @param {Object} context - { workspacePath, rootDir, serviceId, framework, buildCommand, startCommand, port, dynamicInputs }
   * @returns {Object} ResolvedExecutionPlan
   */
  resolveExecutionPlan(context = {}) {
    const { workspacePath, rootDir } = context;
    if (!workspacePath || typeof workspacePath !== 'string') {
      throw new Error('Invalid workspace path for Render deployment.');
    }

    const resolvedWorkspace = path.resolve(workspacePath);
    let targetCwd = resolvedWorkspace;

    if (rootDir && typeof rootDir === 'string') {
      const resolvedTarget = path.resolve(resolvedWorkspace, rootDir);
      const rel = path.relative(resolvedWorkspace, resolvedTarget);
      if (rel.startsWith('..') || (path.isAbsolute(rel) && !resolvedTarget.startsWith(resolvedWorkspace))) {
        throw new Error(`Path traversal rejected: rootDir ${rootDir} escapes workspace.`);
      }
      targetCwd = resolvedTarget;
    }

    if (!fs.existsSync(targetCwd)) {
      throw new Error(`Target deployment directory does not exist: ${targetCwd}`);
    }

    // Verify render.yaml, Dockerfile, or package.json exists
    const configInCwd = path.join(targetCwd, 'render.yaml');
    const configInRoot = path.join(resolvedWorkspace, 'render.yaml');
    const dockerInCwd = path.join(targetCwd, 'Dockerfile');
    const pkgInCwd = path.join(targetCwd, 'package.json');

    const hasConfig = fs.existsSync(configInCwd) || fs.existsSync(configInRoot) || fs.existsSync(dockerInCwd) || fs.existsSync(pkgInCwd);
    if (!hasConfig) {
      throw new Error('CONFIGURATION_MISSING: render.yaml or service manifest not found. Please preview and generate render.yaml.');
    }

    const serviceName = context.serviceId || path.basename(targetCwd);
    const relRootDir = path.relative(resolvedWorkspace, targetCwd);

    return {
      type: 'API',
      providerId: 'render',
      serviceType: 'web_service',
      cwd: targetCwd,
      workspaceRoot: resolvedWorkspace,
      serviceName,
      rootDir: relRootDir || '',
      endpoint: 'https://api.render.com/v1/services',
      payload: {
        type: 'web_service',
        name: serviceName,
        rootDir: relRootDir || undefined,
        buildCommand: cleanProviderCommand(context.buildCommand, 'npm run build'),
        startCommand: cleanProviderCommand(context.startCommand, 'npm start'),
      },
    };
  }

  /**
   * Resolves active workspace / owner ID from Render API
   * @param {string} apiKey
   * @param {Function} [fetchFn=fetch]
   * @returns {Promise<{ ownerId: string, ownerName: string, ownerType: string, allOwners: Array }>}
   */
  async resolveOwnerId(apiKey, fetchFn = fetch) {
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('RENDER_WORKSPACE_RESOLUTION_FAILED: Render API key is missing or empty.');
    }

    const cleanKey = apiKey.trim();
    secretFilter.addSecret(cleanKey);
    const ownersEndpoint = 'https://api.render.com/v1/owners?limit=20';

    let response;
    try {
      response = await fetchFn(ownersEndpoint, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${cleanKey}`,
          'Accept': 'application/json',
        },
      });
    } catch (netErr) {
      throw new Error(`RENDER_WORKSPACE_RESOLUTION_FAILED: Network error querying Render workspaces: ${netErr.message}`);
    }

    const responseText = await response.text();
    if (!response.ok) {
      const sanitizedError = secretFilter.sanitizeString(responseText);
      throw new Error(`RENDER_WORKSPACE_RESOLUTION_FAILED: Render API returned HTTP ${response.status} when querying workspaces: ${sanitizedError}`);
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseErr) {
      throw new Error(`RENDER_WORKSPACE_RESOLUTION_FAILED: Invalid JSON returned by Render owners API.`);
    }

    let ownersList = [];
    if (Array.isArray(data)) {
      ownersList = data.map(item => item.owner || item).filter(Boolean);
    } else if (data && typeof data === 'object') {
      if (Array.isArray(data.owners)) {
        ownersList = data.owners.map(item => item.owner || item).filter(Boolean);
      } else if (data.owner) {
        ownersList = [data.owner];
      } else if (data.id) {
        ownersList = [data];
      }
    }

    if (ownersList.length === 0) {
      throw new Error('RENDER_WORKSPACE_RESOLUTION_FAILED: No accessible Render workspaces or owners found for the authenticated account.');
    }

    // Prefer team workspace or first user workspace
    const selectedOwner = ownersList.find(o => o.type === 'team') || ownersList[0];
    const ownerId = selectedOwner.id;
    const ownerName = selectedOwner.name || selectedOwner.email || 'Workspace';
    const ownerType = selectedOwner.type || 'user';

    if (!ownerId || typeof ownerId !== 'string') {
      throw new Error('RENDER_WORKSPACE_RESOLUTION_FAILED: Render workspace object missing required "id" field.');
    }

    return {
      ownerId: ownerId.trim(),
      ownerName,
      ownerType,
      allOwners: ownersList.map(o => ({ id: o.id, name: o.name || o.email, type: o.type })),
    };
  }

  /**
   * Resolves remote repository URL and active branch from local Git workspace or explicit context
   * @param {string} workspacePath
   * @param {Object} [options]
   * @returns {{ repoUrl: string, branch: string, gitRoot: string }|null}
   */
  resolveGitMetadata(workspacePath, options = {}) {
    const explicitRepo = options.repository || options.repo || options.repositoryUrl || options.deploymentRepositoryContext?.remoteUrl;
    if (explicitRepo && typeof explicitRepo === 'string' && explicitRepo.trim()) {
      const explicitBranch = options.branch || options.deploymentRepositoryContext?.branch || 'main';
      return {
        repoUrl: explicitRepo.trim(),
        branch: explicitBranch.trim(),
        gitRoot: null,
        repositorySource: 'EXPLICIT_PROVIDER_REPOSITORY',
      };
    }
    if (!workspacePath || typeof workspacePath !== 'string') {
      return null;
    }
    return this.remoteRepositoryPreflight.resolveGitMetadata(workspacePath, options);
  }

  /**
   * Prepares service creation payload with ownerId, repo, branch, and dynamic inputs
   * @param {Object} context
   * @param {string} ownerId
   * @param {Object} [dynamicInputs]
   * @returns {Object}
   */
  prepareServicePayload(context = {}, ownerId, dynamicInputs = {}) {
    if (!ownerId || typeof ownerId !== 'string') {
      throw new Error('RENDER_WORKSPACE_RESOLUTION_FAILED: ownerId is required to construct Create Service request.');
    }

    const serviceName = context.serviceName || context.serviceId || 'web-service';
    const envVarsArray = [];

    if (dynamicInputs && typeof dynamicInputs === 'object') {
      for (const [k, v] of Object.entries(dynamicInputs)) {
        if (typeof v === 'string') {
          envVarsArray.push({ key: k, value: v });
        }
      }
    }

    // Resolve Git repository URL, branch, and projectRoot following strict precedence:
    // 1. Explicit context repo / repositoryUrl / repository
    // 2. Explicit deploymentRepositoryContext.remoteUrl
    // 3. Explicit options repository / repo
    // 4. Local workspace Git metadata (ONLY if executionSource === 'GIT_REMOTE' and no explicit repo was selected)
    let repo = context.repo || context.repoUrl || context.repository || context.repositoryUrl || null;
    let branch = context.branch || null;
    let explicitRootDir = context.projectRoot || context.explicitRootDir || null;

    if (context.deploymentRepositoryContext) {
      if (!repo && context.deploymentRepositoryContext.remoteUrl) {
        repo = context.deploymentRepositoryContext.remoteUrl;
      }
      if (!branch && context.deploymentRepositoryContext.branch) {
        branch = context.deploymentRepositoryContext.branch;
      }
      if (!explicitRootDir && context.deploymentRepositoryContext.projectRoot) {
        explicitRootDir = context.deploymentRepositoryContext.projectRoot;
      }
    }

    if (!repo && context.options) {
      if (context.options.repository || context.options.repo || context.options.repositoryUrl) {
        repo = context.options.repository || context.options.repo || context.options.repositoryUrl;
      }
      if (!branch && (context.options.branch || context.options.selectedBranch)) {
        branch = context.options.branch || context.options.selectedBranch;
      }
      if (!explicitRootDir && (context.options.rootDir || context.options.selectedRootDir)) {
        explicitRootDir = context.options.rootDir || context.options.selectedRootDir;
      }
    }

    if (!repo && (context.workspacePath || context.cwd || context.workspaceRoot)) {
      const baseWs = context.workspacePath || context.cwd || context.workspaceRoot;
      const gitMeta = this.resolveGitMetadata(baseWs, context.options || {});
      if (gitMeta) {
        repo = gitMeta.repoUrl;
        if (!branch) {
          branch = gitMeta.branch;
        }
      }
    }

    if (!repo && context.allowMockRepo) {
      repo = 'https://github.com/mock-org/mock-backend.git';
    }

    // Resolve clean root directory within the remote repository
    const resolvedRootDir = this.remoteRepositoryPreflight.resolveServiceRootDir(
      context.workspacePath || context.cwd || '',
      { rootDir: context.rootDir },
      { rootDir: explicitRootDir }
    );
    const cleanRootDir = resolvedRootDir && resolvedRootDir !== '.' ? resolvedRootDir : undefined;

    const env = context.env || 'node';

    // When runtime is node, Render strictly requires repo
    if (!repo && env === 'node') {
      throw new Error(`RENDER_REPOSITORY_REQUIRED: Render Node Web Service requires a connected Git repository URL. No remote origin was detected for workspace.`);
    }

    // Verify remote repository content exists
    if (!context.allowMockRepo && context.skipRemotePreflight !== true && (context.workspacePath || context.cwd || context.workspaceRoot)) {
      const baseWs = context.workspacePath || context.cwd || context.workspaceRoot;
      const remoteCheck = this.remoteRepositoryPreflight.verifyService({
        workspacePath: baseWs,
        serviceTarget: { rootDir: context.rootDir, selectedProvider: 'render' },
        options: {
          allowMockRepo: context.allowMockRepo,
          repository: repo,
          branch: branch,
          rootDir: explicitRootDir,
          executionSource: context.executionSource || 'GIT_REMOTE',
          execFn: context.gitExecFn,
        },
      });

      if (!remoteCheck.valid && !remoteCheck.skipped) {
        throw new Error(`PROVIDER_REPOSITORY_CONTENT_MISSING: ${remoteCheck.message || remoteCheck.reason}`);
      }
    }

    let buildCommand = context.buildCommand || null;
    if (!buildCommand && (context.workspacePath || context.cwd || context.workspaceRoot)) {
      const baseWs = context.workspacePath || context.cwd || context.workspaceRoot;
      const targetDir = context.rootDir ? path.resolve(baseWs, context.rootDir) : path.resolve(baseWs);
      const pkgJson = path.join(targetDir, 'package.json');
      if (fs.existsSync(pkgJson)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
          if (parsed.scripts && parsed.scripts.build) {
            buildCommand = 'npm run build';
          } else {
            buildCommand = 'npm install';
          }
        } catch (_) {}
      }
    }
    if (!buildCommand) {
      buildCommand = 'npm run build';
    }

    // Defense in depth: plans created before the detector fix may still carry
    // a display annotation. Strip it at the provider boundary as well.
    buildCommand = cleanProviderCommand(buildCommand, 'npm run build');
    const startCommand = cleanProviderCommand(context.startCommand, 'npm start');

    const serviceDetails = {
      env,
      plan: context.plan || 'free',
      rootDir: cleanRootDir,
      buildCommand,
      startCommand,
      envSpecificDetails: {
        buildCommand,
        startCommand,
      },
    };

    if (envVarsArray.length > 0) {
      serviceDetails.envVars = envVarsArray;
    }

    const payload = {
      type: 'web_service',
      name: serviceName,
      ownerId: ownerId.trim(),
      autoDeploy: 'no',
      serviceDetails,
    };

    if (repo) {
      payload.repo = repo.trim();
    }
    if (branch) {
      payload.branch = branch.trim();
    }
    if (cleanRootDir) {
      payload.rootDir = cleanRootDir;
    }

    if (envVarsArray.length > 0) {
      payload.envVars = envVarsArray;
    }

    return payload;
  }

  /**
   * Prepares sanitized environment variables with decrypted Render API Key and dynamic inputs
   * @param {Object|string} decryptedCredential - { apiKey: string } or raw string
   * @param {Object} [dynamicInputs] - e.g. { DATABASE_URL: 'postgres://...' }
   * @returns {Object}
   */
  prepareEnvironment(decryptedCredential, dynamicInputs = {}) {
    let apiKey = null;
    if (typeof decryptedCredential === 'string') {
      apiKey = decryptedCredential;
    } else if (decryptedCredential && typeof decryptedCredential === 'object') {
      apiKey = decryptedCredential.apiKey || decryptedCredential.token;
    }

    if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('Render API key is missing or invalid.');
    }

    const cleanDynamicInputs = {};
    if (dynamicInputs && typeof dynamicInputs === 'object') {
      for (const [k, v] of Object.entries(dynamicInputs)) {
        if (typeof v === 'string') {
          cleanDynamicInputs[k] = v;
        }
      }
    }

    return {
      ...process.env,
      RENDER_API_KEY: apiKey.trim(),
      ...cleanDynamicInputs,
      CI: '1',
      FORCE_COLOR: '0',
    };
  }

  /**
   * Parses log chunk or progress update into standard state
   * @param {string} text
   * @returns {string|null}
   */
  parseProgressState(text = '') {
    if (!text || typeof text !== 'string') return null;
    const lower = text.toLowerCase();

    if (lower.includes('building') || lower.includes('build succeeded') || lower.includes('running build')) {
      return 'BUILDING';
    }
    if (lower.includes('uploading') || lower.includes('pushing image') || lower.includes('deploying')) {
      return 'DEPLOYING';
    }
    return null;
  }

  /**
   * Extracts live URL and service ID from output text or API response payload
   * @param {string} outputText
   * @param {Object} [responseData]
   * @returns {Object} { liveUrl: string|null, serviceId: string|null, connectionString: string|null }
   */
  extractOutputs(outputText = '', responseData = null) {
    let liveUrl = null;
    let serviceId = null;
    let connectionString = null;

    // 1. Check structured API response data
    if (responseData && typeof responseData === 'object') {
      if (responseData.service?.serviceDetails?.url) {
        liveUrl = responseData.service.serviceDetails.url;
      } else if (responseData.service?.url) {
        liveUrl = responseData.service.url;
      } else if (responseData.url) {
        liveUrl = responseData.url;
      }

      if (responseData.service?.id) {
        serviceId = responseData.service.id;
      } else if (responseData.id) {
        serviceId = responseData.id;
      }

      if (responseData.postgres?.connectionInfo?.internalConnectionString) {
        connectionString = responseData.postgres.connectionInfo.internalConnectionString;
      } else if (responseData.connectionString) {
        connectionString = responseData.connectionString;
      }
    }

    // 2. Check output text for onrender.com URLs
    if (!liveUrl && outputText) {
      const renderMatches = outputText.match(RENDER_URL_REGEX);
      if (renderMatches && renderMatches.length > 0) {
        liveUrl = renderMatches[renderMatches.length - 1];
      } else {
        const genericMatches = outputText.match(GENERIC_HTTPS_URL_REGEX);
        if (genericMatches && genericMatches.length > 0) {
          const candidate = genericMatches[genericMatches.length - 1];
          if (candidate.startsWith('https://') && !candidate.includes('render.com/docs')) {
            liveUrl = candidate;
          }
        }
      }
    }

    // 3. Check output text for service ID pattern (srv-c...)
    if (!serviceId && outputText) {
      const srvMatch = outputText.match(/srv-[a-zA-Z0-9]+/);
      if (srvMatch) {
        serviceId = srvMatch[0];
      }
    }

    return {
      liveUrl: liveUrl ? secretFilter.sanitizeString(liveUrl) : null,
      serviceId: serviceId ? secretFilter.sanitizeString(serviceId) : null,
      connectionString: connectionString || null,
    };
  }

  /**
   * Normalizes Render API error response
   * @param {number} statusCode
   * @param {Object|string} responseBody
   * @returns {string}
   */
  formatApiError(statusCode, responseBody) {
    let msg = `Render API request failed with status ${statusCode}`;
    if (typeof responseBody === 'object' && responseBody !== null) {
      msg = responseBody.message || responseBody.error || JSON.stringify(responseBody);
    } else if (typeof responseBody === 'string' && responseBody.trim()) {
      msg = responseBody.trim();
    }
    return secretFilter.sanitizeString(`Render Error (${statusCode}): ${msg}`);
  }
}

module.exports = RenderDeployAdapter;
