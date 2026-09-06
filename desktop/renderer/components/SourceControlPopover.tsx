"use client";

import React from "react";
import SourceControlPanel, { SourceControlPanelProps } from "./SourceControlPanel";
import { useOutsideClick } from "../hooks/useOutsideClick";

export interface SourceControlPopoverProps extends SourceControlPanelProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

export default function SourceControlPopover({
  isOpen,
  onClose,
  triggerRef,
  ...sourceControlProps
}: SourceControlPopoverProps) {
  const popoverRef = useOutsideClick<HTMLDivElement>({
    isOpen,
    onClose,
    triggerRef,
  });

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute top-10.5 right-0 w-[360px] max-w-[calc(100vw-24px)] max-h-[500px] border border-[#22252B] rounded-lg shadow-popover z-50 flex flex-col font-sans text-xs overflow-hidden bg-[#111318] text-[#E6E8EB]"
    >
      <SourceControlPanel
        {...sourceControlProps}
        isPopover={true}
        onClosePopover={onClose}
      />
    </div>
  );
}
