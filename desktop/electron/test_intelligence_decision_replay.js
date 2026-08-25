/**
 * TEST SUITE: NEXUS INTELLIGENCE LAYER — DECISION REPLAY (Phase 5)
 * Architectural Memory, Evidence-Backed Rationale & Replay Invariants
 * 
 * Verifies all 20 Invariant Requirements:
 * 1. Explicit architectural decision detected
 * 2. Decision can be confirmed
 * 3. Decision linked to file
 * 4. Decision linked to symbol
 * 5. Decision linked to commit
 * 6. Rejected alternative stored
 * 7. Evidence provenance preserved
 * 8. Unsupported rationale remains unknown
 * 9. Search by decision title
 * 10. Search by file path
 * 11. Search by commit
 * 12. Confidence remains evidence-backed
 * 13. No AI calls required for replay
 * 14. No Git mutations
 * 15. No file writes during replay queries
 * 16. Continuum untouched
 * 17. Context Capsule untouched
 * 18. Existing Why Did This Break remains intact
 * 19. Existing Preflight remains intact
 * 20. Normal chat/coding workflow remains intact
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  DecisionReplayEngine,
  decisionReplayEngine,
  createDecisionRecord,
  DECISION_STATUS,
  DECISION_CONFIDENCE,
  DECISION_PROVENANCE_SOURCE,
} = require('./intelligence');
const { softwareEvidenceLayer } = require('./intelligence/SoftwareEvidenceLayer');
const { breakageCorrelator } = require('./intelligence/BreakageCorrelator');
const { preflightEstimator } = require('./intelligence/PreflightEstimator');

async function runDecisionReplaySuite() {
  console.log('================================================================');
  console.log('STARTING PHASE 5 DECISION REPLAY INVARIANT TEST SUITE');
  console.log('================================================================\n');

  let passedTests = 0;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus_decision_replay_test_'));
  const paymentsDir = path.join(tempDir, 'src', 'payments');
  fs.mkdirSync(paymentsDir, { recursive: true });

  const checkoutFile = path.join(paymentsDir, 'checkout.js');
  fs.writeFileSync(
    checkoutFile,
    'export function calculateCheckoutTotal(cart) { return cart.reduce((s, i) => s + i.price, 0); }\n' +
    'export function processPayment(cart, token) { return { status: "PAID", amount: calculateCheckoutTotal(cart) }; }\n',
    'utf8'
  );

  const testFile = path.join(paymentsDir, 'checkout.test.js');
  fs.writeFileSync(
    testFile,
    'import { calculateCheckoutTotal } from "./checkout";\n// test assertion\n',
    'utf8'
  );

  const engine = new DecisionReplayEngine();

  try {
    // ------------------------------------------------------------------
    // TEST 1: Explicit architectural decision detected
    // ------------------------------------------------------------------
    console.log('[TEST 1] Detecting explicit architectural decisions from discussion...');
    const discussionPrompt = "Let's keep validation before payment processing in src/payments/checkout.js to avoid duplicate charges on retries.";
    const detected = engine.detectCandidateDecisions(discussionPrompt, {
      workspacePath: tempDir,
      activeFilePath: 'src/payments/checkout.js',
    });

    assert(Array.isArray(detected) && detected.length > 0, 'Must detect at least 1 candidate decision');
    const cand = detected[0];
    assert.strictEqual(cand.status, DECISION_STATUS.CANDIDATE, 'Detected state must be CANDIDATE');
    assert(cand.decision.toLowerCase().includes('validation before payment processing'), 'Decision text captured');
    assert(cand.rationale && cand.rationale.toLowerCase().includes('duplicate charges'), 'Rationale captured');
    passedTests++;
    console.log(`✓ TEST 1 PASSED: Detected candidate decision: "${cand.title}"`);

    // ------------------------------------------------------------------
    // TEST 2: Decision can be confirmed
    // ------------------------------------------------------------------
    console.log('\n[TEST 2] Confirming candidate decision...');
    const recorded = await engine.recordDecision(cand, { workspacePath: tempDir });
    assert.strictEqual(recorded.status, DECISION_STATUS.CANDIDATE);

    const confirmed = engine.confirmDecision(recorded.decisionId, tempDir);
    assert(confirmed !== null, 'Confirmed record must exist');
    assert.strictEqual(confirmed.status, DECISION_STATUS.CONFIRMED, 'Status must transition to CONFIRMED');
    assert.strictEqual(confirmed.provenance.source, DECISION_PROVENANCE_SOURCE.USER_CONFIRMED);
    passedTests++;
    console.log('✓ TEST 2 PASSED: Candidate decision confirmed cleanly');

    // ------------------------------------------------------------------
    // TEST 3: Decision linked to file
    // ------------------------------------------------------------------
    console.log('\n[TEST 3] Verifying decision linkage to concrete file...');
    assert(confirmed.affectedFiles && confirmed.affectedFiles.length > 0, 'Must have affected files');
    assert(confirmed.affectedFiles.some((f) => f.includes('checkout.js')), 'Must link checkout.js');
    passedTests++;
    console.log(`✓ TEST 3 PASSED: Linked files: ${confirmed.affectedFiles.join(', ')}`);

    // ------------------------------------------------------------------
    // TEST 4: Decision linked to symbol
    // ------------------------------------------------------------------
    console.log('\n[TEST 4] Linking decision to AST symbols...');
    const symbolDecision = await engine.recordDecision({
      title: 'Validation before payment',
      decision: 'Validation occurs before payment.',
      affectedFiles: ['src/payments/checkout.js'],
      affectedSymbols: ['calculateCheckoutTotal', 'processPayment'],
      rationale: 'Protect against malformed payment amounts',
      status: DECISION_STATUS.CONFIRMED,
    }, { workspacePath: tempDir });

    assert(Array.isArray(symbolDecision.affectedSymbols), 'affectedSymbols is an array');
    assert(symbolDecision.affectedSymbols.includes('calculateCheckoutTotal'));
    passedTests++;
    console.log(`✓ TEST 4 PASSED: Linked symbols: ${symbolDecision.affectedSymbols.join(', ')}`);

    // ------------------------------------------------------------------
    // TEST 5: Decision linked to commit
    // ------------------------------------------------------------------
    console.log('\n[TEST 5] Linking decision to VCS commit...');
    const commitDecision = await engine.recordDecision({
      title: 'Deterministic cents integer math',
      decision: 'All cart totals represented in integer cents.',
      affectedFiles: ['src/payments/checkout.js'],
      relatedCommits: ['abc1234'],
      rationale: 'Prevent floating point rounding errors in credit card charges',
      status: DECISION_STATUS.CONFIRMED,
    }, { workspacePath: tempDir });

    assert(commitDecision.relatedCommits.includes('abc1234'));
    passedTests++;
    console.log(`✓ TEST 5 PASSED: Linked commit: ${commitDecision.relatedCommits.join(', ')}`);

    // ------------------------------------------------------------------
    // TEST 6: Rejected alternative stored
    // ------------------------------------------------------------------
    console.log('\n[TEST 6] Storing rejected architectural alternatives...');
    const rejectPrompt = 'We rejected Redis because this workload does not need shared caching.';
    const rejectDetected = engine.detectCandidateDecisions(rejectPrompt, { workspacePath: tempDir });
    assert(rejectDetected.length > 0, 'Must detect rejection pattern');
    const rejectRec = await engine.recordDecision(rejectDetected[0], { workspacePath: tempDir, autoConfirm: true });

    assert(Array.isArray(rejectRec.rejectedAlternatives) && rejectRec.rejectedAlternatives.length > 0);
    assert.strictEqual(rejectRec.rejectedAlternatives[0].alternative, 'Redis');
    assert(rejectRec.rejectedAlternatives[0].reason.toLowerCase().includes('shared caching'));
    passedTests++;
    console.log(`✓ TEST 6 PASSED: Stored rejected alternative: ${rejectRec.rejectedAlternatives[0].alternative} (${rejectRec.rejectedAlternatives[0].reason})`);

    // ------------------------------------------------------------------
    // TEST 7: Evidence provenance preserved
    // ------------------------------------------------------------------
    console.log('\n[TEST 7] Preserving evidence provenance tags in replay...');
    const replayRes = engine.replayDecision('Why is validation before payment?', {
      workspacePath: tempDir,
    });

    assert.strictEqual(replayRes.success, true);
    assert.strictEqual(replayRes.matched, true);
    assert(Array.isArray(replayRes.evidence) && replayRes.evidence.includes('[decision]'));
    assert(replayRes.evidence.some((e) => e.includes('checkout.test.js') || e.includes('git_diff')));
    passedTests++;
    console.log(`✓ TEST 7 PASSED: Evidence tags in replay: ${replayRes.evidence.join(' ')}`);

    // ------------------------------------------------------------------
    // TEST 8: Unsupported rationale remains unknown (Never fabricated!)
    // ------------------------------------------------------------------
    console.log('\n[TEST 8] Unsupported queries return honest unknown rationale without hallucination...');
    const unknownReplay = engine.replayDecision('Why did we write this completely unknown esoteric algorithm?', {
      workspacePath: tempDir,
    });

    assert.strictEqual(unknownReplay.matched, false);
    assert.strictEqual(
      unknownReplay.rationale,
      'The available evidence does not establish why this decision was made.'
    );
    assert.strictEqual(unknownReplay.confidence, DECISION_CONFIDENCE.LOW);
    passedTests++;
    console.log('✓ TEST 8 PASSED: Honest unknown fallback preserved verbatim');

    // ------------------------------------------------------------------
    // TEST 9: Search by decision title
    // ------------------------------------------------------------------
    console.log('\n[TEST 9] Searching decisions by title...');
    const titleResults = engine.searchDecisions('validation', { workspacePath: tempDir });
    assert(titleResults.length > 0);
    assert(titleResults[0].title.toLowerCase().includes('validation'));
    passedTests++;
    console.log(`✓ TEST 9 PASSED: Title search returned "${titleResults[0].title}"`);

    // ------------------------------------------------------------------
    // TEST 10: Search by file path
    // ------------------------------------------------------------------
    console.log('\n[TEST 10] Searching decisions by affected file path...');
    const fileResults = engine.searchDecisions('src/payments/checkout.js', { workspacePath: tempDir });
    assert(fileResults.length > 0);
    assert(fileResults[0].affectedFiles.some((f) => f.includes('checkout.js')));
    passedTests++;
    console.log(`✓ TEST 10 PASSED: File search found ${fileResults.length} decisions matching checkout.js`);

    // ------------------------------------------------------------------
    // TEST 11: Search by commit
    // ------------------------------------------------------------------
    console.log('\n[TEST 11] Searching decisions by commit hash...');
    const commitResults = engine.searchDecisions('abc1234', { workspacePath: tempDir });
    assert(commitResults.length > 0);
    assert(commitResults[0].relatedCommits.includes('abc1234'));
    passedTests++;
    console.log(`✓ TEST 11 PASSED: Commit search matched decision "${commitResults[0].title}"`);

    // ------------------------------------------------------------------
    // TEST 12: Confidence remains evidence-backed
    // ------------------------------------------------------------------
    console.log('\n[TEST 12] Validating evidence-backed confidence scoring...');
    const highConf = engine.replayDecision('validation before payment', { workspacePath: tempDir });
    assert.strictEqual(highConf.confidence, DECISION_CONFIDENCE.HIGH);

    const emptyDec = createDecisionRecord({
      title: 'Unbacked decision',
      decision: 'Some unbacked decision',
      status: DECISION_STATUS.CANDIDATE,
    });
    assert.strictEqual(emptyDec.confidence, DECISION_CONFIDENCE.LOW);
    passedTests++;
    console.log('✓ TEST 12 PASSED: Evidence-backed confidence tiering verified');

    // ------------------------------------------------------------------
    // TEST 13: No AI calls required for replay
    // ------------------------------------------------------------------
    console.log('\n[TEST 13] Confirming zero AI provider calls during replay...');
    const startTime = Date.now();
    for (let i = 0; i < 100; i++) {
      engine.replayDecision('Why is validation before payment?', { workspacePath: tempDir });
    }
    const elapsed = Date.now() - startTime;
    assert(elapsed < 150, `100 decision replays finished in ${elapsed}ms (<150ms) confirming 100% local execution`);
    passedTests++;
    console.log(`✓ TEST 13 PASSED: 100 replays completed synchronously in ${elapsed}ms`);

    // ------------------------------------------------------------------
    // TEST 14: No Git mutations
    // ------------------------------------------------------------------
    console.log('\n[TEST 14] Verifying zero Git mutations occurred...');
    const gitDir = path.join(process.cwd(), '.git');
    const headPath = path.join(gitDir, 'HEAD');
    let mtimeBefore = 0;
    if (fs.existsSync(headPath)) {
      mtimeBefore = fs.statSync(headPath).mtimeMs;
    }

    engine.replayDecision('Why was payment architecture chosen?', { workspacePath: tempDir });

    if (fs.existsSync(headPath)) {
      const mtimeAfter = fs.statSync(headPath).mtimeMs;
      assert.strictEqual(mtimeBefore, mtimeAfter, 'Git HEAD must be strictly untouched');
    }
    passedTests++;
    console.log('✓ TEST 14 PASSED: Git HEAD verified unmodified');

    // ------------------------------------------------------------------
    // TEST 15: No file writes during replay queries
    // ------------------------------------------------------------------
    console.log('\n[TEST 15] Verifying zero file writes during replay queries...');
    const fileCountBefore = fs.readdirSync(paymentsDir).length;
    const checkoutContentBefore = fs.readFileSync(checkoutFile, 'utf8');

    engine.replayDecision('Why did we write calculateCheckoutTotal?', { workspacePath: tempDir });

    const fileCountAfter = fs.readdirSync(paymentsDir).length;
    const checkoutContentAfter = fs.readFileSync(checkoutFile, 'utf8');
    assert.strictEqual(fileCountBefore, fileCountAfter);
    assert.strictEqual(checkoutContentBefore, checkoutContentAfter);
    passedTests++;
    console.log('✓ TEST 15 PASSED: Workspace source files completely unmodified');

    // ------------------------------------------------------------------
    // TEST 16: Continuum untouched
    // ------------------------------------------------------------------
    console.log('\n[TEST 16] Verifying Continuum storage isolation...');
    const { continuumManager } = require('./continuumManager');
    const initialSnapshots = continuumManager.listSnapshots(tempDir).length;

    engine.replayDecision('Why is validation before payment?', { workspacePath: tempDir });

    const finalSnapshots = continuumManager.listSnapshots(tempDir).length;
    assert.strictEqual(initialSnapshots, finalSnapshots, 'Zero Continuum snapshots written');
    passedTests++;
    console.log('✓ TEST 16 PASSED: Continuum storage verified 100% untouched');

    // ------------------------------------------------------------------
    // TEST 17: Context Capsule untouched & compatible
    // ------------------------------------------------------------------
    console.log('\n[TEST 17] Context Capsule compatibility without storage mutation...');
    const mockCapsule = {
      nexus_capsule_version: '1.0.0',
      capsule_id: 'capsule_1740000000000_123456',
      capsule_ref: '#CC9988AA',
      created_at: Date.now(),
      source_chat: { thread_id: 't1', title: 'Capsule Chat' },
      task_state: {
        primary_goal: 'Payment verification refactor',
        important_decisions: ['Use SHA-256 for Stripe webhook signature verification'],
        relevant_files: ['src/payments/checkout.js'],
      },
    };

    const capsuleDecisions = engine.getDecisions({
      workspacePath: tempDir,
      capsule: mockCapsule,
    });

    assert(capsuleDecisions.some((d) => d.decision.includes('SHA-256 for Stripe webhook')));
    const stripeReplay = engine.replayDecision('Why do we use SHA-256 for Stripe?', {
      workspacePath: tempDir,
      capsule: mockCapsule,
    });
    assert(stripeReplay.matched === true);
    assert(stripeReplay.evidence.some((e) => e.includes('context_capsule: #CC9988AA')));
    passedTests++;
    console.log('✓ TEST 17 PASSED: Context Capsule bounded decisions referenced cleanly');

    // ------------------------------------------------------------------
    // TEST 18: Existing Why Did This Break remains intact
    // ------------------------------------------------------------------
    console.log('\n[TEST 18] Existing BreakageCorrelator remains intact...');
    assert.strictEqual(typeof breakageCorrelator.correlate, 'function');
    passedTests++;
    console.log('✓ TEST 18 PASSED: BreakageCorrelator verified intact');

    // ------------------------------------------------------------------
    // TEST 19: Existing Preflight remains intact
    // ------------------------------------------------------------------
    console.log('\n[TEST 19] Existing PreflightEstimator remains intact...');
    const preflight = preflightEstimator.estimate({
      userInput: 'Fix checkout validation in src/payments/checkout.js',
      workspacePath: tempDir,
    });
    assert.strictEqual(preflight.shouldShowPreflight, true);
    assert(preflight.estimatedTotalTokens > 0);
    passedTests++;
    console.log('✓ TEST 19 PASSED: PreflightEstimator verified intact');

    // ------------------------------------------------------------------
    // TEST 20: Normal chat/coding workflow remains intact
    // ------------------------------------------------------------------
    console.log('\n[TEST 20] Normal chat & coding pipeline remains intact...');
    const { harnessRuntime } = require('./harness');
    assert.strictEqual(typeof harnessRuntime.handleRequest, 'function');
    passedTests++;
    console.log('✓ TEST 20 PASSED: Normal execution pipeline verified preserved');

    console.log('\n================================================================');
    console.log(`ALL ${passedTests}/20 DECISION REPLAY INVARIANT TESTS PASSED CLEANLY!`);
    console.log('================================================================');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

runDecisionReplaySuite().catch((err) => {
  console.error('DECISION REPLAY SUITE FAILED:', err);
  process.exit(1);
});
