/**
 * NEXUS MUTATION INTENT CLASSIFICATION & SAFETY GATING REGRESSION SUITE
 * 
 * Verifies that explicit file-edit and mutation requests are accurately classified as MUTATION,
 * while read-only analysis and inspection requests remain safely gated as READ_ONLY.
 * 
 * Covers:
 * 1. "Add a comment to file" -> MUTATION
 * 2. "Fix bug in file" -> MUTATION
 * 3. "Edit function" -> MUTATION
 * 4. "Remove code" -> MUTATION
 * 5. "Refactor function" -> MUTATION
 * 6. "Explain file" -> READ_ONLY
 * 7. "Find implementation" -> READ_ONLY
 * 8. "Analyze architecture" -> READ_ONLY
 * 9. Explicit mutation cannot be downgraded to READ_ONLY by downstream logic
 * 10. READ_ONLY cannot invoke mutation tools (apply_patch blocked)
 * 11. EXACT LIVE REPRODUCTION:
 *     "Add a comment at the top of cart_calculator.py saying # Final sentinel UI test."
 *     - intent = MUTATION
 *     - mutation authorization succeeds
 *     - existing safety/approval controls apply
 *     - file mutation can proceed (tested in disposable workspace)
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  requestRouter,
  ROUTER_MODES,
  CODING_INTENTS,
} = require('./harness/RequestRouter');

const { HarnessRuntime } = require('./harness/HarnessRuntime');
const { AgentLoop } = require('./harness/AgentLoop');
const { agentManager, classifyTaskIntent } = require('./agentManager');

let passedTests = 0;
let totalTests = 0;

async function runTest(name, fn) {
  totalTests++;
  process.stdout.write(`[TEST ${String(totalTests).padStart(2, '0')}] ${name} ... `);
  try {
    await fn();
    passedTests++;
    console.log('PASS');
  } catch (err) {
    console.log('FAIL');
    console.error(`  Error: ${err.message}`);
    if (err.stack) {
      console.error(err.stack);
    }
  }
}

async function runAll() {
  console.log('================================================================');
  console.log('  NEXUS MUTATION INTENT CLASSIFICATION REGRESSION SUITE         ');
  console.log('================================================================\n');

  // Test 1: "Add a comment to file" -> MUTATION
  await runTest('Test 01: "Add a comment to file" classifies as MUTATION', async () => {
    const res = requestRouter.classify('Add a comment to cart_calculator.py', {
      activeFilePath: 'cart_calculator.py',
    });
    assert.strictEqual(res.mode, ROUTER_MODES.CODING_TASK);
    assert.strictEqual(res.codingIntent, CODING_INTENTS.MUTATION);
    assert.strictEqual(classifyTaskIntent('Add a comment to cart_calculator.py'), 'MUTATION');
  });

  // Test 2: "Fix bug in file" -> MUTATION
  await runTest('Test 02: "Fix bug in file" classifies as MUTATION', async () => {
    const res = requestRouter.classify('Fix the bug in src/auth.js', {
      activeFilePath: 'src/auth.js',
    });
    assert.strictEqual(res.mode, ROUTER_MODES.CODING_TASK);
    assert.strictEqual(res.codingIntent, CODING_INTENTS.MUTATION);
    assert.strictEqual(classifyTaskIntent('Fix the bug in src/auth.js'), 'MUTATION');
  });

  // Test 3: "Edit function" -> MUTATION
  await runTest('Test 03: "Edit function" classifies as MUTATION', async () => {
    const res = requestRouter.classify('Edit function calculate_total', {
      activeFilePath: 'cart_calculator.py',
    });
    assert.strictEqual(res.mode, ROUTER_MODES.CODING_TASK);
    assert.strictEqual(res.codingIntent, CODING_INTENTS.MUTATION);
    assert.strictEqual(classifyTaskIntent('Edit function calculate_total'), 'MUTATION');
  });

  // Test 4: "Remove code" -> MUTATION
  await runTest('Test 04: "Remove code" classifies as MUTATION', async () => {
    const res = requestRouter.classify('Remove code on line 25', {
      activeFilePath: 'cart_calculator.py',
    });
    assert.strictEqual(res.mode, ROUTER_MODES.CODING_TASK);
    assert.strictEqual(res.codingIntent, CODING_INTENTS.MUTATION);
    assert.strictEqual(classifyTaskIntent('Remove code on line 25'), 'MUTATION');
  });

  // Test 5: "Refactor function" -> MUTATION
  await runTest('Test 05: "Refactor function" classifies as MUTATION', async () => {
    const res = requestRouter.classify('Refactor this function', {
      activeFilePath: 'cart_calculator.py',
    });
    assert.strictEqual(res.mode, ROUTER_MODES.CODING_TASK);
    assert.strictEqual(res.codingIntent, CODING_INTENTS.MUTATION);
    assert.strictEqual(classifyTaskIntent('Refactor this function', { activeFilePath: 'cart_calculator.py' }), 'MUTATION');
  });

  // Test 6: "Explain file" -> READ_ONLY
  await runTest('Test 06: "Explain file" classifies as READ_ONLY', async () => {
    const res = requestRouter.classify('Explain file', {
      activeFilePath: 'cart_calculator.py',
    });
    assert.strictEqual(res.mode, ROUTER_MODES.CODING_TASK);
    assert.strictEqual(res.codingIntent, CODING_INTENTS.READ_ONLY);
    assert.strictEqual(classifyTaskIntent('Explain file', { activeFilePath: 'cart_calculator.py' }), 'READ_ONLY');

    const res2 = requestRouter.classify('Explain what cart_calculator.py does');
    assert.strictEqual(res2.mode, ROUTER_MODES.CODING_TASK);
    assert.strictEqual(res2.codingIntent, CODING_INTENTS.READ_ONLY);
  });

  // Test 7: "Find implementation" -> READ_ONLY
  await runTest('Test 07: "Find implementation" classifies as READ_ONLY', async () => {
    const res = requestRouter.classify('Find implementation of discount calculator', {
      activeFilePath: 'cart_calculator.py',
    });
    assert.strictEqual(res.mode, ROUTER_MODES.CODING_TASK);
    assert.strictEqual(res.codingIntent, CODING_INTENTS.READ_ONLY);
    assert.strictEqual(classifyTaskIntent('Find implementation of discount calculator'), 'READ_ONLY');

    const res2 = requestRouter.classify('Find where authentication is implemented');
    assert.strictEqual(res2.mode, ROUTER_MODES.CODING_TASK);
    assert.strictEqual(res2.codingIntent, CODING_INTENTS.READ_ONLY);
  });

  // Test 8: "Analyze architecture" -> READ_ONLY
  await runTest('Test 08: "Analyze architecture" classifies as READ_ONLY', async () => {
    const res = requestRouter.classify('Analyze the architecture');
    assert.strictEqual(res.mode, ROUTER_MODES.CODING_TASK);
    assert.strictEqual(res.codingIntent, CODING_INTENTS.READ_ONLY);
    assert.strictEqual(classifyTaskIntent('Analyze the architecture'), 'READ_ONLY');
  });

  // Test 9: Explicit mutation cannot be downgraded to READ_ONLY downstream
  await runTest('Test 09: Explicit mutation cannot be downgraded to READ_ONLY downstream', async () => {
    const runtime = new HarnessRuntime();
    const prompt = 'Add a comment to cart_calculator.py';
    const classification = runtime.classifyRequest(prompt, { activeFilePath: 'cart_calculator.py' });
    assert.strictEqual(classification.codingIntent, CODING_INTENTS.MUTATION);

    let observedIntent = null;
    let availableTools = [];

    await runtime.handleRequest({
      userInput: prompt,
      workspacePath: path.resolve('demo-workspaces/ai_cart_project'),
      activeFilePath: 'src/cart_calculator.py',
      modelHandler: async (messages, tools) => {
        availableTools = tools ? tools.map(t => t.name) : [];
        return 'Done analyzing and editing';
      },
    });

    assert.ok(availableTools.includes('apply_patch'), 'apply_patch must be included when intent is MUTATION');
  });

  // Test 10: READ_ONLY cannot invoke mutation tools (apply_patch strictly blocked)
  await runTest('Test 10: READ_ONLY cannot invoke mutation tools (apply_patch blocked)', async () => {
    const runtime = new HarnessRuntime();
    const prompt = 'Explain what cart_calculator.py does';
    const classification = runtime.classifyRequest(prompt, { activeFilePath: 'cart_calculator.py' });
    assert.strictEqual(classification.codingIntent, CODING_INTENTS.READ_ONLY);

    let patchBlockedError = null;

    const res = await runtime.handleRequest({
      userInput: prompt,
      workspacePath: path.resolve('demo-workspaces/ai_cart_project'),
      activeFilePath: 'src/cart_calculator.py',
      modelHandler: async (messages, tools) => {
        const hasToolResult = messages.some(m => m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string' && m.content.includes('TOOL_RESULT')));
        if (!hasToolResult) {
          // Model attempts to call apply_patch in READ_ONLY turn
          return {
            toolCalls: [{
              callId: 'call_illegal_patch',
              toolName: 'apply_patch',
              arguments: {
                filePath: 'src/cart_calculator.py',
                patch: '--- a/src/cart_calculator.py\n+++ b/src/cart_calculator.py\n@@ -1,1 +1,2 @@\n+# illegal\n',
              },
            }],
          };
        }
        const toolMsg = messages.find(m => m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string' && m.content.includes('TOOL_RESULT')));
        patchBlockedError = toolMsg?.content?.error || (typeof toolMsg?.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg?.content));
        return 'Acknowledged read-only restriction';
      },
    });

    assert.strictEqual(res.success, true);
    assert.ok(patchBlockedError.includes('apply_patch') && patchBlockedError.includes('READ_ONLY'), 'READ_ONLY must block apply_patch with strict error');
  });

  // Test 11: EXACT LIVE REPRODUCTION CASE in disposable workspace
  await runTest('Test 11: EXACT LIVE REPRODUCTION: "Add a comment at the top of cart_calculator.py saying # Final sentinel UI test."', async () => {
    const exactPrompt = 'Add a comment at the top of cart_calculator.py saying # Final sentinel UI test.';

    // 1. Classification check
    const classification = requestRouter.classify(exactPrompt, {
      workspacePath: '/Users/umangmalhotra/Documents/Nexus/demo-workspaces/ai_cart_project',
      activeFilePath: 'demo-workspaces/ai_cart_project/src/cart_calculator.py',
    });

    assert.strictEqual(classification.mode, ROUTER_MODES.CODING_TASK);
    assert.strictEqual(classification.codingIntent, CODING_INTENTS.MUTATION);

    // 2. Set up disposable workspace
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sentinel-test-'));
    const tmpFile = path.join(tmpDir, 'cart_calculator.py');
    fs.writeFileSync(tmpFile, 'def calculate_cart_total(items):\n    return sum(items)\n', 'utf8');

    const runtime = new HarnessRuntime();
    let patchApplied = false;

    const res = await runtime.handleRequest({
      userInput: exactPrompt,
      workspacePath: tmpDir,
      activeFilePath: 'cart_calculator.py',
      approvalMode: 'auto',
      modelHandler: async (messages, tools) => {
        const hasToolResult = messages.some(m => m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string' && m.content.includes('TOOL_RESULT')));
        if (!hasToolResult) {
          assert.ok(tools.some(t => t.name === 'apply_patch'), 'apply_patch must be provided to model');
          return {
            toolCalls: [{
              callId: 'call_patch_1',
              toolName: 'apply_patch',
              arguments: {
                edits: [{
                  filePath: 'cart_calculator.py',
                  original: 'def calculate_cart_total',
                  replacement: '# Final sentinel UI test.\ndef calculate_cart_total',
                }],
              },
            }],
          };
        }
        patchApplied = true;
        return 'Added the comment "# Final sentinel UI test." at the top of cart_calculator.py successfully.';
      },
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.turn?.metadata?.outcome, 'SUCCESS');
    assert.strictEqual(patchApplied, true);

    const updatedContent = fs.readFileSync(tmpFile, 'utf8');
    assert.ok(updatedContent.includes('# Final sentinel UI test.'), 'File must contain the added comment');

    // Clean up disposable workspace
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Additional test: explicit negative directive forces READ_ONLY even with mutation words
  await runTest('Test 12: Negative directive forces READ_ONLY even with mutation verbs', async () => {
    const res = requestRouter.classify('Add a comment to cart_calculator.py, but keep it read-only and do not modify', {
      activeFilePath: 'cart_calculator.py',
    });
    assert.strictEqual(res.codingIntent, CODING_INTENTS.READ_ONLY);
  });

  console.log('\n================================================================');
  console.log(`  MUTATION INTENT CLASSIFICATION: ${passedTests}/${totalTests} PASS (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log('================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runAll().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
