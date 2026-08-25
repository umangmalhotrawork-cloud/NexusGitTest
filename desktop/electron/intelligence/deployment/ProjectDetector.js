/**
 * NEXUS INTELLIGENCE LAYER — PROJECT DETECTOR (Phase 1)
 * 
 * Deterministic local static analyzer inspecting repository files, manifests,
 * configurations, and entry point source code to identify:
 * - Frontend frameworks & build/output configurations
 * - Backend runtimes, frameworks, entry points, start commands, ports & host bindings
 * - Database drivers, ORMs, connection configs & persistence models
 * - Monorepo structure & workspace sub-packages
 * - Environment variable requirements
 * 
 * STRICT INVARIANTS:
 * - Zero LLM/API calls (100% deterministic local computation).
 * - Read-only filesystem access within workspace bounds.
 * - Real repository evidence with file paths, line numbers, and snippets.
 * - No fake or hardcoded conclusions without evidence.
 */

const fs = require('fs');
const path = require('path');
const secretFilter = require('../../../security/secretFilter');

// Directories to strictly ignore during static code traversal
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'out',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  '.turbo',
  '.nexus',
  '.nexus-recovery',
  '.echo-nullity-recovery',
  '.echo-nullity-snapshots',
  '.echo-nullity-continuum',
  '.echo-nullity-capsules',
  'exports',
  'reports',
]);

const MAX_SCAN_FILES_PER_DIR = 100;
const MAX_FILE_READ_BYTES = 128 * 1024; // 128 KB limit per file

class ProjectDetector {
  /**
   * Safely reads a file with size cap and UTF-8 decoding
   * @param {string} filePath
   * @returns {string|null}
   */
  readFileSafe(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > MAX_FILE_READ_BYTES) return null;
      return fs.readFileSync(filePath, 'utf-8');
    } catch (_) {
      return null;
    }
  }

  /**
   * Discovers top-level directories in a path
   * @param {string} dirPath
   * @returns {string[]}
   */
  listSubdirsSafe(dirPath) {
    try {
      if (!fs.existsSync(dirPath)) return [];
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      return items
        .filter((item) => item.isDirectory() && !item.name.startsWith('.') && !IGNORED_DIRS.has(item.name))
        .map((item) => item.name);
    } catch (_) {
      return [];
    }
  }

  /**
   * Analyzes package.json content
   * @param {string} workspacePath
   * @param {string} [relDir]
   * @returns {Object|null}
   */
  readPackageJson(workspacePath, relDir = '') {
    const fullPath = relDir ? path.join(workspacePath, relDir, 'package.json') : path.join(workspacePath, 'package.json');
    const content = this.readFileSafe(fullPath);
    if (!content) return null;
    try {
      const parsed = JSON.parse(content);
      const relFilePath = relDir ? path.join(relDir, 'package.json') : 'package.json';
      return {
        pkg: parsed,
        relPath: relFilePath,
        fullPath,
        content,
      };
    } catch (_) {
      return null;
    }
  }

  /**
   * Detects Monorepo workspaces
   * @param {string} workspacePath
   * @returns {Object}
   */
  detectMonorepo(workspacePath) {
    const workspaces = [];
    let isMonorepo = false;
    let packageManager = null;

    // Check package manager lockfiles
    if (fs.existsSync(path.join(workspacePath, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
    else if (fs.existsSync(path.join(workspacePath, 'yarn.lock'))) packageManager = 'yarn';
    else if (fs.existsSync(path.join(workspacePath, 'package-lock.json'))) packageManager = 'npm';
    else if (fs.existsSync(path.join(workspacePath, 'bun.lockb')) || fs.existsSync(path.join(workspacePath, 'bun.lock'))) packageManager = 'bun';

    // Check pnpm-workspace.yaml
    const pnpmWsPath = path.join(workspacePath, 'pnpm-workspace.yaml');
    if (fs.existsSync(pnpmWsPath)) {
      isMonorepo = true;
      packageManager = 'pnpm';
      workspaces.push('pnpm-workspace.yaml');
    }

    // Check turbo.json
    const turboPath = path.join(workspacePath, 'turbo.json');
    if (fs.existsSync(turboPath)) {
      isMonorepo = true;
      workspaces.push('turbo.json');
    }

    // Check root package.json workspaces
    const rootPkg = this.readPackageJson(workspacePath);
    if (rootPkg && rootPkg.pkg.workspaces) {
      isMonorepo = true;
      const wsField = rootPkg.pkg.workspaces;
      if (Array.isArray(wsField)) {
        workspaces.push(...wsField);
      } else if (wsField && typeof wsField === 'object' && Array.isArray(wsField.packages)) {
        workspaces.push(...wsField.packages);
      }
    }

    // Scan common monorepo subdirectories (apps/*, packages/*, services/*)
    const candidateDirs = ['apps', 'packages', 'services'];
    const discoveredApps = [];

    for (const cDir of candidateDirs) {
      const fullDir = path.join(workspacePath, cDir);
      if (fs.existsSync(fullDir) && fs.statSync(fullDir).isDirectory()) {
        const subdirs = this.listSubdirsSafe(fullDir);
        for (const sub of subdirs) {
          const appRel = path.join(cDir, sub);
          if (fs.existsSync(path.join(workspacePath, appRel, 'package.json')) ||
              fs.existsSync(path.join(workspacePath, appRel, 'pyproject.toml')) ||
              fs.existsSync(path.join(workspacePath, appRel, 'requirements.txt'))) {
            discoveredApps.push(appRel);
            isMonorepo = true;
          }
        }
      }
    }

    return {
      isMonorepo,
      packageManager,
      workspacePatterns: workspaces,
      discoveredSubApps: discoveredApps,
      hasDocker: fs.existsSync(path.join(workspacePath, 'Dockerfile')),
      dockerfile: fs.existsSync(path.join(workspacePath, 'Dockerfile')) ? 'Dockerfile' : null,
      dockerCompose: fs.existsSync(path.join(workspacePath, 'docker-compose.yml'))
        ? 'docker-compose.yml'
        : fs.existsSync(path.join(workspacePath, 'docker-compose.yaml'))
        ? 'docker-compose.yaml'
        : fs.existsSync(path.join(workspacePath, 'compose.yml'))
        ? 'compose.yml'
        : null,
    };
  }

  /**
   * Detects frontend characteristics from a directory context
   * @param {string} workspacePath
   * @param {string} [relDir]
   * @returns {Object|null}
   */
  detectFrontend(workspacePath, relDir = '') {
    const rootPkgInfo = this.readPackageJson(workspacePath, relDir);
    const targetDir = relDir ? path.join(workspacePath, relDir) : workspacePath;
    const evidence = [];

    let framework = null;
    let buildScript = null;
    let outputDirectory = null;
    let isStaticExport = false;
    let isSSR = false;

    // Check package.json dependencies and scripts
    if (rootPkgInfo) {
      const { pkg, relPath, content } = rootPkgInfo;
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const scripts = pkg.scripts || {};

      if (scripts.build) {
        buildScript = `npm run build (${scripts.build})`;
      }

      // Next.js detection
      if (deps['next']) {
        framework = 'nextjs';
        outputDirectory = '.next';
        isSSR = true;
        evidence.push({
          file: relPath,
          snippet: `"next": "${deps['next']}"`,
          description: 'Next.js framework dependency detected in package.json',
        });

        // Check next.config for static export
        const nextConfigs = ['next.config.js', 'next.config.mjs', 'next.config.ts'];
        for (const nc of nextConfigs) {
          const ncPath = path.join(targetDir, nc);
          const ncContent = this.readFileSafe(ncPath);
          if (ncContent) {
            const relNc = relDir ? path.join(relDir, nc) : nc;
            if (ncContent.includes("output: 'export'") || ncContent.includes('output: "export"')) {
              isStaticExport = true;
              isSSR = false;
              outputDirectory = 'out';
              evidence.push({
                file: relNc,
                snippet: 'output: "export"',
                description: 'Next.js static HTML export mode configured',
              });
            } else {
              evidence.push({
                file: relNc,
                snippet: ncContent.slice(0, 100).trim(),
                description: 'Next.js configuration file detected',
              });
            }
            break;
          }
        }
      }
      // Astro detection
      else if (deps['astro'] || deps['@astrojs/react'] || deps['@astrojs/vue']) {
        framework = 'astro';
        outputDirectory = 'dist';
        evidence.push({
          file: relPath,
          snippet: `"astro": "${deps['astro'] || 'detected'}"`,
          description: 'Astro framework detected in package.json',
        });
      }
      // Vite detection
      else if (deps['vite']) {
        framework = deps['react'] ? 'react (vite)' : deps['vue'] ? 'vue (vite)' : deps['svelte'] ? 'svelte (vite)' : 'vite';
        outputDirectory = 'dist';
        evidence.push({
          file: relPath,
          snippet: `"vite": "${deps['vite']}"`,
          description: 'Vite build tool detected in dependencies',
        });
      }
      // Nuxt detection
      else if (deps['nuxt'] || deps['nuxt3']) {
        framework = 'nuxt';
        outputDirectory = '.output';
        isSSR = true;
        evidence.push({
          file: relPath,
          snippet: `"nuxt": "${deps['nuxt'] || deps['nuxt3']}"`,
          description: 'Nuxt framework detected in dependencies',
        });
      }
      // SvelteKit detection
      else if (deps['@sveltejs/kit']) {
        framework = 'sveltekit';
        outputDirectory = '.svelte-kit';
        evidence.push({
          file: relPath,
          snippet: `"@sveltejs/kit": "${deps['@sveltejs/kit']}"`,
          description: 'SvelteKit framework detected in dependencies',
        });
      }
      // Remix detection
      else if (deps['@remix-run/react'] || deps['@remix-run/node']) {
        framework = 'remix';
        outputDirectory = 'build';
        isSSR = true;
        evidence.push({
          file: relPath,
          snippet: `"@remix-run/react": "${deps['@remix-run/react'] || 'detected'}"`,
          description: 'Remix framework detected in dependencies',
        });
      }
      // Create React App detection
      else if (deps['react-scripts']) {
        framework = 'create-react-app';
        outputDirectory = 'build';
        evidence.push({
          file: relPath,
          snippet: `"react-scripts": "${deps['react-scripts']}"`,
          description: 'Create React App tooling detected in dependencies',
        });
      }
      // Standard React / Vue / Svelte without Vite/Next
      else if (deps['react'] && (deps['webpack'] || scripts.build)) {
        framework = 'react';
        outputDirectory = 'dist';
        evidence.push({
          file: relPath,
          snippet: `"react": "${deps['react']}"`,
          description: 'React library detected in package.json',
        });
      } else if (deps['vue']) {
        framework = 'vue';
        outputDirectory = 'dist';
        evidence.push({
          file: relPath,
          snippet: `"vue": "${deps['vue']}"`,
          description: 'Vue library detected in package.json',
        });
      }
    }

    // Check standalone config files if package.json didn't identify a framework
    if (!framework) {
      const viteFiles = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'];
      for (const vf of viteFiles) {
        const vfPath = path.join(targetDir, vf);
        if (fs.existsSync(vfPath)) {
          framework = 'vite';
          outputDirectory = 'dist';
          evidence.push({
            file: relDir ? path.join(relDir, vf) : vf,
            description: 'Vite configuration file exists in workspace',
          });
          break;
        }
      }
    }

    if (!framework && !buildScript && evidence.length === 0) {
      return null;
    }

    return {
      detected: true,
      framework: framework || 'static web',
      runtime: 'browser',
      packageManager: rootPkgInfo?.pkg?.packageManager || null,
      buildScript,
      outputDirectory: outputDirectory || 'dist',
      isStaticExport,
      isSSR,
      status: buildScript ? 'READY' : 'WARNING',
      path: relDir || null,
      evidence,
    };
  }

  /**
   * Scans a file for Node/Python server listen and binding patterns
   * @param {string} workspacePath
   * @param {string} relFilePath
   * @returns {Object|null}
   */
  inspectServerBinding(workspacePath, relFilePath) {
    const fullPath = path.join(workspacePath, relFilePath);
    const content = this.readFileSafe(fullPath);
    if (!content) return null;

    const lines = content.split('\n');
    let hostBinding = null;
    let port = null;
    let isHostBindingSafe = true;
    let matchEvidence = null;

    // 1. Node.js Express / Fastify / HTTP: app.listen(...) or server.listen(...)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Pattern: app.listen(port, "127.0.0.1") or app.listen(port, 'localhost')
      const badHostMatch = line.match(/(?:app|server|httpServer|fastify)\.listen\s*\(\s*([^,\)]+)\s*,\s*['"](127\.0\.0\.1|localhost)['"]/i);
      if (badHostMatch) {
        port = badHostMatch[1].trim();
        hostBinding = badHostMatch[2];
        isHostBindingSafe = false;
        matchEvidence = {
          file: relFilePath,
          line: lineNum,
          snippet: line.trim(),
          description: `Server explicitly binds to private loopback interface (${hostBinding})`,
        };
        break;
      }

      // Pattern: app.listen(port, "0.0.0.0")
      const safeHostMatch = line.match(/(?:app|server|httpServer|fastify)\.listen\s*\(\s*([^,\)]+)\s*,\s*['"](0\.0\.0\.0)['"]/i);
      if (safeHostMatch) {
        port = safeHostMatch[1].trim();
        hostBinding = '0.0.0.0';
        isHostBindingSafe = true;
        matchEvidence = {
          file: relFilePath,
          line: lineNum,
          snippet: line.trim(),
          description: 'Server explicitly binds to all network interfaces (0.0.0.0)',
        };
        break;
      }

      // Pattern: app.listen(port) or app.listen(process.env.PORT || 3000)
      const genericListenMatch = line.match(/(?:app|server|httpServer|fastify)\.listen\s*\(\s*([^,\)]+)\s*\)/i);
      if (genericListenMatch && !matchEvidence) {
        port = genericListenMatch[1].trim();
        hostBinding = 'default (0.0.0.0)';
        isHostBindingSafe = true;
        matchEvidence = {
          file: relFilePath,
          line: lineNum,
          snippet: line.trim(),
          description: 'Server listens on default network interface',
        };
      }

      // 2. Python Uvicorn / Flask
      const uvicornMatch = line.match(/uvicorn\.run\s*\([^,]+(?:,\s*host=['"]([^'"]+)['"])?(?:,\s*port=([^,\)]+))?/);
      if (uvicornMatch) {
        const h = uvicornMatch[1] || '127.0.0.1';
        port = uvicornMatch[2] || '8000';
        hostBinding = h;
        isHostBindingSafe = (h === '0.0.0.0');
        matchEvidence = {
          file: relFilePath,
          line: lineNum,
          snippet: line.trim(),
          description: `Uvicorn ASGI runner configured with host="${hostBinding}"`,
        };
        break;
      }

      const flaskRunMatch = line.match(/app\.run\s*\((?:[^,]*host=['"]([^'"]+)['"])?(?:[^,]*port=([^,\)]+))?/);
      if (flaskRunMatch) {
        const h = flaskRunMatch[1] || '127.0.0.1'; // Flask default app.run() is localhost
        port = flaskRunMatch[2] || '5000';
        hostBinding = h;
        isHostBindingSafe = (h === '0.0.0.0');
        matchEvidence = {
          file: relFilePath,
          line: lineNum,
          snippet: line.trim(),
          description: `Flask dev server configured with host="${hostBinding}" (requires WSGI for production)`,
        };
        break;
      }
    }

    if (!matchEvidence) return null;

    return {
      hostBinding: hostBinding || 'UNKNOWN',
      port: port || 'process.env.PORT',
      isHostBindingSafe,
      evidence: matchEvidence,
    };
  }

  /**
   * Detects backend characteristics
   * @param {string} workspacePath
   * @param {string} [relDir]
   * @returns {Object|null}
   */
  detectBackend(workspacePath, relDir = '') {
    const targetDir = relDir ? path.join(workspacePath, relDir) : workspacePath;
    const evidence = [];

    let framework = null;
    let runtime = null;
    let entryPoint = null;
    let startCommand = null;
    let buildScript = null;
    let hostBinding = 'UNKNOWN';
    let isHostBindingSafe = true;
    let port = null;

    // -------------------------------------------------------------
    // A. Node.js Backend Detection
    // -------------------------------------------------------------
    const pkgInfo = this.readPackageJson(workspacePath, relDir);
    if (pkgInfo) {
      const { pkg, relPath } = pkgInfo;
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const scripts = pkg.scripts || {};

      if (deps['express']) framework = 'express';
      else if (deps['fastify']) framework = 'fastify';
      else if (deps['@nestjs/core']) framework = 'nestjs';
      else if (deps['koa']) framework = 'koa';
      else if (deps['hono']) framework = 'hono';
      else if (deps['@hapi/hapi']) framework = 'hapi';

      if (framework) {
        runtime = 'node';
        evidence.push({
          file: relPath,
          snippet: `"${framework}": "${deps[framework] || deps['@nestjs/core'] || 'detected'}"`,
          description: `${framework} backend framework detected in package.json`,
        });

        if (pkg.main && fs.existsSync(path.join(targetDir, pkg.main))) {
          entryPoint = relDir ? path.join(relDir, pkg.main) : pkg.main;
        }

        if (scripts.start) {
          startCommand = `npm start (${scripts.start})`;
        } else if (scripts.serve) {
          startCommand = `npm run serve (${scripts.serve})`;
        }

        if (scripts.build) {
          buildScript = `npm run build (${scripts.build})`;
        }
      }
    }

    // -------------------------------------------------------------
    // B. Python Backend Detection
    // -------------------------------------------------------------
    const pyprojectPath = path.join(targetDir, 'pyproject.toml');
    const reqPath = path.join(targetDir, 'requirements.txt');
    const pipfilePath = path.join(targetDir, 'Pipfile');
    const managePyPath = path.join(targetDir, 'manage.py');

    if (fs.existsSync(managePyPath)) {
      runtime = 'python';
      framework = 'django';
      entryPoint = relDir ? path.join(relDir, 'manage.py') : 'manage.py';
      startCommand = 'python manage.py runserver (or gunicorn)';
      evidence.push({
        file: relDir ? path.join(relDir, 'manage.py') : 'manage.py',
        description: 'Django manage.py entrypoint file detected',
      });
    } else {
      const pyManifests = [
        { file: reqPath, rel: relDir ? path.join(relDir, 'requirements.txt') : 'requirements.txt' },
        { file: pyprojectPath, rel: relDir ? path.join(relDir, 'pyproject.toml') : 'pyproject.toml' },
        { file: pipfilePath, rel: relDir ? path.join(relDir, 'Pipfile') : 'Pipfile' },
      ];

      for (const man of pyManifests) {
        const content = this.readFileSafe(man.file);
        if (content) {
          if (/fastapi/i.test(content)) {
            runtime = 'python';
            framework = 'fastapi';
            startCommand = 'uvicorn main:app --host 0.0.0.0 --port $PORT';
            evidence.push({
              file: man.rel,
              snippet: 'fastapi',
              description: 'FastAPI framework detected in Python requirements',
            });
            break;
          } else if (/flask/i.test(content)) {
            runtime = 'python';
            framework = 'flask';
            startCommand = 'gunicorn app:app';
            evidence.push({
              file: man.rel,
              snippet: 'flask',
              description: 'Flask framework detected in Python requirements',
            });
            break;
          }
        }
      }
    }

    // -------------------------------------------------------------
    // C. Inspect Entry Point & Host Binding
    // -------------------------------------------------------------
    const candidateEntryPoints = [
      'server.ts', 'server.js',
      'src/server.ts', 'src/server.js',
      'src/index.ts', 'src/index.js',
      'index.ts', 'index.js',
      'src/main.ts', 'src/main.js',
      'main.ts', 'main.js',
      'app.ts', 'app.js',
      'src/app.ts', 'src/app.js',
      'main.py', 'app.py', 'server.py', 'wsgi.py', 'asgi.py',
    ];

    for (const cand of candidateEntryPoints) {
      const fullCand = path.join(targetDir, cand);
      if (fs.existsSync(fullCand)) {
        if (!entryPoint) {
          entryPoint = relDir ? path.join(relDir, cand) : cand;
        }

        const bindingInfo = this.inspectServerBinding(workspacePath, relDir ? path.join(relDir, cand) : cand);
        if (bindingInfo) {
          hostBinding = bindingInfo.hostBinding;
          isHostBindingSafe = bindingInfo.isHostBindingSafe;
          port = bindingInfo.port;
          evidence.push(bindingInfo.evidence);
          break;
        }
      }
    }

    if (!framework && !runtime && evidence.length === 0) {
      return null;
    }

    return {
      detected: true,
      framework: framework || 'custom backend',
      runtime: runtime || 'node',
      entryPoint,
      startCommand,
      buildScript,
      port,
      hostBinding,
      isHostBindingSafe,
      status: isHostBindingSafe && (startCommand || entryPoint) ? 'READY' : 'WARNING',
      path: relDir || null,
      evidence,
    };
  }

  /**
   * Detects database usage and connection patterns
   * @param {string} workspacePath
   * @param {string} [relDir]
   * @returns {Object|null}
   */
  detectDatabase(workspacePath, relDir = '') {
    const targetDir = relDir ? path.join(workspacePath, relDir) : workspacePath;
    const evidence = [];

    let technology = null;
    let ormOrDriver = null;
    let configFile = null;
    let migrationStatus = 'unknown';
    let usesLocalhost = false;
    let usesEnvVar = false;
    let isSQLite = false;
    let isEphemeralStorageRisk = false;

    // 1. Prisma Detection
    const prismaSchemaPath = path.join(targetDir, 'prisma', 'schema.prisma');
    if (fs.existsSync(prismaSchemaPath)) {
      ormOrDriver = 'prisma';
      configFile = relDir ? path.join(relDir, 'prisma/schema.prisma') : 'prisma/schema.prisma';
      const content = this.readFileSafe(prismaSchemaPath);
      if (content) {
        if (/provider\s*=\s*["']postgresql["']/i.test(content)) technology = 'postgresql';
        else if (/provider\s*=\s*["']mysql["']/i.test(content)) technology = 'mysql';
        else if (/provider\s*=\s*["']sqlite["']/i.test(content)) {
          technology = 'sqlite';
          isSQLite = true;
          isEphemeralStorageRisk = true;
        } else if (/provider\s*=\s*["']mongodb["']/i.test(content)) technology = 'mongodb';

        if (/env\(["']DATABASE_URL["']\)/i.test(content)) {
          usesEnvVar = true;
        }

        const migrationsDir = path.join(targetDir, 'prisma', 'migrations');
        if (fs.existsSync(migrationsDir)) {
          migrationStatus = 'detected (prisma/migrations)';
        }

        evidence.push({
          file: configFile,
          snippet: content.split('\n').find((l) => l.includes('provider') || l.includes('env('))?.trim() || 'datasource db',
          description: `Prisma schema detected (provider: ${technology || 'configured'}, migrations: ${migrationStatus})`,
        });
      }
    }

    // 2. Drizzle Detection
    const drizzleFiles = ['drizzle.config.ts', 'drizzle.config.js'];
    for (const df of drizzleFiles) {
      const dfPath = path.join(targetDir, df);
      if (fs.existsSync(dfPath)) {
        ormOrDriver = ormOrDriver || 'drizzle';
        configFile = relDir ? path.join(relDir, df) : df;
        evidence.push({
          file: configFile,
          description: 'Drizzle ORM configuration detected',
        });
        break;
      }
    }

    // 3. Inspect package.json for drivers if not already identified
    const pkgInfo = this.readPackageJson(workspacePath, relDir);
    if (pkgInfo) {
      const deps = { ...(pkgInfo.pkg.dependencies || {}), ...(pkgInfo.pkg.devDependencies || {}) };

      if (deps['@prisma/client']) ormOrDriver = ormOrDriver || 'prisma';
      if (deps['drizzle-orm']) ormOrDriver = ormOrDriver || 'drizzle';
      if (deps['typeorm']) ormOrDriver = ormOrDriver || 'typeorm';
      if (deps['sequelize']) ormOrDriver = ormOrDriver || 'sequelize';
      if (deps['mongoose']) {
        ormOrDriver = ormOrDriver || 'mongoose';
        technology = technology || 'mongodb';
      }

      if (deps['pg'] || deps['pg-promise'] || deps['postgres']) technology = technology || 'postgresql';
      if (deps['mysql2'] || deps['mysql']) technology = technology || 'mysql';
      if (deps['sqlite3'] || deps['better-sqlite3']) {
        technology = technology || 'sqlite';
        isSQLite = true;
        isEphemeralStorageRisk = true;
      }
      if (deps['ioredis'] || deps['redis']) technology = technology || 'redis';
    }

    // 4. Python Database & ORM checks
    const reqContent = this.readFileSafe(path.join(targetDir, 'requirements.txt')) ||
                       this.readFileSafe(path.join(targetDir, 'pyproject.toml'));
    if (reqContent) {
      if (/sqlalchemy/i.test(reqContent)) ormOrDriver = ormOrDriver || 'sqlalchemy';
      if (/alembic/i.test(reqContent)) {
        migrationStatus = 'detected (alembic)';
        evidence.push({
          file: relDir ? path.join(relDir, 'requirements.txt') : 'requirements.txt',
          snippet: 'alembic',
          description: 'Alembic database migration framework detected',
        });
      }
      if (/psycopg2|asyncpg/i.test(reqContent)) technology = technology || 'postgresql';
      if (/pymongo|motor/i.test(reqContent)) technology = technology || 'mongodb';
      if (/sqlite3/i.test(reqContent)) {
        technology = technology || 'sqlite';
        isSQLite = true;
        isEphemeralStorageRisk = true;
      }
    }

    // 5. Scan source files for localhost DB URIs vs process.env.DATABASE_URL
    const scanFiles = ['server.ts', 'server.js', 'src/server.ts', 'src/server.js', 'src/db.ts', 'src/db.js', 'db.ts', 'db.js', 'app.py', 'settings.py'];
    for (const sf of scanFiles) {
      const content = this.readFileSafe(path.join(targetDir, sf));
      if (content) {
        const relSf = relDir ? path.join(relDir, sf) : sf;

        if (/process\.env\.DATABASE_URL|os\.(?:environ|getenv)\(['"]DATABASE_URL['"]\)/.test(content)) {
          usesEnvVar = true;
          evidence.push({
            file: relSf,
            snippet: 'process.env.DATABASE_URL',
            description: 'Database connection configured via environment variable',
          });
        }

        const localDbMatch = content.match(/(?:postgres(?:ql)?|mongodb|mysql):\/\/[^:]+:[^@]+@(?:localhost|127\.0\.0\.1)/i);
        if (localDbMatch) {
          usesLocalhost = true;
          evidence.push({
            file: relSf,
            snippet: secretFilter.sanitizeString(localDbMatch[0]),
            description: 'Hardcoded local database URI (localhost/127.0.0.1) detected in code',
          });
        }
      }
    }

    if (!technology && !ormOrDriver && evidence.length === 0) {
      return null;
    }

    return {
      detected: true,
      technology: technology || 'database (generic)',
      ormOrDriver: ormOrDriver || null,
      configFile,
      migrationStatus,
      usesLocalhost,
      usesEnvVar,
      isSQLite,
      isEphemeralStorageRisk,
      status: usesLocalhost ? 'WARNING' : 'READY',
      evidence,
    };
  }

  /**
   * Scans workspace for referenced and documented environment variables
   * @param {string} workspacePath
   * @returns {Object}
   */
  detectEnvironmentVariables(workspacePath) {
    const requiredSet = new Set();
    const documentedSet = new Set();
    const evidence = [];

    // 1. Read .env.example, .env.sample, .env.template
    const exampleFiles = ['.env.example', '.env.sample', '.env.template'];
    for (const ef of exampleFiles) {
      const content = this.readFileSafe(path.join(workspacePath, ef));
      if (content) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line && !line.startsWith('#') && line.includes('=')) {
            const varName = line.split('=')[0].trim();
            if (varName && /^[A-Z0-9_]+$/i.test(varName)) {
              documentedSet.add(varName);
            }
          }
        }
        evidence.push({
          file: ef,
          description: `Documented environment variable template detected (${documentedSet.size} variables)`,
        });
      }
    }

    // 2. Scan representative source code files for process.env.VAR and os.getenv('VAR')
    const candidateFiles = [
      'server.ts', 'server.js', 'src/server.ts', 'src/server.js',
      'src/index.ts', 'src/index.js', 'index.ts', 'index.js',
      'src/app.ts', 'src/app.js', 'app.ts', 'app.js',
      'next.config.js', 'next.config.mjs', 'next.config.ts',
      'main.py', 'app.py', 'settings.py',
    ];

    const standardSystemVars = new Set([
      'NODE_ENV', 'PATH', 'PWD', 'HOME', 'USER', 'SHELL', 'CI', 'PORT',
    ]);

    for (const cf of candidateFiles) {
      const content = this.readFileSafe(path.join(workspacePath, cf));
      if (content) {
        // Node process.env.XXX
        const jsMatches = content.matchAll(/process\.env\.([A-Z0-9_]+)/g);
        for (const m of jsMatches) {
          const v = m[1];
          if (v && !standardSystemVars.has(v)) {
            requiredSet.add(v);
          }
        }

        // Python os.getenv / os.environ
        const pyMatches = content.matchAll(/os\.(?:environ\.get|getenv)\s*\(\s*['"]([A-Z0-9_]+)['"]/g);
        for (const m of pyMatches) {
          const v = m[1];
          if (v && !standardSystemVars.has(v)) {
            requiredSet.add(v);
          }
        }
      }
    }

    const missingDocumentation = [...requiredSet].filter((v) => !documentedSet.has(v));

    return {
      required: [...requiredSet].sort(),
      documented: [...documentedSet].sort(),
      missingDocumentation: missingDocumentation.sort(),
      evidence,
    };
  }

  /**
   * Performs full deterministic inspection of a workspace
   * @param {string} workspacePath
   * @returns {Object} ProjectInspectionDescriptor
   */
  inspect(workspacePath) {
    if (!workspacePath || typeof workspacePath !== 'string' || !fs.existsSync(workspacePath)) {
      return {
        valid: false,
        error: 'Invalid or non-existent workspace path',
      };
    }

    const normWorkspace = path.resolve(workspacePath);
    const monorepo = this.detectMonorepo(normWorkspace);

    let frontend = null;
    let backend = null;
    let database = null;

    if (monorepo.isMonorepo && monorepo.discoveredSubApps.length > 0) {
      for (const subApp of monorepo.discoveredSubApps) {
        if (!frontend) frontend = this.detectFrontend(normWorkspace, subApp);
        if (!backend) backend = this.detectBackend(normWorkspace, subApp);
        if (!database) database = this.detectDatabase(normWorkspace, subApp);
      }
    }

    // Fallback or augment with root-level inspection
    if (!frontend) frontend = this.detectFrontend(normWorkspace);
    if (!backend) backend = this.detectBackend(normWorkspace);
    if (!database) database = this.detectDatabase(normWorkspace);

    const envVars = this.detectEnvironmentVariables(normWorkspace);

    return {
      valid: true,
      workspacePath: normWorkspace,
      project: {
        isMonorepo: monorepo.isMonorepo,
        workspaces: monorepo.discoveredSubApps,
        packageManager: monorepo.packageManager,
        hasDocker: monorepo.hasDocker,
        dockerfile: monorepo.dockerfile,
        dockerCompose: monorepo.dockerCompose,
      },
      frontend,
      backend,
      database,
      environmentVariables: envVars,
    };
  }
}

const projectDetector = new ProjectDetector();

module.exports = {
  ProjectDetector,
  projectDetector,
};
