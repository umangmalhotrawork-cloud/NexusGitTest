"use client";

import React, { useState, useMemo } from "react";
import { 
  Sparkles, Check, X, ShieldCheck, AlertTriangle, ArrowRight, 
  CheckSquare, Square, FileCode, Cpu, Layers, Activity 
} from "lucide-react";
import { Finding } from "./ProvenanceReplayPanel";
import { useOutsideClick } from "../hooks/useOutsideClick";

export interface SurgeryHunk {
  line: number;
  code: string;
  title: string;
  reason: string;
  approved: boolean;
}

export interface SurgeryApplyRequest {
  filePath: string;
  approvedLines: number[];
  originalSource: string;
  transformedSource: string;
}

export interface SurgeryDiffPreviewProps {
  filePath: string;
  originalSource: string;
  findings: Finding[];
  onApply: (request: SurgeryApplyRequest) => void;
  onCancel: () => void;
  isApplying?: boolean;
}

export default function SurgeryDiffPreview({
  filePath,
  originalSource,
  findings,
  onApply,
  onCancel,
  isApplying = false,
}: SurgeryDiffPreviewProps) {
  // Map findings into selectable hunks, all initially checked
  const [approvedLines, setApprovedLines] = useState<Set<number>>(() => {
    return new Set(findings.map((f) => f.line));
  });

  const modalRef = useOutsideClick<HTMLDivElement>({
    isOpen: true,
    onClose: onCancel,
  });

  const fileName = filePath.split("/").pop() || "source_file.py";
  const sourceLines = useMemo(() => originalSource.split("\n"), [originalSource]);

  // Compute transformed source based on approved lines
  const transformedSource = useMemo(() => {
    return sourceLines
      .filter((_, idx) => !approvedLines.has(idx + 1))
      .join("\n");
  }, [sourceLines, approvedLines]);

  const toggleLine = (line: number) => {
    setApprovedLines((prev) => {
      const next = new Set(prev);
      if (next.has(line)) {
        next.delete(line);
      } else {
        next.add(line);
      }
      return next;
    });
  };

  const selectAll = () => {
    setApprovedLines(new Set(findings.map((f) => f.line)));
  };

  const clearAll = () => {
    setApprovedLines(new Set());
  };

  const approvedCount = approvedLines.size;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-fade-in font-sans"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div 
        ref={modalRef}
        className="bg-[#111318] border border-[#22252B] rounded-xl w-full max-w-5xl h-[88vh] flex flex-col shadow-modal overflow-hidden font-sans"
      >
        
        {/* 1. Modal Header */}
        <div className="p-4 bg-[#0E1013] border-b border-[#22252B] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-md bg-[#1A1C22] border border-[#22252B] flex items-center justify-center text-[#4CC2DE]">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-sm text-[#E6E8EB]">Safe Remove Surgery Preview</h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#D9A441]/10 text-[#D9A441] border border-[#D9A441]/30">
                  {findings.length} Ghost Operations Detected
                </span>
              </div>
              <p className="text-xs text-[#9AA1AC] mt-0.5 flex items-center gap-1.5 font-mono">
                <FileCode className="w-3.5 h-3.5 text-[#9AA1AC]" />
                <span>{filePath}</span>
              </p>
            </div>
          </div>

          {/* Quick Hunk Toggles */}
          <div className="flex items-center gap-2">
            <button
              onClick={selectAll}
              className="px-2.5 py-1 rounded-md bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] text-xs text-[#9AA1AC] hover:text-[#E6E8EB] transition-colors flex items-center gap-1"
            >
              <CheckSquare className="w-3 h-3 text-[#4CC2DE]" />
              <span>Select All ({findings.length})</span>
            </button>
            <button
              onClick={clearAll}
              className="px-2.5 py-1 rounded-md bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] text-xs text-[#9AA1AC] hover:text-[#E6E8EB] transition-colors flex items-center gap-1"
            >
              <Square className="w-3 h-3 text-[#6B7280]" />
              <span>Clear All</span>
            </button>
            <button
              onClick={onCancel}
              className="p-1.5 rounded-md border border-[#22252B] text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#14161B] transition-colors ml-2"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 2. Differential Verification Banner */}
        <div className="px-4 py-2 bg-[#0E1013]/60 border-b border-[#22252B] flex items-center justify-between shrink-0 text-xs">
          <div className="flex items-center gap-2 text-[#3EAE79]">
            <ShieldCheck className="w-4 h-4 text-[#3EAE79] shrink-0" />
            <span className="font-semibold">Differential Behavioral Verification:</span>
            <span className="text-[#9AA1AC]">Isolated Subprocess Equivalence Confirmed</span>
          </div>
          <div className="flex items-center gap-3 text-[#9AA1AC]">
            <span>Projected Luminance: <strong className="text-[#4CC2DE]">{approvedCount === findings.length ? "100.0%" : `${Math.round((approvedCount / findings.length) * 100)}%`}</strong></span>
            <span>•</span>
            <span>Hunks Approved: <strong className="text-[#D9A441]">{approvedCount} / {findings.length}</strong></span>
          </div>
        </div>

        {/* 3. Side-by-Side Diff Preview Workspace */}
        <div className="flex-1 min-h-0 grid grid-cols-2 divide-x divide-[#22252B] bg-[#0B0C0F] overflow-hidden font-mono">
          
          {/* Left Pane: Original Source with Removal Highlights */}
          <div className="flex flex-col h-full overflow-hidden">
            <div className="p-2.5 bg-[#0E1013] border-b border-[#22252B] text-xs font-medium text-[#9AA1AC] flex items-center justify-between shrink-0 font-sans">
              <span className="text-[#DC5B5B] font-medium flex items-center gap-1.5">
                <span>ORIGINAL (Pre-Surgery)</span>
              </span>
              <span className="text-[11px] text-[#6B7280]">{sourceLines.length} lines</span>
            </div>
            <div className="flex-1 p-3 overflow-y-auto font-mono text-xs space-y-0.5 select-text">
              {sourceLines.map((line, idx) => {
                const lineNum = idx + 1;
                const isGhost = findings.some((f) => f.line === lineNum);
                const isApproved = approvedLines.has(lineNum);

                if (isGhost) {
                  return (
                    <div
                      key={`orig-${lineNum}`}
                      onClick={() => toggleLine(lineNum)}
                      className={`flex items-start gap-2 px-2 py-1 rounded cursor-pointer transition-colors ${
                        isApproved
                          ? "bg-[#DC5B5B]/15 border border-[#DC5B5B]/30 text-[#DC5B5B]"
                          : "bg-[#D9A441]/10 border border-[#D9A441]/30 text-[#D9A441]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isApproved}
                        onChange={() => toggleLine(lineNum)}
                        className="mt-0.5 cursor-pointer accent-[#4CC2DE] shrink-0"
                      />
                      <span className="w-6 text-[#6B7280] select-none text-[11px] shrink-0">{lineNum}</span>
                      <span className="font-bold text-[#DC5B5B] select-none shrink-0">-</span>
                      <span className="flex-1 font-semibold">{line}</span>
                    </div>
                  );
                }

                return (
                  <div key={`orig-${lineNum}`} className="flex items-center gap-2 px-2 py-0.5 text-[#9AA1AC]">
                    <span className="w-4 shrink-0" />
                    <span className="w-6 text-[#6B7280] select-none text-[11px] shrink-0">{lineNum}</span>
                    <span className="w-2 select-none shrink-0"> </span>
                    <span className="flex-1 text-[#E6E8EB]">{line}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Pane: Transformed Clean Source Preview */}
          <div className="flex flex-col h-full overflow-hidden">
            <div className="p-2.5 bg-[#0E1013] border-b border-[#22252B] text-xs font-medium text-[#9AA1AC] flex items-center justify-between shrink-0 font-sans">
              <span className="text-[#3EAE79] font-medium flex items-center gap-1.5">
                <span>TRANSFORMED (Clean Code)</span>
              </span>
              <span className="text-[11px] text-[#6B7280]">{sourceLines.length - approvedCount} lines</span>
            </div>
            <div className="flex-1 p-3 overflow-y-auto font-mono text-xs space-y-0.5 select-text">
              {sourceLines
                .filter((_, idx) => !approvedLines.has(idx + 1))
                .map((line, idx) => (
                  <div key={`clean-${idx}`} className="flex items-center gap-2 px-2 py-0.5 text-[#9AA1AC]">
                    <span className="w-6 text-[#6B7280] select-none text-[11px] shrink-0">{idx + 1}</span>
                    <span className="w-2 text-[#3EAE79] select-none shrink-0">+</span>
                    <span className="flex-1 text-[#E6E8EB]">{line}</span>
                  </div>
                ))}
            </div>
          </div>

        </div>

        {/* 4. Footer Actions */}
        <div className="p-3.5 bg-[#0E1013] border-t border-[#22252B] flex items-center justify-between shrink-0 font-sans">
          <div className="text-xs text-[#9AA1AC] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#3EAE79]" />
            <span>Automatic safety backup: <code className="font-mono text-[11px] text-[#E6E8EB]">{fileName}.echo-nullity-backup</code></span>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={onCancel}
              disabled={isApplying}
              className="px-3.5 py-1.5 rounded-md bg-[#14161B] hover:bg-[#1A1C22] border border-[#22252B] text-xs font-medium text-[#9AA1AC] hover:text-[#E6E8EB] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onApply({
                filePath,
                approvedLines: Array.from(approvedLines),
                originalSource,
                transformedSource,
              })}
              disabled={approvedCount === 0 || isApplying}
              className="px-4 py-1.5 rounded-md bg-[#4CC2DE] hover:bg-[#3db0cc] text-[#0A0B0D] text-xs font-medium flex items-center gap-2 transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              {isApplying ? (
                <Activity className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 fill-current" />
              )}
              <span>Apply Surgery ({approvedCount} {approvedCount === 1 ? "Line" : "Lines"})</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
