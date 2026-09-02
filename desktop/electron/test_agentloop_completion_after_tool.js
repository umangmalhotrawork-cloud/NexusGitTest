/**
 * NEXUS CODEX HARNESS - AGENTLOOP COMPLETION AFTER TOOL CALL REGRESSION SUITE
 * 
 * Verifies that AgentLoop properly completes tasks after tool executions:
 * 1. Model requests valid tool (read_file directly on root-level file)
 * 2. Model requests valid tool (read_file directly on nested file)
 * 3. Model requests valid tool with currently active editor file context
 * 4. Multi-step workflow: search_workspace followed by read_file, then final answer
 * 5. Verifies tool results appear in the model's subsequent context in proper wire format
 * 6. Repeated/duplicate tool calls are detected and prevented from spinning forever
 * 7. Exact reproduction for demo-workspaces/ai_cart_project/src/cart_calculator.py
 *    with prompt "Explain what cart_calculator.py does." completes in <= 2 iterations.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { HarnessRuntime } = require('./harness/HarnessRuntime');
const { TURN_STATUS } = require('./harness/types');
const { modelAdapter } = require('./harness/ModelAdapter');

async function runRegressionSuite() {
  console.log('================================================================');
  console.log('  AGENTLOOP COMPLETION & TOOL CALL RECOVERY REGRESSION SUITE    ');
  console.log('================================================================\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus_agentloop_test_'));
  fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test Project\nRoot readme file.');
  fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'src', 'calculator.ts'), 'export function add(a: number, b: number) { return a + b; }');
  fs.mkdirSync(path.join(tempDir, 'packages', 'core', 'utils'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'packages', 'core', 'utils', 'string.ts'), 'export const trim = (s: string) => s.trim();');

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`[PASS] Test ${String(total).padStart(2, '0')}: ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] Test ${String(total).padStart(2, '0')}: ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  // 1. read_file directly on root-level file
  await test('read_file directly on root-level file completes cleanly in 2 iterations', async () => {
    const runtime = new HarnessRuntime();
    let turnCount = 0;

    const outcome = await runtime.handleRequest({
      userInput: 'Explain README.md',
      workspacePath: tempDir,
      modelHandler: async (messages) => {
        turnCount++;
        const hasToolResult = messages.some((m) => m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string' && m.content.includes('Test Project')));
        if (hasToolResult) {
          return 'README.md explains that this is a test project with root readme documentation.';
        }
        return {
          toolCalls: [
            {
              toolName: 'read_file',
              arguments: { path: 'README.md' },
            },
          ],
        };
      },
    });

    assert.strictEqual(outcome.success, true);
    assert.strictEqual(outcome.status, TURN_STATUS.COMPLETED);
    assert.strictEqual(outcome.iterations, 2);
    assert.strictEqual(outcome.totalToolCalls, 1);
    assert(outcome.finalResponse.includes('README.md explains'));
  });

  // 2. read_file directly on nested file
  await test('read_file directly on nested file completes cleanly in 2 iterations', async () => {
    const runtime = new HarnessRuntime();

    const outcome = await runtime.handleRequest({
      userInput: 'What does calculator.ts do?',
      workspacePath: tempDir,
      modelHandler: async (messages) => {
        const hasToolResult = messages.some((m) => m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string' && m.content.includes('add(a: number')));
        if (hasToolResult) {
          return 'calculator.ts exports an add function that adds two numbers.';
        }
        return {
          toolCalls: [
            {
              toolName: 'read_file',
              arguments: { path: 'src/calculator.ts' },
            },
          ],
        };
      },
    });

    assert.strictEqual(outcome.success, true);
    assert.strictEqual(outcome.status, TURN_STATUS.COMPLETED);
    assert.strictEqual(outcome.iterations, 2);
    assert.strictEqual(outcome.totalToolCalls, 1);
    assert(outcome.finalResponse.includes('exports an add function'));
  });

  // 3. currently active editor file context
  await test('currently active editor file correlates and completes cleanly in 2 iterations', async () => {
    const runtime = new HarnessRuntime();
    const activeFile = 'packages/core/utils/string.ts';

    const outcome = await runtime.handleRequest({
      userInput: 'Explain active file string.ts',
      workspacePath: tempDir,
      activeFilePath: activeFile,
      modelHandler: async (messages) => {
        const hasToolResult = messages.some((m) => m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string' && m.content.includes('trim')));
        if (hasToolResult) {
          return 'The active file exports a trim utility function.';
        }
        return {
          toolCalls: [
            {
              toolName: 'read_file',
              arguments: { path: activeFile },
            },
          ],
        };
      },
    });

    assert.strictEqual(outcome.success, true);
    assert.strictEqual(outcome.status, TURN_STATUS.COMPLETED);
    assert.strictEqual(outcome.iterations, 2);
    assert(outcome.finalResponse.includes('trim utility function'));
  });

  // 4. search_workspace followed by read_file, then final answer
  await test('search_workspace followed by read_file completes cleanly in 3 iterations', async () => {
    const runtime = new HarnessRuntime();
    let step = 0;

    const outcome = await runtime.handleRequest({
      userInput: 'Find and explain string.ts',
      workspacePath: tempDir,
      modelHandler: async (messages) => {
        step++;
        if (step === 1) {
          return {
            toolCalls: [
              {
                toolName: 'search_workspace',
                arguments: { query: 'string.ts' },
              },
            ],
          };
        }
        if (step === 2) {
          return {
            toolCalls: [
              {
                toolName: 'read_file',
                arguments: { path: 'packages/core/utils/string.ts' },
              },
            ],
          };
        }
        return 'Found string.ts which exports a string trimming function.';
      },
    });

    assert.strictEqual(outcome.success, true);
    assert.strictEqual(outcome.status, TURN_STATUS.COMPLETED);
    assert.strictEqual(outcome.iterations, 3);
    assert.strictEqual(outcome.totalToolCalls, 2);
    assert(outcome.finalResponse.includes('Found string.ts'));
  });

  // 5. Tool results appear in model context in proper wire format (native tool_calls & role: tool)
  await test('tool results appear in subsequent model context in canonical OpenAI/Gemini wire format', async () => {
    const runtime = new HarnessRuntime();
    let receivedMessagesOnTurn2 = null;

    await runtime.handleRequest({
      userInput: 'Check calculator.ts',
      workspacePath: tempDir,
      modelHandler: async (messages) => {
        const hasTool = messages.some((m) => m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string' && m.content.includes('[TOOL_RESULT')));
        if (hasTool) {
          receivedMessagesOnTurn2 = messages;
          return 'Checked calculator successfully.';
        }
        return {
          toolCalls: [
            {
              callId: 'call_test_calc_1',
              toolName: 'read_file',
              arguments: { path: 'src/calculator.ts' },
            },
          ],
        };
      },
    });

    assert.ok(receivedMessagesOnTurn2, 'Model must receive messages on turn 2');

    // Verify formatConversationMessages emits OpenAI-compliant structure
    const tools = [{ name: 'read_file', description: 'Reads a file' }];
    const wireMessages = modelAdapter.formatConversationMessages(receivedMessagesOnTurn2, tools);

    // 1. Must have assistant message with tool_calls
    const assistantMsg = wireMessages.find((m) => m.role === 'assistant' && Array.isArray(m.tool_calls));
    assert.ok(assistantMsg, 'wireMessages must include assistant message with tool_calls');
    assert.strictEqual(assistantMsg.tool_calls[0].function.name, 'read_file');

    // 2. Must have tool message with role: 'tool' and matching tool_call_id
    const toolMsg = wireMessages.find((m) => m.role === 'tool');
    assert.ok(toolMsg, 'wireMessages must include role: "tool" message');
    assert.strictEqual(toolMsg.tool_call_id, 'call_test_calc_1');
    assert(toolMsg.content.includes('calculator.ts'));
  });

  // 6. Repeated / duplicate tool calls are detected and prevented from spinning forever
  await test('duplicate read-only tool calls are prevented from spinning forever', async () => {
    const runtime = new HarnessRuntime();
    let handlerCallCount = 0;

    // Simulate a buggy model that keeps requesting read_file for the exact same file repeatedly
    const outcome = await runtime.handleRequest({
      userInput: 'Explain calculator.ts',
      workspacePath: tempDir,
      modelHandler: async () => {
        handlerCallCount++;
        return {
          toolCalls: [
            {
              toolName: 'read_file',
              arguments: { path: 'src/calculator.ts' },
            },
          ],
        };
      },
    });

    // Must NOT exhaust all 10 iterations!
    assert(outcome.iterations < 10, `Iterations was ${outcome.iterations}, must be less than max (10)`);
    assert.strictEqual(outcome.status, TURN_STATUS.COMPLETED);
    assert.strictEqual(outcome.success, true);
    assert(outcome.finalResponse.length > 0);
  });

  // 7. Exact reproduction for demo-workspaces/ai_cart_project/src/cart_calculator.py
  await test('Exact reproduction for demo-workspaces/ai_cart_project/src/cart_calculator.py', async () => {
    const projectRoot = path.resolve(__dirname, '..', '..');
    const demoWs = path.join(projectRoot, 'demo-workspaces', 'ai_cart_project');
    const editorFile = 'demo-workspaces/ai_cart_project/src/cart_calculator.py';

    if (!fs.existsSync(demoWs)) {
      console.log('  [SKIP] demo-workspaces not on disk');
      return;
    }

    const runtime = new HarnessRuntime();

    // Emulate a standard Gemini 2.5 Flash model turn:
    // Turn 1: reads active editor file
    // Turn 2: receives file content in role: 'tool' and synthesizes explanation
    const outcome = await runtime.handleRequest({
      userInput: 'Explain what cart_calculator.py does.',
      workspacePath: demoWs,
      activeFilePath: editorFile,
      modelHandler: async (messages) => {
        const hasTool = messages.some((m) => m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string' && m.content.includes('calculate_cart_total')));
        if (hasTool) {
          return 'The cart_calculator.py module calculates shopping cart totals, applying promotional discounts and sales taxes.';
        }
        return {
          toolCalls: [
            {
              callId: 'call_gemini_read_cart',
              toolName: 'read_file',
              arguments: { path: editorFile },
            },
          ],
        };
      },
    });

    assert.strictEqual(outcome.success, true);
    assert.strictEqual(outcome.status, TURN_STATUS.COMPLETED);
    assert.strictEqual(outcome.iterations, 2);
    assert.strictEqual(outcome.totalToolCalls, 1);
    assert(outcome.finalResponse.includes('calculates shopping cart totals'));
  });

  // Cleanup temp dir
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (_) {}

  console.log('\n================================================================');
  console.log(`  REGRESSION SUITE RESULTS: ${passed}/${total} PASS (${Math.round((passed / total) * 100)}%)`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runRegressionSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
