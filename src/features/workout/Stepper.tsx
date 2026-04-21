import React from "react";
import { toast } from "react-hot-toast";

interface Props {
  value: number;
  step: number;
  min?: number;
  max?: number;
  unit: string;
  onChange: (v: number) => void;
}

/** 모바일 친화 ± 스테퍼. 현재값 탭 시 수동 입력(prompt) 가능. */
export const Stepper: React.FC<Props> = ({ value, step, min = 0, max = 9999, unit, onChange }) => {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const dec = () => onChange(clamp(Number((value - step).toFixed(2))));
  const inc = () => onChange(clamp(Number((value + step).toFixed(2))));
  const edit = () => {
    const raw = window.prompt(`${unit} 값 직접 입력`, String(value));
    if (raw == null) return;
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n < min || n > max) {
      toast.error(`${min}~${max} 범위의 숫자로 입력하세요`);
      return;
    }
    onChange(n);
  };
  const btnBase: React.CSSProperties = {
    width: 40, height: 40, borderRadius: 8, fontSize: 22, fontWeight: 900,
    border: "1px solid var(--border)", background: "var(--surface)",
    color: "var(--text)", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    userSelect: "none", flexShrink: 0,
  };
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <button type="button" onClick={dec} aria-label={`${unit} 감소`} style={btnBase}>−</button>
      <button
        type="button"
        onClick={edit}
        aria-label={`${unit} 값 수정`}
        style={{
          minWidth: 76, height: 40, padding: "0 10px", borderRadius: 8,
          border: "1px solid var(--border)", background: "var(--surface)",
          fontSize: 15, fontWeight: 700, cursor: "pointer",
        }}
      >
        {value} <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 2 }}>{unit}</span>
      </button>
      <button type="button" onClick={inc} aria-label={`${unit} 증가`} style={btnBase}>+</button>
    </div>
  );
};
