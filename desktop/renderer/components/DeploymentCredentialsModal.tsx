"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  X,
  Key,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Lock,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Trash2,
} from "lucide-react";

export interface ProviderMetadata {
  title: string;
  credentialLabel: string;
  placeholder: string;
  credentialField: "token" | "apiKey" | "authToken";
  helpText: string;
  helpUrl: string;
  helpLinkText: string;
  connectedDescription: string;
}

export const PROVIDER_METADATA: Record<string, ProviderMetadata> = {
  vercel: {
    title: "Connect Vercel",
    credentialLabel: "Vercel Personal Access Token",
    placeholder: "Paste your Vercel Token (e.g. vercel_pat_...)",
    credentialField: "token",
    helpText: "Tokens are encrypted using OS Keychain Services via Electron safeStorage. They are never sent to external servers or stored in plaintext.",
    helpUrl: "https://vercel.com/account/tokens",
    helpLinkText: "Create a token in Vercel Dashboard",
    connectedDescription: "Your Vercel Personal Access Token is securely encrypted on this machine. Sentinel AI can deploy projects directly to production.",
  },
  render: {
    title: "Connect Render",
    credentialLabel: "Render API Key",
    placeholder: "Paste your Render API Key (e.g. rnd_...)",
    credentialField: "apiKey",
    helpText: "API keys are encrypted using OS Keychain Services via Electron safeStorage. They are never sent to external servers or stored in plaintext.",
    helpUrl: "https://dashboard.render.com/u/settings#api-keys",
    helpLinkText: "Create an API key in Render Account Settings",
    connectedDescription: "Your Render API Key is securely encrypted on this machine. Sentinel AI can deploy services and databases directly to Render.",
  },
  netlify: {
    title: "Connect Netlify",
    credentialLabel: "Netlify Personal Access Token",
    placeholder: "Paste your Netlify Personal Access Token (e.g. nfp_...)",
    credentialField: "authToken",
    helpText: "Tokens are encrypted using OS Keychain Services via Electron safeStorage. They are never sent to external servers or stored in plaintext.",
    helpUrl: "https://app.netlify.com/user/applications#personal-access-tokens",
    helpLinkText: "Create a token in Netlify User Settings",
    connectedDescription: "Your Netlify Personal Access Token is securely encrypted on this machine. Sentinel AI can deploy frontend projects directly to Netlify.",
  },
  railway: {
    title: "Connect Railway",
    credentialLabel: "Railway API Token",
    placeholder: "Paste your Railway API Token",
    credentialField: "token",
    helpText: "Tokens are encrypted using OS Keychain Services via Electron safeStorage. They are never sent to external servers or stored in plaintext.",
    helpUrl: "https://railway.app/account/tokens",
    helpLinkText: "Create a token in Railway Account Settings",
    connectedDescription: "Your Railway API Token is securely encrypted on this machine.",
  },
  flyio: {
    title: "Connect Fly.io",
    credentialLabel: "Fly.io Auth Token",
    placeholder: "Paste your Fly.io Auth Token",
    credentialField: "token",
    helpText: "Tokens are encrypted using OS Keychain Services via Electron safeStorage. They are never sent to external servers or stored in plaintext.",
    helpUrl: "https://fly.io/user/personal_access_tokens",
    helpLinkText: "Create a token in Fly.io User Settings",
    connectedDescription: "Your Fly.io Auth Token is securely encrypted on this machine.",
  },
};

export function getProviderConfig(providerId: string, displayName?: string): ProviderMetadata {
  const normId = String(providerId || "").toLowerCase();
  if (PROVIDER_METADATA[normId]) {
    return PROVIDER_METADATA[normId];
  }
  const name = displayName || providerId || "Provider";
  return {
    title: `Connect ${name}`,
    credentialLabel: `${name} Access Token / API Key`,
    placeholder: `Paste your ${name} Token`,
    credentialField: "token",
    helpText: "Tokens are encrypted using OS Keychain Services via Electron safeStorage. They are never sent to external servers or stored in plaintext.",
    helpUrl: "https://nexus.local",
    helpLinkText: `${name} Settings`,
    connectedDescription: `Your ${name} credentials are securely encrypted on this machine.`,
  };
}

interface DeploymentCredentialsModalProps {
  providerId: string;
  providerDisplayName: string;
  onClose: () => void;
  onStatusChange?: (isConnected: boolean) => void;
}

export default function DeploymentCredentialsModal({
  providerId,
  providerDisplayName,
  onClose,
  onStatusChange,
}: DeploymentCredentialsModalProps) {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const config = useMemo(
    () => getProviderConfig(providerId, providerDisplayName),
    [providerId, providerDisplayName]
  );

  const checkAuthStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.intelligence?.getProviderAuthStatus) {
        const res = await electronAPI.intelligence.getProviderAuthStatus(providerId);
        setIsConnected(Boolean(res?.isConnected));
        onStatusChange?.(Boolean(res?.isConnected));
      }
    } catch (err: any) {
      setError(err?.message || `Failed to check ${config.title} authentication status.`);
    } finally {
      setLoading(false);
    }
  }, [providerId, config.title, onStatusChange]);

  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      setError(`Please enter a valid ${config.credentialLabel}.`);
      return;
    }

    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.intelligence?.saveProviderCredential) {
        const credentialPayload: Record<string, string> = {
          [config.credentialField]: trimmed,
        };

        const res = await electronAPI.intelligence.saveProviderCredential({
          providerId,
          credential: credentialPayload,
        });

        // Immediately purge token from component state
        setToken("");

        if (res?.success && res?.isConnected) {
          setIsConnected(true);
          setSuccessMsg(`${providerDisplayName || config.title} credentials successfully encrypted and saved.`);
          onStatusChange?.(true);
        } else {
          setError(res?.error || `Failed to save ${providerDisplayName || config.title} credential.`);
        }
      }
    } catch (err: any) {
      setError(err?.message || `Failed to save ${providerDisplayName || config.title} credential.`);
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.intelligence?.removeProviderCredential) {
        await electronAPI.intelligence.removeProviderCredential(providerId);
        setIsConnected(false);
        setSuccessMsg(`${providerDisplayName || config.title} credentials removed from local vault.`);
        onStatusChange?.(false);
      }
    } catch (err: any) {
      setError(err?.message || `Failed to remove ${providerDisplayName || config.title} credential.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-6 select-none font-mono">
      <div className="w-full max-w-lg bg-[#0c0d14] border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden text-zinc-200">
        {/* Header */}
        <header className="px-6 py-4 border-b border-zinc-800 bg-[#0f111a] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center border ${
              isConnected
                ? "bg-emerald-950/80 border-emerald-500/40 text-emerald-400"
                : "bg-cyan-950/80 border-cyan-500/40 text-cyan-400"
            }`}>
              {isConnected ? <CheckCircle2 className="w-5 h-5" /> : <Key className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-100">{config.title}</h2>
              <p className="text-xs text-zinc-400">Encrypted Local Credential Storage</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Body */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-2.5">
              <XCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3.5 rounded-lg bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{successMsg}</span>
            </div>
          )}

          {loading ? (
            <div className="p-8 text-center space-y-2">
              <RefreshCw className="w-5 h-5 text-cyan-400 animate-spin mx-auto" />
              <p className="text-xs text-zinc-400">Checking vault status…</p>
            </div>
          ) : isConnected ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#111420] border border-emerald-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    <span className="text-sm font-bold text-zinc-100">{providerDisplayName || config.title} Connected</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/40">
                    CONNECTED ✓
                  </span>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed font-semibold">
                  {providerDisplayName || config.title} credentials are securely stored and available to Sentinel AI.
                </p>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  {config.connectedDescription}
                </p>
              </div>

              <div className="p-3 rounded-lg bg-[#11131c] border border-zinc-800 text-[11px] text-zinc-400 space-y-1">
                <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Encrypted Storage Active</span>
                </div>
                <p className="leading-relaxed">
                  Credentials are encrypted using OS Keychain Services via Electron safeStorage. They are never sent in plaintext.
                </p>
              </div>

              <div className="pt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-500/40 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {saving ? "Disconnecting…" : "Disconnect Account"}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex items-center gap-1.5 px-5 py-1.5 rounded-md text-xs font-medium bg-[#4CC2DE] hover:bg-[#38b2ce] text-[#0E1013] transition-colors cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Done</span>
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-300 block">
                  {config.credentialLabel}
                </label>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={config.placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  className="w-full px-3.5 py-2 rounded-lg bg-[#08090d] border border-zinc-700 text-xs font-mono text-zinc-200 focus:outline-none focus:border-cyan-500 transition-colors"
                />
              </div>

              <div className="p-3 rounded-lg bg-[#11131c] border border-zinc-800 text-[11px] text-zinc-400 space-y-1.5">
                <div className="flex items-center gap-1.5 text-cyan-400 font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Security Notice</span>
                </div>
                <p className="leading-relaxed">
                  {config.helpText}
                </p>
                <a
                  href={config.helpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 pt-1"
                >
                  <span>{config.helpLinkText}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-1.5 rounded-md text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !token.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium bg-[#4CC2DE] hover:bg-[#38b2ce] text-[#0E1013] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Lock className="w-3.5 h-3.5" />
                  {saving ? "Encrypting…" : "Save & Connect"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
