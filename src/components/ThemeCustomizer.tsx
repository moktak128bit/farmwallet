import React, { useState, useEffect } from "react";

interface ThemeColors {
  primary: string;
  primaryHover: string;
  accent: string;
  danger: string;
  warning: string;
  success: string;
}

interface Props {
  onClose: () => void;
}

const PRESET_THEMES: Record<string, ThemeColors> = {
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
  const [colors, setColors] = useState<ThemeColors>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("fw-custom-theme");
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return PRESET_THEMES.default;
  });

  const [fontSize, setFontSize] = useState<"small" | "medium" | "large">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("fw-font-size") as any) || "medium";
    }
    return "medium";
  });

  useEffect(() => {
    // CSS 변수 업데이트
    const root = document.documentElement;
    root.style.setProperty("--primary", colors.primary);
    root.style.setProperty("--primary-hover", colors.primaryHover);
    root.style.setProperty("--accent", colors.accent);
    root.style.setProperty("--danger", colors.danger);
    root.style.setProperty("--warning", colors.warning);
    root.style.setProperty("--success", colors.success);

    // 폰트 크기 적용
    const fontSizeMap = {
      small: "13px",
      medium: "14px",
      large: "16px"
    };
    root.style.setProperty("--base-font-size", fontSizeMap[fontSize]);

    // 저장
    localStorage.setItem("fw-custom-theme", JSON.stringify(colors));
    localStorage.setItem("fw-font-size", fontSize);
  }, [colors, fontSize]);

  const applyPreset = (presetName: string) => {
    setColors(PRESET_THEMES[presetName]);
  };

  const resetToDefault = () => {
    setColors(PRESET_THEMES.default);
    setFontSize("medium");
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>테마 커스터마이징</h3>
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
                    onChange={(e) => setColors({ ...colors, primary: e.target.value })}
                    style={{ width: 60, height: 40 }}
                  />
                </label>
                <label>
                  <span>강조 색상</span>
                  <input
                    type="color"
                    value={colors.accent}
                    onChange={(e) => setColors({ ...colors, accent: e.target.value })}
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
                    onClick={() => setFontSize(size)}
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





