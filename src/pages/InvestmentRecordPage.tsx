import React, { useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";
import type { Payload } from "recharts/types/component/DefaultTooltipContent";
import type { ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import type { Account, PositionRow, StockTrade } from "../types";
import { formatKRW, formatNumber, formatShortDate } from "../utils/formatter";
import {
  buildClosedTradeRecords,
  summarizeRecords,
  groupByMonth,
  groupByYear,
  groupByHoldingBucket,
  filterByPeriod,
  holdingRange,
  HOLDING_BUCKETS,
  type ClosedTradeRecord,
  type PeriodSummary,
  type PeriodFilter,
} from "../utils/investmentRecord";
import { positionMarketValueKRW } from "../calculations";

interface Props {
  accounts: Account[];
  trades: StockTrade[];
  positions: PositionRow[];
  fxRate?: number | null;
}

const PNL_POS = "#10b981";
const PNL_NEG = "#ef4444";

function pnlColor(v: number): string {
  if (v > 0) return PNL_POS;
  if (v < 0) return PNL_NEG;
  return "var(--text-muted)";
}

function formatPct(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

function formatSignedKRW(v: number): string {
  if (!Number.isFinite(v)) return "0 원";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${formatKRW(Math.abs(v))}`;
}

const Card: React.FC<{
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: string;
}> = ({ label, value, sub, accent }) => (
  <div
    style={{
      padding: 14,
      borderRadius: 12,
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderLeft: accent ? `4px solid ${accent}` : "1px solid var(--border)",
      minWidth: 160,
      flex: 1,
    }}
  >
    <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: accent ?? "var(--text)" }}>
      {value}
    </div>
    {sub != null && (
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{sub}</div>
    )}
  </div>
);

interface TooltipLike {
  active?: boolean;
  payload?: ReadonlyArray<Payload<ValueType, NameType>>;
  label?: string | number;
}

const PeriodTooltip: React.FC<TooltipLike> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  const v = typeof p.value === "number" ? p.value : Number(p.value);
  return (
    <div
      style={{
        padding: "8px 12px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 700 }}>{String(label)}</div>
      <div style={{ color: pnlColor(v) }}>{formatSignedKRW(v)}</div>
    </div>
  );
};

export const InvestmentRecordView: React.FC<Props> = ({ accounts, trades, positions, fxRate }) => {
  const accountNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.id, a.name);
    return m;
  }, [accounts]);

  const allRecords = useMemo(() => buildClosedTradeRecords(trades, accounts), [trades, accounts]);

  const yearOptions = useMemo(() => {
    const s = new Set<number>();
    for (const r of allRecords) s.add(Number(r.sellDate.slice(0, 4)));
    return [...s].sort((a, b) => b - a);
  }, [allRecords]);

  const now = new Date();
  const [period, setPeriod] = useState<PeriodFilter>({ kind: "year", year: now.getFullYear() });

  const filteredRecords = useMemo(
    () => filterByPeriod(allRecords, period),
    [allRecords, period]
  );
  const filteredSummary = useMemo(() => summarizeRecords(filteredRecords), [filteredRecords]);
  const filteredRange = useMemo(() => holdingRange(filteredRecords), [filteredRecords]);

  const yearMap = useMemo(() => groupByYear(allRecords), [allRecords]);
  const yearRows = useMemo(() => {
    const keys = [...yearMap.keys()].sort();
    const recent = keys.slice(-5);
    return recent.map((y) => ({ year: y, summary: yearMap.get(y)! }));
  }, [yearMap]);

  const monthMap = useMemo(() => groupByMonth(allRecords), [allRecords]);
  const monthRows = useMemo(() => {
    const keys = [...monthMap.keys()].sort();
    const recent = keys.slice(-24);
    return recent.map((ym) => ({ ym, summary: monthMap.get(ym)! }));
  }, [monthMap]);

  const holdingBuckets = useMemo(() => groupByHoldingBucket(filteredRecords), [filteredRecords]);

  const holdingsSummary = useMemo(() => {
    let totalBuyKRW = 0;
    let totalMarketKRW = 0;
    let count = 0;
    for (const p of positions) {
      if (p.quantity <= 0) continue;
      count += 1;
      const buyKRW = p.totalBuyAmountKRW ?? p.totalBuyAmount;
      totalBuyKRW += buyKRW;
      totalMarketKRW += positionMarketValueKRW(p, fxRate);
    }
    const unrealized = totalMarketKRW - totalBuyKRW;
    const rate = totalBuyKRW > 0 ? unrealized / totalBuyKRW : 0;
    return { count, totalBuyKRW, totalMarketKRW, unrealized, rate };
  }, [positions, fxRate]);

  const periodLabel =
    period.kind === "all"
      ? "전체 기간"
      : period.kind === "year"
      ? `${period.year}년`
      : `${period.year}년 ${String(period.month).padStart(2, "0")}월`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Filter
        period={period}
        yearOptions={yearOptions}
        onChange={setPeriod}
      />

      <SectionKpis summary={filteredSummary} range={filteredRange} holdings={holdingsSummary} periodLabel={periodLabel} />

      <SectionYear rows={yearRows} />

      <SectionMonth rows={monthRows} />

      <SectionHoldingBuckets buckets={holdingBuckets} />

      <SectionTable records={filteredRecords} accountNameById={accountNameById} />

      <SectionHoldings holdings={holdingsSummary} />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Section: Period filter
// ---------------------------------------------------------------------------

const Filter: React.FC<{
  period: PeriodFilter;
  yearOptions: number[];
  onChange: (p: PeriodFilter) => void;
}> = ({ period, yearOptions, onChange }) => {
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
        padding: 12,
        borderRadius: 10,
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700 }}>기간:</span>
      <select
        value={period.kind}
        onChange={(e) => {
          const kind = e.target.value as PeriodFilter["kind"];
          if (kind === "all") onChange({ kind: "all" });
          else if (kind === "year") onChange({ kind: "year", year: period.year ?? new Date().getFullYear() });
          else onChange({ kind: "month", year: period.year ?? new Date().getFullYear(), month: period.month ?? new Date().getMonth() + 1 });
        }}
        style={{ padding: "6px 10px", borderRadius: 6, fontSize: 13 }}
      >
        <option value="all">전체</option>
        <option value="year">연도별</option>
        <option value="month">월별</option>
      </select>
      {(period.kind === "year" || period.kind === "month") && (
        <select
          value={period.year ?? ""}
          onChange={(e) => onChange({ ...period, year: Number(e.target.value) })}
          style={{ padding: "6px 10px", borderRadius: 6, fontSize: 13 }}
        >
          {yearOptions.length === 0 && <option value={new Date().getFullYear()}>{new Date().getFullYear()}</option>}
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
      )}
      {period.kind === "month" && (
        <select
          value={period.month ?? 1}
          onChange={(e) => onChange({ ...period, month: Number(e.target.value) })}
          style={{ padding: "6px 10px", borderRadius: 6, fontSize: 13 }}
        >
          {months.map((m) => (
            <option key={m} value={m}>{String(m).padStart(2, "0")}월</option>
          ))}
        </select>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Section: KPI cards
// ---------------------------------------------------------------------------

const SectionKpis: React.FC<{
  summary: PeriodSummary;
  range: { min: number; max: number };
  holdings: { count: number; unrealized: number; rate: number };
  periodLabel: string;
}> = ({ summary, range, holdings, periodLabel }) => (
  <section>
    <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 800 }}>
      {periodLabel} 요약
    </h3>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <Card
        label="실현손익"
        value={<span style={{ color: pnlColor(summary.totalPnl) }}>{formatSignedKRW(summary.totalPnl)}</span>}
        sub={`투자원금 ${formatKRW(summary.totalCost)}`}
        accent={pnlColor(summary.totalPnl)}
      />
      <Card
        label="실현 수익률"
        value={<span style={{ color: pnlColor(summary.returnPct) }}>{formatPct(summary.returnPct)}</span>}
        sub={`${summary.tradeCount}건 청산`}
      />
      <Card
        label="승률"
        value={formatPct(summary.winRate)}
        sub={`승 ${summary.winCount} · 패 ${summary.lossCount}`}
      />
      <Card
        label="손익비"
        value={summary.profitLossRatio > 0 ? `${summary.profitLossRatio.toFixed(2)} : 1` : "—"}
        sub={`평균 수익 ${formatKRW(summary.avgWin)} / 평균 손실 ${formatKRW(Math.abs(summary.avgLoss))}`}
      />
      <Card
        label="평균 보유기간"
        value={`${Math.round(summary.avgHoldingDays)}일`}
        sub={`최단 ${range.min}일 · 최장 ${range.max}일`}
      />
      <Card
        label="보유 평가손익"
        value={<span style={{ color: pnlColor(holdings.unrealized) }}>{formatSignedKRW(holdings.unrealized)}</span>}
        sub={`${holdings.count}종목 · ${formatPct(holdings.rate)}`}
      />
    </div>
  </section>
);

// ---------------------------------------------------------------------------
// Section: Yearly
// ---------------------------------------------------------------------------

const SectionYear: React.FC<{ rows: { year: string; summary: PeriodSummary }[] }> = ({ rows }) => {
  if (rows.length === 0) {
    return (
      <section>
        <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 800 }}>연간 실현손익</h3>
        <EmptyBlock text="청산된 거래가 없습니다." />
      </section>
    );
  }
  const chartData = rows.map((r) => ({ year: r.year, pnl: r.summary.totalPnl }));
  return (
    <section>
      <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 800 }}>연간 실현손익 (최근 5년)</h3>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="year" tick={{ fontSize: 12 }} />
            <YAxis tickFormatter={(v: number) => `${Math.round(v / 10000)}만`} tick={{ fontSize: 11 }} />
            <Tooltip content={<PeriodTooltip />} />
            <Bar dataKey="pnl" radius={[6, 6, 0, 0]}>
              {chartData.map((d) => (
                <Cell key={d.year} fill={d.pnl >= 0 ? PNL_POS : PNL_NEG} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ overflowX: "auto", marginTop: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--surface)" }}>
              <Th>연도</Th>
              <Th align="right">실현손익</Th>
              <Th align="right">수익률</Th>
              <Th align="right">거래</Th>
              <Th align="right">승률</Th>
              <Th align="right">평균 보유</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year} style={{ borderTop: "1px solid var(--border)" }}>
                <Td>{r.year}</Td>
                <Td align="right" color={pnlColor(r.summary.totalPnl)}>{formatSignedKRW(r.summary.totalPnl)}</Td>
                <Td align="right" color={pnlColor(r.summary.returnPct)}>{formatPct(r.summary.returnPct)}</Td>
                <Td align="right">{r.summary.tradeCount}건</Td>
                <Td align="right">{formatPct(r.summary.winRate)}</Td>
                <Td align="right">{Math.round(r.summary.avgHoldingDays)}일</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------
// Section: Monthly
// ---------------------------------------------------------------------------

const SectionMonth: React.FC<{ rows: { ym: string; summary: PeriodSummary }[] }> = ({ rows }) => {
  if (rows.length === 0) return null;
  const chartData = rows.map((r) => ({ ym: r.ym.slice(2), pnl: r.summary.totalPnl }));
  return (
    <section>
      <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 800 }}>월별 실현손익 (최근 24개월)</h3>
      <div style={{ width: "100%", height: 220 }}>
        <ResponsiveContainer>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="ym" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tickFormatter={(v: number) => `${Math.round(v / 10000)}만`} tick={{ fontSize: 11 }} />
            <Tooltip content={<PeriodTooltip />} />
            <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
              {chartData.map((d) => (
                <Cell key={d.ym} fill={d.pnl >= 0 ? PNL_POS : PNL_NEG} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ overflowX: "auto", marginTop: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--surface)" }}>
              <Th>월</Th>
              <Th align="right">실현손익</Th>
              <Th align="right">수익률</Th>
              <Th align="right">거래</Th>
              <Th align="right">승률</Th>
              <Th align="right">평균 보유</Th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.ym} style={{ borderTop: "1px solid var(--border)" }}>
                <Td>{r.ym}</Td>
                <Td align="right" color={pnlColor(r.summary.totalPnl)}>{formatSignedKRW(r.summary.totalPnl)}</Td>
                <Td align="right" color={pnlColor(r.summary.returnPct)}>{formatPct(r.summary.returnPct)}</Td>
                <Td align="right">{r.summary.tradeCount}건</Td>
                <Td align="right">{formatPct(r.summary.winRate)}</Td>
                <Td align="right">{Math.round(r.summary.avgHoldingDays)}일</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------
// Section: Holding buckets
// ---------------------------------------------------------------------------

const SectionHoldingBuckets: React.FC<{
  buckets: Map<string, PeriodSummary>;
}> = ({ buckets }) => {
  const any = HOLDING_BUCKETS.some((b) => (buckets.get(b)?.tradeCount ?? 0) > 0);
  if (!any) {
    return (
      <section>
        <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 800 }}>보유기간별 분석</h3>
        <EmptyBlock text="선택한 기간에 청산 거래가 없습니다." />
      </section>
    );
  }
  return (
    <section>
      <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 800 }}>보유기간별 분석</h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--surface)" }}>
              <Th>보유기간</Th>
              <Th align="right">거래</Th>
              <Th align="right">승률</Th>
              <Th align="right">평균 수익률</Th>
              <Th align="right">실현손익</Th>
            </tr>
          </thead>
          <tbody>
            {HOLDING_BUCKETS.map((b) => {
              const s = buckets.get(b)!;
              return (
                <tr key={b} style={{ borderTop: "1px solid var(--border)" }}>
                  <Td>{b}</Td>
                  <Td align="right">{s.tradeCount}건</Td>
                  <Td align="right">{s.tradeCount > 0 ? formatPct(s.winRate) : "—"}</Td>
                  <Td align="right" color={pnlColor(s.returnPct)}>
                    {s.tradeCount > 0 ? formatPct(s.returnPct) : "—"}
                  </Td>
                  <Td align="right" color={pnlColor(s.totalPnl)}>
                    {s.tradeCount > 0 ? formatSignedKRW(s.totalPnl) : "—"}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------
// Section: Closed trade table
// ---------------------------------------------------------------------------

const SectionTable: React.FC<{
  records: ClosedTradeRecord[];
  accountNameById: Map<string, string>;
}> = ({ records, accountNameById }) => {
  if (records.length === 0) {
    return (
      <section>
        <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 800 }}>확정 거래 목록</h3>
        <EmptyBlock text="선택한 기간에 청산 거래가 없습니다." />
      </section>
    );
  }
  return (
    <section>
      <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 800 }}>
        확정 거래 목록 ({records.length}건)
      </h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "var(--surface)" }}>
              <Th>종목</Th>
              <Th>계좌</Th>
              <Th>매수일</Th>
              <Th>매도일</Th>
              <Th align="right">보유일</Th>
              <Th align="right">수량</Th>
              <Th align="right">매입원가</Th>
              <Th align="right">매도대금</Th>
              <Th align="right">실현손익</Th>
              <Th align="right">수익률</Th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.tradeId} style={{ borderTop: "1px solid var(--border)" }}>
                <Td>
                  <div style={{ fontWeight: 700 }}>{r.name || r.ticker}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {r.ticker}{r.isUsd ? " · USD" : ""}
                  </div>
                </Td>
                <Td>{accountNameById.get(r.accountId) ?? r.accountId}</Td>
                <Td>{formatShortDate(r.buyDateWeighted)}</Td>
                <Td>{formatShortDate(r.sellDate)}</Td>
                <Td align="right">{r.holdingDays}일</Td>
                <Td align="right">{formatNumber(r.sellQuantity)}</Td>
                <Td align="right">{formatKRW(r.costBasisKRW)}</Td>
                <Td align="right">{formatKRW(r.proceedsKRW)}</Td>
                <Td align="right" color={pnlColor(r.realizedPnlKRW)}>
                  {formatSignedKRW(r.realizedPnlKRW)}
                </Td>
                <Td align="right" color={pnlColor(r.returnPct)}>
                  {formatPct(r.returnPct)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------
// Section: Holdings summary
// ---------------------------------------------------------------------------

const SectionHoldings: React.FC<{
  holdings: { count: number; totalBuyKRW: number; totalMarketKRW: number; unrealized: number; rate: number };
}> = ({ holdings }) => {
  if (holdings.count === 0) return null;
  return (
    <section>
      <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 800 }}>보유 종목 요약</h3>
      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          padding: 14,
          borderRadius: 10,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          alignItems: "center",
        }}
      >
        <Stat label="보유 종목" value={`${holdings.count}종목`} />
        <Stat label="매입원가" value={formatKRW(holdings.totalBuyKRW)} />
        <Stat label="평가액" value={formatKRW(holdings.totalMarketKRW)} />
        <Stat
          label="평가손익"
          value={<span style={{ color: pnlColor(holdings.unrealized) }}>{formatSignedKRW(holdings.unrealized)}</span>}
        />
        <Stat
          label="평가손익률"
          value={<span style={{ color: pnlColor(holdings.rate) }}>{formatPct(holdings.rate)}</span>}
        />
        <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
          종목별 상세는 주식 탭에서 확인하세요.
        </span>
      </div>
    </section>
  );
};

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const Th: React.FC<{ children: React.ReactNode; align?: "left" | "right" }> = ({ children, align }) => (
  <th
    style={{
      textAlign: align ?? "left",
      padding: "8px 10px",
      fontSize: 11,
      fontWeight: 700,
      color: "var(--text-muted)",
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </th>
);

const Td: React.FC<{
  children: React.ReactNode;
  align?: "left" | "right";
  color?: string;
}> = ({ children, align, color }) => (
  <td
    style={{
      textAlign: align ?? "left",
      padding: "8px 10px",
      whiteSpace: "nowrap",
      color: color ?? "var(--text)",
    }}
  >
    {children}
  </td>
);

const Stat: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div>
    <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{label}</div>
    <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2 }}>{value}</div>
  </div>
);

const EmptyBlock: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      padding: 24,
      borderRadius: 10,
      background: "var(--surface)",
      border: "1px dashed var(--border)",
      textAlign: "center",
      color: "var(--text-muted)",
      fontSize: 13,
    }}
  >
    {text}
  </div>
);
