/**
 * NEXUS POST-MUTATION TEST SENTINEL & AUTONOMOUS REPAIR SUITE (Milestone 22)
 * 
 * Verifies:
 * 1. Targeted test discovery from mutated source files
 * 2. Automatic test runner selection
 * 3. Passing tests mark task as TEST_VERIFIED
 * 4. Failing tests trigger autonomous repair
 * 5. Repair succeeds within bounded cycles
 * 6. Repair terminates safely after 3 failed cycles
 * 7. Test timeouts handled safely
 * 8. Distinguishes environment/dependency failures from code regressions
 * 9. Unrelated tests are never executed
 * 10. Scope boundaries are strictly enforced
 * 11. EvidenceGraph records structured verification trail
 * 12. Credential sanitization across diagnostics and events
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { PostMutationSentinel, MAX_REPAIR_CYCLES } = require('./testing/PostMutationSentinel');
const { EvidenceGraph } = require('./evidence/EvidenceGraph');

async function runPostMutationSentinelTestSuite() {
  console.log('================================================================');
  console.log('  NEXUS POST-MUTATION TEST SENTINEL & AUTO-REPAIR TEST SUITE    ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`[PASS] Test ${total.toString().padStart(2, '0')}: ${name}`);
    } catch (err) {
      console.error(`[FAIL] Test ${total.toString().padStart(2, '0')}: ${name}`);
      console.error(`       Error: ${err.message}`);
      if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
  }

  // ---------------------------------------------------------------------------
  // 1. Mutation Triggers Targeted Test Discovery
  // ---------------------------------------------------------------------------
  await testAsync('Mutation triggers targeted test discovery without scanning full repository', async () => {
    const sandboxDir = path.join(os.tmpdir(), `sentinel-test-disc-${Date.now()}`);
    fs.mkdirSync(path.join(sandboxDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(sandboxDir, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(sandboxDir, 'src', 'auth.ts'), 'export function auth() {}', 'utf8');
    fs.writeFileSync(path.join(sandboxDir, 'src', 'payment.ts'), 'export function pay() {}', 'utf8');
    fs.writeFileSync(path.join(sandboxDir, 'tests', 'auth.test.ts'), 'describe("auth", () => {});', 'utf8');
    fs.writeFileSync(path.join(sandboxDir, 'tests', 'payment.test.ts'), 'describe("payment", () => {});', 'utf8');

    const sentinel = new PostMutationSentinel();
    const discovered = sentinel.discoverTargetedTests(['src/auth.ts'], sandboxDir);

    assert.ok(discovered.includes('tests/auth.test.ts'), 'Must discover tests/auth.test.ts for src/auth.ts');
    assert.strictEqual(discovered.includes('tests/payment.test.ts'), false, 'Must NOT include unrelated payment test');

    fs.rmSync(sandboxDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // 2. Correct Runner Selection
  // ---------------------------------------------------------------------------
  await testAsync('Correct runner is selected based on repository configuration', async () => {
    const mockRunnerDetector = {
      detect: (ws) => ({
        detected: true,
        preferredRunner: 'jest',
        command: 'npx jest --colors',
      }),
    };

    let executedWithRunner = null;
    const mockExecutor = {
      runTests: async (params) => {
        executedWithRunner = params.runner;
        return {
          status: 'PASSED',
          exitCode: 0,
          summary: { passed: 2, total: 2, failed: 0 },
        };
      },
    };

    const mockImpact = {
      analyzeFile: () => ({ tests: [{ testPath: 'tests/unit.test.ts' }] }),
    };

    const sentinel = new PostMutationSentinel({
      testRunnerDetector: mockRunnerDetector,
      testExecutor: mockExecutor,
      impactAnalyzer: mockImpact,
    });

    const res = await sentinel.verify({
      workspacePath: process.cwd(),
      mutatedFiles: ['src/index.ts'],
    });

    assert.strictEqual(executedWithRunner, 'jest');
    assert.strictEqual(res.verified, true);
  });

  // ---------------------------------------------------------------------------
  // 3. Passing Tests Mark Verification
  // ---------------------------------------------------------------------------
  await testAsync('Passing tests transition outcome to TEST_VERIFIED with formatted badge', async () => {
    const mockEvidence = new EvidenceGraph();
    const mockExecutor = {
      runTests: async () => ({
        status: 'PASSED',
        exitCode: 0,
        summary: { passed: 4, total: 4, failed: 0 },
        durationMs: 120,
      }),
    };

    const sentinel = new PostMutationSentinel({
      testRunnerDetector: { detect: () => ({ detected: true, preferredRunner: 'vitest' }) },
      testExecutor: mockExecutor,
      impactAnalyzer: { analyzeFile: () => ({ tests: [{ testPath: 'tests/calc.test.ts' }] }) },
      evidenceGraph: mockEvidence,
    });

    const res = await sentinel.verify({
      workspacePath: process.cwd(),
      mutatedFiles: ['src/calc.ts'],
      threadId: 'thread_pass_1',
    });

    assert.strictEqual(res.verified, true);
    assert.strictEqual(res.status, 'PASSED');
    assert.strictEqual(res.display, '✓ Tests Passed (4/4)');
    assert.strictEqual(res.repaired, false);

    const nodes = mockEvidence.getNodesBySession('thread_pass_1');
    assert.strictEqual(nodes.length, 1);
    assert.strictEqual(nodes[0].provenance, 'TEST_VERIFIED');
    assert.strictEqual(nodes[0].verified, true);
  });

  // ---------------------------------------------------------------------------
  // 4. Failing Tests Invoke Repair
  // ---------------------------------------------------------------------------
  await testAsync('Failing tests automatically invoke the repair coordinator', async () => {
    let repairInvocationCount = 0;
    let runCount = 0;

    const mockExecutor = {
      runTests: async () => {
        runCount++;
        if (runCount === 1) {
          return {
            status: 'FAILED',
            exitCode: 1,
            failures: [{ testName: 'should calculate tax', message: 'Expected 10 but received 0' }],
            summary: { passed: 0, total: 1, failed: 1 },
          };
        }
        return {
          status: 'PASSED',
          exitCode: 0,
          summary: { passed: 1, total: 1, failed: 0 },
        };
      },
    };

    const mockRepairGenerator = async () => {
      repairInvocationCount++;
      return { filePath: 'src/tax.ts', replacement: 'export const tax = 10;' };
    };

    const sentinel = new PostMutationSentinel({
      testRunnerDetector: { detect: () => ({ detected: true, preferredRunner: 'jest' }) },
      testExecutor: mockExecutor,
      impactAnalyzer: { analyzeFile: () => ({ tests: [{ testPath: 'tests/tax.test.ts' }] }) },
      transactionalPatchApplier: { applyPatch: async () => ({ success: true }) },
    });

    const res = await sentinel.verify({
      workspacePath: process.cwd(),
      mutatedFiles: ['src/tax.ts'],
      repairGenerator: mockRepairGenerator,
    });

    assert.strictEqual(repairInvocationCount, 1, 'Repair generator must be called once');
    assert.strictEqual(res.verified, true);
    assert.strictEqual(res.repaired, true);
    assert.strictEqual(res.repairCycles, 1);
  });

  // ---------------------------------------------------------------------------
  // 5. Repair Succeeds Within 3 Cycles
  // ---------------------------------------------------------------------------
  await testAsync('Repair succeeds on cycle 2 and immediately stops further iterations', async () => {
    let cycles = 0;
    const mockExecutor = {
      runTests: async () => {
        cycles++;
        if (cycles < 3) { // 1 initial fail, 1 repair fail, then pass on cycle 2
          return {
            status: 'FAILED',
            exitCode: 1,
            failures: [{ testName: 'test math', message: 'Failed on step' }],
          };
        }
        return {
          status: 'PASSED',
          exitCode: 0,
          summary: { passed: 3, total: 3, failed: 0 },
        };
      },
    };

    let repairAttempts = 0;
    const mockRepairGenerator = async () => {
      repairAttempts++;
      return { filePath: 'src/math.ts', replacement: 'export const math = 42;' };
    };

    const sentinel = new PostMutationSentinel({
      testRunnerDetector: { detect: () => ({ detected: true, preferredRunner: 'vitest' }) },
      testExecutor: mockExecutor,
      impactAnalyzer: { analyzeFile: () => ({ tests: [{ testPath: 'tests/math.test.ts' }] }) },
    });

    const res = await sentinel.verify({
      workspacePath: process.cwd(),
      mutatedFiles: ['src/math.ts'],
      repairGenerator: mockRepairGenerator,
    });

    assert.strictEqual(res.verified, true);
    assert.strictEqual(res.repaired, true);
    assert.strictEqual(res.repairCycles, 2);
    assert.strictEqual(repairAttempts, 2);
  });

  // ---------------------------------------------------------------------------
  // 6. Repair Stops After 3 Failed Cycles
  // ---------------------------------------------------------------------------
  await testAsync('Repair coordinator strictly caps at 3 cycles and reports honest failure', async () => {
    let repairAttempts = 0;
    const mockExecutor = {
      runTests: async () => ({
        status: 'FAILED',
        exitCode: 1,
        failures: [{ testName: 'stubborn bug', message: 'Never passes' }],
      }),
    };

    const mockRepairGenerator = async () => {
      repairAttempts++;
      return { filePath: 'src/stubborn.ts', replacement: 'broken' };
    };

    const sentinel = new PostMutationSentinel({
      testRunnerDetector: { detect: () => ({ detected: true, preferredRunner: 'jest' }) },
      testExecutor: mockExecutor,
      impactAnalyzer: { analyzeFile: () => ({ tests: [{ testPath: 'tests/stubborn.test.ts' }] }) },
    });

    const res = await sentinel.verify({
      workspacePath: process.cwd(),
      mutatedFiles: ['src/stubborn.ts'],
      repairGenerator: mockRepairGenerator,
    });

    assert.strictEqual(repairAttempts, MAX_REPAIR_CYCLES, `Must attempt exactly ${MAX_REPAIR_CYCLES} repairs`);
    assert.strictEqual(res.verified, false);
    assert.strictEqual(res.status, 'REPAIR_EXHAUSTED');
    assert.strictEqual(res.display, '✗ Verification Failed (3 cycles)');
  });

  // ---------------------------------------------------------------------------
  // 7. Test Timeout Handled Safely
  // ---------------------------------------------------------------------------
  await testAsync('Test execution timeouts are classified cleanly without hanging', async () => {
    const mockExecutor = {
      runTests: async () => ({
        status: 'TIMEOUT',
        timedOut: true,
        exitCode: 124,
        stderr: 'Process exceeded timeout limit of 15000ms',
      }),
    };

    const sentinel = new PostMutationSentinel({
      testRunnerDetector: { detect: () => ({ detected: true, preferredRunner: 'jest' }) },
      testExecutor: mockExecutor,
      impactAnalyzer: { analyzeFile: () => ({ tests: [{ testPath: 'tests/slow.test.ts' }] }) },
    });

    const res = await sentinel.verify({
      workspacePath: process.cwd(),
      mutatedFiles: ['src/slow.ts'],
    });

    assert.strictEqual(res.verified, false);
    assert.strictEqual(res.status, 'TIMEOUT');
    assert.strictEqual(res.display, '✗ Test Execution Timed Out');
  });

  // ---------------------------------------------------------------------------
  // 8. Environment / Dependency Failures Distinguished from Code Regressions
  // ---------------------------------------------------------------------------
  await testAsync('Environment and missing module errors are flagged without code repair loops', async () => {
    let repairTriggered = false;
    const mockExecutor = {
      runTests: async () => ({
        status: 'FAILED',
        exitCode: 1,
        stderr: 'Error: Cannot find module "express"\nModuleNotFoundError',
      }),
    };

    const sentinel = new PostMutationSentinel({
      testRunnerDetector: { detect: () => ({ detected: true, preferredRunner: 'jest' }) },
      testExecutor: mockExecutor,
      impactAnalyzer: { analyzeFile: () => ({ tests: [{ testPath: 'tests/server.test.ts' }] }) },
    });

    const res = await sentinel.verify({
      workspacePath: process.cwd(),
      mutatedFiles: ['src/server.ts'],
      repairGenerator: async () => { repairTriggered = true; },
    });

    assert.strictEqual(repairTriggered, false, 'Must NOT trigger code repair for missing module error');
    assert.strictEqual(res.verified, false);
    assert.strictEqual(res.status, 'DEPENDENCY_FAILURE');
  });

  // ---------------------------------------------------------------------------
  // 9. Unrelated Tests are Never Executed
  // ---------------------------------------------------------------------------
  await testAsync('Only tests directly covering modified files are targeted', async () => {
    const executedTargets = [];
    const mockExecutor = {
      runTests: async (params) => {
        executedTargets.push(params.target);
        return { status: 'PASSED', exitCode: 0, summary: { passed: 1, total: 1 } };
      },
    };

    const sentinel = new PostMutationSentinel({
      testRunnerDetector: { detect: () => ({ detected: true, preferredRunner: 'jest' }) },
      testExecutor: mockExecutor,
      impactAnalyzer: {
        analyzeFile: (f) => ({
          tests: f.includes('user') ? [{ testPath: 'tests/user.test.ts' }] : [],
        }),
      },
    });

    await sentinel.verify({
      workspacePath: process.cwd(),
      mutatedFiles: ['src/user.ts'],
    });

    assert.deepStrictEqual(executedTargets, ['tests/user.test.ts']);
  });

  // ---------------------------------------------------------------------------
  // 10. Scope Boundaries Enforced
  // ---------------------------------------------------------------------------
  await testAsync('Test suite files are protected from overwriting during repair', async () => {
    const sentinel = new PostMutationSentinel();

    assert.strictEqual(sentinel._isProtectedTestFile('tests/auth.test.ts'), true);
    assert.strictEqual(sentinel._isProtectedTestFile('test/test_user.py'), true);
    assert.strictEqual(sentinel._isProtectedTestFile('src/auth.ts'), false);
    assert.strictEqual(sentinel._isProtectedTestFile('src/services/payment.ts'), false);
  });

  // ---------------------------------------------------------------------------
  // 11. EvidenceGraph Receives Correct Verification State
  // ---------------------------------------------------------------------------
  await testAsync('EvidenceGraph properly records TEST_VERIFIED node and metadata', async () => {
    const graph = new EvidenceGraph();
    const mockExecutor = {
      runTests: async () => ({
        status: 'PASSED',
        exitCode: 0,
        summary: { passed: 5, total: 5 },
      }),
    };

    const sentinel = new PostMutationSentinel({
      testRunnerDetector: { detect: () => ({ detected: true, preferredRunner: 'jest' }) },
      testExecutor: mockExecutor,
      impactAnalyzer: { analyzeFile: () => ({ tests: [{ testPath: 'tests/verified.test.ts' }] }) },
      evidenceGraph: graph,
    });

    await sentinel.verify({
      workspacePath: process.cwd(),
      mutatedFiles: ['src/verified.ts'],
      threadId: 'session_ev_test_1',
    });

    const nodes = graph.getNodesBySession('session_ev_test_1');
    assert.strictEqual(nodes.length, 1);
    assert.strictEqual(nodes[0].provenance, 'TEST_VERIFIED');
    assert.strictEqual(nodes[0].verified, true);
  });

  // ---------------------------------------------------------------------------
  // 12. Credential Sanitization in Diagnostics and Events
  // ---------------------------------------------------------------------------
  await testAsync('Diagnostics, errors, and UI progress payloads contain zero credentials', async () => {
    const emittedProgress = [];
    const mockExecutor = {
      runTests: async () => ({
        status: 'FAILED',
        exitCode: 1,
        stderr: 'Error: Auth failure with bearer sk-live-secret-key-1234567890abcdef',
        failures: [{ message: 'Failed token AIzaSyDfakeKey12345678901234567890' }],
      }),
    };

    const sentinel = new PostMutationSentinel({
      testRunnerDetector: { detect: () => ({ detected: true, preferredRunner: 'jest' }) },
      testExecutor: mockExecutor,
      impactAnalyzer: { analyzeFile: () => ({ tests: [{ testPath: 'tests/secret.test.ts' }] }) },
    });

    const res = await sentinel.verify({
      workspacePath: process.cwd(),
      mutatedFiles: ['src/secret.ts'],
      onProgress: (p) => emittedProgress.push(p),
      repairGenerator: async () => null,
    });

    const serializedRes = JSON.stringify(res);
    const serializedProg = JSON.stringify(emittedProgress);

    assert.strictEqual(serializedRes.includes('sk-live'), false);
    assert.strictEqual(serializedRes.includes('AIzaSy'), false);
    assert.strictEqual(serializedProg.includes('sk-live'), false);
    assert.strictEqual(serializedProg.includes('AIzaSy'), false);
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('================================================================');
  console.log(`  RESULTS: ${passed}/${total} POST-MUTATION SENTINEL TESTS PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runPostMutationSentinelTestSuite().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
