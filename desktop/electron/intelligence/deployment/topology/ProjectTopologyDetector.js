/**
 * NEXUS INTELLIGENCE LAYER — PROJECT TOPOLOGY DETECTOR (Phase 4A)
 * 
 * Inspects the complete physical workspace working tree to deterministically discover:
 * - Independent frontend, backend, and worker services across root and monorepo architectures
 * - Database storage, schema definitions, and migration technologies
 * - Per-service runtime parameters, ports, build/start commands, and config files
 * - Health check routes and environment variable requirements
 * 
 * STRICT INVARIANTS:
 * - Read-only static analysis on the physical workspace filesystem.
 * - 0 LLM/AI tokens.
 * - 0 Network requests.
 * - 100% deterministic and traceable to repository evidence.
 */

const fs = require('fs');
const path = require('path');
const secretFilter = require('../../../../security/secretFilter');
const { projectDetector } = require('../ProjectDetector');

/**
 * Service Types
 */
const SERVICE_TYPE = Object.freeze({
  FRONTEND: 'FRONTEND',
  BACKEND: 'BACKEND',
  WORKER: 'WORKER',
});

/**
 * Database Technologies
 */
const DATABASE_TECH = Object.freeze({
  POSTGRESQL: 'postgresql',
  MYSQL: 'mysql',
  MONGODB: 'mongodb',
  SQLITE: 'sqlite',
  REDIS: 'redis',
  UNKNOWN: 'unknown',
});

class ProjectTopologyDetector {
  /**
   * Helper to read small files safely
   * @param {string} filePath
   * @returns {string|null}
   */
  readFileSafe(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > 128 * 1024) return null;
      return fs.readFileSync(filePath, 'utf-8');
    } catch (_) {
      return null;
    }
  }

  /**
   * Discovers health check path in candidate backend files
   * @param {string} workspacePath
   * @param {string} relDir
   * @returns {string|null}
   */
  detectHealthCheckPath(workspacePath, relDir = '') {
    const searchDir = relDir ? path.join(workspacePath, relDir) : workspacePath;
    const candidateFiles = [
      'server.ts', 'server.js', 'src/server.ts', 'src/server.js',
      'src/index.ts', 'src/index.js', 'index.ts', 'index.js',
      'src/app.ts', 'src/app.js', 'app.ts', 'app.js',
      'main.py', 'app.py', 'routes.py', 'src/routes.ts', 'src/routes.js',
      'src/health.ts', 'src/health.js',
    ];

    const healthRegexes = [
      /(?:get|use|route)\s*\(\s*['"](\/(?:api\/)?(?:health|healthz|ping|status|live|ready))['"]/i,
      /@(?:app|router)\.get\s*\(\s*['"](\/(?:api\/)?(?:health|healthz|ping|status|live|ready))['"]/i,
    ];

    for (const file of candidateFiles) {
      const fullPath = path.join(searchDir, file);
      const content = this.readFileSafe(fullPath);
      if (content) {
        for (const re of healthRegexes) {
          const match = content.match(re);
          if (match && match[1]) {
            return match[1];
          }
        }
      }
    }
    return null;
  }

  /**
   * Checks if a directory represents a background worker
   * @param {string} workspacePath
   * @param {string} relDir
   * @returns {boolean}
   */
  isWorkerService(workspacePath, relDir = '') {
    const lowerDir = relDir.toLowerCase();
    if (lowerDir.includes('worker') || lowerDir.includes('queue') || lowerDir.includes('consumer') || lowerDir.includes('jobs')) {
      return true;
    }

    const pkgData = projectDetector.readPackageJson(workspacePath, relDir);
    if (pkgData && pkgData.pkg) {
      const name = String(pkgData.pkg.name || '').toLowerCase();
      if (name.includes('worker') || name.includes('queue') || name.includes('consumer')) return true;

      const scripts = pkgData.pkg.scripts || {};
      for (const [key, val] of Object.entries(scripts)) {
        if (key.toLowerCase().includes('worker') || String(val).toLowerCase().includes('worker.js') || String(val).toLowerCase().includes('bullmq') || String(val).toLowerCase().includes('celery')) {
          return true;
        }
      }
    }

    const targetDir = relDir ? path.join(workspacePath, relDir) : workspacePath;
    const workerFiles = ['worker.ts', 'worker.js', 'worker.py', 'consumer.ts', 'consumer.js', 'consumer.py', 'tasks.py'];
    for (const wf of workerFiles) {
      if (fs.existsSync(path.join(targetDir, wf))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Discovers all services and databases across workspace
   * @param {string} workspacePath
   * @returns {Object} TopologyResult
   */
  detectTopology(workspacePath) {
    if (!workspacePath || typeof workspacePath !== 'string' || !fs.existsSync(workspacePath)) {
      return {
        valid: false,
        workspacePath: workspacePath || '',
        isMonorepo: false,
        services: [],
        databases: [],
        environmentVariables: { required: [], documented: [], missingDocumentation: [], evidence: [] },
      };
    }

    const normWorkspace = path.resolve(workspacePath);
    const monorepo = projectDetector.detectMonorepo(normWorkspace);
    const services = [];
    const databases = [];
    const seenServiceIds = new Set();
    const seenDatabaseIds = new Set();

    // Helper to add unique service
    const addService = (svc) => {
      if (!svc || seenServiceIds.has(svc.serviceId)) return;
      seenServiceIds.add(svc.serviceId);
      services.push(svc);
    };

    // Helper to add unique database
    const addDatabase = (db) => {
      if (!db || seenDatabaseIds.has(db.databaseId)) return;
      seenDatabaseIds.add(db.databaseId);
      databases.push(db);
    };

    // 1. Scan Monorepo Sub-apps if present
    if (monorepo.isMonorepo && monorepo.discoveredSubApps.length > 0) {
      for (const subDir of monorepo.discoveredSubApps) {
        const fullSubPath = path.join(normWorkspace, subDir);
        if (!fs.existsSync(fullSubPath)) continue;

        const pkgData = projectDetector.readPackageJson(normWorkspace, subDir);
        const pkgName = pkgData?.pkg?.name || path.basename(subDir);

        // Check if database package (e.g. packages/db or prisma schema)
        const dbResult = projectDetector.detectDatabase(normWorkspace, subDir);
        if (dbResult && dbResult.detected) {
          const dbId = `db_${subDir.replace(/[^a-zA-Z0-9]/g, '_')}`;
          addDatabase({
            databaseId: dbId,
            name: `${pkgName} Database`,
            technology: dbResult.technology || DATABASE_TECH.UNKNOWN,
            ormOrDriver: dbResult.ormOrDriver || 'Raw',
            rootDir: subDir,
            configFile: dbResult.configFile || (fs.existsSync(path.join(fullSubPath, 'prisma/schema.prisma')) ? path.join(subDir, 'prisma/schema.prisma') : null),
            migrationStatus: dbResult.migrationStatus,
            migrationCommand: dbResult.ormOrDriver === 'prisma' ? 'npx prisma migrate deploy' : undefined,
            isSQLite: dbResult.isSQLite,
            isManaged: !dbResult.isSQLite,
            usesLocalhost: dbResult.usesLocalhost,
            evidence: dbResult.evidence || [],
          });
        }

        // Check Worker
        const isWorker = this.isWorkerService(normWorkspace, subDir);
        if (isWorker) {
          const svcId = `svc_${subDir.replace(/[^a-zA-Z0-9]/g, '_')}`;
          const startCmd = pkgData?.pkg?.scripts?.start || pkgData?.pkg?.scripts?.worker || 'node worker.js';
          addService({
            serviceId: svcId,
            name: pkgName,
            type: SERVICE_TYPE.WORKER,
            rootDir: subDir,
            framework: 'nodejs',
            runtime: 'nodejs',
            buildCommand: pkgData?.pkg?.scripts?.build ? 'npm run build' : null,
            startCommand: startCmd,
            port: null,
            outputDir: null,
            configFile: null,
            healthCheckPath: null,
            evidence: [{ file: path.join(subDir, 'package.json'), description: 'Background worker service detected' }],
          });
          continue;
        }

        // Check Frontend
        const feResult = projectDetector.detectFrontend(normWorkspace, subDir);
        if (feResult && feResult.detected) {
          const svcId = `svc_${subDir.replace(/[^a-zA-Z0-9]/g, '_')}`;
          const configPath = fs.existsSync(path.join(fullSubPath, 'vercel.json'))
            ? path.join(subDir, 'vercel.json')
            : fs.existsSync(path.join(fullSubPath, 'netlify.toml'))
            ? path.join(subDir, 'netlify.toml')
            : 'vercel.json';

          addService({
            serviceId: svcId,
            name: pkgName,
            type: SERVICE_TYPE.FRONTEND,
            rootDir: subDir,
            framework: feResult.framework || 'unknown',
            runtime: 'nodejs',
            buildCommand: feResult.buildScript ? `npm run ${feResult.buildScript}` : (pkgData?.pkg?.scripts?.build ? 'npm run build' : null),
            startCommand: pkgData?.pkg?.scripts?.start ? 'npm start' : null,
            port: null,
            outputDir: feResult.outputDirectory || 'dist',
            configFile: configPath,
            healthCheckPath: null,
            isStaticExport: Boolean(feResult.isStaticExport),
            isSSR: Boolean(feResult.isSSR),
            evidence: feResult.evidence || [],
          });
        }

        // Check Backend
        const beResult = projectDetector.detectBackend(normWorkspace, subDir);
        if (beResult && beResult.detected && (!feResult || !feResult.detected || beResult.framework !== 'none')) {
          // If frontend was already added and this is purely a Next.js / fullstack app, avoid duplicating unless it's a distinct server
          const isPureFullstackFrontend = feResult?.detected && (feResult.framework === 'next' || feResult.framework === 'nextjs' || feResult.framework === 'remix') && beResult.framework === 'none';
          if (!isPureFullstackFrontend) {
            const svcId = feResult?.detected ? `svc_${subDir.replace(/[^a-zA-Z0-9]/g, '_')}_api` : `svc_${subDir.replace(/[^a-zA-Z0-9]/g, '_')}`;
            const configPath = fs.existsSync(path.join(fullSubPath, 'render.yaml'))
              ? path.join(subDir, 'render.yaml')
              : fs.existsSync(path.join(fullSubPath, 'railway.toml'))
              ? path.join(subDir, 'railway.toml')
              : fs.existsSync(path.join(fullSubPath, 'Dockerfile'))
              ? path.join(subDir, 'Dockerfile')
              : 'render.yaml';

            addService({
              serviceId: svcId,
              name: feResult?.detected ? `${pkgName} API` : pkgName,
              type: SERVICE_TYPE.BACKEND,
              rootDir: subDir,
              framework: beResult.framework || 'express',
              runtime: beResult.runtime || 'nodejs',
              buildCommand: pkgData?.pkg?.scripts?.build ? 'npm run build' : null,
              startCommand: beResult.startCommand || 'npm start',
              port: beResult.port || 3000,
              outputDir: null,
              configFile: configPath,
              healthCheckPath: this.detectHealthCheckPath(normWorkspace, subDir),
              hostBinding: beResult.hostBinding || '0.0.0.0',
              isHostBindingSafe: Boolean(beResult.isHostBindingSafe),
              evidence: beResult.evidence || [],
            });
          }
        }
      }
    }

    // 2. Single-App / Root Level Discovery (Always runs if services are empty or for standalone projects)
    if (services.length === 0) {
      // Check Root Database
      const rootDb = projectDetector.detectDatabase(normWorkspace);
      if (rootDb && rootDb.detected) {
        addDatabase({
          databaseId: 'db_main',
          name: 'Main Database',
          technology: rootDb.technology || DATABASE_TECH.UNKNOWN,
          ormOrDriver: rootDb.ormOrDriver || 'Raw',
          rootDir: '',
          configFile: rootDb.configFile || (fs.existsSync(path.join(normWorkspace, 'prisma/schema.prisma')) ? 'prisma/schema.prisma' : null),
          migrationStatus: rootDb.migrationStatus,
          migrationCommand: rootDb.ormOrDriver === 'prisma' ? 'npx prisma migrate deploy' : undefined,
          isSQLite: rootDb.isSQLite,
          isManaged: !rootDb.isSQLite,
          usesLocalhost: rootDb.usesLocalhost,
          evidence: rootDb.evidence || [],
        });
      }

      // Check Root Worker
      const rootIsWorker = this.isWorkerService(normWorkspace, '');
      if (rootIsWorker) {
        const pkgData = projectDetector.readPackageJson(normWorkspace, '');
        addService({
          serviceId: 'svc_worker',
          name: pkgData?.pkg?.name || 'Worker Service',
          type: SERVICE_TYPE.WORKER,
          rootDir: '',
          framework: 'nodejs',
          runtime: 'nodejs',
          buildCommand: pkgData?.pkg?.scripts?.build ? 'npm run build' : null,
          startCommand: pkgData?.pkg?.scripts?.start || pkgData?.pkg?.scripts?.worker || 'node worker.js',
          port: null,
          outputDir: null,
          configFile: null,
          healthCheckPath: null,
          evidence: [{ file: 'package.json', description: 'Root worker service detected' }],
        });
      } else {
        // Check Root Frontend
        const rootFe = projectDetector.detectFrontend(normWorkspace);
        if (rootFe && rootFe.detected) {
          const pkgData = projectDetector.readPackageJson(normWorkspace, '');
          const configPath = fs.existsSync(path.join(normWorkspace, 'vercel.json'))
            ? 'vercel.json'
            : fs.existsSync(path.join(normWorkspace, 'netlify.toml'))
            ? 'netlify.toml'
            : 'vercel.json';

          addService({
            serviceId: 'svc_web',
            name: pkgData?.pkg?.name || 'Web Application',
            type: SERVICE_TYPE.FRONTEND,
            rootDir: '',
            framework: rootFe.framework || 'unknown',
            runtime: 'nodejs',
            buildCommand: rootFe.buildScript ? `npm run ${rootFe.buildScript}` : (pkgData?.pkg?.scripts?.build ? 'npm run build' : null),
            startCommand: pkgData?.pkg?.scripts?.start ? 'npm start' : null,
            port: null,
            outputDir: rootFe.outputDirectory || 'dist',
            configFile: configPath,
            healthCheckPath: null,
            isStaticExport: Boolean(rootFe.isStaticExport),
            isSSR: Boolean(rootFe.isSSR),
            evidence: rootFe.evidence || [],
          });
        }

        // Check Root Backend
        const rootBe = projectDetector.detectBackend(normWorkspace);
        if (rootBe && rootBe.detected) {
          const isPureFullstack = rootFe?.detected && (rootFe.framework === 'next' || rootFe.framework === 'remix') && rootBe.framework === 'none';
          if (!isPureFullstack) {
            const pkgData = projectDetector.readPackageJson(normWorkspace, '');
            const configPath = fs.existsSync(path.join(normWorkspace, 'render.yaml'))
              ? 'render.yaml'
              : fs.existsSync(path.join(normWorkspace, 'railway.toml'))
              ? 'railway.toml'
              : fs.existsSync(path.join(normWorkspace, 'Dockerfile'))
              ? 'Dockerfile'
              : 'render.yaml';

            addService({
              serviceId: rootFe?.detected ? 'svc_api' : 'svc_backend',
              name: pkgData?.pkg?.name || (rootFe?.detected ? 'API Server' : 'Backend Service'),
              type: SERVICE_TYPE.BACKEND,
              rootDir: '',
              framework: rootBe.framework || 'express',
              runtime: rootBe.runtime || 'nodejs',
              buildCommand: pkgData?.pkg?.scripts?.build ? 'npm run build' : null,
              startCommand: rootBe.startCommand || 'npm start',
              port: rootBe.port || 3000,
              outputDir: null,
              configFile: configPath,
              healthCheckPath: this.detectHealthCheckPath(normWorkspace, ''),
              hostBinding: rootBe.hostBinding || '0.0.0.0',
              isHostBindingSafe: Boolean(rootBe.isHostBindingSafe),
              evidence: rootBe.evidence || [],
            });
          }
        }
      }

      // Check Standalone Dockerfile if no services detected
      if (services.length === 0 && monorepo.hasDocker && monorepo.dockerfile) {
        addService({
          serviceId: 'svc_container',
          name: 'Docker Application',
          type: SERVICE_TYPE.BACKEND,
          rootDir: '',
          framework: 'docker',
          runtime: 'docker',
          buildCommand: 'docker build .',
          startCommand: 'docker run',
          port: 8080,
          outputDir: null,
          configFile: monorepo.dockerfile,
          healthCheckPath: null,
          hostBinding: '0.0.0.0',
          isHostBindingSafe: true,
          evidence: [{ file: monorepo.dockerfile, description: 'Standalone Dockerfile detected' }],
        });
      }
    }

    const envVars = projectDetector.detectEnvironmentVariables(normWorkspace);

    return {
      valid: true,
      workspacePath: normWorkspace,
      isMonorepo: monorepo.isMonorepo,
      packageManager: monorepo.packageManager,
      services,
      databases,
      environmentVariables: envVars,
    };
  }
}

const projectTopologyDetector = new ProjectTopologyDetector();

module.exports = {
  SERVICE_TYPE,
  DATABASE_TECH,
  ProjectTopologyDetector,
  projectTopologyDetector,
};
