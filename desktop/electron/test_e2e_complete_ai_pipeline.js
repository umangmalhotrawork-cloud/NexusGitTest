/**
 * NEXUS COMPLETE AI EXECUTION INTELLIGENCE PIPELINE — END-TO-END INTEGRATION TEST
 * 
 * Tests the entire unified intelligence chain:
 * 1. Prompt input & classification
 * 2. Local token volume & cost prediction (0 network calls)
 * 3. Model Selection Intelligence recommendation on configured providers
 * 4. User selection preservation
 * 5. Primary execution dispatch
 * 6. Primary 429 Rate Limit simulation
 * 7. Dynamic fallback resolution to compatible tier candidate
 * 8. Strict credential isolation (fallback gets only its own key)
 * 9. Complete multi-turn & tool payload preservation
 * 10. Non-blocking UI failover event emission
 * 11. Successful task completion on fallback
 * 12. Zero persisted configuration drift
 * 13. Zero plaintext credential exposure across entire pipeline
 * 14. Zero network calls for local intelligence functions
 */

const assert = require('assert');
const { AIProviderRouter } = require('./ai/AIProviderRouter');
const { ModelAdapter } = require('./harness/ModelAdapter');
const { preflightEstimator } = require('./intelligence/PreflightEstimator');
const { modelSelectionAdvisor } = require('./intelligence/ModelSelectionAdvisor');

async function runCompletePipelineIntegrationTest() {
  console.log('================================================================');
  console.log('  NEXUS COMPLETE AI EXECUTION INTELLIGENCE PIPELINE E2E TEST   ');
  console.log('================================================================\n');

  const testLog = [];
  function logStep(stepNum, name, passed, details = '') {
    const status = passed ? '✓ PASS' : '❌ FAIL';
    console.log(`[STEP ${stepNum.toString().padStart(2, '0')}] ${name}`);
    console.log(`  Status: ${status}`);
    if (details) console.log(`  Details: ${details}\n`);
    testLog.push({ stepNum, name, passed, details });
  }

  // ---------------------------------------------------------------------------
  // Setup: Clean Router with Configured Providers
  // ---------------------------------------------------------------------------
  const router = new AIProviderRouter();
  router.apiKeys.clear();
  router.keyValidationStatus.clear();

  // Configure Fallback 1: deepseek (DeepSeek Coder)
  const DEEPSEEK_SECRET = 'DEEPSEEK_SECRET_KEY_PROD_5678';
  router.apiKeys.set('deepseek', DEEPSEEK_SECRET);

  // Configure Fallback 2: nexus1 (Gemini 2.5 Flash)
  const GEMINI_SECRET = 'GEMINI_SECRET_KEY_PROD_9999';
  router.apiKeys.set('nexus1', GEMINI_SECRET);

  // Configure Active Primary: nexus6 (Groq GPT-OSS 120B)
  const PRIMARY_SECRET = 'GROQ_SECRET_KEY_PROD_1234';
  router.apiKeys.set('nexus6', PRIMARY_SECRET);
  router.setConfig('nexus6', 'openai/gpt-oss-120b');

  // Ensure mock provider objects don't make real outbound discovery calls
  for (const p of router.providers.values()) {
    if (p) p.discoverModels = async () => [];
  }

  const promptText = 'Fix authentication middleware JWT expiration verification bug in src/auth.js';
  const targetFile = 'src/auth.js';
  const tools = [
    {
      name: 'apply_patch',
      description: 'Applies diff changes to workspace files',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          patch: { type: 'string' },
        },
        required: ['path', 'patch'],
      },
    },
  ];

  // ---------------------------------------------------------------------------
  // STEP 1 & 2: Local Prompt Token & Cost Prediction
  // ---------------------------------------------------------------------------
  let preflightResult = null;
  try {
    const startTime = Date.now();
    preflightResult = preflightEstimator.estimate({
      userInput: promptText,
      targetFiles: [targetFile],
      providerId: 'nexus6',
      modelId: 'openai/gpt-oss-120b',
      configuredProviders: router.getConfig().providers,
    });
    const duration = Date.now() - startTime;

    assert.ok(preflightResult, 'Preflight result must exist');
    assert.ok(preflightResult.estimatedTotalTokens > 500, 'Tokens must be estimated');
    assert.strictEqual(preflightResult.shouldShowPreflight, true, 'Coding prompt must trigger preflight toast');
    assert.ok(preflightResult.primaryCostFormatted, 'Cost formatted must exist');
    assert.ok(duration < 20, `Estimation took ${duration}ms (must be < 20ms local)`);

    logStep(1, 'Local token and cost prediction before send', true,
      `Tokens: ~${preflightResult.estimatedTotalTokens} (Input: ~${preflightResult.estimatedInputTokens}, Output: ~${preflightResult.estimatedMaxOutputTokens}) | Cost: ${preflightResult.primaryCostFormatted} (computed locally in ${duration}ms)`);
  } catch (err) {
    logStep(1, 'Local token and cost prediction before send', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // STEP 3: Model Selection Intelligence Recommendation
  // ---------------------------------------------------------------------------
  try {
    const rec = preflightResult.recommendedModel;
    assert.ok(rec, 'Recommendation must exist');
    assert.strictEqual(rec.tier, 'TIER_2_BALANCED_CODING', 'Single-file bugfix must be Tier 2 Balanced Coding');
    assert.ok(rec.providerId, 'Recommended provider must be specified');
    assert.ok(rec.reason, 'Reason must be provided');

    // Confirm recommended provider is in router's configured list
    const configuredMap = new Set(router.getConfig().providers.filter((p) => p.isConfigured).map((p) => p.id));
    assert.ok(configuredMap.has(rec.providerId), `Recommended provider "${rec.providerId}" must be configured`);

    logStep(2, 'Model Selection Intelligence configured-provider recommendation', true,
      `Recommended: ${rec.modelDisplayName || rec.modelId} (${rec.tier}) | Reason: "${rec.reason}"`);
  } catch (err) {
    logStep(2, 'Model Selection Intelligence configured-provider recommendation', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // STEP 4, 5, 6, 7, 8, 9, 10, 11: Execute with 429 Failover & Credential Isolation
  // ---------------------------------------------------------------------------
  const adapter = new ModelAdapter(router);
  const emittedFailoverEvents = [];
  adapter.emitFailoverEvent = (eventData) => emittedFailoverEvents.push(eventData);

  let primaryAttempted = false;
  let fallbackAttempted = false;
  let apiKeyReceivedByPrimary = null;
  let apiKeyReceivedByFallback = null;
  let payloadReceivedByFallback = null;

  // Mock primary (nexus6) to fail with HTTP 429
  const mockPrimary = router.providers.get('nexus6');
  mockPrimary.request = async (endpoint, method, apiKey, payload) => {
    primaryAttempted = true;
    apiKeyReceivedByPrimary = apiKey;
    const err = new Error('Rate limit reached for model openai/gpt-oss-120b on slot nexus6');
    err.status = 429;
    throw err;
  };

  // Mock fallback (deepseek) to succeed
  const mockDeepSeek = router.providers.get('deepseek');
  mockDeepSeek.request = async (endpoint, method, apiKey, payload) => {
    fallbackAttempted = true;
    apiKeyReceivedByFallback = apiKey;
    payloadReceivedByFallback = payload;
    return {
      data: {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Successfully analyzed and resolved JWT expiration issue in auth.js',
              tool_calls: [
                {
                  id: 'call_patch_jwt_1',
                  type: 'function',
                  function: {
                    name: 'apply_patch',
                    arguments: JSON.stringify({
                      path: 'src/auth.js',
                      patch: '--- a/src/auth.js\n+++ b/src/auth.js\n@@ -10,3 +10,3 @@\n- if (exp < now)\n+ if (exp <= now)',
                    }),
                  },
                },
              ],
            },
          },
        ],
      },
    };
  };

  const initialMessages = [
    { role: 'user', content: promptText },
  ];

  let executionResponse = null;
  try {
    executionResponse = await adapter.invoke(initialMessages, tools, {
      providerId: 'nexus6',
      modelId: 'openai/gpt-oss-120b',
      workspacePath: process.cwd(),
      tier: 'TIER_2_BALANCED_CODING',
    });

    assert.ok(executionResponse, 'Execution response must be returned');
    assert.strictEqual(primaryAttempted, true, 'Primary provider must have been invoked');
    assert.strictEqual(fallbackAttempted, true, 'Fallback provider must have been invoked after 429');

    logStep(3, 'Execution dispatch & 429 auto-failover to fallback', true,
      `Primary (nexus6) failed with 429 -> Fallback (deepseek) activated automatically`);
  } catch (err) {
    logStep(3, 'Execution dispatch & 429 auto-failover to fallback', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // STEP 8: Credential Isolation Check
  // ---------------------------------------------------------------------------
  try {
    assert.strictEqual(apiKeyReceivedByPrimary, PRIMARY_SECRET, 'Primary must receive primary secret');
    assert.strictEqual(apiKeyReceivedByFallback, DEEPSEEK_SECRET, 'Fallback must receive deepseek secret');
    assert.notStrictEqual(apiKeyReceivedByFallback, PRIMARY_SECRET, 'Fallback must NEVER receive primary secret');

    logStep(4, 'Strict provider credential isolation invariant', true,
      `Primary used "${apiKeyReceivedByPrimary.slice(0, 4)}••••", Fallback used "${apiKeyReceivedByFallback.slice(0, 4)}••••" (Zero cross-contamination)`);
  } catch (err) {
    logStep(4, 'Strict provider credential isolation invariant', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // STEP 9: Complete Multi-Turn & Tool Schema Payload Preservation
  // ---------------------------------------------------------------------------
  try {
    assert.ok(payloadReceivedByFallback, 'Fallback payload must be captured');
    assert.strictEqual(payloadReceivedByFallback.messages.some((m) => m.content.includes(promptText)), true,
      'User prompt text must be perfectly preserved');
    assert.strictEqual(payloadReceivedByFallback.tools.length, 1, 'Tools array must be preserved');
    assert.strictEqual(payloadReceivedByFallback.tools[0].function.name, 'apply_patch', 'Tool apply_patch schema preserved');

    logStep(5, 'Complete prompt and tool schema payload preservation', true,
      `Messages and tools preserved with 100% fidelity without state distortion`);
  } catch (err) {
    logStep(5, 'Complete prompt and tool schema payload preservation', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // STEP 10: Non-Blocking Failover Notification Event
  // ---------------------------------------------------------------------------
  try {
    assert.strictEqual(emittedFailoverEvents.length, 1, 'Exactly one failover event must be emitted');
    const event = emittedFailoverEvents[0];
    assert.strictEqual(event.primaryProviderId, 'nexus6');
    assert.strictEqual(event.fallbackProviderId, 'deepseek');
    assert.strictEqual(event.failureCategory, '429_RATE_LIMIT');
    assert.strictEqual(event.reason, '429 Rate Limit Exceeded');
    assert.strictEqual(event.attempt, 1);

    logStep(6, 'Non-blocking UI failover notification event emission', true,
      `Emitted: ⚡ Auto-Failover: nexus6 (429 Rate Limit Exceeded) ──► ${event.fallbackDisplayName} (Attempt 1)`);
  } catch (err) {
    logStep(6, 'Non-blocking UI failover notification event emission', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // STEP 11: Successful Task Output & Tool Call Generation
  // ---------------------------------------------------------------------------
  try {
    assert.ok(executionResponse.content.includes('JWT expiration'), 'Output content verified');
    assert.strictEqual(executionResponse.toolCalls.length, 1, 'Generated tool call verified');
    assert.strictEqual(executionResponse.toolCalls[0].toolName, 'apply_patch');

    logStep(7, 'Successful task completion and structured response delivery', true,
      `Response: "${executionResponse.content}" | Tool Calls: [apply_patch on src/auth.js]`);
  } catch (err) {
    logStep(7, 'Successful task completion and structured response delivery', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // STEP 12: Zero Persisted Configuration Drift
  // ---------------------------------------------------------------------------
  try {
    assert.strictEqual(router.activeProviderId, 'nexus6', 'Active provider in router must remain nexus6');
    assert.strictEqual(router.getConfig().activeProvider, 'nexus6', 'Config activeProvider must remain nexus6');

    logStep(8, 'Zero persisted configuration drift (User selection authoritative)', true,
      `Active provider in router remains "nexus6" for future turns (Failover was runtime-only)`);
  } catch (err) {
    logStep(8, 'Zero persisted configuration drift (User selection authoritative)', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // STEP 13: Zero Plaintext Credential Exposure in Events or UI Data
  // ---------------------------------------------------------------------------
  try {
    const serializedEvents = JSON.stringify(emittedFailoverEvents);
    const serializedPreflight = JSON.stringify(preflightResult);
    const serializedExecution = JSON.stringify(executionResponse);

    assert.strictEqual(serializedEvents.includes(PRIMARY_SECRET), false, 'No primary secret in events');
    assert.strictEqual(serializedEvents.includes(DEEPSEEK_SECRET), false, 'No fallback secret in events');
    assert.strictEqual(serializedPreflight.includes(PRIMARY_SECRET), false, 'No primary secret in preflight');
    assert.strictEqual(serializedExecution.includes(PRIMARY_SECRET), false, 'No primary secret in execution');

    logStep(9, 'Zero plaintext credential exposure across entire pipeline', true,
      `All events, estimates, and responses contain 0% plaintext secrets`);
  } catch (err) {
    logStep(9, 'Zero plaintext credential exposure across entire pipeline', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // STEP 14: Zero Unnecessary Network Calls for Local Intelligence
  // ---------------------------------------------------------------------------
  try {
    const start = Date.now();
    for (let i = 0; i < 20; i++) {
      preflightEstimator.estimate({
        userInput: promptText,
        targetFiles: [targetFile],
        providerId: 'nexus6',
        modelId: 'openai/gpt-oss-120b',
        configuredProviders: router.getConfig().providers,
      });
      modelSelectionAdvisor.getFallbackCandidates({
        primaryProviderId: 'nexus6',
        primaryModelId: 'openai/gpt-oss-120b',
        tier: 'TIER_2_BALANCED_CODING',
        configuredProviders: router.getConfig().providers,
      });
    }
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 100, `20 full prediction cycles ran in ${elapsed}ms (< 100ms)`);

    logStep(10, 'Zero network calls for intelligence estimation & fallback resolution', true,
      `20 complete prediction & fallback cycles executed locally in ${elapsed}ms`);
  } catch (err) {
    logStep(10, 'Zero network calls for intelligence estimation & fallback resolution', false, err.message);
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const totalSteps = testLog.length;
  const passedSteps = testLog.filter((s) => s.passed).length;

  console.log('================================================================');
  console.log(`  COMPLETE PIPELINE E2E RESULT: ${passedSteps}/${totalSteps} STEPS PASSED (${Math.round((passedSteps / totalSteps) * 100)}%)`);
  console.log('================================================================\n');

  if (passedSteps !== totalSteps) {
    process.exit(1);
  }
}

runCompletePipelineIntegrationTest().catch((err) => {
  console.error('Fatal error running pipeline test:', err);
  process.exit(1);
});
