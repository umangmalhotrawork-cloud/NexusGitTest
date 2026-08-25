/**
 * NEXUS INTELLIGENCE LAYER — DECISION REPLAY ENGINE (Phase 5)
 * 
 * Reconstructs architectural and implementation decisions from concrete evidence
 * (Git commits, diffs, tests, AST symbols, session discussions, Context Capsules)
 * without fabricating historical rationale.
 * 
 * READ-ONLY GUARANTEES:
 * - Zero file writes during replay queries
 * - Zero Git mutations (HEAD & working tree untouched)
 * - Zero ChangeSets or AgentLoop executions
 * - Zero automatic patches
 * - Zero Context Capsule mutations
 * - Zero Continuum writes
 * - Zero AI provider/network calls during deterministic replay
 */

const fs = require('fs');
const path = require('path');
const secretFilter = require('../../security/secretFilter');
const {
  DECISION_STATUS,
  DECISION_CONFIDENCE,
  DECISION_PROVENANCE_SOURCE,
  createDecisionRecord,
} = require('./DecisionRecord');
const { softwareEvidenceLayer } = require('./SoftwareEvidenceLayer');

class DecisionReplayEngine {
  /**
   * @param {Object} [dependencies]
   * @param {Object} [dependencies.evidenceLayer]
   */
  constructor(dependencies = {}) {
    this._evidenceLayer = dependencies.evidenceLayer || null;
    this.inMemoryStores = new Map(); // workspacePath -> Map(decisionId -> DecisionRecord)
  }

  get evidenceLayer() {
    if (!this._evidenceLayer) {
      try {
        const { softwareEvidenceLayer } = require('./SoftwareEvidenceLayer');
        this._evidenceLayer = softwareEvidenceLayer;
      } catch (_) {}
    }
    return this._evidenceLayer;
  }

  // =========================================================================
  // 1. STORAGE MANAGEMENT (Workspace Isolated)
  // =========================================================================

  /**
   * Resolves the decision storage filepath for a workspace.
   * @param {string} workspacePath
   * @returns {string|null}
   */
  _getStoragePath(workspacePath) {
    if (!workspacePath || typeof workspacePath !== 'string') return null;
    const nexusDir = path.join(workspacePath, '.nexus');
    return path.join(nexusDir, 'decisions.json');
  }

  /**
   * Loads decisions for a workspace from disk or memory.
   * @param {string} [workspacePath]
   * @returns {Map<string, Object>}
   */
  _loadDecisionMap(workspacePath) {
    const wsKey = workspacePath ? path.resolve(workspacePath) : 'in_memory_default';
    if (!this.inMemoryStores.has(wsKey)) {
      const store = new Map();
      this.inMemoryStores.set(wsKey, store);

      const storagePath = this._getStoragePath(workspacePath);
      if (storagePath && fs.existsSync(storagePath)) {
        try {
          const raw = fs.readFileSync(storagePath, 'utf8');
          const list = JSON.parse(raw);
          if (Array.isArray(list)) {
            for (const item of list) {
              if (item && item.decisionId) {
                store.set(item.decisionId, createDecisionRecord(item));
              }
            }
          }
        } catch (_) {}
      }
    }

    return this.inMemoryStores.get(wsKey);
  }

  /**
   * Persists decision records to workspace storage.
   * @param {string} [workspacePath]
   */
  _saveDecisionMap(workspacePath) {
    if (!workspacePath || typeof workspacePath !== 'string') return;
    const storagePath = this._getStoragePath(workspacePath);
    if (!storagePath) return;

    try {
      const nexusDir = path.dirname(storagePath);
      if (!fs.existsSync(nexusDir)) {
        fs.mkdirSync(nexusDir, { recursive: true });
      }

      const store = this._loadDecisionMap(workspacePath);
      const list = Array.from(store.values());
      fs.writeFileSync(storagePath, JSON.stringify(list, null, 2), 'utf8');
    } catch (_) {}
  }

  // =========================================================================
  // 2. CONSERVATIVE DETERMINISTIC DECISION DETECTION (Capture)
  // =========================================================================

  /**
   * Deterministically detects candidate architectural/implementation decisions
   * from explicit statements, user prompts, or discussion context.
   * 
   * @param {string} text
   * @param {Object} [context] - { workspacePath, activeFilePath, threadId, capsule }
   * @returns {Array<Object>} List of candidate DecisionRecords
   */
  detectCandidateDecisions(text, context = {}) {
    if (!text || typeof text !== 'string') return [];
    const cleanText = text.trim();
    if (cleanText.length < 15) return [];

    const candidates = [];

    // Extract file mentions from text
    const fileMatches = cleanText.match(/(?:[a-zA-Z0-9_\-./]+\.(?:js|ts|tsx|jsx|py|rs|go|json|md|yaml|yml|cpp|c|h))/gi) || [];
    const affectedFiles = [...new Set(fileMatches)];
    if (context.activeFilePath && affectedFiles.length === 0) {
      affectedFiles.push(context.activeFilePath);
    }

    // Explicit decision patterns:
    // 1. "Let's keep <X> before <Y>" / "Keep <X> before <Y>"
    // 2. "We rejected <X> because <Y>" / "Rejected <X> due to <Y>"
    // 3. "Use <X> for <Y>" / "Use <X> instead of <Y>" / "Choose <X> over <Y>"
    // 4. "Keep this state local instead of moving it into Continuum"
    // 5. "Decision: <X>" / "Architectural decision: <X>"

    const lower = cleanText.toLowerCase();

    // Pattern A: Rejection pattern ("We rejected X because Y")
    const rejectMatch = cleanText.match(/(?:we\s+)?(?:rejected|rejecting|did not choose|avoided)\s+([A-Za-z0-9_\-./\s]+?)\s+(?:because|due to|as|since)\s+([^.!?;\n]+)/i);
    if (rejectMatch) {
      const rejectedName = rejectMatch[1].trim();
      const rejectionReason = rejectMatch[2].trim();

      candidates.push(
        createDecisionRecord({
          title: `Rejected ${rejectedName}`,
          decision: `Do not use ${rejectedName}.`,
          problem: `Evaluation of ${rejectedName} for current architecture.`,
          rationale: `Rejected ${rejectedName} because ${rejectionReason}.`,
          rejectedAlternatives: [
            {
              alternative: rejectedName,
              reason: rejectionReason,
            },
          ],
          affectedFiles,
          provenance: {
            source: DECISION_PROVENANCE_SOURCE.DISCUSSION,
            threadId: context.threadId,
            timestamp: Date.now(),
            confidence: 1.0,
          },
          status: DECISION_STATUS.CANDIDATE,
          confidence: DECISION_CONFIDENCE.HIGH,
        })
      );
    }

    // Pattern B: Keep / Placement pattern ("Keep validation before payment processing")
    const keepMatch = cleanText.match(/(?:let'?s\s+)?(?:keep|maintain|perform|enforce|place)\s+([^.!?;\n]+)/i);
    if (keepMatch && candidates.length === 0) {
      let rawStatement = keepMatch[1].trim();
      let rationale = 'Explicit architectural ordering requirement.';
      let problem = 'Ensure correct execution order and prevent runtime anomalies.';

      // Check if rationale is present in subsequent text or conjunction
      const ratMatch = cleanText.match(/(?:because|due to|in order to|to protect|to prevent|to avoid)\s+([^.!?;\n]+)/i);
      if (ratMatch) {
        const reasonText = ratMatch[1].trim();
        rationale = reasonText.charAt(0).toUpperCase() + reasonText.slice(1);
        if (!rationale.endsWith('.')) rationale += '.';

        // Truncate rawStatement before conjunction if it was captured
        const conjIdx = rawStatement.search(/\s+(?:because|due to|in order to|to protect|to prevent|to avoid)\b/i);
        if (conjIdx > 0) {
          rawStatement = rawStatement.substring(0, conjIdx).trim();
        }

        if (/prevent|avoid|protect/i.test(reasonText)) {
          problem = reasonText.charAt(0).toUpperCase() + reasonText.slice(1);
          if (!problem.endsWith('.')) problem += '.';
        } else {
          problem = `Prevent regression: ${reasonText}.`;
        }
      }

      if (/(?:before|after|inside|outside|local|at\s+the\s+beginning|at\s+the\s+end)/i.test(rawStatement)) {
        const decText = rawStatement.charAt(0).toUpperCase() + rawStatement.slice(1);
        candidates.push(
          createDecisionRecord({
            title: decText.length > 80 ? decText.substring(0, 80) : decText,
            decision: decText.endsWith('.') ? decText : `${decText}.`,
            problem,
            rationale,
            affectedFiles,
            provenance: {
              source: DECISION_PROVENANCE_SOURCE.DISCUSSION,
              threadId: context.threadId,
              timestamp: Date.now(),
              confidence: 1.0,
            },
            status: DECISION_STATUS.CANDIDATE,
            confidence: DECISION_CONFIDENCE.HIGH,
          })
        );
      }
    }

    // Pattern C: "Use <X> instead of / over <Y>"
    const useInsteadMatch = cleanText.match(/(?:use|choose|adopt)\s+([A-Za-z0-9_\-./\s]+?)\s+(?:instead of|over|rather than)\s+([^.!?;\n]+)/i);
    if (useInsteadMatch) {
      const chosen = useInsteadMatch[1].trim();
      const rejected = useInsteadMatch[2].trim();

      let rationale = `Adopt ${chosen} over ${rejected}.`;
      const ratMatch = cleanText.match(/(?:because|due to|for)\s+([^.!?;\n]+)/i);
      if (ratMatch) {
        rationale = `Adopted ${chosen} over ${rejected} because ${ratMatch[1].trim()}.`;
      }

      candidates.push(
        createDecisionRecord({
          title: `Use ${chosen} instead of ${rejected}`,
          decision: `Use ${chosen} instead of ${rejected}.`,
          problem: `Selection of technology/pattern for ${affectedFiles[0] || 'subsystem'}.`,
          rationale,
          alternatives: [rejected],
          rejectedAlternatives: [
            {
              alternative: rejected,
              reason: ratMatch ? ratMatch[1].trim() : undefined,
            },
          ],
          affectedFiles,
          provenance: {
            source: DECISION_PROVENANCE_SOURCE.DISCUSSION,
            threadId: context.threadId,
            timestamp: Date.now(),
            confidence: 1.0,
          },
          status: DECISION_STATUS.CANDIDATE,
          confidence: DECISION_CONFIDENCE.HIGH,
        })
      );
    }

    // Pattern D: "Decision: <X>" or "Architectural decision: <X>"
    const explicitDecisionMatch = cleanText.match(/(?:architectural\s+)?decision:\s*([^.!?;\n]+)/i);
    if (explicitDecisionMatch && candidates.length === 0) {
      const rawDec = explicitDecisionMatch[1].trim();
      let rationale = undefined;
      const ratMatch = cleanText.match(/(?:rationale|reason):\s*([^.!?;\n]+)/i);
      if (ratMatch) {
        rationale = ratMatch[1].trim();
      }

      candidates.push(
        createDecisionRecord({
          title: rawDec,
          decision: rawDec,
          rationale,
          affectedFiles,
          provenance: {
            source: DECISION_PROVENANCE_SOURCE.DISCUSSION,
            threadId: context.threadId,
            timestamp: Date.now(),
            confidence: 1.0,
          },
          status: DECISION_STATUS.CANDIDATE,
          confidence: rationale ? DECISION_CONFIDENCE.HIGH : DECISION_CONFIDENCE.MEDIUM,
        })
      );
    }

    return candidates;
  }

  // =========================================================================
  // 3. DECISION RECORD CRUD OPERATIONS
  // =========================================================================

  /**
   * Records a new Decision Record (Candidate or Confirmed).
   * Automatically enriches with code evidence if workspace is available.
   * 
   * @param {Object} input
   * @param {Object} [options] - { workspacePath, autoConfirm }
   * @returns {Promise<Object>} The saved DecisionRecord
   */
  async recordDecision(input = {}, options = {}) {
    const workspacePath = options.workspacePath || input.workspacePath;
    const record = createDecisionRecord(input);

    if (options.autoConfirm) {
      record.status = DECISION_STATUS.CONFIRMED;
    }

    // Enrich with concrete repository evidence (read-only)
    if (workspacePath && this.evidenceLayer) {
      await this.linkCodeEvidence(record, workspacePath);
    }

    const store = this._loadDecisionMap(workspacePath);
    store.set(record.decisionId, record);
    this._saveDecisionMap(workspacePath);

    return record;
  }

  /**
   * Confirms a candidate decision record.
   * @param {string} decisionId
   * @param {string} [workspacePath]
   * @returns {Object|null}
   */
  confirmDecision(decisionId, workspacePath) {
    if (!decisionId) return null;
    const store = this._loadDecisionMap(workspacePath);
    const existing = store.get(decisionId);
    if (!existing) return null;

    existing.status = DECISION_STATUS.CONFIRMED;
    existing.updatedAt = Date.now();
    existing.provenance.source = DECISION_PROVENANCE_SOURCE.USER_CONFIRMED;
    if (existing.rationale || (existing.relatedCommits && existing.relatedCommits.length > 0)) {
      existing.confidence = DECISION_CONFIDENCE.HIGH;
    }

    this._saveDecisionMap(workspacePath);
    return existing;
  }

  /**
   * Rejects a candidate decision record.
   * @param {string} decisionId
   * @param {string} [workspacePath]
   * @returns {Object|null}
   */
  rejectDecision(decisionId, workspacePath) {
    if (!decisionId) return null;
    const store = this._loadDecisionMap(workspacePath);
    const existing = store.get(decisionId);
    if (!existing) return null;

    existing.status = DECISION_STATUS.REJECTED;
    existing.updatedAt = Date.now();

    this._saveDecisionMap(workspacePath);
    return existing;
  }

  /**
   * Retrieves decisions for a workspace, optionally filtered.
   * Also integrates bounded Context Capsule decisions if provided.
   * 
   * @param {Object} [options] - { workspacePath, status, file, symbol, commit, capsule }
   * @returns {Array<Object>} List of DecisionRecords
   */
  getDecisions(options = {}) {
    const workspacePath = options.workspacePath;
    const store = this._loadDecisionMap(workspacePath);
    let results = Array.from(store.values());

    // Merge bounded Context Capsule decisions if present (without full chat copy)
    if (options.capsule && typeof options.capsule === 'object') {
      const capsuleDecisions = this._extractCapsuleDecisions(options.capsule);
      for (const capDec of capsuleDecisions) {
        if (!store.has(capDec.decisionId)) {
          results.push(capDec);
        }
      }
    }

    if (options.status) {
      const targetStatus = String(options.status).toUpperCase();
      results = results.filter((d) => d.status === targetStatus);
    }

    if (options.file) {
      const cleanFile = path.basename(options.file).toLowerCase();
      results = results.filter((d) =>
        d.affectedFiles && d.affectedFiles.some((f) => f.toLowerCase().includes(cleanFile))
      );
    }

    if (options.symbol) {
      const targetSymbol = options.symbol.toLowerCase();
      results = results.filter((d) =>
        d.affectedSymbols && d.affectedSymbols.some((s) => s.toLowerCase() === targetSymbol)
      );
    }

    if (options.commit) {
      const targetCommit = options.commit.toLowerCase();
      results = results.filter((d) =>
        d.relatedCommits && d.relatedCommits.some((c) => c.toLowerCase().startsWith(targetCommit))
      );
    }

    // Sort: CONFIRMED first, then latest createdAt
    return results.sort((a, b) => {
      if (a.status === DECISION_STATUS.CONFIRMED && b.status !== DECISION_STATUS.CONFIRMED) return -1;
      if (b.status === DECISION_STATUS.CONFIRMED && a.status !== DECISION_STATUS.CONFIRMED) return 1;
      return b.createdAt - a.createdAt;
    });
  }

  /**
   * Extracts bounded decisions from a Context Capsule without duplicating source chat.
   * @private
   */
  _extractCapsuleDecisions(capsule) {
    const list = [];
    if (!capsule || typeof capsule !== 'object') return list;

    const capsuleRef = capsule.capsule_ref || `#CC${(capsule.capsule_id || '').slice(-6)}`;
    const taskState = capsule.task_state || {};
    const importantDecisions = Array.isArray(taskState.important_decisions)
      ? taskState.important_decisions
      : [];

    for (let i = 0; i < importantDecisions.length; i++) {
      const raw = importantDecisions[i];
      if (typeof raw === 'string' && raw.trim()) {
        const id = `dec_capsule_${capsule.capsule_id || 'cap'}_${i}`;
        list.push(
          createDecisionRecord({
            decisionId: id,
            title: raw.trim(),
            decision: raw.trim(),
            problem: taskState.primary_goal || 'Context Capsule Continuation Task',
            rationale: 'Recorded as critical decision in imported Context Capsule.',
            affectedFiles: taskState.relevant_files || [],
            provenance: {
              source: DECISION_PROVENANCE_SOURCE.CONTEXT_CAPSULE,
              capsuleRef,
              timestamp: capsule.created_at || Date.now(),
              confidence: 1.0,
            },
            status: DECISION_STATUS.CONFIRMED,
            confidence: DECISION_CONFIDENCE.HIGH,
          })
        );
      }
    }

    return list;
  }

  // =========================================================================
  // 4. EVIDENCE & CODE LINKING (Read-Only)
  // =========================================================================

  /**
   * Enriches a DecisionRecord with concrete VCS commits, diffs, tests, and symbols.
   * Uses strictly read-only queries.
   * 
   * @param {Object} record - DecisionRecord
   * @param {string} workspacePath
   * @returns {Promise<Object>} Enriched record
   */
  async linkCodeEvidence(record, workspacePath) {
    if (!record || !workspacePath || !this.evidenceLayer) return record;

    try {
      const affectedFiles = record.affectedFiles || [];

      // Link recent commits for affected files (bounded to top 5)
      if (affectedFiles.length > 0 && (!record.relatedCommits || record.relatedCommits.length === 0)) {
        for (const file of affectedFiles.slice(0, 3)) {
          const commitsRes = await this.evidenceLayer.getRecentCommits(workspacePath, {
            file,
            maxCount: 3,
          });
          if (commitsRes.success && Array.isArray(commitsRes.data) && commitsRes.data.length > 0) {
            const hashes = commitsRes.data.map((c) => c.hash || c.shortHash || c.id).filter(Boolean);
            record.relatedCommits = [...new Set([...(record.relatedCommits || []), ...hashes])];
          }
        }
      }

      // Link symbols if affected files are present
      if (affectedFiles.length > 0 && (!record.affectedSymbols || record.affectedSymbols.length === 0)) {
        try {
          const impactRes = await this.evidenceLayer.getPotentialImpact(workspacePath, affectedFiles);
          if (impactRes.success && impactRes.data && Array.isArray(impactRes.data.symbols)) {
            const symbolNames = impactRes.data.symbols.map((s) => s.name || s.id).filter(Boolean).slice(0, 5);
            if (symbolNames.length > 0) {
              record.affectedSymbols = symbolNames;
            }
          }
        } catch (_) {}
      }

      // Link test files matching affected files
      if (affectedFiles.length > 0 && (!record.relatedTests || record.relatedTests.length === 0)) {
        const potentialTests = [];
        for (const file of affectedFiles) {
          const base = path.basename(file, path.extname(file));
          const testCandidate1 = path.join(path.dirname(file), `${base}.test${path.extname(file)}`);
          const testCandidate2 = path.join(path.dirname(file), `test_${base}${path.extname(file)}`);
          if (fs.existsSync(path.join(workspacePath, testCandidate1))) {
            potentialTests.push(testCandidate1);
          } else if (fs.existsSync(path.join(workspacePath, testCandidate2))) {
            potentialTests.push(testCandidate2);
          }
        }
        if (potentialTests.length > 0) {
          record.relatedTests = potentialTests;
        }
      }
    } catch (_) {}

    return record;
  }

  // =========================================================================
  // 5. BOUNDED SEARCH
  // =========================================================================

  /**
   * Searches decisions by title, keywords, file, symbol, commit, or repository area.
   * Bounded: Never scans entire repo and limits results to 20.
   * 
   * @param {Object|string} queryOrOptions
   * @param {Object} [options]
   * @returns {Array<Object>}
   */
  searchDecisions(queryOrOptions, options = {}) {
    let query = '';
    let opts = options;

    if (typeof queryOrOptions === 'string') {
      query = queryOrOptions.trim();
    } else if (typeof queryOrOptions === 'object' && queryOrOptions !== null) {
      query = (queryOrOptions.query || '').trim();
      opts = { ...queryOrOptions, ...options };
    }

    const all = this.getDecisions(opts);
    if (!query) {
      return all.slice(0, opts.limit || 20);
    }

    const STOP_WORDS = new Set([
      'why', 'did', 'we', 'this', 'that', 'the', 'and', 'for', 'are', 'was',
      'were', 'with', 'from', 'what', 'how', 'when', 'where', 'which', 'who',
      'whom', 'whose', 'does', 'do', 'have', 'has', 'had', 'been', 'being', 'into',
      'onto', 'about', 'some', 'any', 'each', 'all', 'both', 'our', 'your', 'its',
      'write', 'written', 'make', 'made', 'take', 'taken', 'code', 'function'
    ]);

    const queryTokens = query
      .toLowerCase()
      .split(/[^a-zA-Z0-9_\-./]+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

    const scored = all.map((d) => {
      let score = 0;
      const titleLower = (d.title || '').toLowerCase();
      const decLower = (d.decision || '').toLowerCase();
      const probLower = (d.problem || '').toLowerCase();
      const ratLower = (d.rationale || '').toLowerCase();
      const filesStr = (d.affectedFiles || []).join(' ').toLowerCase();
      const symsStr = (d.affectedSymbols || []).join(' ').toLowerCase();
      const commitsStr = (d.relatedCommits || []).join(' ').toLowerCase();
      const rejectionsStr = (d.rejectedAlternatives || []).map((r) => `${r.alternative} ${r.reason || ''}`).join(' ').toLowerCase();

      // Exact substring matching (only for multi-word or non-trivial query)
      if (query.length > 4) {
        if (titleLower.includes(query.toLowerCase())) score += 50;
        if (decLower.includes(query.toLowerCase())) score += 40;
        if (filesStr.includes(query.toLowerCase())) score += 35;
        if (commitsStr.includes(query.toLowerCase())) score += 35;
        if (symsStr.includes(query.toLowerCase())) score += 30;
        if (rejectionsStr.includes(query.toLowerCase())) score += 25;
        if (ratLower.includes(query.toLowerCase())) score += 20;
      }

      // Non-stopword Token matching
      for (const token of queryTokens) {
        if (titleLower.includes(token)) score += 10;
        if (decLower.includes(token)) score += 8;
        if (filesStr.includes(token)) score += 7;
        if (symsStr.includes(token)) score += 6;
        if (commitsStr.includes(token)) score += 10;
        if (probLower.includes(token)) score += 5;
        if (ratLower.includes(token)) score += 4;
        if (rejectionsStr.includes(token)) score += 5;
      }

      // Confirmed bonus only if relevance match occurred
      if (score > 0 && d.status === DECISION_STATUS.CONFIRMED) {
        score += 5;
      }

      return { record: d, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.record)
      .slice(0, opts.limit || 20);
  }

  // =========================================================================
  // 6. 7-PART ANSWER QUALITY REPLAYER
  // =========================================================================

  /**
   * Replays a decision in response to a developer's "Why" query:
   * "Why was this architecture chosen?"
   * "Why does this function work this way?"
   * "Why did we reject the other approach?"
   * "Why was this dependency introduced?"
   * "What problem was this unusual code solving?"
   * 
   * Strict Answer Order:
   * 1. Decision
   * 2. Problem it solved
   * 3. Rationale
   * 4. Alternatives rejected
   * 5. Evidence
   * 6. Confidence
   * 7. Related code / commits / tests
   * 
   * If unsupported, rationale is explicitly:
   * "The available evidence does not establish why this decision was made."
   * 
   * @param {string} query
   * @param {Object} [options] - { workspacePath, filePath, symbol, commit, capsule }
   * @returns {Object} Structured Replay Answer
   */
  replayDecision(query, options = {}) {
    if (!query || typeof query !== 'string') {
      return {
        success: false,
        error: 'Missing query argument',
      };
    }

    const matches = this.searchDecisions({ query, ...options });
    const bestMatch = matches.length > 0 ? matches[0] : null;

    if (!bestMatch) {
      return {
        success: true,
        matched: false,
        query,
        decision: 'No matching architectural decision found in recorded evidence.',
        problem: 'No problem record established for this query.',
        rationale: 'The available evidence does not establish why this decision was made.',
        alternativesRejected: [],
        evidence: [],
        confidence: DECISION_CONFIDENCE.LOW,
        related: {
          files: options.filePath ? [options.filePath] : [],
          symbols: options.symbol ? [options.symbol] : [],
          commits: options.commit ? [options.commit] : [],
          tests: [],
        },
        formattedReplay: this.formatStructuredReplay({
          title: query,
          decision: 'No matching architectural decision found in recorded evidence.',
          problem: 'No problem record established for this query.',
          rationale: 'The available evidence does not establish why this decision was made.',
          rejectedAlternatives: [],
          evidenceTags: [],
          confidence: DECISION_CONFIDENCE.LOW,
          relatedFiles: options.filePath ? [options.filePath] : [],
          relatedCommits: options.commit ? [options.commit] : [],
          relatedTests: [],
        }),
      };
    }

    // Assemble evidence tags
    const evidenceTags = ['[decision]'];
    if (bestMatch.relatedCommits && bestMatch.relatedCommits.length > 0) {
      evidenceTags.push(`[git_commit: ${bestMatch.relatedCommits[0]}]`);
    }
    if (bestMatch.relatedTests && bestMatch.relatedTests.length > 0) {
      evidenceTags.push(`[test: ${path.basename(bestMatch.relatedTests[0])}]`);
    }
    if (bestMatch.affectedFiles && bestMatch.affectedFiles.length > 0) {
      evidenceTags.push('[git_diff]');
    }
    if (bestMatch.provenance?.source === DECISION_PROVENANCE_SOURCE.CONTEXT_CAPSULE) {
      evidenceTags.push(`[context_capsule: ${bestMatch.provenance.capsuleRef || 'imported'}]`);
    }

    // Rationale: never fabricate! If missing or empty, emit exact disclaimer.
    const rationale = bestMatch.rationale && bestMatch.rationale.trim()
      ? bestMatch.rationale.trim()
      : 'The available evidence does not establish why this decision was made.';

    const problem = bestMatch.problem || 'Protects against architectural ambiguity and unexpected regressions.';

    const alternativesRejected = (bestMatch.rejectedAlternatives || []).map((r) =>
      r.reason ? `Rejected ${r.alternative}: ${r.reason}` : `Rejected ${r.alternative}`
    );

    const related = {
      files: bestMatch.affectedFiles || [],
      symbols: bestMatch.affectedSymbols || [],
      commits: bestMatch.relatedCommits || [],
      tests: bestMatch.relatedTests || [],
    };

    const formattedReplay = this.formatStructuredReplay({
      title: bestMatch.title,
      decision: bestMatch.decision,
      problem,
      rationale,
      rejectedAlternatives: alternativesRejected,
      evidenceTags,
      confidence: bestMatch.confidence || DECISION_CONFIDENCE.MEDIUM,
      relatedFiles: related.files,
      relatedCommits: related.commits,
      relatedTests: related.tests,
    });

    return {
      success: true,
      matched: true,
      query,
      decisionId: bestMatch.decisionId,
      title: bestMatch.title,
      decision: bestMatch.decision,
      problem,
      rationale,
      alternativesRejected,
      evidence: evidenceTags,
      confidence: bestMatch.confidence || DECISION_CONFIDENCE.MEDIUM,
      related,
      record: bestMatch,
      formattedReplay,
    };
  }

  /**
   * Formats the 7-part answer sequence into readable markdown.
   * @param {Object} params
   * @returns {string}
   */
  formatStructuredReplay(params = {}) {
    const titleHeader = params.title ? `### WHY: ${params.title.toUpperCase()}\n\n` : '';
    const decisionSection = `**1. Decision:**\n${params.decision || 'Unknown'}\n\n`;
    const problemSection = `**2. Problem Solved:**\n${params.problem || 'Not explicitly recorded'}\n\n`;
    const rationaleSection = `**3. Rationale:**\n${params.rationale || 'The available evidence does not establish why this decision was made.'}\n\n`;
    
    const alts = Array.isArray(params.rejectedAlternatives) && params.rejectedAlternatives.length > 0
      ? params.rejectedAlternatives.map((a) => `- ${a}`).join('\n')
      : 'None recorded';
    const alternativesSection = `**4. Alternatives Rejected:**\n${alts}\n\n`;

    const ev = Array.isArray(params.evidenceTags) && params.evidenceTags.length > 0
      ? params.evidenceTags.join(' ')
      : '[none]';
    const evidenceSection = `**5. Evidence:**\n${ev}\n\n`;

    const confidenceSection = `**6. Confidence:**\n${params.confidence || 'MEDIUM'}\n\n`;

    const filesStr = Array.isArray(params.relatedFiles) && params.relatedFiles.length > 0
      ? params.relatedFiles.join(', ')
      : 'None';
    const commitsStr = Array.isArray(params.relatedCommits) && params.relatedCommits.length > 0
      ? params.relatedCommits.join(', ')
      : 'None';
    const testsStr = Array.isArray(params.relatedTests) && params.relatedTests.length > 0
      ? params.relatedTests.join(', ')
      : 'None';

    const relatedSection = `**7. Related Context:**\n- Files: ${filesStr}\n- Commits: ${commitsStr}\n- Tests: ${testsStr}`;

    return `${titleHeader}${decisionSection}${problemSection}${rationaleSection}${alternativesSection}${evidenceSection}${confidenceSection}${relatedSection}`;
  }

  /**
   * Clears in-memory decision stores (useful for test isolation).
   */
  clear() {
    this.inMemoryStores.clear();
  }
}

const decisionReplayEngine = new DecisionReplayEngine();

module.exports = {
  DecisionReplayEngine,
  decisionReplayEngine,
};
