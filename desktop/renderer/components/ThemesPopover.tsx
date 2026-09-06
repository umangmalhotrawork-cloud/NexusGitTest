"use client";

import React from "react";
import { Palette, Check, X, Sparkles } from "lucide-react";
import { THEMES, ThemeDefinition } from "../theme/themeRegistry";
import { useOutsideClick } from "../hooks/useOutsideClick";

interface ThemesPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
  activeThemeId: string;
  onSelectTheme: (themeId: string) => void;
}

export default function ThemesPopover({
  isOpen,
  onClose,
  triggerRef,
  activeThemeId = "nexus-dark",
  onSelectTheme,
}: ThemesPopoverProps) {
  const popoverRef = useOutsideClick<HTMLDivElement>({
    isOpen,
    onClose,
    triggerRef,
  });

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute top-11 right-12 w-84 border border-[#22252B] rounded-lg shadow-popover z-50 p-3 space-y-2.5 font-sans text-xs select-none bg-[#1A1C22] text-[#E6E8EB]"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between border-b border-[#22252B] pb-2"
      >
        <div className="flex items-center gap-2 font-medium text-xs text-[#E6E8EB]">
          <Palette className="w-4 h-4 text-[#4CC2DE]" />
          <span>Sentinel AI Themes</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] px-1.5 py-0.5 rounded border border-[#22252B] bg-[#14161B] text-[#9AA1AC] font-mono"
          >
            8 Available
          </span>
          <button
            onClick={onClose}
            className="text-[#9AA1AC] hover:text-[#E6E8EB] cursor-pointer p-0.5 rounded transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Theme Cards List */}
      <div className="space-y-1 max-h-[380px] overflow-y-auto pr-0.5">
        {THEMES.map((theme: ThemeDefinition) => {
          const isActive = theme.id === activeThemeId;

          return (
            <button
              key={theme.id}
              onClick={() => {
                onSelectTheme(theme.id);
                onClose();
              }}
              className={`w-full p-2 rounded-md text-left transition-colors flex items-center justify-between group cursor-pointer border ${
                isActive
                  ? "border-[#2E323B] bg-[#111318]"
                  : "border-transparent hover:bg-[#14161B]"
              }`}
            >
              {/* Left: Swatches + Name + Description */}
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                {/* 4-Color Swatch Preview Box */}
                <div
                  className="w-6 h-6 rounded-md p-0.5 grid grid-cols-2 gap-0.5 shrink-0 border border-[#22252B]"
                  style={{ backgroundColor: theme.colors.themeBackground }}
                  title={`${theme.name} Palette Preview`}
                >
                  {theme.colors.swatches.map((color, idx) => (
                    <div
                      key={idx}
                      className="w-full h-full rounded-[1px]"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-xs truncate text-[#E6E8EB]">
                      {theme.name}
                    </span>
                    {theme.id === "nexus-dark" && (
                      <span className="text-[9px] px-1 py-0.2 rounded bg-[#14161B] text-[#4CC2DE] border border-[#22252B] font-mono">
                        DEFAULT
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-[#6B7280] truncate mt-0.5">
                    {theme.description}
                  </div>
                </div>
              </div>

              {/* Right: Active Check Indicator */}
              <div className="shrink-0 ml-2">
                {isActive ? (
                  <div
                    className="w-4 h-4 rounded-full flex items-center justify-center bg-[#4CC2DE] text-[#0A0B0D]"
                  >
                    <Check className="w-3 h-3 stroke-[3]" />
                  </div>
                ) : (
                  <div className="w-4 h-4 rounded-full border border-[#22252B] group-hover:border-[#2E323B] transition-colors" />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div
        className="pt-2 border-t border-[#22252B] flex items-center justify-between text-[11px] text-[#6B7280]"
      >
        <span className="flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-[#4CC2DE]" />
          <span>Global Theme Engine</span>
        </span>
        <span className="text-[10px] text-[#6B7280]">Persistent</span>
      </div>
    </div>
  );
}
