"use client";

import React, { useState } from "react";
import {
  HelpCircle,
  AlertTriangle,
  Sparkles,
  GitCommit,
  FileCode,
  Layers,
  CheckCircle2,
  X,
  Loader2,
  ArrowRight,
  ShieldAlert,
  Terminal,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

export interface BreakageEvidence {
  source: string;
  id: string;
  description: string;
  relevance: "direct" | "contributing" | "contextual";
}

export interface BreakageReport {
  schemaVersion: string;
  failure: {
    type?: string;
    message?: string;
    filePath?: string | null;
    line?: number | null;
    column?: number | null;
    symbol?: string | null;
    test?: string | null;
  };
  primaryCause: {
    type: string;
    explanation: string;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    evidence: BreakageEvidence[];
    affectedFiles?: string[];
  };
  contributingCauses?: Array<{
    type: string;
    explanation: string;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    evidence: BreakageEvidence[];
    affectedFiles?: string[];
  }>;
  affectedFiles?: string[];
  relatedCommits?: string[];
  relatedAiChanges?: string[];
  recommendedNextStep?: string;
  generatedAt: number;
}

interface WhyDidThisBreakModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: BreakageReport | null;
  loading?: boolean;
  error?: string | null;
  onAskAgentToFix?: (prompt: string) => void;
  onOpenFile?: (filePath: string, line?: number) => void;
}

export default function WhyDidThisBreakModal({
  isOpen,
  onClose,
  report,
  loading = false,
  error = null,
  onAskAgentToFix,
  onOpenFile,
}: WhyDidThisBreakModalProps) {
  const [showEvidenceDetail, setShowEvidenceDetail] = useState(false);

  if (!isOpen) return null;

  const handleAskToFix = () => {
    if (!report || !onAskAgentToFix) return;

    const failMsg = report.failure?.message || "Failure";
    const loc = report.failure?.filePath
      ? `${report.failure.filePath}${report.failure.line ? `:${report.failure.line}` : ""}`
      : "";
    const cause = report.primaryCause?.explanation || "Identified root cause.";
    const files = report.affectedFiles?.length ? report.affectedFiles.join(", ") : loc;

    const fixPrompt = `Please investigate and fix the following failure:\n\nError: ${failMsg}${loc ? ` (at ${loc})` : ""}\n\nCausal Analysis (${report.primaryCause?.confidence || "MEDIUM"} Confidence):\n${cause}\n\nAffected Files: ${files}\n\nRecommended Next Step:\n${report.recommendedNextStep || "Review and apply the appropriate correction."}`;

    onAskAgentToFix(fixPrompt);
    onClose();
  };

  const getConfidenceBadge = (confidence?: "HIGH" | "MEDIUM" | "LOW") => {
    switch (confidence) {
      case "HIGH":
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-500/40 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            Confidence: HIGH
          </span>
        );
      case "MEDIUM":
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-950/80 text-amber-300 border border-amber-500/40 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            Confidence: MEDIUM
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-zinc-800 text-zinc-300 border border-zinc-700 flex items-center gap-1">
            Confidence: LOW
          </span>
        );
    }
  };

  const getSourceIcon = (source: string) => {
    switch (source) {
      case "git_commit":
      case "git_diff":
        return <GitCommit className="w-3 h-3 text-cyan-400 shrink-0" />;
      case "code_change":
        return <Sparkles className="w-3 h-3 text-purple-400 shrink-0" />;
      case "call_graph":
        return <Layers className="w-3 h-3 text-blue-400 shrink-0" />;
      case "diagnostic":
      case "test":
        return <Terminal className="w-3 h-3 text-rose-400 shrink-0" />;
      default:
        return <FileCode className="w-3 h-3 text-zinc-400 shrink-0" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs font-mono animate-fadeIn">
      <div
        style={{
          backgroundColor: "var(--theme-surface-card, #0c0c14)",
          borderColor: "var(--theme-border-card, #242436)",
        }}
        className="w-full max-w-2xl border rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] text-zinc-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1f1f2e] bg-[#10101a]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
              <HelpCircle className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-bold tracking-wider uppercase text-cyan-300">
                WHY DID THIS BREAK?
              </h2>
              <p className="text-[10px] text-zinc-500">
                Read-only causal correlation • Zero AI provider calls
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* Loading State */}
          {loading && (
            <div className="py-12 flex flex-col items-center justify-center space-y-3 text-zinc-400">
              <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
              <p className="text-xs font-medium">
                Correlating repository commits, AST call graph & session evidence...
              </p>
            </div>
          )}

          {/* Error State */}
          {error && !loading && (
            <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Correlation Notice</p>
                <p className="text-[11px] text-rose-200/80">{error}</p>
              </div>
            </div>
          )}

          {/* Report Data */}
          {report && !loading && (
            <>
              {/* Failure Context Box */}
              <div className="p-2.5 rounded-xl bg-rose-950/20 border border-rose-500/20 text-rose-200 text-xs space-y-1">
                <div className="flex items-center justify-between text-[10px] text-rose-400 font-bold uppercase">
                  <span>{report.failure?.type || "FAILURE DETECTED"}</span>
                  {report.failure?.filePath && (
                    <button
                      onClick={() =>
                        onOpenFile?.(
                          report.failure.filePath!,
                          report.failure.line || undefined
                        )
                      }
                      className="hover:underline cursor-pointer flex items-center gap-1 font-mono text-zinc-400"
                    >
                      <FileCode className="w-3 h-3 text-cyan-400" />
                      <span>
                        {report.failure.filePath}
                        {report.failure.line ? `:${report.failure.line}` : ""}
                      </span>
                    </button>
                  )}
                </div>
                <div className="text-[11px] text-zinc-200 font-medium break-words">
                  {report.failure?.message}
                </div>
              </div>

              {/* Primary Likely Cause Card */}
              <div className="p-3.5 rounded-xl bg-[#141422] border border-[#262638] space-y-2.5 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold tracking-wider uppercase text-zinc-400">
                    Likely Cause
                  </span>
                  {getConfidenceBadge(report.primaryCause?.confidence)}
                </div>

                <div className="text-xs text-zinc-100 font-medium leading-relaxed">
                  {report.primaryCause?.explanation}
                </div>

                {/* Evidence Bullet Points */}
                {report.primaryCause?.evidence?.length > 0 && (
                  <div className="pt-2 border-t border-white/5 space-y-1.5">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                      Evidence
                    </span>
                    <ul className="space-y-1 text-[11px] text-zinc-300">
                      {report.primaryCause.evidence.map((ev, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="mt-1">{getSourceIcon(ev.source)}</span>
                          <span className="flex-1">{ev.description}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Related Changes / Affected Files */}
              {report.affectedFiles && report.affectedFiles.length > 0 && (
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                    Related Files
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {report.affectedFiles.map((file, idx) => (
                      <button
                        key={idx}
                        onClick={() => onOpenFile?.(file)}
                        className="px-2 py-0.5 rounded-lg bg-[#151520] hover:bg-[#1f1f30] border border-[#2a2a3e] text-[11px] text-cyan-300 flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        <FileCode className="w-3 h-3 text-cyan-400" />
                        <span>{file}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommended Next Step */}
              {report.recommendedNextStep && (
                <div className="p-2.5 rounded-xl bg-cyan-950/30 border border-cyan-500/20 text-cyan-200 text-[11px] flex items-start gap-2">
                  <ArrowRight className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-cyan-300">Recommendation: </span>
                    <span>{report.recommendedNextStep}</span>
                  </div>
                </div>
              )}

              {/* Detailed Evidence Toggle Drawer */}
              {report.primaryCause?.evidence?.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowEvidenceDetail((prev) => !prev)}
                    className="text-[10px] text-zinc-500 hover:text-cyan-400 flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    {showEvidenceDetail ? (
                      <ChevronDown className="w-3 h-3" />
                    ) : (
                      <ChevronRight className="w-3 h-3" />
                    )}
                    <span>
                      {showEvidenceDetail ? "Hide Raw Evidence Trail" : "Inspect Raw Evidence Trail"}
                    </span>
                  </button>

                  {showEvidenceDetail && (
                    <div className="mt-2 p-2.5 rounded-xl bg-[#090910] border border-[#1c1c28] text-[10px] font-mono space-y-1.5 max-h-40 overflow-y-auto">
                      {report.primaryCause.evidence.map((ev, idx) => (
                        <div key={idx} className="flex justify-between items-center text-zinc-400">
                          <span className="text-cyan-400 font-bold">{ev.source}</span>
                          <span className="text-zinc-600 truncate max-w-[140px]">{ev.id}</span>
                          <span className="text-zinc-500 capitalize">{ev.relevance}</span>
                        </div>
                      ))}
                      {report.relatedCommits && report.relatedCommits.length > 0 && (
                        <div className="pt-1 border-t border-white/5 text-zinc-500">
                          Scanned commits: {report.relatedCommits.slice(0, 5).join(", ")}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-3 border-t border-[#1f1f2e] bg-[#10101a] flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl bg-transparent hover:bg-white/5 border border-zinc-700 text-zinc-300 text-xs font-bold cursor-pointer transition-colors"
          >
            Close
          </button>

          {onAskAgentToFix && report && !loading && (
            <button
              type="button"
              onClick={handleAskToFix}
              className="px-3.5 py-1.5 rounded-md bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] hover:border-[#4CC2DE]/50 text-[#4CC2DE] text-xs font-medium flex items-center gap-1.5 cursor-pointer transition-colors"
              title="Pass causal context into standard NEXUS agent workflow"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#4CC2DE]" />
              <span>Ask Agent to Fix</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
