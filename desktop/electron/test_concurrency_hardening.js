/**
 * NEXUS CONCURRENCY HARDENING & RACE CONDITION TEST SUITE
 * 
 * Verifies targeted fixes for:
 * 1. Streaming Cancellation Race:
 *    - Cancelled stream aborts cleanly and discards delayed chunks.
 *    - Cancelled turns never execute tools or mutate disk.
 *    - Cancelled turn status remains CANCELLED (never flipped to FAILED).
 * 
 * 2. Concurrent PostMutationSentinel Workspace Queue:
 *    - Multiple concurrent verification runs against the same workspace are serialized.
 *    - Independent workspaces run concurrently without blocking each other.
 *    - Per-workspace lock entries clean up cleanly without memory leaks.
 */

const assert = require('assert');
const path = require('path');
const os = require('os');
const { AgentLoop } = require('./harness/AgentLoop');
const { PostMutationSentinel } = require('./testing/PostMutationSentinel');
const { ITEM_TYPES, ITEM_STATUS, TURN_STATUS } = require('./harness/types');

async function runConcurrencyHardeningSuite() {
  console.log('================================================================');
  console.log('  NEXUS CONCURRENCY HARDENING & RACE CONDITION TEST SUITE       ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`[PASS] Test ${total.toString().padStart(2, '0')}: ${name}`);
    } catch (err) {
      console.error(`[FAIL] Test ${total.toString().padStart(2, '0')}: ${name}`);
      console.error(`       Error: ${err.message}`);
      if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
  }

  // ---------------------------------------------------------------------------
  // 1. Streaming Cancellation: Discards Delayed Chunks & Keeps CANCELLED Status
  // ---------------------------------------------------------------------------
  await testAsync('Mid-stream cancellation aborts stream, drops delayed chunks, and preserves CANCELLED status', async () => {
    const { HarnessRuntime } = require('./harness/HarnessRuntime');
    const runtime = new HarnessRuntime({ isolated: true });
    const thread = runtime.createThread({ title: 'Test Thread' });
    const turn = runtime.startTurn(thread.threadId, { userInput: 'Refactor something' });

    let streamChunksEmitted = 0;
    let toolsExecuted = 0;

    const mockModelAdapter = {
      stream: async function* (_msgs, _tools, options) {
        streamChunksEmitted++;
        yield { type: 'message_delta', delta: 'Generating...' };

        // Trigger cancellation on runtime mid-stream
        runtime.cancelTurn(turn.turnId, 'Cancelled by user');

        // Delayed chunk arriving after cancellation
        if (options.abortSignal?.aborted) {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          throw err;
        }

        streamChunksEmitted++;
        yield {
          type: 'tool_call',
          toolCalls: [{ callId: 'tc_delayed_1', toolName: 'edit_file', arguments: { path: 'src/bad.ts' } }],
        };
      },
    };

    const mockToolRegistry = {
      list: () => [],
      execute: async () => {
        toolsExecuted++;
        return { success: true };
      },
    };

    const agentLoop = new AgentLoop({
      runtime,
      modelAdapter: mockModelAdapter,
      toolRegistry: mockToolRegistry,
    });

    const result = await agentLoop.runTurn({
      threadId: thread.threadId,
      turnId: turn.turnId,
      userInput: 'Refactor something',
    });

    assert.strictEqual(result.status, TURN_STATUS.CANCELLED);
    assert.strictEqual(result.success, false);
    assert.strictEqual(toolsExecuted, 0, 'Zero tools must be executed when turn is cancelled');
  });

  // ---------------------------------------------------------------------------
  // 2. Pre-Tool Cancellation Guard
  // ---------------------------------------------------------------------------
  await testAsync('Pre-tool cancellation check prevents tool execution if turn was cancelled after stream', async () => {
    const { HarnessRuntime } = require('./harness/HarnessRuntime');
    const runtime = new HarnessRuntime({ isolated: true });
    const thread = runtime.createThread({ title: 'Test Thread' });
    const turn = runtime.startTurn(thread.threadId, { userInput: 'Fix bug in src/a.ts by applying patch' });

    let toolsExecuted = 0;

    const mockModelAdapter = {
      stream: async function* () {
        // Yield tool call then cancel turn before tool loop executes
        yield {
          type: 'tool_call',
          toolCalls: [{ callId: 'tc_1', toolName: 'apply_patch', arguments: { edits: [{ filePath: 'src/a.ts' }] } }],
        };
        runtime.cancelTurn(turn.turnId, 'Cancelled before tools');
      },
    };

    const mockToolRegistry = {
      list: () => [{ name: 'apply_patch' }],
      execute: async () => {
        toolsExecuted++;
        return { success: true };
      },
    };

    const agentLoop = new AgentLoop({
      runtime,
      modelAdapter: mockModelAdapter,
      toolRegistry: mockToolRegistry,
    });

    const result = await agentLoop.runTurn({
      threadId: thread.threadId,
      turnId: turn.turnId,
      userInput: 'Fix bug in src/a.ts by applying patch',
    });

    assert.strictEqual(result.status, TURN_STATUS.CANCELLED);
    assert.strictEqual(toolsExecuted, 0, 'Must not execute any tool when turn was cancelled');
  });

  // ---------------------------------------------------------------------------
  // 3. PostMutationSentinel Serializes Concurrent Verifications on Same Workspace
  // ---------------------------------------------------------------------------
  await testAsync('Concurrent PostMutationSentinel runs on the same workspace execute in strict serial order', async () => {
    const executionOrder = [];
    const workspace = path.join(os.tmpdir(), 'nexus-sentinel-same-ws');

    const mockExecutor = {
      runTests: async (params) => {
        const id = params.target || 'test';
        executionOrder.push(`START_${id}`);
        // Simulate asynchronous test runner execution duration
        await new Promise((r) => setTimeout(r, 40));
        executionOrder.push(`END_${id}`);
        return {
          status: 'PASSED',
          exitCode: 0,
          summary: { passed: 1, total: 1, failed: 0 },
        };
      },
    };

    const sentinel = new PostMutationSentinel({
      testExecutor: mockExecutor,
      testRunnerDetector: { detect: () => ({ detected: true, preferredRunner: 'jest' }) },
      impactAnalyzer: {
        analyzeFile: (f) => ({ tests: [{ testPath: `tests/${path.basename(f)}.test.ts` }] }),
      },
    });

    // Launch two verification runs concurrently against the same workspace
    const run1 = sentinel.verify({
      workspacePath: workspace,
      mutatedFiles: ['src/fileA.ts'],
      threadId: 'thread_1',
    });

    const run2 = sentinel.verify({
      workspacePath: workspace,
      mutatedFiles: ['src/fileB.ts'],
      threadId: 'thread_2',
    });

    const [res1, res2] = await Promise.all([run1, run2]);

    assert.strictEqual(res1.verified, true);
    assert.strictEqual(res2.verified, true);

    // Assert strict serial execution order: START_A -> END_A -> START_B -> END_B
    // (They must NOT interleave: START_A -> START_B -> END_A)
    assert.deepStrictEqual(executionOrder, [
      'START_tests/fileA.ts.test.ts',
      'END_tests/fileA.ts.test.ts',
      'START_tests/fileB.ts.test.ts',
      'END_tests/fileB.ts.test.ts',
    ], 'Verifications on the same workspace must not interleave');
  });

  // ---------------------------------------------------------------------------
  // 4. Independent Workspaces Run Concurrently Without Global Blocking
  // ---------------------------------------------------------------------------
  await testAsync('Verifications on different workspaces run concurrently without blocking each other', async () => {
    const ws1 = path.join(os.tmpdir(), 'nexus-ws-1');
    const ws2 = path.join(os.tmpdir(), 'nexus-ws-2');
    const executionEvents = [];

    const mockExecutor = {
      runTests: async (params) => {
        const wsName = params.workspacePath.includes('ws-1') ? 'WS1' : 'WS2';
        executionEvents.push(`START_${wsName}`);
        await new Promise((r) => setTimeout(r, 40));
        executionEvents.push(`END_${wsName}`);
        return {
          status: 'PASSED',
          exitCode: 0,
          summary: { passed: 1, total: 1, failed: 0 },
        };
      },
    };

    const sentinel = new PostMutationSentinel({
      testExecutor: mockExecutor,
      testRunnerDetector: { detect: () => ({ detected: true, preferredRunner: 'vitest' }) },
      impactAnalyzer: { analyzeFile: () => ({ tests: [{ testPath: 'tests/unit.test.ts' }] }) },
    });

    const run1 = sentinel.verify({ workspacePath: ws1, mutatedFiles: ['src/a.ts'] });
    const run2 = sentinel.verify({ workspacePath: ws2, mutatedFiles: ['src/b.ts'] });

    await Promise.all([run1, run2]);

    // Both should start before either finishes (concurrent interleaving)
    assert.strictEqual(executionEvents[0].startsWith('START_'), true);
    assert.strictEqual(executionEvents[1].startsWith('START_'), true);
  });

  // ---------------------------------------------------------------------------
  // 5. Per-Workspace Lock Memory Cleanup
  // ---------------------------------------------------------------------------
  await testAsync('Per-workspace lock entries clean up completely from memory upon completion', async () => {
    const ws = path.join(os.tmpdir(), 'nexus-cleanup-ws');

    const sentinel = new PostMutationSentinel({
      testExecutor: {
        runTests: async () => ({ status: 'PASSED', exitCode: 0, summary: { passed: 1, total: 1 } }),
      },
      testRunnerDetector: { detect: () => ({ detected: true, preferredRunner: 'jest' }) },
      impactAnalyzer: { analyzeFile: () => ({ tests: [{ testPath: 'tests/a.test.ts' }] }) },
    });

    await sentinel.verify({ workspacePath: ws, mutatedFiles: ['src/a.ts'] });

    const key = path.resolve(ws);
    assert.strictEqual(sentinel.workspaceLocks.has(key), false, 'Workspace lock entry must be deleted after run');
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('================================================================');
  console.log(`  RESULTS: ${passed}/${total} CONCURRENCY HARDENING TESTS PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runConcurrencyHardeningSuite().catch((err) => {
  console.error('Fatal concurrency test error:', err);
  process.exit(1);
});
