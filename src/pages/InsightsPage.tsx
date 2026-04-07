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
const SD = (a: number, b: number, f = 0): number => b !== 0 ? a / b : f;

function calcTrend(mt: number[]) {
  const nz = mt.filter(v => v > 0);
  const l2 = mt.slice(-2);
  const mom = l2.length === 2 && l2[0] > 0 ? Math.round((l2[1] - l2[0]) / l2[0] * 100) : 0;
  const tr: "up" | "down" | "flat" = mom > 10 ? "up" : mom < -10 ? "down" : "flat";
  const avg = nz.length > 0 ? Math.round(nz.reduce((a, b) => a + b, 0) / nz.length) : 0;
  return { monthTrend: tr, mom, nonZero: nz, monthAvg: avg };
}

function mTotalsFor(months: string[], ledger: LedgerEntry[], match: (l: LedgerEntry) => boolean): number[] {
  return months.map(m => {
    let t = 0;
    for (const l of ledger) {
      if (l.date?.slice(0, 7) !== m || !match(l)) continue;
      t += Number(l.amount);
    }
    return t;
  });
}

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

  /* ---- 카테고리별 세분화 ---- */
  incByGroup: { name: string; value: number; items: [string, number][] }[];
  investBySub: { sub: string; amount: number; count: number }[];
  dateByDetail: [string, number][];
  stockTrends: { name: string; data: { l: string; 누적매수: number }[] }[];
  subInsights: SubInsight[];
  incSubInsights: IncSubInsight[];
  dateSubInsights: DateSubInsight[];
  investSubInsights: InvestSubInsight[];
  realIncome: number;
  realExpense: number;
  settlementTotal: number;
  originalAssets: number;
  originalAssetsByAcct: { name: string; amount: number }[];
  /* ---- 계산 지표 ---- */
  netProfit: number;
  realSavRate: number;
  passiveIncome: number;
  expToIncRatio: number;
  dailyAvgExp: number;
  netCashFlow: number;
  incomeStability: number | null;
  investReturnRate: number;
  subTotal: number;
  fixedExpense: number;
  variableExpense: number;
}

interface SubInsight {
  sub: string; cat: string; total: number; count: number; avg: number;
  monthTrend: "up" | "down" | "flat"; mom: number; peak: string; share: number;
  monthAvg: number; maxSingle: number; maxSingleDesc: string;
  streakUp: number; // 연속 증가 월수
  topDesc: string; topDescAmt: number; // 해당 중분류 내 최다 지출 항목
  comment: string; // 자동 생성 코멘트
  mTotals: number[]; // 월별 데이터
}

interface IncSubInsight {
  sub: string; total: number; count: number; avg: number;
  monthTrend: "up" | "down" | "flat"; mom: number; share: number;
  monthAvg: number; stability: number; // 안정성 지수 (0~100)
  maxMonth: string; maxMonthAmt: number;
  comment: string;
}

interface DateSubInsight {
  sub: string; total: number; count: number; avg: number; share: number;
  maxSingle: number; maxSingleDesc: string;
  avgPerVisit: number; // 방문당 평균
  comment: string;
}

interface InvestSubInsight {
  sub: string; amount: number; count: number; avg: number; share: number;
  monthAvg: number;
  monthTrend: "up" | "down" | "flat"; mom: number;
  comment: string;
}

/* ================================================================== */
/*  Data computation hook                                              */
/* ================================================================== */

function useD(ledger: LedgerEntry[], rawTrades: StockTrade[], accounts: Account[], selMonth: string | null, categoryPresets?: CategoryPresets): D {
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
    const pSavRate = SD(pIncome - pExpense, pIncome) * 100;

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

    /* ===== 소득 분류 자동 감지 (하드코딩 제거) ===== */
    // 급여성: 활동 월의 40% 이상에 나타나는 수입 중분류 → 정기 소득
    const incSubMonths = new Map<string, Set<string>>();
    for (const l of ledger) {
      if (l.kind !== "income" || Number(l.amount) <= 0) continue;
      const m = l.date?.slice(0, 7); const sub = l.subCategory || l.category || "";
      if (!m || !sub) continue;
      if (!incSubMonths.has(sub)) incSubMonths.set(sub, new Set());
      incSubMonths.get(sub)!.add(m);
    }
    const salaryThreshold = Math.max(months.length * 0.4, 2);
    const salaryKeys = new Set<string>();
    for (const [sub, ms] of incSubMonths) { if (ms.size >= salaryThreshold) salaryKeys.add(sub); }
    // 투자/패시브: 투자 계좌에서 발생하는 수입 중분류 (급여성 제외)
    const investIncKeys = new Set<string>();
    for (const l of ledger) {
      if (l.kind !== "income" || Number(l.amount) <= 0) continue;
      const sub = l.subCategory || l.category || "";
      if (!sub || salaryKeys.has(sub)) continue;
      if (invIds.has(l.toAccountId || "") || invIds.has(l.fromAccountId || "")) investIncKeys.add(sub);
    }

    /* ===== trend data (full period) ===== */
    const savRateTrend = months.map(m => {
      const i = monthly[m].income, e = monthly[m].expense;
      return { l: ml[m], rate: SD(i - e, i) * 100, sav: i - e };
    });
    const salaryTrend = months.map(m => {
      let sal = 0, non = 0;
      for (const l of ledger) {
        if (l.kind !== "income" || l.date?.slice(0, 7) !== m || Number(l.amount) <= 0) continue;
        if (salaryKeys.has(l.subCategory || "")) sal += Number(l.amount); else non += Number(l.amount);
      }
      return { l: ml[m], salary: sal, nonSalary: non };
    });
    let ci = 0, ce = 0;
    const cumIE = months.map(m => { ci += monthly[m].income; ce += monthly[m].expense; return { l: ml[m], 누적수입: ci, 누적지출: ce }; });
    const investTrend = months.map(m => ({ l: ml[m], amount: monthly[m].investment }));
    const divTrend = months.map(m => {
      let d = 0;
      for (const l of ledger) { if (l.kind !== "income" || l.date?.slice(0, 7) !== m) continue; if (investIncKeys.has(l.subCategory || "")) d += Number(l.amount); }
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
      const avg = SD(t.buyTotal, t.buyCount);
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

    const fullMonths = Math.max(months.length, 1);
    const avgMonthExp = SD(months.reduce((s, m) => s + monthly[m].expense, 0), fullMonths);

    /* ===== 소득 그룹별 분류 ===== */
    const groupMap: Record<string, { total: number; items: Map<string, number> }> = {
      "회사소득": { total: 0, items: new Map() },
      "투자/패시브": { total: 0, items: new Map() },
      "기타수입": { total: 0, items: new Map() },
    };
    for (const [cat, val] of incByCat) {
      const g = salaryKeys.has(cat) ? "회사소득" : investIncKeys.has(cat) ? "투자/패시브" : "기타수입";
      groupMap[g].total += val;
      groupMap[g].items.set(cat, (groupMap[g].items.get(cat) ?? 0) + val);
    }
    const incByGroup = Object.entries(groupMap)
      .filter(([, v]) => v.total > 0)
      .map(([name, v]) => ({ name, value: v.total, items: [...v.items.entries()].sort((a, b) => b[1] - a[1]) }))
      .sort((a, b) => b.value - a.value);

    /* ===== 재테크 중분류별 분류 ===== */
    const ivSubM = new Map<string, { amount: number; count: number }>();
    for (const l of fL) {
      if (l.kind !== "expense" || l.category !== "재테크") continue;
      const sub = l.subCategory || "기타";
      const p = ivSubM.get(sub) ?? { amount: 0, count: 0 };
      ivSubM.set(sub, { amount: p.amount + Number(l.amount), count: p.count + 1 });
    }
    const investBySub = [...ivSubM.entries()].map(([sub, v]) => ({ sub, ...v })).sort((a, b) => b.amount - a.amount);

    /* ===== 데이트 소분류별 ===== */
    const dateDetM = new Map<string, number>();
    for (const l of fL) {
      if (!isDateEntry(l)) continue;
      const det = l.detailCategory || l.description || "기타";
      dateDetM.set(det, (dateDetM.get(det) ?? 0) + Number(l.amount));
    }
    const dateByDetail = [...dateDetM.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

    /* ===== 종목별 누적 매수금액 추이 (상위 종목 자동 감지) ===== */
    const stockBuyTotals = new Map<string, number>();
    for (const t of rawTrades) {
      if (t.side !== "buy") continue;
      const name = t.name || t.ticker || "";
      if (!name) continue;
      stockBuyTotals.set(name, (stockBuyTotals.get(name) ?? 0) + (t.fxRateAtTrade ? t.totalAmount * t.fxRateAtTrade : t.totalAmount));
    }
    const trackedStocks = [...stockBuyTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
    const stockTrends = trackedStocks.map(stockName => {
      const prefix = stockName.split(" ").slice(0, 2).join(" ");
      const cumByMonth = new Map<string, number>();
      let cum = 0;
      for (const m of months) {
        for (const t of rawTrades) {
          if (t.date?.slice(0, 7) !== m) continue;
          if (!t.name?.includes(prefix)) continue;
          const kr = t.fxRateAtTrade ? t.totalAmount * t.fxRateAtTrade : t.totalAmount;
          if (t.side === "buy") cum += kr; else cum -= kr;
        }
        cumByMonth.set(m, cum);
      }
      const data = months.filter(m => cumByMonth.get(m) !== 0 || months.indexOf(m) >= months.findIndex(mm => (cumByMonth.get(mm) ?? 0) !== 0))
        .map(m => ({ l: ml[m], 누적매수: cumByMonth.get(m) ?? 0 }));
      return { name: stockName, data };
    }).filter(s => s.data.length > 0);

    /* ===== 지출 중분류별 인사이트 ===== */
    const subInsights: SubInsight[] = expBySub.slice(0, 15).map(s => {
      const mTotals = mTotalsFor(months, ledger, l =>
        l.kind === "expense" && l.category !== "재테크" && l.category !== "환전" &&
        (l.subCategory || l.category || "기타") === s.sub
      );
      const { monthTrend, mom, nonZero, monthAvg } = calcTrend(mTotals);
      const last2 = mTotals.slice(-2);
      const peakIdx = mTotals.length > 0 ? mTotals.indexOf(Math.max(...mTotals)) : -1;
      // 해당 중분류 최대 단건
      let maxSingle = 0, maxSingleDesc = "";
      for (const l of fExp) {
        if ((l.subCategory || l.category || "기타") !== s.sub) continue;
        const a = Number(l.amount);
        if (a > maxSingle) { maxSingle = a; maxSingleDesc = l.description || l.subCategory || ""; }
      }
      // 해당 중분류 내 최다 지출 항목(description)
      const descMap = new Map<string, number>();
      for (const l of fExp) {
        if ((l.subCategory || l.category || "기타") !== s.sub) continue;
        const d = l.description || "기타";
        descMap.set(d, (descMap.get(d) ?? 0) + Number(l.amount));
      }
      const topDescEntry = [...descMap.entries()].sort((a, b) => b[1] - a[1])[0];
      // 연속 증가 월수
      let streakUp = 0;
      for (let i = mTotals.length - 1; i >= 1; i--) {
        if (mTotals[i] > mTotals[i - 1] && mTotals[i] > 0) streakUp++; else break;
      }
      const share = Math.round(SD(s.amount, pExpense) * 100);
      // 2번째 지출처
      const topDesc2 = [...descMap.entries()].sort((a, b) => b[1] - a[1])[1];
      // 월별 변동성
      const mStd = nonZero.length >= 2 ? Math.sqrt(nonZero.reduce((ss, v) => ss + (v - monthAvg) ** 2, 0) / nonZero.length) : 0;
      const mCV = monthAvg > 0 ? Math.round(mStd / monthAvg * 100) : 0;
      // 지출 빈도 (월당 평균 건수)
      const freqPerMonth = nonZero.length > 0 ? Math.round(s.count / nonZero.length * 10) / 10 : 0;
      // 자동 코멘트 생성
      const comments: string[] = [];
      // 추세 코멘트
      if (monthTrend === "up" && mom > 50) comments.push(`전월 대비 ${mom}% 급증했습니다. 일시적 지출인지 구조적 증가인지 확인이 필요합니다. 이 속도가 계속되면 연간 ${F(Math.round(last2[1] * 12))} 이상 지출될 수 있습니다.`);
      else if (monthTrend === "up" && mom > 30) comments.push(`전월 대비 ${mom}% 증가했습니다. 특정 이벤트나 구매가 있었는지 확인해 보세요.`);
      else if (monthTrend === "up") comments.push(`전월 대비 ${mom}% 소폭 증가 추세입니다.`);
      else if (monthTrend === "down" && Math.abs(mom) > 50) comments.push(`전월 대비 ${Math.abs(mom)}% 대폭 감소! 훌륭한 절약입니다. 이 습관을 유지하세요.`);
      else if (monthTrend === "down" && Math.abs(mom) > 30) comments.push(`전월 대비 ${Math.abs(mom)}% 감소했습니다. 좋은 흐름이에요!`);
      else if (monthTrend === "down") comments.push(`전월 대비 ${Math.abs(mom)}% 소폭 감소 중입니다.`);
      else comments.push("전월과 비슷한 수준을 유지하고 있습니다.");
      // 연속 증가 경고
      if (streakUp >= 4) comments.push(`${streakUp}개월 연속 증가 중! 습관적 소비 증가가 고착화되고 있을 수 있습니다. 예산 한도를 설정해 보세요.`);
      else if (streakUp >= 2) comments.push(`${streakUp}개월 연속 증가 추세입니다.`);
      // 비중 코멘트
      if (share > 30) comments.push(`전체 지출의 ${share}%로 압도적 비중입니다. 이 카테고리를 10%만 줄여도 월 ${F(Math.round(monthAvg * 0.1))} 절약 효과가 있습니다.`);
      else if (share > 15) comments.push(`전체 지출의 ${share}%로 주요 지출 카테고리입니다.`);
      else if (share > 5) comments.push(`전체 지출의 ${share}%를 차지합니다.`);
      // 빈도 코멘트
      if (freqPerMonth > 15) comments.push(`월평균 ${freqPerMonth}건으로 거의 매일 지출합니다. 자동결제나 습관적 소비가 포함되어 있을 수 있습니다.`);
      else if (freqPerMonth > 8) comments.push(`월평균 ${freqPerMonth}건으로 빈번하게 지출합니다.`);
      else if (freqPerMonth < 2 && s.count > 0) comments.push(`월평균 ${freqPerMonth}건으로 비정기 지출입니다. 고액 지출이 간헐적으로 발생하는 패턴입니다.`);
      // 건당 평균
      const avgPerTx = Math.round(SD(s.amount, s.count));
      if (avgPerTx > 100000) comments.push(`건당 평균 ${F(avgPerTx)}으로 고단가 지출입니다. 구매 전 필요성을 한 번 더 확인하는 습관이 도움됩니다.`);
      else if (avgPerTx > 30000) comments.push(`건당 평균 ${F(avgPerTx)} 수준입니다.`);
      // 변동성 코멘트
      if (mCV > 60) comments.push(`월별 변동성이 ${mCV}%로 큽니다. 비정기 대량 구매가 영향을 줍니다.`);
      else if (mCV < 20 && nonZero.length >= 3) comments.push(`월별 변동성이 ${mCV}%로 매우 안정적인 지출 패턴입니다.`);
      // 지출처 정보
      if (topDescEntry) {
        const topShare = s.amount > 0 ? Math.round(topDescEntry[1] / s.amount * 100) : 0;
        comments.push(`주요 지출처: ${topDescEntry[0]}(${F(topDescEntry[1])}, ${topShare}%).`);
        if (topDesc2) comments.push(`2위: ${topDesc2[0]}(${F(topDesc2[1])}).`);
      }
      // 최대 단건
      if (maxSingle > avgPerTx * 3 && maxSingleDesc) comments.push(`최대 단건 ${maxSingleDesc}(${F(maxSingle)})은 평균의 ${Math.round(SD(maxSingle, avgPerTx))}배입니다.`);
      // 피크월
      if (months[peakIdx]) comments.push(`지출 최고월: ${ml[months[peakIdx]]}(${F(mTotals[peakIdx])}).`);

      return {
        sub: s.sub, cat: s.cat, total: s.amount, count: s.count,
        avg: Math.round(SD(s.amount, s.count)),
        monthTrend, mom, peak: peakIdx >= 0 && months[peakIdx] ? ml[months[peakIdx]] : "", share,
        monthAvg, maxSingle, maxSingleDesc,
        streakUp,
        topDesc: topDescEntry?.[0] ?? "", topDescAmt: topDescEntry?.[1] ?? 0,
        comment: comments.join(" "),
        mTotals,
      };
    });

    /* ===== 수입 중분류별 인사이트 ===== */
    const incSubInsights: IncSubInsight[] = incByCat.slice(0, 12).map(([sub, total]) => {
      const cnt = fInc.filter(l => (l.subCategory || l.category || "기타") === sub).length;
      const fullMTotals = mTotalsFor(months, ledger, l =>
        l.kind === "income" && (l.subCategory || l.category || "기타") === sub
      );
      const { monthTrend, mom, nonZero, monthAvg } = calcTrend(fullMTotals);
      // 안정성 지수
      let stability = 0;
      if (nonZero.length >= 2) {
        const mean = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
        const std = Math.sqrt(nonZero.reduce((s, v) => s + (v - mean) ** 2, 0) / nonZero.length);
        stability = mean > 0 ? Math.round((1 - SD(std, mean)) * 100) : 0;
      }
      // 최대 수입 월
      const maxIdx = fullMTotals.length > 0 ? fullMTotals.indexOf(Math.max(...fullMTotals)) : -1;
      const maxMonth = maxIdx >= 0 && months[maxIdx] ? ml[months[maxIdx]] : "";
      const maxMonthAmt = fullMTotals[maxIdx] ?? 0;
      const avg = Math.round(SD(total, cnt));
      const share = Math.round(SD(total, pIncome) * 100);
      // 수입 발생 빈도
      const incFreq = Math.round(SD(nonZero.length, months.length) * 100);
      // 코멘트
      const cs: string[] = [];
      if (share > 50) cs.push(`전체 수입의 ${share}%로 핵심 수입원입니다. 이 수입이 줄어들면 가계에 큰 영향을 미칩니다.`);
      else if (share > 20) cs.push(`전체 수입의 ${share}%를 차지하는 중요한 수입원입니다.`);
      else if (share > 5) cs.push(`전체 수입의 ${share}%를 차지합니다.`);
      else cs.push(`전체 수입의 ${share}%로 소규모 수입원입니다.`);
      // 안정성 상세
      if (stability >= 80) cs.push(`안정성 ${stability}%로 매우 안정적입니다. 예측 가능한 수입으로 재무 계획에 신뢰할 수 있습니다.`);
      else if (stability >= 60) cs.push(`안정성 ${stability}%로 비교적 안정적입니다.`);
      else if (stability >= 40) cs.push(`안정성 ${stability}%로 변동이 있습니다. 이 수입에만 의존하지 않도록 주의하세요.`);
      else if (nonZero.length >= 2) cs.push(`안정성 ${stability}%로 변동폭이 매우 큽니다. 비정기적 수입이므로 이를 고정 지출 계획에 포함하면 위험합니다.`);
      // 추세 상세
      if (monthTrend === "up" && mom > 30) cs.push(`최근 ${mom}% 급증! 매우 긍정적인 흐름입니다.`);
      else if (monthTrend === "up") cs.push(`최근 ${mom}% 증가 추세로 좋은 방향입니다.`);
      else if (monthTrend === "down" && Math.abs(mom) > 30) cs.push(`최근 ${Math.abs(mom)}% 급감! 원인을 파악하고 대응 방안을 마련하세요.`);
      else if (monthTrend === "down") cs.push(`최근 ${Math.abs(mom)}% 감소 중입니다.`);
      else cs.push("최근 안정적인 수준을 유지 중입니다.");
      // 빈도
      if (incFreq >= 90) cs.push(`${months.length}개월 중 ${nonZero.length}개월 발생 — 매월 꾸준히 들어오는 수입입니다.`);
      else if (incFreq >= 50) cs.push(`${months.length}개월 중 ${nonZero.length}개월 발생 — 비교적 자주 들어옵니다.`);
      else if (nonZero.length >= 1) cs.push(`${months.length}개월 중 ${nonZero.length}개월만 발생 — 비정기 수입입니다.`);
      // 월평균과 최대 비교
      if (maxMonth && maxMonthAmt > monthAvg * 2) cs.push(`최대 수입월 ${maxMonth}(${F(maxMonthAmt)})은 월평균(${F(monthAvg)})의 ${Math.round(SD(maxMonthAmt, monthAvg))}배 — 특별 수입이 있었습니다.`);
      else if (maxMonth) cs.push(`최대 수입월: ${maxMonth}(${F(maxMonthAmt)}), 월평균 ${F(monthAvg)}.`);
      if (cnt > 0) cs.push(`총 ${cnt}건 발생, 건당 평균 ${F(avg)}.`);
      return { sub, total, count: cnt, avg, monthTrend, mom, share, monthAvg, stability, maxMonth, maxMonthAmt, comment: cs.join(" ") };
    });

    /* ===== 데이트 중분류별 인사이트 ===== */
    const dTotal = dateEntries.reduce((s, e) => s + e.amount, 0);
    const dateSubInsights: DateSubInsight[] = dateSubCats.slice(0, 10).map(([sub, total]) => {
      const entries = dateEntries.filter(e => e.sub === sub);
      const avg = Math.round(SD(total, entries.length));
      // 최대 단건
      let maxSingle = 0, maxSingleDesc = "";
      for (const e of entries) { if (e.amount > maxSingle) { maxSingle = e.amount; maxSingleDesc = e.desc || sub; } }
      // 방문(날짜) 기준 평균
      const uniqueDates = new Set(entries.map(e => e.date));
      const avgPerVisit = Math.round(SD(total, uniqueDates.size));
      const share = Math.round(SD(total, dTotal) * 100);
      // 코멘트
      const cs: string[] = [];
      if (share > 40) cs.push(`데이트 지출의 ${share}%로 압도적 비중! 이 카테고리가 데이트비의 핵심입니다.`);
      else if (share > 25) cs.push(`데이트 지출의 ${share}%로 가장 큰 비중을 차지합니다.`);
      else if (share > 10) cs.push(`데이트 지출의 ${share}%로 주요 데이트 활동입니다.`);
      else cs.push(`데이트 지출의 ${share}%를 차지합니다.`);
      cs.push(`총 ${entries.length}건 발생, 건당 평균 ${F(avg)}.`);
      if (uniqueDates.size > 0) {
        cs.push(`${uniqueDates.size}일에 걸쳐 이용, 이용일당 평균 ${F(avgPerVisit)}.`);
        if (entries.length > uniqueDates.size * 1.5) cs.push(`같은 날 여러 건 결제하는 패턴이 있습니다.`);
      }
      if (maxSingle > avg * 3 && maxSingleDesc) cs.push(`최대 단건 ${maxSingleDesc}(${F(maxSingle)})은 평균의 ${Math.round(SD(maxSingle, avg))}배로 특별한 지출이었습니다.`);
      else if (maxSingle > avg * 1.5 && maxSingleDesc) cs.push(`최대 단건: ${maxSingleDesc}(${F(maxSingle)}).`);
      // 가성비 제안
      if (avg > 50000) cs.push(`건당 평균이 높은 편입니다. 할인 혜택이나 가성비 좋은 대안을 찾아보세요.`);
      else if (avg < 10000 && entries.length > 5) cs.push(`소액 다빈도 패턴입니다. 알뜰하게 데이트하고 있어요!`);
      return { sub, total, count: entries.length, avg, share, maxSingle, maxSingleDesc, avgPerVisit, comment: cs.join(" ") };
    });

    /* ===== 재테크 중분류별 인사이트 ===== */
    const investSubInsights: InvestSubInsight[] = investBySub.map(v => {
      const ivTotal = investBySub.reduce((s, x) => s + x.amount, 0);
      const share = Math.round(SD(v.amount, ivTotal) * 100);
      const avg = Math.round(SD(v.amount, v.count));
      // 월별 추이
      const ivMTotals = mTotalsFor(months, ledger, l =>
        l.kind === "expense" && l.category === "재테크" && (l.subCategory || "기타") === v.sub
      );
      const { monthTrend: ivTrend, mom: ivMom, nonZero: ivNonZero, monthAvg } = calcTrend(ivMTotals);
      const cs: string[] = [];
      if (share > 40) cs.push(`재테크 지출의 ${share}%로 가장 큰 투자 카테고리입니다.`);
      else if (share > 20) cs.push(`재테크 지출의 ${share}%로 주요 투자 항목입니다.`);
      else cs.push(`재테크 지출의 ${share}%를 차지합니다.`);
      cs.push(`총 ${v.count}건 거래, 건당 평균 ${F(avg)}.`);
      if (monthAvg > 0) cs.push(`월평균 ${F(monthAvg)} 투자. 연간으로 환산하면 약 ${F(monthAvg * 12)}.`);
      if (ivTrend === "up" && ivMom > 30) cs.push(`최근 투자 금액이 ${ivMom}% 급증! 투자 확대 중입니다.`);
      else if (ivTrend === "up") cs.push(`최근 ${ivMom}% 투자 금액이 증가 중입니다.`);
      else if (ivTrend === "down" && Math.abs(ivMom) > 30) cs.push(`최근 ${Math.abs(ivMom)}% 투자 금액이 급감했습니다. 시장 상황이나 자금 사정 변화를 확인하세요.`);
      else if (ivTrend === "down") cs.push(`최근 ${Math.abs(ivMom)}% 투자 금액이 감소 중입니다.`);
      else cs.push("최근 안정적인 투자 금액을 유지하고 있습니다.");
      // 빈도 분석
      const ivFreq = Math.round(SD(ivNonZero.length, months.length) * 100);
      if (ivFreq >= 90) cs.push(`${months.length}개월 중 ${ivNonZero.length}개월 투자 — 매월 꾸준히 적립하는 훌륭한 습관입니다!`);
      else if (ivFreq >= 60) cs.push(`${months.length}개월 중 ${ivNonZero.length}개월 투자 — 비교적 자주 투자합니다.`);
      else if (ivNonZero.length >= 2) cs.push(`${months.length}개월 중 ${ivNonZero.length}개월만 투자 — 비정기적 투자 패턴입니다. 자동이체 적립식 투자를 추천합니다.`);
      else if (ivNonZero.length === 1) cs.push("단 1번만 투자한 항목입니다.");
      return { sub: v.sub, amount: v.amount, count: v.count, avg, share, monthAvg, monthTrend: ivTrend, mom: ivMom, comment: cs.join(" ") };
    });

    /* ===== 정산 제외 실질 수입/지출 + 원래 보유 자산 ===== */
    let settlementTotal = 0;
    let originalAssetsFromLedger = 0;
    for (const l of fInc) {
      const sub = (l.subCategory || l.category || "").trim();
      if (sub === "정산" || sub.includes("정산")) settlementTotal += Number(l.amount);
      if (sub === "이월" || sub.includes("이월")) originalAssetsFromLedger += Number(l.amount);
    }
    // 원래 보유 자산: Account.initialBalance 기반 (계좌별 역산)
    const originalAssetsByAcct = accounts
      .filter(a => (a.initialBalance ?? 0) > 0)
      .map(a => ({ name: a.name, amount: a.initialBalance ?? 0 }))
      .sort((a, b) => b.amount - a.amount);
    const originalAssets = originalAssetsByAcct.reduce((s, a) => s + a.amount, 0);
    // 실질 수입: 원래 보유 자산(수입이 아님)과 정산(비용 분담 회수) 제외
    const realIncome = pIncome - settlementTotal - originalAssetsFromLedger;
    const realExpense = pExpense - settlementTotal;

    /* ===== 추가 계산 지표 ===== */
    const netProfit = realIncome - realExpense;
    const realSavRate = realIncome > 0 ? (realIncome - realExpense) / realIncome * 100 : 0;
    let passiveIncome = 0;
    for (const [cat, val] of incByCat) { if (investIncKeys.has(cat)) passiveIncome += val; }
    const expToIncRatio = pIncome > 0 ? pExpense / pIncome * 100 : 0;
    const dailyAvgExp = totalDays > 0 ? Math.round(pExpense / totalDays) : 0;
    const netCashFlow = pIncome - pExpense - pInvest;
    // 수입 안정성
    const incVals = months.filter(m => monthly[m].income > 0).map(m => monthly[m].income);
    let incomeStability: number | null = null;
    if (incVals.length >= 2) {
      const iMean = incVals.reduce((a, b) => a + b, 0) / incVals.length;
      const iStd = Math.sqrt(incVals.reduce((s, v) => s + (v - iMean) ** 2, 0) / incVals.length);
      incomeStability = iMean > 0 ? Math.round((1 - iStd / iMean) * 100) : 0;
    }
    // totalInvested for invest return (보유종목 총 매수)
    const totalInvested = trades.filter(v => v.buyCount - v.sellCount > 0).reduce((s, v) => s + v.buyTotal, 0);
    const investReturnRate = plTot !== 0 && totalInvested > 0 ? plTot / totalInvested * 100 : 0;
    const subTotal = subs.reduce((a, s) => a + s.total, 0);
    // 고정비 vs 변동비 — categoryPresets.categoryTypes.fixed 기반
    const fixedMains = new Set(categoryPresets?.categoryTypes?.fixed ?? []);
    const fixedCats = new Set<string>(fixedMains);
    // 고정비 대분류에 속하는 중분류도 고정비로 포함
    for (const g of categoryPresets?.expenseDetails ?? []) {
      if (fixedMains.has(g.main)) for (const s of g.subs) fixedCats.add(s);
    }
    // isFixedExpense 플래그가 있는 항목도 고정비 처리
    let fixedExpense = 0, variableExpense = 0;
    for (const l of fExp) {
      const cat = (l.subCategory || l.category || "").trim();
      if (l.isFixedExpense || fixedCats.has(cat) || fixedCats.has(l.category || "")) fixedExpense += Number(l.amount);
      else variableExpense += Number(l.amount);
    }

    return {
      months, ml, selMonth, txCount: fL.length,
      monthly, savRateTrend, salaryTrend, cumIE, investTrend, divTrend, tradeCntTrend, subTrend, txCntTrend, cumSpend, monthlyCatTrend, dateExpMonthly,
      pIncome, pExpense, pInvest, pSavRate, expByCat, expBySub, topCats, acctUsage, wdSpend, dateTop, dateSubCats, dateEntries, dateTxCount, incByCat, trades, subs, largeExp, topTx, expBySubCat, expByDesc, dateMoim, datePersonal, spendByDOM, portfolio, realPL: { total: plTot, wins: plWin, losses: plLoss, winCnt: plWC, lossCnt: plLC },
      zeroDays, totalDays, weekendTot, weekdayTot, topDates,
      score: { total: scorePts, grade, comment: comments[grade] || "" }, prev, avgMonthExp,
      incByGroup, investBySub, dateByDetail, stockTrends,
      subInsights, incSubInsights, dateSubInsights, investSubInsights,
      realIncome, realExpense, settlementTotal, originalAssets, originalAssetsByAcct,
      netProfit, realSavRate, passiveIncome, expToIncRatio, dailyAvgExp, netCashFlow,
      incomeStability, investReturnRate, subTotal, fixedExpense, variableExpense,
    };
  }, [ledger, rawTrades, accounts, selMonth, categoryPresets]);
}

/* ================================================================== */
/*  Tab: 종합 대시보드                                                  */
/* ================================================================== */

function OverviewTab({ d }: { d: D }) {
  const totals = d.months.reduce((a, m) => { a.i += d.monthly[m].income; a.e += d.monthly[m].expense; a.v += d.monthly[m].investment; return a; }, { i: 0, e: 0, v: 0 });
  const barData = d.months.map(m => ({ name: d.ml[m], 수입: d.monthly[m].income, 지출: d.monthly[m].expense, 투자: d.monthly[m].investment }));
  const flowData = d.months.slice(0, -1).map(m => ({ name: d.ml[m], 순현금흐름: d.monthly[m].income - d.monthly[m].expense - d.monthly[m].investment }));
  const expBadge = d.prev ? Pct(SD(d.pExpense - d.prev.expense, d.prev.expense) * 100) + " vs 전월" : undefined;
  const incBadge = d.prev ? Pct(SD(d.pIncome - d.prev.income, d.prev.income) * 100) + " vs 전월" : undefined;
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

      {(d.settlementTotal > 0 || d.originalAssets > 0) && (
        <Card title="실질 수입/지출 (정산·원래 보유 자산 제외)" span={4}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, fontSize: 13 }}>
            <div style={{ padding: "12px 14px", background: "#f0fdf4", borderRadius: 10, border: "1px solid #86efac" }}>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>실질 수입</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#059669" }}>{F(d.realIncome)}</div>
              <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>정산({F(d.settlementTotal)}), 보유자산({F(d.originalAssets)}) 제외</div>
            </div>
            <div style={{ padding: "12px 14px", background: "#fff5f5", borderRadius: 10, border: "1px solid #fcc" }}>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>실질 지출</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#e94560" }}>{F(d.realExpense)}</div>
              <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>정산분({F(d.settlementTotal)}) 차감 반영</div>
            </div>
            <div style={{ padding: "12px 14px", background: "#f0f8ff", borderRadius: 10, border: "1px solid #bde" }}>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>실질 저축률</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#2563eb" }}>{d.realIncome > 0 ? ((d.realIncome - d.realExpense) / d.realIncome * 100).toFixed(1) : "0"}%</div>
              <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>원래 보유 자산은 수입이 아니므로 제외</div>
            </div>
            <div style={{ padding: "12px 14px", background: "#fdf5e6", borderRadius: 10, border: "1px solid #f0c040" }}>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>실질 순수익</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: d.realIncome - d.realExpense >= 0 ? "#059669" : "#e94560" }}>{F(d.realIncome - d.realExpense)}</div>
              <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>정산 차감, 보유자산 제외 기준</div>
            </div>
          </div>
          {d.originalAssetsByAcct.length > 0 && (
            <div style={{ marginTop: 12, padding: "12px 16px", background: "#f8f9fa", borderRadius: 10, border: "1px solid #eee" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 8 }}>계좌별 원래 보유 자산 (가계부 시작 시점 잔액)</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
                {d.originalAssetsByAcct.map(a => (
                  <div key={a.name} style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", background: "#fff", borderRadius: 6, border: "1px solid #eee", fontSize: 12 }}>
                    <span style={{ color: "#666" }}>{a.name}</span>
                    <span style={{ fontWeight: 700, color: "#0f3460" }}>{F(a.amount)}</span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: "#999", marginTop: 6 }}>합계: {W(d.originalAssets)} — 이 금액은 새로 번 소득이 아니라 기존에 보유하고 있던 자산입니다</div>
            </div>
          )}
        </Card>
      )}

      <Card title="핵심 재무 지표" span={4}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10 }}>
          {[
            { label: "순수익", value: F(d.netProfit), sub: "실질수입 - 실질지출", color: d.netProfit >= 0 ? "#059669" : "#e94560", bg: d.netProfit >= 0 ? "#f0fdf4" : "#fff5f5", border: d.netProfit >= 0 ? "#86efac" : "#fcc" },
            { label: "실질 저축률", value: d.realSavRate.toFixed(1) + "%", sub: "정산·보유자산 제외 기준", color: d.realSavRate >= 30 ? "#059669" : d.realSavRate >= 0 ? "#f0c040" : "#e94560", bg: "#f0f8ff", border: "#bde" },
            { label: "지출/수입 비율", value: d.expToIncRatio.toFixed(1) + "%", sub: d.expToIncRatio > 80 ? "지출 비중 높음!" : "양호", color: d.expToIncRatio > 80 ? "#e94560" : "#2563eb", bg: "#f8f9fa", border: "#eee" },
            { label: "패시브 수입", value: F(d.passiveIncome), sub: `수입 대비 ${d.pIncome > 0 ? Math.round(SD(d.passiveIncome, d.pIncome) * 100) : 0}%`, color: "#48c9b0", bg: "#f0fdf4", border: "#86efac" },
            { label: "일 평균 지출", value: F(d.dailyAvgExp), sub: `${d.totalDays}일 기준`, color: "#533483", bg: "rgba(83,52,131,0.06)", border: "rgba(83,52,131,0.2)" },
          ].map(m => (
            <div key={m.label} style={{ padding: "12px 14px", background: m.bg, borderRadius: 10, border: `1px solid ${m.border}`, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 4, fontWeight: 600 }}>{m.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: m.color }}>{m.value}</div>
              <div style={{ fontSize: 10, color: "#999", marginTop: 4 }}>{m.sub}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginTop: 10 }}>
          {[
            { label: "순현금흐름", value: F(d.netCashFlow), sub: "수입-지출-투자", color: d.netCashFlow >= 0 ? "#059669" : "#e94560" },
            { label: "투자 수익률", value: d.investReturnRate !== 0 ? d.investReturnRate.toFixed(1) + "%" : "-", sub: "실현손익/투자원금", color: d.investReturnRate >= 0 ? "#059669" : "#e94560" },
            { label: "고정비", value: F(d.fixedExpense), sub: `전체 지출의 ${Math.round(SD(d.fixedExpense, d.pExpense) * 100)}%`, color: "#0f3460" },
            { label: "변동비", value: F(d.variableExpense), sub: `전체 지출의 ${Math.round(SD(d.variableExpense, d.pExpense) * 100)}%`, color: "#f39c12" },
            { label: "수입 안정성", value: d.incomeStability !== null ? d.incomeStability + "%" : "-", sub: d.incomeStability !== null && d.incomeStability >= 70 ? "안정적" : "변동 있음", color: "#2563eb" },
          ].map(m => (
            <div key={m.label} style={{ padding: "10px 12px", background: "#f8f9fa", borderRadius: 8, border: "1px solid #eee", textAlign: "center" }}>
              <div style={{ fontSize: 10, color: "#999", fontWeight: 600 }}>{m.label}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: m.color, marginTop: 2 }}>{m.value}</div>
              <div style={{ fontSize: 10, color: "#aaa", marginTop: 2 }}>{m.sub}</div>
            </div>
          ))}
        </div>
      </Card>

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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Insight title="저축률 분석" color="#059669" bg="#d4edda">
            {d.pSavRate >= 30
              ? `저축률 ${d.pSavRate.toFixed(0)}%로 매우 건강한 수준입니다. 수입 ${F(d.pIncome)} 중 ${F(Math.round(d.pIncome * d.pSavRate / 100))}을 저축하고 있습니다. 이 속도라면 연간 약 ${F(Math.round(d.pIncome * d.pSavRate / 100 * 12 / Math.max(d.months.length, 1)))} 이상 자산 증가가 가능합니다.`
              : d.pSavRate >= 0
              ? `저축률 ${d.pSavRate.toFixed(0)}%로 개선 여지가 있습니다. 30% 이상을 목표로 월 ${F(Math.round(d.pExpense * 0.1))} 정도 추가 절약하면 장기적으로 큰 차이를 만들 수 있습니다.`
              : `마이너스 저축률! 수입보다 지출이 ${F(d.pExpense - d.pIncome)} 더 많습니다. 고정비와 변동비를 점검하고, 상위 지출 카테고리부터 줄여보세요.`}
          </Insight>
          <Insight title="지출 집중도 분석" color="#b45309" bg="#fff3cd">
            상위 3개 중분류({top3Sub.map(s => s.sub).join(", ")})가 전체 지출의 {top3pct}%를 차지합니다.
            {top3pct > 70 ? ` 지출이 소수 카테고리에 집중되어 있어 해당 항목의 절약이 전체 지출 감소에 큰 효과를 줍니다. 특히 1위 ${top3Sub[0]?.sub}(${F(top3Sub[0]?.amount ?? 0)})에 집중해 보세요.` : ` 비교적 골고루 분산되어 있어 특정 항목보다 전반적인 소비 습관 개선이 효과적입니다.`}
            {top3Sub[0] && d.pExpense > 0 && ` 1위 ${top3Sub[0].sub}만 10% 줄여도 월 ${F(Math.round(top3Sub[0].amount * 0.1 / Math.max(d.months.length, 1)))} 절약.`}
          </Insight>
          <Insight title="투자 현황" color="#2563eb" bg="#cce5ff">
            {d.pIncome > 0
              ? `수입 대비 투자 비율 ${Math.round(d.pInvest / d.pIncome * 100)}%. 총 ${F(d.pInvest)}를 투자에 할당했습니다.`
              : ""}
            {d.pInvest > 0
              ? ` 월평균 ${F(Math.round(d.pInvest / Math.max(d.months.length, 1)))} 투자. ${d.pInvest / Math.max(d.pIncome, 1) > 0.2 ? "적극적으로 투자하고 있어 장기적 자산 성장이 기대됩니다." : "투자 비중을 수입의 20% 이상으로 높이면 복리 효과가 커집니다."}`
              : " 투자 활동이 없습니다. 소액이라도 ETF 적립식 투자를 시작해 보세요."}
          </Insight>
          <Insight title="소비 습관" color="#7c3aed" bg="rgba(139,92,246,0.08)">
            {d.zeroDays > 0 ? `${d.totalDays}일 중 ${d.zeroDays}일 무지출 달성 (${Math.round(d.zeroDays / Math.max(d.totalDays, 1) * 100)}%).` : "무지출일이 없습니다."}
            {d.weekendTot + d.weekdayTot > 0 && ` 주말 지출 ${Math.round(d.weekendTot / (d.weekendTot + d.weekdayTot) * 100)}%, 주중 ${Math.round(d.weekdayTot / (d.weekendTot + d.weekdayTot) * 100)}%.`}
            {d.zeroDays > d.totalDays * 0.2 ? " 무지출 비율이 높아 소비 통제력이 좋습니다!" : d.zeroDays > 0 ? " 무지출일을 더 늘려보세요. 주 1~2일 무지출 챌린지를 추천합니다." : " 주 1일이라도 무지출 챌린지를 시작해 보세요."}
            {d.pExpense > 0 && ` 일 평균 지출 ${F(d.dailyAvgExp)}.`}
          </Insight>
          {d.prev && (
            <Insight title="전월 대비 변화" color="#0f3460" bg="#f0f8ff">
              수입 {d.pIncome >= d.prev.income ? "+" : ""}{F(d.pIncome - d.prev.income)} ({d.prev.income > 0 ? Pct((d.pIncome - d.prev.income) / d.prev.income * 100) : "N/A"}),
              지출 {d.pExpense >= d.prev.expense ? "+" : ""}{F(d.pExpense - d.prev.expense)} ({d.prev.expense > 0 ? Pct((d.pExpense - d.prev.expense) / d.prev.expense * 100) : "N/A"}).
              {d.pExpense > d.prev.expense ? ` 지출이 ${F(d.pExpense - d.prev.expense)} 증가했습니다. 어떤 카테고리에서 증가했는지 지출 분석 탭에서 확인하세요.` : ` 지출이 ${F(d.prev.expense - d.pExpense)} 감소했습니다. 좋은 흐름입니다!`}
            </Insight>
          )}
          <Insight title="수입 다각화" color="#e94560" bg="#fff5f5">
            {d.incByCat.length}개 수입원 보유.
            {d.incByCat.length >= 5 ? " 수입 다각화가 잘 되어 있습니다. 하나의 수입원이 줄어도 타격이 적습니다." : d.incByCat.length >= 3 ? " 수입원이 적당히 분산되어 있습니다." : " 수입원이 1~2개로 집중되어 있어 리스크가 있습니다. 부업이나 투자 수입을 늘려보세요."}
            {d.incByCat[0] && d.pIncome > 0 && ` 최대 수입원: ${d.incByCat[0][0]}(${Math.round(SD(d.incByCat[0][1], d.pIncome) * 100)}%).`}
          </Insight>
          <Insight title="순수익 분석" color="#059669" bg="#ecfdf5">
            순수익(실질수입-실질지출) {d.netProfit >= 0 ? "+" : ""}{F(d.netProfit)}.
            {d.netProfit > 0
              ? ` 매월 평균 ${F(Math.round(SD(d.netProfit, Math.max(d.months.length, 1))))} 흑자 구조입니다. 연간 환산 시 약 ${F(Math.round(d.netProfit * SD(12, Math.max(d.months.length, 1))))} 순자산 증가가 예상됩니다.`
              : ` 적자 상태입니다. 매월 ${F(Math.abs(Math.round(SD(d.netProfit, Math.max(d.months.length, 1)))))}씩 자산이 감소하고 있습니다. 고정비 점검이 시급합니다.`}
            {d.pInvest > 0 && d.netProfit > 0 ? ` 투자(${F(d.pInvest)})를 포함하면 실질 자산배분 여력이 충분합니다.` : ""}
          </Insight>
          <Insight title="고정비 vs 변동비" color="#7c3aed" bg="rgba(124,58,237,0.06)">
            고정비(보험/통신/월세/구독/교육/대출) {F(d.fixedExpense)} ({Math.round(SD(d.fixedExpense, d.pExpense) * 100)}%), 변동비 {F(d.variableExpense)} ({Math.round(SD(d.variableExpense, d.pExpense) * 100)}%).
            {SD(d.fixedExpense, d.pExpense) > 0.5 ? " 고정비 비중이 50%를 초과합니다. 통신비, 구독, 보험 등 재협상 가능한 항목을 점검하세요." : SD(d.fixedExpense, d.pExpense) > 0.3 ? " 고정비와 변동비가 균형 잡혀 있습니다." : " 변동비 비중이 높아 지출 통제 여지가 큽니다. 예산 관리로 효과적인 절약이 가능합니다."}
            {d.subTotal > 0 ? ` 구독 비용만 ${F(d.subTotal)}로 수입 대비 ${(SD(d.subTotal, d.pIncome) * 100).toFixed(1)}%.` : ""}
          </Insight>
        </div>
      </Card>

      {d.subInsights.length > 0 && (
        <Card title="중분류별 상세 분석" span={4}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {d.subInsights.slice(0, 9).map((s, i) => (
              <div key={s.sub} style={{ padding: "12px 14px", borderRadius: 10, background: s.monthTrend === "up" ? "#fff5f5" : s.monthTrend === "down" ? "#f0fdf4" : "#f8f9fa", border: `1px solid ${s.monthTrend === "up" ? "#fcc" : s.monthTrend === "down" ? "#86efac" : "#eee"}`, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i % 12], display: "inline-block" }} />
                    {s.sub}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: "#e94560" }}>{F(s.total)}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 11, color: "#555" }}>
                  <span>비중: {s.share}%</span>
                  <span>건수: {s.count}건</span>
                  <span>건당 평균: {F(s.avg)}</span>
                  <span>월평균: {F(s.monthAvg)}</span>
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: s.monthTrend === "up" ? "#e94560" : s.monthTrend === "down" ? "#059669" : "#999", fontWeight: 600 }}>
                  {s.monthTrend === "up" ? `▲ 전월 대비 ${s.mom}% 증가` : s.monthTrend === "down" ? `▼ 전월 대비 ${Math.abs(s.mom)}% 감소` : "전월과 유사"}
                  {s.streakUp >= 2 && ` · ${s.streakUp}개월 연속 증가`}
                </div>
                <div style={{ marginTop: 6, fontSize: 11, color: "#666", lineHeight: 1.6, borderTop: "1px solid #eee", paddingTop: 6 }}>
                  {s.comment}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
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
  const subAvg = subs.slice(0, 10).map(s => ({ name: s.sub, avg: Math.round(SD(s.amount, d.months.length)) }));

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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Insight title="최다 지출 중분류" color="#e94560" bg="#fff5f5">
            {topSub ? `${topSub.sub}에 총 ${F(topSub.amount)} (${topSub.count}건, 건당 평균 ${F(Math.round(SD(topSub.amount, topSub.count)))}). ${d.pExpense > 0 ? `전체 지출의 ${Math.round(SD(topSub.amount, d.pExpense) * 100)}%를 차지합니다.` : ""} ${topSub.count > 10 ? "잦은 소비가 누적되고 있습니다. 건수를 줄이는 것만으로도 효과적입니다." : "고단가 지출이 비중을 높이고 있습니다."}` : "데이터 없음"}
          </Insight>
          <Insight title="최다 지출 항목(설명)" color="#0f3460" bg="#f0f8ff">
            {topDescs.length > 0 ? `${topDescs[0].desc}에 총 ${F(topDescs[0].amount)}을 사용했습니다 (${topDescs[0].cat} · ${topDescs[0].sub || "기타"}). ${topDescs.length > 1 ? `2위 ${topDescs[1].desc}(${F(topDescs[1].amount)}), 3위 ${topDescs.length > 2 ? `${topDescs[2].desc}(${F(topDescs[2].amount)})` : "없음"}.` : ""}` : "데이터 없음"}
          </Insight>
          <Insight title="일자별 지출 패턴" color="#b45309" bg="#fff3cd">
            {(() => {
              const maxD = d.spendByDOM.indexOf(Math.max(...d.spendByDOM));
              const topDays = d.spendByDOM.map((v, i) => ({ day: i + 1, v })).sort((a, b) => b.v - a.v).slice(0, 3);
              return `지출 최고일: ${topDays.map(d => `${d.day}일(${F(d.v)})`).join(", ")}. ${maxD >= 24 ? "월말에 지출이 집중됩니다. 신용카드 결제일 영향일 수 있습니다." : maxD < 5 ? "월초에 지출이 집중됩니다. 고정비 결제 패턴을 확인하세요." : "중순에 지출이 가장 많습니다."}`;
            })()}
          </Insight>
          <Insight title="지출 효율성" color="#059669" bg="#d4edda">
            {d.pExpense > 0 && d.totalDays > 0 ? `일 평균 ${F(Math.round(d.pExpense / d.totalDays))} 지출. 총 ${d.expByCat.length}개 대분류, ${subs.length}개 중분류에 분산. ${subs.length > 15 ? "지출처가 많아 관리가 복잡합니다. 통합할 수 있는 항목이 있는지 확인하세요." : subs.length > 8 ? "적당한 수의 카테고리에 분산되어 있습니다." : "소수 카테고리에 집중되어 있어 관리가 용이합니다."}` : "데이터 없음"}
          </Insight>
        </div>
      </Card>

      {d.subInsights.length > 0 && (
        <Card title="중분류별 세부 인사이트" span={2}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {d.subInsights.map((s, i) => (
              <div key={s.sub} style={{ padding: "12px 14px", borderRadius: 10, background: s.monthTrend === "up" ? "#fff5f5" : s.monthTrend === "down" ? "#f0fdf4" : "#f8f9fa", border: `1px solid ${s.monthTrend === "up" ? "#fcc" : s.monthTrend === "down" ? "#86efac" : "#eee"}`, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i % 12], display: "inline-block" }} />
                    {s.sub}
                    <span style={{ fontSize: 11, fontWeight: 400, color: "#999" }}>{s.cat}</span>
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: "#e94560" }}>{F(s.total)}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, fontSize: 11, color: "#555", marginBottom: 4 }}>
                  <span>비중 {s.share}%</span>
                  <span>{s.count}건</span>
                  <span>건당 {F(s.avg)}</span>
                  <span>월평균 {F(s.monthAvg)}</span>
                  <span>피크 {s.peak || "-"}</span>
                  <span>최대건 {F(s.maxSingle)}</span>
                </div>
                <div style={{ fontSize: 11, color: s.monthTrend === "up" ? "#e94560" : s.monthTrend === "down" ? "#059669" : "#999", fontWeight: 600, marginBottom: 4 }}>
                  {s.monthTrend === "up" ? `▲ 전월 대비 ${s.mom}% 증가` : s.monthTrend === "down" ? `▼ 전월 대비 ${Math.abs(s.mom)}% 감소` : "전월과 유사"}
                  {s.streakUp >= 2 && ` · ${s.streakUp}개월 연속 증가!`}
                </div>
                <div style={{ fontSize: 11, color: "#666", lineHeight: 1.6, borderTop: "1px solid #eee", paddingTop: 4 }}>
                  {s.comment}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
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

      <Card title="수입 구조 (그룹별)">
        <ResponsiveContainer width="100%" height={280}>
          <PieChart><Pie data={d.incByGroup} dataKey="value" cx="50%" cy="50%" outerRadius={105} innerRadius={50} label={pieLabel} labelLine={false} style={{ fontSize: 10 }}>
            {d.incByGroup.map((_, i) => <Cell key={i} fill={["#f0c040", "#48c9b0", "#3498db"][i] ?? C[i]} />)}
          </Pie><Tooltip formatter={(v: any) => W(v)} /></PieChart>
        </ResponsiveContainer>
      </Card>

      <Card title="그룹별 상세">
        <div style={{ maxHeight: 280, overflow: "auto" }}>
          {d.incByGroup.map((g, gi) => (
            <div key={g.name}>
              <div style={{ padding: "8px 0 4px", fontWeight: 700, fontSize: 13, color: ["#f0c040", "#48c9b0", "#3498db"][gi] ?? "#333", borderBottom: "2px solid", borderColor: ["#f0c040", "#48c9b0", "#3498db"][gi] ?? "#eee" }}>
                {g.name} — {F(g.value)} ({totalIncome > 0 ? Math.round(g.value / totalIncome * 100) : 0}%)
              </div>
              {g.items.map(([name, value]) => (
                <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0 5px 16px", fontSize: 12, color: "#555" }}>
                  <span>{name}</span>
                  <span style={{ fontWeight: 600 }}>{F(value)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>

      <Card title="수입원 구성 (개별)">
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

      <Card title="수입 종합 인사이트" span={1}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Insight title="수입 안정성" color="#2563eb" bg="#cce5ff">
            {incStability !== null ? `안정성 지수 ${incStability}%. ${incStability >= 70 ? "매우 안정적인 수입 흐름입니다. 일정한 수입이 지출 계획과 투자 전략을 세우기 좋습니다." : incStability >= 40 ? "수입에 변동이 있지만 관리 가능한 수준입니다. 변동 원인을 파악하면 더 안정적으로 만들 수 있습니다." : "수입 변동이 큽니다. 비상자금 확보가 중요하며, 안정적 수입원을 늘려보세요."}` : "데이터 부족"}
          </Insight>
          <Insight title="패시브 수입 현황" color="#059669" bg="#d4edda">
            {passive > 0 ? `배당+이자+캐시백 합산 ${F(passive)} (전체 수입의 ${Math.round(passive / Math.max(totalIncome, 1) * 100)}%). 월평균 ${F(Math.round(passive / Math.max(d.months.length, 1)))}의 패시브 수입이 발생합니다. ${passive / Math.max(totalIncome, 1) > 0.1 ? "패시브 수입 비중이 좋습니다!" : "패시브 수입을 더 늘려보세요. 배당 ETF나 적금 이자가 도움됩니다."}` : "패시브 수입이 없습니다. 배당주, 예금 이자, 캐시백 등 작은 것부터 시작해 보세요. 월 1만원이라도 패시브 수입의 시작입니다."}
          </Insight>
          <Insight title="수입 다각화 점검" color="#b45309" bg="#fff3cd">
            {d.incByCat.length}개 수입원 보유. {salaryPct > 80 ? `급여 의존도 ${salaryPct.toFixed(0)}%로 매우 높습니다. 급여 외 수입이 ${F(totalIncome - salary)}에 불과합니다. 부업, 투자 수입, 프리랜서 활동 등으로 다각화하면 경제적 안정성이 높아집니다.` : salaryPct > 50 ? `급여 비중 ${salaryPct.toFixed(0)}%로 적정 수준입니다. 비급여 수입(${F(totalIncome - salary)})이 있어 좋은 구조입니다.` : `급여 의존도 ${salaryPct.toFixed(0)}%로 매우 낮습니다. 훌륭한 수입 다각화! 여러 수입원에서 골고루 수입이 발생하고 있습니다.`}
          </Insight>
          {(d.settlementTotal > 0 || d.originalAssets > 0) && (
            <Insight title="실질 수입 (정산·보유자산 제외)" color="#7c3aed" bg="rgba(139,92,246,0.08)">
              실질 수입 {F(d.realIncome)} (정산 {F(d.settlementTotal)}, 원래 보유 자산 {F(d.originalAssets)} 제외). 원래 보유 자산은 가계부 시작 시점에 이미 갖고 있던 돈이므로 새로운 수입이 아닙니다. 정산은 비용 분담금 회수이므로 실질 소비에서도 차감됩니다.
              {d.originalAssetsByAcct.length > 0 && ` 계좌별: ${d.originalAssetsByAcct.slice(0, 3).map(a => `${a.name}(${F(a.amount)})`).join(", ")}${d.originalAssetsByAcct.length > 3 ? ` 외 ${d.originalAssetsByAcct.length - 3}개` : ""}.`}
            </Insight>
          )}
        </div>
      </Card>

      {d.incSubInsights.length > 0 && (
        <Card title="수입원별 세부 인사이트" span={2}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {d.incSubInsights.map((s, i) => (
              <div key={s.sub} style={{ padding: "12px 14px", borderRadius: 10, background: s.monthTrend === "up" ? "#f0fdf4" : s.monthTrend === "down" ? "#fff5f5" : "#f8f9fa", border: `1px solid ${s.monthTrend === "up" ? "#86efac" : s.monthTrend === "down" ? "#fcc" : "#eee"}`, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i % 12], display: "inline-block" }} />
                    {s.sub}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: "#059669" }}>{F(s.total)}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 11, color: "#555", marginBottom: 4 }}>
                  <span>비중: {s.share}%</span>
                  <span>{s.count}건 · 건당 {F(s.avg)}</span>
                  <span>월평균: {F(s.monthAvg)}</span>
                  <span>안정성: {s.stability}%</span>
                </div>
                <div style={{ fontSize: 11, color: s.monthTrend === "up" ? "#059669" : s.monthTrend === "down" ? "#e94560" : "#999", fontWeight: 600, marginBottom: 4 }}>
                  {s.monthTrend === "up" ? `▲ 전월 대비 ${s.mom}% 증가` : s.monthTrend === "down" ? `▼ 전월 대비 ${Math.abs(s.mom)}% 감소` : "전월과 유사"}
                  {s.maxMonth ? ` · 최대: ${s.maxMonth}(${F(s.maxMonthAmt)})` : ""}
                </div>
                <div style={{ fontSize: 11, color: "#666", lineHeight: 1.6, borderTop: "1px solid #eee", paddingTop: 4 }}>
                  {s.comment}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
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

        {d.dateByDetail.length > 1 && (
          <Card title="소분류별 데이트 지출">
            <div style={{ maxHeight: 280, overflow: "auto" }}>
              {d.dateByDetail.map(([name, value], i) => {
                const dtTotal = d.dateByDetail.reduce((s, [, v]) => s + v, 0);
                return (
                  <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f5f5f5", fontSize: 12 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i % 12], display: "inline-block" }} />{name}
                    </span>
                    <span style={{ fontWeight: 700 }}>{F(value)} <span style={{ fontSize: 10, color: "#999" }}>({dtTotal > 0 ? Math.round(value / dtTotal * 100) : 0}%)</span></span>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

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

        <Card title="데이트비 종합 인사이트" span={3}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Insight title="지출처 분석" color="#e94560" bg="#fff5f5">
              {d.dateTop.length > 0 ? `최다 지출처: ${d.dateTop[0][0]}에 총 ${F(d.dateTop[0][1])} (전체의 ${total > 0 ? Math.round(d.dateTop[0][1] / total * 100) : 0}%).` : "데이터 없음"}
              {d.dateTop.length > 1 ? ` 2위 ${d.dateTop[1][0]}(${F(d.dateTop[1][1])}), ${d.dateTop.length > 2 ? `3위 ${d.dateTop[2][0]}(${F(d.dateTop[2][1])}).` : "."}` : ""}
              {d.dateTop.length > 3 ? ` 상위 3곳이 ${total > 0 ? Math.round((d.dateTop[0][1] + d.dateTop[1][1] + (d.dateTop[2]?.[1] ?? 0)) / total * 100) : 0}% 차지. ${d.dateTop.length > 5 ? "다양한 곳에서 데이트를 즐기고 있네요!" : "자주 가는 곳이 집중되어 있습니다."}` : ""}
            </Insight>
            <Insight title="모임통장 활용 분석" color="#2ecc71" bg="#f5fff5">
              {splitTotal > 0 ? `모임통장 ${F(d.dateMoim)}(${moimPct}%), 개인 ${F(d.datePersonal)}(${100 - moimPct}%). ${moimPct >= 50 ? "모임통장을 잘 활용하고 있습니다! 데이트 비용을 효과적으로 분담하고 있어요." : moimPct >= 30 ? "모임통장 활용도가 적당합니다. 더 늘리면 개인 부담이 줄어들 수 있어요." : "개인 결제 비중이 높습니다. 데이트 모임통장 활용을 더 늘려보세요. 공동 지출은 모임통장으로 결제하면 정산이 편합니다."}` : "모임통장 사용 내역이 없습니다. 모임통장을 만들면 데이트 비용 관리가 더 쉬워집니다."}
            </Insight>
            <Insight title="월별 추세 분석" color="#0f3460" bg="#f0f8ff">
              {allMonthData.length >= 2 ? `최고 ${maxMonth.name}(${F(maxMonth.금액)}), 최저 ${minMonth.name}(${F(minMonth.금액)}). 변동폭 ${F(maxMonth.금액 - minMonth.금액)}. ${maxMonth.금액 > avg * 2 ? `${maxMonth.name}에 특별 이벤트나 큰 지출이 있었습니다. 평균 대비 ${Math.round(maxMonth.금액 / Math.max(avg, 1) * 100)}% 수준.` : "비교적 안정적인 데이트 지출 패턴입니다."} 월평균 ${F(Math.round(avg))}, 건당 평균 ${F(avgPerTx)}.` : "데이터 부족"}
            </Insight>
            <Insight title="데이트 지출 비중" color="#533483" bg="rgba(83,52,131,0.08)">
              {d.pExpense > 0 ? `전체 지출의 ${Math.round(total / d.pExpense * 100)}%가 데이트 비용입니다. ${total / d.pExpense > 0.15 ? "데이트 비용 비중이 높은 편입니다. 가성비 좋은 데이트 활동을 찾아보세요." : total / d.pExpense > 0.05 ? "적정한 데이트 비용 비중입니다." : "데이트 비용이 전체에서 낮은 비중을 차지합니다."} 월평균 ${F(Math.round(avg))}로, ${avg > 300000 ? "월 30만원 이상 지출 중입니다." : avg > 150000 ? "월 15~30만원 수준입니다." : "알뜰하게 데이트하고 있습니다!"}` : ""}
            </Insight>
          </div>
        </Card>

        {d.dateSubInsights.length > 0 && (
          <Card title="중분류별 데이트 상세 인사이트" span={3}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {d.dateSubInsights.map((s, i) => (
                <div key={s.sub} style={{ padding: "12px 14px", borderRadius: 10, background: "#fff5f5", border: "1px solid #fcc", fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i % 12], display: "inline-block" }} />
                      {s.sub}
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: "#e94560" }}>{F(s.total)}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, fontSize: 11, color: "#555", marginBottom: 4 }}>
                    <span>비중 {s.share}%</span>
                    <span>{s.count}건</span>
                    <span>건당 {F(s.avg)}</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#666", lineHeight: 1.6, borderTop: "1px solid #eee", paddingTop: 4 }}>
                    {s.comment}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
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
    실현손익: v.sellTotal - (v.sellCount > 0 ? SD(v.buyTotal, v.buyCount) * v.sellCount : 0),
  }));
  const holdOnly = holdings.filter(h => h.보유수량 > 0);
  const closedPL = holdings.filter(h => h.보유수량 === 0 && h.매도 > 0);
  const noSellHoldings = holdOnly.filter(h => h.매도 === 0 && h.매수 > 500000);
  const totalInvested = holdOnly.reduce((s, h) => s + h.매수, 0);
  const totalDiv = d.divTrend.reduce((s, m) => s + m.amount, 0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
      <Card accent><Kpi label="총 매수금액" value={F(totalInvested)} color="#f0c040" /></Card>
      <Card accent><Kpi label="실현 손익" value={F(Math.round(d.realPL.total))} sub={d.investReturnRate !== 0 ? `수익률 ${d.investReturnRate.toFixed(1)}%` : undefined} color={d.realPL.total >= 0 ? "#48c9b0" : "#e94560"} /></Card>
      <Card accent><Kpi label="배당/이자 수입" value={F(totalDiv)} sub={totalInvested > 0 ? `배당률 ${(SD(totalDiv, totalInvested) * 100).toFixed(1)}%` : undefined} color="#48c9b0" /></Card>
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

      {d.investBySub.length > 0 && (
        <Card title="재테크 중분류별 분류" span={2}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <ResponsiveContainer width="45%" height={200}>
              <PieChart><Pie data={d.investBySub.map(v => ({ name: v.sub, value: v.amount }))} dataKey="value" cx="50%" cy="50%" outerRadius={80} innerRadius={35} label={pieLabel} labelLine={false} style={{ fontSize: 10 }}>
                {d.investBySub.map((_, i) => <Cell key={i} fill={C[i]} />)}
              </Pie><Tooltip formatter={(v: any) => W(v)} /></PieChart>
            </ResponsiveContainer>
            <div style={{ flex: 1 }}>
              {d.investBySub.map((v, i) => {
                const total = d.investBySub.reduce((s, x) => s + x.amount, 0);
                return (
                  <div key={v.sub} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f5f5f5", fontSize: 13 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i], display: "inline-block" }} />{v.sub} ({v.count}건)
                    </span>
                    <span style={{ fontWeight: 700 }}>{F(v.amount)} <span style={{ fontSize: 10, color: "#999" }}>({total > 0 ? Math.round(v.amount / total * 100) : 0}%)</span></span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {d.stockTrends.map(st => (
        <Card key={st.name} title={`${st.name} 누적 매수금액 변동`} span={2}>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={st.data}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="l" tick={{ fontSize: 10 }} /><YAxis tickFormatter={F} tick={{ fontSize: 10 }} /><Tooltip content={<CT />} />
              <Area type="monotone" dataKey="누적매수" stroke="#0f3460" fill="#0f346020" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      ))}

      <Card title="투자 종합 인사이트" span={4}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {holdOnly[0] && <Insight title="최대 보유 종목 분석" color="#0f3460" bg="#f0f8ff">
            {holdOnly[0].fullName} — 총 매수금액 {F(holdOnly[0].매수)}. 포트폴리오 비중 {totalInvested > 0 ? Math.round(holdOnly[0].매수 / totalInvested * 100) : 0}%.
            {holdOnly[0].매도 > 0 ? ` 일부 매도(${F(holdOnly[0].매도)}) 실행. 실현손익 ${holdOnly[0].실현손익 >= 0 ? "+" : ""}${F(Math.round(holdOnly[0].실현손익))}.` : " 매도 없이 보유 중입니다."}
            {totalInvested > 0 && holdOnly[0].매수 / totalInvested > 0.5 ? " 단일 종목 비중이 50%를 넘습니다. 분산 투자를 고려해 보세요." : ""}
            {holdOnly.length > 1 ? ` 2위: ${holdOnly[1].fullName}(${F(holdOnly[1].매수)}).` : ""}
          </Insight>}
          {noSellHoldings.length > 0 && <Insight title="매도 없는 종목 점검" color="#e94560" bg="#f8d7da">
            {noSellHoldings.map(h => `${h.fullName}(${F(h.매수)})`).join(", ")}.
            총 {noSellHoldings.length}종목이 매수 후 매도 없이 보유 중입니다.
            {noSellHoldings.length >= 3 ? " 보유 종목이 많습니다. 손실이 난 종목은 손절을 검토해 보세요. 포트폴리오 리밸런싱 시점이 될 수 있습니다." : " 장기 투자 전략이라면 좋지만, 정기적으로 포트폴리오를 점검하세요."}
          </Insight>}
          <Insight title="배당/이자 수입 분석" color="#059669" bg="#d4edda">
            {totalDiv > 0 ? `총 ${F(totalDiv)} 수령, 월평균 ${F(Math.round(totalDiv / Math.max(d.months.length, 1)))}. ${totalInvested > 0 ? `투자 원금 대비 수익률 약 ${(totalDiv / totalInvested * 100).toFixed(1)}%.` : ""} ${d.divTrend.filter(m => m.amount > 0).length > 0 ? `${d.divTrend.filter(m => m.amount > 0).length}개월간 배당 수령. ` : ""}배당 수입이 꾸준히 들어오고 있어 복리 효과가 기대됩니다.` : "아직 배당/이자 수입이 없습니다. 배당 ETF나 고배당주를 통해 패시브 수입을 만들어 보세요."}
          </Insight>
          <Insight title="매매 전략 평가" color="#b45309" bg="#fff3cd">
            {d.realPL.winCnt + d.realPL.lossCnt > 0
              ? `총 ${d.realPL.winCnt + d.realPL.lossCnt}건 청산, 승률 ${Math.round(d.realPL.winCnt / (d.realPL.winCnt + d.realPL.lossCnt) * 100)}%. 수익 ${d.realPL.winCnt}건(+${F(Math.round(d.realPL.wins))}), 손실 ${d.realPL.lossCnt}건(-${F(Math.round(d.realPL.losses))}). ${d.realPL.total >= 0 ? `순이익 +${F(Math.round(d.realPL.total))}. 전체적으로 수익을 내고 있습니다!` : `순손실 ${F(Math.round(d.realPL.total))}. 매매 전략을 재점검해 보세요.`} ${d.realPL.winCnt / Math.max(d.realPL.winCnt + d.realPL.lossCnt, 1) < 0.5 ? "승률이 50% 미만입니다. 진입 시점과 손절 기준을 검토해 보세요." : ""}`
              : "아직 매도한 종목이 없어 매매 성과를 평가할 수 없습니다. 장기 보유 전략이라면 괜찮습니다."}
          </Insight>
        </div>
      </Card>

      {d.investSubInsights.length > 0 && (
        <Card title="재테크 중분류별 상세 인사이트" span={4}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {d.investSubInsights.map((v, i) => (
              <div key={v.sub} style={{ padding: "12px 14px", borderRadius: 10, background: v.monthTrend === "up" ? "#f0fdf4" : v.monthTrend === "down" ? "#fff5f5" : "#f0f8ff", border: `1px solid ${v.monthTrend === "up" ? "#86efac" : v.monthTrend === "down" ? "#fcc" : "#cce5ff"}`, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i % 12], display: "inline-block" }} />
                    {v.sub}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: "#0f3460" }}>{F(v.amount)}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, fontSize: 11, color: "#555", marginBottom: 4 }}>
                  <span>비중 {v.share}%</span>
                  <span>{v.count}건</span>
                  <span>건당 {F(v.avg)}</span>
                  <span>월평균 {F(v.monthAvg)}</span>
                  <span style={{ color: v.monthTrend === "up" ? "#059669" : v.monthTrend === "down" ? "#e94560" : "#999", fontWeight: 600 }}>
                    {v.monthTrend === "up" ? `▲ ${v.mom}%` : v.monthTrend === "down" ? `▼ ${Math.abs(v.mom)}%` : "유지"}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: "#666", lineHeight: 1.6, borderTop: "1px solid #eee", paddingTop: 4 }}>
                  {v.comment}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
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

      <Card title="소비 패턴 종합 분석" span={4}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Insight title="요일별 소비 패턴" color="#e94560" bg="#f8d7da">
            건당 평균이 가장 높은 요일: {sorted.slice(0, 2).map(w => `${w.name}(${F(w.avg)}, ${w.count}건)`).join(", ")}.
            건당 평균이 가장 낮은 요일: {sorted.slice(-1).map(w => `${w.name}(${F(w.avg)}, ${w.count}건)`).join("")}.
            {sorted[0]?.avg > sorted[sorted.length - 1]?.avg * 3 ? ` 요일간 격차가 ${Math.round(sorted[0].avg / Math.max(sorted[sorted.length - 1].avg, 1))}배로 큽니다. 고액 결제일이 특정 요일에 집중되어 있을 수 있습니다.` : " 요일간 큰 격차는 없습니다."}
          </Insight>
          <Insight title="주말 vs 주중 분석" color="#0f3460" bg="#f0f8ff">
            주말 {weekendPct}% ({F(d.weekendTot)}), 주중 {100 - weekendPct}% ({F(d.weekdayTot)}).
            {weekendPct > 40 ? " 주말 지출 비중이 높습니다. 외식, 여가, 쇼핑 등이 주말에 집중될 수 있습니다. 주말 예산을 정해두면 효과적입니다." : weekendPct > 25 ? " 주중과 주말 지출이 비교적 균형적입니다." : " 주중 지출이 압도적으로 많습니다. 출퇴근 비용이나 점심값 등 고정적 지출이 주중에 집중되는 패턴입니다."}
          </Insight>
          <Insight title="월 상·중·하순 패턴" color="#b45309" bg="#fff3cd">
            상순(1~10일): {F(byThird[0])} ({d.pExpense > 0 ? Math.round(byThird[0] / d.pExpense * 100) : 0}%), 중순(11~20일): {F(byThird[1])} ({d.pExpense > 0 ? Math.round(byThird[1] / d.pExpense * 100) : 0}%), 하순(21~31일): {F(byThird[2])} ({d.pExpense > 0 ? Math.round(byThird[2] / d.pExpense * 100) : 0}%).
            {byThird[2] > byThird[0] && byThird[2] > byThird[1] ? " 하순에 지출이 가장 많습니다. 신용카드 결제일이나 월말 소비 심리가 영향을 줄 수 있습니다." : byThird[0] > byThird[1] ? " 상순에 지출이 집중됩니다. 월초 고정비(월세, 보험 등) 결제 영향일 수 있습니다." : " 중순에 지출이 가장 많습니다."}
          </Insight>
          <Insight title="무지출 & 소비 통제력" color="#059669" bg="#d4edda">
            {d.zeroDays > 0 ? `${d.totalDays}일 중 ${d.zeroDays}일 무지출 (${Math.round(d.zeroDays / Math.max(d.totalDays, 1) * 100)}%).` : "무지출일이 없습니다."}
            {d.zeroDays >= d.totalDays * 0.3 ? " 뛰어난 소비 통제력! 무지출일이 30% 이상으로 매우 절약적입니다." : d.zeroDays >= d.totalDays * 0.15 ? " 적정 수준의 무지출일입니다. 주 1~2일 무지출 습관이 잡혀 있네요." : " 거의 매일 지출이 발생합니다. 주 1일이라도 무지출일을 만들어 보세요. 습관이 되면 자연스럽게 절약됩니다."}
            {d.pExpense > 0 && d.totalDays > 0 ? ` 일 평균 지출 ${F(Math.round(d.pExpense / d.totalDays))}.` : ""}
          </Insight>
        </div>
      </Card>

      {d.subInsights.length > 0 && (
        <Card title="중분류별 소비 패턴 상세" span={4}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {d.subInsights.slice(0, 12).map((s, i) => (
              <div key={s.sub} style={{ padding: "12px 14px", borderRadius: 10, background: s.monthTrend === "up" ? "#fff5f5" : s.monthTrend === "down" ? "#f0fdf4" : "#f8f9fa", border: `1px solid ${s.monthTrend === "up" ? "#fcc" : s.monthTrend === "down" ? "#86efac" : "#eee"}`, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i % 12], display: "inline-block" }} />
                    {s.sub}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: "#e94560" }}>{F(s.total)}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, fontSize: 11, color: "#555", marginBottom: 4 }}>
                  <span>{s.count}건</span>
                  <span>건당 {F(s.avg)}</span>
                  <span>비중 {s.share}%</span>
                  <span>월평균 {F(s.monthAvg)}</span>
                  <span>피크 {s.peak || "-"}</span>
                  <span>최대건 {F(s.maxSingle)}</span>
                </div>
                <div style={{ fontSize: 11, color: s.monthTrend === "up" ? "#e94560" : s.monthTrend === "down" ? "#059669" : "#999", fontWeight: 600, marginBottom: 4 }}>
                  {s.monthTrend === "up" ? `▲ ${s.mom}% 증가 추세` : s.monthTrend === "down" ? `▼ ${Math.abs(s.mom)}% 감소 추세` : "안정적 유지"}
                  {s.streakUp >= 2 && ` · ${s.streakUp}개월 연속 증가!`}
                </div>
                <div style={{ fontSize: 11, color: "#666", lineHeight: 1.6, borderTop: "1px solid #eee", paddingTop: 4 }}>
                  {s.comment}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
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
  const [ly, lm] = (latestMonth || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`).split("-").map(Number);
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
            { label: "일 평균 지출", value: F(d.dailyAvgExp), color: "#533483" },
            { label: "예상 vs 평균", value: avgMonthlySpend > 0 ? Math.round(projected / avgMonthlySpend * 100) + "%" : "-", color: "#0f3460" },
          ].map(s => (
            <div key={s.label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", background: "#f8f9fa", borderRadius: 8 }}>
              <span style={{ color: "#666" }}>{s.label}</span>
              <span style={{ fontWeight: 700, color: s.color }}>{s.value}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="지출 속도 종합 인사이트" span={3}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {spikeMonth && <Insight title="최고 지출 월 분석" color="#e94560" bg="#f8d7da">
            {d.ml[spikeMonth.m]} — 총 {F(spikeMonth.val)}.
            {avgMonthlySpend > 0 ? ` 평균 대비 ${Math.round(spikeMonth.val / avgMonthlySpend * 100)}% 수준으로 ` : " "}
            {spikeMonth.val > avgMonthlySpend * 1.5 ? "지출이 크게 튀었습니다. 대형 구매나 특별 이벤트가 있었을 수 있습니다. 25일 전후 급등 패턴을 확인하세요." : "다소 높은 지출이었습니다."}
            {stableMonth ? ` 반면 ${d.ml[stableMonth.m]}은 ${F(stableMonth.val)}로 가장 안정적이었습니다. 변동폭 ${F(spikeMonth.val - stableMonth.val)}.` : ""}
          </Insight>}
          <Insight title="15일 기준선 분석" color="#2563eb" bg="#cce5ff">
            15일차까지 월 지출의 50% 이내면 후반부 지출 여유가 생깁니다.
            {midSpend[0] ? ` 15일차 기준 최다 지출월: ${d.ml[midSpend[0].m]}(${F(midSpend[0].val)}). ${midSpend[0].val > (d.cumSpend[midSpend[0].m]?.[30] ?? 0) * 0.55 ? "전반부에 지출이 집중되어 후반부에 긴축하게 됩니다." : "전후반 균형이 좋았습니다."}` : ""}
            {midSpend.length > 1 ? ` 최소: ${d.ml[midSpend[midSpend.length - 1].m]}(${F(midSpend[midSpend.length - 1].val)}).` : ""}
          </Insight>
          {projected > 0 && <Insight title="이번 달 예측" color={projected > avgMonthlySpend * 1.2 ? "#e94560" : "#059669"} bg={projected > avgMonthlySpend * 1.2 ? "#fff5f5" : "#d4edda"}>
            현재 {dayOfMonth}일차, 지출 {F(currentSpend)}. 이 속도로 가면 월말 예상 {F(Math.round(projected))}.
            {avgMonthlySpend > 0 ? ` 평균({F(Math.round(avgMonthlySpend))}) 대비 ${Math.round(projected / avgMonthlySpend * 100)}%.` : ""}
            {projected > avgMonthlySpend * 1.3 ? " 현재 속도면 평균을 크게 초과합니다. 남은 기간 지출을 줄이면 아직 조정 가능합니다." : projected > avgMonthlySpend * 1.1 ? " 다소 높은 속도이지만 관리 가능합니다." : " 양호한 지출 속도입니다."}
            {daysInMonth - dayOfMonth > 0 ? ` 남은 ${daysInMonth - dayOfMonth}일간 일 ${F(Math.round(Math.max(0, avgMonthlySpend - currentSpend) / (daysInMonth - dayOfMonth)))} 이하로 쓰면 평균 수준 유지.` : ""}
          </Insight>}
          <Insight title="월간 변동성" color="#b45309" bg="#fff3cd">
            {validMonths.length >= 2 ? (() => {
              const vals = validMonths.map(m => d.cumSpend[m]?.[30] ?? 0);
              const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
              const std = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
              const cv = mean > 0 ? Math.round(std / mean * 100) : 0;
              return `${validMonths.length}개월 분석 결과, 변동계수 ${cv}%. ${cv > 30 ? "월별 지출 변동이 큽니다. 고정비와 변동비를 구분해서 변동비를 줄이면 안정적인 지출 관리가 가능합니다." : cv > 15 ? "적당한 수준의 변동성입니다. 대부분의 월이 비슷한 패턴을 보입니다." : "매우 안정적인 지출 패턴! 예산 관리를 잘 하고 계십니다."}`;
            })() : "분석할 데이터가 부족합니다."}
          </Insight>
        </div>
      </Card>

      {d.subInsights.length > 0 && (
        <Card title="중분류별 지출 추세 상세" span={3}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {d.subInsights.filter(s => s.monthTrend !== "flat").slice(0, 10).map((s, i) => (
              <div key={s.sub} style={{ padding: "12px 14px", borderRadius: 10, background: s.monthTrend === "up" ? "#fff5f5" : "#f0fdf4", border: `1px solid ${s.monthTrend === "up" ? "#fcc" : "#86efac"}`, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i % 12], display: "inline-block" }} />
                    {s.monthTrend === "up" ? "▲" : "▼"} {s.sub}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: s.monthTrend === "up" ? "#e94560" : "#059669" }}>
                    {Math.abs(s.mom)}% {s.monthTrend === "up" ? "증가" : "감소"}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, fontSize: 11, color: "#555", marginBottom: 4 }}>
                  <span>총 {F(s.total)}</span>
                  <span>비중 {s.share}%</span>
                  <span>월평균 {F(s.monthAvg)}</span>
                </div>
                <div style={{ fontSize: 11, color: "#666", lineHeight: 1.6, borderTop: "1px solid #eee", paddingTop: 4 }}>
                  {s.comment}
                </div>
              </div>
            ))}
            {d.subInsights.filter(s => s.monthTrend !== "flat").length === 0 && (
              <div style={{ gridColumn: "span 2", textAlign: "center", padding: 20, color: "#999" }}>모든 중분류가 전월과 비슷한 수준을 유지하고 있습니다. 안정적인 지출 패턴입니다.</div>
            )}
          </div>
        </Card>
      )}
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

export const InsightsView: React.FC<Props> = ({ accounts, ledger, trades = [], prices: _p, fxRate: _f, categoryPresets, budgetGoals: _b }) => {
  const [tab, setTab] = useState<TabId>("overview");
  const [selMonth, setSelMonth] = useState<string | null>(null);
  const d = useD(ledger, trades, accounts, selMonth, categoryPresets);

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
