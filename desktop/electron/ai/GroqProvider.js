/**
 * NEXUS Multi-Model AI Architecture - Groq Provider Adapter
 */

const OpenAICompatibleProvider = require('./OpenAICompatibleProvider');
const { PROVIDER_IDS, DEFAULT_MODELS } = require('./types');

class GroqProvider extends OpenAICompatibleProvider {
  constructor(
    id = PROVIDER_IDS.GROQ,
    name = 'Groq',
    staticModels = [
      { id: 'openai/gpt-oss-120b', name: 'OpenAI GPT-OSS 120B (High Intelligence & Active)' },
      { id: 'openai/gpt-oss-20b', name: 'OpenAI GPT-OSS 20B' },
      { id: 'groq/compound', name: 'Groq Compound (Fast Multi-Expert)' },
      { id: 'groq/compound-mini', name: 'Groq Compound Mini' },
      { id: 'qwen/qwen3.6-27b', name: 'Qwen 3.6 27B' },
      { id: 'allam-2-7b', name: 'ALLaM 2 7B' },
      { id: 'canopylabs/orpheus-v1-english', name: 'Canopy Labs Orpheus English' },
    ],
    defaultModel = DEFAULT_MODELS[id] || 'openai/gpt-oss-120b',
    options = {}
  ) {
    super(
      id,
      name,
      'https://api.groq.com/openai/v1',
      staticModels,
      defaultModel,
      { supportsJsonMode: true, ...options }
    );
    this.slotIndex = options.slotIndex || null;
    this.secondaryName = options.secondaryName || 'Groq';
  }

  /**
   * Retrieves genuinely verified rate-limit / remaining requests & tokens from Groq API headers.
   * @param {string} apiKey
   * @returns {Promise<{ isAvailable: boolean, display: string, raw: Object|null, error?: string }>}
   */
  async getVerifiedUsage(apiKey) {
    if (!this.isConfigured(apiKey)) {
      return {
        isAvailable: false,
        display: 'Not available',
        raw: null,
      };
    }

    try {
      if (this.lastRateLimitHeaders && (Date.now() - this.lastRateLimitHeaders.timestamp) < 60000) {
        return this.formatVerifiedUsage(this.lastRateLimitHeaders);
      }

      const res = await this.request('/models', 'GET', apiKey, null, {}, 8000);
      const headers = res.headers || {};
      const extracted = this.extractRateLimitHeaders(headers);
      if (extracted) {
        this.lastRateLimitHeaders = extracted;
        return this.formatVerifiedUsage(extracted);
      }
    } catch (err) {
      if (err.headers) {
        const extracted = this.extractRateLimitHeaders(err.headers);
        if (extracted) {
          this.lastRateLimitHeaders = extracted;
          return this.formatVerifiedUsage(extracted);
        }
      }
    }

    if (this.lastRateLimitHeaders) {
      return this.formatVerifiedUsage(this.lastRateLimitHeaders);
    }

    return {
      isAvailable: false,
      display: 'Not available',
      raw: null,
    };
  }

  formatVerifiedUsage(limits) {
    if (!limits) {
      return { isAvailable: false, display: 'Not available', raw: null };
    }
    const parts = [];
    if (typeof limits.remainingRequests === 'number') {
      const rem = limits.remainingRequests.toLocaleString();
      const lim = typeof limits.limitRequests === 'number' ? ` / ${limits.limitRequests.toLocaleString()}` : '';
      parts.push(`${rem}${lim} reqs`);
    }
    if (typeof limits.remainingTokens === 'number') {
      const remTokens = limits.remainingTokens >= 1000
        ? `${(limits.remainingTokens / 1000).toFixed(0)}k`
        : limits.remainingTokens.toLocaleString();
      parts.push(`${remTokens} tokens`);
    }
    if (limits.resetRequests) {
      parts.push(`reset ${limits.resetRequests}`);
    }

    if (parts.length > 0) {
      return {
        isAvailable: true,
        display: parts.join(' • '),
        raw: limits,
      };
    }

    return {
      isAvailable: false,
      display: 'Not available',
      raw: limits,
    };
  }
}

module.exports = GroqProvider;
