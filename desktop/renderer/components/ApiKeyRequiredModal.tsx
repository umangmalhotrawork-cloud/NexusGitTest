"use client";

import React, { useState, useEffect } from "react";
import { Key, Shield, AlertCircle, Loader2, X, Lock, ChevronDown, Check } from "lucide-react";
import { useOutsideClick } from "../hooks/useOutsideClick";

interface ApiKeyRequiredModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (providerId?: string) => void;
  providerName?: string;
  providerId?: string;
}

const PROVIDER_METAS: Record<string, { name: string; placeholder: string; helpUrl: string }> = {
  nexus1: { name: "NEXUS 1 (Gemini)", placeholder: "AQ.Ab8RN6... / AIzaSy...", helpUrl: "https://aistudio.google.com/app/apikey" },
  nexus2: { name: "NEXUS 2 (Gemini)", placeholder: "AQ.Ab8RN6... / AIzaSy...", helpUrl: "https://aistudio.google.com/app/apikey" },
  nexus3: { name: "NEXUS 3 (Gemini)", placeholder: "AQ.Ab8RN6... / AIzaSy...", helpUrl: "https://aistudio.google.com/app/apikey" },
  nexus4: { name: "NEXUS 4 (Gemini)", placeholder: "AQ.Ab8RN6... / AIzaSy...", helpUrl: "https://aistudio.google.com/app/apikey" },
  nexus5: { name: "NEXUS 5 (Gemini)", placeholder: "AQ.Ab8RN6... / AIzaSy...", helpUrl: "https://aistudio.google.com/app/apikey" },
  nexus6: { name: "NEXUS 6 (Groq)", placeholder: "gsk_...", helpUrl: "https://console.groq.com/keys" },
  gemini: { name: "Google Gemini", placeholder: "AIzaSy...", helpUrl: "https://aistudio.google.com/app/apikey" },
  groq: { name: "Groq", placeholder: "gsk_...", helpUrl: "https://console.groq.com/keys" },
  openai: { name: "OpenAI", placeholder: "sk-...", helpUrl: "https://platform.openai.com/api-keys" },
  claude: { name: "Anthropic Claude", placeholder: "sk-ant-...", helpUrl: "https://console.anthropic.com/settings/keys" },
  deepseek: { name: "DeepSeek", placeholder: "sk-...", helpUrl: "https://platform.deepseek.com/api_keys" },
  grok: { name: "xAI Grok", placeholder: "xai-...", helpUrl: "https://console.x.ai/" },
};

export default function ApiKeyRequiredModal({
  isOpen,
  onClose,
  onSuccess,
  providerName,
  providerId = "gemini",
}: ApiKeyRequiredModalProps) {
  const [selectedProviderId, setSelectedProviderId] = useState<string>(providerId);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showProviderDropdown, setShowProviderDropdown] = useState(false);

  const modalRef = useOutsideClick<HTMLDivElement>({
    isOpen,
    onClose,
  });

  useEffect(() => {
    if (isOpen) {
      setSelectedProviderId(providerId || "gemini");
      setApiKey("");
      setErrorMessage(null);
      setLoading(false);
      setShowProviderDropdown(false);
    }
  }, [isOpen, providerId]);

  if (!isOpen) return null;

  const currentMeta = PROVIDER_METAS[selectedProviderId] || {
    name: providerName || selectedProviderId,
    placeholder: "Enter API key...",
    helpUrl: "",
  };

  const handleContinue = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = apiKey.trim();

    if (!trimmed) {
      setErrorMessage("API key cannot be empty.");
      return;
    }

    setLoading(true);
    setErrorMessage(null);

    try {
      if (typeof window !== "undefined" && (window as any).electronAPI?.ai?.setApiKey) {
        const res = await (window as any).electronAPI.ai.setApiKey(selectedProviderId, trimmed);
        if (res && res.success && res.status === "CONNECTED") {
          setLoading(false);
          setApiKey("");
          onSuccess(selectedProviderId);
          return;
        } else {
          setErrorMessage(res?.error || `Invalid API key or ${currentMeta.name} connection failed.`);
        }
      } else {
        setLoading(false);
        onSuccess(selectedProviderId);
        return;
      }
    } catch (err: any) {
      setErrorMessage(err.message || `Invalid API key or ${currentMeta.name} connection failed.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 select-none font-sans"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div 
        ref={modalRef}
        className="w-full max-w-md bg-[#111318] border border-[#22252B] rounded-xl shadow-modal overflow-hidden text-xs text-[#E6E8EB] font-sans"
      >
        
        {/* Header */}
        <div className="p-4 border-b border-[#22252B] flex items-center justify-between bg-[#0E1013]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-[#1A1C22] border border-[#22252B] flex items-center justify-center text-[#4CC2DE]">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-semibold text-sm text-[#E6E8EB]">{currentMeta.name} API Key Configuration</h2>
              <p className="text-[11px] text-[#9AA1AC]">Enter your {currentMeta.name} API key to enable AI features.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-[#9AA1AC] hover:text-[#E6E8EB] p-1 rounded-md hover:bg-[#14161B] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleContinue} className="p-4 space-y-3.5">
          {/* Provider Switcher */}
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[#9AA1AC]">
              Target Provider
            </label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowProviderDropdown(!showProviderDropdown)}
                disabled={loading}
                className="w-full bg-[#14161B] border border-[#22252B] hover:border-[#2E323B] rounded-md px-3 py-2 text-[#E6E8EB] flex items-center justify-between font-sans text-xs cursor-pointer"
              >
                <span className="font-medium text-[#4CC2DE]">{currentMeta.name}</span>
                <ChevronDown className="w-3.5 h-3.5 text-[#9AA1AC]" />
              </button>

              {showProviderDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#1A1C22] border border-[#22252B] rounded-md shadow-popover z-30 overflow-hidden py-1">
                  {Object.entries(PROVIDER_METAS).map(([pId, meta]) => {
                    const isSelected = selectedProviderId === pId;
                    return (
                      <button
                        key={pId}
                        type="button"
                        onClick={() => {
                          setSelectedProviderId(pId);
                          setShowProviderDropdown(false);
                          setErrorMessage(null);
                        }}
                        className={`w-full px-3 py-1.5 text-left text-xs font-sans flex items-center justify-between transition-colors cursor-pointer ${
                          isSelected ? "bg-[#14161B] text-[#4CC2DE] font-medium" : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#14161B]"
                        }`}
                      >
                        <span>{meta.name}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-[#4CC2DE]" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* API Key Input */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-[#9AA1AC] flex items-center justify-between">
              <span>{currentMeta.name} API Key</span>
              <span className="text-[#6B7280] text-[10px]">Format: {currentMeta.placeholder}</span>
            </label>
            <div className="relative">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                autoFocus
                placeholder={`Enter ${currentMeta.name} API key (${currentMeta.placeholder})`}
                disabled={loading}
                className="w-full bg-[#14161B] border border-[#22252B] focus:border-[#4CC2DE] rounded-md px-3 py-2 text-[#E6E8EB] placeholder-[#6B7280] outline-none text-xs font-mono transition-colors"
              />
              <Lock className="w-3.5 h-3.5 text-[#6B7280] absolute right-3 top-2.5 pointer-events-none" />
            </div>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="p-2.5 rounded-md bg-[#DC5B5B]/10 border border-[#DC5B5B]/30 text-[#DC5B5B] text-xs flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-[#DC5B5B] shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Security Note */}
          <div className="flex items-center justify-between text-[11px] text-[#6B7280] pt-1">
            <div className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-[#3EAE79] shrink-0" />
              <span>Stored securely in encrypted OS vault.</span>
            </div>
            {currentMeta.helpUrl && (
              <span className="text-[#4CC2DE]">Never shared between providers</span>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#22252B]">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-3.5 py-1.5 rounded-md bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] text-[#9AA1AC] hover:text-[#E6E8EB] text-xs font-medium cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !apiKey.trim()}
              className="px-4 py-1.5 rounded-md bg-[#4CC2DE] hover:bg-[#3db0cc] disabled:opacity-40 disabled:hover:bg-[#4CC2DE] text-[#0A0B0D] text-xs font-medium font-sans transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0A0B0D]" />
                  <span>Validating Key...</span>
                </>
              ) : (
                <span>Save & Connect</span>
              )}
            </button>
          </div>
        </form>

      </div>
    </div>
  );
}
