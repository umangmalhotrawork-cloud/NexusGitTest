/**
 * REAL RUNTIME WORKSPACE AND PATH RESOLUTION REGRESSION TEST SUITE
 * 
 * Tests the real execution path used by Electron / AgentLoop / Tools:
 * real workspace -> real tool context -> real resolver -> read_file/search_workspace -> real AgentLoop message flow
 * 
 * Covers:
 * 1. Root-level file
 * 2. Nested file
 * 3. Deeply nested file
 * 4. Currently open editor file
 * 5. Workspace switching
 * 6. Second consecutive task on same workspace
 * 7. Exact live acceptance test:
 *    Workspace: nexus-fullstack-deployment-test
 *    File: demo-workspaces/ai_cart_project/src/cart_calculator.py
 *    Prompt: Explain what cart_calculator.py does.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const { HarnessRuntime } = require('./harness/HarnessRuntime');
const { workspacePathResolver } = require('./harness/WorkspacePathResolver');
const SearchWorkspaceTool = require('./harness/tools/SearchWorkspaceTool');
const ReadFileTool = require('./harness/tools/ReadFileTool');

let passedTests = 0;
let totalTests = 0;

async function runScenario(name, fn) {
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
  console.log('  NEXUS REAL RUNTIME WORKSPACE PATH RESOLUTION TEST SUITE       ');
  console.log('================================================================\n');

  const projectRoot = workspacePathResolver.findProjectRoot(process.cwd());
  const wsDeployment = path.join(projectRoot, 'demo-workspaces', 'nexus-fullstack-deployment-test');
  const wsAiCart = path.join(projectRoot, 'demo-workspaces', 'ai_cart_project');

  // 1. Root-level file resolution
  await runScenario('Scenario 1: Root-level file resolution (README.md in workspace)', async () => {
    const runtime = new HarnessRuntime();
    let readToolSuccess = false;

    const res = await runtime.handleRequest({
      userInput: 'Explain README.md',
      workspacePath: wsDeployment,
      activeFilePath: 'README.md',
      modelHandler: async (messages) => {
        const hasToolResult = messages.some((m) => m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string' && m.content.includes('TOOL_RESULT')));
        if (!hasToolResult) {
          return {
            toolCalls: [{
              callId: 'call_root_1',
              toolName: 'read_file',
              arguments: { path: 'README.md' },
            }],
          };
        }
        const toolMsg = messages.find((m) => m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string' && m.content.includes('TOOL_RESULT')));
        readToolSuccess = !JSON.stringify(toolMsg.content).includes('File not found');
        return 'README.md contains the project overview and deployment instructions.';
      },
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.turn?.metadata?.outcome, 'SUCCESS');
    assert.strictEqual(readToolSuccess, true, 'read_file must succeed on root-level file');
    assert.ok(res.summary.includes('README.md'));
  });

  // 2. Nested file resolution
  await runScenario('Scenario 2: Nested file resolution (backend/server.js)', async () => {
    const runtime = new HarnessRuntime();
    let readToolSuccess = false;

    const res = await runtime.handleRequest({
      userInput: 'Inspect backend/server.js',
      workspacePath: wsDeployment,
      activeFilePath: 'backend/server.js',
      modelHandler: async (messages) => {
        const hasToolResult = messages.some((m) => m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string' && m.content.includes('TOOL_RESULT')));
        if (!hasToolResult) {
          return {
            toolCalls: [{
              callId: 'call_nested_1',
              toolName: 'read_file',
              arguments: { path: 'backend/server.js' },
            }],
          };
        }
        const toolMsg = messages.find((m) => m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string' && m.content.includes('TOOL_RESULT')));
        readToolSuccess = !JSON.stringify(toolMsg.content).includes('File not found');
        return 'backend/server.js initializes an Express server with health and API routes.';
      },
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.turn?.metadata?.outcome, 'SUCCESS');
    assert.strictEqual(readToolSuccess, true, 'read_file must succeed on nested file');
  });

  // 3. Deeply nested file resolution
  await runScenario('Scenario 3: Deeply nested file resolution (frontend/src/App.jsx)', async () => {
    const runtime = new HarnessRuntime();
    let readToolSuccess = false;

    const res = await runtime.handleRequest({
      userInput: 'Review frontend/src/App.jsx',
      workspacePath: wsDeployment,
      activeFilePath: 'frontend/src/App.jsx',
      modelHandler: async (messages) => {
        const hasToolResult = messages.some((m) => m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string' && m.content.includes('TOOL_RESULT')));
        if (!hasToolResult) {
          return {
            toolCalls: [{
              callId: 'call_deep_1',
              toolName: 'read_file',
              arguments: { path: 'frontend/src/App.jsx' },
            }],
          };
        }
        const toolMsg = messages.find((m) => m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string' && m.content.includes('TOOL_RESULT')));
        readToolSuccess = !JSON.stringify(toolMsg.content).includes('File not found');
        return 'App.jsx renders the main dashboard React view.';
      },
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.turn?.metadata?.outcome, 'SUCCESS');
    assert.strictEqual(readToolSuccess, true, 'read_file must succeed on deeply nested file');
  });

  // 4. Currently open editor file correlation across workspaces
  await runScenario('Scenario 4: Currently open editor file across workspace boundaries', async () => {
    const runtime = new HarnessRuntime();
    let readBareSuccess = false;

    const res = await runtime.handleRequest({
      userInput: 'Explain cart_calculator.py',
      options: { isCodingTask: true },
      workspacePath: wsDeployment,
      activeFilePath: 'demo-workspaces/ai_cart_project/src/cart_calculator.py',
      modelHandler: async (messages) => {
        const hasToolResult = messages.some((m) => m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string' && m.content.includes('TOOL_RESULT')));
        if (!hasToolResult) {
          return {
            toolCalls: [{
              callId: 'call_open_1',
              toolName: 'read_file',
              arguments: { path: 'cart_calculator.py' },
            }],
          };
        }
        const toolMsg = messages.find((m) => m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string' && m.content.includes('TOOL_RESULT')));
        readBareSuccess = !JSON.stringify(toolMsg.content).includes('File not found') && JSON.stringify(toolMsg.content).includes('calculate_cart_total');
        return 'cart_calculator.py implements the cart total calculations.';
      },
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.turn?.metadata?.outcome, 'SUCCESS');
    assert.strictEqual(readBareSuccess, true, 'Bare filename matching active editor file must resolve');
  });

  // 5. Workspace switching: ai_cart_project -> nexus-fullstack-deployment-test
  await runScenario('Scenario 5: Clean workspace switching without leakage (A -> B)', async () => {
    const runtime = new HarnessRuntime();

    // Step A: Run in ai_cart_project
    const resA = await runtime.handleRequest({
      userInput: 'Explain src/cart_calculator.py',
      options: { isCodingTask: true },
      workspacePath: wsAiCart,
      activeFilePath: 'src/cart_calculator.py',
      modelHandler: async () => 'Handled A',
    });
    assert.strictEqual(resA.success, true);

    // Step B: Switch to nexus-fullstack-deployment-test and read local backend file
    let readBSuccess = false;
    const resB = await runtime.handleRequest({
      userInput: 'Explain backend/server.js',
      options: { isCodingTask: true },
      workspacePath: wsDeployment,
      activeFilePath: 'backend/server.js',
      modelHandler: async (messages) => {
        const hasToolResult = messages.some((m) => m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string' && m.content.includes('TOOL_RESULT')));
        if (!hasToolResult) {
          return {
            toolCalls: [{
              callId: 'call_b_1',
              toolName: 'read_file',
              arguments: { path: 'backend/server.js' },
            }],
          };
        }
        const toolMsg = messages.find((m) => m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string' && m.content.includes('TOOL_RESULT')));
        readBSuccess = !JSON.stringify(toolMsg.content).includes('File not found');
        return 'Backend server checked.';
      },
    });

    assert.strictEqual(resB.success, true);
    assert.strictEqual(readBSuccess, true, 'File in switched workspace must resolve cleanly');
  });

  // 6. Second consecutive task on same workspace
  await runScenario('Scenario 6: Second consecutive task on the same workspace', async () => {
    const runtime = new HarnessRuntime();
    const threadId = 'thread_consecutive_test';

    // Task 1
    const res1 = await runtime.handleRequest({
      threadId,
      userInput: 'First task: check server',
      workspacePath: wsDeployment,
      activeFilePath: 'backend/server.js',
      modelHandler: async () => 'Task 1 done',
    });
    assert.strictEqual(res1.success, true);

    // Task 2 on same thread and workspace
    let readSuccess2 = false;
    const res2 = await runtime.handleRequest({
      threadId,
      userInput: 'Second task: read package.json',
      workspacePath: wsDeployment,
      activeFilePath: 'backend/package.json',
      modelHandler: async (messages) => {
        const hasToolResult = messages.some((m) => m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string' && m.content.includes('TOOL_RESULT')));
        if (!hasToolResult) {
          return {
            toolCalls: [{
              callId: 'call_cons_2',
              toolName: 'read_file',
              arguments: { path: 'backend/package.json' },
            }],
          };
        }
        const toolMsg = messages.find((m) => m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string' && m.content.includes('TOOL_RESULT')));
        readSuccess2 = !JSON.stringify(toolMsg.content).includes('File not found');
        return 'Task 2 done';
      },
    });

    assert.strictEqual(res2.success, true);
    assert.strictEqual(readSuccess2, true);
  });

  // 7. EXACT LIVE ACCEPTANCE TEST
  await runScenario('Scenario 7: EXACT REAL CASE: Workspace=nexus-fullstack-deployment-test, File=demo-workspaces/ai_cart_project/src/cart_calculator.py', async () => {
    const runtime = new HarnessRuntime();
    const ws = 'nexus-fullstack-deployment-test';
    const targetFile = 'demo-workspaces/ai_cart_project/src/cart_calculator.py';
    const userPrompt = 'Explain what cart_calculator.py does.';

    // 1. Verify editor canonical path === tool canonical path === filesystem target
    const editorRes = workspacePathResolver.resolve(ws, targetFile, { activeFilePath: targetFile, mustExist: true });
    const toolResBare = workspacePathResolver.resolve(ws, 'cart_calculator.py', { activeFilePath: targetFile, mustExist: true });
    const toolResFull = workspacePathResolver.resolve(ws, targetFile, { activeFilePath: targetFile, mustExist: true });

    assert.strictEqual(editorRes.success, true);
    assert.strictEqual(toolResBare.success, true);
    assert.strictEqual(toolResFull.success, true);
    assert.strictEqual(editorRes.absolutePath, toolResBare.absolutePath);
    assert.strictEqual(editorRes.absolutePath, toolResFull.absolutePath);
    assert.ok(fs.existsSync(editorRes.absolutePath));

    // 2. Verify search_workspace finds the file
    const searchRes = await SearchWorkspaceTool.execute({
      query: 'cart_calculator.py',
      includeGlobs: ['**/*.py'],
    }, {
      workspacePath: ws,
      activeFilePath: targetFile,
    });

    assert.strictEqual(searchRes.success, true);
    assert.ok(searchRes.totalMatches >= 1);
    assert.ok(searchRes.matches.some((m) => m.file.includes('cart_calculator.py')));

    // 3. Verify read_file reads the file content
    const readRes = await ReadFileTool.execute({
      path: targetFile,
    }, {
      workspacePath: ws,
      activeFilePath: targetFile,
    });

    assert.strictEqual(readRes.success, true);
    assert.ok(readRes.content.includes('def calculate_cart_total'));

    // 4. Verify complete AgentLoop turn receives tool result and produces correct explanation
    let step = 0;
    const turnRes = await runtime.handleRequest({
      userInput: userPrompt,
      workspacePath: ws,
      activeFilePath: targetFile,
      modelHandler: async (messages) => {
        step++;
        if (step === 1) {
          // Turn 1: model executes read_file
          return {
            toolCalls: [{
              callId: 'call_acc_1',
              toolName: 'read_file',
              arguments: { path: targetFile },
            }],
          };
        } else {
          // Turn 2: model inspects tool result and returns final answer
          const toolMsg = messages.find((m) => m.role === 'tool' || (m.role === 'user' && typeof m.content === 'string' && m.content.includes('TOOL_RESULT')));
          assert.ok(toolMsg, 'AgentLoop must pass tool result to model');
          const contentStr = typeof toolMsg.content === 'string' ? toolMsg.content : JSON.stringify(toolMsg.content);
          assert.ok(contentStr.includes('calculate_cart_total'), 'Tool result must contain function definition');

          return 'cart_calculator.py computes subtotal, item-level discounts, coupon codes, sales tax, and shipping rates for cart checkout.';
        }
      },
    });

    assert.strictEqual(turnRes.success, true);
    assert.strictEqual(turnRes.turn?.metadata?.outcome, 'SUCCESS');
    assert.strictEqual(turnRes.iterations, 2, 'Must complete in 2 iterations without looping or reaching max limits');
    assert.strictEqual(turnRes.turn?.items?.some((i) => i.type === 'TOOL_RESULT' && i.status === 'COMPLETED' && i.payload?.success === true), true);
    assert.ok(turnRes.finalResponse.includes('cart_calculator.py'));
  });

  console.log('\n================================================================');
  console.log(`  REAL RUNTIME REGRESSION SUITE: ${passedTests}/${totalTests} PASS (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log('================================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runAll().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
