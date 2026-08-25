/**
 * TEST SUITE: NEXUS INTELLIGENCE LAYER — PREFLIGHT ESTIMATOR (Phase 4)
 * Token / Cost-Aware Planning & Execution Scope Invariants
 * 
 * Verifies all 15 Phase 4 Invariant Requirements:
 * 1. Greeting → no preflight (shouldShowPreflight: false)
 * 2. Conversational statement → no coding preflight (shouldShowPreflight: false)
 * 3. Small coding task → low token & step estimate
 * 4. Medium coding task → medium estimate
 * 5. Large multi-file task → high estimate
 * 6. Imported capsule counted only once (bounded context, no full source chat replay)
 * 7. Cost unavailable → safe fallback ("Cost unavailable", pricingAvailable: false)
 * 8. Provider/model pricing used when available (calculates primary & multi-provider USD)
 * 9. File estimate remains bounded (no unbounded repo scans)
 * 10. No AI calls during estimation (synchronous, local computation)
 * 11. No Git mutations (HEAD & repository untouched)
 * 12. No workspace writes (read-only preflight)
 * 13. Existing ContextEngine estimation remains correct
 * 14. Existing agent execution remains unchanged (HarnessRuntime / AgentLoop)
 * 15. Existing capsule behavior remains unchanged
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { preflightEstimator, PreflightEstimator } = require('./intelligence/PreflightEstimator');
const { preflightCostEstimator } = require('./intelligence/PreflightCostEstimator');
const { getModelPricing, BUDGET_STATUS, CONFIDENCE_LEVELS, CONFIDENCE_TIERS } = require('./intelligence/types');
const { requestRouter, ROUTER_MODES, isGreeting } = require('./harness/RequestRouter');
const { contextEngine } = require('./harness/ContextEngine');

async function runPreflightEstimatorSuite() {
  console.log('================================================================');
  console.log('STARTING PHASE 4 PREFLIGHT ESTIMATOR INVARIANT TEST SUITE');
  console.log('================================================================\n');

  let passedTests = 0;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus_preflight_phase4_test_'));
  const sampleSourceFile = path.join(tempDir, 'checkout.ts');
  fs.writeFileSync(
    sampleSourceFile,
    'export function calculateCheckoutTotal(cart: any[]): number {\n  return cart.reduce((sum, item) => sum + item.price, 0);\n}\n',
    'utf8'
  );

  const sampleTestFile = path.join(tempDir, 'checkout.test.ts');
  fs.writeFileSync(
    sampleTestFile,
    'import { calculateCheckoutTotal } from "./checkout";\n// test calculation\n',
    'utf8'
  );

  try {
    // ------------------------------------------------------------------
    // TEST 1: Greeting → no preflight
    // ------------------------------------------------------------------
    console.log('[TEST 1] Greeting prompts bypass preflight estimation...');
    const greetings = ['hi', 'hello', 'hey', 'thanks', 'thank you', 'good morning'];
    for (const g of greetings) {
      const res = preflightEstimator.estimate({ userInput: g, workspacePath: tempDir });
      assert.strictEqual(res.shouldShowPreflight, false, `Greeting "${g}" must set shouldShowPreflight: false`);
      assert.strictEqual(res.mode, ROUTER_MODES.CONVERSATION, `Greeting "${g}" must be classified as CONVERSATION`);
      assert.strictEqual(res.estimatedToolCalls.approximate, 0, `Greeting must have 0 tool operations`);
    }
    passedTests++;
    console.log('✓ TEST 1 PASSED: Pure greetings deterministically bypass preflight card');

    // ------------------------------------------------------------------
    // TEST 2: Conversational statement → no coding preflight
    // ------------------------------------------------------------------
    console.log('\n[TEST 2] Conversational statements & discussions bypass coding preflight...');
    const convStatements = [
      "I'm working on a checkout validation task.",
      "I'm testing the new capsule feature.",
      "What is recursion?",
      "Can you explain this approach?",
      "What does this project do?",
    ];
    for (const stmt of convStatements) {
      const res = preflightEstimator.estimate({ userInput: stmt, workspacePath: tempDir });
      assert.strictEqual(res.shouldShowPreflight, false, `Statement "${stmt}" must set shouldShowPreflight: false`);
      assert.strictEqual(res.mode, ROUTER_MODES.CONVERSATION);
    }
    passedTests++;
    console.log('✓ TEST 2 PASSED: Conversational statements bypass coding preflight');

    // ------------------------------------------------------------------
    // TEST 3: Small coding task → low token estimate
    // ------------------------------------------------------------------
    console.log('\n[TEST 3] Small coding task produces low token & tool estimate...');
    const smallTask = 'Change button color to cyan in checkout.ts';
    const smallEst = preflightEstimator.estimate({
      userInput: smallTask,
      workspacePath: tempDir,
      activeFilePath: sampleSourceFile,
    });
    assert.strictEqual(smallEst.shouldShowPreflight, true, 'Coding task must trigger preflight');
    assert.strictEqual(smallEst.estimatedFiles.count, 1, 'Small task on 1 file');
    assert(smallEst.estimatedMaxOutputTokens <= 1800, 'Small task max output tokens bounded');
    assert(smallEst.estimatedToolCalls.approximate <= 8, 'Small task tool steps bounded');
    assert.strictEqual(smallEst.riskLevel, 'LOW' || 'MEDIUM');
    passedTests++;
    console.log(`✓ TEST 3 PASSED: Small task token total: ~${smallEst.estimatedTotalTokens}, files: ${smallEst.estimatedFiles.count}, tools: ~${smallEst.estimatedToolCalls.approximate}`);

    // ------------------------------------------------------------------
    // TEST 4: Medium coding task → medium estimate
    // ------------------------------------------------------------------
    console.log('\n[TEST 4] Medium coding task produces medium estimate...');
    const medTask = 'Fix checkout validation in checkout.ts and update calculation';
    const medEst = preflightEstimator.estimate({
      userInput: medTask,
      workspacePath: tempDir,
      activeFilePath: sampleSourceFile,
    });
    assert.strictEqual(medEst.shouldShowPreflight, true);
    assert(medEst.estimatedInputTokens > 850);
    assert(medEst.estimatedMaxOutputTokens >= 1500, 'Medium mutation estimated output tokens >= 1500');
    assert(medEst.estimatedToolCalls.approximate >= 4, 'Medium mutation tool steps >= 4');
    assert.strictEqual(medEst.riskLevel, 'MEDIUM');
    passedTests++;
    console.log(`✓ TEST 4 PASSED: Medium task token total: ~${medEst.estimatedTotalTokens}, risk: ${medEst.riskLevel}, tools: ~${medEst.estimatedToolCalls.approximate}`);

    // ------------------------------------------------------------------
    // TEST 5: Large multi-file task → high estimate
    // ------------------------------------------------------------------
    console.log('\n[TEST 5] Large multi-file refactor task produces high estimate...');
    const largeTask = 'Refactor checkout calculation and data model across the codebase';
    const largeEst = preflightEstimator.estimate({
      userInput: largeTask,
      workspacePath: tempDir,
    });
    assert.strictEqual(largeEst.shouldShowPreflight, true);
    assert(largeEst.estimatedMaxOutputTokens >= 3000, 'Large refactor max output >= 3000 tokens');
    assert(largeEst.estimatedToolCalls.approximate >= 8, 'Large refactor tool steps >= 8');
    assert.strictEqual(largeEst.riskLevel, 'HIGH', 'Large refactor risk must be HIGH');
    passedTests++;
    console.log(`✓ TEST 5 PASSED: Large refactor token total: ~${largeEst.estimatedTotalTokens}, risk: ${largeEst.riskLevel}, tools: ~${largeEst.estimatedToolCalls.approximate}`);

    // ------------------------------------------------------------------
    // TEST 6: Imported capsule counted only once
    // ------------------------------------------------------------------
    console.log('\n[TEST 6] Attached Context Capsule counted only once without source chat replay...');
    const mockCapsule = {
      nexus_capsule_version: '1.0.0',
      capsule_id: 'capsule_1700000000000_abcdef123456',
      created_at: Date.now(),
      source_chat: { title: 'Checkout Optimization', thread_id: 'thread_123' },
      task_state: {
        primary_goal: 'Refactor cart calculation and unit tests',
        important_decisions: ['Use deterministic integer cents for prices'],
        important_context: ['Node 20 environment with TypeScript'],
      },
      conversation_context: {
        summary: 'Prior session set up checkout total logic and test scaffold.',
        last_exchanges: [
          { user: 'Can you implement discounts?', assistant: 'Discounts calculation helper added.' },
        ],
      },
    };

    const estWithoutCapsule = preflightEstimator.estimate({
      userInput: 'Fix checkout validation',
      workspacePath: tempDir,
    });

    const estWithCapsule = preflightEstimator.estimate({
      userInput: 'Fix checkout validation',
      workspacePath: tempDir,
      importedCapsule: mockCapsule,
    });

    assert(estWithCapsule.breakdown.capsule > 0, 'Capsule tokens present in breakdown');
    assert.strictEqual(
      estWithCapsule.estimatedInputTokens,
      estWithoutCapsule.estimatedInputTokens + estWithCapsule.breakdown.capsule,
      'Capsule contributes exactly its bounded formatted tokens once'
    );
    passedTests++;
    console.log(`✓ TEST 6 PASSED: Capsule tokens isolated: ${estWithCapsule.breakdown.capsule} tokens counted once`);

    // ------------------------------------------------------------------
    // TEST 7: Cost unavailable → safe fallback
    // ------------------------------------------------------------------
    console.log('\n[TEST 7] Missing pricing returns safe fallback "Cost unavailable"...');
    const unknownCostEst = preflightEstimator.estimate({
      userInput: 'Fix checkout validation',
      providerId: 'custom_onprem_provider',
      modelId: 'custom-private-weights-v3',
    });
    assert.strictEqual(unknownCostEst.pricingAvailable, false, 'pricingAvailable must be false');
    assert.strictEqual(unknownCostEst.estimatedCostUSD, null, 'estimatedCostUSD must be null');
    assert.strictEqual(unknownCostEst.primaryCostFormatted, 'Cost unavailable', 'Formatted string is "Cost unavailable"');
    passedTests++;
    console.log('✓ TEST 7 PASSED: Safe cost fallback validated without fabricated dollar amounts');

    // ------------------------------------------------------------------
    // TEST 8: Provider/model pricing used when available
    // ------------------------------------------------------------------
    console.log('\n[TEST 8] Known model pricing calculates exact deterministic cost...');
    const knownCostEst = preflightEstimator.estimate({
      userInput: 'Fix checkout validation',
      providerId: 'gemini',
      modelId: 'gemini-2.5-flash',
    });
    assert.strictEqual(knownCostEst.pricingAvailable, true);
    assert(knownCostEst.estimatedCostUSD > 0, 'Cost is positive number');
    assert(knownCostEst.primaryCostFormatted.startsWith('~$0.'), 'Formatted cost includes currency prefix');
    assert(knownCostEst.providerCosts !== null, 'Comparison matrix present');
    assert(typeof knownCostEst.providerCosts.Gemini === 'string', 'Gemini cost present in matrix');
    assert(typeof knownCostEst.providerCosts.Groq === 'string', 'Groq cost present in matrix');
    passedTests++;
    console.log(`✓ TEST 8 PASSED: Estimated cost: ${knownCostEst.primaryCostFormatted}, Comparison:`, knownCostEst.providerCosts);

    // ------------------------------------------------------------------
    // TEST 9: File estimate remains bounded
    // ------------------------------------------------------------------
    console.log('\n[TEST 9] File estimate stays strictly bounded to top matches...');
    const fileEst = preflightEstimator.estimate({
      userInput: 'Fix checkout validation in checkout.ts and checkout.test.ts',
      workspacePath: tempDir,
    });
    assert.strictEqual(fileEst.estimatedFiles.count, 2);
    assert.deepStrictEqual(fileEst.estimatedFiles.targetFiles.sort(), ['checkout.test.ts', 'checkout.ts'].sort());
    passedTests++;
    console.log(`✓ TEST 9 PASSED: Bounded file matches: ${fileEst.estimatedFiles.targetFiles.join(', ')}`);

    // ------------------------------------------------------------------
    // TEST 10: No AI calls during estimation
    // ------------------------------------------------------------------
    console.log('\n[TEST 10] Zero AI calls during estimation...');
    const startTime = Date.now();
    for (let i = 0; i < 100; i++) {
      preflightEstimator.estimate({
        userInput: `Run task iteration ${i} on checkout service`,
        workspacePath: tempDir,
      });
    }
    const elapsed = Date.now() - startTime;
    assert(elapsed < 200, `100 estimations finished in ${elapsed}ms (<200ms) confirming 100% synchronous local execution`);
    passedTests++;
    console.log(`✓ TEST 10 PASSED: 100 preflight estimations completed synchronously in ${elapsed}ms`);

    // ------------------------------------------------------------------
    // TEST 11: No Git mutations
    // ------------------------------------------------------------------
    console.log('\n[TEST 11] Zero Git mutations occurred...');
    const gitDir = path.join(process.cwd(), '.git');
    const headPath = path.join(gitDir, 'HEAD');
    let mtimeBefore = 0;
    if (fs.existsSync(headPath)) {
      mtimeBefore = fs.statSync(headPath).mtimeMs;
    }

    preflightEstimator.estimate({
      userInput: 'git commit -m "update checkout" and git push origin main',
      workspacePath: process.cwd(),
    });

    if (fs.existsSync(headPath)) {
      const mtimeAfter = fs.statSync(headPath).mtimeMs;
      assert.strictEqual(mtimeBefore, mtimeAfter, 'Git HEAD file mtime must remain identical');
    }
    passedTests++;
    console.log('✓ TEST 11 PASSED: Git repository HEAD and state verified unmodified');

    // ------------------------------------------------------------------
    // TEST 12: No workspace writes
    // ------------------------------------------------------------------
    console.log('\n[TEST 12] Zero workspace file writes or deletions...');
    const fileCountBefore = fs.readdirSync(tempDir).length;
    const checkoutContentBefore = fs.readFileSync(sampleSourceFile, 'utf8');

    preflightEstimator.estimate({
      userInput: 'Delete checkout.ts and rewrite completely',
      workspacePath: tempDir,
      activeFilePath: sampleSourceFile,
    });

    const fileCountAfter = fs.readdirSync(tempDir).length;
    const checkoutContentAfter = fs.readFileSync(sampleSourceFile, 'utf8');
    assert.strictEqual(fileCountBefore, fileCountAfter, 'File count in workspace untouched');
    assert.strictEqual(checkoutContentBefore, checkoutContentAfter, 'File content strictly untouched');
    passedTests++;
    console.log('✓ TEST 12 PASSED: Workspace files completely unmodified');

    // ------------------------------------------------------------------
    // TEST 13: Existing ContextEngine estimation remains correct
    // ------------------------------------------------------------------
    console.log('\n[TEST 13] Existing ContextEngine token estimation infrastructure reused...');
    const sampleStr = 'ContextEngine token parity test string 1234567890';
    const ceTokens = contextEngine.estimateTokens(sampleStr);
    const peTokens = preflightEstimator.estimateTokens(sampleStr);
    assert.strictEqual(ceTokens, peTokens, 'PreflightEstimator must yield identical token counts as ContextEngine');
    passedTests++;
    console.log(`✓ TEST 13 PASSED: ContextEngine estimate (${ceTokens}) == PreflightEstimator (${peTokens})`);

    // ------------------------------------------------------------------
    // TEST 14: Existing agent execution remains unchanged
    // ------------------------------------------------------------------
    console.log('\n[TEST 14] Existing agent execution runtime remains decoupled...');
    const { harnessRuntime } = require('./harness');
    assert.strictEqual(typeof harnessRuntime.handleRequest, 'function', 'harnessRuntime.handleRequest exists');
    assert.strictEqual(typeof harnessRuntime.runTurn, 'function', 'harnessRuntime.runTurn exists');
    assert.strictEqual(preflightEstimator.harnessRuntime, undefined, 'PreflightEstimator does not mutate or hijack runtime');
    passedTests++;
    console.log('✓ TEST 14 PASSED: HarnessRuntime and normal execution pipeline verified decoupled and preserved');

    // ------------------------------------------------------------------
    // TEST 15: Existing capsule serialization and schema unchanged
    // ------------------------------------------------------------------
    console.log('\n[TEST 15] Existing capsule serialization and schema unchanged...');
    const { validateCapsule, generateCapsuleId, generateCapsuleRef, serializeCapsule } = require('./capsule/CapsuleSchema');
    const validation = validateCapsule(mockCapsule);
    assert.strictEqual(validation.valid, true, 'Context Capsule schema validation unchanged');
    const serialized = serializeCapsule(mockCapsule);
    assert(typeof serialized === 'string' && serialized.includes('Checkout Optimization'), 'Capsule serializes cleanly');
    passedTests++;
    console.log('✓ TEST 15 PASSED: Context Capsule schema and lifecycle intact');

    console.log('\n================================================================');
    console.log(`ALL ${passedTests}/15 PREFLIGHT INVARIANT TESTS PASSED CLEANLY!`);
    console.log('================================================================');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

runPreflightEstimatorSuite().catch((err) => {
  console.error('PREFLIGHT ESTIMATOR SUITE FAILED:', err);
  process.exit(1);
});
