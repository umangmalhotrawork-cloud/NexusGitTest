/**
 * NEXUS INTELLIGENCE LAYER — SOFTWARE EVIDENCE LAYER (Phase 2)
 * 
 * Safe, strictly read-only query facade aggregating observational software intelligence across:
 * 1. GitManager (VCS commit logs, diffs, working tree status)
 * 2. RepositorySymbolIndex (AST symbols, callers, callees, dependencies, dependents)
 * 3. DiagnosticParser (Structured build, compiler, runtime errors, stack traces)
 * 4. TestResultParser (Structured test totals, assertions, failures)
 * 5. EvidenceGraph (Session-scoped verified evidence trail)
 * 6. ItemStore (In-memory agent turn items & code change records)
 * 
 * STRICT READ-ONLY GUARANTEES:
 * - Never modifies, stages, commits, pushes, pulls, checkouts, or discards files.
 * - Never mutates ChangeSet or TransactionalPatchApplier state.
 * - Never writes to Continuum storage or Context Capsule directories.
 * - Never makes AI provider or network API calls.
 */

const path = require('path');
const fs = require('fs');
const secretFilter = require('../../security/secretFilter');
const {
  PROVENANCE_SOURCE,
  CONFIDENCE_LEVELS,
  createEvidenceQueryResult,
} = require('./types');

class SoftwareEvidenceLayer {
  /**
   * @param {Object} [dependencies]
   * @param {Object} [dependencies.gitManager]
   * @param {Object} [dependencies.symbolIndex]
   * @param {Object} [dependencies.diagnosticParser]
   * @param {Object} [dependencies.testResultParser]
   * @param {Object} [dependencies.evidenceGraph]
   * @param {Object} [dependencies.itemStore]
   */
  constructor(dependencies = {}) {
    this._gitManager = dependencies.gitManager || null;
    this._symbolIndex = dependencies.symbolIndex || null;
    this._diagnosticParser = dependencies.diagnosticParser || null;
    this._testResultParser = dependencies.testResultParser || null;
    this._evidenceGraph = dependencies.evidenceGraph || null;
    this._itemStore = dependencies.itemStore || null;
  }

  // =========================================================================
  // LAZY DEPENDENCY RESOLVERS (Ensures zero circular reference issues)
  // =========================================================================

  get gitManager() {
    if (!this._gitManager) {
      try {
        const { gitManager } = require('../gitManager');
        this._gitManager = gitManager;
      } catch (_) {}
    }
    return this._gitManager;
  }

  get symbolIndex() {
    if (!this._symbolIndex) {
      try {
        const { repositorySymbolIndex } = require('../harness/RepositorySymbolIndex');
        this._symbolIndex = repositorySymbolIndex;
      } catch (_) {}
    }
    return this._symbolIndex;
  }

  get diagnosticParser() {
    if (!this._diagnosticParser) {
      try {
        const { diagnosticParser } = require('../debugging/DiagnosticParser');
        this._diagnosticParser = diagnosticParser;
      } catch (_) {}
    }
    return this._diagnosticParser;
  }

  get testResultParser() {
    if (!this._testResultParser) {
      try {
        const { testResultParser } = require('../testing/TestResultParser');
        this._testResultParser = testResultParser;
      } catch (_) {}
    }
    return this._testResultParser;
  }

  get evidenceGraph() {
    if (!this._evidenceGraph) {
      try {
        const { evidenceGraph } = require('../evidence/EvidenceGraph');
        this._evidenceGraph = evidenceGraph;
      } catch (_) {}
    }
    return this._evidenceGraph;
  }

  get itemStore() {
    if (!this._itemStore) {
      try {
        const { itemStore } = require('../harness/ItemStore');
        this._itemStore = itemStore;
      } catch (_) {}
    }
    return this._itemStore;
  }

  // =========================================================================
  // 1. VCS & REPOSITORY EVIDENCE (Read-Only)
  // =========================================================================

  /**
   * Retrieves recent commit history for a workspace (read-only git log).
   * @param {string} workspacePath
   * @param {Object} [options] - { maxCount, skip, branch, file }
   * @returns {Promise<Object>} EvidenceQueryResult with commit log array
   */
  async getRecentCommits(workspacePath, options = {}) {
    if (!workspacePath || typeof workspacePath !== 'string') {
      return createEvidenceQueryResult({
        success: false,
        data: [],
        source: PROVENANCE_SOURCE.VCS,
        error: 'Invalid or missing workspacePath',
      });
    }

    try {
      if (!this.gitManager) {
        return createEvidenceQueryResult({
          success: false,
          data: [],
          source: PROVENANCE_SOURCE.VCS,
          error: 'GitManager unavailable',
        });
      }

      const historyResult = await this.gitManager.getCommitHistory(workspacePath, {
        maxCount: options.maxCount || 20,
        skip: options.skip || 0,
        branch: options.branch || null,
        file: options.file || null,
      });

      const commitsList = Array.isArray(historyResult)
        ? historyResult
        : (historyResult?.commits || []);

      return createEvidenceQueryResult({
        success: historyResult?.success !== false,
        data: commitsList,
        source: PROVENANCE_SOURCE.VCS,
        confidence: CONFIDENCE_LEVELS.DIRECT,
      });

    } catch (err) {
      return createEvidenceQueryResult({
        success: false,
        data: [],
        source: PROVENANCE_SOURCE.VCS,
        error: err.message,
      });
    }
  }

  /**
   * Retrieves the diff for a specific commit hash (read-only).
   * @param {string} workspacePath
   * @param {string} commitHash
   * @param {string} [file=null]
   * @param {number} [parentIndex=0]
   * @returns {Promise<Object>} EvidenceQueryResult with commit diff details
   */
  async getCommitDiff(workspacePath, commitHash, file = null, parentIndex = 0) {
    if (!workspacePath || !commitHash) {
      return createEvidenceQueryResult({
        success: false,
        data: null,
        source: PROVENANCE_SOURCE.VCS,
        error: 'Missing workspacePath or commitHash',
      });
    }

    try {
      if (!this.gitManager) {
        return createEvidenceQueryResult({
          success: false,
          data: null,
          source: PROVENANCE_SOURCE.VCS,
          error: 'GitManager unavailable',
        });
      }

      const diffResult = await this.gitManager.getCommitDiff(workspacePath, commitHash, file, parentIndex);
      return createEvidenceQueryResult({
        success: true,
        data: diffResult || null,
        source: PROVENANCE_SOURCE.VCS,
        confidence: CONFIDENCE_LEVELS.DIRECT,
      });
    } catch (err) {
      return createEvidenceQueryResult({
        success: false,
        data: null,
        source: PROVENANCE_SOURCE.VCS,
        error: err.message,
      });
    }
  }

  /**
   * Observes current working tree status (staged, unstaged, untracked).
   * @param {string} workspacePath
   * @returns {Promise<Object>} EvidenceQueryResult with working tree status
   */
  async getWorkingTreeStatus(workspacePath) {
    if (!workspacePath || typeof workspacePath !== 'string') {
      return createEvidenceQueryResult({
        success: false,
        data: null,
        source: PROVENANCE_SOURCE.VCS,
        error: 'Invalid or missing workspacePath',
      });
    }

    try {
      if (!this.gitManager) {
        return createEvidenceQueryResult({
          success: false,
          data: null,
          source: PROVENANCE_SOURCE.VCS,
          error: 'GitManager unavailable',
        });
      }

      const status = await this.gitManager.getStatus(workspacePath);
      return createEvidenceQueryResult({
        success: true,
        data: status || null,
        source: PROVENANCE_SOURCE.VCS,
        confidence: CONFIDENCE_LEVELS.DIRECT,
      });
    } catch (err) {
      return createEvidenceQueryResult({
        success: false,
        data: null,
        source: PROVENANCE_SOURCE.VCS,
        error: err.message,
      });
    }
  }

  // =========================================================================
  // 2. DIAGNOSTICS & TEST EVIDENCE (Read-Only)
  // =========================================================================

  /**
   * Parses and normalizes raw compiler, runtime, or terminal diagnostics.
   * @param {Object} input - { command, exitCode, stdout, stderr, rawOutput, workspacePath }
   * @returns {Object} EvidenceQueryResult with structured diagnostic model
   */
  getDiagnostics(input = {}) {
    try {
      if (!this.diagnosticParser) {
        return createEvidenceQueryResult({
          success: false,
          data: null,
          source: PROVENANCE_SOURCE.DIAGNOSTIC,
          error: 'DiagnosticParser unavailable',
        });
      }

      const diagnostic = this.diagnosticParser.parse(input);
      return createEvidenceQueryResult({
        success: true,
        data: diagnostic || null,
        source: PROVENANCE_SOURCE.DIAGNOSTIC,
        confidence: diagnostic ? CONFIDENCE_LEVELS.DIRECT : CONFIDENCE_LEVELS.LOW,
      });
    } catch (err) {
      return createEvidenceQueryResult({
        success: false,
        data: null,
        source: PROVENANCE_SOURCE.DIAGNOSTIC,
        error: err.message,
      });
    }
  }

  /**
   * Parses test runner output into structured metrics and failure assertions.
   * Accepts either an object { framework, stdout, stderr, exitCode } or positional arguments.
   * @param {string|Object} frameworkOrInput
   * @param {string} [stdout='']
   * @param {string} [stderr='']
   * @param {number} [exitCode=0]
   * @returns {Object} EvidenceQueryResult with test summary & parsed failures
   */
  getTestResults(frameworkOrInput, stdout = '', stderr = '', exitCode = 0) {
    try {
      if (!this.testResultParser) {
        return createEvidenceQueryResult({
          success: false,
          data: null,
          source: PROVENANCE_SOURCE.TEST,
          error: 'TestResultParser unavailable',
        });
      }

      let framework = 'pytest';
      let outStr = stdout;
      let errStr = stderr;
      let code = exitCode;

      if (typeof frameworkOrInput === 'object' && frameworkOrInput !== null) {
        framework = frameworkOrInput.framework || 'pytest';
        outStr = frameworkOrInput.stdout || '';
        errStr = frameworkOrInput.stderr || '';
        code = frameworkOrInput.exitCode !== undefined ? frameworkOrInput.exitCode : 0;
      } else if (typeof frameworkOrInput === 'string') {
        framework = frameworkOrInput;
      }

      const parsed = this.testResultParser.parse(framework, outStr, errStr, code);
      return createEvidenceQueryResult({
        success: true,
        data: parsed || null,
        source: PROVENANCE_SOURCE.TEST,
        confidence: CONFIDENCE_LEVELS.DIRECT,
      });
    } catch (err) {
      return createEvidenceQueryResult({
        success: false,
        data: null,
        source: PROVENANCE_SOURCE.TEST,
        error: err.message,
      });
    }
  }

  // =========================================================================
  // 3. AST SYMBOL & CALL GRAPH EVIDENCE (Read-Only)
  // =========================================================================

  /**
   * Helper: Ensures SymbolIndex has loaded workspace symbols if needed.
   * @private
   */
  async _ensureSymbolIndex(workspacePath) {
    if (!this.symbolIndex) return false;
    const ws = workspacePath ? path.resolve(workspacePath) : this.symbolIndex.workspacePath;
    if (!ws || !fs.existsSync(ws)) return false;

    if (this.symbolIndex.symbols.size === 0 || this.symbolIndex.workspacePath !== ws) {
      await this.symbolIndex.build(ws);
    }
    return true;
  }

  /**
   * Retrieves callers of a symbol across the workspace.
   * @param {string} workspacePath
   * @param {string} symbol - Symbol identifier or name
   * @returns {Promise<Object>} EvidenceQueryResult with caller list
   */
  async getCallers(workspacePath, symbol) {
    if (!symbol || typeof symbol !== 'string') {
      return createEvidenceQueryResult({
        success: false,
        data: [],
        source: PROVENANCE_SOURCE.AST,
        error: 'Missing symbol argument',
      });
    }

    try {
      if (!this.symbolIndex) {
        return createEvidenceQueryResult({
          success: false,
          data: [],
          source: PROVENANCE_SOURCE.AST,
          error: 'RepositorySymbolIndex unavailable',
        });
      }

      await this._ensureSymbolIndex(workspacePath);
      const callers = this.symbolIndex.getCallers(symbol);

      return createEvidenceQueryResult({
        success: true,
        data: callers || [],
        source: PROVENANCE_SOURCE.AST,
        confidence: callers.length > 0 ? CONFIDENCE_LEVELS.DIRECT : CONFIDENCE_LEVELS.HEURISTIC,
      });
    } catch (err) {
      return createEvidenceQueryResult({
        success: false,
        data: [],
        source: PROVENANCE_SOURCE.AST,
        error: err.message,
      });
    }
  }

  /**
   * Retrieves callees invoked by a symbol.
   * @param {string} workspacePath
   * @param {string} symbol - Symbol identifier or name
   * @returns {Promise<Object>} EvidenceQueryResult with callee list
   */
  async getCallees(workspacePath, symbol) {
    if (!symbol || typeof symbol !== 'string') {
      return createEvidenceQueryResult({
        success: false,
        data: [],
        source: PROVENANCE_SOURCE.AST,
        error: 'Missing symbol argument',
      });
    }

    try {
      if (!this.symbolIndex) {
        return createEvidenceQueryResult({
          success: false,
          data: [],
          source: PROVENANCE_SOURCE.AST,
          error: 'RepositorySymbolIndex unavailable',
        });
      }

      await this._ensureSymbolIndex(workspacePath);
      const callees = this.symbolIndex.getCallees(symbol);

      return createEvidenceQueryResult({
        success: true,
        data: callees || [],
        source: PROVENANCE_SOURCE.AST,
        confidence: callees.length > 0 ? CONFIDENCE_LEVELS.DIRECT : CONFIDENCE_LEVELS.HEURISTIC,
      });
    } catch (err) {
      return createEvidenceQueryResult({
        success: false,
        data: [],
        source: PROVENANCE_SOURCE.AST,
        error: err.message,
      });
    }
  }

  /**
   * Retrieves all workspace files that depend on/import the given file.
   * @param {string} workspacePath
   * @param {string} filePath
   * @returns {Promise<Object>} EvidenceQueryResult with dependent file list
   */
  async getDependents(workspacePath, filePath) {
    if (!filePath || typeof filePath !== 'string') {
      return createEvidenceQueryResult({
        success: false,
        data: [],
        source: PROVENANCE_SOURCE.AST,
        error: 'Missing filePath argument',
      });
    }

    try {
      if (!this.symbolIndex) {
        return createEvidenceQueryResult({
          success: false,
          data: [],
          source: PROVENANCE_SOURCE.AST,
          error: 'RepositorySymbolIndex unavailable',
        });
      }

      await this._ensureSymbolIndex(workspacePath);
      const dependents = this.symbolIndex.getDependents(filePath);

      return createEvidenceQueryResult({
        success: true,
        data: dependents || [],
        source: PROVENANCE_SOURCE.AST,
        confidence: CONFIDENCE_LEVELS.STRUCTURAL,
      });
    } catch (err) {
      return createEvidenceQueryResult({
        success: false,
        data: [],
        source: PROVENANCE_SOURCE.AST,
        error: err.message,
      });
    }
  }

  /**
   * Retrieves all workspace files that the given file depends on/imports.
   * @param {string} workspacePath
   * @param {string} filePath
   * @returns {Promise<Object>} EvidenceQueryResult with dependency file list
   */
  async getDependencies(workspacePath, filePath) {
    if (!filePath || typeof filePath !== 'string') {
      return createEvidenceQueryResult({
        success: false,
        data: [],
        source: PROVENANCE_SOURCE.AST,
        error: 'Missing filePath argument',
      });
    }

    try {
      if (!this.symbolIndex) {
        return createEvidenceQueryResult({
          success: false,
          data: [],
          source: PROVENANCE_SOURCE.AST,
          error: 'RepositorySymbolIndex unavailable',
        });
      }

      await this._ensureSymbolIndex(workspacePath);
      const dependencies = this.symbolIndex.getDependencies(filePath);

      return createEvidenceQueryResult({
        success: true,
        data: dependencies || [],
        source: PROVENANCE_SOURCE.AST,
        confidence: CONFIDENCE_LEVELS.STRUCTURAL,
      });
    } catch (err) {
      return createEvidenceQueryResult({
        success: false,
        data: [],
        source: PROVENANCE_SOURCE.AST,
        error: err.message,
      });
    }
  }

  /**
   * Evaluates potential downstream impact across targets (files or symbols).
   * @param {string} workspacePath
   * @param {Array<string>} targets
   * @returns {Promise<Object>} EvidenceQueryResult with impact analysis
   */
  async getPotentialImpact(workspacePath, targets = []) {
    if (!Array.isArray(targets) || targets.length === 0) {
      return createEvidenceQueryResult({
        success: true,
        data: {
          symbols: [],
          files: [],
          callers: [],
          callees: [],
          dependents: [],
          dependencies: [],
          confidence: CONFIDENCE_LEVELS.LOW,
        },
        source: PROVENANCE_SOURCE.AST,
      });
    }

    try {
      if (!this.symbolIndex) {
        return createEvidenceQueryResult({
          success: false,
          data: null,
          source: PROVENANCE_SOURCE.AST,
          error: 'RepositorySymbolIndex unavailable',
        });
      }

      await this._ensureSymbolIndex(workspacePath);
      const impact = this.symbolIndex.getPotentialImpact(targets);

      return createEvidenceQueryResult({
        success: true,
        data: impact || null,
        source: PROVENANCE_SOURCE.AST,
        confidence: CONFIDENCE_LEVELS.STRUCTURAL,
      });
    } catch (err) {
      return createEvidenceQueryResult({
        success: false,
        data: null,
        source: PROVENANCE_SOURCE.AST,
        error: err.message,
      });
    }
  }

  // =========================================================================
  // 4. AGENT & EVIDENCE GRAPH RECORDS (Read-Only)
  // =========================================================================

  /**
   * Observes agent-generated code changes and staged files for a session.
   * @param {string} sessionId
   * @returns {Object} EvidenceQueryResult with code change records
   */
  getAgentChanges(sessionId = 'default_session') {
    try {
      const changes = [];

      // 1. In-memory EvidenceGraph CODE_CHANGE nodes
      if (this.evidenceGraph) {
        const nodes = this.evidenceGraph.getNodesBySession(sessionId) || [];
        for (const n of nodes) {
          if (n.type === 'CODE_CHANGE' || n.type === 'TRANSACTION') {
            changes.push({
              id: n.id,
              type: n.type,
              filePath: n.filePath,
              statement: n.statement,
              verified: n.verified,
              timestamp: n.timestamp,
              provenance: n.provenance,
              metadata: n.metadata,
            });
          }
        }
      }

      // 2. In-memory ItemStore FILE_CHANGE items if available
      if (this.itemStore && changes.length === 0) {
        const items = this.itemStore.getItemsByThread(sessionId) || [];
        for (const item of items) {
          if (item.type === 'FILE_CHANGE' || item.type === 'CHANGE_SET') {
            changes.push({
              id: item.itemId,
              type: item.type,
              filePath: item.payload?.filePath || null,
              statement: item.payload?.summary || item.payload?.changeType || 'FILE_CHANGE',
              verified: Boolean(item.payload?.verified),
              timestamp: item.createdAt || Date.now(),
              provenance: 'MODEL_INFERENCE',
              metadata: item.payload || {},
            });
          }
        }
      }

      return createEvidenceQueryResult({
        success: true,
        data: changes,
        source: PROVENANCE_SOURCE.EVIDENCE,
        confidence: CONFIDENCE_LEVELS.DIRECT,
      });
    } catch (err) {
      return createEvidenceQueryResult({
        success: false,
        data: [],
        source: PROVENANCE_SOURCE.EVIDENCE,
        error: err.message,
      });
    }
  }

  /**
   * Retrieves all evidence nodes for a session.
   * @param {string} sessionId
   * @returns {Object} EvidenceQueryResult with evidence nodes
   */
  getEvidence(sessionId = 'default_session') {
    try {
      if (!this.evidenceGraph) {
        return createEvidenceQueryResult({
          success: false,
          data: [],
          source: PROVENANCE_SOURCE.EVIDENCE,
          error: 'EvidenceGraph unavailable',
        });
      }

      const nodes = this.evidenceGraph.getNodesBySession(sessionId) || [];
      return createEvidenceQueryResult({
        success: true,
        data: nodes,
        source: PROVENANCE_SOURCE.EVIDENCE,
        confidence: CONFIDENCE_LEVELS.DIRECT,
      });
    } catch (err) {
      return createEvidenceQueryResult({
        success: false,
        data: [],
        source: PROVENANCE_SOURCE.EVIDENCE,
        error: err.message,
      });
    }
  }

  /**
   * Retrieves authoritative verification summary for a session.
   * @param {string} sessionId
   * @returns {Object} EvidenceQueryResult with verification summary
   */
  getVerificationSummary(sessionId = 'default_session') {
    try {
      if (!this.evidenceGraph) {
        return createEvidenceQueryResult({
          success: false,
          data: null,
          source: PROVENANCE_SOURCE.EVIDENCE,
          error: 'EvidenceGraph unavailable',
        });
      }

      const summary = this.evidenceGraph.getVerificationSummary(sessionId);
      return createEvidenceQueryResult({
        success: true,
        data: summary || null,
        source: PROVENANCE_SOURCE.EVIDENCE,
        confidence: CONFIDENCE_LEVELS.DIRECT,
      });
    } catch (err) {
      return createEvidenceQueryResult({
        success: false,
        data: null,
        source: PROVENANCE_SOURCE.EVIDENCE,
        error: err.message,
      });
    }
  }
}

const softwareEvidenceLayer = new SoftwareEvidenceLayer();

module.exports = {
  SoftwareEvidenceLayer,
  softwareEvidenceLayer,
};
