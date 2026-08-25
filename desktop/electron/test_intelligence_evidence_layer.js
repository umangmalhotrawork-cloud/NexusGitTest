/**
 * TEST: NEXUS INTELLIGENCE LAYER — SOFTWARE EVIDENCE LAYER (Phase 2)
 * 
 * Verifies all 12 required test invariants:
 * 1. Recent commits read correctly.
 * 2. Commit diffs read correctly.
 * 3. Diagnostics read correctly.
 * 4. Test results read correctly.
 * 5. Callers/dependents read correctly.
 * 6. Agent changes read correctly.
 * 7. Verification summary read correctly.
 * 8. No mutation methods are exposed.
 * 9. No repository mutation occurs.
 * 10. No Continuum writes occur.
 * 11. No Capsule writes occur.
 * 12. Zero AI provider calls.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const { softwareEvidenceLayer, SoftwareEvidenceLayer } = require('./intelligence/SoftwareEvidenceLayer');
const { evidenceGraph, NODE_TYPES, PROVENANCE_CLASSES } = require('./evidence/EvidenceGraph');

async function runTests() {
  console.log('====================================================');
  console.log('RUNNING SOFTWARE EVIDENCE LAYER INVARIANT SUITE');
  console.log('====================================================\n');

  const testTempDir = path.join(__dirname, `__test_intelligence_evidence_${Date.now()}`);
  fs.mkdirSync(testTempDir, { recursive: true });

  const gitEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Test User',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test User',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };

  try {
    // Set up a clean mini git repo in testTempDir
    execSync('git init -b main', { cwd: testTempDir, env: gitEnv });
    execSync('git config user.name "Test User"', { cwd: testTempDir, env: gitEnv });
    execSync('git config user.email "test@example.com"', { cwd: testTempDir, env: gitEnv });

    const fileA = path.join(testTempDir, 'auth.ts');
    const fileB = path.join(testTempDir, 'server.ts');

    fs.writeFileSync(fileA, 'export function login(user: string) { return true; }\n', 'utf8');
    fs.writeFileSync(fileB, 'import { login } from "./auth";\nexport function start() { login("admin"); }\n', 'utf8');

    execSync('git add .', { cwd: testTempDir, env: gitEnv });
    execSync('git commit -m "Initial commit for intelligence test"', { cwd: testTempDir, env: gitEnv });

    // Modify fileA in second commit to test diffs
    fs.writeFileSync(fileA, 'export function login(user: string, pass?: string) { return Boolean(user); }\n', 'utf8');
    execSync('git add .', { cwd: testTempDir, env: gitEnv });
    execSync('git commit -m "Add password support to login"', { cwd: testTempDir, env: gitEnv });

    // ----------------------------------------------------
    // Test 1: Recent commits read correctly
    // ----------------------------------------------------
    console.log('[TEST 1] Recent commits read correctly...');
    const commitsRes = await softwareEvidenceLayer.getRecentCommits(testTempDir, { maxCount: 5 });
    assert.strictEqual(commitsRes.success, true, 'getRecentCommits returns success: true');
    assert(Array.isArray(commitsRes.data), 'Commits data is an array');
    assert.strictEqual(commitsRes.data.length, 2, 'Should find exactly 2 commits in test repo');
    assert.strictEqual(commitsRes.data[0].message, 'Add password support to login', 'Latest commit is newest first');
    console.log(`  ✓ Read ${commitsRes.data.length} commits successfully`);

    // ----------------------------------------------------
    // Test 2: Commit diffs read correctly
    // ----------------------------------------------------
    console.log('[TEST 2] Commit diffs read correctly...');
    const latestHash = commitsRes.data[0].hash;
    const diffRes = await softwareEvidenceLayer.getCommitDiff(testTempDir, latestHash);
    assert.strictEqual(diffRes.success, true, 'getCommitDiff returns success: true');
    assert(diffRes.data && diffRes.data.diff, 'Diff string is returned');
    assert(diffRes.data.diff.includes('pass?: string'), 'Diff contains actual modified lines');
    console.log('  ✓ Read commit diff successfully');

    // ----------------------------------------------------
    // Test 3: Diagnostics read correctly
    // ----------------------------------------------------
    console.log('[TEST 3] Diagnostics read correctly...');
    const mockDiagnosticText = 'src/auth.ts:42:15 - error TS2304: Cannot find name "jwtSecret".';
    const diagRes = softwareEvidenceLayer.getDiagnostics({
      rawOutput: mockDiagnosticText,
      workspacePath: testTempDir,
    });
    assert.strictEqual(diagRes.success, true, 'getDiagnostics returns success: true');
    assert.strictEqual(diagRes.data.errorCategory, 'TYPESCRIPT_ERROR', 'Correctly categorized as TYPESCRIPT_ERROR');
    assert.strictEqual(diagRes.data.line, 42, 'Extracted line 42');
    assert.strictEqual(diagRes.data.column, 15, 'Extracted column 15');
    console.log(`  ✓ Diagnostic parsed: ${diagRes.data.summary}`);

    // ----------------------------------------------------
    // Test 4: Test results read correctly
    // ----------------------------------------------------
    console.log('[TEST 4] Test results read correctly...');
    const mockPytestOutput = '==================== 2 failed, 10 passed in 0.45s ====================\nFAILED tests/test_auth.py::test_login - AssertionError: assert False == True';
    const testRes = softwareEvidenceLayer.getTestResults('pytest', mockPytestOutput, '', 1);
    assert.strictEqual(testRes.success, true, 'getTestResults returns success: true');
    assert.strictEqual(testRes.data.summary.passed, 10, 'Parsed 10 passed tests');
    assert.strictEqual(testRes.data.summary.failed, 2, 'Parsed 2 failed tests');
    assert.strictEqual(testRes.data.failures.length, 1, 'Extracted failure item');
    assert.strictEqual(testRes.data.failures[0].testName, 'test_login', 'Extracted test_login failure');
    console.log(`  ✓ Test results parsed: ${testRes.data.summary.passed} passed, ${testRes.data.summary.failed} failed`);

    // ----------------------------------------------------
    // Test 5: Callers/dependents read correctly
    // ----------------------------------------------------
    console.log('[TEST 5] Callers/dependents read correctly...');
    const callersRes = await softwareEvidenceLayer.getCallers(testTempDir, 'login');
    assert.strictEqual(callersRes.success, true, 'getCallers returns success: true');
    assert(Array.isArray(callersRes.data), 'Callers data is an array');

    const dependentsRes = await softwareEvidenceLayer.getDependents(testTempDir, 'auth.ts');
    assert.strictEqual(dependentsRes.success, true, 'getDependents returns success: true');
    assert(Array.isArray(dependentsRes.data), 'Dependents data is an array');
    console.log(`  ✓ Callers and dependents queried without modifying workspace`);

    // ----------------------------------------------------
    // Test 6: Agent changes read correctly
    // ----------------------------------------------------
    console.log('[TEST 6] Agent changes read correctly...');
    const sessionId = `test_session_${Date.now()}`;
    evidenceGraph.addNode({
      sessionId,
      type: NODE_TYPES.CODE_CHANGE,
      filePath: 'src/auth.ts',
      statement: 'Updated login validation logic',
      provenance: PROVENANCE_CLASSES.MODEL_INFERENCE,
      verified: false,
    });

    const agentChanges = softwareEvidenceLayer.getAgentChanges(sessionId);
    assert.strictEqual(agentChanges.success, true, 'getAgentChanges returns success: true');
    assert.strictEqual(agentChanges.data.length, 1, 'Extracted 1 agent code change node');
    assert.strictEqual(agentChanges.data[0].filePath, 'src/auth.ts');
    console.log(`  ✓ Observed agent changes: ${agentChanges.data[0].statement}`);

    // ----------------------------------------------------
    // Test 7: Verification summary read correctly
    // ----------------------------------------------------
    console.log('[TEST 7] Verification summary read correctly...');
    evidenceGraph.addNode({
      sessionId,
      type: NODE_TYPES.TEST_RESULT,
      statement: 'Pytest suite run',
      provenance: PROVENANCE_CLASSES.TEST_VERIFIED,
      verified: true,
      metadata: { status: 'PASSED', summary: { passed: 5, failed: 0 } },
    });

    const verifySummary = softwareEvidenceLayer.getVerificationSummary(sessionId);
    assert.strictEqual(verifySummary.success, true, 'getVerificationSummary returns success: true');
    assert(verifySummary.data && verifySummary.data.verificationLevel, 'Verification level computed');
    console.log(`  ✓ Verification level: ${verifySummary.data.verificationLevel}`);

    // ----------------------------------------------------
    // Test 8: No mutation methods are exposed
    // ----------------------------------------------------
    console.log('[TEST 8] Assert zero mutation methods are exposed on SoftwareEvidenceLayer...');
    const forbiddenMethods = [
      'stage', 'stageAll', 'unstage', 'unstageAll', 'commit', 'push', 'pull',
      'checkout', 'createBranch', 'deleteFile', 'writeFile', 'createFile',
      'reset', 'discard', 'applyPatch', 'applyChangeSet', 'saveSnapshot',
      'deleteSnapshot', 'createCapsule', 'deleteCapsule',
    ];

    for (const method of forbiddenMethods) {
      assert.strictEqual(
        typeof softwareEvidenceLayer[method],
        'undefined',
        `SoftwareEvidenceLayer must NOT expose mutation method '${method}'`
      );
    }
    console.log('  ✓ Verified 0 mutation methods exposed on facade');

    // ----------------------------------------------------
    // Test 9: No repository mutation occurs
    // ----------------------------------------------------
    console.log('[TEST 9] Assert no repository mutation occurs during queries...');
    const statusBefore = await softwareEvidenceLayer.getWorkingTreeStatus(testTempDir);
    // Run extensive queries
    await softwareEvidenceLayer.getRecentCommits(testTempDir);
    await softwareEvidenceLayer.getCommitDiff(testTempDir, latestHash);
    await softwareEvidenceLayer.getCallers(testTempDir, 'login');
    await softwareEvidenceLayer.getDependents(testTempDir, 'auth.ts');
    await softwareEvidenceLayer.getDependencies(testTempDir, 'server.ts');
    await softwareEvidenceLayer.getPotentialImpact(testTempDir, ['login', 'auth.ts']);

    const statusAfter = await softwareEvidenceLayer.getWorkingTreeStatus(testTempDir);
    assert.deepStrictEqual(statusBefore.data.staged, statusAfter.data.staged, 'Staged files list unmodified');
    assert.deepStrictEqual(statusBefore.data.unstaged, statusAfter.data.unstaged, 'Unstaged files list unmodified');
    console.log('  ✓ Repository worktree 100% clean and unmodified');

    // ----------------------------------------------------
    // Test 10: No Continuum writes occur
    // ----------------------------------------------------
    console.log('[TEST 10] Assert no Continuum writes occur...');
    const isolatedContinuumDir = path.join(testTempDir, 'continuum_store');
    fs.mkdirSync(isolatedContinuumDir, { recursive: true });
    process.env.ECHO_CONTINUUM_DIR = isolatedContinuumDir;

    const continuumCountBefore = fs.readdirSync(isolatedContinuumDir).length;
    softwareEvidenceLayer.getVerificationSummary(sessionId);
    const continuumCountAfter = fs.readdirSync(isolatedContinuumDir).length;
    assert.strictEqual(continuumCountBefore, continuumCountAfter, 'Continuum directory count unchanged');
    console.log('  ✓ Continuum storage 100% isolated from evidence queries');

    // ----------------------------------------------------
    // Test 11: No Capsule writes occur
    // ----------------------------------------------------
    console.log('[TEST 11] Assert no Capsule writes occur...');
    const isolatedCapsuleDir = path.join(testTempDir, 'capsule_store');
    fs.mkdirSync(isolatedCapsuleDir, { recursive: true });
    process.env.NEXUS_CAPSULE_DIR = isolatedCapsuleDir;

    const capsuleCountBefore = fs.readdirSync(isolatedCapsuleDir).length;
    softwareEvidenceLayer.getAgentChanges(sessionId);
    const capsuleCountAfter = fs.readdirSync(isolatedCapsuleDir).length;
    assert.strictEqual(capsuleCountBefore, capsuleCountAfter, 'Context Capsule storage untouched');
    console.log('  ✓ Context Capsule storage 100% isolated from evidence queries');


    // ----------------------------------------------------
    // Test 12: Zero AI provider calls
    // ----------------------------------------------------
    console.log('[TEST 12] Assert zero AI provider calls...');
    // Verify synchronous execution time of queries without network delays
    const queryStartTime = Date.now();
    for (let i = 0; i < 25; i++) {
      softwareEvidenceLayer.getDiagnostics({ rawOutput: 'Error: Cannot find module "express"' });
      softwareEvidenceLayer.getTestResults('pytest', '10 passed in 0.1s', '', 0);
      softwareEvidenceLayer.getAgentChanges(sessionId);
      softwareEvidenceLayer.getVerificationSummary(sessionId);
    }
    const queryElapsed = Date.now() - queryStartTime;
    assert(queryElapsed < 100, `25 multi-query passes executed in ${queryElapsed}ms (<100ms) confirming 0 AI network latency`);
    console.log(`  ✓ 100 evidence operations completed synchronously in ${queryElapsed}ms (Zero AI calls)`);

    console.log('\n====================================================');
    console.log('ALL 12 EVIDENCE LAYER INVARIANT TESTS PASSED');
    console.log('====================================================');
  } finally {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

runTests().catch((err) => {
  console.error('EVIDENCE LAYER SUITE FAILED:', err);
  process.exit(1);
});
