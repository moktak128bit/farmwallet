import React from "react";
import type { LedgerEntry, DailyBudgetConfig } from "../../types";
import {
  todaySpend,
  weeklySpend,
  weeklyLimit,
  computeStreak,
  monthlyBudgetStats,
  getCurrentWeekRange,
} from "../../utils/dailyBudget";
import { getTodayKST } from "../../utils/date";
import { formatKRW } from "../../utils/formatter";

interface Props {
  ledger: LedgerEntry[];
  config: DailyBudgetConfig;
}

/**
 * 가계부 상단 진행 바 + streak + 월간 달성률 카드.
 * config.enabled === false면 null 반환.
 */
export const DailyBudgetBar: React.FC<Props> = ({ ledger, config }) => {
  if (!config.enabled) return null;

  const today = getTodayKST();
  const monthKey = today.slice(0, 7);

  const isWeekly = config.mode === "weekly";
  const limit = isWeekly ? weeklyLimit(config) : config.dailyLimit;
  const range = isWeekly ? getCurrentWeekRange(today) : null;
  const spent = isWeekly && range
    ? weeklySpend(ledger, range.start, range.end, config)
    : todaySpend(ledger, config);

  const ratio = limit > 0 ? spent / limit : 0;
  const remaining = limit - spent;
  const pct = Math.min(100, Math.round(ratio * 100));
  // 색상: 0~70% 초록 / 70~100% 노랑 / 100%+ 빨강
  const barColor = ratio >= 1 ? "#dc2626" : ratio >= 0.7 ? "#f59e0b" : "#10b981";
  const bgColor = ratio >= 1 ? "rgba(220,38,38,0.12)" : ratio >= 0.7 ? "rgba(245,158,11,0.12)" : "rgba(16,185,129,0.12)";

  const streak = computeStreak(ledger, config, today);
  const stats = monthlyBudgetStats(ledger, monthKey, config, today);

  const periodLabel = isWeekly ? `이번 주 (${range?.start.slice(5)} ~ ${range?.end.slice(5)})` : "오늘";

  return (
    <div
      className="card"
      style={{
        padding: 14,
        marginBottom: 12,
        background: bgColor,
        border: `2px solid ${barColor}40`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: barColor }}>💰 {periodLabel}</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>
            {formatKRW(Math.round(spent))}
          </span>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
            / {formatKRW(limit)} ({pct}%)
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {streak > 0 && (
            <span
              title={`${streak}일 연속 한도 이하 (한도: ${formatKRW(config.dailyLimit)}/일)`}
              style={{
                padding: "3px 8px", fontSize: 12, fontWeight: 700, borderRadius: 6,
                background: "linear-gradient(135deg, #f97316, #ea580c)", color: "#fff",
              }}
            >
              🔥 {streak}일 연속
            </span>
          )}
          <span
            title={`${monthKey}: ${stats.successDays}/${stats.totalDays}일 성공, 평균 일 ${formatKRW(Math.round(stats.avgSpend))}`}
            style={{
              padding: "3px 8px", fontSize: 12, fontWeight: 600, borderRadius: 6,
              background: "var(--surface)", color: "var(--text-muted)",
              border: "1px solid var(--border)",
            }}
          >
            이달 {stats.successDays}/{stats.totalDays}일 ({Math.round(stats.successRate * 100)}%)
          </span>
        </div>
      </div>
      <div
        style={{
          width: "100%",
          height: 10,
          background: "var(--surface)",
          borderRadius: 999,
          overflow: "hidden",
          border: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: barColor,
            transition: "width 0.3s, background 0.3s",
          }}
        />
      </div>
      <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>
        {remaining >= 0
          ? `남은 한도 ${formatKRW(remaining)}`
          : `한도 ${formatKRW(-remaining)} 초과 ⚠`}
      </div>
    </div>
  );
};
