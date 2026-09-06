"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  X,
  Layers,
  Server,
  Globe,
  Database,
  Cpu,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Info,
  Clock,
  FileCode,
  Lock,
  Unlock,
  Rocket,
  RefreshCw,
  FolderGit2,
  GitBranch,
  GitCommit,
  UploadCloud,
  Key,
  ShieldAlert,
  ChevronDown,
  ChevronUp,
  Check,
  Loader2,
} from "lucide-react";

export interface ServiceTargetUI {
  serviceId: string;
  name: string;
  type: "FRONTEND" | "BACKEND" | "WORKER";
  rootDir: string;
  framework: string;
  runtime: string;
  buildCommand: string | null;
  startCommand: string | null;
  port: number | null;
  outputDir: string | null;
  configFile: string | null;
  healthCheckPath: string | null;
  recommendedProvider: string | null;
  recommendedProviderDisplayName?: string;
  selectedProvider: string;
  selectionSource?: "RECOMMENDATION" | "USER";
  providerDisplayName: string;
  executionAvailable: boolean;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  score: number;
  evidence: Array<{ file?: string; description?: string }>;
}

export interface DatabaseTargetUI {
  databaseId: string;
  name: string;
  technology: string;
  ormOrDriver: string;
  rootDir: string;
  configFile: string | null;
  migrationCommand?: string;
  recommendedProvider: string | null;
  recommendedProviderDisplayName?: string;
  selectedProvider: string;
  selectionSource?: "RECOMMENDATION" | "USER";
  providerDisplayName: string;
  executionAvailable: boolean;
  isManaged: boolean;
  isSQLite: boolean;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  score: number;
  evidence: Array<{ file?: string; description?: string }>;
}

export interface DependencyWiringUI {
  sourceId: string;
  sourceOutput: string;
  targetServiceId: string;
  targetEnvVar: string;
  isSecret: boolean;
}

export interface DependencyItemUI {
  from: string;
  to: string;
  reason: string;
}

export interface RemotePreflightItemUI {
  valid: boolean;
  code?: string;
  repository?: string;
  branch?: string;
  requestedRootDir?: string;
  isCommittedLocally?: boolean;
  uncommittedFiles?: Array<{ path: string; status: string }>;
  reason?: string;
  suggestedFix?: string;
  message?: string;
}

export interface DeploymentPlanUI {
  planId: string;
  workspacePath: string;
  generatedAt: number;
  evidenceHash?: string;
  overallStatus: "READY" | "WARNING" | "BLOCKED" | "UNKNOWN";
  summary: string;
  topology: {
    isMonorepo: boolean;
    packageManager: string | null;
    services: ServiceTargetUI[];
    databases: DatabaseTargetUI[];
  };
  dependencies: DependencyItemUI[];
  wiring: DependencyWiringUI[];
  executionOrder: string[];
  estimatedTotalTimeSeconds: number | null;
  blockers: string[];
  warnings: string[];
  remotePreflight?: RemotePreflightItemUI;
  executionSource?: "GIT_REMOTE" | "LOCAL_WORKSPACE" | "UNCONFIGURED";
  deploymentRepositoryContext?: any;
}

interface DeploymentPlanModalProps {
  workspacePath: string;
  initialSelections?: Record<string, string>;
  onSelectionsChange?: (selections: Record<string, string>) => void;
  onClose: () => void;
  onOpenPreviewConfig?: (providerId: string, displayName: string) => void;
  onOpenCredentials?: (providerId: string, displayName: string) => void;
  onStartDeployment?: (plan: DeploymentPlanUI, requestId: string) => void;
}

const FRONTEND_PROVIDER_OPTIONS = [
  { id: "vercel", name: "Vercel", executable: true },
  { id: "netlify", name: "Netlify", executable: true },
  { id: "railway", name: "Railway", executable: false },
];

const BACKEND_PROVIDER_OPTIONS = [
  { id: "render", name: "Render", executable: true },
  { id: "railway", name: "Railway", executable: false },
  { id: "flyio", name: "Fly.io", executable: false },
];

const DATABASE_PROVIDER_OPTIONS = [
  { id: "render_postgres", name: "Render (PostgreSQL)", executable: true },
  { id: "railway_mysql", name: "Railway (MySQL)", executable: false },
  { id: "mongodb_atlas", name: "MongoDB Atlas", executable: false },
  { id: "embedded_sqlite", name: "Embedded SQLite", executable: true },
];

export default function DeploymentPlanModal({
  workspacePath,
  initialSelections = {},
  onSelectionsChange,
  onClose,
  onOpenPreviewConfig,
  onOpenCredentials,
  onStartDeployment,
}: DeploymentPlanModalProps) {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<DeploymentPlanUI | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authStatuses, setAuthStatuses] = useState<Record<string, boolean>>({});
  const [userSelections, setUserSelections] = useState<Record<string, string>>(initialSelections);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [isConfirmingDeployment, setIsConfirmingDeployment] = useState(false);
  const confirmInFlightRef = useRef(false);
  const [isUpdating, setIsUpdating] = useState(false);

  // Git Deployment Readiness Gate State
  const [isReviewingGitChanges, setIsReviewingGitChanges] = useState(false);
  const [gitCommitMessage, setGitCommitMessage] = useState("");
  const [gitActionBusy, setGitActionBusy] = useState(false);
  const [gitActionStatus, setGitActionStatus] = useState<string | null>(null);
  const [gitActionError, setGitActionError] = useState<string | null>(null);
  const [liveGitFiles, setLiveGitFiles] = useState<Array<{ path: string; status: string; isStaged: boolean }> | null>(null);

  // Deployment Source & Custom Git Repo State
  const [isConfiguringGitRepo, setIsConfiguringGitRepo] = useState(false);
  const [customRepoUrl, setCustomRepoUrl] = useState(initialSelections.repository || initialSelections.selectedRepo || "https://github.com/umangmalhotrawork-cloud/NexusGitTest.git");
  const [customBranch, setCustomBranch] = useState(initialSelections.branch || initialSelections.selectedBranch || "milestone-11-navigation-search");
  const [customRootDir, setCustomRootDir] = useState(
    initialSelections.rootDir || initialSelections.selectedRootDir || (workspacePath && workspacePath.includes("demo-workspaces") ? "demo-workspaces/nexus-fullstack-deployment-test" : ".")
  );

  const requestIdRef = React.useRef(0);
  const planRef = React.useRef<DeploymentPlanUI | null>(null);
  planRef.current = plan;
  const userSelectionsRef = React.useRef<Record<string, string>>(initialSelections);
  userSelectionsRef.current = userSelections;
  const onSelectionsChangeRef = React.useRef(onSelectionsChange);
  onSelectionsChangeRef.current = onSelectionsChange;

  // Development-only diagnostic logger
  const logDiagnostic = useCallback((action: string, detail?: any) => {
    console.log(`[DeploymentSelection] [DeploymentPlanModal] ${action}`, detail || "");
  }, []);

  const fetchPlan = useCallback(async (explicitSelections?: Record<string, string>, isBackground = false) => {
    const currentRequestId = ++requestIdRef.current;
    const selectionsToUse = explicitSelections || userSelectionsRef.current;

    logDiagnostic(`generate start #${currentRequestId}`, { workspacePath, selections: selectionsToUse });
    if (!planRef.current && !isBackground) {
      setLoading(true);
    } else {
      setIsUpdating(true);
    }
    setError(null);

    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.intelligence?.generateDeploymentPlan) {
        const res = await electronAPI.intelligence.generateDeploymentPlan({
          workspacePath,
          userSelections: selectionsToUse,
        });

        // Stale request guard
        if (requestIdRef.current !== currentRequestId) {
          logDiagnostic(`ignore stale response #${currentRequestId}`);
          return;
        }

        logDiagnostic(`generate response #${currentRequestId}`, {
          status: res?.overallStatus,
          services: res?.topology?.services?.map((s: any) => ({ id: s.serviceId, rec: s.recommendedProvider, sel: s.selectedProvider, src: s.selectionSource })),
          databases: res?.topology?.databases?.map((d: any) => ({ id: d.databaseId, rec: d.recommendedProvider, sel: d.selectedProvider, src: d.selectionSource })),
        });
        setPlan(res);
        planRef.current = res;

        // Synchronize active selections state from the loaded plan while preserving repository context
        if (res?.topology) {
          const loadedMap: Record<string, string> = {
            ...userSelectionsRef.current,
          };
          if (res.executionSource) {
            loadedMap.executionSource = res.executionSource;
          }
          if (res.deploymentRepositoryContext?.remoteUrl) {
            loadedMap.repository = res.deploymentRepositoryContext.remoteUrl;
            setCustomRepoUrl(res.deploymentRepositoryContext.remoteUrl);
          }
          if (res.deploymentRepositoryContext?.branch) {
            loadedMap.branch = res.deploymentRepositoryContext.branch;
            setCustomBranch(res.deploymentRepositoryContext.branch);
          }
          if (res.deploymentRepositoryContext?.projectRoot && res.deploymentRepositoryContext.projectRoot !== '.') {
            loadedMap.rootDir = res.deploymentRepositoryContext.projectRoot;
            setCustomRootDir(res.deploymentRepositoryContext.projectRoot);
          }
          for (const s of res.topology.services || []) {
            if (s.selectedProvider) {
              loadedMap[s.serviceId] = s.selectedProvider;
            }
          }
          for (const d of res.topology.databases || []) {
            if (d.selectedProvider) {
              loadedMap[d.databaseId] = d.selectedProvider;
            }
          }
          setUserSelections(loadedMap);
          userSelectionsRef.current = loadedMap;
          onSelectionsChangeRef.current?.(loadedMap);
        }

        // Fetch auth statuses for selected providers
        if (res?.topology?.services) {
          const statuses: Record<string, boolean> = {};
          for (const svc of res.topology.services) {
            const pid = svc.selectedProvider || svc.recommendedProvider;
            if (pid && electronAPI.intelligence.getProviderAuthStatus) {
              const auth = await electronAPI.intelligence.getProviderAuthStatus(pid);
              statuses[pid] = Boolean(auth?.isConnected);
            }
          }
          if (requestIdRef.current === currentRequestId) {
            setAuthStatuses(statuses);
          }
        }
      } else {
        if (requestIdRef.current === currentRequestId) {
          setError("Deployment plan generation API is not available.");
        }
      }
    } catch (err: any) {
      if (requestIdRef.current === currentRequestId) {
        logDiagnostic(`generate error #${currentRequestId}`, err?.message);
        setError(err?.message || "Failed to generate deployment plan.");
      }
    } finally {
      if (requestIdRef.current === currentRequestId) {
        logDiagnostic(`generate finished #${currentRequestId}`);
        setLoading(false);
        setIsUpdating(false);
      }
    }
  }, [workspacePath, logDiagnostic]);

  const handleSelectExecutionSource = useCallback(async (source: "LOCAL_WORKSPACE" | "GIT_REMOTE") => {
    const updated = { ...userSelectionsRef.current, executionSource: source };
    setUserSelections(updated);
    userSelectionsRef.current = updated;
    onSelectionsChangeRef.current?.(updated);
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.intelligence?.saveDeploymentSelections && workspacePath) {
      await electronAPI.intelligence.saveDeploymentSelections({ workspacePath, selections: updated });
    }
    fetchPlan(updated, false);
  }, [workspacePath, fetchPlan]);

  const handleApplyGitRepoSelection = useCallback(async () => {
    const updated = {
      ...userSelectionsRef.current,
      executionSource: "GIT_REMOTE",
      repository: customRepoUrl.trim(),
      branch: customBranch.trim(),
      rootDir: customRootDir.trim(),
    };
    setUserSelections(updated);
    userSelectionsRef.current = updated;
    onSelectionsChangeRef.current?.(updated);
    setIsConfiguringGitRepo(false);
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.intelligence?.saveDeploymentSelections && workspacePath) {
      await electronAPI.intelligence.saveDeploymentSelections({ workspacePath, selections: updated });
    }
    fetchPlan(updated, false);
  }, [workspacePath, customRepoUrl, customBranch, customRootDir, fetchPlan]);

  const checkAuthStatuses = useCallback(async () => {
    const target = planRef.current;
    if (!target?.topology?.services) return;
    const electronAPI = (window as any).electronAPI;
    if (!electronAPI?.intelligence?.getProviderAuthStatus) return;
    try {
      const statuses: Record<string, boolean> = {};
      for (const svc of target.topology.services) {
        const pid = svc.selectedProvider || svc.recommendedProvider;
        if (pid) {
          const auth = await electronAPI.intelligence.getProviderAuthStatus(pid);
          statuses[pid] = Boolean(auth?.isConnected);
        }
      }
      setAuthStatuses(statuses);
    } catch (_) {}
  }, []);

  const refreshGitStatus = useCallback(async () => {
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.git?.status && workspacePath) {
        const st = await electronAPI.git.status(workspacePath);
        if (st?.isRepo) {
          const files: Array<{ path: string; status: string; isStaged: boolean }> = [];
          (st.staged || []).forEach((f: any) => files.push({ path: f.path, status: f.status || 'M', isStaged: true }));
          (st.unstaged || []).forEach((f: any) => files.push({ path: f.path, status: f.status || 'M', isStaged: false }));
          (st.untracked || []).forEach((f: any) => files.push({ path: f.path, status: '??', isStaged: false }));
          setLiveGitFiles(files);
        }
      }
    } catch (_) {}
  }, [workspacePath]);

  const handleStageFile = useCallback(async (filePath: string) => {
    setGitActionBusy(true);
    setGitActionStatus(`Staging ${filePath}...`);
    setGitActionError(null);
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.git?.stage) {
        await electronAPI.git.stage(workspacePath, filePath);
        setGitActionStatus(`Staged ${filePath}`);
        await refreshGitStatus();
      }
    } catch (err: any) {
      setGitActionError(err?.message || `Failed to stage ${filePath}`);
    } finally {
      setGitActionBusy(false);
    }
  }, [workspacePath, refreshGitStatus]);

  const handleUnstageFile = useCallback(async (filePath: string) => {
    setGitActionBusy(true);
    setGitActionStatus(`Unstaging ${filePath}...`);
    setGitActionError(null);
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.git?.unstage) {
        await electronAPI.git.unstage(workspacePath, filePath);
        setGitActionStatus(`Unstaged ${filePath}`);
        await refreshGitStatus();
      }
    } catch (err: any) {
      setGitActionError(err?.message || `Failed to unstage ${filePath}`);
    } finally {
      setGitActionBusy(false);
    }
  }, [workspacePath, refreshGitStatus]);

  const handleCommitGitChanges = useCallback(async () => {
    if (!gitCommitMessage.trim()) return;
    setGitActionBusy(true);
    setGitActionStatus("Committing staged changes...");
    setGitActionError(null);
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.git?.commit) {
        const res = await electronAPI.git.commit(workspacePath, gitCommitMessage.trim());
        if (res?.success) {
          setGitActionStatus(`Committed successfully: ${res.commitResult?.commit || 'Created'}`);
          setGitCommitMessage("");
          await refreshGitStatus();
          await fetchPlan(undefined, true);
        } else {
          setGitActionError(res?.error || "Commit failed.");
        }
      }
    } catch (err: any) {
      setGitActionError(err?.message || "Commit failed.");
    } finally {
      setGitActionBusy(false);
    }
  }, [workspacePath, gitCommitMessage, refreshGitStatus, fetchPlan]);

  const handlePushGitChanges = useCallback(async () => {
    const branch = planRef.current?.remotePreflight?.branch;
    setGitActionBusy(true);
    setGitActionStatus(`Pushing to origin/${branch || 'HEAD'}...`);
    setGitActionError(null);
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.git?.push) {
        const res = await electronAPI.git.push(workspacePath, 'origin', branch);
        if (res?.success) {
          setGitActionStatus(`Successfully pushed to origin/${branch || 'HEAD'}!`);
          await fetchPlan(undefined, true);
        } else {
          setGitActionError(res?.error || res?.message || "Push failed.");
        }
      }
    } catch (err: any) {
      setGitActionError(err?.message || "Push failed.");
    } finally {
      setGitActionBusy(false);
    }
  }, [workspacePath, fetchPlan]);

  const handleRecheckGitReadiness = useCallback(async () => {
    setGitActionStatus("Re-checking remote repository readiness...");
    setGitActionError(null);
    await fetchPlan(undefined, true);
    setGitActionStatus(null);
  }, [fetchPlan]);

  const relevantGitFiles = useMemo(() => {
    const reqDir = plan?.remotePreflight?.requestedRootDir || "";
    if (liveGitFiles && liveGitFiles.length > 0) {
      if (!reqDir || reqDir === ".") return liveGitFiles;
      return liveGitFiles.filter(f => f.path.startsWith(reqDir) || f.path.replace(/\\/g, '/').startsWith(reqDir));
    }
    return (plan?.remotePreflight?.uncommittedFiles || []).map(f => ({
      path: f.path,
      status: f.status,
      isStaged: f.status === "A" || f.status === "M",
    }));
  }, [plan?.remotePreflight, liveGitFiles]);

  const hasStagedRelevantFiles = useMemo(() => {
    return relevantGitFiles.some(f => f.isStaged);
  }, [relevantGitFiles]);

  // Live auth status refresh while modal is active
  useEffect(() => {
    const interval = setInterval(() => {
      checkAuthStatuses();
    }, 2000);
    const onFocus = () => {
      checkAuthStatuses();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [checkAuthStatuses]);

  // Initial single mount trigger
  useEffect(() => {
    logDiagnostic("mount", { workspacePath });
    fetchPlan(initialSelections);
  }, [workspacePath]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleProviderSelect = (targetId: string, providerId: string) => {
    logDiagnostic("provider select", { targetId, providerId });
    const updated = { ...userSelections, [targetId]: providerId };
    setUserSelections(updated);
    userSelectionsRef.current = updated;

    onSelectionsChangeRef.current?.(updated);
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.intelligence?.saveDeploymentSelections) {
      electronAPI.intelligence.saveDeploymentSelections({ workspacePath, selections: updated });
    }
    fetchPlan(updated, true);
  };

  const hasDeployableComponents = Boolean(
    plan && (plan.topology.services.length > 0 || plan.topology.databases.length > 0)
  );

  // Missing credentials for selected providers that ARE executable
  const missingProviders = useMemo(() => {
    if (!plan?.topology?.services) return [];
    const missing: Array<{ providerId: string; displayName: string }> = [];
    for (const svc of plan.topology.services) {
      const pid = svc.selectedProvider || svc.recommendedProvider;
      if (pid && svc.executionAvailable && !authStatuses[pid]) {
        if (!missing.some((m) => m.providerId === pid)) {
          missing.push({
            providerId: pid,
            displayName: svc.providerDisplayName || pid,
          });
        }
      }
    }
    return missing;
  }, [plan, authStatuses]);

  // Check if any selected provider is not executable
  const hasUnsupportedSelection = useMemo(() => {
    if (!plan) return false;
    const unsuppSvc = plan.topology.services.some((s) => s.executionAvailable === false);
    const unsuppDb = plan.topology.databases.some((d) => d.executionAvailable === false);
    return unsuppSvc || unsuppDb;
  }, [plan]);

  const canDeploy = Boolean(
    plan &&
    plan.overallStatus !== "UNKNOWN" &&
    plan.overallStatus !== "BLOCKED" &&
    !hasUnsupportedSelection &&
    plan.executionOrder.length > 0 &&
    missingProviders.length === 0
  );

  const deployDisabledReason = useMemo(() => {
    if (!plan) return "Plan is loading…";
    if (plan.overallStatus === "UNKNOWN") return "Insufficient evidence to deploy project.";
    if (hasUnsupportedSelection) {
      return "One or more selected deployment platforms do not yet have execution support in NEXUS.";
    }
    if (plan.overallStatus === "BLOCKED") return "Deployment plan is blocked: " + (plan.blockers[0] || "Security/integrity blockers detected.");
    if (plan.executionOrder.length === 0) return "No deployment stages available.";
    if (missingProviders.length > 0) {
      return `Connect ${missingProviders.map((p) => p.displayName).join(" & ")} before deploying.`;
    }
    return null;
  }, [plan, hasUnsupportedSelection, missingProviders]);

  const handleConfirmDeploy = () => {
    if (confirmInFlightRef.current || !plan || !canDeploy) return;
    confirmInFlightRef.current = true;
    setIsConfirmingDeployment(true);
    const requestId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `nexus-request-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    if (plan && canDeploy) {
      setShowConfirmation(false);
      onStartDeployment?.(plan, requestId);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-4xl max-h-[90vh] bg-[#111318] border border-[#22252B] rounded-xl shadow-modal flex flex-col overflow-hidden text-[#E1E4EA] font-sans">
        
        {/* Modal Header */}
        <header className="px-5 py-4 border-b border-[#22252B] bg-[#0E1013] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-[#14161B] border border-[#22252B] text-[#4CC2DE] shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-semibold text-[#E1E4EA] tracking-tight">Deployment Plan</h2>
                {plan && (
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${
                      plan.overallStatus === "READY"
                        ? "bg-emerald-950/80 border border-emerald-500/40 text-emerald-300"
                        : plan.overallStatus === "WARNING"
                        ? "bg-amber-950/80 border border-amber-500/40 text-amber-300"
                        : plan.overallStatus === "BLOCKED"
                        ? "bg-rose-950/80 border border-rose-500/40 text-rose-300"
                        : "bg-[#1A1C22] border border-[#22252B] text-[#868C96]"
                    }`}
                  >
                    {plan.overallStatus}
                  </span>
                )}
                {plan?.topology.isMonorepo && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#14161B] border border-[#22252B] text-[#4CC2DE]">
                    Monorepo Topology
                  </span>
                )}
              </div>
              <p className="text-xs text-[#868C96] font-mono truncate mt-0.5 max-w-[500px]" title={workspacePath}>
                {workspacePath}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => fetchPlan(undefined, false)}
              disabled={loading || isUpdating}
              className="p-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border border-zinc-700/50 transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh Plan"
            >
              <RefreshCw className={`w-4 h-4 ${loading || isUpdating ? "animate-spin text-cyan-400" : ""}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border border-zinc-700/50 transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar min-h-0">
          
          {loading && !plan && (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500 space-y-3">
              <RefreshCw className="w-7 h-7 animate-spin text-cyan-500" />
              <p className="text-sm font-medium">Computing deployment plan & target topology…</p>
            </div>
          )}

          {error && !plan && (
            <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-500/30 text-rose-300 text-xs space-y-2">
              <div className="flex items-center gap-2 font-bold text-rose-200">
                <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>Deployment Plan could not be generated</span>
              </div>
              <p className="text-rose-200/80 leading-relaxed">{error}</p>
              <div className="pt-1">
                <button
                  onClick={() => fetchPlan()}
                  className="px-3 py-1.5 rounded-lg bg-rose-900/60 hover:bg-rose-800 text-rose-100 text-xs font-semibold border border-rose-500/40 transition-colors cursor-pointer inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry</span>
                </button>
              </div>
            </div>
          )}

          {plan && (
            <>
              {/* Plan Summary Banner */}
              <div
                className={`p-4 rounded-xl border flex items-start gap-3.5 ${
                  plan.overallStatus === "READY"
                    ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-200"
                    : plan.overallStatus === "WARNING"
                    ? "bg-amber-950/20 border-amber-500/30 text-amber-200"
                    : plan.overallStatus === "BLOCKED"
                    ? "bg-rose-950/20 border-rose-500/30 text-rose-200"
                    : "bg-zinc-900 border-zinc-800 text-zinc-300"
                }`}
              >
                {plan.overallStatus === "READY" && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />}
                {plan.overallStatus === "WARNING" && <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />}
                {plan.overallStatus === "BLOCKED" && <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />}
                {plan.overallStatus === "UNKNOWN" && <Info className="w-5 h-5 text-zinc-400 shrink-0 mt-0.5" />}
                
                <div className="space-y-1 text-xs">
                  <div className="font-bold text-sm tracking-tight text-zinc-100">
                    {plan.overallStatus === "READY" && "Deployment Plan Ready for Review"}
                    {plan.overallStatus === "WARNING" && "Deployment Plan Generated with Warnings"}
                    {plan.overallStatus === "BLOCKED" && "Deployment Plan Blocked"}
                    {plan.overallStatus === "UNKNOWN" && "Indeterminate Project Topology"}
                  </div>
                  <p className="text-zinc-300 leading-relaxed">{plan.summary}</p>
                </div>
              </div>

              {/* Execution Source Info Banner when GIT_REMOTE is active */}
              {plan.executionSource === "GIT_REMOTE" && (
                <div className="p-3.5 rounded-lg bg-[#14161B] border border-[#22252B] text-xs space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-medium text-zinc-100">
                      <FolderGit2 className="w-4 h-4 text-[#4CC2DE] shrink-0" />
                      <span>Deployment Source: <strong className="text-cyan-300">GIT REMOTE</strong></span>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      plan.overallStatus === "READY"
                        ? "bg-emerald-950/80 border border-emerald-500/50 text-emerald-200"
                        : "bg-cyan-950/80 border border-cyan-500/50 text-cyan-200"
                    }`}>
                      {plan.overallStatus === "READY" ? "READY" : "CONFIGURED"}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono bg-black/50 p-2.5 rounded-lg border border-zinc-800/80 text-zinc-300">
                    <div>
                      <span className="text-zinc-500">Repository:</span>{" "}
                      <span className="text-cyan-300 font-semibold">
                        {plan.deploymentRepositoryContext?.remoteUrl || userSelections.repository || "NexusGitTest"}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500">Branch:</span>{" "}
                      <span className="text-amber-300 font-semibold">
                        {plan.deploymentRepositoryContext?.branch || userSelections.branch || "milestone-11-navigation-search"}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500">Root Directory:</span>{" "}
                      <span className="text-zinc-200 font-semibold">
                        {userSelections.rootDir || plan.deploymentRepositoryContext?.projectRoot || "demo-workspaces/nexus-fullstack-deployment-test"}
                      </span>
                    </div>
                    <div>
                      <span className="text-zinc-500">Remote Content:</span>{" "}
                      <span className="text-emerald-400 font-semibold">
                        {plan.remotePreflight && !plan.remotePreflight.valid ? "Mismatch" : "Verified"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsConfiguringGitRepo(true)}
                      className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 text-[11px] font-medium transition-colors cursor-pointer"
                    >
                      Change Repository
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectExecutionSource("LOCAL_WORKSPACE")}
                      className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 text-[11px] font-medium transition-colors cursor-pointer"
                    >
                      Switch to Local Workspace
                    </button>
                  </div>
                </div>
              )}

              {/* Execution Source Info Banner when LOCAL_WORKSPACE is active */}
              {plan.executionSource === "LOCAL_WORKSPACE" && (
                <div className="p-3.5 rounded-xl bg-emerald-950/30 border border-emerald-500/40 text-emerald-300 text-xs flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <UploadCloud className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Deployment Source: <strong className="text-emerald-200">LOCAL WORKSPACE</strong> (Direct local build & deploy, remote check bypassed)</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsConfiguringGitRepo(true)}
                    className="px-2.5 py-1 rounded bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 text-[11px] font-medium transition-colors cursor-pointer"
                  >
                    Switch to Git Remote
                  </button>
                </div>
              )}

              {/* DEPLOYMENT SOURCE NOT YET DEFINED / CONFIGURATION REQUIRED Banner */}
              {(plan.remotePreflight?.code === "DEPLOYMENT_SOURCE_UNCONFIGURED" || plan.executionSource === "UNCONFIGURED") && (
                <div className="p-4 rounded-lg bg-[#14161B] border border-[#22252B] text-xs space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-medium text-zinc-100 text-sm">
                      <FolderGit2 className="w-4 h-4 text-[#4CC2DE] shrink-0" />
                      <span>DEPLOYMENT SOURCE NOT YET DEFINED</span>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-amber-950/80 border border-amber-500/50 text-[10px] font-bold text-amber-200 uppercase tracking-wider">
                      CONFIGURATION REQUIRED
                    </span>
                  </div>

                  <div className="bg-black/50 rounded-lg p-3 border border-zinc-800/80 font-mono text-[11px] text-zinc-300 space-y-1.5">
                    <div>
                      <span className="text-zinc-500">Workspace:</span>{" "}
                      <span className="text-zinc-200 font-semibold">{plan.workspacePath ? plan.workspacePath.split("/").pop() : "nexus-fullstack-deployment-test"}</span>
                    </div>
                    {plan.deploymentRepositoryContext?.parentRepoName && (
                      <div>
                        <span className="text-zinc-500">Detected parent repository:</span>{" "}
                        <span className="text-amber-300">{plan.deploymentRepositoryContext.parentRepoName}</span>
                      </div>
                    )}
                    <div className="text-amber-400/90 text-[10px]">
                      Parent repository will NOT be used automatically for deployment.
                    </div>
                    <div>
                      <span className="text-zinc-500">Deployment source:</span>{" "}
                      <span className="text-zinc-400 italic">Not configured</span>
                    </div>
                  </div>

                  <p className="text-zinc-300 text-xs leading-relaxed">
                    This nested workspace does not have its own Git repository. Choose deployment source:
                  </p>

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => handleSelectExecutionSource("LOCAL_WORKSPACE")}
                      className="px-3.5 py-2 rounded-md bg-emerald-950/90 hover:bg-emerald-900 text-emerald-200 border border-emerald-500/40 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <UploadCloud className="w-4 h-4 text-emerald-400" />
                      <span>Use Local Workspace</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsConfiguringGitRepo(true)}
                      className="px-3.5 py-2 rounded-md bg-[#14161B] hover:bg-[#1A1C22] text-[#4CC2DE] border border-[#22252B] text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <FolderGit2 className="w-4 h-4 text-[#4CC2DE]" />
                      <span>Select Git Repository</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Git Repository Selector Form Modal / Drawer */}
              {isConfiguringGitRepo && (
                <div className="p-4 rounded-lg bg-[#0E1013] border border-[#22252B] space-y-3 animate-in fade-in duration-150">
                  <div className="font-medium text-zinc-100 text-xs flex items-center gap-1.5">
                    <GitBranch className="w-4 h-4 text-[#4CC2DE]" />
                    <span>Select Git Repository for Deployment</span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div>
                      <label className="block text-[11px] text-zinc-400 mb-1">Repository URL or Name:</label>
                      <input
                        type="text"
                        value={customRepoUrl}
                        onChange={(e) => setCustomRepoUrl(e.target.value)}
                        placeholder="https://github.com/umangmalhotrawork-cloud/NexusGitTest.git"
                        className="w-full px-2.5 py-1.5 rounded-md bg-[#14161B] border border-[#22252B] text-zinc-100 font-mono text-[11px] focus:border-[#4CC2DE] focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] text-zinc-400 mb-1">Branch:</label>
                        <input
                          type="text"
                          value={customBranch}
                          onChange={(e) => setCustomBranch(e.target.value)}
                          placeholder="milestone-11-navigation-search"
                          className="w-full px-2.5 py-1.5 rounded-md bg-[#14161B] border border-[#22252B] text-zinc-100 font-mono text-[11px] focus:border-[#4CC2DE] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-zinc-400 mb-1">Root Directory in Repository:</label>
                        <input
                          type="text"
                          value={customRootDir}
                          onChange={(e) => setCustomRootDir(e.target.value)}
                          placeholder="."
                          className="w-full px-2.5 py-1.5 rounded-md bg-[#14161B] border border-[#22252B] text-zinc-100 font-mono text-[11px] focus:border-[#4CC2DE] focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleApplyGitRepoSelection}
                      className="px-3 py-1.5 rounded-md bg-[#4CC2DE] hover:bg-[#3db0cc] text-[#0A0B0D] font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Apply Repository Selection</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsConfiguringGitRepo(false)}
                      className="px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Remote Repository Content Mismatch Blocker Card with Interactive Git Readiness */}
              {plan.remotePreflight && !plan.remotePreflight.valid && plan.remotePreflight.code !== "DEPLOYMENT_SOURCE_UNCONFIGURED" && (
                <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/50 text-rose-200 text-xs space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-bold text-rose-100 text-sm">
                      <FolderGit2 className="w-4 h-4 text-rose-400 shrink-0" />
                      <span>Git Deployment Readiness: Remote Content Mismatch</span>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-rose-900/80 border border-rose-500/50 text-[10px] font-bold text-rose-200 uppercase tracking-wider">
                      BLOCKED
                    </span>
                  </div>

                  <p className="text-rose-200/90 text-xs leading-relaxed">
                    {plan.remotePreflight.reason || "The selected service root directory does not exist in the remote repository branch."}
                  </p>

                  <div className="bg-black/40 rounded-lg p-3 border border-rose-900/50 font-mono text-[11px] text-zinc-300 space-y-1">
                    {plan.remotePreflight.repository && (
                      <div><span className="text-zinc-500">Repository:</span> <span className="text-rose-300">{plan.remotePreflight.repository}</span></div>
                    )}
                    {plan.remotePreflight.branch && (
                      <div><span className="text-zinc-500">Branch:</span> <span className="text-amber-300">{plan.remotePreflight.branch}</span></div>
                    )}
                    {plan.remotePreflight.requestedRootDir && (
                      <div><span className="text-zinc-500">Requested rootDir:</span> <span className="text-zinc-200">{plan.remotePreflight.requestedRootDir}</span></div>
                    )}
                  </div>

                  {plan.remotePreflight.suggestedFix && (
                    <div className="text-[11px] text-rose-300/90 bg-rose-950/60 p-2.5 rounded-lg border border-rose-800/40">
                      <strong>Resolution:</strong> {plan.remotePreflight.suggestedFix}
                    </div>
                  )}

                  {/* Interactive Git Readiness Actions */}
                  <div className="pt-2 border-t border-rose-900/50 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const next = !isReviewingGitChanges;
                          setIsReviewingGitChanges(next);
                          if (next) refreshGitStatus();
                        }}
                        className="px-2.5 py-1 rounded bg-zinc-900/80 hover:bg-zinc-800 text-zinc-200 border border-zinc-700/60 text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        {isReviewingGitChanges ? <ChevronUp className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />}
                        <span>{isReviewingGitChanges ? "Hide Uncommitted Files" : "Review Local Changes"}</span>
                      </button>

                      <div className="flex items-center gap-2">
                        {plan.remotePreflight.isCommittedLocally && (
                          <button
                            type="button"
                            disabled={gitActionBusy}
                            onClick={handlePushGitChanges}
                            className="px-3 py-1 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                          >
                            {gitActionBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                            <span>Push to {plan.remotePreflight.branch || "Remote"}</span>
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={gitActionBusy || isUpdating}
                          onClick={handleRecheckGitReadiness}
                          className="px-3 py-1 rounded-md bg-[#14161B] hover:bg-[#1A1C22] disabled:opacity-50 text-[#4CC2DE] border border-[#22252B] text-[11px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${gitActionBusy || isUpdating ? "animate-spin" : ""}`} />
                          <span>Re-check Readiness</span>
                        </button>
                      </div>
                    </div>

                    {/* Action Feedback Banner */}
                    {gitActionStatus && (
                      <div className="p-2 rounded-md bg-[#14161B] border border-[#22252B] text-[#4CC2DE] text-[11px] flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#4CC2DE] shrink-0" />
                        <span>{gitActionStatus}</span>
                      </div>
                    )}
                    {gitActionError && (
                      <div className="p-2 rounded bg-rose-950/60 border border-rose-500/50 text-rose-300 text-[11px] flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                        <span>{gitActionError}</span>
                      </div>
                    )}

                    {/* Expanded Review & Staging/Commit UI */}
                    {isReviewingGitChanges && (
                      <div className="p-3 rounded-lg bg-black/50 border border-rose-900/60 space-y-3">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-semibold text-zinc-300">
                            Local files in <code className="text-zinc-200">{plan.remotePreflight.requestedRootDir}</code>
                          </span>
                          <span className="text-[10px] text-zinc-500">Explicit stage & commit</span>
                        </div>

                        {/* File items list */}
                        {relevantGitFiles.length === 0 ? (
                          <p className="text-[11px] text-zinc-400 italic">
                            {plan.remotePreflight.isCommittedLocally
                              ? "All files in this rootDir are committed locally. Click 'Push' above to sync with remote."
                              : "No uncommitted local files found in this root directory."}
                          </p>
                        ) : (
                          <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                            {relevantGitFiles.map((file) => (
                              <div
                                key={file.path}
                                className="flex items-center justify-between gap-2 p-1.5 rounded bg-zinc-900/60 border border-zinc-800 text-[11px]"
                              >
                                <div className="flex items-center gap-2 min-w-0 truncate">
                                  <span
                                    className={`px-1.5 py-0.2 rounded text-[10px] font-mono font-bold ${
                                      file.isStaged
                                        ? "bg-emerald-950 text-emerald-300 border border-emerald-500/40"
                                        : file.status === "??"
                                        ? "bg-amber-950 text-amber-300 border border-amber-500/40"
                                        : "bg-blue-950 text-blue-300 border border-blue-500/40"
                                    }`}
                                  >
                                    {file.isStaged ? "STAGED" : file.status === "??" ? "UNTRACKED" : file.status}
                                  </span>
                                  <span className="text-zinc-200 font-mono truncate text-[11px]" title={file.path}>
                                    {file.path.split(/[/\\]/).pop()}
                                    {(file.path.includes("/") || file.path.includes("\\")) && (
                                      <span className="text-[#5A6072] ml-1.5 text-[10px] font-mono font-normal">
                                        {file.path.substring(0, Math.max(file.path.lastIndexOf("/"), file.path.lastIndexOf("\\")) + 1)}
                                      </span>
                                    )}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  disabled={gitActionBusy}
                                  onClick={() => file.isStaged ? handleUnstageFile(file.path) : handleStageFile(file.path)}
                                  className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                                    file.isStaged
                                      ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
                                      : "bg-emerald-900/80 hover:bg-emerald-800 text-emerald-200 border border-emerald-500/40"
                                  }`}
                                >
                                  {file.isStaged ? "Unstage" : "Stage"}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Commit input & button */}
                        {hasStagedRelevantFiles && (
                          <div className="pt-2 border-t border-zinc-800/80 space-y-2">
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={gitCommitMessage}
                                onChange={(e) => setGitCommitMessage(e.target.value)}
                                placeholder={`feat: add ${plan.remotePreflight.requestedRootDir} for deployment`}
                                className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500 font-mono"
                              />
                              <button
                                type="button"
                                disabled={gitActionBusy || !gitCommitMessage.trim()}
                                onClick={handleCommitGitChanges}
                                className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                              >
                                {gitActionBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitCommit className="w-3.5 h-3.5" />}
                                <span>Commit</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Blockers list if any */}
              {plan.blockers.length > 0 && !plan.remotePreflight && (
                <div className="p-3.5 rounded-xl bg-rose-950/30 border border-rose-500/40 text-rose-300 text-xs space-y-2">
                  <div className="flex items-center gap-2 font-bold text-rose-200">
                    <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>Deployment Blockers ({plan.blockers.length})</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-1 text-rose-200/90 text-[11px]">
                    {plan.blockers.map((b, i) => (
                      <li key={i}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Missing Credentials Alert */}
              {missingProviders.length > 0 && (
                <div className="p-3.5 rounded-xl bg-amber-950/25 border border-amber-500/30 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 text-amber-300">
                    <Key className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>
                      Authentication required for selected provider: <strong>{missingProviders.map((p) => p.displayName).join(", ")}</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {missingProviders.map((p) => (
                      <button
                        key={p.providerId}
                        onClick={() => onOpenCredentials?.(p.providerId, p.displayName)}
                        className="px-2.5 py-1 rounded bg-amber-900/60 hover:bg-amber-800 text-amber-200 border border-amber-500/40 text-[11px] font-semibold transition-colors cursor-pointer"
                      >
                        Connect {p.displayName}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* SECTION 1: TOPOLOGY & USER-CONTROLLED TARGET SELECTION */}
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                    Target Components & Provider Selection
                  </h3>
                  <span className="text-[11px] text-zinc-500">
                    NEXUS recommends • You choose the provider
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {/* Database Target */}
                  {plan.topology.databases.map((db) => (
                    <div key={db.databaseId} className="p-4 rounded-xl bg-[#0e1017] border border-zinc-800/80 space-y-3.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Database className="w-4 h-4 text-amber-400" />
                          <span className="font-bold text-xs text-zinc-100">{db.name}</span>
                        </div>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-950/60 border border-amber-500/40 text-amber-300">
                          {db.technology.toUpperCase()}
                        </span>
                      </div>

                      <div className="space-y-2 text-xs">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-zinc-400">Recommended:</span>
                          <span className="text-zinc-300 font-mono">{db.recommendedProvider || "render_postgres"}</span>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] text-zinc-400 block font-semibold">Selected Target:</label>
                          <select
                            value={db.selectedProvider || db.recommendedProvider || "render_postgres"}
                            onChange={(e) => handleProviderSelect(db.databaseId, e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-xs font-mono text-zinc-200 focus:outline-none focus:border-cyan-500 cursor-pointer"
                          >
                            {DATABASE_PROVIDER_OPTIONS.map((opt) => (
                              <option key={opt.id} value={opt.id}>
                                {opt.name} {opt.executable ? "(Available)" : "(Not yet supported)"}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="pt-1 flex items-center justify-between text-[11px]">
                          <span className="text-zinc-400">Execution:</span>
                          <span className={db.executionAvailable ? "text-emerald-400 font-semibold" : "text-amber-400 font-semibold"}>
                            {db.executionAvailable ? "AVAILABLE (Simulated)" : "NOT YET SUPPORTED"}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Service Targets */}
                  {plan.topology.services.map((svc) => {
                    const options = svc.type === "FRONTEND" ? FRONTEND_PROVIDER_OPTIONS : BACKEND_PROVIDER_OPTIONS;
                    return (
                      <div key={svc.serviceId} className="p-4 rounded-xl bg-[#0e1017] border border-zinc-800/80 space-y-3.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {svc.type === "FRONTEND" ? <Globe className="w-4 h-4 text-emerald-400" /> : <Server className="w-4 h-4 text-blue-400" />}
                            <span className="font-bold text-xs text-zinc-100">{svc.name}</span>
                          </div>
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-800 border border-zinc-700 text-zinc-300">
                            {svc.framework}
                          </span>
                        </div>

                        <div className="space-y-2 text-xs">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-zinc-400">Recommended:</span>
                            <span className="text-zinc-300 font-mono capitalize">{svc.recommendedProvider || "Unknown"}</span>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[11px] text-zinc-400 block font-semibold">Selected Target:</label>
                            <select
                              value={svc.selectedProvider || svc.recommendedProvider || ""}
                              onChange={(e) => handleProviderSelect(svc.serviceId, e.target.value)}
                              className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-xs font-mono text-zinc-200 focus:outline-none focus:border-cyan-500 cursor-pointer"
                            >
                              {options.map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.name} {opt.executable ? "(Available)" : "(Not yet supported)"}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="pt-1 flex items-center justify-between text-[11px]">
                            <span className="text-zinc-400">Execution:</span>
                            <span className={svc.executionAvailable ? "text-emerald-400 font-semibold" : "text-amber-400 font-semibold"}>
                              {svc.executionAvailable ? "AVAILABLE ✓" : "NOT YET SUPPORTED"}
                            </span>
                          </div>

                          {!svc.executionAvailable && (
                            <div className="p-2 rounded bg-amber-950/30 border border-amber-500/30 text-amber-300 text-[10.5px]">
                              {svc.providerDisplayName} is selected, but execution support is not yet available in NEXUS.
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* SECTION 2: TOPOLOGICAL EXECUTION PIPELINE */}
              {plan.executionOrder.length > 0 && (
                <section className="space-y-3">
                  <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                    Deployment Pipeline Order ({plan.executionOrder.length} Stages)
                  </h3>

                  <div className="p-4 rounded-xl bg-[#0e1017] border border-zinc-800/80">
                    <div className="flex flex-wrap items-center gap-2">
                      {plan.executionOrder.map((nodeId, idx) => (
                        <React.Fragment key={nodeId}>
                          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700/80 text-xs font-mono">
                            <span className="w-5 h-5 rounded-full bg-cyan-950 border border-cyan-500/50 text-cyan-300 flex items-center justify-center font-bold text-[10px]">
                              {idx + 1}
                            </span>
                            <span className="text-zinc-200 font-semibold">{nodeId}</span>
                          </div>
                          {idx < plan.executionOrder.length - 1 && (
                            <ArrowRight className="w-4 h-4 text-zinc-600 shrink-0" />
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <footer className="px-5 py-3.5 border-t border-zinc-800 bg-[#0e1017] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <Info className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <span>Deterministic multi-service topology • User-selected targets</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700 transition-colors cursor-pointer"
            >
              Close
            </button>

            {hasDeployableComponents && (
              <div className="relative group">
                <button
                  disabled={!canDeploy}
                  onClick={() => setShowConfirmation(true)}
                  className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    canDeploy
                      ? "bg-[#4CC2DE] hover:bg-[#3db0cc] text-[#0A0B0D]"
                      : "bg-[#14161B] text-[#868C96] border border-[#22252B] cursor-not-allowed opacity-60"
                  }`}
                  title={deployDisabledReason || "Deploy complete multi-service project"}
                >
                  <Rocket className="w-3.5 h-3.5" />
                  <span>Deploy Complete Project</span>
                </button>
              </div>
            )}
          </div>
        </footer>

        {/* EXPLICIT CONFIRMATION MODAL */}
        {showConfirmation && plan && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150">
            <div className="w-full max-w-lg bg-[#111318] border border-[#22252B] rounded-xl shadow-modal overflow-hidden text-[#E1E4EA] font-sans">
              <div className="px-5 py-4 border-b border-[#22252B] bg-[#0E1013] flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[#14161B] border border-[#22252B] text-[#4CC2DE]">
                  <Rocket className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#E1E4EA]">CONFIRM COMPLETE PROJECT DEPLOYMENT</h3>
                  <p className="text-[11px] text-[#868C96]">Explicit user approval required prior to cloud execution</p>
                </div>
              </div>

              <div className="p-5 space-y-4 text-xs">
                <div>
                  <span className="text-[#868C96] font-medium">Workspace:</span>
                  <div className="mt-1 p-2 rounded bg-[#0E1013] border border-[#22252B] font-mono text-[11px] text-[#CCCCCC] break-all">
                    {workspacePath}
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="text-[#868C96] font-medium">Deployment Topology & Selected Providers:</span>
                  <div className="space-y-1.5">
                    {plan.topology.databases.map((db, i) => (
                      <div key={db.databaseId} className="flex items-center justify-between p-2 rounded bg-[#0E1013] border border-[#22252B] text-[11px]">
                        <span>{i + 1}. Database: <strong>{db.name}</strong></span>
                        <span className="text-amber-400 font-mono font-medium">{db.providerDisplayName}</span>
                      </div>
                    ))}
                    {plan.topology.services.map((svc, i) => (
                      <div key={svc.serviceId} className="flex items-center justify-between p-2 rounded bg-[#0E1013] border border-[#22252B] text-[11px]">
                        <span>{plan.topology.databases.length + i + 1}. {svc.type}: <strong>{svc.name}</strong></span>
                        <span className="text-[#4CC2DE] font-mono font-medium">{svc.providerDisplayName}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-500/30 text-amber-200 text-[11px] space-y-1.5">
                  <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>Important Notices</span>
                  </div>
                  <ul className="list-disc pl-4 space-y-1 text-amber-200/90">
                    <li>Deployment uses the current local workspace state. NEXUS will not commit, stash, reset, or push Git changes.</li>
                    <li>Deployment will execute against your selected providers.</li>
                    <li>Database provisioning is currently simulated for this validation phase.</li>
                  </ul>
                </div>
              </div>

              <div className="px-5 py-3.5 border-t border-[#22252B] bg-[#0E1013] flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowConfirmation(false)}
                  className="px-4 py-1.5 rounded-md text-xs font-medium bg-[#1A1C22] hover:bg-[#22252B] text-[#CCCCCC] border border-[#22252B] transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmDeploy}
                  disabled={isConfirmingDeployment}
                  className="px-4 py-1.5 rounded-md text-xs font-medium bg-[#4CC2DE] hover:bg-[#3db0cc] text-[#0A0B0D] transition-colors cursor-pointer"
                >
                  {isConfirmingDeployment ? "Starting…" : "Confirm & Deploy"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
