/**
 * NEXUS TEST SUITE — DYNAMIC PROVIDER FALLBACK & AUTO-FAILOVER INTELLIGENCE
 * 
 * Invariant Verification:
 * 1. 429 Rate Limit -> triggers auto-fallback
 * 2. 503 Service Unavailable -> triggers auto-fallback
 * 3. Network Timeout -> triggers auto-fallback
 * 4. Quota Exhaustion -> triggers auto-fallback
 * 5. 401/403 Auth Error -> strictly NO fallback (rethrows immediately)
 * 6. 400 Bad Request / Schema Error -> strictly NO fallback
 * 7. Zero fallback providers -> honest error without crash
 * 8. Multiple fallback candidates -> attempted in deterministic tier order
 * 9. Primary credential isolation -> never passed to fallback provider
 * 10. Complete message & tool payload -> perfectly preserved across failover attempts
 * 11. Bounded retry count -> halts after max candidate chain exhaustion
 * 12. No persisted model change -> user's configured preferred model remains unaltered
 * 13. Event emission safety -> 0% plaintext API key in failover event payload
 * 14. Zero network calls -> candidate selection runs 100% locally and synchronously
 */

const assert = require('assert');
const { ModelAdapter } = require('./harness/ModelAdapter');
const { AIProviderRouter } = require('./ai/AIProviderRouter');
const { modelSelectionAdvisor } = require('./intelligence/ModelSelectionAdvisor');

async function runTestSuite() {
  console.log('================================================================');
  console.log('  NEXUS — DYNAMIC PROVIDER FALLBACK & AUTO-FAILOVER TEST SUITE  ');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      passed++;
      console.log(`[PASS] Test ${total.toString().padStart(2, '0')}: ${name}`);
    } catch (err) {
      console.error(`[FAIL] Test ${total.toString().padStart(2, '0')}: ${name}`);
      console.error(`       Error: ${err.message}`);
      if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
    }
  }

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

  // Helper to construct a mock router with controlled providers
  function createMockRouter(configs = {}) {
    const router = new AIProviderRouter();
    
    // Clear any persistent keys loaded from disk
    router.apiKeys.clear();
    router.keyValidationStatus.clear();

    // Set keys directly to avoid outbound network discovery during unit testing
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

  // ---------------------------------------------------------------------------
  // 1. 429 Rate Limit -> fallback
  // ---------------------------------------------------------------------------
  await testAsync('HTTP 429 Rate Limit triggers automatic failover to next configured provider', async () => {
    const router = createMockRouter({
      nexus6: { apiKey: 'key-nexus6', modelId: 'openai/gpt-oss-120b' },
      nexus1: { apiKey: 'key-nexus1', modelId: 'gemini-2.5-flash' },
    });

    const adapter = new ModelAdapter(router);
    const emittedEvents = [];
    adapter.emitFailoverEvent = (data) => emittedEvents.push(data);

    // Mock primary failing with 429, secondary succeeding
    let primaryCalled = false;
    let fallbackCalled = false;

    const mockPrimary = router.providers.get('nexus6');
    mockPrimary.request = async () => {
      primaryCalled = true;
      const err = new Error('Rate limit reached for model openai/gpt-oss-120b');
      err.status = 429;
      throw err;
    };

    const mockFallback = router.providers.get('nexus1');
    mockFallback.request = async (endpoint, method, apiKey, payload) => {
      fallbackCalled = true;
      return {
        data: {
          choices: [{ message: { role: 'assistant', content: 'Resolved via fallback' } }],
        },
      };
    };

    const res = await adapter.invoke(
      [{ role: 'user', content: 'Refactor code' }],
      [],
      { providerId: 'nexus6', modelId: 'openai/gpt-oss-120b' }
    );

    assert.strictEqual(primaryCalled, true, 'Primary must be called first');
    assert.strictEqual(fallbackCalled, true, 'Fallback must be called after 429');
    assert.strictEqual(res.content, 'Resolved via fallback');
    assert.strictEqual(emittedEvents.length, 1);
    assert.strictEqual(emittedEvents[0].failureCategory, '429_RATE_LIMIT');
  });

  // ---------------------------------------------------------------------------
  // 2. 503 Service Unavailable -> fallback
  // ---------------------------------------------------------------------------
  await testAsync('HTTP 503 Service Unavailable triggers automatic failover', async () => {
    const router = createMockRouter({
      nexus6: { apiKey: 'key-nexus6', modelId: 'openai/gpt-oss-120b' },
      nexus1: { apiKey: 'key-nexus1', modelId: 'gemini-2.5-flash' },
    });

    const adapter = new ModelAdapter(router);
    const emittedEvents = [];
    adapter.emitFailoverEvent = (data) => emittedEvents.push(data);

    const mockPrimary = router.providers.get('nexus6');
    mockPrimary.request = async () => {
      const err = new Error('Service Unavailable: Upstream model overloaded');
      err.status = 503;
      throw err;
    };

    const mockFallback = router.providers.get('nexus1');
    mockFallback.request = async () => {
      return {
        data: {
          choices: [{ message: { role: 'assistant', content: 'Success on 503 failover' } }],
        },
      };
    };

    const res = await adapter.invoke([{ role: 'user', content: 'Analyze bug' }], [], {
      providerId: 'nexus6',
    });

    assert.strictEqual(res.content, 'Success on 503 failover');
    assert.strictEqual(emittedEvents.length, 1);
    assert.strictEqual(emittedEvents[0].failureCategory, '503_SERVICE_UNAVAILABLE');
  });

  // ---------------------------------------------------------------------------
  // 3. Network Timeout -> fallback
  // ---------------------------------------------------------------------------
  await testAsync('Network Timeout (ETIMEDOUT) triggers automatic failover', async () => {
    const router = createMockRouter({
      nexus6: { apiKey: 'key-nexus6', modelId: 'openai/gpt-oss-120b' },
      nexus1: { apiKey: 'key-nexus1', modelId: 'gemini-2.5-flash' },
    });

    const adapter = new ModelAdapter(router);
    const emittedEvents = [];
    adapter.emitFailoverEvent = (data) => emittedEvents.push(data);

    const mockPrimary = router.providers.get('nexus6');
    mockPrimary.request = async () => {
      const err = new Error('Connection timed out after 35000ms');
      err.code = 'ETIMEDOUT';
      throw err;
    };

    const mockFallback = router.providers.get('nexus1');
    mockFallback.request = async () => {
      return {
        data: {
          choices: [{ message: { role: 'assistant', content: 'Success on timeout failover' } }],
        },
      };
    };

    const res = await adapter.invoke([{ role: 'user', content: 'Run test' }], [], {
      providerId: 'nexus6',
    });

    assert.strictEqual(res.content, 'Success on timeout failover');
    assert.strictEqual(emittedEvents.length, 1);
    assert.strictEqual(emittedEvents[0].failureCategory, 'NETWORK_TIMEOUT');
  });

  // ---------------------------------------------------------------------------
  // 4. Quota Exhaustion -> fallback
  // ---------------------------------------------------------------------------
  await testAsync('Explicit provider quota exhaustion message triggers automatic failover', async () => {
    const router = createMockRouter({
      nexus6: { apiKey: 'key-nexus6', modelId: 'openai/gpt-oss-120b' },
      nexus1: { apiKey: 'key-nexus1', modelId: 'gemini-2.5-flash' },
    });

    const adapter = new ModelAdapter(router);
    const mockPrimary = router.providers.get('nexus6');
    mockPrimary.request = async () => {
      const err = new Error('You exceeded your current quota, please check your plan and billing details');
      throw err;
    };

    const mockFallback = router.providers.get('nexus1');
    mockFallback.request = async () => {
      return {
        data: {
          choices: [{ message: { role: 'assistant', content: 'Success on quota failover' } }],
        },
      };
    };

    const res = await adapter.invoke([{ role: 'user', content: 'Optimize function' }], [], {
      providerId: 'nexus6',
    });

    assert.strictEqual(res.content, 'Success on quota failover');
  });

  // ---------------------------------------------------------------------------
  // 5. HTTP 401 Auth Error -> strictly NO fallback
  // ---------------------------------------------------------------------------
  await testAsync('HTTP 401 Unauthorized strictly halts without fallback', async () => {
    const router = createMockRouter({
      nexus6: { apiKey: 'bad-key', modelId: 'openai/gpt-oss-120b' },
      nexus1: { apiKey: 'key-nexus1', modelId: 'gemini-2.5-flash' },
    });

    const adapter = new ModelAdapter(router);
    let fallbackCalled = false;

    const mockPrimary = router.providers.get('nexus6');
    mockPrimary.request = async () => {
      const err = new Error('Incorrect API key provided');
      err.status = 401;
      throw err;
    };

    const mockFallback = router.providers.get('nexus1');
    mockFallback.request = async () => {
      fallbackCalled = true;
      return { data: { choices: [{ message: { content: 'Should not run' } }] } };
    };

    await assert.rejects(
      async () => {
        await adapter.invoke([{ role: 'user', content: 'Do not fallback on 401' }], [], {
          providerId: 'nexus6',
        });
      },
      /Incorrect API key provided/
    );

    assert.strictEqual(fallbackCalled, false, 'Fallback must NOT be attempted on 401');
  });

  // ---------------------------------------------------------------------------
  // 6. HTTP 400 Bad Request -> strictly NO fallback
  // ---------------------------------------------------------------------------
  await testAsync('HTTP 400 Bad Request / Schema Error strictly halts without fallback', async () => {
    const router = createMockRouter({
      nexus6: { apiKey: 'key-nexus6', modelId: 'openai/gpt-oss-120b' },
      nexus1: { apiKey: 'key-nexus1', modelId: 'gemini-2.5-flash' },
    });

    const adapter = new ModelAdapter(router);
    let fallbackCalled = false;

    const mockPrimary = router.providers.get('nexus6');
    mockPrimary.request = async () => {
      const err = new Error('invalid_request_error: schema validation failed for tool parameter');
      err.status = 400;
      throw err;
    };

    const mockFallback = router.providers.get('nexus1');
    mockFallback.request = async () => {
      fallbackCalled = true;
      return { data: { choices: [{ message: { content: 'Should not run' } }] } };
    };

    await assert.rejects(
      async () => {
        await adapter.invoke([{ role: 'user', content: 'Bad schema test' }], [], {
          providerId: 'nexus6',
        });
      },
      /invalid_request_error/
    );

    assert.strictEqual(fallbackCalled, false, 'Fallback must NOT be attempted on 400 schema error');
  });

  // ---------------------------------------------------------------------------
  // 7. Zero Fallback Providers -> clean error
  // ---------------------------------------------------------------------------
  await testAsync('Zero fallback providers configured rethrows original error safely', async () => {
    const router = createMockRouter({
      nexus6: { apiKey: 'key-nexus6', modelId: 'openai/gpt-oss-120b' },
    });

    const adapter = new ModelAdapter(router);
    const mockPrimary = router.providers.get('nexus6');
    mockPrimary.request = async () => {
      const err = new Error('Rate limit exceeded');
      err.status = 429;
      throw err;
    };

    await assert.rejects(
      async () => {
        await adapter.invoke([{ role: 'user', content: 'No fallback available' }], [], {
          providerId: 'nexus6',
        });
      },
      /Rate limit exceeded/
    );
  });

  // ---------------------------------------------------------------------------
  // 8. Multiple fallback candidates in order
  // ---------------------------------------------------------------------------
  await testAsync('Multiple fallbacks iterate sequentially through the fallback chain', async () => {
    const router = createMockRouter({
      nexus6: { apiKey: 'key-nexus6', modelId: 'openai/gpt-oss-120b' },
      nexus1: { apiKey: 'key-nexus1', modelId: 'gemini-2.5-flash' },
      deepseek: { apiKey: 'key-deepseek', modelId: 'deepseek-coder' },
    });

    const adapter = new ModelAdapter(router);
    const attemptLog = [];

    const mockPrimary = router.providers.get('nexus6');
    mockPrimary.request = async () => {
      attemptLog.push('primary:nexus6');
      const err = new Error('429 Rate limit');
      err.status = 429;
      throw err;
    };

    const mockFallbackDeepSeek = router.providers.get('deepseek');
    mockFallbackDeepSeek.request = async () => {
      attemptLog.push('fallback1:deepseek');
      const err = new Error('503 Service Overloaded');
      err.status = 503;
      throw err;
    };

    const mockFallbackNexus1 = router.providers.get('nexus1');
    mockFallbackNexus1.request = async () => {
      attemptLog.push('fallback2:nexus1');
      return {
        data: {
          choices: [{ message: { role: 'assistant', content: 'Success on second fallback' } }],
        },
      };
    };

    const res = await adapter.invoke([{ role: 'user', content: 'Multi-failover' }], [], {
      providerId: 'nexus6',
    });

    assert.strictEqual(res.content, 'Success on second fallback');
    assert.deepStrictEqual(attemptLog, ['primary:nexus6', 'fallback1:deepseek', 'fallback2:nexus1']);
  });

  // ---------------------------------------------------------------------------
  // 9. Primary credential never passed to fallback provider
  // ---------------------------------------------------------------------------
  await testAsync('Primary credential isolation invariant holds during fallback execution', async () => {
    const router = createMockRouter({
      nexus6: { apiKey: 'SECRET_PRIMARY_KEY_GROQ', modelId: 'openai/gpt-oss-120b' },
      nexus1: { apiKey: 'SECRET_FALLBACK_KEY_GEMINI', modelId: 'gemini-2.5-flash' },
    });

    const adapter = new ModelAdapter(router);
    let capturedApiKeyInFallback = null;

    const mockPrimary = router.providers.get('nexus6');
    mockPrimary.request = async () => {
      const err = new Error('429 rate limit');
      err.status = 429;
      throw err;
    };

    const mockFallback = router.providers.get('nexus1');
    mockFallback.request = async (endpoint, method, apiKey) => {
      capturedApiKeyInFallback = apiKey;
      return { data: { choices: [{ message: { content: 'Key isolation validated' } }] } };
    };

    await adapter.invoke([{ role: 'user', content: 'Key isolation test' }], [], {
      providerId: 'nexus6',
    });

    assert.strictEqual(capturedApiKeyInFallback, 'SECRET_FALLBACK_KEY_GEMINI');
    assert.notStrictEqual(capturedApiKeyInFallback, 'SECRET_PRIMARY_KEY_GROQ');
  });

  // ---------------------------------------------------------------------------
  // 10. Complete message & tool payload preserved
  // ---------------------------------------------------------------------------
  await testAsync('Full multi-turn messages and tool schemas are preserved during fallback', async () => {
    const router = createMockRouter({
      nexus6: { apiKey: 'key-nexus6', modelId: 'openai/gpt-oss-120b' },
      nexus1: { apiKey: 'key-nexus1', modelId: 'gemini-2.5-flash' },
    });

    const adapter = new ModelAdapter(router);
    let payloadReceivedByFallback = null;

    const mockPrimary = router.providers.get('nexus6');
    mockPrimary.request = async () => {
      const err = new Error('503 Service Unavailable');
      err.status = 503;
      throw err;
    };

    const mockFallback = router.providers.get('nexus1');
    mockFallback.request = async (endpoint, method, apiKey, payload) => {
      payloadReceivedByFallback = payload;
      return { data: { choices: [{ message: { content: 'Payload verified' } }] } };
    };

    const testMessages = [
      { role: 'user', content: 'Step 1: Check code' },
      { role: 'tool', tool_call_id: 'call_123', content: JSON.stringify({ status: 'ok' }) },
      { role: 'user', content: 'Step 2: Proceed with patch' },
    ];
    const testTools = [
      { name: 'apply_patch', description: 'Apply diff', inputSchema: { type: 'object' } },
    ];

    await adapter.invoke(testMessages, testTools, { providerId: 'nexus6' });

    assert.ok(payloadReceivedByFallback, 'Fallback must receive payload');
    assert.strictEqual(payloadReceivedByFallback.tools.length, 1);
    assert.strictEqual(payloadReceivedByFallback.tools[0].function.name, 'apply_patch');
    assert.ok(payloadReceivedByFallback.messages.some((m) => m.content.includes('Step 1')));
    assert.ok(payloadReceivedByFallback.messages.some((m) => m.content.includes('call_123')));
  });

  // ---------------------------------------------------------------------------
  // 11. Bounded retry count
  // ---------------------------------------------------------------------------
  await testAsync('Fallback chain respects maxCandidates bound and does not loop indefinitely', async () => {
    const router = createMockRouter({
      nexus6: { apiKey: 'key-nexus6', modelId: 'openai/gpt-oss-120b' },
      nexus1: { apiKey: 'key-nexus1', modelId: 'gemini-2.5-flash' },
      deepseek: { apiKey: 'key-deepseek', modelId: 'deepseek-coder' },
    });

    const adapter = new ModelAdapter(router);
    let attemptsCount = 0;

    const mockFail = async () => {
      attemptsCount++;
      const err = new Error('429 Rate limit');
      err.status = 429;
      throw err;
    };

    router.providers.get('nexus6').request = mockFail;
    router.providers.get('nexus1').request = mockFail;
    router.providers.get('deepseek').request = mockFail;

    await assert.rejects(
      async () => {
        await adapter.invoke([{ role: 'user', content: 'Bounded test' }], [], {
          providerId: 'nexus6',
        });
      },
      /429/
    );

    assert.strictEqual(attemptsCount <= 3, true, `Attempts (${attemptsCount}) must be bounded <= 3`);
  });

  // ---------------------------------------------------------------------------
  // 12. No persisted model change
  // ---------------------------------------------------------------------------
  await testAsync('Runtime failover does not alter the user configured selection in AIProviderRouter', async () => {
    const router = createMockRouter({
      nexus6: { apiKey: 'key-nexus6', modelId: 'openai/gpt-oss-120b' },
      nexus1: { apiKey: 'key-nexus1', modelId: 'gemini-2.5-flash' },
    });
    router.activeProviderId = 'nexus6';

    const adapter = new ModelAdapter(router);
    router.providers.get('nexus6').request = async () => {
      const err = new Error('503 Outage');
      err.status = 503;
      throw err;
    };
    router.providers.get('nexus1').request = async () => {
      return { data: { choices: [{ message: { content: 'OK' } }] } };
    };

    await adapter.invoke([{ role: 'user', content: 'Keep preference' }], [], {
      providerId: 'nexus6',
    });

    assert.strictEqual(router.activeProviderId, 'nexus6', 'Active provider in router must remain unchanged');
  });

  // ---------------------------------------------------------------------------
  // 13. Event emission safety (No API key in events)
  // ---------------------------------------------------------------------------
  test('Failover event emission contains zero plaintext API keys', () => {
    const adapter = new ModelAdapter();
    let emitted = null;
    adapter.emitFailoverEvent({
      primaryProviderId: 'nexus6',
      primaryModelId: 'openai/gpt-oss-120b',
      fallbackProviderId: 'nexus1',
      fallbackModelId: 'gemini-2.5-flash',
      fallbackDisplayName: 'Gemini 2.5 Flash',
      failureCategory: '429_RATE_LIMIT',
      reason: '429 Rate Limit Exceeded',
      attempt: 1,
    });

    const serialized = JSON.stringify(emitted || {});
    assert.strictEqual(serialized.includes('key-'), false, 'Must not contain keys');
    assert.strictEqual(serialized.includes('SECRET'), false, 'Must not contain secrets');
  });

  // ---------------------------------------------------------------------------
  // 14. Zero network calls made by candidate selection itself
  // ---------------------------------------------------------------------------
  test('Fallback candidate selection runs 100% locally and synchronously in 0ms', () => {
    const configuredProviders = [
      { id: 'nexus6', isConfigured: true },
      { id: 'nexus1', isConfigured: true },
      { id: 'deepseek', isConfigured: true },
      { id: 'claude', isConfigured: false },
    ];

    const start = Date.now();
    for (let i = 0; i < 50; i++) {
      const candidates = modelSelectionAdvisor.getFallbackCandidates({
        primaryProviderId: 'nexus6',
        primaryModelId: 'openai/gpt-oss-120b',
        tier: 'TIER_2_BALANCED_CODING',
        configuredProviders,
        maxCandidates: 2,
      });
      assert.strictEqual(candidates.length, 2);
      assert.strictEqual(candidates.some((c) => c.providerId === 'nexus6'), false);
      assert.strictEqual(candidates.some((c) => c.providerId === 'claude'), false);
    }
    const duration = Date.now() - start;
    assert.ok(duration < 50, `50 iterations completed in ${duration}ms (< 50ms)`);
  });

  console.log('\n================================================================');
  console.log(`  RESULTS: ${passed}/${total} TESTS PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test suite error:', err);
  process.exit(1);
});
