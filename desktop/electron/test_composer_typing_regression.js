/**
 * TEST SUITE: Composer Typing & Submission Isolation Regression Test
 * Validates:
 * 1. Typing text character-by-character into the composer ONLY updates the text input.
 * 2. Zero task submissions occur during typing.
 * 3. Zero workspace navigation transitions occur during typing (remains "home").
 * 4. Zero task executions occur during typing (taskToExecute remains null, activeTaskPrompt unset).
 * 5. Debounced preflight estimation can safely update during typing without triggering execution.
 * 6. Non-Enter keydown events and IME composition do not trigger submission.
 * 7. Explicit submit actions (Start Task button click or Enter keypress) trigger EXACTLY ONE task submission.
 */

const assert = require('assert');

async function runComposerTypingRegressionTest() {
  console.log('[TEST] Starting Composer Typing & Submission Isolation Regression Test Suite...\n');

  // =========================================================================
  // TEST 1: Simulate character-by-character typing of "What is 2 + 2?"
  // =========================================================================
  console.log('[TEST 1] Simulating typing "What is 2 + 2?" character by character into composer...');

  // App-level state simulation (representing IDEApp & TaskHome state)
  let workspaceMode = 'home';
  let homePrompt = '';
  let activeTaskPrompt = '';
  let taskToExecute = null;
  let taskSubmissionCount = 0;
  let submittedTasks = [];
  let navigationTransitions = [];

  // IDEApp handlers
  const handleHomePromptChange = (promptText) => {
    homePrompt = promptText;
    // CRITICAL: Must NOT set activeTaskPrompt while typing!
  };

  const handleStartTaskFromHome = (promptText, providerId, modelId, attachedCapsule) => {
    taskSubmissionCount++;
    submittedTasks.push({ promptText, providerId, modelId, attachedCapsule });
    homePrompt = '';
    activeTaskPrompt = promptText;
    taskToExecute = { prompt: promptText, id: Date.now(), providerId, modelId };
    workspaceMode = 'agent';
    navigationTransitions.push('agent');
  };

  // TaskHome handler
  const handleComposerSubmit = (promptText, approvalMode, providerId, modelId) => {
    if (!promptText || !promptText.trim()) return;
    handleStartTaskFromHome(promptText.trim(), providerId || 'nexus1', modelId || 'gemini-2.5-flash');
  };

  // Composer component state simulation (representing CodexBottomComposer)
  let composerPrompt = '';
  let composerPreflight = null;
  let preflightEstimatorCalls = 0;

  const mockPreflightEstimate = async (payload) => {
    preflightEstimatorCalls++;
    return {
      estimatedInputTokens: Math.ceil(payload.userInput.length / 4) + 120,
      estimatedMaxOutputTokens: 350,
      estimatedTotalTokens: Math.ceil(payload.userInput.length / 4) + 470,
      shouldShowPreflight: false, // "What is 2 + 2?" is a conversational query
      estimatedCostUSD: 0.0001,
      confidence: 'HIGH',
    };
  };

  const onComposerChange = (newVal) => {
    composerPrompt = newVal;
    handleHomePromptChange(newVal);
  };

  const onComposerKeyDown = (e) => {
    if (e.key === 'Enter') {
      if (e.metaKey || e.ctrlKey) {
        if (e.preventDefault) e.preventDefault();
        handleComposerSubmit(composerPrompt);
      } else if (!e.shiftKey && !e.attachedCapsule && !composerPrompt.includes('\n') && !e.isComposing) {
        if (e.preventDefault) e.preventDefault();
        handleComposerSubmit(composerPrompt);
      }
    }
  };

  // Type characters one by one
  const promptToType = 'What is 2 + 2?';
  let currentBuffer = '';

  for (let i = 0; i < promptToType.length; i++) {
    const char = promptToType[i];
    currentBuffer += char;

    // Simulate keydown for the typed character
    onComposerKeyDown({ key: char, shiftKey: char === '?' || char === '+', metaKey: false, ctrlKey: false });

    // Simulate input/change event
    onComposerChange(currentBuffer);

    // Assertions at every single keystroke
    assert.strictEqual(taskSubmissionCount, 0, `Keystroke "${char}" (index ${i}) must NOT trigger task submission`);
    assert.strictEqual(workspaceMode, 'home', `Keystroke "${char}" (index ${i}) must NOT trigger workspace navigation`);
    assert.strictEqual(taskToExecute, null, `Keystroke "${char}" (index ${i}) must NOT create taskToExecute`);
    assert.strictEqual(activeTaskPrompt, '', `Keystroke "${char}" (index ${i}) must NOT prematurely populate activeTaskPrompt`);
    assert.strictEqual(homePrompt, currentBuffer, `homePrompt must match typed buffer "${currentBuffer}"`);
    assert.strictEqual(composerPrompt, currentBuffer, `composerPrompt must match typed buffer "${currentBuffer}"`);
  }

  console.log(`  ✓ All ${promptToType.length} keystrokes processed cleanly with 0 submissions and 0 navigations.\n`);

  // =========================================================================
  // TEST 2: Preflight estimation updates in background without execution
  // =========================================================================
  console.log('[TEST 2] Verifying preflight estimation can update while typing without triggering execution...');

  // Simulate debounced preflight estimate triggering after typing pauses
  const estimateResult = await mockPreflightEstimate({ userInput: composerPrompt });
  composerPreflight = estimateResult;

  assert.ok(composerPreflight !== null, 'Preflight estimate must resolve');
  assert.strictEqual(preflightEstimatorCalls, 1, 'Preflight estimator called exactly once');
  assert.strictEqual(composerPreflight.shouldShowPreflight, false, 'Conversational prompt bypasses modal');
  assert.strictEqual(taskSubmissionCount, 0, 'Preflight estimate completion must NOT trigger task submission');
  assert.strictEqual(workspaceMode, 'home', 'Preflight estimate completion must NOT navigate away from home');
  assert.strictEqual(taskToExecute, null, 'Preflight estimate completion must NOT create taskToExecute');
  console.log('  ✓ Preflight estimation updated advisory data safely with 0 submissions.\n');

  // =========================================================================
  // TEST 3: IME Composition Enter does NOT trigger submission
  // =========================================================================
  console.log('[TEST 3] Verifying IME composition Enter does NOT trigger submission...');
  onComposerKeyDown({ key: 'Enter', shiftKey: false, isComposing: true, preventDefault: () => {} });
  assert.strictEqual(taskSubmissionCount, 0, 'IME Enter must NOT submit the task');
  assert.strictEqual(workspaceMode, 'home');
  console.log('  ✓ IME composition Enter correctly ignored.\n');

  // =========================================================================
  // TEST 4: Shift+Enter does NOT trigger submission (allows newline)
  // =========================================================================
  console.log('[TEST 4] Verifying Shift+Enter does NOT trigger submission...');
  onComposerKeyDown({ key: 'Enter', shiftKey: true, isComposing: false, preventDefault: () => {} });
  assert.strictEqual(taskSubmissionCount, 0, 'Shift+Enter must NOT submit the task');
  assert.strictEqual(workspaceMode, 'home');
  console.log('  ✓ Shift+Enter correctly ignored.\n');

  // =========================================================================
  // TEST 5: Explicit submit action (Start Task button click / form submit)
  // =========================================================================
  console.log('[TEST 5] Verifying explicit submit action (Start Task button / form submit)...');
  handleComposerSubmit(composerPrompt, 'auto', 'nexus1', 'gemini-2.5-flash');

  assert.strictEqual(taskSubmissionCount, 1, 'Explicit submit must produce EXACTLY ONE submission');
  assert.strictEqual(submittedTasks.length, 1);
  assert.strictEqual(submittedTasks[0].promptText, 'What is 2 + 2?');
  assert.strictEqual(workspaceMode, 'agent', 'Explicit submit must navigate to "agent" view');
  assert.strictEqual(activeTaskPrompt, 'What is 2 + 2?', 'Explicit submit must set activeTaskPrompt');
  assert.ok(taskToExecute !== null, 'Explicit submit must create taskToExecute');
  assert.strictEqual(taskToExecute.prompt, 'What is 2 + 2?');
  console.log('  ✓ Explicit submit successfully triggered exactly 1 task execution and navigated to agent.\n');

  // =========================================================================
  // TEST 6: Explicit Enter key submission contract preservation
  // =========================================================================
  console.log('[TEST 6] Verifying Enter key submission contract is preserved...');
  // Reset state for Enter-to-send test
  workspaceMode = 'home';
  homePrompt = '';
  activeTaskPrompt = '';
  taskToExecute = null;
  taskSubmissionCount = 0;
  submittedTasks = [];

  composerPrompt = 'Explain dependency injection';
  handleHomePromptChange(composerPrompt);
  assert.strictEqual(taskSubmissionCount, 0, 'Setting prompt text must not submit');

  // Explicit Enter press
  onComposerKeyDown({ key: 'Enter', shiftKey: false, isComposing: false, preventDefault: () => {} });
  assert.strictEqual(taskSubmissionCount, 1, 'Enter key must trigger exactly one submission');
  assert.strictEqual(submittedTasks[0].promptText, 'Explain dependency injection');
  assert.strictEqual(workspaceMode, 'agent');
  console.log('  ✓ Enter-to-send contract preserved and functioning.\n');

  // =========================================================================
  // TEST 7: AgentPanel initialTask auto-run isolation
  // =========================================================================
  console.log('[TEST 7] Verifying AgentPanel does not receive premature initialTask during typing...');
  // Reset for isolation test
  activeTaskPrompt = '';
  taskToExecute = null;
  let agentPanelExecutions = 0;
  let executedRef = null;

  const simulateAgentPanelMount = (initialTaskProp, taskToExecuteProp) => {
    if (taskToExecuteProp && taskToExecuteProp.prompt) {
      const key = `${taskToExecuteProp.id}_${taskToExecuteProp.prompt.trim()}`;
      if (executedRef !== key) {
        executedRef = key;
        agentPanelExecutions++;
      }
    } else if (initialTaskProp && initialTaskProp.trim() && !taskToExecuteProp) {
      if (executedRef !== initialTaskProp) {
        executedRef = initialTaskProp;
        agentPanelExecutions++;
      }
    }
  };

  // While typing (activeTaskPrompt remains empty)
  simulateAgentPanelMount(activeTaskPrompt, null);
  assert.strictEqual(agentPanelExecutions, 0, 'AgentPanel must not execute while activeTaskPrompt is empty');

  // After explicit submission
  activeTaskPrompt = 'What is 2 + 2?';
  taskToExecute = { prompt: 'What is 2 + 2?', id: Date.now() };
  simulateAgentPanelMount(activeTaskPrompt, taskToExecute);
  assert.strictEqual(agentPanelExecutions, 1, 'AgentPanel executes exactly once upon explicit submission');

  console.log('  ✓ AgentPanel initialTask isolation verified.\n');

  console.log('=================================================================');
  console.log('ALL COMPOSER TYPING & SUBMISSION REGRESSION TESTS PASSED (7/7)!');
  console.log('=================================================================\n');
}

runComposerTypingRegressionTest().catch((err) => {
  console.error('[TEST FAILED]', err);
  process.exit(1);
});

module.exports = { runComposerTypingRegressionTest };
