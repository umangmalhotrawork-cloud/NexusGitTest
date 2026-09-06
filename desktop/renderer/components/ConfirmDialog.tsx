"use client";

import { AlertTriangle } from "lucide-react";
import { useOutsideClick } from "../hooks/useOutsideClick";

interface ConfirmDialogProps {
  isOpen: boolean;
  fileName: string;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  isOpen,
  fileName,
  onSave,
  onDiscard,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useOutsideClick<HTMLDivElement>({
    isOpen,
    onClose: onCancel,
  });

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCancel();
        }
      }}
    >
      <div 
        ref={dialogRef}
        className="w-full max-w-md bg-[#111318] border border-[#22252B] rounded-xl shadow-modal p-6 space-y-4 font-sans"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-[#D9A441]/10 border border-[#D9A441]/30 text-[#D9A441]">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-[#E6E8EB]">Save changes?</h3>
            <p className="text-xs text-[#9AA1AC] mt-0.5">
              Do you want to save the changes to <span className="text-[#E6E8EB] font-mono font-medium">{fileName}</span>?
            </p>
          </div>
        </div>

        <p className="text-xs text-[#6B7280]">
          Your changes will be lost if you don't save them.
        </p>

        <div className="flex items-center justify-end gap-2 font-sans text-xs pt-3 border-t border-[#22252B]">
          <button
            onClick={onCancel}
            className="px-3.5 py-1.5 rounded-md border border-[#22252B] bg-[#14161B] text-[#9AA1AC] hover:text-[#E6E8EB] hover:bg-[#1A1C22] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onDiscard}
            className="px-3.5 py-1.5 rounded-md bg-[#DC5B5B]/10 hover:bg-[#DC5B5B]/20 border border-[#DC5B5B]/30 text-[#DC5B5B] font-medium transition-colors"
          >
            Discard
          </button>
          <button
            onClick={onSave}
            className="px-4 py-1.5 rounded-md bg-[#4CC2DE] hover:bg-[#3db0cc] text-[#0A0B0D] font-medium transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
