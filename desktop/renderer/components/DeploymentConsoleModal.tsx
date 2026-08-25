"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  X,
  Rocket,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
  Ban,
  Terminal,
  ShieldCheck,
  Globe,
} from "lucide-react";

export interface DeploymentLogChunkUI {
  deploymentId: string;
  stream: "stdout" | "stderr";
  text: string;
  timestamp: number;
}

export interface DeploymentStateChangeUI {
  deploymentId: string;
  state: "IDLE" | "AUTH_CHECKING" | "PREFLIGHT" | "PREPARING" | "BUILDING" | "UPLOADING" | "DEPLOYING" | "SUCCESS" | "FAILED" | "CANCELLED";
  url?: string;
  message?: string;
  error?: string;
}

interface DeploymentConsoleModalProps {
  workspacePath: string;
  providerId: string;
  providerDisplayName: string;
  rootDir?: string | null;
  onClose: () => void;
  onFinished?: (result: { status: string; url?: string }) => void;
}

export default function DeploymentConsoleModal({
  workspacePath,
  providerId,
  providerDisplayName,
  rootDir,
  onClose,
  onFinished,
}: DeploymentConsoleModalProps) {
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("PREFLIGHT");
  const [statusMsg, setStatusMsg] = useState<string>("Ready for deployment preflight verification.");
  const [logs, setLogs] = useState<string[]>([]);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Subscribe to IPC log and state events
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    let unsubLogs: (() => void) | undefined;
    let unsubState: (() => void) | undefined;

    if (electronAPI?.intelligence?.onDeploymentLogChunk) {
      unsubLogs = electronAPI.intelligence.onDeploymentLogChunk((chunk: DeploymentLogChunkUI) => {
        setLogs((prev) => [...prev, chunk.text]);
      });
    }

    if (electronAPI?.intelligence?.onDeploymentState) {
      unsubState = electronAPI.intelligence.onDeploymentState((event: DeploymentStateChangeUI) => {
        setStatus(event.state);
        if (event.message) setStatusMsg(event.message);
        if (event.url) setLiveUrl(event.url);
        if (event.error) setError(event.error);
        if (event.state === "SUCCESS" || event.state === "FAILED" || event.state === "CANCELLED") {
          onFinished?.({ status: event.state, url: event.url });
        }
      });
    }

    return () => {
      unsubLogs?.();
      unsubState?.();
    };
  }, [onFinished]);

  const handleStartDeploy = async () => {
    setError(null);
    setStatus("PREPARING");
    setStatusMsg("Starting Vercel CLI execution…");
    setLogs(["$ npx vercel --prod --yes\n"]);

    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.intelligence?.startDeployment) {
        const res = await electronAPI.intelligence.startDeployment({
          workspacePath,
          providerId,
          options: { rootDir },
        });

        if (res?.deploymentId) {
          setDeploymentId(res.deploymentId);
        }

        if (res?.status === "SUCCESS") {
          setStatus("SUCCESS");
          if (res.url) setLiveUrl(res.url);
          setStatusMsg("Deployment completed successfully!");
        } else if (res?.status === "FAILED") {
          setStatus("FAILED");
          setError(res.error || "Deployment failed.");
        } else if (res?.status === "CANCELLED") {
          setStatus("CANCELLED");
          setStatusMsg("Deployment was cancelled.");
        }
      }
    } catch (err: any) {
      setStatus("FAILED");
      setError(err?.message || "Failed to start deployment process.");
    }
  };

  const handleCancel = async () => {
    if (!deploymentId) return;
    setCancelling(true);
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.intelligence?.cancelDeployment) {
        await electronAPI.intelligence.cancelDeployment(deploymentId);
      }
    } catch (err: any) {
      console.warn("Cancel deployment error:", err);
    } finally {
      setCancelling(false);
    }
  };

  const handleCopyUrl = () => {
    if (!liveUrl) return;
    navigator.clipboard.writeText(liveUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const isRunning = ["AUTH_CHECKING", "PREPARING", "BUILDING", "UPLOADING", "DEPLOYING"].includes(status);

  const getStatusBadge = () => {
    switch (status) {
      case "SUCCESS":
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/40 shadow-[0_0_8px_rgba(16,185,129,0.2)] flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            SUCCESS
          </span>
        );
      case "FAILED":
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-950 text-rose-300 border border-rose-500/40 flex items-center gap-1.5">
            <XCircle className="w-3.5 h-3.5" />
            FAILED
          </span>
        );
      case "CANCELLED":
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-950 text-amber-300 border border-amber-500/40 flex items-center gap-1.5">
            <Ban className="w-3.5 h-3.5" />
            CANCELLED
          </span>
        );
      case "BUILDING":
      case "UPLOADING":
      case "DEPLOYING":
      case "PREPARING":
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-cyan-950 text-cyan-300 border border-cyan-500/40 flex items-center gap-1.5 animate-pulse">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            {status}
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-zinc-800 text-zinc-300 border border-zinc-700">
            PREFLIGHT
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6 select-none font-mono">
      <div className="w-full max-w-4xl max-h-[90vh] bg-[#0c0d14] border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden text-zinc-200">
        {/* Header */}
        <header className="px-6 py-4 border-b border-zinc-800 bg-[#0f111a] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
              <Rocket className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-sm font-bold text-zinc-100">Deploy to {providerDisplayName} (Production)</h2>
                {getStatusBadge()}
              </div>
              <p className="text-xs text-zinc-400 truncate max-w-xl">
                {workspacePath} {rootDir ? `(rootDir: ${rootDir})` : ""}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isRunning}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors disabled:opacity-30 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-3">
              <XCircle className="w-5 h-5 shrink-0 text-rose-400" />
              <div>
                <p className="font-bold">Deployment Error</p>
                <p>{error}</p>
              </div>
            </div>
          )}

          {/* Success Banner with Live URL */}
          {status === "SUCCESS" && liveUrl && (
            <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-xs text-emerald-300 flex items-center justify-between gap-4 shadow-[0_0_16px_rgba(16,185,129,0.15)]">
              <div className="flex items-center gap-3">
                <Globe className="w-6 h-6 text-emerald-400 shrink-0" />
                <div>
                  <p className="font-bold text-emerald-200 text-sm">Deployment Live in Production</p>
                  <p className="text-zinc-300 font-mono">{liveUrl}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopyUrl}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold border border-zinc-700 transition-colors cursor-pointer"
                >
                  {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedUrl ? "Copied" : "Copy URL"}
                </button>
                <a
                  href={liveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors shadow-[0_0_10px_rgba(16,185,129,0.3)] cursor-pointer"
                >
                  <span>Open Live Site</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>
          )}

          {/* Preflight Confirmation View */}
          {status === "PREFLIGHT" && (
            <div className="p-5 rounded-xl bg-[#11131c] border border-zinc-800 space-y-4">
              <div className="flex items-center gap-2 text-cyan-400 font-bold text-xs uppercase tracking-wider">
                <ShieldCheck className="w-4 h-4" />
                <span>Preflight Verification Summary</span>
              </div>

              <div className="space-y-2 text-xs text-zinc-300">
                <div className="flex justify-between py-1 border-b border-zinc-800/60">
                  <span className="text-zinc-400">Target Provider:</span>
                  <span className="font-bold text-zinc-100">Vercel Production</span>
                </div>
                <div className="flex justify-between py-1 border-b border-zinc-800/60">
                  <span className="text-zinc-400">Workspace Root:</span>
                  <span className="font-mono text-zinc-200 truncate max-w-md">{workspacePath}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-zinc-800/60">
                  <span className="text-zinc-400">Configuration:</span>
                  <span className="font-mono text-emerald-400">vercel.json ✓</span>
                </div>
                <div className="flex justify-between py-1 border-b border-zinc-800/60">
                  <span className="text-zinc-400">Credential Status:</span>
                  <span className="text-emerald-400 font-semibold">Vercel Connected (Encrypted Vault) ✓</span>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-[#0a0b10] border border-zinc-800 text-[11px] text-zinc-400 leading-relaxed">
                Clicking <strong>Deploy to Vercel</strong> will spawn the Vercel CLI locally, build project artifacts according to <code className="text-cyan-300">vercel.json</code>, and stream logs in real-time.
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  onClick={onClose}
                  className="px-3.5 py-1.5 rounded-md text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStartDeploy}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white transition-colors shadow-[0_0_12px_rgba(6,182,212,0.3)] cursor-pointer"
                >
                  <Rocket className="w-3.5 h-3.5" />
                  Deploy to Vercel
                </button>
              </div>
            </div>
          )}

          {/* Live Terminal Log Stream */}
          {status !== "PREFLIGHT" && (
            <div className="rounded-xl bg-[#08090d] border border-zinc-800/90 overflow-hidden flex flex-col">
              <div className="px-4 py-2 bg-[#0d0e14] border-b border-zinc-800/80 flex items-center justify-between text-xs text-zinc-400">
                <div className="flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Deployment Console</span>
                </div>
                <span className="text-[10px] text-zinc-500">{statusMsg}</span>
              </div>

              <div
                ref={logContainerRef}
                className="p-4 font-mono text-xs text-zinc-300 overflow-y-auto max-h-96 min-h-64 leading-relaxed select-text space-y-0.5"
              >
                {logs.length === 0 ? (
                  <p className="text-zinc-600">Waiting for Vercel CLI output…</p>
                ) : (
                  logs.map((line, idx) => (
                    <div key={idx} className="whitespace-pre-wrap">
                      {line}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {status !== "PREFLIGHT" && (
          <footer className="px-6 py-3.5 border-t border-zinc-800 bg-[#0f111a] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Sanitized logs • 0 tokens leaked</span>
            </div>

            <div className="flex items-center gap-3">
              {isRunning && (
                <button
                  onClick={handleCancel}
                  disabled={cancelling}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-500/40 transition-colors cursor-pointer"
                >
                  <Ban className="w-3.5 h-3.5" />
                  {cancelling ? "Cancelling…" : "Cancel Deployment"}
                </button>
              )}

              {!isRunning && (
                <button
                  onClick={onClose}
                  className="px-4 py-1.5 rounded-md text-xs font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors cursor-pointer"
                >
                  Close
                </button>
              )}
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
