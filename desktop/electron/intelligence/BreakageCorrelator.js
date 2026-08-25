/**
 * NEXUS INTELLIGENCE LAYER — BREAKAGE CORRELATOR (Phase 3)
 * 
 * Implements "WHY DID THIS BREAK?" — Deterministic, strictly read-only causal analysis
 * correlating test failures, build errors, compiler diagnostics, and runtime crashes
 * with recent code commits, AST call-graph relationships, AI-generated patches,
 * and dependency/config modifications.
 * 
 * STRICT ARCHITECTURAL INVARIANTS:
 * - Read-only analysis: NEVER mutates code, stage, branch, repository, or state.
 * - NEVER automatically creates a ChangeSet or triggers an agent execution.
 * - NEVER executes AgentLoop, Continuum writes, or Context Capsule mutations.
 * - ZERO AI provider API calls for causal analysis.
 * - Bounded history scanning (max 10 commits).
 * - Honest, evidence-derived confidence ranking (HIGH, MEDIUM, LOW).
 * - Full secret filtering on all outputs and evidence summaries.
 */

const path = require('path');
const fs = require('fs');
const secretFilter = require('../../security/secretFilter');
const {
  CONFIDENCE_TIERS,
  EVIDENCE_TYPES,
  PROVENANCE_SOURCE,
} = require('./types');

// Bounded recent commit scan depth
const MAX_RECENT_COMMITS_SCAN = 10;

// Known dependency and configuration manifest file names
const CONFIG_AND_DEPENDENCY_FILES = new Set([
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'requirements.txt',
  'pyproject.toml',
  'Pipfile',
  'Pipfile.lock',
  'setup.py',
  'setup.cfg',
  'tsconfig.json',
  'jsconfig.json',
  'webpack.config.js',
  'vite.config.ts',
  'vite.config.js',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.js',
  'Cargo.toml',
  'Cargo.lock',
  'go.mod',
  'go.sum',
]);

class BreakageCorrelator {
  /**
   * @param {Object} [dependencies]
   * @param {Object} [dependencies.evidenceLayer]
   */
  constructor(dependencies = {}) {
    this._evidenceLayer = dependencies.evidenceLayer || null;
  }

  get evidenceLayer() {
    if (!this._evidenceLayer) {
      try {
        const { softwareEvidenceLayer } = require('./SoftwareEvidenceLayer');
        this._evidenceLayer = softwareEvidenceLayer;
      } catch (_) {}
    }
    return this._evidenceLayer;
  }

  // =========================================================================
  // 1. FAILURE NORMALIZATION (Deterministic • Zero AI Calls)
  // =========================================================================

  /**
   * Normalizes disparate failure inputs into a clean, structured failure descriptor.
   * @param {Object} input
   * @returns {Object} Normalized failure struct
   */
  _normalizeFailure(input = {}) {
    const rawMsg = input.message || input.rawOutput || input.stderr || input.stdout || '';
    const sanitizedRaw = typeof rawMsg === 'string' ? secretFilter.sanitizeString(rawMsg) : '';

    let type = 'UNKNOWN_FAILURE';
    let message = sanitizedRaw || 'No detailed failure message provided';
    let filePath = input.activeFilePath || null;
    let line = null;
    let column = null;
    let symbol = null;
    let testName = null;
    let stackTrace = null;

    // 1. Direct Diagnostic Input
    if (input.diagnostic && typeof input.diagnostic === 'object') {
      const diag = input.diagnostic;
      type = diag.errorCategory || diag.category || 'DIAGNOSTIC_ERROR';
      message = diag.summary || diag.friendlyExplanation || diag.message || message;
      filePath = diag.filePath || filePath;
      line = typeof diag.line === 'number' ? diag.line : line;
      column = typeof diag.column === 'number' ? diag.column : column;
      symbol = diag.symbol || symbol;
      stackTrace = diag.stackTrace || stackTrace;
    }

    // 2. Direct Test Result Input
    if (input.testResult && typeof input.testResult === 'object') {
      const tr = input.testResult;
      type = 'TEST_FAILURE';
      if (Array.isArray(tr.failures) && tr.failures.length > 0) {
        const firstFail = tr.failures[0];
        testName = firstFail.testName || firstFail.name || testName;
        message = firstFail.message || firstFail.error || message;
        filePath = firstFail.filePath || tr.filePath || filePath;
        line = typeof firstFail.line === 'number' ? firstFail.line : line;
        stackTrace = firstFail.stackTrace || stackTrace;
      } else if (tr.summary && tr.summary.failed > 0) {
        message = `Test suite failed (${tr.summary.failed} failing tests)`;
      }
    }

    // 3. Fallback to Parsing Raw Output via DiagnosticParser
    if ((!filePath || !line) && sanitizedRaw && this.evidenceLayer) {
      const parsedDiag = this.evidenceLayer.getDiagnostics({
        rawOutput: sanitizedRaw,
        command: input.command,
        workspacePath: input.workspacePath,
      });

      if (parsedDiag && parsedDiag.success && parsedDiag.data) {
        const d = parsedDiag.data;
        if (d.errorCategory && d.errorCategory !== 'UNKNOWN') {
          type = d.errorCategory;
        }
        if (d.summary) {
          message = d.summary;
        }
        filePath = d.filePath || filePath;
        line = typeof d.line === 'number' ? d.line : line;
        column = typeof d.column === 'number' ? d.column : column;
        symbol = d.symbol || symbol;
        stackTrace = d.stackTrace || stackTrace;
      }
    }

    // 4. Fallback to Parsing Raw Output via TestResultParser (Only if still UNKNOWN_FAILURE)
    if (type === 'UNKNOWN_FAILURE' && sanitizedRaw && this.evidenceLayer) {
      const parsedTest = this.evidenceLayer.getTestResults(
        input.framework || 'pytest',
        input.stdout || sanitizedRaw,
        input.stderr || '',
        input.exitCode || 1
      );

      if (parsedTest && parsedTest.success && parsedTest.data && parsedTest.data.failures?.length > 0) {
        type = 'TEST_FAILURE';
        const f = parsedTest.data.failures[0];
        testName = f.testName || testName;
        filePath = f.filePath || filePath;
        line = typeof f.line === 'number' ? f.line : line;
        message = f.message || message;
      }
    }

    // 5. Extract testName from raw traceback frame if available
    if (!testName && sanitizedRaw) {
      const tMatch = sanitizedRaw.match(/(?:in\s+|::|FAILED\s+.*?::)(test_\w+)/);
      if (tMatch) {
        testName = tMatch[1];
      }
    }

    // 6. Refine failure type if in a test context
    const isTestContext = Boolean(
      testName ||
      (filePath && (filePath.includes('/tests/') || filePath.includes('/test/') || filePath.startsWith('test_') || filePath.endsWith('_test.py') || filePath.endsWith('_tests.py')))
    );
    if (isTestContext && (type === 'UNKNOWN_FAILURE' || type === 'PYTHON_TRACEBACK' || type === 'DIAGNOSTIC_ERROR' || type === 'ASSERTION_FAILURE')) {
      type = 'TEST_FAILURE';
    }

    // Sanitize normalized file path relative to workspace if absolute
    if (filePath && input.workspacePath && path.isAbsolute(filePath)) {
      try {
        const rel = path.relative(input.workspacePath, filePath);
        if (!rel.startsWith('..')) {
          filePath = rel;
        }
      } catch (_) {}
    }

    return {
      type: secretFilter.sanitizeString(type),
      message: secretFilter.sanitizeString(message),
      filePath: filePath ? secretFilter.sanitizeString(filePath) : null,
      line,
      column,
      symbol: symbol ? secretFilter.sanitizeString(symbol) : null,
      test: testName ? secretFilter.sanitizeString(testName) : null,
      stackTrace: stackTrace ? secretFilter.sanitizeString(stackTrace) : null,
    };
  }

  /**
   * Extracts detailed assertion mismatch information (expected, actual, function under test).
   * @private
   */
  _extractAssertionDetails(failure, rawOutput, workspacePath) {
    const raw = rawOutput || failure.message || '';
    let expected = null;
    let actual = null;
    let assertionExpr = null;
    let targetFunction = null;

    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    const lastErrLine = lines.slice().reverse().find((l) =>
      l.includes('AssertionError') || l.includes('Error') || l.includes('Expected') || l.includes('assert') || l.includes('!=')
    ) || lines[lines.length - 1] || '';

    // Pattern 1: Expected X but got Y / Expected X, got Y
    const expGotMatch = lastErrLine.match(/expected\s+['"]?([^'",\n]+?)['"]?(?:,|\s+)?(?:but\s+)?got\s+['"]?([^'"\n]+)['"]?/i);
    if (expGotMatch) {
      expected = expGotMatch[1].trim();
      actual = expGotMatch[2].trim();
    }

    // Pattern 2: Expected: X \n Received: Y (Jest/Vitest)
    if (!expected) {
      const expRecMatch = raw.match(/Expected:\s*['"]?([^\n'"]+)['"]?\s*\n\s*Received:\s*['"]?([^\n'"]+)['"]?/i);
      if (expRecMatch) {
        expected = expRecMatch[1].trim();
        actual = expRecMatch[2].trim();
      }
    }

    // Pattern 3: assert actual == expected / assert expected == actual
    if (!expected) {
      const assertEqMatch = lastErrLine.match(/assert\s+(.+?)\s*==\s*(.+)/i) || raw.match(/assert\s+(.+?)\s*==\s*(.+)/i);
      if (assertEqMatch) {
        actual = assertEqMatch[1].trim();
        expected = assertEqMatch[2].trim();
      }
    }

    // Pattern 4: actual != expected
    if (!expected) {
      const neMatch = lastErrLine.match(/['"]?([^'",\n]+)['"]?\s*!=\s*['"]?([^'",\n]+)['"]?/);
      if (neMatch) {
        actual = neMatch[1].trim();
        expected = neMatch[2].trim();
      }
    }

    // Extract assertion expression line from traceback or raw output
    const assertLineMatch = raw.match(/(?:>|\s+)(assert\s+[^,\n]+(?:,\s*f?["'].*?["'])?)/);
    if (assertLineMatch) {
      assertionExpr = assertLineMatch[1].trim();
    }

    // Extract target function from failure file or test name
    if (failure.filePath && workspacePath) {
      try {
        const absPath = path.isAbsolute(failure.filePath)
          ? failure.filePath
          : path.resolve(workspacePath, failure.filePath);
        if (fs.existsSync(absPath)) {
          const fileContent = fs.readFileSync(absPath, 'utf8');
          const fileLines = fileContent.split('\n');
          const errLineIdx = (failure.line || 1) - 1;
          for (let i = Math.max(0, errLineIdx - 6); i <= errLineIdx; i++) {
            const l = fileLines[i] || '';
            const trimmed = l.trim();
            if (trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
            if (trimmed.startsWith('def ') || trimmed.startsWith('async def ')) continue;
            const fnCallMatch = l.match(/(?:^|[^a-zA-Z0-9_])([a-zA-Z_]\w*)\s*\(/);
            if (fnCallMatch) {
              const name = fnCallMatch[1];
              if (!['assert', 'print', 'len', 'range', 'int', 'str', 'float', 'list', 'dict', 'set', 'expect'].includes(name) && !name.startsWith('test_')) {
                targetFunction = name;
                break;
              }
            }
          }
          if (!targetFunction) {
            const importMatch = fileContent.match(/from\s+[\w\.]+\s+import\s+([\w,\s]+)/);
            if (importMatch) {
              const imported = importMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
              if (imported.length > 0 && !imported[0].startsWith('test_')) targetFunction = imported[0];
            }
          }

        }
      } catch (_) {}
    }

    // Derive targetFunction from test name if still not found
    if (!targetFunction && failure.test) {
      const derived = failure.test
        .replace(/^test_/, '')
        .replace(/_(?:failing|failure|mismatch|error|standard|basic|discount|case|edge|test).*$/, '');
      if (derived && derived.length > 2) {
        targetFunction = derived;
      }
    }

    return {
      isAssertionMismatch: Boolean(expected && actual),
      expected,
      actual,
      assertionExpr: assertionExpr || (expected && actual ? `assert expected (${expected}) == actual (${actual})` : null),
      targetFunction,
    };
  }


  // =========================================================================
  // 2. STRUCTURAL AST & SYMBOL CONTEXT
  // =========================================================================

  /**
   * Resolves callers, callees, dependents, and dependencies for failure location.
   * @private
   */
  async _resolveStructuralContext(workspacePath, failure) {
    const structural = {
      callers: [],
      callees: [],
      dependents: [],
      dependencies: [],
      relevantFiles: new Set(),
    };

    if (!this.evidenceLayer || !workspacePath) {
      return structural;
    }

    if (failure.filePath) {
      structural.relevantFiles.add(failure.filePath);

      // Query dependents and dependencies via SoftwareEvidenceLayer
      try {
        const depRes = await this.evidenceLayer.getDependents(workspacePath, failure.filePath);
        if (depRes?.success && Array.isArray(depRes.data)) {
          structural.dependents = depRes.data;
          depRes.data.forEach((f) => structural.relevantFiles.add(f));
        }

        const impRes = await this.evidenceLayer.getDependencies(workspacePath, failure.filePath);
        if (impRes?.success && Array.isArray(impRes.data)) {
          structural.dependencies = impRes.data;
          impRes.data.forEach((f) => structural.relevantFiles.add(f));
        }
      } catch (_) {}
    }

    if (failure.symbol) {
      try {
        const callersRes = await this.evidenceLayer.getCallers(workspacePath, failure.symbol);
        if (callersRes?.success && Array.isArray(callersRes.data)) {
          structural.callers = callersRes.data;
          callersRes.data.forEach((c) => {
            if (c.filePath) structural.relevantFiles.add(c.filePath);
          });
        }

        const calleesRes = await this.evidenceLayer.getCallees(workspacePath, failure.symbol);
        if (calleesRes?.success && Array.isArray(calleesRes.data)) {
          structural.callees = calleesRes.data;
          calleesRes.data.forEach((c) => {
            if (c.filePath) structural.relevantFiles.add(c.filePath);
          });
        }
      } catch (_) {}
    }

    return structural;
  }

  // =========================================================================
  // 3. BOUNDED GIT CHANGE ANALYSIS (Max 10 Commits)
  // =========================================================================

  /**
   * Inspects recent git history for relevant commits and diffs.
   * @private
   */
  async _analyzeRecentGitChanges(workspacePath, failure, structural) {
    const gitFindings = {
      relatedCommits: [],
      directCommitMatches: [],
      structuralCommitMatches: [],
      configCommitMatches: [],
      diffEvidence: [],
    };

    if (!this.evidenceLayer || !workspacePath) {
      return gitFindings;
    }

    try {
      // 1. Fetch Bounded Commit History (Max 10 commits)
      const commitsResult = await this.evidenceLayer.getRecentCommits(workspacePath, {
        maxCount: MAX_RECENT_COMMITS_SCAN,
      });

      if (!commitsResult?.success || !Array.isArray(commitsResult.data)) {
        return gitFindings;
      }

      const commits = commitsResult.data.slice(0, MAX_RECENT_COMMITS_SCAN);
      gitFindings.relatedCommits = commits.map((c) => c.hash || c.shortHash).filter(Boolean);

      const isTestContext = failure.filePath && (
        failure.filePath.includes('/tests/') ||
        failure.filePath.includes('/test/') ||
        path.basename(failure.filePath).startsWith('test_')
      );

      for (const commit of commits) {
        const commitHash = commit.hash || commit.shortHash || '';
        const commitMsg = commit.message || '';
        const commitFiles = Array.isArray(commit.filesChanged)
          ? commit.filesChanged
          : (Array.isArray(commit.files) ? commit.files : []);

        // Check if commit touched the failing file directly or touched production module under test
        let matchedDirectFile = null;

        const touchedDirectly = failure.filePath && commitFiles.some((f) => {
          const normF = typeof f === 'string' ? f : (f.file || f.path || '');
          const match = normF === failure.filePath || normF.endsWith(`/${failure.filePath}`) || failure.filePath.endsWith(`/${normF}`) || normF.endsWith(failure.filePath) || failure.filePath.endsWith(normF);
          if (match) matchedDirectFile = normF;
          return match;
        });

        const touchedProductionModule = isTestContext && commitFiles.some((f) => {
          const normF = typeof f === 'string' ? f : (f.file || f.path || '');
          const match = structural.dependencies.includes(normF) || structural.relevantFiles.has(normF) || (normF.includes('src/') && !normF.includes('test'));
          if (match) matchedDirectFile = normF;
          return match;
        });

        if (touchedDirectly || touchedProductionModule) {
          const targetPath = matchedDirectFile || failure.filePath;
          gitFindings.directCommitMatches.push({
            commit,
            relevance: 'direct',
            matchedFile: targetPath,
            reason: touchedDirectly ? `Touched failing file ${failure.filePath}` : `Modified production module ${targetPath} under test`,
          });

          // Fetch commit diff for direct match
          try {
            const diffRes = await this.evidenceLayer.getCommitDiff(workspacePath, commitHash, targetPath);
            if (diffRes?.success && diffRes.data?.diff) {
              gitFindings.diffEvidence.push({
                commitHash,
                file: targetPath,
                diffSnippet: secretFilter.sanitizeString(diffRes.data.diff.slice(0, 1000)),
              });
            }
          } catch (_) {}
          continue;
        }


        // Check if commit touched structural neighbors (callers, dependents, dependencies)
        const touchedStructural = commitFiles.some((f) => {
          const normF = typeof f === 'string' ? f : (f.file || f.path || '');
          return structural.relevantFiles.has(normF);
        });

        if (touchedStructural) {
          gitFindings.structuralCommitMatches.push({
            commit,
            relevance: 'call_chain',
            reason: `Touched related caller/dependent file in call chain`,
          });
          continue;
        }

        // Check if commit touched dependency/config manifests
        const touchedConfig = commitFiles.some((f) => {
          const normF = typeof f === 'string' ? f : (f.file || f.path || '');
          const baseName = path.basename(normF);
          return CONFIG_AND_DEPENDENCY_FILES.has(baseName);
        });


        if (touchedConfig) {
          gitFindings.configCommitMatches.push({
            commit,
            relevance: 'dependency_or_config',
            reason: `Modified project configuration or dependency manifest`,
          });
        }
      }
    } catch (_) {}

    return gitFindings;
  }

  // =========================================================================
  // 4. AI-GENERATED CHANGES OBSERVATION (Read-Only • Provenance Aware)
  // =========================================================================

  /**
   * Observes recent AI agent code changes from session evidence.
   * Surfaces them as evidence with provenance MODEL_INFERENCE without fabricating causality.
   * @private
   */
  _analyzeAiChanges(sessionId, failure, structural) {
    const aiFindings = {
      relatedAiChanges: [],
      directAiMatches: [],
      structuralAiMatches: [],
    };

    if (!this.evidenceLayer || !sessionId) {
      return aiFindings;
    }

    try {
      const agentChangesRes = this.evidenceLayer.getAgentChanges(sessionId);
      if (!agentChangesRes?.success || !Array.isArray(agentChangesRes.data)) {
        return aiFindings;
      }

      for (const change of agentChangesRes.data) {
        const changeFile = change.filePath || '';
        aiFindings.relatedAiChanges.push(change.id || `change_${change.timestamp}`);

        const isDirect = failure.filePath && (
          changeFile === failure.filePath ||
          changeFile.endsWith(failure.filePath) ||
          failure.filePath.endsWith(changeFile)
        );

        if (isDirect) {
          aiFindings.directAiMatches.push({
            id: change.id,
            filePath: changeFile,
            statement: secretFilter.sanitizeString(change.statement || 'Modified file'),
            timestamp: change.timestamp,
            verified: change.verified,
          });
          continue;
        }

        if (structural.relevantFiles.has(changeFile)) {
          aiFindings.structuralAiMatches.push({
            id: change.id,
            filePath: changeFile,
            statement: secretFilter.sanitizeString(change.statement || 'Modified related file'),
            timestamp: change.timestamp,
            verified: change.verified,
          });
        }
      }
    } catch (_) {}

    return aiFindings;
  }

  // =========================================================================
  // 5. CAUSAL CANDIDATE BUILDING & DETERMINISTIC RANKING
  // =========================================================================

  /**
   * Builds and ranks causal candidates based on empirical evidence strength.
   * @private
   */
  _buildAndRankCauses(failure, structural, gitFindings, aiFindings, assertionDetails = {}) {
    const candidates = [];

    // Candidate 1: Direct Recent Code Commit (Score: 100)
    if (gitFindings.directCommitMatches.length > 0) {
      const match = gitFindings.directCommitMatches[0];
      const commit = match.commit;
      const shortHash = commit.shortHash || (commit.hash ? commit.hash.slice(0, 7) : 'recent');
      const targetFile = match.matchedFile || failure.filePath || 'failing file';
      const evidence = [
        {
          source: EVIDENCE_TYPES.GIT_COMMIT,
          id: commit.hash || shortHash,
          description: `Commit ${shortHash} ("${secretFilter.sanitizeString(commit.message)}") modified ${targetFile}`,
          relevance: 'direct',
        },
      ];


      if (gitFindings.diffEvidence.length > 0) {
        const diffItem = gitFindings.diffEvidence.find((d) => d.commitHash === commit.hash || d.commitHash === shortHash) || gitFindings.diffEvidence[0];
        evidence.push({
          source: EVIDENCE_TYPES.GIT_DIFF,
          id: `diff_${shortHash}`,
          description: `Diff shows recent changes in ${diffItem.file || targetFile}`,
          relevance: 'direct',
        });
      }

      const explanation = assertionDetails.targetFunction
        ? `Commit ${shortHash} changed ${assertionDetails.targetFunction}() and modified ${targetFile}: "${secretFilter.sanitizeString(commit.message)}".`
        : `Recent commit ${shortHash} modified ${targetFile}: "${secretFilter.sanitizeString(commit.message)}".`;

      candidates.push({
        type: 'RECENT_CODE_CHANGE',
        explanation,
        confidence: CONFIDENCE_TIERS.HIGH,
        score: 100,
        evidence,
        affectedFiles: [targetFile, failure.filePath].filter(Boolean),
      });

    }

    // Candidate 2: Test Expectation Mismatch (Score: 110 when no recent commit touched code, 85 otherwise)
    if (assertionDetails.isAssertionMismatch) {
      const targetFnDesc = assertionDetails.targetFunction ? `${assertionDetails.targetFunction}()` : 'the function under test';
      const explanation = `The test assertion expects ${assertionDetails.expected}, but ${targetFnDesc} returned ${assertionDetails.actual}. The mismatch originates directly from the test expectation.`;

      const evidence = [
        {
          source: EVIDENCE_TYPES.TEST,
          id: `test_${failure.test || 'assertion'}`,
          description: `Test ${failure.test || 'case'} failed expectation: expects ${assertionDetails.expected}, returned ${assertionDetails.actual}`,
          relevance: 'direct',
        },
        {
          source: EVIDENCE_TYPES.DIAGNOSTIC,
          id: 'assertion_expression',
          description: `Assertion expression: ${assertionDetails.assertionExpr || `Expected ${assertionDetails.expected}, got ${assertionDetails.actual}`}`,
          relevance: 'direct',
        },
      ];

      const isPrimary = gitFindings.directCommitMatches.length === 0;

      candidates.push({
        type: 'TEST_EXPECTATION_MISMATCH',
        explanation,
        confidence: CONFIDENCE_TIERS.HIGH,
        score: isPrimary ? 110 : 85,
        evidence,
        affectedFiles: [failure.filePath].filter(Boolean),
      });
    } else if (failure.type === 'TEST_FAILURE' && failure.test) {
      candidates.push({
        type: 'TEST_EXPECTATION_MISMATCH',
        explanation: `Test "${failure.test}" assertion failed against current return values or behavior.`,
        confidence: candidates.length === 0 ? CONFIDENCE_TIERS.MEDIUM : CONFIDENCE_TIERS.LOW,
        score: 40,
        evidence: [
          {
            source: EVIDENCE_TYPES.TEST,
            id: `test_${failure.test}`,
            description: failure.message || `Assertion failure in ${failure.test}`,
            relevance: 'direct',
          },
        ],
        affectedFiles: [failure.filePath].filter(Boolean),
      });
    }

    // Candidate 3: Recent AI-Generated Code Change (Score: 95)
    if (aiFindings.directAiMatches.length > 0) {
      const aiMatch = aiFindings.directAiMatches[0];
      const evidence = [
        {
          source: EVIDENCE_TYPES.CODE_CHANGE,
          id: aiMatch.id,
          description: `AI-generated change modified ${aiMatch.filePath} (${aiMatch.statement})`,
          relevance: 'direct',
          provenance: PROVENANCE_SOURCE.MODEL_INFERENCE,
        },
      ];

      candidates.push({
        type: 'AI_PATCH_CHANGE',
        explanation: `AI-generated edit in current session modified ${aiMatch.filePath}: ${aiMatch.statement}.`,
        confidence: CONFIDENCE_TIERS.HIGH,
        score: 95,
        evidence,
        affectedFiles: [aiMatch.filePath].filter(Boolean),
      });
    }

    // Candidate 4: Dependency / Configuration Modification (Score: 90 / 115)
    const isMissingModuleError =
      failure.message.includes('Cannot find module') ||
      failure.message.includes('ModuleNotFoundError') ||
      failure.message.includes('ImportError') ||
      failure.type === 'TYPESCRIPT_CONFIG_ERROR';

    const isFailingConfigFile = failure.filePath && CONFIG_AND_DEPENDENCY_FILES.has(path.basename(failure.filePath));

    if (isMissingModuleError || isFailingConfigFile || (gitFindings.configCommitMatches.length > 0 && failure.message.toLowerCase().includes('dependency'))) {
      const evidence = [];
      let explanation = 'Project dependencies or configuration files were recently modified or are missing expected modules.';
      let score = 90;

      if (gitFindings.configCommitMatches.length > 0) {
        const cfgMatch = gitFindings.configCommitMatches[0];
        const shortHash = cfgMatch.commit.shortHash || cfgMatch.commit.hash?.slice(0, 7) || 'recent';
        evidence.push({
          source: EVIDENCE_TYPES.DEPENDENCY_CHANGE,
          id: cfgMatch.commit.hash || shortHash,
          description: `Commit ${shortHash} updated dependency/configuration manifest ("${secretFilter.sanitizeString(cfgMatch.commit.message)}")`,
          relevance: 'direct',
        });
        explanation = `Commit ${shortHash} modified dependency/configuration files: "${secretFilter.sanitizeString(cfgMatch.commit.message)}".`;
        score = isMissingModuleError ? 115 : 90;
      } else {
        evidence.push({
          source: EVIDENCE_TYPES.DIAGNOSTIC,
          id: 'diagnostic_import_error',
          description: failure.message,
          relevance: 'direct',
        });
        score = isMissingModuleError ? 110 : 80;
      }

      candidates.push({
        type: 'DEPENDENCY_CHANGE',
        explanation,
        confidence: gitFindings.configCommitMatches.length > 0 || isMissingModuleError ? CONFIDENCE_TIERS.HIGH : CONFIDENCE_TIERS.MEDIUM,
        score,
        evidence,
        affectedFiles: Array.from(CONFIG_AND_DEPENDENCY_FILES).filter((f) => failure.message.includes(f)),
      });
    }

    // Candidate 5: Structural / Caller-Callee Call Chain Divergence (Score: 70)
    if (gitFindings.structuralCommitMatches.length > 0 || aiFindings.structuralAiMatches.length > 0) {
      const evidence = [];
      const affected = [];

      if (gitFindings.structuralCommitMatches.length > 0) {
        const sMatch = gitFindings.structuralCommitMatches[0];
        const shortHash = sMatch.commit.shortHash || sMatch.commit.hash?.slice(0, 7) || 'recent';
        evidence.push({
          source: EVIDENCE_TYPES.CALL_GRAPH,
          id: sMatch.commit.hash || shortHash,
          description: `Commit ${shortHash} modified callers/dependents in the call graph for ${failure.filePath || 'failing module'}`,
          relevance: 'contributing',
        });
      }

      if (aiFindings.structuralAiMatches.length > 0) {
        const aiMatch = aiFindings.structuralAiMatches[0];
        evidence.push({
          source: EVIDENCE_TYPES.CODE_CHANGE,
          id: aiMatch.id,
          description: `AI patch modified related module ${aiMatch.filePath} in the active session`,
          relevance: 'contributing',
          provenance: PROVENANCE_SOURCE.MODEL_INFERENCE,
        });
        affected.push(aiMatch.filePath);
      }

      const targetDesc = assertionDetails.targetFunction || failure.symbol || failure.filePath || 'the target module';

      candidates.push({
        type: 'CALLER_CALLEE_MISMATCH',
        explanation: `Changes to related caller or dependent files in the call chain may have altered expected arguments, return types, or invocation sequence for ${targetDesc}.`,
        confidence: CONFIDENCE_TIERS.MEDIUM,
        score: 70,
        evidence,
        affectedFiles: affected.length > 0 ? affected : Array.from(structural.relevantFiles).slice(0, 3),
      });
    }

    // Fallback: Honest Low-Confidence Explanation (Score: 10)
    if (candidates.length === 0) {
      candidates.push({
        type: 'UNRESOLVED_RUNTIME_ERROR',
        explanation: 'The available evidence does not establish a stronger causal relationship.',
        confidence: CONFIDENCE_TIERS.LOW,
        score: 10,
        evidence: failure.message && failure.message !== 'No detailed failure message provided' ? [
          {
            source: EVIDENCE_TYPES.DIAGNOSTIC,
            id: 'unresolved_diagnostic',
            description: failure.message,
            relevance: 'contextual',
          },
        ] : [],
        affectedFiles: [failure.filePath].filter(Boolean),
      });
    }

    // Sort descending by deterministic score
    candidates.sort((a, b) => b.score - a.score);

    return candidates;
  }

  // =========================================================================
  // 6. MAIN CORRELATION ENTRYPOINT (Read-Only • Non-Blocking)
  // =========================================================================

  /**
   * Performs read-only causal analysis on failure signals.
   * @param {Object} input
   * @param {string} input.workspacePath - Workspace root path
   * @param {Object} [input.diagnostic] - DiagnosticParser output or error object
   * @param {Object} [input.testResult] - TestResultParser output
   * @param {string} [input.command] - Command string that triggered failure
   * @param {string} [input.sessionId] - Active session ID
   * @param {string} [input.activeFilePath] - Active file path in editor
   * @param {string} [input.rawOutput] - Raw terminal or runner output
   * @returns {Promise<Object>} BreakageReport struct
   */
  async correlate(input = {}) {
    const timestamp = Date.now();
    const workspacePath = input.workspacePath || '';

    // 1. Normalize Failure
    const failure = this._normalizeFailure(input);

    // Safe handling when no workspacePath or valid failure is present
    if (!workspacePath || typeof workspacePath !== 'string') {
      return {
        schemaVersion: '1.0.0',
        failure,
        primaryCause: {
          type: 'INVALID_INPUT',
          explanation: 'Workspace path is missing or invalid. Unable to correlate repository evidence.',
          confidence: CONFIDENCE_TIERS.LOW,
          evidence: [],
          affectedFiles: [],
        },
        contributingCauses: [],
        affectedFiles: [],
        relatedCommits: [],
        relatedAiChanges: [],
        recommendedNextStep: 'Specify a valid workspace path to enable evidence correlation.',
        generatedAt: timestamp,
      };
    }

    try {
      // 2. Extract Assertion Mismatch Details
      const rawText = input.rawOutput || input.stderr || input.stdout || failure.message || '';
      const assertionDetails = this._extractAssertionDetails(failure, rawText, workspacePath);

      // 3. Resolve Structural AST & Symbol Context
      const structural = await this._resolveStructuralContext(workspacePath, failure);

      // 4. Analyze Recent Git Changes (Bounded 10 commits)
      const gitFindings = await this._analyzeRecentGitChanges(workspacePath, failure, structural);

      // 5. Analyze AI-Generated Changes
      const aiFindings = this._analyzeAiChanges(input.sessionId, failure, structural);

      // 6. Build and Rank Causal Candidates
      const rankedCandidates = this._buildAndRankCauses(failure, structural, gitFindings, aiFindings, assertionDetails);

      const primaryCandidate = rankedCandidates[0];
      const contributingCandidates = rankedCandidates.slice(1);

      // Aggregate all affected files uniquely
      const allAffectedFiles = new Set();
      if (failure.filePath) allAffectedFiles.add(failure.filePath);
      rankedCandidates.forEach((c) => {
        if (Array.isArray(c.affectedFiles)) {
          c.affectedFiles.forEach((f) => allAffectedFiles.add(f));
        }
      });

      // Formulate Specific Recommended Next Step
      let recommendedNextStep = 'Review the failing location and related commit history.';
      if (primaryCandidate.type === 'TEST_EXPECTATION_MISMATCH') {
        if (assertionDetails.isAssertionMismatch) {
          const fnName = assertionDetails.targetFunction ? `${assertionDetails.targetFunction}()` : 'the function';
          recommendedNextStep = `Review the test expectation; the assertion expects ${assertionDetails.expected} while ${fnName} returned ${assertionDetails.actual}.`;
        } else {
          recommendedNextStep = `Check if the test assertion in ${failure.test || failure.filePath} needs updating for recent behavioral changes.`;
        }
      } else if (primaryCandidate.type === 'RECENT_CODE_CHANGE') {
        const commitId = primaryCandidate.evidence[0]?.id || 'recent commit';
        const shortHash = typeof commitId === 'string' ? commitId.slice(0, 7) : 'recent';
        const targetDesc = assertionDetails.targetFunction ? `${assertionDetails.targetFunction}()` : failure.filePath || 'the source code';
        recommendedNextStep = `Review commit ${shortHash} and the changed calculation in ${targetDesc}.`;
      } else if (primaryCandidate.type === 'AI_PATCH_CHANGE') {
        recommendedNextStep = `Review the recent AI edit to ${failure.filePath || 'the code'} and adjust the implementation logic.`;
      } else if (primaryCandidate.type === 'DEPENDENCY_CHANGE') {
        recommendedNextStep = `Review the dependency/version change and its compatibility with this call.`;
      } else if (primaryCandidate.type === 'CALLER_CALLEE_MISMATCH') {
        const targetDesc = assertionDetails.targetFunction || failure.symbol || failure.filePath || 'the target function';
        recommendedNextStep = `Verify that callers match the updated signature and return types of ${targetDesc}.`;
      } else {
        recommendedNextStep = 'Review the failing location and debug execution step-by-step.';
      }


      return {
        schemaVersion: '1.0.0',
        failure: {
          type: failure.type,
          message: failure.message,
          filePath: failure.filePath,
          line: failure.line,
          column: failure.column,
          symbol: failure.symbol,
          test: failure.test,
        },
        primaryCause: {
          type: primaryCandidate.type,
          explanation: primaryCandidate.explanation,
          confidence: primaryCandidate.confidence,
          evidence: primaryCandidate.evidence || [],
          affectedFiles: primaryCandidate.affectedFiles || [],
        },
        contributingCauses: contributingCandidates.map((c) => ({
          type: c.type,
          explanation: c.explanation,
          confidence: c.confidence,
          evidence: c.evidence || [],
          affectedFiles: c.affectedFiles || [],
        })),
        affectedFiles: Array.from(allAffectedFiles),
        relatedCommits: gitFindings.relatedCommits,
        relatedAiChanges: aiFindings.relatedAiChanges,
        recommendedNextStep,
        generatedAt: timestamp,
      };
    } catch (err) {
      return {
        schemaVersion: '1.0.0',
        failure,
        primaryCause: {
          type: 'ANALYSIS_ERROR',
          explanation: `Causal correlation encountered an error: ${secretFilter.sanitizeString(err.message)}`,
          confidence: CONFIDENCE_TIERS.LOW,
          evidence: [],
          affectedFiles: failure.filePath ? [failure.filePath] : [],
        },
        contributingCauses: [],
        affectedFiles: failure.filePath ? [failure.filePath] : [],
        relatedCommits: [],
        relatedAiChanges: [],
        recommendedNextStep: 'Inspect the raw error output or compiler diagnostic.',
        generatedAt: timestamp,
      };
    }
  }
}

const breakageCorrelator = new BreakageCorrelator();

module.exports = {
  BreakageCorrelator,
  breakageCorrelator,
};
