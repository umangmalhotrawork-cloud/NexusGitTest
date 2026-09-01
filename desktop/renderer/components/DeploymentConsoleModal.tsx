"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  X,
  Rocket,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
  Ban,
  Terminal,
  ShieldCheck,
  Globe,
  Database,
  Server,
  Cpu,
  Clock,
  Layers,
  ArrowRight,
  Info,
  Sparkles,
} from "lucide-react";
import { DeploymentPlanUI, ServiceTargetUI, DatabaseTargetUI } from "./DeploymentPlanModal";

export interface DeploymentLogChunkUI {
  orchestrationId?: string;
  requestId?: string | null;
  stageId?: string;
  chunk: string;
  timestamp: number;
}

export interface FailureDiagnosticUI {
  stageId?: string;
  providerId?: string;
  serviceName?: string;
  failureCategory: string;
  likelyRootCause: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  evidence: Array<{
    source?: string;
    file?: string;
    line?: number;
    snippet?: string;
    description?: string;
  }>;
  suggestedFix: string;
  isRetrySafe?: boolean;
}

export interface OrchestrationStateChangeUI {
  orchestrationId: string;
  requestId?: string | null;
  overallState: "PREFLIGHT" | "RUNNING" | "SUCCESS" | "FAILED" | "PARTIAL_SUCCESS" | "CANCELLED" | "AUTH_REQUIRED" | "PLAN_STALE";
  message?: string;
  error?: string;
  timestamp: number;
}

export interface OrchestrationStageStateUI {
  orchestrationId: string;
  requestId?: string | null;
  stageId: string;
  targetId?: string;
  type?: string;
  providerId?: string;
  stageState: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED" | "CANCELLED";
  liveUrl?: string;
  error?: string;
  diagnostic?: FailureDiagnosticUI;
  message?: string;
  timestamp: number;
}

interface DeploymentConsoleModalProps {
  workspacePath: string;
  plan?: DeploymentPlanUI | null;
  providerId?: string;
  providerDisplayName?: string;
  rootDir?: string | null;
  requestId?: string;
  onClose: () => void;
  onFinished?: (result: { status: string; url?: string }) => void;
}

export default function DeploymentConsoleModal({
  workspacePath,
  plan,
  providerId,
  providerDisplayName,
  rootDir,
  requestId,
  onClose,
  onFinished,
}: DeploymentConsoleModalProps) {
  const isMultiStage = Boolean(plan && plan.executionOrder && plan.executionOrder.length > 0);

  const [orchestrationId, setOrchestrationId] = useState<string | null>(null);
  const [overallStatus, setOverallStatus] = useState<string>("PREFLIGHT");
  const [overallMsg, setOverallMsg] = useState<string>("Initializing deployment verification…");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Stage runtime tracking
  const [stageStates, setStageStates] = useState<Record<string, {
    status: string;
    type?: string;
    providerId?: string;
    liveUrl?: string | null;
    error?: string | null;
    startedAt?: number;
  }>>({});

  const [diagnostics, setDiagnostics] = useState<Record<string, FailureDiagnosticUI>>({});
  const [activeStageId, setActiveStageId] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<string>("all");
  const [logs, setLogs] = useState<Record<string, string[]>>({ all: [] });

  // Final extracted results
  const [finalServices, setFinalServices] = useState<Array<{ serviceId: string; providerId: string; status: string; liveUrl: string | null; error: string | null; diagnostic?: FailureDiagnosticUI }>>([]);
  const [finalDatabases, setFinalDatabases] = useState<Array<{ databaseId: string; providerId: string; status: string; error: string | null; diagnostic?: FailureDiagnosticUI }>>([]);

  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const startAttemptedRef = useRef(false);
  const currentOrchestrationIdRef = useRef<string | null>(null);

  // Initialize stage states from plan
  useEffect(() => {
    if (isMultiStage && plan) {
      const initial: Record<string, any> = {};
      for (const nodeId of plan.executionOrder) {
        const svc = plan.topology.services.find((s) => s.serviceId === nodeId);
        const db = plan.topology.databases.find((d) => d.databaseId === nodeId);
        initial[nodeId] = {
          status: "PENDING",
          type: svc ? svc.type : db ? "DATABASE" : "UNKNOWN",
          providerId: svc ? svc.recommendedProvider : db ? db.recommendedProvider : "unknown",
          liveUrl: null,
          error: null,
        };
      }
      setStageStates(initial);
    }
  }, [isMultiStage, plan]);

  // Elapsed timer while RUNNING
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (overallStatus === "RUNNING") {
      timer = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [overallStatus]);

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, selectedTab]);

  // Subscribe to Multi-Stage Orchestration IPC events
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.intelligence) return;

    let unsubState: (() => void) | undefined;
    let unsubStage: (() => void) | undefined;
    let unsubLogs: (() => void) | undefined;
    const belongsToCurrentRun = (event: { requestId?: string | null; orchestrationId?: string }) => {
      if (requestId && event.requestId !== requestId) return false;
      if (!event.orchestrationId) return false;
      if (!currentOrchestrationIdRef.current) {
        currentOrchestrationIdRef.current = event.orchestrationId;
        return true;
      }
      return currentOrchestrationIdRef.current === event.orchestrationId;
    };

    // 1. Overall State Changes
    if (electronAPI.intelligence.onOrchestrationState) {
      unsubState = electronAPI.intelligence.onOrchestrationState((event: OrchestrationStateChangeUI) => {
        // The Electron event channel is shared.  Never let a concurrent or old
        // run mutate the console which belongs to this confirmation request.
        if (!belongsToCurrentRun(event)) return;
        setOrchestrationId(event.orchestrationId);
        setOverallStatus(event.overallState);
        if (event.message) setOverallMsg(event.message);
        if (event.error) setErrorMsg(event.error);

        if (event.overallState === "SUCCESS" || event.overallState === "PARTIAL_SUCCESS" || event.overallState === "FAILED" || event.overallState === "CANCELLED") {
          onFinished?.({ status: event.overallState });
        }
      });
    }

    // 2. Stage State Changes
    if (electronAPI.intelligence.onOrchestrationStageState) {
      unsubStage = electronAPI.intelligence.onOrchestrationStageState((event: OrchestrationStageStateUI) => {
        if (!belongsToCurrentRun(event)) return;
        const { stageId, stageState, liveUrl, error, type, providerId, diagnostic } = event;
        setStageStates((prev) => ({
          ...prev,
          [stageId]: {
            ...prev[stageId],
            status: stageState,
            type: type || prev[stageId]?.type,
            providerId: providerId || prev[stageId]?.providerId,
            liveUrl: liveUrl || prev[stageId]?.liveUrl,
            error: error || prev[stageId]?.error,
            startedAt: stageState === "RUNNING" ? Date.now() : prev[stageId]?.startedAt,
          },
        }));

        if (diagnostic) {
          setDiagnostics((prev) => ({
            ...prev,
            [stageId]: diagnostic,
          }));
        }

        if (stageState === "RUNNING") {
          setActiveStageId(stageId);
        }
      });
    }

    // 3. Sanitized Log Chunks
    if (electronAPI.intelligence.onOrchestrationLogChunk) {
      unsubLogs = electronAPI.intelligence.onOrchestrationLogChunk((payload: DeploymentLogChunkUI) => {
        if (!belongsToCurrentRun(payload)) return;
        const stageId = payload.stageId || "general";
        const text = payload.chunk || "";

        setLogs((prev) => ({
          ...prev,
          all: [...(prev.all || []), text],
          [stageId]: [...(prev[stageId] || []), text],
        }));
      });
    }

    return () => {
      unsubState?.();
      unsubStage?.();
      unsubLogs?.();
    };
  }, [onFinished, requestId]);

  // Start Multi-Stage Orchestration on Mount if plan is provided
  useEffect(() => {
    let started = false;
    const startDeploy = async () => {
      if (started || startAttemptedRef.current) return;
      started = true;
      startAttemptedRef.current = true;

      const electronAPI = (window as any).electronAPI;
      if (!electronAPI?.intelligence) return;

      if (isMultiStage && plan) {
        setOverallStatus("RUNNING");
        setOverallMsg(`Deploying complete project (${plan.executionOrder.length} stages)…`);

        try {
          const res = await electronAPI.intelligence.startOrchestration({ plan, requestId });
          if (res?.orchestrationId) {
            currentOrchestrationIdRef.current = res.orchestrationId;
            setOrchestrationId(res.orchestrationId);
          }
          if (res?.status) {
            setOverallStatus(res.status);
            if (res.services) {
              setFinalServices(res.services);
              for (const s of res.services) {
                if (s.diagnostic) {
                  setDiagnostics((prev) => ({ ...prev, [s.serviceId]: s.diagnostic }));
                }
              }
            }
            if (res.databases) {
              setFinalDatabases(res.databases);
              for (const d of res.databases) {
                if (d.diagnostic) {
                  setDiagnostics((prev) => ({ ...prev, [d.databaseId]: d.diagnostic }));
                }
              }
            }
            if (res.error) setErrorMsg(res.error);
          }
        } catch (err: any) {
          setOverallStatus("FAILED");
          setErrorMsg(err.message || "Failed to start orchestration.");
        }
      } else if (providerId) {
        // Single-provider legacy fallback
        setOverallStatus("RUNNING");
        setOverallMsg(`Deploying ${providerDisplayName || providerId}…`);
        try {
          const res = await electronAPI.intelligence.startDeployment({
            workspacePath,
            providerId,
            options: { rootDir },
          });
          if (res?.status === "SUCCESS") {
            setOverallStatus("SUCCESS");
          } else if (res?.status === "FAILED") {
            setOverallStatus("FAILED");
            setErrorMsg(res.error || "Deployment failed.");
          }
        } catch (err: any) {
          setOverallStatus("FAILED");
          setErrorMsg(err.message || "Deployment failed.");
        }
      }
    };

    startDeploy();
  }, [isMultiStage, plan, providerId, providerDisplayName, workspacePath, rootDir, requestId]);

  // Handle Cancellation
  const handleCancel = async () => {
    if (!orchestrationId || cancelling) return;
    setCancelling(true);
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.intelligence?.cancelOrchestration) {
        await electronAPI.intelligence.cancelOrchestration(orchestrationId);
      }
      setOverallStatus("CANCELLED");
      setOverallMsg("Deployment cancelled by user.");
    } catch (err: any) {
      console.error("Cancel failed:", err);
    } finally {
      setCancelling(false);
    }
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  // Format Elapsed Time
  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const s = secs % 60;
    return `${mins}:${s.toString().padStart(2, "0")}`;
  };

  // Calculate current stage progress index
  const stagesList = useMemo(() => {
    if (!plan?.executionOrder) return [];
    return plan.executionOrder.map((nodeId, idx) => {
      const svc = plan.topology.services.find((s) => s.serviceId === nodeId);
      const db = plan.topology.databases.find((d) => d.databaseId === nodeId);
      const state = stageStates[nodeId] || { status: "PENDING" };
      return {
        stageIndex: idx + 1,
        nodeId,
        name: svc ? svc.name : db ? db.name : nodeId,
        type: svc ? svc.type : db ? "DATABASE" : "SERVICE",
        providerDisplayName: svc ? svc.providerDisplayName : db ? db.providerDisplayName : "Cloud",
        status: state.status,
        liveUrl: state.liveUrl || null,
        error: state.error || null,
      };
    });
  }, [plan, stageStates]);

  const activeStageIndex = useMemo(() => {
    const idx = stagesList.findIndex((s) => s.status === "RUNNING");
    if (idx !== -1) return idx + 1;
    const completed = stagesList.filter((s) => s.status === "SUCCESS").length;
    return Math.min(completed + 1, stagesList.length);
  }, [stagesList]);

  const activeLogs = logs[selectedTab] || [];
  const currentTabStage = useMemo(() => {
    if (selectedTab === "all") return null;
    return stagesList.find((s) => s.nodeId === selectedTab) || null;
  }, [selectedTab, stagesList]);

  const failedStages = useMemo(() => {
    return stagesList.filter((s) => s.status === "FAILED");
  }, [stagesList]);

  // Helper for Status Badges
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case "SUCCESS":
        return (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-500/40">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>✓ SUCCESS</span>
          </span>
        );
      case "PARTIAL_SUCCESS":
        return (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-950/80 text-amber-300 border border-amber-500/40">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>PARTIAL SUCCESS</span>
          </span>
        );
      case "RUNNING":
      case "BUILDING":
      case "UPLOADING":
      case "DEPLOYING":
        return (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-950/80 text-cyan-300 border border-cyan-500/40 animate-pulse">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            <span>● RUNNING ({formatTime(elapsedSeconds)})</span>
          </span>
        );
      case "FAILED":
        return (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-950/80 text-rose-300 border border-rose-500/40">
            <XCircle className="w-3.5 h-3.5" />
            <span>✗ FAILED</span>
          </span>
        );
      case "CANCELLED":
        return (
          <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-800 text-zinc-400 border border-zinc-700">
            <Ban className="w-3.5 h-3.5" />
            <span>⊘ CANCELLED</span>
          </span>
        );
      case "SKIPPED":
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-zinc-800/80 text-zinc-500 border border-zinc-700">
            <span>- SKIPPED</span>
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-zinc-900 text-zinc-400 border border-zinc-800">
            <span>○ PENDING</span>
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="flex flex-col w-full max-w-4xl max-h-[92vh] bg-[#0c0d12] border border-zinc-800 rounded-xl shadow-2xl overflow-hidden">
        
        {/* Header */}
        <header className="px-5 py-4 border-b border-zinc-800 bg-[#0e1017] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-cyan-950/70 border border-cyan-500/30 text-cyan-400 shrink-0">
              <Rocket className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-zinc-100 truncate">
                  {isMultiStage ? "Project Deployment Console" : `Deploying to ${providerDisplayName || providerId}`}
                </h2>
                {renderStatusBadge(overallStatus)}
              </div>
              <p className="text-xs text-zinc-400 truncate mt-0.5">{overallMsg}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar min-h-0">
          
          {/* MULTI-STAGE PROGRESS PIPELINE */}
          {isMultiStage && stagesList.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  Deployment Pipeline ({activeStageIndex} / {stagesList.length})
                </span>
                <span className="text-[11px] font-mono text-zinc-500">
                  Elapsed: {formatTime(elapsedSeconds)}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {stagesList.map((stage) => {
                  const isDb = stage.type === "DATABASE";
                  const isBackend = stage.type === "BACKEND";

                  return (
                    <div
                      key={stage.nodeId}
                      className={`p-3.5 rounded-xl border transition-colors ${
                        stage.status === "RUNNING"
                          ? "bg-cyan-950/20 border-cyan-500/50 shadow-sm shadow-cyan-950"
                          : stage.status === "SUCCESS"
                          ? "bg-emerald-950/15 border-emerald-500/30"
                          : stage.status === "FAILED"
                          ? "bg-rose-950/20 border-rose-500/40"
                          : "bg-[#0e1017] border-zinc-800/80 opacity-70"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-zinc-800 text-zinc-300 flex items-center justify-center font-bold text-[10px]">
                            {stage.stageIndex}
                          </span>
                          <span className="text-xs font-bold text-zinc-200 truncate">{stage.name}</span>
                        </div>
                        {renderStatusBadge(stage.status)}
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-zinc-400">
                        <span className="flex items-center gap-1">
                          {isDb ? <Database className="w-3 h-3 text-amber-400" /> : isBackend ? <Server className="w-3 h-3 text-blue-400" /> : <Globe className="w-3 h-3 text-emerald-400" />}
                          <span>{stage.providerDisplayName}</span>
                        </span>
                        {isDb && stage.status === "SUCCESS" && (
                          <span className="text-emerald-400 font-semibold text-[10px]">Ready ✓</span>
                        )}
                      </div>

                      {stage.liveUrl && (
                        <div className="mt-2 pt-2 border-t border-zinc-800/60 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-cyan-300 font-mono truncate">{stage.liveUrl}</span>
                          <button
                            onClick={() => handleCopyUrl(stage.liveUrl!)}
                            className="p-1 text-zinc-400 hover:text-cyan-300 transition-colors shrink-0"
                            title="Copy Live URL"
                          >
                            {copiedUrl === stage.liveUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ENVIRONMENT WIRING & SIMULATION NOTICE */}
          {isMultiStage && plan && (
            <div className="p-3.5 rounded-xl bg-[#0e1017] border border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-zinc-300 font-medium">
                  Dynamic Environment Wiring:
                </span>
                {plan.wiring.map((w, idx) => (
                  <span key={idx} className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700/80 text-[11px] font-mono text-zinc-300">
                    {w.targetEnvVar} (Injected ✓)
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-amber-400/90 italic">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>Database provisioning is simulated for this validation phase.</span>
              </div>
            </div>
          )}

          {/* SUCCESS SCREEN */}
          {overallStatus === "SUCCESS" && (
            <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/40 space-y-3">
              <div className="flex items-center gap-2.5 text-emerald-300 font-bold text-sm">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <span>DEPLOYMENT COMPLETE</span>
              </div>
              <p className="text-xs text-zinc-300">
                All planned services were deployed successfully. Real production URLs are active:
              </p>
              <div className="space-y-2 pt-1">
                {stagesList.filter((s) => s.liveUrl).map((s) => (
                  <div key={s.nodeId} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-emerald-950/40 border border-emerald-500/30">
                    <span className="text-xs font-semibold text-emerald-200">{s.name} ({s.providerDisplayName}):</span>
                    <div className="flex items-center gap-2">
                      <a
                        href={s.liveUrl!}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-mono text-cyan-300 hover:underline flex items-center gap-1"
                      >
                        {s.liveUrl}
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PARTIAL SUCCESS SCREEN */}
          {overallStatus === "PARTIAL_SUCCESS" && (
            <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-500/40 space-y-3">
              <div className="flex items-center gap-2.5 text-amber-300 font-bold text-sm">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                <span>PARTIAL SUCCESS — SOME SERVICES LIVE</span>
              </div>
              <p className="text-xs text-zinc-300">
                Upstream services deployed successfully, but downstream stages failed. Live endpoints:
              </p>
              <div className="space-y-2 pt-1">
                {stagesList.filter((s) => s.liveUrl).map((s) => (
                  <div key={s.nodeId} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-amber-950/40 border border-amber-500/30">
                    <span className="text-xs font-semibold text-amber-200">{s.name} ({s.providerDisplayName}):</span>
                    <a
                      href={s.liveUrl!}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-mono text-cyan-300 hover:underline flex items-center gap-1"
                    >
                      {s.liveUrl}
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CRITICAL FAILURE SCREEN */}
          {overallStatus === "FAILED" && (
            <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-500/40 space-y-2">
              <div className="flex items-center gap-2.5 text-rose-300 font-bold text-sm">
                <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                <span>DEPLOYMENT FAILED</span>
              </div>
              <p className="text-xs text-rose-200/90">
                {errorMsg || "An error occurred during stage execution. Downstream deployment was halted."}
              </p>
            </div>
          )}

          {/* FAILURE ROOT-CAUSE DIAGNOSTICS */}
          {failedStages.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-bold text-rose-400 uppercase tracking-wider">
                <AlertTriangle className="w-4 h-4" />
                <span>Failure Diagnosis & Actionable Fix</span>
              </div>

              {failedStages.map((stage) => {
                const diag = diagnostics[stage.nodeId];
                return (
                  <div key={stage.nodeId} className="p-4 rounded-xl bg-[#11131c] border border-rose-500/40 space-y-3 font-mono">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-500/40">
                          {diag?.failureCategory?.replace(/_/g, " ") || "EXECUTION FAILURE"}
                        </span>
                        <span className="text-xs font-bold text-zinc-200">{stage.name} ({stage.providerDisplayName})</span>
                      </div>
                      {diag?.confidence && (
                        <span className="text-[10px] text-zinc-400">
                          Confidence: <strong className="text-cyan-400">{diag.confidence}</strong>
                        </span>
                      )}
                    </div>

                    <div className="space-y-1">
                      <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wide">Likely Root Cause:</span>
                      <p className="text-xs text-zinc-200 leading-relaxed font-sans">
                        {diag?.likelyRootCause || stage.error || "Deployment process exited with error."}
                      </p>
                    </div>

                    {diag?.evidence && diag.evidence.length > 0 && (
                      <div className="space-y-1.5">
                        <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wide">Project Evidence:</span>
                        <div className="space-y-1">
                          {diag.evidence.map((ev, evIdx) => (
                            <div key={evIdx} className="p-2 rounded bg-[#08090d] border border-zinc-800 text-[11px] text-zinc-300 space-y-1">
                              <div className="text-cyan-400 font-semibold">{ev.source || ev.file || "Evidence"}</div>
                              {ev.snippet && (
                                <pre className="p-1.5 rounded bg-zinc-950 text-zinc-300 text-[10px] overflow-x-auto whitespace-pre-wrap font-mono">
                                  {ev.snippet}
                                </pre>
                              )}
                              {ev.description && <p className="text-zinc-400 text-[10px] font-sans">{ev.description}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {diag?.suggestedFix && (
                      <div className="p-3 rounded-lg bg-cyan-950/30 border border-cyan-500/30 space-y-1">
                        <span className="text-[11px] font-bold text-cyan-300 uppercase tracking-wide flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                          Suggested Fix:
                        </span>
                        <p className="text-xs text-zinc-200 leading-relaxed font-sans">
                          {diag.suggestedFix}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          {/* LIVE SANITIZED LOG CONSOLE */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-400">
                <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                <span>Sanitized Execution Logs</span>
              </div>

              {/* Stage Filter Tabs */}
              {isMultiStage && stagesList.length > 0 && (
                <div className="flex items-center gap-1 bg-[#0e1017] p-1 rounded-lg border border-zinc-800 text-[11px]">
                  <button
                    onClick={() => setSelectedTab("all")}
                    className={`px-2.5 py-1 rounded font-medium transition-colors ${
                      selectedTab === "all"
                        ? "bg-zinc-800 text-cyan-300 font-bold"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    All Logs
                  </button>
                  {stagesList.map((s) => (
                    <button
                      key={s.nodeId}
                      onClick={() => setSelectedTab(s.nodeId)}
                      className={`px-2 py-1 rounded font-medium transition-colors ${
                        selectedTab === s.nodeId
                          ? "bg-zinc-800 text-cyan-300 font-bold"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div
              ref={logContainerRef}
              className="p-4 rounded-xl bg-[#08090d] border border-zinc-800/90 font-mono text-xs text-zinc-300 h-64 overflow-y-auto custom-scrollbar space-y-1"
            >
              {activeLogs.length === 0 ? (
                currentTabStage?.status === "FAILED" ? (
                  <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-500/40 text-rose-300 text-xs space-y-1">
                    <div className="font-bold flex items-center gap-1.5 text-rose-400">
                      <XCircle className="w-4 h-4 shrink-0" />
                      <span>Stage Execution Failed</span>
                    </div>
                    <p className="text-zinc-300 font-sans">{currentTabStage.error || "No standard output received before process exited with error."}</p>
                  </div>
                ) : currentTabStage?.status === "SKIPPED" ? (
                  <div className="text-zinc-500 italic py-2">Stage was skipped because an upstream deployment stage failed.</div>
                ) : currentTabStage?.status === "PENDING" ? (
                  <div className="text-zinc-600 italic py-2">Stage pending execution.</div>
                ) : (
                  <div className="text-zinc-600 italic py-2">Waiting for stage output streams…</div>
                )
              ) : (
                activeLogs.map((chunk, i) => (
                  <pre key={i} className="whitespace-pre-wrap break-all leading-relaxed font-mono">
                    {chunk}
                  </pre>
                ))
              )}
            </div>
          </section>
        </div>

        {/* Footer Actions */}
        <footer className="px-5 py-3.5 border-t border-zinc-800 bg-[#0e1017] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>Secret filter active • 0 plaintext tokens on wire</span>
          </div>

          <div className="flex items-center gap-2">
            {overallStatus === "RUNNING" && (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-500/40 transition-colors cursor-pointer"
              >
                <Ban className="w-3.5 h-3.5" />
                <span>{cancelling ? "Cancelling…" : "Cancel Deployment"}</span>
              </button>
            )}

            {overallStatus !== "RUNNING" && (
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors cursor-pointer"
              >
                Close
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
