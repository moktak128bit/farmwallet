/**
 * 인사이트 상단 헤더 — 타이틀 + 기간(3M/6M/1Y/전체) 버튼 + 월 선택 드롭다운.
 * InsightsPage에서 분리 — React.memo로 감싸 탭 전환 등 무관한 상태 변경 시 재렌더를 건너뛴다.
 * 부모가 넘기는 콜백은 모두 안정적(useCallback)이어야 memo가 효과를 가진다.
 */
import React from "react";

const PERIOD_OPTIONS: { label: string; v: number | null }[] = [
  { label: "3M", v: 3 },
  { label: "6M", v: 6 },
  { label: "1Y", v: 12 },
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
    <div style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%)", padding: "24px 32px 18px", color: "#fff", borderRadius: "12px 12px 0 0", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase" as const, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>FarmWallet Analytics</div>
        <div style={{ fontSize: 26, fontWeight: 800 }}>가계부 인사이트 대시보드</div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>{dateRange} · {txCount.toLocaleString()}건 분석</div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {/* 기간: 특정 월 선택 시엔 의미 없으므로 흐리게 */}
        <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.1)", borderRadius: 8, padding: 2, opacity: selMonth ? 0.4 : 1 }}>
          {PERIOD_OPTIONS.map((p) => (
            <button
              key={p.label}
              type="button"
              disabled={!!selMonth}
              onClick={() => onSelectPeriod(p.v)}
              style={{
                padding: "6px 12px", borderRadius: 6, border: "none",
                cursor: selMonth ? "not-allowed" : "pointer",
                fontSize: 12, fontWeight: 700,
                background: periodMonths === p.v ? "#fff" : "transparent",
                color: periodMonths === p.v ? "#1a1a2e" : "rgba(255,255,255,0.7)",
                transition: "all 0.15s",
              }}
            >{p.label}</button>
          ))}
        </div>
        <select
          value={selMonth ?? "all"}
          onChange={(e) => onSelectMonth(e.target.value === "all" ? null : e.target.value)}
          style={{
            padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.1)",
            color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", outline: "none", minWidth: 120,
          }}
        >
          <option value="all" style={{ color: "#1a1a2e" }}>전체 월</option>
          {[...months].reverse().map(m => <option key={m} value={m} style={{ color: "#1a1a2e" }}>{ml[m]} ({m})</option>)}
        </select>
      </div>
    </div>
  );
});
