"use client";

import React from "react";
import {
  FolderTree,
  Search,
  GitBranch,
  FlaskConical,
  Bot,
  Layers,
  ShieldCheck,
  BookmarkCheck,
  ShieldAlert,
  Terminal,
  Settings,
} from "lucide-react";

export type ActivityRailItem = "explorer" | "search" | "git" | "tests" | "agent" | "sessions" | "verification" | "decisions" | "simulator" | "terminal";


interface ActivityRailProps {
  activeItem: ActivityRailItem | null;
  onSelectItem: (item: ActivityRailItem) => void;
  agentPanelOpen: boolean;
  onToggleAgentPanel: () => void;
  bottomPanelOpen: boolean;
  onToggleBottomPanel: () => void;
  onOpenSettings?: () => void;
}

export default function ActivityRail({
  activeItem,
  onSelectItem,
  agentPanelOpen,
  onToggleAgentPanel,
  bottomPanelOpen,
  onToggleBottomPanel,
  onOpenSettings,
}: ActivityRailProps) {
  return (
    <aside 
      style={{
        backgroundColor: "var(--theme-surface, #08080c)",
        borderColor: "var(--theme-border, #161620)",
        color: "var(--theme-text, #f4f4f5)",
      }}
      className="w-11 border-r flex flex-col items-center py-2 shrink-0 select-none z-30 justify-between font-mono"
    >
      {/* Top Tool Group */}
      <div className="flex flex-col items-center gap-1 w-full">
        {/* Explorer */}
        <button
          onClick={() => onSelectItem("explorer")}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer relative group ${
            activeItem === "explorer"
              ? "bg-[#121624] text-cyan-400 border border-cyan-500/30"
              : "text-zinc-500 hover:text-zinc-200 hover:bg-[#101016]"
          }`}
          title="Explorer (⌘1)"
        >
          <FolderTree className="w-4 h-4" />
          {activeItem === "explorer" && (
            <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-cyan-400 rounded-r" />
          )}
        </button>

        {/* Search */}
        <button
          onClick={() => onSelectItem("search")}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer relative group ${
            activeItem === "search"
              ? "bg-[#121624] text-cyan-400 border border-cyan-500/30"
              : "text-zinc-500 hover:text-zinc-200 hover:bg-[#101016]"
          }`}
          title="Search Workspace (⌘2)"
        >
          <Search className="w-4 h-4" />
          {activeItem === "search" && (
            <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-cyan-400 rounded-r" />
          )}
        </button>

        {/* Source Control */}
        <button
          onClick={() => onSelectItem("git")}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer relative group ${
            activeItem === "git"
              ? "bg-[#121624] text-cyan-400 border border-cyan-500/30"
              : "text-zinc-500 hover:text-zinc-200 hover:bg-[#101016]"
          }`}
          title="Source Control (⌘3)"
        >
          <GitBranch className="w-4 h-4" />
          {activeItem === "git" && (
            <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-cyan-400 rounded-r" />
          )}
        </button>

        {/* Tests / Test Explorer */}
        <button
          onClick={() => onSelectItem("tests")}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer relative group ${
            activeItem === "tests"
              ? "bg-[#121624] text-emerald-400 border border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.2)]"
              : "text-zinc-500 hover:text-emerald-300 hover:bg-[#101016]"
          }`}
          title="Test Explorer (⌘4 / ⌘⇧T)"
        >
          <FlaskConical className="w-4 h-4" />
          {activeItem === "tests" && (
            <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-emerald-400 rounded-r" />
          )}
        </button>


        {/* Agent Panel Toggle */}
        <button
          onClick={onToggleAgentPanel}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-all cursor-pointer relative group ${
            agentPanelOpen
              ? "bg-cyan-950/80 text-cyan-300 border border-cyan-500/40 shadow-[0_0_8px_rgba(6,182,212,0.2)]"
              : "text-zinc-500 hover:text-cyan-300 hover:bg-[#101016]"
          }`}
          title="AI Agent Dock (⌘I)"
        >
          <Bot className="w-4 h-4" />
          {agentPanelOpen && (
            <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-cyan-400 rounded-r" />
          )}
        </button>

        {/* Sessions / Snapshots */}
        <button
          onClick={() => onSelectItem("sessions")}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer relative group ${
            activeItem === "sessions"
              ? "bg-[#121624] text-cyan-400 border border-cyan-500/30"
              : "text-zinc-500 hover:text-zinc-200 hover:bg-[#101016]"
          }`}
          title="Continuum Sessions (⌘5)"
        >
          <Layers className="w-4 h-4" />
          {activeItem === "sessions" && (
            <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-cyan-400 rounded-r" />
          )}
        </button>

        {/* Verification / Safety */}
        <button
          onClick={() => onSelectItem("verification")}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer relative group ${
            activeItem === "verification"
              ? "bg-[#121624] text-emerald-400 border border-emerald-500/30"
              : "text-zinc-500 hover:text-emerald-300 hover:bg-[#101016]"
          }`}
          title="Patch Firewall & Verification (⌘6)"
        >
          <ShieldCheck className="w-4 h-4" />
          {activeItem === "verification" && (
            <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-emerald-400 rounded-r" />
          )}
        </button>

        {/* Decision Replay (Phase 5) */}
        <button
          onClick={() => onSelectItem("decisions")}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer relative group ${
            activeItem === "decisions"
               ? "bg-[#121624] text-cyan-400 border border-cyan-500/30 shadow-[0_0_8px_rgba(6,182,212,0.2)]"
               : "text-zinc-500 hover:text-cyan-300 hover:bg-[#101016]"
          }`}
          title="Decision Replay & Architectural Memory (⌘7)"
        >
          <BookmarkCheck className="w-4 h-4" />
          {activeItem === "decisions" && (
            <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-cyan-400 rounded-r" />
          )}
        </button>

        {/* Future Bug Simulator (Phase 6) */}
        <button
          onClick={() => onSelectItem("simulator")}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer relative group ${
            activeItem === "simulator"
               ? "bg-[#241a12] text-amber-400 border border-amber-500/30 shadow-[0_0_8px_rgba(245,158,11,0.2)]"
               : "text-zinc-500 hover:text-amber-300 hover:bg-[#101016]"
          }`}
          title="Future Bug Simulator (⌘8)"
        >
          <ShieldAlert className="w-4 h-4" />
          {activeItem === "simulator" && (
            <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-amber-400 rounded-r" />
          )}
        </button>
      </div>

      {/* Bottom Tool Group */}
      <div className="flex flex-col items-center gap-1 w-full">
        {/* Terminal Toggle */}
        <button
          onClick={onToggleBottomPanel}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer relative group ${
            bottomPanelOpen
              ? "bg-[#121624] text-cyan-400 border border-cyan-500/30"
              : "text-zinc-500 hover:text-zinc-200 hover:bg-[#101016]"
          }`}
          title="Terminal & Bottom Panel (⌘` / Ctrl+\)"
        >
          <Terminal className="w-4 h-4" />
          {bottomPanelOpen && (
            <span className="absolute left-0 top-1 bottom-1 w-0.5 bg-cyan-400 rounded-r" />
          )}
        </button>

        {/* AI Settings */}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="w-8 h-8 rounded-md flex items-center justify-center text-zinc-500 hover:text-cyan-300 hover:bg-[#101016] transition-colors cursor-pointer"
            title="AI Model & Credentials Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        )}
      </div>
    </aside>
  );
}
