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
  recommendedModel?: {
    providerId: string | null;
    modelId: string | null;
    modelDisplayName?: string | null;
    reason: string;
    savingsEstimate?: string | null;
    isCurrentOptimal?: boolean;
    tier?: string;
  } | null;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fadeIn font-sans">
      <div 
        role="dialog"
        aria-modal="true"
        aria-label="Token and Cost Preflight Estimate"
        className="w-full max-w-xl rounded-xl border border-[#22252B] bg-[#111318] shadow-modal overflow-hidden flex flex-col font-sans text-xs text-[#E6E8EB]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#22252B] bg-[#0E1013]">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md bg-[#1A1C22] border border-[#22252B] text-[#4CC2DE]">
              <Coins className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-[#E6E8EB] tracking-normal">
                  TOKEN / COST PREFLIGHT
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#1A1C22] border border-[#22252B] text-[#9AA1AC]">
                  ADVISORY
                </span>
              </div>
              <p className="text-xs text-[#9AA1AC] mt-0.5">
                Deterministic pre-execution estimate for task scope
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-md text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#14161B] transition-colors cursor-pointer"
            title="Cancel (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Prompt Preview */}
        <div className="px-5 py-2.5 bg-[#0B0C0F] border-b border-[#22252B] text-xs">
          <span className="text-[#9AA1AC] font-medium uppercase tracking-wider text-[10px]">Task Intent:</span>
          <div className="text-[#E6E8EB] font-mono text-xs mt-1 line-clamp-2 bg-[#14161B] p-2 rounded-md border border-[#22252B]">
            "{taskPrompt}"
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* 1. Token Metrics Card */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-[#14161B] border border-[#22252B] flex flex-col">
              <span className="text-[10px] uppercase font-medium text-[#9AA1AC]">Estimated Context</span>
              <span className="text-base font-semibold text-[#E6E8EB] mt-1 font-mono">
                {formatTokens(estimate.estimatedInputTokens)} <span className="text-[10px] font-normal text-[#6B7280]">tokens</span>
              </span>
              <span className="text-[10px] text-[#6B7280] mt-0.5">Input & active files</span>
            </div>

            <div className="p-3 rounded-lg bg-[#14161B] border border-[#22252B] flex flex-col">
              <span className="text-[10px] uppercase font-medium text-[#9AA1AC]">Agent Output</span>
              <span className="text-base font-semibold text-[#E6E8EB] mt-1 font-mono">
                {formatTokens(estimate.estimatedMaxOutputTokens)} <span className="text-[10px] font-normal text-[#6B7280]">tokens</span>
              </span>
              <span className="text-[10px] text-[#6B7280] mt-0.5">Generated response</span>
            </div>

            <div className="p-3 rounded-lg bg-[#14161B] border border-[#22252B] flex flex-col">
              <span className="text-[10px] uppercase font-medium text-[#4CC2DE]">Estimated Total</span>
              <span className="text-base font-semibold text-[#4CC2DE] mt-1 font-mono">
                ~{formatTokens(estimate.estimatedTotalTokens)} <span className="text-[10px] font-normal text-[#6B7280]">tokens</span>
              </span>
              <span className="text-[10px] text-[#9AA1AC] mt-0.5">Turn token ceiling</span>
            </div>
          </div>

          {/* 2. Execution Scope & Tools Card */}
          <div className="p-3.5 rounded-lg bg-[#14161B] border border-[#22252B] space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-[#9AA1AC]">
                <FileCode className="w-3.5 h-3.5 text-[#9AA1AC]" />
                <span>Estimated files likely touched:</span>
              </div>
              <span className="font-semibold text-[#E6E8EB]">
                {estimate.estimatedFiles?.count ?? 1} file(s)
              </span>
            </div>

            {estimate.estimatedFiles?.targetFiles && estimate.estimatedFiles.targetFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {estimate.estimatedFiles.targetFiles.map((file, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 rounded bg-[#1A1C22] border border-[#22252B] text-[10px] text-[#4CC2DE] font-mono truncate max-w-[240px]"
                    title={file}
                  >
                    {file}
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between text-xs pt-2 border-t border-[#22252B]">
              <div className="flex items-center gap-2 text-[#9AA1AC]">
                <Wrench className="w-3.5 h-3.5 text-[#D9A441]" />
                <span>Estimated tool operations / steps:</span>
              </div>
              <span className="font-semibold text-[#E6E8EB]">
                ~{estimate.estimatedToolCalls?.approximate ?? estimate.estimatedToolCalls?.min ?? 3} operations
              </span>
            </div>
          </div>

          {/* 3. Provider Cost Card */}
          <div className="p-3.5 rounded-lg bg-[#14161B] border border-[#22252B] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-[#9AA1AC]">
                Estimated Provider Cost:
              </span>
              <span className="text-xs font-semibold text-[#3EAE79] font-mono">
                {estimate.primaryCostFormatted || "Cost unavailable"}
              </span>
            </div>

            {estimate.providerCosts && Object.keys(estimate.providerCosts).length > 0 ? (
              <div className="grid grid-cols-3 gap-2 pt-1">
                {Object.entries(estimate.providerCosts).map(([provName, costStr]) => (
                  <div key={provName} className="px-2.5 py-1.5 rounded-md bg-[#0E1013] border border-[#22252B] text-[10px] flex items-center justify-between">
                    <span className="text-[#9AA1AC]">{provName}:</span>
                    <span className="font-medium text-[#E6E8EB] font-mono">{costStr}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-[#6B7280] italic">
                Cost data is unavailable for the selected custom model.
              </div>
            )}
          </div>

          {/* 4. Risk & Confidence Indicators */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <div className={`flex-1 px-3 py-2 rounded-md border flex items-center justify-between text-xs ${getRiskColor(risk)}`}>
              <span className="font-medium text-[11px]">Risk Level:</span>
              <span className="font-semibold tracking-wide">{risk}</span>
            </div>

            <div className={`flex-1 px-3 py-2 rounded-md border flex items-center justify-between text-xs ${getConfidenceColor(String(confidence))}`}>
              <span className="font-medium text-[11px]">Estimate Confidence:</span>
              <span className="font-semibold tracking-wide">{confidence}</span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[#22252B] bg-[#0E1013]">
          <span className="text-xs text-[#6B7280]">
            Advisory preflight • Normal execution pipeline preserved
          </span>
          <div className="flex items-center gap-2.5">
            <button
              onClick={onCancel}
              className="px-3.5 py-1.5 rounded-md border border-[#22252B] bg-[#14161B] hover:bg-[#1A1C22] text-[#9AA1AC] hover:text-[#E6E8EB] text-xs font-medium cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onContinue}
              className="px-4 py-1.5 rounded-md bg-[#4CC2DE] hover:bg-[#3db0cc] text-[#0A0B0D] font-medium text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
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
