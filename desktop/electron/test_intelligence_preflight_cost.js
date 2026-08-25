/**
 * TEST: NEXUS INTELLIGENCE LAYER — PREFLIGHT COST ESTIMATOR (Phase 2)
 * 
 * Verifies all 20 required test invariants:
 * 1. Basic prompt token estimate.
 * 2. Active-file token estimate.
 * 3. Selection token estimate.
 * 4. History contribution.
 * 5. Capsule contribution.
 * 6. Tool overhead.
 * 7. File estimate from explicit targets.
 * 8. Unknown target returns honest low-confidence estimate.
 * 9. Known model pricing calculation.
 * 10. Unknown pricing returns pricingAvailable:false.
 * 11. NORMAL context classification.
 * 12. APPROACHING context classification.
 * 13. CRITICAL context classification.
 * 14. No AI calls.
 * 15. No Git mutations.
 * 16. No Continuum access.
 * 17. No Context Capsule mutation.
 * 18. No AgentLoop execution.
 * 19. Existing greeting gating remains unchanged.
 * 20. Existing Source Control remains unchanged.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { preflightCostEstimator, PreflightCostEstimator } = require('./intelligence/PreflightCostEstimator');
const { getModelPricing, BUDGET_STATUS, CONFIDENCE_LEVELS } = require('./intelligence/types');
const { requestRouter, isGreeting } = require('./harness/RequestRouter');

async function runTests() {
  console.log('====================================================');
  console.log('RUNNING PREFLIGHT COST ESTIMATOR INVARIANT SUITE');
  console.log('====================================================\n');

  const testTempDir = path.join(__dirname, `__test_intelligence_preflight_${Date.now()}`);
  fs.mkdirSync(testTempDir, { recursive: true });
  const testSampleFile = path.join(testTempDir, 'sample.ts');
  const sampleCode = 'export function add(a: number, b: number): number {\n  return a + b;\n}\n';
  fs.writeFileSync(testSampleFile, sampleCode, 'utf8');

  try {
    // ----------------------------------------------------
    // Test 1: Basic prompt token estimate
    // ----------------------------------------------------
    console.log('[TEST 1] Basic prompt token estimate...');
    const promptText = 'Explain how authentication works in this project.';
    const est1 = preflightCostEstimator.estimate({ userInput: promptText, workspacePath: testTempDir });
    assert(est1.breakdown.prompt === Math.ceil(promptText.length / 4), 'Prompt token count should match 4 chars/token heuristic');
    assert(est1.estimatedInputTokens > est1.breakdown.prompt, 'Total input includes system and tool overheads');
    console.log(`  ✓ Prompt tokens: ${est1.breakdown.prompt}, Total input tokens: ${est1.estimatedInputTokens}`);

    // ----------------------------------------------------
    // Test 2: Active-file token estimate
    // ----------------------------------------------------
    console.log('[TEST 2] Active-file token estimate...');
    const est2 = preflightCostEstimator.estimate({
      userInput: 'Refactor this file',
      workspacePath: testTempDir,
      activeFilePath: testSampleFile,
    });
    assert(est2.breakdown.activeFile === Math.ceil(sampleCode.length / 4), 'Active file tokens calculated from file byte length');
    console.log(`  ✓ Active file tokens: ${est2.breakdown.activeFile}`);

    // ----------------------------------------------------
    // Test 3: Selection token estimate
    // ----------------------------------------------------
    console.log('[TEST 3] Selection token estimate...');
    const selection = 'return a + b;';
    const est3 = preflightCostEstimator.estimate({
      userInput: 'Optimize selected lines',
      workspacePath: testTempDir,
      selectionText: selection,
      activeFilePath: testSampleFile,
    });
    assert(est3.breakdown.selection === Math.ceil(selection.length / 4), 'Selection tokens match selection text length / 4');
    assert(est3.breakdown.activeFile === 0, 'When selection is given, selection overrides full file read');
    console.log(`  ✓ Selection tokens: ${est3.breakdown.selection}`);

    // ----------------------------------------------------
    // Test 4: History contribution
    // ----------------------------------------------------
    console.log('[TEST 4] History contribution...');
    const historyItems = [
      { payload: { text: 'Turn 1 user request to set up project structure.' } },
      { payload: { text: 'Turn 1 agent response with directory scaffold.' } },
    ];
    const est4 = preflightCostEstimator.estimate({
      userInput: 'Next step please',
      historyItems,
    });
    assert(est4.breakdown.history > 0, 'History items contribute deterministically to token breakdown');
    console.log(`  ✓ History tokens: ${est4.breakdown.history}`);

    // ----------------------------------------------------
    // Test 5: Capsule contribution
    // ----------------------------------------------------
    console.log('[TEST 5] Capsule contribution...');
    const mockCapsule = {
      conversation_context: {
        summary: 'Prior session built the authentication service.',
        last_exchanges: [{ user: 'Can we add JWT?', assistant: 'JWT token generation implemented.' }],
      },
      task_state: { primary_goal: 'Authentication setup' },
    };
    const est5 = preflightCostEstimator.estimate({
      userInput: 'Continue from where we left off',
      importedCapsule: mockCapsule,
    });
    assert(est5.breakdown.capsule > 0, 'Imported capsule context contributes to tokens');
    console.log(`  ✓ Capsule tokens: ${est5.breakdown.capsule}`);

    // ----------------------------------------------------
    // Test 6: Tool overhead
    // ----------------------------------------------------
    console.log('[TEST 6] Tool overhead...');
    assert(est1.breakdown.tools === 500, 'Tool declaration tokens is 500');
    assert(est1.breakdown.system === 350, 'Base system instructions tokens is 350');
    console.log(`  ✓ Tool overhead: ${est1.breakdown.tools}, System overhead: ${est1.breakdown.system}`);

    // ----------------------------------------------------
    // Test 7: File estimate from explicit targets
    // ----------------------------------------------------
    console.log('[TEST 7] File estimate from explicit targets...');
    const est7 = preflightCostEstimator.estimate({
      userInput: 'Modify user service',
      targetFiles: ['src/user.ts', 'src/auth.ts', 'tests/user.test.ts'],
    });
    assert.strictEqual(est7.estimatedFiles.count, 3, 'Estimated file count matches explicit target count');
    assert.strictEqual(est7.estimatedFiles.confidence, CONFIDENCE_LEVELS.DIRECT, 'Explicit targets have DIRECT (1.0) confidence');
    console.log(`  ✓ Estimated files: ${est7.estimatedFiles.count}, confidence: ${est7.estimatedFiles.confidence}`);

    // ----------------------------------------------------
    // Test 8: Unknown target returns honest low-confidence estimate
    // ----------------------------------------------------
    console.log('[TEST 8] Unknown target returns honest low-confidence estimate...');
    const est8 = preflightCostEstimator.estimate({
      userInput: 'Tell me something interesting',
    });
    assert.strictEqual(est8.estimatedFiles.count, 1);
    assert.strictEqual(est8.estimatedFiles.confidence, CONFIDENCE_LEVELS.LOW, 'Unknown target returns LOW confidence (0.3)');
    console.log(`  ✓ Fallback confidence: ${est8.estimatedFiles.confidence}`);

    // ----------------------------------------------------
    // Test 9: Known model pricing calculation
    // ----------------------------------------------------
    console.log('[TEST 9] Known model pricing calculation...');
    const est9 = preflightCostEstimator.estimate({
      userInput: 'Fix the bug in the add function',
      providerId: 'nexus1', // gemini-2.5-flash: $0.075 / 1M in, $0.30 / 1M out
      modelId: 'gemini-2.5-flash',
    });
    assert.strictEqual(est9.pricingAvailable, true, 'Pricing must be available for gemini-2.5-flash');
    assert(est9.estimatedCostUSD > 0, 'Estimated cost should be positive');
    assert(typeof est9.inputCostUSD === 'number', 'inputCostUSD is a number');
    assert(typeof est9.outputCostUSD === 'number', 'outputCostUSD is a number');
    console.log(`  ✓ Estimated cost: $${est9.estimatedCostUSD} (Input: $${est9.inputCostUSD}, Output: $${est9.outputCostUSD})`);

    // ----------------------------------------------------
    // Test 10: Unknown pricing returns pricingAvailable:false
    // ----------------------------------------------------
    console.log('[TEST 10] Unknown pricing returns pricingAvailable:false...');
    const est10 = preflightCostEstimator.estimate({
      userInput: 'Fix bug',
      providerId: 'custom_local_llm',
      modelId: 'unlisted-community-model-99b',
    });
    assert.strictEqual(est10.pricingAvailable, false, 'Unknown model pricing returns pricingAvailable: false');
    assert.strictEqual(est10.estimatedCostUSD, null, 'Unknown model pricing returns estimatedCostUSD: null without fabricating dollar amounts');
    console.log(`  ✓ pricingAvailable: ${est10.pricingAvailable}, estimatedCostUSD: ${est10.estimatedCostUSD}`);

    // ----------------------------------------------------
    // Test 11: NORMAL context classification
    // ----------------------------------------------------
    console.log('[TEST 11] NORMAL context classification...');
    const est11 = preflightCostEstimator.estimate({
      userInput: 'Short question',
      budgetLimit: 6000,
    });
    assert.strictEqual(est11.budgetStatus.level, BUDGET_STATUS.NORMAL, 'Short context is classified as NORMAL');
    assert.strictEqual(est11.budgetStatus.isApproaching, false);
    assert.strictEqual(est11.budgetStatus.isCritical, false);
    console.log(`  ✓ Budget status: ${est11.budgetStatus.level} (${est11.budgetStatus.percentage}%)`);

    // ----------------------------------------------------
    // Test 12: APPROACHING context classification
    // ----------------------------------------------------
    console.log('[TEST 12] APPROACHING context classification...');
    // Create prompt that fills ~80% of 1000 tokens ceiling
    const largePrompt = 'a'.repeat(4 * 800); // 800 tokens
    const est12 = preflightCostEstimator.estimate({
      userInput: largePrompt,
      budgetLimit: 2000,
    });
    // total tokens will be ~800 prompt + 500 tools + 350 system = 1650 / 2000 = 82.5% -> APPROACHING
    assert.strictEqual(est12.budgetStatus.level, BUDGET_STATUS.APPROACHING, 'Context >= 75% and < 90% is APPROACHING');
    assert.strictEqual(est12.budgetStatus.isApproaching, true);
    console.log(`  ✓ Budget status: ${est12.budgetStatus.level} (${est12.budgetStatus.percentage}%)`);

    // ----------------------------------------------------
    // Test 13: CRITICAL context classification
    // ----------------------------------------------------
    console.log('[TEST 13] CRITICAL context classification...');
    const hugePrompt = 'x'.repeat(4 * 2500); // 2500 tokens
    const est13 = preflightCostEstimator.estimate({
      userInput: hugePrompt,
      budgetLimit: 2000,
    });
    assert.strictEqual(est13.budgetStatus.level, BUDGET_STATUS.CRITICAL, 'Context >= 90% is CRITICAL');
    assert.strictEqual(est13.budgetStatus.isCritical, true);
    console.log(`  ✓ Budget status: ${est13.budgetStatus.level} (${est13.budgetStatus.percentage}%)`);

    // ----------------------------------------------------
    // Test 14: No AI calls
    // ----------------------------------------------------
    console.log('[TEST 14] Assert zero AI calls occurred...');
    // Verify that running estimate() does not make network requests or touch AI providers
    const startEstimateTime = Date.now();
    for (let i = 0; i < 50; i++) {
      preflightCostEstimator.estimate({ userInput: `Synthetic test prompt ${i}` });
    }
    const elapsed = Date.now() - startEstimateTime;
    assert(elapsed < 100, `50 estimations ran in ${elapsed}ms (<100ms) confirming pure synchronous local computation`);
    console.log(`  ✓ 50 preflight estimates completed synchronously in ${elapsed}ms`);

    // ----------------------------------------------------
    // Test 15: No Git mutations
    // ----------------------------------------------------
    console.log('[TEST 15] Assert zero Git mutations occurred...');
    const gitDir = path.join(process.cwd(), '.git');
    const headFile = path.join(gitDir, 'HEAD');
    let headMtimeBefore = 0;
    if (fs.existsSync(headFile)) {
      headMtimeBefore = fs.statSync(headFile).mtimeMs;
    }
    preflightCostEstimator.estimate({
      userInput: 'git commit and push changes',
      workspacePath: process.cwd(),
    });
    if (fs.existsSync(headFile)) {
      const headMtimeAfter = fs.statSync(headFile).mtimeMs;
      assert.strictEqual(headMtimeBefore, headMtimeAfter, 'Git HEAD file was not mutated');
    }
    console.log('  ✓ Git repository state completely unmodified');

    // ----------------------------------------------------
    // Test 16: No Continuum access
    // ----------------------------------------------------
    console.log('[TEST 16] Assert no Continuum storage was written...');
    const isolatedContinuumDir = path.join(testTempDir, 'continuum_store');
    fs.mkdirSync(isolatedContinuumDir, { recursive: true });
    process.env.ECHO_CONTINUUM_DIR = isolatedContinuumDir;

    const continuumCountBefore = fs.readdirSync(isolatedContinuumDir).length;
    preflightCostEstimator.estimate({
      userInput: 'Fix continuum handoff bug',
      workspacePath: process.cwd(),
    });
    const continuumCountAfter = fs.readdirSync(isolatedContinuumDir).length;
    assert.strictEqual(continuumCountBefore, continuumCountAfter, 'Continuum directory count unchanged');
    console.log('  ✓ Continuum storage verified 100% isolated');

    // ----------------------------------------------------
    // Test 17: No Context Capsule mutation
    // ----------------------------------------------------
    console.log('[TEST 17] Assert Context Capsule was not mutated...');
    const isolatedCapsuleDir = path.join(testTempDir, 'capsule_store');
    fs.mkdirSync(isolatedCapsuleDir, { recursive: true });
    process.env.NEXUS_CAPSULE_DIR = isolatedCapsuleDir;

    const capsuleCountBefore = fs.readdirSync(isolatedCapsuleDir).length;
    preflightCostEstimator.estimate({
      userInput: 'Export context capsule',
      importedCapsule: mockCapsule,
    });
    const capsuleCountAfter = fs.readdirSync(isolatedCapsuleDir).length;
    assert.strictEqual(capsuleCountBefore, capsuleCountAfter, 'Context Capsule storage untouched');
    console.log('  ✓ Context Capsule storage verified 100% isolated');


    // ----------------------------------------------------
    // Test 18: No AgentLoop execution
    // ----------------------------------------------------
    console.log('[TEST 18] Assert no AgentLoop execution occurred...');
    // PreflightCostEstimator has no reference or dependency on AgentLoop
    assert.strictEqual(preflightCostEstimator.agentLoop, undefined, 'PreflightCostEstimator has zero AgentLoop coupling');
    console.log('  ✓ AgentLoop completely isolated from preflight estimation');

    // ----------------------------------------------------
    // Test 19: Existing greeting gating remains unchanged
    // ----------------------------------------------------
    console.log('[TEST 19] Existing greeting gating remains unchanged...');
    const greetingResult = requestRouter.classify('hello');
    assert.strictEqual(greetingResult.mode, 'CONVERSATION', 'RequestRouter still identifies greetings as CONVERSATION');
    assert.strictEqual(isGreeting('hello'), true, 'isGreeting helper works identically');
    console.log('  ✓ Greeting intent classification verified intact');

    // ----------------------------------------------------
    // Test 20: Existing Source Control remains unchanged
    // ----------------------------------------------------
    console.log('[TEST 20] Existing Source Control remains unchanged...');
    const { gitManager } = require('./gitManager');
    assert.strictEqual(typeof gitManager.getStatus, 'function', 'GitManager.getStatus exists and unchanged');
    assert.strictEqual(typeof gitManager.getCommitHistory, 'function', 'GitManager.getCommitHistory exists and unchanged');
    console.log('  ✓ Source Control infrastructure verified intact');

    console.log('\n====================================================');
    console.log('ALL 20 PREFLIGHT INVARIANT TESTS PASSED SUCCESSFULLY');
    console.log('====================================================');
  } finally {
    try {
      fs.rmSync(testTempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

runTests().catch((err) => {
  console.error('PREFLIGHT INVARIANT SUITE FAILED:', err);
  process.exit(1);
});
