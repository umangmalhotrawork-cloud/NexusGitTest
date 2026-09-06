"use client";

import React, { useState, useEffect } from "react";
import {
  AlertTriangle,
  Play,
  Sparkles,
  HelpCircle,
  ShieldAlert,
  Layers,
  FileCode,
  CheckCircle2,
  XCircle,
  Info,
  Clock,
  RefreshCw,
  X,
  ArrowRight,
  Database,
  Key,
  CloudOff,
  Users,
  Activity,
  ChevronLeft,
} from "lucide-react";

export interface SimulationReportUI {
  simulationId: string;
  question: string;
  scenarioType: string;
  mode: "STATIC_FORECAST" | "SANDBOX_SIMULATION" | "HEURISTIC_INFERENCE";
  status: "VERIFIED" | "PREDICTED" | "INCONCLUSIVE";
  summary: string;
  affectedFiles: string[];
  affectedSymbols: string[];
  likelyFailurePoints: Array<{
    file: string;
    symbol?: string;
    line?: number;
    description: string;
    risk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  }>;
  expectedBehavior: string;
  failureBehavior: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  evidence: Array<{
    type: string;
    source: string;
    description: string;
    provenance?: any;
  }>;
  observedResults: Array<{
    executionMethod?: string;
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    failingTests?: string[];
    passed?: boolean;
    durationMs?: number;
  }>;
  suggestedTests: string[];
  assumptions: string[];
  limitations: string[];
  createdAt: number;
}

interface FutureBugSimulatorPanelProps {
  workspacePath?: string;
  activeFilePath?: string;
  onOpenFile?: (filePath: string, line?: number) => void;
  onAskAgentToImplement?: (prompt: string) => void;
  onBack?: () => void;
  onClose?: () => void;
}

export default function FutureBugSimulatorPanel({
  workspacePath,
  activeFilePath,
  onOpenFile,
  onAskAgentToImplement,
  onBack,
  onClose,
}: FutureBugSimulatorPanelProps) {
  const [question, setQuestion] = useState("");
  const [simulating, setSimulating] = useState(false);
  const [report, setReport] = useState<SimulationReportUI | null>(null);
  const [allowSandbox, setAllowSandbox] = useState(false);
  const [presets, setPresets] = useState<Array<{ id: string; title: string; question: string; scenarioType: string }>>([
    { id: "high_traffic", title: "10× Traffic", scenarioType: "HIGH_TRAFFIC", question: "What happens under 10× traffic?" },
    { id: "slow_db", title: "Slow DB", scenarioType: "SLOW_DATABASE", question: "What happens if the database becomes 10× slower?" },
    { id: "expired_token", title: "Expired Token", scenarioType: "EXPIRED_AUTH_TOKEN", question: "What happens if the authentication token expires?" },
    { id: "api_down", title: "API Down", scenarioType: "DEPENDENCY_UNAVAILABLE", question: "What happens if the payment provider is unavailable?" },
    { id: "concurrent_users", title: "Concurrent Users", scenarioType: "CONCURRENT_UPDATE", question: "What happens if two users update this at the same time?" },
    { id: "timeout", title: "Timeout", scenarioType: "REQUEST_TIMEOUT", question: "What happens if a request times out?" },
    { id: "invalid_input", title: "Invalid Input", scenarioType: "INVALID_INPUT", question: "What happens if this function receives null / malformed input?" },
  ]);

  useEffect(() => {
    const loadPresets = async () => {
      try {
        const intelligence = (window as any).electronAPI?.intelligence;
        if (intelligence?.getScenarioPresets) {
          const res = await intelligence.getScenarioPresets();
          if (Array.isArray(res) && res.length > 0) {
            setPresets(res);
          }
        }
      } catch (_) {}
    };
    loadPresets();
  }, []);

  const handleSimulate = async (customQuestion?: string) => {
    const q = (customQuestion || question).trim();
    if (!q) return;

    setSimulating(true);
    try {
      const intelligence = (window as any).electronAPI?.intelligence;
      if (intelligence?.simulateBug) {
        const res = await intelligence.simulateBug({
          question: q,
          workspacePath,
          activeFilePath,
          allowSandbox,
        });
        if (res) {
          setReport(res);
        }
      }
    } catch (err) {
      console.error("[FutureBugSimulator] Simulation error:", err);
    } finally {
      setSimulating(false);
    }
  };

  const handleSelectPreset = (p: { question: string }) => {
    setQuestion(p.question);
    handleSimulate(p.question);
  };

  const handleHandoff = (r: SimulationReportUI) => {
    if (!onAskAgentToImplement) return;
    const prompt = `Please review and fortify our code against the following plausible failure scenario:\n\nScenario: ${r.scenarioType}\nQuestion: ${r.question}\nPredicted Consequence: ${r.summary}\nAffected Files: ${r.affectedFiles.join(", ") || "Workspace"}\nSuggested Test: ${r.suggestedTests.join("; ") || "Add fault injection test"}`;
    onAskAgentToImplement(prompt);
  };

  const getModeBadge = (mode: string) => {
    switch (mode) {
      case "SANDBOX_SIMULATION":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-sans font-medium bg-emerald-950/90 border border-emerald-500/50 text-emerald-300 shrink-0">
            <CheckCircle2 className="w-3 h-3" />
            Sandbox Simulation Executed
          </span>
        );
      case "HEURISTIC_INFERENCE":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-sans font-medium bg-amber-950/90 border border-amber-500/50 text-amber-300 shrink-0">
            <Info className="w-3 h-3" />
            Heuristic Inference
          </span>
        );
      case "STATIC_FORECAST":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-sans font-medium bg-cyan-950/90 border border-cyan-500/40 text-cyan-300 shrink-0">
            <ShieldAlert className="w-3 h-3" />
            Static Forecast (Not Executed)
          </span>
        );
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "VERIFIED":
        return <span className="text-[10px] font-sans font-medium text-emerald-400">Verified</span>;
      case "PREDICTED":
        return <span className="text-[10px] font-sans font-medium text-cyan-400">Predicted</span>;
      case "INCONCLUSIVE":
      default:
        return <span className="text-[10px] font-sans font-medium text-zinc-400">Inconclusive</span>;
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case "CRITICAL":
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-sans font-medium bg-red-950 border border-red-500/50 text-red-300">Critical</span>;
      case "HIGH":
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-sans font-medium bg-amber-950 border border-amber-500/50 text-amber-300">High</span>;
      case "MEDIUM":
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-sans font-medium bg-blue-950 border border-blue-500/50 text-blue-300">Medium</span>;
      case "LOW":
      default:
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-sans font-medium bg-zinc-900 border border-zinc-700 text-zinc-400">Low</span>;
    }
  };

  const getConfidenceBadge = (confidence: string) => {
    switch (confidence) {
      case "HIGH":
        return <span className="text-[10px] font-sans font-medium text-emerald-400">High</span>;
      case "MEDIUM":
        return <span className="text-[10px] font-sans font-medium text-amber-400">Medium</span>;
      case "LOW":
      default:
        return <span className="text-[10px] font-sans font-medium text-zinc-400">Low</span>;
    }
  };

  return (
    <div className="flex flex-col h-full w-full min-w-0 max-w-full bg-[#0E1013] text-zinc-200 border-r border-[#22252B] select-none font-sans text-xs overflow-hidden">
      {/* Header */}
      <div className="h-10 px-3 border-b border-[#22252B] flex items-center justify-between shrink-0 min-w-0 max-w-full bg-[#0E1013]">
        <div className="flex items-center gap-2 min-w-0">
          <ShieldAlert className="w-4 h-4 text-[#4CC2DE] shrink-0" />
          <span className="font-semibold text-zinc-100 text-sm tracking-tight truncate">Future Bug Simulator</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => handleSimulate()}
            className="p-1 rounded hover:bg-[#1A1C22] text-[#8C92A4] hover:text-zinc-200 transition-colors cursor-pointer"
            title="Re-run Simulation"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${simulating ? "animate-spin" : ""}`} />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[#1A1C22] text-[#8C92A4] hover:text-zinc-200 transition-colors cursor-pointer"
              title="Close Simulator"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Query Bar */}
      <div className="p-2.5 border-b border-[#22252B] bg-[#0E1013] shrink-0 min-w-0 max-w-full space-y-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSimulate();
          }}
          className="space-y-1.5 min-w-0 max-w-full font-sans"
        >
          <label className="text-xs font-sans text-zinc-300 font-medium flex items-center gap-1.5 min-w-0">
            <HelpCircle className="w-3.5 h-3.5 text-[#8C92A4] shrink-0" />
            <span className="truncate">What could break?</span>
          </label>
          <div className="flex items-center gap-1.5 min-w-0 max-w-full font-sans">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. What happens if the database becomes 10× slower?"
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-md bg-[#14161B] border border-[#22252B] text-zinc-200 text-xs focus:outline-none focus:border-[#4CC2DE] font-sans"
            />
            <button
              type="submit"
              disabled={simulating || !question.trim()}
              className="px-3.5 py-1.5 rounded-md bg-[#4CC2DE] hover:bg-[#38b2ce] disabled:opacity-50 text-[#0E1013] font-sans text-xs font-medium transition-colors shrink-0 flex items-center gap-1.5 cursor-pointer"
            >
              <Play className="w-3 h-3 fill-current shrink-0" />
              <span>Simulate</span>
            </button>
          </div>
        </form>

        {/* Preset Pills */}
        <div className="space-y-1 min-w-0 max-w-full font-sans">
          <div className="text-[11px] font-sans text-[#8C92A4]">Scenario Presets:</div>
          <div className="flex flex-wrap items-center gap-1 min-w-0 max-w-full">
            {presets.map((p) => (
              <button
                key={p.id}
                onClick={() => handleSelectPreset(p)}
                className="px-2.5 py-1 rounded-md bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] hover:border-[#4CC2DE]/40 text-zinc-300 font-sans text-xs transition-colors cursor-pointer shrink-0 font-medium"
              >
                {p.title}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Report Body */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2.5 space-y-3 min-w-0 max-w-full font-sans">
        {simulating ? (
          <div className="text-center py-12 text-zinc-400 space-y-2 min-w-0 font-sans">
            <RefreshCw className="w-6 h-6 mx-auto text-amber-400 animate-spin" />
            <p className="text-xs font-sans text-[#8C92A4]">Analyzing call graphs and fault propagation...</p>
          </div>
        ) : !report ? (
          <div className="h-full min-h-[240px] flex flex-col items-center justify-center text-center p-6 text-zinc-500 space-y-2 min-w-0 font-sans">
            <ShieldAlert className="w-7 h-7 mx-auto text-[#5A6072] shrink-0" />
            <p className="text-xs font-medium text-[#9AA1AC]">No active simulation.</p>
            <p className="text-[11px] font-sans text-[#5A6072] max-w-xs break-words [overflow-wrap:anywhere]">
              Ask a question above or select a preset to evaluate failure scenarios before production.
            </p>
          </div>
        ) : (
          <div className="p-3 rounded-lg bg-[#111318] border border-[#22252B] space-y-3 text-xs min-w-0 max-w-full overflow-hidden font-sans">
            {/* Top Bar: Mode & Status */}
            <div className="flex flex-wrap items-center justify-between gap-2 min-w-0 max-w-full pb-2 border-b border-[#22252B] font-sans">
              {getModeBadge(report.mode)}
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-sans text-[#8C92A4]">Status:</span>
                {getStatusBadge(report.status)}
              </div>
            </div>

            {/* Scenario & Question */}
            <div className="space-y-0.5 min-w-0 font-sans">
              <div className="text-[10px] font-sans text-[#8C92A4] font-medium uppercase tracking-wider">Scenario</div>
              <div className="font-semibold text-zinc-100 text-xs leading-snug break-words [overflow-wrap:anywhere]">
                {report.question}
              </div>
            </div>

            {/* Likely Impact */}
            <div className="space-y-0.5 min-w-0 font-sans">
              <div className="text-[10px] font-sans text-[#8C92A4] font-medium uppercase tracking-wider">Likely Impact</div>
              <div className="text-zinc-200 leading-relaxed font-sans bg-[#0E1013] p-2.5 rounded-md border border-[#22252B] text-xs break-words [overflow-wrap:anywhere]">
                {report.summary}
              </div>
            </div>

            {/* Severity & Confidence */}
            <div className="flex flex-wrap items-center justify-between gap-2 py-1.5 border-y border-[#22252B] min-w-0 max-w-full font-sans">
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[11px] font-sans text-[#8C92A4]">Severity:</span>
                {getSeverityBadge(report.severity)}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[11px] font-sans text-[#8C92A4]">Confidence:</span>
                {getConfidenceBadge(report.confidence)}
              </div>
            </div>

            {/* Affected Files & Functions */}
            <div className="space-y-1.5 min-w-0 font-sans">
              {report.affectedFiles && report.affectedFiles.length > 0 && (
                <div className="space-y-0.5 min-w-0 font-sans">
                  <div className="text-[10px] font-sans text-[#8C92A4] font-medium uppercase tracking-wider">Affected Files</div>
                  <div className="flex flex-wrap gap-1 min-w-0 max-w-full">
                    {report.affectedFiles.map((f, i) => (
                      <button
                        key={i}
                        onClick={() => onOpenFile && onOpenFile(f)}
                        className="px-1.5 py-0.5 rounded bg-[#14161B] border border-[#22252B] text-[#4CC2DE] font-mono text-[10px] break-all [overflow-wrap:anywhere] hover:underline text-left cursor-pointer"
                        title={f}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {report.affectedSymbols && report.affectedSymbols.length > 0 && (
                <div className="space-y-0.5 min-w-0">
                  <div className="text-[10px] font-mono text-[#8C92A4] font-semibold uppercase">Affected Functions</div>
                  <div className="flex flex-wrap gap-1 min-w-0 max-w-full">
                    {report.affectedSymbols.map((s, i) => (
                      <span
                        key={i}
                        className="px-1.5 py-0.5 rounded bg-[#14161B] border border-[#22252B] text-purple-300 font-mono text-[10px] break-words [overflow-wrap:anywhere]"
                      >
                        {s}()
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Evidence */}
            {report.evidence && report.evidence.length > 0 && (
              <div className="space-y-1 min-w-0">
                <div className="text-[10px] font-mono text-[#8C92A4] font-semibold uppercase">Evidence Trail</div>
                <div className="space-y-1 min-w-0 max-w-full">
                  {report.evidence.map((ev, idx) => (
                    <div
                      key={idx}
                      className="p-1.5 rounded bg-[#0E1013] border border-[#22252B] text-[10px] font-mono space-y-0.5 break-words [overflow-wrap:anywhere]"
                    >
                      <div className="flex items-center gap-1 text-[#4CC2DE] font-semibold">
                        <span>[{ev.type}]</span>
                        <span className="text-[#5A6072]">({ev.source})</span>
                      </div>
                      <div className="text-zinc-300">{ev.description}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Observed Results (Sandbox mode) */}
            {report.observedResults && report.observedResults.length > 0 && (
              <div className="space-y-1 min-w-0">
                <div className="text-[10px] font-mono text-emerald-400 font-semibold uppercase">Observed Results</div>
                <div className="space-y-1 min-w-0 max-w-full">
                  {report.observedResults.map((obs, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded bg-[#0E1013] border border-emerald-500/30 text-[10px] font-mono space-y-1 break-words [overflow-wrap:anywhere]"
                    >
                      <div className="flex items-center justify-between text-emerald-300 font-semibold">
                        <span>{obs.executionMethod}</span>
                        <span>{obs.passed ? "PASSED" : "FAILED"} ({obs.durationMs}ms)</span>
                      </div>
                      {obs.stdout && <div className="text-zinc-400 whitespace-pre-wrap">{obs.stdout}</div>}
                      {obs.stderr && <div className="text-red-400 whitespace-pre-wrap">{obs.stderr}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Suggested Tests */}
            {report.suggestedTests && report.suggestedTests.length > 0 && (
              <div className="space-y-1 min-w-0">
                <div className="text-[10px] font-mono text-[#8C92A4] font-semibold uppercase">Suggested Test</div>
                <ul className="list-disc list-inside text-zinc-300 text-[11px] space-y-0.5 break-words [overflow-wrap:anywhere]">
                  {report.suggestedTests.map((st, i) => (
                    <li key={i}>{st}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Limitations & Provenance Notice */}
            {report.limitations && report.limitations.length > 0 && (
              <div className="space-y-1 min-w-0">
                <div className="text-[10px] font-mono text-[#5A6072] font-semibold uppercase">Limitations</div>
                <div className="text-[10px] font-mono text-[#5A6072] bg-[#0E1013] p-2 rounded border border-[#22252B] space-y-0.5 break-words [overflow-wrap:anywhere]">
                  {report.limitations.map((lim, i) => (
                    <div key={i}>• {lim}</div>
                  ))}
                </div>
              </div>
            )}

            {/* Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#22252B] min-w-0 max-w-full">
              <span className="text-[10px] font-mono text-[#5A6072] shrink-0">
                {new Date(report.createdAt).toLocaleTimeString()}
              </span>

              {onAskAgentToImplement && (
                <button
                  onClick={() => handleHandoff(report)}
                  className="ml-auto px-2.5 py-1 rounded bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] text-[#4CC2DE] font-mono text-[10px] flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                >
                  <span>Send to Agent</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
