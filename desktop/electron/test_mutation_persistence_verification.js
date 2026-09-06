/**
 * NEXUS CODEX HARNESS - MUTATION INTEGRITY & PERSISTENCE VERIFICATION SUITE (Issue #6)
 * 
 * Verifies that the agent CANNOT report success unless:
 * 1. Valid patch changes the intended file on disk.
 * 2. Post-write reread confirms the requested content in the target file.
 * 3. Success is returned only after disk confirmation.
 * 4. Wrong-path patch cannot be reported as successful.
 * 5. Staged-but-not-applied ChangeSet cannot be reported as successful.
 * 6. Failed disk write cannot be reported as successful.
 * 7. Editor stale-cache scenario refreshes from persisted disk content.
 * 8. Nested file mutation confirms the correct canonical path.
 * 9. Mutation outside workspace is strictly blocked.
 * 10. Exact regression scenario:
 *     "Add a comment at the top of cart_calculator.py saying # Sentinel verification check."
 *     - Request classified as MUTATION
 *     - ChangeSet staged for cart_calculator.py
 *     - User approves change
 *     - Actual file contains "# Sentinel verification check"
 *     - Only then does turn complete with SUCCESS
 *     - PostMutationSentinel runs only after persistence is verified on disk.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { HarnessRuntime } = require('./harness/HarnessRuntime');
const { requestRouter, ROUTER_MODES, CODING_INTENTS } = require('./harness/RequestRouter');
const { ChangeSet, CHANGESET_STATUS } = require('./harness/ChangeSet');
const { workspacePathResolver } = require('./harness/WorkspacePathResolver');
const { ITEM_TYPES, TURN_STATUS, EVENT_TYPES } = require('./harness/types');
const ApplyPatchTool = require('./harness/tools/ApplyPatchTool');

async function runTestSuite() {
  console.log('================================================================');
  console.log('  MUTATION PERSISTENCE & INTEGRITY VERIFICATION TEST SUITE       ');
  console.log('================================================================\n');

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

  // Setup sandbox directory
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus_mutation_test_'));

  try {
    // -------------------------------------------------------------------------
    // Test 1: Valid patch changes the intended file on disk
    // -------------------------------------------------------------------------
    await test('Valid patch changes the intended file on disk', async () => {
      const filePath = path.join(sandboxDir, 'test_calc.py');
      fs.writeFileSync(filePath, 'def add(a, b):\n    return a + b\n', 'utf8');

      const cs = new ChangeSet({
        threadId: 't1',
        intent: 'MUTATION',
      });
      cs.addFile({
        filePath: 'test_calc.py',
        original: 'return a + b',
        replacement: 'return a + b  # added sum comment',
      });
      cs.approvalState = { approved: true, approvedBy: 'user' };

      const outcome = await cs.apply({ workspacePath: sandboxDir });
      assert.strictEqual(outcome.success, true, 'ChangeSet.apply() must succeed');
      assert.strictEqual(outcome.appliedCount, 1, 'Exactly 1 file must be applied');

      const onDisk = fs.readFileSync(filePath, 'utf8');
      assert.ok(onDisk.includes('# added sum comment'), 'Disk file must contain the new comment');
    });

    // -------------------------------------------------------------------------
    // Test 2: Post-write reread confirms the requested content
    // -------------------------------------------------------------------------
    await test('Post-write reread confirms the requested content', async () => {
      const filePath = path.join(sandboxDir, 'test_reread.py');
      fs.writeFileSync(filePath, 'val = 100\n', 'utf8');

      const cs = new ChangeSet({ threadId: 't2', intent: 'MUTATION' });
      cs.addFile({
        filePath: 'test_reread.py',
        original: 'val = 100',
        replacement: 'val = 200',
      });

      // Before applying, verifyPersistence should fail because disk has 100, not 200
      const preCheck = cs.verifyPersistence(sandboxDir);
      assert.strictEqual(preCheck.success, false, 'Pre-apply verifyPersistence must fail');
      assert.strictEqual(preCheck.reason, 'MUTATION_NOT_PERSISTED');

      // Now apply
      cs.approvalState = { approved: true, approvedBy: 'user' };
      const applyRes = await cs.apply({ workspacePath: sandboxDir });
      assert.strictEqual(applyRes.success, true);
      assert.strictEqual(cs.metadata.persistenceVerified, true);

      // Post-apply verifyPersistence should succeed
      const postCheck = cs.verifyPersistence(sandboxDir);
      assert.strictEqual(postCheck.success, true);
      assert.strictEqual(postCheck.verifiedFiles.length, 1);
      assert.strictEqual(postCheck.verifiedFiles[0].persistenceVerified, true);
    });

    // -------------------------------------------------------------------------
    // Test 3: Success is returned only after disk confirmation
    // -------------------------------------------------------------------------
    await test('Success is returned only after disk confirmation', async () => {
      const runtime = new HarnessRuntime({ isolate: true });
      const filePath = path.join(sandboxDir, 'confirmed_target.py');
      fs.writeFileSync(filePath, 'INITIAL_STATE = True\n', 'utf8');

      const thread = runtime.createThread({
        metadata: { workspacePath: sandboxDir, title: 'Confirm Test' },
      });

      const outcome = await runtime.runTurn({
        threadId: thread.threadId,
        userInput: 'Update INITIAL_STATE to False',
        workspacePath: sandboxDir,
        intent: 'MUTATION',
        approvalMode: 'auto',
        modelHandler: async (messages) => {
          const toolResult = messages.find((m) => m.role === 'tool' && m.name === 'apply_patch');
          if (toolResult) {
            return {
              role: 'assistant',
              content: 'I have updated INITIAL_STATE to False.',
            };
          }
          return {
            role: 'assistant',
            content: 'Patching INITIAL_STATE',
            toolCalls: [
              {
                type: 'tool_call',
                callId: 'call_patch_3',
                toolName: 'apply_patch',
                arguments: {
                  edits: [
                    {
                      filePath: 'confirmed_target.py',
                      original: 'INITIAL_STATE = True',
                      replacement: 'INITIAL_STATE = False',
                    },
                  ],
                },
              },
            ],
          };
        },
      });

      assert.strictEqual(outcome.success, true, 'Turn must succeed');
      assert.strictEqual(outcome.status, TURN_STATUS.COMPLETED);

      const diskText = fs.readFileSync(filePath, 'utf8');
      assert.strictEqual(diskText, 'INITIAL_STATE = False\n');
    });

    // -------------------------------------------------------------------------
    // Test 4: Wrong-path patch cannot be reported as successful
    // -------------------------------------------------------------------------
    await test('Wrong-path patch cannot be reported as successful', async () => {
      const runtime = new HarnessRuntime({ isolate: true });

      const thread = runtime.createThread({
        metadata: { workspacePath: sandboxDir, title: 'Wrong Path Test' },
      });

      const outcome = await runtime.runTurn({
        threadId: thread.threadId,
        userInput: 'Modify nonexistent file',
        workspacePath: sandboxDir,
        intent: 'MUTATION',
        approvalMode: 'auto',
        modelHandler: async (messages) => {
          const toolResult = messages.find((m) => m.role === 'tool' && m.name === 'apply_patch');
          if (toolResult) {
            return {
              role: 'assistant',
              content: 'I successfully updated ghost_file.py!',
            };
          }
          return {
            role: 'assistant',
            content: 'Applying patch to ghost file',
            toolCalls: [
              {
                type: 'tool_call',
                callId: 'call_ghost_1',
                toolName: 'apply_patch',
                arguments: {
                  edits: [
                    {
                      filePath: 'ghost_file_nonexistent.py',
                      original: 'old',
                      replacement: 'new',
                    },
                  ],
                },
              },
            ],
          };
        },
      });

      // AgentLoop must detect that zero mutations were verified and FAIL the turn
      assert.strictEqual(outcome.success, false, 'Turn must fail when patch targets wrong/missing path');
      assert.strictEqual(outcome.status, TURN_STATUS.FAILED);
      assert.ok(
        outcome.error.includes('Mutation persistence verification failed'),
        `Error must report persistence failure, got: ${outcome.error}`
      );
    });

    // -------------------------------------------------------------------------
    // Test 5: Staged-but-not-applied ChangeSet cannot be reported as successful
    // -------------------------------------------------------------------------
    await test('Staged-but-not-applied ChangeSet cannot be reported as successful', async () => {
      const runtime = new HarnessRuntime({ isolate: true });
      const targetFile = path.join(sandboxDir, 'staged_only.py');
      fs.writeFileSync(targetFile, 'x = 1\n', 'utf8');

      const thread = runtime.createThread({
        metadata: { workspacePath: sandboxDir, title: 'Staged Only Test' },
      });

      const turnPromise = runtime.runTurn({
        threadId: thread.threadId,
        userInput: 'Stage change for approval',
        workspacePath: sandboxDir,
        intent: 'MUTATION',
        approvalMode: 'strict', // Requires approval
        modelHandler: async (messages) => {
          const toolResult = messages.find((m) => m.role === 'tool' && m.name === 'apply_patch');
          if (toolResult) {
            return {
              role: 'assistant',
              content: 'The user denied the patch.',
            };
          }
          return {
            role: 'assistant',
            content: 'I proposed the change.',
            toolCalls: [
              {
                type: 'tool_call',
                callId: 'call_stage_only',
                toolName: 'apply_patch',
                arguments: {
                  edits: [
                    {
                      filePath: 'staged_only.py',
                      original: 'x = 1',
                      replacement: 'x = 2',
                    },
                  ],
                },
              },
            ],
          };
        },
      });

      // Wait until turn pauses for approval
      let activeTurn = null;
      for (let t = 0; t < 30; t++) {
        activeTurn = runtime.turnManager.listTurnsByThread(thread.threadId)[0];
        if (activeTurn) {
          const turnItems = runtime.itemStore.getItemsByTurn(activeTurn.turnId);
          const approvalItem = turnItems.find((i) => i.type === ITEM_TYPES.APPROVAL_REQUEST);
          if (approvalItem) break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      // User rejects the staged ChangeSet
      runtime.approveAction({
        turnId: activeTurn.turnId,
        callId: 'call_stage_only',
        decision: { approved: false, reason: 'User denied mutation' },
      });

      const outcome = await turnPromise;

      // Turn must not succeed
      assert.strictEqual(outcome.success, false, 'Turn must fail when staged ChangeSet is not applied');
      assert.strictEqual(outcome.status, TURN_STATUS.FAILED);
      assert.ok(
        outcome.error.includes('Mutation persistence verification failed'),
        `Error must report persistence failure: ${outcome.error}`
      );

      // Verify disk file was NOT modified
      const diskContent = fs.readFileSync(targetFile, 'utf8');
      assert.strictEqual(diskContent, 'x = 1\n');
    });

    // -------------------------------------------------------------------------
    // Test 6: Failed disk write cannot be reported as successful
    // -------------------------------------------------------------------------
    await test('Failed disk write cannot be reported as successful', async () => {
      const targetFile = path.join(sandboxDir, 'failed_write.py');
      fs.writeFileSync(targetFile, 'content = "old"\n', 'utf8');

      const cs = new ChangeSet({ threadId: 't6', intent: 'MUTATION' });
      cs.addFile({
        filePath: 'failed_write.py',
        original: 'content = "old"',
        replacement: 'content = "new"',
      });
      cs.approvalState = { approved: true, approvedBy: 'user' };

      // Mock applier that pretends to succeed but writes nothing to disk
      const mockFakeApplier = {
        applyTransaction: async () => ({
          success: true,
          transactionId: 'fake_tx',
          appliedCount: 1,
          modifiedFiles: [{ relPath: 'failed_write.py', originalLength: 15, newLength: 15 }],
        }),
      };

      const result = await cs.apply({
        workspacePath: sandboxDir,
        applier: mockFakeApplier,
      });

      assert.strictEqual(result.success, false, 'ChangeSet.apply() must fail because disk content was not updated');
      assert.strictEqual(result.reason, 'MUTATION_NOT_PERSISTED');
      assert.strictEqual(cs.status, CHANGESET_STATUS.FAILED);
    });

    // -------------------------------------------------------------------------
    // Test 7: Editor stale-cache scenario refreshes from persisted content
    // -------------------------------------------------------------------------
    await test('Editor stale-cache scenario refreshes from persisted content', async () => {
      const filePath = path.join(sandboxDir, 'editor_sync.py');
      fs.writeFileSync(filePath, 'stale_var = 10\n', 'utf8');

      // Simulated editor tab state (as in IDEApp.tsx)
      let openTabs = [
        {
          path: filePath,
          name: 'editor_sync.py',
          content: 'stale_var = 10\n',
          savedContent: 'stale_var = 10\n',
          isDirty: false,
        },
      ];

      // Simulated refreshOpenTabFromDisk handler (mirrors IDEApp.tsx)
      const refreshOpenTabFromDisk = async (targetPath) => {
        const normTab = openTabs[0].path.replace(/\\/g, '/');
        const normTarget = targetPath.replace(/\\/g, '/');
        if (normTab === normTarget || normTarget.endsWith(normTab) || normTab.endsWith(normTarget)) {
          const fresh = fs.readFileSync(filePath, 'utf8');
          openTabs = openTabs.map((t) => ({
            ...t,
            content: fresh,
            savedContent: fresh,
            isDirty: false,
          }));
        }
      };

      // Perform disk mutation
      fs.writeFileSync(filePath, 'stale_var = 99  # persisted\n', 'utf8');

      // Before refresh, editor buffer is stale
      assert.strictEqual(openTabs[0].content, 'stale_var = 10\n');

      // Trigger sync (simulating ai:file-persisted / onFsChanged event)
      await refreshOpenTabFromDisk(filePath);

      // After sync, editor buffer reflects fresh disk content
      assert.strictEqual(openTabs[0].content, 'stale_var = 99  # persisted\n');
      assert.strictEqual(openTabs[0].isDirty, false);
    });

    // -------------------------------------------------------------------------
    // Test 8: Nested file mutation confirms the correct canonical path
    // -------------------------------------------------------------------------
    await test('Nested file mutation confirms the correct canonical path', async () => {
      const nestedDir = path.join(sandboxDir, 'packages', 'billing', 'src');
      fs.mkdirSync(nestedDir, { recursive: true });
      const nestedFile = path.join(nestedDir, 'calculator.js');
      fs.writeFileSync(nestedFile, 'function calc() { return 0; }\n', 'utf8');

      const cs = new ChangeSet({ threadId: 't8', intent: 'MUTATION' });
      cs.addFile({
        filePath: 'packages/billing/src/calculator.js',
        original: 'return 0;',
        replacement: 'return 42; /* canonical check */',
      });
      cs.approvalState = { approved: true, approvedBy: 'user' };

      const outcome = await cs.apply({ workspacePath: sandboxDir });
      assert.strictEqual(outcome.success, true);
      assert.strictEqual(cs.metadata.persistenceVerified, true);
      assert.strictEqual(cs.files[0].canonicalPath, 'packages/billing/src/calculator.js');

      const reread = fs.readFileSync(nestedFile, 'utf8');
      assert.ok(reread.includes('return 42; /* canonical check */'));
    });

    // -------------------------------------------------------------------------
    // Test 9: Mutation outside workspace is still blocked
    // -------------------------------------------------------------------------
    await test('Mutation outside workspace is still blocked', async () => {
      const outsideFile = path.join(os.tmpdir(), 'nexus_outside_secret.txt');
      fs.writeFileSync(outsideFile, 'TOP_SECRET\n', 'utf8');

      try {
        const toolResult = await ApplyPatchTool.execute(
          {
            edits: [
              {
                filePath: '../../nexus_outside_secret.txt',
                original: 'TOP_SECRET',
                replacement: 'HACKED',
              },
            ],
          },
          {
            workspacePath: sandboxDir,
            threadId: 't9',
          }
        );

        assert.strictEqual(toolResult.success, false, 'Mutation outside workspace must fail');
        assert.ok(
          toolResult.error.toLowerCase().includes('traversal') ||
          toolResult.error.toLowerCase().includes('outside') ||
          toolResult.error.toLowerCase().includes('boundary'),
          `Error must cite boundary traversal: ${toolResult.error}`
        );

        const content = fs.readFileSync(outsideFile, 'utf8');
        assert.strictEqual(content, 'TOP_SECRET\n', 'Outside file must remain untouched');
      } finally {
        try { fs.unlinkSync(outsideFile); } catch (e) {}
      }
    });

    // -------------------------------------------------------------------------
    // Test 10: Exact regression scenario:
    // "Add a comment at the top of cart_calculator.py saying # Sentinel verification check."
    // -------------------------------------------------------------------------
    await test('Exact regression: cart_calculator.py sentinel comment confirmed before success & test execution', async () => {
      const demoRoot = path.join(sandboxDir, 'demo-workspaces', 'ai_cart_project');
      const srcDir = path.join(demoRoot, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      const cartCalculatorFile = path.join(srcDir, 'cart_calculator.py');
      const initialCode = `def calculate_cart_total(items, discount=0.0):
    subtotal = sum(item["price"] * item["quantity"] for item in items)
    return subtotal
`;
      fs.writeFileSync(cartCalculatorFile, initialCode, 'utf8');

      const userPrompt = 'Add a comment at the top of cart_calculator.py saying # Sentinel verification check.';

      // 1. Verify classification
      const classification = requestRouter.classify(userPrompt, {
        workspacePath: demoRoot,
        activeFilePath: cartCalculatorFile,
      });
      assert.strictEqual(classification.mode, ROUTER_MODES.CODING_TASK);
      assert.strictEqual(classification.codingIntent, CODING_INTENTS.MUTATION);

      const runtime = new HarnessRuntime({ isolate: true });
      const thread = runtime.createThread({
        metadata: { workspacePath: demoRoot, title: 'Issue 6 Reproduction' },
      });

      // Track sequence of events
      const eventSequence = [];
      runtime.eventBus.subscribe((evt) => {
        if (evt.type === 'ai:file-persisted') {
          eventSequence.push({ type: 'ai:file-persisted', filePath: evt.payload?.filePath || evt.payload?.canonicalPath });
        } else if (evt.type === EVENT_TYPES.TEST_VERIFICATION_STATUS || evt.type === 'ai:test-verification-status') {
          eventSequence.push({ type: 'TEST_VERIFICATION_STATUS', payload: evt.payload });
        }
      });

      // Launch turn with strict approval
      const mockModelHandler = async (messages) => {
        const patchResult = messages.find((m) => m.role === 'tool' && m.name === 'apply_patch');
        if (patchResult) {
          return {
            role: 'assistant',
            content: "I've added the comment \"# Sentinel verification check\" at the top of cart_calculator.py.",
          };
        }
        return {
          role: 'assistant',
          content: 'Adding sentinel verification check comment.',
          toolCalls: [
            {
              type: 'tool_call',
              callId: 'call_cart_sentinel_01',
              toolName: 'apply_patch',
              arguments: {
                edits: [
                  {
                    filePath: 'src/cart_calculator.py',
                    original: 'def calculate_cart_total',
                    replacement: '# Sentinel verification check\ndef calculate_cart_total',
                  },
                ],
              },
            },
          ],
        };
      };

      const turnPromise = runtime.runTurn({
        threadId: thread.threadId,
        userInput: userPrompt,
        workspacePath: demoRoot,
        intent: 'MUTATION',
        approvalMode: 'strict',
        modelHandler: mockModelHandler,
      });

      // Poll until turn pauses for approval
      let activeTurn = null;
      let approvalItem = null;
      for (let t = 0; t < 30; t++) {
        activeTurn = runtime.turnManager.listTurnsByThread(thread.threadId)[0];
        if (activeTurn) {
          const turnItems = runtime.itemStore.getItemsByTurn(activeTurn.turnId);
          approvalItem = turnItems.find((i) => i.type === ITEM_TYPES.APPROVAL_REQUEST);
          if (approvalItem) break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      assert.ok(approvalItem, 'ChangeSet approval request must be present');

      // Before user approval: disk file MUST NOT contain the comment
      const diskBeforeApproval = fs.readFileSync(cartCalculatorFile, 'utf8');
      assert.strictEqual(
        diskBeforeApproval.includes('# Sentinel verification check'),
        false,
        'File must NOT be modified before approval'
      );

      // User approves the mutation
      const approveRes = runtime.approveAction({
        turnId: activeTurn.turnId,
        callId: 'call_cart_sentinel_01',
        decision: { approved: true },
      });
      assert.strictEqual(approveRes.success, true);

      // Await turn completion
      const turnOutcome = await turnPromise;

      // Assert turn succeeded
      assert.strictEqual(turnOutcome.success, true, 'Turn must report success after persisted mutation');
      assert.strictEqual(turnOutcome.status, TURN_STATUS.COMPLETED);

      // Assert the actual disk file contains the requested comment at the top!
      const diskAfterCompletion = fs.readFileSync(cartCalculatorFile, 'utf8');
      assert.ok(
        diskAfterCompletion.includes('# Sentinel verification check'),
        'Target disk file MUST contain "# Sentinel verification check"'
      );
      assert.ok(
        diskAfterCompletion.startsWith('# Sentinel verification check\ndef calculate_cart_total'),
        'Comment must be at the top of cart_calculator.py'
      );

      // Verify event ordering: ai:file-persisted must occur BEFORE any test verification
      const persistIndex = eventSequence.findIndex((e) => e.type === 'ai:file-persisted');
      assert.ok(persistIndex !== -1, 'ai:file-persisted event must have been emitted');

      const testIndex = eventSequence.findIndex((e) => e.type === 'TEST_VERIFICATION_STATUS');
      if (testIndex !== -1) {
        assert.ok(persistIndex < testIndex, 'ai:file-persisted MUST precede test verification status');
      }
    });

  } finally {
    // Clean up sandbox
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch (e) {}
  }

  console.log('\n================================================================');
  console.log(`  MUTATION PERSISTENCE SUITE RESULTS: ${passed}/${total} PASSED`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exitCode = 1;
  }
}

runTestSuite().catch((err) => {
  console.error('Unhandled suite error:', err);
  process.exitCode = 1;
});
