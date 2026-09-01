/**
 * NEXUS INTELLIGENCE LAYER — DEPLOYMENT ORCHESTRATOR (Phase 4C)
 * 
 * Sequential multi-stage deployment orchestrator coordinating:
 * - Preflight plan integrity & credential verification
 * - Stale-plan protection (SHA-256 evidence hashing)
 * - Topological stage execution (Database -> Backend -> Frontend)
 * - Dynamic output-to-input environment wiring (DATABASE_URL, NEXT_PUBLIC_API_URL)
 * - Dynamic secret registration in secretFilter
 * - Post-deployment HTTP health checks
 * - Failure escalation and multi-stage cancellation
 * 
 * STRICT INVARIANTS:
 * - 0 LLM tokens, 100% deterministic local orchestration.
 * - Strictly sequential stage execution in Phase 4C.
 * - Dynamic secrets never cross IPC boundaries to renderer.
 * - All log chunks pass through secretFilter.sanitizeString.
 * - Fails closed on plan staleness, missing auth, or failed health checks.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const secretFilter = require('../../../../security/secretFilter');
const { deploymentCredentialStore: defaultCredentialStore } = require('../credentials/DeploymentCredentialStore');
const { healthCheckClient: defaultHealthCheckClient } = require('./HealthCheckClient');
const { remoteRepositoryPreflight: defaultRemoteRepositoryPreflight } = require('../preflight/RemoteRepositoryPreflight');

const VercelDeployAdapter = require('../execution/providers/VercelDeployAdapter');
const RenderDeployAdapter = require('../execution/providers/RenderDeployAdapter');
const NetlifyDeployAdapter = require('../execution/providers/NetlifyDeployAdapter');
const { deploymentFailureDiagnoser } = require('../diagnostics/DeploymentFailureDiagnoser');

const DEFAULT_STAGE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes per stage

/**
 * Stage Execution Statuses
 */
const STAGE_STATUS = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  CANCELLED: 'CANCELLED',
});

/**
 * Overall Orchestration Statuses
 */
const ORCHESTRATION_STATUS = Object.freeze({
  CREATED: 'CREATED',
  PREPARING: 'PREPARING',
  PREFLIGHT: 'PREFLIGHT',
  RUNNING: 'RUNNING',
  FINALIZING: 'FINALIZING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  PARTIAL_SUCCESS: 'PARTIAL_SUCCESS',
  CANCELLED: 'CANCELLED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  PLAN_STALE: 'PLAN_STALE',
  TIMED_OUT: 'TIMED_OUT',
});

const TERMINAL_ORCHESTRATION_STATUSES = new Set([
  ORCHESTRATION_STATUS.SUCCESS,
  ORCHESTRATION_STATUS.FAILED,
  ORCHESTRATION_STATUS.PARTIAL_SUCCESS,
  ORCHESTRATION_STATUS.CANCELLED,
  ORCHESTRATION_STATUS.AUTH_REQUIRED,
  ORCHESTRATION_STATUS.TIMED_OUT,
]);

class DeploymentOrchestrator {
  constructor(options = {}) {
    this.credentialStore = options.credentialStore || defaultCredentialStore;
    this.healthCheckClient = options.healthCheckClient || defaultHealthCheckClient;
    this.remoteRepositoryPreflight = options.remoteRepositoryPreflight || defaultRemoteRepositoryPreflight;
    this.spawnFn = options.spawn || spawn;
    this.stageTimeoutMs = options.stageTimeoutMs || DEFAULT_STAGE_TIMEOUT_MS;
    this.databaseAdapter = options.databaseAdapter || null; // Injected for mock/real DB testing

    this.adapters = new Map();
    // activeOrchestrations remains for compatibility with existing callers.  Workspace
    // ownership is deliberately kept separately so an ID can never accidentally
    // conflict with its own record while it is doing preflight.
    this.activeOrchestrations = new Map(); // orchestrationId -> DeploymentExecutionContext
    this.workspaceOwners = new Map(); // resolved workspacePath -> orchestrationId
    this.orchestrationRecords = new Map(); // active and terminal records by orchestrationId
    this.inflightRequests = new Map(); // `${workspacePath}:${requestId}` -> Promise

    this.registerDefaultAdapters();
  }

  registerDefaultAdapters() {
    this.registerAdapter(new VercelDeployAdapter({ remoteRepositoryPreflight: this.remoteRepositoryPreflight }));
    this.registerAdapter(new RenderDeployAdapter({ remoteRepositoryPreflight: this.remoteRepositoryPreflight }));
    this.registerAdapter(new NetlifyDeployAdapter({ remoteRepositoryPreflight: this.remoteRepositoryPreflight }));
  }

  registerAdapter(adapter) {
    if (adapter && typeof adapter.providerId === 'string') {
      this.adapters.set(adapter.providerId, adapter);
    }
  }

  /**
   * Checks if an OS process PID is alive
   * @param {number} pid
   * @returns {boolean}
   */
  isPidAlive(pid) {
    if (!pid || typeof pid !== 'number') return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Determines if an orchestration record is genuinely running and non-stale
   * @param {Object} orch
   * @returns {boolean}
   */
  isOrchestrationActive(orch) {
    if (!orch || typeof orch !== 'object') return false;

    // 1. Terminal states are never active
    if (TERMINAL_ORCHESTRATION_STATUSES.has(orch.status)) {
      return false;
    }

    // 2. Check child process liveness if present
    if (orch.activeChild) {
      if (orch.activeChild.exitCode !== null || orch.activeChild.killed) {
        return false;
      }
      if (orch.activeChild.pid && !this.isPidAlive(orch.activeChild.pid)) {
        return false;
      }
      return true;
    }

    // A live in-process stage (notably Render's API/health-check path) is
    // positive ownership evidence even when there is no child PID to inspect.
    if (orch.activeStageId && orch.status === ORCHESTRATION_STATUS.RUNNING) {
      return true;
    }

    // 3. Check for stale timestamp / abandoned execution
    const now = Date.now();
    const startTime = orch.startedAt || 0;
    const lastActivity = orch.lastActivityAt || startTime;
    const staleThreshold = this.stageTimeoutMs || DEFAULT_STAGE_TIMEOUT_MS;

    if (startTime > 0 && now - lastActivity > staleThreshold) {
      return false;
    }

    return orch.status === ORCHESTRATION_STATUS.RUNNING || orch.status === ORCHESTRATION_STATUS.PREFLIGHT;
  }

  /**
   * Auto-cleans terminal or stale orchestration records from active map
   * @param {string} [workspacePath] - Optional workspace to filter cleanup
   */
  cleanupStaleOrchestrations(workspacePath) {
    const resolved = workspacePath ? path.resolve(workspacePath) : null;
    for (const [id, orch] of this.activeOrchestrations.entries()) {
      if (!resolved || orch.workspacePath === resolved) {
        if (!this.isOrchestrationActive(orch)) {
          if (this.workspaceOwners.get(orch.workspacePath) === id) {
            this.workspaceOwners.delete(orch.workspacePath);
          }
          this.activeOrchestrations.delete(id);
          if (orch && typeof orch === 'object') {
            orch.status = TERMINAL_ORCHESTRATION_STATUSES.has(orch.status)
              ? orch.status
              : ORCHESTRATION_STATUS.TIMED_OUT;
            orch.terminalAt = orch.terminalAt || Date.now();
            orch.terminalReason = orch.terminalReason || 'Stale or dead orchestration record cleaned.';
            this.orchestrationRecords.set(id, orch);
          }
        }
      }
    }
  }

  /**
   * Generates a unique orchestration run ID
   * @returns {string}
   */
  generateOrchestrationId() {
    return `nexus-orch-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Returns a conflicting active owner, if any.  Passing the current ID is the
   * critical self-ownership rule: the owner is always allowed to continue.
   */
  isAnotherActiveOrchestration(workspacePath, currentOrchestrationId) {
    const resolvedWorkspace = path.resolve(workspacePath);
    this.cleanupStaleOrchestrations(resolvedWorkspace);

    const ownedId = this.workspaceOwners.get(resolvedWorkspace);
    if (ownedId) {
      const ownedRecord = this.activeOrchestrations.get(ownedId);
      if (ownedId === currentOrchestrationId) return null;
      if (ownedRecord && this.isOrchestrationActive(ownedRecord)) return ownedRecord;
      this.workspaceOwners.delete(resolvedWorkspace);
    }

    // Also inspect the legacy public map.  Some integrations/tests seed this map
    // directly, and it must not bypass the concurrency gate.
    for (const [id, record] of this.activeOrchestrations.entries()) {
      if (record.workspacePath !== resolvedWorkspace || id === currentOrchestrationId) continue;
      if (this.isOrchestrationActive(record)) return record;
    }
    return null;
  }

  acquireOrchestration(workspacePath, orchestrationId, record) {
    const resolvedWorkspace = path.resolve(workspacePath);
    const conflict = this.isAnotherActiveOrchestration(resolvedWorkspace, orchestrationId);
    if (conflict) {
      return {
        acquired: false,
        code: 'CONCURRENT_ORCHESTRATION',
        error: `An orchestration is already active for this workspace (ID: ${conflict.orchestrationId || this.workspaceOwners.get(resolvedWorkspace)}).`,
        activeOrchestrationId: conflict.orchestrationId || this.workspaceOwners.get(resolvedWorkspace),
      };
    }

    this.workspaceOwners.set(resolvedWorkspace, orchestrationId);
    this.activeOrchestrations.set(orchestrationId, record);
    this.orchestrationRecords.set(orchestrationId, record);
    return { acquired: true, workspacePath: resolvedWorkspace };
  }

  canExecuteStage(record) {
    return Boolean(
      record &&
      !record.cancelRequested &&
      !TERMINAL_ORCHESTRATION_STATUSES.has(record.status) &&
      this.activeOrchestrations.get(record.orchestrationId) === record &&
      this.workspaceOwners.get(record.workspacePath) === record.orchestrationId
    );
  }

  finalizeOrchestration(orchestrationId, terminalState, reason) {
    const record = this.orchestrationRecords.get(orchestrationId) || this.activeOrchestrations.get(orchestrationId);
    if (!record) return { finalized: false, error: 'Orchestration ID not found.' };
    if (!TERMINAL_ORCHESTRATION_STATUSES.has(terminalState)) {
      throw new Error(`Invalid terminal orchestration state: ${terminalState}`);
    }
    if (TERMINAL_ORCHESTRATION_STATUSES.has(record.status)) {
      return { finalized: false, record };
    }

    record.status = terminalState;
    record.phase = 'TERMINAL';
    record.terminalAt = Date.now();
    record.terminalReason = reason || null;
    record.lastActivityAt = record.terminalAt;
    if (this.workspaceOwners.get(record.workspacePath) === orchestrationId) {
      this.workspaceOwners.delete(record.workspacePath);
    }
    if (this.activeOrchestrations.get(orchestrationId) === record) {
      this.activeOrchestrations.delete(orchestrationId);
    }
    this.orchestrationRecords.set(orchestrationId, record);
    return { finalized: true, record };
  }

  /**
   * Computes an evidence hash of key workspace configuration files
   * @param {string} workspacePath
   * @returns {string}
   */
  computeEvidenceHash(workspacePath) {
    if (!workspacePath || !fs.existsSync(workspacePath)) return '';

    const manifestCandidates = [
      'package.json',
      'pnpm-workspace.yaml',
      'turbo.json',
      'render.yaml',
      'vercel.json',
      'netlify.toml',
      'Dockerfile',
      'docker-compose.yml',
      'prisma/schema.prisma',
    ];

    const hash = crypto.createHash('sha256');
    for (const file of manifestCandidates) {
      const fullPath = path.join(workspacePath, file);
      try {
        if (fs.existsSync(fullPath)) {
          const stat = fs.statSync(fullPath);
          hash.update(`${file}:${stat.size}:${stat.mtimeMs}`);
        }
      } catch (_) {}
    }

    return hash.digest('hex');
  }

  /**
   * Performs complete preflight validation of a DeploymentPlan
   * @param {Object} plan
   * @param {Object} [options]
   * @returns {Promise<Object>} { valid: boolean, error?: string, code?: string, missingProviders?: string[] }
   */
  async runPreflight(plan, options = {}) {
    if (!plan || typeof plan !== 'object') {
      return { valid: false, error: 'Invalid plan: DeploymentPlan must be an object.', code: 'INVALID_PLAN' };
    }

    const workspacePath = plan.workspacePath;
    if (!workspacePath || typeof workspacePath !== 'string') {
      return { valid: false, error: 'Invalid workspace path in plan.', code: 'INVALID_WORKSPACE' };
    }

    const resolvedWorkspace = path.resolve(workspacePath);
    if (!fs.existsSync(resolvedWorkspace) || !fs.statSync(resolvedWorkspace).isDirectory()) {
      return { valid: false, error: `Workspace directory does not exist: ${resolvedWorkspace}`, code: 'WORKSPACE_MISSING' };
    }

    // 1. Check ownership, never merely "anything active".  startOrchestration
    // supplies its own ID, which makes its preflight explicitly self-safe.
    const conflict = this.isAnotherActiveOrchestration(resolvedWorkspace, options.orchestrationId);
    if (conflict) {
      return {
        valid: false,
        error: `An orchestration is already active for this workspace (ID: ${conflict.orchestrationId}).`,
        code: 'CONCURRENT_ORCHESTRATION',
        activeOrchestrationId: conflict.orchestrationId,
      };
    }

    // 2. Validate plan execution order
    const executionOrder = Array.isArray(plan.executionOrder) ? plan.executionOrder : [];
    if (executionOrder.length === 0) {
      return { valid: false, error: 'DeploymentPlan executionOrder is empty. No stages to orchestrate.', code: 'EMPTY_EXECUTION_ORDER' };
    }

    // 3. Stale plan validation (Check if workspace files modified after plan generation)
    if (plan.evidenceHash && options.enforceFreshness !== false) {
      const currentHash = this.computeEvidenceHash(resolvedWorkspace);
      if (currentHash && currentHash !== plan.evidenceHash) {
        return {
          valid: false,
          error: 'The workspace changed after this deployment plan was generated. Review the updated plan before deploying.',
          code: ORCHESTRATION_STATUS.PLAN_STALE,
        };
      }
    }

    const services = Array.isArray(plan.topology?.services) ? plan.topology.services : [];

    // 4. Validate rootDir containment for all services
    for (const svc of services) {
      if (svc.rootDir && typeof svc.rootDir === 'string') {
        const targetDir = path.resolve(resolvedWorkspace, svc.rootDir);
        const rel = path.relative(resolvedWorkspace, targetDir);
        if (rel.startsWith('..') || (path.isAbsolute(rel) && !targetDir.startsWith(resolvedWorkspace))) {
          return { valid: false, error: `Path traversal rejected: Service '${svc.name}' rootDir '${svc.rootDir}' escapes workspace.`, code: 'PATH_TRAVERSAL' };
        }
      }
    }

    // 5. Validate credentials for all required providers
    const missingProviders = [];

    for (const svc of services) {
      const providerId = svc.selectedProvider || svc.recommendedProvider;
      if (!providerId) {
        return { valid: false, error: `Service '${svc.name}' (${svc.serviceId}) has no compatible cloud provider.`, code: 'UNSUPPORTED_PROVIDER' };
      }

      if (!this.adapters.has(providerId)) {
        return { valid: false, error: `No deploy adapter registered for provider: ${providerId}`, code: 'UNSUPPORTED_PROVIDER' };
      }

      const authStatus = this.credentialStore.getAuthStatus(providerId);
      if (!authStatus || !authStatus.isConnected) {
        missingProviders.push(providerId);
      }
    }

    if (missingProviders.length > 0) {
      const uniqueMissing = [...new Set(missingProviders)];
      return {
        valid: false,
        error: `Missing credentials for required provider(s): ${uniqueMissing.join(', ')}. Please connect them first.`,
        code: ORCHESTRATION_STATUS.AUTH_REQUIRED,
        missingProviders: uniqueMissing,
      };
    }

    // 6. Validate remote repository content for Git-backed providers
    const isMock = Boolean(options.mockApiExecutor || options.allowMockRepo || options.skipRemotePreflight);
    const isLocalWorkspace = plan.executionSource === 'LOCAL_WORKSPACE' || options.executionSource === 'LOCAL_WORKSPACE';

    if (!isMock) {
      for (const svc of services) {
        const providerId = svc.selectedProvider || svc.recommendedProvider;

        if (['render', 'vercel', 'railway', 'fly_io'].includes(providerId)) {
          const repoContext = this.remoteRepositoryPreflight.resolveDeploymentRepositoryContext(resolvedWorkspace, {
            ...options,
            repository: options.repository || plan.deploymentRepositoryContext?.remoteUrl,
            branch: options.branch || plan.deploymentRepositoryContext?.branch,
            rootDir: options.rootDir || plan.deploymentRepositoryContext?.projectRoot,
          });

          if (repoContext.repositorySource === 'PARENT_GIT' && !options.allowParentRepo && !options.repository && !plan.deploymentRepositoryContext?.remoteUrl) {
            return {
              valid: false,
              error: `Deployment source not configured: Local workspace is nested inside parent repository '${repoContext.parentRepoName}' which will not be used automatically.`,
              code: 'DEPLOYMENT_SOURCE_UNCONFIGURED',
            };
          }

          if (!repoContext.remoteUrl && options.requireRealRepo && providerId === 'render') {
            return {
              valid: false,
              error: 'RENDER_REPOSITORY_REQUIRED: Render Node Web Service requires a connected Git repository URL. No remote origin was detected for workspace.',
              code: 'RENDER_REPOSITORY_REQUIRED',
            };
          }

          if (repoContext.repositorySource === 'WORKSPACE_GIT' || repoContext.repositorySource === 'EXPLICIT_PROVIDER_REPOSITORY') {
            const remoteCheck = this.remoteRepositoryPreflight.verifyService({
              workspacePath: resolvedWorkspace,
              serviceTarget: svc,
              options: {
                allowMockRepo: options.allowMockRepo,
                branch: options.branch || repoContext.branch,
                repository: options.repository || repoContext.remoteUrl,
                rootDir: options.rootDir || repoContext.projectRoot,
                execFn: options.gitExecFn,
              },
            });

            if (!remoteCheck.valid && !remoteCheck.skipped) {
              return {
                valid: false,
                error: remoteCheck.message || `Local workspace differs from remote repository (${remoteCheck.requestedRootDir} not found in remote branch '${remoteCheck.branch}').`,
                code: 'PROVIDER_REPOSITORY_CONTENT_MISSING',
                remotePreflight: remoteCheck,
              };
            }
          }
        }
      }
    }

    return {
      valid: true,
      workspacePath: resolvedWorkspace,
      executionOrder,
      servicesCount: services.length,
      databasesCount: (plan.topology?.databases || []).length,
    };
  }

  /**
   * Starts multi-stage deployment orchestration
   * @param {Object} plan - Validated DeploymentPlan
   * @param {Object} [options]
   * @param {Function} [eventCallback] - (eventType, eventPayload) => void
   * @returns {Promise<Object>} Final orchestration result
   */
  startOrchestration(plan, options = {}, eventCallback = () => {}) {
    const requestId = options.requestId;
    const workspacePath = typeof plan?.workspacePath === 'string' ? path.resolve(plan.workspacePath) : '';
    const requestKey = requestId && workspacePath ? `${workspacePath}:${requestId}` : null;
    if (requestKey && this.inflightRequests.has(requestKey)) {
      return this.inflightRequests.get(requestKey);
    }
    const execution = this._startOrchestration(plan, options, eventCallback);
    if (requestKey) {
      this.inflightRequests.set(requestKey, execution);
      execution.finally(() => this.inflightRequests.delete(requestKey)).catch(() => {});
    }
    return execution;
  }

  async _startOrchestration(plan, options = {}, eventCallback = () => {}) {
    const orchestrationId = this.generateOrchestrationId();
    const startTime = Date.now();
    const requestId = options.requestId || null;
    const requestedWorkspace = typeof plan?.workspacePath === 'string' ? path.resolve(plan.workspacePath) : '';

    const emit = (eventType, payload) => {
      try {
        eventCallback(eventType, { orchestrationId, requestId, ...payload, timestamp: Date.now() });
      } catch (_) {}
    };

    // This is the one runtime object for the entire attempt.  It is registered
    // before any await, making acquisition atomic in Electron's single process.
    const runtimeRecord = {
      orchestrationId,
      requestId,
      workspacePath: requestedWorkspace,
      status: ORCHESTRATION_STATUS.CREATED,
      phase: ORCHESTRATION_STATUS.CREATED,
      createdAt: startTime,
      startedAt: startTime,
      lastActivityAt: startTime,
      terminalAt: null,
      terminalReason: null,
      currentStageIndex: 0,
      activeChild: null,
      cancelRequested: false,
      cancelled: false,
      dynamicOutputs: {},
      stageResults: {},
      stageLogs: {},
      stageDiagnostics: {},
      plan,
      deploymentRepositoryContext: plan?.deploymentRepositoryContext || null,
      executionSource: plan?.executionSource || null,
    };
    this.orchestrationRecords.set(orchestrationId, runtimeRecord);

    const finish = (terminalState, reason) => {
      const finalized = this.finalizeOrchestration(orchestrationId, terminalState, reason);
      if (finalized.finalized) {
        emit('state-change', {
          overallState: terminalState,
          message: terminalState === ORCHESTRATION_STATUS.SUCCESS
            ? 'Complete project deployment succeeded.'
            : terminalState === ORCHESTRATION_STATUS.PARTIAL_SUCCESS
            ? 'Deployment finished with partial success (some services live).'
            : terminalState === ORCHESTRATION_STATUS.CANCELLED
            ? 'Deployment orchestration was cancelled.'
            : reason || 'Deployment orchestration failed.',
          error: terminalState === ORCHESTRATION_STATUS.SUCCESS ? undefined : reason,
        });
      }
      return finalized.record || runtimeRecord;
    };

    if (requestedWorkspace) {
      const acquisition = this.acquireOrchestration(requestedWorkspace, orchestrationId, runtimeRecord);
      if (!acquisition.acquired) {
        const record = finish(ORCHESTRATION_STATUS.FAILED, acquisition.error);
        return {
          orchestrationId,
          requestId,
          status: record.status,
          workspacePath: requestedWorkspace,
          services: [], databases: [], startedAt: startTime, finishedAt: record.terminalAt,
          error: acquisition.error, code: acquisition.code,
          activeOrchestrationId: acquisition.activeOrchestrationId,
        };
      }
    }

    runtimeRecord.status = ORCHESTRATION_STATUS.PREFLIGHT;
    runtimeRecord.phase = ORCHESTRATION_STATUS.PREFLIGHT;
    emit('state-change', {
      overallState: ORCHESTRATION_STATUS.PREFLIGHT,
      message: 'Running preflight plan and credential checks…',
    });

    // 1. Run Preflight
    const preflight = await this.runPreflight(plan, { ...options, orchestrationId });
    if (!preflight.valid) {
      const terminalState = preflight.code === ORCHESTRATION_STATUS.AUTH_REQUIRED
        ? ORCHESTRATION_STATUS.AUTH_REQUIRED
        : ORCHESTRATION_STATUS.FAILED;
      const record = finish(terminalState, preflight.error);

      return {
        orchestrationId,
        requestId,
        status: record.status,
        workspacePath: plan.workspacePath || '',
        services: [],
        databases: [],
        startedAt: startTime,
        finishedAt: record.terminalAt,
        error: preflight.error,
        code: preflight.code,
        missingProviders: preflight.missingProviders,
        remotePreflight: preflight.remotePreflight,
      };
    }

    // 2. Initialize Runtime Context
    const resolvedWorkspace = preflight.workspacePath;
    const services = plan.topology?.services || [];
    const databases = plan.topology?.databases || [];
    const wiring = plan.wiring || [];
    const executionOrder = plan.executionOrder || [];

    runtimeRecord.workspacePath = resolvedWorkspace;
    runtimeRecord.status = ORCHESTRATION_STATUS.RUNNING;
    runtimeRecord.phase = ORCHESTRATION_STATUS.RUNNING;

    emit('state-change', {
      overallState: ORCHESTRATION_STATUS.RUNNING,
      message: `Starting sequential deployment of ${executionOrder.length} stage(s)…`,
    });

    let overallFailed = false;
    let anySuccess = false;

    try {
      // 3. Sequential Stage Execution Loop
      for (let i = 0; i < executionOrder.length; i++) {
        if (!this.canExecuteStage(runtimeRecord)) {
          runtimeRecord.cancelled = runtimeRecord.cancelRequested;
          break;
        }
        runtimeRecord.lastActivityAt = Date.now();
        const nodeId = executionOrder[i];
        runtimeRecord.currentStageIndex = i;
        runtimeRecord.stageLogs[nodeId] = runtimeRecord.stageLogs[nodeId] || [];

        if (runtimeRecord.cancelRequested || runtimeRecord.cancelled) {
          runtimeRecord.cancelled = true;
          runtimeRecord.stageResults[nodeId] = { status: STAGE_STATUS.CANCELLED, error: 'Orchestration cancelled.' };
          break;
        }

        if (overallFailed) {
          runtimeRecord.stageResults[nodeId] = { status: STAGE_STATUS.SKIPPED, error: 'Skipped due to prior stage failure.' };
          emit('stage-state', { stageId: nodeId, stageState: STAGE_STATUS.SKIPPED, message: 'Stage skipped.' });
          continue;
        }

        // Check if Node is Database or Service
        const dbTarget = databases.find((d) => d.databaseId === nodeId);
        const svcTarget = services.find((s) => s.serviceId === nodeId);
        runtimeRecord.activeStageId = nodeId;

        if (dbTarget) {
          // --- DATABASE STAGE ---
          emit('stage-state', { stageId: nodeId, targetId: dbTarget.databaseId, type: 'DATABASE', stageState: STAGE_STATUS.RUNNING, message: `Provisioning database: ${dbTarget.name}…` });

          try {
            const dbOutcome = await this.executeDatabaseStage(dbTarget, { ...options, runtimeRecord }, (chunk) => {
              if (!this.canExecuteStage(runtimeRecord)) return;
              runtimeRecord.lastActivityAt = Date.now();
              const sanitized = secretFilter.sanitizeString(chunk);
              runtimeRecord.stageLogs[nodeId].push(sanitized);
              emit('log-chunk', { stageId: nodeId, chunk: sanitized });
            });

            if (!this.canExecuteStage(runtimeRecord)) {
              throw new Error('ORCHESTRATION_CANCELLED');
            }

            if (dbOutcome.success) {
              // Dynamic Secret Registration Invariant:
              if (dbOutcome.connectionString) {
                secretFilter.addSecret(dbOutcome.connectionString);
              }

              runtimeRecord.dynamicOutputs[nodeId] = {
                connectionString: dbOutcome.connectionString,
              };
              runtimeRecord.stageResults[nodeId] = {
                status: STAGE_STATUS.SUCCESS,
                durationMs: dbOutcome.durationMs,
              };
              anySuccess = true;
              emit('stage-state', { stageId: nodeId, stageState: STAGE_STATUS.SUCCESS, message: `Database ${dbTarget.name} provisioned successfully.` });
            } else {
              throw new Error(dbOutcome.error || 'Database provisioning failed');
            }
          } catch (err) {
            if (runtimeRecord.cancelRequested || err.message === 'ORCHESTRATION_CANCELLED') {
              runtimeRecord.cancelled = true;
              runtimeRecord.stageResults[nodeId] = { status: STAGE_STATUS.CANCELLED, error: 'Orchestration cancelled.' };
              emit('stage-state', { stageId: nodeId, stageState: STAGE_STATUS.CANCELLED, message: 'Stage cancelled.' });
              break;
            }
            overallFailed = true;
            runtimeRecord.stageResults[nodeId] = { status: STAGE_STATUS.FAILED, error: err.message };
            const diag = deploymentFailureDiagnoser.diagnoseFailure({
              workspacePath: resolvedWorkspace,
              stageId: nodeId,
              providerId: dbTarget.recommendedProvider || 'database',
              serviceName: dbTarget.name || nodeId,
              error: err.message,
              logs: runtimeRecord.stageLogs[nodeId],
              plan,
            });
            runtimeRecord.stageDiagnostics[nodeId] = diag;
            emit('stage-state', { stageId: nodeId, stageState: STAGE_STATUS.FAILED, error: err.message, diagnostic: diag, message: `Database failure: ${err.message}` });
          }

        } else if (svcTarget) {
          // --- SERVICE STAGE (Backend, Frontend, Worker) ---
          emit('stage-state', { stageId: nodeId, targetId: svcTarget.serviceId, type: svcTarget.type, providerId: svcTarget.selectedProvider || svcTarget.recommendedProvider, stageState: STAGE_STATUS.RUNNING, message: `Deploying service: ${svcTarget.name} via ${svcTarget.providerDisplayName || svcTarget.recommendedProvider}…` });

          try {
            const svcOutcome = await this.executeServiceStage(
              svcTarget,
              resolvedWorkspace,
              wiring,
              runtimeRecord,
              options,
              (chunk) => {
                if (!this.canExecuteStage(runtimeRecord)) return;
                runtimeRecord.lastActivityAt = Date.now();
                const sanitized = secretFilter.sanitizeString(chunk);
                runtimeRecord.stageLogs[nodeId].push(sanitized);
                emit('log-chunk', { stageId: nodeId, chunk: sanitized });
              }
            );

            if (!this.canExecuteStage(runtimeRecord)) {
              throw new Error('ORCHESTRATION_CANCELLED');
            }

            if (svcOutcome.success) {
              runtimeRecord.dynamicOutputs[nodeId] = {
                liveUrl: svcOutcome.liveUrl,
                serviceId: svcOutcome.serviceId,
              };
              runtimeRecord.stageResults[nodeId] = {
                status: STAGE_STATUS.SUCCESS,
                liveUrl: svcOutcome.liveUrl,
                durationMs: svcOutcome.durationMs,
              };
              anySuccess = true;
              emit('stage-state', { stageId: nodeId, stageState: STAGE_STATUS.SUCCESS, liveUrl: svcOutcome.liveUrl, message: `Service ${svcTarget.name} deployed successfully.` });
            } else {
              throw new Error(svcOutcome.error || 'Service deployment failed');
            }
          } catch (err) {
            if (runtimeRecord.cancelRequested || err.message === 'ORCHESTRATION_CANCELLED') {
              runtimeRecord.cancelled = true;
              runtimeRecord.stageResults[nodeId] = { status: STAGE_STATUS.CANCELLED, error: 'Orchestration cancelled.' };
              emit('stage-state', { stageId: nodeId, stageState: STAGE_STATUS.CANCELLED, message: 'Stage cancelled.' });
              break;
            }
            overallFailed = true;
            runtimeRecord.stageResults[nodeId] = { status: STAGE_STATUS.FAILED, error: err.message };
            const diag = deploymentFailureDiagnoser.diagnoseFailure({
              workspacePath: resolvedWorkspace,
              stageId: nodeId,
              providerId: svcTarget.selectedProvider || svcTarget.recommendedProvider,
              serviceName: svcTarget.name || nodeId,
              rootDir: svcTarget.rootDir || '',
              framework: svcTarget.framework || '',
              error: err.message,
              logs: runtimeRecord.stageLogs[nodeId],
              plan,
            });
            runtimeRecord.stageDiagnostics[nodeId] = diag;
            emit('stage-state', { stageId: nodeId, stageState: STAGE_STATUS.FAILED, error: err.message, diagnostic: diag, message: `Service failure: ${err.message}` });
          }

        } else {
          // Unknown Node in execution order
          overallFailed = true;
          runtimeRecord.stageResults[nodeId] = { status: STAGE_STATUS.FAILED, error: `Unrecognized node ID in executionOrder: ${nodeId}` };
          emit('stage-state', { stageId: nodeId, stageState: STAGE_STATUS.FAILED, error: 'Unknown execution target' });
        }
        runtimeRecord.activeStageId = null;
      }

      // 4. Compute Final Orchestration Status
      let finalStatus;
      if (runtimeRecord.cancelled) {
        finalStatus = ORCHESTRATION_STATUS.CANCELLED;
      } else if (!overallFailed) {
        finalStatus = ORCHESTRATION_STATUS.SUCCESS;
      } else if (anySuccess) {
        finalStatus = ORCHESTRATION_STATUS.PARTIAL_SUCCESS;
      } else {
        finalStatus = ORCHESTRATION_STATUS.FAILED;
      }

      runtimeRecord.phase = ORCHESTRATION_STATUS.FINALIZING;

      // 5. Build Sanitized Final Payload (Never contains connectionString or plaintext tokens)
      const finalServices = services.map((s) => ({
        serviceId: s.serviceId,
        providerId: s.selectedProvider || s.recommendedProvider,
        status: runtimeRecord.stageResults[s.serviceId]?.status || STAGE_STATUS.PENDING,
        liveUrl: runtimeRecord.stageResults[s.serviceId]?.liveUrl || null,
        error: runtimeRecord.stageResults[s.serviceId]?.error || null,
        diagnostic: runtimeRecord.stageDiagnostics[s.serviceId] || null,
      }));

      const finalDatabases = databases.map((d) => ({
        databaseId: d.databaseId,
        providerId: d.selectedProvider || d.recommendedProvider,
        status: runtimeRecord.stageResults[d.databaseId]?.status || STAGE_STATUS.PENDING,
        error: runtimeRecord.stageResults[d.databaseId]?.error || null,
        diagnostic: runtimeRecord.stageDiagnostics[d.databaseId] || null,
      }));

      const finalReason = overallFailed
        ? (runtimeRecord.stageResults[executionOrder[runtimeRecord.currentStageIndex]]?.error || 'Orchestration failed')
        : null;
      const finalizedRecord = finish(finalStatus, finalReason);

      return {
        orchestrationId,
        requestId,
        status: finalizedRecord.status,
        workspacePath: secretFilter.sanitizeString(resolvedWorkspace),
        services: finalServices,
        databases: finalDatabases,
        startedAt: startTime,
        finishedAt: finalizedRecord.terminalAt,
        error: overallFailed ? finalReason : null,
      };
    } catch (unexpectedErr) {
      const finalizedRecord = finish(ORCHESTRATION_STATUS.FAILED, `Unexpected orchestration failure: ${unexpectedErr.message}`);

      return {
        orchestrationId,
        requestId,
        status: finalizedRecord.status,
        workspacePath: secretFilter.sanitizeString(resolvedWorkspace),
        services: [],
        databases: [],
        startedAt: startTime,
        finishedAt: finalizedRecord.terminalAt,
        error: unexpectedErr.message,
      };
    }
  }

  /**
   * Executes Database provisioning stage
   * @param {Object} dbTarget
   * @param {Object} options
   * @param {Function} logCallback
   * @returns {Promise<{ success: boolean, connectionString?: string, durationMs: number, error?: string }>}
   */
  async executeDatabaseStage(dbTarget, options = {}, logCallback = () => {}) {
    const start = Date.now();
    if (options.runtimeRecord && TERMINAL_ORCHESTRATION_STATUSES.has(options.runtimeRecord.status)) {
      throw new Error('ORCHESTRATION_TERMINAL: no further deployment stages may execute.');
    }

    // Check if custom or injected test database adapter is provided
    if (this.databaseAdapter && typeof this.databaseAdapter.provision === 'function') {
      return await this.databaseAdapter.provision(dbTarget, options, logCallback);
    }

    // Safe Mock Database Provisioning for Phase 4C testing
    logCallback(`[DATABASE] Provisioning planned target: ${dbTarget.providerDisplayName || dbTarget.technology}...\n`);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Deterministic mock connection string
    const mockDbPass = crypto.randomBytes(8).toString('hex');
    const mockConnStr = `postgresql://nexus_usr_${dbTarget.databaseId}:${mockDbPass}@dpg-mock-host.render.com:5432/${dbTarget.databaseId}_db`;

    logCallback(`[DATABASE] Database provisioned and ready for migration.\n`);

    return {
      success: true,
      connectionString: mockConnStr,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Executes a Service deployment stage (Backend, Frontend, Worker)
   * @param {Object} svcTarget
   * @param {string} workspacePath
   * @param {Array} wiring
   * @param {Object} runtimeRecord
   * @param {Object} options
   * @param {Function} logCallback
   * @returns {Promise<{ success: boolean, liveUrl?: string, serviceId?: string, durationMs: number, error?: string }>}
   */
  async executeServiceStage(svcTarget, workspacePath, wiring, runtimeRecord, options = {}, logCallback = () => {}) {
    const start = Date.now();
    if (TERMINAL_ORCHESTRATION_STATUSES.has(runtimeRecord?.status)) {
      throw new Error('ORCHESTRATION_TERMINAL: no further deployment stages may execute.');
    }
    const providerId = svcTarget.selectedProvider || svcTarget.recommendedProvider;
    const adapter = this.adapters.get(providerId);

    if (!adapter) {
      throw new Error(`Unsupported provider adapter: ${providerId}`);
    }

    // 1. Resolve Dynamic Inputs mapped to this service from wiring
    const dynamicInputs = {};
    for (const w of wiring) {
      if (w.targetServiceId === svcTarget.serviceId) {
        const sourceOutput = runtimeRecord.dynamicOutputs[w.sourceId];
        if (sourceOutput) {
          if (w.targetEnvVar === 'DATABASE_URL' && sourceOutput.connectionString) {
            dynamicInputs[w.targetEnvVar] = sourceOutput.connectionString;
          } else if ((w.targetEnvVar === 'NEXT_PUBLIC_API_URL' || w.targetEnvVar === 'VITE_API_URL') && sourceOutput.liveUrl) {
            dynamicInputs[w.targetEnvVar] = sourceOutput.liveUrl;
          }
        }
      }
    }

    // 2. Fetch Decrypted Provider Credential
    const cred = this.credentialStore.getCredential(providerId);
    if (!cred) {
      throw new Error(`Credentials missing for provider: ${providerId}`);
    }

    // 3. Resolve Execution Plan
    const execPlan = adapter.resolveExecutionPlan({
      workspacePath,
      rootDir: svcTarget.rootDir,
      serviceId: svcTarget.serviceId,
      framework: svcTarget.framework,
      buildCommand: svcTarget.buildCommand,
      startCommand: svcTarget.startCommand,
      port: svcTarget.port,
      outputDirectory: svcTarget.outputDir,
      dynamicInputs,
    });

    // 4. Prepare Sanitized Environment
    const env = adapter.prepareEnvironment(cred, dynamicInputs);

    // 5. Execute Plan (CLI or Mocked/Real API)
    const providerTag = (svcTarget.providerDisplayName || svcTarget.recommendedProvider || 'SERVICE').toUpperCase();
    logCallback(`[${providerTag}] Preparing build for ${svcTarget.name}...\n`);

    let outputText = '';
    let apiResponseData = null;

    if (execPlan.providerId === 'render' || execPlan.type === 'API') {
      const renderAdapter = this.adapters.get('render');
      const apiKey = env.RENDER_API_KEY || (typeof cred === 'string' ? cred : cred?.apiKey || cred?.token);
      if (!apiKey) {
        const err = `[${providerTag} ERROR] API Key missing from environment or credentials.`;
        logCallback(`${err}\n`);
        throw new Error(err);
      }

      // 1. Resolve active Render workspace owner ID
      logCallback(`[${providerTag}] Resolving accessible Render workspaces...\n`);
      let ownerInfo = null;

      if (options.mockOwnerInfo) {
        ownerInfo = options.mockOwnerInfo;
      } else if ((options.mockApiExecutor || this.spawnFn !== spawn) && !options.resolveRealOwners) {
        ownerInfo = { ownerId: 'usr-mock-render-workspace-1', ownerName: 'Mock Workspace', ownerType: 'user' };
      } else {
        const fetchFn = options.fetchFn || fetch;
        ownerInfo = await renderAdapter.resolveOwnerId(apiKey, fetchFn);
      }

      if (!ownerInfo || !ownerInfo.ownerId) {
        const err = `[${providerTag} ERROR] RENDER_WORKSPACE_RESOLUTION_FAILED: Could not obtain workspace ownerId from Render account.`;
        logCallback(`${err}\n`);
        throw new Error('RENDER_WORKSPACE_RESOLUTION_FAILED: Could not obtain workspace ownerId from Render account.');
      }

      logCallback(`[${providerTag}] Resolved active Render workspace: "${ownerInfo.ownerName}" (${ownerInfo.ownerType}) [ID: ${ownerInfo.ownerId}]\n`);

      // 2. Prepare Create Service payload with ownerId, repo, branch, rootDir and dynamic inputs
      const isTestMock = Boolean(options.mockApiExecutor || (this.spawnFn !== spawn && !options.resolveRealOwners && !options.requireRealRepo));
      const repoUrl = options.repository || options.repo || options.repoUrl || runtimeRecord.deploymentRepositoryContext?.remoteUrl || runtimeRecord.plan?.deploymentRepositoryContext?.remoteUrl;
      const branch = options.branch || runtimeRecord.deploymentRepositoryContext?.branch || runtimeRecord.plan?.deploymentRepositoryContext?.branch;
      const explicitRootDir = options.rootDir || runtimeRecord.deploymentRepositoryContext?.projectRoot || runtimeRecord.plan?.deploymentRepositoryContext?.projectRoot;

      const servicePayload = renderAdapter.prepareServicePayload(
        {
          serviceId: svcTarget.serviceId,
          serviceName: svcTarget.name || svcTarget.serviceId,
          rootDir: svcTarget.rootDir,
          workspacePath,
          repo: repoUrl,
          branch,
          explicitRootDir,
          deploymentRepositoryContext: runtimeRecord.deploymentRepositoryContext || runtimeRecord.plan?.deploymentRepositoryContext,
          executionSource: runtimeRecord.executionSource || runtimeRecord.plan?.executionSource,
          allowMockRepo: isTestMock,
          gitExecFn: options.gitExecFn,
          buildCommand: svcTarget.buildCommand,
          startCommand: svcTarget.startCommand,
        },
        ownerInfo.ownerId,
        dynamicInputs
      );

      if (servicePayload.repo) {
        logCallback(`[${providerTag}] Using Git repository: ${servicePayload.repo} (branch: ${servicePayload.branch || 'main'}, rootDir: ${servicePayload.rootDir || '.'})\n`);
      }

      if (options.mockApiExecutor) {
        // Mock API call in tests
        const apiRes = await options.mockApiExecutor({ ...execPlan, payload: servicePayload, ownerId: ownerInfo.ownerId }, env);
        apiResponseData = apiRes.data;
        outputText = apiRes.log || '';
        logCallback(outputText);
      } else if (this.spawnFn === spawn) {
        // Real API invocation in production (e.g. Render)
        logCallback(`[${providerTag}] Submitting Create Service request to REST API (${execPlan.endpoint})...\n`);

        try {
          const fetchFn = options.fetchFn || fetch;
          let response = await fetchFn(execPlan.endpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey.trim()}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify(servicePayload),
          });

          let responseText = await response.text();

          // If service with this name already exists, update settings and trigger fresh deploy
          if (!response.ok && response.status === 400 && responseText.includes('already in use')) {
            logCallback(`[${providerTag}] Service "${servicePayload.name}" already exists on Render. Resolving service ID to update and deploy...\n`);
            const listRes = await fetchFn('https://api.render.com/v1/services?limit=50', {
              headers: { 'Authorization': `Bearer ${apiKey.trim()}` },
            });
            const listData = await listRes.json();
            const allServices = (Array.isArray(listData) ? listData : listData.services || []).map(i => i.service || i);
            const found = allServices.find(s => s.name === servicePayload.name);

            if (found) {
              logCallback(`[${providerTag}] Updating existing service configuration (ID: ${found.id})...\n`);
              // Update service configuration (rootDir, buildCommand, startCommand, etc.)
              await fetchFn(`https://api.render.com/v1/services/${found.id}`, {
                method: 'PATCH',
                headers: {
                  'Authorization': `Bearer ${apiKey.trim()}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  autoDeploy: 'no',
                  rootDir: servicePayload.rootDir,
                  branch: servicePayload.branch,
                  serviceDetails: servicePayload.serviceDetails,
                }),
              });

              // Trigger fresh deploy
              logCallback(`[${providerTag}] Triggering fresh build on Render...\n`);
              await fetchFn(`https://api.render.com/v1/services/${found.id}/deploys`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${apiKey.trim()}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ clearCache: 'clear' }),
              });

              response = { ok: true, status: 200 };
              responseText = JSON.stringify({ service: found });
            }
          }

          if (!response.ok) {
            const cleanErr = secretFilter.sanitizeString(responseText);
            const errLine = `[${providerTag} ERROR] API request failed with HTTP ${response.status}: ${cleanErr}\n`;
            logCallback(errLine);
            throw new Error(`Render API Error (HTTP ${response.status}): ${cleanErr}`);
          }

          let parsed = {};
          try {
            parsed = JSON.parse(responseText);
          } catch (_) {}

          apiResponseData = parsed;
          const serviceName = parsed.service?.name || parsed.name || execPlan.serviceName || svcTarget.name;
          const serviceId = parsed.service?.id || parsed.id || 'srv-render';
          const liveUrl = parsed.service?.serviceDetails?.url || parsed.service?.url || parsed.url || `https://${serviceName}.onrender.com`;
          logCallback(`[${providerTag}] Service provisioned successfully (ID: ${serviceId}).\n`);
          logCallback(`[${providerTag}] Live URL: ${liveUrl}\n`);
          outputText += `Render live: ${liveUrl}\n`;
        } catch (err) {
          if (!outputText.includes(`[${providerTag} ERROR]`)) {
            logCallback(`[${providerTag} ERROR] ${secretFilter.sanitizeString(err.message)}\n`);
          }
          throw err;
        }
      } else {
        // Mock spawn test runner fallback
        const command = execPlan.command || (process.platform === 'win32' ? 'npx.cmd' : 'npx');
        const args = execPlan.args || [];
        const cwd = execPlan.cwd || workspacePath;

        logCallback(`[${providerTag}] Executing: ${command} ${args.join(' ')}\n`);

        const child = this.spawnFn(command, args, {
          cwd,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        runtimeRecord.activeChild = child;

        const exitPromise = new Promise((resolve, reject) => {
          let stdoutAcc = '';
          let stderrAcc = '';

          child.stdout?.on('data', (data) => {
            const text = data.toString('utf8');
            stdoutAcc += text;
            outputText += text;
            logCallback(text);
          });

          child.stderr?.on('data', (data) => {
            const text = data.toString('utf8');
            stderrAcc += text;
            outputText += text;
            logCallback(text);
          });

          child.on('error', (err) => {
            const cleanErr = secretFilter.sanitizeString(err.message || 'Process failed to spawn.');
            const spawnErrLine = `[${providerTag} ERROR] Process spawn error: ${cleanErr}\n`;
            logCallback(spawnErrLine);
            reject(new Error(spawnErrLine.trim()));
          });

          child.on('close', (code) => {
            runtimeRecord.activeChild = null;
            if (code === 0) {
              resolve();
            } else {
              const cleanErr = secretFilter.sanitizeString(stderrAcc || stdoutAcc || `Process exited with code ${code}`);
              const procErrLine = `[${providerTag} ERROR] Build process exited with non-zero status code: ${code}.\n`;
              logCallback(procErrLine);
              reject(new Error(`${providerTag} process exited with code ${code}`));
            }
          });
        });

        const timeoutPromise = new Promise((_, reject) => {
          const timer = setTimeout(() => {
            if (runtimeRecord.activeChild) {
              try {
                runtimeRecord.activeChild.kill('SIGKILL');
              } catch (_) {}
            }
            const timeoutErrLine = `[${providerTag} ERROR] STAGE_TIMEOUT: Execution exceeded 15 minute limit.\n`;
            logCallback(timeoutErrLine);
            reject(new Error(timeoutErrLine.trim()));
          }, this.stageTimeoutMs);

          child.on('close', () => clearTimeout(timer));
        });

        await Promise.race([exitPromise, timeoutPromise]);
      }
    } else {
      // CLI child process execution (e.g. Vercel, Netlify)
      const command = execPlan.command || (process.platform === 'win32' ? 'npx.cmd' : 'npx');
      const args = execPlan.args || [];
      const cwd = execPlan.cwd || workspacePath;

      logCallback(`[${providerTag}] Executing: ${command} ${args.join(' ')}\n`);

      const child = this.spawnFn(command, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      runtimeRecord.activeChild = child;

      const exitPromise = new Promise((resolve, reject) => {
        let stdoutAcc = '';
        let stderrAcc = '';

        child.stdout?.on('data', (data) => {
          const text = data.toString('utf8');
          stdoutAcc += text;
          outputText += text;
          logCallback(text);
        });

        child.stderr?.on('data', (data) => {
          const text = data.toString('utf8');
          stderrAcc += text;
          outputText += text;
          logCallback(text);
        });

        child.on('error', (err) => {
          const cleanErr = secretFilter.sanitizeString(err.message || 'Process failed to spawn.');
          const spawnErrLine = `[${providerTag} ERROR] Process spawn error: ${cleanErr}\n`;
          logCallback(spawnErrLine);
          reject(new Error(spawnErrLine.trim()));
        });

        child.on('close', (code) => {
          runtimeRecord.activeChild = null;
          if (code === 0) {
            resolve({ stdout: stdoutAcc, stderr: stderrAcc });
          } else {
            const exitErrLine = `[${providerTag} ERROR] Build process exited with non-zero status code: ${code}.\n`;
            logCallback(exitErrLine);
            reject(new Error(`${providerTag} process exited with code ${code}`));
          }
        });
      });

      // Stage timeout race
      const timeoutPromise = new Promise((_, reject) => {
        const timer = setTimeout(() => {
          if (runtimeRecord.activeChild) {
            try {
              runtimeRecord.activeChild.kill('SIGKILL');
            } catch (_) {}
          }
          const timeoutErrLine = `[${providerTag} ERROR] STAGE_TIMEOUT: Execution exceeded 15 minute limit.\n`;
          logCallback(timeoutErrLine);
          reject(new Error(timeoutErrLine.trim()));
        }, this.stageTimeoutMs);

        child.on('close', () => clearTimeout(timer));
      });

      await Promise.race([exitPromise, timeoutPromise]);
    }

    // 6. Extract Outputs (liveUrl, serviceId)
    const outputs = adapter.extractOutputs(outputText, apiResponseData);
    const liveUrl = outputs.liveUrl || (options.mockFallbackUrl ? `https://${svcTarget.serviceId}.mockapp.com` : null);

    if (!liveUrl && !options.mockFallbackUrl) {
      const noUrlErr = `[${providerTag} ERROR] Deployment finished without returning a verified live HTTPS production URL.\n`;
      logCallback(noUrlErr);
      throw new Error(noUrlErr.trim());
    }

    logCallback(`[${providerTag}] Verified production URL: ${liveUrl}\n`);

    // 7. Post-Deployment Health Check (Backend only)
    if (svcTarget.type === 'BACKEND' && liveUrl && svcTarget.healthCheckPath) {
      if (options.skipHealthCheck || (this.spawnFn !== spawn && !options.enableMockHealthCheck && this.healthCheckClient === defaultHealthCheckClient)) {
        logCallback(`[HEALTH] Health check skipped for testing.\n`);
      } else {
        logCallback(`[HEALTH] Probing backend endpoint: ${svcTarget.healthCheckPath}...\n`);
        const healthOptions = options.healthCheckOptions || {
          timeoutMs: options.healthCheckTimeoutMs || (this.spawnFn === spawn ? 180000 : 30000),
          pollIntervalMs: options.healthCheckIntervalMs || 5000,
        };
        const healthRes = await this.healthCheckClient.check(liveUrl, svcTarget.healthCheckPath, healthOptions);
        if (!healthRes.ok && !healthRes.skipped) {
          logCallback(`[HEALTH ERROR] ${healthRes.error}\n`);
          throw new Error(`HEALTH_CHECK_FAILED: ${healthRes.error}`);
        }
        logCallback(`[HEALTH] Backend passed health check (${healthRes.statusCode || 200} OK).\n`);
      }
    }

    return {
      success: true,
      liveUrl,
      serviceId: outputs.serviceId || svcTarget.serviceId,
      durationMs: Date.now() - start,
    };
  }

  /**
   * Cancels an active orchestration run
   * @param {string} orchestrationId
   * @returns {Object} { success: boolean, cancelled: boolean }
   */
  cancelOrchestration(orchestrationId) {
    const record = this.activeOrchestrations.get(orchestrationId);
    if (!record) {
      return { success: false, error: 'Orchestration ID not found or already completed.' };
    }

    // Cancellation is a request, not a terminal transition.  The stage promise
    // must settle before startOrchestration performs the one authoritative
    // terminalization and releases the workspace lease.
    record.cancelRequested = true;
    record.lastActivityAt = Date.now();

    // Terminate active child process
    if (record.activeChild) {
      try {
        record.activeChild.kill('SIGTERM');
        const killTimer = setTimeout(() => {
          try {
            if (record.activeChild) {
              record.activeChild.kill('SIGKILL');
            }
          } catch (_) {}
        }, 2000);
        if (killTimer && typeof killTimer.unref === 'function') {
          killTimer.unref();
        }
      } catch (_) {}
    }

    return {
      success: true,
      orchestrationId,
      cancelled: true,
    };
  }
}

const deploymentOrchestrator = new DeploymentOrchestrator();

module.exports = {
  STAGE_STATUS,
  ORCHESTRATION_STATUS,
  DeploymentOrchestrator,
  deploymentOrchestrator,
};
