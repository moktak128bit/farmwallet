/**
 * 세금 시뮬레이션 (한국) — 연도 선택 + 배당/이자 분리과세·종합과세 경고.
 * ReportPage에서 분리 — React.memo로 감싸 다른 보고서 상태 변경 시 재렌더를 건너뛴다.
 * taxYear/taxSummary는 부모 memo (CSV/Excel/PDF 내보내기와 공유) — 여기서 재계산하지 않는다.
 * 연도 select는 종합 월간 보고서와 공유하는 selectedMonth(부모 소유)의 연도 부분을 바꾼다 —
 * setSelectedMonth는 setState 그대로라 참조 안정.
 */
import React from "react";
import { COMPREHENSIVE_TAX_THRESHOLD, type TaxYearSummary } from "../../utils/taxCalculator";
import { formatKRW } from "../../utils/formatter";

interface Props {
  taxYear: number;
  taxSummary: TaxYearSummary;
  selectedMonth: string;
  setSelectedMonth: React.Dispatch<React.SetStateAction<string>>;
}

export const TaxReportSection: React.FC<Props> = React.memo(function TaxReportSection({
  taxYear,
  taxSummary,
  selectedMonth,
  setSelectedMonth
}) {
  return (
    <div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <label>연도:</label>
        <select value={taxYear} onChange={(e) => {
          const y = e.target.value;
          setSelectedMonth(`${y}-${selectedMonth.slice(5)}`);
        }}>
          {Array.from({ length: 6 }).map((_, i) => {
            const y = new Date().getFullYear() - i;
            return <option key={y} value={y}>{y}년</option>;
          })}
        </select>
      </div>
      <h3>세금 시뮬레이션 — {taxYear}년 (한국 세법 기준)</h3>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <tbody>
          <tr><td style={{ padding: 6 }}>배당 (총)</td><td style={{ textAlign: "right", padding: 6 }}>{formatKRW(taxSummary.dividendGross)}</td></tr>
          <tr><td style={{ padding: 6 }}>이자 (총)</td><td style={{ textAlign: "right", padding: 6 }}>{formatKRW(taxSummary.interestGross)}</td></tr>
          <tr style={{ borderTop: "1px solid var(--border)" }}><td style={{ padding: 6, fontWeight: 700 }}>합계</td><td style={{ textAlign: "right", padding: 6, fontWeight: 700 }}>{formatKRW(taxSummary.totalGross)}</td></tr>
          <tr><td style={{ padding: 6 }}>분리과세 (15.4%)</td><td style={{ textAlign: "right", padding: 6 }}>−{formatKRW(Math.round(taxSummary.separateTax))}</td></tr>
          <tr style={{ borderTop: "1px solid var(--border)" }}><td style={{ padding: 6, fontWeight: 700 }}>실수령액 (분리과세 후)</td><td style={{ textAlign: "right", padding: 6, fontWeight: 700, color: "var(--success)" }}>{formatKRW(Math.round(taxSummary.netIncome))}</td></tr>
        </tbody>
      </table>
      {taxSummary.exceedsThreshold && (
        <div style={{ marginTop: 16, padding: 12, background: "var(--warning-bg, #fef3c7)", borderLeft: "4px solid var(--warning, #f59e0b)", borderRadius: 6 }}>
          <strong>⚠ 종합과세 대상 가능</strong>
          <p style={{ fontSize: 13, margin: "8px 0 4px" }}>
            배당+이자 합계가 {COMPREHENSIVE_TAX_THRESHOLD.toLocaleString()}원을 초과합니다.
            초과액 {formatKRW(taxSummary.amountOverThreshold)}에 대해 종합소득세 신고가 필요할 수 있으며,
            추정 추가세부담은 약 <strong>{formatKRW(Math.round(taxSummary.estimatedAdditionalTaxIfComprehensive))}</strong>입니다 (24% 누진구간 가정).
          </p>
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>
            ※ 정확한 금액은 다른 종합소득(근로/사업) 합산에 따라 달라집니다. 본 수치는 참고용입니다.
          </p>
        </div>
      )}
    </div>
  );
});
