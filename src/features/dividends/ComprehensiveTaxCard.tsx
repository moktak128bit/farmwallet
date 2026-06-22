/**
 * 종합과세 추적 카드 (B1) — 올해 금융소득(배당+이자)이 2,000만 임계에 얼마나 가까운지,
 * 이 페이스면 언제 넘을지 보여줘 배당 수령 타이밍/규모 조절(절세) 판단을 돕는다.
 * 계산은 utils/taxCalculator.buildComprehensiveTaxTracker(순수)에 있고 여기는 표시만.
 */
import React, { useMemo } from "react";
import type { LedgerEntry } from "../../types";
import { buildComprehensiveTaxTracker } from "../../utils/taxCalculator";
import { getTodayKST } from "../../utils/date";
import { formatKRW } from "../../utils/formatter";

interface Props {
  ledger: LedgerEntry[];
  fxRate: number | null;
}

export const ComprehensiveTaxCard: React.FC<Props> = ({ ledger, fxRate }) => {
  const today = getTodayKST();
  const t = useMemo(() => buildComprehensiveTaxTracker(ledger, today, fxRate), [ledger, today, fxRate]);

  const pct = Math.min(1, t.pctOfThreshold);
  // 임계 근접도로 색 구분: 초과=danger, 80%+=warning, 그 외=accent(중립 진행)
  const barColor = t.exceeded ? "var(--danger)" : t.pctOfThreshold >= 0.8 ? "var(--warning)" : "var(--accent)";

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div className="card-title">올해 금융소득 — 종합과세 추적 ({t.year}년)</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          배당 {formatKRW(Math.round(t.dividendGross))} · 이자 {formatKRW(Math.round(t.interestGross))}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 24, fontWeight: 800 }}>{formatKRW(Math.round(t.ytdGross))}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          / {formatKRW(t.threshold)} 임계 ({(t.pctOfThreshold * 100).toFixed(0)}%)
        </div>
      </div>

      {/* 진행 바 */}
      <div style={{ height: 10, borderRadius: 6, background: "var(--border)", overflow: "hidden", margin: "10px 0 8px" }}>
        <div style={{ width: `${pct * 100}%`, height: "100%", background: barColor, transition: "none" }} />
      </div>

      {t.exceeded ? (
        <div style={{ fontSize: 13, color: "var(--danger)", fontWeight: 600 }}>
          ⚠ 종합과세 임계를 넘었습니다 — 초과 {formatKRW(Math.round(t.ytdGross - t.threshold))}.
          내년 5월 종합소득세 신고 대상일 수 있습니다.
        </div>
      ) : (
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          임계까지 <strong style={{ color: "var(--text)" }}>{formatKRW(Math.round(t.remainingToThreshold))}</strong> 남음.
          {t.projectedThresholdDate
            ? ` 이 페이스면 약 ${t.projectedThresholdDate} 도달 예상 — 배당 수령 시기를 분산하면 절세에 유리합니다.`
            : " 현재 페이스로는 올해 안에 넘지 않을 전망입니다."}
        </div>
      )}
    </div>
  );
};
