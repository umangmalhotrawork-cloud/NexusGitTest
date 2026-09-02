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
          className="w-full px-3.5 py-2.5 rounded-xl border border-amber-500/50 shadow-2xl flex items-center justify-between gap-3 animate-fadeIn transition-all"
          style={{
            backgroundColor: "rgba(35, 22, 10, 0.95)",
            color: "#fef3c7",
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1 rounded-lg bg-amber-950/90 border border-amber-500/50 text-amber-400 shrink-0">
              <Zap className="w-3.5 h-3.5 animate-pulse" />
            </div>
            <div className="text-xs font-mono min-w-0 flex items-center gap-1.5 flex-wrap">
              <span className="text-amber-300 font-bold">⚡ Auto-Failover:</span>
              <span className="text-zinc-300">{getProviderDisplayName(failoverNotice.primaryProviderId)} ({failoverNotice.reason})</span>
              <span className="text-amber-400 font-bold">──►</span>
              <span className="text-emerald-300 font-semibold">{failoverNotice.fallbackDisplayName}</span>
              <span className="text-zinc-400 text-[10.5px]">(Zero data lost)</span>
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

      {/* 1. Context Row: Workspace -> Local -> Branch -> CONTINUUM -> IMPORT CAPSULE */}
      <div className="flex items-center gap-2 text-xs font-mono" style={{ color: "var(--theme-text-muted, #a1a1aa)" }}>
        {/* Workspace Pill */}
        <button
          onClick={onOpenFolder}
          style={{
            backgroundColor: "var(--theme-surface-raised, #0e0e16)",
            borderColor: "var(--theme-border, #1e1e2c)",
            color: "var(--theme-text, #f4f4f5)",
          }}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-colors cursor-pointer text-[11px]"
        >
          <FolderOpen className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span className="font-bold truncate max-w-[140px]">{workspaceName}</span>
        </button>

        {/* Environment Pill */}
        <div 
          style={{
            backgroundColor: "var(--theme-surface-raised, #0e0e16)",
            borderColor: "var(--theme-border, #1e1e2c)",
            color: "var(--theme-text-muted, #a1a1aa)",
          }}
          className="flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px]"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span>Local</span>
        </div>

        {/* Branch Pill */}
        <div 
          style={{
            backgroundColor: "var(--theme-surface-raised, #0e0e16)",
            borderColor: "var(--theme-border, #1e1e2c)",
            color: "var(--theme-accent-secondary, #a855f7)",
          }}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px]"
        >
          <GitBranch className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--theme-accent-secondary, #a855f7)" }} />
          <span className="font-bold truncate max-w-[150px]">{gitBranch}</span>
        </div>

        {/* CONTINUUM Pill — IMMEDIATELY TO THE RIGHT OF THE BRANCH! */}
        <button
          onClick={onOpenContinuum}
          style={{
            backgroundColor: "var(--theme-accent-dim, rgba(34,211,238,0.15))",
            borderColor: "var(--theme-border-focus, rgba(34,211,238,0.4))",
            color: "var(--theme-accent, #22d3ee)",
          }}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-bold transition-all cursor-pointer text-[11px] shadow-sm hover:brightness-125"
          title="Open Continuum Session Memory & Lineage"
        >
          <Layers className="w-3.5 h-3.5 text-cyan-400 shrink-0 animate-pulse" />
          <span>Continuum</span>
        </button>

        {/* Import Context Capsule Pill */}
        {onImportCapsule && (
          <button
            type="button"
            onClick={onImportCapsule}
            style={{
              backgroundColor: "var(--theme-surface-raised, #0e0e16)",
              borderColor: "var(--theme-border, #1e1e2c)",
              color: "var(--theme-accent, #22d3ee)",
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-bold transition-all cursor-pointer text-[11px] shadow-sm hover:border-cyan-500/40 hover:bg-cyan-950/40"
            title="Import Context Capsule to continue previous conversation"
          >
            <Upload className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span>Import Capsule</span>
          </button>
        )}
      </div>

      {/* 2. Codex Agent Composer Container */}
      <form onSubmit={handleSubmit} className="w-full">
        <div 
          style={{
            backgroundColor: "var(--theme-surface-panel, #0b0b12)",
            borderColor: "var(--theme-border-card, #222234)",
          }}
          className="border focus-within:border-cyan-500/60 rounded-2xl p-3.5 shadow-2xl transition-all relative space-y-2"
        >
          {/* Subtle Capsule Attachment Badge */}
          {attachedCapsule && (
            <div className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-cyan-950/40 border border-cyan-500/30 text-[10px] text-cyan-300 font-mono animate-fadeIn">
              <div className="flex items-center gap-2 min-w-0 truncate">
                <Box className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="px-1.5 py-0.5 rounded bg-cyan-900/80 border border-cyan-400/40 text-cyan-200 font-bold tracking-wider shrink-0">
                  {`Context Capsule ${attachedCapsule.capsule_ref || (attachedCapsule.capsule_id ? `#CC${attachedCapsule.capsule_id.slice(-6).toUpperCase()}` : "#CC")}`}
                </span>
                <span className="font-bold text-zinc-200 truncate">Continuation context prepared</span>
              </div>
              <span className="text-[9.5px] text-emerald-400 flex items-center gap-1 font-bold shrink-0 ml-2">
                <Check className="w-3 h-3 text-emerald-400" />
                Ready to continue
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
                } else if (!e.shiftKey && !attachedCapsule && !prompt.includes("\n")) {
                  e.preventDefault();
                  handleSubmit();
                }
              }
            }}
            placeholder="Ask NEXUS to investigate or change code... (⌘Enter to send)"
            disabled={disabled}
            style={{ color: "var(--theme-text, #f4f4f5)" }}
            className={`w-full bg-transparent text-xs placeholder-zinc-500 focus:outline-none resize-none font-mono transition-all ${
              attachedCapsule || prompt.length > 200 || prompt.includes("\n") ? "h-48" : "h-20"
            }`}
          />

          {/* Bottom Control Row */}
          <div 
            style={{ borderColor: "var(--theme-border-subtle, #1a1a28)" }}
            className="flex items-center justify-between pt-2 border-t text-xs"
          >
            <div className="flex items-center gap-2 relative">
              {/* Attachment / Action Button */}
              <button
                type="button"
                style={{
                  backgroundColor: "var(--theme-surface-raised, #141420)",
                  borderColor: "var(--theme-border-card, #242436)",
                }}
                className="w-7 h-7 rounded-lg border flex items-center justify-center text-zinc-400 hover:text-cyan-300 transition-colors cursor-pointer"
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
                  style={{
                    backgroundColor: "var(--theme-surface-raised, #141420)",
                    borderColor: "var(--theme-border-card, #242436)",
                    color: "var(--theme-text, #f4f4f5)",
                  }}
                  className="px-2.5 py-1 rounded-lg border text-[11px] font-mono flex items-center gap-1.5 cursor-pointer"
                >
                  <ShieldCheck className={`w-3.5 h-3.5 ${approvalMode === "auto" ? "text-emerald-400" : "text-amber-400"}`} />
                  <span>{approvalMode === "auto" ? "Auto-Approve Safe" : "Require Approval"}</span>
                  <ChevronDown className="w-3 h-3 text-zinc-500" />
                </button>

                {showApprovalDropdown && (
                  <div 
                    ref={approvalDropdownRef}
                    style={{
                      backgroundColor: "var(--theme-surface-card, #0c0c14)",
                      borderColor: "var(--theme-border-card, #242436)",
                    }}
                    className="absolute left-0 bottom-9 w-48 border rounded-xl shadow-2xl z-50 p-1 space-y-1 text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setApprovalMode("auto");
                        setShowApprovalDropdown(false);
                      }}
                      className="w-full text-left px-2 py-1.5 rounded-lg flex items-center justify-between hover:bg-white/5 text-emerald-300 cursor-pointer"
                    >
                      <span>Auto-Approve Safe</span>
                      {approvalMode === "auto" && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setApprovalMode("strict");
                        setShowApprovalDropdown(false);
                      }}
                      className="w-full text-left px-2 py-1.5 rounded-lg flex items-center justify-between hover:bg-white/5 text-amber-300 cursor-pointer"
                    >
                      <span>Require Approval</span>
                      {approvalMode === "strict" && <Check className="w-3.5 h-3.5 text-amber-400" />}
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
                  style={{
                    backgroundColor: "var(--theme-surface-raised, #141420)",
                    borderColor: "var(--theme-border-card, #242436)",
                    color: "var(--theme-accent, #22d3ee)",
                  }}
                  className="px-2.5 py-1 rounded-lg border text-[11px] font-mono flex items-center gap-1.5 cursor-pointer max-w-[180px]"
                >
                  <Cpu className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                  <span className="truncate capitalize">
                    {activeProvider.startsWith("nexus") 
                      ? (activeProvider === "nexus6" ? "NEXUS 6 (Groq)" : `NEXUS ${activeProvider.replace("nexus", "")} (Gemini)`) 
                      : `${activeProvider} (${activeModel.split('/').pop()?.replace(/^models\//, '') || activeModel})`}
                  </span>
                  <ChevronDown className="w-3 h-3 text-zinc-500 shrink-0" />
                </button>

                {showModelDropdown && (
                  <div 
                    ref={modelDropdownRef}
                    style={{
                      backgroundColor: "var(--theme-surface-card, #0c0c14)",
                      borderColor: "var(--theme-border-card, #242436)",
                    }}
                    className="absolute left-0 bottom-9 w-64 border rounded-xl shadow-2xl z-50 p-1.5 space-y-1 text-xs max-h-56 overflow-y-auto"
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
                          className={`w-full text-left px-2 py-1.5 rounded-lg flex items-center justify-between hover:bg-white/5 cursor-pointer text-xs ${
                            isSel ? "text-cyan-300 font-bold bg-cyan-950/40" : "text-zinc-400"
                          }`}
                        >
                          <span className="truncate">{isSel ? `✓ ${p.label}` : p.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Preflight Cost & Context Indicator (Phase 2 - Non-blocking) */}
              {preflight && preflight.estimatedInputTokens > 0 && (
                <div className="relative">
                  <button
                    ref={preflightTriggerRef}
                    type="button"
                    onClick={() => setShowPreflightPopover((prev) => !prev)}
                    style={{
                      backgroundColor: "var(--theme-surface-raised, #141420)",
                      borderColor:
                        preflight.budgetStatus?.level === "CRITICAL"
                          ? "rgba(239, 68, 68, 0.4)"
                          : preflight.budgetStatus?.level === "APPROACHING"
                          ? "rgba(245, 158, 11, 0.4)"
                          : "var(--theme-border-card, #242436)",
                      color:
                        preflight.budgetStatus?.level === "CRITICAL"
                          ? "#f87171"
                          : preflight.budgetStatus?.level === "APPROACHING"
                          ? "#fbbf24"
                          : "var(--theme-text-muted, #a1a1aa)",
                    }}
                    className="px-2 py-1 rounded-lg border text-[10.5px] font-mono flex items-center gap-1.5 cursor-pointer hover:border-cyan-500/40 transition-all"
                    title="Click for Preflight Token & Cost Details"
                  >
                    <Coins className="w-3 h-3 text-cyan-400 shrink-0" />
                    <span>
                      {preflight.estimatedInputTokens >= 1000
                        ? `~${(preflight.estimatedInputTokens / 1000).toFixed(1)}k tokens`
                        : `~${preflight.estimatedInputTokens} tokens`}
                    </span>
                    {preflight.pricingAvailable && preflight.estimatedCostUSD !== null && (
                      <>
                        <span className="text-zinc-600">•</span>
                        <span className="text-emerald-400 font-semibold">
                          {`~$${preflight.estimatedCostUSD.toFixed(preflight.estimatedCostUSD < 0.01 ? 4 : 2)}`}
                        </span>
                      </>
                    )}
                  </button>

                  {showPreflightPopover && (
                    <div
                      ref={preflightPopoverRef}
                      style={{
                        backgroundColor: "var(--theme-surface-card, #0c0c14)",
                        borderColor: "var(--theme-border-card, #242436)",
                      }}
                      className="absolute left-0 bottom-9 w-60 border rounded-xl shadow-2xl z-50 p-2.5 space-y-2 text-xs font-mono animate-fadeIn"
                    >
                      <div className="flex items-center justify-between border-b border-white/5 pb-1.5">
                        <span className="text-[11px] font-bold text-zinc-200 flex items-center gap-1">
                          <Coins className="w-3.5 h-3.5 text-cyan-400" />
                          Preflight Estimate
                        </span>
                        <span
                          className={`text-[9.5px] px-1.5 py-0.5 rounded font-bold ${
                            preflight.budgetStatus?.level === "CRITICAL"
                              ? "bg-red-950/80 text-red-300 border border-red-500/30"
                              : preflight.budgetStatus?.level === "APPROACHING"
                              ? "bg-amber-950/80 text-amber-300 border border-amber-500/30"
                              : "bg-emerald-950/80 text-emerald-300 border border-emerald-500/30"
                          }`}
                        >
                          {preflight.budgetStatus?.level || "NORMAL"}
                        </span>
                      </div>

                      <div className="space-y-1 text-[11px] text-zinc-300">
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Estimated input:</span>
                          <span className="font-semibold text-zinc-200">
                            {preflight.estimatedInputTokens.toLocaleString()} tokens
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Max output:</span>
                          <span className="font-semibold text-zinc-200">
                            {preflight.estimatedMaxOutputTokens.toLocaleString()} tokens
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Files:</span>
                          <span className="font-semibold text-zinc-200">
                            {preflight.estimatedFiles?.count || 1}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Tool calls:</span>
                          <span className="font-semibold text-zinc-200">
                            {preflight.estimatedToolCalls?.min === 0
                              ? "0"
                              : `${preflight.estimatedToolCalls?.min}–${preflight.estimatedToolCalls?.max}`}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">Context window:</span>
                          <span
                            className={`font-semibold ${
                              preflight.isContextExceeded
                                ? "text-amber-400 font-bold"
                                : "text-zinc-300"
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
                        <div className="flex justify-between pt-1 border-t border-white/5">
                          <span className="text-zinc-500">Estimated cost:</span>
                          <span className="font-bold text-emerald-400">
                            {preflight.pricingAvailable && preflight.estimatedCostUSD !== null
                              ? `$${preflight.estimatedCostUSD.toFixed(preflight.estimatedCostUSD < 0.01 ? 4 : 2)}`
                              : "N/A"}
                          </span>
                        </div>

                        {preflight.recommendedModel?.modelId && (
                          <div className="pt-1.5 border-t border-white/5 space-y-0.5">
                            <div className="flex items-center justify-between text-[10.5px]">
                              <span className="text-zinc-500 flex items-center gap-1">
                                {preflight.recommendedModel.isContextExceeded ? (
                                  <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                                ) : (
                                  <Sparkles className="w-3 h-3 text-cyan-400 shrink-0" />
                                )}
                                Advisor:
                              </span>
                              <span className={`font-semibold truncate max-w-[125px] ${preflight.recommendedModel.isContextExceeded ? "text-amber-300" : "text-cyan-300"}`}>
                                {preflight.recommendedModel.modelDisplayName || preflight.recommendedModel.modelId}
                              </span>
                            </div>
                            <div className={`text-[9.5px] leading-tight ${preflight.recommendedModel.isContextExceeded ? "text-amber-300/90" : "text-zinc-400"}`}>
                              {preflight.recommendedModel.reason}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="text-[9px] text-zinc-600 pt-0.5 text-center">
                        Deterministic preflight • Zero AI calls
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Model Selection Intelligence / Context Window Pre-Gating Suggestion */}
              {preflight?.recommendedModel?.modelId && !preflight.recommendedModel.isCurrentOptimal && (
                <button
                  type="button"
                  onClick={() => {
                    if (preflight.recommendedModel?.providerId && preflight.recommendedModel?.modelId) {
                      onSelectModel(preflight.recommendedModel.providerId, preflight.recommendedModel.modelId);
                    }
                  }}
                  style={{
                    backgroundColor: preflight.recommendedModel.isContextExceeded
                      ? "rgba(245, 158, 11, 0.12)"
                      : "rgba(6, 182, 212, 0.08)",
                    borderColor: preflight.recommendedModel.isContextExceeded
                      ? "rgba(245, 158, 11, 0.45)"
                      : "rgba(6, 182, 212, 0.3)",
                    color: preflight.recommendedModel.isContextExceeded
                      ? "#fbbf24"
                      : "#67e8f9",
                  }}
                  className="px-2 py-1 rounded-lg border text-[10.5px] font-mono flex items-center gap-1.5 cursor-pointer hover:brightness-125 transition-all"
                  title={`Click to switch: ${preflight.recommendedModel.reason}`}
                >
                  {preflight.recommendedModel.isContextExceeded ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  ) : (
                    <Sparkles className="w-3 h-3 text-cyan-400 shrink-0" />
                  )}
                  <span>
                    {preflight.recommendedModel.isContextExceeded
                      ? `⚠️ Context Limit Risk: Switch to ${preflight.recommendedModel.modelDisplayName || preflight.recommendedModel.modelId}`
                      : `Suggested: ${preflight.recommendedModel.modelDisplayName || preflight.recommendedModel.modelId}`}
                  </span>
                </button>
              )}

              {/* Unresolved Context Exceeded State (No larger compatible model configured) */}
              {preflight?.isContextExceeded && !preflight?.recommendedModel?.modelId && (
                <div
                  style={{
                    backgroundColor: "rgba(239, 68, 68, 0.12)",
                    borderColor: "rgba(239, 68, 68, 0.4)",
                    color: "#f87171",
                  }}
                  className="px-2 py-1 rounded-lg border text-[10.5px] font-mono flex items-center gap-1.5"
                  title={preflight.recommendedModel?.reason || "Estimated context exceeds active model limit"}
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                  <span>⚠️ Context Limit Risk (No larger configured model)</span>
                </div>
              )}

              {/* Multi-File Refactor Plan Trigger Button (High-Risk / Multi-File Only) */}
              {isRefactorCandidate && (
                <button
                  type="button"
                  onClick={handleOpenRefactorPlan}
                  style={{
                    backgroundColor: "rgba(168, 85, 247, 0.12)",
                    borderColor: "rgba(168, 85, 247, 0.35)",
                    color: "#d8b4fe",
                  }}
                  className="px-2.5 py-1 rounded-lg border text-[10.5px] font-mono flex items-center gap-1.5 cursor-pointer hover:bg-purple-950/50 hover:border-purple-400 transition-all font-medium"
                  title="Generate visual task DAG, scope boundaries, and step-by-step refactor plan"
                >
                  <GitMerge className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                  <span>Plan Refactor</span>
                </button>
              )}
            </div>


            {/* Send Button */}
            <button
              type="submit"
              disabled={!prompt.trim() || disabled}
              style={{
                backgroundColor: "var(--theme-accent, #06b6d4)",
                color: "#ffffff",
              }}
              className="px-4 py-1.5 rounded-xl hover:brightness-110 disabled:opacity-40 text-xs font-bold font-mono transition-all flex items-center gap-1.5 shadow-md cursor-pointer"
            >
              <span>Start Task</span>
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Compact API Usage & Credential Status Area */}
          <div
            style={{ borderColor: "var(--theme-border-subtle, #1a1a28)" }}
            className="flex items-center justify-between px-1 pt-2 border-t text-[10.5px] font-mono text-zinc-400 select-text"
          >
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1">
                <span className="text-zinc-500">Provider:</span>
                <span className="text-zinc-200 font-semibold">{getProviderDisplayName(activeProvider)}</span>
              </div>
              <span className="text-zinc-700">•</span>
              <div className="flex items-center gap-1">
                <span className="text-zinc-500">Credential:</span>
                <span className={isKeyConfigured ? "text-emerald-400 font-semibold" : "text-zinc-500"}>
                  {isKeyConfigured ? "Configured ✓" : "Not configured"}
                </span>
              </div>
              <span className="text-zinc-700">•</span>
              <div className="flex items-center gap-1">
                <span className="text-zinc-500">Account usage:</span>
                <span className={verifiedUsage?.isAvailable ? "text-cyan-400 font-semibold" : "text-zinc-500"}>
                  {verifiedUsage?.display || "Not available"}
                </span>
              </div>
            </div>

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
                        testVerificationStatus.status === "RUNNER_NOT_DETECTED"
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
                        testVerificationStatus.status === "RUNNER_NOT_DETECTED"
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
                        testVerificationStatus.status === "RUNNER_NOT_DETECTED"
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
                  testVerificationStatus.status === "RUNNER_NOT_DETECTED") && (
                  <Info className="w-3 h-3 text-zinc-400 shrink-0" />
                )}
                {testVerificationStatus.status !== "VERIFYING" &&
                  testVerificationStatus.status !== "PASSED" &&
                  testVerificationStatus.status !== "REPAIRING" &&
                  testVerificationStatus.status !== "NO_TESTS_FOUND" &&
                  testVerificationStatus.status !== "SKIPPED" &&
                  testVerificationStatus.status !== "RUNNER_NOT_DETECTED" && (
                    <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
                  )}
                <span>{testVerificationStatus.display || testVerificationStatus.badge || testVerificationStatus.status}</span>
              </div>
            )}
          </div>
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
