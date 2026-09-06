"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  X,
  Compass,
  Sparkles,
  Server,
  Globe,
  Database,
  Layers,
  ArrowRight,
  ShieldCheck,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Info,
  Clock,
  RefreshCw,
  Award,
  Zap,
  DollarSign,
  Cpu,
  HardDrive,
  ShieldAlert,
  ChevronRight,
  ExternalLink,
} from "lucide-react";

export interface RiskItemUI {
  code: string;
  severity: "HIGH" | "MEDIUM" | "LOW" | "INFO";
  title: string;
  explanation: string;
  affectedService: string;
  affectedProviders: string[];
  evidence: string;
  recommendation: string;
}

export interface ArchitectureRecommendationUI {
  architectureId: string;
  name: string;
  compatibilityScore: number;
  architectureScore: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  executionAvailable: boolean;
  isRecommended: boolean;
  suitability: string;
  services: Array<{
    serviceId: string;
    name: string;
    type: "FRONTEND" | "BACKEND" | "WORKER";
    framework: string;
    recommendedProvider: string;
    providerDisplayName: string;
    executionAvailable: boolean;
    configFile: string;
  }>;
  databases: Array<{
    databaseId: string;
    name: string;
    technology: string;
    recommendedProvider: string;
    providerDisplayName: string;
    executionAvailable: boolean;
    isManaged: boolean;
  }>;
  advantages: string[];
  tradeoffs: string[];
  risks: RiskItemUI[];
  billingConsiderations: {
    frontend?: string;
    backend?: string;
    database?: string;
    summary: string;
  };
  resourceConsiderations: {
    memory: string;
    compute: string;
    storage: string;
    bandwidth: string;
  };
  credentialRequirements: Array<{
    providerId: string;
    displayName: string;
    status: string;
  }>;
  complexity: "LOW" | "MEDIUM" | "HIGH";
  rationale: string[];
}

export interface DeploymentAdviceUI {
  adviceId: string;
  workspacePath: string;
  generatedAt: number;
  evidenceHash: string;
  projectSummary: {
    frontendFramework: string;
    backendFramework: string;
    databaseTechnology: string;
    totalServices: number;
    totalDatabases: number;
    isMonorepo: boolean;
    summaryText: string;
  };
  detectedTopology: {
    isMonorepo: boolean;
    packageManager: string | null;
    services: any[];
    databases: any[];
  };
  architectureRecommendations: ArchitectureRecommendationUI[];
  recommendedArchitecture: ArchitectureRecommendationUI | null;
  alternatives: ArchitectureRecommendationUI[];
  projectRisks: RiskItemUI[];
  blockers: string[];
  requirements: string[];
  billingConsiderations: {
    summary: string;
  };
  resourceConsiderations: {
    memory: string;
    compute: string;
    storage: string;
    bandwidth: string;
  };
  credentialRequirements: Array<{ providerId: string; displayName: string; status: string }>;
  complexity: "LOW" | "MEDIUM" | "HIGH";
  selectedArchitecture: string | null;
  status: "READY" | "WARNING" | "BLOCKED" | "UNKNOWN";
}

interface DeploymentAdvisorModalProps {
  workspacePath: string;
  onClose: () => void;
  onSelectArchitecture: (userSelections: Record<string, string>) => void;
  onOpenCustomPlan?: () => void;
}

export default function DeploymentAdvisorModal({
  workspacePath,
  onClose,
  onSelectArchitecture,
  onOpenCustomPlan,
}: DeploymentAdvisorModalProps) {
  const [loading, setLoading] = useState(true);
  const [advice, setAdvice] = useState<DeploymentAdviceUI | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedArchId, setSelectedArchId] = useState<string | null>(null);

  const fetchAdvice = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.intelligence?.getDeploymentAdvice) {
        const res = await electronAPI.intelligence.getDeploymentAdvice({ workspacePath });
        setAdvice(res);
        if (res?.recommendedArchitecture) {
          setSelectedArchId(res.recommendedArchitecture.architectureId);
        }
      } else {
        setError("Deployment Advisor API is not available.");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to generate deployment advice.");
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    fetchAdvice();
  }, [fetchAdvice]);

  const handleApplyArchitecture = (arch: ArchitectureRecommendationUI) => {
    const selections: Record<string, string> = {};
    for (const s of arch.services || []) {
      selections[s.serviceId] = s.recommendedProvider;
    }
    for (const d of arch.databases || []) {
      selections[d.databaseId] = d.recommendedProvider;
    }
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.intelligence?.saveDeploymentSelections) {
      electronAPI.intelligence.saveDeploymentSelections({ workspacePath, selections });
    }
    onSelectArchitecture(selections);
  };

  const getSeverityBadge = (sev: string) => {
    switch (sev) {
      case "HIGH":
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950/80 border border-rose-500/40 text-rose-300">HIGH RISK</span>;
      case "MEDIUM":
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950/80 border border-amber-500/40 text-amber-300">MEDIUM RISK</span>;
      case "LOW":
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-950/80 border border-blue-500/40 text-blue-300">LOW</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-800 border border-zinc-700 text-zinc-400">INFO</span>;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-5xl max-h-[92vh] bg-[#090a0f] border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden text-zinc-200 font-sans">
        
        {/* Header */}
        <header className="px-5 py-4 border-b border-zinc-800 bg-[#0e1017] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-cyan-950/80 border border-cyan-500/30 text-cyan-400 shrink-0">
              <Compass className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-zinc-100 tracking-tight">NEXUS Deployment Advisor</h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-cyan-950/80 border border-cyan-500/40 text-cyan-300">
                  Evidence-Grounded Architecture Rankings
                </span>
              </div>
              <p className="text-xs text-zinc-400 font-mono truncate mt-0.5 max-w-[500px]" title={workspacePath}>
                {workspacePath}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => fetchAdvice()}
              disabled={loading}
              className="p-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 border border-zinc-700/50 transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh Analysis"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-cyan-400" : ""}`} />
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar min-h-0">
          {loading && (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-500 space-y-3">
              <RefreshCw className="w-8 h-8 animate-spin text-cyan-500" />
              <p className="text-sm font-medium">Analyzing repository topology, runtime models & deployment risks…</p>
            </div>
          )}

          {error && !loading && (
            <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-500/30 text-rose-300 text-xs space-y-1">
              <div className="flex items-center gap-2 font-bold">
                <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>Advisor Analysis Failed</span>
              </div>
              <p className="pl-6 text-rose-200/80">{error}</p>
            </div>
          )}

          {!loading && advice && (
            <>
              {/* Project Summary Banner */}
              <div className="p-4 rounded-xl bg-[#0f111a] border border-zinc-800 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-zinc-300 uppercase tracking-wider">
                    <Layers className="w-4 h-4 text-cyan-400" />
                    <span>Project Profile</span>
                  </div>
                  {advice.projectSummary.isMonorepo && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-950/60 border border-cyan-500/30 text-cyan-300">
                      Monorepo Architecture
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="p-2.5 rounded-lg bg-zinc-900/80 border border-zinc-800/80 space-y-1">
                    <div className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-emerald-400" /> Frontend
                    </div>
                    <div className="font-bold text-zinc-200 truncate">{advice.projectSummary.frontendFramework}</div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-zinc-900/80 border border-zinc-800/80 space-y-1">
                    <div className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
                      <Server className="w-3.5 h-3.5 text-blue-400" /> Backend
                    </div>
                    <div className="font-bold text-zinc-200 truncate">{advice.projectSummary.backendFramework}</div>
                  </div>

                  <div className="p-2.5 rounded-lg bg-zinc-900/80 border border-zinc-800/80 space-y-1">
                    <div className="text-[11px] text-zinc-400 font-medium flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-amber-400" /> Database
                    </div>
                    <div className="font-bold text-zinc-200 truncate">{advice.projectSummary.databaseTechnology}</div>
                  </div>
                </div>

                <p className="text-xs text-zinc-300 leading-relaxed border-t border-zinc-800/60 pt-2.5">
                  {advice.projectSummary.summaryText}
                </p>
              </div>

              {/* 1. RECOMMENDED ARCHITECTURE CARD */}
              {advice.recommendedArchitecture && (
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Award className="w-4 h-4 text-cyan-400" />
                      <span>Recommended Deployment Architecture</span>
                    </h3>
                    <span className="text-[11px] text-zinc-400">
                      Evaluated for performance, execution stability & simplicity
                    </span>
                  </div>

                  <div className="p-4 rounded-lg bg-[#111318] border border-[#22252B] space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#1A1C22] text-[#4CC2DE] border border-[#22252B]">
                            TOP RECOMMENDATION
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              advice.recommendedArchitecture.executionAvailable
                                ? "bg-emerald-950/80 text-emerald-300 border border-emerald-500/40"
                                : "bg-amber-950/80 text-amber-300 border border-amber-500/40"
                            }`}
                          >
                            {advice.recommendedArchitecture.executionAvailable ? "Execution: AVAILABLE" : "Execution: NOT YET SUPPORTED"}
                          </span>
                        </div>
                        <h4 className="text-base font-bold text-zinc-100 mt-1">
                          {advice.recommendedArchitecture.name}
                        </h4>
                      </div>

                      <div className="text-right">
                        <div className="text-base font-bold text-cyan-400">
                          {advice.recommendedArchitecture.architectureScore} <span className="text-xs text-zinc-500 font-normal">/ 100</span>
                        </div>
                        <span className="text-[10px] text-zinc-500 block">deployment compatibility score</span>
                      </div>
                    </div>

                    {/* Services Breakdown */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                      {advice.recommendedArchitecture.services.map((svc) => (
                        <div key={svc.serviceId} className="p-3 rounded-lg bg-[#090a0f] border border-zinc-800 text-xs space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-400 font-semibold">{svc.name}</span>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                              {svc.type}
                            </span>
                          </div>
                          <div className="text-cyan-300 font-bold text-[11px] truncate">
                            ➔ {svc.providerDisplayName}
                          </div>
                        </div>
                      ))}

                      {advice.recommendedArchitecture.databases.map((db) => (
                        <div key={db.databaseId} className="p-3 rounded-lg bg-[#090a0f] border border-zinc-800 text-xs space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-zinc-400 font-semibold">{db.name}</span>
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-500/30">
                              DATABASE
                            </span>
                          </div>
                          <div className="text-amber-300 font-bold text-[11px] truncate">
                            ➔ {db.providerDisplayName}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Why this is recommended */}
                    <div className="space-y-1.5 text-xs">
                      <span className="font-bold text-zinc-300 text-[11px] uppercase tracking-wider">Why this is recommended:</span>
                      <ul className="space-y-1 text-zinc-300">
                        {advice.recommendedArchitecture.advantages.map((adv, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                            <span className="leading-relaxed">{adv}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Billing & Resource Considerations */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-zinc-800/80 text-xs">
                      <div className="p-3 rounded-lg bg-[#090a0f] border border-zinc-800/80 space-y-1">
                        <div className="flex items-center gap-1.5 text-amber-400 font-bold text-[11px]">
                          <DollarSign className="w-3.5 h-3.5" /> Billing / Plan Considerations
                        </div>
                        <p className="text-zinc-300 text-[11px] leading-relaxed">
                          {advice.recommendedArchitecture.billingConsiderations.summary}
                        </p>
                      </div>

                      <div className="p-3 rounded-lg bg-[#090a0f] border border-zinc-800/80 space-y-1">
                        <div className="flex items-center gap-1.5 text-blue-400 font-bold text-[11px]">
                          <Cpu className="w-3.5 h-3.5" /> Resource / Runtime Limits
                        </div>
                        <p className="text-zinc-300 text-[11px] leading-relaxed">
                          {advice.recommendedArchitecture.resourceConsiderations.memory} • {advice.recommendedArchitecture.resourceConsiderations.compute}
                        </p>
                      </div>
                    </div>

                    {/* Action Button */}
                    <div className="pt-2 flex items-center justify-end gap-3">
                      <button
                        onClick={() => handleApplyArchitecture(advice.recommendedArchitecture!)}
                        className="flex items-center gap-2 px-4 py-1.5 rounded-md text-xs font-medium bg-[#4CC2DE] hover:bg-[#3db0cc] text-[#0A0B0D] transition-colors cursor-pointer"
                      >
                        <span>Use Recommended Architecture</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </section>
              )}

              {/* 2. ALTERNATIVE ARCHITECTURES */}
              {advice.alternatives && advice.alternatives.length > 0 && (
                <section className="space-y-3">
                  <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                    Alternative Deployment Architectures ({advice.alternatives.length})
                  </h3>

                  <div className="space-y-3">
                    {advice.alternatives.map((alt) => (
                      <div key={alt.architectureId} className="p-4 rounded-xl bg-[#0e1017] border border-zinc-800 hover:border-zinc-700 transition-colors space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-zinc-100">{alt.name}</span>
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  alt.executionAvailable
                                    ? "bg-emerald-950/80 text-emerald-300 border border-emerald-500/40"
                                    : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                                }`}
                              >
                                {alt.executionAvailable ? "Execution: AVAILABLE" : "Execution: NOT YET SUPPORTED"}
                              </span>
                            </div>
                            <p className="text-[11px] text-zinc-400 mt-0.5">{alt.rationale?.[0] || alt.advantages?.[0]}</p>
                          </div>

                          <div className="text-right">
                            <div className="text-sm font-bold text-cyan-400">
                              {alt.compatibilityScore} <span className="text-xs text-zinc-500 font-normal">/ 100</span>
                            </div>
                            <span className="text-[10px] text-zinc-500 block">deployment compatibility score</span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-zinc-800/60">
                          <div className="text-[11px] text-zinc-400 space-y-0.5">
                            <div><strong className="text-zinc-300">Billing: </strong>{alt.billingConsiderations.summary}</div>
                            {alt.tradeoffs.length > 0 && (
                              <div><strong className="text-amber-400">Tradeoff: </strong>{alt.tradeoffs[0]}</div>
                            )}
                          </div>

                          <button
                            onClick={() => handleApplyArchitecture(alt)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 hover:border-cyan-500/40 transition-colors cursor-pointer shrink-0"
                          >
                            <span>Select Architecture</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* 3. DETECTED RISKS & COMPLIANCE FINDINGS */}
              {advice.projectRisks && advice.projectRisks.length > 0 && (
                <section className="space-y-3">
                  <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span>Project Readiness & Risk Analysis ({advice.projectRisks.length})</span>
                  </h3>

                  <div className="space-y-2">
                    {advice.projectRisks.map((risk, idx) => (
                      <div
                        key={idx}
                        className={`p-3.5 rounded-xl border space-y-1.5 ${
                          risk.severity === "HIGH"
                            ? "bg-rose-950/20 border-rose-500/30 text-rose-200"
                            : risk.severity === "MEDIUM"
                            ? "bg-amber-950/20 border-amber-500/30 text-amber-200"
                            : "bg-zinc-900/80 border-zinc-800 text-zinc-300"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            {risk.severity === "HIGH" && <XCircle className="w-4 h-4 text-rose-400 shrink-0" />}
                            {risk.severity === "MEDIUM" && <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />}
                            {risk.severity !== "HIGH" && risk.severity !== "MEDIUM" && <Info className="w-4 h-4 text-zinc-400 shrink-0" />}
                            <span className="font-bold text-xs text-zinc-100">{risk.title}</span>
                          </div>
                          {getSeverityBadge(risk.severity)}
                        </div>

                        <p className="text-xs text-zinc-300 leading-relaxed pl-6">{risk.explanation}</p>
                        
                        {risk.recommendation && (
                          <div className="text-[11px] text-cyan-300 pl-6">
                            <strong>Recommendation: </strong>{risk.recommendation}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <footer className="px-5 py-3.5 border-t border-zinc-800 bg-[#0e1017] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <Info className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <span>NEXUS recommends complete architectures • You choose the target</span>
          </div>

          <div className="flex items-center gap-2">
            {onOpenCustomPlan && (
              <button
                onClick={onOpenCustomPlan}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors cursor-pointer"
              >
                Customize Architecture in Plan
              </button>
            )}

            <button
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700 transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
