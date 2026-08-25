/**
 * NEXUS INTELLIGENCE LAYER — DOCKER CONFIG GENERATOR (Phase 2C)
 * 
 * Deterministically generates Dockerfile from actual DeploymentReport evidence.
 * 
 * STRICT INVARIANTS:
 * - 100% deterministic, 0 API/LLM tokens.
 * - Grounded in real repository evidence (runtimes, package manifests, ports, start commands).
 */

const secretFilter = require('../../../../security/secretFilter');

class DockerConfigGenerator {
  constructor() {
    this.providerId = 'docker';
    this.targetFile = 'Dockerfile';
    this.format = 'dockerfile';
  }

  /**
   * Generates Dockerfile content
   * @param {Object} report - DeploymentReport
   * @param {Object} recommendation - PlatformRecommendation
   * @param {Object} [options]
   * @returns {Object}
   */
  generate(report = {}, recommendation = {}, options = {}) {
    const { frontend, backend } = report;
    const warnings = [];
    const generatedFromEvidence = [];

    const lines = [
      '# Production Container Specification',
      '# Generated deterministically by NEXUS Deployment Intelligence',
      '',
    ];

    if (backend?.detected) {
      if (backend.runtime === 'node') {
        lines.push('FROM node:20-alpine AS runner');
        lines.push('WORKDIR /app');
        lines.push('ENV NODE_ENV=production');
        lines.push('');
        lines.push('COPY package*.json ./');
        lines.push('RUN npm ci --only=production || npm install --production');
        lines.push('COPY . .');
        lines.push('');

        let port = 3000;
        if (backend.port && /^\d+$/.test(String(backend.port))) {
          port = parseInt(String(backend.port), 10);
        }
        lines.push(`EXPOSE ${port}`);
        generatedFromEvidence.push(`backend.port: ${port}`);

        const startCmd = backend.startCommand ? backend.startCommand.replace(/^npm start \((.*)\)$/, '$1').trim() : 'npm start';
        const parts = startCmd.split(' ').map((p) => `"${p}"`).join(', ');
        lines.push(`CMD [${parts}]`);
        generatedFromEvidence.push(`backend.startCommand: ${startCmd}`);
      } else if (backend.runtime === 'python') {
        lines.push('FROM python:3.11-slim');
        lines.push('WORKDIR /app');
        lines.push('ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1');
        lines.push('');
        lines.push('COPY requirements.txt .');
        lines.push('RUN pip install --no-cache-dir -r requirements.txt');
        lines.push('COPY . .');
        lines.push('');

        let port = 8000;
        if (backend.port && /^\d+$/.test(String(backend.port))) {
          port = parseInt(String(backend.port), 10);
        }
        lines.push(`EXPOSE ${port}`);
        generatedFromEvidence.push(`backend.port: ${port}`);

        const startCmd = backend.startCommand || `uvicorn main:app --host 0.0.0.0 --port ${port}`;
        const parts = startCmd.split(' ').map((p) => `"${p}"`).join(', ');
        lines.push(`CMD [${parts}]`);
        generatedFromEvidence.push(`backend.startCommand: ${startCmd}`);
      }
    } else if (frontend?.detected) {
      // Static Frontend Nginx Container
      const publishDir = frontend.outputDirectory || 'dist';
      lines.push('FROM nginx:alpine');
      lines.push(`COPY ${publishDir} /usr/share/nginx/html`);
      lines.push('EXPOSE 80');
      lines.push('CMD ["nginx", "-g", "daemon off;"]');
      generatedFromEvidence.push(`frontend.outputDirectory: ${publishDir} (Nginx static serving)`);
    } else {
      lines.push('FROM alpine:latest');
      lines.push('WORKDIR /app');
      lines.push('CMD ["echo", "Container ready"]');
      warnings.push('Insufficient project evidence to generate specialized Docker instructions.');
    }

    const content = secretFilter.sanitizeString(lines.join('\n') + '\n');

    return {
      providerId: this.providerId,
      targetFile: this.targetFile,
      format: this.format,
      content,
      warnings,
      generatedFromEvidence,
    };
  }
}

module.exports = DockerConfigGenerator;
