/**
 * NEXUS INTELLIGENCE LAYER — MODEL SELECTION ADVISOR
 * Pure, deterministic, local recommendation engine for AI models.
 * 
 * Reuses existing:
 * - RequestRouter intent classification (CONVERSATION vs CODING_TASK, READ_ONLY vs MUTATION)
 * - PreflightEstimator token ceilings, file count impact, and risk levels
 * - MODEL_PRICING_CATALOG published rates and savings calculations
 * - AIProviderRouter configured provider validation
 * 
 * STRICT GUARANTEES:
 * - 100% local, synchronous computation (0 network calls).
 * - Never inspects, exposes, or logs plaintext API keys.
 * - Only recommends models whose provider is currently configured (isConfigured === true).
 * - Pure advisory: does NOT forcibly mutate active model selection.
 */

const { getModelPricing, getModelContextWindow, MODEL_PRICING_CATALOG } = require('./types');

/**
 * Priority candidate model tiers based on task characteristics.
 */
const TIER_CANDIDATES = Object.freeze({
  // Tier 1: Fast & Economical (greetings, simple conversation, single-file reading, low tokens)
  TIER_1_FAST_ECONOMICAL: [
    { providerId: 'nexus1', modelId: 'gemini-2.5-flash', matchName: 'Gemini 2.5 Flash' },
    { providerId: 'gemini', modelId: 'gemini-2.5-flash', matchName: 'Gemini 2.5 Flash' },
    { providerId: 'groq', modelId: 'llama-3.1-8b-instant', matchName: 'Groq Llama 3.1 8B' },
    { providerId: 'nexus6', modelId: 'openai/gpt-oss-120b', matchName: 'NEXUS 6 (Groq)' },
    { providerId: 'deepseek', modelId: 'deepseek-chat', matchName: 'DeepSeek Chat' },
    { providerId: 'openai', modelId: 'gpt-4o-mini', matchName: 'GPT-4o Mini' },
    { providerId: 'claude', modelId: 'claude-3-5-haiku-20241022', matchName: 'Claude 3.5 Haiku' },
  ],

  // Tier 2: Balanced Coding & Diagnostics (standard coding tasks, diagnostics, single-file mutations)
  TIER_2_BALANCED_CODING: [
    { providerId: 'nexus6', modelId: 'openai/gpt-oss-120b', matchName: 'NEXUS 6 (Groq GPT-OSS 120B)' },
    { providerId: 'groq', modelId: 'openai/gpt-oss-120b', matchName: 'Groq GPT-OSS 120B' },
    { providerId: 'deepseek', modelId: 'deepseek-coder', matchName: 'DeepSeek Coder' },
    { providerId: 'nexus2', modelId: 'gemini-3.5-flash', matchName: 'NEXUS 2 (Gemini 3.5 Flash)' },
    { providerId: 'gemini', modelId: 'gemini-3.5-flash', matchName: 'Gemini 3.5 Flash' },
    { providerId: 'claude', modelId: 'claude-3-5-haiku-20241022', matchName: 'Claude 3.5 Haiku' },
    { providerId: 'openai', modelId: 'gpt-4o-mini', matchName: 'GPT-4o Mini' },
  ],

  // Tier 3: High Capacity & Deep Refactoring (multi-file refactors, high risk, large token budget)
  TIER_3_DEEP_REASONING: [
    { providerId: 'nexus6', modelId: 'openai/gpt-oss-120b', matchName: 'NEXUS 6 (Groq GPT-OSS 120B)' },
    { providerId: 'groq', modelId: 'openai/gpt-oss-120b', matchName: 'Groq GPT-OSS 120B' },
    { providerId: 'claude', modelId: 'claude-3-5-sonnet-20241022', matchName: 'Claude 3.5 Sonnet' },
    { providerId: 'openai', modelId: 'gpt-4o', matchName: 'GPT-4o' },
    { providerId: 'deepseek', modelId: 'deepseek-coder', matchName: 'DeepSeek Coder' },
    { providerId: 'nexus1', modelId: 'gemini-2.5-flash', matchName: 'NEXUS 1 (Gemini 2.5 Flash)' },
    { providerId: 'gemini', modelId: 'gemini-2.5-pro', matchName: 'Gemini 2.5 Pro' },
    { providerId: 'grok', modelId: 'grok-2-latest', matchName: 'Grok 2' },
  ],
});

class ModelSelectionAdvisor {
  /**
   * Recommends the optimal model for a given preflight assessment and configured providers.
   * @param {Object} params
   * @param {string} [params.mode] - 'CONVERSATION' | 'CODING_TASK'
   * @param {string|null} [params.codingIntent] - 'READ_ONLY' | 'MUTATION' | null
   * @param {string} [params.riskLevel] - 'LOW' | 'MEDIUM' | 'HIGH'
   * @param {number} [params.estimatedInputTokens] - Input tokens
   * @param {number} [params.estimatedMaxOutputTokens] - Output tokens
   * @param {number} [params.estimatedTotalTokens] - Total tokens
   * @param {number} [params.estimatedFilesCount] - Target files count
   * @param {number} [params.estimatedToolCalls] - Approximate tool steps
   * @param {string} [params.currentProviderId] - Currently selected provider
   * @param {string} [params.currentModelId] - Currently selected model
   * @param {Array<Object>} [params.configuredProviders] - List of providers with isConfigured status
   * @returns {{
   *   providerId: string|null,
   *   modelId: string|null,
   *   modelDisplayName: string|null,
   *   reason: string,
   *   savingsEstimate: string|null,
   *   isCurrentOptimal: boolean,
   *   isContextExceeded?: boolean,
   *   contextWindow?: number|null,
   *   tier: string
   * }}
   */
  recommendModel(params = {}) {
    const {
      mode = 'CODING_TASK',
      codingIntent = null,
      riskLevel = 'MEDIUM',
      estimatedInputTokens = 0,
      estimatedMaxOutputTokens = 0,
      estimatedTotalTokens = 0,
      estimatedFilesCount = 1,
      estimatedToolCalls = 3,
      currentProviderId = '',
      currentModelId = '',
      configuredProviders = [],
    } = params;

    const totalTokens = estimatedTotalTokens || (estimatedInputTokens + estimatedMaxOutputTokens) || 0;
    const activeContextWindow = getModelContextWindow(currentProviderId, currentModelId);
    const isContextExceeded = Boolean(activeContextWindow !== null && totalTokens > activeContextWindow);

    // 1. Build set of currently configured provider IDs
    const configuredProviderMap = new Map();
    if (Array.isArray(configuredProviders)) {
      for (const p of configuredProviders) {
        if (p && (p.isConfigured === true || p.status === 'CONNECTED')) {
          configuredProviderMap.set(p.id, p);
          if (p.providerId) configuredProviderMap.set(p.providerId, p);
        }
      }
    }

    // If no configured providers exist, return clear unconfigured recommendation
    if (configuredProviderMap.size === 0) {
      return {
        providerId: null,
        modelId: null,
        modelDisplayName: null,
        reason: 'No configured AI provider available. Please configure an API key.',
        savingsEstimate: null,
        isCurrentOptimal: false,
        isContextExceeded,
        contextWindow: activeContextWindow,
        tier: 'UNCONFIGURED',
      };
    }

    // 2. Handle Context Window Exceeded Pre-Gating
    if (isContextExceeded) {
      // Find a configured candidate whose known context window can accommodate totalTokens
      const allTierCandidates = [
        ...TIER_CANDIDATES.TIER_3_DEEP_REASONING,
        ...TIER_CANDIDATES.TIER_2_BALANCED_CODING,
        ...TIER_CANDIDATES.TIER_1_FAST_ECONOMICAL,
      ];

      let largeCandidate = null;
      for (const cand of allTierCandidates) {
        if (configuredProviderMap.has(cand.providerId)) {
          const candWindow = getModelContextWindow(cand.providerId, cand.modelId);
          if (candWindow !== null && candWindow >= totalTokens) {
            largeCandidate = cand;
            break;
          }
        }
      }

      if (largeCandidate) {
        return {
          providerId: largeCandidate.providerId,
          modelId: largeCandidate.modelId,
          modelDisplayName: largeCandidate.matchName,
          reason: `⚠️ Context Limit Risk: Switch to ${largeCandidate.matchName} (requires ~${totalTokens.toLocaleString()} tokens > ${activeContextWindow.toLocaleString()} limit)`,
          savingsEstimate: null,
          isCurrentOptimal: false,
          isContextExceeded: true,
          contextWindow: activeContextWindow,
          tier: 'CONTEXT_EXCEEDED_RESOLVED',
        };
      }

      // No configured model has enough verified capacity
      return {
        providerId: null,
        modelId: null,
        modelDisplayName: null,
        reason: '⚠️ Estimated context exceeds active model limit. No verified compatible model available.',
        savingsEstimate: null,
        isCurrentOptimal: false,
        isContextExceeded: true,
        contextWindow: activeContextWindow,
        tier: 'CONTEXT_EXCEEDED_UNRESOLVED',
      };
    }

    // 3. Classify Target Capability Tier based on complexity, scope, and risk
    let targetTierName = 'TIER_2_BALANCED_CODING';
    let targetTierCandidates = TIER_CANDIDATES.TIER_2_BALANCED_CODING;
    let baseReason = 'Balanced performance and latency for standard coding tasks.';

    const isConversation = mode === 'CONVERSATION' || codingIntent === null;
    const isHighComplexity = riskLevel === 'HIGH' || estimatedFilesCount > 2 || estimatedToolCalls >= 8 || estimatedInputTokens > 3000 || estimatedTotalTokens > 6000;
    const isLowComplexity = isConversation || (riskLevel === 'LOW' && estimatedFilesCount <= 1 && estimatedToolCalls <= 2 && estimatedInputTokens < 1500);

    if (isHighComplexity) {
      targetTierName = 'TIER_3_DEEP_REASONING';
      targetTierCandidates = TIER_CANDIDATES.TIER_3_DEEP_REASONING;
      baseReason = 'High reasoning capability & tool precision recommended for multi-file modification.';
    } else if (isLowComplexity) {
      targetTierName = 'TIER_1_FAST_ECONOMICAL';
      targetTierCandidates = TIER_CANDIDATES.TIER_1_FAST_ECONOMICAL;
      baseReason = isConversation
        ? 'Fast, cost-efficient model optimal for conversational queries.'
        : 'Lightweight model optimal for low-risk inspection and single-file tasks.';
    }

    // 4. Find the best configured candidate in the target tier (ensuring context window is sufficient)
    let selectedRecommendation = null;

    for (const cand of targetTierCandidates) {
      if (configuredProviderMap.has(cand.providerId)) {
        const candWindow = getModelContextWindow(cand.providerId, cand.modelId);
        if (candWindow === null || candWindow >= totalTokens) {
          selectedRecommendation = cand;
          break;
        }
      }
    }

    // If target tier has no configured match, search other tiers
    if (!selectedRecommendation) {
      const fallbackOrder = [
        ...TIER_CANDIDATES.TIER_2_BALANCED_CODING,
        ...TIER_CANDIDATES.TIER_1_FAST_ECONOMICAL,
        ...TIER_CANDIDATES.TIER_3_DEEP_REASONING,
      ];
      for (const cand of fallbackOrder) {
        if (configuredProviderMap.has(cand.providerId)) {
          const candWindow = getModelContextWindow(cand.providerId, cand.modelId);
          if (candWindow === null || candWindow >= totalTokens) {
            selectedRecommendation = cand;
            baseReason = 'Best available configured model for current task scope.';
            break;
          }
        }
      }
    }

    // If still no candidate found, pick any first configured provider's default model
    if (!selectedRecommendation) {
      const firstConfigured = configuredProviderMap.values().next().value;
      if (firstConfigured) {
        selectedRecommendation = {
          providerId: firstConfigured.id,
          modelId: firstConfigured.selectedModelId || firstConfigured.defaultModel || 'default',
          matchName: firstConfigured.name || firstConfigured.id,
        };
        baseReason = 'Configured model ready for execution.';
      }
    }

    if (!selectedRecommendation) {
      return {
        providerId: null,
        modelId: null,
        modelDisplayName: null,
        reason: 'No configured AI provider available.',
        savingsEstimate: null,
        isCurrentOptimal: false,
        isContextExceeded: false,
        contextWindow: activeContextWindow,
        tier: targetTierName,
      };
    }

    // 5. Check if current model matches recommendation
    const normCurrentProv = String(currentProviderId || '').toLowerCase().trim();
    const normCurrentMod = String(currentModelId || '').toLowerCase().trim();
    const isCurrentOptimal = normCurrentProv === selectedRecommendation.providerId &&
      (normCurrentMod === selectedRecommendation.modelId || !currentModelId);

    // 6. Calculate Cost Savings Estimate if applicable
    let savingsEstimate = null;
    try {
      const currentPricing = getModelPricing(currentProviderId, currentModelId);
      const recommendedPricing = getModelPricing(selectedRecommendation.providerId, selectedRecommendation.modelId);

      if (currentPricing.pricingAvailable && recommendedPricing.pricingAvailable && !isCurrentOptimal) {
        const currentCost = ((estimatedInputTokens || 500) / 1_000_000) * currentPricing.inputUsdPerMillion +
                            ((estimatedMaxOutputTokens || 1000) / 1_000_000) * currentPricing.outputUsdPerMillion;
        const recCost = ((estimatedInputTokens || 500) / 1_000_000) * recommendedPricing.inputUsdPerMillion +
                        ((estimatedMaxOutputTokens || 1000) / 1_000_000) * recommendedPricing.outputUsdPerMillion;

        if (currentCost > 0 && recCost < currentCost) {
          const savingsPct = Math.round(((currentCost - recCost) / currentCost) * 100);
          if (savingsPct >= 10) {
            savingsEstimate = `~${savingsPct}% estimated cost savings`;
          }
        }
      }
    } catch (_) {
      savingsEstimate = null;
    }

    let finalReason = baseReason;
    if (isCurrentOptimal) {
      finalReason = 'Currently selected model is optimal for this task scope.';
    } else if (savingsEstimate) {
      finalReason = `${baseReason} (${savingsEstimate})`;
    }

    return {
      providerId: selectedRecommendation.providerId,
      modelId: selectedRecommendation.modelId,
      modelDisplayName: selectedRecommendation.matchName,
      reason: finalReason,
      savingsEstimate,
      isCurrentOptimal,
      isContextExceeded: false,
      contextWindow: activeContextWindow,
      tier: targetTierName,
    };
  }

  /**
   * Resolves an ordered list of fallback provider/model candidates.
   * - Filters strictly to currently configured providers (isConfigured === true).
   * - Excludes the primary provider / model.
   * - Prefers alternatives with compatible capabilities and the same capability tier.
   * - Never exposes or logs API keys.
   * - 100% deterministic and local (0 network calls).
   * @param {Object} params
   * @param {string} params.primaryProviderId - The failing provider ID
   * @param {string} params.primaryModelId - The failing model ID
   * @param {string} [params.tier] - Capability tier ('TIER_1_FAST_ECONOMICAL' | 'TIER_2_BALANCED_CODING' | 'TIER_3_DEEP_REASONING')
   * @param {Array<Object>} [params.configuredProviders] - List of providers with isConfigured state
   * @param {number} [params.maxCandidates=3] - Maximum fallback candidates to return
   * @returns {Array<{ providerId: string, modelId: string, modelDisplayName: string, tier: string }>}
   */
  getFallbackCandidates(params = {}) {
    const {
      primaryProviderId = '',
      primaryModelId = '',
      tier = 'TIER_2_BALANCED_CODING',
      configuredProviders = [],
      maxCandidates = 3,
    } = params;

    const normPrimaryProv = String(primaryProviderId || '').toLowerCase().trim();
    const normPrimaryMod = String(primaryModelId || '').toLowerCase().trim();

    // 1. Build set of currently configured provider IDs
    const configuredMap = new Map();
    if (Array.isArray(configuredProviders)) {
      for (const p of configuredProviders) {
        if (p && (p.isConfigured === true || p.status === 'CONNECTED')) {
          configuredMap.set(p.id, p);
          if (p.providerId) configuredMap.set(p.providerId, p);
        }
      }
    }

    if (configuredMap.size === 0) {
      return [];
    }

    // 2. Determine ordered candidate lists by tier preference
    let tierOrder = [];
    if (tier === 'TIER_3_DEEP_REASONING') {
      tierOrder = [
        TIER_CANDIDATES.TIER_3_DEEP_REASONING,
        TIER_CANDIDATES.TIER_2_BALANCED_CODING,
        TIER_CANDIDATES.TIER_1_FAST_ECONOMICAL,
      ];
    } else if (tier === 'TIER_1_FAST_ECONOMICAL') {
      tierOrder = [
        TIER_CANDIDATES.TIER_1_FAST_ECONOMICAL,
        TIER_CANDIDATES.TIER_2_BALANCED_CODING,
        TIER_CANDIDATES.TIER_3_DEEP_REASONING,
      ];
    } else {
      tierOrder = [
        TIER_CANDIDATES.TIER_2_BALANCED_CODING,
        TIER_CANDIDATES.TIER_3_DEEP_REASONING,
        TIER_CANDIDATES.TIER_1_FAST_ECONOMICAL,
      ];
    }

    const results = [];
    const seen = new Set();

    // Map slot aliases to exclude identical provider infrastructure
    const slotAliases = {
      nexus1: ['nexus1', 'nexus2', 'gemini'],
      nexus2: ['nexus1', 'nexus2', 'gemini'],
      nexus3: ['nexus3', 'openai'],
      nexus4: ['nexus4', 'claude'],
      nexus5: ['nexus5', 'deepseek'],
      nexus6: ['nexus6', 'groq'],
      gemini: ['nexus1', 'nexus2', 'gemini'],
      openai: ['nexus3', 'openai'],
      claude: ['nexus4', 'claude'],
      deepseek: ['nexus5', 'deepseek'],
      groq: ['nexus6', 'groq'],
    };

    // Exclude the primary provider/model and all its slot aliases
    seen.add(`${normPrimaryProv}:${normPrimaryMod}`);
    seen.add(`${normPrimaryProv}:`);
    seen.add(normPrimaryProv);

    const aliases = slotAliases[normPrimaryProv] || [];
    for (const alias of aliases) {
      seen.add(alias);
      seen.add(`${alias}:${normPrimaryMod}`);
      seen.add(`${alias}:`);
    }

    for (const candList of tierOrder) {
      for (const cand of candList) {
        const key = `${cand.providerId}:${cand.modelId}`;
        const provKey = cand.providerId;

        // Skip if already in results or if it's the exact same failing provider or alias
        if (!seen.has(key) && !seen.has(provKey) && configuredMap.has(cand.providerId)) {
          seen.add(key);
          seen.add(provKey); // Prioritize provider diversity in fallback chain
          const candAliases = slotAliases[provKey] || [];
          for (const a of candAliases) seen.add(a);

          results.push({
            providerId: cand.providerId,
            modelId: cand.modelId,
            modelDisplayName: cand.matchName,
            tier: tier,
          });
          if (results.length >= maxCandidates) {
            return results;
          }
        }
      }
    }

    // If still have capacity and other models on already-seen providers exist
    if (results.length < maxCandidates) {
      for (const candList of tierOrder) {
        for (const cand of candList) {
          const key = `${cand.providerId}:${cand.modelId}`;
          if (!seen.has(key) && configuredMap.has(cand.providerId)) {
            seen.add(key);
            results.push({
              providerId: cand.providerId,
              modelId: cand.modelId,
              modelDisplayName: cand.matchName,
              tier: tier,
            });
            if (results.length >= maxCandidates) {
              return results;
            }
          }
        }
      }
    }

    return results;
  }
}

const modelSelectionAdvisor = new ModelSelectionAdvisor();

module.exports = {
  ModelSelectionAdvisor,
  modelSelectionAdvisor,
  TIER_CANDIDATES,
};
