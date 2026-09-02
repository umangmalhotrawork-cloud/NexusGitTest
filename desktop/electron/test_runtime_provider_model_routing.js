/**
 * NEXUS TEST SUITE — RUNTIME PROVIDER & MODEL ROUTING CONSISTENCY
 * 
 * Verifies:
 * 1. Selected provider = nexus6/groq -> submit task -> runtime provider remains nexus6/groq
 * 2. Selected DeepSeek -> runtime DeepSeek
 * 3. Selected Groq -> runtime Groq
 * 4. 401 / Auth error -> strictly NO failover (immediate honest failure with primary identity)
 * 5. 429 / Rate limit -> allowed failover to configured fallback candidate
 * 6. Failover event emitted ONLY when failover actually occurs (never on normal or 401 runs)
 * 7. No stale provider/model state between consecutive tasks
 * 8. User's persisted preferred provider/model remains completely unaltered by failover
 */

const assert = require('assert');
const { ModelAdapter } = require('./harness/ModelAdapter');
const { AIProviderRouter } = require('./ai/AIProviderRouter');
const { PROVIDER_IDS } = require('./ai/types');

async function runRoutingTestSuite() {
  console.log('================================================================');
  console.log('  NEXUS — RUNTIME PROVIDER & MODEL ROUTING CONSISTENCY TESTS   ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
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

  function createMockRouter(configs = {}) {
    const router = new AIProviderRouter();
    router.apiKeys.clear();
    router.keyValidationStatus.clear();

    for (const [pId, pConf] of Object.entries(configs)) {
      router.apiKeys.set(pId, pConf.apiKey || `mock-key-${pId}`);
      const prov = router.providers.get(pId);
      if (prov) {
        prov.discoverModels = async () => [];
      }
      if (pConf.modelId) {
        router.setConfig(pId, pConf.modelId);
      }
    }
    return router;
  }

  // -------------------------------------------------------------------------
  // Test 1: selected provider = nexus6 (Groq) -> runtime provider remains nexus6
  // -------------------------------------------------------------------------
  await test('Selected NEXUS 6 (Groq) uses NEXUS 6 configured model at runtime', async () => {
    const router = createMockRouter({
      nexus6: { apiKey: 'mock_groq_key_1', modelId: 'openai/gpt-oss-120b' },
      deepseek: { apiKey: 'mock_deepseek_key_1', modelId: 'deepseek-coder' },
    });

    let invokedProviderId = null;
    let invokedModelId = null;
    let failoverEvents = [];

    const mockGroq = router.providers.get('nexus6');
    mockGroq.request = async (endpoint, method, key, payload) => {
      invokedProviderId = 'nexus6';
      invokedModelId = payload?.model;
      return {
        statusCode: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'Groq response' } }],
        },
      };
    };

    const adapter = new ModelAdapter(router);
    adapter.emitFailoverEvent = (evt) => failoverEvents.push(evt);

    const res = await adapter.invoke([{ role: 'user', content: 'Write hello' }], [], {
      providerId: 'nexus6',
      modelId: 'openai/gpt-oss-120b',
    });

    assert.strictEqual(invokedProviderId, 'nexus6', 'Must invoke nexus6');
    assert.strictEqual(invokedModelId, 'openai/gpt-oss-120b', 'Must invoke openai/gpt-oss-120b');
    assert.strictEqual(res.content, 'Groq response');
    assert.strictEqual(failoverEvents.length, 0, 'No failover event on successful request');
  });

  // -------------------------------------------------------------------------
  // Test 2: selected DeepSeek -> runtime DeepSeek
  // -------------------------------------------------------------------------
  await test('Selected DeepSeek uses DeepSeek at runtime', async () => {
    const router = createMockRouter({
      nexus6: { apiKey: 'mock_groq_key_1', modelId: 'openai/gpt-oss-120b' },
      deepseek: { apiKey: 'mock_deepseek_key_1', modelId: 'deepseek-coder' },
    });

    let invokedProviderId = null;
    let invokedModelId = null;

    const mockDeepSeek = router.providers.get('deepseek');
    mockDeepSeek.request = async (endpoint, method, key, payload) => {
      invokedProviderId = 'deepseek';
      invokedModelId = payload?.model;
      return {
        statusCode: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'DeepSeek response' } }],
        },
      };
    };

    const adapter = new ModelAdapter(router);
    const res = await adapter.invoke([{ role: 'user', content: 'Write code' }], [], {
      providerId: 'deepseek',
      modelId: 'deepseek-coder',
    });

    assert.strictEqual(invokedProviderId, 'deepseek', 'Must invoke deepseek');
    assert.strictEqual(invokedModelId, 'deepseek-coder', 'Must invoke deepseek-coder');
    assert.strictEqual(res.content, 'DeepSeek response');
  });

  // -------------------------------------------------------------------------
  // Test 3: selected Groq -> runtime Groq
  // -------------------------------------------------------------------------
  await test('Selected Groq uses Groq at runtime', async () => {
    const router = createMockRouter({
      groq: { apiKey: 'mock_groq_key_standalone', modelId: 'openai/gpt-oss-120b' },
    });

    let invokedProviderId = null;
    const mockGroq = router.providers.get('groq');
    mockGroq.request = async (endpoint, method, key, payload) => {
      invokedProviderId = 'groq';
      return {
        statusCode: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'Groq standalone response' } }],
        },
      };
    };

    const adapter = new ModelAdapter(router);
    const res = await adapter.invoke([{ role: 'user', content: 'Hello' }], [], {
      providerId: 'groq',
      modelId: 'openai/gpt-oss-120b',
    });

    assert.strictEqual(invokedProviderId, 'groq', 'Must invoke standalone groq');
    assert.strictEqual(res.content, 'Groq standalone response');
  });

  // -------------------------------------------------------------------------
  // Test 4: 401 / Auth Error -> strictly NO failover
  // -------------------------------------------------------------------------
  await test('401 Authentication Error strictly aborts without failover', async () => {
    const router = createMockRouter({
      nexus6: { apiKey: 'invalid_groq_key', modelId: 'openai/gpt-oss-120b' },
      deepseek: { apiKey: 'valid_deepseek_key', modelId: 'deepseek-coder' },
    });

    let deepSeekInvoked = false;
    let failoverEvents = [];

    const mockGroq = router.providers.get('nexus6');
    mockGroq.request = async () => {
      const err = new Error('Authentication Fails, Your api key is invalid');
      err.statusCode = 401;
      err.providerId = 'nexus6';
      err.modelId = 'openai/gpt-oss-120b';
      throw err;
    };

    const mockDeepSeek = router.providers.get('deepseek');
    mockDeepSeek.request = async () => {
      deepSeekInvoked = true;
      return { statusCode: 200, data: { choices: [{ message: { content: 'Should not run' } }] } };
    };

    const adapter = new ModelAdapter(router);
    adapter.emitFailoverEvent = (evt) => failoverEvents.push(evt);

    let caughtErr = null;
    try {
      await adapter.invoke([{ role: 'user', content: 'Hello' }], [], {
        providerId: 'nexus6',
        modelId: 'openai/gpt-oss-120b',
      });
    } catch (e) {
      caughtErr = e;
    }

    assert(caughtErr !== null, 'Must throw on 401 auth error');
    assert.strictEqual(caughtErr.statusCode, 401);
    assert.strictEqual(deepSeekInvoked, false, 'DeepSeek fallback must NOT be invoked on 401');
    assert.strictEqual(failoverEvents.length, 0, 'No failover event emitted for 401 auth error');
  });

  // -------------------------------------------------------------------------
  // Test 5: 429 / Rate Limit -> allowed failover
  // -------------------------------------------------------------------------
  await test('429 Rate Limit error triggers allowed auto-failover', async () => {
    const router = createMockRouter({
      nexus6: { apiKey: 'rate_limited_groq_key', modelId: 'openai/gpt-oss-120b' },
      deepseek: { apiKey: 'valid_deepseek_key', modelId: 'deepseek-coder' },
    });

    let failoverEvents = [];
    let fallbackInvoked = false;

    const mockGroq = router.providers.get('nexus6');
    mockGroq.request = async () => {
      const err = new Error('Rate limit exceeded: 429 too many requests');
      err.statusCode = 429;
      err.isRateLimit = true;
      err.providerId = 'nexus6';
      err.modelId = 'openai/gpt-oss-120b';
      throw err;
    };

    const mockDeepSeek = router.providers.get('deepseek');
    mockDeepSeek.request = async (endpoint, method, key, payload) => {
      fallbackInvoked = true;
      return {
        statusCode: 200,
        data: {
          choices: [{ message: { role: 'assistant', content: 'DeepSeek fallback response' } }],
        },
      };
    };

    const adapter = new ModelAdapter(router);
    adapter.emitFailoverEvent = (evt) => failoverEvents.push(evt);

    const res = await adapter.invoke([{ role: 'user', content: 'Do refactor' }], [], {
      providerId: 'nexus6',
      modelId: 'openai/gpt-oss-120b',
    });

    assert.strictEqual(fallbackInvoked, true, 'Fallback provider must be invoked on 429');
    assert.strictEqual(failoverEvents.length, 1, 'Failover event must be emitted on 429');
    assert.strictEqual(failoverEvents[0].primaryProviderId, 'nexus6');
    assert.strictEqual(failoverEvents[0].fallbackProviderId, 'deepseek');
    assert.strictEqual(failoverEvents[0].failureCategory, '429_RATE_LIMIT');
    assert.strictEqual(res.execution?.isFallback, true, 'Execution metadata must indicate isFallback: true');
    assert.strictEqual(res.execution?.providerId, 'deepseek');
    assert.strictEqual(res.execution?.requestedProviderId, 'nexus6');
  });

  // -------------------------------------------------------------------------
  // Test 6: Failover event emitted ONLY when failover occurs
  // -------------------------------------------------------------------------
  await test('Failover event is never emitted for non-failover requests', async () => {
    const router = createMockRouter({
      nexus6: { apiKey: 'valid_groq_key', modelId: 'openai/gpt-oss-120b' },
    });

    let failoverEvents = [];
    const mockGroq = router.providers.get('nexus6');
    mockGroq.request = async () => ({
      statusCode: 200,
      data: { choices: [{ message: { role: 'assistant', content: 'Normal response' } }] },
    });

    const adapter = new ModelAdapter(router);
    adapter.emitFailoverEvent = (evt) => failoverEvents.push(evt);

    await adapter.invoke([{ role: 'user', content: 'Prompt' }], [], {
      providerId: 'nexus6',
      modelId: 'openai/gpt-oss-120b',
    });

    assert.strictEqual(failoverEvents.length, 0, 'Must not emit failover event on normal success');
  });

  // -------------------------------------------------------------------------
  // Test 7: No stale provider/model state between consecutive tasks
  // -------------------------------------------------------------------------
  await test('No stale provider or model state leaks across consecutive tasks', async () => {
    const router = createMockRouter({
      nexus6: { apiKey: 'key_nexus6', modelId: 'openai/gpt-oss-120b' },
      deepseek: { apiKey: 'key_deepseek', modelId: 'deepseek-coder' },
      nexus1: { apiKey: 'key_nexus1', modelId: 'gemini-2.5-flash' },
    });

    const executionLog = [];

    router.providers.get('nexus6').request = async () => {
      executionLog.push({ provider: 'nexus6', model: 'openai/gpt-oss-120b' });
      return { statusCode: 200, data: { choices: [{ message: { content: 'nexus6 done' } }] } };
    };

    router.providers.get('deepseek').request = async () => {
      executionLog.push({ provider: 'deepseek', model: 'deepseek-coder' });
      return { statusCode: 200, data: { choices: [{ message: { content: 'deepseek done' } }] } };
    };

    router.providers.get('nexus1').generateAgentPlan = async () => {
      executionLog.push({ provider: 'nexus1', model: 'gemini-2.5-flash' });
      return { summary: 'nexus1 done' };
    };

    const adapter = new ModelAdapter(router);

    // Task 1: user selected nexus6
    await adapter.invoke([{ role: 'user', content: 'Task 1' }], [], {
      providerId: 'nexus6',
      modelId: 'openai/gpt-oss-120b',
    });

    // Task 2: user selected deepseek
    await adapter.invoke([{ role: 'user', content: 'Task 2' }], [], {
      providerId: 'deepseek',
      modelId: 'deepseek-coder',
    });

    // Task 3: user selected nexus6 again
    await adapter.invoke([{ role: 'user', content: 'Task 3' }], [], {
      providerId: 'nexus6',
      modelId: 'openai/gpt-oss-120b',
    });

    assert.deepStrictEqual(executionLog, [
      { provider: 'nexus6', model: 'openai/gpt-oss-120b' },
      { provider: 'deepseek', model: 'deepseek-coder' },
      { provider: 'nexus6', model: 'openai/gpt-oss-120b' },
    ], 'Each task must execute with its explicitly requested provider/model');
  });

  // -------------------------------------------------------------------------
  // Test 8: User's persisted preferred provider/model unaltered by failover
  // -------------------------------------------------------------------------
  await test('User preferred provider/model selection is untouched after failover', async () => {
    const router = createMockRouter({
      nexus6: { apiKey: 'key_nexus6', modelId: 'openai/gpt-oss-120b' },
      deepseek: { apiKey: 'key_deepseek', modelId: 'deepseek-coder' },
    });

    router.activeProviderId = 'nexus6';
    router.activeModelId = 'openai/gpt-oss-120b';

    const mockGroq = router.providers.get('nexus6');
    mockGroq.request = async () => {
      const err = new Error('429 Rate limit exceeded');
      err.statusCode = 429;
      err.isRateLimit = true;
      throw err;
    };

    const mockDeepSeek = router.providers.get('deepseek');
    mockDeepSeek.request = async () => ({
      statusCode: 200,
      data: { choices: [{ message: { content: 'fallback ok' } }] },
    });

    const adapter = new ModelAdapter(router);
    await adapter.invoke([{ role: 'user', content: 'Failover task' }], [], {
      providerId: 'nexus6',
      modelId: 'openai/gpt-oss-120b',
    });

    assert.strictEqual(router.activeProviderId, 'nexus6', 'Active provider must remain nexus6');
    assert.strictEqual(router.activeModelId, 'openai/gpt-oss-120b', 'Active model must remain openai/gpt-oss-120b');
    assert.strictEqual(router.getSelectedModelId('nexus6'), 'openai/gpt-oss-120b', 'Slot model must remain openai/gpt-oss-120b');
  });

  // -------------------------------------------------------------------------
  // Test 9: Streaming 401 re-throws immediately without invoke() failover
  // -------------------------------------------------------------------------
  await test('Streaming 401 re-throws immediately without triggering non-streaming failover', async () => {
    const router = createMockRouter({
      nexus6: { apiKey: 'key_invalid', modelId: 'openai/gpt-oss-120b' },
      deepseek: { apiKey: 'key_deepseek', modelId: 'deepseek-coder' },
    });

    let deepSeekCalled = false;
    const mockGroq = router.providers.get('nexus6');
    mockGroq.streamChatCompletions = async function* () {
      const err = new Error('Authentication Fails, Your api key is invalid');
      err.statusCode = 401;
      throw err;
    };

    const mockDeepSeek = router.providers.get('deepseek');
    mockDeepSeek.request = async () => {
      deepSeekCalled = true;
      return { statusCode: 200, data: { choices: [{ message: { content: 'Never' } }] } };
    };

    const adapter = new ModelAdapter(router);
    let caught = null;

    try {
      const gen = adapter.stream([{ role: 'user', content: 'Test stream' }], [], {
        providerId: 'nexus6',
        modelId: 'openai/gpt-oss-120b',
      });
      for await (const _ of gen) {}
    } catch (e) {
      caught = e;
    }

    assert(caught !== null, 'Streaming 401 must throw');
    assert.strictEqual(caught.statusCode, 401);
    assert.strictEqual(deepSeekCalled, false, 'DeepSeek must not be called when streaming encounters 401');
  });

  console.log('\n================================================================');
  console.log(`  ROUTING CONSISTENCY RESULTS: ${passed}/${total} PASS (${Math.round((passed/total)*100)}%)`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runRoutingTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
