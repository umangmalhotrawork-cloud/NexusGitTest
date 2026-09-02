/**
 * NEXUS INTELLIGENCE LAYER — PREFLIGHT ESTIMATOR (Phase 4)
 * Token / Cost-Aware Planning & Execution Scope Intelligence
 * 
 * Computes deterministic, advisory preflight intelligence estimates BEFORE AgentLoop executes:
 * - Estimated input / context tokens (prompt, active file, selection, history, capsule, tools, system)
 * - Estimated maximum output / generation tokens
 * - Estimated total tokens
 * - Estimated provider cost (primary provider and multi-provider comparison) with safe "Cost unavailable" fallback
 * - Estimated files touched & target file identification (bounded heuristics)
 * - Estimated tool operations / execution steps
 * - Risk level (LOW / MEDIUM / HIGH)
 * - Confidence of the estimate (LOW / MEDIUM / HIGH)
 * - Decision flag: shouldShowPreflight (false for greetings & conversation, true for coding tasks)
 * 
 * STRICT DETERMINISTIC & NON-BREAKING GUARANTEES:
 * - Reuses ContextEngine token-estimation infrastructure (zero duplicate token algorithms).
 * - Reuses RequestRouter intent classification (pure greetings & conversation bypass preflight).
 * - Zero AI model or provider API calls (100% synchronous local computation).
 * - Zero Git or repository mutations (HEAD and worktree untouched).
 * - Zero Continuum state mutations.
 * - Zero Context Capsule modifications (bounded capsule context counted exactly once).
 * - Never runs an unbounded full repository disk scan.
 * - Advisory only: does not replace or modify the normal NEXUS execution pipeline.
 */

const fs = require('fs');
const path = require('path');
const secretFilter = require('../../security/secretFilter');
const { contextEngine } = require('../harness/ContextEngine');
const { requestRouter, ROUTER_MODES, CODING_INTENTS, isGreeting } = require('../harness/RequestRouter');
const {
  BUDGET_STATUS,
  CONFIDENCE_TIERS,
  CONFIDENCE_LEVELS,
  getModelPricing,
  getModelContextWindow,
  MODEL_PRICING_CATALOG,
} = require('./types');
const { modelSelectionAdvisor } = require('./ModelSelectionAdvisor');
const { aiProviderRouter } = require('../ai/AIProviderRouter');

// Default Token Ceilings & Heuristic Weights
const DEFAULT_TOTAL_BUDGET = 6000;
const CODING_TASK_BUDGET = 1800; // For rate-limited / high-throughput providers
const TOOL_DECLARATIONS_TOKEN_OVERHEAD = 500;
const BASE_SYSTEM_INSTRUCTIONS_OVERHEAD = 350;

// Maximum byte threshold for single-file preflight reading (avoids unbounded disk reads)
const MAX_PREFLIGHT_FILE_BYTES = 64 * 1024; // 64 KB
const MAX_BOUNDED_WORKSPACE_SCAN_FILES = 50;

// File extensions pattern for deterministic prompt mention detection
const EXPLICIT_FILE_REGEX = /\b([a-zA-Z0-9_\-./]+\.(?:py|ts|tsx|js|jsx|json|html|css|yaml|yml|sql|go|rs|java|cpp|c|h|md|toml|env|sh))\b/gi;

// Dirs to ignore during bounded workspace evidence search
const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.gemini',
  '__pycache__',
]);

class PreflightEstimator {
  /**
   * Reuses ContextEngine token estimation infrastructure (4 characters ~ 1 token).
   * @param {string|Object} input
   * @returns {number} Estimated token count
   */
  estimateTokens(input) {
    if (contextEngine && typeof contextEngine.estimateTokens === 'function') {
      return contextEngine.estimateTokens(input);
    }
    if (!input) return 0;
    if (typeof input === 'string') return Math.ceil(input.length / 4);
    try {
      return Math.ceil(JSON.stringify(input).length / 4);
    } catch (_) {
      return 0;
    }
  }

  /**
   * Classifies task intent authoritatively using RequestRouter.
   * @param {string} text
   * @param {Object} context
   * @returns {{ mode: string, codingIntent: string|null, confidence: number, isGreeting: boolean }}
   */
  classifyIntent(text = '', context = {}) {
    if (!text || typeof text !== 'string' || !text.trim()) {
      return {
        mode: ROUTER_MODES.CONVERSATION,
        codingIntent: null,
        confidence: 1.0,
        isGreeting: true,
      };
    }

    const greetingCheck = isGreeting(text);
    if (greetingCheck) {
      return {
        mode: ROUTER_MODES.CONVERSATION,
        codingIntent: null,
        confidence: 0.98,
        isGreeting: true,
      };
    }

    const route = requestRouter.classify(text, context);
    return {
      mode: route.mode,
      codingIntent: route.codingIntent,
      confidence: route.confidence,
      isGreeting: false,
      reasons: route.reasons,
    };
  }

  /**
   * Estimates files touched using bounded evidence and task intent.
   * Never scans the repository recursively or reads unbounded files.
   * @param {Object} params
   * @returns {{ count: number, targetFiles: string[], confidence: 'HIGH'|'MEDIUM'|'LOW', confidenceScore: number, source: string }}
   */
  estimateFiles(params = {}) {
    const { userInput = '', workspacePath, activeFilePath, selectionText, targetFiles, codingIntent } = params;

    // 1. Explicit target files array provided
    if (Array.isArray(targetFiles) && targetFiles.length > 0) {
      const valid = targetFiles.filter((f) => typeof f === 'string' && f.trim());
      if (valid.length > 0) {
        return {
          count: valid.length,
          targetFiles: valid,
          confidence: CONFIDENCE_LEVELS.DIRECT,
          confidenceTier: CONFIDENCE_TIERS.HIGH,
          source: 'explicit_targets',
        };
      }
    }

    // 2. Explicit file mentions extracted from prompt
    const promptMentions = new Set();
    let match;
    EXPLICIT_FILE_REGEX.lastIndex = 0;
    while ((match = EXPLICIT_FILE_REGEX.exec(userInput)) !== null) {
      promptMentions.add(match[1]);
    }

    if (promptMentions.size > 0) {
      return {
        count: promptMentions.size,
        targetFiles: Array.from(promptMentions),
        confidence: CONFIDENCE_LEVELS.STRUCTURAL,
        confidenceTier: CONFIDENCE_TIERS.HIGH,
        source: 'prompt_mentions',
      };
    }

    // 3. Active file with selection in editor
    if (selectionText && activeFilePath && typeof activeFilePath === 'string') {
      return {
        count: 1,
        targetFiles: [path.basename(activeFilePath)],
        confidence: CONFIDENCE_LEVELS.DIRECT,
        confidenceTier: CONFIDENCE_TIERS.HIGH,
        source: 'active_editor_selection',
      };
    }

    // 4. Bounded keyword matching against workspace source files
    const matchedFiles = this.findBoundedWorkspaceMatches(userInput, workspacePath);
    if (matchedFiles.length > 0) {
      return {
        count: matchedFiles.length,
        targetFiles: matchedFiles,
        confidence: CONFIDENCE_LEVELS.STRUCTURAL,
        confidenceTier: CONFIDENCE_TIERS.MEDIUM,
        source: 'intent_keyword_match',
      };
    }

    // 5. Active file without selection in editor
    if (activeFilePath && typeof activeFilePath === 'string') {
      return {
        count: 1,
        targetFiles: [path.basename(activeFilePath)],
        confidence: CONFIDENCE_LEVELS.HEURISTIC,
        confidenceTier: CONFIDENCE_TIERS.MEDIUM,
        source: 'active_editor_file',
      };
    }

    // 6. Intent-based heuristic fallback
    const lower = userInput.toLowerCase();
    if (
      lower.includes('refactor') ||
      lower.includes('rewrite') ||
      lower.includes('across the codebase') ||
      lower.includes('audit all') ||
      lower.includes('migrate')
    ) {
      return {
        count: 4,
        targetFiles: [],
        confidence: CONFIDENCE_LEVELS.LOW,
        confidenceTier: CONFIDENCE_TIERS.LOW,
        source: 'refactor_heuristic',
      };
    }

    if (
      lower.startsWith('fix') ||
      lower.startsWith('add') ||
      lower.startsWith('implement') ||
      lower.startsWith('create') ||
      lower.startsWith('change') ||
      codingIntent === CODING_INTENTS.MUTATION
    ) {
      return {
        count: 2,
        targetFiles: [],
        confidence: CONFIDENCE_LEVELS.HEURISTIC,
        confidenceTier: CONFIDENCE_TIERS.MEDIUM,
        source: 'mutation_heuristic',
      };
    }

    return {
      count: 1,
      targetFiles: [],
      confidence: CONFIDENCE_LEVELS.LOW,
      confidenceTier: CONFIDENCE_TIERS.LOW,
      source: 'read_only_fallback',
    };
  }

  /**
   * Bounded search for keyword-relevant files in workspace root and immediate subdirs.
   * Reads at most MAX_BOUNDED_WORKSPACE_SCAN_FILES entries.
   * @param {string} prompt
   * @param {string} [workspacePath]
   * @returns {string[]} Matched relative file paths (max 4)
   */
  findBoundedWorkspaceMatches(prompt = '', workspacePath) {
    if (!workspacePath || !prompt || typeof prompt !== 'string') return [];
    try {
      if (!fs.existsSync(workspacePath)) return [];
      const promptWords = prompt
        .toLowerCase()
        .replace(/[^a-z0-9_\-\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !['the', 'and', 'for', 'with', 'this', 'that', 'from', 'all', 'project', 'file', 'code', 'help'].includes(w));

      if (promptWords.length === 0) return [];

      const foundFiles = [];
      const queue = [workspacePath];
      let scannedCount = 0;

      while (queue.length > 0 && scannedCount < MAX_BOUNDED_WORKSPACE_SCAN_FILES) {
        const currentDir = queue.shift();
        try {
          const entries = fs.readdirSync(currentDir, { withFileTypes: true });
          for (const entry of entries) {
            scannedCount++;
            if (scannedCount >= MAX_BOUNDED_WORKSPACE_SCAN_FILES) break;

            const name = entry.name;
            if (name.startsWith('.') || IGNORE_DIRS.has(name)) continue;

            const fullPath = path.join(currentDir, name);
            if (entry.isDirectory()) {
              // Only traverse 1 level deep from workspace root
              if (currentDir === workspacePath) {
                queue.push(fullPath);
              }
            } else if (entry.isFile()) {
              const lowerName = name.toLowerCase();
              const ext = path.extname(lowerName);
              if (['.ts', '.tsx', '.js', '.jsx', '.py', '.json', '.html', '.css', '.go', '.rs'].includes(ext)) {
                // Check if any keyword matches the filename
                const matched = promptWords.some((kw) => lowerName.includes(kw));
                if (matched) {
                  const rel = path.relative(workspacePath, fullPath);
                  foundFiles.push(rel);
                  if (foundFiles.length >= 4) return foundFiles;
                }
              }
            }
          }
        } catch (_) {}
      }

      return foundFiles;
    } catch (_) {
      return [];
    }
  }

  /**
   * Estimates projected tool calls range, approximate steps, and confidence.
   * @param {string} mode
   * @param {string|null} codingIntent
   * @param {number} fileCount
   * @param {string} prompt
   * @returns {{ min: number, max: number, approximate: number, confidence: number, intent: string }}
   */
  estimateToolCalls(mode, codingIntent, fileCount = 1, prompt = '') {
    if (mode === ROUTER_MODES.CONVERSATION) {
      return { min: 0, max: 0, approximate: 0, confidence: 0.98, intent: 'CONVERSATION' };
    }

    const lower = (prompt || '').toLowerCase();
    const isRefactor =
      lower.includes('refactor') ||
      lower.includes('rewrite') ||
      lower.includes('across the codebase') ||
      fileCount >= 4;

    if (isRefactor) {
      return { min: 8, max: 15, approximate: 10, confidence: 0.65, intent: 'REFACTOR' };
    }

    if (codingIntent === CODING_INTENTS.MUTATION) {
      const minSteps = Math.min(3 * Math.max(1, fileCount), 8);
      const maxSteps = Math.min(4 * Math.max(1, fileCount) + 2, 14);
      const approx = Math.round((minSteps + maxSteps) / 2);
      return { min: minSteps, max: maxSteps, approximate: approx, confidence: 0.75, intent: 'MUTATION' };
    }

    // READ_ONLY
    return { min: 1, max: 3, approximate: 2, confidence: 0.85, intent: 'READ_ONLY' };
  }

  /**
   * Evaluates risk level based on intent, file scope, prompt keywords, and budget status.
   * @param {string} mode
   * @param {string|null} codingIntent
   * @param {number} fileCount
   * @param {Object} budgetStatus
   * @param {string} [prompt]
   * @returns {'LOW'|'MEDIUM'|'HIGH'}
   */
  evaluateRisk(mode, codingIntent, fileCount, budgetStatus, prompt = '') {
    if (mode === ROUTER_MODES.CONVERSATION) {
      return 'LOW';
    }

    if (budgetStatus && budgetStatus.isCritical) {
      return 'HIGH';
    }

    const lower = (prompt || '').toLowerCase();
    const isRefactor =
      lower.includes('refactor') ||
      lower.includes('rewrite') ||
      lower.includes('across the codebase') ||
      fileCount >= 4;

    if (fileCount >= 4 || codingIntent === 'REFACTOR' || isRefactor) {
      return 'HIGH';
    }

    if (codingIntent === CODING_INTENTS.MUTATION || fileCount >= 2 || (budgetStatus && budgetStatus.isApproaching)) {
      return 'MEDIUM';
    }

    return 'LOW';
  }

  /**
   * Calculates provider cost matrix for primary model and comparison models.
   * @param {number} inputTokens
   * @param {number} outputTokens
   * @param {string} providerId
   * @param {string} modelId
   * @returns {{
   *   pricingAvailable: boolean,
   *   estimatedCostUSD: number|null,
   *   inputCostUSD: number|null,
   *   outputCostUSD: number|null,
   *   primaryCostFormatted: string,
   *   providerCosts: Record<string, string>|null,
   *   rates: { inputUsdPerMillion: number, outputUsdPerMillion: number }|null
   * }}
   */
  calculateCost(inputTokens, outputTokens, providerId, modelId) {
    const primaryPricing = getModelPricing(providerId, modelId);

    let estimatedCostUSD = null;
    let inputCostUSD = null;
    let outputCostUSD = null;
    let primaryCostFormatted = 'Cost unavailable';

    if (primaryPricing.pricingAvailable) {
      inputCostUSD = (inputTokens / 1_000_000) * primaryPricing.inputUsdPerMillion;
      outputCostUSD = (outputTokens / 1_000_000) * primaryPricing.outputUsdPerMillion;
      const total = inputCostUSD + outputCostUSD;
      estimatedCostUSD = total > 0 ? Math.max(0.0001, Math.round(total * 10000) / 10000) : 0;
      primaryCostFormatted = `~$${estimatedCostUSD.toFixed(4)}`;
    }

    // Build multi-provider comparison matrix (Gemini, Groq, OpenAI)
    const comparisonProviders = [
      { name: 'Gemini', providerId: 'gemini', modelId: 'gemini-2.5-flash' },
      { name: 'Groq', providerId: 'groq', modelId: 'openai/gpt-oss-120b' },
      { name: 'OpenAI', providerId: 'openai', modelId: 'gpt-4o' },
    ];

    const providerCosts = {};
    for (const comp of comparisonProviders) {
      const p = getModelPricing(comp.providerId, comp.modelId);
      if (p.pricingAvailable) {
        const inCost = (inputTokens / 1_000_000) * p.inputUsdPerMillion;
        const outCost = (outputTokens / 1_000_000) * p.outputUsdPerMillion;
        const tot = inCost + outCost;
        const rounded = tot > 0 ? Math.max(0.0001, Math.round(tot * 10000) / 10000) : 0;
        providerCosts[comp.name] = `~$${rounded.toFixed(4)}`;
      }
    }

    return {
      pricingAvailable: primaryPricing.pricingAvailable,
      estimatedCostUSD,
      inputCostUSD: inputCostUSD !== null ? Math.round(inputCostUSD * 10000) / 10000 : null,
      outputCostUSD: outputCostUSD !== null ? Math.round(outputCostUSD * 10000) / 10000 : null,
      primaryCostFormatted,
      providerCosts: Object.keys(providerCosts).length > 0 ? providerCosts : null,
      rates: primaryPricing.pricingAvailable
        ? {
            inputUsdPerMillion: primaryPricing.inputUsdPerMillion,
            outputUsdPerMillion: primaryPricing.outputUsdPerMillion,
          }
        : null,
    };
  }

  /**
   * Evaluates context budget status.
   * @param {number} totalTokens
   * @param {number} [budgetLimit]
   * @returns {Object} Budget status struct
   */
  evaluateBudget(totalTokens, budgetLimit = DEFAULT_TOTAL_BUDGET) {
    const limit = typeof budgetLimit === 'number' && budgetLimit > 0 ? budgetLimit : DEFAULT_TOTAL_BUDGET;
    const tokens = Math.max(0, totalTokens || 0);
    const ratio = limit > 0 ? tokens / limit : 0;
    const percentage = Math.round(ratio * 100);

    let level = BUDGET_STATUS.NORMAL;
    if (percentage >= 90) {
      level = BUDGET_STATUS.CRITICAL;
    } else if (percentage >= 75) {
      level = BUDGET_STATUS.APPROACHING;
    }

    return {
      tokens,
      budgetLimit: limit,
      ratio: Math.round(ratio * 1000) / 1000,
      percentage,
      level,
      isApproaching: level === BUDGET_STATUS.APPROACHING,
      isCritical: level === BUDGET_STATUS.CRITICAL,
    };
  }

  /**
   * Computes complete advisory preflight assessment.
   * Pure deterministic calculation without AI, Git, or storage side-effects.
   * @param {Object} input
   * @returns {Object} PreflightAssessment object
   */
  estimate(input = {}) {
    const {
      userInput = '',
      workspacePath,
      activeFilePath,
      selectionText,
      targetFiles,
      providerId = 'nexus1',
      modelId = '',
      historyItems = [],
      importedCapsule = null,
      budgetLimit,
    } = input;

    const sanitizedPrompt = typeof userInput === 'string' ? secretFilter.sanitizeString(userInput) : '';

    // 1. Classify Request Intent (Greeting / Conversation vs Coding Task)
    const routeClassification = this.classifyIntent(sanitizedPrompt, {
      activeFilePath,
      workspacePath,
      selectionText,
    });

    const isConv = routeClassification.mode === ROUTER_MODES.CONVERSATION;
    const shouldShowPreflight = !isConv && !routeClassification.isGreeting;

    // 2. Token Estimation via ContextEngine
    const promptTokens = this.estimateTokens(sanitizedPrompt);
    const selectionTokens = selectionText ? this.estimateTokens(secretFilter.sanitizeString(selectionText)) : 0;

    // Active File Tokens (Bounded 64KB read)
    let activeFileTokens = 0;
    if (!selectionText && activeFilePath && typeof activeFilePath === 'string') {
      try {
        const fullPath = path.isAbsolute(activeFilePath)
          ? activeFilePath
          : path.resolve(workspacePath || process.cwd(), activeFilePath);

        if (fs.existsSync(fullPath)) {
          const stats = fs.statSync(fullPath);
          if (stats.isFile()) {
            const bytesToRead = Math.min(stats.size, MAX_PREFLIGHT_FILE_BYTES);
            activeFileTokens = Math.ceil(bytesToRead / 4);
          }
        }
      } catch (_) {}
    }

    // History Tokens (last 10 turns)
    let historyTokens = 0;
    if (Array.isArray(historyItems) && historyItems.length > 0) {
      for (const item of historyItems.slice(-10)) {
        if (!item) continue;
        const text = item.payload?.text || item.content || item.summary || item.userInput || '';
        historyTokens += this.estimateTokens(text);
      }
    }

    // Context Capsule Tokens (count bounded imported capsule context only once)
    let capsuleTokens = 0;
    if (importedCapsule && typeof importedCapsule === 'object') {
      if (contextEngine && typeof contextEngine.formatImportedCapsule === 'function') {
        const formattedCapsule = contextEngine.formatImportedCapsule(importedCapsule);
        capsuleTokens = this.estimateTokens(formattedCapsule);
      } else {
        const capSummary = importedCapsule.conversation_context?.summary || '';
        const capGoal = importedCapsule.task_state?.primary_goal || '';
        const capExchanges = JSON.stringify(importedCapsule.conversation_context?.last_exchanges || []);
        capsuleTokens = this.estimateTokens(`${capSummary}\n${capGoal}\n${capExchanges}`);
      }
    }

    // Tool Declarations and Base System Overhead
    const toolDeclarationTokens = TOOL_DECLARATIONS_TOKEN_OVERHEAD;
    const systemTokens = BASE_SYSTEM_INSTRUCTIONS_OVERHEAD;

    // Total Input / Context Tokens
    const estimatedInputTokens = promptTokens + selectionTokens + activeFileTokens + historyTokens + capsuleTokens + toolDeclarationTokens + systemTokens;

    // 3. Expected Agent Generation / Output Tokens
    let estimatedMaxOutputTokens = 800;
    const lowerPrompt = sanitizedPrompt.toLowerCase();
    if (isConv) {
      estimatedMaxOutputTokens = 350;
    } else if (
      lowerPrompt.includes('refactor') ||
      lowerPrompt.includes('rewrite all') ||
      lowerPrompt.includes('across the codebase') ||
      lowerPrompt.includes('audit all')
    ) {
      estimatedMaxOutputTokens = 3200;
    } else if (routeClassification.codingIntent === CODING_INTENTS.MUTATION) {
      estimatedMaxOutputTokens = 1800;
    } else {
      estimatedMaxOutputTokens = 600; // READ_ONLY inspection
    }

    // Total Tokens
    const estimatedTotalTokens = estimatedInputTokens + estimatedMaxOutputTokens;

    // 4. File Estimation
    const filesAssessment = this.estimateFiles({
      userInput: sanitizedPrompt,
      workspacePath,
      activeFilePath,
      selectionText,
      targetFiles,
      codingIntent: routeClassification.codingIntent,
    });

    // 5. Tool Operations Estimation
    const toolsAssessment = this.estimateToolCalls(
      routeClassification.mode,
      routeClassification.codingIntent,
      filesAssessment.count,
      sanitizedPrompt
    );

    // 6. Cost Calculation
    const costAssessment = this.calculateCost(
      estimatedInputTokens,
      estimatedMaxOutputTokens,
      providerId,
      modelId
    );

    // 7. Context Budget Status
    const effectiveLimit = budgetLimit || (providerId === 'nexus6' || providerId === 'groq' ? CODING_TASK_BUDGET : DEFAULT_TOTAL_BUDGET);
    const budgetAssessment = this.evaluateBudget(estimatedInputTokens, effectiveLimit);

    // 8. Risk Assessment
    const riskLevel = this.evaluateRisk(
      routeClassification.mode,
      routeClassification.codingIntent,
      filesAssessment.count,
      budgetAssessment,
      sanitizedPrompt
    );

    // 9. Overall Confidence
    const overallConfidenceScore = Math.round(
      ((filesAssessment.confidence * 0.45) + (toolsAssessment.confidence * 0.35) + 0.20) * 100
    ) / 100;

    let overallConfidenceTier = CONFIDENCE_TIERS.MEDIUM;
    if (overallConfidenceScore >= 0.8) {
      overallConfidenceTier = CONFIDENCE_TIERS.HIGH;
    } else if (overallConfidenceScore < 0.5) {
      overallConfidenceTier = CONFIDENCE_TIERS.LOW;
    }

    // 10. Context Window Pre-Gating Assessment
    const activeContextWindow = getModelContextWindow(providerId, modelId);
    const contextUsageRatio = activeContextWindow ? Math.round((estimatedTotalTokens / activeContextWindow) * 1000) / 1000 : null;
    const isContextExceeded = Boolean(activeContextWindow !== null && estimatedTotalTokens > activeContextWindow);

    // 11. Model Selection Intelligence Recommendation (Deterministic & Local)
    let recommendedModel = null;
    try {
      let configuredProviders = [];
      if (input.configuredProviders && Array.isArray(input.configuredProviders)) {
        configuredProviders = input.configuredProviders;
      } else if (aiProviderRouter && typeof aiProviderRouter.getConfig === 'function') {
        const routerConfig = aiProviderRouter.getConfig();
        configuredProviders = routerConfig ? routerConfig.providers : [];
      }

      recommendedModel = modelSelectionAdvisor.recommendModel({
        mode: routeClassification.mode,
        codingIntent: routeClassification.codingIntent,
        riskLevel,
        estimatedInputTokens,
        estimatedMaxOutputTokens,
        estimatedTotalTokens,
        estimatedFilesCount: filesAssessment.count,
        estimatedToolCalls: toolsAssessment.approximate,
        currentProviderId: providerId,
        currentModelId: modelId,
        configuredProviders,
      });
    } catch (_) {
      recommendedModel = {
        providerId: null,
        modelId: null,
        modelDisplayName: null,
        reason: 'Recommendation unavailable',
        savingsEstimate: null,
        isCurrentOptimal: false,
        isContextExceeded,
        contextWindow: activeContextWindow,
      };
    }

    return {
      schemaVersion: '1.0.0',
      timestamp: Date.now(),
      shouldShowPreflight,
      mode: routeClassification.mode,
      codingIntent: routeClassification.codingIntent,
      providerId,
      modelId: costAssessment.rates ? (modelId || costAssessment.rates && getModelPricing(providerId, modelId).resolvedModelId) : (modelId || 'unknown'),
      recommendedModel,
      contextWindow: activeContextWindow,
      contextUsageRatio,
      isContextExceeded,
      estimatedInputTokens,
      estimatedMaxOutputTokens,
      estimatedTotalTokens,
      estimatedFiles: filesAssessment,
      estimatedToolCalls: toolsAssessment,
      estimatedCostUSD: costAssessment.estimatedCostUSD,
      inputCostUSD: costAssessment.inputCostUSD,
      outputCostUSD: costAssessment.outputCostUSD,
      primaryCostFormatted: costAssessment.primaryCostFormatted,
      providerCosts: costAssessment.providerCosts,
      pricingAvailable: costAssessment.pricingAvailable,
      rates: costAssessment.rates,
      budgetStatus: budgetAssessment,
      riskLevel,
      confidence: overallConfidenceTier,
      confidenceScore: overallConfidenceScore,
      breakdown: {
        prompt: promptTokens,
        activeFile: activeFileTokens,
        selection: selectionTokens,
        history: historyTokens,
        capsule: capsuleTokens,
        tools: toolDeclarationTokens,
        system: systemTokens,
      },
    };
  }
}

const preflightEstimator = new PreflightEstimator();

module.exports = {
  PreflightEstimator,
  preflightEstimator,
};
