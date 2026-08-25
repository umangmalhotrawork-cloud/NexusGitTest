/**
 * NEXUS INTELLIGENCE LAYER — DECISION RECORD (Phase 5)
 * Structured Decision Record Schema, Validation, and Normalization.
 * Strictly decoupled from Continuum Lineage and Context Capsule storage.
 */

const crypto = require('crypto');
const secretFilter = require('../../security/secretFilter');

const DECISION_STATUS = Object.freeze({
  CANDIDATE: 'CANDIDATE',
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
});

const DECISION_CONFIDENCE = Object.freeze({
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
});

const DECISION_PROVENANCE_SOURCE = Object.freeze({
  DISCUSSION: 'explicit_discussion',
  CONTEXT_CAPSULE: 'context_capsule',
  EVIDENCE_GRAPH: 'evidence_graph',
  USER_CONFIRMED: 'user_confirmed',
  VCS: 'git_commit',
  TEST: 'test_assertion',
  STATIC_SPEC: 'architectural_spec',
});

/**
 * Generates a unique decision identifier.
 * Format: dec_<timestamp>_<hex>
 * @param {number} [timestamp]
 * @returns {string}
 */
function generateDecisionId(timestamp = Date.now()) {
  const ts = typeof timestamp === 'number' && !isNaN(timestamp) && timestamp > 0 ? timestamp : Date.now();
  const rand = crypto.randomBytes(4).toString('hex');
  return `dec_${ts}_${rand}`;
}

/**
 * Creates and normalizes a structured Decision Record.
 * Supports partial fields as per specification.
 * 
 * @param {Object} input
 * @returns {Object} Structured DecisionRecord
 */
function createDecisionRecord(input = {}) {
  const now = typeof input.createdAt === 'number' ? input.createdAt : Date.now();
  const decisionId = input.decisionId || generateDecisionId(now);

  const rawTitle = input.title || input.decision || 'Architectural Decision';
  const rawDecision = input.decision || input.statement || input.title || '';
  const rawProblem = input.problem || '';
  const rawRationale = input.rationale || '';

  // Sanitize free-form text strings
  const title = secretFilter.sanitizeString(String(rawTitle).trim());
  const decision = secretFilter.sanitizeString(String(rawDecision).trim());
  const problem = rawProblem ? secretFilter.sanitizeString(String(rawProblem).trim()) : undefined;
  const summary = input.summary ? secretFilter.sanitizeString(String(input.summary).trim()) : (decision ? decision.slice(0, 150) : undefined);
  const rationale = rawRationale ? secretFilter.sanitizeString(String(rawRationale).trim()) : undefined;

  // Alternatives and rejected alternatives normalization
  let alternatives = [];
  if (Array.isArray(input.alternatives)) {
    alternatives = input.alternatives
      .filter((a) => typeof a === 'string' && a.trim())
      .map((a) => secretFilter.sanitizeString(a.trim()));
  }

  let rejectedAlternatives = [];
  if (Array.isArray(input.rejectedAlternatives)) {
    rejectedAlternatives = input.rejectedAlternatives
      .map((r) => {
        if (typeof r === 'string') {
          return {
            alternative: secretFilter.sanitizeString(r.trim()),
            reason: undefined,
          };
        } else if (r && typeof r === 'object') {
          return {
            alternative: secretFilter.sanitizeString(String(r.alternative || r.name || '').trim()),
            reason: r.reason ? secretFilter.sanitizeString(String(r.reason).trim()) : undefined,
          };
        }
        return null;
      })
      .filter((r) => r && r.alternative);
  }

  // Assumptions
  let assumptions = [];
  if (Array.isArray(input.assumptions)) {
    assumptions = input.assumptions
      .filter((a) => typeof a === 'string' && a.trim())
      .map((a) => secretFilter.sanitizeString(a.trim()));
  }

  // Affected files & symbols
  let affectedFiles = [];
  if (Array.isArray(input.affectedFiles)) {
    affectedFiles = [...new Set(input.affectedFiles.filter((f) => typeof f === 'string' && f.trim()))];
  } else if (typeof input.affectedFiles === 'string' && input.affectedFiles.trim()) {
    affectedFiles = [input.affectedFiles.trim()];
  }

  let affectedSymbols = [];
  if (Array.isArray(input.affectedSymbols)) {
    affectedSymbols = [...new Set(input.affectedSymbols.filter((s) => typeof s === 'string' && s.trim()))];
  } else if (typeof input.affectedSymbols === 'string' && input.affectedSymbols.trim()) {
    affectedSymbols = [input.affectedSymbols.trim()];
  }

  // Related commits & tests
  let relatedCommits = [];
  if (Array.isArray(input.relatedCommits)) {
    relatedCommits = [...new Set(input.relatedCommits.filter((c) => typeof c === 'string' && c.trim()))];
  } else if (typeof input.relatedCommits === 'string' && input.relatedCommits.trim()) {
    relatedCommits = [input.relatedCommits.trim()];
  }

  let relatedTests = [];
  if (Array.isArray(input.relatedTests)) {
    relatedTests = [...new Set(input.relatedTests.filter((t) => typeof t === 'string' && t.trim()))];
  } else if (typeof input.relatedTests === 'string' && input.relatedTests.trim()) {
    relatedTests = [input.relatedTests.trim()];
  }

  // Provenance metadata
  const provenance = {
    source: input.provenance?.source || DECISION_PROVENANCE_SOURCE.DISCUSSION,
    timestamp: typeof input.provenance?.timestamp === 'number' ? input.provenance.timestamp : now,
    threadId: input.provenance?.threadId || input.threadId || undefined,
    capsuleRef: input.provenance?.capsuleRef || input.capsuleRef || undefined,
    confidence: typeof input.provenance?.confidence === 'number' ? input.provenance.confidence : 1.0,
    readOnly: true,
  };

  // Status: CANDIDATE | CONFIRMED | REJECTED
  let status = DECISION_STATUS.CANDIDATE;
  if (input.status && DECISION_STATUS[input.status.toUpperCase()]) {
    status = DECISION_STATUS[input.status.toUpperCase()];
  } else if (input.userApproved || input.confirmed) {
    status = DECISION_STATUS.CONFIRMED;
  }

  // Confidence Tier: HIGH | MEDIUM | LOW
  let confidence = DECISION_CONFIDENCE.MEDIUM;
  if (input.confidence && DECISION_CONFIDENCE[input.confidence.toUpperCase()]) {
    confidence = DECISION_CONFIDENCE[input.confidence.toUpperCase()];
  } else if (status === DECISION_STATUS.CONFIRMED && (rationale || relatedCommits.length > 0)) {
    confidence = DECISION_CONFIDENCE.HIGH;
  } else if (!rationale && affectedFiles.length === 0) {
    confidence = DECISION_CONFIDENCE.LOW;
  }

  return {
    decisionId,
    title,
    summary,
    decision,
    problem,
    rationale,
    alternatives: alternatives.length > 0 ? alternatives : undefined,
    rejectedAlternatives: rejectedAlternatives.length > 0 ? rejectedAlternatives : undefined,
    assumptions: assumptions.length > 0 ? assumptions : undefined,
    affectedFiles: affectedFiles.length > 0 ? affectedFiles : undefined,
    affectedSymbols: affectedSymbols.length > 0 ? affectedSymbols : undefined,
    relatedCommits: relatedCommits.length > 0 ? relatedCommits : undefined,
    relatedTests: relatedTests.length > 0 ? relatedTests : undefined,
    provenance,
    status,
    confidence,
    createdAt: now,
    updatedAt: typeof input.updatedAt === 'number' ? input.updatedAt : now,
  };
}

module.exports = {
  DECISION_STATUS,
  DECISION_CONFIDENCE,
  DECISION_PROVENANCE_SOURCE,
  generateDecisionId,
  createDecisionRecord,
};
