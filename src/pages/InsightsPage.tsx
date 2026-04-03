import React, { useMemo, useState } from "react";
import type { Account, BudgetGoal, CategoryPresets, LedgerEntry, StockTrade, StockPrice } from "../types";
import { formatKRW, formatNumber } from "../utils/formatter";
import {
  WaterfallWidget,
  TopThreeBlocksWidget,
  SubscriptionAlertWidget,
  PortfolioBreakdownWidget,
  DividendCoverageInsightWidget,
  SavingsRateTrendWidget,
  InvestSimulatorWidget
} from "../features/insights/AdvancedInsights";
import {
  RealReturnWidget,
  GoalPlannerWidget,
  InvestCapacityWidget,
  TradeVsSpendWidget,
  ConcentrationWidget,
  type AdvancedWidgetProps
} from "../features/dashboard/AdvancedWidgets";

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

const monthOf = (d: string) => (d || "").slice(0, 7);

const isLivingExpense = (l: LedgerEntry) =>
  l.kind === "expense" &&
  l.category !== "신용결제" &&
  l.category !== "재테크" &&
  Number(l.amount) > 0;

/** 이전 달 yyyy-mm 문자열 */
const prevMonth = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1); // month is 0-indexed
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** yyyy-mm 기준으로 n개월 전까지 배열 반환 (오래된 순) */
const lastNMonths = (ym: string, n: number): string[] => {
  const result: string[] = [];
  let cur = ym;
  for (let i = 0; i < n; i++) {
    result.unshift(cur);
    cur = prevMonth(cur);
  }
  return result;
};

/** Date 기준 요일 인덱스를 월=0 ... 일=6 으로 재매핑 */
const dowIndex = (dateStr: string): number => {
  const d = new Date(dateStr);
  const jsDay = d.getDay(); // 0=Sun
  return jsDay === 0 ? 6 : jsDay - 1; // Mon=0 ... Sun=6
};

const DOW_KR = ["월", "화", "수", "목", "금", "토", "일"] as const;

/* ------------------------------------------------------------------ */
/*  default month                                                      */
/* ------------------------------------------------------------------ */

function pickDefaultMonth(ledger: LedgerEntry[]): string {
  const months = ledger
    .filter((l) => l.kind === "expense" && l.date)
    .map((l) => monthOf(l.date))
    .filter(Boolean)
    .sort();
  return months.length ? months[months.length - 1] : new Date().toISOString().slice(0, 7);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades?: StockTrade[];
  prices?: StockPrice[];
  fxRate?: number;
  categoryPresets: CategoryPresets;
  budgetGoals?: BudgetGoal[];
}

export const InsightsView: React.FC<Props> = ({ accounts, ledger, trades = [], prices = [], fxRate = 1350, categoryPresets, budgetGoals: _goals }) => {
  const [month, setMonth] = useState<string>(() => pickDefaultMonth(ledger));

  /* --- month options --- */
  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    ledger.forEach((l) => {
      if (l.date) set.add(monthOf(l.date));
    });
    const months = Array.from(set).sort((a, b) => b.localeCompare(a));
    return months.length ? months : [new Date().toISOString().slice(0, 7)];
  }, [ledger]);

  /* --- filtered entries --- */
  const livingEntries = useMemo(
    () => ledger.filter((l) => isLivingExpense(l) && monthOf(l.date) === month),
    [ledger, month]
  );

  const prevLivingEntries = useMemo(() => {
    const pm = prevMonth(month);
    return ledger.filter((l) => isLivingExpense(l) && monthOf(l.date) === pm);
  }, [ledger, month]);

  const totalLiving = useMemo(() => livingEntries.reduce((s, e) => s + Number(e.amount), 0), [livingEntries]);
  const prevTotalLiving = useMemo(
    () => prevLivingEntries.reduce((s, e) => s + Number(e.amount), 0),
    [prevLivingEntries]
  );

  const totalIncome = useMemo(
    () =>
      ledger
        .filter((l) => l.kind === "income" && monthOf(l.date) === month && Number(l.amount) > 0)
        .reduce((s, e) => s + Number(e.amount), 0),
    [ledger, month]
  );

  /* ================================================================ */
  /*  1. Spending Analogies                                           */
  /* ================================================================ */
  const analogies = useMemo(() => {
    const items: { icon: string; label: string; unit: string; price: number }[] = [
      { icon: "[C]", label: "커피", unit: "잔", price: 5500 },
      { icon: "[Ch]", label: "치킨", unit: "마리", price: 22000 },
      { icon: "[M]", label: "영화", unit: "편", price: 15000 },
      { icon: "[N]", label: "넷플릭스", unit: "월", price: 17000 },
      { icon: "[T]", label: "택시 기본요금", unit: "회", price: 4800 },
    ];
    return items.map((it) => ({
      ...it,
      count: totalLiving > 0 ? Math.floor(totalLiving / it.price) : 0,
      equiv: totalLiving,
    }));
  }, [totalLiving]);

  /* ================================================================ */
  /*  2. Category Trends                                              */
  /* ================================================================ */
  const categoryTrends = useMemo(() => {
    const thisMap = new Map<string, number>();
    const prevMap = new Map<string, number>();
    for (const e of livingEntries) {
      const cat = e.category || "기타";
      thisMap.set(cat, (thisMap.get(cat) ?? 0) + Number(e.amount));
    }
    for (const e of prevLivingEntries) {
      const cat = e.category || "기타";
      prevMap.set(cat, (prevMap.get(cat) ?? 0) + Number(e.amount));
    }
    const allCats = new Set([...thisMap.keys(), ...prevMap.keys()]);
    const rows: { category: string; thisMonth: number; lastMonth: number; change: number; pct: number }[] = [];
    for (const cat of allCats) {
      const tm = thisMap.get(cat) ?? 0;
      const lm = prevMap.get(cat) ?? 0;
      const change = tm - lm;
      const pct = lm > 0 ? (change / lm) * 100 : tm > 0 ? 100 : 0;
      rows.push({ category: cat, thisMonth: tm, lastMonth: lm, change, pct });
    }
    rows.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    return rows.slice(0, 8);
  }, [livingEntries, prevLivingEntries]);

  /* ================================================================ */
  /*  3. Spending Patterns (day of week)                              */
  /* ================================================================ */
  const spendingPatterns = useMemo(() => {
    const dowTotals = Array(7).fill(0) as number[];
    const dailyMap = new Map<string, number>();

    for (const e of livingEntries) {
      const idx = dowIndex(e.date);
      const amt = Number(e.amount);
      dowTotals[idx] += amt;
      dailyMap.set(e.date, (dailyMap.get(e.date) ?? 0) + amt);
    }

    const maxDow = Math.max(...dowTotals, 1);
    const dailyAmounts = Array.from(dailyMap.values());
    const avgDaily = dailyAmounts.length > 0 ? dailyAmounts.reduce((a, b) => a + b, 0) / dailyAmounts.length : 0;

    let mostExpensiveDay = "";
    let mostExpensiveAmount = 0;
    for (const [date, amt] of dailyMap) {
      if (amt > mostExpensiveAmount) {
        mostExpensiveDay = date;
        mostExpensiveAmount = amt;
      }
    }

    return {
      dowTotals,
      maxDow,
      avgDaily,
      mostExpensiveDay,
      mostExpensiveAmount,
    };
  }, [livingEntries]);

  /* ================================================================ */
  /*  4. Spending Score                                               */
  /* ================================================================ */
  const scoreData = useMemo(() => {
    // savings rate points (40)
    const savingsRate = totalIncome > 0 ? 1 - totalLiving / totalIncome : 0;
    let savingsPoints = 0;
    if (savingsRate >= 0.5) savingsPoints = 40;
    else if (savingsRate >= 0.3) savingsPoints = 30;
    else if (savingsRate >= 0.2) savingsPoints = 20;
    else if (savingsRate >= 0.1) savingsPoints = 10;

    // improvement points (30)
    let improvementPoints = 0;
    if (prevTotalLiving > 0 && totalLiving < prevTotalLiving) {
      const decreasePct = ((prevTotalLiving - totalLiving) / prevTotalLiving) * 100;
      improvementPoints = Math.min(30, Math.round(30 * (decreasePct / 20)));
    }

    // consistency points (30)
    const dailyMap = new Map<string, number>();
    for (const e of livingEntries) {
      dailyMap.set(e.date, (dailyMap.get(e.date) ?? 0) + Number(e.amount));
    }
    const dailyAmounts = Array.from(dailyMap.values());
    let consistencyPoints = 0;
    if (dailyAmounts.length >= 2) {
      const mean = dailyAmounts.reduce((a, b) => a + b, 0) / dailyAmounts.length;
      const variance = dailyAmounts.reduce((s, v) => s + (v - mean) ** 2, 0) / dailyAmounts.length;
      const stddev = Math.sqrt(variance);
      const cv = mean > 0 ? stddev / mean : 999;
      if (cv < 0.5) consistencyPoints = 30;
      else if (cv < 1.0) consistencyPoints = 20;
      else if (cv < 1.5) consistencyPoints = 10;
    } else if (dailyAmounts.length === 1) {
      consistencyPoints = 30; // only one spending day => perfectly consistent
    }

    const total = savingsPoints + improvementPoints + consistencyPoints;

    let grade: string;
    let comment: string;
    if (total >= 90) {
      grade = "A+"; comment = "완벽한 소비 습관이에요!";
    } else if (total >= 80) {
      grade = "A"; comment = "정말 잘 관리하고 있어요!";
    } else if (total >= 70) {
      grade = "B+"; comment = "꽤 좋은 소비 패턴이에요!";
    } else if (total >= 60) {
      grade = "B"; comment = "나쁘지 않아요, 조금만 더!";
    } else if (total >= 50) {
      grade = "C+"; comment = "개선의 여지가 있어요.";
    } else if (total >= 40) {
      grade = "C"; comment = "소비 조절이 필요해요.";
    } else {
      grade = "D"; comment = "지출을 돌아볼 시간이에요!";
    }

    return {
      total,
      grade,
      comment,
      savingsPoints,
      improvementPoints,
      consistencyPoints,
      savingsRate,
    };
  }, [totalLiving, prevTotalLiving, totalIncome, livingEntries]);

  /* ================================================================ */
  /*  5. Category Heatmap (last 6 months)                             */
  /* ================================================================ */
  const heatmapData = useMemo(() => {
    const months6 = lastNMonths(month, 6);

    // gather all living expenses across 6 months
    const catMonthMap = new Map<string, Map<string, number>>(); // cat -> (month -> amount)
    for (const e of ledger) {
      if (!isLivingExpense(e)) continue;
      const m = monthOf(e.date);
      if (!months6.includes(m)) continue;
      const cat = e.category || "기타";
      if (!catMonthMap.has(cat)) catMonthMap.set(cat, new Map());
      const mMap = catMonthMap.get(cat)!;
      mMap.set(m, (mMap.get(m) ?? 0) + Number(e.amount));
    }

    // top 8 categories by total
    const catTotals = Array.from(catMonthMap.entries()).map(([cat, mMap]) => {
      let total = 0;
      for (const v of mMap.values()) total += v;
      return { cat, total, mMap };
    });
    catTotals.sort((a, b) => b.total - a.total);
    const top8 = catTotals.slice(0, 8);

    // normalize per category
    const rows = top8.map(({ cat, mMap }) => {
      const values = months6.map((m) => mMap.get(m) ?? 0);
      const max = Math.max(...values, 1);
      return {
        category: cat,
        cells: months6.map((m, i) => ({
          month: m,
          amount: values[i],
          intensity: values[i] / max,
        })),
      };
    });

    return { months: months6, rows };
  }, [ledger, month]);

  /* ================================================================ */
  /*  Styles                                                          */
  /* ================================================================ */
  const cardStyle: React.CSSProperties = {
    padding: 16,
    borderRadius: 12,
  };

  const cardTitleStyle: React.CSSProperties = {
    margin: "0 0 12px 0",
    fontSize: 16,
    fontWeight: 700,
    color: "var(--text)",
  };

  const subtleText: React.CSSProperties = {
    fontSize: 12,
    color: "var(--text-muted)",
  };

  /* ================================================================ */
  /*  Render                                                          */
  /* ================================================================ */
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h2 style={{ margin: "0 0 4px 0" }}>인사이트</h2>

      {/* Month Selector */}
      <div className="card" style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ color: "var(--text-muted)" }}>기간:</span>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 6 }}
        >
          {monthOptions.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <span style={{ marginLeft: "auto", fontWeight: 700, fontSize: 14 }}>
          생활비 합계: <span style={{ color: "var(--danger)" }}>{formatKRW(Math.round(totalLiving))}</span>
        </span>
      </div>

      {/* ============================================================ */}
      {/*  1. Spending Analogies                                       */}
      {/* ============================================================ */}
      <div className="card" style={cardStyle}>
        <h3 style={cardTitleStyle}>
          이번달 소비 비유
        </h3>
        {totalLiving === 0 ? (
          <p style={subtleText}>이번 달 생활비 지출이 없습니다.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
            {analogies.map((a) => (
              <div
                key={a.label}
                style={{
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "12px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <span style={{ fontSize: 28 }}>{a.icon}</span>
                <span style={{ fontWeight: 700, fontSize: 18, color: "var(--text)" }}>
                  {a.label} {formatNumber(a.count)}{a.unit}
                </span>
                <span style={subtleText}>
                  @{formatKRW(a.price)}/{a.unit}
                </span>
              </div>
            ))}
          </div>
        )}
        {totalLiving > 0 && (
          <p style={{ ...subtleText, marginTop: 10, textAlign: "right" }}>
            이번 달 총 생활비: {formatKRW(Math.round(totalLiving))}
          </p>
        )}
      </div>

      {/* ============================================================ */}
      {/*  2. Category Trends                                          */}
      {/* ============================================================ */}
      <div className="card" style={cardStyle}>
        <h3 style={cardTitleStyle}>
          카테고리 변화 추이
        </h3>
        <p style={{ ...subtleText, margin: "0 0 10px 0" }}>
          전월 대비 카테고리별 지출 변화 (생활비 기준)
        </p>
        {categoryTrends.length === 0 ? (
          <p style={subtleText}>데이터가 부족합니다.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {categoryTrends.map((row) => {
              const isIncrease = row.change > 0;
              const isDecrease = row.change < 0;
              const color = isDecrease ? "var(--success)" : isIncrease ? "var(--danger)" : "var(--text-muted)";
              const arrow = isIncrease ? "^" : isDecrease ? "v" : "-";
              return (
                <div
                  key={row.category}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontWeight: 600, minWidth: 80, fontSize: 13, color: "var(--text)" }}>
                    {row.category}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 100 }}>
                    {formatKRW(Math.round(row.lastMonth))} {"->"} {formatKRW(Math.round(row.thisMonth))}
                  </span>
                  <span style={{ marginLeft: "auto", fontWeight: 700, fontSize: 14, color }}>
                    {arrow} {formatKRW(Math.abs(Math.round(row.change)))}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color,
                      background: isDecrease
                        ? "rgba(16,185,129,0.12)"
                        : isIncrease
                          ? "rgba(239,68,68,0.12)"
                          : "transparent",
                      borderRadius: 4,
                      padding: "2px 6px",
                    }}
                  >
                    {row.pct >= 0 ? "+" : ""}{Math.round(row.pct)}%
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/*  3. Spending Patterns                                        */}
      {/* ============================================================ */}
      <div className="card" style={cardStyle}>
        <h3 style={cardTitleStyle}>
          소비 패턴
        </h3>
        <p style={{ ...subtleText, margin: "0 0 10px 0" }}>
          요일별 지출 합계 (생활비)
        </p>
        {totalLiving === 0 ? (
          <p style={subtleText}>이번 달 지출이 없습니다.</p>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {DOW_KR.map((label, idx) => {
                const val = spendingPatterns.dowTotals[idx];
                const pct = spendingPatterns.maxDow > 0 ? (val / spendingPatterns.maxDow) * 100 : 0;
                const isMax = val === spendingPatterns.maxDow && val > 0;
                return (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        width: 24,
                        textAlign: "center",
                        fontWeight: isMax ? 800 : 600,
                        fontSize: 13,
                        color: isMax ? "var(--primary)" : "var(--text)",
                      }}
                    >
                      {label}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        height: 22,
                        background: "var(--bg)",
                        borderRadius: 6,
                        overflow: "hidden",
                        border: "1px solid var(--border)",
                        position: "relative",
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.max(pct, 1)}%`,
                          height: "100%",
                          background: isMax
                            ? "linear-gradient(90deg, var(--primary), #6366f1)"
                            : "var(--primary)",
                          opacity: isMax ? 1 : 0.5,
                          borderRadius: 6,
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                    <span
                      style={{
                        minWidth: 90,
                        textAlign: "right",
                        fontSize: 12,
                        fontWeight: isMax ? 700 : 400,
                        color: isMax ? "var(--primary)" : "var(--text-muted)",
                      }}
                    >
                      {formatKRW(Math.round(val))}
                    </span>
                  </div>
                );
              })}
            </div>
            <div
              style={{
                display: "flex",
                gap: 16,
                marginTop: 14,
                flexWrap: "wrap",
                paddingTop: 10,
                borderTop: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={subtleText}>일 평균 지출</span>
                <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>
                  {formatKRW(Math.round(spendingPatterns.avgDaily))}
                </span>
              </div>
              {spendingPatterns.mostExpensiveDay && (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={subtleText}>최고 지출일</span>
                  <span style={{ fontWeight: 700, fontSize: 15, color: "var(--danger)" }}>
                    {spendingPatterns.mostExpensiveDay} ({formatKRW(Math.round(spendingPatterns.mostExpensiveAmount))})
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ============================================================ */}
      {/*  4. Spending Score                                           */}
      {/* ============================================================ */}
      <div className="card" style={cardStyle}>
        <h3 style={cardTitleStyle}>
          소비 점수
        </h3>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "10px 0" }}>
          {/* Circular score display */}
          <div
            style={{
              position: "relative",
              width: 140,
              height: 140,
              borderRadius: "50%",
              background: `conic-gradient(
                ${scoreData.total >= 70 ? "var(--success)" : scoreData.total >= 40 ? "var(--primary)" : "var(--danger)"} ${scoreData.total * 3.6}deg,
                var(--border) ${scoreData.total * 3.6}deg
              )`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 112,
                height: 112,
                borderRadius: "50%",
                background: "var(--surface)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <span style={{ fontSize: 32, fontWeight: 800, color: "var(--text)" }}>
                {scoreData.total}
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--primary)" }}>
                {scoreData.grade}
              </span>
            </div>
          </div>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", textAlign: "center" }}>
            {scoreData.comment}
          </span>
        </div>

        {/* Score breakdown */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 8,
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px solid var(--border)",
          }}
        >
          <div
            style={{
              background: "var(--bg)",
              borderRadius: 8,
              padding: "10px 12px",
              textAlign: "center",
              border: "1px solid var(--border)",
            }}
          >
            <div style={subtleText}>저축률</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: "var(--text)" }}>
              {scoreData.savingsPoints}<span style={{ fontSize: 12, color: "var(--text-muted)" }}>/40</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {totalIncome > 0 ? `${Math.round(scoreData.savingsRate * 100)}%` : "수입 없음"}
            </div>
          </div>
          <div
            style={{
              background: "var(--bg)",
              borderRadius: 8,
              padding: "10px 12px",
              textAlign: "center",
              border: "1px solid var(--border)",
            }}
          >
            <div style={subtleText}>전월 대비 개선</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: "var(--text)" }}>
              {scoreData.improvementPoints}<span style={{ fontSize: 12, color: "var(--text-muted)" }}>/30</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {prevTotalLiving > 0
                ? totalLiving < prevTotalLiving
                  ? `${Math.round(((prevTotalLiving - totalLiving) / prevTotalLiving) * 100)}% 절약`
                  : "전월 대비 증가"
                : "전월 데이터 없음"}
            </div>
          </div>
          <div
            style={{
              background: "var(--bg)",
              borderRadius: 8,
              padding: "10px 12px",
              textAlign: "center",
              border: "1px solid var(--border)",
            }}
          >
            <div style={subtleText}>일관성</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: "var(--text)" }}>
              {scoreData.consistencyPoints}<span style={{ fontSize: 12, color: "var(--text-muted)" }}>/30</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              일별 편차 기준
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/*  5. Category Heatmap                                         */}
      {/* ============================================================ */}
      <div className="card" style={cardStyle}>
        <h3 style={cardTitleStyle}>
          월별 카테고리 히트맵
        </h3>
        <p style={{ ...subtleText, margin: "0 0 10px 0" }}>
          최근 6개월 카테고리별 지출 강도 (카테고리 내 최대치 대비)
        </p>
        {heatmapData.rows.length === 0 ? (
          <p style={subtleText}>데이터가 부족합니다.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "separate",
                borderSpacing: 3,
                fontSize: 12,
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "6px 8px",
                      color: "var(--text-muted)",
                      fontWeight: 600,
                      minWidth: 70,
                    }}
                  >
                    카테고리
                  </th>
                  {heatmapData.months.map((m) => (
                    <th
                      key={m}
                      style={{
                        textAlign: "center",
                        padding: "6px 4px",
                        color: "var(--text-muted)",
                        fontWeight: 600,
                        minWidth: 60,
                      }}
                    >
                      {m.slice(2).replace("-", ".")}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmapData.rows.map((row) => (
                  <tr key={row.category}>
                    <td
                      style={{
                        padding: "6px 8px",
                        fontWeight: 600,
                        color: "var(--text)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {row.category}
                    </td>
                    {row.cells.map((cell) => {
                      const r = 239, g = 68, b = 68; // red tones for spending
                      const bg =
                        cell.amount > 0
                          ? `rgba(${r}, ${g}, ${b}, ${Math.max(cell.intensity * 0.85, 0.08)})`
                          : "var(--bg)";
                      return (
                        <td
                          key={cell.month}
                          title={`${row.category} ${cell.month}: ${formatKRW(Math.round(cell.amount))}`}
                          style={{
                            textAlign: "center",
                            padding: "8px 4px",
                            borderRadius: 6,
                            background: bg,
                            color: cell.intensity > 0.5 ? "#fff" : "var(--text)",
                            fontWeight: cell.intensity > 0.5 ? 700 : 400,
                            cursor: "default",
                            transition: "background 0.2s",
                            minWidth: 60,
                          }}
                        >
                          {cell.amount > 0 ? formatNumber(Math.round(cell.amount / 10000)) + "만" : "-"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Legend */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 8,
                justifyContent: "flex-end",
              }}
            >
              <span style={subtleText}>낮음</span>
              {[0.1, 0.3, 0.5, 0.7, 0.9].map((intensity) => (
                <div
                  key={intensity}
                  style={{
                    width: 18,
                    height: 14,
                    borderRadius: 3,
                    background: `rgba(239, 68, 68, ${intensity * 0.85})`,
                  }}
                />
              ))}
              <span style={subtleText}>높음</span>
            </div>
          </div>
        )}
      {/* 고급 인사이트 위젯 */}
      {(() => {
        const wp = { accounts, ledger, trades, prices, fxRate, categoryPresets, month };
        return (
          <>
            <WaterfallWidget {...wp} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12 }}>
              <TopThreeBlocksWidget {...wp} />
              <SubscriptionAlertWidget {...wp} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12 }}>
              <PortfolioBreakdownWidget {...wp} />
              <DividendCoverageInsightWidget {...wp} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12 }}>
              <SavingsRateTrendWidget {...wp} />
              <InvestSimulatorWidget {...wp} />
            </div>
          </>
        );
      })()}

      {/* 대시보드에서 이동한 고급 위젯 */}
      {(() => {
        const awp: AdvancedWidgetProps = { accounts, ledger, trades, prices, fxRate, categoryPresets, budgetGoals: _goals };
        return (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12 }}>
              <RealReturnWidget {...awp} />
              <GoalPlannerWidget {...awp} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 12 }}>
              <InvestCapacityWidget {...awp} />
              <TradeVsSpendWidget {...awp} />
            </div>
            <ConcentrationWidget {...awp} />
          </>
        );
      })()}

      </div>
    </div>
  );
};
