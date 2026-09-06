"use client";

import React, { useState, useRef, useEffect } from "react";
import { 
  FolderOpen, GitBranch, Layers, Plus, ShieldCheck, Cpu, 
  Send, ArrowRight, Zap, ChevronDown, Check, Key, Upload, Box,
  Coins, Info, X, Sparkles, GitMerge, Loader2, CheckCircle2, RefreshCw, AlertTriangle
} from "lucide-react";
import { useOutsideClick } from "../hooks/useOutsideClick";
import RefactorPlanModal, { RefactorPlanData } from "./RefactorPlanModal";

interface CodexBottomComposerProps {
  workspaceName?: string;
  gitBranch?: string;
  activeProvider?: string;
  activeModel?: string;
  promptValue?: string;
  onPromptChange?: (prompt: string) => void;
  onSelectModel: (providerId: string, modelId?: string) => void;
  onSubmitTask: (prompt: string, approvalMode: "auto" | "strict", providerId?: string, modelId?: string) => void;
  onOpenContinuum: () => void;
  onOpenFolder: () => void;
  onImportCapsule?: () => void;
  attachedCapsule?: any;
  disabled?: boolean;
}

export default function CodexBottomComposer({
  workspaceName = "NEXUS",
  gitBranch = "main",
  activeProvider = "gemini",
  activeModel = "gemini-2.5-flash",
  promptValue,
  onPromptChange,
  onSelectModel,
  onSubmitTask,
  onOpenContinuum,
  onOpenFolder,
  onImportCapsule,
  attachedCapsule,
  disabled = false,
}: CodexBottomComposerProps) {
  const [prompt, setPrompt] = useState(promptValue || "");
  const [approvalMode, setApprovalMode] = useState<"auto" | "strict">("auto");
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showApprovalDropdown, setShowApprovalDropdown] = useState(false);
  const [preflight, setPreflight] = useState<any>(null);
  const [showPreflightPopover, setShowPreflightPopover] = useState(false);
  const [toastEstimate, setToastEstimate] = useState<any>(null);
  const [showToast, setShowToast] = useState(false);
  const [verifiedUsage, setVerifiedUsage] = useState<{ isAvailable: boolean; display: string; raw?: any } | null>(null);
  const [isKeyConfigured, setIsKeyConfigured] = useState<boolean>(false);
  const [failoverNotice, setFailoverNotice] = useState<{
    primaryProviderId: string;
    fallbackDisplayName: string;
    reason: string;
  } | null>(null);
  const [refactorPlan, setRefactorPlan] = useState<RefactorPlanData | null>(null);
  const [showRefactorModal, setShowRefactorModal] = useState(false);
  const [isRefactorExecuting, setIsRefactorExecuting] = useState(false);
  const [testVerificationStatus, setTestVerificationStatus] = useState<{
    status: string;
    display?: string;
    badge?: string;
    cycle?: number;
    maxCycles?: number;
    targetedTests?: string[];
  } | null>(null);
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const failoverTimerRef = useRef<NodeJS.Timeout | null>(null);
  const testVerificationTimerRef = useRef<NodeJS.Timeout | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Subscribe to live refactor plan updates
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    let unsubscribePlan: (() => void) | null = null;
    if (electronAPI?.harness?.onRefactorPlanUpdate) {
      unsubscribePlan = electronAPI.harness.onRefactorPlanUpdate((update: any) => {
        setRefactorPlan((prev) => {
          if (!prev || prev.planId !== update.planId) return prev;
          return {
            ...prev,
            status: update.status || prev.status,
            rejectionReason: update.rejectionReason !== undefined ? update.rejectionReason : prev.rejectionReason,
            tasks: update.tasks || prev.tasks,
            verificationResult: update.verification || prev.verificationResult,
          };
        });
      });
    }
    return () => {
      if (typeof unsubscribePlan === "function") unsubscribePlan();
    };
  }, []);

  React.useEffect(() => {
    if (promptValue !== undefined && promptValue !== prompt) {
      setPrompt(promptValue);
      if (promptValue && textareaRef.current) {
        setTimeout(() => {
          textareaRef.current?.focus();
        }, 50);
      }
    }
  }, [promptValue]);

  useEffect(() => {
    if (attachedCapsule && textareaRef.current) {
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 50);
    }
  }, [attachedCapsule]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
      if (failoverTimerRef.current) {
        clearTimeout(failoverTimerRef.current);
      }
    };
  }, []);

  // Fetch verified usage and credential status for active provider
  useEffect(() => {
    let isMounted = true;

    const fetchUsageAndConfig = async () => {
      try {
        const electronAPI = (window as any).electronAPI;
        if (electronAPI?.ai) {
          const [cfg, usage] = await Promise.all([
            typeof electronAPI.ai.getConfig === 'function' ? electronAPI.ai.getConfig() : null,
            typeof electronAPI.ai.getVerifiedUsage === 'function' ? electronAPI.ai.getVerifiedUsage(activeProvider) : null,
          ]);

          if (isMounted) {
            if (cfg && Array.isArray(cfg.providers)) {
              const currentProv = cfg.providers.find((p: any) => p.id === activeProvider);
              setIsKeyConfigured(Boolean(currentProv?.isConfigured));
            }
            if (usage) {
              setVerifiedUsage(usage);
            } else {
              setVerifiedUsage({ isAvailable: false, display: "Not available" });
            }
          }
        }
      } catch (_) {
        if (isMounted) {
          setVerifiedUsage({ isAvailable: false, display: "Not available" });
        }
      }
    };

    fetchUsageAndConfig();

    const handleConfigChange = () => {
      fetchUsageAndConfig();
    };

    window.addEventListener("nexus:ai-config-changed", handleConfigChange);
    let unsubscribeIpc: (() => void) | null = null;
    if ((window as any).electronAPI?.ai?.onConfigChange) {
      unsubscribeIpc = (window as any).electronAPI.ai.onConfigChange(handleConfigChange);
    }

    let unsubscribeFailover: (() => void) | null = null;
    if ((window as any).electronAPI?.ai?.onFailover) {
      unsubscribeFailover = (window as any).electronAPI.ai.onFailover((data: any) => {
        if (data && isMounted) {
          setFailoverNotice({
            primaryProviderId: data.primaryProviderId || activeProvider,
            fallbackDisplayName: data.fallbackDisplayName || data.fallbackModelId || "Compatible Provider",
            reason: data.reason || "429 Rate Limit",
          });
          if (failoverTimerRef.current) clearTimeout(failoverTimerRef.current);
          failoverTimerRef.current = setTimeout(() => {
            if (isMounted) setFailoverNotice(null);
          }, 6000);
        }
      });
    }

    let unsubscribeTestVerification: (() => void) | null = null;
    if ((window as any).electronAPI?.ai?.onTestVerificationStatus) {
      unsubscribeTestVerification = (window as any).electronAPI.ai.onTestVerificationStatus((data: any) => {
        if (data && isMounted) {
          setTestVerificationStatus(data);
          if (
            data.status === "PASSED" ||
            data.status === "REPAIR_EXHAUSTED" ||
            data.status === "SKIPPED" ||
            data.status === "NO_TESTS_FOUND" ||
            data.status === "RUNNER_NOT_DETECTED" ||
            data.status === "TESTS_NOT_CONFIGURED" ||
            data.status === "ENVIRONMENT_FAILURE" ||
            data.status === "DEPENDENCY_FAILURE" ||
            data.status === "TIMEOUT"
          ) {
            if (testVerificationTimerRef.current) clearTimeout(testVerificationTimerRef.current);
            testVerificationTimerRef.current = setTimeout(() => {
              if (isMounted) setTestVerificationStatus(null);
            }, 10000);
          }
        }
      });
    }

    return () => {
      isMounted = false;
      if (failoverTimerRef.current) clearTimeout(failoverTimerRef.current);
      if (testVerificationTimerRef.current) clearTimeout(testVerificationTimerRef.current);
      window.removeEventListener("nexus:ai-config-changed", handleConfigChange);
      if (typeof unsubscribeIpc === "function") unsubscribeIpc();
      if (typeof unsubscribeFailover === "function") unsubscribeFailover();
      if (typeof unsubscribeTestVerification === "function") unsubscribeTestVerification();
    };
  }, [activeProvider]);

  // Debounced Preflight Cost & Context Estimation (Non-Blocking)
  useEffect(() => {
    const currentPrompt = promptValue !== undefined ? promptValue : prompt;
    if (!currentPrompt || !currentPrompt.trim()) {
      setPreflight(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const intelligence = (window as any).electronAPI?.intelligence;
        if (intelligence?.preflightEstimate) {
          const res = await intelligence.preflightEstimate({
            userInput: currentPrompt.trim(),
            providerId: activeProvider,
            modelId: activeModel,
            importedCapsule: attachedCapsule,
          });
          if (res && !res.error) {
            setPreflight(res);
          }
        }
      } catch (_) {}
    }, 200);

    return () => clearTimeout(timer);
  }, [prompt, promptValue, activeProvider, activeModel, attachedCapsule]);

  const approvalTriggerRef = useRef<HTMLButtonElement | null>(null);
  const approvalDropdownRef = useOutsideClick<HTMLDivElement>({
    isOpen: showApprovalDropdown,
    onClose: () => setShowApprovalDropdown(false),
    triggerRef: approvalTriggerRef,
  });

  const modelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const modelDropdownRef = useOutsideClick<HTMLDivElement>({
    isOpen: showModelDropdown,
    onClose: () => setShowModelDropdown(false),
    triggerRef: modelTriggerRef,
  });

  const preflightTriggerRef = useRef<HTMLButtonElement | null>(null);
  const preflightPopoverRef = useOutsideClick<HTMLDivElement>({
    isOpen: showPreflightPopover,
    onClose: () => setShowPreflightPopover(false),
    triggerRef: preflightTriggerRef,
  });

  const getProviderDisplayName = (id: string) => {
    if (id === "nexus1") return "NEXUS 1 (Gemini)";
    if (id === "nexus2") return "NEXUS 2 (Gemini)";
    if (id === "nexus3") return "NEXUS 3 (Gemini)";
    if (id === "nexus4") return "NEXUS 4 (Gemini)";
    if (id === "nexus5") return "NEXUS 5 (Gemini)";
    if (id === "nexus6") return "NEXUS 6 (Groq)";
    if (id === "gemini") return "Google Gemini";
    if (id === "groq") return "Groq";
    if (id === "openai") return "OpenAI";
    if (id === "claude") return "Claude";
    if (id === "deepseek") return "DeepSeek";
    if (id === "grok") return "xAI Grok";
    return id;
  };

  const handleOpenRefactorPlan = async () => {
    const currentPrompt = promptValue !== undefined ? promptValue : prompt;
    if (!currentPrompt.trim()) return;
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.harness?.planRefactor) {
      const res = await electronAPI.harness.planRefactor({
        goal: currentPrompt.trim(),
      });
      if (res?.success && res?.plan) {
        setRefactorPlan(res.plan);
        setShowRefactorModal(true);
      }
    }
  };

  const handleApproveAndExecuteRefactor = async (stepByStep: boolean) => {
    if (!refactorPlan) return;
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.harness) {
      setIsRefactorExecuting(true);
      await electronAPI.harness.approveRefactorPlan({
        planId: refactorPlan.planId,
        stepByStep,
      });
      const execRes = await electronAPI.harness.executeRefactorPlan({
        planId: refactorPlan.planId,
        stepByStep,
      });
      if (execRes?.plan) {
        setRefactorPlan((prev) => (prev ? { ...prev, ...execRes.plan } : execRes.plan));
      }
      setIsRefactorExecuting(false);
    }
  };

  const handleCancelRefactorPlan = async (reason?: string) => {
    if (!refactorPlan) return;
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.harness?.rejectRefactorPlan) {
      await electronAPI.harness.rejectRefactorPlan({
        planId: refactorPlan.planId,
        reason: reason || "Cancelled by user",
      });
      setRefactorPlan((prev) =>
        prev ? { ...prev, status: "CANCELLED", rejectionReason: reason || "Cancelled by user" } : null
      );
    }
  };

  const isRefactorCandidate = Boolean(
    (preflight?.riskLevel === "HIGH" ||
      (preflight?.estimatedFilesCount && preflight.estimatedFilesCount > 2) ||
      (promptValue || prompt).toLowerCase().includes("refactor")) &&
      (promptValue || prompt).trim().length > 10
  );

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const currentPrompt = promptValue !== undefined ? promptValue : prompt;
    if (!currentPrompt.trim() || disabled) return;
    const trimmed = currentPrompt.trim();

    // Determine prompt token & cost estimate using existing PreflightEstimator
    let estimate = preflight;
    if (!estimate) {
      try {
        const intelligence = (window as any).electronAPI?.intelligence;
        if (intelligence?.preflightEstimate) {
          estimate = await intelligence.preflightEstimate({
            userInput: trimmed,
            providerId: activeProvider,
            modelId: activeModel,
            importedCapsule: attachedCapsule,
          });
        }
      } catch (_) {}
    }

    // Show non-blocking toast for coding prompts only (greetings bypass)
    if (estimate && estimate.shouldShowPreflight) {
      setToastEstimate(estimate);
      setShowToast(true);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      toastTimerRef.current = setTimeout(() => {
        setShowToast(false);
      }, 4000);
    } else {
      setShowToast(false);
    }

    onSubmitTask(trimmed, approvalMode, activeProvider, activeModel);
    if (promptValue === undefined) {
      setPrompt("");
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col items-center gap-2 select-none font-mono">
      {/* Non-Blocking Preflight Prompt Analysis Toast */}
      {showToast && toastEstimate && (
        <div
          className="w-full px-3.5 py-2.5 rounded-xl border border-cyan-500/40 shadow-2xl flex items-start justify-between gap-3 animate-fadeIn transition-all"
          style={{
            backgroundColor: "var(--theme-surface-raised, #0e0e18)",
            color: "var(--theme-text, #f4f4f5)",
          }}
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="p-1 rounded-lg bg-cyan-950/80 border border-cyan-500/40 text-cyan-400 mt-0.5 shrink-0">
              <Zap className="w-3.5 h-3.5" />
            </div>
            <div className="space-y-0.5 text-xs font-mono min-w-0">
              <div className="text-[11px] font-bold text-cyan-300 flex items-center gap-1.5 font-sans">
                <span>NEXUS analyzed your prompt</span>
              </div>
              <div className="text-[11px] text-zinc-300 flex items-center gap-2 flex-wrap">
                <span>
                  Estimated usage: ~{toastEstimate.estimatedTotalTokens || (toastEstimate.estimatedInputTokens + toastEstimate.estimatedMaxOutputTokens)} tokens
                </span>
                <span className="text-zinc-600">•</span>
                <span className="text-zinc-400 text-[10px]">
                  (Input: ~{toastEstimate.estimatedInputTokens} • Output: ~{toastEstimate.estimatedMaxOutputTokens})
                </span>
              </div>
              <div className="text-[11px] text-zinc-300 flex items-center gap-1.5">
                <span>Estimated cost:</span>
                <span className="font-bold text-emerald-400">
                  {toastEstimate.primaryCostFormatted || (toastEstimate.pricingAvailable && toastEstimate.estimatedCostUSD !== null ? `~$${toastEstimate.estimatedCostUSD.toFixed(4)}` : "Cost unavailable")}
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowToast(false)}
            className="p-1 rounded text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer shrink-0"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Non-Blocking Dynamic Auto-Failover Notification Banner */}
      {failoverNotice && (
        <div
          className="w-full px-3.5 py-2.5 rounded-lg border border-[#D9A441]/40 bg-[#1A1C22] text-[#E6E8EB] flex items-center justify-between gap-3 font-sans transition-colors"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1 rounded-md bg-[#14161B] border border-[#D9A441]/40 text-[#D9A441] shrink-0">
              <Zap className="w-3.5 h-3.5" />
            </div>
            <div className="text-xs min-w-0 flex items-center gap-1.5 flex-wrap">
              <span className="text-[#D9A441] font-medium">Auto-Failover:</span>
              <span className="text-[#9AA1AC]">{getProviderDisplayName(failoverNotice.primaryProviderId)} ({failoverNotice.reason})</span>
              <span className="text-[#6B7280]">→</span>
              <span className="text-[#3EAE79] font-medium">{failoverNotice.fallbackDisplayName}</span>
              <span className="text-[#6B7280] text-[11px]">(Zero data lost)</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setFailoverNotice(null)}
            className="p-1 rounded text-amber-400/60 hover:text-amber-200 transition-colors cursor-pointer shrink-0"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 1. Quiet Context Line: [ workspace · branch · continuum / capsule context ... token estimate ] */}
      <div className="w-full flex items-center justify-between gap-2 px-1 text-xs font-sans text-[#8C92A4]">
        {/* Left: Quiet Consolidated Workspace & Branch Context */}
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          {/* Workspace Trigger */}
          <button
            type="button"
            onClick={onOpenFolder}
            className="flex items-center gap-1 text-[#8C92A4] hover:text-[#E6E8EB] transition-colors cursor-pointer text-[11px]"
            title="Switch Workspace Folder"
          >
            <FolderOpen className="w-3.5 h-3.5 text-[#8C92A4] shrink-0" />
            <span className="font-medium truncate max-w-[130px]">{workspaceName}</span>
          </button>

          <span className="text-[#3E424D]">·</span>

          {/* Git Branch */}
          <div 
            className="flex items-center gap-1 text-[#8C92A4] text-[11px]"
            title={`Active Branch: ${gitBranch}`}
          >
            <GitBranch className="w-3.5 h-3.5 shrink-0 text-[#6B7280]" />
            <span className="truncate max-w-[130px]">{gitBranch}</span>
          </div>

          <span className="text-[#3E424D]">·</span>

          {/* CONTINUUM Trigger */}
          <button
            type="button"
            onClick={onOpenContinuum}
            className="flex items-center gap-1 text-[#8C92A4] hover:text-[#4CC2DE] transition-colors cursor-pointer text-[11px]"
            title="Open Continuum Session Memory & Lineage"
          >
            <Layers className="w-3.5 h-3.5 text-[#4CC2DE] shrink-0" />
            <span>Continuum</span>
          </button>

          {/* Import Context Capsule Trigger */}
          {onImportCapsule && (
            <>
              <span className="text-[#3E424D]">·</span>
              <button
                type="button"
                onClick={onImportCapsule}
                className="flex items-center gap-1 text-[#8C92A4] hover:text-[#E6E8EB] transition-colors cursor-pointer text-[11px]"
                title="Import Context Capsule to continue previous conversation"
              >
                <Upload className="w-3.5 h-3.5 text-[#6B7280] shrink-0" />
                <span>Import Capsule</span>
              </button>
            </>
          )}
        </div>

        {/* Right: Quiet Preflight Cost & Context Indicator */}
        {preflight && preflight.estimatedInputTokens > 0 && (
          <div className="relative shrink-0">
            <button
              ref={preflightTriggerRef}
              type="button"
              onClick={() => setShowPreflightPopover((prev) => !prev)}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-sans cursor-pointer transition-colors ${
                preflight.budgetStatus?.level === "CRITICAL"
                  ? "bg-[#DC5B5B]/10 text-[#DC5B5B] hover:bg-[#DC5B5B]/20"
                  : preflight.budgetStatus?.level === "APPROACHING"
                  ? "bg-[#D9A441]/10 text-[#D9A441] hover:bg-[#D9A441]/20"
                  : "text-[#8C92A4] hover:text-[#E6E8EB] hover:bg-[#14161B]"
              }`}
              title="Click for Preflight Token & Cost Details"
            >
              <Coins className="w-3 h-3 text-[#6B7280] shrink-0" />
              <span>
                {preflight.estimatedInputTokens >= 1000
                  ? `~${(preflight.estimatedInputTokens / 1000).toFixed(1)}k`
                  : `~${preflight.estimatedInputTokens}`}
                {" tokens"}
              </span>
              {preflight.pricingAvailable && preflight.estimatedCostUSD !== null && (
                <>
                  <span className="text-[#3E424D]">•</span>
                  <span className="text-[#3EAE79] font-medium">
                    {`~$${preflight.estimatedCostUSD.toFixed(preflight.estimatedCostUSD < 0.01 ? 4 : 2)}`}
                  </span>
                </>
              )}
            </button>

            {showPreflightPopover && (
              <div
                ref={preflightPopoverRef}
                className="absolute right-0 bottom-7 w-64 border border-[#22252B] rounded-lg shadow-popover bg-[#1A1C22] z-50 p-2.5 space-y-2 text-xs font-sans"
              >
                <div className="flex items-center justify-between border-b border-[#22252B] pb-1.5">
                  <span className="text-xs font-medium text-[#E6E8EB] flex items-center gap-1.5">
                    <Coins className="w-3.5 h-3.5 text-[#4CC2DE]" />
                    Preflight Estimate
                  </span>
                  <span
                    className={`text-[9.5px] px-1.5 py-0.5 rounded font-mono font-medium ${
                      preflight.budgetStatus?.level === "CRITICAL"
                        ? "bg-[#DC5B5B]/10 text-[#DC5B5B] border border-[#DC5B5B]/30"
                        : preflight.budgetStatus?.level === "APPROACHING"
                        ? "bg-[#D9A441]/10 text-[#D9A441] border border-[#D9A441]/30"
                        : "bg-[#3EAE79]/10 text-[#3EAE79] border border-[#3EAE79]/30"
                    }`}
                  >
                    {preflight.budgetStatus?.level || "NORMAL"}
                  </span>
                </div>

                <div className="space-y-1 text-[11px] text-[#9AA1AC]">
                  <div className="flex justify-between">
                    <span className="text-[#6B7280]">Estimated input:</span>
                    <span className="font-medium text-[#E6E8EB]">
                      {preflight.estimatedInputTokens.toLocaleString()} tokens
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B7280]">Max output:</span>
                    <span className="font-medium text-[#E6E8EB]">
                      {preflight.estimatedMaxOutputTokens.toLocaleString()} tokens
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B7280]">Files:</span>
                    <span className="font-medium text-[#E6E8EB]">
                      {preflight.estimatedFiles?.count || 1}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B7280]">Tool calls:</span>
                    <span className="font-medium text-[#E6E8EB]">
                      {preflight.estimatedToolCalls?.min === 0
                        ? "0"
                        : `${preflight.estimatedToolCalls?.min}–${preflight.estimatedToolCalls?.max}`}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6B7280]">Context window:</span>
                    <span
                      className={`font-medium ${
                        preflight.isContextExceeded
                          ? "text-[#D9A441]"
                          : "text-[#E6E8EB]"
                      }`}
                    >
                      {preflight.contextWindow
                        ? `${(preflight.contextWindow / 1000).toFixed(0)}k ${
                            preflight.contextUsageRatio
                              ? `(${(preflight.contextUsageRatio * 100).toFixed(0)}%)`
                              : ""
                          }`
                        : "Unknown limit"}
                    </span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-[#22252B]">
                    <span className="text-[#6B7280]">Estimated cost:</span>
                    <span className="font-medium text-[#3EAE79]">
                      {preflight.pricingAvailable && preflight.estimatedCostUSD !== null
                        ? `$${preflight.estimatedCostUSD.toFixed(preflight.estimatedCostUSD < 0.01 ? 4 : 2)}`
                        : "N/A"}
                    </span>
                  </div>

                  {preflight.recommendedModel?.modelId && (
                    <div className="pt-1.5 border-t border-[#22252B] space-y-0.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-[#6B7280] flex items-center gap-1">
                          {preflight.recommendedModel.isContextExceeded ? (
                            <AlertTriangle className="w-3 h-3 text-[#D9A441] shrink-0" />
                          ) : (
                            <Sparkles className="w-3 h-3 text-[#4CC2DE] shrink-0" />
                          )}
                          Advisor:
                        </span>
                        <span className={`font-medium truncate max-w-[125px] ${preflight.recommendedModel.isContextExceeded ? "text-[#D9A441]" : "text-[#4CC2DE]"}`}>
                          {preflight.recommendedModel.modelDisplayName || preflight.recommendedModel.modelId}
                        </span>
                      </div>
                      <div className={`text-[10px] leading-tight ${preflight.recommendedModel.isContextExceeded ? "text-[#D9A441]/90" : "text-[#9AA1AC]"}`}>
                        {preflight.recommendedModel.reason}
                      </div>
                    </div>
                  )}
                </div>

                <div className="text-[10px] text-[#6B7280] pt-0.5 text-center">
                  Deterministic preflight • Zero AI calls
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. Codex Agent Composer Container */}
      <form onSubmit={handleSubmit} className="w-full">
        <div 
          className="border border-[#22252B] focus-within:border-[#4CC2DE] rounded-lg p-3 bg-[#111318] transition-colors relative space-y-2"
        >
          {/* Subtle Capsule Attachment Badge */}
          {attachedCapsule && (
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-[#14161B] border border-[#22252B] text-[11px] text-[#9AA1AC] font-sans">
              <div className="flex items-center gap-2 min-w-0 truncate">
                <Box className="w-3.5 h-3.5 text-[#4CC2DE] shrink-0" />
                <span className="px-1.5 py-0.5 rounded bg-[#1A1C22] border border-[#22252B] text-[#E6E8EB] font-mono text-[10px] shrink-0">
                  {`Context Capsule ${attachedCapsule.capsule_ref || (attachedCapsule.capsule_id ? `#CC${attachedCapsule.capsule_id.slice(-6).toUpperCase()}` : "#CC")}`}
                </span>
                <span className="font-medium text-[#E6E8EB] truncate">Continuation context prepared</span>
              </div>
              <span className="text-[10px] text-[#3EAE79] flex items-center gap-1 font-medium shrink-0 ml-2">
                <Check className="w-3 h-3 text-[#3EAE79]" />
                Ready
              </span>
            </div>
          )}

          {/* Prompt Textarea */}
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => {
              const val = e.target.value;
              setPrompt(val);
              onPromptChange?.(val);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (e.metaKey || e.ctrlKey) {
                  e.preventDefault();
                  handleSubmit();
                } else if (!e.shiftKey && !attachedCapsule && !prompt.includes("\n") && !e.nativeEvent?.isComposing) {
                  e.preventDefault();
                  handleSubmit();
                }
              }
            }}
            placeholder="Ask NEXUS to investigate or change code... (⌘Enter to send)"
            disabled={disabled}
            className={`w-full bg-transparent text-xs text-[#E6E8EB] placeholder-[#6B7280] focus:outline-none resize-none font-sans transition-all ${
              attachedCapsule || prompt.length > 200 || prompt.includes("\n") ? "h-48" : "h-20"
            }`}
          />

          {/* Bottom Control Row */}
          <div 
            className="flex items-center justify-between pt-2 border-t border-[#22252B] text-xs font-sans"
          >
            <div className="flex items-center gap-2 relative">
              {/* Attachment / Action Button */}
              <button
                type="button"
                className="w-7 h-7 rounded-md border border-[#22252B] bg-[#14161B] hover:bg-[#1A1C22] flex items-center justify-center text-[#9AA1AC] hover:text-[#E6E8EB] transition-colors cursor-pointer"
                title="Attach Context or File"
              >
                <Plus className="w-4 h-4" />
              </button>

              {/* Approval Mode Control */}
              <div className="relative">
                <button
                  ref={approvalTriggerRef}
                  type="button"
                  onClick={() => setShowApprovalDropdown((prev) => !prev)}
                  className="px-2.5 py-1 rounded-md border border-[#22252B] bg-[#14161B] hover:bg-[#1A1C22] text-[#9AA1AC] hover:text-[#E6E8EB] text-[11px] font-sans flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <ShieldCheck className={`w-3.5 h-3.5 ${approvalMode === "auto" ? "text-[#3EAE79]" : "text-[#D9A441]"}`} />
                  <span>{approvalMode === "auto" ? "Auto-Approve Safe" : "Require Approval"}</span>
                  <ChevronDown className="w-3 h-3 text-[#6B7280]" />
                </button>

                {showApprovalDropdown && (
                  <div 
                    ref={approvalDropdownRef}
                    className="absolute left-0 bottom-9 w-48 border border-[#22252B] rounded-lg shadow-popover bg-[#1A1C22] z-50 p-1 space-y-0.5 text-xs font-sans"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setApprovalMode("auto");
                        setShowApprovalDropdown(false);
                      }}
                      className="w-full text-left px-2 py-1.5 rounded-md flex items-center justify-between hover:bg-[#22252B] text-[#E6E8EB] cursor-pointer"
                    >
                      <span>Auto-Approve Safe</span>
                      {approvalMode === "auto" && <Check className="w-3.5 h-3.5 text-[#3EAE79]" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setApprovalMode("strict");
                        setShowApprovalDropdown(false);
                      }}
                      className="w-full text-left px-2 py-1.5 rounded-md flex items-center justify-between hover:bg-[#22252B] text-[#E6E8EB] cursor-pointer"
                    >
                      <span>Require Approval</span>
                      {approvalMode === "strict" && <Check className="w-3.5 h-3.5 text-[#D9A441]" />}
                    </button>
                  </div>
                )}
              </div>

              {/* Model Selector Button & Dropdown */}
              <div className="relative">
                <button
                  ref={modelTriggerRef}
                  type="button"
                  onClick={() => setShowModelDropdown((prev) => !prev)}
                  className="px-2.5 py-1 rounded-md border border-[#22252B] bg-[#14161B] hover:bg-[#1A1C22] text-[#E6E8EB] text-[11px] font-sans flex items-center gap-1.5 cursor-pointer max-w-[180px] transition-colors"
                >
                  <Cpu className="w-3.5 h-3.5 text-[#9AA1AC] shrink-0" />
                  <span className="truncate capitalize">
                    {activeProvider.startsWith("nexus") 
                      ? (activeProvider === "nexus6" ? "NEXUS 6 (Groq)" : `NEXUS ${activeProvider.replace("nexus", "")} (Gemini)`) 
                      : `${activeProvider} (${activeModel.split('/').pop()?.replace(/^models\//, '') || activeModel})`}
                  </span>
                  <ChevronDown className="w-3 h-3 text-[#6B7280] shrink-0" />
                </button>

                {showModelDropdown && (
                  <div 
                    ref={modelDropdownRef}
                    className="absolute left-0 bottom-9 w-64 border border-[#22252B] rounded-lg shadow-popover bg-[#1A1C22] z-50 p-1 space-y-0.5 text-xs font-sans max-h-56 overflow-y-auto"
                  >
                    {[
                      { id: "nexus1", name: "NEXUS 1", modelId: "gemini-2.5-flash", label: "NEXUS 1 (Gemini 2.5 Flash)" },
                      { id: "nexus2", name: "NEXUS 2", modelId: "gemini-3.5-flash", label: "NEXUS 2 (Gemini 3.5 Flash)" },
                      { id: "nexus3", name: "NEXUS 3", modelId: "gemini-3.5-flash", label: "NEXUS 3 (Gemini 3.5 Flash)" },
                      { id: "nexus4", name: "NEXUS 4", modelId: "gemini-3.5-flash", label: "NEXUS 4 (Gemini 3.5 Flash)" },
                      { id: "nexus5", name: "NEXUS 5", modelId: "gemini-3.5-flash", label: "NEXUS 5 (Gemini 3.5 Flash)" },
                      { id: "nexus6", name: "NEXUS 6", modelId: "openai/gpt-oss-120b", label: "NEXUS 6 (Groq GPT-OSS 120B)" },
                    ].map((p, idx) => {
                      const isSel = activeProvider === p.id && (activeModel === p.modelId || (!activeModel && idx === 0));
                      return (
                        <button
                          key={`${p.id}-${p.modelId}-${idx}`}
                          type="button"
                          onClick={() => {
                            onSelectModel(p.id, p.modelId);
                            setShowModelDropdown(false);
                          }}
                          className={`w-full text-left px-2 py-1.5 rounded-md flex items-center justify-between hover:bg-[#22252B] cursor-pointer text-xs transition-colors ${
                            isSel ? "text-[#4CC2DE] font-medium bg-[#22252B]" : "text-[#9AA1AC]"
                          }`}
                        >
                          <span className="truncate">{isSel ? `✓ ${p.label}` : p.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Model Selection Intelligence / Context Window Pre-Gating Suggestion */}
              {preflight?.recommendedModel?.modelId && !preflight.recommendedModel.isCurrentOptimal && (
                <button
                  type="button"
                  onClick={() => {
                    if (preflight.recommendedModel?.providerId && preflight.recommendedModel?.modelId) {
                      onSelectModel(preflight.recommendedModel.providerId, preflight.recommendedModel.modelId);
                    }
                  }}
                  className={`px-2 py-1 rounded-md border text-[11px] font-sans flex items-center gap-1.5 cursor-pointer transition-colors ${
                    preflight.recommendedModel.isContextExceeded
                      ? "border-[#D9A441]/50 bg-[#D9A441]/10 text-[#D9A441] hover:bg-[#D9A441]/20"
                      : "border-[#4CC2DE]/40 bg-[#4CC2DE]/10 text-[#4CC2DE] hover:bg-[#4CC2DE]/20"
                  }`}
                  title={`Click to switch: ${preflight.recommendedModel.reason}`}
                >
                  {preflight.recommendedModel.isContextExceeded ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-[#D9A441] shrink-0" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-[#4CC2DE] shrink-0" />
                  )}
                  <span>
                    {preflight.recommendedModel.isContextExceeded
                      ? `Context Limit Risk: Switch to ${preflight.recommendedModel.modelDisplayName || preflight.recommendedModel.modelId}`
                      : `Suggested: ${preflight.recommendedModel.modelDisplayName || preflight.recommendedModel.modelId}`}
                  </span>
                </button>
              )}

              {/* Unresolved Context Exceeded State (No larger compatible model configured) */}
              {preflight?.isContextExceeded && !preflight?.recommendedModel?.modelId && (
                <div
                  className="px-2 py-1 rounded-md border border-[#DC5B5B]/50 bg-[#DC5B5B]/10 text-[#DC5B5B] text-[11px] font-sans flex items-center gap-1.5"
                  title={preflight.recommendedModel?.reason || "Estimated context exceeds active model limit"}
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-[#DC5B5B] shrink-0" />
                  <span>Context Limit Risk (No larger configured model)</span>
                </div>
              )}

              {/* Multi-File Refactor Plan Trigger Button (High-Risk / Multi-File Only) */}
              {isRefactorCandidate && (
                <button
                  type="button"
                  onClick={handleOpenRefactorPlan}
                  className="px-2.5 py-1 rounded-md border border-[#22252B] bg-[#14161B] hover:bg-[#1A1C22] text-[#9AA1AC] hover:text-[#E6E8EB] text-[11px] font-sans flex items-center gap-1.5 cursor-pointer transition-colors font-medium"
                  title="Generate visual task DAG, scope boundaries, and step-by-step refactor plan"
                >
                  <GitMerge className="w-3.5 h-3.5 text-[#9AA1AC] shrink-0" />
                  <span>Plan Refactor</span>
                </button>
              )}
            </div>

            {/* Primary Action: Send / Start Task */}
            <button
              type="submit"
              disabled={!prompt.trim() || disabled}
              className="px-4 py-1.5 rounded-md bg-[#4CC2DE] hover:bg-[#38b2ce] active:bg-[#2fa3c0] disabled:opacity-40 disabled:cursor-not-allowed text-[#0A0B0D] text-xs font-medium font-sans transition-colors flex items-center gap-1.5 cursor-pointer shrink-0 shadow-none"
            >
              <span>Start Task</span>
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Contextual Notices (Quiet Precision: Healthy systems are silent; only render alerts/status) */}
          {(!isKeyConfigured || testVerificationStatus) && (
            <div className="flex items-center justify-between px-1 pt-2 border-t border-[#22252B] text-[11px] font-sans select-text">
              {!isKeyConfigured ? (
                <div className="flex items-center gap-1.5 text-[#D9A441]">
                  <AlertTriangle className="w-3.5 h-3.5 text-[#D9A441] shrink-0" />
                  <span>API Key not configured for {getProviderDisplayName(activeProvider)}</span>
                </div>
              ) : (
                <div />
              )}

              {/* Non-Blocking Test Verification & Autonomous Repair Status Badge */}
              {testVerificationStatus && (
                <div
                  className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-mono border animate-in fade-in duration-200"
                  style={{
                    backgroundColor:
                      testVerificationStatus.status === "PASSED"
                        ? "rgba(16, 185, 129, 0.1)"
                        : testVerificationStatus.status === "REPAIRING"
                        ? "rgba(234, 179, 8, 0.12)"
                        : testVerificationStatus.status === "VERIFYING"
                        ? "rgba(6, 182, 212, 0.1)"
                        : testVerificationStatus.status === "NO_TESTS_FOUND" ||
                          testVerificationStatus.status === "SKIPPED" ||
                          testVerificationStatus.status === "RUNNER_NOT_DETECTED" ||
                          testVerificationStatus.status === "TESTS_NOT_CONFIGURED"
                        ? "rgba(113, 113, 122, 0.15)"
                        : "rgba(239, 68, 68, 0.1)",
                    borderColor:
                      testVerificationStatus.status === "PASSED"
                        ? "rgba(16, 185, 129, 0.35)"
                        : testVerificationStatus.status === "REPAIRING"
                        ? "rgba(234, 179, 8, 0.4)"
                        : testVerificationStatus.status === "VERIFYING"
                        ? "rgba(6, 182, 212, 0.35)"
                        : testVerificationStatus.status === "NO_TESTS_FOUND" ||
                          testVerificationStatus.status === "SKIPPED" ||
                          testVerificationStatus.status === "RUNNER_NOT_DETECTED" ||
                          testVerificationStatus.status === "TESTS_NOT_CONFIGURED"
                        ? "rgba(113, 113, 122, 0.35)"
                        : "rgba(239, 68, 68, 0.35)",
                    color:
                      testVerificationStatus.status === "PASSED"
                        ? "#34d399"
                        : testVerificationStatus.status === "REPAIRING"
                        ? "#fde047"
                        : testVerificationStatus.status === "VERIFYING"
                        ? "#67e8f9"
                        : testVerificationStatus.status === "NO_TESTS_FOUND" ||
                          testVerificationStatus.status === "SKIPPED" ||
                          testVerificationStatus.status === "RUNNER_NOT_DETECTED" ||
                          testVerificationStatus.status === "TESTS_NOT_CONFIGURED"
                        ? "#a1a1aa"
                        : "#f87171",
                  }}
                >
                  {testVerificationStatus.status === "VERIFYING" && (
                    <Loader2 className="w-3 h-3 animate-spin text-cyan-400 shrink-0" />
                  )}
                  {testVerificationStatus.status === "PASSED" && (
                    <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  )}
                  {testVerificationStatus.status === "REPAIRING" && (
                    <RefreshCw className="w-3 h-3 animate-spin text-yellow-400 shrink-0" />
                  )}
                  {(testVerificationStatus.status === "NO_TESTS_FOUND" ||
                    testVerificationStatus.status === "SKIPPED" ||
                    testVerificationStatus.status === "RUNNER_NOT_DETECTED" ||
                    testVerificationStatus.status === "TESTS_NOT_CONFIGURED") && (
                    <Info className="w-3 h-3 text-zinc-400 shrink-0" />
                  )}
                  {testVerificationStatus.status !== "VERIFYING" &&
                    testVerificationStatus.status !== "PASSED" &&
                    testVerificationStatus.status !== "REPAIRING" &&
                    testVerificationStatus.status !== "NO_TESTS_FOUND" &&
                    testVerificationStatus.status !== "SKIPPED" &&
                    testVerificationStatus.status !== "RUNNER_NOT_DETECTED" &&
                    testVerificationStatus.status !== "TESTS_NOT_CONFIGURED" && (
                      <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
                    )}
                  <span>{testVerificationStatus.display || testVerificationStatus.badge || testVerificationStatus.status}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </form>

      {/* Interactive Multi-File Refactor Plan & Execution Reviewer Modal */}
      {showRefactorModal && refactorPlan && (
        <RefactorPlanModal
          isOpen={showRefactorModal}
          onClose={() => setShowRefactorModal(false)}
          plan={refactorPlan}
          onApproveAndExecute={handleApproveAndExecuteRefactor}
          onCancelPlan={handleCancelRefactorPlan}
          isExecuting={isRefactorExecuting}
        />
      )}
    </div>
  );
}
