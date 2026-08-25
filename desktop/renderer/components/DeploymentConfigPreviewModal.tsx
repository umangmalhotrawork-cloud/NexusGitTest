"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  X,
  FileCode,
  Copy,
  Check,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Save,
  RefreshCw,
  Info,
  ShieldCheck,
  HardDrive,
  GitCommit,
} from "lucide-react";

export interface ConfigDiffLineUI {
  type: "added" | "removed" | "unchanged";
  line: number;
  content: string;
}

export interface ConfigGenerationResultUI {
  providerId: string;
  targetFile: string;
  format: string;
  content: string;
  existingContent: string | null;
  exists: boolean;
  existingContentHash: string | null;
  diff: {
    added: number;
    removed: number;
    unchanged: number;
    lines: ConfigDiffLineUI[];
  };
  warnings: string[];
  validation: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
  generatedFromEvidence: string[];
}

interface DeploymentConfigPreviewModalProps {
  workspacePath: string;
  providerId: string;
  providerDisplayName: string;
  onClose: () => void;
  onSuccess?: (result: { targetFile: string; backupFile: string | null }) => void;
}

export default function DeploymentConfigPreviewModal({
  workspacePath,
  providerId,
  providerDisplayName,
  onClose,
  onSuccess,
}: DeploymentConfigPreviewModalProps) {
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configResult, setConfigResult] = useState<ConfigGenerationResultUI | null>(null);
  const [activeTab, setActiveTab] = useState<"generated" | "diff">("generated");
  const [copied, setCopied] = useState(false);
  const [showConfirmWrite, setShowConfirmWrite] = useState(false);
  const [writeSuccess, setWriteSuccess] = useState<{
    targetFile: string;
    backupFile: string | null;
    bytesWritten: number;
  } | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.intelligence?.generateDeploymentConfig) {
        const res = await electronAPI.intelligence.generateDeploymentConfig({
          workspacePath,
          providerId,
        });
        setConfigResult(res);
        if (res.exists) {
          setActiveTab("diff");
        }
      } else {
        setError("Deployment config generation API is not available.");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to generate deployment configuration.");
    } finally {
      setLoading(false);
    }
  }, [workspacePath, providerId]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleCopy = () => {
    if (!configResult?.content) return;
    navigator.clipboard.writeText(configResult.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApply = async () => {
    if (!configResult) return;
    setApplying(true);
    setError(null);
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.intelligence?.applyDeploymentConfig) {
        const res = await electronAPI.intelligence.applyDeploymentConfig({
          workspacePath,
          providerId,
          options: {
            expectedExistingContentHash: configResult.existingContentHash,
          },
        });
        setWriteSuccess(res);
        setShowConfirmWrite(false);
        onSuccess?.({ targetFile: res.targetFile, backupFile: res.backupFile });
      } else {
        setError("Apply deployment config API is not available.");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to write configuration file.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6 select-none font-mono">
      <div className="w-full max-w-4xl max-h-[90vh] bg-[#0c0d14] border border-zinc-800 rounded-xl shadow-2xl flex flex-col overflow-hidden text-zinc-200">
        {/* Modal Header */}
        <header className="px-6 py-4 border-b border-zinc-800 bg-[#0f111a] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
              <FileCode className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-zinc-100">{providerDisplayName} Configuration Preview</h2>
                {configResult && (
                  <span className={`text-[10px] px-2 py-0.5 rounded font-bold border ${
                    configResult.validation.valid
                      ? "bg-emerald-950/80 text-emerald-300 border-emerald-500/40"
                      : "bg-rose-950/80 text-rose-300 border-rose-500/40"
                  }`}>
                    {configResult.validation.valid ? "VALID SYNTAX" : "SYNTAX ERROR"}
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400">
                Target: <code className="text-cyan-300">{configResult?.targetFile || "config"}</code> • {workspacePath}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && (
            <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-3">
              <XCircle className="w-5 h-5 shrink-0 text-rose-400" />
              <div>
                <p className="font-bold">Error</p>
                <p>{error}</p>
              </div>
            </div>
          )}

          {loading && (
            <div className="p-12 text-center space-y-3">
              <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin mx-auto" />
              <p className="text-xs text-cyan-300 font-semibold">Generating deterministic deployment configuration…</p>
            </div>
          )}

          {writeSuccess && (
            <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/40 text-xs text-emerald-300 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold text-emerald-200">Configuration Successfully Written to Workspace</p>
                <p className="text-zinc-300">
                  File <code className="text-emerald-300 font-semibold">{writeSuccess.targetFile}</code> was written ({writeSuccess.bytesWritten} bytes).
                </p>
                {writeSuccess.backupFile && (
                  <p className="text-[11px] text-zinc-400">
                    Backup created: <code className="text-zinc-300">{writeSuccess.backupFile}</code>
                  </p>
                )}
              </div>
            </div>
          )}

          {configResult && !loading && !writeSuccess && (
            <div className="space-y-4">
              {/* Tab Navigation */}
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveTab("generated")}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                      activeTab === "generated"
                        ? "bg-cyan-950 text-cyan-300 border border-cyan-500/40"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    Generated Config
                  </button>

                  <button
                    onClick={() => setActiveTab("diff")}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
                      activeTab === "diff"
                        ? "bg-cyan-950 text-cyan-300 border border-cyan-500/40"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <GitCommit className="w-3.5 h-3.5" />
                    {configResult.exists ? (
                      <span>Diff ({configResult.diff.added} added, {configResult.diff.removed} removed)</span>
                    ) : (
                      <span>New File Preview</span>
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                  {configResult.exists ? (
                    <span className="text-amber-400">Existing file on disk (backup will be created)</span>
                  ) : (
                    <span className="text-emerald-400">New file will be created in workspace root</span>
                  )}
                </div>
              </div>

              {/* Code / Diff View Container */}
              <div className="rounded-xl bg-[#08090d] border border-zinc-800/90 overflow-hidden">
                {activeTab === "generated" && (
                  <div className="p-4 font-mono text-xs text-zinc-300 overflow-x-auto max-h-80 leading-relaxed">
                    <pre className="select-text">
                      {configResult.content}
                    </pre>
                  </div>
                )}

                {activeTab === "diff" && (
                  <div className="p-4 font-mono text-xs overflow-x-auto max-h-80 leading-relaxed space-y-0.5 select-text">
                    {configResult.diff.lines.map((l, idx) => (
                      <div
                        key={idx}
                        className={`flex items-start gap-3 px-2 py-0.5 rounded text-xs ${
                          l.type === "added"
                            ? "bg-emerald-950/40 text-emerald-300"
                            : l.type === "removed"
                            ? "bg-rose-950/40 text-rose-300"
                            : "text-zinc-400"
                        }`}
                      >
                        <span className="w-7 text-right select-none text-[10px] text-zinc-600 font-mono">
                          {l.line}
                        </span>
                        <span className="w-3 select-none text-center font-bold">
                          {l.type === "added" ? "+" : l.type === "removed" ? "-" : " "}
                        </span>
                        <span className="flex-1 whitespace-pre">{l.content}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Evidence and Defaults Information Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Evidence Grounding */}
                <div className="p-3.5 rounded-lg bg-[#11131c] border border-zinc-800/80 space-y-2">
                  <div className="flex items-center gap-1.5 text-cyan-400 font-bold text-[11px] uppercase tracking-wider">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Evidence Grounding</span>
                  </div>
                  <ul className="space-y-1 text-xs text-zinc-300">
                    {configResult.generatedFromEvidence && configResult.generatedFromEvidence.length > 0 ? (
                      configResult.generatedFromEvidence.map((e, idx) => (
                        <li key={idx} className="flex items-start gap-1.5">
                          <span className="text-cyan-400">•</span>
                          <span>{e}</span>
                        </li>
                      ))
                    ) : (
                      <li className="text-zinc-500">Standard defaults applied.</li>
                    )}
                  </ul>
                </div>

                {/* Warnings / Safety Info */}
                <div className="p-3.5 rounded-lg bg-[#11131c] border border-zinc-800/80 space-y-2">
                  <div className="flex items-center gap-1.5 text-amber-400 font-bold text-[11px] uppercase tracking-wider">
                    <HardDrive className="w-3.5 h-3.5" />
                    <span>Safety & File Integrity</span>
                  </div>
                  <div className="text-xs text-zinc-300 space-y-1">
                    <p>• Zero secrets or tokens inserted.</p>
                    <p>• Written atomically via temp file rename.</p>
                    {configResult.exists && (
                      <p className="text-amber-300">• Existing file will be backed up as <code className="text-zinc-200">.nexus-backup-*</code></p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Confirmation Overlay before Writing */}
          {showConfirmWrite && configResult && (
            <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/40 text-xs text-amber-300 space-y-3">
              <div className="flex items-center gap-2 font-bold text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span>Confirm Write to Workspace</span>
              </div>
              <p className="text-zinc-200 leading-relaxed">
                Are you sure you want to write <code className="text-cyan-300 font-bold">{configResult.targetFile}</code> to <code className="text-zinc-300">{workspacePath}</code>?
                {configResult.exists && " A timestamped backup will be preserved automatically."}
              </p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => setShowConfirmWrite(false)}
                  className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApply}
                  disabled={applying}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-colors cursor-pointer shadow-[0_0_10px_rgba(6,182,212,0.3)]"
                >
                  <Save className="w-3.5 h-3.5" />
                  {applying ? "Writing…" : "Confirm & Write File"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <footer className="px-6 py-3.5 border-t border-zinc-800 bg-[#0f111a] flex items-center justify-between shrink-0">
          <button
            onClick={handleCopy}
            disabled={!configResult}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-zinc-400" />}
            {copied ? "Copied to Clipboard" : "Copy Configuration"}
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-md text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors cursor-pointer"
            >
              {writeSuccess ? "Close" : "Cancel"}
            </button>

            {!writeSuccess && !showConfirmWrite && (
              <button
                onClick={() => setShowConfirmWrite(true)}
                disabled={!configResult || !configResult.validation.valid || loading}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_10px_rgba(6,182,212,0.3)] cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                Write to Workspace
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
