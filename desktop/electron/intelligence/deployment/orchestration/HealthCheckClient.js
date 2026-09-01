/**
 * NEXUS INTELLIGENCE LAYER — HEALTH CHECK CLIENT (Phase 4C)
 * 
 * Deterministic HTTP/HTTPS health check polling client for backend pre-deployment verification.
 * 
 * STRICT INVARIANTS:
 * - Validates HTTPS URLs derived from trusted provider adapter outputs only.
 * - Non-blocking polling with configurable interval (default: 2s) and timeout (default: 30s).
 * - Expects HTTP 2xx response.
 * - If no healthCheckPath was detected in repository evidence, safely returns skipped status.
 * - 0 LLM tokens, 100% deterministic local network operations.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 30000;

class HealthCheckClient {
  constructor(options = {}) {
    this.pollIntervalMs = options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.fetchFn = options.fetchFn || null; // For dependency injection in automated tests
  }

  /**
   * Validates target URL structure
   * @param {string} rawUrl
   * @returns {URL}
   */
  validateUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') {
      throw new Error('Invalid URL: target URL must be a non-empty string.');
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (err) {
      throw new Error(`Invalid URL format: ${err.message}`);
    }

    // Accept HTTPS, and accept HTTP for localhost/127.0.0.1 (used in mock node tests)
    const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && (!isLocalhost || parsed.protocol !== 'http:')) {
      throw new Error(`Insecure protocol rejected: ${parsed.protocol} (HTTPS required for cloud targets)`);
    }

    return parsed;
  }

  /**
   * Performs a single HTTP GET request
   * @param {string} fullUrl
   * @returns {Promise<{ statusCode: number, ok: boolean }>}
   */
  async singleProbe(fullUrl) {
    if (this.fetchFn) {
      const res = await this.fetchFn(fullUrl);
      return {
        statusCode: res.status || (res.ok ? 200 : 500),
        ok: res.ok !== undefined ? res.ok : (res.status >= 200 && res.status < 300),
      };
    }

    const parsed = this.validateUrl(fullUrl);
    const lib = parsed.protocol === 'https:' ? https : http;

    return new Promise((resolve, reject) => {
      const req = lib.get(fullUrl, { timeout: 5000, agent: false }, (res) => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        resolve({
          statusCode: res.statusCode || 0,
          ok,
        });
        // Consume response data to free up memory
        res.resume();
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Probe request timed out'));
      });
    });
  }

  /**
   * Polls health check endpoint until 2xx or timeout
   * @param {string} baseUrl - e.g. "https://api-stage.onrender.com"
   * @param {string|null} [healthCheckPath] - e.g. "/api/health" or null
   * @param {Object} [options]
   * @returns {Promise<{ ok: boolean, statusCode?: number, durationMs: number, skipped?: boolean, error?: string }>}
   */
  async check(baseUrl, healthCheckPath = null, options = {}) {
    const startTime = Date.now();
    const timeout = options.timeoutMs || this.timeoutMs;
    const interval = options.pollIntervalMs || this.pollIntervalMs;

    if (!healthCheckPath || typeof healthCheckPath !== 'string' || !healthCheckPath.trim()) {
      return {
        ok: true,
        skipped: true,
        durationMs: 0,
        message: 'Health check skipped (no healthCheckPath detected in repository evidence).',
      };
    }

    let targetUrl;
    try {
      const parsedBase = this.validateUrl(baseUrl);
      const cleanPath = healthCheckPath.startsWith('/') ? healthCheckPath : `/${healthCheckPath}`;
      targetUrl = `${parsedBase.origin}${cleanPath}`;
    } catch (err) {
      return {
        ok: false,
        durationMs: Date.now() - startTime,
        error: `HEALTH_CHECK_INVALID_URL: ${err.message}`,
      };
    }

    let lastError = null;
    let lastStatusCode = 0;

    while (Date.now() - startTime < timeout) {
      try {
        const probeRes = await this.singleProbe(targetUrl);
        lastStatusCode = probeRes.statusCode;

        if (probeRes.ok) {
          return {
            ok: true,
            statusCode: probeRes.statusCode,
            durationMs: Date.now() - startTime,
            targetUrl,
          };
        }
      } catch (err) {
        lastError = err;
      }

      // Wait poll interval before next attempt
      await new Promise((resolve) => setTimeout(resolve, Math.min(interval, Math.max(10, timeout - (Date.now() - startTime)))));
    }

    const durationMs = Date.now() - startTime;
    return {
      ok: false,
      statusCode: lastStatusCode || 0,
      durationMs,
      error: `HEALTH_CHECK_TIMEOUT: Health check timed out after ${durationMs}ms (${lastError?.message || `HTTP ${lastStatusCode}`})`,
      targetUrl,
    };
  }
}

const healthCheckClient = new HealthCheckClient();

module.exports = {
  HealthCheckClient,
  healthCheckClient,
};
