"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  FolderTree, Search, GitBranch, Layers, ShieldCheck, Settings, 
  Plus, MessageSquare, Plug, ChevronDown, ChevronRight,
  Folder, Pin, PinOff, MoreVertical, Edit2, Trash2, X, Check, Clock, Bot, Sparkles, BookmarkCheck, ShieldAlert,
  Rocket
} from "lucide-react";
import { useOutsideClick } from "../hooks/useOutsideClick";

export interface SidebarThread {
  threadId: string;
  id?: string;
  title: string;
  timestamp?: number;
  createdAt?: number;
  updatedAt?: number;
  pinned?: boolean;
  status?: string;
  workspacePath?: string;
  workspaceName?: string;
  providerId?: string;
  modelId?: string;
  sequenceNumber?: number;
}

interface CodexSidebarProps {
  currentProjectName: string;
  workspacePath?: string;
  activeThreadId?: string | null;
  threads?: SidebarThread[];
  recentSessions?: any[];
  onNewTask: () => void;
  onSelectSession?: (sessionId: string, userGoal?: string) => void;
  onSelectThread?: (threadId: string, title?: string) => void;
  onPinThread?: (threadId: string, pinned: boolean) => void;
  onRenameThread?: (threadId: string, newTitle: string) => void;
  onDeleteThread?: (threadId: string) => void;
  onOpenFolder: () => void;
  activeItem: string | null;
  onSelectItem: (item: any) => void;
}

function formatTimeAgo(timestamp?: number): string {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function CodexSidebar({
  currentProjectName = "NEXUS",
  workspacePath = "",
  activeThreadId,
  threads = [],
  recentSessions = [],
  onNewTask,
  onSelectSession,
  onSelectThread,
  onPinThread,
  onRenameThread,
  onDeleteThread,
  onOpenFolder,
  activeItem,
  onSelectItem,
}: CodexSidebarProps) {
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [activeMenuThreadId, setActiveMenuThreadId] = useState<string | null>(null);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editTitleInput, setEditTitleInput] = useState("");

  const menuRef = useRef<HTMLDivElement | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);

  // Close context menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenuThreadId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Auto-focus edit input when renaming
  useEffect(() => {
    if (editingThreadId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingThreadId]);

  const toggleProject = (name: string) => {
    setCollapsedProjects((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const handleSelect = (threadId: string, title?: string) => {
    if (editingThreadId) return;
    if (onSelectThread) {
      onSelectThread(threadId, title);
    } else if (onSelectSession) {
      onSelectSession(threadId, title);
    }
  };

  const handleStartRename = (thread: SidebarThread, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveMenuThreadId(null);
    setEditingThreadId(thread.threadId);
    setEditTitleInput(thread.title || "Untitled Task");
  };

  const handleSaveRename = (threadId: string) => {
    if (editTitleInput.trim() && onRenameThread) {
      onRenameThread(threadId, editTitleInput.trim());
    }
    setEditingThreadId(null);
  };

  const handleCancelRename = () => {
    setEditingThreadId(null);
  };

  const handleTogglePin = (thread: SidebarThread, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveMenuThreadId(null);
    if (onPinThread) {
      onPinThread(thread.threadId, !thread.pinned);
    }
  };

  const handleDelete = (thread: SidebarThread, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveMenuThreadId(null);
    if (onDeleteThread) {
      onDeleteThread(thread.threadId);
    }
  };

  // Harmonize unified thread list from threads prop and recentSessions fallback
  const allThreads: SidebarThread[] = React.useMemo(() => {
    const list: SidebarThread[] = [];
    const seenIds = new Set<string>();

    if (Array.isArray(threads) && threads.length > 0) {
      for (const t of threads) {
        const id = t.threadId || t.id;
        if (id && !seenIds.has(id)) {
          seenIds.add(id);
          list.push({
            ...t,
            threadId: id,
            timestamp: t.updatedAt || t.createdAt || t.timestamp,
          });
        }
      }
    }

    if (Array.isArray(recentSessions) && recentSessions.length > 0) {
      for (const s of recentSessions) {
        const id = s.threadId || s.id || s.snapshotId || s.sessionId;
        if (id && !seenIds.has(id)) {
          seenIds.add(id);
          list.push({
            threadId: id,
            title: s.title || s.user_intent_summary || s.userGoal || s.goal || "AI Agent Session",
            timestamp: s.updatedAt || s.timestamp || (s.created_at ? new Date(s.created_at).getTime() : undefined),
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            pinned: Boolean(s.pinned),
            status: s.status || "ACTIVE",
            workspaceName: s.workspaceName || currentProjectName,
            workspacePath: s.workspacePath || workspacePath,
            providerId: s.providerId,
            modelId: s.modelId,
            sequenceNumber: s.sequence_number || s.sequenceNumber,
          });
        }
      }
    }

    // Sort newest first
    list.sort((a, b) => ((b.updatedAt || b.timestamp || 0) - (a.updatedAt || a.timestamp || 0)));
    return list;
  }, [threads, recentSessions, currentProjectName, workspacePath]);

  // Filter threads by search query
  const filteredThreads = React.useMemo(() => {
    if (!searchQuery.trim()) return allThreads;
    const q = searchQuery.toLowerCase().trim();
    return allThreads.filter((t) => {
      const title = (t.title || "").toLowerCase();
      const ws = (t.workspaceName || "").toLowerCase();
      return title.includes(q) || ws.includes(q);
    });
  }, [allThreads, searchQuery]);

  // Separate pinned and non-pinned threads
  const pinnedThreads = filteredThreads.filter((t) => t.pinned);
  const recentThreads = filteredThreads.filter((t) => !t.pinned);

  // Group threads by project
  const projectGroups = React.useMemo(() => {
    const map = new Map<string, SidebarThread[]>();
    for (const t of filteredThreads) {
      const projectName = t.workspaceName || currentProjectName || "NEXUS";
      if (!map.has(projectName)) {
        map.set(projectName, []);
      }
      map.get(projectName)!.push(t);
    }
    return Array.from(map.entries()).map(([name, groupThreads]) => ({
      name,
      isCurrent: name === (currentProjectName || "NEXUS"),
      threads: groupThreads,
    }));
  }, [filteredThreads, currentProjectName]);

  return (
    <aside 
      style={{
        backgroundColor: "var(--theme-surface, #0E1013)",
        borderColor: "var(--theme-border, #22252B)",
        color: "var(--theme-text, #E6E8EB)",
      }}
      className="w-64 border-r flex flex-col h-full shrink-0 select-none font-sans text-xs"
    >
      {/* Top Branding & New Chat & Search */}
      <div 
        style={{
          backgroundColor: "var(--theme-surface-panel, #0E1013)",
          borderColor: "var(--theme-border, #22252B)",
        }}
        className="p-2.5 border-b space-y-2"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: "var(--theme-accent, #4CC2DE)" }} />
            <span className="font-semibold text-sm tracking-tight text-[#E6E8EB]">NEXUS</span>
          </div>
          <span 
            className="text-[9.5px] px-1.5 py-0.5 rounded font-mono border border-[#22252B] bg-[#14161B] text-[#9AA1AC]"
          >
            IDE v1.0
          </span>
        </div>

        {/* New Task / Chat Button */}
        <button
          onClick={onNewTask}
          className="w-full h-7 px-2.5 rounded-md bg-[#4CC2DE] hover:bg-[#6ED4EA] active:bg-[#2FA3C0] text-[#0A0B0D] font-medium text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-[#0A0B0D]" />
          <span>New Task / Chat</span>
        </button>

        {/* Search Chats Input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[#9AA1AC] absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search chats & tasks..."
            className="w-full h-7 pl-7 pr-7 py-1 rounded-md border border-[#22252B] bg-[#14161B] text-[#E6E8EB] text-[11px] placeholder-[#6B7280] focus:outline-none focus:border-[#4CC2DE] font-sans transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#9AA1AC] hover:text-[#E6E8EB]"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Main Scrollable Sidebar Area */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-3">
        {/* Navigation Section */}
        <div className="space-y-0.5">
          <div className="px-2 text-[10px] font-semibold uppercase tracking-wider mb-1 text-[#6B7280]">
            Navigation
          </div>

          <button
            onClick={() => onSelectItem("explorer")}
            className={`w-full h-7 text-left px-2 rounded flex items-center gap-2 transition-colors cursor-pointer text-xs ${
              activeItem === "explorer"
                ? "bg-[#1A1C22] text-[#E6E8EB] font-medium border-l-2 border-l-[#4CC2DE] border-y-transparent border-r-transparent"
                : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#14161B] border-l-2 border-transparent"
            }`}
          >
            <FolderTree className={`w-3.5 h-3.5 shrink-0 ${activeItem === "explorer" ? "text-[#4CC2DE]" : "text-[#9AA1AC]"}`} />
            <span className="truncate">Files & Workspace</span>
          </button>

          <button
            onClick={() => onSelectItem("sessions")}
            className={`w-full h-7 text-left px-2 rounded flex items-center gap-2 transition-colors cursor-pointer text-xs ${
              activeItem === "sessions"
                ? "bg-[#1A1C22] text-[#E6E8EB] font-medium border-l-2 border-l-[#4CC2DE] border-y-transparent border-r-transparent"
                : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#14161B] border-l-2 border-transparent"
            }`}
          >
            <Layers className={`w-3.5 h-3.5 shrink-0 ${activeItem === "sessions" ? "text-[#4CC2DE]" : "text-[#9AA1AC]"}`} />
            <span className="truncate">Continuum Lineage</span>
          </button>

          <button
            onClick={() => onSelectItem("verification")}
            className={`w-full h-7 text-left px-2 rounded flex items-center gap-2 transition-colors cursor-pointer text-xs ${
              activeItem === "verification"
                ? "bg-[#1A1C22] text-[#E6E8EB] font-medium border-l-2 border-l-[#4CC2DE] border-y-transparent border-r-transparent"
                : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#14161B] border-l-2 border-transparent"
            }`}
          >
            <ShieldCheck className={`w-3.5 h-3.5 shrink-0 ${activeItem === "verification" ? "text-[#4CC2DE]" : "text-[#9AA1AC]"}`} />
            <span className="truncate">Patch Safety Firewall</span>
          </button>

          <button
            onClick={() => onSelectItem("capabilities")}
            className={`w-full h-7 text-left px-2 rounded flex items-center gap-2 transition-colors cursor-pointer text-xs ${
              activeItem === "capabilities"
                ? "bg-[#1A1C22] text-[#E6E8EB] font-medium border-l-2 border-l-[#4CC2DE] border-y-transparent border-r-transparent"
                : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#14161B] border-l-2 border-transparent"
            }`}
          >
            <Plug className={`w-3.5 h-3.5 shrink-0 ${activeItem === "capabilities" ? "text-[#4CC2DE]" : "text-[#9AA1AC]"}`} />
            <span className="truncate">MCP & Skills Center</span>
          </button>

          <button
            onClick={() => onSelectItem("decisions")}
            className={`w-full h-7 text-left px-2 rounded flex items-center justify-between transition-colors cursor-pointer text-xs ${
              activeItem === "decisions"
                ? "bg-[#1A1C22] text-[#E6E8EB] font-medium border-l-2 border-l-[#4CC2DE] border-y-transparent border-r-transparent"
                : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#14161B] border-l-2 border-transparent"
            }`}
          >
            <div className="flex items-center gap-2 min-w-0 truncate">
              <BookmarkCheck className={`w-3.5 h-3.5 shrink-0 ${activeItem === "decisions" ? "text-[#4CC2DE]" : "text-[#9AA1AC]"}`} />
              <span className="truncate">Decision Replay</span>
            </div>
            <span className="text-[9px] px-1 py-0.5 rounded bg-[#14161B] text-[#6B7280] font-mono border border-[#22252B]">⌘7</span>
          </button>

          <button
            onClick={() => onSelectItem("simulator")}
            className={`w-full h-7 text-left px-2 rounded flex items-center justify-between transition-colors cursor-pointer text-xs ${
              activeItem === "simulator"
                ? "bg-[#1A1C22] text-[#E6E8EB] font-medium border-l-2 border-l-[#4CC2DE] border-y-transparent border-r-transparent"
                : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#14161B] border-l-2 border-transparent"
            }`}
          >
            <div className="flex items-center gap-2 min-w-0 truncate">
              <ShieldAlert className={`w-3.5 h-3.5 shrink-0 ${activeItem === "simulator" ? "text-[#4CC2DE]" : "text-[#9AA1AC]"}`} />
              <span className="truncate">Future Bug Simulator</span>
            </div>
            <span className="text-[9px] px-1 py-0.5 rounded bg-[#14161B] text-[#6B7280] font-mono border border-[#22252B]">⌘8</span>
          </button>

          <button
            onClick={() => onSelectItem("deploy")}
            className={`w-full h-7 text-left px-2 rounded flex items-center justify-between transition-colors cursor-pointer text-xs ${
              activeItem === "deploy"
                ? "bg-[#1A1C22] text-[#E6E8EB] font-medium border-l-2 border-l-[#4CC2DE] border-y-transparent border-r-transparent"
                : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#14161B] border-l-2 border-transparent"
            }`}
          >
            <div className="flex items-center gap-2 min-w-0 truncate">
              <Rocket className={`w-3.5 h-3.5 shrink-0 ${activeItem === "deploy" ? "text-[#4CC2DE]" : "text-[#9AA1AC]"}`} />
              <span className="truncate">Deployment Inspector</span>
            </div>
            <span className="text-[9px] px-1 py-0.5 rounded bg-[#14161B] text-[#6B7280] font-mono border border-[#22252B]">⌘9</span>
          </button>
        </div>

        {/* PINNED CHATS SECTION */}
        {pinnedThreads.length > 0 && (
          <div className="space-y-1">
            <div className="px-2 flex items-center gap-1.5 text-[9.5px] font-bold text-amber-400/90 uppercase tracking-wider">
              <Pin className="w-3 h-3 text-amber-400 rotate-45 shrink-0" />
              <span>Pinned Chats</span>
              <span className="ml-auto text-[9px] font-mono px-1 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">{pinnedThreads.length}</span>
            </div>

            <div className="space-y-0.5">
              {pinnedThreads.map((thread) => renderThreadItem(thread, true))}
            </div>
          </div>
        )}

        {/* PROJECTS SECTION */}
        <div className="space-y-2">
          <div className="px-2 flex items-center justify-between text-[10px] font-semibold text-[#6B7280] uppercase tracking-wider">
            <span>Projects & Workspaces</span>
            <button onClick={onOpenFolder} className="text-[#4CC2DE] hover:text-[#6ED4EA] cursor-pointer">Open</button>
          </div>

          <div className="space-y-1">
            {projectGroups.map((proj) => {
              const isCollapsed = collapsedProjects[proj.name];
              return (
                <div key={proj.name} className="space-y-1">
                  <button
                    onClick={() => toggleProject(proj.name)}
                    className="w-full text-left px-2 py-1 rounded-md hover:bg-[#1A1C22] flex items-center justify-between text-[#9AA1AC] hover:text-[#E6E8EB] font-medium text-xs cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      {isCollapsed ? (
                        <ChevronRight className="w-3.5 h-3.5 text-[#6B7280] shrink-0" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5 text-[#6B7280] shrink-0" />
                      )}
                      <Folder className="w-3.5 h-3.5 text-[#9AA1AC] shrink-0" />
                      <span className="truncate">{proj.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[9px] px-1 py-0.5 rounded bg-[#14161B] text-[#6B7280] border border-[#22252B] font-mono">{proj.threads.length}</span>
                      {proj.isCurrent && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-[#14161B] text-[#4CC2DE] border border-[#22252B] font-mono">Active</span>
                      )}
                    </div>
                  </button>

                  {!isCollapsed && (
                    <div className="pl-3 space-y-0.5 border-l border-[#22252B] ml-2.5">
                      {proj.threads.length === 0 ? (
                        <div className="text-[11px] text-[#6B7280] italic px-2 py-1">No active threads</div>
                      ) : (
                        proj.threads.map((t) => renderThreadItem(t))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* RECENTS SECTION */}
        {recentThreads.length > 0 && (
          <div className="space-y-1">
            <div className="px-2 flex items-center gap-1.5 text-[10px] font-semibold text-[#6B7280] uppercase tracking-wider">
              <Clock className="w-3 h-3 text-[#6B7280] shrink-0" />
              <span>Recent Chats</span>
              <span className="ml-auto text-[9px] font-mono text-[#6B7280]">{recentThreads.length}</span>
            </div>

            <div className="space-y-0.5">
              {recentThreads.map((thread) => renderThreadItem(thread))}
            </div>
          </div>
        )}

        {filteredThreads.length === 0 && (
          <div className="px-3 py-6 text-center text-[#6B7280] text-xs">
            {searchQuery ? "No matching chats found." : "No conversation history yet."}
          </div>
        )}
      </div>

      {/* Footer Profile / Local Status */}
      <div className="p-2.5 border-t border-[#22252B] bg-[#0E1013] flex items-center justify-between text-[11px] text-[#9AA1AC]">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#3EAE79]" />
          <span className="font-medium text-[#9AA1AC]">Local Sandbox</span>
        </div>
        <button
          onClick={() => onSelectItem("settings")}
          className="text-[#9AA1AC] hover:text-[#E6E8EB] cursor-pointer transition-colors"
          title="Settings"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
      </div>
    </aside>
  );

  function renderThreadItem(thread: SidebarThread, isPinnedSection = false) {
    const isActive = activeThreadId === thread.threadId;
    const isEditing = editingThreadId === thread.threadId;
    const isMenuOpen = activeMenuThreadId === thread.threadId;

    if (isEditing) {
      return (
        <div
          key={thread.threadId}
          className="px-2 py-1 rounded-md bg-[#14161B] border border-[#4CC2DE] flex items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            ref={editInputRef}
            type="text"
            value={editTitleInput}
            onChange={(e) => setEditTitleInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveRename(thread.threadId);
              if (e.key === "Escape") handleCancelRename();
            }}
            className="flex-1 bg-transparent text-[11px] text-[#E6E8EB] focus:outline-none font-sans"
          />
          <button
            onClick={() => handleSaveRename(thread.threadId)}
            className="text-[#3EAE79] hover:text-[#52c991] p-0.5 cursor-pointer"
            title="Save title"
          >
            <Check className="w-3 h-3" />
          </button>
          <button
            onClick={handleCancelRename}
            className="text-[#6B7280] hover:text-[#9AA1AC] p-0.5 cursor-pointer"
            title="Cancel"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      );
    }

    return (
      <div
        key={thread.threadId}
        className={`group relative w-full h-7 text-left px-2 rounded text-[11px] transition-colors flex items-center justify-between cursor-pointer border-y-transparent border-r-transparent border-l-2 ${
          isActive
            ? "bg-[#1A1C22] text-[#E6E8EB] font-medium border-l-[#4CC2DE]"
            : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#14161B] border-l-transparent"
        }`}
        onClick={() => handleSelect(thread.threadId, thread.title)}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1 pr-1">
          {thread.pinned ? (
            <Pin className="w-3 h-3 text-[#D9A441] rotate-45 shrink-0" />
          ) : (
            <MessageSquare className={`w-3 h-3 shrink-0 ${isActive ? "text-[#4CC2DE]" : "text-[#6B7280] group-hover:text-[#9AA1AC]"}`} />
          )}
          <span className="truncate flex-1">{thread.title || "Untitled Task"}</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[9px] text-[#6B7280] group-hover:hidden font-mono">
            {formatTimeAgo(thread.timestamp)}
          </span>

          {/* Contextual Action Button ("...") */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setActiveMenuThreadId(isMenuOpen ? null : thread.threadId);
            }}
            className={`p-1 rounded hover:bg-[#22252B] text-[#9AA1AC] hover:text-[#E6E8EB] transition-colors ${
              isMenuOpen ? "opacity-100 text-[#4CC2DE]" : "opacity-0 group-hover:opacity-100"
            }`}
            title="Chat actions"
          >
            <MoreVertical className="w-3 h-3" />
          </button>
        </div>

        {/* Dropdown Menu */}
        {isMenuOpen && (
          <div
            ref={menuRef}
            onClick={(e) => e.stopPropagation()}
            className="absolute right-1 top-8 w-36 border border-[#22252B] rounded-lg shadow-popover z-50 p-1 space-y-0.5 text-xs font-sans bg-[#1A1C22]"
          >
            <button
              onClick={(e) => handleTogglePin(thread, e)}
              className="w-full text-left px-2 py-1.5 rounded-md flex items-center gap-2 hover:bg-[#22252B] text-[#9AA1AC] hover:text-[#E6E8EB] cursor-pointer text-xs transition-colors"
            >
              {thread.pinned ? (
                <>
                  <PinOff className="w-3.5 h-3.5 text-[#D9A441]" />
                  <span>Unpin chat</span>
                </>
              ) : (
                <>
                  <Pin className="w-3.5 h-3.5 text-[#D9A441] rotate-45" />
                  <span>Pin chat</span>
                </>
              )}
            </button>

            <button
              onClick={(e) => handleStartRename(thread, e)}
              className="w-full text-left px-2 py-1.5 rounded-md flex items-center gap-2 hover:bg-[#22252B] text-[#9AA1AC] hover:text-[#E6E8EB] cursor-pointer text-xs transition-colors"
            >
              <Edit2 className="w-3.5 h-3.5 text-[#4CC2DE]" />
              <span>Rename</span>
            </button>

            <div className="h-px bg-[#22252B] my-0.5" />

            <button
              onClick={(e) => handleDelete(thread, e)}
              className="w-full text-left px-2 py-1.5 rounded-md flex items-center gap-2 hover:bg-[#DC5B5B]/10 text-[#DC5B5B] cursor-pointer text-xs transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5 text-[#DC5B5B]" />
              <span>Delete</span>
            </button>
          </div>
        )}
      </div>
    );
  }
}
