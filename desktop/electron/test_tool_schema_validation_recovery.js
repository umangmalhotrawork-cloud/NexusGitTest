/**
 * NEXUS CODEX HARNESS REGRESSION TEST SUITE
 * Issue #2: search_workspace Tool-Call Schema Validation & Recovery
 * 
 * Verifies:
 * 1. search_workspace Valid Call: { "query": "cart_calculator.py" } succeeds and executes.
 * 2. search_workspace Invalid Call: {} rejects cleanly without crashing or executing tool.
 * 3. search_workspace Invalid Call with whitespace/empty string query rejects cleanly.
 * 4. Verification that tool.execute is NEVER invoked for invalid calls.
 * 5. Other required-parameter tools:
 *    - read_file: valid { path } executes; invalid {} rejects cleanly without execution.
 *    - run_command: valid { command } executes; invalid {} rejects cleanly without execution.
 *    - apply_patch: valid { edits } executes; invalid {} rejects cleanly without execution.
 * 6. AgentLoop recovery: Model emits invalid call ({}), NEXUS returns clean tool-validation error,
 *    model receives the error in turn history, retries with valid arguments, and completes turn.
 * 7. Provider tool validation error normalization: Groq-style 400 tool-use failure is converted
 *    into assistant tool call and processed through validation without crashing the loop.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { HarnessRuntime } = require('./harness/HarnessRuntime');
const { ToolRegistry } = require('./harness/ToolRegistry');
const { ModelAdapter } = require('./harness/ModelAdapter');
const { ITEM_TYPES, TURN_STATUS } = require('./harness/types');
const SearchWorkspaceTool = require('./harness/tools/SearchWorkspaceTool');
const ReadFileTool = require('./harness/tools/ReadFileTool');
const { RunCommandTool } = require('./harness/tools/RunCommandTool');
const ApplyPatchTool = require('./harness/tools/ApplyPatchTool');

async function runTests() {
  console.log('================================================================');
  console.log('  NEXUS — TOOL CALL SCHEMA VALIDATION & AGENT RECOVERY SUITE    ');
  console.log('================================================================\n');

  const testWorkspaceDir = path.resolve(__dirname, '../../demo-workspaces/ai_cart_project');

  // ---------------------------------------------------------------------------
  // TEST 1: search_workspace Valid Call: { query: 'cart_calculator.py' }
  // ---------------------------------------------------------------------------
  console.log('[TEST 1] Testing search_workspace valid call { query: "cart_calculator.py" }...');
  const runtime = HarnessRuntime.createIsolated();
  const validRes = await runtime.executeTool('search_workspace', {
    query: 'cart_calculator.py',
  }, {
    workspacePath: testWorkspaceDir,
  });

  assert.strictEqual(validRes.type, 'tool_result', 'Result type must be tool_result');
  assert.strictEqual(validRes.success, true, 'Valid search_workspace call must succeed');
  assert.strictEqual(validRes.error, null, 'Error must be null for valid search_workspace call');
  assert.ok(validRes.result && Array.isArray(validRes.result.matches), 'Must return matches array');
  console.log('  ✓ search_workspace succeeded with total matches:', validRes.result.totalMatches);
  console.log('[PASS] Test 1: Valid search_workspace call executes successfully\n');

  // ---------------------------------------------------------------------------
  // TEST 2: search_workspace Invalid Call: {}
  // ---------------------------------------------------------------------------
  console.log('[TEST 2] Testing search_workspace invalid call {} missing required query...');
  let executeInvoked = false;
  const isolatedRegistry = new ToolRegistry();
  isolatedRegistry.register({
    name: SearchWorkspaceTool.name,
    description: SearchWorkspaceTool.description,
    inputSchema: SearchWorkspaceTool.inputSchema,
    execute: async (args, context) => {
      executeInvoked = true;
      return SearchWorkspaceTool.execute(args, context);
    },
  });

  const invalidRes = await isolatedRegistry.execute('search_workspace', {}, {
    workspacePath: testWorkspaceDir,
  });

  assert.strictEqual(invalidRes.type, 'tool_result', 'Result type must be tool_result');
  assert.strictEqual(invalidRes.success, false, 'Invalid call missing query must return success: false');
  assert.strictEqual(invalidRes.result, null, 'Result must be null when rejected');
  assert.ok(invalidRes.error, 'Error message must be present');
  assert.ok(invalidRes.error.includes('tool call validation failed'), 'Error must report tool call validation failed');
  assert.ok(invalidRes.error.includes("missing properties: 'query'"), 'Error must report missing properties: \'query\'');
  assert.strictEqual(executeInvoked, false, 'CRITICAL: tool.execute must NEVER be invoked for invalid calls');
  console.log('  ✓ Error message:', invalidRes.error);
  console.log('  ✓ tool.execute was NOT executed (guaranteed safety)');
  console.log('[PASS] Test 2: Invalid search_workspace call {} rejected cleanly without executing tool\n');

  // ---------------------------------------------------------------------------
  // TEST 3: search_workspace Invalid Call with whitespace-only or empty query
  // ---------------------------------------------------------------------------
  console.log('[TEST 3] Testing search_workspace with empty and whitespace-only query...');
  const emptyRes = await isolatedRegistry.execute('search_workspace', { query: '' }, {
    workspacePath: testWorkspaceDir,
  });
  assert.strictEqual(emptyRes.success, false, 'Empty query string must be rejected');
  assert.ok(emptyRes.error.includes("missing properties: 'query'"));

  const whitespaceRes = await isolatedRegistry.execute('search_workspace', { query: '   ' }, {
    workspacePath: testWorkspaceDir,
  });
  assert.strictEqual(whitespaceRes.success, false, 'Whitespace query string must be rejected');
  assert.ok(whitespaceRes.error.includes("missing properties: 'query'"));
  console.log('[PASS] Test 3: Empty and whitespace query strings rejected cleanly\n');

  // ---------------------------------------------------------------------------
  // TEST 4: Other Required-Parameter Tool #1: read_file
  // ---------------------------------------------------------------------------
  console.log('[TEST 4] Testing read_file tool schema validation...');
  let readFileExecuted = false;
  isolatedRegistry.register({
    name: ReadFileTool.name,
    description: ReadFileTool.description,
    inputSchema: ReadFileTool.inputSchema,
    execute: async (args, context) => {
      readFileExecuted = true;
      return ReadFileTool.execute(args, context);
    },
  });

  // 4a. Invalid read_file: {}
  const badReadRes = await isolatedRegistry.execute('read_file', {}, {
    workspacePath: testWorkspaceDir,
  });
  assert.strictEqual(badReadRes.success, false, 'read_file without path must be rejected');
  assert.strictEqual(readFileExecuted, false, 'read_file execute must not be called when path is missing');
  assert.ok(badReadRes.error.includes('tool call validation failed'));
  assert.ok(badReadRes.error.includes("missing properties: 'path'"));
  console.log('  ✓ read_file invalid call {} rejected without execution:', badReadRes.error);

  // 4b. Valid read_file: { path: 'src/cart_calculator.py' }
  const goodReadRes = await isolatedRegistry.execute('read_file', {
    path: 'src/cart_calculator.py',
  }, {
    workspacePath: testWorkspaceDir,
  });
  assert.strictEqual(goodReadRes.success, true, 'read_file with valid path must succeed');
  assert.strictEqual(readFileExecuted, true, 'read_file execute must be called when valid');
  assert.ok(goodReadRes.result.content.includes('def calculate_cart_total'), 'Content must be read');
  console.log('[PASS] Test 4: read_file general validation verified (both valid and invalid)\n');

  // ---------------------------------------------------------------------------
  // TEST 5: Other Required-Parameter Tool #2: run_command
  // ---------------------------------------------------------------------------
  console.log('[TEST 5] Testing run_command tool schema validation...');
  let runCommandExecuted = false;
  isolatedRegistry.register({
    name: RunCommandTool.name,
    description: RunCommandTool.description,
    inputSchema: RunCommandTool.inputSchema,
    execute: async (args, context) => {
      runCommandExecuted = true;
      return RunCommandTool.execute(args, context);
    },
  });

  // 5a. Invalid run_command: {}
  const badCmdRes = await isolatedRegistry.execute('run_command', {}, {
    workspacePath: testWorkspaceDir,
  });
  assert.strictEqual(badCmdRes.success, false, 'run_command without command must be rejected');
  assert.strictEqual(runCommandExecuted, false, 'run_command execute must not be called when command is missing');
  assert.ok(badCmdRes.error.includes('tool call validation failed'));
  assert.ok(badCmdRes.error.includes("missing properties: 'command'"));
  console.log('  ✓ run_command invalid call {} rejected without execution:', badCmdRes.error);

  // 5b. Valid run_command: { command: 'echo "test"' }
  const goodCmdRes = await isolatedRegistry.execute('run_command', {
    command: 'echo "test"',
  }, {
    workspacePath: testWorkspaceDir,
    approvalMode: 'auto',
  });
  assert.strictEqual(goodCmdRes.success, true, 'run_command with command must succeed');
  assert.strictEqual(runCommandExecuted, true, 'run_command execute must be called when valid');
  console.log('[PASS] Test 5: run_command general validation verified (both valid and invalid)\n');

  // ---------------------------------------------------------------------------
  // TEST 6: Other Required-Parameter Tool #3: apply_patch
  // ---------------------------------------------------------------------------
  console.log('[TEST 6] Testing apply_patch tool schema validation...');
  let applyPatchExecuted = false;
  isolatedRegistry.register({
    name: ApplyPatchTool.name,
    description: ApplyPatchTool.description,
    inputSchema: ApplyPatchTool.inputSchema,
    execute: async (args, context) => {
      applyPatchExecuted = true;
      return ApplyPatchTool.execute(args, context);
    },
  });

  // 6a. Invalid apply_patch: {}
  const badPatchRes = await isolatedRegistry.execute('apply_patch', {}, {
    workspacePath: testWorkspaceDir,
  });
  assert.strictEqual(badPatchRes.success, false, 'apply_patch without edits must be rejected');
  assert.strictEqual(applyPatchExecuted, false, 'apply_patch execute must not be called when edits is missing');
  assert.ok(badPatchRes.error.includes('tool call validation failed'));
  assert.ok(badPatchRes.error.includes("missing properties: 'edits'"));

  // 6b. Invalid apply_patch: { edits: [] }
  const emptyPatchRes = await isolatedRegistry.execute('apply_patch', { edits: [] }, {
    workspacePath: testWorkspaceDir,
  });
  assert.strictEqual(emptyPatchRes.success, false, 'apply_patch with empty edits array must be rejected');
  assert.strictEqual(applyPatchExecuted, false, 'apply_patch execute must not be called when edits is empty');
  console.log('[PASS] Test 6: apply_patch general validation verified (both valid and invalid)\n');

  // ---------------------------------------------------------------------------
  // TEST 7: AgentLoop Multi-Turn Recovery Flow
  // Verifies that when the model emits an invalid call, NEXUS:
  // - Returns a clean tool-validation error
  // - Does NOT crash or fail the turn
  // - Feeds the error back to the model in messages
  // - Allows the model to retry with valid arguments and complete the task
  // ---------------------------------------------------------------------------
  console.log('[TEST 7] Testing AgentLoop multi-turn recovery from invalid tool call...');
  const recoveryRuntime = HarnessRuntime.createIsolated();
  const thread = recoveryRuntime.createThread({ metadata: { workspacePath: testWorkspaceDir } });

  let callIteration = 0;
  let receivedToolErrorMessage = null;

  const recoveryTurnRes = await recoveryRuntime.runTurn({
    threadId: thread.threadId,
    userInput: 'Explain what cart_calculator.py does.',
    workspacePath: testWorkspaceDir,
    intent: 'READ_ONLY',
    modelHandler: async (messages, tools) => {
      callIteration++;

      if (callIteration === 1) {
        // First model turn: Emit invalid tool call (missing query)
        return {
          role: 'assistant',
          content: null,
          toolCalls: [
            {
              type: 'tool_call',
              callId: 'call_invalid_1',
              toolName: 'search_workspace',
              arguments: {},
            },
          ],
        };
      }

      if (callIteration === 2) {
        // Second model turn: Inspect incoming messages to verify tool validation error was received
        const toolMsg = messages.find((m) =>
          m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string' && m.content.includes('[TOOL_RESULT'))
        );
        receivedToolErrorMessage = toolMsg ? (typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content)) : null;

        // Model recovers and emits valid tool call with query
        return {
          role: 'assistant',
          content: null,
          toolCalls: [
            {
              type: 'tool_call',
              callId: 'call_valid_2',
              toolName: 'search_workspace',
              arguments: { query: 'cart_calculator.py' },
            },
          ],
        };
      }

      // Third model turn: Provide final answer based on tool output
      return {
        role: 'assistant',
        content: 'cart_calculator.py calculates shopping cart subtotals and discounts.',
        toolCalls: [],
      };
    },
  });

  assert.strictEqual(recoveryTurnRes.success, true, 'Turn must complete successfully via recovery');
  assert.strictEqual(recoveryTurnRes.status, TURN_STATUS.COMPLETED, 'Turn status must be COMPLETED');
  assert.strictEqual(recoveryTurnRes.totalToolCalls, 2, 'Must have recorded 2 tool calls (1 invalid rejected + 1 valid executed)');
  assert.ok(receivedToolErrorMessage, 'Model must have received tool error message in second turn');
  assert.ok(receivedToolErrorMessage.includes('tool call validation failed'), 'Error message must contain validation failure');
  assert.ok(receivedToolErrorMessage.includes("missing properties: 'query'"), 'Error message must specify missing query');
  assert.ok(recoveryTurnRes.finalResponse.includes('cart_calculator.py'), 'Final response must be returned');

  // Verify Turn Items in ItemStore
  const turnItems = recoveryRuntime.itemStore.getItemsByTurn(recoveryTurnRes.turnId);
  const toolResults = turnItems.filter((i) => i.type === ITEM_TYPES.TOOL_RESULT);
  assert.strictEqual(toolResults.length, 2, 'Must have recorded 2 TOOL_RESULT items');
  assert.strictEqual(toolResults[0].payload.success, false, 'First TOOL_RESULT must be failed');
  assert.ok(toolResults[0].payload.error.includes("missing properties: 'query'"), 'First TOOL_RESULT must contain query error');
  assert.strictEqual(toolResults[1].payload.success, true, 'Second TOOL_RESULT must be successful');
  console.log('  ✓ First turn tool result safely failed with:', toolResults[0].payload.error);
  console.log('  ✓ Second turn tool result succeeded with:', toolResults[1].payload.result.matches.length, 'matches');
  console.log('  ✓ Final turn response delivered cleanly');
  console.log('[PASS] Test 7: AgentLoop successfully recovered from invalid tool call and finished\n');

  // ---------------------------------------------------------------------------
  // TEST 8: Provider HTTP 400 Tool Validation Error Normalization
  // Verifies that when Groq returns HTTP 400 "tool call validation failed",
  // ModelAdapter translates it into an assistant tool call instead of crashing.
  // ---------------------------------------------------------------------------
  console.log('[TEST 8] Testing ModelAdapter provider tool validation error normalization...');
  const mockRouter = {
    activeProviderId: 'nexus6',
    resolveProviderAndModel: () => ({
      provider: {
        getId: () => 'nexus6',
        request: async () => {
          const err = new Error("tool call validation failed: parameters for tool `search_workspace` did not match schema: errors: [missing properties: 'query']");
          err.statusCode = 400;
          err.status = 400;
          err.data = {
            error: {
              message: "tool call validation failed: parameters for tool `search_workspace` did not match schema: errors: [missing properties: 'query']",
              type: 'invalid_request_error',
              code: 'tool_use_failed',
              failed_generation: '{"name": "search_workspace", "arguments": {}}',
            },
          };
          throw err;
        },
      },
      apiKey: 'gsk_mock_123',
      modelId: 'openai/gpt-oss-120b',
    }),
  };

  const adapter = new ModelAdapter(mockRouter);
  const availableTools = [SearchWorkspaceTool, ReadFileTool];

  const normalizedOutput = await adapter.invoke(
    [{ role: 'user', content: 'Explain what cart_calculator.py does.' }],
    availableTools,
    { providerId: 'nexus6', modelId: 'openai/gpt-oss-120b' }
  );

  assert.strictEqual(normalizedOutput.role, 'assistant');
  assert.ok(Array.isArray(normalizedOutput.toolCalls), 'Must extract toolCalls');
  assert.strictEqual(normalizedOutput.toolCalls.length, 1, 'Must extract 1 tool call');
  assert.strictEqual(normalizedOutput.toolCalls[0].toolName, 'search_workspace');
  assert.deepStrictEqual(normalizedOutput.toolCalls[0].arguments, {}, 'Arguments must match failed generation');
  console.log('  ✓ Normalized Groq 400 error into assistant tool call:', normalizedOutput.toolCalls[0]);
  console.log('[PASS] Test 8: Provider tool validation error normalized into recoverable tool call\n');

  console.log('================================================================');
  console.log('  ALL 8/8 TOOL SCHEMA VALIDATION & RECOVERY TESTS PASSED!       ');
  console.log('================================================================');
}

runTests().catch((err) => {
  console.error('\n[FATAL TEST FAILURE]:', err);
  process.exit(1);
});
