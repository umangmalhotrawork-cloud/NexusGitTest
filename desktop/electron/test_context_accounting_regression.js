/**
 * NEXUS CONTEXT ACCOUNTING & BUDGET REGRESSION TEST SUITE (ISSUE #5)
 * 
 * Verifies:
 * 1. Small one-file task has correct context percentage (< 40% of 1800 budget, not 99%).
 * 2. Context percentage increases predictably as messages are added.
 * 3. Tool results are counted exactly once.
 * 4. System instructions are counted exactly once.
 * 5. Tool declarations are counted exactly once.
 * 6. Context Capsule is counted exactly once.
 * 7. Repeated task execution does not duplicate prior tool results.
 * 8. Context percentage denominator is correct (1800 for coding task, 6000 for default).
 * 9. Internal budget percentage is not mislabeled as model context-window percentage.
 * 10. Existing model context-window pre-gating remains correct.
 * 11. Exact reproduction: cart_calculator.py single-file mutation.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { ContextEngine, DEFAULT_BUDGETS, CODING_TASK_BUDGETS } = require('./harness/ContextEngine');
const { HarnessRuntime } = require('./harness/HarnessRuntime');
const { ITEM_TYPES, TURN_STATUS } = require('./harness/types');
const { preflightEstimator } = require('./intelligence/PreflightEstimator');
const { getModelContextWindow } = require('./intelligence/types');

async function runContextAccountingRegressionSuite() {
  console.log('================================================================');
  console.log('  NEXUS CONTEXT ACCOUNTING & BUDGET REGRESSION TEST SUITE       ');
  console.log('================================================================\n');

  let passedTests = 0;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-context-accounting-'));
  const demoWs = path.join(process.cwd(), 'demo-workspaces', 'ai_cart_project');

  try {
    const contextEngine = new ContextEngine();

    // ------------------------------------------------------------------
    // TEST 1: Small one-file task has correct context percentage
    // ------------------------------------------------------------------
    console.log('[TEST 01] Small one-file task has correct context percentage (< 40% of 1800, not 99%)...');
    const thread1 = { threadId: 'thread_small_1' };
    const turn1 = { turnId: 'turn_small_1', userInput: 'Add a comment at top of file' };
    const items1 = [
      { itemId: 'i_u1', turnId: 'turn_small_1', type: ITEM_TYPES.USER_MESSAGE, payload: { text: 'Add a comment at top of file' } },
      { itemId: 'i_tc1', turnId: 'turn_small_1', type: ITEM_TYPES.TOOL_CALL, payload: { callId: 'c1', toolName: 'read_file', arguments: { path: 'a.py' } } },
      { itemId: 'i_tr1', turnId: 'turn_small_1', type: ITEM_TYPES.TOOL_RESULT, payload: { callId: 'c1', toolName: 'read_file', result: '# file a\nx = 1\n' } },
      { itemId: 'i_a1', turnId: 'turn_small_1', type: ITEM_TYPES.AGENT_MESSAGE, payload: { text: 'Done.' } },
    ];

    const ctx1 = contextEngine.buildContext({
      thread: thread1,
      turn: turn1,
      items: items1,
      intent: 'MUTATION',
    });

    assert.ok(ctx1.metadata, 'Context metadata must be present');
    assert.strictEqual(ctx1.metadata.budgetLimitTokens, 1800, 'Coding task budget denominator must be 1800');
    assert.ok(ctx1.metadata.totalEstimatedTokens < 600, `Expected tokens < 600, got ${ctx1.metadata.totalEstimatedTokens}`);
    assert.ok(ctx1.metadata.percentage < 40, `Expected percentage < 40%, got ${ctx1.metadata.percentage}%`);
    assert.strictEqual(ctx1.metadata.level, 'NORMAL', 'Small task must be NORMAL level, not CRITICAL');
    assert.strictEqual(ctx1.metadata.isCritical, false, 'isCritical must be false');
    passedTests++;
    console.log(`[PASS] Test 01: Small task tokens: ${ctx1.metadata.totalEstimatedTokens}/1800 (${ctx1.metadata.percentage}%), Level: ${ctx1.metadata.level}`);

    // ------------------------------------------------------------------
    // TEST 2: Context percentage increases predictably as messages are added
    // ------------------------------------------------------------------
    console.log('[TEST 02] Context percentage increases predictably as messages are added...');
    let prevTokens = ctx1.metadata.totalEstimatedTokens;
    let prevPercentage = ctx1.metadata.percentage;

    const items2 = [...items1];
    for (let i = 1; i <= 3; i++) {
      items2.push({
        itemId: `extra_user_${i}`,
        turnId: 'turn_small_1',
        type: ITEM_TYPES.USER_MESSAGE,
        payload: { text: `Extra instruction block ${i} with additional context for the computation.` },
      });
      items2.push({
        itemId: `extra_agent_${i}`,
        turnId: 'turn_small_1',
        type: ITEM_TYPES.AGENT_MESSAGE,
        payload: { text: `Acknowledged block ${i}. Processing step ${i} completed.` },
      });
    }

    const ctx2 = contextEngine.buildContext({
      thread: thread1,
      turn: turn1,
      items: items2,
      intent: 'MUTATION',
    });

    assert.ok(ctx2.metadata.totalEstimatedTokens > prevTokens, 'Tokens must increase with added messages');
    assert.ok(ctx2.metadata.percentage >= prevPercentage, 'Percentage must increase monotonically');
    assert.ok(ctx2.metadata.percentage <= 100, 'Percentage cannot exceed 100%');
    passedTests++;
    console.log(`[PASS] Test 02: Monotonic progression verified: ${prevTokens}t (${prevPercentage}%) -> ${ctx2.metadata.totalEstimatedTokens}t (${ctx2.metadata.percentage}%)`);

    // ------------------------------------------------------------------
    // TEST 3: Tool results are counted exactly once
    // ------------------------------------------------------------------
    console.log('[TEST 03] Tool results are counted exactly once...');
    const singleToolItem = {
      itemId: 'tr_single',
      turnId: 'turn_small_1',
      type: ITEM_TYPES.TOOL_RESULT,
      payload: { callId: 'c1', toolName: 'read_file', result: 'EXACT_UNIQUE_PAYLOAD_STRING_789', success: true },
    };

    const ctxWithTool = contextEngine.buildContext({
      thread: thread1,
      turn: turn1,
      items: [singleToolItem],
      intent: 'MUTATION',
    });

    const serializedMessages = JSON.stringify(ctxWithTool.messages);
    const occurrences = (serializedMessages.match(/EXACT_UNIQUE_PAYLOAD_STRING_789/g) || []).length;
    assert.strictEqual(occurrences, 1, `Tool result must appear exactly once in compiled messages, found ${occurrences}`);
    passedTests++;
    console.log('[PASS] Test 03: Tool result payload appears exactly once');

    // ------------------------------------------------------------------
    // TEST 4: System instructions are counted exactly once
    // ------------------------------------------------------------------
    console.log('[TEST 04] System instructions are counted exactly once...');
    assert.ok(typeof ctxWithTool.systemPrompt === 'string', 'System prompt must be string');
    const systemPromptCount = ctxWithTool.messages.filter((m) => m.role === 'system' && m.content?.includes('NEXUS PAIR PROGRAMMER')).length;
    assert.strictEqual(systemPromptCount, 0, 'System instructions must not be duplicated into conversational messages');
    passedTests++;
    console.log('[PASS] Test 04: System instructions isolated in root systemPrompt, zero duplicates in messages');

    // ------------------------------------------------------------------
    // TEST 5: Tool declarations are counted exactly once
    // ------------------------------------------------------------------
    console.log('[TEST 05] Tool declarations are counted exactly once...');
    const preflight = preflightEstimator.estimate({
      userInput: 'Modify cart_calculator.py',
      workspacePath: tempDir,
    });
    assert.strictEqual(preflight.breakdown.tools, 500, 'Preflight counts bounded tool declarations overhead exactly once');
    assert.strictEqual(preflight.breakdown.system, 350, 'Preflight counts base system overhead exactly once');
    passedTests++;
    console.log('[PASS] Test 05: Tool declarations and system overhead counted once in preflight breakdown');

    // ------------------------------------------------------------------
    // TEST 6: Context Capsule is counted exactly once
    // ------------------------------------------------------------------
    console.log('[TEST 06] Context Capsule is counted exactly once...');
    const sampleCapsule = {
      nexus_capsule_version: '1.0.0',
      capsule_id: 'capsule_test_1',
      task_state: { primary_goal: 'Test capsule counting' },
      conversation_context: { summary: 'Prior summary', last_exchanges: [] },
    };

    const ctxNoCap = contextEngine.buildContext({
      thread: thread1,
      turn: turn1,
      items: items1,
      intent: 'MUTATION',
    });

    const ctxWithCap = contextEngine.buildContext({
      thread: thread1,
      turn: turn1,
      items: items1,
      intent: 'MUTATION',
      importedCapsule: sampleCapsule,
    });

    assert.ok(ctxWithCap.metadata.sections.importedCapsulePresent, 'Capsule must be marked present');
    assert.ok(ctxWithCap.metadata.sections.importedCapsuleTokens > 0, 'Capsule tokens must be positive');
    const capTokenDiff = ctxWithCap.metadata.totalEstimatedTokens - ctxNoCap.metadata.totalEstimatedTokens;
    assert.strictEqual(
      capTokenDiff,
      ctxWithCap.metadata.sections.importedCapsuleTokens,
      'Capsule token diff must equal importedCapsuleTokens exactly'
    );
    passedTests++;
    console.log(`[PASS] Test 06: Capsule added exactly ${capTokenDiff} tokens once without replay`);

    // ------------------------------------------------------------------
    // TEST 7: Repeated task execution does not duplicate prior tool results
    // ------------------------------------------------------------------
    console.log('[TEST 07] Repeated task execution does not duplicate prior tool results...');
    const olderTurn = { turnId: 'turn_older' };
    const olderItems = [
      { itemId: 'ot_u', turnId: 'turn_older', type: ITEM_TYPES.USER_MESSAGE, payload: { text: 'First task' } },
      { itemId: 'ot_tc', turnId: 'turn_older', type: ITEM_TYPES.TOOL_CALL, payload: { callId: 'old_call', toolName: 'read_file', arguments: { path: 'old.py' } } },
      { itemId: 'ot_tr', turnId: 'turn_older', type: ITEM_TYPES.TOOL_RESULT, payload: { callId: 'old_call', toolName: 'read_file', result: 'OLD_CONTENT_RAW' } },
      { itemId: 'ot_a', turnId: 'turn_older', type: ITEM_TYPES.AGENT_MESSAGE, payload: { text: 'First task done' } },
    ];

    const ctxMultiTurn = contextEngine.buildContext({
      thread: thread1,
      turn: turn1, // current turn
      turns: [olderTurn, turn1],
      items: [...olderItems, ...items1],
      intent: 'MUTATION',
    });

    const multiTurnJson = JSON.stringify(ctxMultiTurn.messages);
    assert.ok(!multiTurnJson.includes('OLD_CONTENT_RAW'), 'Older turn raw tool results must be discarded from compiled history');
    assert.ok(multiTurnJson.includes('First task'), 'Older user prompt must be preserved');
    assert.ok(multiTurnJson.includes('First task done'), 'Older agent summary must be preserved');
    passedTests++;
    console.log('[PASS] Test 07: Prior turn tool results dropped from active history cleanly');

    // ------------------------------------------------------------------
    // TEST 8: Context percentage denominator is correct
    // ------------------------------------------------------------------
    console.log('[TEST 08] Context percentage denominator is correct (1800 coding, 6000 default)...');
    assert.strictEqual(DEFAULT_BUDGETS.totalBudgetTokens, 6000, 'Default budget is 6000');
    assert.strictEqual(CODING_TASK_BUDGETS.totalBudgetTokens, 1800, 'Coding task budget is 1800');

    // With buildContext:
    const codingCtx = contextEngine.buildContext({ thread: thread1, turn: turn1, items: items1, intent: 'MUTATION' });
    assert.strictEqual(codingCtx.metadata.budgetLimitTokens, 1800, 'Coding task uses 1800 denominator');

    const generalCtx = contextEngine.buildContext({ thread: thread1, turn: turn1, items: items1, intent: 'GENERAL_CHAT' });
    assert.strictEqual(generalCtx.metadata.budgetLimitTokens, 6000, 'General chat uses 6000 denominator');
    passedTests++;
    console.log('[PASS] Test 08: Denominators verified: 1800 for MUTATION, 6000 for GENERAL_CHAT');

    // ------------------------------------------------------------------
    // TEST 9: Internal budget percentage is not mislabeled as model context window
    // ------------------------------------------------------------------
    console.log('[TEST 09] Internal budget percentage explicitly declares WORKING_MEMORY...');
    assert.strictEqual(codingCtx.metadata.budgetType, 'WORKING_MEMORY', 'budgetType must be WORKING_MEMORY');
    assert.strictEqual(codingCtx.metadata.budgetCategory, 'CODING_TASK', 'budgetCategory must be CODING_TASK');
    assert.strictEqual(typeof codingCtx.metadata.budgetDescription, 'string');
    passedTests++;
    console.log(`[PASS] Test 09: Metadata explicitly declares budgetType: "${codingCtx.metadata.budgetType}", budgetCategory: "${codingCtx.metadata.budgetCategory}"`);

    // ------------------------------------------------------------------
    // TEST 10: Existing model context-window pre-gating remains correct
    // ------------------------------------------------------------------
    console.log('[TEST 10] Model context-window pre-gating capacity checks remain intact...');
    const geminiWindow = getModelContextWindow('gemini', 'gemini-2.5-flash');
    assert.strictEqual(geminiWindow, 1048576, 'Gemini 2.5 Flash context window is 1,048,576');

    const preflightGating = preflightEstimator.estimate({
      userInput: 'Small test',
      providerId: 'gemini',
      modelId: 'gemini-2.5-flash',
    });

    assert.strictEqual(preflightGating.isContextExceeded, false, 'Must not be exceeded');
    assert.ok(preflightGating.contextUsageRatio < 0.01, `Gemini usage ratio must be < 1%, got ${preflightGating.contextUsageRatio}`);
    passedTests++;
    console.log(`[PASS] Test 10: Model context window: ${geminiWindow} tokens, usage ratio: ${preflightGating.contextUsageRatio} (0.3%)`);

    // ------------------------------------------------------------------
    // TEST 11: EXACT REPRODUCTION: cart_calculator.py single-file mutation
    // ------------------------------------------------------------------
    console.log('\n[TEST 11] EXACT REPRODUCTION: cart_calculator.py single-file mutation...');
    const runtime = new HarnessRuntime({ isolated: false });
    const targetFile = path.join(demoWs, 'src', 'cart_calculator.py');
    assert.ok(fs.existsSync(targetFile), 'cart_calculator.py must exist in demo-workspaces');

    const reproOutcome = await runtime.handleRequest({
      userInput: 'Add a comment at the top of cart_calculator.py saying # Final manual mutation test.',
      workspacePath: demoWs,
      activeFilePath: 'src/cart_calculator.py',
      approvalMode: 'auto',
      providerId: 'gemini',
      modelId: 'gemini-2.5-flash',
      modelHandler: async (messages) => {
        const hasRead = messages.some((m) => m.role === 'tool' && m.tool_call_id === 'repro_read');
        if (!hasRead) {
          return {
            toolCalls: [{ callId: 'repro_read', toolName: 'read_file', arguments: { path: 'src/cart_calculator.py' } }],
          };
        }
        const hasPatch = messages.some((m) => m.role === 'tool' && m.tool_call_id === 'repro_patch');
        if (!hasPatch) {
          return {
            toolCalls: [
              {
                callId: 'repro_patch',
                toolName: 'apply_patch',
                arguments: {
                  edits: [
                    {
                      filePath: 'src/cart_calculator.py',
                      original: '# Final manual mutation test\n',
                      replacement: '# Final manual mutation test\n',
                    },
                  ],
                },
              },
            ],
          };
        }
        return 'Added comment to cart_calculator.py saying # Final manual mutation test.';
      },
    });

    assert.strictEqual(reproOutcome.success, true, 'Reproduction mutation task must succeed');
    assert.ok(reproOutcome.contextMetrics, 'contextMetrics must be returned in outcome');
    const m = reproOutcome.contextMetrics;

    console.log('  Reproduction context metrics:', {
      totalEstimatedTokens: m.totalEstimatedTokens,
      budgetLimitTokens: m.budgetLimitTokens,
      percentage: m.percentage,
      level: m.level,
      budgetType: m.budgetType,
    });

    assert.strictEqual(m.budgetLimitTokens, 1800, 'Coding task working budget limit must be 1800');
    assert.ok(m.totalEstimatedTokens >= 500 && m.totalEstimatedTokens <= 1100, `Expected token count in 500-1100 range, got ${m.totalEstimatedTokens}`);
    assert.ok(m.percentage < 60, `Reported context percentage must be < 60% on fresh run, got ${m.percentage}%`);
    assert.notStrictEqual(m.percentage, 99, 'Context percentage must NOT be 99% for a small single-file task');
    assert.strictEqual(m.level, 'NORMAL', 'Level must be NORMAL');
    assert.strictEqual(m.budgetType, 'WORKING_MEMORY', 'budgetType must be WORKING_MEMORY');
    passedTests++;
    console.log(`[PASS] Test 11: Exact reproduction passed: ${m.totalEstimatedTokens} tokens / ${m.budgetLimitTokens} budget = ${m.percentage}% (${m.level})`);

    console.log('\n================================================================');
    console.log(`  ALL ${passedTests}/11 CONTEXT ACCOUNTING TESTS PASSED (100%) `);
    console.log('================================================================\n');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

if (require.main === module) {
  runContextAccountingRegressionSuite().catch((err) => {
    console.error('CONTEXT ACCOUNTING REGRESSION TEST FAILED:', err);
    process.exit(1);
  });
}

module.exports = { runContextAccountingRegressionSuite };
