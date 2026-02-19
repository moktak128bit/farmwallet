import React from "react";
import type { StockPreset } from "../../types";

interface PresetSectionProps {
  presets: StockPreset[];
  onApplyPreset: (preset: StockPreset) => void;
  onSaveCurrent: () => void;
  onOpenModal: () => void;
}

export const PresetSection: React.FC<PresetSectionProps> = ({
  presets,
  onApplyPreset,
  onSaveCurrent,
  onOpenModal
}) => {
  return (
    <div className="card" style={{ padding: 12, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--muted)" }}>
          프리셋 {presets.length > 0 ? `(Ctrl+1~9)` : ""}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="secondary"
            onClick={onSaveCurrent}
            style={{ fontSize: 11, padding: "4px 8px" }}
          >
            현재 저장
          </button>
          <button
            type="button"
            className="secondary"
            onClick={onOpenModal}
            style={{ fontSize: 11, padding: "4px 8px" }}
          >
            관리
          </button>
        </div>
      </div>
      {presets.length > 0 ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {presets.map((preset, index) => (
            <button
              key={preset.id}
              type="button"
              className="secondary"
              onClick={() => onApplyPreset(preset)}
              style={{ fontSize: 12, padding: "6px 12px" }}
              title={`Ctrl+${index + 1}: ${preset.name}`}
            >
              {index + 1}. {preset.name}
            </button>
          ))}
        </div>
      ) : (
        <p className="hint" style={{ margin: 0, fontSize: 12 }}>
          프리셋이 없습니다. 자주 매수하는 종목을 입력한 후 "현재 저장" 버튼을 클릭하세요.
        </p>
      )}
    </div>
  );
};
