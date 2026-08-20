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
import { useTaxGrossUp } from "../../hooks/useTaxGrossUp";

interface Props {
  ledger: LedgerEntry[];
  fxRate: number | null;
}

export const ComprehensiveTaxCard: React.FC<Props> = ({ ledger, fxRate }) => {
  const today = getTodayKST();
  // 세전 환산 토글 — 가계부 금액은 세후 입금액일 가능성이 높아 그대로 쓰면 임계가 ~15% 과소 (보고서 탭과 같은 값 공유)
  const [grossUp, setGrossUp] = useTaxGrossUp();
  const t = useMemo(
    () => buildComprehensiveTaxTracker(ledger, today, fxRate, { grossUp }),
    [ledger, today, fxRate, grossUp]
  );

  const pct = Math.min(1, t.pctOfThreshold);
  // 임계 근접도로 색 구분: 초과=danger, 80%+=warning, 그 외=accent(중립 진행)
  const barColor = t.exceeded ? "var(--danger)" : t.pctOfThreshold >= 0.8 ? "var(--warning)" : "var(--accent)";

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div className="card-title">
          올해 금융소득 — 종합과세 추적 ({t.year}년)
          {t.grossUpApplied && (
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>세전 환산 기준</span>
          )}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          배당 {formatKRW(Math.round(t.dividendGross))} · 이자 {formatKRW(Math.round(t.interestGross))}
        </div>
      </div>

      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", marginTop: 6, cursor: "pointer", flexWrap: "wrap" }}>
        <input type="checkbox" checked={grossUp} onChange={(e) => setGrossUp(e.target.checked)} />
        세전 환산(원천징수 15.4%/15% 역산)
        {t.grossUpApplied && t.netTotal > 0 && (
          <span>— 입금액 {formatKRW(Math.round(t.netTotal))} → 세전 {formatKRW(Math.round(t.grossTotal))}</span>
        )}
      </label>

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
