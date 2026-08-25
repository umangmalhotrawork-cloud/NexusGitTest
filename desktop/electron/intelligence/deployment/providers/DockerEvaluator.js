/**
 * NEXUS INTELLIGENCE LAYER — DOCKER COMPATIBILITY EVALUATOR (Phase 2A)
 * 
 * Evaluates project compatibility for containerized deployment (Self-Hosted, Cloud Run, AWS ECS, Kubernetes):
 * - Evaluates Dockerfile, docker-compose.yml presence and container readiness.
 * - Distinguishes detected Docker artifacts from validated image builds.
 * - Suitable for any runtime (Node.js, Python, multi-tier) capable of containerization.
 */

const {
  PROVIDER_IDS,
  PROVIDER_DISPLAY_NAMES,
  SUITABILITY,
  CONFIDENCE,
  COMPUTE_SERVICE_TYPE,
  DATABASE_STRATEGY,
  createPlatformRecommendation,
} = require('../PlatformRecommendation');

class DockerEvaluator {
  constructor() {
    this.providerId = PROVIDER_IDS.DOCKER;
    this.displayName = PROVIDER_DISPLAY_NAMES[this.providerId];
  }

  /**
   * Evaluates a DeploymentReport against Containerized / Docker capabilities
   * @param {Object} report - DeploymentReport struct
   * @returns {Object} PlatformRecommendation
   */
  evaluate(report = {}) {
    if (!report || typeof report !== 'object') {
      return createPlatformRecommendation({
        providerId: this.providerId,
        displayName: this.displayName,
        suitability: SUITABILITY.INCOMPATIBLE,
        score: 0,
        confidence: CONFIDENCE.LOW,
        reasons: ['Malformed or missing deployment report.'],
      });
    }

    const { frontend, backend, database, project, findings = [] } = report;
    let score = 50;
    let confidence = CONFIDENCE.HIGH;
    let serviceType = COMPUTE_SERVICE_TYPE.DOCKER_CONTAINER;
    let buildCommand = 'docker build -t app .';
    let startCommand = 'docker run -p 8080:8080 app';
    let outputDir = null;
    let rootDir = null;

    const reasons = [];
    const blockers = [];
    const warnings = [];

    let dbStrategy = DATABASE_STRATEGY.NOT_REQUIRED;
    let dbRecommendedProvider = null;
    let dbRationale = 'No database detected.';

    // 1. Unknown / Empty Project
    if (!frontend?.detected && !backend?.detected && !database?.detected && !project?.hasDocker) {
      return createPlatformRecommendation({
        providerId: this.providerId,
        displayName: this.displayName,
        suitability: SUITABILITY.INCOMPATIBLE,
        score: 10,
        confidence: CONFIDENCE.LOW,
        reasons: ['Insufficient repository evidence to determine Docker compatibility.'],
      });
    }

    // 2. Evaluate Docker Artifact Presence
    if (project?.hasDocker) {
      score = 96;
      reasons.push(`Custom ${project.dockerfile || 'Dockerfile'} detected in repository root ready for container building.`);
      if (project.dockerCompose) {
        reasons.push(`Multi-container composition detected in ${project.dockerCompose}.`);
      }
    } else if (backend?.detected) {
      // Backend detected without Dockerfile
      score = 85;
      confidence = CONFIDENCE.MEDIUM;
      reasons.push(`Project shape (${backend.framework || backend.runtime}) can be containerized with a standard Dockerfile.`);
      warnings.push({
        code: 'DOCKERFILE_NOT_FOUND',
        title: 'Dockerfile Not Yet Created',
        message: 'No Dockerfile exists in workspace root. Containerized deployment will require creating a base image Dockerfile.',
        recommendation: 'Generate a Dockerfile for this project before deploying to container hosts.',
      });
    } else if (frontend?.detected) {
      score = 80;
      confidence = CONFIDENCE.MEDIUM;
      reasons.push(`Static frontend (${frontend.framework}) can be containerized using an Nginx or Caddy base image.`);
    }

    // 3. Host Binding Inspection
    if (backend?.detected) {
      const rule01Finding = findings.find((f) => f.ruleId === 'RULE-01');
      if (backend.hostBinding === '127.0.0.1' || backend.hostBinding === 'localhost' || (rule01Finding && rule01Finding.severity === 'BLOCKER')) {
        score = 20;
        blockers.push({
          code: 'DOCKER_PORT_FORWARDING_BLOCKED',
          title: 'Docker Port Forwarding Blocked by Loopback Binding',
          message: 'Server binds to 127.0.0.1. In Docker containers, binding to localhost prevents published ports (-p 8080:8080) from receiving host traffic.',
          recommendation: 'Update server listen call to bind to 0.0.0.0 (e.g. app.listen(port, "0.0.0.0")).',
        });
      }
    }

    // 4. Evaluate Database Strategy
    if (database?.detected) {
      if (database.isSQLite) {
        dbStrategy = DATABASE_STRATEGY.PERSISTENT_VOLUME;
        dbRecommendedProvider = 'docker_volume';
        dbRationale = 'Mount a host directory or Docker named volume to persist SQLite database file.';
        reasons.push('Docker named volume mounts enable persistent SQLite data storage.');
      } else if (project?.dockerCompose) {
        dbStrategy = DATABASE_STRATEGY.CO_LOCATED;
        dbRecommendedProvider = 'docker_compose_db';
        dbRationale = 'Database service defined directly in docker-compose.yml with internal bridge networking.';
        reasons.push('Co-located database container orchestration supported via docker-compose.');
      } else {
        dbStrategy = DATABASE_STRATEGY.MANAGED_EXTERNAL;
        dbRecommendedProvider = 'managed_cloud_db';
        dbRationale = `Connect container to external ${database.technology} database instance.`;
      }
    }

    return createPlatformRecommendation({
      providerId: this.providerId,
      displayName: this.displayName,
      score,
      confidence,
      computeTarget: {
        serviceType,
        rootDir,
        buildCommand,
        startCommand,
        outputDir,
      },
      databaseTarget: {
        strategy: dbStrategy,
        recommendedProvider: dbRecommendedProvider,
        rationale: dbRationale,
      },
      reasons,
      blockers,
      warnings,
    });
  }
}

module.exports = DockerEvaluator;
