import React, { useEffect, useState } from "react";
import { STORAGE_KEYS } from "../constants/config";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useModalStackEntry } from "../utils/modalStack";
import {
  type CustomThemeColors,
  type FontSizeOption,
  applyCustomThemeColors,
  applyFontSizeOption,
  clearCustomThemeVars,
  readSavedCustomTheme,
  readSavedFontSize,
} from "../hooks/useTheme";

interface Props {
  onClose: () => void;
}

const PRESET_THEMES: Record<string, CustomThemeColors> = {
  default: {
    primary: "#0d9488",
    primaryHover: "#0f766e",
    accent: "#0284c7",
    danger: "#dc2626",
    warning: "#d97706",
    success: "#059669"
  },
  blue: {
    primary: "#2563eb",
    primaryHover: "#1d4ed8",
    accent: "#3b82f6",
    danger: "#dc2626",
    warning: "#d97706",
    success: "#059669"
  },
  green: {
    primary: "#059669",
    primaryHover: "#047857",
    accent: "#10b981",
    danger: "#dc2626",
    warning: "#d97706",
    success: "#059669"
  },
  purple: {
    primary: "#7c3aed",
    primaryHover: "#6d28d9",
    accent: "#8b5cf6",
    danger: "#dc2626",
    warning: "#d97706",
    success: "#059669"
  }
};

export const ThemeCustomizer: React.FC<Props> = ({ onClose }) => {
  const [colors, setColors] = useState<CustomThemeColors>(
    () => readSavedCustomTheme() ?? PRESET_THEMES.default
  );
  const [fontSize, setFontSize] = useState<FontSizeOption>(
    () => readSavedFontSize() ?? "medium"
  );

  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const isTopModal = useModalStackEntry(true);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 모달 중첩 시 최상위 모달만 ESC로 닫힘
      if (e.key === "Escape" && isTopModal()) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, isTopModal]);

  /**
   * 사용자가 명시적으로 변경했을 때만 적용+저장.
   * (이전에는 모달을 열기만 해도 기본 프리셋이 인라인 변수로 저장돼
   *  다크모드 팔레트를 영구히 덮어쓰는 문제가 있었음)
   */
  const persist = (nextColors: CustomThemeColors, nextFontSize: FontSizeOption) => {
    applyCustomThemeColors(nextColors);
    applyFontSizeOption(nextFontSize);
    localStorage.setItem(STORAGE_KEYS.CUSTOM_THEME, JSON.stringify(nextColors));
    localStorage.setItem(STORAGE_KEYS.FONT_SIZE, nextFontSize);
  };

  const updateColors = (next: CustomThemeColors) => {
    setColors(next);
    persist(next, fontSize);
  };

  const updateFontSize = (next: FontSizeOption) => {
    setFontSize(next);
    persist(colors, next);
  };

  const applyPreset = (presetName: string) => {
    updateColors(PRESET_THEMES[presetName]);
  };

  /** 기본값 복원: 인라인 변수 제거 → 스타일시트(.dark 포함) 기본 팔레트로 복귀 + 저장본 삭제 */
  const resetToDefault = () => {
    setColors(PRESET_THEMES.default);
    setFontSize("medium");
    clearCustomThemeVars();
    localStorage.removeItem(STORAGE_KEYS.CUSTOM_THEME);
    localStorage.removeItem(STORAGE_KEYS.FONT_SIZE);
  };

  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="theme-customizer-title"
    >
      <div ref={trapRef} className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id="theme-customizer-title" style={{ margin: 0 }}>테마 커스터마이징</h3>
          <button type="button" className="secondary" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="modal-body">
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* 프리셋 테마 */}
            <div>
              <h4 style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: 600 }}>프리셋 테마</h4>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {Object.keys(PRESET_THEMES).map((name) => (
                  <button
                    key={name}
                    type="button"
                    className="secondary"
                    onClick={() => applyPreset(name)}
                    style={{ fontSize: 12, padding: "8px 16px", textTransform: "capitalize" }}
                  >
                    {name === "default" ? "기본" : name}
                  </button>
                ))}
              </div>
            </div>

            {/* 커스텀 색상 */}
            <div>
              <h4 style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: 600 }}>커스텀 색상</h4>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "12px", alignItems: "center" }}>
                <label>
                  <span>주요 색상</span>
                  <input
                    type="color"
                    value={colors.primary}
                    onChange={(e) => updateColors({ ...colors, primary: e.target.value })}
                    style={{ width: 60, height: 40 }}
                  />
                </label>
                <label>
                  <span>강조 색상</span>
                  <input
                    type="color"
                    value={colors.accent}
                    onChange={(e) => updateColors({ ...colors, accent: e.target.value })}
                    style={{ width: 60, height: 40 }}
                  />
                </label>
              </div>
            </div>

            {/* 폰트 크기 */}
            <div>
              <h4 style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: 600 }}>폰트 크기</h4>
              <div style={{ display: "flex", gap: 8 }}>
                {(["small", "medium", "large"] as const).map((size) => (
                  <button
                    key={size}
                    type="button"
                    className={fontSize === size ? "primary" : "secondary"}
                    onClick={() => updateFontSize(size)}
                    style={{ fontSize: 12, padding: "8px 16px" }}
                  >
                    {size === "small" ? "작게" : size === "medium" ? "보통" : "크게"}
                  </button>
                ))}
              </div>
            </div>

            {/* 리셋 */}
            <div>
              <button type="button" className="secondary" onClick={resetToDefault}>
                기본값으로 리셋
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
