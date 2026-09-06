"use client";

import React, { useState } from "react";
import {
  GitMerge,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  FileCode,
  Layers,
  ShieldAlert,
  ShieldCheck,
  Play,
  X,
  ArrowRight,
  Sparkles,
  RotateCcw,
  Check,
  ListTree,
  Zap,
} from "lucide-react";

export interface RefactorTask {
  taskId: string;
  role: "CORE_MUTATOR" | "CALL_SITE_MUTATOR" | "TEST_ENGINEER" | string;
  objective: string;
  codingIntent?: string;
  relevantFiles: string[];
  dependencies: string[];
  allowedTools?: string[];
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | string;
  error?: string;
}

export interface RefactorPlanData {
  planId: string;
  goal: string;
  status: "ANALYSIS" | "PROPOSED" | "APPROVED" | "EXECUTING" | "VERIFYING" | "COMPLETED" | "CANCELLED" | "FAILED" | string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | string;
  rootTargets: string[];
  affectedFiles: string[];
  testsToRun: string[];
  warnings?: string[];
  recommendedOrder?: string[];
  tasks: RefactorTask[];
  rejectionReason?: string;
  verificationResult?: {
    success: boolean;
    passed: number;
    failed: number;
    errors?: string[];
  };
  createdAt?: number;
  updatedAt?: number;
}

interface RefactorPlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  plan: RefactorPlanData | null;
  onApproveAndExecute: (stepByStep: boolean) => Promise<void> | void;
  onCancelPlan: (reason?: string) => Promise<void> | void;
  isExecuting?: boolean;
}

export default function RefactorPlanModal({
  isOpen,
  onClose,
  plan,
  onApproveAndExecute,
  onCancelPlan,
  isExecuting = false,
}: RefactorPlanModalProps) {
  const [stepByStep, setStepByStep] = useState(false);
  const [activeTab, setActiveTab] = useState<"tasks" | "files" | "verification">("tasks");

  if (!isOpen || !plan) return null;

  const getRiskBadge = (level: string) => {
    switch (level?.toUpperCase()) {
      case "HIGH":
        return {
          bg: "bg-rose-500/10 border-rose-500/30 text-rose-400",
          icon: ShieldAlert,
          label: "HIGH RISK (Multi-file blast radius)",
        };
      case "LOW":
        return {
          bg: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
          icon: ShieldCheck,
          label: "LOW RISK (Bounded impact)",
        };
      default:
        return {
          bg: "bg-amber-500/10 border-amber-500/30 text-amber-400",
          icon: AlertTriangle,
          label: "MEDIUM RISK (Standard refactor)",
        };
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status?.toUpperCase()) {
      case "PROPOSED":
        return "bg-[#4CC2DE]/10 border-[#4CC2DE]/30 text-[#4CC2DE]";
      case "APPROVED":
        return "bg-[#3EAE79]/10 border-[#3EAE79]/30 text-[#3EAE79]";
      case "EXECUTING":
        return "bg-[#4CC2DE]/10 border-[#4CC2DE]/30 text-[#4CC2DE]";
      case "VERIFYING":
        return "bg-[#5A8FD6]/10 border-[#5A8FD6]/30 text-[#5A8FD6]";
      case "COMPLETED":
        return "bg-[#3EAE79]/15 border-[#3EAE79]/40 text-[#3EAE79]";
      case "CANCELLED":
        return "bg-[#6B7280]/15 border-[#22252B] text-[#9AA1AC]";
      case "FAILED":
        return "bg-[#DC5B5B]/15 border-[#DC5B5B]/40 text-[#DC5B5B]";
      default:
        return "bg-[#14161B] border-[#22252B] text-[#9AA1AC]";
    }
  };

  const getTaskStatusIcon = (status: string) => {
    switch (status?.toUpperCase()) {
      case "COMPLETED":
        return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
      case "IN_PROGRESS":
        return <Loader2 className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />;
      case "FAILED":
        return <XCircle className="w-4 h-4 text-rose-400 shrink-0" />;
      default:
        return <Clock className="w-4 h-4 text-zinc-500 shrink-0" />;
    }
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "CORE_MUTATOR":
        return "bg-cyan-500/15 text-cyan-300 border-cyan-500/30";
      case "CALL_SITE_MUTATOR":
        return "bg-purple-500/15 text-purple-300 border-purple-500/30";
      case "TEST_ENGINEER":
        return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
      default:
        return "bg-zinc-700/40 text-zinc-300 border-zinc-600/30";
    }
  };

  const riskMeta = getRiskBadge(plan.riskLevel);
  const RiskIcon = riskMeta.icon;

  const isProposed = plan.status === "PROPOSED" || plan.status === "ANALYSIS";
  const isRunning = plan.status === "EXECUTING" || plan.status === "VERIFYING" || isExecuting;
  const isDone = plan.status === "COMPLETED";
  const isCancelled = plan.status === "CANCELLED";
  const isFailed = plan.status === "FAILED";

  const completedTaskCount = plan.tasks.filter((t) => t.status === "COMPLETED").length;
  const progressPercent = plan.tasks.length > 0 ? Math.round((completedTaskCount / plan.tasks.length) * 100) : 0;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200 font-sans">
      <div 
        className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-xl border border-[#22252B] bg-[#111318] shadow-modal overflow-hidden font-sans text-xs text-[#E6E8EB]"
      >
        {/* Header */}
        <div className="p-4 border-b border-[#22252B] flex items-start justify-between gap-4 bg-[#0E1013]">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-[#1A1C22] border border-[#22252B] text-[#4CC2DE]">
                <GitMerge className="w-3.5 h-3.5 text-[#4CC2DE]" />
                <span>Sentinel AI Refactor Plan</span>
              </div>
              <div className={`px-2 py-0.5 rounded text-xs font-medium border ${getStatusBadge(plan.status)}`}>
                STATUS: {plan.status}
              </div>
              <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs border ${riskMeta.bg}`}>
                <RiskIcon className="w-3 h-3" />
                <span>{riskMeta.label}</span>
              </div>
            </div>
            <h2 className="text-base font-semibold tracking-tight text-[#E6E8EB] line-clamp-2">
              {plan.goal}
            </h2>
            <div className="text-xs text-[#9AA1AC] flex items-center gap-2 font-mono">
              <span>Plan ID: <code className="text-[#E6E8EB]">{plan.planId}</code></span>
              <span>•</span>
              <span className="font-sans">Scope: <strong className="text-[#E6E8EB] font-mono">{plan.affectedFiles.length} files</strong> ({plan.tasks.length} subtasks)</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#14161B] transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Execution Progress Bar (if executing or completed) */}
        {(isRunning || isDone || completedTaskCount > 0) && (
          <div className="px-5 pt-3 pb-2 border-b border-[#22252B] bg-[#0E1013]/40">
            <div className="flex items-center justify-between text-xs mb-1.5 font-mono">
              <span className="text-[#9AA1AC] flex items-center gap-1.5 font-sans">
                {isRunning && <Loader2 className="w-3.5 h-3.5 text-[#4CC2DE] animate-spin" />}
                {isDone ? "Refactor execution completed" : `Executing tasks (${completedTaskCount}/${plan.tasks.length})`}
              </span>
              <span className="font-medium text-[#4CC2DE]">{progressPercent}%</span>
            </div>
            <div className="w-full h-1.5 bg-[#14161B] rounded-full overflow-hidden border border-[#22252B]">
              <div
                className={`h-full transition-all duration-300 ${
                  isDone ? "bg-[#3EAE79]" : isFailed ? "bg-[#DC5B5B]" : "bg-[#4CC2DE]"
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <div className="px-5 pt-2 flex items-center gap-4 border-b border-[#22252B] text-xs bg-[#0E1013]/20">
          <button
            onClick={() => setActiveTab("tasks")}
            className={`pb-2 border-b-2 font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === "tasks" ? "border-[#4CC2DE] text-[#4CC2DE]" : "border-transparent text-[#9AA1AC] hover:text-[#E6E8EB]"
            }`}
          >
            <ListTree className="w-3.5 h-3.5" />
            <span>Task DAG & Steps ({plan.tasks.length})</span>
          </button>
          <button
            onClick={() => setActiveTab("files")}
            className={`pb-2 border-b-2 font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === "files" ? "border-[#4CC2DE] text-[#4CC2DE]" : "border-transparent text-[#9AA1AC] hover:text-[#E6E8EB]"
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Affected Files ({plan.affectedFiles.length})</span>
          </button>
          {plan.testsToRun.length > 0 && (
            <button
              onClick={() => setActiveTab("verification")}
              className={`pb-2 border-b-2 font-medium transition-colors flex items-center gap-1.5 ${
                activeTab === "verification" ? "border-[#4CC2DE] text-[#4CC2DE]" : "border-transparent text-[#9AA1AC] hover:text-[#E6E8EB]"
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Targeted Tests ({plan.testsToRun.length})</span>
            </button>
          )}
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4 text-sm font-sans">
          {/* Status Alert for Cancellation / Failure */}
          {isCancelled && (
            <div className="p-3.5 rounded-xl border border-zinc-700/40 bg-zinc-800/30 flex items-center gap-3 text-zinc-300 text-xs font-mono">
              <RotateCcw className="w-4 h-4 text-zinc-400 shrink-0" />
              <div>
                <strong>Plan Cancelled:</strong> {plan.rejectionReason || "Cancelled by operator."} Zero file mutations occurred.
              </div>
            </div>
          )}

          {isFailed && (
            <div className="p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 flex items-center gap-3 text-rose-300 text-xs font-mono">
              <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <div>
                <strong>Execution Failed:</strong> Plan was halted safely. Isolated workspace preserved.
              </div>
            </div>
          )}

          {/* Tab 1: Task Checklist & DAG */}
          {activeTab === "tasks" && (
            <div className="space-y-3">
              {plan.tasks.map((task, idx) => (
                <div
                  key={task.taskId || idx}
                  className="p-3.5 rounded-xl border transition-all space-y-2"
                  style={{
                    backgroundColor: "var(--theme-surface-panel, #090910)",
                    borderColor: task.status === "IN_PROGRESS" ? "var(--theme-accent, #22d3ee)" : "var(--theme-border, #1e1e2d)",
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {getTaskStatusIcon(task.status)}
                      <span className="font-mono font-bold text-xs text-zinc-200">
                        {idx + 1}. {task.taskId}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${getRoleBadge(task.role)}`}>
                        {task.role}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-zinc-400 uppercase">
                      {task.status}
                    </span>
                  </div>

                  <p className="text-xs text-zinc-300 font-medium pl-6">
                    {task.objective}
                  </p>

                  <div className="pl-6 flex items-center gap-4 text-[11px] font-mono text-zinc-400 flex-wrap">
                    {task.dependencies && task.dependencies.length > 0 && (
                      <span className="flex items-center gap-1">
                        <span className="text-zinc-500">Depends on:</span>
                        <code className="text-purple-400">{task.dependencies.join(", ")}</code>
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <span className="text-zinc-500">Target:</span>
                      <code className="text-cyan-400">{task.relevantFiles.join(", ") || "Workspace"}</code>
                    </span>
                  </div>

                  {task.error && (
                    <div className="ml-6 p-2 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-mono">
                      Error: {task.error}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Tab 2: Affected Files List */}
          {activeTab === "files" && (
            <div className="space-y-2">
              <div className="text-xs font-mono text-zinc-400 mb-2">
                Authoritative file scope. Any mutation outside this list triggers automatic scope-drift isolation:
              </div>
              <div className="grid grid-cols-1 gap-2">
                {plan.affectedFiles.map((file, i) => (
                  <div
                    key={file || i}
                    className="p-2.5 rounded-lg border flex items-center justify-between text-xs font-mono"
                    style={{
                      backgroundColor: "var(--theme-surface-panel, #090910)",
                      borderColor: "var(--theme-border, #1e1e2d)",
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileCode className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                      <span className="text-zinc-200 font-medium truncate">{file}</span>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                      {i === 0 ? "PRIMARY TARGET" : "DEPENDENT"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab 3: Targeted Verification Tests */}
          {activeTab === "verification" && (
            <div className="space-y-2">
              <div className="text-xs font-mono text-zinc-400 mb-2">
                Automated test verification suite mapped to this refactor:
              </div>
              <div className="grid grid-cols-1 gap-2">
                {plan.testsToRun.map((testFile, i) => (
                  <div
                    key={testFile || i}
                    className="p-2.5 rounded-lg border flex items-center justify-between text-xs font-mono"
                    style={{
                      backgroundColor: "var(--theme-surface-panel, #090910)",
                      borderColor: "var(--theme-border, #1e1e2d)",
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="text-zinc-200 font-medium truncate">{testFile}</span>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                      VERIFICATION SUITE
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-3.5 border-t border-[#22252B] flex items-center justify-between gap-3 bg-[#0E1013]">
          <div className="flex items-center gap-3">
            {isProposed && (
              <label className="flex items-center gap-2 cursor-pointer text-xs font-sans text-[#9AA1AC] select-none">
                <input
                  type="checkbox"
                  checked={stepByStep}
                  onChange={(e) => setStepByStep(e.target.checked)}
                  className="rounded border-[#22252B] bg-[#14161B] text-[#4CC2DE] focus:ring-0"
                />
                <span>Step-by-step confirmation</span>
              </label>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            {isProposed && (
              <>
                <button
                  onClick={() => onCancelPlan("Cancelled by user")}
                  className="px-3.5 py-1.5 rounded-md text-xs font-medium border border-[#22252B] bg-[#14161B] hover:bg-[#1A1C22] text-[#9AA1AC] hover:text-[#E6E8EB] transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Cancel Plan</span>
                </button>
                <button
                  onClick={() => onApproveAndExecute(stepByStep)}
                  className="px-4 py-1.5 rounded-md text-xs font-medium bg-[#4CC2DE] hover:bg-[#3db0cc] text-[#0A0B0D] transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Approve & Execute</span>
                </button>
              </>
            )}

            {isRunning && (
              <button
                disabled
                className="px-3.5 py-1.5 rounded-md text-xs font-medium bg-[#14161B] border border-[#22252B] text-[#9AA1AC] flex items-center gap-2 cursor-not-allowed"
              >
                <Loader2 className="w-3.5 h-3.5 text-[#4CC2DE] animate-spin" />
                <span>Executing Plan Tasks...</span>
              </button>
            )}

            {(isDone || isCancelled || isFailed) && (
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded-md text-xs font-medium bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] text-[#E6E8EB] transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Close</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
