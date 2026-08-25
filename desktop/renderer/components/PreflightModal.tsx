"use client";

import React, { useEffect } from "react";
import { 
  Coins, Zap, ShieldAlert, CheckCircle2, AlertTriangle, 
  FileCode, Wrench, X, ArrowRight, Sparkles, HelpCircle 
} from "lucide-react";

export interface PreflightEstimateData {
  schemaVersion?: string;
  shouldShowPreflight?: boolean;
  mode?: string;
  codingIntent?: string | null;
  providerId?: string;
  modelId?: string;
  estimatedInputTokens: number;
  estimatedMaxOutputTokens: number;
  estimatedTotalTokens: number;
  estimatedFiles?: {
    count: number;
    targetFiles?: string[];
    confidence?: number | string;
    confidenceTier?: string;
    source?: string;
  };
  estimatedToolCalls?: {
    min: number;
    max: number;
    approximate: number;
    confidence: number;
    intent?: string;
  };
  estimatedCostUSD?: number | null;
  inputCostUSD?: number | null;
  outputCostUSD?: number | null;
  primaryCostFormatted?: string;
  providerCosts?: Record<string, string> | null;
  pricingAvailable?: boolean;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH";
  confidence?: "LOW" | "MEDIUM" | "HIGH" | string;
  confidenceScore?: number;
  breakdown?: {
    prompt?: number;
    activeFile?: number;
    selection?: number;
    history?: number;
    capsule?: number;
    tools?: number;
    system?: number;
  };
}

interface PreflightModalProps {
  isOpen: boolean;
  taskPrompt: string;
  estimate: PreflightEstimateData | null;
  onContinue: () => void;
  onCancel: () => void;
}

export default function PreflightModal({
  isOpen,
  taskPrompt,
  estimate,
  onContinue,
  onCancel,
}: PreflightModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter" && !e.shiftKey && (e.metaKey || e.ctrlKey || e.target === document.body)) {
        e.preventDefault();
        onContinue();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onContinue, onCancel]);

  if (!isOpen || !estimate) return null;

  const formatTokens = (num?: number) => {
    if (typeof num !== "number" || isNaN(num)) return "0";
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}k`;
    }
    return `${num}`;
  };

  const risk = estimate.riskLevel || "MEDIUM";
  const confidence = estimate.confidence || "MEDIUM";

  const getRiskColor = (lvl: string) => {
    switch (lvl) {
      case "LOW":
        return "text-emerald-400 bg-emerald-950/40 border-emerald-500/30";
      case "HIGH":
        return "text-rose-400 bg-rose-950/40 border-rose-500/30";
      case "MEDIUM":
      default:
        return "text-amber-400 bg-amber-950/40 border-amber-500/30";
    }
  };

  const getConfidenceColor = (conf: string) => {
    switch (conf) {
      case "HIGH":
        return "text-cyan-400 bg-cyan-950/40 border-cyan-500/30";
      case "LOW":
        return "text-zinc-400 bg-zinc-900 border-zinc-700/50";
      case "MEDIUM":
      default:
        return "text-blue-400 bg-blue-950/40 border-blue-500/30";
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fadeIn font-mono">
      <div 
        className="w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col transition-all transform scale-100"
        style={{
          backgroundColor: "var(--theme-surface-raised, #0e0e16)",
          borderColor: "var(--theme-border, #1e1e2c)",
          color: "var(--theme-text, #f4f4f5)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e1e2c] bg-[#12121c]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-cyan-950/70 border border-cyan-500/40 text-cyan-400">
              <Coins className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-zinc-100 tracking-wide font-sans">
                  TOKEN / COST PREFLIGHT
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider bg-cyan-950/80 border border-cyan-500/40 text-cyan-300">
                  ADVISORY
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
                Deterministic pre-execution estimate for task scope
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors cursor-pointer"
            title="Cancel (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Prompt Preview */}
        <div className="px-5 py-3 bg-[#0a0a10] border-b border-[#1a1a26] text-[11px]">
          <span className="text-zinc-500 font-semibold uppercase tracking-wider text-[10px]">Task Intent:</span>
          <div className="text-zinc-200 font-mono mt-1 line-clamp-2 bg-[#12121c] p-2 rounded-lg border border-[#202030]">
            "{taskPrompt}"
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* 1. Token Metrics Card */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-[#12121c] border border-[#202030] flex flex-col">
              <span className="text-[10px] uppercase font-bold text-zinc-500">Estimated Context</span>
              <span className="text-base font-bold text-cyan-400 mt-1">
                {formatTokens(estimate.estimatedInputTokens)} <span className="text-[10px] font-normal text-zinc-400">tokens</span>
              </span>
              <span className="text-[9.5px] text-zinc-500 mt-0.5">Input & active files</span>
            </div>

            <div className="p-3 rounded-xl bg-[#12121c] border border-[#202030] flex flex-col">
              <span className="text-[10px] uppercase font-bold text-zinc-500">Agent Output</span>
              <span className="text-base font-bold text-indigo-400 mt-1">
                {formatTokens(estimate.estimatedMaxOutputTokens)} <span className="text-[10px] font-normal text-zinc-400">tokens</span>
              </span>
              <span className="text-[9.5px] text-zinc-500 mt-0.5">Generated response</span>
            </div>

            <div className="p-3 rounded-xl bg-[#141422] border border-cyan-500/30 flex flex-col">
              <span className="text-[10px] uppercase font-bold text-cyan-400">Estimated Total</span>
              <span className="text-base font-bold text-zinc-100 mt-1">
                ~{formatTokens(estimate.estimatedTotalTokens)} <span className="text-[10px] font-normal text-zinc-400">tokens</span>
              </span>
              <span className="text-[9.5px] text-cyan-400/70 mt-0.5">Turn token ceiling</span>
            </div>
          </div>

          {/* 2. Execution Scope & Tools Card */}
          <div className="p-3.5 rounded-xl bg-[#12121c] border border-[#202030] space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-zinc-300">
                <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                <span>Estimated files likely touched:</span>
              </div>
              <span className="font-bold text-zinc-100">
                {estimate.estimatedFiles?.count ?? 1} file(s)
              </span>
            </div>

            {estimate.estimatedFiles?.targetFiles && estimate.estimatedFiles.targetFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {estimate.estimatedFiles.targetFiles.map((file, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 rounded-md bg-[#1a1a2a] border border-[#2a2a3e] text-[10px] text-cyan-300 font-mono truncate max-w-[240px]"
                    title={file}
                  >
                    {file}
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between text-xs pt-1 border-t border-[#1e1e2c]">
              <div className="flex items-center gap-2 text-zinc-300">
                <Wrench className="w-3.5 h-3.5 text-amber-400" />
                <span>Estimated tool operations / steps:</span>
              </div>
              <span className="font-bold text-zinc-100">
                ~{estimate.estimatedToolCalls?.approximate ?? estimate.estimatedToolCalls?.min ?? 3} operations
              </span>
            </div>
          </div>

          {/* 3. Provider Cost Card */}
          <div className="p-3.5 rounded-xl bg-[#12121c] border border-[#202030] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider">
                Estimated Provider Cost:
              </span>
              <span className="text-xs font-bold text-emerald-400">
                {estimate.primaryCostFormatted || "Cost unavailable"}
              </span>
            </div>

            {estimate.providerCosts && Object.keys(estimate.providerCosts).length > 0 ? (
              <div className="grid grid-cols-3 gap-2 pt-1">
                {Object.entries(estimate.providerCosts).map(([provName, costStr]) => (
                  <div key={provName} className="px-2.5 py-1.5 rounded-lg bg-[#181824] border border-[#262638] text-[10px] flex items-center justify-between">
                    <span className="text-zinc-400">{provName}:</span>
                    <span className="font-bold text-zinc-200">{costStr}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-zinc-500 italic">
                Cost data is unavailable for the selected custom model.
              </div>
            )}
          </div>

          {/* 4. Risk & Confidence Indicators */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <div className={`flex-1 px-3 py-2 rounded-xl border flex items-center justify-between text-xs ${getRiskColor(risk)}`}>
              <span className="font-semibold text-[11px]">Risk Level:</span>
              <span className="font-bold tracking-wider">{risk}</span>
            </div>

            <div className={`flex-1 px-3 py-2 rounded-xl border flex items-center justify-between text-xs ${getConfidenceColor(String(confidence))}`}>
              <span className="font-semibold text-[11px]">Estimate Confidence:</span>
              <span className="font-bold tracking-wider">{confidence}</span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-[#1e1e2c] bg-[#12121c]">
          <span className="text-[10.5px] text-zinc-500">
            Advisory preflight • Normal execution pipeline preserved
          </span>
          <div className="flex items-center gap-2.5">
            <button
              onClick={onCancel}
              className="px-3.5 py-1.5 rounded-xl border border-zinc-700/60 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onContinue}
              className="px-4 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 border border-cyan-400/40 text-black font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-cyan-950/50 cursor-pointer transition-all"
              autoFocus
            >
              <span>Continue</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
