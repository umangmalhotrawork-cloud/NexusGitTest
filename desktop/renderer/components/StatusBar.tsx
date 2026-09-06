"use client";

import React, { useState, useEffect, useRef } from "react";
import { GitBranch, ShieldCheck, ChevronDown, Bot, Key, X, Loader2, Layers, Cpu, Check, Github } from "lucide-react";
import { useOutsideClick } from "../hooks/useOutsideClick";

interface StatusBarProps {
  gitBranch?: string;
  activeLanguage?: string;
  activeFilePath?: string;
  sessionTitle?: string;
  errorCount?: number;
  verificationActive?: boolean;
  onOpenAiConfig?: () => void;
  activeTask?: string;
  onSelectVerificationTab?: () => void;
  onSelectAgentPanel?: () => void;
  onSelectSourceControl?: () => void;
  activeProvider?: string;
  activeModel?: string;
  onSelectModel?: (providerId: string, modelId?: string) => void;
  onOpenGithub?: () => void;
}

export default function StatusBar({
  gitBranch = "main",
  activeLanguage = "python",
  activeFilePath,
  sessionTitle,
  errorCount = 0,
  verificationActive = true,
  onOpenAiConfig,
  activeTask,
  onSelectVerificationTab,
  onSelectAgentPanel,
  onSelectSourceControl,
  activeProvider,
  activeModel,
  onSelectModel,
  onOpenGithub,
}: StatusBarProps) {
  const [aiConfig, setAiConfig] = useState<any>(null);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [selectedKeyProviderId, setSelectedKeyProviderId] = useState("gemini");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [keyValidationMsg, setKeyValidationMsg] = useState("");
  const [validatingKey, setValidatingKey] = useState(false);

  const statusModelTriggerRef = useRef<HTMLButtonElement | null>(null);
  const statusModelDropdownRef = useOutsideClick<HTMLDivElement>({
    isOpen: showModelDropdown,
    onClose: () => setShowModelDropdown(false),
    triggerRef: statusModelTriggerRef,
  });

  const statusKeyModalRef = useOutsideClick<HTMLDivElement>({
    isOpen: showKeyModal,
    onClose: () => setShowKeyModal(false),
  });

  const fetchAiConfig = async () => {
    if (typeof window !== "undefined" && (window as any).electronAPI?.ai?.getConfig) {
      try {
        const config = await (window as any).electronAPI.ai.getConfig();
        if (config) setAiConfig(config);
      } catch (e) {
        console.error("[STATUS-BAR] Failed to fetch AI config:", e);
      }
    }
  };

  useEffect(() => {
    fetchAiConfig();

    let unsubscribeIpc: (() => void) | null = null;
    if (typeof window !== "undefined" && (window as any).electronAPI?.ai?.onConfigChange) {
      unsubscribeIpc = (window as any).electronAPI.ai.onConfigChange((cfg: any) => {
        if (cfg) setAiConfig(cfg);
      });
    }

    const handleDomConfigChange = () => {
      fetchAiConfig();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("nexus:ai-config-changed", handleDomConfigChange);
    }

    return () => {
      if (typeof unsubscribeIpc === "function") unsubscribeIpc();
      if (typeof window !== "undefined") {
        window.removeEventListener("nexus:ai-config-changed", handleDomConfigChange);
      }
    };
  }, []);

  const handleSelectModel = async (providerId: string, modelId?: string) => {
    if (onSelectModel) {
      onSelectModel(providerId, modelId);
    }
    if (typeof window !== "undefined" && (window as any).electronAPI?.ai?.setConfig) {
      try {
        await (window as any).electronAPI.ai.setConfig(providerId, modelId);
        fetchAiConfig();
      } catch (e) {
        console.error("[STATUS-BAR] Failed to set model config:", e);
      }
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("nexus:ai-config-changed", { detail: { providerId, modelId } }));
    }
    setShowModelDropdown(false);
  };

  const handleOpenKeyModal = (providerId: string) => {
    setSelectedKeyProviderId(providerId);
    setApiKeyInput("");
    setKeyValidationMsg("");
    setShowModelDropdown(false);
    setShowKeyModal(true);
  };

  const handleSaveApiKey = async () => {
    if (!apiKeyInput.trim()) return;
    setValidatingKey(true);
    setKeyValidationMsg("");
    try {
      if (typeof window !== "undefined" && (window as any).electronAPI?.ai?.setApiKey) {
        const res = await (window as any).electronAPI.ai.setApiKey(selectedKeyProviderId, apiKeyInput.trim());
        if (res.success) {
          setKeyValidationMsg("Connected successfully");
          setApiKeyInput("");
          fetchAiConfig();
          setTimeout(() => setShowKeyModal(false), 1000);
        } else {
          setKeyValidationMsg(`Validation failed: ${res.error || "Invalid key"}`);
        }
      }
    } catch (e: any) {
      setKeyValidationMsg(`Error: ${e.message}`);
    } finally {
      setValidatingKey(false);
    }
  };

  const handleRemoveApiKey = async () => {
    try {
      if (typeof window !== "undefined" && (window as any).electronAPI?.ai?.removeApiKey) {
        await (window as any).electronAPI.ai.removeApiKey(selectedKeyProviderId);
        setApiKeyInput("");
        setKeyValidationMsg("API key removed");
        fetchAiConfig();
      }
    } catch (e) {
      console.error("[STATUS-BAR] Remove key failed:", e);
    }
  };

  const currentProviderId = activeProvider || aiConfig?.activeProvider || "nexus1";
  const currentModelId = activeModel || aiConfig?.activeModel || "gemini-2.5-flash";
  const activeProviderObj = aiConfig?.providers?.find((p: any) => p.id === currentProviderId);
  const activeDiagnostics = activeProviderObj?.diagnostics;
  const isConfigured = activeProviderObj?.isConfigured;

  const formatSlotName = (name?: string) => name ? name.replace(/\bNEXUS\b/g, "Sentinel") : "Sentinel 1";

  const displayModelName = activeProviderObj 
    ? `${formatSlotName(activeProviderObj.name)} (${activeProviderObj.secondaryName || 'Gemini'})` 
    : `Sentinel 1 (Gemini)`;

  const targetKeyProvider = aiConfig?.providers?.find((p: any) => p.id === selectedKeyProviderId) || {
    id: selectedKeyProviderId,
    name: selectedKeyProviderId,
    keyPlaceholder: "Enter key...",
  };

  return (
    <footer 
      style={{
        backgroundColor: "var(--theme-surface, #0E1013)",
        borderColor: "var(--theme-border, #22252B)",
        color: "var(--theme-text-muted, #9AA1AC)",
      }}
      className="h-6 border-t px-3 flex items-center justify-between text-[11px] font-sans select-none shrink-0 z-40 relative"
    >
      {/* Left Items */}
      <div className="flex items-center gap-2.5">
        {/* Git Branch */}
        <button
          onClick={onSelectSourceControl}
          className="flex items-center gap-1 text-[#9AA1AC] hover:text-[#E6E8EB] font-medium cursor-pointer transition-colors"
          title={`Active Branch: ${gitBranch} (Click to open Source Control)`}
        >
          <GitBranch className="w-3 h-3 text-[#9AA1AC]" />
          <span>{gitBranch}</span>
        </button>

        <span className="text-[#22252B]">|</span>

        {/* Verification Status */}
        <button
          onClick={onSelectVerificationTab}
          className="flex items-center gap-1.5 text-[#9AA1AC] hover:text-[#E6E8EB] transition-colors cursor-pointer"
          title="Open Verification Panel"
        >
          <ShieldCheck className={`w-3.5 h-3.5 ${verificationActive ? "text-[#3EAE79]" : "text-[#D9A441]"}`} />
          <span>
            {verificationActive ? "AST Verified" : "Verification Pending"}
          </span>
        </button>

        {/* Error / Diagnostics Count */}
        {errorCount > 0 && (
          <>
            <span className="text-[#22252B]">|</span>
            <div className="flex items-center gap-1 text-[#DC5B5B] font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-[#DC5B5B]" />
              <span>{errorCount} {errorCount === 1 ? "Error" : "Errors"}</span>
            </div>
          </>
        )}

        {/* Active Task / Agent Status */}
        {activeTask && (
          <>
            <span className="text-[#22252B]">|</span>
            <button
              onClick={onSelectAgentPanel}
              className="flex items-center gap-1.5 text-[#9AA1AC] hover:text-[#E6E8EB] transition-colors truncate max-w-xs cursor-pointer"
              title={`Active Task: ${activeTask}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#4CC2DE]" />
              <span className="truncate">{activeTask}</span>
            </button>
          </>
        )}
      </div>

      {/* Right Items */}
      <div className="flex items-center gap-2.5">
        {/* Global Multi-Model AI Status & Selector */}
        <div className="relative">
          <button
            ref={statusModelTriggerRef}
            onClick={() => setShowModelDropdown(!showModelDropdown)}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] hover:border-[#2E323B] text-[#E6E8EB] transition-colors cursor-pointer font-medium text-[11px]"
            title={`Global AI Model & Provider Selector\nActive Slot: ${formatSlotName(activeProviderObj?.name)}\nProvider: ${activeProviderObj?.secondaryName || 'Gemini'}\nStatus: ${isConfigured ? 'Configured' : 'Not Configured'}\nLast Request: ${activeDiagnostics?.lastRequestAt ? new Date(activeDiagnostics.lastRequestAt).toLocaleTimeString() : 'Never'}\nLast Status: ${activeDiagnostics?.status || 'IDLE'}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isConfigured ? "bg-[#3EAE79]" : "bg-[#6B7280]"}`} />
            <Bot className="w-3 h-3 text-[#9AA1AC]" />
            <span className="truncate max-w-[130px]">AI: {displayModelName}</span>
            <span className="text-[#5A6072]">•</span>
            <span className="hidden sm:inline text-[#8C92A4] font-normal text-[10px]">
              {formatSlotName(activeProviderObj?.name)}
              <span className={isConfigured ? "text-[#3EAE79] ml-1 font-medium" : "text-[#6B7280] ml-1"}>
                ({isConfigured ? "Configured" : "No Key"})
              </span>
            </span>
            <ChevronDown className="w-3 h-3 text-[#6B7280] shrink-0" />
          </button>

          {/* Model Selector Dropdown */}
          {showModelDropdown && (
            <div 
              ref={statusModelDropdownRef}
              className="absolute right-0 bottom-7 w-84 bg-[#1A1C22] border border-[#22252B] rounded-lg shadow-popover z-50 p-2 space-y-1.5 text-xs font-sans text-[#E6E8EB]"
            >
              <div className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-wider px-1 border-b border-[#22252B] pb-1.5 flex items-center justify-between">
                <span>Select AI Slot & Provider</span>
                <button onClick={() => setShowModelDropdown(false)} className="text-[#9AA1AC] hover:text-[#E6E8EB] cursor-pointer">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {(aiConfig?.providers || [
                  { id: "nexus1", name: "Sentinel 1", secondaryName: "Gemini", status: "CONNECTED", isConfigured: true },
                  { id: "nexus2", name: "Sentinel 2", secondaryName: "Gemini", status: "NOT_CONFIGURED", isConfigured: false },
                  { id: "nexus3", name: "Sentinel 3", secondaryName: "Gemini", status: "NOT_CONFIGURED", isConfigured: false },
                  { id: "nexus4", name: "Sentinel 4", secondaryName: "Gemini", status: "NOT_CONFIGURED", isConfigured: false },
                  { id: "nexus5", name: "Sentinel 5", secondaryName: "Gemini", status: "NOT_CONFIGURED", isConfigured: false },
                  { id: "nexus6", name: "Sentinel 6", secondaryName: "Groq", status: "NOT_CONFIGURED", isConfigured: false },
                ]).map((provider: any) => {
                  const isSelected = (aiConfig?.activeProvider || "nexus1") === provider.id;
                  const isConnected = provider.isConfigured;
                  const pDiag = provider.diagnostics;

                  return (
                    <div
                      key={provider.id}
                      className={`p-2 rounded-md border transition-colors ${
                        isSelected
                          ? "bg-[#111318] border-[#2E323B]"
                          : "bg-[#14161B] border-[#22252B] hover:bg-[#1A1C22]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <button
                          onClick={() => {
                            handleSelectModel(provider.id);
                            if (!isConnected) {
                              handleOpenKeyModal(provider.id);
                            }
                          }}
                          className="flex items-center gap-1.5 font-medium text-xs hover:text-[#4CC2DE] cursor-pointer flex-1 text-left"
                        >
                          <span className={isSelected ? "text-[#4CC2DE]" : "text-[#E6E8EB]"}>
                            {isSelected ? "✓ " : "  "}{formatSlotName(provider.name)}
                          </span>
                          <span className="text-[10px] text-[#6B7280]">
                            ({provider.secondaryName || "Gemini"})
                          </span>
                        </button>

                        <div className="flex items-center gap-2">
                          <span className={`inline-block w-2 h-2 rounded-full ${isConnected ? "bg-[#3EAE79]" : "bg-[#6B7280]"}`} />
                          <span className={`text-[10px] ${isConnected ? "text-[#3EAE79] font-medium" : "text-[#6B7280]"}`}>
                            {isConnected ? "Connected" : "No Key"}
                          </span>
                          <button
                            onClick={() => handleOpenKeyModal(provider.id)}
                            className="px-2 py-0.5 rounded-md border border-[#22252B] bg-[#14161B] hover:bg-[#22252B] text-[10px] text-[#9AA1AC] hover:text-[#E6E8EB] flex items-center gap-1 cursor-pointer transition-colors"
                          >
                            <Key className="w-2.5 h-2.5" />
                            <span>{isConnected ? "Key" : "Configure"}</span>
                          </button>
                        </div>
                      </div>

                      {/* Unconfigured Slot Action Banner */}
                      {!isConnected && isSelected && (
                        <div className="mt-1.5 p-1.5 rounded-md bg-[#14161B] border border-[#22252B] flex items-center justify-between">
                          <span className="text-[10px] text-[#D9A441]">Slot has no API key</span>
                          <button
                            onClick={() => handleOpenKeyModal(provider.id)}
                            className="px-2 py-0.5 rounded-md bg-[#4CC2DE] hover:bg-[#6ED4EA] text-[#0A0B0D] text-[10px] font-medium cursor-pointer transition-colors"
                          >
                            Configure API Key
                          </button>
                        </div>
                      )}

                      {/* Diagnostic Status Row */}
                      <div className="mt-1 pt-1 border-t border-[#22252B] flex items-center justify-between text-[10px] text-[#6B7280]">
                        <span>Last: {pDiag?.lastRequestAt ? new Date(pDiag.lastRequestAt).toLocaleTimeString() : "Never"}</span>
                        <span className={pDiag?.status === "SUCCESS" ? "text-[#3EAE79]" : pDiag?.status?.includes("429") ? "text-[#D9A441]" : "text-[#6B7280]"}>
                          Status: {pDiag?.status || (isConnected ? "IDLE" : "NOT_CONFIGURED")}
                        </span>
                      </div>

                      {/* Provider Models */}
                      {Array.isArray(provider.models) && provider.models.length > 0 && isSelected && (
                        <div className="mt-1.5 pt-1.5 border-t border-[#22252B] space-y-1">
                          <div className="text-[10px] text-[#6B7280] font-semibold uppercase">Active Model:</div>
                          <div className="grid grid-cols-1 gap-1 max-h-40 overflow-y-auto pr-0.5">
                            {provider.models.map((m: any) => {
                              const isMSelected = (aiConfig?.activeModel || "gemini-2.5-flash") === m.id;
                              return (
                                <button
                                  key={m.id}
                                  onClick={() => handleSelectModel(provider.id, m.id)}
                                  className={`px-2 py-1 rounded-md text-[11px] text-left flex items-center justify-between border cursor-pointer transition-colors ${
                                    isMSelected
                                      ? "bg-[#111318] border-[#2E323B] text-[#4CC2DE] font-medium"
                                      : "bg-[#14161B] border-[#22252B] text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
                                  }`}
                                >
                                  <span className="truncate">{m.name || m.id}</span>
                                  {isMSelected && <Check className="w-3 h-3 text-[#4CC2DE] shrink-0" />}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <span className="text-[#22252B]">|</span>

        {/* GitHub Status Button */}
        <button
          onClick={onOpenGithub}
          className="flex items-center gap-1.5 text-[11px] text-[#9AA1AC] hover:text-[#E6E8EB] transition-colors cursor-pointer py-0.5 px-1.5 rounded-md hover:bg-[#1A1C22]"
          title="GitHub Account Connection & Repository Association"
        >
          <Github className="w-3.5 h-3.5 text-[#9AA1AC] shrink-0" />
          <span>GitHub</span>
        </button>
      </div>

      {/* API Key Modal */}
      {showKeyModal && (
        <div 
          ref={statusKeyModalRef}
          className="fixed bottom-8 right-3 w-84 p-3.5 bg-[#111318] border border-[#22252B] rounded-xl space-y-2.5 text-xs font-sans shadow-modal z-50"
        >
          <div className="flex items-center justify-between border-b border-[#22252B] pb-1.5">
            <div className="font-medium text-[#E6E8EB] flex items-center gap-1.5 text-xs">
              <Key className="w-3.5 h-3.5 text-[#4CC2DE]" />
              <span>{targetKeyProvider.name} Key Configuration</span>
            </div>
            <button onClick={() => setShowKeyModal(false)} className="text-[#9AA1AC] hover:text-[#E6E8EB] cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-2">
            <div className="text-[11px] text-[#6B7280]">
              Active Key: <span className="text-[#E6E8EB] font-mono select-all">{targetKeyProvider.maskedKey || "Not set (Session fallback active)"}</span>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-[#6B7280] font-semibold uppercase">{targetKeyProvider.name} API Key</label>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={targetKeyProvider.keyPlaceholder || "Enter API key..."}
                className="w-full bg-[#14161B] border border-[#22252B] focus:border-[#4CC2DE] rounded-md px-2.5 py-1.5 text-[#E6E8EB] placeholder-[#6B7280] outline-none text-xs font-sans"
              />
            </div>

            {keyValidationMsg && (
              <div className={`text-[11px] font-medium ${keyValidationMsg.includes("Connected") ? "text-[#3EAE79]" : "text-[#DC5B5B]"}`}>
                {keyValidationMsg}
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <button
                onClick={handleRemoveApiKey}
                className="px-2.5 py-1 rounded-md bg-[#DC5B5B]/10 border border-[#DC5B5B]/30 text-[#DC5B5B] hover:bg-[#DC5B5B]/20 text-[11px] font-medium cursor-pointer transition-colors"
              >
                Remove
              </button>

              <button
                onClick={handleSaveApiKey}
                disabled={validatingKey || !apiKeyInput.trim()}
                className="px-3 py-1 rounded-md bg-[#4CC2DE] hover:bg-[#6ED4EA] active:bg-[#2FA3C0] text-[#0A0B0D] text-[11px] font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40 transition-colors"
              >
                {validatingKey ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin text-[#0A0B0D]" />
                    <span>Validating...</span>
                  </>
                ) : (
                  <span>Save & Connect</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </footer>
  );
}
