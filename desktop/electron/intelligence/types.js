/**
 * NEXUS INTELLIGENCE LAYER — TYPE DEFINITIONS & CONTRACTS (Phase 2)
 * 
 * Provides clean, strongly-typed contracts, pricing matrices, and provenance models
 * for the Read-Only Software Evidence Layer and Preflight Cost Estimator.
 */

// =========================================================================
// 1. BUDGET & HEALTH TIERS
// =========================================================================

const BUDGET_STATUS = Object.freeze({
  NORMAL: 'NORMAL',          // < 75% of budget ceiling
  APPROACHING: 'APPROACHING', // >= 75% and < 90% of budget ceiling
  CRITICAL: 'CRITICAL',       // >= 90% of budget ceiling
});

const CONFIDENCE_TIERS = Object.freeze({
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
});

const CONFIDENCE_LEVELS = Object.freeze({
  DIRECT: 1.0,     // Direct explicit artifact or verified query
  STRUCTURAL: 0.8, // AST/Graph or explicit filename reference in prompt
  HEURISTIC: 0.5,  // Contextual heuristic (e.g. active file assumption)
  LOW: 0.3,        // Broad unverified estimate
});

const EVIDENCE_TYPES = Object.freeze({
  DIAGNOSTIC: 'diagnostic',
  TEST: 'test',
  GIT_COMMIT: 'git_commit',
  GIT_DIFF: 'git_diff',
  DEPENDENCY_CHANGE: 'dependency_change',
  CONFIG_CHANGE: 'config_change',
  CODE_CHANGE: 'code_change',
  CALL_GRAPH: 'call_graph',
  VERIFICATION: 'verification',
});

const PROVENANCE_SOURCE = Object.freeze({
  VCS: 'git_manager',
  AST: 'symbol_index',
  DIAGNOSTIC: 'diagnostic_parser',
  TEST: 'test_result_parser',
  EVIDENCE: 'evidence_graph',
  PREFLIGHT: 'preflight_cost_estimator',
  BREAKAGE: 'breakage_correlator',
  STATIC_CATALOG: 'pricing_catalog',
});


// =========================================================================
// 2. MODEL PRICING CATALOG (USD per 1,000,000 Tokens)
// =========================================================================

/**
 * Standard published pricing rates per 1M tokens.
 * Provider & Model aliases are automatically normalized.
 */
const MODEL_PRICING_CATALOG = Object.freeze({
  // Google Gemini Models
  'gemini-2.5-flash': { inputUsdPerMillion: 0.075, outputUsdPerMillion: 0.30 },
  'gemini-3.5-flash': { inputUsdPerMillion: 0.075, outputUsdPerMillion: 0.30 },
  'gemini-2.5-pro': { inputUsdPerMillion: 1.25, outputUsdPerMillion: 5.00 },
  'gemini-2.0-flash': { inputUsdPerMillion: 0.10, outputUsdPerMillion: 0.40 },
  'gemini-1.5-flash': { inputUsdPerMillion: 0.075, outputUsdPerMillion: 0.30 },
  'gemini-1.5-pro': { inputUsdPerMillion: 1.25, outputUsdPerMillion: 5.00 },

  // Groq / Open Models
  'openai/gpt-oss-120b': { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.60 },
  'llama-3.3-70b-versatile': { inputUsdPerMillion: 0.59, outputUsdPerMillion: 0.79 },
  'llama-3.1-8b-instant': { inputUsdPerMillion: 0.05, outputUsdPerMillion: 0.08 },
  'mixtral-8x7b-32768': { inputUsdPerMillion: 0.24, outputUsdPerMillion: 0.24 },

  // OpenAI Models
  'gpt-4o': { inputUsdPerMillion: 2.50, outputUsdPerMillion: 10.00 },
  'gpt-4o-mini': { inputUsdPerMillion: 0.15, outputUsdPerMillion: 0.60 },
  'o1-preview': { inputUsdPerMillion: 15.00, outputUsdPerMillion: 60.00 },
  'o1-mini': { inputUsdPerMillion: 3.00, outputUsdPerMillion: 12.00 },

  // Anthropic Claude Models
  'claude-3-5-sonnet-20241022': { inputUsdPerMillion: 3.00, outputUsdPerMillion: 15.00 },
  'claude-3-5-sonnet': { inputUsdPerMillion: 3.00, outputUsdPerMillion: 15.00 },
  'claude-3-5-haiku-20241022': { inputUsdPerMillion: 0.80, outputUsdPerMillion: 4.00 },
  'claude-3-5-haiku': { inputUsdPerMillion: 0.80, outputUsdPerMillion: 4.00 },

  // DeepSeek Models
  'deepseek-coder': { inputUsdPerMillion: 0.14, outputUsdPerMillion: 0.28 },
  'deepseek-chat': { inputUsdPerMillion: 0.14, outputUsdPerMillion: 0.28 },

  // xAI Grok Models
  'grok-2-latest': { inputUsdPerMillion: 2.00, outputUsdPerMillion: 10.00 },
  'grok-beta': { inputUsdPerMillion: 5.00, outputUsdPerMillion: 15.00 },
});

// Slot to Default Model Mappings for NEXUS 1-6
const SLOT_DEFAULT_MODELS = Object.freeze({
  nexus1: 'gemini-2.5-flash',
  nexus2: 'gemini-3.5-flash',
  nexus3: 'gemini-3.5-flash',
  nexus4: 'gemini-3.5-flash',
  nexus5: 'gemini-3.5-flash',
  nexus6: 'openai/gpt-oss-120b',
  gemini: 'gemini-2.5-flash',
  groq: 'openai/gpt-oss-120b',
  openai: 'gpt-4o',
  claude: 'claude-3-5-sonnet-20241022',
  deepseek: 'deepseek-coder',
  grok: 'grok-2-latest',
});

/**
 * Resolves pricing metadata for a given provider and model.
 * Handles slot names, prefixes, and defaults gracefully.
 * @param {string} [providerId]
 * @param {string} [modelId]
 * @returns {{ pricingAvailable: boolean, inputUsdPerMillion: number|null, outputUsdPerMillion: number|null, resolvedModelId: string }}
 */
function getModelPricing(providerId = '', modelId = '') {
  const normProvider = String(providerId || '').toLowerCase().trim();
  let candidateModel = String(modelId || '').trim();

  // Strip common prefix wrappers e.g. "models/"
  if (candidateModel.startsWith('models/')) {
    candidateModel = candidateModel.slice(7);
  }

  // Fallback to provider/slot default if modelId is empty or default
  if (!candidateModel || candidateModel === 'default') {
    candidateModel = SLOT_DEFAULT_MODELS[normProvider] || '';
  }

  const rates = MODEL_PRICING_CATALOG[candidateModel];
  if (rates) {
    return {
      pricingAvailable: true,
      inputUsdPerMillion: rates.inputUsdPerMillion,
      outputUsdPerMillion: rates.outputUsdPerMillion,
      resolvedModelId: candidateModel,
    };
  }

  return {
    pricingAvailable: false,
    inputUsdPerMillion: null,
    outputUsdPerMillion: null,
    resolvedModelId: candidateModel || 'unknown',
  };
}

// =========================================================================
// 3. MODEL CONTEXT WINDOW SPECIFICATIONS (Authoritative Tokens)
// =========================================================================

/**
 * Authoritative context window limits for verified catalog models (in tokens).
 */
const MODEL_CONTEXT_WINDOWS = Object.freeze({
  // Google Gemini Models
  'gemini-2.5-flash': 1_048_576,
  'gemini-3.5-flash': 1_048_576,
  'gemini-2.0-flash': 1_048_576,
  'gemini-1.5-flash': 1_048_576,
  'gemini-2.5-pro': 2_097_152,
  'gemini-1.5-pro': 2_097_152,

  // Anthropic Claude Models
  'claude-3-5-sonnet-20241022': 200_000,
  'claude-3-5-sonnet': 200_000,
  'claude-3-5-haiku-20241022': 200_000,
  'claude-3-5-haiku': 200_000,
  'claude-3-opus-20240229': 200_000,
  'claude-3-haiku-20240307': 200_000,

  // OpenAI Models
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'o1-preview': 128_000,
  'o1-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-3.5-turbo': 16_385,

  // Groq Models
  'openai/gpt-oss-120b': 128_000,
  'openai/gpt-oss-20b': 128_000,
  'llama-3.3-70b-versatile': 128_000,
  'llama-3.1-8b-instant': 128_000,
  'groq/compound': 128_000,
  'groq/compound-mini': 128_000,
  'qwen/qwen3.6-27b': 128_000,
  'mixtral-8x7b-32768': 32_768,

  // DeepSeek Models
  'deepseek-coder': 64_000,
  'deepseek-chat': 64_000,
  'deepseek-reasoner': 64_000,

  // xAI Grok Models
  'grok-2-latest': 128_000,
  'grok-beta': 128_000,
  'grok-vision-beta': 128_000,
});

/**
 * Resolves the authoritative context window for a given provider and model.
 * Returns null if the model's limit is unknown (never guesses or invents a fallback).
 * @param {string} [providerId]
 * @param {string} [modelId]
 * @returns {number|null} Token limit or null if unknown
 */
function getModelContextWindow(providerId = '', modelId = '') {
  const normProvider = String(providerId || '').toLowerCase().trim();
  let candidateModel = String(modelId || '').trim();

  if (candidateModel.startsWith('models/')) {
    candidateModel = candidateModel.slice(7);
  }

  if (!candidateModel || candidateModel === 'default') {
    candidateModel = SLOT_DEFAULT_MODELS[normProvider] || '';
  }

  const windowLimit = MODEL_CONTEXT_WINDOWS[candidateModel];
  if (typeof windowLimit === 'number' && windowLimit > 0) {
    return windowLimit;
  }

  return null;
}

// =========================================================================
// 3. FACTORY / HELPER CONSTRUCTORS
// =========================================================================

/**
 * Creates a structured EvidenceRef record.
 */
function createEvidenceRef(options = {}) {
  return {
    id: options.id || `ev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    type: options.type || 'OBSERVATION',
    source: options.source || PROVENANCE_SOURCE.VCS,
    timestamp: options.timestamp || Date.now(),
    confidence: typeof options.confidence === 'number' ? options.confidence : CONFIDENCE_LEVELS.DIRECT,
    uri: options.uri || null,
    summary: options.summary || '',
    metadata: options.metadata || {},
  };
}

/**
 * Creates a structured EvidenceQueryResult container.
 */
function createEvidenceQueryResult(options = {}) {
  return {
    success: options.success !== false,
    count: Array.isArray(options.data) ? options.data.length : (options.data ? 1 : 0),
    data: options.data !== undefined ? options.data : null,
    provenance: {
      source: options.source || PROVENANCE_SOURCE.VCS,
      timestamp: Date.now(),
      confidence: typeof options.confidence === 'number' ? options.confidence : CONFIDENCE_LEVELS.DIRECT,
      readOnly: true,
    },
    error: options.error || null,
  };
}

module.exports = {
  BUDGET_STATUS,
  CONFIDENCE_TIERS,
  CONFIDENCE_LEVELS,
  EVIDENCE_TYPES,
  PROVENANCE_SOURCE,
  MODEL_PRICING_CATALOG,
  MODEL_CONTEXT_WINDOWS,
  SLOT_DEFAULT_MODELS,
  getModelPricing,
  getModelContextWindow,
  createEvidenceRef,
  createEvidenceQueryResult,
};

