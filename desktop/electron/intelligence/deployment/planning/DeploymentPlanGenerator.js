/**
 * NEXUS INTELLIGENCE LAYER — DEPLOYMENT PLAN GENERATOR (Phase 4A)
 * 
 * Computes deterministic multi-service deployment plans:
 * - Per-service cloud provider mapping (Frontend -> Vercel, Backend -> Render, DB -> Managed Postgres)
 * - Repository evidence-based dependency graph (Database -> Backend -> Frontend)
 * - Secret vs Public environment variable wiring (DATABASE_URL, NEXT_PUBLIC_API_URL)
 * - Topological sort for multi-stage execution ordering with cycle detection
 * - Protection against secret leakage into public frontend bundles
 * 
 * STRICT INVARIANTS:
 * - 100% deterministic local computation.
 * - 0 LLM/AI tokens.
 * - 0 Network requests.
 * - Read-only analysis; does not deploy, provision, or mutate files.
 */

const crypto = require('crypto');
const path = require('path');
const secretFilter = require('../../../../security/secretFilter');
const { projectTopologyDetector, SERVICE_TYPE } = require('../topology/ProjectTopologyDetector');
const { DeploymentSelectionStore, deploymentSelectionStore: defaultSelectionStore } = require('../persistence/DeploymentSelectionStore');
const {
  REPOSITORY_SOURCE,
  EXECUTION_SOURCE,
  remoteRepositoryPreflight: defaultRemoteRepositoryPreflight,
} = require('../preflight/RemoteRepositoryPreflight');

/**
 * Plan Status
 */
const PLAN_STATUS = Object.freeze({
  READY: 'READY',
  WARNING: 'WARNING',
  BLOCKED: 'BLOCKED',
  UNKNOWN: 'UNKNOWN',
});

const EXECUTABLE_PROVIDERS = new Set([
  'vercel',
  'render',
  'netlify',
  'render_postgres',
  'render_redis',
  'embedded_sqlite',
]);

class DeploymentPlanGenerator {
  constructor(options = {}) {
    if (options.selectionStore) {
      this.selectionStore = options.selectionStore;
    } else if (options.storePath) {
      this.selectionStore = new DeploymentSelectionStore({ storePath: options.storePath });
    } else {
      this.selectionStore = defaultSelectionStore;
    }
    this.remoteRepositoryPreflight = options.remoteRepositoryPreflight || defaultRemoteRepositoryPreflight;
  }

  /**
   * Checks if a provider has an available execution adapter
   * @param {string} providerId
   * @returns {boolean}
   */
  isProviderExecutable(providerId) {
    if (!providerId) return false;
    const norm = String(providerId).toLowerCase();
    return EXECUTABLE_PROVIDERS.has(norm);
  }

  /**
   * Resolves display name, config file, and execution availability for a provider ID
   * @param {string} providerId
   * @param {Object} service
   * @returns {Object}
   */
  getProviderDetails(providerId, service = {}) {
    const norm = String(providerId || '').toLowerCase();
    const rootDir = service.rootDir || '';

    switch (norm) {
      case 'vercel':
        return {
          providerId: 'vercel',
          displayName: 'Vercel',
          configFile: rootDir ? path.join(rootDir, 'vercel.json') : 'vercel.json',
          executionAvailable: true,
        };
      case 'render':
        return {
          providerId: 'render',
          displayName: service.type === SERVICE_TYPE.WORKER ? 'Render Background Worker' : 'Render Web Service',
          configFile: rootDir ? path.join(rootDir, 'render.yaml') : 'render.yaml',
          executionAvailable: true,
        };
      case 'netlify':
        return {
          providerId: 'netlify',
          displayName: 'Netlify',
          configFile: rootDir ? path.join(rootDir, 'netlify.toml') : 'netlify.toml',
          executionAvailable: true,
        };
      case 'railway':
        return {
          providerId: 'railway',
          displayName: 'Railway',
          configFile: rootDir ? path.join(rootDir, 'railway.toml') : 'railway.toml',
          executionAvailable: false,
        };
      case 'flyio':
      case 'fly.io':
        return {
          providerId: 'flyio',
          displayName: 'Fly.io',
          configFile: rootDir ? path.join(rootDir, 'fly.toml') : 'fly.toml',
          executionAvailable: false,
        };
      case 'docker':
        return {
          providerId: 'docker',
          displayName: 'Docker / Custom Container',
          configFile: rootDir ? path.join(rootDir, 'Dockerfile') : 'Dockerfile',
          executionAvailable: false,
        };
      default:
        return {
          providerId: norm || 'unknown',
          displayName: norm ? norm.toUpperCase() : 'Unknown Provider',
          configFile: null,
          executionAvailable: false,
        };
    }
  }

  /**
   * Resolves database provider details
   * @param {string} providerId
   * @param {Object} database
   * @returns {Object}
   */
  getDatabaseProviderDetails(providerId, database = {}) {
    const norm = String(providerId || '').toLowerCase();
    switch (norm) {
      case 'render_postgres':
      case 'render':
        return {
          providerId: 'render_postgres',
          displayName: 'Managed PostgreSQL (Render/Neon)',
          isManaged: true,
          executionAvailable: true,
        };
      case 'render_redis':
        return {
          providerId: 'render_redis',
          displayName: 'Managed Redis (Render/Upstash)',
          isManaged: true,
          executionAvailable: true,
        };
      case 'railway_mysql':
      case 'railway':
        return {
          providerId: 'railway_mysql',
          displayName: 'Managed MySQL (Railway/PlanetScale)',
          isManaged: true,
          executionAvailable: false,
        };
      case 'mongodb_atlas':
        return {
          providerId: 'mongodb_atlas',
          displayName: 'MongoDB Atlas',
          isManaged: true,
          executionAvailable: false,
        };
      case 'embedded_sqlite':
        return {
          providerId: 'embedded_sqlite',
          displayName: 'Embedded SQLite (Local/Volume)',
          isManaged: false,
          executionAvailable: true,
        };
      default:
        return {
          providerId: norm || 'custom_db',
          displayName: norm ? norm.toUpperCase() : 'Custom Database Target',
          isManaged: false,
          executionAvailable: false,
        };
    }
  }
  /**
   * Generates a unique plan ID
   * @returns {string}
   */
  generatePlanId() {
    const rand = crypto.randomBytes(3).toString('hex');
    return `plan_${Date.now().toString(36)}_${rand}`;
  }

  /**
   * Recommends the best provider for a specific service target
   * @param {Object} service
   * @returns {Object} { providerId, displayName, configFile, confidence, score }
   */
  selectProviderForService(service) {
    if (!service) return { providerId: null, displayName: 'Unknown', configFile: null, confidence: 'LOW', score: 0 };

    if (service.type === SERVICE_TYPE.FRONTEND) {
      const fw = String(service.framework || '').toLowerCase();
      if (fw.includes('next') || fw.includes('remix')) {
        return {
          providerId: 'vercel',
          displayName: 'Vercel',
          configFile: service.rootDir ? path.join(service.rootDir, 'vercel.json') : 'vercel.json',
          confidence: 'HIGH',
          score: 96,
        };
      }
      if (fw.includes('vite') || service.isStaticExport) {
        return {
          providerId: 'netlify',
          displayName: 'Netlify',
          configFile: service.rootDir ? path.join(service.rootDir, 'netlify.toml') : 'netlify.toml',
          confidence: 'HIGH',
          score: 92,
        };
      }
      return {
        providerId: 'vercel',
        displayName: 'Vercel',
        configFile: service.rootDir ? path.join(service.rootDir, 'vercel.json') : 'vercel.json',
        confidence: 'MEDIUM',
        score: 85,
      };
    }

    if (service.type === SERVICE_TYPE.BACKEND) {
      if (service.framework === 'docker' || service.runtime === 'docker') {
        return {
          providerId: 'render',
          displayName: 'Render (Docker Web Service)',
          configFile: service.configFile || (service.rootDir ? path.join(service.rootDir, 'Dockerfile') : 'Dockerfile'),
          confidence: 'HIGH',
          score: 90,
        };
      }
      return {
        providerId: 'render',
        displayName: 'Render Web Service',
        configFile: service.rootDir ? path.join(service.rootDir, 'render.yaml') : 'render.yaml',
        confidence: 'HIGH',
        score: 92,
      };
    }

    if (service.type === SERVICE_TYPE.WORKER) {
      return {
        providerId: 'render',
        displayName: 'Render Background Worker',
        configFile: service.rootDir ? path.join(service.rootDir, 'render.yaml') : 'render.yaml',
        confidence: 'HIGH',
        score: 88,
      };
    }

    return {
      providerId: null,
      displayName: 'Unknown Provider',
      configFile: null,
      confidence: 'LOW',
      score: 0,
    };
  }

  /**
   * Recommends the planned provider for a database target
   * @param {Object} database
   * @returns {Object}
   */
  selectProviderForDatabase(database) {
    if (!database) return { providerId: null, displayName: 'None', isManaged: false };

    switch (database.technology) {
      case 'postgresql':
        return { providerId: 'render_postgres', displayName: 'Managed PostgreSQL (Render/Neon)', isManaged: true };
      case 'mysql':
        return { providerId: 'railway_mysql', displayName: 'Managed MySQL (Railway/PlanetScale)', isManaged: true };
      case 'redis':
        return { providerId: 'render_redis', displayName: 'Managed Redis (Render/Upstash)', isManaged: true };
      case 'mongodb':
        return { providerId: 'mongodb_atlas', displayName: 'MongoDB Atlas', isManaged: true };
      case 'sqlite':
        return { providerId: 'embedded_sqlite', displayName: 'Embedded SQLite (Local/Volume)', isManaged: false };
      default:
        return { providerId: 'custom_db', displayName: 'Custom Database Target', isManaged: false };
    }
  }

  /**
   * Performs topological sort over a dependency graph
   * @param {string[]} nodeIds
   * @param {Array<{ from: string, to: string }>} dependencies
   * @returns {{ order: string[], hasCycle: boolean }}
   */
  topologicalSort(nodeIds, dependencies) {
    const inDegree = new Map();
    const adjList = new Map();

    for (const id of nodeIds) {
      inDegree.set(id, 0);
      adjList.set(id, []);
    }

    for (const dep of dependencies) {
      if (adjList.has(dep.from) && inDegree.has(dep.to)) {
        adjList.get(dep.from).push(dep.to);
        inDegree.set(dep.to, (inDegree.get(dep.to) || 0) + 1);
      }
    }

    const queue = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) {
        queue.push(id);
      }
    }

    const order = [];
    while (queue.length > 0) {
      const u = queue.shift();
      order.push(u);

      for (const v of adjList.get(u) || []) {
        inDegree.set(v, inDegree.get(v) - 1);
        if (inDegree.get(v) === 0) {
          queue.push(v);
        }
      }
    }

    const hasCycle = order.length !== nodeIds.length;
    return {
      order: hasCycle ? [] : order,
      hasCycle,
    };
  }

  /**
   * Computes an evidence hash of key workspace configuration files
   * @param {string} workspacePath
   * @returns {string}
   */
  computeEvidenceHash(workspacePath) {
    if (!workspacePath) return '';
    try {
      const fs = require('fs');
      if (!fs.existsSync(workspacePath)) return '';

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
        if (fs.existsSync(fullPath)) {
          const stat = fs.statSync(fullPath);
          hash.update(`${file}:${stat.size}:${stat.mtimeMs}`);
        }
      }

      return hash.digest('hex');
    } catch (_) {
      return '';
    }
  }

  /**
   * Resolves the framework-appropriate public API environment variable for a frontend service
   * @param {Object} frontend
   * @param {Object} topology
   * @returns {string} e.g. 'VITE_API_URL' or 'NEXT_PUBLIC_API_URL'
   */
  resolveFrontendApiEnvVar(frontend, topology = {}) {
    if (!frontend) return 'NEXT_PUBLIC_API_URL';

    const fw = String(frontend.framework || '').toLowerCase();
    const documentedVars = topology.environmentVariables?.documented || [];
    const requiredVars = topology.environmentVariables?.required || [];
    const allKnownVars = [...new Set([...documentedVars, ...requiredVars])];

    if (fw.includes('vite')) {
      const explicitViteVar = allKnownVars.find((v) => /^VITE_.*(?:API|BACKEND|URL|SERVER)/i.test(v));
      if (explicitViteVar) return explicitViteVar;
      return 'VITE_API_URL';
    }

    if (fw.includes('next')) {
      const explicitNextVar = allKnownVars.find((v) => /^NEXT_PUBLIC_.*(?:API|BACKEND|URL|SERVER)/i.test(v));
      if (explicitNextVar) return explicitNextVar;
      return 'NEXT_PUBLIC_API_URL';
    }

    if (fw.includes('nuxt')) {
      const explicitNuxtVar = allKnownVars.find((v) => /^NUXT_PUBLIC_.*(?:API|BACKEND|URL|SERVER)/i.test(v));
      if (explicitNuxtVar) return explicitNuxtVar;
      return 'NUXT_PUBLIC_API_URL';
    }

    if (fw.includes('create-react-app') || fw.includes('cra')) {
      return 'REACT_APP_API_URL';
    }

    if (fw.includes('gatsby')) {
      return 'GATSBY_API_URL';
    }

    // Generic check across known variables for public API prefixes
    const publicCandidate = allKnownVars.find((v) =>
      /^(?:VITE_|NEXT_PUBLIC_|NUXT_PUBLIC_|REACT_APP_|PUBLIC_).*(?:API|BACKEND|URL)/i.test(v)
    );
    if (publicCandidate) return publicCandidate;

    return 'NEXT_PUBLIC_API_URL';
  }

  /**
   * Generates a complete DeploymentPlan for a workspace
   * @param {string|Object} workspaceOrTopology
   * @param {Object} [options]
   * @returns {Object} DeploymentPlan
   */
  generatePlan(workspaceOrTopology, options = {}) {
    let topology;
    let workspacePath = '';

    if (typeof workspaceOrTopology === 'string') {
      workspacePath = workspaceOrTopology;
      topology = projectTopologyDetector.detectTopology(workspacePath);
    } else if (workspaceOrTopology && typeof workspaceOrTopology === 'object') {
      topology = workspaceOrTopology;
      workspacePath = topology.workspacePath || '';
    } else {
      topology = { services: [], databases: [], environmentVariables: { required: [] } };
    }

    const planId = this.generatePlanId();
    const generatedAt = Date.now();
    const services = [];
    const databases = [];
    const dependencies = [];
    const wiring = [];
    const blockers = [];
    const warnings = [];
    let remotePreflightBlocker = null;

    // Resolve persistent user selections for this workspace
    const normWorkspace = workspacePath ? (this.selectionStore.normalizeWorkspacePath ? this.selectionStore.normalizeWorkspacePath(workspacePath) : path.resolve(workspacePath)) : '';
    if (options.clearSelections && normWorkspace) {
      this.selectionStore.clearWorkspaceSelections(normWorkspace);
    }
    const incomingSelections = options.userSelections || options.selections;
    if (incomingSelections && typeof incomingSelections === 'object' && Object.keys(incomingSelections).length > 0 && normWorkspace) {
      this.selectionStore.saveWorkspaceSelections(normWorkspace, incomingSelections);
    }
    const stored = normWorkspace ? this.selectionStore.getWorkspaceSelections(normWorkspace) : null;
    const userSelections = stored?.selections || {};
    const userSources = stored?.selectionSource || {};

    // Resolve explicit deployment repository context
    const repoContext = this.remoteRepositoryPreflight.resolveDeploymentRepositoryContext(normWorkspace || workspacePath, {
      ...options,
      repository: options.repository || userSelections.repository || userSelections.selectedRepo,
      branch: options.branch || userSelections.branch || userSelections.selectedBranch,
      rootDir: options.rootDir || userSelections.rootDir || userSelections.selectedRootDir,
    });
    
    // Determine execution source (LOCAL_WORKSPACE vs GIT_REMOTE vs UNCONFIGURED)
    let executionSource = options.executionSource || userSelections.executionSource || options.deploymentSource || null;
    if (typeof executionSource === 'string') {
      executionSource = executionSource.trim().toUpperCase();
    }
    if (!executionSource) {
      if (repoContext.repositorySource === REPOSITORY_SOURCE.WORKSPACE_GIT || repoContext.repositorySource === REPOSITORY_SOURCE.EXPLICIT_PROVIDER_REPOSITORY) {
        executionSource = EXECUTION_SOURCE.GIT_REMOTE;
      } else if (repoContext.repositorySource === REPOSITORY_SOURCE.PARENT_GIT) {
        executionSource = EXECUTION_SOURCE.UNCONFIGURED;
      } else {
        executionSource = EXECUTION_SOURCE.LOCAL_WORKSPACE;
      }
    }

    console.log('[DeploymentSelection] DeploymentPlanGenerator.generatePlan', {
      workspace: workspacePath,
      normalizedWorkspace: normWorkspace,
      incomingSelections: incomingSelections || {},
      loadedSelections: userSelections,
      hasStoredEntry: Boolean(stored),
      repositorySource: repoContext.repositorySource,
      executionSource,
    });

    // 1. Process and Map Databases
    for (const rawDb of topology.databases || []) {
      const recProv = this.selectProviderForDatabase(rawDb);
      const recProvInfo = this.getDatabaseProviderDetails(recProv.providerId, rawDb);
      const userChosen = userSelections[rawDb.databaseId];
      const selectedId = userChosen || recProv.providerId;
      const selectionSource = userChosen ? 'USER' : 'RECOMMENDATION';
      const provInfo = this.getDatabaseProviderDetails(selectedId, rawDb);
      const isExec = this.isProviderExecutable(selectedId);

      const dbTarget = {
        databaseId: rawDb.databaseId,
        name: rawDb.name || `${rawDb.technology} Database`,
        technology: rawDb.technology,
        ormOrDriver: rawDb.ormOrDriver,
        rootDir: rawDb.rootDir || '',
        configFile: rawDb.configFile,
        migrationCommand: rawDb.migrationCommand,
        recommendedProvider: recProv.providerId,
        recommendedProviderDisplayName: recProvInfo.displayName,
        selectedProvider: selectedId,
        selectionSource,
        providerDisplayName: provInfo.displayName,
        executionAvailable: isExec,
        isManaged: provInfo.isManaged,
        isSQLite: Boolean(rawDb.isSQLite),
        evidence: rawDb.evidence || [],
      };
      databases.push(dbTarget);

      if (!isExec) {
        blockers.push(`Database '${dbTarget.name}' has selected provider '${selectedId}' which does not currently have deployment execution support in NEXUS.`);
      }

      if (rawDb.isSQLite) {
        warnings.push(`Database (${rawDb.databaseId}): SQLite uses embedded file storage. Ephemeral cloud instances will lose state on restart without persistent volume mounts.`);
      }
    }

    // 2. Process and Map Services
    for (const rawSvc of topology.services || []) {
      const recProv = this.selectProviderForService(rawSvc);
      const recProvInfo = this.getProviderDetails(recProv.providerId, rawSvc);
      const userChosen = userSelections[rawSvc.serviceId];
      const selectedId = userChosen || recProv.providerId;
      const selectionSource = userChosen ? 'USER' : 'RECOMMENDATION';
      const provInfo = this.getProviderDetails(selectedId, rawSvc);
      const isExec = this.isProviderExecutable(selectedId);

      const svcTarget = {
        serviceId: rawSvc.serviceId,
        name: rawSvc.name || 'Application Service',
        type: rawSvc.type,
        rootDir: rawSvc.rootDir || '',
        framework: rawSvc.framework,
        runtime: rawSvc.runtime,
        buildCommand: rawSvc.buildCommand,
        startCommand: rawSvc.startCommand,
        port: rawSvc.port,
        outputDir: rawSvc.outputDir,
        configFile: provInfo.configFile || rawSvc.configFile,
        healthCheckPath: rawSvc.healthCheckPath,
        recommendedProvider: recProv.providerId,
        recommendedProviderDisplayName: recProvInfo.displayName,
        selectedProvider: selectedId,
        selectionSource,
        providerDisplayName: provInfo.displayName,
        executionAvailable: isExec,
        confidence: recProv.confidence,
        score: recProv.score,
        evidence: rawSvc.evidence || [],
      };
      services.push(svcTarget);

      if (!selectedId) {
        blockers.push(`Service (${svcTarget.serviceId}): No compatible cloud deployment provider detected.`);
      } else if (!isExec) {
        blockers.push(`Service '${svcTarget.name}' has selected provider '${selectedId}' which does not currently have deployment execution support in NEXUS.`);
      } else if (options.skipRemotePreflight !== true && ['render', 'vercel', 'railway', 'fly_io'].includes(selectedId)) {
        const remoteCheck = this.remoteRepositoryPreflight.verifyService({
          workspacePath: normWorkspace || workspacePath,
          serviceTarget: svcTarget,
          options: {
            allowMockRepo: options.allowMockRepo,
            branch: options.branch || userSelections.branch || userSelections.selectedBranch || repoContext.branch,
            repository: options.repository || userSelections.repository || userSelections.selectedRepo || repoContext.remoteUrl,
            rootDir: options.rootDir || userSelections.rootDir || userSelections.selectedRootDir || repoContext.projectRoot,
            executionSource,
            execFn: options.gitExecFn,
          },
        });

        if (!remoteCheck.valid && !remoteCheck.skipped) {
          svcTarget.remotePreflight = remoteCheck;
          blockers.push(remoteCheck.message || `Local workspace differs from remote repository: ${remoteCheck.reason}`);
          if (!remotePreflightBlocker) {
            remotePreflightBlocker = remoteCheck;
          }
        }
      }
    }

    // 3. Infer Dependencies and Environment Variable Wiring
    const backendServices = services.filter((s) => s.type === SERVICE_TYPE.BACKEND);
    const frontendServices = services.filter((s) => s.type === SERVICE_TYPE.FRONTEND);
    const workerServices = services.filter((s) => s.type === SERVICE_TYPE.WORKER);

    // Database -> Backend dependencies
    for (const db of databases) {
      for (const backend of backendServices) {
        // Evidence: backend ORM or prisma or env vars contain DATABASE_URL
        const hasDbEvidence = backend.evidence?.some((e) => /prisma|db|database|orm/i.test(e.description || e.file || '')) ||
          (topology.environmentVariables?.required || []).includes('DATABASE_URL') ||
          databases.length === 1; // Single DB co-located

        if (hasDbEvidence) {
          dependencies.push({
            from: db.databaseId,
            to: backend.serviceId,
            reason: `${backend.name} requires database connection (${db.technology})`,
          });

          wiring.push({
            sourceId: db.databaseId,
            sourceOutput: 'CONNECTION_STRING',
            targetServiceId: backend.serviceId,
            targetEnvVar: 'DATABASE_URL',
            isSecret: true,
          });
        }
      }

      // Database -> Worker dependencies
      for (const worker of workerServices) {
        dependencies.push({
          from: db.databaseId,
          to: worker.serviceId,
          reason: `${worker.name} requires database/queue persistence`,
        });

        wiring.push({
          sourceId: db.databaseId,
          sourceOutput: 'CONNECTION_STRING',
          targetServiceId: worker.serviceId,
          targetEnvVar: 'DATABASE_URL',
          isSecret: true,
        });
      }
    }

    // Backend -> Frontend dependencies
    for (const backend of backendServices) {
      for (const frontend of frontendServices) {
        // Evidence: Frontend references API URL or monorepo co-existence
        const reqVars = topology.environmentVariables?.required || [];
        const hasApiUrlVar = reqVars.some((v) => /API_URL|BACKEND_URL/i.test(v));
        const targetEnvVar = this.resolveFrontendApiEnvVar(frontend, topology);

        if (hasApiUrlVar || (topology.isMonorepo && backendServices.length === 1)) {
          dependencies.push({
            from: backend.serviceId,
            to: frontend.serviceId,
            reason: `${frontend.name} communicates with ${backend.name} via ${targetEnvVar}`,
          });

          wiring.push({
            sourceId: backend.serviceId,
            sourceOutput: 'LIVE_URL',
            targetServiceId: frontend.serviceId,
            targetEnvVar,
            isSecret: false,
          });
        }
      }
    }

    // 4. Check for Custom Injected Dependencies (e.g. for testing cycle detection)
    if (Array.isArray(options.customDependencies)) {
      for (const cd of options.customDependencies) {
        dependencies.push(cd);
      }
    }

    // 5. Security Rule: Check for Dangerous Secret Wiring into Frontend Targets
    const secretVars = ['DATABASE_URL', 'JWT_SECRET', 'API_SECRET_KEY', 'POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'AWS_SECRET_ACCESS_KEY'];
    for (const w of wiring) {
      const targetSvc = services.find((s) => s.serviceId === w.targetServiceId);
      if (targetSvc && targetSvc.type === SERVICE_TYPE.FRONTEND && w.isSecret) {
        blockers.push(`Security Blocker: Secret variable '${w.targetEnvVar}' is wired into public frontend client '${targetSvc.name}'. Secrets must never be exposed to browser bundles.`);
      }
    }

    // Check if frontend source code directly requires DATABASE_URL
    for (const fe of frontendServices) {
      const reqVars = topology.environmentVariables?.required || [];
      if (reqVars.includes('DATABASE_URL') && backendServices.length === 0 && !fe.isSSR) {
        warnings.push(`Security Warning: Pure client frontend '${fe.name}' references DATABASE_URL directly in static bundle.`);
      }
    }

    // 6. Compute Execution Order via Topological Sort
    const allNodeIds = [
      ...databases.map((d) => d.databaseId),
      ...services.map((s) => s.serviceId),
    ];

    const { order, hasCycle } = this.topologicalSort(allNodeIds, dependencies);

    if (hasCycle) {
      blockers.push('Circular dependency detected between deployment targets. Execution order cannot be resolved.');
    }

    // 7. Compute Plan Overall Status
    let overallStatus;
    if (services.length === 0 && databases.length === 0) {
      overallStatus = PLAN_STATUS.UNKNOWN;
    } else if (blockers.length > 0) {
      overallStatus = PLAN_STATUS.BLOCKED;
    } else if (warnings.length > 0) {
      overallStatus = PLAN_STATUS.WARNING;
    } else {
      overallStatus = PLAN_STATUS.READY;
    }

    // 8. Estimate Total Time (Deterministic Heuristic)
    let estimatedTotalTimeSeconds = null;
    if (services.length > 0 || databases.length > 0) {
      estimatedTotalTimeSeconds = databases.length * 30 + services.length * 45;
    }

    // 9. Formulate Summary
    let summary;
    if (overallStatus === PLAN_STATUS.READY) {
      summary = `Complete deployment plan generated with ${services.length} service(s) and ${databases.length} database(s) across ${order.length} stage(s).`;
    } else if (overallStatus === PLAN_STATUS.WARNING) {
      summary = `Deployment plan generated with ${warnings.length} warning(s) that should be reviewed prior to orchestration.`;
    } else if (overallStatus === PLAN_STATUS.BLOCKED) {
      summary = `Deployment plan is blocked by ${blockers.length} critical issue(s): ${blockers[0]}`;
    } else {
      summary = 'Insufficient repository topology evidence to construct a valid deployment plan.';
    }

    return {
      planId,
      workspacePath: secretFilter.sanitizeString(workspacePath),
      generatedAt,
      evidenceHash: this.computeEvidenceHash(workspacePath),
      overallStatus,
      summary: secretFilter.sanitizeString(summary),
      topology: {
        isMonorepo: Boolean(topology.isMonorepo),
        packageManager: topology.packageManager || null,
        services,
        databases,
      },
      dependencies,
      wiring,
      executionOrder: order,
      estimatedTotalTimeSeconds,
      blockers,
      warnings,
      remotePreflight: remotePreflightBlocker || null,
      executionSource,
      deploymentRepositoryContext: repoContext,
    };
  }

  /**
   * Saves user selections for a workspace
   * @param {string} workspacePath
   * @param {Record<string, string>} selections
   * @param {Object} [options]
   */
  saveUserSelections(workspacePath, selections = {}, options = {}) {
    if (!workspacePath) return;
    const resolved = this.selectionStore.normalizeWorkspacePath ? this.selectionStore.normalizeWorkspacePath(workspacePath) : path.resolve(workspacePath);
    console.log('[DeploymentSelection] DeploymentPlanGenerator.saveUserSelections', {
      workspace: workspacePath,
      normalizedWorkspace: resolved,
      selections,
    });
    return this.selectionStore.saveWorkspaceSelections(resolved, selections, options);
  }

  /**
   * Retrieves active user selections for a workspace
   * @param {string} workspacePath
   * @returns {Record<string, string>}
   */
  getUserSelections(workspacePath) {
    if (!workspacePath) return {};
    const resolved = this.selectionStore.normalizeWorkspacePath ? this.selectionStore.normalizeWorkspacePath(workspacePath) : path.resolve(workspacePath);
    const record = this.selectionStore.getWorkspaceSelections(resolved);
    const result = record?.selections ? { ...record.selections } : {};
    console.log('[DeploymentSelection] DeploymentPlanGenerator.getUserSelections', {
      workspace: workspacePath,
      normalizedWorkspace: resolved,
      loadedSelections: result,
    });
    return result;
  }

  /**
   * Clears saved user selections for a workspace
   * @param {string} workspacePath
   */
  clearUserSelections(workspacePath) {
    if (!workspacePath) return;
    const resolved = this.selectionStore.normalizeWorkspacePath ? this.selectionStore.normalizeWorkspacePath(workspacePath) : path.resolve(workspacePath);
    console.log('[DeploymentSelection] DeploymentPlanGenerator.clearUserSelections', {
      workspace: workspacePath,
      normalizedWorkspace: resolved,
    });
    return this.selectionStore.clearWorkspaceSelections(resolved);
  }
}

const deploymentPlanGenerator = new DeploymentPlanGenerator();

module.exports = {
  PLAN_STATUS,
  DeploymentPlanGenerator,
  deploymentPlanGenerator,
};
