"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Camera,
  History,
  Clock,
  RotateCcw,
  Search,
  Plus,
  Trash2,
  GitCompare,
  CheckCircle2,
  Layers,
  Sparkles,
  Play,
  Loader2,
} from "lucide-react";
import { useSnapshots, WorkspaceSnapshot, SnapshotDiffItem } from "../hooks/useSnapshots";

export type ContinuumSessionSummary = {
  snapshotId: string;
  sessionId: string;
  parentSessionId: string | null;
  sequenceNumber: number;
  createdAt: number;
  updatedAt: number;
  workspaceName: string;
  userGoal: string;
  activeTargetNodeId: string | null;
};

interface SnapshotPanelProps {
  snapshotHook: ReturnType<typeof useSnapshots>;
  onOpenFile: (filePath: string, line?: number) => void;
  openTabs: Array<{ path: string; name: string }>;
  activeTabPath: string;
  workspacePath?: string;
  activeSessionId?: string | null;
  onResumeSession?: (sessionId: string) => void;
  onCreateSession?: (goal?: string) => void;
}

export default function SnapshotPanel({
  snapshotHook,
  onOpenFile,
  openTabs,
  activeTabPath,
  workspacePath,
  activeSessionId,
  onResumeSession,
  onCreateSession,
}: SnapshotPanelProps) {
  const {
    snapshots,
    loading: snapshotsLoading,
    selectedSnapshot,
    setSelectedSnapshot,
    comparison,
    createSnapshot,
    compareSnapshot,
    deleteSnapshot,
  } = snapshotHook;

  const [activeTab, setActiveTab] = useState<"sessions" | "checkpoints">("sessions");
  const [continuumSessions, setContinuumSessions] = useState<ContinuumSessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSnapName, setNewSnapName] = useState("");
  const [newSnapDesc, setNewSnapDesc] = useState("");

  const fetchContinuumSessions = useCallback(async () => {
    if (typeof window !== "undefined" && (window as any).electronAPI?.continuum?.list) {
      setSessionsLoading(true);
      try {
        const list = await (window as any).electronAPI.continuum.list(workspacePath || "");
        if (Array.isArray(list)) {
          setContinuumSessions(list);
        }
      } catch (e) {
        console.error("[SNAPSHOT-PANEL] Failed to fetch Continuum sessions:", e);
      } finally {
        setSessionsLoading(false);
      }
    }
  }, [workspacePath]);

  useEffect(() => {
    fetchContinuumSessions();
  }, [fetchContinuumSessions]);

  const formatRelativeTime = (timestamp: number) => {
    if (!timestamp) return "unknown";
    const diff = Math.floor((Date.now() - timestamp) / 1000);
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  const handleResume = async (sessionId: string) => {
    setResumingId(sessionId);
    try {
      if (onResumeSession) {
        await onResumeSession(sessionId);
      }
      await fetchContinuumSessions();
    } finally {
      setResumingId(null);
    }
  };

  const handleCreateNewSession = () => {
    const goal = newSnapName.trim() || "New Continuum Session";
    if (onCreateSession) {
      onCreateSession(goal);
    } else if (typeof window !== "undefined" && (window as any).electronAPI?.continuum?.createCurrent) {
      (window as any).electronAPI.continuum.createCurrent({ userGoal: goal, activeFilePath: activeTabPath }, workspacePath || "").then(() => {
        fetchContinuumSessions();
      });
    }
    setNewSnapName("");
    setShowCreateModal(false);
  };

  const handleCreateCheckpoint = async () => {
    if (!newSnapName.trim()) return;
    await createSnapshot(
      newSnapName.trim(),
      newSnapDesc.trim(),
      openTabs,
      activeTabPath,
      []
    );
    setNewSnapName("");
    setNewSnapDesc("");
    setShowCreateModal(false);
  };

  const filteredSessions = continuumSessions.filter(
    (s) =>
      s.sessionId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.userGoal && s.userGoal.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const filteredSnapshots = snapshots.filter(
    (s) =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.description && s.description.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="h-full flex flex-col font-sans text-xs select-none bg-[#0B0C0E] border-r border-[#22252B] overflow-hidden">
      {/* Surface Header & Navigation Tabs */}
      <div className="px-3 py-2 bg-[#0E1013] border-b border-[#22252B] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 bg-[#14161B] p-0.5 rounded-md border border-[#22252B]">
          <button
            onClick={() => setActiveTab("sessions")}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "sessions"
                ? "bg-[#1A1C22] text-[#E6E8EB] border border-[#22252B]"
                : "text-[#868C96] hover:text-[#E6E8EB]"
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-[#4CC2DE]" />
            <span>Sessions ({continuumSessions.length})</span>
          </button>

          <button
            onClick={() => setActiveTab("checkpoints")}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "checkpoints"
                ? "bg-[#1A1C22] text-[#E6E8EB] border border-[#22252B]"
                : "text-[#868C96] hover:text-[#E6E8EB]"
            }`}
          >
            <Camera className="w-3.5 h-3.5 text-[#4CC2DE]" />
            <span>Checkpoints ({snapshots.length})</span>
          </button>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="px-2.5 py-1 rounded-md bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] text-[#CCCCCC] hover:text-[#E6E8EB] font-medium text-[11px] flex items-center gap-1 transition-colors cursor-pointer"
          title={activeTab === "sessions" ? "Start New Continuum Session" : "Create Checkpoint"}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New</span>
        </button>
      </div>

      {/* Search Bar */}
      <div className="p-2.5 bg-[#0E1013] border-b border-[#22252B] shrink-0">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-[#868C96] absolute left-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={activeTab === "sessions" ? "Search Continuum sessions..." : "Search checkpoints..."}
            className="w-full bg-[#14161B] border border-[#22252B] focus:border-[#4CC2DE] rounded-md px-2.5 py-1 pl-8 text-[#CCCCCC] placeholder:text-[#6B7280] outline-none text-xs font-sans"
          />
        </div>
      </div>

      {/* Surface Body */}
      {activeTab === "sessions" ? (
        <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
          {filteredSessions.map((session) => {
            const isActive = activeSessionId === session.sessionId;

            return (
              <div
                key={session.sessionId}
                className={`p-3 rounded-lg border transition-all space-y-2 ${
                  isActive
                    ? "bg-[#14161B] border-[#4CC2DE]"
                    : "bg-[#111318] border-[#22252B] hover:border-[#333842]"
                }`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 truncate">
                    <Layers className="w-3.5 h-3.5 text-[#4CC2DE] shrink-0" />
                    <span className="font-medium text-[#E6E8EB] text-xs truncate">
                      {session.userGoal || session.sessionId}
                    </span>
                  </div>

                  {isActive ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#14161B] text-[#4CC2DE] border border-[#4CC2DE]/40 flex items-center gap-1 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#4CC2DE]" />
                      ACTIVE
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#1A1C22] text-[#868C96] border border-[#22252B] shrink-0">
                      Seq #{session.sequenceNumber}
                    </span>
                  )}
                </div>

                <div className="text-[11px] text-[#868C96] space-y-0.5 font-mono">
                  <div className="truncate">
                    ID: <span className="text-[#CCCCCC] select-all">{session.sessionId}</span>
                  </div>
                  {session.parentSessionId && (
                    <div className="truncate text-[#6B7280]">
                      Parent: <span className="text-[#868C96]">{session.parentSessionId}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-[#22252B]">
                  <div className="flex items-center gap-1 text-[10px] text-[#868C96]">
                    <Clock className="w-3 h-3 text-[#6B7280]" />
                    <span>{formatRelativeTime(session.updatedAt || session.createdAt)}</span>
                  </div>

                  <button
                    onClick={() => handleResume(session.sessionId)}
                    disabled={resumingId === session.sessionId}
                    className="px-2.5 py-1 rounded-md bg-[#4CC2DE] hover:bg-[#3db0cc] text-[#0A0B0D] text-[11px] font-medium flex items-center gap-1 cursor-pointer disabled:opacity-40 transition-colors"
                  >
                    {resumingId === session.sessionId ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin text-[#0A0B0D]" />
                        <span>Resuming...</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3 h-3 text-[#0A0B0D] fill-current" />
                        <span>Resume</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}

          {filteredSessions.length === 0 && !sessionsLoading && (
            <div className="py-12 text-center text-[#868C96] space-y-2 px-3">
              <Layers className="w-8 h-8 text-[#6B7280] mx-auto" />
              <p className="text-sm font-semibold text-[#E6E8EB]">No Continuum sessions yet</p>
              <p className="text-xs text-[#868C96]">Start an agent task or click + New to create a session.</p>
              <button
                onClick={() => handleCreateNewSession()}
                className="mt-2 px-3 py-1.5 rounded-md bg-[#4CC2DE] hover:bg-[#3db0cc] text-[#0A0B0D] text-xs font-medium inline-flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Session</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Checkpoints / Workspace Diffs View */
        <div className="flex-1 flex overflow-hidden">
          <div className="w-full overflow-y-auto p-2.5 space-y-2">
            {filteredSnapshots.map((snap) => {
              const isSelected = selectedSnapshot?.id === snap.id;

              return (
                <div
                  key={snap.id}
                  onClick={() => {
                    setSelectedSnapshot(snap);
                    compareSnapshot(snap.id);
                  }}
                  className={`p-3 rounded-lg border transition-all cursor-pointer space-y-1.5 ${
                    isSelected
                      ? "bg-[#14161B] border-[#4CC2DE]"
                      : "bg-[#111318] border-[#22252B] hover:border-[#333842]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex items-center gap-1.5 truncate">
                      <Camera className="w-3.5 h-3.5 text-[#4CC2DE] shrink-0" />
                      <span className="font-medium text-[#E6E8EB] text-xs truncate">
                        {snap.name}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-[#868C96] pt-0.5">
                    <div className="flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      <span>{formatRelativeTime(snap.timestamp)}</span>
                    </div>
                    <span>{snap.totalFiles} files</span>
                  </div>
                </div>
              );
            })}

            {filteredSnapshots.length === 0 && !snapshotsLoading && (
              <div className="py-12 text-center text-[#868C96] space-y-2">
                <History className="w-8 h-8 text-[#6B7280] mx-auto" />
                <p className="text-sm font-semibold text-[#E6E8EB]">No workspace checkpoints found</p>
                <p className="text-xs text-[#868C96]">Click New to save the current workspace state.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal for Creating Session or Checkpoint */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
          <div className="w-96 bg-[#111318] border border-[#22252B] rounded-xl p-4 space-y-3 font-sans text-xs shadow-modal text-[#E6E8EB]">
            <div className="flex items-center justify-between border-b border-[#22252B] pb-2">
              <span className="font-semibold text-[#E6E8EB] flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-[#4CC2DE]" />
                <span>{activeTab === "sessions" ? "New Continuum Session" : "New Checkpoint"}</span>
              </span>
              <button onClick={() => setShowCreateModal(false)} className="text-[#868C96] hover:text-[#E6E8EB] cursor-pointer">
                ✕
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-[#868C96] uppercase font-medium">
                {activeTab === "sessions" ? "Session Task / Goal" : "Checkpoint Name"}
              </label>
              <input
                type="text"
                value={newSnapName}
                onChange={(e) => setNewSnapName(e.target.value)}
                placeholder={activeTab === "sessions" ? "e.g. Refactor checkout API..." : "e.g. Before refactoring cart..."}
                className="w-full bg-[#14161B] border border-[#22252B] focus:border-[#4CC2DE] rounded-md p-2 text-[#E6E8EB] outline-none text-xs font-sans"
                autoFocus
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-3 py-1.5 rounded-md bg-[#1A1C22] hover:bg-[#22252B] border border-[#22252B] text-[#CCCCCC] text-xs font-medium cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={activeTab === "sessions" ? handleCreateNewSession : handleCreateCheckpoint}
                disabled={!newSnapName.trim()}
                className="px-3 py-1.5 rounded-md bg-[#4CC2DE] hover:bg-[#3db0cc] text-[#0A0B0D] font-medium text-xs disabled:opacity-40 cursor-pointer transition-colors"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
