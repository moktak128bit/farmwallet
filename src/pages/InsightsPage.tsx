import React, { useMemo, useState } from "react";
import type { Account, LedgerEntry, StockTrade, StockPrice, CategoryPresets, BudgetGoal } from "../types";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area, ComposedChart,
} from "recharts";

/* ================================================================== */
/*  Constants                                                          */
/* ================================================================== */

const WDN = ["월", "화", "수", "목", "금", "토", "일"];
const C = ["#e94560", "#0f3460", "#f0c040", "#533483", "#48c9b0", "#f39c12", "#3498db", "#e74c3c", "#2ecc71", "#9b59b6", "#1abc9c", "#d35400"];

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "overview", label: "종합 대시보드", icon: "📊" },
  { id: "expense", label: "지출 분석", icon: "💸" },
  { id: "income", label: "수입 구조", icon: "💰" },
  { id: "date", label: "데이트 분석", icon: "💕" },
  { id: "invest", label: "투자 포트폴리오", icon: "📈" },
  { id: "sub", label: "구독 관리", icon: "🔄" },
  { id: "pattern", label: "소비 패턴", icon: "🔍" },
  { id: "velocity", label: "지출 속도", icon: "⚡" },
];
type TabId = "overview" | "expense" | "income" | "date" | "invest" | "sub" | "pattern" | "velocity";

/* ================================================================== */
/*  Formatters                                                         */
/* ================================================================== */

const F = (n: number): string => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10000000) return sign + (abs / 10000000).toFixed(1) + "천만";
  if (abs >= 10000) return sign + Math.round(abs / 10000).toLocaleString() + "만";
  return n.toLocaleString();
};
const W = (n: number) => n.toLocaleString() + "원";
const Pct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(1) + "%";

/* ================================================================== */
/*  Shared UI                                                          */
/* ================================================================== */

function Card({ title, children, span = 1, accent = false }: {
  title?: string; children: React.ReactNode; span?: number; accent?: boolean;
}) {
  return (
    <div style={{
      background: accent ? "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)" : "#fff",
      borderRadius: 16, padding: "20px 24px",
      gridColumn: span > 1 ? `span ${span}` : undefined,
      boxShadow: accent ? "0 8px 32px rgba(233,69,96,0.15)" : "0 2px 12px rgba(0,0,0,0.06)",
      border: accent ? "1px solid rgba(233,69,96,0.3)" : "1px solid #f0f0f0",
      color: accent ? "#fff" : "#1a1a2e",
    }}>
      {title && <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: 1.5, marginBottom: 16, color: accent ? "rgba(255,255,255,0.6)" : "#999" }}>{title}</div>}
      {children}
    </div>
  );
}

function Kpi({ label, value, sub, badge, color = "#e94560" }: {
  label: string; value: string; sub?: string; badge?: string; color?: string;
}) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 11, color: "#999", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{sub}</div>}
      {badge && <div style={{ fontSize: 11, marginTop: 4, display: "inline-block", padding: "2px 8px", borderRadius: 4, background: badge.startsWith("-") ? "rgba(72,201,176,0.15)" : "rgba(233,69,96,0.15)", color: badge.startsWith("-") ? "#48c9b0" : "#e94560", fontWeight: 700 }}>{badge}</div>}
    </div>
  );
}

function Insight({ title, color, bg, children }: { title: string; color: string; bg: string; children: React.ReactNode }) {
  return (
    <div style={{ background: bg, padding: 14, borderRadius: 10, fontSize: 13, lineHeight: 1.7 }}>
      <div style={{ fontWeight: 700, color, marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const pieLabel = ({ name, percent }: any) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`;
function CT({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#1a1a2e", border: "1px solid #333", borderRadius: 10, padding: "10px 14px", color: "#fff", fontSize: 12, maxWidth: 280 }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: "#f0c040" }}>{label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <div style={{ width: 8, height: 8, borderRadius: 4, background: p.color, flexShrink: 0 }} />
          <span style={{ color: "#aaa" }}>{p.name}:</span>
          <span style={{ fontWeight: 600 }}>{W(Math.round(p.value))}</span>
        </div>
      ))}
    </div>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ================================================================== */
/*  InsightData type                                                   */
/* ================================================================== */

interface D {
  months: string[];
  ml: Record<string, string>;
  selMonth: string | null;
  txCount: number;

  /* ---- trend (always full period) ---- */
  monthly: Record<string, { income: number; expense: number; investment: number }>;
  savRateTrend: { l: string; rate: number; sav: number }[];
  salaryTrend: { l: string; salary: number; nonSalary: number }[];
  cumIE: { l: string; 누적수입: number; 누적지출: number }[];
  investTrend: { l: string; amount: number }[];
  divTrend: { l: string; amount: number }[];
  tradeCntTrend: { l: string; count: number }[];
  subTrend: { l: string; amount: number }[];
  txCntTrend: { l: string; count: number }[];
  cumSpend: Record<string, number[]>;
  monthlyCatTrend: Record<string, Record<string, number>>;
  dateExpMonthly: Record<string, number>;

  /* ---- period (filtered) ---- */
  pIncome: number;
  pExpense: number;
  pInvest: number;
  pSavRate: number;
  expByCat: [string, number][];
  expBySub: { cat: string; sub: string; amount: number; count: number }[];
  topCats: string[];
  acctUsage: { name: string; count: number; total: number }[];
  wdSpend: { total: number; count: number }[];
  dateTop: [string, number][];
  dateSubCats: [string, number][];
  dateEntries: { date: string; desc: string; sub: string; amount: number }[];
  dateTxCount: number;
  incByCat: [string, number][];
  trades: { name: string; buyCount: number; sellCount: number; buyTotal: number; sellTotal: number }[];
  subs: { name: string; count: number; total: number; avg: number }[];
  largeExp: { date: string; desc: string; sub: string; amount: number }[];
  topTx: { date: string; desc: string; cat: string; sub: string; amount: number }[];
  expBySubCat: { cat: string; sub: string; amount: number; count: number }[];
  expByDesc: { desc: string; cat: string; sub: string; amount: number }[];
  dateMoim: number;
  datePersonal: number;
  spendByDOM: number[];
  portfolio: { name: string; value: number }[];
  realPL: { total: number; wins: number; losses: number; winCnt: number; lossCnt: number };
  zeroDays: number;
  totalDays: number;
  weekendTot: number;
  weekdayTot: number;
  topDates: { date: string; total: number; items: { desc: string; amount: number }[] }[];
  score: { total: number; grade: string; comment: string };
  prev: { income: number; expense: number } | null;
  avgMonthExp: number;
}

/* ================================================================== */
/*  Data computation hook                                              */
/* ================================================================== */

function useD(ledger: LedgerEntry[], rawTrades: StockTrade[], accounts: Account[], selMonth: string | null): D {
  return useMemo(() => {
    const aMap = new Map(accounts.map(a => [a.id, a.name]));
    const invIds = new Set(accounts.filter(a => a.type === "securities" || a.type === "crypto").map(a => a.id));
    const moimIds = new Set(accounts.filter(a => a.name.includes("모임")).map(a => a.id));

    /* ===== monthly (full period) ===== */
    const monthly: Record<string, { income: number; expense: number; investment: number }> = {};
    const em = (m: string) => { if (!monthly[m]) monthly[m] = { income: 0, expense: 0, investment: 0 }; };
    for (const l of ledger) {
      const m = l.date?.slice(0, 7); if (!m) continue; em(m);
      const a = Number(l.amount); if (a <= 0) continue;
      if (l.kind === "income") monthly[m].income += a;
      else if (l.kind === "expense") { if (l.category === "재테크") monthly[m].investment += a; else monthly[m].expense += a; }
      else if (l.kind === "transfer" && l.toAccountId && invIds.has(l.toAccountId)) monthly[m].investment += a;
    }
    const months = Object.keys(monthly).sort();
    const ml: Record<string, string> = {};
    months.forEach(m => { ml[m] = parseInt(m.slice(5)) + "월"; });

    /* ===== filter for period ===== */
    const fL = selMonth ? ledger.filter(l => l.date?.startsWith(selMonth)) : ledger;
    const fT = selMonth ? rawTrades.filter(t => t.date?.startsWith(selMonth)) : rawTrades;
    const fExp = fL.filter(l => l.kind === "expense" && Number(l.amount) > 0 && l.category !== "재테크" && l.category !== "환전");
    const fInc = fL.filter(l => l.kind === "income" && Number(l.amount) > 0);

    /* period totals */
    const pIncome = fInc.reduce((s, l) => s + Number(l.amount), 0);
    const pExpense = fExp.reduce((s, l) => s + Number(l.amount), 0);
    let pInvest = 0;
    for (const l of fL) {
      if (l.kind === "expense" && l.category === "재테크") pInvest += Number(l.amount);
      else if (l.kind === "transfer" && l.toAccountId && invIds.has(l.toAccountId)) pInvest += Number(l.amount);
    }
    const pSavRate = pIncome > 0 ? (pIncome - pExpense) / pIncome * 100 : 0;

    /* ===== expenseByCategory (대분류) ===== */
    const catM = new Map<string, number>();
    for (const l of fExp) { const c = l.category || "기타"; catM.set(c, (catM.get(c) ?? 0) + Number(l.amount)); }
    const expByCat = Array.from(catM.entries()).sort((a, b) => b[1] - a[1]);
    const topCats = expByCat.slice(0, 6).map(([c]) => c);

    /* ===== expenseBySubCategory (중분류) ===== */
    const subM = new Map<string, { cat: string; sub: string; amount: number; count: number }>();
    for (const l of fExp) {
      const cat = l.category || "기타";
      const sub = l.subCategory || l.category || "기타";
      const key = sub;
      const prev = subM.get(key) ?? { cat, sub, amount: 0, count: 0 };
      subM.set(key, { cat: prev.cat, sub, amount: prev.amount + Number(l.amount), count: prev.count + 1 });
    }
    const expBySub = Array.from(subM.values()).sort((a, b) => b.amount - a.amount);

    /* monthlyCategoryTrend (full) */
    const monthlyCatTrend: Record<string, Record<string, number>> = {};
    for (const l of ledger) {
      if (l.kind !== "expense" || Number(l.amount) <= 0 || l.category === "재테크" || l.category === "환전") continue;
      const m = l.date?.slice(0, 7); if (!m) continue;
      const c = l.category || "기타"; if (!topCats.includes(c)) continue;
      if (!monthlyCatTrend[m]) monthlyCatTrend[m] = {};
      monthlyCatTrend[m][c] = (monthlyCatTrend[m][c] ?? 0) + Number(l.amount);
    }

    /* accountUsage */
    const auM = new Map<string, { count: number; total: number }>();
    for (const l of fExp) {
      if (!l.fromAccountId) continue;
      const n = aMap.get(l.fromAccountId) || l.fromAccountId;
      const p = auM.get(n) ?? { count: 0, total: 0 };
      auM.set(n, { count: p.count + 1, total: p.total + Number(l.amount) });
    }
    const acctUsage = Array.from(auM.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total);

    /* subcategory breakdown */
    const scM = new Map<string, { cat: string; sub: string; amount: number; count: number }>();
    for (const l of fExp) {
      const cat = l.category || "기타";
      const sub = l.subCategory || l.description || "기타";
      const key = `${cat}__${sub}`;
      const prev = scM.get(key) ?? { cat, sub, amount: 0, count: 0 };
      scM.set(key, { cat, sub, amount: prev.amount + Number(l.amount), count: prev.count + 1 });
    }
    const expBySubCat = Array.from(scM.values()).sort((a, b) => b.amount - a.amount);

    /* description breakdown (top spending items) */
    const descM = new Map<string, { desc: string; cat: string; sub: string; amount: number }>();
    for (const l of fExp) {
      const desc = l.description || l.subCategory || "기타";
      const key = desc;
      const prev = descM.get(key) ?? { desc, cat: l.category || "기타", sub: l.subCategory || "", amount: 0 };
      descM.set(key, { ...prev, amount: prev.amount + Number(l.amount) });
    }
    const expByDesc = Array.from(descM.values()).sort((a, b) => b.amount - a.amount).slice(0, 30);

    /* weekdaySpending */
    const wdSpend: { total: number; count: number }[] = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
    for (const l of fExp) {
      if (!l.date) continue;
      const js = new Date(l.date).getDay();
      const idx = js === 0 ? 6 : js - 1;
      wdSpend[idx].total += Number(l.amount); wdSpend[idx].count++;
    }

    /* dateExpense — category 또는 subCategory에 "데이트" 포함 시 매칭 */
    const isDateEntry = (l: LedgerEntry) => {
      if (l.kind !== "expense") return false;
      const cat = (l.category || "").trim();
      const sub = (l.subCategory || "").trim();
      return cat.includes("데이트") || sub.includes("데이트") || cat === "데이트비" || sub === "데이트비";
    };
    const dateExpMonthly: Record<string, number> = {};
    const dateDescM = new Map<string, number>();
    const dateSubCatM = new Map<string, number>();
    const dateEntries: { date: string; desc: string; sub: string; amount: number }[] = [];
    let dateMoim = 0, datePersonal = 0;
    for (const l of fL) {
      if (!isDateEntry(l)) continue;
      const a = Number(l.amount); const m = l.date?.slice(0, 7);
      if (m) dateExpMonthly[m] = (dateExpMonthly[m] ?? 0) + a;
      const desc = l.description || l.subCategory || "기타";
      dateDescM.set(desc, (dateDescM.get(desc) ?? 0) + a);
      const sub = l.subCategory || l.description || "기타";
      dateSubCatM.set(sub, (dateSubCatM.get(sub) ?? 0) + a);
      if (l.fromAccountId && moimIds.has(l.fromAccountId)) dateMoim += a; else datePersonal += a;
      dateEntries.push({ date: l.date, desc: l.description || "", sub: l.subCategory || l.category || "", amount: a });
    }
    dateEntries.sort((a, b) => b.amount - a.amount);
    const dateTxCount = dateEntries.length;
    // full period dateExpMonthly (always)
    if (selMonth) {
      for (const l of ledger) {
        if (!isDateEntry(l)) continue;
        const m = l.date?.slice(0, 7); if (!m || dateExpMonthly[m] !== undefined) continue;
        dateExpMonthly[m] = 0;
      }
      for (const l of ledger) {
        if (!isDateEntry(l)) continue;
        const m = l.date?.slice(0, 7); if (!m) continue;
        if (selMonth && m === selMonth) continue;
        dateExpMonthly[m] = (dateExpMonthly[m] ?? 0) + Number(l.amount);
      }
    }

    const dateTop = Array.from(dateDescM.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);
    const dateSubCats = Array.from(dateSubCatM.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);

    /* incomeByCategory */
    const icM = new Map<string, number>();
    for (const l of fInc) { const c = l.subCategory || l.category || "기타"; icM.set(c, (icM.get(c) ?? 0) + Number(l.amount)); }
    const incByCat = Array.from(icM.entries()).sort((a, b) => b[1] - a[1]);

    /* tradeSummary */
    const tM = new Map<string, { buyCount: number; sellCount: number; buyTotal: number; sellTotal: number }>();
    for (const t of fT) {
      const n = t.name || t.ticker;
      if (!tM.has(n)) tM.set(n, { buyCount: 0, sellCount: 0, buyTotal: 0, sellTotal: 0 });
      const e = tM.get(n)!;
      const kr = t.fxRateAtTrade ? t.totalAmount * t.fxRateAtTrade : t.totalAmount;
      if (t.side === "buy") { e.buyCount += t.quantity; e.buyTotal += kr; }
      else { e.sellCount += t.quantity; e.sellTotal += kr; }
    }
    const trades = Array.from(tM.entries()).map(([name, v]) => ({ name, ...v })).filter(v => v.buyTotal > 10000).sort((a, b) => b.buyTotal - a.buyTotal);

    /* subscriptions — category 또는 subCategory에 "구독" 포함 */
    const isSubEntry = (l: LedgerEntry) => {
      if (l.kind !== "expense") return false;
      const cat = (l.category || "").trim();
      const sub = (l.subCategory || "").trim();
      return cat.includes("구독") || sub.includes("구독");
    };
    const sM = new Map<string, { count: number; total: number }>();
    for (const l of fL) {
      if (!isSubEntry(l)) continue;
      const n = l.description || l.subCategory || l.category || ""; if (!n) continue;
      const p = sM.get(n) ?? { count: 0, total: 0 };
      sM.set(n, { count: p.count + 1, total: p.total + Number(l.amount) });
    }
    const subs = Array.from(sM.entries()).map(([name, v]) => ({ name, ...v, avg: v.count > 0 ? Math.round(v.total / v.count) : 0 })).filter(s => s.name).sort((a, b) => b.total - a.total);

    /* largeExpenses */
    const largeExp = fExp.filter(l => Number(l.amount) >= 100000).sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 20)
      .map(l => ({ date: l.date, desc: l.description || "", sub: l.subCategory || l.category || "", amount: Number(l.amount) }));

    /* topTransactions (top 10) */
    const topTx = [...fExp].sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 10)
      .map(l => ({ date: l.date, desc: l.description || "", cat: l.category || "", sub: l.subCategory || "", amount: Number(l.amount) }));

    /* spendingByDayOfMonth */
    const spendByDOM = new Array(31).fill(0);
    for (const l of fExp) { const d = parseInt(l.date?.slice(8, 10) || "0") - 1; if (d >= 0 && d < 31) spendByDOM[d] += Number(l.amount); }

    /* ===== trend data (full period) ===== */
    const savRateTrend = months.map(m => {
      const i = monthly[m].income, e = monthly[m].expense;
      return { l: ml[m], rate: i > 0 ? (i - e) / i * 100 : 0, sav: i - e };
    });
    const salaryTrend = months.map(m => {
      let sal = 0, non = 0;
      for (const l of ledger) {
        if (l.kind !== "income" || l.date?.slice(0, 7) !== m || Number(l.amount) <= 0) continue;
        if (["급여", "상여", "수당"].includes(l.subCategory || "")) sal += Number(l.amount); else non += Number(l.amount);
      }
      return { l: ml[m], salary: sal, nonSalary: non };
    });
    let ci = 0, ce = 0;
    const cumIE = months.map(m => { ci += monthly[m].income; ce += monthly[m].expense; return { l: ml[m], 누적수입: ci, 누적지출: ce }; });
    const investTrend = months.map(m => ({ l: ml[m], amount: monthly[m].investment }));
    const divTrend = months.map(m => {
      let d = 0;
      for (const l of ledger) { if (l.kind !== "income" || l.date?.slice(0, 7) !== m) continue; if (["배당", "이자", "분배금"].includes(l.subCategory || "")) d += Number(l.amount); }
      return { l: ml[m], amount: d };
    });
    const tradeCntTrend = months.map(m => ({ l: ml[m], count: rawTrades.filter(t => t.date?.slice(0, 7) === m).length }));
    const subTrend = months.map(m => {
      let a = 0; for (const l of ledger) { if (l.date?.slice(0, 7) !== m || !isSubEntry(l)) continue; a += Number(l.amount); }
      return { l: ml[m], amount: a };
    });
    const txCntTrend = months.map(m => ({ l: ml[m], count: ledger.filter(l => l.date?.slice(0, 7) === m).length }));

    /* cumulativeSpending (full) */
    const cumSpend: Record<string, number[]> = {};
    for (const m of months) {
      const [y, mo] = m.split("-").map(Number); const dim = new Date(y, mo, 0).getDate();
      const daily = new Array(31).fill(0);
      for (const l of ledger) {
        if (l.kind !== "expense" || l.category === "재테크" || l.category === "환전" || l.date?.slice(0, 7) !== m) continue;
        const d = parseInt(l.date.slice(8, 10)) - 1; if (d >= 0 && d < 31) daily[d] += Number(l.amount);
      }
      const cum: number[] = []; let r = 0;
      for (let d = 0; d < 31; d++) { if (d < dim) r += daily[d]; cum.push(r); }
      cumSpend[m] = cum;
    }

    /* portfolio allocation */
    const pM = new Map<string, number>();
    for (const t of trades) {
      if (t.buyCount - t.sellCount <= 0) continue;
      const n = t.name.toLowerCase();
      let tp = "개별주식";
      if (/tiger|kodex|rise|sol |1q |ace |kbstar|hanaro/i.test(n)) tp = "ETF";
      else if (/solana|ethereum|bitcoin|sol$|eth$|btc$/i.test(n)) tp = "암호화폐";
      pM.set(tp, (pM.get(tp) ?? 0) + t.buyTotal);
    }
    const portfolio = Array.from(pM.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

    /* realized PL */
    let plTot = 0, plWin = 0, plLoss = 0, plWC = 0, plLC = 0;
    for (const t of trades) {
      if (t.sellCount === 0) continue;
      const avg = t.buyTotal / Math.max(t.buyCount, 1);
      const pl = t.sellTotal - avg * t.sellCount;
      plTot += pl; if (pl >= 0) { plWin += pl; plWC++; } else { plLoss += Math.abs(pl); plLC++; }
    }

    /* zero spend days */
    let zeroDays = 0, totalDays = 0;
    const spendSet = new Set(fExp.map(l => l.date));
    const msCheck = selMonth ? [selMonth] : months;
    for (const m of msCheck) {
      const [y, mo] = m.split("-").map(Number); const dim = new Date(y, mo, 0).getDate();
      const now = new Date(); const isCur = now.getFullYear() === y && now.getMonth() + 1 === mo;
      const md = isCur ? now.getDate() : dim;
      for (let d = 1; d <= md; d++) { totalDays++; if (!spendSet.has(`${m}-${String(d).padStart(2, "0")}`)) zeroDays++; }
    }

    /* weekend vs weekday */
    let weekendTot = 0, weekdayTot = 0;
    for (const l of fExp) { const d = new Date(l.date).getDay(); if (d === 0 || d === 6) weekendTot += Number(l.amount); else weekdayTot += Number(l.amount); }

    /* top spend dates */
    const tdM = new Map<string, { total: number; items: { desc: string; amount: number }[] }>();
    for (const l of fExp) {
      if (!tdM.has(l.date)) tdM.set(l.date, { total: 0, items: [] });
      const e = tdM.get(l.date)!; e.total += Number(l.amount); e.items.push({ desc: l.description || l.category || "기타", amount: Number(l.amount) });
    }
    const topDates = Array.from(tdM.entries()).map(([date, v]) => ({ date, ...v })).sort((a, b) => b.total - a.total).slice(0, 5);

    /* financial score */
    let scorePts = 0;
    const sr = pSavRate;
    if (sr >= 50) scorePts += 40; else if (sr >= 30) scorePts += 30; else if (sr >= 20) scorePts += 20; else if (sr >= 10) scorePts += 10;
    if (zeroDays > totalDays * 0.2) scorePts += 20; else if (zeroDays > totalDays * 0.1) scorePts += 10;
    if (pInvest > 0) scorePts += 20; else scorePts += 5;
    const incDiv = incByCat.length;
    if (incDiv >= 5) scorePts += 20; else if (incDiv >= 3) scorePts += 15; else if (incDiv >= 2) scorePts += 10; else scorePts += 5;
    const grade = scorePts >= 90 ? "A+" : scorePts >= 80 ? "A" : scorePts >= 70 ? "B+" : scorePts >= 60 ? "B" : scorePts >= 50 ? "C+" : scorePts >= 40 ? "C" : "D";
    const comments: Record<string, string> = { "A+": "완벽한 재무 습관!", A: "훌륭하게 관리 중!", "B+": "꽤 건강한 재무 상태!", B: "나쁘지 않아요!", "C+": "개선의 여지가 있어요.", C: "소비 조절이 필요해요.", D: "재무 점검이 필요해요!" };

    /* prev month */
    let prev: { income: number; expense: number } | null = null;
    if (selMonth) {
      const [y, m] = selMonth.split("-").map(Number); const pd = new Date(y, m - 2, 1);
      const pm = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, "0")}`;
      let pi = 0, pe = 0;
      for (const l of ledger) {
        if (l.date?.slice(0, 7) !== pm) continue;
        if (l.kind === "income") pi += Number(l.amount);
        if (l.kind === "expense" && l.category !== "재테크" && l.category !== "환전") pe += Number(l.amount);
      }
      if (pi > 0 || pe > 0) prev = { income: pi, expense: pe };
    }

    const fullMonths = Math.max(months.length - 1, 1);
    const avgMonthExp = months.reduce((s, m) => s + monthly[m].expense, 0) / fullMonths;

    return {
      months, ml, selMonth, txCount: fL.length,
      monthly, savRateTrend, salaryTrend, cumIE, investTrend, divTrend, tradeCntTrend, subTrend, txCntTrend, cumSpend, monthlyCatTrend, dateExpMonthly,
      pIncome, pExpense, pInvest, pSavRate, expByCat, expBySub, topCats, acctUsage, wdSpend, dateTop, dateSubCats, dateEntries, dateTxCount, incByCat, trades, subs, largeExp, topTx, expBySubCat, expByDesc, dateMoim, datePersonal, spendByDOM, portfolio, realPL: { total: plTot, wins: plWin, losses: plLoss, winCnt: plWC, lossCnt: plLC },
      zeroDays, totalDays, weekendTot, weekdayTot, topDates,
      score: { total: scorePts, grade, comment: comments[grade] || "" }, prev, avgMonthExp,
    };
  }, [ledger, rawTrades, accounts, selMonth]);
}

/* ================================================================== */
/*  Tab: 종합 대시보드                                                  */
/* ================================================================== */

function OverviewTab({ d }: { d: D }) {
  const totals = d.months.reduce((a, m) => { a.i += d.monthly[m].income; a.e += d.monthly[m].expense; a.v += d.monthly[m].investment; return a; }, { i: 0, e: 0, v: 0 });
  const barData = d.months.map(m => ({ name: d.ml[m], 수입: d.monthly[m].income, 지출: d.monthly[m].expense, 투자: d.monthly[m].investment }));
  const flowData = d.months.slice(0, -1).map(m => ({ name: d.ml[m], 순현금흐름: d.monthly[m].income - d.monthly[m].expense - d.monthly[m].investment }));
  const expBadge = d.prev ? Pct((d.pExpense - d.prev.expense) / Math.max(d.prev.expense, 1) * 100) + " vs 전월" : undefined;
  const incBadge = d.prev ? Pct((d.pIncome - d.prev.income) / Math.max(d.prev.income, 1) * 100) + " vs 전월" : undefined;
  const top3Sub = d.expBySub.filter(s => s.sub !== "신용결제" && s.cat !== "신용결제").slice(0, 3);
  const top3pct = d.pExpense > 0 ? Math.round(top3Sub.reduce((s, x) => s + x.amount, 0) / d.pExpense * 100) : 0;
  const pieData = [{ name: "수입", value: d.pIncome }, { name: "지출", value: d.pExpense }, { name: "투자", value: d.pInvest }].filter(x => x.value > 0);
  const pieCols = ["#f0c040", "#e94560", "#48c9b0"];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
      <Card accent><Kpi label="총 수입" value={F(d.pIncome)} badge={incBadge} color="#f0c040" /></Card>
      <Card accent><Kpi label="총 지출" value={F(d.pExpense)} badge={expBadge} color="#e94560" /></Card>
      <Card accent><Kpi label="총 투자" value={F(d.pInvest)} color="#48c9b0" /></Card>
      <Card accent><Kpi label="저축률" value={d.pSavRate.toFixed(1) + "%"} sub={`월평균 지출 ${F(Math.round(d.avgMonthExp))}`} color="#fff" /></Card>

      <Card title="월별 수입 · 지출 · 투자 추이" span={4}>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={barData}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="수입" fill="#f0c040" radius={[4, 4, 0, 0]} /><Bar dataKey="지출" fill="#e94560" radius={[4, 4, 0, 0]} /><Bar dataKey="투자" fill="#48c9b0" radius={[4, 4, 0, 0]} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      <Card title="순 현금흐름 (수입 - 지출 - 투자)" span={2}>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={flowData}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} />
            <defs><linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#e94560" stopOpacity={0.3} /><stop offset="95%" stopColor="#e94560" stopOpacity={0} /></linearGradient></defs>
            <Area dataKey="순현금흐름" stroke="#e94560" fill="url(#fg)" strokeWidth={2.5} />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      <Card title="월별 저축률 추이" span={2}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={d.savRateTrend}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="l" tick={{ fontSize: 12 }} /><YAxis tickFormatter={(v: number) => v + "%"} tick={{ fontSize: 11 }} /><Tooltip formatter={(v: any) => v.toFixed(1) + "%"} />
            <Bar dataKey="rate" name="저축률" radius={[4, 4, 0, 0]}>
              {d.savRateTrend.map((e, i) => <Cell key={i} fill={e.rate >= 30 ? "#48c9b0" : e.rate >= 0 ? "#f0c040" : "#e94560"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="재무 건강 점수" span={1}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "10px 0" }}>
          <div style={{ position: "relative", width: 120, height: 120, borderRadius: "50%", background: `conic-gradient(${d.score.total >= 70 ? "#48c9b0" : d.score.total >= 40 ? "#f0c040" : "#e94560"} ${d.score.total * 3.6}deg, #f0f0f0 ${d.score.total * 3.6}deg)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 96, height: 96, borderRadius: "50%", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 28, fontWeight: 800 }}>{d.score.total}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#e94560" }}>{d.score.grade}</span>
            </div>
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, textAlign: "center" }}>{d.score.comment}</span>
        </div>
      </Card>

      <Card title="수입 · 지출 · 투자 비중" span={1}>
        <ResponsiveContainer width="100%" height={180}>
          <PieChart><Pie data={pieData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={35} label={pieLabel} labelLine={false} style={{ fontSize: 10 }}>
            {pieData.map((_, i) => <Cell key={i} fill={pieCols[i]} />)}
          </Pie><Tooltip formatter={(v: any) => W(v)} /></PieChart>
        </ResponsiveContainer>
      </Card>

      <Card title="상위 지출 (중분류)" span={1}>
        <div style={{ fontSize: 13 }}>
          {top3Sub.map((s, i) => (
            <div key={s.sub} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f5f5f5" }}>
              <span><span style={{ color: C[i], fontWeight: 800, marginRight: 6 }}>{i + 1}</span>{s.sub} <span style={{ fontSize: 10, color: "#bbb" }}>{s.cat}</span></span>
              <span style={{ fontWeight: 700 }}>{F(s.amount)}</span>
            </div>
          ))}
          {d.pExpense > 0 && <div style={{ fontSize: 11, color: "#999", marginTop: 8 }}>상위 3개가 전체의 {top3pct}%</div>}
        </div>
      </Card>

      <Card title="월별 거래 건수" span={1}>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={d.txCntTrend}><XAxis dataKey="l" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip />
            <Bar dataKey="count" fill="#533483" radius={[4, 4, 0, 0]} name="건수" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="누적 수입 vs 누적 지출" span={4}>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={d.cumIE}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="l" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="누적수입" stroke="#f0c040" strokeWidth={2.5} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="누적지출" stroke="#e94560" strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card title="종합 인사이트" span={4}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
          <Insight title="저축률" color="#059669" bg="#d4edda">
            {d.pSavRate >= 30 ? `${d.pSavRate.toFixed(0)}%로 건강한 수준!` : d.pSavRate >= 0 ? `${d.pSavRate.toFixed(0)}% — 30% 이상 목표로.` : `마이너스 저축률! 지출 점검 필요.`}
          </Insight>
          <Insight title="지출 집중도" color="#b45309" bg="#fff3cd">상위 3개 중분류({top3Sub.map(s => s.sub).join(", ")})가 {top3pct}%. {top3pct > 70 ? "집중도가 높아요." : "골고루 분산되어 있어요."}</Insight>
          <Insight title="투자 비율" color="#2563eb" bg="#cce5ff">{d.pIncome > 0 ? `수입 대비 투자 ${Math.round(d.pInvest / d.pIncome * 100)}%. ` : ""}{d.pInvest > 0 ? "꾸준히 투자 중!" : "투자 활동이 없어요."}</Insight>
          <Insight title="무지출일" color="#7c3aed" bg="rgba(139,92,246,0.08)">{d.zeroDays > 0 ? `${d.totalDays}일 중 ${d.zeroDays}일 무지출 달성!` : "무지출일이 없습니다."} {d.zeroDays > d.totalDays * 0.2 ? "잘 하고 있어요!" : ""}</Insight>
        </div>
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  Tab: 지출 분석                                                      */
/* ================================================================== */

function ExpenseTab({ d }: { d: D }) {
  /* 중분류 (subCategory) 기준 — 핵심 분석 단위 */
  const subs = d.expBySub.filter(s => s.sub !== "신용결제" && s.cat !== "신용결제");
  const subPie = subs.slice(0, 10).map(s => ({ name: s.sub, value: s.amount }));
  const topSub = subs[0];

  /* 대분류 트렌드 (월별 흐름은 대분류가 더 가독성 좋음) */
  const trendCats = d.topCats.filter(c => c !== "신용결제");
  const trendData = d.months.map(m => { const o: Record<string, string | number> = { name: d.ml[m] }; trendCats.forEach(c => { o[c] = d.monthlyCatTrend[m]?.[c] || 0; }); return o; });

  /* 대분류 → 중분류 드릴다운 */
  const cats = d.expByCat.filter(([k]) => k !== "신용결제");
  const subCatByCat = new Map<string, { sub: string; amount: number; count: number }[]>();
  for (const s of d.expBySubCat) {
    if (s.cat === "신용결제") continue;
    const arr = subCatByCat.get(s.cat) ?? [];
    arr.push({ sub: s.sub, amount: s.amount, count: s.count });
    subCatByCat.set(s.cat, arr);
  }

  /* 소분류/설명 기준 */
  const topDescs = d.expByDesc.filter(x => x.cat !== "신용결제").slice(0, 25);
  const domData = d.spendByDOM.map((v, i) => ({ day: i + 1, 지출: v }));

  /* 중분류 월평균 */
  const subAvg = subs.slice(0, 10).map(s => ({ name: s.sub, avg: Math.round(s.amount / Math.max(d.months.length, 1)) }));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      {/* 중분류 파이차트 */}
      <Card title="중분류별 지출 비중">
        <ResponsiveContainer width="100%" height={320}>
          <PieChart><Pie data={subPie} dataKey="value" cx="50%" cy="50%" outerRadius={120} innerRadius={55} label={pieLabel} labelLine={false} style={{ fontSize: 9 }}>
            {subPie.map((_, i) => <Cell key={i} fill={C[i]} />)}
          </Pie><Tooltip formatter={(v: any) => W(v)} /></PieChart>
        </ResponsiveContainer>
      </Card>

      {/* 중분류 순위 */}
      <Card title="중분류 지출 순위">
        <div style={{ maxHeight: 320, overflow: "auto" }}>
          {subs.slice(0, 20).map((s, i) => (
            <div key={s.sub} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", borderBottom: "1px solid #f5f5f5" }}>
              <span style={{ fontSize: 11, color: i < 3 ? "#e94560" : "#999", width: 20, textAlign: "right", fontWeight: 700 }}>{i + 1}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{s.sub} <span style={{ fontSize: 10, color: "#bbb" }}>({s.cat})</span></div>
                <div style={{ height: 4, background: "#f0f0f0", borderRadius: 2, marginTop: 3 }}>
                  <div style={{ height: 4, background: C[i % 12], borderRadius: 2, width: `${topSub ? s.amount / topSub.amount * 100 : 0}%` }} />
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#e94560" }}>{F(s.amount)}</div>
                <div style={{ fontSize: 10, color: "#999" }}>{s.count}건</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* 대분류 → 중분류 드릴다운 */}
      <Card title="대분류 → 중분류 상세" span={2}>
        <div style={{ maxHeight: 420, overflow: "auto" }}>
          {cats.slice(0, 10).map(([catName, catTotal], ci) => {
            const csubs = subCatByCat.get(catName) ?? [];
            return (
              <div key={catName} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `2px solid ${C[ci % 12]}` }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C[ci % 12] }}>{catName}</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: "#e94560" }}>{F(catTotal)}</span>
                </div>
                {csubs.slice(0, 8).map((s, si) => (
                  <div key={si} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0 4px 16px", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
                    <span style={{ color: "#555" }}>{s.sub} <span style={{ color: "#bbb", fontSize: 10 }}>({s.count}건)</span></span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 60, height: 4, background: "#f0f0f0", borderRadius: 2 }}>
                        <div style={{ height: 4, background: C[ci % 12], borderRadius: 2, width: `${catTotal > 0 ? s.amount / catTotal * 100 : 0}%`, opacity: 0.7 }} />
                      </div>
                      <span style={{ fontWeight: 600, minWidth: 60, textAlign: "right" }}>{F(s.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </Card>

      {/* 월별 대분류 트렌드 */}
      <Card title="월별 대분류 트렌드" span={2}>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={trendData}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} /><Legend wrapperStyle={{ fontSize: 11 }} />
            {trendCats.map((c, i) => <Area key={c} type="monotone" dataKey={c} stackId="1" stroke={C[i]} fill={C[i]} fillOpacity={0.6} />)}
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* 소분류/설명 TOP (어디에 돈을 썼는지) */}
      <Card title="지출 내역 TOP 25 (소분류/설명)">
        <div style={{ maxHeight: 380, overflow: "auto" }}>
          {topDescs.map((item, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
              <span style={{ fontWeight: 700, color: i < 3 ? "#e94560" : "#999", width: 20, textAlign: "right" }}>{i + 1}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{item.desc}</div>
                <div style={{ fontSize: 10, color: "#aaa" }}>{item.cat}{item.sub ? ` · ${item.sub}` : ""}</div>
              </div>
              <span style={{ fontWeight: 700, color: "#e94560" }}>{F(item.amount)}</span>
            </div>
          ))}
          {topDescs.length === 0 && <div style={{ textAlign: "center", padding: 20, color: "#999" }}>데이터 없음</div>}
        </div>
      </Card>

      {/* 중분류 월평균 */}
      <Card title="중분류 월평균 지출">
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={subAvg} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="#eee" />
            <XAxis type="number" tickFormatter={F} tick={{ fontSize: 10 }} /><YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 10 }} />
            <Tooltip formatter={(v: any) => W(v)} /><Bar dataKey="avg" fill="#533483" radius={[0, 4, 4, 0]} name="월평균" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* 일자별 지출 패턴 */}
      <Card title="일자별 지출 패턴 (1~31일)">
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={domData}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="day" tick={{ fontSize: 9 }} interval={2} /><YAxis tickFormatter={F} tick={{ fontSize: 10 }} /><Tooltip content={<CT />} />
            <Bar dataKey="지출" radius={[2, 2, 0, 0]}>
              {domData.map((e, i) => <Cell key={i} fill={e.지출 > d.avgMonthExp / 15 ? "#e94560" : "#0f3460"} opacity={0.7} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* TOP 단건 지출 */}
      <Card title="TOP 10 단건 지출" span={2}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr style={{ borderBottom: "2px solid #eee" }}>
              <th style={{ padding: "8px 6px", textAlign: "left", color: "#999" }}>#</th>
              <th style={{ padding: "8px 6px", textAlign: "left", color: "#999" }}>날짜</th>
              <th style={{ padding: "8px 6px", textAlign: "left", color: "#999" }}>내용</th>
              <th style={{ padding: "8px 6px", textAlign: "left", color: "#999" }}>대분류</th>
              <th style={{ padding: "8px 6px", textAlign: "left", color: "#999" }}>중분류</th>
              <th style={{ padding: "8px 6px", textAlign: "right", color: "#999" }}>금액</th>
            </tr></thead>
            <tbody>{d.topTx.map((t, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f5f5f5" }}>
                <td style={{ padding: "6px", fontWeight: 700, color: i < 3 ? "#e94560" : "#999" }}>{i + 1}</td>
                <td style={{ padding: "6px", color: "#666" }}>{t.date}</td>
                <td style={{ padding: "6px", fontWeight: 500 }}>{t.desc || "-"}</td>
                <td style={{ padding: "6px", color: "#666" }}>{t.cat}</td>
                <td style={{ padding: "6px", color: "#888" }}>{t.sub || "-"}</td>
                <td style={{ padding: "6px", textAlign: "right", fontWeight: 700, color: "#e94560" }}>{F(t.amount)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>

      {/* 인사이트 */}
      <Card title="지출 분석 인사이트" span={2}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <Insight title="최다 중분류" color="#e94560" bg="#fff5f5">
            {topSub ? `${topSub.sub}에 총 ${F(topSub.amount)} (${topSub.count}건). ${d.pExpense > 0 ? `전체의 ${Math.round(topSub.amount / d.pExpense * 100)}%` : ""}` : "데이터 없음"}
          </Insight>
          <Insight title="최다 지출 항목" color="#0f3460" bg="#f0f8ff">
            {topDescs.length > 0 ? `${topDescs[0].desc}에 총 ${F(topDescs[0].amount)} (${topDescs[0].cat} · ${topDescs[0].sub || "기타"}).` : "데이터 없음"}
          </Insight>
          <Insight title="일자별 패턴" color="#b45309" bg="#fff3cd">
            {(() => { const maxD = d.spendByDOM.indexOf(Math.max(...d.spendByDOM)); return `${maxD + 1}일에 지출이 가장 많음 (${F(d.spendByDOM[maxD])}).`; })()}
          </Insight>
        </div>
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  Tab: 수입 구조                                                      */
/* ================================================================== */

function IncomeTab({ d }: { d: D }) {
  const incData = d.incByCat.map(([name, value]) => ({ name, value }));
  const totalIncome = incData.reduce((s, x) => s + x.value, 0);
  const salary = d.incByCat.find(([c]) => c === "급여")?.[1] ?? 0;
  const salaryPct = totalIncome > 0 ? salary / totalIncome * 100 : 0;
  const passive = d.incByCat.filter(([c]) => ["배당", "이자", "캐시백", "분배금"].includes(c)).reduce((s, [, v]) => s + v, 0);
  const monthlyInc = d.months.filter(m => d.monthly[m].income > 0).map(m => ({ name: d.ml[m], 수입: d.monthly[m].income }));
  const incStability = (() => {
    const vals = d.months.filter(m => d.monthly[m].income > 0).map(m => d.monthly[m].income);
    if (vals.length < 2) return null;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    return mean > 0 ? Math.round((1 - std / mean) * 100) : 0;
  })();

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
      <Card accent><Kpi label="급여 의존도" value={salaryPct.toFixed(1) + "%"} sub="급여가 전체 수입에서 차지하는 비율" color="#f0c040" /></Card>
      <Card accent><Kpi label="비급여 수입" value={F(totalIncome - salary)} sub={`패시브: ${F(passive)} | 기타: ${F(totalIncome - salary - passive)}`} color="#48c9b0" /></Card>

      <Card title="수입원 구성">
        <ResponsiveContainer width="100%" height={280}>
          <PieChart><Pie data={incData.slice(0, 7)} dataKey="value" cx="50%" cy="50%" outerRadius={105} innerRadius={50} label={pieLabel} labelLine={false} style={{ fontSize: 10 }}>
            {incData.slice(0, 7).map((_, i) => <Cell key={i} fill={C[i]} />)}
          </Pie><Tooltip formatter={(v: any) => W(v)} /></PieChart>
        </ResponsiveContainer>
      </Card>

      <Card title="수입원 상세">
        <div style={{ maxHeight: 280, overflow: "auto" }}>
          {incData.map(({ name, value }, i) => (
            <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #f5f5f5", fontSize: 13 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i % 12], display: "inline-block" }} />{name}
              </span>
              <span style={{ fontWeight: 700 }}>{F(value)} <span style={{ fontSize: 10, color: "#999" }}>({totalIncome > 0 ? Math.round(value / totalIncome * 100) : 0}%)</span></span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="월별 수입 추이" span={2}>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={monthlyInc}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} />
            <Bar dataKey="수입" fill="#f0c040" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="급여 vs 비급여 추이" span={2}>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={d.salaryTrend}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="l" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} /><Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="salary" stackId="a" fill="#f0c040" name="급여계" radius={[0, 0, 0, 0]} />
            <Bar dataKey="nonSalary" stackId="a" fill="#48c9b0" name="비급여" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="누적 수입 vs 누적 지출" span={1}>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={d.cumIE}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="l" tick={{ fontSize: 10 }} /><YAxis tickFormatter={F} tick={{ fontSize: 10 }} /><Tooltip content={<CT />} />
            <Line type="monotone" dataKey="누적수입" stroke="#f0c040" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="누적지출" stroke="#e94560" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card title="수입 인사이트" span={1}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Insight title="수입 안정성" color="#2563eb" bg="#cce5ff">
            {incStability !== null ? `안정성 지수 ${incStability}%. ${incStability >= 70 ? "안정적인 수입 흐름!" : incStability >= 40 ? "다소 변동적." : "수입 변동이 큽니다."}` : "데이터 부족"}
          </Insight>
          <Insight title="패시브 수입" color="#059669" bg="#d4edda">
            {passive > 0 ? `배당+이자+캐시백 합산 ${F(passive)}. 전체의 ${Math.round(passive / Math.max(totalIncome, 1) * 100)}%.` : "패시브 수입이 없습니다. 배당주나 예금 이자를 늘려보세요."}
          </Insight>
          <Insight title="수입 다각화" color="#b45309" bg="#fff3cd">
            {d.incByCat.length}개 수입원 보유. {salaryPct > 80 ? "급여 의존도가 높아요. 부수입을 늘려보세요." : salaryPct > 50 ? "적정 수준의 다각화." : "훌륭한 수입 다각화!"}
          </Insight>
        </div>
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  Tab: 데이트 분석                                                    */
/* ================================================================== */

function DateTab({ d }: { d: D }) {
  const allMonthData = d.months.map(m => ({ name: d.ml[m], 금액: d.dateExpMonthly[m] ?? 0 }));
  const total = Object.values(d.dateExpMonthly).reduce((a, b) => a + b, 0);
  const monthsWithData = Object.values(d.dateExpMonthly).filter(v => v > 0).length;
  const avg = monthsWithData > 0 ? total / monthsWithData : 0;
  const splitTotal = d.dateMoim + d.datePersonal;
  const moimPct = splitTotal > 0 ? Math.round(d.dateMoim / splitTotal * 100) : 0;
  const subPie = d.dateSubCats.slice(0, 8).map(([name, value]) => ({ name, value }));
  const dateVsTotal = d.months.filter(m => d.monthly[m].expense > 0).map(m => ({
    name: d.ml[m], 비율: d.dateExpMonthly[m] && d.monthly[m].expense > 0 ? Math.round(d.dateExpMonthly[m] / d.monthly[m].expense * 100) : 0,
  }));
  const maxMonth = allMonthData.reduce((max, m) => m.금액 > max.금액 ? m : max, allMonthData[0] || { name: "", 금액: 0 });
  const minMonth = allMonthData.filter(m => m.금액 > 0).reduce((min, m) => m.금액 < min.금액 ? m : min, allMonthData.find(m => m.금액 > 0) || { name: "", 금액: 0 });
  const avgPerTx = d.dateTxCount > 0 ? Math.round(total / d.dateTxCount) : 0;

  /* 요일별 데이트 지출 */
  const dateDow = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
  for (const e of d.dateEntries) {
    if (!e.date) continue;
    const js = new Date(e.date).getDay();
    const idx = js === 0 ? 6 : js - 1;
    dateDow[idx].total += e.amount; dateDow[idx].count++;
  }
  const dowData = WDN.map((name, i) => ({ name, 금액: dateDow[i].total, 건수: dateDow[i].count }));

  const noData = d.dateTxCount === 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
      <Card accent><Kpi label="총 데이트 지출" value={F(total)} sub={`${d.dateTxCount}건`} color="#e94560" /></Card>
      <Card accent><Kpi label="월평균 · 건당평균" value={F(Math.round(avg))} sub={`건당 ${F(avgPerTx)}`} color="#f0c040" /></Card>
      <Card accent><Kpi label="모임통장 vs 개인" value={`${moimPct}% : ${100 - moimPct}%`} sub={`모임 ${F(d.dateMoim)} / 개인 ${F(d.datePersonal)}`} color="#48c9b0" /></Card>

      {noData && (
        <Card span={3}>
          <div style={{ textAlign: "center", padding: "40px 20px", color: "#999" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>💕</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>데이트 지출 데이터가 없습니다</div>
            <div style={{ fontSize: 13, lineHeight: 1.8 }}>
              가계부에서 <b>대분류</b> 또는 <b>중분류</b>에 "데이트"가 포함된 항목을 자동 감지합니다.<br />
              예: category="데이트비" / subCategory="데이트비" 등
            </div>
          </div>
        </Card>
      )}

      {!noData && <>
        <Card title="월별 데이트 지출" span={2}>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={allMonthData}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} />
              <Bar dataKey="금액" fill="#e94560" radius={[6, 6, 0, 0]} /><Line type="monotone" dataKey="금액" stroke="#f0c040" strokeWidth={2} dot={{ r: 3 }} name="추세" />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        <Card title="중분류별 비중">
          {subPie.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart><Pie data={subPie} dataKey="value" cx="50%" cy="50%" outerRadius={100} innerRadius={40} label={pieLabel} labelLine={false} style={{ fontSize: 9 }}>
                {subPie.map((_, i) => <Cell key={i} fill={C[i]} />)}
              </Pie><Tooltip formatter={(v: any) => W(v)} /></PieChart>
            </ResponsiveContainer>
          ) : <div style={{ textAlign: "center", padding: 40, color: "#999" }}>중분류 없음</div>}
        </Card>

        <Card title="지출처 TOP 20 (설명/내역)" span={2}>
          <div style={{ maxHeight: 320, overflow: "auto" }}>
            {d.dateTop.map(([name, value], i) => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
                <span style={{ fontWeight: 700, color: i < 3 ? "#e94560" : "#999", width: 20, textAlign: "right" }}>{i + 1}</span>
                <span style={{ flex: 1, fontWeight: 500 }}>{name}</span>
                <span style={{ fontWeight: 700, color: "#e94560" }}>{F(value)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="요일별 데이트 지출">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dowData}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 10 }} /><Tooltip content={<CT />} />
              <Bar dataKey="금액" radius={[6, 6, 0, 0]}>
                {dowData.map((e, i) => <Cell key={i} fill={e.금액 === Math.max(...dowData.map(x => x.금액)) ? "#e94560" : "#0f3460"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: "#999", textAlign: "center", marginTop: 4 }}>
            {(() => { const best = dowData.reduce((m, d) => d.금액 > m.금액 ? d : m, dowData[0]); return best.금액 > 0 ? `${best.name}요일에 가장 많이 지출 (${best.건수}건, ${F(best.금액)})` : ""; })()}
          </div>
        </Card>

        <Card title="전체 지출 대비 데이트비 비율" span={1}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={dateVsTotal}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis tickFormatter={(v: number) => v + "%"} tick={{ fontSize: 10 }} /><Tooltip formatter={(v: any) => v + "%"} />
              <Bar dataKey="비율" fill="#e94560" radius={[4, 4, 0, 0]} name="비율" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="데이트 내역 상세" span={2}>
          <div style={{ overflowX: "auto", maxHeight: 320 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr style={{ borderBottom: "2px solid #eee" }}>
                <th style={{ padding: "6px", textAlign: "left", color: "#999" }}>날짜</th>
                <th style={{ padding: "6px", textAlign: "left", color: "#999" }}>내용</th>
                <th style={{ padding: "6px", textAlign: "left", color: "#999" }}>중분류</th>
                <th style={{ padding: "6px", textAlign: "right", color: "#999" }}>금액</th>
              </tr></thead>
              <tbody>{d.dateEntries.slice(0, 30).map((e, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <td style={{ padding: "5px 6px", color: "#666" }}>{e.date}</td>
                  <td style={{ padding: "5px 6px", fontWeight: 500 }}>{e.desc || "-"}</td>
                  <td style={{ padding: "5px 6px", color: "#888" }}>{e.sub || "-"}</td>
                  <td style={{ padding: "5px 6px", textAlign: "right", fontWeight: 700, color: "#e94560" }}>{F(e.amount)}</td>
                </tr>
              ))}</tbody>
            </table>
            {d.dateEntries.length > 30 && <div style={{ fontSize: 11, color: "#999", textAlign: "center", marginTop: 4 }}>+{d.dateEntries.length - 30}건 더</div>}
          </div>
        </Card>

        <Card title="통계" span={1}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { label: "총 건수", value: `${d.dateTxCount}건`, color: "#e94560" },
              { label: "건당 평균", value: F(avgPerTx), color: "#0f3460" },
              { label: "최대 지출월", value: `${maxMonth.name} (${F(maxMonth.금액)})`, color: "#f39c12" },
              { label: "최소 지출월", value: `${minMonth.name} (${F(minMonth.금액)})`, color: "#48c9b0" },
              { label: "전체 지출 대비", value: d.pExpense > 0 ? Math.round(total / d.pExpense * 100) + "%" : "-", color: "#533483" },
              { label: "모임통장 비율", value: moimPct + "%", color: "#2ecc71" },
            ].map(s => (
              <div key={s.label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 10px", background: "#f8f9fa", borderRadius: 8, fontSize: 12 }}>
                <span style={{ color: "#666" }}>{s.label}</span>
                <span style={{ fontWeight: 700, color: s.color }}>{s.value}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="데이트비 인사이트" span={3}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Insight title="최다 지출처" color="#e94560" bg="#fff5f5">
              {d.dateTop.length > 0 ? `${d.dateTop[0][0]}에 총 ${F(d.dateTop[0][1])}. ${d.dateTop.length > 1 ? `2위 ${d.dateTop[1][0]} (${F(d.dateTop[1][1])}).` : ""}` : "데이터 없음"}
            </Insight>
            <Insight title="모임통장 활용" color="#2ecc71" bg="#f5fff5">
              {splitTotal > 0 ? `전체의 ${moimPct}%가 모임통장 결제. ${moimPct < 30 ? "모임통장 활용을 늘려보세요." : "적절히 활용 중!"}` : "모임통장 데이터 없음"}
            </Insight>
            <Insight title="추세" color="#0f3460" bg="#f0f8ff">
              {allMonthData.length >= 2 ? `최고 ${maxMonth.name}(${F(maxMonth.금액)}), 최저 ${minMonth.name}(${F(minMonth.금액)}). 변동폭 ${F(maxMonth.금액 - minMonth.금액)}.` : "데이터 부족"}
            </Insight>
          </div>
        </Card>
      </>}
    </div>
  );
}

/* ================================================================== */
/*  Tab: 투자 포트폴리오                                                */
/* ================================================================== */

function InvestTab({ d }: { d: D }) {
  const holdings = d.trades.map(v => ({
    name: v.name.length > 20 ? v.name.slice(0, 20) + "…" : v.name, fullName: v.name,
    매수: v.buyTotal, 매도: v.sellTotal, 보유수량: v.buyCount - v.sellCount,
    실현손익: v.sellTotal - (v.sellCount > 0 ? (v.buyTotal / Math.max(v.buyCount, 1)) * v.sellCount : 0),
  }));
  const holdOnly = holdings.filter(h => h.보유수량 > 0);
  const closedPL = holdings.filter(h => h.보유수량 === 0 && h.매도 > 0);
  const noSellHoldings = holdOnly.filter(h => h.매도 === 0 && h.매수 > 500000);
  const totalInvested = holdOnly.reduce((s, h) => s + h.매수, 0);
  const totalDiv = d.divTrend.reduce((s, m) => s + m.amount, 0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
      <Card accent><Kpi label="총 매수금액" value={F(totalInvested)} color="#f0c040" /></Card>
      <Card accent><Kpi label="실현 손익" value={F(Math.round(d.realPL.total))} color={d.realPL.total >= 0 ? "#48c9b0" : "#e94560"} /></Card>
      <Card accent><Kpi label="배당/이자 수입" value={F(totalDiv)} color="#48c9b0" /></Card>
      <Card accent><Kpi label="보유 종목 수" value={`${holdOnly.length}종목`} sub={`청산 ${closedPL.length}종목`} color="#fff" /></Card>

      <Card title="보유 종목 (매수금액 기준)" span={2}>
        {holdOnly.length === 0 ? <div style={{ textAlign: "center", padding: 40, color: "#999" }}>보유 종목 없음</div> : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={holdOnly.slice(0, 10)} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis type="number" tickFormatter={F} tick={{ fontSize: 11 }} /><YAxis dataKey="name" type="category" width={150} tick={{ fontSize: 10 }} />
              <Tooltip content={<CT />} /><Bar dataKey="매수" fill="#0f3460" radius={[0, 6, 6, 0]} name="매수금액" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="포트폴리오 자산배분" span={1}>
        {d.portfolio.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart><Pie data={d.portfolio} dataKey="value" cx="50%" cy="50%" outerRadius={100} innerRadius={45} label={pieLabel} labelLine={false} style={{ fontSize: 10 }}>
              {d.portfolio.map((_, i) => <Cell key={i} fill={C[i]} />)}
            </Pie><Tooltip formatter={(v: any) => W(v)} /></PieChart>
          </ResponsiveContainer>
        ) : <div style={{ textAlign: "center", padding: 40, color: "#999" }}>데이터 없음</div>}
      </Card>

      <Card title="청산 종목 손익" span={1}>
        <div style={{ maxHeight: 280, overflow: "auto" }}>
          {closedPL.length === 0 ? <div style={{ textAlign: "center", padding: 40, color: "#999" }}>청산 종목 없음</div> : closedPL.map(({ fullName, 매수, 매도, 실현손익 }) => (
            <div key={fullName} style={{ padding: "8px 0", borderBottom: "1px solid #f5f5f5" }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{fullName}</div>
              <div style={{ display: "flex", gap: 12, fontSize: 11, marginTop: 2 }}>
                <span style={{ color: "#999" }}>매수 {F(매수)}</span><span style={{ color: "#999" }}>매도 {F(매도)}</span>
                <span style={{ color: 실현손익 >= 0 ? "#2ecc71" : "#e94560", fontWeight: 700 }}>{실현손익 >= 0 ? "+" : ""}{F(Math.round(실현손익))}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="월별 투자금액 추이" span={2}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={d.investTrend}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="l" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} />
            <Bar dataKey="amount" fill="#48c9b0" radius={[4, 4, 0, 0]} name="투자금액" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="월별 매매 횟수" span={1}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={d.tradeCntTrend}><XAxis dataKey="l" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip />
            <Bar dataKey="count" fill="#533483" radius={[4, 4, 0, 0]} name="거래수" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="배당/이자 수입 추이" span={1}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={d.divTrend.filter(m => m.amount > 0)}><XAxis dataKey="l" tick={{ fontSize: 10 }} /><YAxis tickFormatter={F} tick={{ fontSize: 10 }} /><Tooltip content={<CT />} />
            <Bar dataKey="amount" fill="#f0c040" radius={[4, 4, 0, 0]} name="배당/이자" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="매매 성과" span={1}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: d.realPL.total >= 0 ? "#d4edda" : "#f8d7da", borderRadius: 8 }}>
            <span>총 실현손익</span><span style={{ fontWeight: 800, color: d.realPL.total >= 0 ? "#2ecc71" : "#e94560" }}>{d.realPL.total >= 0 ? "+" : ""}{F(Math.round(d.realPL.total))}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1, padding: "8px 10px", background: "#d4edda", borderRadius: 8, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#666" }}>수익</div>
              <div style={{ fontWeight: 700, color: "#2ecc71" }}>{d.realPL.winCnt}건 +{F(Math.round(d.realPL.wins))}</div>
            </div>
            <div style={{ flex: 1, padding: "8px 10px", background: "#f8d7da", borderRadius: 8, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#666" }}>손실</div>
              <div style={{ fontWeight: 700, color: "#e94560" }}>{d.realPL.lossCnt}건 -{F(Math.round(d.realPL.losses))}</div>
            </div>
          </div>
          {d.realPL.winCnt + d.realPL.lossCnt > 0 && (
            <div style={{ textAlign: "center", fontSize: 12, color: "#666" }}>
              승률 {Math.round(d.realPL.winCnt / (d.realPL.winCnt + d.realPL.lossCnt) * 100)}%
            </div>
          )}
        </div>
      </Card>

      <Card title="투자 인사이트" span={3}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {holdOnly[0] && <Insight title="최대 보유" color="#0f3460" bg="#f0f8ff">{holdOnly[0].fullName} — {F(holdOnly[0].매수)}. 포트폴리오 비중 {totalInvested > 0 ? Math.round(holdOnly[0].매수 / totalInvested * 100) : 0}%.</Insight>}
          {noSellHoldings.length > 0 && <Insight title="매도 없는 종목" color="#e94560" bg="#f8d7da">{noSellHoldings.map(h => h.fullName).join(", ")}. 손절 회피 가능성 점검.</Insight>}
          <Insight title="배당 수입" color="#059669" bg="#d4edda">{totalDiv > 0 ? `총 ${F(totalDiv)} 수령. 월평균 ${F(Math.round(totalDiv / Math.max(d.months.length, 1)))}.` : "아직 배당/이자 수입이 없습니다."}</Insight>
        </div>
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  Tab: 구독 관리                                                      */
/* ================================================================== */

function SubTab({ d }: { d: D }) {
  const subs = d.subs;
  const totalMonthly = subs.reduce((a, s) => a + s.avg, 0);
  const totalAnnual = totalMonthly * 12;
  const subPctIncome = d.pIncome > 0 ? (subs.reduce((a, s) => a + s.total, 0) / d.pIncome * 100) : 0;
  const aiSubs = subs.filter(s => /chatgpt|claude|cursor|ai|gpt|copilot/i.test(s.name));
  const videoSubs = subs.filter(s => /유튜브|넷플릭스|왓챠|디즈니|웨이브|프리미엄/i.test(s.name));
  const commerceSubs = subs.filter(s => /쿠팡|로켓|네이버플러스|멤버십/i.test(s.name));
  const costPerDay = totalMonthly > 0 ? Math.round(totalMonthly / 30) : 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
      <Card accent><Kpi label="월 구독 비용" value={F(totalMonthly)} sub={`일 ${W(costPerDay)}`} color="#f0c040" /></Card>
      <Card accent><Kpi label="연간 구독 비용" value={F(totalAnnual)} color="#e94560" /></Card>
      <Card accent><Kpi label="수입 대비 비율" value={subPctIncome.toFixed(1) + "%"} sub={subPctIncome > 5 ? "구독 비중이 높아요" : "적정 수준"} color="#48c9b0" /></Card>

      <Card title="구독 서비스 상세" span={3}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {subs.map(({ name, count, total, avg }) => (
            <div key={name} style={{ background: "#f8f9fa", borderRadius: 12, padding: 14, border: "1px solid #eee" }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{name}</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#666" }}>
                <span>월 ~{W(avg)}</span><span>{count}회 결제</span>
              </div>
              <div style={{ fontSize: 12, color: "#e94560", fontWeight: 600, marginTop: 4 }}>누적 {W(total)}</div>
            </div>
          ))}
        </div>
        {subs.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "#999" }}>구독 데이터 없음</div>}
      </Card>

      <Card title="월별 구독 지출 추이" span={2}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={d.subTrend}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="l" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} />
            <Bar dataKey="amount" fill="#533483" radius={[4, 4, 0, 0]} name="구독비" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="구독 카테고리 분류" span={1}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
          {[
            { label: "AI/생산성", items: aiSubs, color: "#e94560", total: aiSubs.reduce((s, sub) => s + sub.avg, 0) },
            { label: "영상/엔터", items: videoSubs, color: "#0f3460", total: videoSubs.reduce((s, sub) => s + sub.avg, 0) },
            { label: "커머스/배송", items: commerceSubs, color: "#48c9b0", total: commerceSubs.reduce((s, sub) => s + sub.avg, 0) },
          ].filter(g => g.items.length > 0).map(g => (
            <div key={g.label} style={{ padding: "10px 12px", background: "#f8f9fa", borderRadius: 8, borderLeft: `4px solid ${g.color}` }}>
              <div style={{ fontWeight: 700, color: g.color }}>{g.label} — 월 {W(g.total)}</div>
              <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{g.items.map(s => s.name).join(", ")}</div>
            </div>
          ))}
          {aiSubs.length === 0 && videoSubs.length === 0 && commerceSubs.length === 0 && (
            <div style={{ textAlign: "center", padding: 20, color: "#999" }}>분류할 구독이 없습니다</div>
          )}
        </div>
      </Card>

      <Card title="구독 최적화 제안" span={3}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {aiSubs.length > 1 && <Insight title="AI 구독 점검" color="#b45309" bg="#fff3cd">{aiSubs.map(s => `${s.name}(${F(s.avg)})`).join(" + ")} = 월 {F(aiSubs.reduce((s, sub) => s + sub.avg, 0))}. 둘 다 필요한지 점검.</Insight>}
          {videoSubs.length > 1 && <Insight title="영상 구독 중복" color="#2563eb" bg="#cce5ff">{videoSubs.map(s => s.name).join(" + ")}. 사용빈도 대비 효율 점검.</Insight>}
          {commerceSubs.length > 1 && <Insight title="커머스 통합" color="#059669" bg="#d4edda">{commerceSubs.map(s => s.name).join(" + ")}. 주 사용처 하나로 통합하면 절약.</Insight>}
          <Insight title="비용 대비 가치" color="#7c3aed" bg="rgba(139,92,246,0.08)">
            연간 {F(totalAnnual)} 지출. {totalAnnual > 1000000 ? "100만원 이상! 미사용 구독을 정리해보세요." : "적정 수준입니다."}
          </Insight>
          {costPerDay > 0 && <Insight title="일일 구독 비용" color="#e94560" bg="#fff5f5">하루 {W(costPerDay)} 지출. {costPerDay > 3000 ? "커피 한 잔 이상!" : "커피 한 잔 미만."}</Insight>}
        </div>
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  Tab: 소비 패턴                                                      */
/* ================================================================== */

function PatternTab({ d }: { d: D }) {
  const wdData = WDN.map((name, i) => ({ name, total: d.wdSpend[i].total, avg: d.wdSpend[i].count > 0 ? Math.round(d.wdSpend[i].total / d.wdSpend[i].count) : 0, count: d.wdSpend[i].count }));
  const subFreqPie = d.expBySub.filter(s => s.sub !== "신용결제" && s.cat !== "신용결제" && s.count > 0).slice(0, 8).map(s => ({ name: s.sub, value: s.count }));
  const sorted = [...wdData].sort((a, b) => b.avg - a.avg);
  const totalExpTx = d.wdSpend.reduce((s, w) => s + w.count, 0);
  const avgDaily = d.totalDays > 0 ? Math.round(d.pExpense / d.totalDays) : 0;
  const weekendPct = d.weekendTot + d.weekdayTot > 0 ? Math.round(d.weekendTot / (d.weekendTot + d.weekdayTot) * 100) : 0;

  // spending by third of month
  const byThird = [0, 0, 0]; // 1-10, 11-20, 21-31
  d.spendByDOM.forEach((v, i) => { if (i < 10) byThird[0] += v; else if (i < 20) byThird[1] += v; else byThird[2] += v; });
  const thirdData = [{ name: "상순(1~10)", 지출: byThird[0] }, { name: "중순(11~20)", 지출: byThird[1] }, { name: "하순(21~31)", 지출: byThird[2] }];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
      <Card accent><Kpi label="무지출 일수" value={`${d.zeroDays}일`} sub={`${d.totalDays}일 중`} color="#48c9b0" /></Card>
      <Card accent><Kpi label="일 평균 지출" value={F(avgDaily)} color="#f0c040" /></Card>
      <Card accent><Kpi label="주말 지출 비중" value={weekendPct + "%"} sub={`주말 ${F(d.weekendTot)} / 주중 ${F(d.weekdayTot)}`} color="#e94560" /></Card>
      <Card accent><Kpi label="총 거래 건수" value={`${totalExpTx}건`} color="#fff" /></Card>

      <Card title="요일별 지출 패턴" span={2}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={wdData}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} />
            <Bar dataKey="avg" fill="#533483" radius={[6, 6, 0, 0]} name="건당 평균" />
          </BarChart>
        </ResponsiveContainer>
        <div style={{ textAlign: "center", fontSize: 11, color: "#999", marginTop: 4 }}>건당 평균 금액 기준. 최고: {sorted[0]?.name}({F(sorted[0]?.avg || 0)})</div>
      </Card>

      <Card title="중분류별 지출 빈도" span={1}>
        {subFreqPie.length > 0 ? (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart><Pie data={subFreqPie} dataKey="value" cx="50%" cy="50%" outerRadius={95} innerRadius={40} label={pieLabel} labelLine={false} style={{ fontSize: 9 }}>
              {subFreqPie.map((_, i) => <Cell key={i} fill={C[i]} />)}
            </Pie><Tooltip formatter={(v: any) => `${v}건`} /></PieChart>
          </ResponsiveContainer>
        ) : <div style={{ textAlign: "center", padding: 40, color: "#999" }}>데이터 없음</div>}
      </Card>

      <Card title="상·중·하순 지출 비교" span={1}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={thirdData}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis tickFormatter={F} tick={{ fontSize: 10 }} /><Tooltip content={<CT />} />
            <Bar dataKey="지출" radius={[6, 6, 0, 0]}>
              {thirdData.map((_, i) => <Cell key={i} fill={C[i]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="지출 많은 날 TOP 5" span={2}>
        {d.topDates.length === 0 ? <div style={{ textAlign: "center", padding: 20, color: "#999" }}>데이터 없음</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {d.topDates.map((dt, idx) => (
              <div key={dt.date} style={{ background: idx < 3 ? "#fff5f5" : "#f8f9fa", borderRadius: 10, padding: "10px 14px", border: idx < 3 ? "1px solid #fcc" : "1px solid #eee", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${d.topDates[0] ? dt.total / d.topDates[0].total * 100 : 0}%`, background: "rgba(233,69,96,0.06)", borderRadius: 10 }} />
                <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: idx < 3 ? "#e94560" : "#999", width: 28 }}>{idx + 1}</span>
                  <span style={{ fontSize: 13, color: "#666", fontWeight: 600, minWidth: 85 }}>{dt.date}</span>
                  <span style={{ fontWeight: 700, fontSize: 15, color: "#e94560", marginLeft: "auto" }}>{F(dt.total)}</span>
                </div>
                <div style={{ position: "relative", display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                  {dt.items.slice(0, 4).map((it, j) => (
                    <span key={j} style={{ fontSize: 10, color: "#999", background: "#fff", border: "1px solid #eee", borderRadius: 4, padding: "1px 6px" }}>{it.desc} {F(it.amount)}</span>
                  ))}
                  {dt.items.length > 4 && <span style={{ fontSize: 10, color: "#999" }}>+{dt.items.length - 4}건</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="고액 지출 TOP 12" span={2}>
        {d.largeExp.length === 0 ? <div style={{ textAlign: "center", padding: 20, color: "#999" }}>10만원 이상 지출 없음</div> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
            {d.largeExp.slice(0, 12).map((item, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: i < 3 ? "#fff5f5" : "#f8f9fa", borderRadius: 8, border: i < 3 ? "1px solid #fcc" : "1px solid #eee" }}>
                <span style={{ fontSize: 16, fontWeight: 800, color: i < 3 ? "#e94560" : "#999", width: 24 }}>{i + 1}</span>
                <div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 600 }}>{item.desc || item.sub}</div><div style={{ fontSize: 10, color: "#999" }}>{item.date} · {item.sub}</div></div>
                <span style={{ fontSize: 14, fontWeight: 800, color: "#e94560" }}>{F(item.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="소비 패턴 인사이트" span={4}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
          <Insight title="건당 평균 높은 요일" color="#e94560" bg="#f8d7da">
            {sorted.slice(0, 2).map(w => `${w.name}(${F(w.avg)})`).join(", ")}. 신용결제일이나 고정지출 영향 가능.
          </Insight>
          <Insight title="주말 vs 주중" color="#0f3460" bg="#f0f8ff">
            주말 {weekendPct}%, 주중 {100 - weekendPct}%. {weekendPct > 40 ? "주말 지출 비중이 높아요." : "주중 위주 지출 패턴."}
          </Insight>
          <Insight title="월 상·중·하순" color="#b45309" bg="#fff3cd">
            {byThird[2] > byThird[0] && byThird[2] > byThird[1] ? "하순(21~31일)에 지출 집중! 신용결제일 영향." : byThird[0] > byThird[1] ? "상순(1~10일)에 집중." : "중순(11~20일)에 집중."}
          </Insight>
          <Insight title="무지출 달성" color="#059669" bg="#d4edda">
            {d.zeroDays > 0 ? `${d.zeroDays}일 무지출! ${d.zeroDays >= 10 ? "대단해요!" : "더 늘려보세요."}` : "무지출일이 없습니다."}
          </Insight>
        </div>
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  Tab: 지출 속도                                                      */
/* ================================================================== */

function VelocityTab({ d }: { d: D }) {
  const validMonths = d.months.filter(m => { const c = d.cumSpend[m]; return c && c[30] > 0; });
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const lineData = days.map(day => { const o: Record<string, number> = { day }; validMonths.forEach(m => { o[d.ml[m]] = d.cumSpend[m]?.[day - 1] ?? 0; }); return o; });
  const colors = ["#e94560", "#0f3460", "#f0c040", "#533483", "#48c9b0", "#f39c12", "#3498db", "#e74c3c", "#2ecc71"];

  const maxSpend = validMonths.map(m => ({ m, val: d.cumSpend[m]?.[30] ?? 0 })).sort((a, b) => b.val - a.val);
  const minSpend = validMonths.map(m => ({ m, val: d.cumSpend[m]?.[30] ?? 0 })).filter(x => x.val > 0).sort((a, b) => a.val - b.val);
  const midSpend = validMonths.map(m => ({ m, val: d.cumSpend[m]?.[14] ?? 0 })).sort((a, b) => b.val - a.val);
  const spikeMonth = maxSpend[0]; const stableMonth = minSpend[0];

  // monthly totals bar
  const monthlyTotalBar = validMonths.map(m => ({ name: d.ml[m], 총지출: d.cumSpend[m]?.[30] ?? 0 }));
  const avgMonthlySpend = validMonths.length > 0 ? monthlyTotalBar.reduce((s, m) => s + m.총지출, 0) / validMonths.length : 0;

  // pace for current/latest month
  const latestMonth = d.months[d.months.length - 1];
  const latestCum = d.cumSpend[latestMonth];
  const now = new Date();
  const [ly, lm] = (latestMonth || "2026-01").split("-").map(Number);
  const isCurrent = now.getFullYear() === ly && now.getMonth() + 1 === lm;
  const dayOfMonth = isCurrent ? now.getDate() : new Date(ly, lm, 0).getDate();
  const daysInMonth = new Date(ly, lm, 0).getDate();
  const currentSpend = latestCum?.[dayOfMonth - 1] ?? 0;
  const projected = dayOfMonth > 0 ? currentSpend / dayOfMonth * daysInMonth : 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
      <Card accent><Kpi label="현재 지출" value={F(currentSpend)} sub={`${d.ml[latestMonth] || ""} ${dayOfMonth}일차`} color="#f0c040" /></Card>
      <Card accent><Kpi label="예상 월말 지출" value={F(Math.round(projected))} sub={projected > avgMonthlySpend * 1.2 ? "평균 초과 예상!" : "양호"} color={projected > avgMonthlySpend * 1.2 ? "#e94560" : "#48c9b0"} /></Card>
      <Card accent><Kpi label="월 평균 지출" value={F(Math.round(avgMonthlySpend))} sub={`${validMonths.length}개월 평균`} color="#fff" /></Card>

      <Card title="월별 누적 지출 속도 비교" span={3}>
        {validMonths.length === 0 ? <div style={{ textAlign: "center", padding: 40, color: "#999" }}>데이터 없음</div> : (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={lineData}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="day" tick={{ fontSize: 11 }} label={{ value: "일", position: "insideBottomRight", fontSize: 11 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} /><Legend wrapperStyle={{ fontSize: 11 }} />
              {validMonths.map((m, i) => <Line key={m} type="monotone" dataKey={d.ml[m]} stroke={colors[i % colors.length]} strokeWidth={spikeMonth && m === spikeMonth.m ? 3 : 1.5} dot={false} strokeOpacity={spikeMonth && m === spikeMonth.m ? 1 : 0.7} />)}
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="월별 총 지출 비교" span={2}>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={monthlyTotalBar}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} />
            <Bar dataKey="총지출" radius={[4, 4, 0, 0]}>
              {monthlyTotalBar.map((e, i) => <Cell key={i} fill={e.총지출 > avgMonthlySpend * 1.3 ? "#e94560" : e.총지출 < avgMonthlySpend * 0.8 ? "#48c9b0" : "#0f3460"} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 11, color: "#999", textAlign: "center", marginTop: 4 }}>빨강: 평균 130%+, 파랑: 평균, 초록: 평균 80% 미만</div>
      </Card>

      <Card title="속도 통계" span={1}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
          {[
            { label: "최고 지출월", value: spikeMonth ? `${d.ml[spikeMonth.m]} (${F(spikeMonth.val)})` : "-", color: "#e94560" },
            { label: "최저 지출월", value: stableMonth ? `${d.ml[stableMonth.m]} (${F(stableMonth.val)})` : "-", color: "#48c9b0" },
            { label: "15일차 최고", value: midSpend[0] ? `${d.ml[midSpend[0].m]} (${F(midSpend[0].val)})` : "-", color: "#f0c040" },
            { label: "일 평균 지출", value: F(Math.round(d.pExpense / Math.max(d.totalDays, 1))), color: "#533483" },
            { label: "예상 vs 평균", value: avgMonthlySpend > 0 ? Math.round(projected / avgMonthlySpend * 100) + "%" : "-", color: "#0f3460" },
          ].map(s => (
            <div key={s.label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", background: "#f8f9fa", borderRadius: 8 }}>
              <span style={{ color: "#666" }}>{s.label}</span>
              <span style={{ fontWeight: 700, color: s.color }}>{s.value}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="지출 속도 인사이트" span={3}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {spikeMonth && <Insight title="최고 지출 월" color="#e94560" bg="#f8d7da">{d.ml[spikeMonth.m]} — 총 {F(spikeMonth.val)}. 25일 전후 급등 패턴 확인하세요.</Insight>}
          {stableMonth && stableMonth.m !== spikeMonth?.m && <Insight title="안정적 지출 월" color="#059669" bg="#d4edda">{d.ml[stableMonth.m]} — 총 {F(stableMonth.val)}. 이상적 지출 패턴.</Insight>}
          <Insight title="15일 기준선" color="#2563eb" bg="#cce5ff">15일차에 월 지출 50% 이내면 양호. {midSpend[0] ? `가장 빠른 달: ${d.ml[midSpend[0].m]} (${F(midSpend[0].val)}).` : ""}</Insight>
          {projected > avgMonthlySpend * 1.2 && <Insight title="예산 경고" color="#e94560" bg="#fff5f5">이번 달 예상 {F(Math.round(projected))}로 평균({F(Math.round(avgMonthlySpend))}) 대비 {Math.round((projected / avgMonthlySpend - 1) * 100)}% 초과!</Insight>}
        </div>
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  Main Component                                                     */
/* ================================================================== */

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades?: StockTrade[];
  prices?: StockPrice[];
  fxRate?: number;
  categoryPresets: CategoryPresets;
  budgetGoals?: BudgetGoal[];
}

export const InsightsView: React.FC<Props> = ({ accounts, ledger, trades = [], prices: _p, fxRate: _f, categoryPresets: _c, budgetGoals: _b }) => {
  const [tab, setTab] = useState<TabId>("overview");
  const [selMonth, setSelMonth] = useState<string | null>(null);
  const d = useD(ledger, trades, accounts, selMonth);

  const dateRange = d.months.length > 0 ? `${d.months[0].replace("-", ".")} ~ ${d.months[d.months.length - 1].replace("-", ".")}` : "";
  const TabMap: Record<TabId, React.FC<{ d: D }>> = { overview: OverviewTab, expense: ExpenseTab, income: IncomeTab, date: DateTab, invest: InvestTab, sub: SubTab, pattern: PatternTab, velocity: VelocityTab };
  const ActiveTab = TabMap[tab];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, fontFamily: "'Pretendard Variable', 'Pretendard', -apple-system, sans-serif" }}>
      <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%)", padding: "24px 32px 18px", color: "#fff", borderRadius: "12px 12px 0 0", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase" as const, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>FarmWallet Analytics</div>
          <div style={{ fontSize: 26, fontWeight: 800 }}>가계부 인사이트 대시보드</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>{dateRange} · {d.txCount.toLocaleString()}건 분석</div>
        </div>
        <select value={selMonth ?? "all"} onChange={e => setSelMonth(e.target.value === "all" ? null : e.target.value)} style={{
          padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.1)",
          color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", outline: "none", minWidth: 120,
        }}>
          <option value="all" style={{ color: "#1a1a2e" }}>전체 기간</option>
          {[...d.months].reverse().map(m => <option key={m} value={m} style={{ color: "#1a1a2e" }}>{d.ml[m]} ({m})</option>)}
        </select>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, padding: "12px 24px", background: "#fff", borderBottom: "1px solid #eee", overflowX: "auto", flexWrap: "nowrap" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "8px 16px", borderRadius: 20, border: "none", cursor: "pointer", whiteSpace: "nowrap",
            fontSize: 13, fontWeight: tab === t.id ? 700 : 500,
            background: tab === t.id ? "#1a1a2e" : "transparent", color: tab === t.id ? "#fff" : "#666", transition: "all 0.2s",
          }}>{t.icon} {t.label}</button>
        ))}
        {selMonth && <span style={{ marginLeft: "auto", fontSize: 12, color: "#e94560", fontWeight: 700, alignSelf: "center", whiteSpace: "nowrap" }}>{d.ml[selMonth]} 선택됨</span>}
      </div>

      {/* Content */}
      <div style={{ padding: "20px 24px", maxWidth: 1200, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        <ActiveTab d={d} />
      </div>
    </div>
  );
};
