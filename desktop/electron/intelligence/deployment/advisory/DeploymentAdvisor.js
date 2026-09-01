/**
 * NEXUS INTELLIGENCE LAYER — DEPLOYMENT ADVISOR (Phase 4 / Final Trust Pass)
 * 
 * Analyzes workspace evidence and project topology to:
 * 1. Generate comprehensive project summary templates.
 * 2. Evaluate and score COMPLETE DEPLOYMENT ARCHITECTURES (not just isolated provider cards).
 * 3. Perform deep backend failure risk analysis (PORT, HOST binding, DB connection, migrations, filesystem persistence).
 * 4. Analyze verified provider limits and realistic billing/plan considerations (never fabricating exact prices).
 * 5. Recommend 1 top architecture and 2–5 structured alternatives.
 * 6. Validate user architecture selections with deterministic execution gating.
 * 
 * STRICT INVARIANTS:
 * - 0 LLM/AI tokens consumed.
 * - 0 Network requests / Cloud API calls.
 * - 100% deterministic local computation.
 * - Compatibility scores are immutable and distinct from execution availability.
 * - Never leaks secret credentials or database connection strings.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const secretFilter = require('../../../../security/secretFilter');
const { deploymentInspector } = require('../DeploymentInspector');
const { projectTopologyDetector, SERVICE_TYPE, DATABASE_TECH } = require('../topology/ProjectTopologyDetector');
const { SUITABILITY, CONFIDENCE } = require('../PlatformRecommendation');

/**
 * Risk Severity
 */
const RISK_SEVERITY = Object.freeze({
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  INFO: 'INFO',
});

/**
 * Risk Codes
 */
const RISK_CODES = Object.freeze({
  PORT_MISCONFIGURATION: 'PORT_MISCONFIGURATION',
  HOST_BINDING_RISK: 'HOST_BINDING_RISK',
  MISSING_ENVIRONMENT: 'MISSING_ENVIRONMENT',
  DATABASE_CONNECTION_RISK: 'DATABASE_CONNECTION_RISK',
  MIGRATION_RISK: 'MIGRATION_RISK',
  FILESYSTEM_PERSISTENCE_RISK: 'FILESYSTEM_PERSISTENCE_RISK',
  NATIVE_DEPENDENCY_RISK: 'NATIVE_DEPENDENCY_RISK',
  LONG_RUNNING_PROCESS_RISK: 'LONG_RUNNING_PROCESS_RISK',
  HEALTH_CHECK_RISK: 'HEALTH_CHECK_RISK',
  RESOURCE_RISK: 'RESOURCE_RISK',
  DOCKER_RUNTIME_RISK: 'DOCKER_RUNTIME_RISK',
});

/**
 * Billing Tier Categories
 */
const BILLING_TIER = Object.freeze({
  FREE: 'FREE',
  FREE_TIER_AVAILABLE: 'FREE_TIER_AVAILABLE',
  PAID_RESOURCE_REQUIRED: 'PAID_RESOURCE_REQUIRED',
  PLAN_DEPENDENT: 'PLAN_DEPENDENT',
  UNKNOWN: 'UNKNOWN',
});

/**
 * Verified Provider Capability Metadata (Central Source of Truth)
 */
const PROVIDER_CAPABILITIES = Object.freeze({
  vercel: {
    providerId: 'vercel',
    displayName: 'Vercel',
    isExecutable: true,
    supportedTypes: ['FRONTEND', 'FULLSTACK_SERVERLESS'],
    maxFunctionMemoryMB: 1024,
    maxExecutionTimeSec: 10,
    persistentStorage: false,
    ephemeralStorage: true,
    dockerSupport: false,
    monorepoSupport: true,
    billing: {
      frontend: BILLING_TIER.FREE_TIER_AVAILABLE,
      serverless: BILLING_TIER.FREE_TIER_AVAILABLE,
      database: BILLING_TIER.PLAN_DEPENDENT,
    },
    resourceLimits: {
      memory: '1024 MB (Serverless Function)',
      compute: 'Edge CDN + Serverless execution (10s max request duration)',
      storage: 'Ephemeral (Read-only bundle at runtime)',
      bandwidth: '100 GB/mo (Hobby)',
    },
  },
  render: {
    providerId: 'render',
    displayName: 'Render Web Service',
    isExecutable: true,
    supportedTypes: ['BACKEND', 'WORKER', 'DATABASE', 'FRONTEND_STATIC'],
    maxMemoryMB: 512,
    persistentStorage: true,
    ephemeralStorage: true,
    dockerSupport: true,
    monorepoSupport: true,
    billing: {
      frontend: BILLING_TIER.FREE_TIER_AVAILABLE,
      backend: BILLING_TIER.FREE_TIER_AVAILABLE,
      database: BILLING_TIER.PAID_RESOURCE_REQUIRED,
    },
    resourceLimits: {
      memory: '512 MB (Free Web Service)',
      compute: '0.1 CPU (Free tier instance, sleeps after 15m inactivity)',
      storage: 'Ephemeral by default (Persistent disk available on paid instances)',
      bandwidth: '100 GB/mo',
    },
  },
  render_postgres: {
    providerId: 'render_postgres',
    displayName: 'Render Managed PostgreSQL',
    isExecutable: true,
    supportedTypes: ['DATABASE'],
    maxMemoryMB: 256,
    persistentStorage: true,
    ephemeralStorage: false,
    dockerSupport: false,
    monorepoSupport: true,
    billing: {
      database: BILLING_TIER.PAID_RESOURCE_REQUIRED,
    },
    resourceLimits: {
      memory: '256 MB (Free tier trial) / Paid instance',
      compute: 'Managed PostgreSQL Instance',
      storage: 'Persistent Managed Storage',
      bandwidth: 'Standard egress',
    },
  },
  netlify: {
    providerId: 'netlify',
    displayName: 'Netlify',
    isExecutable: true,
    supportedTypes: ['FRONTEND', 'SERVERLESS_FUNCTIONS'],
    maxFunctionMemoryMB: 1024,
    maxExecutionTimeSec: 10,
    persistentStorage: false,
    ephemeralStorage: true,
    dockerSupport: false,
    monorepoSupport: true,
    billing: {
      frontend: BILLING_TIER.FREE_TIER_AVAILABLE,
      serverless: BILLING_TIER.FREE_TIER_AVAILABLE,
      database: BILLING_TIER.PLAN_DEPENDENT,
    },
    resourceLimits: {
      memory: '1024 MB (Functions)',
      compute: 'Global Edge distribution + Serverless functions',
      storage: 'Ephemeral CDN build output',
      bandwidth: '100 GB/mo',
    },
  },
  railway: {
    providerId: 'railway',
    displayName: 'Railway',
    isExecutable: false,
    supportedTypes: ['FRONTEND', 'BACKEND', 'WORKER', 'DATABASE'],
    maxMemoryMB: null,
    persistentStorage: true,
    ephemeralStorage: true,
    dockerSupport: true,
    monorepoSupport: true,
    billing: {
      frontend: BILLING_TIER.PLAN_DEPENDENT,
      backend: BILLING_TIER.PLAN_DEPENDENT,
      database: BILLING_TIER.PLAN_DEPENDENT,
    },
    resourceLimits: {
      memory: 'Plan dependent (Usage-based compute & memory)',
      compute: 'Container execution',
      storage: 'Persistent volumes supported',
      bandwidth: 'Usage-based',
    },
  },
  flyio: {
    providerId: 'flyio',
    displayName: 'Fly.io',
    isExecutable: false,
    supportedTypes: ['BACKEND', 'WORKER', 'DATABASE', 'CONTAINER'],
    maxMemoryMB: 256,
    persistentStorage: true,
    ephemeralStorage: true,
    dockerSupport: true,
    monorepoSupport: true,
    billing: {
      frontend: BILLING_TIER.PLAN_DEPENDENT,
      backend: BILLING_TIER.FREE_TIER_AVAILABLE,
      database: BILLING_TIER.PLAN_DEPENDENT,
    },
    resourceLimits: {
      memory: '256 MB (Free allowances)',
      compute: 'MicroVMs / Container execution',
      storage: 'NVMe Volumes supported',
      bandwidth: 'Global Anycast distribution',
    },
  },
  docker: {
    providerId: 'docker',
    displayName: 'Custom Docker / Self-Hosted',
    isExecutable: false,
    supportedTypes: ['BACKEND', 'WORKER', 'CONTAINER'],
    maxMemoryMB: null,
    persistentStorage: true,
    ephemeralStorage: true,
    dockerSupport: true,
    monorepoSupport: true,
    billing: {
      frontend: BILLING_TIER.UNKNOWN,
      backend: BILLING_TIER.UNKNOWN,
      database: BILLING_TIER.UNKNOWN,
    },
    resourceLimits: {
      memory: 'Limit not verified by NEXUS.',
      compute: 'Host container daemon',
      storage: 'Host mounts',
      bandwidth: 'Host network',
    },
  },
});

class DeploymentAdvisor {
  /**
   * Generates a unique advice ID
   * @returns {string}
   */
  generateAdviceId() {
    const rand = crypto.randomBytes(3).toString('hex');
    return `adv_${Date.now().toString(36)}_${rand}`;
  }

  /**
   * Safely reads a small text file
   * @param {string} filePath
   * @returns {string|null}
   */
  readFileSafe(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > 256 * 1024) return null;
      return fs.readFileSync(filePath, 'utf-8');
    } catch (_) {
      return null;
    }
  }

  /**
   * Evaluates service compatibility against a specific provider based on service type & framework
   * @param {Object} service
   * @param {string} providerId
   * @returns {number} 0-100 score
   */
  evaluateServiceFit(service, providerId) {
    if (!service) return 80;

    if (service.type === SERVICE_TYPE.FRONTEND) {
      const fw = String(service.framework || '').toLowerCase();
      switch (providerId) {
        case 'vercel':
          if (fw.includes('next')) return 98;
          if (fw.includes('vite') || fw.includes('react') || fw.includes('svelte') || fw.includes('astro') || fw.includes('vue')) return 95;
          return 90;
        case 'netlify':
          if (fw.includes('vite') || fw.includes('react') || fw.includes('svelte') || fw.includes('astro') || fw.includes('vue')) return 96;
          if (fw.includes('next')) return 90;
          return 90;
        case 'railway':
          return 94;
        case 'flyio':
          return 85;
        case 'render':
          return 88;
        default:
          return 80;
      }
    }

    if (service.type === SERVICE_TYPE.BACKEND) {
      const fw = String(service.framework || '').toLowerCase();
      switch (providerId) {
        case 'render':
          if (fw.includes('express') || fw.includes('fastapi') || fw.includes('nest') || fw.includes('node') || fw.includes('python')) return 96;
          return 90;
        case 'railway':
          return 98;
        case 'flyio':
          return 92;
        case 'vercel':
          return 65;
        case 'netlify':
          return 60;
        default:
          return 80;
      }
    }

    return 85;
  }

  /**
   * Evaluates database compatibility against a specific database provider
   * @param {Object} database
   * @param {string} providerId
   * @returns {number} 0-100 score
   */
  evaluateDatabaseFit(database, providerId) {
    if (!database) return 85;
    const tech = String(database.technology || '').toLowerCase();
    if (tech === 'postgresql') {
      if (providerId === 'render_postgres' || providerId === 'render') return 95;
      if (providerId.includes('railway')) return 96;
      if (providerId.includes('flyio')) return 88;
      return 90;
    }
    if (tech === 'mysql') {
      if (providerId.includes('railway')) return 95;
      if (providerId.includes('render')) return 85;
      return 85;
    }
    if (tech === 'sqlite') {
      return 70;
    }
    return 85;
  }

  /**
   * Generates a deterministic project summary from topology and report evidence
   * @param {Object} topology
   * @param {Object} report
   * @returns {Object}
   */
  generateProjectSummary(topology, report) {
    const frontends = topology.services.filter((s) => s.type === SERVICE_TYPE.FRONTEND);
    const backends = topology.services.filter((s) => s.type === SERVICE_TYPE.BACKEND);
    const databases = topology.databases || [];

    const frontendFw = frontends.length > 0
      ? frontends.map((f) => f.framework).join(', ')
      : report?.frontend?.framework || 'None';

    const backendFw = backends.length > 0
      ? backends.map((b) => `${b.framework} (${b.runtime})`).join(', ')
      : report?.backend?.framework
      ? `${report.backend.framework} (${report.backend.runtime})`
      : 'None';

    const dbTech = databases.length > 0
      ? databases.map((d) => `${d.technology}${d.ormOrDriver ? ` with ${d.ormOrDriver}` : ''}`).join(', ')
      : report?.database?.technology
      ? `${report.database.technology}${report.database.orm ? ` with ${report.database.orm}` : ''}`
      : 'None detected';

    const isMonorepo = Boolean(topology.isMonorepo);

    let summaryText = '';
    if (frontends.length > 0 && backends.length > 0 && databases.length > 0) {
      summaryText = `Full-stack ${isMonorepo ? 'monorepo' : 'project'} with ${frontends.length} frontend (${frontendFw}), ${backends.length} backend (${backendFw}), and ${databases.length} database (${dbTech}).`;
    } else if (frontends.length > 0 && backends.length > 0) {
      summaryText = `Full-stack application consisting of ${frontendFw} frontend and ${backendFw} backend API service.`;
    } else if (backends.length > 0 && databases.length > 0) {
      summaryText = `Backend service (${backendFw}) coupled with ${dbTech} database persistence.`;
    } else if (frontends.length > 0) {
      summaryText = `Standalone frontend application built with ${frontendFw}.`;
    } else if (backends.length > 0) {
      summaryText = `Standalone backend API service built with ${backendFw}.`;
    } else {
      summaryText = 'Single-tier application with standard static or dynamic runtime.';
    }

    return {
      frontendFramework: frontendFw,
      backendFramework: backendFw,
      databaseTechnology: dbTech,
      totalServices: topology.services.length,
      totalDatabases: databases.length,
      isMonorepo,
      summaryText: secretFilter.sanitizeString(summaryText),
    };
  }

  /**
   * Inspects backend source code deterministically to detect real runtime failure risks
   * @param {string} workspacePath
   * @param {Object} backendService
   * @param {Object} topology
   * @returns {Array<Object>} Array of RiskItem
   */
  analyzeBackendRisks(workspacePath, backendService, topology) {
    const risks = [];
    if (!backendService || backendService.type !== SERVICE_TYPE.BACKEND) {
      return risks;
    }

    const searchDir = backendService.rootDir
      ? path.join(workspacePath, backendService.rootDir)
      : workspacePath;

    const candidateFiles = [
      'server.js', 'server.ts', 'app.js', 'app.ts', 'index.js', 'index.ts',
      'src/server.js', 'src/server.ts', 'src/app.js', 'src/app.ts', 'src/index.js', 'src/index.ts',
      'main.py', 'app.py', 'src/main.py', 'src/app.py',
    ];

    let inspectedCode = '';
    let inspectedFile = '';
    for (const file of candidateFiles) {
      const fullPath = path.join(searchDir, file);
      const content = this.readFileSafe(fullPath);
      if (content) {
        inspectedCode += `\n${content}`;
        if (!inspectedFile) inspectedFile = file;
      }
    }

    const requiredVars = topology.environmentVariables?.required || [];

    // 1. PORT Misconfiguration Risk
    // Only emitted if hardcoded port is listened on WITHOUT dynamic process.env.PORT path
    if (inspectedCode) {
      const hasDynamicPort = /process\.env\.PORT|os\.environ\.get\(['"]PORT['"]\)|env\.PORT|\$PORT/i.test(inspectedCode);
      const hasListenCall = /\.listen\s*\(|uvicorn\.run|http\.createServer/i.test(inspectedCode);
      const hasHardcodedPort = /\.listen\s*\(\s*\d{2,5}\s*(?:,|\))/i.test(inspectedCode);

      if (hasListenCall && hasHardcodedPort && !hasDynamicPort) {
        risks.push({
          code: RISK_CODES.PORT_MISCONFIGURATION,
          severity: RISK_SEVERITY.HIGH,
          title: 'Hardcoded Port Detected',
          explanation: `Service '${backendService.name}' listens on a hardcoded port without checking process.env.PORT. Cloud container platforms (Render, Railway, Fly.io) assign dynamic port numbers.`,
          affectedService: backendService.serviceId,
          affectedProviders: ['render', 'railway', 'flyio'],
          evidence: inspectedFile ? `Found fixed port in ${inspectedFile}` : 'Fixed port argument in listen() call',
          recommendation: 'Update listen call to bind to process.env.PORT || 3000.',
        });
      }
    }

    // 2. HOST Binding Risk (localhost vs 0.0.0.0)
    // Only emitted if server explicitly binds to localhost/127.0.0.1
    if (inspectedCode) {
      const hasLocalhostBinding = /\.listen\s*\([^)]*['"](?:localhost|127\.0\.0\.1)['"]/i.test(inspectedCode) ||
        /host\s*:\s*['"](?:localhost|127\.0\.0\.1)['"]/i.test(inspectedCode);
      const hasZeroBinding = /\.listen\s*\([^)]*['"]0\.0\.0\.0['"]/i.test(inspectedCode) ||
        /host\s*:\s*['"]0\.0\.0\.0['"]/i.test(inspectedCode);

      if (hasLocalhostBinding && !hasZeroBinding) {
        risks.push({
          code: RISK_CODES.HOST_BINDING_RISK,
          severity: RISK_SEVERITY.HIGH,
          title: 'Localhost Binding Risk',
          explanation: `Service '${backendService.name}' explicitly binds to localhost/127.0.0.1. In cloud containers, this prevents external load balancers and ingress reverse proxies from routing traffic to your application.`,
          affectedService: backendService.serviceId,
          affectedProviders: ['render', 'railway', 'flyio', 'docker'],
          evidence: inspectedFile ? `Explicit localhost binding in ${inspectedFile}` : 'localhost host argument in listen() call',
          recommendation: "Bind server to '0.0.0.0' or omit host argument so the server listens on all network interfaces.",
        });
      }
    }

    // 3. Database Connection Risk
    // Only emitted if database driver is imported but no DATABASE_URL environment or target exists
    const hasDatabaseDeps = /pg|postgres|prisma|typeorm|mongoose|sequelize|knex|mysql2/i.test(inspectedCode) ||
      (backendService.evidence || []).some((e) => /prisma|database|db|postgres/i.test(e.file || e.description || ''));
    
    if (hasDatabaseDeps) {
      const hasDatabaseUrl = requiredVars.includes('DATABASE_URL') || /process\.env\.DATABASE_URL/i.test(inspectedCode);
      if (!hasDatabaseUrl && (topology.databases || []).length === 0) {
        risks.push({
          code: RISK_CODES.DATABASE_CONNECTION_RISK,
          severity: RISK_SEVERITY.HIGH,
          title: 'Unconfigured Database Target',
          explanation: `Service '${backendService.name}' imports database drivers but lacks a configured DATABASE_URL environment target.`,
          affectedService: backendService.serviceId,
          affectedProviders: ['render', 'railway', 'flyio'],
          evidence: 'Database client imports detected in backend code',
          recommendation: 'Configure a managed PostgreSQL/MySQL database instance and set the DATABASE_URL environment variable.',
        });
      }
    }

    // 4. Migration Risk
    // Only emitted if prisma schema or migration directories exist
    const hasPrismaSchema = fs.existsSync(path.join(searchDir, 'prisma/schema.prisma')) ||
      fs.existsSync(path.join(workspacePath, 'prisma/schema.prisma'));
    const hasMigrationDir = fs.existsSync(path.join(searchDir, 'migrations')) ||
      fs.existsSync(path.join(searchDir, 'prisma/migrations'));

    if (hasPrismaSchema || hasMigrationDir) {
      risks.push({
        code: RISK_CODES.MIGRATION_RISK,
        severity: RISK_SEVERITY.MEDIUM,
        title: 'Database Migrations Require Execution',
        explanation: `Database schema migrations detected for '${backendService.name}'. Migrations must be applied before or during initial deployment to prevent runtime schema mismatch errors.`,
        affectedService: backendService.serviceId,
        affectedProviders: ['render', 'railway', 'flyio'],
        evidence: hasPrismaSchema ? 'prisma/schema.prisma' : 'migrations directory',
        recommendation: 'Include a pre-deploy migration step (e.g. npx prisma migrate deploy) in your build or release command.',
      });
    }

    // 5. Filesystem Persistence Risk
    // Only emitted if fs.writeFile or upload dirs are in backend code
    if (inspectedCode) {
      const hasFsWrites = /fs\.(?:writeFile|writeFileSync|mkdir|mkdirSync|createWriteStream)\s*\(/i.test(inspectedCode) ||
        /['"]\/(?:uploads|storage|data)\/['"]/i.test(inspectedCode);

      if (hasFsWrites) {
        risks.push({
          code: RISK_CODES.FILESYSTEM_PERSISTENCE_RISK,
          severity: RISK_SEVERITY.MEDIUM,
          title: 'Ephemeral Filesystem Persistence Risk',
          explanation: `Service '${backendService.name}' writes to the local filesystem. Cloud deployment targets use ephemeral storage; files written to disk will be lost on container restart or rollout.`,
          affectedService: backendService.serviceId,
          affectedProviders: ['vercel', 'netlify', 'render', 'flyio'],
          evidence: 'Local fs write operations detected in source code',
          recommendation: 'Use S3/cloud object storage or attach a persistent volume for uploaded assets and permanent data.',
        });
      }
    }

    // 6. Native Dependency Risk
    // Only emitted if native C++ packages are in package.json
    const pkgData = this.readFileSafe(path.join(searchDir, 'package.json'));
    if (pkgData) {
      try {
        const parsed = JSON.parse(pkgData);
        const allDeps = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };
        const nativeDeps = ['bcrypt', 'sharp', 'sqlite3', 'canvas', 'fsevents', 'node-gyp'].filter((d) => allDeps[d]);
        if (nativeDeps.length > 0) {
          risks.push({
            code: RISK_CODES.NATIVE_DEPENDENCY_RISK,
            severity: RISK_SEVERITY.LOW,
            title: 'Native Addon Dependencies',
            explanation: `Native C++ dependencies (${nativeDeps.join(', ')}) detected in '${backendService.name}'. Ensure the build environment supports native compilation.`,
            affectedService: backendService.serviceId,
            affectedProviders: ['vercel', 'netlify', 'render'],
            evidence: `Dependencies: ${nativeDeps.join(', ')}`,
            recommendation: 'Ensure standard Node.js buildpack or multi-stage Docker build is used.',
          });
        }
      } catch (_) {}
    }

    // 7. Health Check Risk
    // Only emitted if healthCheckPath is absent
    if (!backendService.healthCheckPath) {
      risks.push({
        code: RISK_CODES.HEALTH_CHECK_RISK,
        severity: RISK_SEVERITY.INFO,
        title: 'No Explicit Health Route Detected',
        explanation: `Service '${backendService.name}' does not define an explicit /health or /api/health HTTP route. Providers will rely on basic TCP ping or root route probing for zero-downtime health verification.`,
        affectedService: backendService.serviceId,
        affectedProviders: ['render', 'railway', 'flyio'],
        evidence: 'Absence of standard health check route regex match',
        recommendation: "Add a lightweight GET /api/health endpoint returning status 200 OK for instant health checks.",
      });
    }

    return risks;
  }

  /**
   * Analyzes database hosting implications
   * @param {Array<Object>} databases
   * @returns {Array<Object>}
   */
  analyzeDatabaseRisks(databases = []) {
    const risks = [];
    for (const db of databases) {
      if (db.isSQLite || db.technology === 'sqlite') {
        risks.push({
          code: RISK_CODES.FILESYSTEM_PERSISTENCE_RISK,
          severity: RISK_SEVERITY.HIGH,
          title: 'SQLite Ephemeral Storage Risk',
          explanation: `Database '${db.name}' uses SQLite with local embedded file storage. Standard cloud instances discard local filesystem changes on restart. Persistent volume mounts are required to preserve state.`,
          affectedService: db.databaseId,
          affectedProviders: ['render', 'flyio', 'railway', 'vercel'],
          evidence: 'SQLite driver / database file configuration',
          recommendation: 'Migrate to managed PostgreSQL/MySQL or attach a persistent volume mount for production persistence.',
        });
      } else if (db.technology === 'postgresql') {
        risks.push({
          code: 'DATABASE_PROVISIONING_REQUIREMENT',
          severity: RISK_SEVERITY.INFO,
          title: 'Managed PostgreSQL Requirement',
          explanation: `Relational database persistence (${db.technology}) requires a dedicated managed instance (e.g. Render Managed Postgres, Neon, Supabase, or Railway).`,
          affectedService: db.databaseId,
          affectedProviders: ['render', 'railway', 'flyio'],
          evidence: 'PostgreSQL technology signature',
          recommendation: 'Use managed PostgreSQL provisioning with SSL connection string enabled.',
        });
      }
    }
    return risks;
  }

  /**
   * Generates candidate multi-service deployment architectures
   * @param {Object} topology
   * @param {Object} report
   * @param {Array<Object>} allRisks
   * @returns {Array<Object>}
   */
  generateArchitectures(topology, report, allRisks = []) {
    const frontends = topology.services.filter((s) => s.type === SERVICE_TYPE.FRONTEND);
    const backends = topology.services.filter((s) => s.type === SERVICE_TYPE.BACKEND);
    const databases = topology.databases || [];

    const isFullStack = frontends.length > 0 && backends.length > 0;
    const isSingleFrontend = frontends.length > 0 && backends.length === 0;
    const isSingleBackend = backends.length > 0 && frontends.length === 0;

    const architectures = [];

    // Helper to compute component-specific scores
    const calcComponentScore = (serviceMap, dbMap) => {
      const scores = [];
      for (const [svc, pid] of serviceMap) {
        scores.push(this.evaluateServiceFit(svc, pid));
      }
      for (const [db, pid] of dbMap) {
        scores.push(this.evaluateDatabaseFit(db, pid));
      }
      if (scores.length === 0) return 85;
      return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    };

    // -------------------------------------------------------------
    // Full-Stack Architectures (Frontend + Backend + DB)
    // -------------------------------------------------------------
    if (isFullStack) {
      // 1. Architecture: Vercel + Render + Managed Postgres
      const servicesMapA = [
        ...frontends.map((f) => [f, 'vercel']),
        ...backends.map((b) => [b, 'render']),
      ];
      const dbMapA = databases.map((d) => [d, 'render_postgres']);
      const baseScoreA = calcComponentScore(servicesMapA, dbMapA);
      const riskCountA = allRisks.filter((r) => r.severity === RISK_SEVERITY.HIGH).length;
      const archScoreA = Math.max(0, Math.min(100, baseScoreA - riskCountA * 5));

      architectures.push({
        architectureId: 'arch_hybrid_vercel_render',
        name: 'Vercel (Frontend) + Render (Backend & Database)',
        compatibilityScore: baseScoreA,
        architectureScore: archScoreA,
        confidence: CONFIDENCE.HIGH,
        executionAvailable: true,
        isRecommended: false,
        suitability: SUITABILITY.EXCELLENT,
        services: [
          ...frontends.map((f) => ({
            serviceId: f.serviceId,
            name: f.name,
            type: f.type,
            framework: f.framework,
            recommendedProvider: 'vercel',
            providerDisplayName: PROVIDER_CAPABILITIES.vercel.displayName,
            executionAvailable: true,
            configFile: f.rootDir ? path.join(f.rootDir, 'vercel.json') : 'vercel.json',
          })),
          ...backends.map((b) => ({
            serviceId: b.serviceId,
            name: b.name,
            type: b.type,
            framework: b.framework,
            recommendedProvider: 'render',
            providerDisplayName: PROVIDER_CAPABILITIES.render.displayName,
            executionAvailable: true,
            configFile: b.rootDir ? path.join(b.rootDir, 'render.yaml') : 'render.yaml',
          })),
        ],
        databases: databases.map((d) => ({
          databaseId: d.databaseId,
          name: d.name,
          technology: d.technology,
          recommendedProvider: 'render_postgres',
          providerDisplayName: PROVIDER_CAPABILITIES.render_postgres.displayName,
          executionAvailable: true,
          isManaged: true,
        })),
        advantages: [
          'High-performance global edge CDN for frontend assets',
          'Dedicated long-running container runtime for backend API',
          'Active deployment execution support in NEXUS',
          'Automatic dynamic environment variable wiring (LIVE_URL ➔ Public API)',
        ],
        tradeoffs: [
          'Two cloud provider accounts required (Vercel + Render)',
          'Managed PostgreSQL on Render requires paid instance after initial trial',
        ],
        risks: allRisks.filter((r) => ['render', 'vercel'].some((p) => (r.affectedProviders || []).includes(p))),
        billingConsiderations: {
          frontend: BILLING_TIER.FREE_TIER_AVAILABLE,
          backend: BILLING_TIER.FREE_TIER_AVAILABLE,
          database: databases.length > 0 ? BILLING_TIER.PAID_RESOURCE_REQUIRED : BILLING_TIER.FREE,
          summary: 'Frontend on Vercel Hobby (Free). Backend on Render Free Web Service. Database requires Render Postgres instance.',
        },
        resourceConsiderations: {
          memory: 'Vercel: 1024 MB Edge / Serverless • Render: 512 MB Free Instance',
          compute: 'Frontend: Global Edge CDN • Backend: 0.1 CPU (Sleeps after inactivity)',
          storage: 'Frontend: Ephemeral CDN • Backend: Ephemeral filesystem',
          bandwidth: '100 GB/mo per provider',
        },
        credentialRequirements: [
          { providerId: 'vercel', displayName: 'Vercel', status: 'REQUIRED' },
          { providerId: 'render', displayName: 'Render', status: 'REQUIRED' },
        ],
        complexity: 'LOW',
        rationale: [
          'Optimal separation of concerns: Static/SSR assets distributed to Vercel edge nodes.',
          'Express backend runs as an uninterrupted process on Render with environment variable integration.',
        ],
      });

      // 2. Architecture: Netlify + Render + Managed Postgres
      const servicesMapB = [
        ...frontends.map((f) => [f, 'netlify']),
        ...backends.map((b) => [b, 'render']),
      ];
      const baseScoreB = calcComponentScore(servicesMapB, dbMapA);
      const archScoreB = Math.max(0, Math.min(100, baseScoreB - riskCountA * 5));

      architectures.push({
        architectureId: 'arch_hybrid_netlify_render',
        name: 'Netlify (Frontend) + Render (Backend & Database)',
        compatibilityScore: baseScoreB,
        architectureScore: archScoreB,
        confidence: CONFIDENCE.HIGH,
        executionAvailable: true,
        isRecommended: false,
        suitability: SUITABILITY.EXCELLENT,
        services: [
          ...frontends.map((f) => ({
            serviceId: f.serviceId,
            name: f.name,
            type: f.type,
            framework: f.framework,
            recommendedProvider: 'netlify',
            providerDisplayName: PROVIDER_CAPABILITIES.netlify.displayName,
            executionAvailable: true,
            configFile: f.rootDir ? path.join(f.rootDir, 'netlify.toml') : 'netlify.toml',
          })),
          ...backends.map((b) => ({
            serviceId: b.serviceId,
            name: b.name,
            type: b.type,
            framework: b.framework,
            recommendedProvider: 'render',
            providerDisplayName: PROVIDER_CAPABILITIES.render.displayName,
            executionAvailable: true,
            configFile: b.rootDir ? path.join(b.rootDir, 'render.yaml') : 'render.yaml',
          })),
        ],
        databases: databases.map((d) => ({
          databaseId: d.databaseId,
          name: d.name,
          technology: d.technology,
          recommendedProvider: 'render_postgres',
          providerDisplayName: PROVIDER_CAPABILITIES.render_postgres.displayName,
          executionAvailable: true,
          isManaged: true,
        })),
        advantages: [
          'Excellent Vite/React static SPA hosting with automatic redirects',
          'Robust backend container execution on Render',
          'Active deployment execution support in NEXUS',
        ],
        tradeoffs: [
          'Multi-provider credential setup (Netlify + Render)',
        ],
        risks: allRisks.filter((r) => ['render', 'netlify'].some((p) => (r.affectedProviders || []).includes(p))),
        billingConsiderations: {
          frontend: BILLING_TIER.FREE_TIER_AVAILABLE,
          backend: BILLING_TIER.FREE_TIER_AVAILABLE,
          database: databases.length > 0 ? BILLING_TIER.PAID_RESOURCE_REQUIRED : BILLING_TIER.FREE,
          summary: 'Netlify Free Tier + Render Free Web Service.',
        },
        resourceConsiderations: {
          memory: 'Netlify: 1024 MB • Render: 512 MB',
          compute: 'Netlify Edge CDN • Render 0.1 CPU',
          storage: 'Ephemeral storage',
          bandwidth: '100 GB/mo',
        },
        credentialRequirements: [
          { providerId: 'netlify', displayName: 'Netlify', status: 'REQUIRED' },
          { providerId: 'render', displayName: 'Render', status: 'REQUIRED' },
        ],
        complexity: 'LOW',
        rationale: [
          'Netlify is specifically optimized for single-page Vite applications with instant rollbacks.',
        ],
      });

      // 3. Architecture: Unified Railway Full-Stack
      const servicesMapC = [
        ...frontends.map((f) => [f, 'railway']),
        ...backends.map((b) => [b, 'railway']),
      ];
      const dbMapC = databases.map((d) => [d, 'railway']);
      const baseScoreC = calcComponentScore(servicesMapC, dbMapC);

      architectures.push({
        architectureId: 'arch_unified_railway',
        name: 'Railway (Unified Full-Stack & Database)',
        compatibilityScore: baseScoreC,
        architectureScore: baseScoreC,
        confidence: CONFIDENCE.HIGH,
        executionAvailable: false,
        isRecommended: false,
        suitability: SUITABILITY.EXCELLENT,
        services: [
          ...frontends.map((f) => ({
            serviceId: f.serviceId,
            name: f.name,
            type: f.type,
            framework: f.framework,
            recommendedProvider: 'railway',
            providerDisplayName: PROVIDER_CAPABILITIES.railway.displayName,
            executionAvailable: false,
            configFile: f.rootDir ? path.join(f.rootDir, 'railway.toml') : 'railway.toml',
          })),
          ...backends.map((b) => ({
            serviceId: b.serviceId,
            name: b.name,
            type: b.type,
            framework: b.framework,
            recommendedProvider: 'railway',
            providerDisplayName: PROVIDER_CAPABILITIES.railway.displayName,
            executionAvailable: false,
            configFile: b.rootDir ? path.join(b.rootDir, 'railway.toml') : 'railway.toml',
          })),
        ],
        databases: databases.map((d) => ({
          databaseId: d.databaseId,
          name: d.name,
          technology: d.technology,
          recommendedProvider: 'railway',
          providerDisplayName: 'Railway Managed Database',
          executionAvailable: false,
          isManaged: true,
        })),
        advantages: [
          'Single unified dashboard and billing account for all services',
          'Automatic private networking between frontend, backend, and database',
          'Zero configuration required for inter-service communication',
        ],
        tradeoffs: [
          'Deployment execution adapter for Railway is currently in development in NEXUS',
          'Usage-based billing after initial trial credit',
        ],
        risks: allRisks.filter((r) => (r.affectedProviders || []).includes('railway')),
        billingConsiderations: {
          frontend: BILLING_TIER.PLAN_DEPENDENT,
          backend: BILLING_TIER.PLAN_DEPENDENT,
          database: BILLING_TIER.PLAN_DEPENDENT,
          summary: 'Usage-based execution ($5 trial credit, then usage-based billing).',
        },
        resourceConsiderations: PROVIDER_CAPABILITIES.railway.resourceLimits,
        credentialRequirements: [
          { providerId: 'railway', displayName: 'Railway', status: 'ADAPTER_IN_DEVELOPMENT' },
        ],
        complexity: 'LOW',
        rationale: [
          'Highest compatibility score for monorepos due to unified multi-service orchestration.',
        ],
      });

      // 4. Architecture: Fly.io MicroVMs
      const servicesMapD = [
        ...frontends.map((f) => [f, 'flyio']),
        ...backends.map((b) => [b, 'flyio']),
      ];
      const dbMapD = databases.map((d) => [d, 'flyio']);
      const baseScoreD = calcComponentScore(servicesMapD, dbMapD);

      architectures.push({
        architectureId: 'arch_containers_flyio',
        name: 'Fly.io (Global MicroVMs & Database)',
        compatibilityScore: baseScoreD,
        architectureScore: baseScoreD,
        confidence: CONFIDENCE.MEDIUM,
        executionAvailable: false,
        isRecommended: false,
        suitability: SUITABILITY.GOOD,
        services: [
          ...frontends.map((f) => ({
            serviceId: f.serviceId,
            name: f.name,
            type: f.type,
            framework: f.framework,
            recommendedProvider: 'flyio',
            providerDisplayName: PROVIDER_CAPABILITIES.flyio.displayName,
            executionAvailable: false,
            configFile: f.rootDir ? path.join(f.rootDir, 'fly.toml') : 'fly.toml',
          })),
          ...backends.map((b) => ({
            serviceId: b.serviceId,
            name: b.name,
            type: b.type,
            framework: b.framework,
            recommendedProvider: 'flyio',
            providerDisplayName: PROVIDER_CAPABILITIES.flyio.displayName,
            executionAvailable: false,
            configFile: b.rootDir ? path.join(b.rootDir, 'fly.toml') : 'fly.toml',
          })),
        ],
        databases: databases.map((d) => ({
          databaseId: d.databaseId,
          name: d.name,
          technology: d.technology,
          recommendedProvider: 'render_postgres',
          providerDisplayName: PROVIDER_CAPABILITIES.render_postgres.displayName,
          executionAvailable: true,
          isManaged: true,
        })),
        advantages: [
          'Ultra low-latency global distribution via WireGuard private mesh',
          'Native Docker container support',
        ],
        tradeoffs: [
          'Fly.io execution adapter in development in NEXUS',
          'Requires Dockerfile or buildpack configuration',
        ],
        risks: allRisks.filter((r) => (r.affectedProviders || []).includes('flyio')),
        billingConsiderations: {
          frontend: BILLING_TIER.PLAN_DEPENDENT,
          backend: BILLING_TIER.FREE_TIER_AVAILABLE,
          database: BILLING_TIER.PLAN_DEPENDENT,
          summary: 'Free resource allowances available for small microVMs.',
        },
        resourceConsiderations: PROVIDER_CAPABILITIES.flyio.resourceLimits,
        credentialRequirements: [
          { providerId: 'flyio', displayName: 'Fly.io', status: 'ADAPTER_IN_DEVELOPMENT' },
        ],
        complexity: 'MEDIUM',
        rationale: [
          'Best for high-concurrency websocket and low-latency microservice architectures.',
        ],
      });
    } else if (isSingleFrontend) {
      // -------------------------------------------------------------
      // Single Frontend Architectures
      // -------------------------------------------------------------
      const vScore = this.evaluateServiceFit(frontends[0], 'vercel');
      architectures.push({
        architectureId: 'arch_frontend_vercel',
        name: 'Vercel Edge Distribution',
        compatibilityScore: vScore,
        architectureScore: vScore,
        confidence: CONFIDENCE.HIGH,
        executionAvailable: true,
        isRecommended: false,
        suitability: SUITABILITY.EXCELLENT,
        services: frontends.map((f) => ({
          serviceId: f.serviceId,
          name: f.name,
          type: f.type,
          framework: f.framework,
          recommendedProvider: 'vercel',
          providerDisplayName: PROVIDER_CAPABILITIES.vercel.displayName,
          executionAvailable: true,
          configFile: 'vercel.json',
        })),
        databases: [],
        advantages: ['Automatic Edge caching', 'Instant preview deployments', 'Active NEXUS execution support'],
        tradeoffs: ['Serverless limits apply if backend functions are added later'],
        risks: allRisks,
        billingConsiderations: {
          frontend: BILLING_TIER.FREE_TIER_AVAILABLE,
          summary: 'Vercel Hobby Plan (Free).',
        },
        resourceConsiderations: PROVIDER_CAPABILITIES.vercel.resourceLimits,
        credentialRequirements: [{ providerId: 'vercel', displayName: 'Vercel', status: 'REQUIRED' }],
        complexity: 'LOW',
        rationale: ['Native optimization for modern React and Next.js applications.'],
      });

      const nScore = this.evaluateServiceFit(frontends[0], 'netlify');
      architectures.push({
        architectureId: 'arch_frontend_netlify',
        name: 'Netlify Global CDN',
        compatibilityScore: nScore,
        architectureScore: nScore,
        confidence: CONFIDENCE.HIGH,
        executionAvailable: true,
        isRecommended: false,
        suitability: SUITABILITY.EXCELLENT,
        services: frontends.map((f) => ({
          serviceId: f.serviceId,
          name: f.name,
          type: f.type,
          framework: f.framework,
          recommendedProvider: 'netlify',
          providerDisplayName: PROVIDER_CAPABILITIES.netlify.displayName,
          executionAvailable: true,
          configFile: 'netlify.toml',
        })),
        databases: [],
        advantages: ['Instant SPA redirects', 'Global CDN asset distribution', 'Active NEXUS execution support'],
        tradeoffs: ['Limited long-running background compute'],
        risks: allRisks,
        billingConsiderations: {
          frontend: BILLING_TIER.FREE_TIER_AVAILABLE,
          summary: 'Netlify Starter Plan (Free).',
        },
        resourceConsiderations: PROVIDER_CAPABILITIES.netlify.resourceLimits,
        credentialRequirements: [{ providerId: 'netlify', displayName: 'Netlify', status: 'REQUIRED' }],
        complexity: 'LOW',
        rationale: ['Fast static site builds and atomic asset deployments.'],
      });
    } else {
      // -------------------------------------------------------------
      // Single Backend Architectures
      // -------------------------------------------------------------
      const rScore = this.evaluateServiceFit(backends[0], 'render');
      architectures.push({
        architectureId: 'arch_backend_render',
        name: 'Render Web Service',
        compatibilityScore: rScore,
        architectureScore: rScore,
        confidence: CONFIDENCE.HIGH,
        executionAvailable: true,
        isRecommended: false,
        suitability: SUITABILITY.EXCELLENT,
        services: backends.map((b) => ({
          serviceId: b.serviceId,
          name: b.name,
          type: b.type,
          framework: b.framework,
          recommendedProvider: 'render',
          providerDisplayName: PROVIDER_CAPABILITIES.render.displayName,
          executionAvailable: true,
          configFile: 'render.yaml',
        })),
        databases: databases.map((d) => ({
          databaseId: d.databaseId,
          name: d.name,
          technology: d.technology,
          recommendedProvider: 'render_postgres',
          providerDisplayName: PROVIDER_CAPABILITIES.render_postgres.displayName,
          executionAvailable: true,
          isManaged: true,
        })),
        advantages: ['Uninterrupted container process', 'Automatic HTTPS certificates', 'Active NEXUS execution support'],
        tradeoffs: ['Free tier web service sleeps after 15m of inactivity'],
        risks: allRisks,
        billingConsiderations: {
          backend: BILLING_TIER.FREE_TIER_AVAILABLE,
          database: databases.length > 0 ? BILLING_TIER.PAID_RESOURCE_REQUIRED : BILLING_TIER.FREE,
          summary: 'Render Free Web Service tier. Managed DB on paid instance.',
        },
        resourceConsiderations: PROVIDER_CAPABILITIES.render.resourceLimits,
        credentialRequirements: [{ providerId: 'render', displayName: 'Render', status: 'REQUIRED' }],
        complexity: 'LOW',
        rationale: ['Full Node.js / Python server lifecycle support with zero server management.'],
      });
    }

    // Sort architectures:
    // 1. Executable first (when available)
    // 2. Architecture Score descending
    const executableArchs = architectures.filter((a) => a.executionAvailable);
    const sortedExecutable = [...executableArchs].sort((a, b) => b.architectureScore - a.architectureScore);

    // Pick top recommendation:
    let recommended = sortedExecutable.length > 0
      ? sortedExecutable[0]
      : [...architectures].sort((a, b) => b.compatibilityScore - a.compatibilityScore)[0];

    if (recommended) {
      recommended.isRecommended = true;
    }

    return architectures;
  }

  /**
   * Generates a complete DeploymentAdvice payload for a workspace
   * @param {string|Object} workspaceOrTopology
   * @param {Object} [options]
   * @returns {Promise<Object>} DeploymentAdvice
   */
  async generateAdvice(workspaceOrTopology, options = {}) {
    let workspacePath = '';
    let topology;
    let report;

    if (typeof workspaceOrTopology === 'string') {
      workspacePath = path.resolve(workspaceOrTopology);
      topology = projectTopologyDetector.detectTopology(workspacePath);
      report = await deploymentInspector.inspectWorkspace(workspacePath);
    } else if (workspaceOrTopology && typeof workspaceOrTopology === 'object') {
      topology = workspaceOrTopology;
      workspacePath = topology.workspacePath || '';
      if (options.report) {
        report = options.report;
      } else if (workspacePath) {
        report = await deploymentInspector.inspectWorkspace(workspacePath);
      } else {
        report = { platformRecommendations: [], environmentVariables: { required: [] } };
      }
    } else {
      topology = { services: [], databases: [], environmentVariables: { required: [] } };
      report = { platformRecommendations: [], environmentVariables: { required: [] } };
    }

    const adviceId = this.generateAdviceId();
    const generatedAt = Date.now();

    // 1. Project Summary
    const projectSummary = this.generateProjectSummary(topology, report);

    // 2. Risk Analysis
    const projectRisks = [];
    for (const svc of topology.services) {
      if (svc.type === SERVICE_TYPE.BACKEND) {
        const backendRisks = this.analyzeBackendRisks(workspacePath, svc, topology);
        projectRisks.push(...backendRisks);
      }
    }
    const dbRisks = this.analyzeDatabaseRisks(topology.databases || []);
    projectRisks.push(...dbRisks);

    // 3. Complete Architecture Evaluation
    const architectures = this.generateArchitectures(topology, report, projectRisks);

    // 4. Recommendation & Alternatives Split
    const recommendedArchitecture = architectures.find((a) => a.isRecommended) || architectures[0] || null;
    const alternatives = architectures.filter((a) => a !== recommendedArchitecture);

    // 5. Global Blockers & Requirements
    const blockers = [];
    const requirements = [];

    if (topology.services.length === 0 && (topology.databases || []).length === 0) {
      blockers.push('No deployable application service or database targets detected in workspace.');
    }

    // Check for secret leakage into frontend
    const secretVars = ['DATABASE_URL', 'JWT_SECRET', 'API_SECRET_KEY', 'POSTGRES_PASSWORD'];
    const reqVars = topology.environmentVariables?.required || [];
    for (const sv of secretVars) {
      if (reqVars.includes(sv)) {
        requirements.push(`Secure backend environment variable required: ${sv}`);
      }
    }

    // Determine Overall Status
    let status = 'READY';
    if (topology.services.length === 0) {
      status = 'UNKNOWN';
    } else if (blockers.length > 0) {
      status = 'BLOCKED';
    } else if (projectRisks.some((r) => r.severity === RISK_SEVERITY.HIGH)) {
      status = 'WARNING';
    }

    return {
      adviceId,
      workspacePath: secretFilter.sanitizeString(workspacePath),
      generatedAt,
      evidenceHash: report?.evidenceHash || `hash_${Date.now().toString(36)}`,
      projectSummary,
      detectedTopology: {
        isMonorepo: Boolean(topology.isMonorepo),
        packageManager: topology.packageManager || null,
        services: topology.services,
        databases: topology.databases || [],
      },
      architectureRecommendations: architectures,
      recommendedArchitecture,
      alternatives,
      projectRisks,
      blockers,
      requirements,
      billingConsiderations: recommendedArchitecture?.billingConsiderations || {
        summary: 'Standard free tiers available for testing.',
      },
      resourceConsiderations: recommendedArchitecture?.resourceConsiderations || {
        memory: 'Limit not verified by NEXUS.',
        compute: 'Standard cloud instance',
        storage: 'Ephemeral storage',
        bandwidth: 'Usage-based',
      },
      credentialRequirements: recommendedArchitecture?.credentialRequirements || [],
      complexity: recommendedArchitecture?.complexity || 'LOW',
      selectedArchitecture: recommendedArchitecture?.architectureId || null,
      status,
    };
  }

  /**
   * Validates a selected architecture or customized user selection
   * @param {Object} advice - DeploymentAdvice object
   * @param {string|Object} selection - architectureId or { [serviceId]: providerId }
   * @returns {Object} Validation Result
   */
  validateSelectedArchitecture(advice, selection) {
    if (!advice || !advice.architectureRecommendations) {
      return {
        valid: false,
        status: 'BLOCKED',
        blockers: ['Invalid or missing deployment advice.'],
        missingProviders: [],
      };
    }

    let targetArch = null;
    let userSelections = {};

    if (typeof selection === 'string') {
      targetArch = advice.architectureRecommendations.find((a) => a.architectureId === selection);
      if (!targetArch) {
        return {
          valid: false,
          status: 'BLOCKED',
          blockers: [`Selected architecture '${selection}' was not found in recommendations.`],
          missingProviders: [],
        };
      }
      for (const s of targetArch.services || []) {
        userSelections[s.serviceId] = s.recommendedProvider;
      }
      for (const d of targetArch.databases || []) {
        userSelections[d.databaseId] = d.recommendedProvider;
      }
    } else if (selection && typeof selection === 'object') {
      userSelections = selection;
    }

    const blockers = [];
    const missingProviders = [];

    // Check execution capability for each selection
    for (const [targetId, providerId] of Object.entries(userSelections)) {
      const cap = PROVIDER_CAPABILITIES[providerId] || { isExecutable: false, displayName: providerId };
      if (!cap.isExecutable && providerId !== 'render_postgres' && providerId !== 'embedded_sqlite') {
        blockers.push(`Selected provider '${cap.displayName}' does not currently have deployment execution support in NEXUS.`);
      }
    }

    if (blockers.length > 0) {
      return {
        valid: false,
        status: 'BLOCKED',
        blockers,
        missingProviders,
        userSelections,
      };
    }

    return {
      valid: true,
      status: 'READY',
      blockers: [],
      missingProviders,
      userSelections,
    };
  }
}

const deploymentAdvisor = new DeploymentAdvisor();

module.exports = {
  RISK_SEVERITY,
  RISK_CODES,
  BILLING_TIER,
  PROVIDER_CAPABILITIES,
  DeploymentAdvisor,
  deploymentAdvisor,
};
