"use client";

import React, { useState } from "react";
import {
  Shield, ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2,
  RefreshCw, X, ChevronRight, ChevronDown, Download, Cpu, Sparkles, Activity, FileCode
} from "lucide-react";

export interface HunkResult {
  hunk_index: number;
  start_line: number;
  end_line: number;
  original_code: string;
  edited_code: string;
  counterfactual: {
    equivalence_score: number;
    safe_to_remove: boolean;
    confidence: number;
    changed_observations?: number;
    total_observations?: number;
    trace_diff?: any[];
  };
  blast_radius?: {
    blast_radius_score: number;
    root_changed_functions?: any[];
    impacted_functions?: any[];
  };
}

export interface PatchFileResult {
  file_path: string;
  hunks: HunkResult[];
}

export interface PatchFirewallReport {
  schema_version: number;
  files: PatchFileResult[];
  risk_score: number;
  risk_level: "AUTO_APPROVE" | "SAFE_REMOVE" | "REVIEW_REQUIRED" | "HIGH_RISK";
  safe_to_auto_apply: boolean;
  confidence?: number;
  summary: {
    changed_hunks: number;
    safe_removals: number;
    behavior_changes: number;
    impacted_functions: number;
    max_blast_radius_score?: number;
  };
  error?: string;
}

export interface PatchFirewallPanelProps {
  report: PatchFirewallReport | null;
  loading: boolean;
  onRunAnalysis: (patchText: string) => void;
  onClose?: () => void;
  currentFile?: string | null;
}

const DEFAULT_SAMPLE_DIFF = `--- a/src/cart_calculator.py
+++ b/src/cart_calculator.py
@@ -9,4 +9,0 @@
-    subtotal = subtotal * 1
-    subtotal = subtotal + 0
-    subtotal = subtotal - 0
-    subtotal = subtotal / 1
`;

export default function PatchFirewallPanel({
  report,
  loading,
  onRunAnalysis,
  onClose,
  currentFile,
}: PatchFirewallPanelProps) {
  const [patchText, setPatchText] = useState<string>(DEFAULT_SAMPLE_DIFF);
  const [expandedHunks, setExpandedHunks] = useState<Record<string, boolean>>({});

  const toggleHunk = (key: string) => {
    setExpandedHunks((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleExportJSON = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `echo_nullity_patch_firewall_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const riskLevelConfig = {
    AUTO_APPROVE: { label: "AUTO APPROVE", bg: "bg-emerald-950/80", text: "text-emerald-300", border: "border-emerald-500/40", icon: ShieldCheck },
    SAFE_REMOVE: { label: "SAFE REMOVE", bg: "bg-emerald-950/90", text: "text-emerald-300", border: "border-emerald-500/50", icon: CheckCircle2 },
    REVIEW_REQUIRED: { label: "REVIEW REQUIRED", bg: "bg-amber-950/80", text: "text-amber-300", border: "border-amber-500/40", icon: AlertTriangle },
    HIGH_RISK: { label: "HIGH RISK", bg: "bg-red-950/90", text: "text-red-300", border: "border-red-500/50", icon: ShieldAlert },
  };

  const currentConfig = report?.risk_level ? riskLevelConfig[report.risk_level] : riskLevelConfig.REVIEW_REQUIRED;
  const BadgeIcon = currentConfig.icon;

  return (
    <div className="h-full flex flex-col bg-[#0E1013] text-zinc-200 font-sans overflow-hidden">
      {/* Header Bar */}
      <div className="h-10 bg-[#0E1013] border-b border-[#22252B] px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <Shield className="w-4 h-4 text-[#4CC2DE]" />
          <h2 className="text-sm font-medium text-[#E6E8EB]">Patch Safety Firewall</h2>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#14161B] text-[#8C92A4] border border-[#22252B]">
            Verification
          </span>
        </div>

        <div className="flex items-center gap-2">
          {report && (
            <button
              onClick={handleExportJSON}
              className="px-2.5 py-1 rounded-md bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] text-xs font-medium text-zinc-300 flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-[#8C92A4]" />
              <span>Export Report</span>
            </button>
          )}

          {onClose && (
            <button onClick={onClose} className="p-1 rounded hover:bg-[#1A1C22] text-[#8C92A4] hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Container */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Diff Input Section */}
        <div className="bg-[#111318] border border-[#22252B] rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-[#E6E8EB] flex items-center gap-1.5">
              <FileCode className="w-4 h-4 text-[#4CC2DE]" />
              <span>Proposed Unified Diff / AI Code Edit Buffer</span>
            </label>
            <button
              onClick={() => setPatchText(DEFAULT_SAMPLE_DIFF)}
              className="text-[11px] text-[#4CC2DE] hover:underline"
            >
              Load Sample Vacuous Removal Patch (Lines 9–12)
            </button>
          </div>

          <textarea
            rows={5}
            value={patchText}
            onChange={(e) => setPatchText(e.target.value)}
            placeholder="Paste unified git diff or proposed source buffer here..."
            className="w-full bg-[#0E1013] border border-[#22252B] rounded-md p-3 text-xs text-zinc-200 font-mono focus:outline-none focus:border-[#4CC2DE] resize-y"
          />

          <button
            onClick={() => onRunAnalysis(patchText)}
            disabled={loading || !patchText.trim()}
            className="w-full py-2 rounded-md bg-[#4CC2DE] hover:bg-[#38b2ce] text-[#0E1013] font-medium text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            <Shield className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>{loading ? "Evaluating Counterfactual & Blast Radius Engines..." : "Analyze AI Patch Safety"}</span>
          </button>
        </div>

        {/* Firewall Report Display */}
        {report && (
          <div className="space-y-4">
            {/* Risk Badge & Executive Dashboard */}
            <div className="bg-[#111318] border border-[#22252B] rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`px-2.5 py-1 rounded border flex items-center gap-2 font-medium text-xs ${currentConfig.bg} ${currentConfig.text} ${currentConfig.border}`}>
                    <BadgeIcon className="w-3.5 h-3.5" />
                    <span>{currentConfig.label}</span>
                  </div>
                  <span className="text-xs text-zinc-400 font-mono">
                    Auto-apply status:{" "}
                    <strong className={report.safe_to_auto_apply ? "text-emerald-400" : "text-red-400"}>
                      {report.safe_to_auto_apply ? "SAFE TO APPLY" : "BLOCKED FOR REVIEW"}
                    </strong>
                  </span>
                </div>

                {report.confidence && (
                  <div className="text-xs font-mono text-zinc-400">
                    Engine Confidence: <strong className="text-[#4CC2DE]">{Math.round(report.confidence * 100)}%</strong>
                  </div>
                )}
              </div>

              {/* KPI Cards */}
              <div className="grid grid-cols-5 gap-3">
                <div className="bg-[#14161B] border border-[#22252B] rounded-md p-3 text-center">
                  <p className="text-[10px] font-medium text-[#8C92A4] uppercase">Risk Score</p>
                  <p className={`text-xl font-bold font-mono mt-0.5 ${report.risk_score === 0 ? "text-emerald-400" : report.risk_score < 50 ? "text-amber-400" : "text-red-400"}`}>
                    {report.risk_score} / 100
                  </p>
                </div>
                <div className="bg-[#14161B] border border-[#22252B] rounded-md p-3 text-center">
                  <p className="text-[10px] font-medium text-[#8C92A4] uppercase">Changed Hunks</p>
                  <p className="text-xl font-bold text-[#4CC2DE] font-mono mt-0.5">
                    {report.summary?.changed_hunks || 0}
                  </p>
                </div>
                <div className="bg-[#14161B] border border-[#22252B] rounded-md p-3 text-center">
                  <p className="text-[10px] font-medium text-[#8C92A4] uppercase">Safe Removals</p>
                  <p className="text-xl font-bold text-emerald-400 font-mono mt-0.5">
                    {report.summary?.safe_removals || 0}
                  </p>
                </div>
                <div className="bg-[#14161B] border border-[#22252B] rounded-md p-3 text-center">
                  <p className="text-[10px] font-medium text-[#8C92A4] uppercase">Behavior Diffs</p>
                  <p className="text-xl font-bold text-amber-400 font-mono mt-0.5">
                    {report.summary?.behavior_changes || 0}
                  </p>
                </div>
                <div className="bg-[#14161B] border border-[#22252B] rounded-md p-3 text-center">
                  <p className="text-[10px] font-medium text-[#8C92A4] uppercase">Impacted Callers</p>
                  <p className="text-xl font-bold text-rose-400 font-mono mt-0.5">
                    {report.summary?.impacted_functions || 0}
                  </p>
                </div>
              </div>
            </div>

            {/* Evaluated Files & Hunks */}
            {report.files && report.files.map((fileRes, fileIdx) => (
              <div key={fileIdx} className="bg-[#111318] border border-[#22252B] rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2 border-b border-[#22252B] pb-2 text-xs font-semibold text-white font-mono">
                  <FileCode className="w-4 h-4 text-[#4CC2DE]" />
                  <span>{fileRes.file_path}</span>
                </div>

                <div className="space-y-3">
                  {fileRes.hunks.map((hunk, hunkIdx) => {
                    const hunkKey = `${fileIdx}-${hunkIdx}`;
                    const isExp = expandedHunks[hunkKey];
                    const isSafe = hunk.counterfactual?.safe_to_remove;

                    return (
                      <div key={hunkIdx} className="border border-[#22252B] rounded-lg bg-[#0E1013] overflow-hidden">
                        <div
                          onClick={() => toggleHunk(hunkKey)}
                          className="p-3 flex items-center justify-between cursor-pointer hover:bg-[#14161B] transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            {isExp ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500" />}
                            <span className="font-mono text-xs font-bold text-zinc-300">
                              Hunk #{hunk.hunk_index} (Lines {hunk.start_line}–{hunk.end_line})
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                isSafe
                                  ? "bg-emerald-950 text-emerald-300 border-emerald-500/30"
                                  : "bg-red-950 text-red-300 border-red-500/30"
                              }`}
                            >
                              {isSafe ? "SAFE REMOVE" : "BEHAVIORAL CHANGE"}
                            </span>
                          </div>

                          <div className="flex items-center gap-4 text-xs font-mono">
                            <span className="text-[#4CC2DE]">
                              Equivalence: {Math.round((hunk.counterfactual?.equivalence_score || 0) * 100)}%
                            </span>
                            <span className="text-zinc-500">
                              Confidence: {Math.round((hunk.counterfactual?.confidence || 0) * 100)}%
                            </span>
                          </div>
                        </div>

                        {/* Hunk Trace Details & Code Diffs */}
                        {isExp && (
                          <div className="p-3 border-t border-[#22252B] bg-[#14161B] space-y-3">
                            <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                              <div className="bg-[#0E1013] p-2.5 rounded border border-[#22252B]">
                                <p className="text-red-400 font-medium mb-1">- Original Code (Hunk Target):</p>
                                <pre className="text-[11px] text-zinc-300 whitespace-pre-wrap">{hunk.original_code || "(Empty)"}</pre>
                              </div>
                              <div className="bg-[#0E1013] p-2.5 rounded border border-[#22252B]">
                                <p className="text-emerald-400 font-medium mb-1">+ Counterfactual Code:</p>
                                <pre className="text-[11px] text-emerald-300 whitespace-pre-wrap">{hunk.edited_code || "(Removed)"}</pre>
                              </div>
                            </div>

                            {/* Downstream Impacted Functions */}
                            {hunk.blast_radius && hunk.blast_radius.impacted_functions && hunk.blast_radius.impacted_functions.length > 0 && (
                              <div className="space-y-1.5">
                                <h5 className="text-[11px] font-semibold text-amber-400 uppercase">Downstream Blast Radius Callers</h5>
                                <div className="border border-[#22252B] rounded-md bg-[#0E1013] divide-y divide-[#22252B]">
                                  {hunk.blast_radius.impacted_functions.map((fn, i) => (
                                    <div key={i} className="p-2 flex items-center justify-between text-[11px] font-mono">
                                      <span className="text-white font-medium">{fn.name}</span>
                                      <span className="text-amber-300">+{fn.distance} hop ({fn.classification})</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
