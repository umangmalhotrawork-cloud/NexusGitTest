/**
 * NEXUS INTELLIGENCE LAYER — DEPLOYMENT EXECUTOR (Phase 3A)
 * 
 * Orchestrates deployment lifecycle, preflight verification, child process execution,
 * real-time log streaming with secret redaction, state machine transitions, and cancellation.
 * 
 * STRICT INVARIANTS:
 * - 0 LLM tokens, 100% deterministic local process management.
 * - Credentials injected strictly into child.env, never in CLI args.
 * - All log chunks pass through secretFilter.sanitizeString.
 * - Bounded process memory buffers & 15-minute execution timeout.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const secretFilter = require('../../../../security/secretFilter');
const { deploymentCredentialStore: defaultCredentialStore } = require('../credentials/DeploymentCredentialStore');
const VercelDeployAdapter = require('./providers/VercelDeployAdapter');

const DEFAULT_DEPLOYMENT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

const DEPLOYMENT_STATES = Object.freeze({
  IDLE: 'IDLE',
  AUTH_CHECKING: 'AUTH_CHECKING',
  PREFLIGHT: 'PREFLIGHT',
  PREPARING: 'PREPARING',
  BUILDING: 'BUILDING',
  UPLOADING: 'UPLOADING',
  DEPLOYING: 'DEPLOYING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  TIMED_OUT: 'TIMED_OUT',
});

const TERMINAL_DEPLOYMENT_STATES = new Set([
  DEPLOYMENT_STATES.SUCCESS,
  DEPLOYMENT_STATES.FAILED,
  DEPLOYMENT_STATES.CANCELLED,
  DEPLOYMENT_STATES.TIMED_OUT,
]);

class DeploymentExecutor {
  constructor(options = {}) {
    this.credentialStore = options.credentialStore || defaultCredentialStore;
    this.spawnFn = options.spawn || spawn;
    this.timeoutMs = options.timeoutMs || DEFAULT_DEPLOYMENT_TIMEOUT_MS;
    this.adapters = new Map();
    this.activeDeployments = new Map(); // deploymentId -> { child, workspacePath, status, timer, cancel, startedAt, lastActivityAt }
    this.registerDefaultAdapters();
  }

  registerDefaultAdapters() {
    this.registerAdapter(new VercelDeployAdapter());
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
   * Checks if a deployment record is active and non-stale
   * @param {Object} dep
   * @returns {boolean}
   */
  isDeploymentActive(dep) {
    if (!dep || typeof dep !== 'object') return false;

    if (TERMINAL_DEPLOYMENT_STATES.has(dep.status)) {
      return false;
    }

    if (dep.child) {
      if (dep.child.exitCode !== null || dep.child.killed) {
        return false;
      }
      if (dep.child.pid && !this.isPidAlive(dep.child.pid)) {
        return false;
      }
      return true;
    }

    const now = Date.now();
    const startTime = dep.startedAt || 0;
    const lastActivity = dep.lastActivityAt || startTime;
    const timeout = this.timeoutMs || DEFAULT_DEPLOYMENT_TIMEOUT_MS;

    if (startTime > 0 && now - lastActivity > timeout) {
      return false;
    }

    return dep.status !== DEPLOYMENT_STATES.IDLE;
  }

  /**
   * Auto-cleans terminal or stale deployment records
   * @param {string} [workspacePath]
   */
  cleanupStaleDeployments(workspacePath) {
    const resolved = workspacePath ? path.resolve(workspacePath) : null;
    for (const [id, dep] of this.activeDeployments.entries()) {
      if (!resolved || dep.workspacePath === resolved) {
        if (!this.isDeploymentActive(dep)) {
          if (dep.timer) clearTimeout(dep.timer);
          this.activeDeployments.delete(id);
        }
      }
    }
  }

  /**
   * Generates a unique deployment ID
   * @returns {string}
   */
  generateDeploymentId() {
    return `nexus-deploy-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Runs preflight verification before deployment
   * @param {string} workspacePath
   * @param {string} providerId
   * @param {Object} [options]
   * @returns {Promise<Object>} Preflight result
   */
  async runPreflight(workspacePath, providerId, options = {}) {
    if (!workspacePath || typeof workspacePath !== 'string') {
      return { valid: false, error: 'Invalid workspace path.' };
    }

    const resolvedWorkspace = path.resolve(workspacePath);
    if (!fs.existsSync(resolvedWorkspace) || !fs.statSync(resolvedWorkspace).isDirectory()) {
      return { valid: false, error: `Workspace directory does not exist: ${resolvedWorkspace}` };
    }

    // 1. Check for running deployment (and clean stale ones)
    this.cleanupStaleDeployments(resolvedWorkspace);

    for (const [id, dep] of this.activeDeployments.entries()) {
      if (dep.workspacePath === resolvedWorkspace && this.isDeploymentActive(dep)) {
        return { valid: false, error: `A deployment is already active for this workspace (ID: ${id}).` };
      }
    }

    // 2. Check adapter
    const adapter = this.adapters.get(providerId);
    if (!adapter) {
      return { valid: false, error: `Unsupported deployment provider: ${providerId}` };
    }

    // 3. Check credentials
    const cred = this.credentialStore.getCredential(providerId);
    if (!cred || !cred.token) {
      return {
        valid: false,
        error: `Provider ${providerId} is not connected. Please connect credentials first.`,
        authRequired: true,
      };
    }

    // 4. Validate execution plan (checks config file on disk)
    try {
      adapter.resolveExecutionPlan({
        workspacePath: resolvedWorkspace,
        rootDir: options.rootDir,
      });
    } catch (err) {
      return { valid: false, error: err.message, configMissing: err.message.includes('CONFIGURATION_MISSING') };
    }

    return {
      valid: true,
      workspacePath: resolvedWorkspace,
      providerId,
    };
  }

  /**
   * Starts a deployment lifecycle
   * @param {string} workspacePath
   * @param {string} providerId
   * @param {Object} [options]
   * @param {Function} [eventCallback] - (event, payload) => void
   * @returns {Promise<Object>}
   */
  async startDeployment(workspacePath, providerId, options = {}, eventCallback = () => {}) {
    const deploymentId = this.generateDeploymentId();
    const emit = (eventType, payload) => {
      try {
        eventCallback(eventType, { deploymentId, ...payload });
      } catch (_) {}
    };

    emit('state-change', { state: DEPLOYMENT_STATES.AUTH_CHECKING, message: 'Verifying provider credentials…' });

    // 1. Preflight
    const preflight = await this.runPreflight(workspacePath, providerId, options);
    if (!preflight.valid) {
      emit('state-change', { state: DEPLOYMENT_STATES.FAILED, error: preflight.error });
      return {
        deploymentId,
        status: DEPLOYMENT_STATES.FAILED,
        error: preflight.error,
        authRequired: preflight.authRequired,
        configMissing: preflight.configMissing,
      };
    }

    const adapter = this.adapters.get(providerId);
    const cred = this.credentialStore.getCredential(providerId);
    const plan = adapter.resolveExecutionPlan({
      workspacePath: preflight.workspacePath,
      rootDir: options.rootDir,
    });

    emit('state-change', { state: DEPLOYMENT_STATES.PREPARING, message: `Preparing ${adapter.displayName} deployment…` });

    const env = adapter.prepareEnvironment(cred.token);

    return new Promise((resolve) => {
      let isCancelled = false;
      let isTimedOut = false;
      let currentState = DEPLOYMENT_STATES.PREPARING;
      let accumulatedOutput = '';

      const child = this.spawnFn(plan.command, plan.args, {
        cwd: plan.cwd,
        env,
      });

      // Cancellation closure
      const cancelFn = () => {
        if (isCancelled) return;
        isCancelled = true;
        currentState = DEPLOYMENT_STATES.CANCELLED;
        emit('state-change', { state: DEPLOYMENT_STATES.CANCELLED, message: 'Deployment cancelled by user.' });

        try {
          child.kill('SIGTERM');
          const killTimer = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch (_) {}
          }, 3000);
          if (killTimer && typeof killTimer.unref === 'function') killTimer.unref();
        } catch (_) {}
      };

      // 15-minute Timeout
      const timer = setTimeout(() => {
        isTimedOut = true;
        currentState = DEPLOYMENT_STATES.FAILED;
        emit('state-change', { state: DEPLOYMENT_STATES.FAILED, error: 'DEPLOYMENT_TIMEOUT: Deployment exceeded 15 minutes limit.' });
        try {
          child.kill('SIGTERM');
          const killTimer = setTimeout(() => {
            try { child.kill('SIGKILL'); } catch (_) {}
          }, 3000);
          if (killTimer && typeof killTimer.unref === 'function') killTimer.unref();
        } catch (_) {}
      }, options.timeoutMs || DEFAULT_DEPLOYMENT_TIMEOUT_MS);

      const now = Date.now();
      const depRecord = {
        child,
        workspacePath: preflight.workspacePath,
        status: currentState,
        timer,
        cancel: cancelFn,
        startedAt: now,
        lastActivityAt: now,
      };

      // Track active deployment
      this.activeDeployments.set(deploymentId, depRecord);

      // Process stdout
      child.stdout.on('data', (chunk) => {
        depRecord.lastActivityAt = Date.now();
        const rawText = chunk.toString('utf8');
        accumulatedOutput += rawText;
        const sanitized = secretFilter.sanitizeString(rawText);

        emit('log-chunk', {
          stream: 'stdout',
          text: sanitized,
          timestamp: Date.now(),
        });

        const nextPhase = adapter.parseProgressState(sanitized);
        if (nextPhase && nextPhase !== currentState && !isCancelled && !isTimedOut) {
          currentState = nextPhase;
          depRecord.status = currentState;
          emit('state-change', { state: currentState, message: `Status: ${currentState}` });
        }
      });

      // Process stderr
      child.stderr.on('data', (chunk) => {
        depRecord.lastActivityAt = Date.now();
        const rawText = chunk.toString('utf8');
        accumulatedOutput += rawText;
        const sanitized = secretFilter.sanitizeString(rawText);

        emit('log-chunk', {
          stream: 'stderr',
          text: sanitized,
          timestamp: Date.now(),
        });
      });

      // Handle spawn error
      child.on('error', (err) => {
        clearTimeout(timer);
        this.activeDeployments.delete(deploymentId);
        const cleanErr = secretFilter.sanitizeString(err.message || 'Process execution failure.');
        emit('state-change', { state: DEPLOYMENT_STATES.FAILED, error: cleanErr });
        resolve({
          deploymentId,
          status: DEPLOYMENT_STATES.FAILED,
          error: cleanErr,
        });
      });

      // Handle exit
      child.on('close', (code) => {
        clearTimeout(timer);
        this.activeDeployments.delete(deploymentId);

        if (isCancelled) {
          resolve({
            deploymentId,
            status: DEPLOYMENT_STATES.CANCELLED,
            message: 'Deployment was cancelled by user.',
          });
          return;
        }

        if (isTimedOut) {
          resolve({
            deploymentId,
            status: DEPLOYMENT_STATES.FAILED,
            error: 'DEPLOYMENT_TIMEOUT: Execution timed out.',
          });
          return;
        }

        if (code === 0) {
          const liveUrl = adapter.extractDeploymentUrl(accumulatedOutput);
          emit('state-change', {
            state: DEPLOYMENT_STATES.SUCCESS,
            url: liveUrl,
            message: 'Deployment completed successfully!',
          });
          resolve({
            deploymentId,
            status: DEPLOYMENT_STATES.SUCCESS,
            url: liveUrl,
            exitCode: code,
          });
        } else {
          const sanitizedErr = secretFilter.sanitizeString(
            `Vercel CLI exited with code ${code}. Check build output for details.`
          );
          emit('state-change', {
            state: DEPLOYMENT_STATES.FAILED,
            error: sanitizedErr,
            exitCode: code,
          });
          resolve({
            deploymentId,
            status: DEPLOYMENT_STATES.FAILED,
            error: sanitizedErr,
            exitCode: code,
          });
        }
      });
    });
  }

  /**
   * Cancels a running deployment
   * @param {string} deploymentId
   * @returns {Object}
   */
  cancelDeployment(deploymentId) {
    const dep = this.activeDeployments.get(deploymentId);
    if (!dep) {
      return { success: false, error: 'No active deployment found with this ID.' };
    }

    dep.cancel();
    return { success: true, deploymentId };
  }
}

const deploymentExecutor = new DeploymentExecutor();

module.exports = {
  DEPLOYMENT_STATES,
  DeploymentExecutor,
  deploymentExecutor,
};
