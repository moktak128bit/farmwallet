import React, { useMemo } from "react";
import type { CategoryPresets, LedgerEntry } from "../../types";
import { buildInsightsDecisionBrief } from "../../utils/insightsDecisionBrief";
import { getTodayKST } from "../../utils/date";
import { W, Pct } from "./insightsShared";

export function InsightsDecisionBrief({ ledger, targetMonth, categoryPresets, fxRate }: {
  ledger: LedgerEntry[];
  targetMonth: string;
  categoryPresets: CategoryPresets;
  fxRate: number | null;
}) {
  const today = getTodayKST();
  const brief = useMemo(() => buildInsightsDecisionBrief({ ledger, targetMonth, categoryPresets, fxRate, today }),
    [ledger, targetMonth, categoryPresets, fxRate, today]);
  const baseline = brief.comparisons.find(row => row.id === "average3")!;
  const increases = brief.drivers.filter(row => row.delta > 0);
  const period = brief.partialDay != null ? `동기(1~${brief.partialDay}일)` : "월 전체";
  const signedMoney = (amount: number) => `${amount > 0 ? "+" : amount < 0 ? "−" : ""}${W(Math.round(Math.abs(amount)))}`;
  return (
    <section className="card" aria-label="지출 변화와 확인할 항목" style={{ marginTop: 16, marginBottom: 20, padding: 18 }}>
      <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>지출 변화와 확인할 항목</h2>
      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 16px", lineHeight: 1.6 }}>
        {targetMonth.replace("-", ".")} · {period}. 비교는 기간 필터와 관계없이 전체 가계부 기록을 사용합니다.
        {brief.partialDay != null && " 과거 월도 같은 일자까지 비교합니다."}
      </p>
      {!brief.hasTarget ? <p className="hint">선택한 달에 기록이 없어 분석을 보류합니다.</p> : brief.missingFx ? (
        <p style={{ color: "var(--warning)", fontSize: 13 }}>달러 지출의 환율이 없어 비교를 보류합니다. 환율을 불러온 뒤 다시 확인하세요.</p>
      ) : <>
        {brief.daysSinceLastRecord != null && brief.daysSinceLastRecord >= 7 && <p style={{ background: "var(--warning-light)", padding: 12, borderRadius: 8, fontSize: 13, lineHeight: 1.6 }}>
          마지막 기록은 {brief.latestRecordDate}입니다. {brief.daysSinceLastRecord}일간 새 기록이 없어 지출 감소를 절약 성과로 판단하기 어렵습니다. 빠진 거래부터 확인하세요.
        </p>}
        <p style={{ fontSize: 14, lineHeight: 1.7 }}>
          {baseline.delta == null ? "직전 3개월 기록이 모두 있어야 평소 지출과 비교할 수 있습니다." : (
            <>직전 3개월 평균보다 기록된 지출이 <strong>{W(Math.round(Math.abs(baseline.delta)))}</strong> {baseline.delta > 0 ? "늘었습니다" : baseline.delta < 0 ? "줄었습니다" : "차이 없이 유지됐습니다"}.
              {increases[0] && <> 증가액이 가장 큰 대분류는 <strong>{increases[0].name}</strong>입니다.</>}</>
          )}
        </p>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ width: "100%", fontSize: 13 }}>
            <caption style={{ textAlign: "left", padding: "0 0 10px", color: "var(--text-muted)" }}>비교 기준별 지출 차이 · {period}</caption>
            <thead><tr><th>비교 기준</th><th className="number">기준 지출</th><th className="number">차이</th><th className="number">증감률</th></tr></thead>
            <tbody>{brief.comparisons.map(row => <tr key={row.id}>
              <td>{row.label}{row.amount == null && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>기록 {row.recordedCount}/{row.requiredCount}개월 · 비교 보류</div>}</td>
              <td className="number">{row.amount == null ? "—" : W(Math.round(row.amount))}</td>
              <td className="number">{row.delta == null ? "—" : signedMoney(row.delta)}</td>
              <td className="number">{row.amount == null ? "—" : row.amount === 0 ? "기준 지출 0원" : Pct(row.percent!)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {brief.drivers.length > 0 && <div style={{ marginTop: 18 }}>
          <h3 style={{ fontSize: 15, margin: "0 0 10px" }}>변화가 큰 항목 · 직전 3개월 평균 대비</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
            {brief.drivers.map(row => <article key={row.name} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontWeight: 700 }}><span>{row.name}</span><span style={{ color: row.delta > 0 ? "var(--chart-expense)" : "var(--text-secondary)" }}>{signedMoney(row.delta)}</span></div>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, margin: "8px 0" }}>
                거래 건수 {row.averageCount.toFixed(1)}건 → {row.count}건<br />
                건당 평균 {row.baselineTicket == null ? "기록 없음" : W(Math.round(row.baselineTicket))} → {row.averageTicket == null ? "거래 없음" : W(Math.round(row.averageTicket))}
              </p>
              {row.largestEntry && <p style={{ fontSize: 13, lineHeight: 1.6, margin: "8px 0" }}>
                최대 단건: <strong>{row.largestEntry.description} · {W(Math.round(row.largestEntry.amount))}</strong> ({row.largestEntry.date})
              </p>}
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                {row.delta > 0 ? row.averageCount === 0
                  ? "이전 3개월에 없던 지출입니다. 새 고정비인지 일회성 거래인지 가계부에서 확인하세요."
                  : "가계부에서 이 분류의 거래를 확인하고, 반복 결제·큰 단건·구매 횟수 중 무엇이 달라졌는지 점검하세요."
                  : "지출이 줄어든 항목입니다. 결제가 다음 달로 미뤄졌거나 기록이 빠진 것은 아닌지 확인하세요."}
              </div>
            </article>)}
          </div>
        </div>}
      </>}
      <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, margin: "14px 0 0" }}>
        기록이 없는 달은 0원으로 간주하지 않습니다. 기록이 있는 달도 미입력 거래가 있으면 결과가 달라집니다.
        카드대금 이체·저축·투자·환전은 소비 지출에서 제외합니다. 증감액은 절약 가능한 금액을 뜻하지 않습니다.
      </p>
    </section>
  );
}
