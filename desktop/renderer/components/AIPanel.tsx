"use client";

import React from "react";
import { Sparkles, X, Check, Eye, AlertCircle, RefreshCw, Layers } from "lucide-react";

export interface AIResponsePayload {
  success: boolean;
  action: string;
  response: string;
  error?: string;
  proposedPatch?: {
    original: string;
    replacement: string;
  };
}

interface AIPanelProps {
  isOpen: boolean;
  onClose: () => void;
  loading: boolean;
  response: AIResponsePayload | null;
  onApplyPatch: (patch: { original: string; replacement: string }) => void;
  onPreviewDiff: (patch: { original: string; replacement: string }) => void;
}

export default function AIPanel({
  isOpen,
  onClose,
  loading,
  response,
  onApplyPatch,
  onPreviewDiff,
}: AIPanelProps) {
  if (!isOpen) return null;

  const actionLabels: Record<string, string> = {
    explain: "Explain Code",
    find_bug: "Find Bugs & Vulnerabilities",
    fix: "Propose Code Fix",
    refactor: "Clean Refactor",
    tests: "Unit Tests Generator",
    docs: "Generate Documentation",
  };

  return (
    <div className="fixed right-0 top-0 bottom-0 w-96 max-w-[90vw] bg-[#111318] border-l border-[#22252B] shadow-modal z-40 flex flex-col font-sans text-xs animate-slideInRight select-none">
      {/* Header */}
      <div className="h-9 bg-[#0E1013] border-b border-[#22252B] px-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#4CC2DE]" />
          <span className="font-semibold text-zinc-100 text-xs">
            AI Code Actions
          </span>
          {response?.action && (
            <span className="px-1.5 py-0.2 rounded bg-[#1A1C22] text-[#4CC2DE] border border-[#22252B] text-[10px] font-medium">
              {actionLabels[response.action] || response.action}
            </span>
          )}
        </div>

        <button
          onClick={onClose}
          className="p-1 rounded text-[#9AA1AC] hover:text-[#E6E8EB] transition-colors cursor-pointer"
          title="Close AI Panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-zinc-300">
        {loading && (
          <div className="py-16 flex flex-col items-center justify-center text-center space-y-3">
            <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin" />
            <div className="font-bold text-zinc-200 text-xs">Analyzing code with AI...</div>
            <p className="text-zinc-500 text-[11px]">Evaluating AST semantics and patch safety bounds.</p>
          </div>
        )}

        {!loading && response && (
          <div className="space-y-4">
            {response.error && (
              <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Error</div>
                  <div>{response.error}</div>
                </div>
              </div>
            )}

            {/* Markdown / Response Text */}
            <div className="whitespace-pre-wrap leading-relaxed font-mono text-[11.5px] bg-[#050507] p-3.5 rounded-xl border border-[#1a1a22] text-zinc-200">
              {response.response}
            </div>

            {/* Proposed Patch Action Controls */}
            {response.proposedPatch && (
              <div className="p-3 bg-[#0d0d12] border border-cyan-500/30 rounded-xl space-y-2">
                <div className="flex items-center gap-1.5 text-cyan-400 font-bold text-[11px] uppercase tracking-wide">
                  <Layers className="w-3.5 h-3.5" />
                  <span>Proposed Code Patch</span>
                </div>
                <p className="text-zinc-400 text-[10.5px]">
                  Review diff and evaluate patch safety firewall before applying changes.
                </p>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <button
                    onClick={() => response.proposedPatch && onPreviewDiff(response.proposedPatch)}
                    className="py-1.5 px-3 rounded-lg bg-[#18181b] hover:bg-[#27272a] text-zinc-200 border border-[#27272a] text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5 text-purple-400" />
                    <span>Preview Diff</span>
                  </button>

                  <button
                    onClick={() => response.proposedPatch && onApplyPatch(response.proposedPatch)}
                    className="py-1.5 px-3 rounded-md bg-[#4CC2DE] hover:bg-[#38b2ce] text-[#0E1013] text-[11px] font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                    <span>Apply Patch</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {!loading && !response && (
          <div className="py-16 text-center text-zinc-600 space-y-2">
            <Sparkles className="w-8 h-8 mx-auto opacity-30 text-cyan-400" />
            <div>Select code in the editor and choose an action to get AI insights.</div>
          </div>
        )}
      </div>
    </div>
  );
}
