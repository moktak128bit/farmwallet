import React, { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";

interface Props {
  value: number;
  step: number;
  min?: number;
  max?: number;
  unit: string;
  onChange: (v: number) => void;
  /**
   * 큰 점프 step (예: kg=10, 회=5). 미지정 시 step의 4배.
   * 점프 버튼이 없으면 false 전달.
   */
  bigStep?: number | false;
}

/**
 * 모바일 친화 ± 스테퍼.
 * - 값 탭 시 인라인 숫자 입력 활성화 (prompt 대신, 모바일 키패드 OK)
 * - 큰 점프 버튼(±bigStep) 옵션
 */
export const Stepper: React.FC<Props> = ({ value, step, min = 0, max = 9999, unit, onChange, bigStep }) => {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const dec = () => onChange(clamp(Number((value - step).toFixed(2))));
  const inc = () => onChange(clamp(Number((value + step).toFixed(2))));
  const big = bigStep === false ? null : (bigStep ?? step * 4);
  const decBig = big ? () => onChange(clamp(Number((value - big).toFixed(2)))) : null;
  const incBig = big ? () => onChange(clamp(Number((value + big).toFixed(2)))) : null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(String(value));
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing, value]);

  const commit = () => {
    const n = parseFloat(draft);
    if (!Number.isFinite(n) || n < min || n > max) {
      toast.error(`${min}~${max} 범위의 숫자로 입력하세요`);
      setEditing(false);
      setDraft(String(value));
      return;
    }
    onChange(n);
    setEditing(false);
  };

  const btnBase: React.CSSProperties = {
    width: 36, height: 40, borderRadius: 8, fontSize: 20, fontWeight: 900,
    border: "1px solid var(--border)", background: "var(--surface)",
    color: "var(--text)", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    userSelect: "none", flexShrink: 0,
  };
  const bigBtn: React.CSSProperties = {
    ...btnBase,
    width: 32, fontSize: 11, fontWeight: 700,
    color: "var(--text-muted)",
  };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      {decBig && (
        <button type="button" onClick={decBig} aria-label={`${unit} ${big}만큼 감소`} title={`-${big}`} style={bigBtn}>
          −{big}
        </button>
      )}
      <button type="button" onClick={dec} aria-label={`${unit} 감소`} style={btnBase}>−</button>
      {editing ? (
        <input
          ref={inputRef}
          type="number"
          inputMode="decimal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            else if (e.key === "Escape") { e.preventDefault(); setEditing(false); setDraft(String(value)); }
          }}
          style={{
            minWidth: 76, height: 40, padding: "0 10px", borderRadius: 8,
            border: "2px solid var(--primary)", background: "var(--surface)",
            fontSize: 15, fontWeight: 700, textAlign: "center",
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`${unit} 값 수정`}
          style={{
            minWidth: 76, height: 40, padding: "0 10px", borderRadius: 8,
            border: "1px solid var(--border)", background: "var(--surface)",
            fontSize: 15, fontWeight: 700, cursor: "pointer",
          }}
        >
          {value} <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 2 }}>{unit}</span>
        </button>
      )}
      <button type="button" onClick={inc} aria-label={`${unit} 증가`} style={btnBase}>+</button>
      {incBig && (
        <button type="button" onClick={incBig} aria-label={`${unit} ${big}만큼 증가`} title={`+${big}`} style={bigBtn}>
          +{big}
        </button>
      )}
    </div>
  );
};
