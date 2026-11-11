/**
 * 내 실질 월급 — 대시보드 "소득" 섹션.
 * 기본은 최근 12개 완료월. 기간(시작·끝 달)을 고르면 그 기간의 근로소득 합계·월평균·월별 표를 보여 준다.
 * 계산은 utils/annualTakeHome.computeAnnualTakeHome 단일 소스(인사이트 수입 탭과 같은 정의).
 */
import React, { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LedgerEntry } from "../../types";
import { computeAnnualTakeHome } from "../../utils/annualTakeHome";
import { shiftMonth } from "../../utils/date";
import { Money } from "../../components/ui/Money";
import { formatKRW, formatKrwCompact, formatNumber } from "../../utils/formatter";

const ym = (m: string) => m.replace("-", ".");

type Preset = "last12" | "thisYear" | "lastYear" | "custom";

interface Props {
  ledger: LedgerEntry[];
  salaryKeys: Set<string>;
  fxRate: number | null;
  /** 진행 중인 달 (KST YYYY-MM) */
  curMonth: string;
}

export const AnnualTakeHomeCard: React.FC<Props> = React.memo(function AnnualTakeHomeCard({ ledger, salaryKeys, fxRate, curMonth }) {
  const lastDone = shiftMonth(curMonth, -1);
  const firstMonth = useMemo(() => {
    let first = lastDone;
    for (const l of ledger) {
      const m = l.date?.slice(0, 7);
      if (m && m < first) first = m;
    }
    return first;
  }, [ledger, lastDone]);
  const monthOptions = useMemo(() => {
    const out: string[] = [];
    for (let m = firstMonth; m <= lastDone && out.length < 600; m = shiftMonth(m, 1)) out.push(m);
    return out;
  }, [firstMonth, lastDone]);

  const [preset, setPreset] = useState<Preset>("last12");
  const [custom, setCustom] = useState<{ from: string; to: string }>(() => ({ from: shiftMonth(curMonth, -12), to: lastDone }));
  const thisYear = curMonth.slice(0, 4);
  const range = useMemo((): { from: string; to: string } | undefined => {
    if (preset === "thisYear") return { from: `${thisYear}-01`, to: lastDone };
    if (preset === "lastYear") return { from: `${Number(thisYear) - 1}-01`, to: `${Number(thisYear) - 1}-12` };
    if (preset === "custom") return custom.from <= custom.to ? custom : { from: custom.to, to: custom.from };
    return undefined;
  }, [preset, custom, thisYear, lastDone]);

  const data = useMemo(
    () => computeAnnualTakeHome({ ledger, salaryKeys, fxRate, curMonth, range }),
    [ledger, salaryKeys, fxRate, curMonth, range]
  );
  const [showTable, setShowTable] = useState(true);

  const presetBtn = (id: Preset, label: string) => (
    <button
      type="button"
      className={preset === id ? "primary" : "secondary"}
      onClick={() => setPreset(id)}
      style={{ padding: "4px 10px", fontSize: 12 }}
      aria-pressed={preset === id}
    >
      {label}
    </button>
  );

  const controls = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {presetBtn("last12", "최근 12개월")}
      {presetBtn("thisYear", `${thisYear}년`)}
      {presetBtn("lastYear", `${Number(thisYear) - 1}년`)}
      {presetBtn("custom", "기간 선택")}
      {preset === "custom" && (
        <span style={{ display: "inline-flex", gap: 4, alignItems: "center", fontSize: 12 }}>
          <select aria-label="시작 달" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} style={{ fontSize: 12 }}>
            {monthOptions.map((m) => <option key={m} value={m}>{ym(m)}</option>)}
          </select>
          ~
          <select aria-label="끝 달" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} style={{ fontSize: 12 }}>
            {monthOptions.map((m) => <option key={m} value={m}>{ym(m)}</option>)}
          </select>
        </span>
      )}
    </div>
  );

  if (!data) {
    return (
      <div className="card">
        <div className="card-title">내 실질 월급</div>
        {controls}
        <div className="hint" style={{ marginTop: 12 }}>이 기간에는 급여·상여·수당 기록이 없어요.</div>
      </div>
    );
  }

  const n = data.byMonth.length;
  const yoy = data.prevTotal != null && data.prevTotal > 0 && data.divisorMonths === n ? ((data.total / data.prevTotal) - 1) * 100 : null;
  const refundTotal = data.refundExtras.reduce((s, r) => s + r.aboveTypical, 0);
  const chart = data.byMonth.map((r) => ({ l: r.month.slice(2).replace("-", "."), 정기: r.regular, 상여수당: r.extra }));
  const extraLabel = data.extraItems.map((x) => `${x.key} ${formatKrwCompact(x.total)}`).join(" · ");
  const regularName = data.regularKey ?? "월급";

  return (
    <div className="card">
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <div className="card-title" style={{ margin: 0 }}>
          내 실질 월급 · {ym(data.from)}~{ym(data.to)} ({data.divisorMonths < n ? `기록 ${data.divisorMonths}개월` : `${n}개월`})
        </div>
        {controls}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 32px", alignItems: "flex-end" }}>
        <div>
          <div className="hint" style={{ fontSize: 12 }}>
            한 달 평균 실수령 (근로소득 {formatKRW(data.total)} ÷ {data.divisorMonths}개월)
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, color: "var(--chart-income)" }}>
            <Money value={data.monthlyAvg} />
          </div>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7 }}>
          <div>
            {data.divisorMonths}개월 실수령 <strong style={{ color: "var(--text)" }}>{formatKRW(data.total)}</strong>
            {data.divisorMonths !== 12 && <span> · 12개월 환산 {formatKrwCompact(data.monthlyAvg * 12)}</span>}
            {yoy != null && (
              <span style={{ marginLeft: 6, color: yoy >= 0 ? "var(--chart-income)" : "var(--chart-expense)" }}>
                직전 {n}개월 대비 {yoy >= 0 ? "+" : ""}{yoy.toFixed(1)}%
              </span>
            )}
          </div>
          <div>
            정기 {regularName} 보통 <strong style={{ color: "var(--text)" }}>{formatKRW(data.regularMedian)}</strong>
            {data.extraTotal > 0 && <> · 상여·수당 {formatKRW(data.extraTotal)}</>}
          </div>
          {extraLabel && <div className="hint" style={{ fontSize: 12 }}>{extraLabel}</div>}
        </div>
      </div>

      {refundTotal > 0 && (
        <div className="hint" style={{ fontSize: 12, marginTop: 8, padding: "6px 10px", background: "var(--warning-light)", borderRadius: 6, color: "var(--text-secondary)" }}>
          {data.refundExtras.map((r) => `${ym(r.month)} ${regularName}("${r.note}")`).join(", ")}에 연말정산 환급 등이 섞여 있어요.
          {" "}평소보다 많은 {formatKRW(refundTotal)}을 빼면 평균 {formatKRW(Math.round((data.total - refundTotal) / data.divisorMonths))}
          {" "}(가계부에 환급액이 따로 적혀 있지 않아 평소 {regularName} 중앙값과의 차이로 추정).
        </div>
      )}

      <div style={{ height: 180, marginTop: 12 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="l" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} width={44} tickFormatter={(v: number) => formatKrwCompact(v)} />
            <Tooltip formatter={(v) => formatKRW(Number(v ?? 0))} />
            <Bar dataKey="정기" name={regularName} stackId="pay" fill="var(--chart-income)" isAnimationActive={false} />
            <Bar dataKey="상여수당" name="상여·수당" stackId="pay" fill="var(--warning)" isAnimationActive={false} />
            <ReferenceLine y={data.monthlyAvg} stroke="var(--text-secondary)" strokeDasharray="4 3" label={{ value: `평균 ${formatKrwCompact(data.monthlyAvg)}`, position: "insideTopLeft", fontSize: 11, fill: "var(--text-secondary)" }} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <button type="button" className="secondary" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable} style={{ marginTop: 8, padding: "4px 10px", fontSize: 12 }}>
        {showTable ? "월별 표 접기" : "월별 표 보기"}
      </button>
      {showTable && (
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table className="data-table" style={{ width: "100%", fontSize: 13 }}>
            <thead>
              <tr>
                <th>월</th>
                <th className="number">{regularName}</th>
                <th>상여·수당</th>
                <th className="number">합계</th>
              </tr>
            </thead>
            <tbody>
              {data.byMonth.map((r) => (
                <tr key={r.month}>
                  <td>{ym(r.month)}</td>
                  <td className="number">
                    {r.regular > 0 ? formatNumber(r.regular) : "—"}
                    {r.refundNote && <div className="hint" style={{ fontSize: 11 }}>{r.refundNote}</div>}
                  </td>
                  <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {r.extras.length === 0
                      ? ""
                      : r.extras.map((x, i) => (
                          <div key={i}>
                            {x.key} {formatNumber(x.amount)}
                            {x.desc && x.desc !== x.key && <span className="hint" style={{ fontSize: 11 }}> ({x.desc})</span>}
                          </div>
                        ))}
                  </td>
                  <td className="number" style={{ fontWeight: 600 }}>{formatNumber(r.regular + r.extra)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 700 }}>
                <td>합계</td>
                <td className="number">{formatNumber(data.regularTotal)}</td>
                <td>{formatNumber(data.extraTotal)}</td>
                <td className="number">{formatNumber(data.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="hint" style={{ fontSize: 12, marginTop: 8, lineHeight: 1.6 }}>
        통장에 들어온 세후 금액 기준(급여·상여·수당). 진행 중인 달은 빼고, 배당·캐시백·정산 같은 다른 수입도 넣지 않았어요.
        {data.paidMonths < n && ` 근로소득이 없던 달 ${n - data.paidMonths}개월 포함.`}
        {data.divisorMonths < n && ` 기록이 ${data.divisorMonths}개월뿐이라 그 기간으로 나눴어요.`}
        {data.retirement > 0 && ` 회사 퇴직연금 적립 ${formatKRW(data.retirement)}은 쓸 수 있는 돈이 아니라 따로 뒀어요.`}
      </div>
    </div>
  );
});
