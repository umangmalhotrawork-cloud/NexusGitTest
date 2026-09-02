/**
 * NEXUS CODEX HARNESS — CLOSED-LOOP POST-MUTATION TEST SENTINEL (Milestone 22)
 * 
 * Automatically verifies code mutations by discovering affected test files via
 * ImpactAnalyzer, running targeted tests through TestExecutor in isolated child
 * processes, and coordinating a strictly bounded 3-cycle autonomous repair loop
 * via TestResultParser and TransactionalPatchApplier.
 * 
 * Safety Invariants:
 * 1. Targeted execution: Never runs the full test suite when targeted tests are identified.
 * 2. Honest fallback: Does not invent tests for read-only tasks or when no test exists.
 * 3. Bounded repair: Max 3 repair cycles; stops immediately upon passing tests.
 * 4. Failure classification: Never auto-repairs environment or dependency setup failures as code regressions.
 * 5. Scope safety: Preserves authorized workspace boundaries and rejects unplanned edits.
 * 6. Credential protection: 100% sanitized diagnostics in EvidenceGraph, logs, and events.
 */

const path = require('path');
const fs = require('fs');
const { testRunnerDetector } = require('./TestRunnerDetector');
const { testExecutor } = require('./TestExecutor');
const { testResultParser } = require('./TestResultParser');
const { impactAnalyzer } = require('../harness/ImpactAnalyzer');
const { transactionalPatchApplier } = require('../transactionalPatchApplier');
const { workspacePathResolver } = require('../harness/WorkspacePathResolver');
const secretFilter = require('../../security/secretFilter');

let evidenceGraphInstance = null;
try {
  const { evidenceGraph } = require('../evidence/EvidenceGraph');
  evidenceGraphInstance = evidenceGraph;
} catch (e) {}

const MAX_REPAIR_CYCLES = 3;
const DEFAULT_TEST_TIMEOUT_MS = 15000;

class PostMutationSentinel {
  constructor(options = {}) {
    this.runnerDetector = options.testRunnerDetector || testRunnerDetector;
    this.executor = options.testExecutor || testExecutor;
    this.parser = options.testResultParser || testResultParser;
    this.impact = options.impactAnalyzer || impactAnalyzer;
    this.patchApplier = options.transactionalPatchApplier || transactionalPatchApplier;
    this.evidenceGraph = options.evidenceGraph || evidenceGraphInstance;
    this.maxRepairCycles = options.maxRepairCycles || MAX_REPAIR_CYCLES;
    this.workspaceLocks = new Map(); // workspacePath -> Promise queue
  }

  /**
   * Serializes test verifications and repairs per workspace without blocking unrelated workspaces.
   * @param {string} workspacePath
   * @param {Function} taskFn
   * @returns {Promise<any>}
   */
  async _withWorkspaceLock(workspacePath, taskFn) {
    const key = workspacePathResolver.canonicalizeWorkspaceRoot(workspacePath);
    const prevLock = this.workspaceLocks.get(key) || Promise.resolve();

    let releaseLock;
    const currentLock = new Promise((resolve) => {
      releaseLock = resolve;
    });

    // Chain current lock
    this.workspaceLocks.set(key, currentLock);

    try {
      await prevLock;
      return await taskFn();
    } finally {
      if (this.workspaceLocks.get(key) === currentLock) {
        this.workspaceLocks.delete(key);
      }
      releaseLock();
    }
  }

  /**
   * Classifies test failure type to avoid attempting code repairs on environment faults.
   * @param {Object} testResult
   * @returns {'CODE_FAILURE'|'ENVIRONMENT_FAILURE'|'DEPENDENCY_FAILURE'|'TIMEOUT'|'CANCELLED'|'UNKNOWN'}
   */
  classifyFailure(testResult = {}) {
    if (testResult.timedOut || testResult.status === 'TIMEOUT') {
      return 'TIMEOUT';
    }
    if (testResult.cancelled || testResult.status === 'CANCELLED') {
      return 'CANCELLED';
    }
    const combined = `${testResult.stdout || ''} ${testResult.stderr || ''}`.toLowerCase();

    if (
      combined.includes('modulenotfounderror') ||
      combined.includes('cannot find module') ||
      combined.includes('importerror')
    ) {
      return 'DEPENDENCY_FAILURE';
    }

    if (
      combined.includes('command not found') ||
      combined.includes('is not recognized as an internal') ||
      (combined.includes('no such file or directory') && (combined.includes('pytest') || combined.includes('jest') || combined.includes('vitest')))
    ) {
      return 'ENVIRONMENT_FAILURE';
    }

    if (testResult.failures && testResult.failures.length > 0) {
      return 'CODE_FAILURE';
    }

    if (testResult.exitCode !== 0) {
      return 'CODE_FAILURE';
    }

    return 'UNKNOWN';
  }

  /**
   * Discovers relevant test files for a given set of mutated source files.
   * @param {string[]} mutatedFiles
   * @param {string} workspacePath
   * @returns {string[]} Ordered list of targeted test paths
   */
  discoverTargetedTests(mutatedFiles = [], workspacePath = process.cwd()) {
    if (!Array.isArray(mutatedFiles) || mutatedFiles.length === 0) {
      return [];
    }

    const testSet = new Set();

    for (const file of mutatedFiles) {
      if (!file || typeof file !== 'string') continue;

      // If the mutated file itself is a test file, target it directly
      const lower = file.toLowerCase();
      if (
        lower.includes('.test.') ||
        lower.includes('.spec.') ||
        lower.startsWith('test_') ||
        lower.endsWith('_test.py') ||
        lower.startsWith('tests/') ||
        lower.startsWith('test/')
      ) {
        testSet.add(file);
        continue;
      }

      // Check with ImpactAnalyzer for symbol/file callers and mapped test files
      try {
        const fileImpact = this.impact.analyzeFile(file, { workspacePath });
        if (fileImpact && Array.isArray(fileImpact.tests)) {
          for (const t of fileImpact.tests) {
            if (t && t.testPath) testSet.add(t.testPath);
          }
        }
      } catch (_) {}

      // Heuristic fallback matching (e.g. src/auth.ts -> tests/auth.test.ts, test/test_auth.py)
      const baseName = path.basename(file, path.extname(file));
      const ext = path.extname(file);
      const candidates = [
        `tests/${baseName}.test${ext}`,
        `test/${baseName}.test${ext}`,
        `tests/${baseName}.spec${ext}`,
        `tests/test_${baseName}.py`,
        `test/test_${baseName}.py`,
        `__tests__/${baseName}.test${ext}`,
        `${path.dirname(file)}/${baseName}.test${ext}`,
      ];

      const canonicalWorkspace = workspacePathResolver.canonicalizeWorkspaceRoot(workspacePath);
      for (const cand of candidates) {
        const res = workspacePathResolver.resolve(canonicalWorkspace, cand, { mustExist: true });
        if (res.success && res.exists) {
          testSet.add(res.relativePath);
        }
      }
    }

    return Array.from(testSet);
  }

  /**
   * Executes post-mutation verification and bounded autonomous repair.
   * @param {Object} params
   * @param {string} [params.workspacePath]
   * @param {string[]} [params.mutatedFiles]
   * @param {string} [params.threadId]
   * @param {string} [params.turnId]
   * @param {Object} [params.modelAdapter]
   * @param {Function} [params.repairGenerator] - Optional custom repair generator (for tests or subagents)
   * @param {Function} [params.onProgress] - Callback for live UI updates
   * @param {Object} [params.options]
   * @returns {Promise<Object>} Verification outcome
   */
  async verify(params = {}) {
    const {
      workspacePath = process.cwd(),
      mutatedFiles = [],
      threadId = 'default_thread',
      turnId = 'default_turn',
      modelAdapter = null,
      repairGenerator = null,
      testExecutor = null,
      onProgress = null,
      options = {},
    } = params;

    const activeExecutor = testExecutor || options.testExecutor || this.executor;

    return this._withWorkspaceLock(workspacePath, async () => {
      const notify = (data = {}) => {
        if (typeof onProgress === 'function') {
          try {
            onProgress(secretFilter.sanitizeObject(data));
          } catch (_) {}
        }
      };

      // 1. Check if any file was actually mutated
      if (!Array.isArray(mutatedFiles) || mutatedFiles.length === 0) {
        const outcome = {
          verified: false,
          status: 'SKIPPED',
          reason: 'NO_MUTATIONS',
          display: 'Tests: Not automatically verified (No file modifications)',
        };
        notify(outcome);
        return outcome;
      }

    // 2. Discover targeted test files
    const targetedTests = this.discoverTargetedTests(mutatedFiles, workspacePath);

    if (targetedTests.length === 0) {
      const outcome = {
        verified: false,
        status: 'NO_TESTS_FOUND',
        reason: 'NO_TARGETED_TESTS',
        display: 'Tests: Not automatically verified (No associated tests found)',
        mutatedFiles,
      };
      notify(outcome);
      this._recordEvidence(threadId, 'OBSERVED', 'No targeted tests found for modified files', {
        mutatedFiles,
        verified: false,
      });
      return outcome;
    }

    // 3. Detect workspace test runner
    const detection = this.runnerDetector.detect(workspacePath);
    if (!detection || !detection.detected) {
      const outcome = {
        verified: false,
        status: 'RUNNER_NOT_DETECTED',
        reason: 'NO_RUNNER',
        display: 'Tests: Not automatically verified (No test runner configured)',
        targetedTests,
      };
      notify(outcome);
      return outcome;
    }

    const runner = detection.preferredRunner;
    const timeoutMs = options.timeoutMs || DEFAULT_TEST_TIMEOUT_MS;

    // 4. Initial Test Run
    notify({
      status: 'VERIFYING',
      display: '⏳ Verifying Tests...',
      targetedTests,
      runner,
    });

    const primaryTestTarget = targetedTests[0];
    let testResult = await activeExecutor.runTests({
      workspacePath,
      runner,
      target: primaryTestTarget,
      timeoutMs,
      sessionId: threadId,
    });

    // 5. If Tests Pass on First Run
    const parseSummary = testResult.summary || { passed: testResult.status === 'PASSED' ? 1 : 0, total: 1, failed: 0 };
    if (testResult.status === 'PASSED' && (!testResult.failures || testResult.failures.length === 0)) {
      const passCount = Math.max(1, parseSummary.passed || 1);
      const totalCount = Math.max(passCount, parseSummary.total || passCount);
      const outcome = {
        verified: true,
        repaired: false,
        repairCycles: 0,
        status: 'PASSED',
        display: `✓ Tests Passed (${passCount}/${totalCount})`,
        summary: parseSummary,
        targetedTests,
        durationMs: testResult.durationMs,
      };
      notify(outcome);
      this._recordEvidence(threadId, 'TEST_VERIFIED', `Targeted tests passed (${passCount}/${totalCount}): ${primaryTestTarget}`, {
        status: 'PASSED',
        targetedTests,
        summary: parseSummary,
        verified: true,
      });
      return outcome;
    }

    // 6. Handle Non-Code Failures (Environment, Dependency, Timeout)
    const failureCategory = this.classifyFailure(testResult);
    if (failureCategory === 'ENVIRONMENT_FAILURE' || failureCategory === 'DEPENDENCY_FAILURE' || failureCategory === 'TIMEOUT') {
      const outcome = {
        verified: false,
        repaired: false,
        repairCycles: 0,
        status: failureCategory,
        category: failureCategory,
        display: failureCategory === 'TIMEOUT' ? '✗ Test Execution Timed Out' : `✗ Test ${failureCategory === 'DEPENDENCY_FAILURE' ? 'Dependency' : 'Environment'} Failure`,
        error: secretFilter.sanitizeString(testResult.stderr || testResult.stdout || 'Environment failure'),
        targetedTests,
      };
      notify(outcome);
      this._recordEvidence(threadId, 'OBSERVED', `Test runner failure (${failureCategory}): ${primaryTestTarget}`, {
        status: failureCategory,
        verified: false,
      });
      return outcome;
    }

    // 7. Bounded Autonomous Repair Loop (CODE_FAILURE)
    let cycle = 0;
    let lastResult = testResult;
    const repairHistory = [];

    while (cycle < this.maxRepairCycles) {
      cycle++;

      notify({
        status: 'REPAIRING',
        cycle,
        maxCycles: this.maxRepairCycles,
        display: `⚡ Auto-Repairing Tests (Cycle ${cycle}/${this.maxRepairCycles})`,
        failures: lastResult.failures,
      });

      // Extract actionable failure snippet
      const failureSnippet = (lastResult.failures || [])
        .map((f) => `${f.testName || f.testFile}: ${f.message || ''}\n${f.stackTrace || ''}`)
        .join('\n') || lastResult.stderr || lastResult.stdout;

      // Generate repair patch
      let repairPatch = null;
      if (typeof repairGenerator === 'function') {
        try {
          repairPatch = await repairGenerator({
            cycle,
            mutatedFiles,
            testTarget: primaryTestTarget,
            failures: lastResult.failures,
            failureSnippet,
          });
        } catch (_) {}
      } else if (modelAdapter) {
        try {
          const repairPrompt = `The following targeted test failed after code mutation:\nTest: ${primaryTestTarget}\nFailure:\n${failureSnippet}\n\nPlease generate a minimal, targeted patch to fix the failing code in: ${mutatedFiles.join(', ')}.`;
          const modelRes = await modelAdapter.invoke(
            [{ role: 'user', content: repairPrompt }],
            [],
            { workspacePath, disableFailover: false }
          );
          if (modelRes && modelRes.toolCalls) {
            const editCall = modelRes.toolCalls.find((tc) => tc.toolName === 'edit_file' || tc.toolName === 'apply_patch');
            if (editCall) repairPatch = editCall.arguments;
          }
        } catch (_) {}
      }

      // Apply repair patch transactionally if available
      if (repairPatch) {
        try {
          if (repairPatch.path && repairPatch.patch) {
            await this.patchApplier.applyPatch({
              workspacePath,
              filePath: repairPatch.path,
              patch: repairPatch.patch,
            });
          } else if (repairPatch.filePath && repairPatch.replacement) {
            const res = workspacePathResolver.resolve(workspacePath, repairPatch.filePath, { allowDirectory: false });
            if (res.success && res.exists && !this._isProtectedTestFile(res.relativePath)) {
              fs.writeFileSync(res.absolutePath, repairPatch.replacement, 'utf8');
            }
          }
        } catch (_) {}
      }

      // Re-run targeted test
      const retest = await activeExecutor.runTests({
        workspacePath,
        runner,
        target: primaryTestTarget,
        timeoutMs,
        sessionId: threadId,
      });

      repairHistory.push({
        cycle,
        status: retest.status,
        exitCode: retest.exitCode,
      });

      lastResult = retest;

      // If retest passed, stop immediately
      const retestSummary = retest.summary || { passed: retest.status === 'PASSED' ? 1 : 0, total: 1 };
      if (retest.status === 'PASSED' && (!retest.failures || retest.failures.length === 0)) {
        const passCount = Math.max(1, retestSummary.passed || 1);
        const totalCount = Math.max(passCount, retestSummary.total || passCount);
        const outcome = {
          verified: true,
          repaired: true,
          repairCycles: cycle,
          status: 'PASSED',
          display: `✓ Tests Passed (${passCount}/${totalCount}) (Repaired on cycle ${cycle})`,
          summary: retestSummary,
          targetedTests,
          durationMs: retest.durationMs,
        };
        notify(outcome);
        this._recordEvidence(threadId, 'TEST_VERIFIED', `Autonomous repair succeeded on cycle ${cycle}: ${primaryTestTarget}`, {
          status: 'PASSED',
          repaired: true,
          repairCycles: cycle,
          verified: true,
        });
        return outcome;
      }
    }

    // 8. All repair cycles exhausted
    const finalOutcome = {
      verified: false,
      repaired: false,
      repairCycles: cycle,
      status: 'REPAIR_EXHAUSTED',
      display: `✗ Verification Failed (${this.maxRepairCycles} cycles)`,
      failures: secretFilter.sanitizeObject(lastResult.failures || []),
      targetedTests,
      repairHistory,
    };
    notify(finalOutcome);
    this._recordEvidence(threadId, 'OBSERVED', `Autonomous repair exhausted ${this.maxRepairCycles} cycles without passing: ${primaryTestTarget}`, {
      status: 'FAILED',
      verified: false,
      repairCycles: cycle,
    });
      return finalOutcome;
    });
  }

  _isProtectedTestFile(filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    const norm = filePath.replace(/\\/g, '/').toLowerCase();
    return (
      norm.startsWith('tests/') ||
      norm.startsWith('test/') ||
      norm.startsWith('__tests__/') ||
      norm.endsWith('.test.ts') ||
      norm.endsWith('.test.js') ||
      norm.endsWith('_test.py')
    );
  }

  _recordEvidence(sessionId, level, statement, metadata = {}) {
    if (this.evidenceGraph) {
      try {
        this.evidenceGraph.addNode({
          sessionId: sessionId || 'default_session',
          type: 'TEST_RESULT',
          statement: secretFilter.sanitizeString(statement),
          provenance: level === 'TEST_VERIFIED' ? 'TEST_VERIFIED' : 'OBSERVED',
          provenanceClass: level === 'TEST_VERIFIED' ? 'TEST_VERIFIED' : 'OBSERVED',
          verificationLevel: level,
          verified: level === 'TEST_VERIFIED',
          metadata: secretFilter.sanitizeObject(metadata),
        });
      } catch (_) {}
    }
  }
}

const postMutationSentinel = new PostMutationSentinel();

module.exports = {
  PostMutationSentinel,
  postMutationSentinel,
  MAX_REPAIR_CYCLES,
};
