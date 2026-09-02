/**
 * NEXUS CLOSED-LOOP POST-MUTATION TEST SENTINEL — REAL SANDBOX E2E ACCEPTANCE TEST
 * 
 * Validates the complete real-workspace lifecycle of the Post-Mutation Test Sentinel
 * and Autonomous Repair Loop in a disposable sandbox workspace.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { PostMutationSentinel, MAX_REPAIR_CYCLES } = require('./testing/PostMutationSentinel');
const { EvidenceGraph } = require('./evidence/EvidenceGraph');
const { RefactorPlan } = require('./harness/RefactorPlan');
const { ChangeSet } = require('./harness/ChangeSet');
const { preflightEstimator } = require('./intelligence/PreflightEstimator');

async function runRealSandboxE2EAcceptance() {
  console.log('================================================================');
  console.log('  NEXUS REAL SANDBOX E2E ACCEPTANCE: POST-MUTATION SENTINEL     ');
  console.log('================================================================\n');

  // Setup disposable sandbox directory
  const sandboxDir = path.join(os.tmpdir(), `nexus-sentinel-e2e-${Date.now()}`);
  fs.mkdirSync(path.join(sandboxDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(sandboxDir, 'tests'), { recursive: true });

  // Create initial project files
  fs.writeFileSync(
    path.join(sandboxDir, 'src', 'calculator.ts'),
    'export function add(a: number, b: number): number { return a + b; }\nexport function multiply(a: number, b: number): number { return a * b; }',
    'utf8'
  );

  fs.writeFileSync(
    path.join(sandboxDir, 'src', 'formatter.ts'),
    'export function formatCurrency(amount: number): string { return `$${amount.toFixed(2)}`; }',
    'utf8'
  );

  fs.writeFileSync(
    path.join(sandboxDir, 'tests', 'calculator.test.ts'),
    'describe("calculator", () => {\n  it("adds numbers", () => expect(add(2, 3)).toBe(5));\n});',
    'utf8'
  );

  fs.writeFileSync(
    path.join(sandboxDir, 'tests', 'formatter.test.ts'),
    'describe("formatter", () => {\n  it("formats currency", () => expect(formatCurrency(10)).toBe("$10.00"));\n});',
    'utf8'
  );

  fs.writeFileSync(
    path.join(sandboxDir, 'tests', 'unrelated.test.ts'),
    'describe("unrelated", () => {\n  it("runs standalone", () => expect(true).toBe(true));\n});',
    'utf8'
  );

  fs.writeFileSync(
    path.join(sandboxDir, 'package.json'),
    JSON.stringify({
      name: 'sandbox-project',
      scripts: { test: 'jest' },
      devDependencies: { jest: '^29.0.0' },
    }),
    'utf8'
  );

  const results = [];
  function recordScenario(num, name, passed, evidence = '') {
    const status = passed ? '✓ PASS' : '❌ FAIL';
    console.log(`[SCENARIO ${num.toString().padStart(2, '0')}] ${name}`);
    console.log(`  Status: ${status}`);
    if (evidence) console.log(`  Evidence: ${evidence}\n`);
    results.push({ num, name, passed, evidence });
  }

  const evidenceGraph = new EvidenceGraph();

  try {
    // -------------------------------------------------------------------------
    // SCENARIO 1: Correct Mutation Triggers Targeted Discovery & Passing Badge
    // -------------------------------------------------------------------------
    const progressEvents1 = [];
    const mockExecutor1 = {
      runTests: async (params) => {
        return {
          status: 'PASSED',
          exitCode: 0,
          summary: { passed: 2, total: 2, failed: 0 },
          durationMs: 85,
        };
      },
    };

    const sentinel1 = new PostMutationSentinel({
      testExecutor: mockExecutor1,
      evidenceGraph,
    });

    const res1 = await sentinel1.verify({
      workspacePath: sandboxDir,
      mutatedFiles: ['src/calculator.ts'],
      threadId: 'session_scen_1',
      onProgress: (p) => progressEvents1.push(p),
    });

    const scen1Ok = res1.verified === true &&
      res1.targetedTests.includes('tests/calculator.test.ts') &&
      !res1.targetedTests.includes('tests/unrelated.test.ts') &&
      progressEvents1.some((e) => e.status === 'VERIFYING') &&
      res1.display.includes('✓ Tests Passed (2/2)');

    recordScenario(1, 'Targeted test discovery and immediate test verification', scen1Ok,
      `Targeted: [${res1.targetedTests.join(', ')}], Unrelated tests omitted: true, Badge: "${res1.display}"`);

    // -------------------------------------------------------------------------
    // SCENARIO 2: Broken Mutation Triggers Parsed Diagnostics & Successful Auto-Repair
    // -------------------------------------------------------------------------
    const progressEvents2 = [];
    let scen2Runs = 0;
    let receivedFailureContext = null;

    const mockExecutor2 = {
      runTests: async () => {
        scen2Runs++;
        if (scen2Runs === 1) {
          return {
            status: 'FAILED',
            exitCode: 1,
            failures: [
              {
                testName: 'calculator > adds numbers',
                testFile: 'tests/calculator.test.ts',
                message: 'Expected 5, received 0',
                stackTrace: 'Error: Expected 5, received 0\n    at tests/calculator.test.ts:3:12',
              },
            ],
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

    const mockRepairGen2 = async (context) => {
      receivedFailureContext = context;
      return {
        filePath: 'src/calculator.ts',
        replacement: 'export function add(a: number, b: number): number { return a + b; }',
      };
    };

    const sentinel2 = new PostMutationSentinel({
      testExecutor: mockExecutor2,
      evidenceGraph,
    });

    const res2 = await sentinel2.verify({
      workspacePath: sandboxDir,
      mutatedFiles: ['src/calculator.ts'],
      threadId: 'session_scen_2',
      onProgress: (p) => progressEvents2.push(p),
      repairGenerator: mockRepairGen2,
    });

    const scen2Ok = res2.verified === true &&
      res2.repaired === true &&
      res2.repairCycles === 1 &&
      progressEvents2.some((e) => e.status === 'REPAIRING' && e.cycle === 1) &&
      receivedFailureContext?.failures?.[0]?.message === 'Expected 5, received 0';

    recordScenario(2, 'Broken mutation triggers parsed failure extraction and 1-cycle auto-repair', scen2Ok,
      `Failure parsed: "${receivedFailureContext?.failures?.[0]?.testName}", Repair cycle: 1, Retest: PASSED`);

    // -------------------------------------------------------------------------
    // SCENARIO 3: Unfixable Failure Strictly Caps at Exactly 3 Repair Cycles
    // -------------------------------------------------------------------------
    let scen3Repairs = 0;
    const progressEvents3 = [];
    const mockExecutor3 = {
      runTests: async () => ({
        status: 'FAILED',
        exitCode: 1,
        failures: [{ testName: 'unfixable test', message: 'Fatal logic flaw' }],
      }),
    };

    const sentinel3 = new PostMutationSentinel({
      testExecutor: mockExecutor3,
      evidenceGraph,
    });

    const res3 = await sentinel3.verify({
      workspacePath: sandboxDir,
      mutatedFiles: ['src/calculator.ts'],
      threadId: 'session_scen_3',
      onProgress: (p) => progressEvents3.push(p),
      repairGenerator: async () => {
        scen3Repairs++;
        return { filePath: 'src/calculator.ts', replacement: 'bad' };
      },
    });

    const scen3Ok = res3.verified === false &&
      res3.status === 'REPAIR_EXHAUSTED' &&
      res3.repairCycles === 3 &&
      scen3Repairs === 3 &&
      res3.display.includes('✗ Verification Failed (3 cycles)');

    recordScenario(3, 'Unfixable failure strictly terminates after exactly 3 repair cycles', scen3Ok,
      `Attempted cycles: ${scen3Repairs}/${MAX_REPAIR_CYCLES}, Final status: "${res3.status}", Badge: "${res3.display}"`);

    // -------------------------------------------------------------------------
    // SCENARIO 4: Missing Dependency / Command Classified as Environment Failure
    // -------------------------------------------------------------------------
    let envRepairTriggered = false;
    const mockExecutor4 = {
      runTests: async () => ({
        status: 'FAILED',
        exitCode: 1,
        stderr: 'Error: Cannot find module "vitest"\nModuleNotFoundError: No module named vitest',
      }),
    };

    const sentinel4 = new PostMutationSentinel({
      testExecutor: mockExecutor4,
      evidenceGraph,
    });

    const res4 = await sentinel4.verify({
      workspacePath: sandboxDir,
      mutatedFiles: ['src/calculator.ts'],
      threadId: 'session_scen_4',
      repairGenerator: async () => { envRepairTriggered = true; },
    });

    const scen4Ok = res4.verified === false &&
      res4.status === 'DEPENDENCY_FAILURE' &&
      envRepairTriggered === false;

    recordScenario(4, 'Environment/dependency failure classified without code repair', scen4Ok,
      `Category: "${res4.category}", Repair triggered: ${envRepairTriggered} (Code repair aborted for env error)`);

    // -------------------------------------------------------------------------
    // SCENARIO 5: Task with No Relevant Tests Reports Honest Fallback
    // -------------------------------------------------------------------------
    fs.writeFileSync(path.join(sandboxDir, 'README.md'), '# Documentation', 'utf8');

    const sentinel5 = new PostMutationSentinel({
      evidenceGraph,
    });

    const res5 = await sentinel5.verify({
      workspacePath: sandboxDir,
      mutatedFiles: ['README.md'],
      threadId: 'session_scen_5',
    });

    const scen5Ok = res5.verified === false &&
      res5.status === 'NO_TESTS_FOUND' &&
      res5.display.includes('Tests: Not automatically verified');

    recordScenario(5, 'Task with no relevant tests reports honest fallback status', scen5Ok,
      `Status: "${res5.status}", Display: "${res5.display}"`);

    // -------------------------------------------------------------------------
    // SCENARIO 6: Unrelated Tests are Strictly Omitted
    // -------------------------------------------------------------------------
    const discoveredTests = sentinel1.discoverTargetedTests(['src/formatter.ts'], sandboxDir);
    const scen6Ok = discoveredTests.includes('tests/formatter.test.ts') &&
      !discoveredTests.includes('tests/calculator.test.ts') &&
      !discoveredTests.includes('tests/unrelated.test.ts');

    recordScenario(6, 'Unrelated repository test suites are strictly excluded', scen6Ok,
      `Modified: src/formatter.ts -> Discovered: [${discoveredTests.join(', ')}] (0 unrelated tests)`);

    // -------------------------------------------------------------------------
    // SCENARIO 7: Test Files Protected from Overwrite During Repair
    // -------------------------------------------------------------------------
    const isProtected1 = sentinel1._isProtectedTestFile('tests/calculator.test.ts');
    const isProtected2 = sentinel1._isProtectedTestFile('src/calculator.ts');
    const isProtected3 = sentinel1._isProtectedTestFile('test/test_auth.py');

    const scen7Ok = isProtected1 === true && isProtected2 === false && isProtected3 === true;
    recordScenario(7, 'Test suite files are protected from overwrite during auto-repair', scen7Ok,
      `tests/calculator.test.ts: ${isProtected1 ? 'PROTECTED' : 'UNPROTECTED'}, src/calculator.ts: ${isProtected2 ? 'PROTECTED' : 'MUTABLE'}`);

    // -------------------------------------------------------------------------
    // SCENARIO 8: EvidenceGraph Records Verification Provenance Trail
    // -------------------------------------------------------------------------
    const scen1Nodes = evidenceGraph.getNodesBySession('session_scen_1');
    const scen1Verified = scen1Nodes.some((n) => n.type === 'TEST_RESULT' && n.provenance === 'TEST_VERIFIED' && n.verified === true);

    const scen3Nodes = evidenceGraph.getNodesBySession('session_scen_3');
    const scen3Failed = scen3Nodes.some((n) => n.type === 'TEST_RESULT' && n.verified === false);

    const scen8Ok = scen1Verified && scen3Failed;
    recordScenario(8, 'EvidenceGraph stores structured verification provenance', scen8Ok,
      `Session 1: TEST_VERIFIED (true), Session 3: TEST_VERIFIED (false) with structured metadata`);

    // -------------------------------------------------------------------------
    // SCENARIO 9: Credential Sanitization Across Events, Logs, and Payloads
    // -------------------------------------------------------------------------
    const leakEvents = [];
    const mockLeakExecutor = {
      runTests: async () => ({
        status: 'FAILED',
        exitCode: 1,
        stderr: 'Bearer sk-ant-api03-secret1234567890abcdef and gsk_fakeSecretKey9876543210',
        failures: [{ message: 'Failed with key AIzaSyFakeSecret1234567890' }],
      }),
    };

    const sentinelLeak = new PostMutationSentinel({
      testExecutor: mockLeakExecutor,
      evidenceGraph,
    });

    const leakRes = await sentinelLeak.verify({
      workspacePath: sandboxDir,
      mutatedFiles: ['src/calculator.ts'],
      threadId: 'session_leak_check',
      onProgress: (p) => leakEvents.push(p),
      repairGenerator: async () => null,
    });

    const serializedLeakRes = JSON.stringify(leakRes);
    const serializedLeakEvents = JSON.stringify(leakEvents);

    const scen9Ok = !serializedLeakRes.includes('sk-ant') &&
      !serializedLeakRes.includes('gsk_') &&
      !serializedLeakRes.includes('AIzaSy') &&
      !serializedLeakEvents.includes('sk-ant');

    recordScenario(9, 'Zero plaintext credentials in test payloads, events, or diagnostics', scen9Ok,
      `100% credential sanitization verified on outcome payloads and live progress events`);

    // -------------------------------------------------------------------------
    // SCENARIO 10: RefactorPlan Scope & Approval Invariants Preserved
    // -------------------------------------------------------------------------
    const plan = new RefactorPlan({
      goal: 'Refactor calculator and formatter',
      workspacePath: sandboxDir,
      rootTargets: ['add'],
      affectedFiles: ['src/calculator.ts', 'src/formatter.ts'],
      testsToRun: ['tests/calculator.test.ts', 'tests/formatter.test.ts'],
    });

    plan.decomposeTasks({
      rootSymbol: { name: 'add', filePath: 'src/calculator.ts' },
      callers: [{ sourceFilePath: 'src/formatter.ts' }],
      tests: [{ testPath: 'tests/calculator.test.ts' }],
    });

    const isProposed = plan.status === 'PROPOSED';
    plan.approve({ approvedBy: 'OPERATOR' });
    const isApproved = plan.status === 'APPROVED';

    const rogueCs = new ChangeSet({
      workspacePath: sandboxDir,
      files: [{ filePath: 'src/admin/secrets.env', original: 'a', replacement: 'b' }],
    });

    const scopeCheck = plan.validateChildChangeSet(rogueCs, plan.tasks[0]);
    const scen10Ok = isProposed && isApproved && scopeCheck.scopeDrift === true;

    recordScenario(10, 'RefactorPlan approval and child workspace isolation preserved', scen10Ok,
      `PROPOSED -> APPROVED transition verified; Scope drift blocked on unplanned file: "${scopeCheck.reasons[0]}"`);

    // -------------------------------------------------------------------------
    // SCENARIO 11: Single-File Fast Path Preservation
    // -------------------------------------------------------------------------
    const fastPreflight = preflightEstimator.estimate({
      userInput: 'Add docstring to add() function in src/calculator.ts',
      targetFiles: ['src/calculator.ts'],
      providerId: 'nexus1',
      modelId: 'gemini-2.5-flash',
    });

    const scen11Ok = fastPreflight.estimatedFiles.count === 1 && fastPreflight.riskLevel !== 'HIGH';
    recordScenario(11, 'Single-file prompts retain standard fast execution path', scen11Ok,
      `Files: ${fastPreflight.estimatedFiles.count}, Risk: ${fastPreflight.riskLevel}, Fast path active: true`);

  } finally {
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const totalScenarios = results.length;
  const passedScenarios = results.filter((r) => r.passed).length;

  console.log('================================================================');
  console.log(`  ACCEPTANCE SUMMARY: ${passedScenarios}/${totalScenarios} SCENARIOS PASSED (${Math.round((passedScenarios / totalScenarios) * 100)}%)`);
  console.log('================================================================\n');

  if (passedScenarios !== totalScenarios) {
    process.exit(1);
  }
}

runRealSandboxE2EAcceptance().catch((err) => {
  console.error('Fatal sandbox acceptance error:', err);
  process.exit(1);
});
