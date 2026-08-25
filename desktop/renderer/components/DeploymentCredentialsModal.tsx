"use client";

import React, { useState, useEffect, useCallback } from "react";
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
      setError(err?.message || "Failed to check provider authentication status.");
    } finally {
      setLoading(false);
    }
  }, [providerId, onStatusChange]);

  useEffect(() => {
    checkAuthStatus();
  }, [checkAuthStatus]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setError("Please enter a valid Vercel Personal Access Token.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.intelligence?.saveProviderCredential) {
        const res = await electronAPI.intelligence.saveProviderCredential({
          providerId,
          credential: { token: token.trim() },
        });

        // Immediately purge token from component state
        setToken("");

        if (res?.success && res?.isConnected) {
          setIsConnected(true);
          setSuccessMsg("Vercel credentials successfully encrypted and saved to local keychain.");
          onStatusChange?.(true);
        } else {
          setError(res?.error || "Failed to save credential.");
        }
      }
    } catch (err: any) {
      setError(err?.message || "Failed to save credential.");
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
        setSuccessMsg("Vercel credentials removed from local vault.");
        onStatusChange?.(false);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to remove credential.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6 select-none font-mono">
      <div className="w-full max-w-lg bg-[#0c0d14] border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden text-zinc-200">
        {/* Header */}
        <header className="px-6 py-4 border-b border-zinc-800 bg-[#0f111a] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-100">Connect {providerDisplayName}</h2>
              <p className="text-xs text-zinc-400">Encrypted Local Credential Storage</p>
            </div>
          </div>

          <button
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
            <div className="p-4 rounded-xl bg-[#111420] border border-emerald-500/30 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <span className="text-sm font-bold text-zinc-100">{providerDisplayName} Connected</span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/40">
                  READY TO DEPLOY
                </span>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Your Vercel Personal Access Token is securely encrypted on this machine. NEXUS can deploy projects directly to production.
              </p>
              <div className="pt-2 flex justify-end">
                <button
                  onClick={handleDisconnect}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-rose-950/60 hover:bg-rose-900 text-rose-300 border border-rose-500/40 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {saving ? "Disconnecting…" : "Disconnect Account"}
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-300 block">
                  Vercel Personal Access Token
                </label>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Paste your Vercel Token (e.g. vercel_pat_...)"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full px-3.5 py-2 rounded-lg bg-[#08090d] border border-zinc-700 text-xs font-mono text-zinc-200 focus:outline-none focus:border-cyan-500 transition-colors"
                />
              </div>

              <div className="p-3 rounded-lg bg-[#11131c] border border-zinc-800 text-[11px] text-zinc-400 space-y-1.5">
                <div className="flex items-center gap-1.5 text-cyan-400 font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Security Notice</span>
                </div>
                <p className="leading-relaxed">
                  Tokens are encrypted using OS Keychain Services via Electron safeStorage. They are never sent to external servers or stored in plaintext.
                </p>
                <a
                  href="https://vercel.com/account/tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 pt-1"
                >
                  <span>Create a token in Vercel Dashboard</span>
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
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_10px_rgba(6,182,212,0.3)] cursor-pointer"
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
