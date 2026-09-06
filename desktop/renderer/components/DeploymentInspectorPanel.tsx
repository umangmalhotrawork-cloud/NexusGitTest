"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Rocket,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  FileCode,
  Layers,
  Server,
  Layout,
  Database,
  Key,
  FolderTree,
  ChevronRight,
  ChevronDown,
  ArrowRight,
  ExternalLink,
  ShieldAlert,
  Info,
  Sparkles,
  Lock,
  Cloud,
  Cpu,
  HardDrive,
  Award,
  Compass,
  FolderGit2,
  GitBranch,
} from "lucide-react";
import DeploymentConfigPreviewModal from "./DeploymentConfigPreviewModal";
import DeploymentCredentialsModal from "./DeploymentCredentialsModal";
import DeploymentConsoleModal from "./DeploymentConsoleModal";
import DeploymentPlanModal from "./DeploymentPlanModal";
import DeploymentAdvisorModal from "./DeploymentAdvisorModal";

export interface DeploymentRepositoryContextUI {
  workspacePath: string;
  projectRoot: string;
  gitRoot: string | null;
  remoteUrl: string | null;
  branch: string | null;
  repositorySource: "WORKSPACE_GIT" | "PARENT_GIT" | "EXPLICIT_PROVIDER_REPOSITORY" | "NONE";
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  hasOwnGit: boolean;
  isNestedInParentRepo: boolean;
  parentGitRoot: string | null;
  parentRepoName: string | null;
  parentRemoteUrl: string | null;
  parentBranch: string | null;
}

export interface DeploymentEvidenceUI {
  file: string;
  line?: number;
  column?: number;
  snippet?: string;
  description?: string;
}

export interface DeploymentFindingUI {
  id: string;
  ruleId?: string;
  severity: "BLOCKER" | "WARNING" | "INFO";
  category: "FRONTEND" | "BACKEND" | "DATABASE" | "ENVIRONMENT" | "MONOREPO" | "CONTAINER" | "GENERAL";
  title: string;
  message: string;
  evidence: DeploymentEvidenceUI[];
  recommendation?: string;
}

export interface PlatformBlockerUI {
  code: string;
  title: string;
  message: string;
  recommendation?: string;
}

export interface PlatformWarningUI {
  code: string;
  title: string;
  message: string;
  recommendation?: string;
}

export interface PlatformRecommendationUI {
  providerId: string;
  displayName: string;
  suitability: "EXCELLENT" | "GOOD" | "CONDITIONAL" | "POOR" | "INCOMPATIBLE";
  score: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  computeTarget: {
    serviceType: string;
    rootDir: string | null;
    buildCommand: string | null;
    startCommand: string | null;
    outputDir: string | null;
  };
  databaseTarget: {
    strategy: string;
    recommendedProvider: string | null;
    rationale: string;
  };
  reasons: string[];
  blockers: PlatformBlockerUI[];
  warnings: PlatformWarningUI[];
}

export interface DeploymentReportUI {
  workspacePath: string;
  inspectedAt: number;
  overallStatus: "READY" | "WARNING" | "BLOCKED" | "UNKNOWN";
  summary: string;
  project: {
    isMonorepo: boolean;
    workspaces: string[];
    packageManager: string | null;
    hasDocker: boolean;
    dockerfile: string | null;
    dockerCompose: string | null;
  };
  frontend: {
    detected: boolean;
    framework: string | null;
    buildScript: string | null;
    buildScriptDescription?: string | null;
    outputDirectory: string | null;
    isStaticExport: boolean;
    isSSR: boolean;
    status: "READY" | "WARNING" | "BLOCKED" | "UNKNOWN";
    evidence: DeploymentEvidenceUI[];
  } | null;
  backend: {
    detected: boolean;
    runtime: string | null;
    framework: string | null;
    entryPoint: string | null;
    startCommand: string | null;
    startCommandDescription?: string | null;
    buildScriptDescription?: string | null;
    port: number | null;
    portIsDynamic: boolean;
    hostBinding: string | null;
    isHostBindingSafe: boolean;
    status: "READY" | "WARNING" | "BLOCKED" | "UNKNOWN";
    evidence: DeploymentEvidenceUI[];
  } | null;
  database: {
    detected: boolean;
    technology: string | null;
    ormOrDriver: string | null;
    configFile: string | null;
    migrationStatus: string | null;
    usesLocalhost: boolean;
    usesEnvVar: boolean;
    isSQLite: boolean;
    isEphemeralStorageRisk: boolean;
    status: "READY" | "WARNING" | "BLOCKED" | "UNKNOWN";
    evidence: DeploymentEvidenceUI[];
  } | null;
  findings: DeploymentFindingUI[];
  environmentVariables: {
    required: string[];
    documented: string[];
    missingDocumentation: string[];
    evidence: DeploymentEvidenceUI[];
  };
  recommendedProvider?: string | null;
  platformRecommendations?: PlatformRecommendationUI[];
  deploymentRepositoryContext?: DeploymentRepositoryContextUI | null;
}

interface DeploymentInspectorPanelProps {
  workspacePath?: string;
  onOpenFile?: (filePath: string, line?: number) => void;
  onAskAgentToFix?: (prompt: string) => void;
  onClose?: () => void;
}

export default function DeploymentInspectorPanel({
  workspacePath,
  onOpenFile,
  onAskAgentToFix,
  onClose,
}: DeploymentInspectorPanelProps) {
  const [report, setReport] = useState<DeploymentReportUI | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<"ALL" | "BLOCKER" | "WARNING" | "INFO">("ALL");
  const [previewModal, setPreviewModal] = useState<{ isOpen: boolean; providerId: string; displayName: string } | null>(null);
  const [credentialsModal, setCredentialsModal] = useState<{ isOpen: boolean; providerId: string; displayName: string } | null>(null);
  const [deployConsoleModal, setDeployConsoleModal] = useState<{ isOpen: boolean; plan?: any; providerId?: string; displayName?: string; rootDir?: string | null; requestId?: string } | null>(null);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showAdvisorModal, setShowAdvisorModal] = useState(false);
  const [userSelections, setUserSelections] = useState<Record<string, string>>({});
  const [isVercelConnected, setIsVercelConnected] = useState(false);

  const checkVercelAuth = useCallback(async () => {
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.intelligence?.getProviderAuthStatus) {
        const res = await electronAPI.intelligence.getProviderAuthStatus("vercel");
        setIsVercelConnected(Boolean(res?.isConnected));
      }
    } catch (_) {}
  }, []);

  const runInspection = useCallback(async () => {
    if (!workspacePath) return;
    setLoading(true);
    setError(null);
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.intelligence?.inspectDeployment) {
        const res = await electronAPI.intelligence.inspectDeployment({ workspacePath });
        setReport(res);
      } else {
        setError("Deployment inspection API is not available.");
      }
      checkVercelAuth();
    } catch (err: any) {
      setError(err?.message || "Failed to inspect workspace deployment.");
    } finally {
      setLoading(false);
    }
  }, [workspacePath, checkVercelAuth]);

  const loadPersistedSelections = useCallback(async () => {
    if (!workspacePath) return;
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.intelligence?.getDeploymentSelections) {
        const saved = await electronAPI.intelligence.getDeploymentSelections({ workspacePath });
        if (saved && typeof saved === "object" && Object.keys(saved).length > 0) {
          console.log("[DeploymentSelection] [DeploymentInspectorPanel] Loaded persisted selections:", saved);
          setUserSelections(saved);
        }
      }
    } catch (_) {}
  }, [workspacePath]);

  useEffect(() => {
    runInspection();
    checkVercelAuth();
    loadPersistedSelections();
  }, [runInspection, checkVercelAuth, loadPersistedSelections]);

  const filteredFindings = (report?.findings || []).filter((f) => {
    if (filterSeverity === "ALL") return true;
    return f.severity === filterSeverity;
  });

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case "READY":
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5" />
            READY
          </span>
        );
      case "WARNING":
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-950/60 text-amber-400 border border-amber-500/30 shrink-0">
            <AlertTriangle className="w-3.5 h-3.5" />
            WARNINGS
          </span>
        );
      case "BLOCKED":
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-rose-950/60 text-rose-400 border border-rose-500/30 shrink-0">
            <XCircle className="w-3.5 h-3.5" />
            BLOCKED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-[#1A1C22] text-[#8C92A4] border border-[#22252B] shrink-0">
            <HelpCircle className="w-3.5 h-3.5" />
            UNKNOWN
          </span>
        );
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case "BLOCKER":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950/90 text-rose-300 border border-rose-500/40 shrink-0">
            BLOCKER
          </span>
        );
      case "WARNING":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950/90 text-amber-300 border border-amber-500/40 shrink-0">
            WARNING
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-950/90 text-cyan-300 border border-cyan-500/40 shrink-0">
            INFO
          </span>
        );
    }
  };

  const getSuitabilityBadge = (suitability: string) => {
    switch (suitability) {
      case "EXCELLENT":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-950/60 text-emerald-300 border border-emerald-500/30 shrink-0">
            EXCELLENT FIT
          </span>
        );
      case "GOOD":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#14161B] text-[#4CC2DE] border border-[#4CC2DE]/30 shrink-0">
            GOOD FIT
          </span>
        );
      case "CONDITIONAL":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-950/60 text-amber-300 border border-amber-500/30 shrink-0">
            CONDITIONAL
          </span>
        );
      case "POOR":
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#14161B] text-[#8C92A4] border border-[#22252B] shrink-0">
            POOR FIT
          </span>
        );
      case "INCOMPATIBLE":
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-rose-950/60 text-rose-400 border border-rose-500/30 shrink-0">
            INCOMPATIBLE
          </span>
        );
    }
  };

  const formatServiceType = (st?: string) => {
    if (!st) return "None";
    switch (st) {
      case "STATIC_SITE":
        return "Static Site (CDN)";
      case "WEB_SERVICE":
        return "Web Service (Long-running process)";
      case "SERVERLESS":
        return "Serverless Edge Function";
      case "DOCKER_CONTAINER":
        return "Docker Container";
      default:
        return st;
    }
  };

  const recommendations = report?.platformRecommendations || [];
  const hasValidRecommendations = recommendations.some((r) => r.suitability === "EXCELLENT" || r.suitability === "GOOD" || r.suitability === "CONDITIONAL");

  return (
    <div className="w-full h-full flex flex-col bg-[#0E1013] text-zinc-200 font-mono select-none overflow-hidden min-w-0">
      {/* Top Header */}
      <header className="px-4 py-2.5 sm:px-5 border-b border-[#22252B] bg-[#0E1013] flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-7 h-7 rounded-md bg-[#14161B] border border-[#22252B] flex items-center justify-center text-[#4CC2DE] shrink-0">
            <Rocket className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-sm font-semibold text-zinc-100 tracking-tight shrink-0">Deployment Inspector</h1>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#14161B] text-[#8C92A4] border border-[#22252B] shrink-0 font-sans">
                Local Intelligence
              </span>
            </div>
            <p className="text-[11px] text-[#8C92A4] truncate max-w-md block" title={workspacePath || ""}>
              {workspacePath ? (
                <>
                  <span className="text-zinc-300 font-medium">{workspacePath.split("/").pop()}</span>
                  <span className="text-[#5A6072] ml-1.5">{workspacePath}</span>
                </>
              ) : (
                "No workspace opened"
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {report && getStatusBadge(report.overallStatus)}
          <button
            onClick={runInspection}
            disabled={loading || !workspacePath}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#4CC2DE] hover:bg-[#38b2ce] text-[#0E1013] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="shrink-0">{loading ? "Inspecting…" : "Inspect Project"}</span>
          </button>
        </div>
      </header>

      {/* Main Single Scroll Container */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5 space-y-4">
        {error && (
          <div className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-3">
            <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
            <div className="min-w-0">
              <p className="font-bold">Inspection Error</p>
              <p className="break-words">{error}</p>
            </div>
          </div>
        )}

        {loading && (
          <div className="p-8 rounded-xl bg-[#11131c] border border-cyan-500/30 text-center space-y-3">
            <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin mx-auto" />
            <p className="text-xs text-cyan-300 font-semibold">Analyzing deployment readiness & platform compatibility…</p>
          </div>
        )}

        {/* Initial Centered Empty State */}
        {!report && !loading && !error && (
          <div className="h-full min-h-[320px] flex flex-col items-center justify-center text-center p-8 space-y-3">
            <div className="w-12 h-12 rounded-xl bg-[#14161B] border border-[#22252B] flex items-center justify-center text-[#4CC2DE]">
              <Rocket className="w-6 h-6" />
            </div>
            <div className="space-y-1 max-w-sm">
              <h3 className="text-sm font-medium text-[#E6E8EB]">Ready to Inspect Deployment</h3>
              <p className="text-xs text-[#9AA1AC]">
                Click "Inspect Project" to evaluate framework manifests, runtime bindings, container requirements, and target platform compatibility.
              </p>
            </div>
          </div>
        )}

        {/* Overall Status Banner */}
        {report && !loading && (
          <div className={`p-3.5 rounded-xl border flex items-start gap-3 min-w-0 ${
            report.overallStatus === "READY"
              ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-300"
              : report.overallStatus === "WARNING"
              ? "bg-amber-950/20 border-amber-500/30 text-amber-300"
              : report.overallStatus === "BLOCKED"
              ? "bg-rose-950/20 border-rose-500/30 text-rose-300"
              : "bg-zinc-900/40 border-zinc-800 text-zinc-300"
          }`}>
            <div className="mt-0.5 shrink-0">
              {report.overallStatus === "READY" && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
              {report.overallStatus === "WARNING" && <AlertTriangle className="w-5 h-5 text-amber-400" />}
              {report.overallStatus === "BLOCKED" && <XCircle className="w-5 h-5 text-rose-400" />}
              {report.overallStatus === "UNKNOWN" && <HelpCircle className="w-5 h-5 text-zinc-400" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <h2 className="text-xs font-bold text-zinc-100">
                  {report.overallStatus === "READY" && "Project Ready for Deployment"}
                  {report.overallStatus === "WARNING" && "Deployment Warnings Detected"}
                  {report.overallStatus === "BLOCKED" && "Deployment Blockers Detected"}
                  {report.overallStatus === "UNKNOWN" && "Inspection Status Inconclusive"}
                </h2>
                <span className="text-[10px] text-zinc-500">
                  {new Date(report.inspectedAt).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-xs text-zinc-300 mt-1 leading-relaxed break-words">{report.summary}</p>
            </div>
          </div>
        )}

        {/* Project Repository Boundary Card */}
        {report?.deploymentRepositoryContext && !loading && (
          <div className="p-3.5 rounded-xl bg-[#101422] border border-cyan-500/30 text-xs space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-bold text-zinc-100">
                <FolderGit2 className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>Project Repository Boundary</span>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                  userSelections.executionSource === "LOCAL_WORKSPACE"
                    ? "bg-emerald-950/80 border border-emerald-500/40 text-emerald-300"
                    : report.deploymentRepositoryContext.repositorySource === "WORKSPACE_GIT" || report.deploymentRepositoryContext.repositorySource === "EXPLICIT_PROVIDER_REPOSITORY" || userSelections.repository
                    ? "bg-cyan-950/80 border border-cyan-500/40 text-cyan-300"
                    : "bg-amber-950/80 border border-amber-500/40 text-amber-300"
                }`}
              >
                {userSelections.executionSource === "LOCAL_WORKSPACE"
                  ? "LOCAL WORKSPACE"
                  : userSelections.repository
                  ? "GIT REMOTE (CONFIGURED)"
                  : report.deploymentRepositoryContext.repositorySource === "WORKSPACE_GIT"
                  ? "WORKSPACE GIT"
                  : "CONFIGURATION REQUIRED"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px] font-mono bg-[#14161B] p-3 rounded-lg border border-[#22252B] text-zinc-300">
              <div className="min-w-0">
                <span className="text-[#8C92A4]">Workspace:</span>{" "}
                <span className="text-zinc-200 font-medium truncate" title={report.deploymentRepositoryContext.workspacePath || ""}>
                  {report.deploymentRepositoryContext.workspacePath ? report.deploymentRepositoryContext.workspacePath.split("/").pop() : "Current"}
                </span>
              </div>
              <div className="min-w-0">
                <span className="text-[#8C92A4]">Parent Git repo:</span>{" "}
                <span className="text-zinc-300">{report.deploymentRepositoryContext.parentRepoName || "None"}</span>
                {report.deploymentRepositoryContext.isNestedInParentRepo && (
                  <span className="text-[10px] text-amber-400/90 ml-1.5">(Detected: YES, Not used automatically)</span>
                )}
              </div>
              <div className="min-w-0 sm:col-span-2">
                <span className="text-[#8C92A4]">Deployment repository:</span>{" "}
                <span className={`break-all ${userSelections.repository || report.deploymentRepositoryContext.remoteUrl ? "text-[#4CC2DE]" : "text-amber-300"}`}>
                  {userSelections.repository || report.deploymentRepositoryContext.remoteUrl || "Not selected"}
                </span>
              </div>
              <div className="min-w-0 sm:col-span-2">
                <span className="text-[#8C92A4]">Execution source:</span>{" "}
                <span className="text-zinc-200 font-medium">
                  {userSelections.executionSource || (report.deploymentRepositoryContext.repositorySource === "WORKSPACE_GIT" ? "GIT_REMOTE" : "Not selected")}
                </span>
              </div>
            </div>

            {report.deploymentRepositoryContext.repositorySource === "PARENT_GIT" && !userSelections.repository && userSelections.executionSource !== "LOCAL_WORKSPACE" && (
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <p className="text-[11px] text-zinc-400">
                  Parent repository will NOT be used automatically for deployment. Choose deployment source:
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      const updated = { ...userSelections, executionSource: "LOCAL_WORKSPACE" };
                      setUserSelections(updated);
                      const electronAPI = (window as any).electronAPI;
                      if (electronAPI?.intelligence?.saveDeploymentSelections && workspacePath) {
                        await electronAPI.intelligence.saveDeploymentSelections({ workspacePath, selections: updated });
                      }
                      setShowPlanModal(true);
                    }}
                    className="px-2.5 py-1 rounded bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-500/40 text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <span>Use Local Workspace</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowPlanModal(true)}
                    className="px-2.5 py-1 rounded bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border border-cyan-500/40 text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <span>Select Git Repository</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Subsystems Breakdown Grid (Responsive auto-fit) */}
        {report && !loading && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3">
            {/* Frontend Card */}
            <div className="p-3.5 rounded-xl bg-[#11131c] border border-zinc-800/80 flex flex-col justify-between min-w-0 space-y-3">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 text-cyan-400 min-w-0">
                    <Layout className="w-4 h-4 shrink-0" />
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-200 truncate">Frontend</span>
                  </div>
                  {report.frontend ? getStatusBadge(report.frontend.status) : <span className="text-[10px] text-zinc-500 shrink-0">Not Detected</span>}
                </div>

                {report.frontend ? (
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-zinc-500 shrink-0">Framework:</span>
                      <span className="font-semibold text-zinc-200 capitalize truncate text-right">{report.frontend.framework}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-zinc-500 shrink-0">Build Script:</span>
                      <span className="font-mono text-zinc-300 truncate text-right">{report.frontend.buildScript || "None"}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-zinc-500 shrink-0">Output Dir:</span>
                      <span className="font-mono text-cyan-300 truncate text-right">{report.frontend.outputDirectory || "None"}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-zinc-500 shrink-0">Mode:</span>
                      <span className="text-zinc-300 truncate text-right">
                        {report.frontend.isStaticExport ? "Static Export" : report.frontend.isSSR ? "SSR" : "Client SPA"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500 py-1">No frontend web framework detected in repository manifests.</p>
                )}
              </div>

              {report.frontend?.evidence?.[0]?.file && (
                <button
                  onClick={() => onOpenFile?.(report.frontend!.evidence[0].file, report.frontend!.evidence[0].line)}
                  className="pt-2.5 border-t border-zinc-800/60 text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1.5 min-w-0 w-full cursor-pointer"
                >
                  <FileCode className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate min-w-0">{report.frontend.evidence[0].file}</span>
                </button>
              )}
            </div>

            {/* Backend Card */}
            <div className="p-3.5 rounded-xl bg-[#11131c] border border-zinc-800/80 flex flex-col justify-between min-w-0 space-y-3">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 text-emerald-400 min-w-0">
                    <Server className="w-4 h-4 shrink-0" />
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-200 truncate">Backend</span>
                  </div>
                  {report.backend ? getStatusBadge(report.backend.status) : <span className="text-[10px] text-zinc-500 shrink-0">Not Detected</span>}
                </div>

                {report.backend ? (
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-zinc-500 shrink-0">Runtime:</span>
                      <span className="font-semibold text-zinc-200 uppercase truncate text-right">
                        {report.backend.runtime} ({report.backend.framework})
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-zinc-500 shrink-0">Start Cmd:</span>
                      <span className="font-mono text-zinc-300 truncate text-right">{report.backend.startCommand || "None"}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-zinc-500 shrink-0">Host Binding:</span>
                      <span className={`font-semibold text-right truncate ${report.backend.isHostBindingSafe ? "text-emerald-400" : "text-rose-400"}`}>
                        {report.backend.hostBinding} {report.backend.isHostBindingSafe ? "✓" : "✗"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500 py-1">No backend API server or runtime detected in workspace.</p>
                )}
              </div>

              {report.backend?.evidence?.[0]?.file && (
                <button
                  onClick={() => onOpenFile?.(report.backend!.evidence[0].file, report.backend!.evidence[0].line)}
                  className="pt-2.5 border-t border-zinc-800/60 text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1.5 min-w-0 w-full cursor-pointer"
                >
                  <FileCode className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate min-w-0">{report.backend.evidence[0].file}{report.backend.evidence[0].line ? `:${report.backend.evidence[0].line}` : ""}</span>
                </button>
              )}
            </div>

            {/* Database Card */}
            <div className="p-3.5 rounded-xl bg-[#11131c] border border-zinc-800/80 flex flex-col justify-between min-w-0 space-y-3">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 text-amber-400 min-w-0">
                    <Database className="w-4 h-4 shrink-0" />
                    <span className="text-xs font-bold uppercase tracking-wider text-zinc-200 truncate">Database</span>
                  </div>
                  {report.database ? getStatusBadge(report.database.status) : <span className="text-[10px] text-zinc-500 shrink-0">Not Detected</span>}
                </div>

                {report.database ? (
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-zinc-500 shrink-0">Database:</span>
                      <span className="font-semibold text-zinc-200 capitalize truncate text-right">{report.database.technology}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-zinc-500 shrink-0">ORM / Driver:</span>
                      <span className="font-mono text-zinc-300 truncate text-right">{report.database.ormOrDriver || "Raw"}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-zinc-500 shrink-0">Config:</span>
                      <span className={`font-semibold text-right truncate ${report.database.usesLocalhost ? "text-amber-400" : "text-emerald-400"}`}>
                        {report.database.usesLocalhost ? "Localhost ⚠" : "Env Var ✓"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500 py-1">No database client, ORM, or schema files detected.</p>
                )}
              </div>

              {report.database?.evidence?.[0]?.file && (
                <button
                  onClick={() => onOpenFile?.(report.database!.evidence[0].file, report.database!.evidence[0].line)}
                  className="pt-2.5 border-t border-zinc-800/60 text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1.5 min-w-0 w-full cursor-pointer"
                >
                  <FileCode className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate min-w-0">{report.database.evidence[0].file}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Phase 2B: RECOMMENDED DEPLOYMENT PLATFORMS */}
        {report && !loading && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
              <div className="flex items-center gap-2">
                <Cloud className="w-4 h-4 text-cyan-400 shrink-0" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-200">
                  Recommended Deployment Platforms
                </h3>
              </div>
              <span className="text-[10px] text-zinc-500 shrink-0">
                Platform Compatibility
              </span>
            </div>

            {recommendations.length === 0 || !hasValidRecommendations ? (
              <div className="p-6 rounded-xl bg-[#11131c] border border-zinc-800/80 text-center space-y-2">
                <div className="w-9 h-9 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center mx-auto text-zinc-400">
                  <HelpCircle className="w-5 h-5" />
                </div>
                <p className="text-xs text-zinc-300 font-bold">No suitable deployment platform found.</p>
                <p className="text-[11px] text-zinc-500 max-w-sm mx-auto leading-relaxed">
                  Insufficient repository evidence to determine a reliable cloud deployment target for this workspace.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {recommendations.map((rec, idx) => {
                  const isTopRanked = idx === 0 && (rec.suitability === "EXCELLENT" || rec.suitability === "GOOD");

                  return (
                    <div
                      key={rec.providerId}
                      className={`p-4 rounded-xl border transition-all space-y-3.5 min-w-0 ${
                        isTopRanked
                          ? "bg-[#14161B] border-[#4CC2DE]/40"
                          : rec.suitability === "EXCELLENT" || rec.suitability === "GOOD"
                          ? "bg-[#111318] border-[#22252B]"
                          : rec.suitability === "CONDITIONAL"
                          ? "bg-[#111318] border-amber-500/20"
                          : "bg-[#0E1013] border-[#22252B] opacity-70"
                      }`}
                    >
                      {/* Provider Card Header */}
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                            isTopRanked
                              ? "bg-cyan-950 text-cyan-300 border border-cyan-500/40"
                              : "bg-zinc-900 text-zinc-300 border border-zinc-800"
                          }`}>
                            {idx + 1}
                          </div>
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <h4 className="text-sm font-bold text-zinc-100 truncate">{rec.displayName}</h4>
                              {getSuitabilityBadge(rec.suitability)}
                              {isTopRanked && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-500/50 shrink-0">
                                  <Award className="w-3 h-3 text-cyan-400" />
                                  Recommended
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                              <span className="text-[11px] text-zinc-400">
                                Confidence: <strong className="text-zinc-300 font-semibold">{rec.confidence}</strong>
                              </span>
                              <span className="text-zinc-600">•</span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  rec.providerId === "vercel" || rec.providerId === "render" || rec.providerId === "netlify"
                                    ? "bg-emerald-950/60 border border-emerald-500/40 text-emerald-300"
                                    : "bg-zinc-800 border border-zinc-700 text-zinc-400"
                                }`}
                              >
                                {rec.providerId === "vercel" || rec.providerId === "render" || rec.providerId === "netlify"
                                  ? "Execution: AVAILABLE"
                                  : "Execution: NOT YET SUPPORTED"}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0 ml-auto">
                          <div className="text-sm font-bold text-cyan-400">
                            {rec.score} <span className="text-zinc-500 text-xs font-normal">/ 100</span>
                          </div>
                          <span className="text-[10px] text-zinc-500 block">compatibility</span>
                        </div>
                      </div>

                      {/* Reasons List */}
                      {rec.reasons && rec.reasons.length > 0 && (
                        <div className="pt-2.5 border-t border-zinc-800/60 space-y-1">
                          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">Why this fits:</span>
                          <ul className="space-y-1">
                            {rec.reasons.map((r, rIdx) => (
                              <li key={rIdx} className="text-xs text-zinc-300 flex items-start gap-2 min-w-0">
                                <span className="text-cyan-400 shrink-0 mt-0.5">•</span>
                                <span className="break-words leading-relaxed">{r}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Compute & Database Target Breakdown (Auto-fit Grid) */}
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5 pt-2.5 border-t border-zinc-800/60 text-xs">
                        {/* Compute Target */}
                        <div className="p-2.5 rounded-lg bg-[#0a0b10] border border-zinc-800/80 space-y-1 min-w-0">
                          <div className="flex items-center gap-1.5 text-cyan-400 font-bold text-[10px] uppercase tracking-wider">
                            <Cpu className="w-3.5 h-3.5 shrink-0" />
                            <span>Application Compute</span>
                          </div>
                          <div className="text-zinc-300 font-semibold truncate">
                            {formatServiceType(rec.computeTarget?.serviceType)}
                          </div>
                          {rec.computeTarget?.rootDir && (
                            <div className="text-[11px] text-zinc-400 truncate">
                              <span className="text-zinc-500">Root: </span>
                              <code className="text-cyan-300 font-mono">{rec.computeTarget.rootDir}</code>
                            </div>
                          )}
                          {rec.computeTarget?.buildCommand && (
                            <div className="text-[11px] text-zinc-400 truncate">
                              <span className="text-zinc-500">Build: </span>
                              <code className="text-zinc-300 font-mono">{rec.computeTarget.buildCommand}</code>
                            </div>
                          )}
                          {rec.computeTarget?.startCommand && (
                            <div className="text-[11px] text-zinc-400 truncate">
                              <span className="text-zinc-500">Start: </span>
                              <code className="text-zinc-300 font-mono">{rec.computeTarget.startCommand}</code>
                            </div>
                          )}
                          {rec.computeTarget?.outputDir && (
                            <div className="text-[11px] text-zinc-400 truncate">
                              <span className="text-zinc-500">Output: </span>
                              <code className="text-cyan-300 font-mono">{rec.computeTarget.outputDir}</code>
                            </div>
                          )}
                        </div>

                        {/* Database Target */}
                        <div className="p-2.5 rounded-lg bg-[#0a0b10] border border-zinc-800/80 space-y-1 min-w-0">
                          <div className="flex items-center gap-1.5 text-amber-400 font-bold text-[10px] uppercase tracking-wider">
                            <HardDrive className="w-3.5 h-3.5 shrink-0" />
                            <span>Database Storage</span>
                          </div>
                          <div className="text-zinc-300 font-semibold truncate capitalize">
                            {rec.databaseTarget?.recommendedProvider ? rec.databaseTarget.recommendedProvider.replace(/_/g, " ") : "Not Required"}
                          </div>
                          <div className="text-[11px] text-zinc-400 truncate">
                            <span className="text-zinc-500">Strategy: </span>
                            <span className="text-amber-300 font-semibold">{rec.databaseTarget?.strategy || "NOT_REQUIRED"}</span>
                          </div>
                          {rec.databaseTarget?.rationale && (
                            <p className="text-[11px] text-zinc-400 leading-relaxed break-words">
                              {rec.databaseTarget.rationale}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Blockers */}
                      {rec.blockers && rec.blockers.length > 0 && (
                        <div className="space-y-2 pt-1">
                          {rec.blockers.map((b, bIdx) => (
                            <div key={bIdx} className="p-3 rounded-lg bg-rose-950/30 border border-rose-500/40 text-xs text-rose-300 space-y-1 min-w-0">
                              <div className="flex items-center gap-2 font-bold text-rose-200">
                                <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                                <span className="truncate">{b.title}</span>
                              </div>
                              <p className="leading-relaxed pl-6 text-zinc-300 break-words">{b.message}</p>
                              {b.recommendation && (
                                <p className="pl-6 text-[11px] text-rose-300 break-words">
                                  <strong className="text-rose-200">Fix: </strong>{b.recommendation}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Warnings */}
                      {rec.warnings && rec.warnings.length > 0 && (
                        <div className="space-y-2 pt-1">
                          {rec.warnings.map((w, wIdx) => (
                            <div key={wIdx} className="p-2.5 rounded-lg bg-amber-950/20 border border-amber-500/30 text-xs text-amber-300 space-y-0.5 min-w-0">
                              <div className="flex items-center gap-2 font-bold text-amber-200">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                <span className="truncate">{w.title}</span>
                              </div>
                              <p className="leading-relaxed pl-5 text-zinc-300 text-[11px] break-words">{w.message}</p>
                              {w.recommendation && (
                                <p className="pl-5 text-[10.5px] text-amber-300 break-words">
                                  <strong>Recommendation: </strong>{w.recommendation}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Config Preview & Target Selection Actions */}
                      {rec.suitability !== "INCOMPATIBLE" && (
                        <div className="pt-3 border-t border-zinc-800/60 flex flex-wrap items-center justify-between gap-2.5">
                          <div className="flex items-center gap-2 min-w-0">
                            {rec.providerId === "vercel" || rec.providerId === "render" || rec.providerId === "netlify" ? (
                              <button
                                onClick={() => setCredentialsModal({ isOpen: true, providerId: rec.providerId, displayName: rec.displayName })}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-500/40 transition-colors cursor-pointer shrink-0"
                              >
                                <Key className="w-3.5 h-3.5 text-cyan-400" />
                                Connect {rec.displayName}
                              </button>
                            ) : (
                              <span className="text-[10px] text-zinc-500 truncate">
                                Execution adapter in development
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0 ml-auto">
                            <button
                              onClick={() => {
                                setShowPlanModal(true);
                              }}
                              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 hover:border-cyan-500/40 transition-colors cursor-pointer shrink-0"
                            >
                              <Rocket className="w-3.5 h-3.5" />
                              Select Target in Plan
                            </button>

                            <button
                              onClick={() => setPreviewModal({ isOpen: true, providerId: rec.providerId, displayName: rec.displayName })}
                              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 hover:border-cyan-500/40 transition-colors cursor-pointer shrink-0"
                            >
                              <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                              Preview Config
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Environment Variables Summary */}
        {report && !loading && report.environmentVariables && report.environmentVariables.required.length > 0 && (
          <div className="p-3.5 rounded-xl bg-[#11131c] border border-zinc-800/80 space-y-2.5">
            <div className="flex items-center gap-2 text-cyan-400">
              <Key className="w-4 h-4 shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-200">Required Environment Variables</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {report.environmentVariables.required.map((v) => {
                const isDocumented = report.environmentVariables.documented.includes(v);
                return (
                  <span
                    key={v}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-mono border ${
                      isDocumented
                        ? "bg-zinc-900/80 text-cyan-300 border-cyan-500/30"
                        : "bg-amber-950/40 text-amber-300 border-amber-500/30"
                    }`}
                  >
                    {v} {!isDocumented && "(missing in .env.example)"}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Findings & Evidence Section */}
        {report && !loading && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                  Inspection Findings ({report.findings?.length || 0})
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-1 bg-[#11131c] p-0.5 rounded-lg border border-zinc-800 text-[11px]">
                {(["ALL", "BLOCKER", "WARNING", "INFO"] as const).map((sev) => (
                  <button
                    key={sev}
                    onClick={() => setFilterSeverity(sev)}
                    className={`px-2 py-0.5 rounded-md transition-colors cursor-pointer text-xs ${
                      filterSeverity === sev
                        ? "bg-cyan-950 text-cyan-300 border border-cyan-500/40 font-semibold"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {sev}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2.5">
              {filteredFindings.length === 0 ? (
                <div className="p-6 rounded-xl bg-[#11131c] border border-zinc-800/80 text-center text-zinc-500 text-xs">
                  No findings matching filter "{filterSeverity}".
                </div>
              ) : (
                filteredFindings.map((finding) => (
                  <div
                    key={finding.id}
                    className="p-3.5 rounded-xl bg-[#11131c] border border-zinc-800/80 space-y-2.5 min-w-0"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        {getSeverityBadge(finding.severity)}
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 uppercase shrink-0">
                          {finding.category}
                        </span>
                        <h4 className="text-xs font-bold text-zinc-100 break-words flex-1 min-w-0">{finding.title}</h4>
                      </div>
                    </div>

                    <p className="text-xs text-zinc-300 leading-relaxed break-words">{finding.message}</p>

                    {/* Evidence Blocks */}
                    {finding.evidence && finding.evidence.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">Repository Evidence:</span>
                        {finding.evidence.map((ev, idx) => (
                          <div
                            key={idx}
                            onClick={() => ev.file && onOpenFile?.(ev.file, ev.line)}
                            className={`p-2 rounded bg-[#090a0f] border border-zinc-800/80 font-mono text-[11px] text-zinc-300 flex items-start justify-between gap-2 min-w-0 ${
                              ev.file ? "cursor-pointer hover:border-cyan-500/40 hover:bg-cyan-950/10" : ""
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 text-cyan-400 font-semibold truncate">
                                <FileCode className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate min-w-0">{ev.file}{ev.line ? `:${ev.line}` : ""}</span>
                              </div>
                              {ev.snippet && (
                                <pre className="mt-1 text-zinc-400 text-[10px] whitespace-pre-wrap break-all bg-black/40 px-2 py-1 rounded max-h-24 overflow-y-auto">
                                  {ev.snippet}
                                </pre>
                              )}
                            </div>
                            {ev.file && <ExternalLink className="w-3.5 h-3.5 text-zinc-500 shrink-0 mt-0.5" />}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Recommendation */}
                    {finding.recommendation && (
                      <div className="p-2.5 rounded-lg bg-cyan-950/20 border border-cyan-500/20 text-xs text-cyan-300 flex items-start gap-2 min-w-0">
                        <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                        <div className="break-words min-w-0">
                          <strong className="text-cyan-200">Recommendation: </strong>
                          <span>{finding.recommendation}</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Action Footer (Fixed/Shrink-0 at bottom) */}
      <footer className="px-4 py-2.5 sm:px-5 border-t border-[#22252B] bg-[#0E1013] flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-1.5 text-[11px] text-[#8C92A4] shrink-0">
          <Info className="w-3.5 h-3.5 text-[#5A6072] shrink-0" />
          <span>Deterministic analysis • 0 AI tokens</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {workspacePath && (
            <button
              onClick={() => setShowAdvisorModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#14161B] hover:bg-[#1A1C22] text-[#4CC2DE] border border-[#22252B] transition-colors cursor-pointer shrink-0"
            >
              <Compass className="w-3.5 h-3.5 text-[#4CC2DE] shrink-0" />
              <span>Deployment Advisor</span>
            </button>
          )}

          {report && report.overallStatus !== "UNKNOWN" && (
            <button
              onClick={() => setShowPlanModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#14161B] hover:bg-[#1A1C22] text-zinc-200 border border-[#22252B] transition-colors cursor-pointer shrink-0"
            >
              <Layers className="w-3.5 h-3.5 text-[#8C92A4] shrink-0" />
              <span>Review Deployment Plan</span>
            </button>
          )}

          {report && report.findings.some((f) => f.severity === "BLOCKER" || f.severity === "WARNING") && onAskAgentToFix && (
            <button
              onClick={() => {
                const issuesText = report.findings
                  .filter((f) => f.severity === "BLOCKER" || f.severity === "WARNING")
                  .map((f) => `- [${f.severity}] ${f.title}: ${f.message}\n  Recommendation: ${f.recommendation || "Review and fix"}`)
                  .join("\n\n");
                onAskAgentToFix(`Please help resolve the following deployment readiness findings for this workspace:\n\n${issuesText}`);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#14161B] hover:bg-[#1A1C22] text-zinc-200 border border-[#22252B] transition-colors cursor-pointer shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5 text-[#4CC2DE] shrink-0" />
              Fix Issues with AI
            </button>
          )}

          {hasValidRecommendations && report?.recommendedProvider === "vercel" && isVercelConnected && report?.overallStatus !== "BLOCKED" ? (
            <button
              onClick={() => setDeployConsoleModal({ isOpen: true, providerId: "vercel", displayName: "Vercel" })}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-medium bg-[#4CC2DE] hover:bg-[#38b2ce] text-[#0E1013] transition-colors cursor-pointer shrink-0"
            >
              <Rocket className="w-3.5 h-3.5" />
              Deploy to Vercel
            </button>
          ) : hasValidRecommendations && report?.recommendedProvider === "vercel" && !isVercelConnected ? (
            <button
              onClick={() => setCredentialsModal({ isOpen: true, providerId: "vercel", displayName: "Vercel" })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[#14161B] hover:bg-[#1A1C22] text-[#4CC2DE] border border-[#22252B] transition-colors cursor-pointer shrink-0"
            >
              <Key className="w-3.5 h-3.5 text-[#4CC2DE]" />
              Connect Vercel to Deploy
            </button>
          ) : (
            <span className="text-[11px] text-zinc-500 italic px-2 py-1">
              No deployment action available
            </span>
          )}
        </div>
      </footer>

      {/* Deployment Advisor Modal */}
      {showAdvisorModal && workspacePath && (
        <DeploymentAdvisorModal
          workspacePath={workspacePath}
          onClose={() => setShowAdvisorModal(false)}
          onSelectArchitecture={(selections) => {
            setUserSelections(selections);
            setShowAdvisorModal(false);
            setShowPlanModal(true);
          }}
          onOpenCustomPlan={() => {
            setShowAdvisorModal(false);
            setShowPlanModal(true);
          }}
        />
      )}

      {/* Deployment Plan Modal (Phase 4D) */}
      {showPlanModal && workspacePath && (
        <DeploymentPlanModal
          workspacePath={workspacePath}
          initialSelections={userSelections}
          onSelectionsChange={setUserSelections}
          onClose={() => setShowPlanModal(false)}
          onOpenPreviewConfig={(providerId, displayName) => {
            setShowPlanModal(false);
            setPreviewModal({ isOpen: true, providerId, displayName });
          }}
          onOpenCredentials={(providerId, displayName) => {
            setCredentialsModal({ isOpen: true, providerId, displayName });
          }}
          onStartDeployment={(plan, requestId) => {
            setShowPlanModal(false);
            setDeployConsoleModal({ isOpen: true, plan, requestId });
          }}
        />
      )}

      {/* Deployment Configuration Preview & Generation Modal (Phase 2C) */}
      {previewModal && previewModal.isOpen && workspacePath && (
        <DeploymentConfigPreviewModal
          workspacePath={workspacePath}
          providerId={previewModal.providerId}
          providerDisplayName={previewModal.displayName}
          onClose={() => setPreviewModal(null)}
          onSuccess={() => {
            runInspection();
          }}
        />
      )}

      {/* Deployment Credentials Modal (Phase 3A) */}
      {credentialsModal && credentialsModal.isOpen && (
        <DeploymentCredentialsModal
          providerId={credentialsModal.providerId}
          providerDisplayName={credentialsModal.displayName}
          onClose={() => {
            setCredentialsModal(null);
            runInspection();
            checkVercelAuth();
          }}
          onStatusChange={(connected) => {
            setIsVercelConnected(connected);
          }}
        />
      )}

      {/* Deployment Live Console Modal (Phase 4D) */}
      {deployConsoleModal && deployConsoleModal.isOpen && workspacePath && (
        <DeploymentConsoleModal
          workspacePath={workspacePath}
          plan={deployConsoleModal.plan}
          providerId={deployConsoleModal.providerId}
          providerDisplayName={deployConsoleModal.displayName}
          rootDir={deployConsoleModal.rootDir}
          requestId={deployConsoleModal.requestId}
          onClose={() => setDeployConsoleModal(null)}
          onFinished={() => {
            runInspection();
          }}
        />
      )}
    </div>
  );
}
