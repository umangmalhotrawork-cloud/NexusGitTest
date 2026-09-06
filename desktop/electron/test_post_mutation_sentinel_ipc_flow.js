/**
 * NEXUS POST-MUTATION SENTINEL IPC & COMPOSER STATUS REGRESSION TEST
 *
 * Reproduces and verifies the exact manual workflow:
 * AI mutation -> AgentLoop -> PostMutationSentinel -> eventBus -> main.js IPC forwarder -> Preload onTestVerificationStatus -> Composer
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { HarnessRuntime } = require('./harness/HarnessRuntime');
const { EVENT_TYPES } = require('./harness/types');
const { postMutationSentinel } = require('./testing/PostMutationSentinel');

async function runTest() {
  console.log('================================================================');
  console.log('  NEXUS POST-MUTATION SENTINEL IPC & UI EVENT FLOW TEST        ');
  console.log('================================================================\n');

  // Create isolated sandbox workspace
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sentinel-ipc-test-'));
  
  try {
    // 1. Set up a Python test workspace with pytest and cart_calculator.py
    const pytestIni = path.join(tempDir, 'pytest.ini');
    fs.writeFileSync(pytestIni, '[pytest]\n');

    const cartCalc = path.join(tempDir, 'cart_calculator.py');
    fs.writeFileSync(cartCalc, 'def calculate_total(items):\n    return sum(item["price"] for item in items)\n');

    const testsDir = path.join(tempDir, 'tests');
    fs.mkdirSync(testsDir, { recursive: true });

    const testCartCalc = path.join(testsDir, 'test_cart_calculator.py');
    fs.writeFileSync(testCartCalc, 'from cart_calculator import calculate_total\n\ndef test_calculate_total():\n    assert calculate_total([{"price": 10}, {"price": 20}]) == 30\n');

    // 2. Initialize HarnessRuntime
    const runtime = new HarnessRuntime({
      baseDir: path.join(tempDir, '.nexus_harness'),
    });

    // Mock Electron BrowserWindow & webContents
    const dispatchedIpcEvents = [];
    const mockWebContents = {
      send: (channel, payload) => {
        dispatchedIpcEvents.push({ channel, payload });
      },
    };

    // Wire up main.js event subscription logic
    runtime.subscribe((event) => {
      // Forward harness event
      mockWebContents.send('harness:event', event);

      // Forward test verification status directly to 'ai:test-verification-status'
      if (
        event &&
        (event.type === 'ai:test-verification-status' ||
          event.type === 'TEST_VERIFICATION_STATUS' ||
          event.type === (EVENT_TYPES && EVENT_TYPES.TEST_VERIFICATION_STATUS))
      ) {
        const payload =
          event.payload && (event.payload.status || event.payload.badge || event.payload.display)
            ? event.payload
            : (event.payload?.data || event);
        mockWebContents.send('ai:test-verification-status', payload);
      }
    });

    // Mock Preload listener callback (as subscribed by CodexBottomComposer)
    const composerReceivedStatuses = [];
    const preloadOnTestVerificationStatus = (callback) => {
      // Handler simulating ipcRenderer.on('ai:test-verification-status')
      return (channel, data) => {
        if (channel === 'ai:test-verification-status') {
          callback(data);
        }
      };
    };

    const composerListener = (statusData) => {
      composerReceivedStatuses.push(statusData);
    };
    const ipcHandler = preloadOnTestVerificationStatus(composerListener);

    // TEST 1: Execute a simulated AI mutation turn via AgentLoop
    console.log('[TEST 1] AI mutation with targeted tests triggers PostMutationSentinel and dispatches IPC status');
    
    // Mock model adapter that returns an edit_file / apply_patch tool call followed by completion
    let stepCount = 0;
    const mockModelHandler = async ({ messages }) => {
      stepCount++;
      if (stepCount === 1) {
        // Return apply_patch tool call modifying cart_calculator.py
        return {
          role: 'assistant',
          content: 'Adding test marker comment to cart_calculator.py',
          toolCalls: [
            {
              type: 'tool_call',
              callId: 'call_edit_cart_01',
              toolName: 'apply_patch',
              arguments: {
                edits: [
                  {
                    filePath: 'cart_calculator.py',
                    original: 'def calculate_total(items):',
                    replacement: '# Tested by NEXUS\ndef calculate_total(items):',
                  },
                ],
              },
            },
          ],
        };
      } else {
        // Final completion text
        return {
          role: 'assistant',
          content: 'Added # Tested by NEXUS to cart_calculator.py successfully.',
          toolCalls: [],
        };
      }
    };

    // Hook mockWebContents to invoke preload handler
    const originalSend = mockWebContents.send;
    mockWebContents.send = (channel, payload) => {
      originalSend(channel, payload);
      ipcHandler(channel, payload);
    };

    const mockExecutor = {
      runTests: async (params) => {
        return {
          status: 'PASSED',
          exitCode: 0,
          passed: 1,
          failed: 0,
          total: 1,
          durationMs: 45,
          stdout: 'collected 1 item\ntests/test_cart_calculator.py . [100%]\n1 passed in 0.04s',
          stderr: '',
          timedOut: false,
          cancelled: false,
        };
      },
    };

    const thread1 = runtime.createThread({
      userInput: 'Add # Tested by NEXUS comment to cart_calculator.py',
      metadata: { workspacePath: tempDir },
    });

    const turnOutcome = await runtime.runTurn({
      threadId: thread1.threadId,
      userInput: 'Add # Tested by NEXUS comment to cart_calculator.py',
      workspacePath: tempDir,
      modelHandler: mockModelHandler,
      approvalMode: 'auto',
      options: { testExecutor: mockExecutor },
    });

    assert.strictEqual(turnOutcome.success, true, 'Turn must succeed');
    assert.ok(turnOutcome.testVerification, 'Turn outcome must include testVerification object');
    assert.strictEqual(turnOutcome.testVerification.verified, true, 'testVerification must be verified');

    // Verify composer received test verification progress events
    const verifyingEvent = composerReceivedStatuses.find(s => s.status === 'VERIFYING');
    assert.ok(verifyingEvent, 'Composer must receive VERIFYING status event ("⏳ Verifying Tests...")');
    assert.strictEqual(verifyingEvent.display, '⏳ Verifying Tests...');

    const passedEvent = composerReceivedStatuses.find(s => s.status === 'PASSED');
    assert.ok(passedEvent, 'Composer must receive PASSED status event ("✓ Tests Passed (1/1)")');
    assert.ok(passedEvent.display.includes('✓ Tests Passed'), `Display must indicate passed tests, got: ${passedEvent.display}`);

    console.log('  ✓ Verified VERIFYING event received:', verifyingEvent.display);
    console.log('  ✓ Verified PASSED event received:', passedEvent.display);
    console.log('[PASS] Test 1: Full AI mutation -> PostMutationSentinel -> IPC -> Composer pipeline verified\n');

    // TEST 2: AI mutation with NO matching tests reports honest fallback status
    console.log('[TEST 2] AI mutation with no matching tests dispatches NO_TESTS_FOUND status to Composer');
    composerReceivedStatuses.length = 0; // reset

    // Create an un-tested file
    const standaloneScript = path.join(tempDir, 'scripts', 'build_manifest.py');
    fs.mkdirSync(path.join(tempDir, 'scripts'), { recursive: true });
    fs.writeFileSync(standaloneScript, 'print("Manifest created")\n');

    let stepCount2 = 0;
    const mockModelHandler2 = async ({ messages }) => {
      stepCount2++;
      if (stepCount2 === 1) {
        return {
          role: 'assistant',
          content: 'Updating build_manifest.py',
          toolCalls: [
            {
              type: 'tool_call',
              callId: 'call_edit_manifest_01',
              toolName: 'apply_patch',
              arguments: {
                edits: [
                  {
                    filePath: 'scripts/build_manifest.py',
                    original: 'print("Manifest created")',
                    replacement: 'print("Manifest created v2")',
                  },
                ],
              },
            },
          ],
        };
      } else {
        return {
          role: 'assistant',
          content: 'Updated build_manifest.py.',
          toolCalls: [],
        };
      }
    };

    const thread2 = runtime.createThread({
      userInput: 'Update scripts/build_manifest.py',
      metadata: { workspacePath: tempDir },
    });

    const turnOutcome2 = await runtime.runTurn({
      threadId: thread2.threadId,
      userInput: 'Update scripts/build_manifest.py',
      workspacePath: tempDir,
      modelHandler: mockModelHandler2,
      approvalMode: 'auto',
    });

    assert.strictEqual(turnOutcome2.success, true);
    const verifyingEvent2 = composerReceivedStatuses.find(s => s.status === 'VERIFYING');
    assert.ok(verifyingEvent2, 'Composer must receive VERIFYING status event prior to discovering no tests');
    assert.strictEqual(verifyingEvent2.display, '⏳ Verifying Tests...');

    const noTestsEvent = composerReceivedStatuses.find(s => s.status === 'NO_TESTS_FOUND');
    assert.ok(noTestsEvent, 'Composer must receive NO_TESTS_FOUND status');
    assert.strictEqual(noTestsEvent.display, 'Tests: Not automatically verified (No associated tests found)');

    console.log('  ✓ Verified VERIFYING event received:', verifyingEvent2.display);
    console.log('  ✓ Verified NO_TESTS_FOUND event received:', noTestsEvent.display);
    console.log('[PASS] Test 2: Non-tested mutation reports VERIFYING then honest fallback to Composer\n');

    // TEST 3: AI mutation with tests present but test runner not configured
    console.log('[TEST 3] AI mutation with tests present but no runner configured dispatches honest fallback to Composer');
    composerReceivedStatuses.length = 0; // reset

    // Create a new subfolder with a test file but remove pytest.ini or test runner markers
    const noRunnerDir = path.join(tempDir, 'no_runner_subproject');
    fs.mkdirSync(noRunnerDir, { recursive: true });
    const dummySrc = path.join(noRunnerDir, 'service.py');
    fs.writeFileSync(dummySrc, 'def run(): pass\n');
    const dummyTest = path.join(noRunnerDir, 'test_service.py');
    fs.writeFileSync(dummyTest, 'def test_run(): pass\n');

    const thread3 = runtime.createThread({
      userInput: 'Update service.py',
      metadata: { workspacePath: noRunnerDir },
    });

    let stepCount3 = 0;
    const mockModelHandler3 = async () => {
      stepCount3++;
      if (stepCount3 === 1) {
        return {
          role: 'assistant',
          content: 'Mutating service.py',
          toolCalls: [
            {
              type: 'tool_call',
              callId: 'call_edit_service_01',
              toolName: 'apply_patch',
              arguments: {
                edits: [
                  {
                    filePath: 'service.py',
                    original: 'def run(): pass',
                    replacement: 'def run(): return True',
                  },
                ],
              },
            },
          ],
        };
      } else {
        return {
          role: 'assistant',
          content: 'Updated service.py successfully.',
          toolCalls: [],
        };
      }
    };

    const turnOutcome3 = await runtime.runTurn({
      threadId: thread3.threadId,
      userInput: 'Update service.py',
      workspacePath: noRunnerDir,
      modelHandler: mockModelHandler3,
      approvalMode: 'auto',
      options: {
        testExecutor: {
          runTests: async () => {
            throw new Error('Should not run test executor when runner is not detected');
          },
        },
      },
    });

    assert.strictEqual(turnOutcome3.success, true);
    const verifyingEvent3 = composerReceivedStatuses.find(s => s.status === 'VERIFYING');
    assert.ok(verifyingEvent3, 'Composer must receive VERIFYING status event prior to runner check');

    const runnerNotDetectedEvent = composerReceivedStatuses.find(
      s => s.status === 'RUNNER_NOT_DETECTED' || s.status === 'TESTS_NOT_CONFIGURED' || s.status === 'NO_TESTS_FOUND'
    );
    assert.ok(runnerNotDetectedEvent, 'Composer must receive unconfigured runner / honest fallback event');
    assert.ok(
      runnerNotDetectedEvent.display.includes('Tests: Not automatically verified'),
      `Display must contain honest unverified text, got: "${runnerNotDetectedEvent.display}"`
    );

    console.log('  ✓ Verified VERIFYING event received:', verifyingEvent3.display);
    console.log('  ✓ Verified unconfigured runner event received:', runnerNotDetectedEvent.display);
    console.log('[PASS] Test 3: Unconfigured test runner reports honest fallback to Composer\n');

    console.log('================================================================');
    console.log('  RESULTS: 3/3 POST-MUTATION SENTINEL IPC TESTS PASSED (100%)  ');
    console.log('================================================================');
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {}
  }
}

runTest().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
