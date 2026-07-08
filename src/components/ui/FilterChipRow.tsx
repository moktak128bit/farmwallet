/**
 * 공유 필터 칩 행 — 가계부·주식 등 모든 탭의 "전체 + 토글 칩" 필터 UI 단일 프리미티브.
 *
 * 컨벤션(앱 전역 통일):
 *  - "선택 없음"은 항상 `string | undefined` (null/"" 센티넬 금지).
 *  - 맨 앞 "전체" 칩 = undefined 선택. 활성 칩 재클릭 = 토글 해제(= 전체).
 *  - 옵션 0개면 row 자체 숨김(cascading 상위가 잠궜을 때) — hideWhenEmpty=false로 끌 수 있음.
 *  - 색은 CSS 변수만(--primary-light/--primary) — 다크모드 자동 대응, 하드코딩 hex 금지.
 *
 * 기존 LedgerFilterBar의 비공개 ChipRow를 승격한 것. 칩별 개수 배지(count)를 추가 지원.
 */
import React from "react";

interface FilterChipOption {
  value: string;
  display: string;
  /** 선택적 개수 배지 (예: 계좌별 거래 수) */
  count?: number;
}

interface FilterChipRowProps {
  /** 좌측 라벨 (생략 가능) */
  label?: string;
  options: FilterChipOption[];
  selected: string | undefined;
  onSelect: (v: string | undefined) => void;
  /** "전체" 칩 라벨 (기본 "전체"); 개수 표시용 별도 텍스트도 display로 받음 */
  allLabel?: string;
  /** 옵션 0개일 때 row 자체를 숨길지 (기본 true) */
  hideWhenEmpty?: boolean;
}

const chipBaseStyle: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 12,
  border: "1px solid var(--border)",
  borderRadius: 16,
  background: "var(--surface)",
  color: "var(--text)",
  cursor: "pointer",
  transition: "all 0.15s",
  whiteSpace: "nowrap",
};

const chipActiveStyle: React.CSSProperties = {
  ...chipBaseStyle,
  fontWeight: 600,
  background: "var(--primary-light)",
  color: "var(--primary)",
  border: "1px solid var(--primary)",
};

const countBadgeStyle: React.CSSProperties = {
  marginLeft: 5,
  fontSize: 10,
  opacity: 0.7,
};

export const FilterChipRow: React.FC<FilterChipRowProps> = ({
  label,
  options,
  selected,
  onSelect,
  allLabel = "전체",
  hideWhenEmpty = true,
}) => {
  if (hideWhenEmpty && options.length === 0) return null;
  const isAll = !selected;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
      {label != null && (
        <span style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 56, paddingTop: 7 }}>{label}</span>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, flex: 1, minWidth: 0 }}>
        <button type="button" onClick={() => onSelect(undefined)} style={isAll ? chipActiveStyle : chipBaseStyle}>
          {allLabel}
        </button>
        {options.map((opt) => {
          const active = selected === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onSelect(active ? undefined : opt.value)}
              style={active ? chipActiveStyle : chipBaseStyle}
            >
              {opt.display}
              {opt.count != null && <span style={countBadgeStyle}>{opt.count}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
};
