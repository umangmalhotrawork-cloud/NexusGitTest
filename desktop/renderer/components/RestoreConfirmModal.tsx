"use client";

import React from "react";
import { RotateCcw, X, AlertTriangle, FileText, CheckCircle2 } from "lucide-react";
import { HistoryEntry } from "../IDEApp";
import { useOutsideClick } from "../hooks/useOutsideClick";

interface RestoreConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  entry: HistoryEntry | null;
  onConfirmRestore: (id: string) => void;
  isRestoring?: boolean;
}

export default function RestoreConfirmModal({
  isOpen,
  onClose,
  entry,
  onConfirmRestore,
  isRestoring = false,
}: RestoreConfirmModalProps) {
  const modalRef = useOutsideClick<HTMLDivElement>({
    isOpen: isOpen && !!entry,
    onClose,
  });

  if (!isOpen || !entry) return null;

  const fileName = entry.file_path ? entry.file_path.split("/").pop() : "unknown.py";
  const beforeLines = (entry.before_source || "").split("\n");
  const afterLines = (entry.after_source || "").split("\n");

  return (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div 
        ref={modalRef}
        className="bg-[#111318] border border-[#22252B] rounded-xl p-5 max-w-2xl w-full space-y-4 shadow-modal font-sans text-xs"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#22252B] pb-3">
          <div className="flex items-center gap-2 text-[#D9A441] font-semibold text-sm">
            <RotateCcw className="w-4 h-4 text-[#D9A441]" />
            <span className="text-[#E6E8EB]">Confirm Time-Travel Checkpoint Restore</span>
          </div>
          <button onClick={onClose} className="text-[#9AA1AC] hover:text-[#E6E8EB] p-1 rounded-md hover:bg-[#14161B] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Warning / Summary Info */}
        <div className="bg-[#D9A441]/10 border border-[#D9A441]/30 rounded-lg p-3 text-[#D9A441] text-xs font-sans space-y-1">
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="w-4 h-4 text-[#D9A441] shrink-0" />
            <span>Restoring Pre-Surgery State for {fileName}</span>
          </div>
          <p className="text-[#9AA1AC] text-[11px] leading-relaxed">
            This operation will revert <span className="font-mono text-[#E6E8EB] font-medium">{fileName}</span> back to its state prior to checkpoint <span className="font-mono text-[#4CC2DE]">{entry.id}</span>. AST analysis, luminance metrics, clones, and graph will automatically re-index upon completion.
          </p>
        </div>

        {/* File Details Grid */}
        <div className="grid grid-cols-2 gap-3 text-[11px] bg-[#0E1013] p-3 rounded-lg border border-[#22252B]">
          <div>
            <span className="text-[#6B7280] block">File Path:</span>
            <span className="text-[#E6E8EB] font-medium truncate block font-mono" title={entry.file_path}>{entry.file_path}</span>
          </div>
          <div>
            <span className="text-[#6B7280] block">Checkpoint ID:</span>
            <span className="text-[#4CC2DE] font-mono">{entry.id}</span>
          </div>
          <div>
            <span className="text-[#6B7280] block">Original Timestamp:</span>
            <span className="text-[#9AA1AC]">{new Date(entry.timestamp).toLocaleString()}</span>
          </div>
          <div>
            <span className="text-[#6B7280] block">Target Operation:</span>
            <span className="text-[#D9A441] font-mono font-medium">{entry.operation_type}</span>
          </div>
        </div>

        {/* Code Diff Preview Box */}
        <div className="space-y-1.5">
          <span className="text-[#9AA1AC] font-medium text-[11px] flex items-center justify-between">
            <span>Restored Source Snapshot Preview</span>
            <span className="text-[#6B7280] text-[10px]">{beforeLines.length} Lines</span>
          </span>
          <div className="bg-[#0B0C0F] border border-[#22252B] rounded-lg p-3 max-h-48 overflow-y-auto font-mono text-[11px] leading-relaxed text-[#E6E8EB] space-y-0.5">
            {beforeLines.slice(0, 15).map((line, idx) => (
              <div key={idx} className="flex items-center gap-3">
                <span className="w-6 text-right text-[#6B7280] select-none text-[10px]">{idx + 1}</span>
                <span className="whitespace-pre">{line}</span>
              </div>
            ))}
            {beforeLines.length > 15 && (
              <div className="text-[#6B7280] italic text-[10px] pt-1 text-center">... and {beforeLines.length - 15} more lines</div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#22252B]">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-md border border-[#22252B] bg-[#14161B] text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#1A1C22] transition-colors font-sans text-xs font-medium"
            disabled={isRestoring}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirmRestore(entry.id)}
            disabled={isRestoring}
            className="px-4 py-1.5 rounded-md bg-[#D9A441] hover:bg-[#c99534] text-[#0A0B0D] font-medium transition-colors flex items-center gap-2 font-sans text-xs"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#0A0B0D]" />
            <span>{isRestoring ? "Restoring Checkpoint..." : "Confirm Restore Checkpoint"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
