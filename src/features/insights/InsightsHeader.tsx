/**
 * 인사이트 상단 헤더 — 타이틀 + 기간(3개월/6개월/1년/전체) 버튼 + 월 선택 드롭다운.
 * 다른 탭과 같은 .section-header — 인사이트만 다른 앱처럼 보이던 네이비 배너를 걷어냈다
 * (디자인 원칙: 색은 데이터에만, 활성 상태는 잉크 대비로).
 * InsightsPage에서 분리 — React.memo로 감싸 탭 전환 등 무관한 상태 변경 시 재렌더를 건너뛴다.
 * 부모가 넘기는 콜백은 모두 안정적(useCallback)이어야 memo가 효과를 가진다.
 */
import React from "react";

const PERIOD_OPTIONS: { label: string; v: number | null }[] = [
  { label: "3개월", v: 3 },
  { label: "6개월", v: 6 },
  { label: "1년", v: 12 },
  { label: "전체", v: null },
];

interface Props {
  dateRange: string;
  txCount: number;
  months: string[];
  ml: Record<string, string>;
  selMonth: string | null;
  periodMonths: number | null;
  onSelectPeriod: (v: number | null) => void;
  onSelectMonth: (v: string | null) => void;
}

export const InsightsHeader = React.memo(function InsightsHeader({ dateRange, txCount, months, ml, selMonth, periodMonths, onSelectPeriod, onSelectMonth }: Props) {
  return (
    <div className="section-header">
      <div>
        <h2>인사이트</h2>
        <div className="hint" style={{ marginTop: 2, fontSize: 12 }}>{dateRange} · {txCount.toLocaleString()}건 분석</div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {/* 기간: 특정 월 선택 시엔 의미 없으므로 비활성 */}
        <div role="group" aria-label="분석 기간" style={{ display: "flex", gap: 4, opacity: selMonth ? 0.5 : 1 }}>
          {PERIOD_OPTIONS.map((p) => (
            <button
              key={p.label}
              type="button"
              disabled={!!selMonth}
              onClick={() => onSelectPeriod(p.v)}
              className={periodMonths === p.v ? "primary" : "secondary"}
              style={{ fontSize: 12, padding: "5px 10px" }}
            >{p.label}</button>
          ))}
        </div>
        <select
          aria-label="분석 월 선택"
          value={selMonth ?? "all"}
          onChange={(e) => onSelectMonth(e.target.value === "all" ? null : e.target.value)}
          style={{ fontSize: 13, padding: "6px 10px", minWidth: 120 }}
        >
          <option value="all">전체 월</option>
          {[...months].reverse().map(m => <option key={m} value={m}>{ml[m]} ({m})</option>)}
        </select>
      </div>
    </div>
  );
});
