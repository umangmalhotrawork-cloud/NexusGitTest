/**
 * NEXUS Multi-Model AI Architecture - DeepSeek Provider Adapter
 */

const OpenAICompatibleProvider = require('./OpenAICompatibleProvider');
const { PROVIDER_IDS, DEFAULT_MODELS } = require('./types');

class DeepSeekProvider extends OpenAICompatibleProvider {
  constructor() {
    super(
      PROVIDER_IDS.DEEPSEEK,
      'DeepSeek',
      'https://api.deepseek.com',
      [
        { id: 'deepseek-coder', name: 'DeepSeek Coder' },
        { id: 'deepseek-chat', name: 'DeepSeek Chat' },
        { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner (R1)' },
      ],
      DEFAULT_MODELS[PROVIDER_IDS.DEEPSEEK] || 'deepseek-coder',
      { supportsJsonMode: true }
    );
  }

  /**
   * Retrieves genuinely verified user balance from DeepSeek API (/user/balance).
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
      const res = await this.request('/user/balance', 'GET', apiKey, null, {}, 8000);
      const data = res.data;
      if (data && data.is_available && Array.isArray(data.balance_infos) && data.balance_infos.length > 0) {
        const info = data.balance_infos.find((b) => Number(b.total_balance) > 0) || data.balance_infos[0];
        const total = info.total_balance;
        const curr = info.currency || 'CNY';
        if (total !== undefined && total !== null) {
          return {
            isAvailable: true,
            display: `Balance: ${curr === 'USD' ? '$' : ''}${total}${curr !== 'USD' ? ` ${curr}` : ''}`,
            raw: data,
          };
        }
      }
    } catch (err) {
      // Fallback cleanly
    }

    return {
      isAvailable: false,
      display: 'Not available',
      raw: null,
    };
  }
}

module.exports = DeepSeekProvider;
