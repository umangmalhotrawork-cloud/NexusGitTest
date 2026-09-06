"use client";

import React, { useState, useEffect } from "react";
import { 
  FolderTree, Search, GitBranch, FlaskConical, Bug, Terminal, Plug,
  X, ChevronRight, Maximize2, Minimize2
} from "lucide-react";

export type ToolTab = "explorer" | "search" | "git" | "tests" | "debugger" | "terminal" | "capabilities";

interface ContextualToolsDrawerProps {
  isOpen: boolean;
  activeTab: ToolTab;
  onTabChange: (tab: ToolTab) => void;
  onClose: () => void;
  // Tool content views passed from parent
  explorerContent: React.ReactNode;
  searchContent: React.ReactNode;
  gitContent: React.ReactNode;
  testsContent: React.ReactNode;
  debuggerContent: React.ReactNode;
  terminalContent: React.ReactNode;
  capabilitiesContent?: React.ReactNode;
}

export default function ContextualToolsDrawer({
  isOpen,
  activeTab,
  onTabChange,
  onClose,
  explorerContent,
  searchContent,
  gitContent,
  testsContent,
  debuggerContent,
  terminalContent,
  capabilitiesContent,
}: ContextualToolsDrawerProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop overlay to prevent visual bleed and capture clicks */}
      <div 
        onClick={onClose} 
        className="fixed inset-0 bg-black/60 z-40 animate-in fade-in duration-150" 
      />

      <div 
        className={`fixed inset-y-0 left-0 ${isExpanded ? "w-[650px]" : "w-[400px]"} max-w-[90vw] z-50 bg-[#111318] border-r border-[#22252B] shadow-modal flex flex-col font-sans select-none animate-slideInLeft transition-all duration-200 overflow-hidden`}
      >
        {/* Header with Navigation Tabs */}
        <div className="h-10 px-3 bg-[#0E1013] border-b border-[#22252B] flex items-center justify-between font-sans text-xs shrink-0">
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            <button
              onClick={() => onTabChange("explorer")}
              className={`px-2 py-1 rounded-md flex items-center gap-1.5 transition-all text-[11px] cursor-pointer ${
                activeTab === "explorer"
                  ? "bg-[#1A1C22] text-[#E6E8EB] font-medium border border-[#22252B]"
                  : "text-[#868C96] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
              }`}
              title="File Explorer (⌘B)"
            >
              <FolderTree className="w-3.5 h-3.5" />
              <span>Files</span>
            </button>

            <button
              onClick={() => onTabChange("search")}
              className={`px-2 py-1 rounded-md flex items-center gap-1.5 transition-all text-[11px] cursor-pointer ${
                activeTab === "search"
                  ? "bg-[#1A1C22] text-[#E6E8EB] font-medium border border-[#22252B]"
                  : "text-[#868C96] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
              }`}
              title="Search & Replace (⌘⇧F)"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Search</span>
            </button>

            <button
              onClick={() => onTabChange("git")}
              className={`px-2 py-1 rounded-md flex items-center gap-1.5 transition-all text-[11px] cursor-pointer ${
                activeTab === "git"
                  ? "bg-[#1A1C22] text-[#E6E8EB] font-medium border border-[#22252B]"
                  : "text-[#868C96] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
              }`}
              title="Source Control (⌘⇧G)"
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>Git</span>
            </button>

            <button
              onClick={() => onTabChange("tests")}
              className={`px-2 py-1 rounded-md flex items-center gap-1.5 transition-all text-[11px] cursor-pointer ${
                activeTab === "tests"
                  ? "bg-[#1A1C22] text-[#E6E8EB] font-medium border border-[#22252B]"
                  : "text-[#868C96] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
              }`}
              title="Test Explorer (⌘⇧T)"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              <span>Tests</span>
            </button>

            <button
              onClick={() => onTabChange("debugger")}
              className={`px-2 py-1 rounded-md flex items-center gap-1.5 transition-all text-[11px] cursor-pointer ${
                activeTab === "debugger"
                  ? "bg-[#1A1C22] text-[#E6E8EB] font-medium border border-[#22252B]"
                  : "text-[#868C96] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
              }`}
              title="Debugger (F10)"
            >
              <Bug className="w-3.5 h-3.5" />
              <span>Debug</span>
            </button>

            <button
              onClick={() => onTabChange("terminal")}
              className={`px-2 py-1 rounded-md flex items-center gap-1.5 transition-all text-[11px] cursor-pointer ${
                activeTab === "terminal"
                  ? "bg-[#1A1C22] text-[#E6E8EB] font-medium border border-[#22252B]"
                  : "text-[#868C96] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
              }`}
              title="Terminal (⌘`)"
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Terminal</span>
            </button>

            <button
              onClick={() => onTabChange("capabilities")}
              className={`px-2 py-1 rounded-md flex items-center gap-1.5 transition-all text-[11px] cursor-pointer ${
                activeTab === "capabilities"
                  ? "bg-[#1A1C22] text-[#E6E8EB] font-medium border border-[#22252B]"
                  : "text-[#868C96] hover:text-[#E6E8EB] hover:bg-[#1A1C22]"
              }`}
              title="Capabilities & MCP (⌘⇧C)"
            >
              <Plug className="w-3.5 h-3.5 text-[#4CC2DE]" />
              <span>MCP & Skills</span>
            </button>
          </div>

          <div className="flex items-center gap-1 text-[#868C96]">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 hover:text-[#E6E8EB] rounded cursor-pointer transition-colors"
              title={isExpanded ? "Collapse width" : "Expand width"}
            >
              {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={onClose}
              className="p-1 hover:text-[#E6E8EB] rounded cursor-pointer transition-colors"
              title="Close Drawer (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body View Container */}
        <div className="flex-1 w-full h-full overflow-hidden bg-[#0B0C0E] relative">
          {activeTab === "explorer" && <div className="w-full h-full overflow-y-auto">{explorerContent}</div>}
          {activeTab === "search" && <div className="w-full h-full overflow-y-auto">{searchContent}</div>}
          {activeTab === "git" && <div className="w-full h-full overflow-y-auto">{gitContent}</div>}
          {activeTab === "tests" && <div className="w-full h-full overflow-y-auto">{testsContent}</div>}
          {activeTab === "debugger" && <div className="w-full h-full overflow-y-auto">{debuggerContent}</div>}
          {activeTab === "terminal" && <div className="w-full h-full overflow-y-auto p-2">{terminalContent}</div>}
          {activeTab === "capabilities" && <div className="w-full h-full overflow-hidden">{capabilitiesContent}</div>}
        </div>
      </div>
    </>
  );
}
