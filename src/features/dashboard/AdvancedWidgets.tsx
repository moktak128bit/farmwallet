/**
 * AdvancedWidgets — 대시보드용 고급 분석 위젯 6종.
 * 외부 차트 라이브러리 없이 순수 HTML/CSS 바·게이지만 사용.
 */
import React, { useMemo, useState } from "react";
import type {
  Account,
  LedgerEntry,
  StockTrade,
  StockPrice,
  BudgetGoal,
  CategoryPresets,
} from "../../types";
import { formatKRW, formatNumber } from "../../utils/formatter";
import { isUSDStock } from "../../utils/finance";

// ─── 공유 Props ─────────────────────────────────────────────────────────────

export interface AdvancedWidgetProps {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  prices: StockPrice[];
  fxRate: number;
  categoryPresets: CategoryPresets;
  budgetGoals?: BudgetGoal[];
}

// ─── 헬퍼 ───────────────────────────────────────────────────────────────────

const monthOf = (d: string) => (d || "").slice(0, 7);

const getNow = () => {
  const now = new Date();
  const currentMonth =
    now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const currentYear = String(now.getFullYear());
  return { now, currentMonth, currentYear };
};

const barStyle = (
  pct: number,
  color: string,
  height = 18,
): React.CSSProperties => ({
  width: `${Math.min(100, Math.max(0, pct))}%`,
  height,
  background: color,
  borderRadius: 4,
  transition: "width 0.3s",
});

const trackStyle = (height = 18): React.CSSProperties => ({
  width: "100%",
  height,
  background: "var(--border)",
  borderRadius: 4,
  overflow: "hidden",
});

// ─── Widget 1: RealReturnWidget — "연간 진짜 수익률" ────────────────────────

export const RealReturnWidget: React.FC<AdvancedWidgetProps> = ({
  ledger,
  trades,
}) => {
  const { currentYear, now } = useMemo(() => getNow(), []);
  const [hourlyWage, setHourlyWage] = useState(0);

  const data = useMemo(() => {
    const yearTrades = trades.filter((t) => t.date.startsWith(currentYear));
    const yearLedger = ledger.filter((e) => e.date.startsWith(currentYear));

    // 실현 수익 / 손실: 가계부에서 재테크 > 투자수익 / 투자손실
    const gains = yearLedger
      .filter(
        (e) =>
          e.kind === "income" &&
          e.category === "재테크" &&
          (e.subCategory || "").includes("투자수익"),
      )
      .reduce((s, e) => s + e.amount, 0);

    const losses = yearLedger
      .filter(
        (e) =>
          e.kind === "expense" &&
          e.category === "재테크" &&
          (e.subCategory || "").includes("투자손실"),
      )
      .reduce((s, e) => s + e.amount, 0);

    // 비용: 매매 수수료
    const tradeFees = yearTrades.reduce((s, t) => s + t.fee, 0);

    // 비용: 투자 관련 구독/서비스 지출
    const investKeywords = [
      "증권",
      "리포트",
      "투자",
      "알파",
      "유료",
      "프리미엄",
      "구독",
    ];
    const subscriptionCosts = yearLedger
      .filter((e) => {
        if (e.kind !== "expense" || e.category !== "구독비") return false;
        const text = (e.description || "") + (e.subCategory || "");
        return investKeywords.some((kw) => text.includes(kw));
      })
      .reduce((s, e) => s + e.amount, 0);

    const totalCosts = tradeFees + subscriptionCosts;
    const netReturn = gains - losses - totalCosts;

    // 총 투자금 (올해 매수 총액) — 수익률 계산 분모
    const totalInvested = yearTrades
      .filter((t) => t.side === "buy")
      .reduce((s, t) => s + t.totalAmount, 0);

    const returnRate = totalInvested > 0 ? (netReturn / totalInvested) * 100 : 0;

    // 적금 비교: 연 3.5% / 12 * 경과 개월 수
    const monthsElapsed = now.getMonth() + 1;
    const savingsReturn =
      totalInvested > 0
        ? totalInvested * (0.035 / 12) * monthsElapsed
        : 0;
    const savingsRate =
      totalInvested > 0 ? (savingsReturn / totalInvested) * 100 : 0;

    // 시간 비용 (hourlyWage > 0 일 때)
    // 대략 매매일 30분, 거래 발생 일수 기준
    const tradingDays = new Set(yearTrades.map((t) => t.date)).size;
    const timeCostHours = tradingDays * 0.5;
    const timeCost = hourlyWage > 0 ? timeCostHours * hourlyWage : 0;

    return {
      gains,
      losses,
      tradeFees,
      subscriptionCosts,
      totalCosts,
      netReturn,
      returnRate,
      savingsReturn,
      savingsRate,
      totalInvested,
      timeCost,
      timeCostHours,
      tradingDays,
    };
  }, [ledger, trades, currentYear, now, hourlyWage]);

  const maxRate = Math.max(
    Math.abs(data.returnRate),
    Math.abs(data.savingsRate),
    1,
  );

  return (
    <div className="card">
      <div className="card-title">연간 진짜 수익률</div>

      {/* 큰 수익률 표시 */}
      <div
        style={{
          textAlign: "center",
          margin: "16px 0",
          fontSize: 32,
          fontWeight: 800,
          color:
            data.netReturn >= 0 ? "var(--success)" : "var(--danger)",
        }}
      >
        {data.returnRate >= 0 ? "+" : ""}
        {data.returnRate.toFixed(2)}%
        <div
          style={{ fontSize: 14, fontWeight: 400, color: "var(--text-muted)" }}
        >
          순수익 {formatKRW(data.netReturn)}
        </div>
      </div>

      {/* 비교 바 */}
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 6,
          }}
        >
          <span style={{ width: 80, fontSize: 13, color: "var(--text)" }}>
            내 수익률
          </span>
          <div style={trackStyle()}>
            <div
              style={barStyle(
                (Math.abs(data.returnRate) / maxRate) * 100,
                data.returnRate >= 0 ? "var(--success)" : "var(--danger)",
              )}
            />
          </div>
          <span style={{ fontSize: 13, minWidth: 52, textAlign: "right" }}>
            {data.returnRate.toFixed(1)}%
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 80, fontSize: 13, color: "var(--text)" }}>
            적금 3.5%
          </span>
          <div style={trackStyle()}>
            <div
              style={barStyle(
                (Math.abs(data.savingsRate) / maxRate) * 100,
                "var(--primary)",
              )}
            />
          </div>
          <span style={{ fontSize: 13, minWidth: 52, textAlign: "right" }}>
            {data.savingsRate.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* 비용 내역 */}
      <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
        <div>
          매매 수수료: {formatKRW(data.tradeFees)}
        </div>
        <div>
          투자 구독비: {formatKRW(data.subscriptionCosts)}
        </div>
        <div>
          총 비용: {formatKRW(data.totalCosts)}
        </div>
      </div>

      {/* 시간 비용 입력 */}
      <div
        style={{
          marginTop: 12,
          padding: "8px 0",
          borderTop: "1px solid var(--border)",
          fontSize: 13,
        }}
      >
        <label style={{ color: "var(--text-muted)" }}>
          시급 (원):&nbsp;
          <input
            type="number"
            value={hourlyWage || ""}
            onChange={(e) => setHourlyWage(Number(e.target.value) || 0)}
            style={{
              width: 90,
              padding: "2px 6px",
              border: "1px solid var(--border)",
              borderRadius: 4,
              background: "var(--surface)",
              color: "var(--text)",
            }}
            placeholder="0"
          />
        </label>
        {hourlyWage > 0 && (
          <div style={{ marginTop: 4 }}>
            매매 {data.tradingDays}일 × 30분 = {data.timeCostHours.toFixed(1)}
            시간 → 시간비용 {formatKRW(data.timeCost)}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Widget 2: GoalPlannerWidget — "목표 역산 플래너" ────────────────────────

export const GoalPlannerWidget: React.FC<AdvancedWidgetProps> = ({
  accounts,
  ledger,
  trades,
}) => {
  const [targetAmount, setTargetAmount] = useState(100_000_000);
  const { currentMonth } = useMemo(() => getNow(), []);

  const data = useMemo(() => {
    // 현재 자산
    const currentAssets = accounts.reduce(
      (s, a) => s + a.initialBalance,
      0,
    );

    // 최근 3개월 계산
    const months: string[] = [];
    {
      const [y, m] = currentMonth.split("-").map(Number);
      for (let i = 1; i <= 3; i++) {
        const d = new Date(y, m - i, 1);
        months.push(
          d.getFullYear() +
            "-" +
            String(d.getMonth() + 1).padStart(2, "0"),
        );
      }
    }

    // 월별 저축 (income - 생활비)
    const monthlySavingsList = months.map((mo) => {
      const moLedger = ledger.filter((e) => monthOf(e.date) === mo);
      const income = moLedger
        .filter((e) => e.kind === "income")
        .reduce((s, e) => s + e.amount, 0);
      const living = moLedger
        .filter(
          (e) =>
            e.kind === "expense" &&
            e.category !== "신용결제" &&
            e.category !== "재테크",
        )
        .reduce((s, e) => s + e.amount, 0);
      return income - living;
    });

    const avgMonthlySavings =
      monthlySavingsList.length > 0
        ? monthlySavingsList.reduce((a, b) => a + b, 0) /
          monthlySavingsList.length
        : 0;

    // 월 투자 수익 (sell cashImpact 누적 / 개월수)
    const allMonths = new Set(trades.map((t) => monthOf(t.date)));
    const tradeMonthCount = Math.max(allMonths.size, 1);
    const netSellCash = trades
      .filter((t) => t.side === "sell")
      .reduce((s, t) => s + t.cashImpact, 0);
    const monthlyInvestGain = netSellCash / tradeMonthCount;

    const monthlyGrowth = avgMonthlySavings + monthlyInvestGain;
    const gap = targetAmount - currentAssets;
    const monthsToGoal =
      monthlyGrowth > 0 ? Math.ceil(gap / monthlyGrowth) : Infinity;

    // 시나리오 1: 월 지출 20만원 절약
    const scenario1Months =
      monthlyGrowth + 200_000 > 0
        ? Math.ceil(gap / (monthlyGrowth + 200_000))
        : Infinity;

    // 시나리오 2: 월 50만원 추가 투자 (연 8% 수익 가정)
    const extraMonthlyReturn = 500_000 * (0.08 / 12);
    const scenario2Growth = monthlyGrowth + 500_000 + extraMonthlyReturn;
    const scenario2Months =
      scenario2Growth > 0 ? Math.ceil(gap / scenario2Growth) : Infinity;

    const progressPct =
      targetAmount > 0
        ? Math.min(100, (currentAssets / targetAmount) * 100)
        : 0;

    return {
      currentAssets,
      avgMonthlySavings,
      monthlyInvestGain,
      monthlyGrowth,
      monthsToGoal,
      scenario1Months,
      scenario2Months,
      progressPct,
    };
  }, [accounts, ledger, trades, currentMonth]);

  const fmtMonths = (m: number) =>
    Number.isFinite(m) && m > 0
      ? `${Math.floor(m / 12)}년 ${m % 12}개월`
      : "산정 불가";

  return (
    <div className="card">
      <div className="card-title">목표 역산 플래너</div>

      {/* 목표 금액 입력 */}
      <div style={{ marginBottom: 12, fontSize: 13 }}>
        <label style={{ color: "var(--text-muted)" }}>
          목표 금액:&nbsp;
          <input
            type="number"
            value={targetAmount}
            onChange={(e) => setTargetAmount(Number(e.target.value) || 0)}
            style={{
              width: 140,
              padding: "2px 6px",
              border: "1px solid var(--border)",
              borderRadius: 4,
              background: "var(--surface)",
              color: "var(--text)",
            }}
          />
          &nbsp;원
        </label>
      </div>

      {/* 진행 바 */}
      <div style={{ marginBottom: 8, fontSize: 13, color: "var(--text-muted)" }}>
        {formatKRW(data.currentAssets)} / {formatKRW(targetAmount)} (
        {data.progressPct.toFixed(1)}%)
      </div>
      <div style={trackStyle(14)}>
        <div style={barStyle(data.progressPct, "var(--primary)", 14)} />
      </div>

      {/* 현재 속도 */}
      <div
        style={{
          textAlign: "center",
          margin: "16px 0",
          fontSize: 22,
          fontWeight: 700,
          color: "var(--text)",
        }}
      >
        현재 속도 {fmtMonths(data.monthsToGoal)}
      </div>

      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
        월 저축 평균: {formatKRW(data.avgMonthlySavings)} / 월 투자수익 평균:{" "}
        {formatKRW(data.monthlyInvestGain)}
      </div>

      {/* 시나리오 카드 */}
      <div style={{ display: "flex", gap: 8 }}>
        <div
          style={{
            flex: 1,
            padding: 10,
            borderRadius: 8,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            월 지출 20만원 줄이면
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--primary)" }}>
            {fmtMonths(data.scenario1Months)}
          </div>
          {Number.isFinite(data.monthsToGoal) &&
            Number.isFinite(data.scenario1Months) && (
              <div style={{ color: "var(--success)", fontSize: 12 }}>
                {data.monthsToGoal - data.scenario1Months}개월 단축
              </div>
            )}
        </div>
        <div
          style={{
            flex: 1,
            padding: 10,
            borderRadius: 8,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            월 투자 50만원 추가
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--primary)" }}>
            {fmtMonths(data.scenario2Months)}
          </div>
          {Number.isFinite(data.monthsToGoal) &&
            Number.isFinite(data.scenario2Months) && (
              <div style={{ color: "var(--success)", fontSize: 12 }}>
                {data.monthsToGoal - data.scenario2Months}개월 단축
              </div>
            )}
        </div>
      </div>
    </div>
  );
};

// ─── Widget 3: InvestCapacityWidget — "투자 여력 스코어" ─────────────────────

export const InvestCapacityWidget: React.FC<AdvancedWidgetProps> = ({
  ledger,
}) => {
  const { currentMonth } = useMemo(() => getNow(), []);

  const data = useMemo(() => {
    // 최근 6개월
    const months: string[] = [];
    {
      const [y, m] = currentMonth.split("-").map(Number);
      for (let i = 0; i < 6; i++) {
        const d = new Date(y, m - 1 - i, 1);
        months.unshift(
          d.getFullYear() +
            "-" +
            String(d.getMonth() + 1).padStart(2, "0"),
        );
      }
    }

    const essentialCategories = [
      "식비",
      "유류교통비",
      "의료건강비",
      "통신비",
      "주거비",
    ];

    const monthlyData = months.map((mo) => {
      const moLedger = ledger.filter((e) => monthOf(e.date) === mo);

      const income = moLedger
        .filter((e) => e.kind === "income")
        .reduce((s, e) => s + e.amount, 0);

      const fixed = moLedger
        .filter((e) => e.kind === "expense" && e.isFixedExpense === true)
        .reduce((s, e) => s + e.amount, 0);

      const essential = moLedger
        .filter(
          (e) =>
            e.kind === "expense" &&
            !e.isFixedExpense &&
            essentialCategories.includes(e.category),
        )
        .reduce((s, e) => s + e.amount, 0);

      const available = Math.max(0, income - fixed - essential);

      const actualInvest = moLedger
        .filter(
          (e) =>
            e.kind === "expense" &&
            (e.category === "재테크" || e.category === "저축성지출"),
        )
        .reduce((s, e) => s + e.amount, 0);

      const utilization =
        available > 0 ? Math.min(100, (actualInvest / available) * 100) : 0;

      return { month: mo, income, fixed, essential, available, actualInvest, utilization };
    });

    const currentData = monthlyData[monthlyData.length - 1];

    return { monthlyData, currentData };
  }, [ledger, currentMonth]);

  const { currentData, monthlyData } = data;
  const util = currentData?.utilization ?? 0;
  const label =
    util >= 70 ? "적극적" : util >= 40 ? "보통" : "보수적";
  const labelColor =
    util >= 70
      ? "var(--success)"
      : util >= 40
        ? "var(--primary)"
        : "var(--text-muted)";

  // conic-gradient gauge
  const gaugeBackground = `conic-gradient(${
    util >= 70 ? "var(--success)" : util >= 40 ? "var(--primary)" : "var(--border)"
  } ${util * 3.6}deg, var(--border) ${util * 3.6}deg)`;

  return (
    <div className="card">
      <div className="card-title">투자 여력 스코어</div>

      {/* 원형 게이지 */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          margin: "16px 0",
        }}
      >
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: "50%",
            background: gaugeBackground,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: "50%",
              background: "var(--surface)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontSize: 24, fontWeight: 800, color: "var(--text)" }}>
              {util.toFixed(0)}%
            </span>
            <span style={{ fontSize: 12, color: labelColor, fontWeight: 600 }}>
              {label}
            </span>
          </div>
        </div>
      </div>

      <div
        style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", marginBottom: 12 }}
      >
        여력 {formatKRW(currentData?.available ?? 0)} 중{" "}
        {formatKRW(currentData?.actualInvest ?? 0)} 투자
      </div>

      {/* 6개월 바 차트 */}
      <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 80 }}>
        {monthlyData.map((md) => {
          const h = Math.max(4, (md.utilization / 100) * 70);
          const isCurrent = md.month === currentData?.month;
          return (
            <div
              key={md.month}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: h,
                  background: isCurrent ? "var(--primary)" : "var(--border)",
                  borderRadius: 3,
                }}
              />
              <span style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                {md.month.slice(5)}월
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ─── Widget 4: TradeVsSpendWidget — "매매 vs 소비 패턴" ─────────────────────

export const TradeVsSpendWidget: React.FC<AdvancedWidgetProps> = ({
  ledger,
  trades,
}) => {
  const { currentMonth } = useMemo(() => getNow(), []);

  const data = useMemo(() => {
    // 최근 3개월
    const months: string[] = [];
    {
      const [y, m] = currentMonth.split("-").map(Number);
      for (let i = 0; i < 3; i++) {
        const d = new Date(y, m - 1 - i, 1);
        months.push(
          d.getFullYear() +
            "-" +
            String(d.getMonth() + 1).padStart(2, "0"),
        );
      }
    }

    const recentTrades = trades.filter((t) =>
      months.includes(monthOf(t.date)),
    );
    const recentLedger = ledger.filter((e) =>
      months.includes(monthOf(e.date)),
    );

    const dayLabels = ["일", "월", "화", "수", "목", "금", "토"];

    // 요일별 매매 건수
    const tradesByDay = Array(7).fill(0) as number[];
    recentTrades.forEach((t) => {
      const dow = new Date(t.date).getDay();
      tradesByDay[dow]++;
    });

    // 요일별 큰 지출 건수 (>50000, 신용결제/재테크 제외)
    const bigSpendByDay = Array(7).fill(0) as number[];
    recentLedger
      .filter(
        (e) =>
          e.kind === "expense" &&
          e.amount > 50000 &&
          e.category !== "신용결제" &&
          e.category !== "재테크",
      )
      .forEach((e) => {
        const dow = new Date(e.date).getDay();
        bigSpendByDay[dow]++;
      });

    // 패턴 감지
    const patterns: string[] = [];
    const peakTradeDay = tradesByDay.indexOf(Math.max(...tradesByDay));
    const peakSpendDay = bigSpendByDay.indexOf(Math.max(...bigSpendByDay));

    if (
      Math.max(...tradesByDay) > 0 &&
      Math.max(...bigSpendByDay) > 0
    ) {
      if (
        peakTradeDay === peakSpendDay ||
        Math.abs(peakTradeDay - peakSpendDay) === 1
      ) {
        patterns.push("지출과 매매가 같은 요일에 집중");
      }
      if (peakTradeDay === 1 && Math.max(...tradesByDay) > 0) {
        patterns.push("월요일 집중 매매 (주말 분석 후?)");
      }
    }
    if (Math.max(...tradesByDay) > 0) {
      patterns.push(
        `매매 피크: ${dayLabels[peakTradeDay]}요일 (${tradesByDay[peakTradeDay]}건)`,
      );
    }
    if (Math.max(...bigSpendByDay) > 0) {
      patterns.push(
        `큰 지출 피크: ${dayLabels[peakSpendDay]}요일 (${bigSpendByDay[peakSpendDay]}건)`,
      );
    }

    const maxCount = Math.max(...tradesByDay, ...bigSpendByDay, 1);

    return { dayLabels, tradesByDay, bigSpendByDay, patterns, maxCount };
  }, [ledger, trades, currentMonth]);

  return (
    <div className="card">
      <div className="card-title">매매 vs 소비 패턴</div>

      {/* 듀얼 수평 바 */}
      <div style={{ marginTop: 8 }}>
        {data.dayLabels.map((label, i) => (
          <div
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 4,
              fontSize: 13,
            }}
          >
            <span
              style={{ width: 20, textAlign: "center", color: "var(--text)" }}
            >
              {label}
            </span>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={trackStyle(10)}>
                <div
                  style={barStyle(
                    (data.tradesByDay[i] / data.maxCount) * 100,
                    "var(--primary)",
                    10,
                  )}
                />
              </div>
              <div style={trackStyle(10)}>
                <div
                  style={barStyle(
                    (data.bigSpendByDay[i] / data.maxCount) * 100,
                    "var(--danger)",
                    10,
                  )}
                />
              </div>
            </div>
            <span
              style={{
                minWidth: 36,
                fontSize: 11,
                color: "var(--text-muted)",
                textAlign: "right",
              }}
            >
              {data.tradesByDay[i]}/{data.bigSpendByDay[i]}
            </span>
          </div>
        ))}
      </div>

      {/* 범례 */}
      <div
        style={{
          display: "flex",
          gap: 12,
          fontSize: 11,
          color: "var(--text-muted)",
          marginTop: 8,
        }}
      >
        <span>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              background: "var(--primary)",
              borderRadius: 2,
              marginRight: 4,
            }}
          />
          매매
        </span>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              background: "var(--danger)",
              borderRadius: 2,
              marginRight: 4,
            }}
          />
          큰 지출 (5만원+)
        </span>
      </div>

      {/* 패턴 배지 */}
      {data.patterns.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
          {data.patterns.map((p) => (
            <span
              key={p}
              style={{
                padding: "3px 8px",
                borderRadius: 12,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                fontSize: 11,
                color: "var(--text-muted)",
              }}
            >
              {p}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Widget 5: DividendCoverageWidget — "배당 vs 고정지출 커버리지" ──────────

export const DividendCoverageWidget: React.FC<AdvancedWidgetProps> = ({
  ledger,
}) => {
  const { currentMonth } = useMemo(() => getNow(), []);

  const data = useMemo(() => {
    // 최근 3개월
    const months: string[] = [];
    {
      const [y, m] = currentMonth.split("-").map(Number);
      for (let i = 1; i <= 3; i++) {
        const d = new Date(y, m - i, 1);
        months.push(
          d.getFullYear() +
            "-" +
            String(d.getMonth() + 1).padStart(2, "0"),
        );
      }
    }

    const recentLedger = ledger.filter((e) =>
      months.includes(monthOf(e.date)),
    );

    // 월 배당 수입 평균
    const dividendEntries = recentLedger.filter(
      (e) =>
        e.kind === "income" &&
        ((e.category || "").includes("배당") ||
          (e.subCategory || "").includes("배당")),
    );
    const monthlyDividend =
      dividendEntries.reduce((s, e) => s + e.amount, 0) /
      Math.max(months.length, 1);

    // 고정지출 항목별 월 평균
    const fixedEntries = recentLedger.filter(
      (e) => e.kind === "expense" && e.isFixedExpense === true,
    );

    const fixedMap = new Map<string, { total: number; monthSet: Set<string> }>();
    fixedEntries.forEach((e) => {
      const key = e.category + (e.subCategory ? ` > ${e.subCategory}` : "");
      const prev = fixedMap.get(key) || { total: 0, monthSet: new Set<string>() };
      prev.total += e.amount;
      prev.monthSet.add((e.date || "").slice(0, 7));
      fixedMap.set(key, prev);
    });

    const fixedItems = Array.from(fixedMap.entries())
      .map(([name, { total, monthSet }]) => ({
        name,
        avgAmount: total / Math.max(monthSet.size, 1),
      }))
      .sort((a, b) => a.avgAmount - b.avgAmount);

    // 커버리지 계산
    let remainingDividend = monthlyDividend;
    let coveredCount = 0;
    const itemsWithCoverage = fixedItems.map((item) => {
      const covered = Math.min(remainingDividend, item.avgAmount);
      remainingDividend = Math.max(0, remainingDividend - item.avgAmount);
      if (covered >= item.avgAmount) coveredCount++;
      return {
        ...item,
        covered,
        pct: item.avgAmount > 0 ? (covered / item.avgAmount) * 100 : 0,
      };
    });

    const totalFixed = fixedItems.reduce((s, i) => s + i.avgAmount, 0);
    const additionalNeeded = Math.max(0, totalFixed - monthlyDividend);

    return {
      monthlyDividend,
      coveredCount,
      totalItems: fixedItems.length,
      additionalNeeded,
      itemsWithCoverage,
    };
  }, [ledger, currentMonth]);

  return (
    <div className="card">
      <div className="card-title">배당 vs 고정지출 커버리지</div>

      <div
        style={{
          fontSize: 14,
          color: "var(--text)",
          margin: "12px 0",
          textAlign: "center",
        }}
      >
        월 배당 수입: <strong>{formatKRW(data.monthlyDividend)}</strong>
      </div>

      <div
        style={{
          fontSize: 13,
          color: "var(--text-muted)",
          textAlign: "center",
          marginBottom: 12,
        }}
      >
        배당으로 <strong style={{ color: "var(--success)" }}>{data.coveredCount}개</strong> 항목
        커버
        {data.additionalNeeded > 0 && (
          <span>
            , 추가 월 <strong style={{ color: "var(--danger)" }}>{formatKRW(data.additionalNeeded)}</strong>{" "}
            필요
          </span>
        )}
      </div>

      {/* 항목 리스트 + 커버리지 바 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {data.itemsWithCoverage.map((item) => {
          const color =
            item.pct >= 100
              ? "var(--success)"
              : item.pct > 0
                ? "#eab308"
                : "var(--border)";
          return (
            <div key={item.name}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12,
                  color: "var(--text-muted)",
                  marginBottom: 2,
                }}
              >
                <span>{item.name}</span>
                <span>
                  {formatNumber(item.covered)} / {formatKRW(item.avgAmount)}
                </span>
              </div>
              <div style={trackStyle(8)}>
                <div style={barStyle(item.pct, color, 8)} />
              </div>
            </div>
          );
        })}
        {data.itemsWithCoverage.length === 0 && (
          <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
            고정지출 데이터 없음
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Widget 6: ConcentrationWidget — "집중도 vs 다양성 (HHI)" ───────────────

export const ConcentrationWidget: React.FC<AdvancedWidgetProps> = ({
  ledger,
  trades,
  prices,
  fxRate,
}) => {
  const { currentMonth } = useMemo(() => getNow(), []);

  const data = useMemo(() => {
    // ── 포트폴리오 HHI ──
    // 현재 보유 수량: ticker별 buy - sell
    const holdingsMap = new Map<string, number>();
    trades.forEach((t) => {
      const prev = holdingsMap.get(t.ticker) || 0;
      holdingsMap.set(
        t.ticker,
        t.side === "buy" ? prev + t.quantity : prev - t.quantity,
      );
    });

    // 가격 맵
    const priceMap = new Map<string, number>();
    prices.forEach((p) => {
      priceMap.set(p.ticker, p.price);
    });

    let totalPortValue = 0;
    const positions: Array<{ ticker: string; value: number }> = [];
    holdingsMap.forEach((qty, ticker) => {
      if (qty <= 0) return;
      const px = priceMap.get(ticker) ?? 0;
      const value = qty * px * (isUSDStock(ticker) ? fxRate : 1);
      if (value > 0) {
        positions.push({ ticker, value });
        totalPortValue += value;
      }
    });

    let portfolioHHI = 0;
    if (totalPortValue > 0) {
      portfolioHHI = positions.reduce((sum, p) => {
        const share = p.value / totalPortValue;
        return sum + share * share;
      }, 0) * 10000;
    }

    // ── 소비 HHI ──
    const currentMonthExpenses = ledger.filter(
      (e) =>
        monthOf(e.date) === currentMonth &&
        e.kind === "expense" &&
        e.category !== "신용결제" &&
        e.category !== "재테크",
    );

    const catMap = new Map<string, number>();
    currentMonthExpenses.forEach((e) => {
      catMap.set(e.category, (catMap.get(e.category) || 0) + e.amount);
    });

    const totalSpend = currentMonthExpenses.reduce(
      (s, e) => s + e.amount,
      0,
    );

    let spendHHI = 0;
    if (totalSpend > 0) {
      catMap.forEach((amt) => {
        const share = amt / totalSpend;
        spendHHI += share * share;
      });
      spendHHI *= 10000;
    }

    const hhiLabel = (hhi: number) =>
      hhi < 1500 ? "분산" : hhi < 2500 ? "보통" : "집중";
    const hhiColor = (hhi: number) =>
      hhi < 1500
        ? "var(--success)"
        : hhi < 2500
          ? "var(--primary)"
          : "var(--danger)";

    // 비교 인사이트
    const portLabel = hhiLabel(portfolioHHI);
    const spendLabel = hhiLabel(spendHHI);
    let insight = "";
    if (portLabel === "분산" && spendLabel === "분산") {
      insight = "투자·소비 모두 잘 분산되어 있습니다";
    } else if (portLabel === "집중" && spendLabel === "분산") {
      insight = "투자는 집중, 소비는 분산";
    } else if (portLabel === "분산" && spendLabel === "집중") {
      insight = "소비는 집중, 투자는 분산";
    } else if (portLabel === "집중" && spendLabel === "집중") {
      insight = "투자·소비 모두 집중도가 높습니다";
    } else {
      insight = `투자: ${portLabel}, 소비: ${spendLabel}`;
    }

    return {
      portfolioHHI,
      spendHHI,
      portLabel,
      spendLabel,
      portColor: hhiColor(portfolioHHI),
      spendColor: hhiColor(spendHHI),
      insight,
    };
  }, [ledger, trades, prices, fxRate, currentMonth]);

  const maxHHI = 10000;

  return (
    <div className="card">
      <div className="card-title">집중도 vs 다양성 (HHI)</div>

      {/* 두 게이지 나란히 */}
      <div
        style={{
          display: "flex",
          gap: 16,
          marginTop: 16,
          marginBottom: 16,
        }}
      >
        {/* 포트폴리오 HHI */}
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text)",
              marginBottom: 6,
            }}
          >
            투자 포트폴리오
          </div>
          <div style={trackStyle(16)}>
            <div
              style={barStyle(
                (data.portfolioHHI / maxHHI) * 100,
                data.portColor,
                16,
              )}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              marginTop: 4,
            }}
          >
            <span style={{ color: data.portColor, fontWeight: 600 }}>
              {data.portLabel}
            </span>
            <span style={{ color: "var(--text-muted)" }}>
              HHI {formatNumber(Math.round(data.portfolioHHI))}
            </span>
          </div>
        </div>

        {/* 소비 HHI */}
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text)",
              marginBottom: 6,
            }}
          >
            소비 지출
          </div>
          <div style={trackStyle(16)}>
            <div
              style={barStyle(
                (data.spendHHI / maxHHI) * 100,
                data.spendColor,
                16,
              )}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              marginTop: 4,
            }}
          >
            <span style={{ color: data.spendColor, fontWeight: 600 }}>
              {data.spendLabel}
            </span>
            <span style={{ color: "var(--text-muted)" }}>
              HHI {formatNumber(Math.round(data.spendHHI))}
            </span>
          </div>
        </div>
      </div>

      {/* HHI 스케일 범례 */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 12,
          fontSize: 11,
          color: "var(--text-muted)",
          marginBottom: 8,
        }}
      >
        <span>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--success)",
              marginRight: 3,
            }}
          />
          분산 (&lt;1500)
        </span>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--primary)",
              marginRight: 3,
            }}
          />
          보통 (1500-2500)
        </span>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--danger)",
              marginRight: 3,
            }}
          />
          집중 (&gt;2500)
        </span>
      </div>

      {/* 인사이트 텍스트 */}
      <div
        style={{
          textAlign: "center",
          fontSize: 14,
          fontWeight: 600,
          color: "var(--text)",
          padding: "8px 0",
          borderTop: "1px solid var(--border)",
        }}
      >
        {data.insight}
      </div>
    </div>
  );
};
