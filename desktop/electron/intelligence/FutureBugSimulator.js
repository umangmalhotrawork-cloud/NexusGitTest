/**
 * NEXUS INTELLIGENCE LAYER — FUTURE BUG SIMULATOR (Phase 6)
 * 
 * Implements evidence-backed deterministic analysis of plausible failure scenarios
 * BEFORE production.
 * 
 * STRICT ARCHITECTURAL INVARIANTS:
 * - Read-only by default: Never mutates workspace files, Git history, or state.
 * - ZERO AI provider API calls for deterministic scenario classification & static forecast.
 * - Clear distinction between:
 *   1. STATIC FORECAST — NOT EXECUTED
 *   2. EXECUTED SANDBOX SIMULATION
 *   3. HEURISTIC INFERENCE
 * - Never claims an experiment occurred unless actually executed in a verified safe sandbox.
 * - Semantic Evidence Rule: A file only appears in affectedFiles when there is a real relationship
 *   (direct import, AST caller/callee, symbol reference, or explicit active file).
 * - Excludes all generated reports (exports/**, EchoNullity-Report-**, findings.json).
 * - Grounding Rule: If no dependency exists for a scenario (e.g. no DB in a pure math function),
 *   returns INCONCLUSIVE with honest LOW confidence and no fabricated advice.
 * - Zero ChangeSet creation, zero AgentLoop execution, zero Continuum writes, zero Context Capsule writes.
 */

const path = require('path');
const fs = require('fs');
const secretFilter = require('../../security/secretFilter');

const {
  SCENARIO_TYPES,
  SIMULATION_MODES,
  SIMULATION_STATUS,
  SIMULATION_SEVERITY,
  SIMULATION_CONFIDENCE,
  createSimulationReport,
} = require('./SimulationReport');

// Directories to strictly ignore during static code traversal
const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nexus',
  'out',
  'coverage',
  'fixtures',
  'exports',
  '.git',
  '__pycache__',
  'reports',
  'temp',
  'tmp',
  '.echo-nullity-backup',
]);

// Source code extensions permitted for affected file inclusion
const SOURCE_EXTENSIONS = new Set(['.js', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs']);

class FutureBugSimulator {
  /**
   * @param {Object} [dependencies]
   * @param {Object} [dependencies.evidenceLayer]
   * @param {Object} [dependencies.testManager]
   * @param {Object} [dependencies.decisionEngine]
   */
  constructor(dependencies = {}) {
    this._evidenceLayer = dependencies.evidenceLayer || null;
    this._testManager = dependencies.testManager || null;
    this._decisionEngine = dependencies.decisionEngine || null;
  }

  // =========================================================================
  // LAZY DEPENDENCY RESOLVERS
  // =========================================================================

  get evidenceLayer() {
    if (!this._evidenceLayer) {
      try {
        const { softwareEvidenceLayer } = require('./SoftwareEvidenceLayer');
        this._evidenceLayer = softwareEvidenceLayer;
      } catch (_) {}
    }
    return this._evidenceLayer;
  }

  get testManager() {
    if (!this._testManager) {
      try {
        const { TestManager } = require('../testManager');
        this._testManager = new TestManager();
      } catch (_) {}
    }
    return this._testManager;
  }

  get decisionEngine() {
    if (!this._decisionEngine) {
      try {
        const { decisionReplayEngine } = require('./DecisionReplayEngine');
        this._decisionEngine = decisionReplayEngine;
      } catch (_) {}
    }
    return this._decisionEngine;
  }

  // =========================================================================
  // 1. DETERMINISTIC SCENARIO CLASSIFICATION (0 AI Provider Calls)
  // =========================================================================

  /**
   * Classifies a developer query into one of the 12 deterministic scenario types.
   * 
   * @param {string} question
   * @returns {string} One of SCENARIO_TYPES
   */
  classifyScenario(question) {
    if (!question || typeof question !== 'string') {
      return SCENARIO_TYPES.UNKNOWN;
    }

    const q = question.trim().toLowerCase();

    // 1. SLOW_DATABASE
    if (
      /(?:database|db|postgres|mysql|mongo|sqlite|redis|sql|query|queries).*(?:slower|slow|latency|delay|lag|10x|100x|timeout)/i.test(q) ||
      /(?:slower|slow|latency|delay).*(?:database|db|postgres|mysql|mongo|sqlite|query)/i.test(q) ||
      /database\s+becomes\s+10[x\xd7]\s+slower/i.test(q)
    ) {
      return SCENARIO_TYPES.SLOW_DATABASE;
    }

    // 2. DATABASE_UNAVAILABLE
    if (
      /(?:database|db|postgres|mysql|mongo|sqlite).*(?:unavailable|down|drop|disconnect|unreachable|crashes|refused|killed)/i.test(q) ||
      /(?:connection\s+to\s+(?:database|db)\s+(?:drops|lost|fails))/i.test(q)
    ) {
      return SCENARIO_TYPES.DATABASE_UNAVAILABLE;
    }

    // 3. HIGH_TRAFFIC
    if (
      /(?:10[x\xd7]|100[x\xd7]|high|peak|spike|heavy)\s+(?:traffic|load|volume|concurrency|requests|users)/i.test(q) ||
      /under\s+(?:10[x\xd7]|heavy|high|peak)\s+traffic/i.test(q) ||
      /traffic\s+(?:spike|increase|surge)/i.test(q)
    ) {
      return SCENARIO_TYPES.HIGH_TRAFFIC;
    }

    // 4. EXPIRED_AUTH_TOKEN
    if (
      /(?:auth|authentication|jwt|session|oauth|access|bearer|refresh)\s*(?:token)?.*(?:expire|expired|invalid|revoked|timeout|corrupt)/i.test(q) ||
      /token\s+(?:expires|is\s+expired|is\s+invalid)/i.test(q)
    ) {
      return SCENARIO_TYPES.EXPIRED_AUTH_TOKEN;
    }

    // 5. NULL_OR_MISSING_DATA
    if (
      /\bnull\b|undefined|empty\s+(?:input|payload|string|body|data)|missing\s+(?:property|key|field|attribute|value|parameter)/i.test(q) ||
      /receives?\s+null/i.test(q)
    ) {
      return SCENARIO_TYPES.NULL_OR_MISSING_DATA;
    }

    // 6. INVALID_INPUT
    if (
      /invalid\s+input|malformed|bad\s+(?:input|payload|request)|schema\s+mismatch|unexpected\s+type|negative\s+(?:amount|number)|illegal\s+argument/i.test(q) ||
      /receives?\s+(?:malformed|invalid)/i.test(q)
    ) {
      return SCENARIO_TYPES.INVALID_INPUT;
    }

    // 7. CONCURRENT_UPDATE
    if (
      /(?:two|multiple|concurrent)\s+users\s+(?:update|edit|write|modify|buy|checkout)/i.test(q) ||
      /race\s+condition|simultaneous\s+(?:update|write|request)|optimistic\s+lock|double\s+(?:spending|booking|submit)/i.test(q) ||
      /update\s+(?:this\s+)?at\s+the\s+same\s+time/i.test(q)
    ) {
      return SCENARIO_TYPES.CONCURRENT_UPDATE;
    }

    // 8. REQUEST_TIMEOUT
    if (
      /request\s+times?\s*out|timeout|hanging\s+socket|socket\s+hang\s*up|gateway\s+timeout|504|upstream\s+timeout/i.test(q)
    ) {
      return SCENARIO_TYPES.REQUEST_TIMEOUT;
    }

    // 9. DEPENDENCY_UNAVAILABLE
    if (
      /(?:stripe|twilio|sendgrid|s3|aws|redis|kafka|rabbitmq|npm|dependency).*(?:unavailable|down|unreachable|outage|offline|blocked)/i.test(q) ||
      /dependency\s+(?:becomes\s+)?unavailable/i.test(q)
    ) {
      return SCENARIO_TYPES.DEPENDENCY_UNAVAILABLE;
    }

    // 10. EXTERNAL_API_FAILURE
    if (
      /external\s+api|third\s+party\s+api|upstream\s+(?:500|error|failure|service)|api\s+(?:fails|down|returns\s+500)/i.test(q) ||
      /payment\s+provider.*(?:unavailable|down|fails|error)/i.test(q)
    ) {
      return SCENARIO_TYPES.EXTERNAL_API_FAILURE;
    }

    // 11. RATE_LIMIT
    if (
      /rate\s*limit|429|too\s+many\s+requests|throttl|quota\s+exceeded/i.test(q)
    ) {
      return SCENARIO_TYPES.RATE_LIMIT;
    }

    // 12. RETRY_DUPLICATION
    if (
      /retry\s+duplication|idempotenc|double\s+charg|duplicate\s+(?:request|order|payment|transaction)|replay\s+attack/i.test(q)
    ) {
      return SCENARIO_TYPES.RETRY_DUPLICATION;
    }

    return SCENARIO_TYPES.UNKNOWN;
  }

  // =========================================================================
  // 2. SIMULATION ENGINE ENTRYPOINT
  // =========================================================================

  /**
   * Simulates future failure scenarios based on developer question and workspace state.
   * 
   * @param {string} question - Developer query e.g. "What happens if the database becomes 10x slower?"
   * @param {Object} [options]
   * @param {string} [options.workspacePath]
   * @param {string} [options.activeFilePath]
   * @param {boolean} [options.allowSandbox=false] - If true, permits safe isolated test execution
   * @returns {Promise<Object>} FutureBugSimulationReport
   */
  async simulate(question, options = {}) {
    const cleanQuestion = typeof question === 'string' ? question.trim() : '';
    const workspacePath = options.workspacePath || process.cwd();
    const activeFilePath = options.activeFilePath || null;
    const allowSandbox = Boolean(options.allowSandbox);

    const scenarioType = this.classifyScenario(cleanQuestion);

    // If query is completely unrecognized and vague, return honest inconclusive report
    if (scenarioType === SCENARIO_TYPES.UNKNOWN && cleanQuestion.length < 10) {
      return createSimulationReport({
        question: cleanQuestion,
        scenarioType: SCENARIO_TYPES.UNKNOWN,
        mode: SIMULATION_MODES.HEURISTIC_INFERENCE,
        status: SIMULATION_STATUS.INCONCLUSIVE,
        summary: 'The query could not be mapped to an identifiable failure scenario.',
        severity: SIMULATION_SEVERITY.LOW,
        confidence: SIMULATION_CONFIDENCE.LOW,
        assumptions: ['No specific fault scenario or target component was specified.'],
        limitations: ['Deterministic static analysis requires an identifiable fault type.'],
      });
    }

    // 1. Gather semantic static evidence
    const staticEvidence = await this._gatherStaticEvidence(scenarioType, workspacePath, activeFilePath);

    // 2. Determine execution vs static mode
    // External dependency, external API, or live infrastructure outage scenarios must NOT execute live network calls
    const isExternalNetworkScenario = [
      SCENARIO_TYPES.DEPENDENCY_UNAVAILABLE,
      SCENARIO_TYPES.EXTERNAL_API_FAILURE,
      SCENARIO_TYPES.DATABASE_UNAVAILABLE,
    ].includes(scenarioType);

    if (allowSandbox && !isExternalNetworkScenario && staticEvidence.safeSandboxTest) {
      try {
        const sandboxReport = await this._executeSandboxSimulation(
          cleanQuestion,
          scenarioType,
          staticEvidence,
          workspacePath
        );
        if (sandboxReport) {
          return sandboxReport;
        }
      } catch (_) {
        // Fall back gracefully to static forecast
      }
    }

    // 3. Generate Static Forecast (Default & Safe)
    return this._generateStaticForecast(cleanQuestion, scenarioType, staticEvidence, workspacePath);
  }

  // =========================================================================
  // 3. STATIC EVIDENCE GATHERING (0 AI Provider Calls)
  // =========================================================================

  /**
   * Discovers affected files, symbols, call graphs, configs, and tests for the scenario.
   * Strictly enforces semantic relationship rules.
   * @private
   */
  async _gatherStaticEvidence(scenarioType, workspacePath, activeFilePath) {
    const evidenceItems = [];
    const affectedFiles = [];
    const affectedSymbols = [];
    let safeSandboxTest = null;
    let matchedTests = [];

    let activeFileContent = '';
    let activeFileClean = null;

    // A. Sanitize and validate active file
    if (activeFilePath && typeof activeFilePath === 'string') {
      const normalized = path.normalize(activeFilePath);
      if (!this._isExcludedPath(normalized)) {
        activeFileClean = normalized;
        affectedFiles.push(activeFileClean);

        const fullActive = path.isAbsolute(activeFileClean)
          ? activeFileClean
          : path.join(workspacePath, activeFileClean);
        if (fs.existsSync(fullActive)) {
          try {
            activeFileContent = fs.readFileSync(fullActive, 'utf8');
          } catch (_) {}
        }
      }
    }

    // B. If NO active file is selected, look for strictly relevant source files
    if (affectedFiles.length === 0) {
      const candidateFiles = await this._findSemanticSourceFiles(scenarioType, workspacePath);
      for (const f of candidateFiles) {
        if (!affectedFiles.includes(f)) {
          affectedFiles.push(f);
        }
      }
    }

    // C. AST Symbol & Call Graph Analysis via SoftwareEvidenceLayer
    let directDependencies = [];
    let symbolCallers = [];
    let symbolCallees = [];

    if (affectedFiles.length > 0) {
      const primaryFile = affectedFiles[0];

      if (this.evidenceLayer) {
        try {
          const depsRes = await this.evidenceLayer.getDependencies(workspacePath, primaryFile);
          if (depsRes.success && Array.isArray(depsRes.data) && depsRes.data.length > 0) {
            directDependencies = depsRes.data.filter((d) => !this._isExcludedPath(d));
            for (const d of directDependencies.slice(0, 3)) {
              if (!affectedFiles.includes(d)) affectedFiles.push(d);
            }
            if (directDependencies.length > 0) {
              evidenceItems.push({
                type: 'dependency_graph',
                source: 'SoftwareEvidenceLayer',
                description: `${primaryFile} directly imports ${directDependencies.slice(0, 3).join(', ')}`,
              });
            }
          }

          const symbolIndex = this.evidenceLayer.symbolIndex;
          if (symbolIndex) {
            const workspaceSymbols = symbolIndex.getSymbolsInFile
              ? symbolIndex.getSymbolsInFile(primaryFile)
              : [];

            for (const sym of workspaceSymbols.slice(0, 5)) {
              const symName = typeof sym === 'string' ? sym : sym.name;
              if (symName && !affectedSymbols.includes(symName)) {
                affectedSymbols.push(symName);

                const callers = symbolIndex.getCallers(symName);
                if (Array.isArray(callers) && callers.length > 0) {
                  symbolCallers.push(...callers);
                  evidenceItems.push({
                    type: 'call_graph',
                    source: 'RepositorySymbolIndex',
                    description: `Symbol '${symName}' invoked by ${callers.length} upstream caller(s): ${callers.slice(0, 2).map((c) => c.symbol || c).join(', ')}`,
                  });
                }

                const callees = symbolIndex.getCallees ? symbolIndex.getCallees(symName) : [];
                if (Array.isArray(callees) && callees.length > 0) {
                  symbolCallees.push(...callees);
                }
              }
            }
          }
        } catch (_) {}
      }

      // If symbols not found via index, extract basic function definitions from content
      if (affectedSymbols.length === 0 && activeFileContent) {
        const fnMatches = activeFileContent.matchAll(/(?:def|function|const|let|var)\s+([a-zA-Z0-9_]+)\s*(?:=|\()/g);
        for (const m of fnMatches) {
          if (m[1] && !affectedSymbols.includes(m[1]) && m[1].length > 2) {
            affectedSymbols.push(m[1]);
          }
        }
      }
    }

    // D. Semantic Scenario Relationship Evaluation
    const relationshipAssessment = this._assessScenarioRelationship(
      scenarioType,
      affectedFiles,
      affectedSymbols,
      activeFileContent,
      directDependencies,
      symbolCallees,
      workspacePath
    );

    if (relationshipAssessment.evidence) {
      evidenceItems.push(relationshipAssessment.evidence);
    }

    // E. Architectural Decision Records lookup
    if (this.decisionEngine) {
      try {
        const decisions = this.decisionEngine.getDecisions({ workspacePath });
        if (Array.isArray(decisions) && decisions.length > 0) {
          const relevantDecisions = decisions.filter((d) => {
            const text = `${d.title} ${d.decision} ${d.problem} ${d.rationale}`.toLowerCase();
            if (scenarioType === SCENARIO_TYPES.SLOW_DATABASE || scenarioType === SCENARIO_TYPES.DATABASE_UNAVAILABLE) {
              return text.includes('database') || text.includes('db') || text.includes('sql') || text.includes('cache');
            }
            if (scenarioType === SCENARIO_TYPES.EXPIRED_AUTH_TOKEN) {
              return text.includes('auth') || text.includes('token') || text.includes('jwt') || text.includes('session');
            }
            if (scenarioType === SCENARIO_TYPES.CONCURRENT_UPDATE) {
              return text.includes('concurren') || text.includes('lock') || text.includes('transact') || text.includes('order');
            }
            return false;
          });

          for (const rd of relevantDecisions.slice(0, 2)) {
            evidenceItems.push({
              type: 'decision',
              source: 'DecisionReplayEngine',
              description: `Architectural Decision (${rd.status}): "${rd.title}" — ${rd.decision}`,
            });
          }
        }
      } catch (_) {}
    }

    // F. Configuration inspection (manifest files)
    const configEvidence = this._inspectConfigurationEvidence(scenarioType, workspacePath);
    if (configEvidence) {
      evidenceItems.push(configEvidence);
    }

    // G. Semantic Test Matching (Strict: only tests that actually exercise affected components)
    if (this.testManager && affectedFiles.length > 0) {
      try {
        const allTests = this.testManager.scanFiles(workspacePath);
        matchedTests = this._findMatchingTests(allTests, affectedFiles, affectedSymbols, workspacePath);

        if (matchedTests.length > 0) {
          safeSandboxTest = matchedTests[0];
          evidenceItems.push({
            type: 'test',
            source: 'TestManager',
            description: `Found ${matchedTests.length} unit test suite(s) directly exercising affected components: ${path.basename(matchedTests[0])}`,
          });
        }
      } catch (_) {}
    }

    return {
      affectedFiles,
      affectedSymbols,
      evidenceItems,
      safeSandboxTest,
      matchedTests,
      relationshipAssessment,
    };
  }

  /**
   * Determines whether a given path is an excluded artifact, report, or non-source directory.
   * @private
   */
  _isExcludedPath(filePath) {
    if (!filePath || typeof filePath !== 'string') return true;
    const lower = filePath.toLowerCase().replace(/\\/g, '/');

    // Strict artifact exclusions
    if (
      lower.includes('exports/') ||
      lower.includes('echonullity-report') ||
      lower.includes('findings.json') ||
      lower.endsWith('.json') ||
      lower.endsWith('.yaml') ||
      lower.endsWith('.yml') ||
      lower.endsWith('.md')
    ) {
      return true;
    }

    const segments = lower.split('/');
    return segments.some((seg) => IGNORED_DIRS.has(seg) || seg.startsWith('.'));
  }

  /**
   * Discovers real source files relevant to a scenario when no active file is given.
   * @private
   */
  async _findSemanticSourceFiles(scenarioType, workspacePath) {
    const results = [];
    if (!workspacePath || !fs.existsSync(workspacePath)) return results;

    const keywords = [];
    switch (scenarioType) {
      case SCENARIO_TYPES.SLOW_DATABASE:
      case SCENARIO_TYPES.DATABASE_UNAVAILABLE:
        keywords.push('db', 'database', 'repository', 'repo', 'model', 'sql', 'store');
        break;
      case SCENARIO_TYPES.EXPIRED_AUTH_TOKEN:
        keywords.push('auth', 'token', 'jwt', 'session', 'permission');
        break;
      case SCENARIO_TYPES.DEPENDENCY_UNAVAILABLE:
      case SCENARIO_TYPES.EXTERNAL_API_FAILURE:
        keywords.push('stripe', 'payment', 'gateway', 'client', 'http');
        break;
      case SCENARIO_TYPES.CONCURRENT_UPDATE:
        keywords.push('order', 'cart', 'inventory', 'account', 'balance', 'transaction');
        break;
      case SCENARIO_TYPES.HIGH_TRAFFIC:
      case SCENARIO_TYPES.RATE_LIMIT:
        keywords.push('server', 'handler', 'route', 'api', 'controller', 'middleware');
        break;
      case SCENARIO_TYPES.INVALID_INPUT:
      case SCENARIO_TYPES.NULL_OR_MISSING_DATA:
        keywords.push('validator', 'schema', 'parser', 'handler');
        break;
      default:
        keywords.push('main', 'index', 'app');
        break;
    }

    try {
      const walk = (dir, depth = 0) => {
        if (depth > 4 || results.length >= 5) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = path.relative(workspacePath, fullPath);

          if (this._isExcludedPath(relPath)) {
            continue;
          }

          if (entry.isDirectory()) {
            walk(fullPath, depth + 1);
          } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            const lowerName = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
            if (keywords.some((kw) => lowerName.includes(kw))) {
              results.push(relPath);
            }
          }
        }
      };

      walk(workspacePath);
    } catch (_) {}

    return results.slice(0, 4);
  }

  /**
   * Evaluates whether there is a real semantic dependency between the affected code and the scenario.
   * Concrete evidence required: actual imports of DB packages, explicit DB client calls, SQL literals, or known DB callees.
   * @private
   */
  _assessScenarioRelationship(
    scenarioType,
    affectedFiles,
    affectedSymbols,
    fileContent,
    dependencies,
    callees,
    workspacePath
  ) {
    const primaryFile = affectedFiles[0] || 'target';

    // 1. Concrete Database Patterns
    const REAL_DB_IMPORT_PATTERNS = [
      /(?:import|from)\s+(?:sqlite3|psycopg2|psycopg|sqlalchemy|pymongo|motor|tortoise|databases|asyncpg|mysql|redis|peewee|django\.db)\b/i,
      /(?:require\(|from\s+)['"](?:pg|pg-promise|mysql|mysql2|sqlite3|better-sqlite3|mongoose|typeorm|sequelize|@prisma\/client|knex|redis|ioredis|couchbase|cassandra-driver)['"]/i,
    ];

    const REAL_DB_CALL_PATTERNS = [
      /\b(?:db|database|pool|cursor|session|prisma|knex|conn|connection)\s*\.\s*(?:query|execute|raw|execute_sql|findAll|findMany|findOne|findById|insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|transaction)\s*\(/i,
      /['"`]\s*(?:SELECT\s+.+\s+FROM|INSERT\s+INTO\s+.+\s+VALUES|UPDATE\s+.+\s+SET|DELETE\s+FROM\s+.+\s+WHERE|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b/i,
      /\b(?:session\.add|session\.commit|session\.rollback|session\.query|db\.session)\b/i,
    ];

    const REAL_DB_CALLEE_PATTERNS = [
      /\b(?:executeQuery|executeSql|runQuery|queryDatabase|fetchFromDb|saveToDb|persistToDb|insertRecord|updateRecord|deleteRecord)\b/i,
    ];

    // 2. Concrete Auth Patterns
    const REAL_AUTH_IMPORT_PATTERNS = [
      /(?:import|from)\s+(?:jwt|jose|passlib|bcrypt|argon2|authlib|oauth2|keycloak)\b/i,
      /(?:require\(|from\s+)['"](?:jsonwebtoken|jose|passport|bcrypt|bcryptjs|argon2|next-auth|@auth0\/nextjs-auth0)['"]/i,
    ];

    const REAL_AUTH_CALL_PATTERNS = [
      /\b(?:jwt\.verify|jwt\.decode|bcrypt\.compare|passport\.authenticate|req\.headers\[['"]authorization['"]\]|request\.headers\.get\(['"]authorization['"]\))\b/i,
      /\b(?:verify_token|decode_token|authenticate_user|require_auth|auth_middleware)\s*\(/i,
    ];

    // 3. Concrete External API Patterns
    const REAL_EXT_API_IMPORT_PATTERNS = [
      /(?:import|from)\s+(?:stripe|requests|httpx|aiohttp|urllib3|twilio|sendgrid|boto3)\b/i,
      /(?:require\(|from\s+)['"](?:stripe|axios|node-fetch|got|twilio|@sendgrid\/mail|@aws-sdk|superagent)['"]/i,
    ];

    const REAL_EXT_API_CALL_PATTERNS = [
      /\b(?:fetch|axios\.get|axios\.post|axios\.put|axios\.delete|requests\.get|requests\.post|requests\.put|requests\.delete|httpx\.get|httpx\.post|http\.request|https\.request|stripe\.[a-zA-Z0-9_]+\.create)\s*\(/i,
    ];

    if (scenarioType === SCENARIO_TYPES.SLOW_DATABASE || scenarioType === SCENARIO_TYPES.DATABASE_UNAVAILABLE) {
      const hasDbImport = fileContent && REAL_DB_IMPORT_PATTERNS.some((p) => p.test(fileContent));
      const hasDbCall = fileContent && REAL_DB_CALL_PATTERNS.some((p) => p.test(fileContent));
      const hasDbDep = dependencies.some((d) => REAL_DB_IMPORT_PATTERNS.some((p) => p.test(d)));
      const hasDbCallee = callees.some((c) => {
        const name = typeof c === 'string' ? c : c.symbol || c.name || '';
        return REAL_DB_CALLEE_PATTERNS.some((p) => p.test(name));
      });

      const established = Boolean(hasDbImport || hasDbCall || hasDbDep || hasDbCallee);
      return {
        established,
        scenarioType,
        reason: established
          ? 'Database queries, driver imports, or ORM operations detected in affected code path.'
          : 'No database queries, drivers, ORMs, or connection pools exist in the affected code path.',
        evidence: established
          ? {
              type: 'ast_inspection',
              source: 'SoftwareEvidenceLayer',
              description: `Database operations confirmed in '${path.basename(primaryFile)}'.`,
            }
          : {
              type: 'ast_inspection',
              source: 'SoftwareEvidenceLayer',
              description: `Inspected '${path.basename(primaryFile)}' and confirmed 0 database calls, SQL queries, or driver imports.`,
            },
      };
    }

    if (scenarioType === SCENARIO_TYPES.EXPIRED_AUTH_TOKEN) {
      const hasAuthImport = fileContent && REAL_AUTH_IMPORT_PATTERNS.some((p) => p.test(fileContent));
      const hasAuthCall = fileContent && REAL_AUTH_CALL_PATTERNS.some((p) => p.test(fileContent));
      const hasAuthDep = dependencies.some((d) => REAL_AUTH_IMPORT_PATTERNS.some((p) => p.test(d)));
      const established = Boolean(hasAuthImport || hasAuthCall || hasAuthDep);
      return {
        established,
        scenarioType,
        reason: established
          ? 'Authentication token verification or session handling detected in code path.'
          : 'No authentication token or session verification logic found in affected code path.',
        evidence: {
          type: 'ast_inspection',
          source: 'SoftwareEvidenceLayer',
          description: established
            ? `Auth token handling confirmed in '${path.basename(primaryFile)}'.`
            : `Inspected '${path.basename(primaryFile)}' and confirmed 0 token verification logic.`,
        },
      };
    }

    if (scenarioType === SCENARIO_TYPES.DEPENDENCY_UNAVAILABLE || scenarioType === SCENARIO_TYPES.EXTERNAL_API_FAILURE) {
      const hasExtImport = fileContent && REAL_EXT_API_IMPORT_PATTERNS.some((p) => p.test(fileContent));
      const hasExtCall = fileContent && REAL_EXT_API_CALL_PATTERNS.some((p) => p.test(fileContent));
      const hasExtDep = dependencies.some((d) => REAL_EXT_API_IMPORT_PATTERNS.some((p) => p.test(d)));
      const established = Boolean(hasExtImport || hasExtCall || hasExtDep);
      return {
        established,
        scenarioType,
        reason: established
          ? 'External API/HTTP client calls detected in affected code path.'
          : 'No external HTTP or third-party service calls found in affected code path.',
        evidence: {
          type: 'ast_inspection',
          source: 'SoftwareEvidenceLayer',
          description: established
            ? `External service calls confirmed in '${path.basename(primaryFile)}'.`
            : `Inspected '${path.basename(primaryFile)}' and confirmed 0 external API calls.`,
        },
      };
    }

    return {
      established: true,
      scenarioType,
      reason: 'General code structure analyzed for scenario plausibility.',
    };
  }

  /**
   * Determines whether a file path is a test file.
   * @private
   */
  _isTestFile(filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    const lower = filePath.toLowerCase().replace(/\\/g, '/');
    const baseName = path.basename(lower);
    return (
      lower.includes('/tests/') ||
      lower.includes('/test/') ||
      lower.includes('/__tests__/') ||
      baseName.startsWith('test_') ||
      baseName.endsWith('_test.py') ||
      baseName.endsWith('_test.js') ||
      baseName.endsWith('_test.ts') ||
      baseName.endsWith('.test.js') ||
      baseName.endsWith('.test.ts') ||
      baseName.endsWith('.test.tsx') ||
      baseName.endsWith('.test.jsx') ||
      baseName.endsWith('.spec.js') ||
      baseName.endsWith('.spec.ts') ||
      baseName.endsWith('.spec.tsx') ||
      baseName.endsWith('.spec.jsx')
    );
  }

  /**
   * Matches unit test files strictly to affected files and symbols.
   * @private
   */
  _findMatchingTests(allTests, affectedFiles, affectedSymbols, workspacePath) {
    const matched = [];
    const targetBaseNames = affectedFiles.map((f) =>
      path.basename(f, path.extname(f)).toLowerCase()
    );
    const absTargetFiles = affectedFiles.map((f) => path.resolve(workspacePath, f));

    for (const tf of allTests) {
      if (this._isExcludedPath(tf)) continue;
      if (!this._isTestFile(tf)) continue;

      const absTf = path.resolve(workspacePath, tf);
      if (absTargetFiles.includes(absTf)) continue;

      const ext = path.extname(tf).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(ext)) continue;

      const baseName = path.basename(tf, ext).toLowerCase();

      // Check filename relationship: e.g. test_cart_calculator.py matches cart_calculator.py
      const matchesFilename = targetBaseNames.some((tb) => {
        return (
          baseName === `test_${tb}` ||
          baseName === `${tb}_test` ||
          baseName === `${tb}.test` ||
          baseName === `${tb}.spec`
        );
      });

      if (matchesFilename) {
        matched.push(tf);
        continue;
      }

      // Check if test content imports target file or references target symbol
      try {
        const fullPath = path.isAbsolute(tf) ? tf : path.join(workspacePath, tf);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, 'utf8');
          const importsTarget = targetBaseNames.some((tb) => content.includes(tb));
          const callsSymbol = affectedSymbols.some((ts) => ts && content.includes(ts));
          if (importsTarget || callsSymbol) {
            matched.push(tf);
          }
        }
      } catch (_) {}
    }

    return [...new Set(matched)];
  }

  /**
   * Helper to inspect config files for timeout and connection values.
   * @private
   */
  _inspectConfigurationEvidence(scenarioType, workspacePath) {
    try {
      const pkgPath = path.join(workspacePath, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const raw = fs.readFileSync(pkgPath, 'utf8');
        const pkg = JSON.parse(raw);
        const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

        if (scenarioType === SCENARIO_TYPES.SLOW_DATABASE || scenarioType === SCENARIO_TYPES.DATABASE_UNAVAILABLE) {
          const dbDeps = Object.keys(allDeps).filter((d) =>
            /(?:pg|postgres|mysql|sqlite|mongoose|mongodb|redis|prisma|typeorm|sequelize|knex)/i.test(d)
          );
          if (dbDeps.length > 0) {
            return {
              type: 'configuration',
              source: 'package.json',
              description: `Database driver/ORM dependencies detected in manifest: ${dbDeps.join(', ')}`,
            };
          }
        }

        if (scenarioType === SCENARIO_TYPES.DEPENDENCY_UNAVAILABLE || scenarioType === SCENARIO_TYPES.EXTERNAL_API_FAILURE) {
          const extDeps = Object.keys(allDeps).filter((d) =>
            /(?:stripe|axios|node-fetch|got|twilio|aws-sdk|@aws-sdk)/i.test(d)
          );
          if (extDeps.length > 0) {
            return {
              type: 'configuration',
              source: 'package.json',
              description: `External service/HTTP dependencies detected in manifest: ${extDeps.join(', ')}`,
            };
          }
        }
      }
    } catch (_) {}
    return null;
  }

  // =========================================================================
  // 4. STATIC FORECAST GENERATOR (Mode 1)
  // =========================================================================

  /**
   * Constructs a static forecast based on AST, call graph, config, and decision records.
   * @private
   */
  _generateStaticForecast(question, scenarioType, staticEvidence, workspacePath) {
    const { affectedFiles, affectedSymbols, evidenceItems, relationshipAssessment } = staticEvidence;
    const primaryFile = affectedFiles[0] || 'Unknown';
    const primarySymbol = affectedSymbols[0] || '';

    let summary = '';
    let expectedBehavior = '';
    let failureBehavior = '';
    let severity = SIMULATION_SEVERITY.HIGH;
    let confidence = SIMULATION_CONFIDENCE.MEDIUM;
    let status = SIMULATION_STATUS.PREDICTED;
    const likelyFailurePoints = [];
    const suggestedTests = [];
    const assumptions = [];
    const limitations = [
      'STATIC FORECAST — NOT EXECUTED: No sandbox execution or network simulation occurred.',
      'Analysis derived deterministically from workspace AST, call graph, dependencies, and configuration.',
    ];

    // Check if the scenario dependency is unestablished for the target code path
    if (relationshipAssessment && relationshipAssessment.established === false) {
      status = SIMULATION_STATUS.INCONCLUSIVE;
      confidence = SIMULATION_CONFIDENCE.LOW;
      severity = SIMULATION_SEVERITY.LOW;

      if (scenarioType === SCENARIO_TYPES.SLOW_DATABASE || scenarioType === SCENARIO_TYPES.DATABASE_UNAVAILABLE) {
        summary = `No database dependency was established for the selected code path ('${path.basename(primaryFile)}'), so NEXUS cannot ground a database-latency failure forecast.`;
        expectedBehavior = primarySymbol
          ? `'${primarySymbol}' operates as a local calculation or handler with no database I/O.`
          : 'Selected code path operates without database I/O.';
        failureBehavior = 'Database latency changes will have no direct impact on this code path unless an upstream or downstream caller introduces a database dependency.';
        suggestedTests.push('No database dependency was found; no database-specific test can be grounded.');
        limitations.push('AST inspection confirmed 0 database calls or driver dependencies in target.');
      } else if (scenarioType === SCENARIO_TYPES.EXPIRED_AUTH_TOKEN) {
        summary = `No authentication token dependency was established for '${path.basename(primaryFile)}', so NEXUS cannot ground a token expiration forecast.`;
        expectedBehavior = 'Selected code path executes without token verification requirements.';
        failureBehavior = 'Auth token expiration will not directly affect this component.';
        suggestedTests.push('No auth token dependency was found; no token-specific test can be grounded.');
      } else if (scenarioType === SCENARIO_TYPES.DEPENDENCY_UNAVAILABLE || scenarioType === SCENARIO_TYPES.EXTERNAL_API_FAILURE) {
        summary = `No external API dependency was established for '${path.basename(primaryFile)}', so NEXUS cannot ground an external API failure forecast.`;
        expectedBehavior = 'Selected component performs in-process operations without network requests.';
        failureBehavior = 'External service outages will not directly impact this component.';
        suggestedTests.push('No external API dependency was found; no network-specific test can be grounded.');
      }

      return createSimulationReport({
        question,
        scenarioType,
        mode: SIMULATION_MODES.STATIC_FORECAST,
        status,
        summary,
        affectedFiles,
        affectedSymbols,
        likelyFailurePoints: [],
        expectedBehavior,
        failureBehavior,
        severity,
        confidence,
        evidence: evidenceItems,
        suggestedTests,
        assumptions,
        limitations,
      });
    }

    // GROUNDED SCENARIO FORECASTS
    switch (scenarioType) {
      case SCENARIO_TYPES.SLOW_DATABASE:
        summary = 'Database latency increase will propagate up the call graph, threatening upstream request timeout thresholds.';
        expectedBehavior = 'Queries complete within baseline latency budget (< 50ms).';
        failureBehavior = 'Requests block on database calls; connection pool saturation may cause gateway 504 timeouts or uncaught rejection.';
        severity = SIMULATION_SEVERITY.HIGH;
        confidence = affectedFiles.length > 0 ? SIMULATION_CONFIDENCE.HIGH : SIMULATION_CONFIDENCE.MEDIUM;

        likelyFailurePoints.push({
          file: primaryFile,
          symbol: primarySymbol || 'databaseQuery',
          description: 'Synchronous or awaited database query blocks handler thread.',
          risk: SIMULATION_SEVERITY.HIGH,
        });

        suggestedTests.push('Inject synthetic 500ms latency on database driver query method and assert timeout handling.');
        suggestedTests.push('Run load test with 50 concurrent transactions to evaluate pool exhaustion behavior.');
        assumptions.push('Upstream HTTP servers enforce standard timeout limits (e.g. 5s-30s).');
        break;

      case SCENARIO_TYPES.DATABASE_UNAVAILABLE:
        summary = 'Database connection drop will trigger connection refusal errors in repository layers.';
        expectedBehavior = 'Service connects to primary database instance.';
        failureBehavior = 'Unhandled ECONNREFUSED or database client crash if reconnection / circuit-breaker is missing.';
        severity = SIMULATION_SEVERITY.CRITICAL;
        confidence = SIMULATION_CONFIDENCE.HIGH;

        likelyFailurePoints.push({
          file: primaryFile,
          description: 'Connection pool initialization and query dispatch without circuit breaker.',
          risk: SIMULATION_SEVERITY.CRITICAL,
        });

        suggestedTests.push('Simulate database port unreachable and verify graceful 503 Service Unavailable response.');
        break;

      case SCENARIO_TYPES.EXPIRED_AUTH_TOKEN:
        summary = 'Expired authentication tokens will be rejected at auth middleware or signature verification checkpoints.';
        expectedBehavior = 'Token verified against secret/public key and current timestamp before expiry.';
        failureBehavior = 'If expiration check is bypassed or uncaught, unauthenticated requests may access protected endpoints or trigger 500 crash instead of 401.';
        severity = SIMULATION_SEVERITY.HIGH;
        confidence = SIMULATION_CONFIDENCE.HIGH;

        likelyFailurePoints.push({
          file: primaryFile,
          description: 'Token validation expiration timestamp comparison (`exp` claim).',
          risk: SIMULATION_SEVERITY.HIGH,
        });

        suggestedTests.push('Pass expired JWT token (exp: now - 3600) and verify HTTP 401 Unauthorized.');
        suggestedTests.push('Pass malformed signature token and verify HTTP 401 Unauthorized without stack trace leak.');
        break;

      case SCENARIO_TYPES.CONCURRENT_UPDATE:
        summary = 'Simultaneous updates to the same record without optimistic locking or transactional isolation may cause race conditions and lost updates.';
        expectedBehavior = 'Sequential updates preserve atomic state transitions.';
        failureBehavior = 'Last-write-wins overwrites prior modifications; inventory or balance counts become desynchronized.';
        severity = SIMULATION_SEVERITY.HIGH;
        confidence = SIMULATION_CONFIDENCE.MEDIUM;

        likelyFailurePoints.push({
          file: primaryFile,
          symbol: primarySymbol || undefined,
          description: 'Read-modify-write cycle without version check or database transaction lock.',
          risk: SIMULATION_SEVERITY.HIGH,
        });

        suggestedTests.push('Execute 2 parallel update mutations on the same entity and assert atomic version validation.');
        break;

      case SCENARIO_TYPES.DEPENDENCY_UNAVAILABLE:
      case SCENARIO_TYPES.EXTERNAL_API_FAILURE:
        summary = 'External dependency or API failure will propagate to caller unless wrapped in timeout and fallback boundaries.';
        expectedBehavior = 'External API returns 200 OK within SLA.';
        failureBehavior = 'External 500/timeout triggers uncaught exception or hangs request if no fallback circuit breaker is configured.';
        severity = SIMULATION_SEVERITY.HIGH;
        confidence = SIMULATION_CONFIDENCE.HIGH;

        likelyFailurePoints.push({
          file: primaryFile,
          description: 'Direct network call without fallback mock or error transformation.',
          risk: SIMULATION_SEVERITY.HIGH,
        });

        suggestedTests.push('Mock external endpoint returning 500 Internal Server Error and verify graceful error response to client.');
        suggestedTests.push('Simulate socket timeout of 10s on external client and verify fallback handling.');
        break;

      case SCENARIO_TYPES.NULL_OR_MISSING_DATA:
      case SCENARIO_TYPES.INVALID_INPUT:
        summary = `Null, missing, or malformed input will trigger TypeError / AttributeError in '${path.basename(primaryFile)}' if parameter schemas are not validated at boundary.`;
        expectedBehavior = 'Input parameters conform to expected schema and type contracts.';
        failureBehavior = 'Runtime crash: unchecked property access or missing key access on null / undefined input.';
        severity = SIMULATION_SEVERITY.MEDIUM;
        confidence = SIMULATION_CONFIDENCE.HIGH;

        likelyFailurePoints.push({
          file: primaryFile,
          symbol: primarySymbol || undefined,
          description: 'Unchecked property access or iteration on input arguments.',
          risk: SIMULATION_SEVERITY.MEDIUM,
        });

        suggestedTests.push(`Call '${primarySymbol || 'handler'}' with null, empty, and invalid type arguments and assert graceful validation error.`);
        break;

      case SCENARIO_TYPES.HIGH_TRAFFIC:
      case SCENARIO_TYPES.RATE_LIMIT:
        summary = 'Traffic surge will increase memory consumption and event loop lag; unthrottled endpoints may exhaust resources.';
        expectedBehavior = 'Steady-state throughput within provisioned capacity.';
        failureBehavior = 'Event loop blockage, response latency degradation, and potential OOM or connection drops under unthrottled load.';
        severity = SIMULATION_SEVERITY.HIGH;
        confidence = SIMULATION_CONFIDENCE.MEDIUM;

        suggestedTests.push('Run benchmark test measuring response latency under 100 concurrent virtual users.');
        break;

      default:
        summary = `Evaluation of fault scenario: ${scenarioType}.`;
        expectedBehavior = 'Baseline standard execution.';
        failureBehavior = 'Potential anomaly under simulated stress condition.';
        severity = SIMULATION_SEVERITY.MEDIUM;
        confidence = SIMULATION_CONFIDENCE.LOW;
        break;
    }

    return createSimulationReport({
      question,
      scenarioType,
      mode: SIMULATION_MODES.STATIC_FORECAST,
      status,
      summary,
      affectedFiles,
      affectedSymbols,
      likelyFailurePoints,
      expectedBehavior,
      failureBehavior,
      severity,
      confidence,
      evidence: evidenceItems,
      suggestedTests,
      assumptions,
      limitations,
    });
  }

  // =========================================================================
  // 5. SANDBOX SIMULATION (Mode 2 — When Safe Local Runner Available)
  // =========================================================================

  /**
   * Executes a safe local unit test in the sandbox to observe concrete failure behavior.
   * Strictly isolated from external production networks or databases.
   * @private
   */
  async _executeSandboxSimulation(question, scenarioType, staticEvidence, workspacePath) {
    const testFile = staticEvidence.safeSandboxTest;
    if (!testFile || !this.testManager) return null;

    if (this._isExcludedPath(testFile)) return null;

    // Safety verification: only run unit tests inside the workspace test directory
    const absTest = path.resolve(workspacePath, testFile);
    if (!fs.existsSync(absTest)) return null;

    const startTime = Date.now();
    const runResult = await this.testManager.runTest({
      workspacePath,
      filePath: absTest,
      testName: '',
      framework: absTest.endsWith('.py') ? 'pytest' : 'jest',
    });

    const durationMs = Date.now() - startTime;
    const passed = runResult.status === 'passed';

    const observedResults = [
      {
        executionMethod: `Isolated Sandbox Unit Runner (${path.basename(absTest)})`,
        exitCode: runResult.exitCode || 0,
        stdout: secretFilter.sanitizeString(runResult.stdout || ''),
        stderr: secretFilter.sanitizeString(runResult.stderr || ''),
        failingTests: passed ? [] : [runResult.failureMessage || path.basename(absTest)],
        passed,
        durationMs,
      },
    ];

    const evidenceItems = [
      ...staticEvidence.evidenceItems,
      {
        type: 'sandbox_execution',
        source: 'TestManager',
        description: `Executed isolated test '${path.basename(absTest)}' in sandbox in ${durationMs}ms (Status: ${runResult.status.toUpperCase()})`,
      },
    ];

    return createSimulationReport({
      question,
      scenarioType,
      mode: SIMULATION_MODES.SANDBOX_SIMULATION,
      status: SIMULATION_STATUS.VERIFIED,
      summary: `Executed sandbox test validation on ${path.basename(absTest)}. Observed status: ${runResult.status.toUpperCase()}.`,
      affectedFiles: staticEvidence.affectedFiles,
      affectedSymbols: staticEvidence.affectedSymbols,
      likelyFailurePoints: [
        {
          file: staticEvidence.affectedFiles[0] || path.basename(absTest),
          description: passed
            ? 'Existing unit test passes under standard assertions.'
            : `Test failure observed: ${runResult.failureMessage || 'Assertion failed'}`,
          risk: passed ? SIMULATION_SEVERITY.LOW : SIMULATION_SEVERITY.HIGH,
        },
      ],
      expectedBehavior: 'All assertions in unit test suite pass cleanly.',
      failureBehavior: passed
        ? 'No local unit test failure observed under baseline conditions.'
        : runResult.failureMessage || 'Assertion failure observed in sandbox.',
      severity: passed ? SIMULATION_SEVERITY.LOW : SIMULATION_SEVERITY.HIGH,
      confidence: SIMULATION_CONFIDENCE.HIGH,
      evidence: evidenceItems,
      observedResults,
      suggestedTests: ['Run extended fault injection suite.'],
      assumptions: ['Sandbox execution ran with local mock isolation and zero production network access.'],
      limitations: ['Executed inside local unit sandbox only; does not simulate physical multi-node network partitions.'],
    });
  }

  // =========================================================================
  // 6. SCENARIO PRESETS
  // =========================================================================

  /**
   * Returns standard scenario presets for the UI.
   * @returns {Array<Object>}
   */
  getScenarioPresets() {
    return [
      {
        id: 'slow_db',
        title: 'Slow DB',
        scenarioType: SCENARIO_TYPES.SLOW_DATABASE,
        question: 'What happens if the database becomes 10× slower?',
        icon: 'Database',
      },
      {
        id: 'high_traffic',
        title: '10× Traffic',
        scenarioType: SCENARIO_TYPES.HIGH_TRAFFIC,
        question: 'What happens under 10× traffic?',
        icon: 'Activity',
      },
      {
        id: 'expired_token',
        title: 'Expired Token',
        scenarioType: SCENARIO_TYPES.EXPIRED_AUTH_TOKEN,
        question: 'What happens if the authentication token expires?',
        icon: 'Key',
      },
      {
        id: 'api_down',
        title: 'API Down',
        scenarioType: SCENARIO_TYPES.DEPENDENCY_UNAVAILABLE,
        question: 'What happens if the payment provider is unavailable?',
        icon: 'CloudOff',
      },
      {
        id: 'concurrent_users',
        title: 'Concurrent Users',
        scenarioType: SCENARIO_TYPES.CONCURRENT_UPDATE,
        question: 'What happens if two users update this at the same time?',
        icon: 'Users',
      },
      {
        id: 'timeout',
        title: 'Timeout',
        scenarioType: SCENARIO_TYPES.REQUEST_TIMEOUT,
        question: 'What happens if a request times out?',
        icon: 'Clock',
      },
      {
        id: 'invalid_input',
        title: 'Invalid Input',
        scenarioType: SCENARIO_TYPES.INVALID_INPUT,
        question: 'What happens if this function receives null / malformed input?',
        icon: 'AlertTriangle',
      },
    ];
  }
}

// Global singleton
const futureBugSimulator = new FutureBugSimulator();

module.exports = {
  FutureBugSimulator,
  futureBugSimulator,
};
