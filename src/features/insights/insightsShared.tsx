import React, { useState } from "react";
import type { Payload, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import type { PieLabelRenderProps } from "recharts/types/polar/Pie";

/* ================================================================== */
/*  Constants                                                          */
/* ================================================================== */

export const WDN = ["월", "화", "수", "목", "금", "토", "일"];
export const C = [
  "#e94560", "#0f3460", "#f0c040", "#533483", "#48c9b0", "#f39c12",
  "#3498db", "#e74c3c", "#2ecc71", "#9b59b6", "#1abc9c", "#d35400",
];

/* ================================================================== */
/*  Formatters                                                         */
/* ================================================================== */

export const F = (n: number): string => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 10000000) return sign + (abs / 10000000).toFixed(1) + "천만";
  if (abs >= 10000) return sign + Math.round(abs / 10000).toLocaleString() + "만";
  return n.toLocaleString();
};
export const W = (n: number) => n.toLocaleString() + "원";
export const Pct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
export const SD = (a: number, b: number, f = 0): number => (b !== 0 ? a / b : f);

/* ================================================================== */
/*  Shared UI                                                          */
/* ================================================================== */

export function Card({ title, children, span = 1, accent = false }: {
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

export function Kpi({ label, value, sub, badge, color = "#e94560", info }: {
  label: string; value: string; sub?: string; badge?: string; color?: string; info?: string;
}) {
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 11, color: "#999", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 1, display: "flex", justifyContent: "center", alignItems: "center", gap: 4 }}>
        {label}
        {info && (
          <span
            title={info}
            role="img"
            aria-label={info}
            style={{
              cursor: "help",
              fontSize: 10,
              width: 14,
              height: 14,
              borderRadius: 7,
              background: "rgba(255,255,255,0.15)",
              color: "rgba(255,255,255,0.7)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
            }}
          >ⓘ</span>
        )}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{sub}</div>}
      {badge && <div style={{ fontSize: 11, marginTop: 4, display: "inline-block", padding: "2px 8px", borderRadius: 4, background: badge.startsWith("-") ? "rgba(72,201,176,0.15)" : "rgba(233,69,96,0.15)", color: badge.startsWith("-") ? "#48c9b0" : "#e94560", fontWeight: 700 }}>{badge}</div>}
    </div>
  );
}

/** localStorage로 접힘 상태 유지되는 섹션 래퍼 (Overview/Expense 등 탭 재사용) */
export function Section({ storageKey, title, defaultOpen = true, children }: {
  storageKey: string; title: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved == null ? defaultOpen : saved === "1";
    } catch { return defaultOpen; }
  });
  const toggle = () => {
    setOpen((v) => {
      try { localStorage.setItem(storageKey, v ? "0" : "1"); } catch { /* ignore */ }
      return !v;
    });
  };
  return (
    <div style={{ marginBottom: 20 }}>
      <button
        type="button"
        onClick={toggle}
        style={{
          width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "10px 4px", border: "none", background: "transparent", cursor: "pointer",
          fontSize: 15, fontWeight: 700, color: "#1a1a2e",
          borderBottom: open ? "2px solid #1a1a2e" : "1px solid #ddd",
          marginBottom: open ? 14 : 0,
        }}
      >
        <span>{title}</span>
        <span style={{ fontSize: 14, color: "#666" }}>{open ? "▾ 접기" : "▸ 펼치기"}</span>
      </button>
      {open && <div className="grid-4">{children}</div>}
    </div>
  );
}

export function Insight({ title, color, bg, children }: { title: string; color: string; bg: string; children: React.ReactNode }) {
  return (
    <div style={{ background: bg, padding: 14, borderRadius: 10, fontSize: 13, lineHeight: 1.7 }}>
      <div style={{ fontWeight: 700, color, marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}

export const pieLabel = ({ name, percent }: PieLabelRenderProps) =>
  `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`;

export interface CTProps {
  active?: boolean;
  payload?: ReadonlyArray<Payload<ValueType, NameType>>;
  label?: string | number;
}
export function CT({ active, payload, label }: CTProps) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#1a1a2e", border: "1px solid #333", borderRadius: 10, padding: "10px 14px", color: "#fff", fontSize: 12, maxWidth: 280 }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: "#f0c040" }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <div style={{ width: 8, height: 8, borderRadius: 4, background: p.color, flexShrink: 0 }} />
          <span style={{ color: "#aaa" }}>{p.name}:</span>
          <span style={{ fontWeight: 600 }}>{W(Math.round(Number(p.value)))}</span>
        </div>
      ))}
    </div>
  );
}

/* ================================================================== */
/*  InsightData type                                                   */
/* ================================================================== */

export interface SubInsight {
  sub: string; cat: string; total: number; count: number; avg: number;
  monthTrend: "up" | "down" | "flat"; mom: number; peak: string; share: number;
  monthAvg: number; maxSingle: number; maxSingleDesc: string;
  streakUp: number;
  topDesc: string; topDescAmt: number;
  comment: string;
  mTotals: number[];
}

export interface IncSubInsight {
  sub: string; total: number; count: number; avg: number;
  monthTrend: "up" | "down" | "flat"; mom: number; share: number;
  monthAvg: number; stability: number;
  maxMonth: string; maxMonthAmt: number;
  comment: string;
}

export interface DateSubInsight {
  sub: string; total: number; count: number; avg: number; share: number;
  maxSingle: number; maxSingleDesc: string;
  avgPerVisit: number;
  comment: string;
}

export interface InvestSubInsight {
  sub: string; amount: number; count: number; avg: number; share: number;
  monthAvg: number;
  monthTrend: "up" | "down" | "flat"; mom: number;
  comment: string;
}

export interface AnomalyLite {
  category: string;
  currentMonthAmount: number;
  averageAmount: number;
  zScore: number;
  percentChange: number;
  severity: "normal" | "elevated" | "extreme";
  isAnomaly: boolean;
}

export interface IncomeGrowth {
  series: { l: string; month: string; income: number; momPct: number | null }[];
  mom: number | null;
  yoy: number | null;
  avg3MoM: number | null;
  targetInc: number;
  prevInc: number;
}

export interface SpendingInertia {
  curExp: number;
  avg: number;
  deviation: number | null;
  lookbackMonths: number;
}

export interface BudgetProgressRow {
  category: string;
  limit: number;
  spent: number;
  remaining: number;
  pct: number;
  status: "safe" | "warning" | "over";
}

export interface CategoryGrowthRow {
  sub: string;
  cur: number;
  avg3: number;
  /** 신규 카테고리(avg3=0)의 경우 Infinity — UI는 isNew로 분기 */
  pctChange: number;
  isNew: boolean;
}

export interface EntryOutlier {
  date: string;
  desc: string;
  sub: string;
  cat: string;
  amount: number;
  zScore: number;
  avg: number;
}

export interface PatternStats {
  longestSpendStreak: number;
  longestZeroStreak: number;
  currentStreakType: "none" | "spend" | "zero";
  currentStreakDays: number;
  zeroDaysPerMonth: { month: string; label: string; zeroDays: number; totalDays: number }[];
  avgIntervalDays: number;
}

export interface D {
  months: string[];
  ml: Record<string, string>;
  selMonth: string | null;
  txCount: number;
  anomalyTargetMonth: string | null;
  topAnomaly: AnomalyLite | null;
  incomeGrowth: IncomeGrowth;
  spendingInertia: SpendingInertia | null;
  budgetProgress: BudgetProgressRow[];
  categoryGrowth: { up: CategoryGrowthRow[]; down: CategoryGrowthRow[] };
  entryOutliers: EntryOutlier[];
  spendByDOMAvg: number[];
  domOccurrences: number[];
  patternStats: PatternStats;

  monthly: Record<string, { income: number; expense: number; investment: number }>;
  savRateTrend: { l: string; rate: number; cumRate: number; sav: number }[];
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
  tempIncomeTotal: number;
  /** 데이트 계좌에서 지출된 총액 (기간 내) */
  dateAccountSpend: number;
  /** 데이트 계좌 지출 중 상대 부담분 (50%) — 실 지출 계산에서 차감됨 */
  datePartnerShare: number;

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

  netWorthByMonth: { month: string; label: string; total: number; income: number; expense: number; savings: number }[];
  accountBalances: { name: string; type: string; balance: number }[];
  assetAllocation: { name: string; value: number }[];

  funStats: {
    biggestSpendDay: { date: string; total: number } | null;
    mostFrugalMonth: { month: string; expense: number } | null;
    mostSpendMonth: { month: string; expense: number } | null;
    longestZeroStreak: number;
    weekendVsWeekday: { weekend: number; weekday: number };
    avgTxPerDay: number;
    topStore: { name: string; total: number; count: number } | null;
    monthOverMonthGrowth: number | null;
    daysToSpendIncome: number | null;
    bestSavingsMonth: { month: string; rate: number } | null;
  };
}
