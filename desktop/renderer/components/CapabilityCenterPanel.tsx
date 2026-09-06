"use client";

import React, { useState } from "react";
import {
  Plug,
  Server,
  Sparkles,
  RefreshCw,
  Play,
  Square,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Shield,
  Activity,
  Layers,
  ChevronDown,
  ChevronRight,
  Code2,
  Trash2,
  Lock,
  Eye,
  Settings2,
} from "lucide-react";
import { useCapabilityCenter, MCPServerInfo, SkillInfo } from "../hooks/useCapabilityCenter";

interface CapabilityCenterPanelProps {
  workspacePath?: string;
  onClose?: () => void;
}

export default function CapabilityCenterPanel({
  workspacePath,
  onClose,
}: CapabilityCenterPanelProps) {
  const {
    servers,
    skills,
    capabilities,
    logs,
    configStatus,
    loading,
    selectedServerId,
    setSelectedServerId,
    startServer,
    stopServer,
    restartServer,
    enableSkill,
    disableSkill,
    reloadCapabilities,
    clearLogs,
  } = useCapabilityCenter(workspacePath);

  const [activeTab, setActiveTab] = useState<"servers" | "skills" | "logs">("servers");
  const [skillScopeFilter, setSkillScopeFilter] = useState<"ALL" | "PROJECT" | "BUILTIN">("ALL");
  const [isReloading, setIsReloading] = useState(false);

  const handleReload = async () => {
    setIsReloading(true);
    await reloadCapabilities();
    setTimeout(() => setIsReloading(false), 400);
  };

  const filteredSkills = skills.filter((s) => {
    if (skillScopeFilter === "PROJECT") return s.scope === "PROJECT" || s.source === "project";
    if (skillScopeFilter === "BUILTIN") return s.scope === "BUILTIN" || s.source === "builtin";
    return true;
  });

  const selectedServer = servers.find((s) => s.serverId === selectedServerId) || servers[0] || null;

  return (
    <div className="flex flex-col h-full bg-[#0B0C0E] text-[#CCCCCC] font-sans select-none overflow-hidden">
      {/* Header & Config State Summary */}
      <div className="p-3 border-b border-[#22252B] bg-[#0E1013] flex items-center justify-between shrink-0 font-sans">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-[#14161B] border border-[#22252B] text-[#4CC2DE]">
            <Plug className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-semibold text-[#E6E8EB] flex items-center gap-2">
              <span>Capability Operations</span>
            </div>
            <div className="text-[10px] text-[#868C96] flex items-center gap-2 font-mono">
              <span>mcp.json:</span>
              <span
                className={`font-medium ${
                  configStatus.mcpStatus === "VALID"
                    ? "text-[#3EAE79]"
                    : configStatus.mcpStatus === "INVALID"
                    ? "text-[#DC5B5B]"
                    : "text-[#868C96]"
                }`}
              >
                {configStatus.mcpStatus}
              </span>
              <span>• skills:</span>
              <span
                className={`font-medium ${
                  configStatus.skillsStatus === "DISCOVERED"
                    ? "text-[#4CC2DE]"
                    : configStatus.skillsStatus === "INVALID_ENTRIES"
                    ? "text-[#D9A441]"
                    : "text-[#868C96]"
                }`}
              >
                {configStatus.skillsStatus}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleReload}
            disabled={isReloading}
            className="px-2.5 py-1 rounded-md bg-[#14161B] hover:bg-[#1A1C22] text-[#CCCCCC] hover:text-[#E6E8EB] border border-[#22252B] flex items-center gap-1 text-[11px] font-medium cursor-pointer transition-colors"
            title="Hot Reload Capabilities from Disk"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isReloading ? "animate-spin text-[#4CC2DE]" : ""}`} />
            <span>Reload</span>
          </button>
        </div>
      </div>

      {/* Configuration Errors Banner (if any) */}
      {configStatus.errors.length > 0 && (
        <div className="px-3 py-2 bg-rose-950/20 border-b border-rose-500/30 text-rose-300 text-[11px] flex items-start gap-2 shrink-0">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1 space-y-0.5 font-mono text-[10.5px]">
            <span className="font-semibold text-rose-200">Configuration Issues Detected:</span>
            {configStatus.errors.map((err, idx) => (
              <div key={idx} className="text-rose-400 truncate">
                • {err}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-1 px-3 py-1.5 bg-[#0E1013] border-b border-[#22252B] shrink-0 font-sans text-xs">
        <button
          onClick={() => setActiveTab("servers")}
          className={`px-2.5 py-1 rounded-md flex items-center gap-1.5 text-[11px] font-medium cursor-pointer transition-colors ${
            activeTab === "servers"
              ? "bg-[#1A1C22] text-[#E6E8EB] border border-[#22252B]"
              : "text-[#868C96] hover:text-[#E6E8EB] hover:bg-[#14161B]"
          }`}
        >
          <Server className="w-3.5 h-3.5 text-[#4CC2DE]" />
          <span>MCP Servers ({servers.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("skills")}
          className={`px-2.5 py-1 rounded-md flex items-center gap-1.5 text-[11px] font-medium cursor-pointer transition-colors ${
            activeTab === "skills"
              ? "bg-[#1A1C22] text-[#E6E8EB] border border-[#22252B]"
              : "text-[#868C96] hover:text-[#E6E8EB] hover:bg-[#14161B]"
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-[#4CC2DE]" />
          <span>Skills ({skills.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("logs")}
          className={`px-2.5 py-1 rounded-md flex items-center gap-1.5 text-[11px] font-medium cursor-pointer transition-colors ${
            activeTab === "logs"
              ? "bg-[#1A1C22] text-[#E6E8EB] border border-[#22252B]"
              : "text-[#868C96] hover:text-[#E6E8EB] hover:bg-[#14161B]"
          }`}
        >
          <Activity className="w-3.5 h-3.5 text-[#4CC2DE]" />
          <span>Operator Logs ({logs.length})</span>
        </button>
      </div>

      {/* Main View Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 font-mono text-xs">
        {/* ========================================================= */}
        {/* TAB 1: MCP SERVERS & TOOL INSPECTOR */}
        {/* ========================================================= */}
        {activeTab === "servers" && (
          <div className="space-y-3">
            {servers.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-[#22252B] rounded-lg text-[#868C96] text-xs space-y-2">
                <Server className="w-8 h-8 text-[#6B7280] mx-auto opacity-50" />
                <p className="text-sm font-semibold text-[#E6E8EB]">No MCP servers registered in current workspace</p>
                <p className="text-xs text-[#868C96]">
                  Declare servers in <code className="text-[#4CC2DE]">.nexus/mcp.json</code> to hydrate automatically.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {servers.map((srv) => {
                  const isRunning = srv.status === "RUNNING";
                  const isStarting = srv.status === "STARTING";
                  const isFailed = srv.status === "FAILED";
                  const isSelected = selectedServer?.serverId === srv.serverId;

                  return (
                    <div
                      key={srv.serverId}
                      className={`p-3 rounded-lg border transition-colors ${
                        isSelected
                          ? "bg-[#14161B] border-[#4CC2DE]"
                          : "bg-[#111318] border-[#22252B] hover:border-[#333842]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div
                          className="flex items-center gap-2 cursor-pointer flex-1 min-w-0"
                          onClick={() => setSelectedServerId(srv.serverId)}
                        >
                          <div
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              isRunning
                                ? "bg-[#3EAE79]"
                                : isStarting
                                ? "bg-[#D9A441]"
                                : isFailed
                                ? "bg-[#DC5B5B]"
                                : "bg-[#6B7280]"
                            }`}
                          />
                          <span className="font-semibold text-[#E6E8EB] text-xs truncate">{srv.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1A1C22] text-[#868C96] border border-[#22252B]">
                            {srv.transport}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                              isRunning
                                ? "bg-emerald-950/80 text-emerald-300 border border-emerald-500/30"
                                : isStarting
                                ? "bg-amber-950/80 text-amber-300 border border-amber-500/30"
                                : isFailed
                                ? "bg-rose-950/80 text-rose-300 border border-rose-500/30"
                                : "bg-[#1A1C22] text-[#868C96] border border-[#22252B]"
                            }`}
                          >
                            {srv.status}
                          </span>
                        </div>

                        {/* Lifecycle Control Actions */}
                        <div className="flex items-center gap-1 shrink-0">
                          {isRunning ? (
                            <button
                              onClick={() => restartServer(srv.serverId)}
                              className="px-2 py-1 rounded-md bg-[#1A1C22] hover:bg-[#22252B] text-[#CCCCCC] border border-[#22252B] flex items-center gap-1 text-[11px] font-medium cursor-pointer transition-colors"
                              title="Restart Server"
                            >
                              <RotateCcw className="w-3 h-3 text-[#CCCCCC]" />
                              <span>Restart</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => startServer(srv.serverId)}
                              disabled={isStarting}
                              className="px-2 py-1 rounded-md bg-[#4CC2DE] hover:bg-[#3db0cc] text-[#0A0B0D] flex items-center gap-1 text-[11px] font-medium cursor-pointer transition-colors disabled:opacity-40"
                              title="Start Server"
                            >
                              <Play className="w-3 h-3 fill-current" />
                              <span>Start</span>
                            </button>
                          )}
                          {isRunning && (
                            <button
                              onClick={() => stopServer(srv.serverId)}
                              className="px-2 py-1 rounded-md bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-500/30 flex items-center gap-1 text-[11px] font-medium cursor-pointer transition-colors"
                              title="Stop Server"
                            >
                              <Square className="w-3 h-3 fill-current text-rose-300" />
                              <span>Stop</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Server Details & Error info */}
                      <div className="mt-2 text-[11px] text-[#868C96] flex items-center justify-between border-t border-[#22252B] pt-2 font-mono">
                        <div className="truncate">ID: <code className="text-[#CCCCCC]">{srv.serverId}</code></div>
                        <div>Tools: <span className="text-[#4CC2DE] font-semibold">{srv.tools?.length || srv.toolCount || 0}</span></div>
                      </div>

                      {srv.lastError && (
                        <div className="mt-1 text-[11px] text-rose-400 bg-rose-950/20 p-2 rounded-md border border-rose-500/30 truncate font-mono">
                          Error: {srv.lastError}
                        </div>
                      )}

                      {/* Exposed Tools Inspector */}
                      {isSelected && srv.tools && srv.tools.length > 0 && (
                        <div className="mt-2.5 pt-2 border-t border-[#22252B] space-y-1.5">
                          <div className="text-[10px] font-medium text-[#868C96] uppercase tracking-wider flex items-center justify-between">
                            <span>Exposed Tools ({srv.tools.length})</span>
                            <span className="text-[#6B7280]">CapabilityRegistry Hydrated</span>
                          </div>
                          <div className="space-y-1">
                            {srv.tools.map((t) => (
                              <div
                                key={t.name}
                                className="p-2 rounded-md bg-[#0E1013] border border-[#22252B] text-[11px] space-y-0.5"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-semibold text-[#4CC2DE] flex items-center gap-1">
                                    <Code2 className="w-3 h-3 text-[#4CC2DE]" />
                                    {t.name}
                                  </span>
                                  <div className="flex items-center gap-1">
                                    {t.riskLevel && (
                                      <span
                                        className={`text-[9px] px-1 py-0.5 rounded font-medium ${
                                          t.riskLevel === "SAFE"
                                            ? "bg-emerald-950/80 text-emerald-300 border border-emerald-500/30"
                                            : t.riskLevel === "REVIEW_REQUIRED"
                                            ? "bg-amber-950/80 text-amber-300 border border-amber-500/30"
                                            : "bg-rose-950/80 text-rose-300 border border-rose-500/30"
                                        }`}
                                      >
                                        {t.riskLevel}
                                      </span>
                                    )}
                                    {t.isReadOnly && (
                                      <span className="text-[9px] px-1 py-0.5 rounded bg-[#1A1C22] text-[#868C96] border border-[#22252B]">
                                        Read-Only
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="text-[#868C96] text-[10px] line-clamp-1">{t.description}</div>
                              </div>
                            ))}
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

        {/* ========================================================= */}
        {/* TAB 2: SKILL CENTER */}
        {/* ========================================================= */}
        {activeTab === "skills" && (
          <div className="space-y-3">
            {/* Scope Filter */}
            <div className="flex items-center gap-1.5 text-[11px] font-sans">
              <span className="text-[#868C96]">Scope:</span>
              {(["ALL", "PROJECT", "BUILTIN"] as const).map((sc) => (
                <button
                  key={sc}
                  onClick={() => setSkillScopeFilter(sc)}
                  className={`px-2.5 py-0.5 rounded-md cursor-pointer transition-colors font-medium text-[10px] ${
                    skillScopeFilter === sc
                      ? "bg-[#1A1C22] text-[#E6E8EB] border border-[#22252B]"
                      : "text-[#868C96] hover:text-[#E6E8EB] bg-[#14161B] border border-transparent"
                  }`}
                >
                  {sc}
                </button>
              ))}
            </div>

            {filteredSkills.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-[#22252B] rounded-lg text-[#868C96] text-xs">
                No skills matching scope filter.
              </div>
            ) : (
              <div className="space-y-2">
                {filteredSkills.map((sk) => {
                  const isActive = sk.status === "ACTIVE" && sk.enabled;
                  const isBuiltin = sk.scope === "BUILTIN" || sk.source === "builtin";

                  return (
                    <div
                      key={sk.skillId}
                      className="p-3 rounded-lg bg-[#111318] border border-[#22252B] hover:border-[#333842] transition-colors space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 truncate">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              isActive ? "bg-[#3EAE79]" : "bg-[#6B7280]"
                            }`}
                          />
                          <span className="font-semibold text-[#E6E8EB] text-xs truncate">{sk.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1A1C22] text-[#868C96] border border-[#22252B]">
                            v{sk.version}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-[#14161B] text-[#4CC2DE] border border-[#22252B]">
                            {sk.scope}
                          </span>
                        </div>

                        {/* Skill Toggle Button */}
                        <div>
                          <button
                            onClick={() => (isActive ? disableSkill(sk.skillId) : enableSkill(sk.skillId))}
                            className={`px-2.5 py-0.5 rounded-md text-[10px] font-medium cursor-pointer transition-colors ${
                              isActive
                                ? "bg-emerald-950/80 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-900"
                                : "bg-[#1A1C22] text-[#868C96] border border-[#22252B] hover:text-[#E6E8EB]"
                            }`}
                          >
                            {isActive ? "ACTIVE" : "DISABLED"}
                          </button>
                        </div>
                      </div>

                      <div className="text-[11px] text-[#868C96] line-clamp-2">{sk.description}</div>

                      {/* Triggers & Dependencies Badges */}
                      <div className="flex flex-wrap items-center gap-1 text-[10px] pt-1">
                        {sk.triggers?.map((trig, idx) => (
                          <span key={idx} className="px-1.5 py-0.5 rounded bg-[#0E1013] text-[#868C96] border border-[#22252B]">
                            #{trig}
                          </span>
                        ))}
                        {sk.requires && sk.requires.length > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-950/40 text-amber-300 border border-amber-500/30">
                            requires: {sk.requires.join(", ")}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 3: OPERATOR LOGS */}
        {/* ========================================================= */}
        {activeTab === "logs" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-sans text-[#868C96] pb-1 border-b border-[#22252B]">
              <span>Real-time Capability Event Stream (Sanitized)</span>
              <button
                onClick={clearLogs}
                className="text-[#868C96] hover:text-rose-400 flex items-center gap-1 cursor-pointer transition-colors"
                title="Clear Logs"
              >
                <Trash2 className="w-3 h-3" />
                <span>Clear</span>
              </button>
            </div>

            {logs.length === 0 ? (
              <div className="p-8 text-center text-[#868C96] text-xs">No capability logs captured yet.</div>
            ) : (
              <div className="space-y-1 font-mono text-[10px]">
                {logs.map((lg) => (
                  <div
                    key={lg.id}
                    className="p-2 rounded-md bg-[#0E1013] border border-[#22252B] flex items-start gap-2 text-[#CCCCCC] leading-relaxed"
                  >
                    <span className="text-[#6B7280] shrink-0">
                      {new Date(lg.timestamp).toLocaleTimeString()}
                    </span>
                    <span
                      className={`px-1 rounded text-[9px] font-medium shrink-0 ${
                        lg.status === "SUCCESS"
                          ? "bg-emerald-950/80 text-emerald-400 border border-emerald-500/30"
                          : lg.status === "ERROR"
                          ? "bg-rose-950/80 text-rose-400 border border-rose-500/30"
                          : lg.status === "WARN"
                          ? "bg-amber-950/80 text-amber-400 border border-amber-500/30"
                          : "bg-[#14161B] text-[#4CC2DE] border border-[#22252B]"
                      }`}
                    >
                      {lg.status}
                    </span>
                    <span className="text-[#CCCCCC] break-all flex-1">{lg.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
