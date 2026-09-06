"use client";

import React, { useState, useEffect } from "react";
import {
  BookmarkCheck,
  Search,
  HelpCircle,
  Sparkles,
  GitCommit,
  FileCode,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Layers,
  ArrowRight,
  Shield,
  Clock,
  Plus,
  RefreshCw,
  Tag,
  BookOpen,
  Check,
  X,
} from "lucide-react";

export interface DecisionRecordUI {
  decisionId: string;
  title: string;
  summary?: string;
  decision: string;
  problem?: string;
  rationale?: string;
  alternatives?: string[];
  rejectedAlternatives?: Array<{
    alternative: string;
    reason?: string;
  }>;
  assumptions?: string[];
  affectedFiles?: string[];
  affectedSymbols?: string[];
  relatedCommits?: string[];
  relatedTests?: string[];
  provenance: {
    source: string;
    timestamp: number;
    threadId?: string;
    capsuleRef?: string;
    confidence: number;
  };
  status: "CANDIDATE" | "CONFIRMED" | "REJECTED";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  createdAt: number;
  updatedAt: number;
}

interface DecisionReplayPanelProps {
  workspacePath?: string;
  onOpenFile?: (filePath: string, line?: number) => void;
  onAskAgentToImplement?: (prompt: string) => void;
  onBack?: () => void;
  onClose?: () => void;
}

export default function DecisionReplayPanel({
  workspacePath,
  onOpenFile,
  onAskAgentToImplement,
  onBack,
  onClose,
}: DecisionReplayPanelProps) {
  const [decisions, setDecisions] = useState<DecisionRecordUI[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [replayQuery, setReplayQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<"ALL" | "CONFIRMED" | "CANDIDATE" | "REJECTED">("ALL");
  const [selectedDecision, setSelectedDecision] = useState<DecisionRecordUI | null>(null);
  const [replayAnswer, setReplayAnswer] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDecision, setNewDecision] = useState("");
  const [newProblem, setNewProblem] = useState("");
  const [newRationale, setNewRationale] = useState("");

  const loadDecisions = async () => {
    setLoading(true);
    try {
      const intelligence = (window as any).electronAPI?.intelligence;
      if (intelligence?.getDecisions) {
        const res = await intelligence.getDecisions({ workspacePath });
        if (Array.isArray(res)) {
          setDecisions(res);
        }
      }
    } catch (err) {
      console.error("[DecisionReplay] Failed to load decisions:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDecisions();
  }, [workspacePath]);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      loadDecisions();
      return;
    }
    try {
      const intelligence = (window as any).electronAPI?.intelligence;
      if (intelligence?.searchDecisions) {
        const results = await intelligence.searchDecisions({ query: query.trim(), workspacePath });
        if (Array.isArray(results)) {
          setDecisions(results);
        }
      }
    } catch (err) {
      console.error("[DecisionReplay] Search error:", err);
    }
  };

  const handleReplay = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!replayQuery.trim()) return;

    setReplaying(true);
    setReplayAnswer(null);
    try {
      const intelligence = (window as any).electronAPI?.intelligence;
      if (intelligence?.replayDecision) {
        const ans = await intelligence.replayDecision({
          query: replayQuery.trim(),
          workspacePath,
        });
        setReplayAnswer(ans);
      }
    } catch (err) {
      console.error("[DecisionReplay] Replay error:", err);
    } finally {
      setReplaying(false);
    }
  };

  const handleConfirm = async (decisionId: string) => {
    try {
      const intelligence = (window as any).electronAPI?.intelligence;
      if (intelligence?.confirmDecision) {
        await intelligence.confirmDecision({ decisionId, workspacePath });
        await loadDecisions();
      }
    } catch (err) {
      console.error("[DecisionReplay] Confirm error:", err);
    }
  };

  const handleReject = async (decisionId: string) => {
    try {
      const intelligence = (window as any).electronAPI?.intelligence;
      if (intelligence?.rejectDecision) {
        await intelligence.rejectDecision({ decisionId, workspacePath });
        await loadDecisions();
      }
    } catch (err) {
      console.error("[DecisionReplay] Reject error:", err);
    }
  };

  const handleCreateDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDecision.trim()) return;

    try {
      const intelligence = (window as any).electronAPI?.intelligence;
      if (intelligence?.recordDecision) {
        await intelligence.recordDecision({
          decision: {
            title: newTitle.trim() || newDecision.trim(),
            decision: newDecision.trim(),
            problem: newProblem.trim() || undefined,
            rationale: newRationale.trim() || undefined,
            status: "CONFIRMED",
          },
          workspacePath,
          autoConfirm: true,
        });
        setShowAddModal(false);
        setNewTitle("");
        setNewDecision("");
        setNewProblem("");
        setNewRationale("");
        await loadDecisions();
      }
    } catch (err) {
      console.error("[DecisionReplay] Create error:", err);
    }
  };

  const handleHandoffToAgent = (d: DecisionRecordUI) => {
    if (!onAskAgentToImplement) return;
    const prompt = `Please review and take action on the following architectural decision:\n\nDecision: ${d.decision}\nProblem: ${d.problem || "None"}\nRationale: ${d.rationale || "None"}\nAffected Files: ${(d.affectedFiles || []).join(", ") || "Workspace"}`;
    onAskAgentToImplement(prompt);
  };

  const filteredDecisions = decisions.filter((d) => {
    if (activeFilter === "ALL") return true;
    return d.status === activeFilter;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "CONFIRMED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-sans font-medium bg-emerald-950/80 border border-emerald-500/40 text-emerald-300">
            <CheckCircle2 className="w-2.5 h-2.5" />
            Confirmed
          </span>
        );
      case "CANDIDATE":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-sans font-medium bg-amber-950/80 border border-amber-500/40 text-amber-300">
            <AlertCircle className="w-2.5 h-2.5" />
            Candidate
          </span>
        );
      case "REJECTED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-sans font-medium bg-zinc-900 border border-zinc-700 text-zinc-400">
            <XCircle className="w-2.5 h-2.5" />
            Rejected
          </span>
        );
      default:
        return null;
    }
  };

  const getConfidenceBadge = (confidence: string) => {
    switch (confidence) {
      case "HIGH":
        return <span className="text-[10px] font-sans font-medium text-emerald-400">High</span>;
      case "MEDIUM":
        return <span className="text-[10px] font-sans font-medium text-amber-400">Medium</span>;
      case "LOW":
      default:
        return <span className="text-[10px] font-sans font-medium text-zinc-400">Low</span>;
    }
  };

  return (
    <div className="flex flex-col h-full w-full min-w-0 max-w-full bg-[#0E1013] text-zinc-200 border-r border-[#22252B] select-none font-sans text-xs overflow-hidden">
      {/* Header */}
      <div className="h-10 px-3 border-b border-[#22252B] flex items-center justify-between shrink-0 min-w-0 max-w-full bg-[#0E1013] font-sans">
        <div className="flex items-center gap-2 min-w-0">
          <BookmarkCheck className="w-4 h-4 text-[#4CC2DE] shrink-0" />
          <span className="font-semibold text-zinc-100 text-sm tracking-tight truncate">Decision Replay</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setShowAddModal(true)}
            className="p-1 rounded hover:bg-[#1A1C22] text-[#8C92A4] hover:text-[#4CC2DE] transition-colors cursor-pointer"
            title="Log New Decision"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={loadDecisions}
            className="p-1 rounded hover:bg-[#1A1C22] text-[#8C92A4] hover:text-zinc-200 transition-colors cursor-pointer"
            title="Refresh Decisions"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[#1A1C22] text-[#8C92A4] hover:text-zinc-200 transition-colors cursor-pointer"
              title="Close Decision Replay (Back to Explorer)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* "Why" Replay Question Bar */}
      <div className="p-2.5 border-b border-[#22252B] bg-[#0E1013] shrink-0 min-w-0 max-w-full font-sans">
        <form onSubmit={handleReplay} className="space-y-1.5 min-w-0 max-w-full">
          <label className="text-xs font-sans text-zinc-300 font-medium flex items-center gap-1.5 min-w-0">
            <HelpCircle className="w-3.5 h-3.5 text-[#8C92A4] shrink-0" />
            <span className="truncate">Ask "Why" about Architecture or Code:</span>
          </label>
          <div className="flex items-center gap-1.5 min-w-0 max-w-full">
            <input
              type="text"
              value={replayQuery}
              onChange={(e) => setReplayQuery(e.target.value)}
              placeholder="e.g. Why is validation before payment?"
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md bg-[#14161B] border border-[#22252B] text-zinc-200 text-xs focus:outline-none focus:border-[#4CC2DE] font-sans"
            />
            <button
              type="submit"
              disabled={replaying || !replayQuery.trim()}
              className="px-3 py-1.5 rounded-md bg-[#4CC2DE] hover:bg-[#38b2ce] disabled:opacity-50 text-[#0E1013] font-sans text-xs font-medium transition-colors shrink-0 flex items-center gap-1.5 cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>Replay</span>
            </button>
          </div>
        </form>
      </div>

      {/* Replay Answer Modal / Dropdown Box */}
      {replayAnswer && (
        <div className="p-2.5 border-b border-[#22252B] bg-[#111318] space-y-2 shrink-0 min-w-0 max-w-full font-sans">
          <div className="flex items-center justify-between min-w-0">
            <span className="text-xs font-sans text-[#E6E8EB] font-medium tracking-normal truncate">
              Reconstructed Decision
            </span>
            <button
              onClick={() => setReplayAnswer(null)}
              className="text-[#8C92A4] hover:text-zinc-300 text-xs font-sans shrink-0 cursor-pointer"
            >
              ✕ Dismiss
            </button>
          </div>

          <div className="p-2.5 rounded-lg bg-[#14161B] border border-[#22252B] space-y-2 text-xs min-w-0 max-w-full overflow-hidden">
            {/* 1. Decision */}
            <div className="min-w-0">
              <div className="text-[10px] font-sans text-[#8C92A4] font-medium uppercase tracking-wider">1. Decision</div>
              <div className="text-zinc-200 font-medium break-words [overflow-wrap:anywhere] leading-snug">
                {replayAnswer.decision}
              </div>
            </div>

            {/* 2. Problem */}
            <div className="min-w-0">
              <div className="text-[10px] font-sans text-[#8C92A4] font-medium uppercase tracking-wider">2. Problem Solved</div>
              <div className="text-zinc-300 break-words [overflow-wrap:anywhere] leading-snug">
                {replayAnswer.problem || "Not explicitly recorded"}
              </div>
            </div>

            {/* 3. Rationale */}
            <div className="min-w-0">
              <div className="text-[10px] font-sans text-[#8C92A4] font-medium uppercase tracking-wider">3. Rationale</div>
              <div className="text-zinc-200 font-sans text-xs bg-[#111318] p-2.5 rounded-md border border-[#22252B] break-words [overflow-wrap:anywhere] whitespace-pre-wrap leading-relaxed">
                {replayAnswer.rationale}
              </div>
            </div>

            {/* 4. Rejected Alternatives */}
            {replayAnswer.alternativesRejected && replayAnswer.alternativesRejected.length > 0 && (
              <div className="min-w-0">
                <div className="text-[10px] font-sans text-[#8C92A4] font-medium uppercase tracking-wider">4. Alternatives Rejected</div>
                <ul className="list-disc list-inside text-zinc-400 text-xs space-y-0.5 min-w-0">
                  {replayAnswer.alternativesRejected.map((alt: string, i: number) => (
                    <li key={i} className="break-words [overflow-wrap:anywhere]">{alt}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 5. Evidence Tags */}
            <div className="min-w-0">
              <div className="text-[10px] font-sans text-[#8C92A4] font-medium uppercase tracking-wider">5. Evidence Tags</div>
              <div className="flex flex-wrap gap-1 pt-1 min-w-0 max-w-full">
                {replayAnswer.evidence?.map((ev: string, idx: number) => (
                  <span
                    key={idx}
                    className="px-1.5 py-0.5 rounded bg-[#161624] border border-cyan-500/30 text-cyan-300 font-mono text-[10px] break-all [overflow-wrap:anywhere]"
                  >
                    {ev}
                  </span>
                ))}
              </div>
            </div>

            {/* 6. Confidence */}
            <div className="flex items-center justify-between pt-1 border-t border-[#1a1a24] min-w-0">
              <span className="text-[10px] font-mono text-zinc-400 shrink-0">Confidence:</span>
              <div className="shrink-0">{getConfidenceBadge(replayAnswer.confidence)}</div>
            </div>

            {/* 7. Related */}
            {replayAnswer.related && (
              <div className="text-[11px] text-zinc-400 space-y-1 pt-1 border-t border-[#1a1a24] min-w-0">
                {replayAnswer.related.files?.length > 0 && (
                  <div className="break-words [overflow-wrap:anywhere] min-w-0">
                    <span className="text-zinc-500 font-mono text-[10px]">Files: </span>
                    {replayAnswer.related.files.map((f: string, i: number) => (
                      <button
                        key={i}
                        onClick={() => onOpenFile && onOpenFile(f)}
                        className="text-cyan-400 hover:underline mr-2 break-all [overflow-wrap:anywhere] text-left cursor-pointer inline"
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                )}
                {replayAnswer.related.commits?.length > 0 && (
                  <div className="break-words [overflow-wrap:anywhere] min-w-0">
                    <span className="text-zinc-500 font-mono text-[10px]">Commits: </span>
                    <span className="font-mono text-zinc-300 break-all">{replayAnswer.related.commits.join(", ")}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="p-2.5 border-b border-[#22252B] space-y-2 shrink-0 min-w-0 max-w-full">
        <div className="relative min-w-0">
          <Search className="w-3.5 h-3.5 text-[#5A6072] absolute left-2.5 top-2 shrink-0 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="What decision are you looking for?"
            className="w-full pl-8 pr-2.5 py-1.5 rounded bg-[#14161B] border border-[#22252B] text-zinc-200 text-xs focus:outline-none focus:border-[#4CC2DE] min-w-0"
          />
        </div>

        {/* Filter Pills */}
        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1 font-sans text-[11px] min-w-0">
          {(
            [
              { id: "ALL", label: "All" },
              { id: "CONFIRMED", label: "Confirmed" },
              { id: "CANDIDATE", label: "Candidate" },
              { id: "REJECTED", label: "Rejected" },
            ] as const
          ).map((filter) => (
            <button
              key={filter.id}
              onClick={() => setActiveFilter(filter.id)}
              className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer shrink-0 font-medium ${
                activeFilter === filter.id
                  ? "bg-[#14161B] text-[#4CC2DE] border border-[#4CC2DE]/30"
                  : "text-[#8C92A4] hover:text-[#E6E8EB] hover:bg-[#14161B]"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {/* Decision Records List */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2.5 space-y-2.5 min-w-0 max-w-full font-sans">
        {filteredDecisions.length === 0 ? (
          <div className="h-full min-h-[240px] flex flex-col items-center justify-center text-center p-6 text-zinc-500 space-y-2 min-w-0 font-sans">
            <BookOpen className="w-6 h-6 mx-auto text-[#5A6072] shrink-0" />
            <p className="text-xs text-[#9AA1AC] font-medium">No decision records found.</p>
            <p className="text-[11px] font-sans text-[#5A6072] max-w-xs break-words [overflow-wrap:anywhere]">
              Decisions are captured during architectural discussions or Context Capsule imports.
            </p>
          </div>
        ) : (
          filteredDecisions.map((d) => (
            <div
              key={d.decisionId}
              className="p-3 rounded-lg bg-[#111318] border border-[#22252B] hover:border-[#4CC2DE]/30 transition-colors space-y-2 text-xs min-w-0 max-w-full overflow-hidden font-sans"
            >
              {/* Card Top */}
              <div className="flex items-start justify-between gap-2 min-w-0">
                <h4 className="font-semibold text-zinc-100 text-xs leading-snug break-words [overflow-wrap:anywhere] min-w-0 flex-1">
                  {d.title}
                </h4>
                <div className="shrink-0">{getStatusBadge(d.status)}</div>
              </div>

              {/* Decision Statement */}
              <div className="text-zinc-300 leading-relaxed font-sans break-words [overflow-wrap:anywhere] min-w-0">
                <span className="font-medium text-[#8C92A4] font-sans text-[11px]">Decision: </span>
                <span>{d.decision}</span>
              </div>

              {/* Problem Solved */}
              {d.problem && (
                <div className="text-zinc-400 bg-[#0E1013] p-2 rounded-md border border-[#22252B] text-[11px] break-words [overflow-wrap:anywhere] min-w-0 font-sans">
                  <span className="font-medium text-[#8C92A4] font-sans text-[11px]">Problem: </span>
                  <span>{d.problem}</span>
                </div>
              )}

              {/* Rationale / Why */}
              {d.rationale && (
                <div className="text-zinc-300 bg-[#0E1013] p-2 rounded-md border border-[#22252B] text-[11px] break-words [overflow-wrap:anywhere] min-w-0 whitespace-pre-wrap leading-relaxed font-sans">
                  <span className="font-medium text-[#4CC2DE] font-sans text-[11px]">Why: </span>
                  <span>{d.rationale}</span>
                </div>
              )}

              {/* Rejected Alternatives */}
              {d.rejectedAlternatives && d.rejectedAlternatives.length > 0 && (
                <div className="text-[11px] text-zinc-400 break-words [overflow-wrap:anywhere] min-w-0 font-sans">
                  <span className="font-sans text-[11px] text-[#8C92A4] font-medium">Rejected: </span>
                  {d.rejectedAlternatives.map((r, i) => (
                    <span key={i} className="mr-2 inline-block break-words [overflow-wrap:anywhere]">
                      {r.alternative} {r.reason ? `(${r.reason})` : ""}
                    </span>
                  ))}
                </div>
              )}

              {/* Affected Files & Commits */}
              <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[10px] text-zinc-500 min-w-0 max-w-full">
                {d.affectedFiles && d.affectedFiles.length > 0 && (
                  <div className="flex items-center gap-1 text-cyan-400 min-w-0 max-w-full shrink-0">
                    <FileCode className="w-3 h-3 shrink-0" />
                    <button
                      onClick={() => onOpenFile && onOpenFile(d.affectedFiles![0])}
                      className="hover:underline break-all [overflow-wrap:anywhere] text-left cursor-pointer"
                      title={d.affectedFiles[0]}
                    >
                      {d.affectedFiles[0]}
                    </button>
                  </div>
                )}
                {d.relatedCommits && d.relatedCommits.length > 0 && (
                  <div className="flex items-center gap-1 text-purple-400 shrink-0">
                    <GitCommit className="w-3 h-3 shrink-0" />
                    <span className="font-mono">{d.relatedCommits[0].slice(0, 7)}</span>
                  </div>
                )}
                <div className="ml-auto flex items-center gap-1 shrink-0">
                  <span>Confidence:</span>
                  {getConfidenceBadge(d.confidence)}
                </div>
              </div>

              {/* Candidate Actions & Handoff */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#181824] min-w-0 max-w-full">
                {d.status === "CANDIDATE" ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => handleConfirm(d.decisionId)}
                      className="px-2 py-1 rounded bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-500/40 text-emerald-300 font-mono text-[10px] flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Check className="w-3 h-3" />
                      <span>Confirm</span>
                    </button>
                    <button
                      onClick={() => handleReject(d.decisionId)}
                      className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 font-mono text-[10px] transition-colors cursor-pointer"
                    >
                      Dismiss
                    </button>
                  </div>
                ) : (
                  <span className="text-[10px] font-mono text-zinc-600 shrink-0">
                    {new Date(d.createdAt).toLocaleDateString()}
                  </span>
                )}

                {onAskAgentToImplement && (
                  <button
                    onClick={() => handleHandoffToAgent(d)}
                    className="ml-auto text-[10px] font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1 transition-colors shrink-0 whitespace-nowrap cursor-pointer"
                  >
                    <span>Handoff to Agent</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Manual Decision Entry Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md bg-[#111318] border border-[#22252B] rounded-xl shadow-modal p-5 space-y-4 min-w-0 max-w-full overflow-hidden">
            <div className="flex items-center justify-between min-w-0">
              <h3 className="font-semibold text-zinc-100 text-sm truncate">Log Architectural Decision</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-[#8C92A4] hover:text-zinc-300 font-mono shrink-0 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateDecision} className="space-y-3 font-sans text-xs min-w-0 max-w-full">
              <div className="min-w-0">
                <label className="block text-[11px] font-mono text-[#8C92A4] mb-1">Title</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Keep validation before payment processing"
                  className="w-full px-2.5 py-1.5 rounded bg-[#0E1013] border border-[#22252B] text-zinc-200 text-xs focus:outline-none focus:border-[#4CC2DE] min-w-0"
                />
              </div>

              <div className="min-w-0">
                <label className="block text-[11px] font-mono text-[#8C92A4] mb-1">Decision Statement *</label>
                <textarea
                  required
                  rows={2}
                  value={newDecision}
                  onChange={(e) => setNewDecision(e.target.value)}
                  placeholder="What was decided?"
                  className="w-full px-2.5 py-1.5 rounded bg-[#0E1013] border border-[#22252B] text-zinc-200 text-xs focus:outline-none focus:border-[#4CC2DE] min-w-0"
                />
              </div>

              <div className="min-w-0">
                <label className="block text-[11px] font-mono text-[#8C92A4] mb-1">Problem Solved</label>
                <input
                  type="text"
                  value={newProblem}
                  onChange={(e) => setNewProblem(e.target.value)}
                  placeholder="What problem or regression does this prevent?"
                  className="w-full px-2.5 py-1.5 rounded bg-[#0E1013] border border-[#22252B] text-zinc-200 text-xs focus:outline-none focus:border-[#4CC2DE] min-w-0"
                />
              </div>

              <div className="min-w-0">
                <label className="block text-[11px] font-mono text-[#8C92A4] mb-1">Rationale / Why</label>
                <textarea
                  rows={2}
                  value={newRationale}
                  onChange={(e) => setNewRationale(e.target.value)}
                  placeholder="Why was this chosen? (Supporting evidence/tradeoffs)"
                  className="w-full px-2.5 py-1.5 rounded bg-[#0E1013] border border-[#22252B] text-zinc-200 text-xs focus:outline-none focus:border-[#4CC2DE] min-w-0"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 min-w-0">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 rounded bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] text-zinc-300 font-mono text-xs cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newDecision.trim()}
                  className="px-4 py-1.5 rounded bg-[#4CC2DE] hover:bg-[#38b2ce] text-[#0E1013] font-mono text-xs font-medium disabled:opacity-50 cursor-pointer transition-colors"
                >
                  Save Decision
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
