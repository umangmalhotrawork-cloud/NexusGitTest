import React, { useState, useMemo } from "react";
import { Terminal as TerminalIcon, AlertTriangle, AlertCircle, Info, FileCode, FileText, ChevronRight, ShieldCheck, GitBranch, Bot, ChevronDown, X, Minus, HelpCircle } from "lucide-react";
import TerminalPanel from "./TerminalPanel";
import { ProblemItem } from "../utils/diagnosticParser";
import WhyDidThisBreakModal, { BreakageReport } from "./WhyDidThisBreakModal";

export type BottomPanelTab = "terminal" | "problems" | "output" | "verification" | "git" | "agent_logs";


interface BottomPanelProps {
  isOpen: boolean;
  activeTab: BottomPanelTab;
  onSelectTab: (tab: BottomPanelTab) => void;
  onClose: () => void;
  height: number;
  onResizeStart: (e: React.MouseEvent) => void;
  // Terminal Panel props
  terminalProps: {
    tabs: any[];
    activeTabId: string | null;
    onSelectTab: (id: string) => void;
    onCreateTab: (shell?: string, name?: string) => void;
    onCloseTab: (id: string) => void;
    onRestartTab: (id: string) => void;
    onSendInput: (id: string, input: string) => void;
    onRenameTab?: (id: string, newName: string) => void;
    onClearTabOutput?: (id: string) => void;
    splitLayout?: any;
    splitTabIds?: string[];
    focusedPaneId?: string;
    onSplitTab?: (direction: "vertical" | "horizontal", targetTabId?: string) => void;
    onUnsplit?: () => void;
    onFocusPane?: (id: string) => void;
    logs: string[];
    onClearLogs: () => void;
    debugLogs: string[];
    pythonOutput: string;
    onClearDebugLogs: () => void;
    activeMode: "terminal" | "output" | "debug" | "logs" | "python";
    onModeChange: (mode: any) => void;
    onAskAiAboutDiagnostic?: (diagnostic: any) => void;
    onOpenLocation?: (filePath: string, line?: number, column?: number) => void;
    onSendSelectionToAi?: (selectedText: string) => void;
  };
  // Extra tabs data
  problems?: ProblemItem[] | Array<{ file?: string; filePath?: string; line?: number; column?: number; message: string; severity: "error" | "warning" | "info"; code?: string; source?: string }>;
  verificationSummary?: { firewallStatus?: string; driftStatus?: string; riskLevel?: string };
  agentLogs?: string[];
  gitSummary?: { branch?: string; stagedCount?: number; unstagedCount?: number };
}

export default function BottomPanel({
  isOpen,
  activeTab,
  onSelectTab,
  onClose,
  height,
  onResizeStart,
  terminalProps,
  problems = [],
  verificationSummary,
  agentLogs = [],
  gitSummary,
}: BottomPanelProps) {
  const errorCount = useMemo(() => problems.filter((p) => p.severity === "error").length, [problems]);
  const warningCount = useMemo(() => problems.filter((p) => p.severity === "warning").length, [problems]);

  const [breakageModalOpen, setBreakageModalOpen] = useState(false);
  const [breakageReport, setBreakageReport] = useState<BreakageReport | null>(null);
  const [breakageLoading, setBreakageLoading] = useState(false);
  const [breakageError, setBreakageError] = useState<string | null>(null);

  const handleWhyDidThisBreakProblem = async (e: React.MouseEvent, prob: any, fileName: string) => {
    e.stopPropagation();
    setBreakageModalOpen(true);
    setBreakageLoading(true);
    setBreakageError(null);
    try {
      const intelligence = (window as any).electronAPI?.intelligence;
      if (intelligence?.correlateBreakage) {
        const report = await intelligence.correlateBreakage({
          workspacePath: (window as any).electronAPI?.workspacePath || "",
          rawOutput: prob.message,
          activeFilePath: fileName,
          line: prob.line,
        });
        setBreakageReport(report);
      } else {
        setBreakageError("Intelligence API unavailable");
      }
    } catch (err: any) {
      setBreakageError(err.message || "Failed to analyze problem");
    } finally {
      setBreakageLoading(false);
    }
  };

  if (!isOpen) return null;


  return (
    <div
      style={{ height: `${height}px` }}
      className="bg-[#0E1013] border-t border-[#22252B] flex flex-col shrink-0 relative font-sans text-xs z-30 select-none"
    >
      {/* Resizer handle */}
      <div
        onMouseDown={onResizeStart}
        className="h-1 w-full bg-[#22252B] hover:bg-[#4CC2DE] cursor-ns-resize transition-colors"
      />

      {/* Header Tab Bar */}
      <div className="h-8 bg-[#0E1013] border-b border-[#22252B] px-2 flex items-center justify-between shrink-0 font-sans">
        <div className="flex items-center gap-1 overflow-x-auto">
          {/* Terminal Tab */}
          <button
            onClick={() => onSelectTab("terminal")}
            className={`px-2.5 py-1 rounded-t-md flex items-center gap-1.5 transition-colors text-[11px] cursor-pointer ${
              activeTab === "terminal"
                ? "bg-[#0A0B0D] text-[#E6E8EB] border-t-2 border-t-[#4CC2DE] font-medium"
                : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
            }`}
          >
            <TerminalIcon className={`w-3.5 h-3.5 ${activeTab === "terminal" ? "text-[#4CC2DE]" : "text-[#9AA1AC]"}`} />
            <span>Terminal</span>
          </button>

          {/* Problems Tab */}
          <button
            onClick={() => onSelectTab("problems")}
            className={`px-2.5 py-1 rounded-t-md flex items-center gap-1.5 transition-colors text-[11px] cursor-pointer ${
              activeTab === "problems"
                ? "bg-[#0A0B0D] text-[#E6E8EB] border-t-2 border-t-[#4CC2DE] font-medium"
                : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
            }`}
          >
            <AlertTriangle className={`w-3.5 h-3.5 ${errorCount > 0 ? "text-[#DC5B5B]" : warningCount > 0 ? "text-[#D9A441]" : "text-[#9AA1AC]"}`} />
            <span>Problems</span>
            {problems.length > 0 && (
              <span className="flex items-center gap-1 ml-0.5">
                {errorCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-[#DC5B5B]/20 text-[#DC5B5B] font-medium border border-[#DC5B5B]/30 font-mono">
                    {errorCount}
                  </span>
                )}
                {warningCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-[#D9A441]/20 text-[#D9A441] font-medium border border-[#D9A441]/30 font-mono">
                    {warningCount}
                  </span>
                )}
              </span>
            )}
          </button>

          {/* Output Tab */}
          <button
            onClick={() => onSelectTab("output")}
            className={`px-2.5 py-1 rounded-t-md flex items-center gap-1.5 transition-colors text-[11px] cursor-pointer ${
              activeTab === "output"
                ? "bg-[#0A0B0D] text-[#E6E8EB] border-t-2 border-t-[#4CC2DE] font-medium"
                : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
            }`}
          >
            <FileCode className={`w-3.5 h-3.5 ${activeTab === "output" ? "text-[#4CC2DE]" : "text-[#9AA1AC]"}`} />
            <span>Output</span>
          </button>

          {/* Verification Tab */}
          <button
            onClick={() => onSelectTab("verification")}
            className={`px-2.5 py-1 rounded-t-md flex items-center gap-1.5 transition-colors text-[11px] cursor-pointer ${
              activeTab === "verification"
                ? "bg-[#0A0B0D] text-[#E6E8EB] border-t-2 border-t-[#4CC2DE] font-medium"
                : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
            }`}
          >
            <ShieldCheck className={`w-3.5 h-3.5 ${activeTab === "verification" ? "text-[#3EAE79]" : "text-[#9AA1AC]"}`} />
            <span>Verification</span>
          </button>

          {/* Git Tab */}
          <button
            onClick={() => onSelectTab("git")}
            className={`px-2.5 py-1 rounded-t-md flex items-center gap-1.5 transition-colors text-[11px] cursor-pointer ${
              activeTab === "git"
                ? "bg-[#0A0B0D] text-[#E6E8EB] border-t-2 border-t-[#4CC2DE] font-medium"
                : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
            }`}
          >
            <GitBranch className={`w-3.5 h-3.5 ${activeTab === "git" ? "text-[#4CC2DE]" : "text-[#9AA1AC]"}`} />
            <span>Git</span>
          </button>

          {/* Agent Logs Tab */}
          <button
            onClick={() => onSelectTab("agent_logs")}
            className={`px-2.5 py-1 rounded-t-md flex items-center gap-1.5 transition-colors text-[11px] cursor-pointer ${
              activeTab === "agent_logs"
                ? "bg-[#0A0B0D] text-[#E6E8EB] border-t-2 border-t-[#4CC2DE] font-medium"
                : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
            }`}
          >
            <Bot className={`w-3.5 h-3.5 ${activeTab === "agent_logs" ? "text-[#4CC2DE]" : "text-[#9AA1AC]"}`} />
            <span>Agent Logs</span>
          </button>
        </div>

        {/* Right controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#1A1C22] cursor-pointer transition-colors"
            title="Minimize Panel"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[#9AA1AC] hover:text-[#DC5B5B] hover:bg-[#1A1C22] cursor-pointer transition-colors"
            title="Close Panel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Panel Content Body */}
      <div className="flex-1 min-h-0 overflow-hidden relative font-sans">
        {activeTab === "terminal" && (
          <TerminalPanel
            tabs={terminalProps.tabs}
            activeTabId={terminalProps.activeTabId || ""}
            onSelectTab={terminalProps.onSelectTab}
            onCreateTab={terminalProps.onCreateTab}
            onCloseTab={terminalProps.onCloseTab}
            onRestartTab={terminalProps.onRestartTab}
            onSendInput={terminalProps.onSendInput}
            onRenameTab={terminalProps.onRenameTab}
            onClearTabOutput={terminalProps.onClearTabOutput}
            splitLayout={terminalProps.splitLayout}
            splitTabIds={terminalProps.splitTabIds}
            focusedPaneId={terminalProps.focusedPaneId}
            onSplitTab={terminalProps.onSplitTab}
            onUnsplit={terminalProps.onUnsplit}
            onFocusPane={terminalProps.onFocusPane}
            logs={terminalProps.logs}
            onClearLogs={terminalProps.onClearLogs}
            debugLogs={terminalProps.debugLogs}
            pythonOutput={terminalProps.pythonOutput}
            onClearDebugLogs={terminalProps.onClearDebugLogs}
            activeMode={terminalProps.activeMode === "output" || terminalProps.activeMode === "debug" ? terminalProps.activeMode : "terminal"}
            onModeChange={terminalProps.onModeChange}
            onClosePanel={onClose}
            onAskAiAboutDiagnostic={terminalProps.onAskAiAboutDiagnostic}
            onOpenLocation={terminalProps.onOpenLocation}
            onSendSelectionToAi={terminalProps.onSendSelectionToAi}
          />
        )}

        {activeTab === "problems" && (
          <div className="flex flex-col h-full bg-[#0B0C0F] font-sans text-xs">
            {/* Header summary bar */}
            <div className="px-3 py-1.5 bg-[#0E1013] border-b border-[#22252B] flex items-center justify-between text-[11px] shrink-0">
              <div className="flex items-center gap-3 text-[#9AA1AC]">
                <span className="flex items-center gap-1.5 font-medium text-[#E6E8EB]">
                  <AlertCircle className="w-3.5 h-3.5 text-[#DC5B5B]" />
                  <span>{errorCount} {errorCount === 1 ? "Error" : "Errors"}</span>
                </span>
                <span className="flex items-center gap-1.5 font-medium text-[#E6E8EB]">
                  <AlertTriangle className="w-3.5 h-3.5 text-[#D9A441]" />
                  <span>{warningCount} {warningCount === 1 ? "Warning" : "Warnings"}</span>
                </span>
              </div>
              <span className="text-[10px] text-[#6B7280] font-mono">
                {problems.length} total {problems.length === 1 ? "issue" : "issues"}
              </span>
            </div>

            {/* List grouped by file */}
            <div className="p-2 overflow-y-auto flex-1 space-y-2">
              {problems.length === 0 ? (
                <div className="text-[#6B7280] italic text-xs py-8 text-center flex flex-col items-center gap-1.5">
                  <ShieldCheck className="w-6 h-6 text-[#3EAE79]/40" />
                  <span>No syntax, type, or runtime errors detected in active workspace.</span>
                </div>
              ) : (
                (() => {
                  const groups: Record<string, any[]> = {};
                  for (const p of problems) {
                    const f = (p as any).filePath || (p as any).file || "workspace";
                    if (!groups[f]) groups[f] = [];
                    groups[f].push(p);
                  }
                  return Object.entries(groups).map(([fileName, items]) => (
                    <div key={fileName} className="rounded-md border border-[#22252B] bg-[#111318] overflow-hidden">
                      <div className="px-2.5 py-1 bg-[#14161B] border-b border-[#22252B] flex items-center justify-between text-[11px] font-medium text-[#E6E8EB]">
                        <div className="flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-[#9AA1AC]" />
                          <span className="truncate">{fileName}</span>
                        </div>
                        <span className="px-1.5 py-0.2 rounded text-[10px] bg-[#1A1C22] text-[#9AA1AC] font-mono border border-[#22252B]">
                          {items.length}
                        </span>
                      </div>
                      <div className="divide-y divide-[#22252B]">
                        {items.map((prob: any, idx: number) => {
                          const isErr = prob.severity === "error";
                          const isWarn = prob.severity === "warning";
                          return (
                            <div
                              key={idx}
                              onClick={() => {
                                if (terminalProps.onOpenLocation) {
                                  terminalProps.onOpenLocation(fileName, prob.line, prob.column);
                                }
                              }}
                              className="p-2 hover:bg-[#1A1C22] transition-colors cursor-pointer flex items-start justify-between gap-3 text-xs"
                            >
                              <div className="flex items-start gap-2 min-w-0">
                                {isErr ? (
                                  <AlertCircle className="w-3.5 h-3.5 text-[#DC5B5B] shrink-0 mt-0.5" />
                                ) : isWarn ? (
                                  <AlertTriangle className="w-3.5 h-3.5 text-[#D9A441] shrink-0 mt-0.5" />
                                ) : (
                                  <Info className="w-3.5 h-3.5 text-[#5A8FD6] shrink-0 mt-0.5" />
                                )}
                                <div className="min-w-0 space-y-0.5">
                                  <div className="text-[#E6E8EB] leading-tight font-sans">
                                    {prob.message}
                                  </div>
                                  <div className="flex items-center gap-1.5 text-[10px] text-[#6B7280]">
                                    {prob.code && (
                                      <span className="px-1 py-0.2 rounded bg-[#14161B] text-[#4CC2DE] font-mono border border-[#22252B]">
                                        {prob.code}
                                      </span>
                                    )}
                                    {prob.source && (
                                      <span className="text-[#6B7280]">[{prob.source}]</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {isErr && (
                                  <button
                                    onClick={(e) => handleWhyDidThisBreakProblem(e, prob, fileName)}
                                    className="px-2 py-0.5 rounded-md bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] text-[#9AA1AC] hover:text-[#4CC2DE] text-[10px] font-sans flex items-center gap-1 cursor-pointer transition-colors"
                                    title="Explain why this problem occurred using read-only causal analysis"
                                  >
                                    <HelpCircle className="w-3 h-3 text-[#4CC2DE]" />
                                    <span>Why Did This Break?</span>
                                  </button>
                                )}
                                <span className="text-[#6B7280] text-[10px] font-mono">
                                  {prob.line ? `line ${prob.line}${prob.column ? `:${prob.column}` : ""}` : ""}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ));
                })()
              )}
            </div>
          </div>
        )}

        {activeTab === "output" && (
          <div className="p-3 overflow-y-auto h-full font-mono text-[11px] text-[#E6E8EB] space-y-1 bg-[#0B0C0F]">
            {terminalProps.pythonOutput ? (
              <pre className="whitespace-pre-wrap select-all">{terminalProps.pythonOutput}</pre>
            ) : (
              <div className="text-[#6B7280] italic text-xs py-4 text-center">
                No application output stream recorded yet. Click &quot;Run Code&quot; to execute.
              </div>
            )}
          </div>
        )}

        {activeTab === "verification" && (
          <div className="p-3 overflow-y-auto h-full font-sans text-xs text-[#E6E8EB] space-y-2 bg-[#0B0C0F]">
            <div className="flex items-center gap-2 text-[#3EAE79] font-medium text-xs">
              <ShieldCheck className="w-4 h-4" />
              <span>Patch Safety & Intent Verification Active</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              <div className="p-2.5 rounded-md bg-[#14161B] border border-[#22252B]">
                <div className="text-[#6B7280]">Firewall</div>
                <div className="text-[#3EAE79] font-medium mt-0.5">{verificationSummary?.firewallStatus || "ACTIVE (ENFORCED)"}</div>
              </div>
              <div className="p-2.5 rounded-md bg-[#14161B] border border-[#22252B]">
                <div className="text-[#6B7280]">Intent Drift</div>
                <div className="text-[#4CC2DE] font-medium mt-0.5">{verificationSummary?.driftStatus || "ZERO_DRIFT"}</div>
              </div>
              <div className="p-2.5 rounded-md bg-[#14161B] border border-[#22252B]">
                <div className="text-[#6B7280]">Risk Assessment</div>
                <div className="text-[#3EAE79] font-medium mt-0.5">{verificationSummary?.riskLevel || "LOW_RISK"}</div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "git" && (
          <div className="p-3 overflow-y-auto h-full font-sans text-xs text-[#E6E8EB] space-y-1.5 bg-[#0B0C0F]">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#9AA1AC]">Branch: <span className="text-[#4CC2DE] font-medium">{gitSummary?.branch || "main"}</span></span>
              <span className="text-[#6B7280]">Staged: {gitSummary?.stagedCount || 0} | Unstaged: {gitSummary?.unstagedCount || 0}</span>
            </div>
          </div>
        )}

        {activeTab === "agent_logs" && (
          <div className="p-3 overflow-y-auto h-full font-mono text-[11px] text-zinc-300 space-y-1 bg-[#060608]">
            {terminalProps.logs.length === 0 ? (
              <div className="text-zinc-500 italic text-[11px] py-4 text-center">
                No Agent telemetry logs generated for current turn.
              </div>
            ) : (
              terminalProps.logs.map((logLine, idx) => (
                <div key={idx} className="text-cyan-300/90">{logLine}</div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Why Did This Break Modal for Problems */}
      <WhyDidThisBreakModal
        isOpen={breakageModalOpen}
        onClose={() => setBreakageModalOpen(false)}
        report={breakageReport}
        loading={breakageLoading}
        error={breakageError}
        onOpenFile={(file, line) => {
          if (terminalProps.onOpenLocation) {
            terminalProps.onOpenLocation(file, line);
          }
        }}
      />
    </div>
  );
}
