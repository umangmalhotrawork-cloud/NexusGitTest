"use client";

import React from "react";
import { FolderOpen, Sparkles, Clock, ArrowRight, X, Layers, FileCode } from "lucide-react";
import { useOutsideClick } from "../hooks/useOutsideClick";

interface StartupModalProps {
  isOpen: boolean;
  onClose: () => void;
  recentWorkspaces: string[];
  onOpenRecent: (path: string) => void;
  onOpenFolder: () => void;
  onOpenDemo: () => void;
}

export default function StartupModal({
  isOpen,
  onClose,
  recentWorkspaces,
  onOpenRecent,
  onOpenFolder,
  onOpenDemo,
}: StartupModalProps) {
  const modalRef = useOutsideClick<HTMLDivElement>({
    isOpen,
    onClose,
  });

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 font-sans select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div 
        ref={modalRef}
        className="w-full max-w-lg bg-[#111318] border border-[#22252B] rounded-xl shadow-modal p-6 space-y-5 relative"
      >
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-[#9AA1AC] hover:text-[#E6E8EB] p-1 rounded-md hover:bg-[#1A1C22] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#4CC2DE]" />
            <h2 className="font-sans text-base font-semibold text-[#E6E8EB] tracking-tight">
              Sentinel AI Workbench
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-[#14161B] border border-[#22252B] text-[#9AA1AC] text-[10px] font-mono">
              v0.2.0
            </span>
          </div>
          <p className="text-xs text-[#9AA1AC]">
            Autonomous Causal Code Tomography &amp; Ghost-Line Elimination
          </p>
        </div>

        {/* Primary Action Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => {
              onOpenFolder();
              onClose();
            }}
            className="p-3.5 rounded-lg bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] hover:border-[#2E323B] text-left space-y-2 group transition-colors cursor-pointer"
          >
            <FolderOpen className="w-5 h-5 text-[#9AA1AC] group-hover:text-[#4CC2DE] transition-colors" />
            <div>
              <div className="font-medium text-xs text-[#E6E8EB]">Open Project Folder</div>
              <div className="text-[11px] text-[#6B7280]">Analyze local repository</div>
            </div>
          </button>

          <button
            onClick={() => {
              onOpenDemo();
              onClose();
            }}
            className="p-3.5 rounded-lg bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] hover:border-[#2E323B] text-left space-y-2 group transition-colors cursor-pointer"
          >
            <Sparkles className="w-5 h-5 text-[#9AA1AC] group-hover:text-[#4CC2DE] transition-colors" />
            <div>
              <div className="font-medium text-xs text-[#E6E8EB]">Demo Workspace</div>
              <div className="text-[11px] text-[#6B7280]">ai_cart_project sample</div>
            </div>
          </button>
        </div>

        {/* Recent Workspaces List */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] text-[#6B7280] font-semibold uppercase tracking-wider">
            <Clock className="w-3.5 h-3.5 text-[#6B7280]" />
            <span>Recent Workspaces</span>
          </div>

          <div className="space-y-1.5 max-h-36 overflow-y-auto">
            {Array.isArray(recentWorkspaces) && recentWorkspaces.length > 0 ? (
              recentWorkspaces.map((folder, i) => (
                <button
                  key={i}
                  onClick={() => {
                    onOpenRecent(folder);
                    onClose();
                  }}
                  className="w-full text-left py-2 px-3 rounded-md bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] hover:border-[#2E323B] text-xs text-[#E6E8EB] flex items-center justify-between group transition-colors cursor-pointer"
                >
                  <span className="truncate max-w-[340px] text-[#9AA1AC] group-hover:text-[#E6E8EB]">{folder}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-[#6B7280] group-hover:text-[#4CC2DE] transition-colors" />
                </button>
              ))
            ) : (
              <div className="p-3 bg-[#14161B] rounded-md border border-[#22252B] text-center text-[#6B7280] text-xs">
                No recent workspaces saved.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-[#22252B] flex justify-end">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] text-[#9AA1AC] hover:text-[#E6E8EB] text-xs transition-colors cursor-pointer"
          >
            Continue to Editor
          </button>
        </div>

      </div>
    </div>
  );
}
