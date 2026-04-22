import React, { useMemo, useState } from "react";
import type { Account, LedgerEntry, StockTrade } from "../../types";
import {
  buildClosedTradeRecords,
  filterByPeriod,
  summarizeRecords,
  groupByMonth,
  groupByYear,
  groupByHoldingBucket,
  holdingRange,
  HOLDING_BUCKETS,
  type PeriodFilter,
} from "../../utils/investmentRecord";
import { formatKRW } from "../../utils/formatter";
import { getTodayKST } from "../../utils/date";
import { xirr } from "../../utils/irr";
import { downloadAsExcel } from "../../utils/excelExport";

interface Props {
  trades: StockTrade[];
  accounts: Account[];
  ledger: LedgerEntry[];
  fxRate: number | null;
}

type Tab = "summary" | "year" | "month" | "holding" | "trades";

export const InvestmentRecordCard: React.FC<Props> = ({ trades, accounts, ledger, fxRate }) => {
  const today = useMemo(() => getTodayKST(), []);
  const currentYear = Number(today.slice(0, 4));

  const [filter, setFilter] = useState<PeriodFilter>({ kind: "year", year: currentYear });
  const [tab, setTab] = useState<Tab>("summary");

  const all = useMemo(() => buildClosedTradeRecords(trades, accounts), [trades, accounts]);
  const filtered = useMemo(() => filterByPeriod(all, filter), [all, filter]);
  const summary = useMemo(() => summarizeRecords(filtered), [filtered]);

  const dividendIncome = useMemo(() => {
    let sum = 0;
    const isDividend = (e: LedgerEntry) =>
      (e.category ?? "").includes("배당") ||
      (e.subCategory ?? "").includes("배당") ||
      (e.description ?? "").includes("배당");
    const inPeriod = (dateStr: string | undefined): boolean => {
      if (!dateStr) return false;
      if (filter.kind === "all") return true;
      if (filter.kind === "year") return dateStr.slice(0, 4) === String(filter.year);
      if (filter.kind === "month") {
        const ym = `${filter.year}-${String(filter.month).padStart(2, "0")}`;
        return dateStr.slice(0, 7) === ym;
      }
      return false;
    };
    for (const e of ledger) {
      if (e.kind !== "income") continue;
      if (!isDividend(e)) continue;
      if (!inPeriod(e.date)) continue;
      const krw = e.currency === "USD" && fxRate ? e.amount * fxRate : e.amount;
      sum += krw;
    }
    return sum;
  }, [ledger, filter, fxRate]);

  const totalReturnWithDividend = summary.totalPnl + dividendIncome;

  const periodIrr = useMemo(() => {
    if (filtered.length === 0) return null;
    const flows: { date: string; amount: number }[] = [];
    for (const r of filtered) {
      if (r.costBasisKRW > 0) flows.push({ date: r.buyDateWeighted, amount: -r.costBasisKRW });
      if (r.proceedsKRW > 0) flows.push({ date: r.sellDate, amount: r.proceedsKRW });
    }
    flows.sort((a, b) => a.date.localeCompare(b.date));
    return xirr(flows);
  }, [filtered]);

  const yearGroups = useMemo(() => groupByYear(all), [all]);
  const monthGroups = useMemo(() => groupByMonth(filtered), [filtered]);
  const holdingGroups = useMemo(() => groupByHoldingBucket(filtered), [filtered]);
  const range = useMemo(() => holdingRange(filtered), [filtered]);

  const years = useMemo(() => {
    const s = new Set<number>();
    for (const r of all) s.add(Number(r.sellDate.slice(0, 4)));
    return [...s].sort((a, b) => b - a);
  }, [all]);

  const accountNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.id, a.name || a.id);
    return m;
  }, [accounts]);

  const exportExcel = () => {
    const header = ["종목", "티커", "계좌", "매수일(가중평균)", "매도일", "보유일수", "수량", "원가(KRW)", "매도대금(KRW)", "실현손익(KRW)", "수익률(%)"];
    const rows = filtered.map((r) => [
      r.name,
      r.ticker,
      accountNameById.get(r.accountId) ?? r.accountId,
      r.buyDateWeighted,
      r.sellDate,
      r.holdingDays,
      r.sellQuantity,
      Math.round(r.costBasisKRW),
      Math.round(r.proceedsKRW),
      Math.round(r.realizedPnlKRW),
      Number((r.returnPct * 100).toFixed(2)),
    ]);
    const kpi = [
      ["실현손익", Math.round(summary.totalPnl)],
      ["실현 수익률(%)", Number((summary.returnPct * 100).toFixed(2))],
      ["승률(%)", Math.round(summary.winRate * 100)],
      ["손익비", Number(summary.profitLossRatio.toFixed(2))],
      ["평균 보유(일)", Math.round(summary.avgHoldingDays)],
      ["연환산 IRR(%)", periodIrr != null ? Number((periodIrr * 100).toFixed(2)) : ""],
      ["거래 건수", summary.tradeCount],
    ];
    const stamp = today.replace(/-/g, "");
    downloadAsExcel(`farmwallet-투자기록-${stamp}`, [
      { name: "요약", rows: [["항목", "값"], ...kpi] },
      { name: "확정거래", rows: [header, ...rows] },
    ]);
  };

  const exportCsv = () => {
    const header = ["종목", "티커", "계좌", "매수일", "매도일", "보유일수", "수량", "원가KRW", "매도대금KRW", "실현손익KRW", "수익률%"];
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(",")];
    for (const r of filtered) {
      lines.push([
        r.name, r.ticker, accountNameById.get(r.accountId) ?? r.accountId,
        r.buyDateWeighted, r.sellDate, r.holdingDays, r.sellQuantity,
        Math.round(r.costBasisKRW), Math.round(r.proceedsKRW), Math.round(r.realizedPnlKRW),
        (r.returnPct * 100).toFixed(2),
      ].map(esc).join(","));
    }
    const csv = "﻿" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `farmwallet-투자기록-${today.replace(/-/g, "")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (all.length === 0) {
    return (
      <div className="card" style={{ borderLeft: "4px solid var(--chart-secondary)" }}>
        <div className="card-title">투자 기록</div>
        <div className="hint" style={{ marginTop: 8 }}>아직 확정된 매도 거래가 없습니다.</div>
      </div>
    );
  }

  const pnlColor = (v: number) =>
    v > 0 ? "var(--success)" : v < 0 ? "var(--danger)" : "var(--muted)";

  return (
    <div
      className="card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        borderLeft: "4px solid var(--chart-secondary)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <div className="card-title">투자 기록</div>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>확정 거래 기준 · FIFO</span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <PeriodSelect filter={filter} years={years} onChange={setFilter} />
          <button
            type="button"
            onClick={exportExcel}
            style={{ padding: "4px 10px", fontSize: 11, borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer" }}
          >
            Excel
          </button>
          <button
            type="button"
            onClick={exportCsv}
            style={{ padding: "4px 10px", fontSize: 11, borderRadius: 6, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer" }}
          >
            CSV
          </button>
        </div>
      </div>

      <KpiGrid summary={summary} range={range} periodIrr={periodIrr} dividendIncome={dividendIncome} totalWithDividend={totalReturnWithDividend} />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", borderBottom: "1px solid var(--border)", paddingBottom: 4 }}>
        {([
          ["summary", "요약"],
          ["year", "연도별"],
          ["month", "월별"],
          ["holding", "보유기간"],
          ["trades", "확정 거래"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            style={{
              padding: "4px 10px",
              fontSize: 12,
              fontWeight: 600,
              background: tab === key ? "var(--chart-secondary)" : "transparent",
              color: tab === key ? "#fff" : "var(--text)",
              border: "1px solid " + (tab === key ? "var(--chart-secondary)" : "var(--border)"),
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "summary" && <SummaryPanel summary={summary} pnlColor={pnlColor} />}
      {tab === "year" && <YearPanel yearGroups={yearGroups} pnlColor={pnlColor} />}
      {tab === "month" && <MonthPanel monthGroups={monthGroups} pnlColor={pnlColor} />}
      {tab === "holding" && <HoldingPanel holdingGroups={holdingGroups} range={range} pnlColor={pnlColor} />}
      {tab === "trades" && <TradesPanel records={filtered} accountNameById={accountNameById} pnlColor={pnlColor} />}
    </div>
  );
};

const PeriodSelect: React.FC<{
  filter: PeriodFilter;
  years: number[];
  onChange: (f: PeriodFilter) => void;
}> = ({ filter, years, onChange }) => {
  const value =
    filter.kind === "all"
      ? "all"
      : filter.kind === "year"
        ? `y:${filter.year}`
        : `m:${filter.year}-${String(filter.month).padStart(2, "0")}`;

  const monthOptions: string[] = [];
  for (const y of years) {
    for (let m = 12; m >= 1; m--) {
      monthOptions.push(`${y}-${String(m).padStart(2, "0")}`);
    }
  }

  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "all") onChange({ kind: "all" });
        else if (v.startsWith("y:")) onChange({ kind: "year", year: Number(v.slice(2)) });
        else if (v.startsWith("m:")) {
          const ym = v.slice(2);
          onChange({
            kind: "month",
            year: Number(ym.slice(0, 4)),
            month: Number(ym.slice(5, 7)),
          });
        }
      }}
      style={{
        padding: "4px 8px",
        fontSize: 12,
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--surface)",
        color: "var(--text)",
      }}
    >
      <option value="all">전체</option>
      <optgroup label="연도">
        {years.map((y) => (
          <option key={`y-${y}`} value={`y:${y}`}>{y}년</option>
        ))}
      </optgroup>
      <optgroup label="월별">
        {monthOptions.slice(0, 36).map((ym) => (
          <option key={`m-${ym}`} value={`m:${ym}`}>{ym}</option>
        ))}
      </optgroup>
    </select>
  );
};

const KpiGrid: React.FC<{
  summary: ReturnType<typeof summarizeRecords>;
  range: { min: number; max: number };
  periodIrr: number | null;
  dividendIncome: number;
  totalWithDividend: number;
}> = ({ summary, range, periodIrr, dividendIncome, totalWithDividend }) => {
  const pnlColor = summary.totalPnl > 0 ? "var(--success)" : summary.totalPnl < 0 ? "var(--danger)" : "var(--muted)";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
      <Kpi label="실현손익" value={formatKRW(Math.round(summary.totalPnl))} color={pnlColor} />
      <Kpi
        label="실현 수익률"
        value={`${(summary.returnPct * 100).toFixed(1)}%`}
        color={pnlColor}
      />
      <Kpi
        label="승률"
        value={`${Math.round(summary.winRate * 100)}% (${summary.winCount}/${summary.winCount + summary.lossCount})`}
      />
      <Kpi
        label="손익비"
        value={summary.profitLossRatio > 0 ? summary.profitLossRatio.toFixed(2) : "—"}
      />
      <Kpi
        label="평균 보유"
        value={`${Math.round(summary.avgHoldingDays)}일`}
        sub={range.max > 0 ? `최장 ${range.max}일 · 최단 ${range.min}일` : undefined}
      />
      <Kpi label="거래 건수" value={`${summary.tradeCount}건`} />
      <Kpi
        label="연환산 IRR"
        value={periodIrr != null ? `${(periodIrr * 100).toFixed(1)}%` : "—"}
        color={periodIrr != null ? (periodIrr >= 0 ? "var(--success)" : "var(--danger)") : undefined}
        sub="확정 거래 현금흐름 기준"
      />
      <Kpi
        label="배당 수입"
        value={formatKRW(Math.round(dividendIncome))}
        color={dividendIncome > 0 ? "var(--success)" : undefined}
      />
      <Kpi
        label="배당 포함 총수익"
        value={formatKRW(Math.round(totalWithDividend))}
        color={totalWithDividend > 0 ? "var(--success)" : totalWithDividend < 0 ? "var(--danger)" : undefined}
      />
    </div>
  );
};

const Kpi: React.FC<{ label: string; value: string; color?: string; sub?: string }> = ({ label, value, color, sub }) => (
  <div style={{ padding: "8px 10px", background: "var(--bg-subtle, var(--border))", borderRadius: 6 }}>
    <div style={{ fontSize: 10, color: "var(--muted)" }}>{label}</div>
    <div style={{ fontSize: 15, fontWeight: 700, color: color ?? "var(--text)" }}>{value}</div>
    {sub && <div style={{ fontSize: 10, color: "var(--muted)" }}>{sub}</div>}
  </div>
);

const SummaryPanel: React.FC<{ summary: ReturnType<typeof summarizeRecords>; pnlColor: (v: number) => string }> = ({ summary, pnlColor }) => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, fontSize: 12 }}>
    <Row label="총 투자원금" value={formatKRW(Math.round(summary.totalCost))} />
    <Row label="평균 수익 거래" value={formatKRW(Math.round(summary.avgWin))} color={pnlColor(summary.avgWin)} />
    <Row label="평균 손실 거래" value={formatKRW(Math.round(summary.avgLoss))} color={pnlColor(summary.avgLoss)} />
    <Row label="수익 거래" value={`${summary.winCount}건`} />
    <Row label="손실 거래" value={`${summary.lossCount}건`} />
    <Row label="평균 보유 기간" value={`${Math.round(summary.avgHoldingDays)}일`} />
  </div>
);

const Row: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 8px", borderBottom: "1px dashed var(--border)" }}>
    <span style={{ color: "var(--muted)" }}>{label}</span>
    <span style={{ fontWeight: 600, color: color ?? "var(--text)" }}>{value}</span>
  </div>
);

const YearPanel: React.FC<{ yearGroups: Map<string, ReturnType<typeof summarizeRecords>>; pnlColor: (v: number) => string }> = ({ yearGroups, pnlColor }) => {
  const rows = [...yearGroups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const maxAbs = Math.max(1, ...rows.map(([, s]) => Math.abs(s.totalPnl)));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
      {rows.length === 0 && <div className="hint">데이터 없음</div>}
      {rows.map(([year, s]) => {
        const pct = (Math.abs(s.totalPnl) / maxAbs) * 100;
        return (
          <div key={year} style={{ display: "grid", gridTemplateColumns: "60px 1fr 120px 80px 90px", gap: 8, alignItems: "center" }}>
            <span style={{ fontWeight: 700 }}>{year}</span>
            <div style={{ height: 12, background: "var(--border)", borderRadius: 3, position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  height: "100%",
                  width: `${pct}%`,
                  background: s.totalPnl >= 0 ? "var(--success)" : "var(--danger)",
                  borderRadius: 3,
                }}
              />
            </div>
            <span style={{ fontWeight: 700, textAlign: "right", color: pnlColor(s.totalPnl) }}>{formatKRW(Math.round(s.totalPnl))}</span>
            <span style={{ textAlign: "right", color: "var(--muted)" }}>{s.tradeCount}건</span>
            <span style={{ textAlign: "right", color: "var(--muted)" }}>승률 {Math.round(s.winRate * 100)}%</span>
          </div>
        );
      })}
    </div>
  );
};

const MonthPanel: React.FC<{ monthGroups: Map<string, ReturnType<typeof summarizeRecords>>; pnlColor: (v: number) => string }> = ({ monthGroups, pnlColor }) => {
  const rows = [...monthGroups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
            <th style={{ padding: "4px 6px" }}>연월</th>
            <th style={{ padding: "4px 6px", textAlign: "right" }}>실현손익</th>
            <th style={{ padding: "4px 6px", textAlign: "right" }}>수익률</th>
            <th style={{ padding: "4px 6px", textAlign: "right" }}>거래</th>
            <th style={{ padding: "4px 6px", textAlign: "right" }}>승률</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={5} style={{ padding: 8, color: "var(--muted)" }}>데이터 없음</td></tr>
          )}
          {rows.map(([ym, s]) => (
            <tr key={ym} style={{ borderBottom: "1px dashed var(--border)" }}>
              <td style={{ padding: "4px 6px", fontWeight: 600 }}>{ym}</td>
              <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: 700, color: pnlColor(s.totalPnl) }}>{formatKRW(Math.round(s.totalPnl))}</td>
              <td style={{ padding: "4px 6px", textAlign: "right", color: pnlColor(s.totalPnl) }}>{(s.returnPct * 100).toFixed(1)}%</td>
              <td style={{ padding: "4px 6px", textAlign: "right" }}>{s.tradeCount}</td>
              <td style={{ padding: "4px 6px", textAlign: "right" }}>{Math.round(s.winRate * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const HoldingPanel: React.FC<{
  holdingGroups: Map<string, ReturnType<typeof summarizeRecords>>;
  range: { min: number; max: number };
  pnlColor: (v: number) => string;
}> = ({ holdingGroups, range, pnlColor }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
    <div style={{ fontSize: 11, color: "var(--muted)" }}>
      최장 {range.max}일 · 최단 {range.min}일
    </div>
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
            <th style={{ padding: "4px 6px" }}>보유기간</th>
            <th style={{ padding: "4px 6px", textAlign: "right" }}>거래</th>
            <th style={{ padding: "4px 6px", textAlign: "right" }}>승률</th>
            <th style={{ padding: "4px 6px", textAlign: "right" }}>평균 수익률</th>
            <th style={{ padding: "4px 6px", textAlign: "right" }}>합계 실현손익</th>
          </tr>
        </thead>
        <tbody>
          {HOLDING_BUCKETS.map((b) => {
            const s = holdingGroups.get(b);
            if (!s) return null;
            return (
              <tr key={b} style={{ borderBottom: "1px dashed var(--border)" }}>
                <td style={{ padding: "4px 6px", fontWeight: 600 }}>{b}</td>
                <td style={{ padding: "4px 6px", textAlign: "right" }}>{s.tradeCount}</td>
                <td style={{ padding: "4px 6px", textAlign: "right" }}>{Math.round(s.winRate * 100)}%</td>
                <td style={{ padding: "4px 6px", textAlign: "right", color: pnlColor(s.totalPnl) }}>{(s.returnPct * 100).toFixed(1)}%</td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: 700, color: pnlColor(s.totalPnl) }}>{formatKRW(Math.round(s.totalPnl))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  </div>
);

const TradesPanel: React.FC<{
  records: ReturnType<typeof buildClosedTradeRecords>;
  accountNameById: Map<string, string>;
  pnlColor: (v: number) => string;
}> = ({ records, accountNameById, pnlColor }) => (
  <div style={{ overflowX: "auto", maxHeight: 320, overflowY: "auto" }}>
    <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
      <thead style={{ position: "sticky", top: 0, background: "var(--surface)" }}>
        <tr style={{ textAlign: "left", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
          <th style={{ padding: "4px 6px" }}>종목</th>
          <th style={{ padding: "4px 6px" }}>계좌</th>
          <th style={{ padding: "4px 6px" }}>매수일</th>
          <th style={{ padding: "4px 6px" }}>매도일</th>
          <th style={{ padding: "4px 6px", textAlign: "right" }}>보유</th>
          <th style={{ padding: "4px 6px", textAlign: "right" }}>원가</th>
          <th style={{ padding: "4px 6px", textAlign: "right" }}>손익</th>
          <th style={{ padding: "4px 6px", textAlign: "right" }}>수익률</th>
        </tr>
      </thead>
      <tbody>
        {records.length === 0 && (
          <tr><td colSpan={8} style={{ padding: 8, color: "var(--muted)" }}>거래 없음</td></tr>
        )}
        {records.map((r) => (
          <tr key={r.tradeId} style={{ borderBottom: "1px dashed var(--border)" }}>
            <td style={{ padding: "3px 6px", fontWeight: 600 }}>{r.name || r.ticker}{r.isUsd && <span style={{ marginLeft: 4, fontSize: 9, color: "var(--muted)" }}>USD</span>}</td>
            <td style={{ padding: "3px 6px", color: "var(--muted)" }}>{accountNameById.get(r.accountId) ?? "-"}</td>
            <td style={{ padding: "3px 6px" }}>{r.buyDateWeighted}</td>
            <td style={{ padding: "3px 6px" }}>{r.sellDate}</td>
            <td style={{ padding: "3px 6px", textAlign: "right" }}>{r.holdingDays}일</td>
            <td style={{ padding: "3px 6px", textAlign: "right" }}>{formatKRW(Math.round(r.costBasisKRW))}</td>
            <td style={{ padding: "3px 6px", textAlign: "right", fontWeight: 700, color: pnlColor(r.realizedPnlKRW) }}>{formatKRW(Math.round(r.realizedPnlKRW))}</td>
            <td style={{ padding: "3px 6px", textAlign: "right", color: pnlColor(r.realizedPnlKRW) }}>{(r.returnPct * 100).toFixed(1)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
