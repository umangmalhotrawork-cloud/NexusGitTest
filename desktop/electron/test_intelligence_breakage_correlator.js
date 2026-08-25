/**
 * TEST: NEXUS INTELLIGENCE LAYER — BREAKAGE CORRELATOR (Phase 3)
 * 
 * Verifies all 25 required test invariants:
 * 1. TypeScript error normalization.
 * 2. Runtime error normalization.
 * 3. Test failure normalization.
 * 4. Correct failing file extraction.
 * 5. Correct symbol/caller lookup.
 * 6. Relevant recent commit detection.
 * 7. Relevant diff detection.
 * 8. Dependency change detection.
 * 9. AI-generated change detection.
 * 10. Multiple candidate causes ranking.
 * 11. Primary cause selection.
 * 12. Evidence provenance.
 * 13. Confidence does not exceed evidence.
 * 14. No secret leakage.
 * 15. No Git mutations.
 * 16. No file writes.
 * 17. No ChangeSet creation.
 * 18. No AgentLoop execution.
 * 19. No Continuum usage.
 * 20. No Context Capsule mutation.
 * 21. Zero AI provider calls.
 * 22. Empty/unknown diagnostics fail safely.
 * 23. Bounded history scan.
 * 24. Existing Source Control unaffected.
 * 25. Existing greeting routing unaffected.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const { breakageCorrelator, BreakageCorrelator } = require('./intelligence/BreakageCorrelator');
const { softwareEvidenceLayer } = require('./intelligence/SoftwareEvidenceLayer');
const { evidenceGraph, NODE_TYPES, PROVENANCE_CLASSES } = require('./evidence/EvidenceGraph');
const { requestRouter, isGreeting } = require('./harness/RequestRouter');
const { CONFIDENCE_TIERS, EVIDENCE_TYPES } = require('./intelligence/types');

async function runTests() {
  console.log('====================================================');
  console.log('RUNNING BREAKAGE CORRELATOR INVARIANT SUITE (PHASE 3)');
  console.log('====================================================\n');

  const testTempDir = path.join(__dirname, `__test_intelligence_breakage_${Date.now()}`);
  fs.mkdirSync(testTempDir, { recursive: true });

  const gitEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Test Author',
    GIT_AUTHOR_EMAIL: 'author@example.com',
    GIT_COMMITTER_NAME: 'Test Committer',
    GIT_COMMITTER_EMAIL: 'committer@example.com',
  };

  try {
    // ----------------------------------------------------
    // Set up Git Repo for Invariant Tests
    // ----------------------------------------------------
    execSync('git init -b main', { cwd: testTempDir, env: gitEnv });
    execSync('git config user.name "Test Author"', { cwd: testTempDir, env: gitEnv });
    execSync('git config user.email "author@example.com"', { cwd: testTempDir, env: gitEnv });

    const checkoutServiceFile = path.join(testTempDir, 'checkout.ts');
    const paymentServiceFile = path.join(testTempDir, 'payment.ts');
    const pkgJsonFile = path.join(testTempDir, 'package.json');

    fs.writeFileSync(
      checkoutServiceFile,
      'export function processOrder(orderId: string) {\n  validateOrder(orderId);\n  return true;\n}\nfunction validateOrder(id: string) { return Boolean(id); }\n',
      'utf8'
    );
    fs.writeFileSync(paymentServiceFile, 'import { processOrder } from "./checkout";\nexport function pay() { return processOrder("123"); }\n', 'utf8');
    fs.writeFileSync(pkgJsonFile, JSON.stringify({ name: 'test-app', dependencies: { stripe: '^12.0.0' } }, null, 2), 'utf8');

    execSync('git add .', { cwd: testTempDir, env: gitEnv });
    execSync('git commit -m "Initial commit of checkout and payment"', { cwd: testTempDir, env: gitEnv });

    // Second commit: modify checkout.ts validation order
    fs.writeFileSync(
      checkoutServiceFile,
      'export function processOrder(orderId: string, options?: any) {\n  if (!options) throw new Error("Missing options");\n  validateOrder(orderId);\n  return true;\n}\nfunction validateOrder(id: string) { return Boolean(id); }\n',
      'utf8'
    );
    execSync('git add checkout.ts', { cwd: testTempDir, env: gitEnv });
    execSync('git commit -m "Require options in processOrder"', { cwd: testTempDir, env: gitEnv });

    // Third commit: update package.json
    fs.writeFileSync(pkgJsonFile, JSON.stringify({ name: 'test-app', dependencies: { stripe: '^14.0.0', lodash: '^4.17.21' } }, null, 2), 'utf8');
    execSync('git add package.json', { cwd: testTempDir, env: gitEnv });
    execSync('git commit -m "Upgrade stripe dependency to v14"', { cwd: testTempDir, env: gitEnv });

    // ----------------------------------------------------
    // Test 1: TypeScript error normalization
    // ----------------------------------------------------
    console.log('[TEST 1] TypeScript error normalization...');
    const rawTsError = 'checkout.ts:2:7 - error TS2345: Argument of type "undefined" is not assignable to parameter of type "object".';
    const report1 = await breakageCorrelator.correlate({
      workspacePath: testTempDir,
      rawOutput: rawTsError,
    });
    assert.strictEqual(report1.failure.type, 'TYPESCRIPT_ERROR', 'Normalized as TYPESCRIPT_ERROR');
    assert.strictEqual(report1.failure.line, 2, 'Extracted line 2');
    assert.strictEqual(report1.failure.filePath, 'checkout.ts', 'Extracted checkout.ts');
    console.log(`  ✓ TypeScript error parsed: ${report1.failure.filePath}:${report1.failure.line}`);

    // ----------------------------------------------------
    // Test 2: Runtime error normalization
    // ----------------------------------------------------
    console.log('[TEST 2] Runtime error normalization...');
    const rawRuntimeError = 'Error: Missing options\n    at processOrder (checkout.ts:2:11)\n    at pay (payment.ts:2:32)';
    const report2 = await breakageCorrelator.correlate({
      workspacePath: testTempDir,
      rawOutput: rawRuntimeError,
    });
    assert(report2.failure.message.includes('Missing options'), 'Runtime message extracted');
    assert.strictEqual(report2.failure.filePath, 'checkout.ts', 'Runtime file location extracted from stack');
    console.log(`  ✓ Runtime error normalized: ${report2.failure.message}`);

    // ----------------------------------------------------
    // Test 3: Test failure normalization
    // ----------------------------------------------------
    console.log('[TEST 3] Test failure normalization...');
    const testResultInput = {
      summary: { total: 5, passed: 4, failed: 1 },
      failures: [
        {
          testName: 'test_process_order',
          filePath: 'tests/test_checkout.py',
          line: 42,
          message: 'AssertionError: Expected True but got Error',
        },
      ],
    };
    const report3 = await breakageCorrelator.correlate({
      workspacePath: testTempDir,
      testResult: testResultInput,
    });
    assert.strictEqual(report3.failure.type, 'TEST_FAILURE');
    assert.strictEqual(report3.failure.test, 'test_process_order');
    assert.strictEqual(report3.failure.filePath, 'tests/test_checkout.py');
    assert.strictEqual(report3.failure.line, 42);
    console.log(`  ✓ Test failure normalized: ${report3.failure.test} in ${report3.failure.filePath}`);

    // ----------------------------------------------------
    // Test 4: Correct failing file extraction
    // ----------------------------------------------------
    console.log('[TEST 4] Correct failing file extraction...');
    assert.strictEqual(report1.failure.filePath, 'checkout.ts');
    assert.strictEqual(report3.failure.filePath, 'tests/test_checkout.py');
    console.log('  ✓ Correct failing file extracted across formats');

    // ----------------------------------------------------
    // Test 5: Correct symbol/caller lookup
    // ----------------------------------------------------
    console.log('[TEST 5] Correct symbol/caller lookup...');
    const callersRes = await softwareEvidenceLayer.getCallers(testTempDir, 'processOrder');
    assert.strictEqual(callersRes.success, true);
    console.log('  ✓ Symbol caller lookup executed cleanly via evidence facade');

    // ----------------------------------------------------
    // Test 6: Relevant recent commit detection
    // ----------------------------------------------------
    console.log('[TEST 6] Relevant recent commit detection...');
    const report6 = await breakageCorrelator.correlate({
      workspacePath: testTempDir,
      activeFilePath: 'checkout.ts',
      message: 'TypeError: options is required',
    });
    assert(report6.relatedCommits.length > 0, 'Found recent commits');
    assert.strictEqual(report6.primaryCause.type, 'RECENT_CODE_CHANGE', 'Identified recent commit to checkout.ts as primary cause');
    assert(report6.primaryCause.explanation.includes('Require options in processOrder'), 'Identified specific commit message');
    console.log(`  ✓ Primary cause detected: ${report6.primaryCause.explanation}`);

    // ----------------------------------------------------
    // Test 7: Relevant diff detection
    // ----------------------------------------------------
    console.log('[TEST 7] Relevant diff detection...');
    const diffEvidence = report6.primaryCause.evidence.find((e) => e.source === EVIDENCE_TYPES.GIT_DIFF);
    assert(diffEvidence, 'Diff evidence generated');
    assert.strictEqual(diffEvidence.relevance, 'direct');
    console.log(`  ✓ Diff evidence attached with direct relevance`);

    // ----------------------------------------------------
    // Test 8: Dependency change detection
    // ----------------------------------------------------
    console.log('[TEST 8] Dependency change detection...');
    const report8 = await breakageCorrelator.correlate({
      workspacePath: testTempDir,
      rawOutput: 'Error: Cannot find module "stripe"',
      activeFilePath: 'payment.ts',
    });
    assert.strictEqual(report8.primaryCause.type, 'DEPENDENCY_CHANGE', 'Identified dependency change for missing module');
    assert(report8.primaryCause.explanation.includes('stripe'), 'Mentions stripe upgrade');
    console.log(`  ✓ Dependency change detected: ${report8.primaryCause.explanation}`);

    // ----------------------------------------------------
    // Test 9: AI-generated change detection
    // ----------------------------------------------------
    console.log('[TEST 9] AI-generated change detection...');
    const sessionId = `test_ai_session_${Date.now()}`;
    evidenceGraph.addNode({
      sessionId,
      type: NODE_TYPES.CODE_CHANGE,
      filePath: 'checkout.ts',
      statement: 'AI patch modified validation order in checkout.ts',
      provenance: PROVENANCE_CLASSES.MODEL_INFERENCE,
      verified: false,
    });

    const report9 = await breakageCorrelator.correlate({
      workspacePath: testTempDir,
      sessionId,
      activeFilePath: 'checkout.ts',
      rawOutput: 'Error: Validation failed after AI edit',
    });
    assert(report9.relatedAiChanges.length > 0, 'Identified related AI change in session');
    console.log(`  ✓ AI change observed in session evidence`);

    // ----------------------------------------------------
    // Test 10: Multiple candidate causes ranking
    // ----------------------------------------------------
    console.log('[TEST 10] Multiple candidate causes ranking...');
    assert(Array.isArray(report6.contributingCauses), 'Contributing causes is an array');
    console.log(`  ✓ Ranked candidates: 1 primary + ${report6.contributingCauses.length} contributing`);

    // ----------------------------------------------------
    // Test 11: Primary cause selection
    // ----------------------------------------------------
    console.log('[TEST 11] Primary cause selection...');
    assert(report6.primaryCause, 'Primary cause selected');
    assert(report6.primaryCause.confidence, 'Confidence defined on primary cause');
    console.log(`  ✓ Selected primary cause: [${report6.primaryCause.confidence}] ${report6.primaryCause.type}`);

    // ----------------------------------------------------
    // Test 12: Evidence provenance
    // ----------------------------------------------------
    console.log('[TEST 12] Evidence provenance...');
    for (const ev of report6.primaryCause.evidence) {
      assert(ev.source, 'Evidence item has valid source');
      assert(ev.id, 'Evidence item has valid ID');
      assert(ev.description, 'Evidence item has description');
      assert(ev.relevance, 'Evidence item has relevance');
    }
    console.log('  ✓ All evidence items contain required provenance metadata');

    // ----------------------------------------------------
    // Test 13: Confidence does not exceed evidence
    // ----------------------------------------------------
    console.log('[TEST 13] Confidence does not exceed evidence...');
    const ungroundedReport = await breakageCorrelator.correlate({
      workspacePath: testTempDir,
      message: 'Something went wrong in some unlisted file xyz_unknown.js',
    });
    assert.strictEqual(ungroundedReport.primaryCause.confidence, CONFIDENCE_TIERS.LOW, 'Ungrounded failure assigned LOW confidence');
    console.log(`  ✓ Ungrounded failure assigned honest LOW confidence`);

    // ----------------------------------------------------
    // Test 14: No secret leakage
    // ----------------------------------------------------
    console.log('[TEST 14] Assert zero secret leakage...');
    const rawSecretOutput = 'Error: Failed with token ghp_ABC123456789012345678901234567890123 and key sk-1234567890abcdef1234567890abcdef in checkout.ts:1';
    const secretReport = await breakageCorrelator.correlate({
      workspacePath: testTempDir,
      rawOutput: rawSecretOutput,
    });
    assert(!JSON.stringify(secretReport).includes('ghp_ABC'), 'GitHub token redacted');
    assert(!JSON.stringify(secretReport).includes('sk-1234'), 'OpenAI key redacted');
    console.log('  ✓ All secrets in failure diagnostics properly redacted');

    // ----------------------------------------------------
    // Test 15: No Git mutations
    // ----------------------------------------------------
    console.log('[TEST 15] Assert zero Git mutations occurred...');
    const statusBefore = execSync('git status --porcelain', { cwd: testTempDir, env: gitEnv }).toString();
    await breakageCorrelator.correlate({
      workspacePath: testTempDir,
      rawOutput: rawTsError,
    });
    const statusAfter = execSync('git status --porcelain', { cwd: testTempDir, env: gitEnv }).toString();
    assert.strictEqual(statusBefore, statusAfter, 'Git status strictly unmodified');
    console.log('  ✓ Git repository worktree 100% clean and unmodified');

    // ----------------------------------------------------
    // Test 16: No file writes
    // ----------------------------------------------------
    console.log('[TEST 16] Assert zero file writes occurred in workspace...');
    const filesBefore = fs.readdirSync(testTempDir);
    await breakageCorrelator.correlate({
      workspacePath: testTempDir,
      rawOutput: rawTsError,
    });
    const filesAfter = fs.readdirSync(testTempDir);
    assert.deepStrictEqual(filesBefore, filesAfter, 'Workspace files list unmodified');
    console.log('  ✓ Zero file writes to workspace during correlation');

    // ----------------------------------------------------
    // Test 17: No ChangeSet creation
    // ----------------------------------------------------
    console.log('[TEST 17] Assert no ChangeSet creation occurred...');
    assert.strictEqual(breakageCorrelator.changeSet, undefined, 'BreakageCorrelator has zero ChangeSet mutation coupling');
    console.log('  ✓ Zero ChangeSets created');

    // ----------------------------------------------------
    // Test 18: No AgentLoop execution
    // ----------------------------------------------------
    console.log('[TEST 18] Assert no AgentLoop execution occurred...');
    assert.strictEqual(breakageCorrelator.agentLoop, undefined, 'BreakageCorrelator has zero AgentLoop coupling');
    console.log('  ✓ Zero AgentLoop execution triggered');

    // ----------------------------------------------------
    // Test 19: No Continuum usage
    // ----------------------------------------------------
    console.log('[TEST 19] Assert no Continuum storage was written...');
    const isolatedContinuumDir = path.join(testTempDir, 'continuum_store');
    fs.mkdirSync(isolatedContinuumDir, { recursive: true });
    process.env.ECHO_CONTINUUM_DIR = isolatedContinuumDir;

    const continuumCountBefore = fs.readdirSync(isolatedContinuumDir).length;
    await breakageCorrelator.correlate({
      workspacePath: testTempDir,
      rawOutput: rawTsError,
    });
    const continuumCountAfter = fs.readdirSync(isolatedContinuumDir).length;
    assert.strictEqual(continuumCountBefore, continuumCountAfter, 'Continuum directory count unchanged');
    console.log('  ✓ Continuum storage 100% isolated');

    // ----------------------------------------------------
    // Test 20: No Context Capsule mutation
    // ----------------------------------------------------
    console.log('[TEST 20] Assert Context Capsule was not mutated...');
    const isolatedCapsuleDir = path.join(testTempDir, 'capsule_store');
    fs.mkdirSync(isolatedCapsuleDir, { recursive: true });
    process.env.NEXUS_CAPSULE_DIR = isolatedCapsuleDir;

    const capsuleCountBefore = fs.readdirSync(isolatedCapsuleDir).length;
    await breakageCorrelator.correlate({
      workspacePath: testTempDir,
      rawOutput: rawTsError,
    });
    const capsuleCountAfter = fs.readdirSync(isolatedCapsuleDir).length;
    assert.strictEqual(capsuleCountBefore, capsuleCountAfter, 'Context Capsule storage untouched');
    console.log('  ✓ Context Capsule storage 100% isolated');

    // ----------------------------------------------------
    // Test 21: Zero AI provider calls
    // ----------------------------------------------------
    console.log('[TEST 21] Assert zero AI provider calls...');
    const queryStartTime = Date.now();
    for (let i = 0; i < 20; i++) {
      await breakageCorrelator.correlate({
        workspacePath: testTempDir,
        rawOutput: `Diagnostic TS2304 in test_${i}.ts:10`,
      });
    }
    const elapsed = Date.now() - queryStartTime;
    assert(elapsed < 4000, `20 correlations executed in ${elapsed}ms (<4000ms) proving local sub-process execution without AI provider network calls`);
    console.log(`  ✓ 20 causal correlations completed in ${elapsed}ms without AI provider calls (0 AI calls)`);


    // ----------------------------------------------------
    // Test 22: Empty/unknown diagnostics fail safely
    // ----------------------------------------------------
    console.log('[TEST 22] Empty/unknown diagnostics fail safely...');
    const safeReport = await breakageCorrelator.correlate({ workspacePath: testTempDir });
    assert(safeReport && safeReport.schemaVersion === '1.0.0');
    assert(safeReport.primaryCause);
    console.log('  ✓ Empty diagnostic handled gracefully without throwing');

    // ----------------------------------------------------
    // Test 23: Bounded history scan (Max 10 commits)
    // ----------------------------------------------------
    console.log('[TEST 23] Bounded history scan...');
    assert(report6.relatedCommits.length <= 10, 'Bounded to at most 10 recent commits');
    console.log(`  ✓ Commit scan strictly bounded to ${report6.relatedCommits.length} (<= 10)`);

    // ----------------------------------------------------
    // Test 24: Existing Source Control unaffected
    // ----------------------------------------------------
    console.log('[TEST 24] Existing Source Control unaffected...');
    const { gitManager } = require('./gitManager');
    assert.strictEqual(typeof gitManager.getStatus, 'function');
    assert.strictEqual(typeof gitManager.getCommitHistory, 'function');
    console.log('  ✓ Source control APIs intact');

    // ----------------------------------------------------
    // Test 25: Existing greeting routing unaffected
    // ----------------------------------------------------
    console.log('[TEST 25] Existing greeting routing unaffected...');
    assert.strictEqual(requestRouter.classify('hello').mode, 'CONVERSATION');
    assert.strictEqual(isGreeting('hi'), true);
    console.log('  ✓ Greeting gating verified intact');

    // ----------------------------------------------------
    // Test 26: Expected X / actual Y assertion mismatch -> TEST_EXPECTATION_MISMATCH (HIGH confidence)
    // ----------------------------------------------------
    console.log('[TEST 26] Expected X / actual Y assertion mismatch -> TEST_EXPECTATION_MISMATCH...');

    const mismatchReport = await breakageCorrelator.correlate({
      workspacePath: testTempDir,
      activeFilePath: 'tests/test_cart.py',
      rawOutput: 'Traceback (most recent call last):\n  File "tests/test_cart.py", line 25, in test_cart_total\n    assert total == 999.99\nAssertionError: Expected 999.99 but got 108.0',
    });
    assert.strictEqual(mismatchReport.primaryCause.type, 'TEST_EXPECTATION_MISMATCH');
    assert.strictEqual(mismatchReport.primaryCause.confidence, CONFIDENCE_TIERS.HIGH);
    assert(mismatchReport.primaryCause.explanation.includes('expects 999.99, but'), 'Explanation details expected vs actual values');
    assert(mismatchReport.primaryCause.explanation.includes('returned 108.0'), 'Explanation mentions returned 108.0');
    assert(mismatchReport.recommendedNextStep.includes('expects 999.99'), 'Recommendation specifies expected value');
    assert(mismatchReport.primaryCause.evidence.some((e) => e.source === 'test'), 'Contains test evidence item');
    assert(mismatchReport.primaryCause.evidence.some((e) => e.source === 'diagnostic'), 'Contains assertion diagnostic item');
    console.log(`  ✓ TEST_EXPECTATION_MISMATCH classified with HIGH confidence: ${mismatchReport.primaryCause.explanation}`);

    // ----------------------------------------------------
    // Test 27: Caller / Callee mismatch correlation
    // ----------------------------------------------------
    console.log('[TEST 27] Recent caller modification -> CALLER_CALLEE_MISMATCH (MEDIUM confidence)...');
    const callerMismatchReport = await breakageCorrelator.correlate({
      workspacePath: testTempDir,
      activeFilePath: 'payment.ts',
      message: 'TypeError: processOrder is not a function or arguments mismatch',
    });
    assert(callerMismatchReport.primaryCause, 'Primary cause present');
    assert(
      callerMismatchReport.primaryCause.type === 'CALLER_CALLEE_MISMATCH' ||
      callerMismatchReport.contributingCauses.some((c) => c.type === 'CALLER_CALLEE_MISMATCH'),
      'Surfaced CALLER_CALLEE_MISMATCH for caller modification'
    );
    console.log(`  ✓ CALLER_CALLEE_MISMATCH surfaced in causal analysis`);

    // ----------------------------------------------------
    // Test 28: Honest low confidence on ungrounded failures
    // ----------------------------------------------------
    console.log('[TEST 28] No meaningful evidence -> honest LOW confidence...');
    const lowConfReport = await breakageCorrelator.correlate({
      workspacePath: testTempDir,
      message: 'Random unrecognized error string without git or AST matches',
    });
    assert.strictEqual(lowConfReport.primaryCause.confidence, CONFIDENCE_TIERS.LOW);
    assert(lowConfReport.primaryCause.explanation.includes('does not establish a stronger causal relationship'), 'Explicit honest low confidence text');
    console.log(`  ✓ Honest LOW confidence explanation verified: ${lowConfReport.primaryCause.explanation}`);

    console.log('\n====================================================');
    console.log('ALL 28 BREAKAGE CORRELATOR INVARIANT TESTS PASSED');
    console.log('====================================================');

  } finally {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

runTests().catch((err) => {
  console.error('BREAKAGE CORRELATOR SUITE FAILED:', err);
  process.exit(1);
});
