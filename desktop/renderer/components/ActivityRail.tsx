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
  Rocket,
} from "lucide-react";

export type ActivityRailItem = "explorer" | "search" | "git" | "tests" | "agent" | "sessions" | "verification" | "decisions" | "simulator" | "deploy" | "terminal";


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
        backgroundColor: "var(--theme-surface, #0E1013)",
        borderColor: "var(--theme-border, #22252B)",
        color: "var(--theme-text, #E6E8EB)",
      }}
      className="w-11 border-r flex flex-col items-center py-2 shrink-0 select-none z-30 justify-between font-sans"
    >
      {/* Top Tool Group */}
      <div className="flex flex-col items-center gap-1 w-full">
        {/* Explorer */}
        <button
          onClick={() => onSelectItem("explorer")}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer relative group ${
            activeItem === "explorer"
              ? "bg-[#14161B] text-[#4CC2DE] border border-[#22252B]"
              : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
          }`}
          title="Explorer (⌘1)"
        >
          <FolderTree className="w-4 h-4" />
          {activeItem === "explorer" && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#4CC2DE] rounded-r" />
          )}
        </button>

        {/* Search */}
        <button
          onClick={() => onSelectItem("search")}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer relative group ${
            activeItem === "search"
              ? "bg-[#14161B] text-[#4CC2DE] border border-[#22252B]"
              : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
          }`}
          title="Search Workspace (⌘2)"
        >
          <Search className="w-4 h-4" />
          {activeItem === "search" && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#4CC2DE] rounded-r" />
          )}
        </button>

        {/* Source Control */}
        <button
          onClick={() => onSelectItem("git")}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer relative group ${
            activeItem === "git"
              ? "bg-[#14161B] text-[#4CC2DE] border border-[#22252B]"
              : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
          }`}
          title="Source Control (⌘3)"
        >
          <GitBranch className="w-4 h-4" />
          {activeItem === "git" && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#4CC2DE] rounded-r" />
          )}
        </button>

        {/* Tests / Test Explorer */}
        <button
          onClick={() => onSelectItem("tests")}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer relative group ${
            activeItem === "tests"
              ? "bg-[#14161B] text-[#4CC2DE] border border-[#22252B]"
              : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
          }`}
          title="Test Explorer (⌘4 / ⌘⇧T)"
        >
          <FlaskConical className="w-4 h-4" />
          {activeItem === "tests" && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#4CC2DE] rounded-r" />
          )}
        </button>

        {/* Agent Panel Toggle */}
        <button
          onClick={onToggleAgentPanel}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer relative group ${
            agentPanelOpen
              ? "bg-[#14161B] text-[#4CC2DE] border border-[#22252B]"
              : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
          }`}
          title="AI Agent Dock (⌘I)"
        >
          <Bot className="w-4 h-4" />
          {agentPanelOpen && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#4CC2DE] rounded-r" />
          )}
        </button>

        {/* Sessions / Snapshots */}
        <button
          onClick={() => onSelectItem("sessions")}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer relative group ${
            activeItem === "sessions"
              ? "bg-[#14161B] text-[#4CC2DE] border border-[#22252B]"
              : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
          }`}
          title="Continuum Sessions (⌘5)"
        >
          <Layers className="w-4 h-4" />
          {activeItem === "sessions" && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#4CC2DE] rounded-r" />
          )}
        </button>

        {/* Verification / Safety */}
        <button
          onClick={() => onSelectItem("verification")}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer relative group ${
            activeItem === "verification"
              ? "bg-[#14161B] text-[#4CC2DE] border border-[#22252B]"
              : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
          }`}
          title="Patch Firewall & Verification (⌘6)"
        >
          <ShieldCheck className="w-4 h-4" />
          {activeItem === "verification" && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#4CC2DE] rounded-r" />
          )}
        </button>

        {/* Decision Replay */}
        <button
          onClick={() => onSelectItem("decisions")}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer relative group ${
            activeItem === "decisions"
               ? "bg-[#14161B] text-[#4CC2DE] border border-[#22252B]"
               : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
          }`}
          title="Decision Replay & Architectural Memory (⌘7)"
        >
          <BookmarkCheck className="w-4 h-4" />
          {activeItem === "decisions" && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#4CC2DE] rounded-r" />
          )}
        </button>

        {/* Future Bug Simulator */}
        <button
          onClick={() => onSelectItem("simulator")}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer relative group ${
            activeItem === "simulator"
               ? "bg-[#14161B] text-[#4CC2DE] border border-[#22252B]"
               : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
          }`}
          title="Future Bug Simulator (⌘8)"
        >
          <ShieldAlert className="w-4 h-4" />
          {activeItem === "simulator" && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#4CC2DE] rounded-r" />
          )}
        </button>

        {/* Deployment Inspector */}
        <button
          onClick={() => onSelectItem("deploy")}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer relative group ${
            activeItem === "deploy"
               ? "bg-[#14161B] text-[#4CC2DE] border border-[#22252B]"
               : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
          }`}
          title="Deployment Inspector (⌘9)"
        >
          <Rocket className="w-4 h-4" />
          {activeItem === "deploy" && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#4CC2DE] rounded-r" />
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
              ? "bg-[#14161B] text-[#4CC2DE] border border-[#22252B]"
              : "text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
          }`}
          title="Terminal & Bottom Panel (⌘` / Ctrl+\)"
        >
          <Terminal className="w-4 h-4" />
          {bottomPanelOpen && (
            <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 bg-[#4CC2DE] rounded-r" />
          )}
        </button>

        {/* AI Settings */}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="w-8 h-8 rounded-md flex items-center justify-center text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#1A1C22] transition-colors cursor-pointer"
            title="AI Model & Credentials Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        )}
      </div>
    </aside>
  );
}
