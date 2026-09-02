/**
 * NEXUS CODEX HARNESS - MODEL ADAPTER
 * Normalizes multi-model prompt formatting, tool declarations, and tool-call responses
 * across OpenAI, Gemini, Claude, Groq, DeepSeek, Grok, and simulated test handlers.
 */

const { aiProviderRouter } = require('../ai/AIProviderRouter');
const secretFilter = require('../../security/secretFilter');

class ModelAdapter {
  constructor(router = aiProviderRouter) {
    this.router = router;
  }

  /**
   * Formats tool definitions into a provider-neutral schema declaration block.
   * @param {Array<Object>} tools
   * @returns {string} Formatted tool specification instructions
   */
  formatToolsPrompt(tools = []) {
    if (!tools || tools.length === 0) return '';

    const lines = [
      '## AVAILABLE TOOLS',
      'You have access to the following tools to inspect, verify, and mutate the workspace:',
      '',
    ];

    for (const tool of tools) {
      lines.push(`### Tool: \`${tool.name}\``);
      lines.push(`${tool.description}`);
      lines.push('Input JSON Schema:');
      lines.push('```json');
      lines.push(JSON.stringify(tool.inputSchema || {}, null, 2));
      lines.push('```');
      lines.push('');
    }

    lines.push('## TOOL CALL PROTOCOL');
    lines.push('When you need to use one or more tools, respond with a JSON code block containing the tool call:');
    lines.push('```json');
    lines.push('{');
    lines.push('  "tool_calls": [');
    lines.push('    {');
    lines.push('      "callId": "call_1",');
    lines.push('      "toolName": "read_file",');
    lines.push('      "arguments": { "path": "src/main.py" }');
    lines.push('    }');
    lines.push('  ]');
    lines.push('}');
    lines.push('```');
    lines.push('');
    lines.push('## CRITICAL CODE MUTATION & PROPOSED CHANGES RULES');
    lines.push('1. Whenever you propose, plan, or execute a code change, fix, refactor, or edit (or when the user asks to propose a fix, show a diff, or create a ChangeSet), you MUST invoke the `apply_patch` tool with your proposed edits.');
    lines.push('2. Invoking `apply_patch` is safe and non-destructive: it stages changes into an authoritative ChangeSet, calculates diffs, evaluates Patch Firewall safety, and requests user approval before anything touches disk.');
    lines.push('3. Do NOT output proposed code diffs solely as plain markdown text without invoking `apply_patch`. You MUST issue the `apply_patch` tool call to create the ChangeSet.');
    lines.push('When you have completed the task and have all necessary information, provide your final response directly as conversational text without any tool calls.');

    return lines.join('\n');
  }

  /**
   * Formats internal conversation messages into the provider's expected wire format.
   * When native tools are enabled, preserves OpenAI-standard assistant tool_calls and role: 'tool' responses.
   * When tools are disabled or omitted, formats tool results as user messages for text-based models.
   * @param {Array<Object>} messages
   * @param {Array<Object>} tools
   * @returns {Array<Object>}
   */
  formatConversationMessages(messages = [], tools = []) {
    const hasTools = Array.isArray(tools) && tools.length > 0;
    const conversationMessages = (messages || []).filter((m) => m && m.role !== 'system');

    return conversationMessages.map((m) => {
      if (m.role === 'tool') {
        const compactJson = typeof m.content === 'string' ? m.content : JSON.stringify(m.content !== undefined ? m.content : {});
        if (hasTools) {
          return {
            role: 'tool',
            tool_call_id: m.tool_call_id || m.callId || m.id || 'call_0',
            name: m.name || 'tool',
            content: compactJson,
          };
        }
        return {
          role: 'user',
          content: `[TOOL_RESULT for call "${m.tool_call_id || m.callId || m.id || 'call_0'}"]: ${compactJson}`,
        };
      }

      if (m.role === 'assistant') {
        const assistantMsg = {
          role: 'assistant',
          content: m.content !== undefined && m.content !== null
            ? (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
            : (Array.isArray(m.tool_calls) && m.tool_calls.length > 0 ? null : ''),
        };
        if (Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
          assistantMsg.tool_calls = m.tool_calls;
        }
        return assistantMsg;
      }

      return {
        role: m.role || 'user',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content !== undefined ? m.content : ''),
      };
    });
  }

  /**
   * Parses raw model text or structured response into a normalized ModelTurnOutput.
   * @param {string|Object} rawResponse
   * @returns {{ role: string, content: string|null, toolCalls: Array<Object> }}
   */
  normalizeResponse(rawResponse) {
    if (!rawResponse) {
      return {
        role: 'assistant',
        content: '',
        toolCalls: [],
      };
    }

    // 1. If provider returned native structured tool calls (e.g. OpenAI / Groq tool_calls or toolCalls)
    const rawCalls = rawResponse.tool_calls || rawResponse.toolCalls;
    if (typeof rawResponse === 'object' && Array.isArray(rawCalls) && rawCalls.length > 0) {
      const toolCalls = rawCalls.map((tc, idx) => {
        let args = tc.function?.arguments || tc.arguments || tc.args || {};
        if (typeof args === 'string') {
          try { args = JSON.parse(args); } catch (e) { args = { raw: args }; }
        }
        return {
          type: 'tool_call',
          callId: tc.id || tc.callId || `call_${Date.now()}_${idx}`,
          toolName: tc.function?.name || tc.toolName || tc.name || tc.tool,
          arguments: args,
        };
      });

      return {
        role: 'assistant',
        content: rawResponse.content || null,
        toolCalls,
      };
    }

    const text = typeof rawResponse === 'string' ? rawResponse : (rawResponse.content || rawResponse.text || JSON.stringify(rawResponse));

    // 2. Check for explicit ```json { "tool_calls": [...] } ``` blocks
    const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
    let match;
    const foundToolCalls = [];
    let textWithoutToolJson = text;

    while ((match = jsonBlockRegex.exec(text)) !== null) {
      const candidateStr = match[1].trim();
      try {
        const parsed = JSON.parse(candidateStr);
        if (parsed && Array.isArray(parsed.tool_calls)) {
          for (let i = 0; i < parsed.tool_calls.length; i++) {
            const tc = parsed.tool_calls[i];
            if (tc && (tc.toolName || tc.tool || tc.name)) {
              foundToolCalls.push({
                type: 'tool_call',
                callId: tc.callId || tc.id || `call_${Date.now()}_${i}`,
                toolName: tc.toolName || tc.tool || tc.name,
                arguments: tc.arguments || tc.args || {},
              });
            }
          }
          textWithoutToolJson = textWithoutToolJson.replace(match[0], '').trim();
        } else if (parsed && (parsed.toolName || parsed.tool) && parsed.arguments) {
          foundToolCalls.push({
            type: 'tool_call',
            callId: parsed.callId || `call_${Date.now()}_0`,
            toolName: parsed.toolName || parsed.tool,
            arguments: parsed.arguments || parsed.args || {},
          });
          textWithoutToolJson = textWithoutToolJson.replace(match[0], '').trim();
        }
      } catch (e) {
        // Not a JSON tool call block, continue
      }
    }

    // 3. Check for standalone JSON without markdown block
    if (foundToolCalls.length === 0 && text.trim().startsWith('{') && text.trim().endsWith('}')) {
      try {
        const parsed = JSON.parse(text.trim());
        if (parsed && Array.isArray(parsed.tool_calls)) {
          for (let i = 0; i < parsed.tool_calls.length; i++) {
            const tc = parsed.tool_calls[i];
            if (tc && (tc.toolName || tc.tool || tc.name)) {
              foundToolCalls.push({
                type: 'tool_call',
                callId: tc.callId || tc.id || `call_${Date.now()}_${i}`,
                toolName: tc.toolName || tc.tool || tc.name,
                arguments: tc.arguments || tc.args || {},
              });
            }
          }
          textWithoutToolJson = '';
        } else if (parsed && (parsed.toolName || parsed.tool)) {
          foundToolCalls.push({
            type: 'tool_call',
            callId: parsed.callId || `call_${Date.now()}_0`,
            toolName: parsed.toolName || parsed.tool,
            arguments: parsed.arguments || parsed.args || {},
          });
          textWithoutToolJson = '';
        }
      } catch (e) {}
    }

    return {
      role: 'assistant',
      content: secretFilter.sanitizeString(textWithoutToolJson || (foundToolCalls.length === 0 ? text : '')),
      toolCalls: foundToolCalls,
    };
  }

  /**
   * Determines if an error is eligible for auto-failover.
   * Eligible: 429 Rate Limit, 503 Service Unavailable, Quota Exhaustion, Network Timeout.
   * Ineligible: 401/403 Auth errors, 400 Bad Request / Schema errors, local code errors.
   */
  isFailoverEligibleError(err) {
    if (!err) return null;
    const status = Number(err.status || err.statusCode || err.response?.status || err.code);
    const msg = String(err.message || '').toLowerCase();
    const raw = String(err.rawResponse || err.data || (typeof err.data === 'object' ? JSON.stringify(err.data) : '')).toLowerCase();
    const combined = `${msg} ${raw}`;

    // Strictly Ineligible errors (Authentication, Authorization, Invalid Keys, Bad Request, Schema validation)
    if (
      status === 401 ||
      status === 403 ||
      combined.includes('401') ||
      combined.includes('403') ||
      combined.includes('unauthorized') ||
      combined.includes('forbidden') ||
      combined.includes('authentication') ||
      combined.includes('authenticate') ||
      combined.includes('invalid api key') ||
      combined.includes('invalid_api_key') ||
      combined.includes('incorrect api key') ||
      combined.includes('invalid key') ||
      combined.includes('invalid token') ||
      combined.includes('invalid_token') ||
      combined.includes('unauthenticated') ||
      combined.includes('permission denied') ||
      combined.includes('access denied') ||
      combined.includes('account suspended') ||
      combined.includes('billing disabled') ||
      combined.includes('api key not valid')
    ) {
      return null;
    }

    if (
      status === 400 ||
      combined.includes('invalid_request_error') ||
      combined.includes('bad request') ||
      combined.includes('schema validation') ||
      combined.includes('unsupported parameter') ||
      combined.includes('context length exceeded') ||
      combined.includes('maximum context length')
    ) {
      return null;
    }

    // 1. 429 Rate Limit / Quota Exhaustion (Eligible)
    if (
      status === 429 ||
      err.isRateLimit === true ||
      combined.includes('rate limit') ||
      combined.includes('429') ||
      combined.includes('too many requests') ||
      combined.includes('resource exhausted') ||
      combined.includes('quota') ||
      combined.includes('credits exhausted') ||
      combined.includes('balance depleted') ||
      combined.includes('insufficient_quota')
    ) {
      return {
        category: '429_RATE_LIMIT',
        reason: '429 Rate Limit Exceeded',
      };
    }

    // 2. 503 / 502 / 504 Service Unavailable / Overloaded (Eligible)
    if (
      status === 503 ||
      status === 502 ||
      status === 504 ||
      combined.includes('503') ||
      combined.includes('502') ||
      combined.includes('504') ||
      combined.includes('service unavailable') ||
      combined.includes('overloaded') ||
      combined.includes('bad gateway') ||
      combined.includes('gateway timeout')
    ) {
      return {
        category: '503_SERVICE_UNAVAILABLE',
        reason: '503 Service Unavailable',
      };
    }

    // 3. Network Timeout / Connection Reset (Eligible)
    if (
      err.code === 'ETIMEDOUT' ||
      err.code === 'ECONNRESET' ||
      err.code === 'ECONNABORTED' ||
      err.code === 'ENOTFOUND' ||
      err.name === 'TimeoutError' ||
      combined.includes('timed out') ||
      combined.includes('timeout') ||
      combined.includes('network error') ||
      combined.includes('econnreset')
    ) {
      return {
        category: 'NETWORK_TIMEOUT',
        reason: 'Network Timeout',
      };
    }

    return null;
  }

  /**
   * Checks if an error from a provider represents a tool-use schema validation rejection.
   * e.g. Groq 400 with "tool call validation failed; parameters for tool `xyz` did not match schema".
   * @param {Error|Object} err
   * @param {Array<Object>} tools
   * @returns {boolean}
   */
  _isProviderToolValidationError(err, tools = []) {
    if (!err || !Array.isArray(tools) || tools.length === 0) return false;
    const status = Number(err.statusCode || err.status || err.response?.status || 0);
    if (status !== 400) return false;

    const msg = String(err.message || '').toLowerCase();
    const raw = String(err.data?.error?.message || err.data?.message || (typeof err.data === 'string' ? err.data : '')).toLowerCase();
    const code = String(err.data?.error?.code || '').toLowerCase();
    const combined = `${msg} ${raw} ${code}`;

    const hasValidationPattern =
      combined.includes('tool call validation failed') ||
      combined.includes('parameters for tool') ||
      code === 'tool_use_failed' ||
      (combined.includes('schema validation') && combined.includes('tool'));

    if (!hasValidationPattern) return false;

    // Verify it matches one of our available tools
    return tools.some((t) => t && t.name && combined.includes(t.name.toLowerCase()));
  }

  /**
   * Extracts a normalized tool call from a provider-side tool validation error.
   * @param {Error|Object} err
   * @param {Array<Object>} tools
   * @returns {{ role: string, content: string|null, toolCalls: Array<Object> }|null}
   */
  _extractProviderToolValidationError(err, tools = []) {
    const rawMsg = `${err.message || ''} ${err.data?.error?.message || ''}`;
    let matchedTool = null;

    // Find the tool name referenced in the error message
    for (const t of tools) {
      if (!t || !t.name) continue;
      const regex = new RegExp(`\\b${t.name}\\b`, 'i');
      if (regex.test(rawMsg)) {
        matchedTool = t;
        break;
      }
    }

    if (!matchedTool) return null;

    let args = {};
    const failedGen = err.data?.error?.failed_generation;
    if (failedGen) {
      if (typeof failedGen === 'object') {
        args = failedGen.arguments || failedGen.args || failedGen;
      } else if (typeof failedGen === 'string') {
        try {
          const parsed = JSON.parse(failedGen);
          args = parsed.arguments || parsed.args || parsed;
        } catch (_) {
          const jsonMatch = failedGen.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const parsedMatch = JSON.parse(jsonMatch[0]);
              args = parsedMatch.arguments || parsedMatch.args || parsedMatch;
            } catch (__) {}
          }
        }
      }
    }

    return {
      role: 'assistant',
      content: null,
      toolCalls: [
        {
          type: 'tool_call',
          callId: `call_val_${Date.now()}_0`,
          toolName: matchedTool.name,
          arguments: typeof args === 'object' && args !== null ? args : {},
        },
      ],
    };
  }

  /**
   * Broadcasts safe non-sensitive failover event to UI.
   */
  emitFailoverEvent(data = {}) {
    const safePayload = {
      primaryProviderId: data.primaryProviderId,
      primaryModelId: data.primaryModelId,
      fallbackProviderId: data.fallbackProviderId,
      fallbackModelId: data.fallbackModelId,
      fallbackDisplayName: data.fallbackDisplayName,
      failureCategory: data.failureCategory,
      reason: data.reason,
      attempt: data.attempt,
      timestamp: Date.now(),
    };

    try {
      const { eventBus } = require('./eventBus');
      if (eventBus && typeof eventBus.emit === 'function') {
        eventBus.emit('AI_FAILOVER_TRIGGERED', {
          threadId: data.threadId,
          turnId: data.turnId,
          payload: safePayload,
        });
      }
    } catch (_) {}

    try {
      const { BrowserWindow } = require('electron');
      if (BrowserWindow && typeof BrowserWindow.getAllWindows === 'function') {
        for (const win of BrowserWindow.getAllWindows()) {
          if (win && win.webContents && !win.isDestroyed()) {
            win.webContents.send('ai:failover-triggered', safePayload);
          }
        }
      }
    } catch (_) {}
  }

  /**
   * Core provider execution handler.
   */
  async _executeProviderInvocation(resolved, messages = [], tools = [], options = {}) {
    const { provider, apiKey, modelId } = resolved;

    // Build system prompt & messages
    const systemMessage = messages.find((m) => m.role === 'system');
    let existingSystemText = systemMessage ? systemMessage.content : 'You are NEXUS Autonomous AI Pair Programmer.';
    if (tools && tools.length > 0) {
      existingSystemText += '\n\n## RULES: When proposing or editing code, invoke apply_patch to create a ChangeSet.';
    }

    const formattedMessages = this.formatConversationMessages(messages, tools);

    const fullMessages = [
      { role: 'system', content: existingSystemText },
      ...formattedMessages,
    ];

    if (typeof provider.request === 'function') {
      const requestPayload = {
        model: modelId,
        messages: fullMessages,
        temperature: 0.1,
        max_tokens: 3000,
      };

      if (tools && tools.length > 0) {
        requestPayload.tools = tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema || { type: 'object', properties: {} },
          },
        }));
        requestPayload.tool_choice = 'auto';
      }

      try {
        const res = await provider.request(
          '/chat/completions',
          'POST',
          apiKey,
          requestPayload,
          {},
          options.timeoutMs || 35000
        );
        const choiceMessage = res.data?.choices?.[0]?.message;
        return this.normalizeResponse(choiceMessage || res.data?.choices?.[0] || res.data?.choices?.[0]?.text || '');
      } catch (err) {
        if (this._isProviderToolValidationError(err, tools)) {
          const recovered = this._extractProviderToolValidationError(err, tools);
          if (recovered) {
            return recovered;
          }
        }
        throw err;
      }
    } else if (typeof provider.generateAgentPlan === 'function') {
      const lastUserMsg = [...formattedMessages].reverse().find((m) => m.role === 'user')?.content || 'Continue task';
      const planRes = await provider.generateAgentPlan(apiKey, modelId, {
        task: `${existingSystemText}\n\n${lastUserMsg}`,
        workspacePath: options.workspacePath || process.cwd(),
      });
      const rawText = planRes?.rawResponse || planRes?.summary || JSON.stringify(planRes);
      return this.normalizeResponse(rawText);
    } else {
      throw new Error(`[HARNESS-MODELADAPTER] Provider "${provider.getId()}" does not support iterative invocation.`);
    }
  }

  /**
   * Invokes the model with conversational messages and tool definitions.
   * Automatically fails over to configured compatible alternatives on 429/503/timeout.
   * @param {Array<Object>} messages - Array of { role, content, tool_calls, tool_call_id }
   * @param {Array<Object>} tools - Array of tool declarations from ToolRegistry
   * @param {Object} options - { providerId, modelId, modelHandler, workspacePath, intent }
   * @returns {Promise<{ role: string, content: string|null, toolCalls: Array<Object> }>}
   */
  async invoke(messages = [], tools = [], options = {}) {
    // 1. If a custom or mock model handler is provided (e.g. for offline unit tests), use it directly
    if (typeof options.modelHandler === 'function') {
      const rawRes = await options.modelHandler(messages, tools, options);
      return this.normalizeResponse(rawRes);
    }

    // 2. Resolve primary target AI provider through AIProviderRouter
    const primaryProvId = options.providerId || this.router.activeProviderId;
    const primaryModId = options.modelId;
    const resolved = this.router.resolveProviderAndModel(primaryProvId, primaryModId);

    if (!resolved) {
      throw new Error(
        `[HARNESS-MODELADAPTER] No configured AI provider available for providerId "${primaryProvId}". ` +
        `The iterative agent loop requires an active, configured provider or custom modelHandler.`
      );
    }

    // 3. Attempt primary execution
    try {
      return await this._executeProviderInvocation(resolved, messages, tools, options);
    } catch (primaryErr) {
      const failoverCheck = this.isFailoverEligibleError(primaryErr);
      if (!failoverCheck || options.disableFailover === true) {
        throw primaryErr;
      }

      // 4. Resolve bounded fallback candidates
      let fallbackCandidates = [];
      try {
        const { modelSelectionAdvisor } = require('../intelligence/ModelSelectionAdvisor');
        const routerConfig = this.router ? this.router.getConfig() : null;
        const configuredProviders = routerConfig ? routerConfig.providers : [];
        fallbackCandidates = modelSelectionAdvisor.getFallbackCandidates({
          primaryProviderId: resolved.provider.getId(),
          primaryModelId: resolved.modelId,
          tier: options.tier || 'TIER_2_BALANCED_CODING',
          configuredProviders,
          maxCandidates: 2,
        });
      } catch (_) {
        fallbackCandidates = [];
      }

      if (!fallbackCandidates || fallbackCandidates.length === 0) {
        throw primaryErr;
      }

      // 5. Try bounded fallback chain with complete payload preservation
      let attempt = 0;
      let lastErr = primaryErr;

      for (const fallback of fallbackCandidates) {
        attempt++;
        const fallbackResolved = this.router.resolveProviderAndModel(fallback.providerId, fallback.modelId);
        if (!fallbackResolved) continue;

        // Emit renderer-safe failover event (no keys)
        this.emitFailoverEvent({
          primaryProviderId: resolved.provider.getId(),
          primaryModelId: resolved.modelId,
          fallbackProviderId: fallbackResolved.provider.getId(),
          fallbackModelId: fallbackResolved.modelId,
          fallbackDisplayName: fallback.modelDisplayName || fallbackResolved.modelId,
          failureCategory: failoverCheck.category,
          reason: failoverCheck.reason,
          attempt,
          threadId: options.threadId,
          turnId: options.turnId,
        });

        try {
          // Replay with identical payload and fallback provider's isolated key
          const fallbackRes = await this._executeProviderInvocation(fallbackResolved, messages, tools, options);
          if (fallbackRes && typeof fallbackRes === 'object') {
            fallbackRes.execution = {
              providerId: fallbackResolved.provider.getId(),
              modelId: fallbackResolved.modelId,
              requestedProviderId: resolved.provider.getId(),
              requestedModelId: resolved.modelId,
              isFallback: true,
            };
          }
          return fallbackRes;
        } catch (fallbackErr) {
          const nextCheck = this.isFailoverEligibleError(fallbackErr);
          if (!nextCheck) {
            fallbackErr.primaryProviderId = resolved.provider.getId();
            fallbackErr.primaryModelId = resolved.modelId;
            throw fallbackErr; // If 401 or invalid request, stop immediately
          }
          lastErr = fallbackErr;
        }
      }

      if (lastErr) {
        lastErr.primaryProviderId = resolved.provider.getId();
        lastErr.primaryModelId = resolved.modelId;
      }
      throw lastErr;
    }
  }

  /**
   * Streams model output progressively as normalized deltas.
   * Supports native provider SSE streaming or clean non-streaming fallback.
   * @param {Array<Object>} messages
   * @param {Array<Object>} tools
   * @param {Object} options
   * @returns {AsyncIterable<{ type: string, delta?: string, accumulated?: string, toolCalls?: Array<Object>, finishReason?: string|null, sequence?: number }>}
   */
  async *stream(messages = [], tools = [], options = {}) {
    let sequence = 0;
    let accumulatedText = '';

    // 1. If mock or custom model handler is provided
    if (typeof options.modelHandler === 'function') {
      const handlerRes = options.modelHandler(messages, tools, options);

      // Check if handler returns an AsyncIterable or generator
      if (handlerRes && typeof handlerRes[Symbol.asyncIterator] === 'function') {
        for await (const chunk of handlerRes) {
          sequence++;
          const deltaStr = typeof chunk === 'string' ? chunk : (chunk.delta || chunk.content || '');
          accumulatedText += deltaStr;
          yield {
            type: chunk.toolCalls ? 'tool_call_delta' : 'message_delta',
            delta: deltaStr,
            accumulated: accumulatedText,
            toolCalls: chunk.toolCalls || null,
            finishReason: chunk.finishReason || null,
            sequence,
          };
        }
        return;
      }

      // Non-streaming handler: await and yield one assembled completed response
      const rawRes = await handlerRes;
      const normalized = this.normalizeResponse(rawRes);
      yield {
        type: normalized.toolCalls.length > 0 ? 'tool_call_delta' : 'message_delta',
        delta: normalized.content || '',
        accumulated: normalized.content || '',
        toolCalls: normalized.toolCalls,
        finishReason: 'stop',
        sequence: 1,
      };
      return;
    }

    // 2. Resolve provider and model
    const resolved = this.router.resolveProviderAndModel(options.providerId, options.modelId);
    if (!resolved) {
      throw new Error(
        `[HARNESS-MODELADAPTER] No configured AI provider available for providerId "${options.providerId || this.router.activeProviderId}". ` +
        `The iterative agent loop requires an active, configured provider or custom modelHandler.`
      );
    }

    const { provider, apiKey, modelId } = resolved;

    // 3. Build system prompt & messages
    const systemMessage = messages.find((m) => m.role === 'system');
    let existingSystemText = systemMessage ? systemMessage.content : 'You are NEXUS Autonomous AI Pair Programmer.';
    if (tools && tools.length > 0) {
      existingSystemText += '\n\n## RULES: When proposing or editing code, invoke apply_patch to create a ChangeSet.';
    }

    const formattedMessages = this.formatConversationMessages(messages, tools);

    const fullMessages = [
      { role: 'system', content: existingSystemText },
      ...formattedMessages,
    ];

    // 4. Native SSE Streaming if supported
    if (typeof provider.streamChatCompletions === 'function') {
      try {
        const stream = provider.streamChatCompletions(apiKey, modelId, fullMessages, {
          temperature: 0.1,
          maxTokens: options.maxTokens ?? 1500,
          tools,
          abortSignal: options.abortSignal,
        });

        let capturedNativeToolCalls = [];

        for await (const chunk of stream) {
          sequence++;
          if (chunk.toolCalls && chunk.toolCalls.length > 0) {
            capturedNativeToolCalls = chunk.toolCalls;
            yield {
              type: 'tool_call_delta',
              delta: '',
              accumulated: accumulatedText,
              toolCalls: capturedNativeToolCalls,
              finishReason: chunk.finishReason || null,
              sequence,
            };
          }
          if (chunk.content) {
            accumulatedText += chunk.content;
            yield {
              type: 'message_delta',
              delta: chunk.content,
              accumulated: accumulatedText,
              finishReason: chunk.finishReason || null,
              sequence,
            };
          }
        }

        if (capturedNativeToolCalls.length > 0) {
          return;
        }

        // Parse accumulated text for JSON tool calls if any
        const normalized = this.normalizeResponse(accumulatedText);
        if (normalized.toolCalls.length > 0) {
          yield {
            type: 'tool_call_delta',
            delta: '',
            accumulated: normalized.content,
            toolCalls: normalized.toolCalls,
            finishReason: 'stop',
            sequence: sequence + 1,
          };
        }
        if (this.router && typeof this.router.recordSlotRequest === 'function') {
          this.router.recordSlotRequest(resolved.provider.getId(), 'SUCCESS', resolved.modelId);
        }
        return;
      } catch (streamErr) {
        if (options.abortSignal?.aborted) {
          throw streamErr;
        }
        const { parseRateLimitError } = require('../ai/types');
        const rateInfo = parseRateLimitError(streamErr, options.providerId || resolved?.provider?.getId(), options.modelId || resolved?.modelId);
        if (this.router && typeof this.router.recordSlotRequest === 'function') {
          this.router.recordSlotRequest(
            options.providerId || resolved?.provider?.getId(),
            rateInfo ? '429_RATE_LIMIT' : 'ERROR',
            options.modelId || resolved?.modelId
          );
        }
        const failoverEligible = this.isFailoverEligibleError(streamErr);
        if (!failoverEligible && (streamErr.statusCode === 401 || streamErr.statusCode === 403 || String(streamErr.message).toLowerCase().includes('auth') || String(streamErr.message).toLowerCase().includes('key'))) {
          throw streamErr;
        }
        if (this._isProviderToolValidationError(streamErr, tools)) {
          const recovered = this._extractProviderToolValidationError(streamErr, tools);
          if (recovered && recovered.toolCalls && recovered.toolCalls.length > 0) {
            yield {
              type: 'tool_call_delta',
              delta: '',
              accumulated: '',
              toolCalls: recovered.toolCalls,
              finishReason: 'tool_calls',
              sequence: sequence + 1,
            };
            return;
          }
        }
        // Fall back to invoke with failover
      }
    }

    // 5. Non-streaming fallback
    const fallbackRes = await this.invoke(messages, tools, options);
    yield {
      type: fallbackRes.toolCalls.length > 0 ? 'tool_call_delta' : 'message_delta',
      delta: fallbackRes.content || '',
      accumulated: fallbackRes.content || '',
      toolCalls: fallbackRes.toolCalls,
      finishReason: fallbackRes.toolCalls.length > 0 ? 'tool_calls' : 'stop',
      sequence: 1,
    };
  }
}

const modelAdapter = new ModelAdapter();

module.exports = {
  ModelAdapter,
  modelAdapter,
};
