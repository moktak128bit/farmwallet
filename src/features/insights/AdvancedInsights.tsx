import { useState, useMemo } from "react";
import type {
  Account,
  LedgerEntry,
  StockTrade,
  StockPrice,
  CategoryPresets,
} from "../../types";
import { formatKRW, formatNumber } from "../../utils/formatter";
import { isUSDStock } from "../../utils/finance";

// ---------------------------------------------------------------------------
// Shared props
// ---------------------------------------------------------------------------

export interface InsightWidgetProps {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
  fxRate: number;
  categoryPresets: CategoryPresets;
  month: string; // "yyyy-MM"
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const monthOf = (d: string) => (d || "").slice(0, 7);

const prevMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(y, mo - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const getDateAccountId = () => {
  try {
    return localStorage.getItem("fw-date-account-id") ?? "";
  } catch {
    return "";
  }
};

const getDateAccountRatio = () => {
  try {
    return Number(localStorage.getItem("fw-date-account-ratio")) || 50;
  } catch {
    return 50;
  }
};

const lastNMonths = (month: string, n: number): string[] => {
  const result: string[] = [];
  let cur = month;
  for (let i = 0; i < n; i++) {
    result.unshift(cur);
    cur = prevMonth(cur);
  }
  return result;
};

const pct = (v: number, total: number) =>
  total > 0 ? Math.round((v / total) * 100) : 0;

const barStyle = (
  widthPct: number,
  color: string,
): React.CSSProperties => ({
  height: 18,
  width: `${Math.min(Math.max(widthPct, 0), 100)}%`,
  background: color,
  borderRadius: 3,
  minWidth: widthPct > 0 ? 2 : 0,
  transition: "width 0.3s",
});

// ---------------------------------------------------------------------------
// 1. WaterfallWidget — 돈의 흐름 (월간 워터폴)
// ---------------------------------------------------------------------------

export const WaterfallWidget: React.FC<InsightWidgetProps> = ({
  ledger,
  accounts,
  month,
}) => {
  const items = useMemo(() => {
    const ml = ledger.filter((e) => monthOf(e.date) === month);
    const salary = ml
      .filter((e) => e.kind === "income" && e.subCategory === "급여")
      .reduce((s, e) => s + e.amount, 0);
    const otherIncome = ml
      .filter(
        (e) =>
          e.kind === "income" &&
          e.subCategory !== "급여" &&
          e.subCategory !== "이월",
      )
      .reduce((s, e) => s + e.amount, 0);
    const fixedExp = ml
      .filter((e) => e.kind === "expense" && e.isFixedExpense === true)
      .reduce((s, e) => s + e.amount, 0);
    const varExp = ml
      .filter(
        (e) =>
          e.kind === "expense" &&
          !e.isFixedExpense &&
          e.category !== "신용결제" &&
          e.category !== "재테크",
      )
      .reduce((s, e) => s + e.amount, 0);
    const investGain = ml
      .filter(
        (e) =>
          e.kind === "expense" &&
          e.category === "재테크" &&
          (e.subCategory || "").includes("투자수익"),
      )
      .reduce((s, e) => s + e.amount, 0);
    const investLoss = ml
      .filter(
        (e) =>
          e.kind === "expense" &&
          e.category === "재테크" &&
          (e.subCategory || "").includes("투자손실"),
      )
      .reduce((s, e) => s + e.amount, 0);
    const divInt = ml
      .filter(
        (e) =>
          e.kind === "income" &&
          ((e.subCategory || "").includes("배당") ||
            e.subCategory === "이자"),
      )
      .reduce((s, e) => s + e.amount, 0);

    const startBal = accounts.reduce((s, a) => s + a.initialBalance, 0);

    const rows: { label: string; value: number; positive: boolean }[] = [
      { label: "월초 잔액", value: startBal, positive: true },
      { label: "급여 수입", value: salary, positive: true },
      { label: "급여 외 수입", value: otherIncome, positive: true },
      { label: "고정지출", value: -fixedExp, positive: false },
      { label: "변동지출", value: -varExp, positive: false },
      { label: "투자수익", value: investGain, positive: true },
      { label: "투자손실", value: -investLoss, positive: false },
      { label: "배당/이자", value: divInt, positive: true },
    ];

    const endBal =
      startBal +
      salary +
      otherIncome -
      fixedExp -
      varExp +
      investGain -
      investLoss +
      divInt;
    rows.push({ label: "월말 잔액", value: endBal, positive: true });

    return rows;
  }, [ledger, accounts, month]);

  const maxAbs = useMemo(
    () => Math.max(...items.map((r) => Math.abs(r.value)), 1),
    [items],
  );

  if (items.every((r) => r.value === 0 && r.label !== "월초 잔액")) {
    return (
      <div className="card">
        <div className="card-title">돈의 흐름 (월간 워터폴)</div>
        <p style={{ color: "var(--text-muted)" }}>데이터 없음</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title">돈의 흐름 (월간 워터폴)</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((r) => {
          const isBalance =
            r.label === "월초 잔액" || r.label === "월말 잔액";
          const color = isBalance
            ? "var(--text-muted)"
            : r.value >= 0
              ? "var(--success)"
              : "var(--danger)";
          const w = pct(Math.abs(r.value), maxAbs);
          return (
            <div
              key={r.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                style={{
                  width: 90,
                  flexShrink: 0,
                  fontSize: 13,
                  color: "var(--text)",
                }}
              >
                {r.label}
              </span>
              <div
                style={{
                  flex: 1,
                  background: "var(--surface)",
                  borderRadius: 3,
                  overflow: "hidden",
                }}
              >
                <div style={barStyle(w, color)} />
              </div>
              <span
                style={{
                  width: 110,
                  textAlign: "right",
                  flexShrink: 0,
                  fontSize: 13,
                  color,
                  fontWeight: isBalance ? 700 : 400,
                }}
              >
                {r.value >= 0 ? "+" : ""}
                {formatKRW(r.value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 2. TopThreeBlocksWidget — 3대 블록 비율
// ---------------------------------------------------------------------------

export const TopThreeBlocksWidget: React.FC<InsightWidgetProps> = ({
  ledger,
  month,
}) => {
  const data = useMemo(() => {
    const ml = ledger.filter(
      (e) =>
        monthOf(e.date) === month &&
        e.kind === "expense" &&
        e.category !== "신용결제" &&
        e.category !== "재테크",
    );
    const totalLiving = ml.reduce((s, e) => s + e.amount, 0);

    const dateAccId = getDateAccountId();
    const ratio = getDateAccountRatio() / 100;

    const dateEntries = ml.filter((e) => e.category === "데이트비");
    const dateExpense = dateEntries.reduce((s, e) => {
      const r = e.fromAccountId === dateAccId ? ratio : 1;
      return s + e.amount * r;
    }, 0);

    const carEntries = ml.filter(
      (e) =>
        e.category === "유류교통비" ||
        (e.category === "데이트비" &&
          (e.subCategory === "이동" || e.subCategory === "주차비")),
    );
    const carExpense = carEntries.reduce((s, e) => s + e.amount, 0);

    const foodExpense = ml
      .filter((e) => e.category === "식비")
      .reduce((s, e) => s + e.amount, 0);

    const blockTotal = dateExpense + carExpense + foodExpense;
    const blockPct = pct(blockTotal, totalLiving);

    return { totalLiving, dateExpense, carExpense, foodExpense, blockPct };
  }, [ledger, month]);

  if (data.totalLiving === 0) {
    return (
      <div className="card">
        <div className="card-title">3대 블록 비율</div>
        <p style={{ color: "var(--text-muted)" }}>데이터 없음</p>
      </div>
    );
  }

  const blocks = [
    { label: "데이트비 실부담", value: data.dateExpense },
    { label: "차량비", value: data.carExpense },
    { label: "식비", value: data.foodExpense },
  ];

  return (
    <div className="card">
      <div className="card-title">3대 블록 비율</div>
      <p
        style={{
          margin: "0 0 10px",
          fontSize: 14,
          fontWeight: 600,
          color: "var(--primary)",
        }}
      >
        3대 블록이 전체의 {data.blockPct}%
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {blocks.map((b) => {
          const p = pct(b.value, data.totalLiving);
          return (
            <div key={b.label}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                  marginBottom: 2,
                }}
              >
                <span>{b.label}</span>
                <span style={{ color: "var(--text-muted)" }}>
                  {formatKRW(b.value)} ({p}%)
                </span>
              </div>
              <div
                style={{
                  background: "var(--surface)",
                  borderRadius: 3,
                  overflow: "hidden",
                }}
              >
                <div style={barStyle(p, "var(--primary)")} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 3. SubscriptionAlertWidget — 구독비 추이 경고
// ---------------------------------------------------------------------------

export const SubscriptionAlertWidget: React.FC<InsightWidgetProps> = ({
  ledger,
  month,
}) => {
  const AI_KEYWORDS = [
    "chatgpt",
    "cursor",
    "claude",
    "grok",
    "gemini",
    "copilot",
    "ai",
  ];

  const data = useMemo(() => {
    const months = lastNMonths(month, 6);
    const isAI = (sub: string) =>
      AI_KEYWORDS.some((k) => (sub || "").toLowerCase().includes(k));

    const perMonth = months.map((m) => {
      const ml = ledger.filter(
        (e) => monthOf(e.date) === m && e.category === "구독비",
      );
      const ai = ml.filter((e) => isAI(e.subCategory || "")).reduce((s, e) => s + e.amount, 0);
      const other = ml.filter((e) => !isAI(e.subCategory || "")).reduce((s, e) => s + e.amount, 0);
      const subs = new Set(ml.map((e) => e.subCategory || e.description));
      return { month: m, ai, other, total: ai + other, subs };
    });

    const current = perMonth[perMonth.length - 1];
    const annual = current.total * 12;

    // Three months ago
    const threeAgo = perMonth.length >= 4 ? perMonth[perMonth.length - 4] : null;
    const newSubs = threeAgo
      ? [...current.subs].filter((s) => !threeAgo.subs.has(s))
      : [];

    // Warning level
    let warningLevel: "none" | "yellow" | "red" = "none";
    if (threeAgo && threeAgo.total > 0) {
      const incr = (current.total - threeAgo.total) / threeAgo.total;
      if (incr >= 0.5) warningLevel = "red";
      else if (incr >= 0.2) warningLevel = "yellow";
    }

    return { perMonth, current, annual, newSubs, warningLevel };
  }, [ledger, month]);

  const maxBar = useMemo(
    () => Math.max(...data.perMonth.map((p) => p.total), 1),
    [data.perMonth],
  );

  return (
    <div className="card">
      <div className="card-title">
        구독비 추이 경고
        {data.warningLevel === "red" && (
          <span style={{ color: "var(--danger)", marginLeft: 8, fontSize: 12 }}>
            50%+ 증가
          </span>
        )}
        {data.warningLevel === "yellow" && (
          <span style={{ color: "#e8a500", marginLeft: 8, fontSize: 12 }}>
            20%+ 증가
          </span>
        )}
      </div>
      <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--text-muted)" }}>
        이번 달 {formatKRW(data.current.total)} · 연간 환산{" "}
        {formatKRW(data.annual)}
      </p>

      <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 80, marginBottom: 8 }}>
        {data.perMonth.map((p) => {
          const h = pct(p.total, maxBar);
          const aiH = p.total > 0 ? Math.round((p.ai / p.total) * h) : 0;
          const otherH = h - aiH;
          return (
            <div
              key={p.month}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                alignItems: "center",
                height: "100%",
              }}
            >
              <div
                style={{
                  width: "70%",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                }}
              >
                <div
                  style={{
                    height: aiH * 0.8,
                    background: "var(--primary)",
                    borderRadius: "3px 3px 0 0",
                  }}
                />
                <div
                  style={{
                    height: otherH * 0.8,
                    background: "var(--text-muted)",
                    borderRadius: aiH > 0 ? 0 : "3px 3px 0 0",
                  }}
                />
              </div>
              <span style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                {p.month.slice(5)}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
        <span>
          <span style={{ display: "inline-block", width: 10, height: 10, background: "var(--primary)", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />
          AI
        </span>
        <span>
          <span style={{ display: "inline-block", width: 10, height: 10, background: "var(--text-muted)", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />
          기타
        </span>
      </div>

      {data.newSubs.length > 0 && (
        <p style={{ fontSize: 12, color: "var(--danger)", margin: "4px 0 0" }}>
          신규 구독: {data.newSubs.join(", ")}
        </p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 4. PortfolioBreakdownWidget — 포트폴리오 손익 분해
// ---------------------------------------------------------------------------

export const PortfolioBreakdownWidget: React.FC<InsightWidgetProps> = ({
  accounts,
  trades,
  prices,
  fxRate,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const data = useMemo(() => {
    const priceMap = new Map<string, StockPrice>();
    for (const p of prices) priceMap.set(p.ticker, p);

    const accountIds = [...new Set(trades.map((t) => t.accountId))];

    return accountIds.map((accId) => {
      const accTrades = trades.filter((t) => t.accountId === accId);
      const acc = accounts.find((a) => a.id === accId);
      const accName = acc?.name ?? accId;

      const totalBuy = accTrades
        .filter((t) => t.side === "buy")
        .reduce((s, t) => s + t.totalAmount * (isUSDStock(t.ticker) ? (t.fxRateAtTrade || fxRate) : 1), 0);
      const totalSell = accTrades
        .filter((t) => t.side === "sell")
        .reduce((s, t) => s + t.totalAmount * (isUSDStock(t.ticker) ? (t.fxRateAtTrade || fxRate) : 1), 0);

      // Holdings
      const holdMap = new Map<string, { qty: number; buyAmt: number; name: string }>();
      for (const t of accTrades) {
        const prev = holdMap.get(t.ticker) || { qty: 0, buyAmt: 0, name: t.name };
        if (t.side === "buy") {
          prev.qty += t.quantity;
          prev.buyAmt += t.totalAmount * (isUSDStock(t.ticker) ? (t.fxRateAtTrade || fxRate) : 1);
        } else {
          const soldRatio = prev.qty > 0 ? t.quantity / prev.qty : 0;
          prev.buyAmt -= prev.buyAmt * soldRatio;
          prev.qty -= t.quantity;
        }
        holdMap.set(t.ticker, prev);
      }

      let currentValue = 0;
      const holdings: { ticker: string; name: string; value: number; pnl: number }[] = [];

      holdMap.forEach((h, ticker) => {
        if (h.qty <= 0) return;
        const sp = priceMap.get(ticker);
        const mp = sp?.price ?? 0;
        const usd = isUSDStock(ticker);
        const val = h.qty * mp * (usd ? fxRate : 1);
        const pnl = val - h.buyAmt;
        currentValue += val;
        holdings.push({ ticker, name: h.name, value: val, pnl });
      });

      holdings.sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));

      const pnl = currentValue + totalSell - totalBuy;

      return { accId, accName, totalBuy, totalSell, currentValue, pnl, holdings: holdings.slice(0, 5) };
    });
  }, [accounts, trades, prices, fxRate]);

  const maxPnl = useMemo(
    () => Math.max(...data.map((d) => Math.abs(d.pnl)), 1),
    [data],
  );

  if (data.length === 0) {
    return (
      <div className="card">
        <div className="card-title">포트폴리오 손익 분해</div>
        <p style={{ color: "var(--text-muted)" }}>데이터 없음</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title">포트폴리오 손익 분해</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {data.map((d) => {
          const color = d.pnl >= 0 ? "var(--success)" : "var(--danger)";
          const w = pct(Math.abs(d.pnl), maxPnl);
          const expanded = expandedId === d.accId;
          return (
            <div key={d.accId}>
              <div
                style={{ cursor: "pointer" }}
                onClick={() => setExpandedId(expanded ? null : d.accId)}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 13,
                    marginBottom: 2,
                  }}
                >
                  <span>{d.accName} {expanded ? "▾" : "▸"}</span>
                  <span style={{ color, fontWeight: 600 }}>
                    {d.pnl >= 0 ? "+" : ""}
                    {formatKRW(d.pnl)}
                  </span>
                </div>
                <div
                  style={{
                    background: "var(--surface)",
                    borderRadius: 3,
                    overflow: "hidden",
                  }}
                >
                  <div style={barStyle(w, color)} />
                </div>
              </div>
              {expanded && (
                <div style={{ paddingLeft: 12, marginTop: 6 }}>
                  {d.holdings.length === 0 && (
                    <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      보유 종목 없음
                    </p>
                  )}
                  {d.holdings.map((h) => (
                    <div
                      key={h.ticker}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 12,
                        padding: "2px 0",
                        color: h.pnl >= 0 ? "var(--success)" : "var(--danger)",
                      }}
                    >
                      <span style={{ color: "var(--text)" }}>
                        {h.name || h.ticker}
                      </span>
                      <span>
                        {h.pnl >= 0 ? "+" : ""}
                        {formatKRW(h.pnl)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 5. DividendCoverageInsightWidget — 배당 vs 고정지출 커버리지
// ---------------------------------------------------------------------------

export const DividendCoverageInsightWidget: React.FC<InsightWidgetProps> = ({
  ledger,
  month,
}) => {
  const data = useMemo(() => {
    const last3 = lastNMonths(month, 3);
    const divTotal = last3.reduce((s, m) => {
      return (
        s +
        ledger
          .filter(
            (e) =>
              monthOf(e.date) === m &&
              e.kind === "income" &&
              (e.subCategory || "").includes("배당"),
          )
          .reduce((ss, e) => ss + e.amount, 0)
      );
    }, 0);
    const monthlyDiv = divTotal / 3;

    // Fixed expenses: unique sub-categories
    const fixedEntries = ledger.filter(
      (e) =>
        e.kind === "expense" &&
        e.isFixedExpense === true &&
        last3.includes(monthOf(e.date)),
    );
    const fixedMap = new Map<string, number>();
    for (const e of fixedEntries) {
      const key = e.subCategory || e.category;
      fixedMap.set(key, (fixedMap.get(key) || 0) + e.amount);
    }
    const fixedItems = [...fixedMap.entries()]
      .map(([name, total]) => ({ name, monthlyAvg: total / 3 }))
      .sort((a, b) => a.monthlyAvg - b.monthlyAvg);

    // Greedy cover
    let budget = monthlyDiv;
    const covered: { name: string; amount: number; covered: boolean; pct: number }[] = [];
    let nextUncovered: typeof covered[0] | null = null;

    for (const item of fixedItems) {
      if (budget >= item.monthlyAvg) {
        budget -= item.monthlyAvg;
        covered.push({ name: item.name, amount: item.monthlyAvg, covered: true, pct: 100 });
      } else {
        const p = item.monthlyAvg > 0 ? Math.round((budget / item.monthlyAvg) * 100) : 0;
        if (!nextUncovered) {
          nextUncovered = { name: item.name, amount: item.monthlyAvg, covered: false, pct: p };
        }
        covered.push({ name: item.name, amount: item.monthlyAvg, covered: false, pct: p });
        budget = 0;
      }
    }

    const additional = nextUncovered
      ? nextUncovered.amount - (nextUncovered.amount * nextUncovered.pct) / 100
      : 0;

    return { monthlyDiv, covered, nextUncovered, additional };
  }, [ledger, month]);

  if (data.covered.length === 0) {
    return (
      <div className="card">
        <div className="card-title">배당 vs 고정지출 커버리지</div>
        <p style={{ color: "var(--text-muted)" }}>데이터 없음</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title">배당 vs 고정지출 커버리지</div>
      <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--text-muted)" }}>
        월 평균 배당: {formatKRW(data.monthlyDiv)}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {data.covered.map((item) => (
          <div key={item.name}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                marginBottom: 2,
              }}
            >
              <span>
                {item.covered ? "✅" : "❌"} {item.name}
              </span>
              <span style={{ color: "var(--text-muted)" }}>
                {formatKRW(item.amount)}
              </span>
            </div>
            <div
              style={{
                background: "var(--surface)",
                borderRadius: 3,
                overflow: "hidden",
              }}
            >
              <div
                style={barStyle(
                  item.pct,
                  item.covered ? "var(--success)" : "var(--danger)",
                )}
              />
            </div>
          </div>
        ))}
      </div>
      {data.nextUncovered && (
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--primary)" }}>
          다음 목표: {data.nextUncovered.name} 커버까지 월 배당{" "}
          {formatKRW(data.additional)} 추가 필요
        </p>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// 6. SavingsRateTrendWidget — 저축률 + 급여 의존도
// ---------------------------------------------------------------------------

export const SavingsRateTrendWidget: React.FC<InsightWidgetProps> = ({
  ledger,
  month,
}) => {
  const data = useMemo(() => {
    const months = lastNMonths(month, 6);

    return months.map((m) => {
      const ml = ledger.filter((e) => monthOf(e.date) === m);
      const totalIncome = ml
        .filter((e) => e.kind === "income")
        .reduce((s, e) => s + e.amount, 0);
      const salary = ml
        .filter((e) => e.kind === "income" && e.subCategory === "급여")
        .reduce((s, e) => s + e.amount, 0);
      const savings = ml
        .filter(
          (e) =>
            e.kind === "expense" &&
            (e.category === "재테크" || e.category === "저축성지출"),
        )
        .reduce((s, e) => s + e.amount, 0);
      const livingExpense = ml
        .filter(
          (e) =>
            e.kind === "expense" &&
            e.category !== "신용결제" &&
            e.category !== "재테크",
        )
        .reduce((s, e) => s + e.amount, 0);

      const actualSavingsRate =
        totalIncome > 0 ? Math.round((savings / totalIncome) * 100) : 0;
      const salaryOnlySavingsRate =
        salary > 0
          ? Math.max(
              0,
              Math.round(((salary - livingExpense) / salary) * 100),
            )
          : 0;
      const salaryDependency =
        totalIncome > 0 ? Math.round((salary / totalIncome) * 100) : 0;

      return {
        month: m,
        actualSavingsRate,
        salaryOnlySavingsRate,
        salaryDependency,
      };
    });
  }, [ledger, month]);

  const currentMonth = data[data.length - 1];
  const gap = currentMonth
    ? currentMonth.actualSavingsRate - currentMonth.salaryOnlySavingsRate
    : 0;

  return (
    <div className="card">
      <div className="card-title">저축률 + 급여 의존도</div>
      {currentMonth && (
        <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600, color: "var(--primary)" }}>
          급여만으로는 저축률 {currentMonth.salaryOnlySavingsRate}%
        </p>
      )}
      {gap > 20 && (
        <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--danger)" }}>
          급여 외 수입 의존도 높음 (차이 {gap}%p)
        </p>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
        {data.map((d) => (
          <div
            key={d.month}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
            }}
          >
            <div style={{ width: "100%", display: "flex", gap: 2, justifyContent: "center" }}>
              {/* Actual savings rate - solid */}
              <div
                style={{
                  width: "40%",
                  background: "var(--surface)",
                  borderRadius: 3,
                  overflow: "hidden",
                  height: 60,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                }}
              >
                <div
                  style={{
                    height: `${Math.min(d.actualSavingsRate, 100)}%`,
                    background: "var(--primary)",
                    borderRadius: 3,
                  }}
                />
              </div>
              {/* Salary-only savings rate - outline */}
              <div
                style={{
                  width: "40%",
                  background: "var(--surface)",
                  borderRadius: 3,
                  overflow: "hidden",
                  height: 60,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                }}
              >
                <div
                  style={{
                    height: `${Math.min(d.salaryOnlySavingsRate, 100)}%`,
                    border: "2px dashed var(--primary)",
                    borderRadius: 3,
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
              {d.month.slice(5)}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
        <span>
          <span style={{ display: "inline-block", width: 10, height: 10, background: "var(--primary)", borderRadius: 2, marginRight: 4, verticalAlign: "middle" }} />
          실제 저축률
        </span>
        <span>
          <span style={{ display: "inline-block", width: 10, height: 10, border: "2px dashed var(--primary)", borderRadius: 2, marginRight: 4, verticalAlign: "middle", boxSizing: "border-box" }} />
          급여만 저축률
        </span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// 7. InvestSimulatorWidget — 이걸 투자했다면
// ---------------------------------------------------------------------------

export const InvestSimulatorWidget: React.FC<InsightWidgetProps> = ({
  ledger,
  month,
  categoryPresets,
}) => {
  const expenseCategories = useMemo(() => {
    const cats = categoryPresets.expense ?? [];
    return cats.length > 0 ? cats : ["간식", "식비", "카페", "쇼핑", "구독비"];
  }, [categoryPresets]);

  const [selectedCategory, setSelectedCategory] = useState("간식");
  const [annualRate, setAnnualRate] = useState(8);

  const result = useMemo(() => {
    const months = lastNMonths(month, 12);
    const monthlyRate = annualRate / 100 / 12;

    let totalSpent = 0;
    let totalIfInvested = 0;

    months.forEach((m, idx) => {
      const spent = ledger
        .filter(
          (e) =>
            monthOf(e.date) === m &&
            e.kind === "expense" &&
            e.category === selectedCategory,
        )
        .reduce((s, e) => s + e.amount, 0);

      const remaining = months.length - idx;
      const compounded = spent * Math.pow(1 + monthlyRate, remaining);
      totalSpent += spent;
      totalIfInvested += compounded;
    });

    const difference = totalIfInvested - totalSpent;

    return { totalSpent, totalIfInvested, difference, months: months.length };
  }, [ledger, month, selectedCategory, annualRate]);

  const maxBar = Math.max(result.totalSpent, result.totalIfInvested, 1);

  return (
    <div className="card">
      <div className="card-title">이걸 투자했다면</div>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <label style={{ fontSize: 13 }}>
          카테고리{" "}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            style={{
              padding: "2px 6px",
              borderRadius: 4,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text)",
              fontSize: 13,
            }}
          >
            {expenseCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          연 수익률 {annualRate}%
          <input
            type="range"
            min={5}
            max={15}
            value={annualRate}
            onChange={(e) => setAnnualRate(Number(e.target.value))}
            style={{ width: 80 }}
          />
        </label>
      </div>

      {result.totalSpent === 0 ? (
        <p style={{ color: "var(--text-muted)" }}>
          최근 {result.months}개월간 해당 카테고리 지출 없음
        </p>
      ) : (
        <>
          <p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 10px", color: "var(--text)" }}>
            {result.months}개월간{" "}
            {formatKRW(result.totalSpent)} 지출 → 투자했다면{" "}
            <span style={{ color: "var(--success)" }}>
              {formatKRW(result.totalIfInvested)}
            </span>{" "}
            <span style={{ color: "var(--success)", fontSize: 12 }}>
              (+{formatKRW(result.difference)})
            </span>
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div>
              <div style={{ fontSize: 12, marginBottom: 2, color: "var(--text-muted)" }}>
                실제 지출
              </div>
              <div style={{ background: "var(--surface)", borderRadius: 3, overflow: "hidden" }}>
                <div
                  style={barStyle(
                    pct(result.totalSpent, maxBar),
                    "var(--danger)",
                  )}
                />
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, marginBottom: 2, color: "var(--text-muted)" }}>
                투자 시 가치
              </div>
              <div style={{ background: "var(--surface)", borderRadius: 3, overflow: "hidden" }}>
                <div
                  style={barStyle(
                    pct(result.totalIfInvested, maxBar),
                    "var(--success)",
                  )}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
