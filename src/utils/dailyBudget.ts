/**
 * 하루(또는 주간) 예산 한도 계산.
 *
 * 사용처: 가계부 상단 DailyBudgetBar, 입력 폼 사전 경고, streak·월간 달성률 카드.
 *
 * 정책:
 *  - kind=expense 항목만 합산
 *  - DailyBudgetConfig.excludedCategories / excludedSubCategories 에 해당하면 제외
 *  - amount는 할인 후 순액(amount 그대로 사용)
 */

import type { LedgerEntry, DailyBudgetConfig } from "../types";
import { getTodayKST, parseIsoLocal, formatIsoLocal } from "./date";

export const DEFAULT_DAILY_BUDGET: DailyBudgetConfig = {
  enabled: false,
  dailyLimit: 30_000,
  mode: "daily",
  excludedCategories: ["신용결제", "재테크", "저축성지출", "이체", "수입"],
  excludedSubCategories: ["통신비", "구독비", "주거비"],
  warnOnExceed: true,
};

/** entry가 한도 계산 대상인지 (kind=expense + 미제외 카테고리) */
function isCountableExpense(entry: LedgerEntry, config: DailyBudgetConfig): boolean {
  if (entry.kind !== "expense") return false;
  if (config.excludedCategories.includes(entry.category)) return false;
  if (entry.subCategory && config.excludedSubCategories.includes(entry.subCategory)) return false;
  return true;
}

/** 특정 일자(YYYY-MM-DD) 사용액 합 */
export function dailySpend(ledger: LedgerEntry[], dateIso: string, config: DailyBudgetConfig): number {
  let sum = 0;
  for (const e of ledger) {
    if (!e.date || !e.date.startsWith(dateIso)) continue;
    if (!isCountableExpense(e, config)) continue;
    sum += e.amount;
  }
  return sum;
}

/** 주간(시작~끝 ISO) 사용액 합 */
export function weeklySpend(
  ledger: LedgerEntry[],
  weekStartIso: string,
  weekEndIso: string,
  config: DailyBudgetConfig
): number {
  let sum = 0;
  for (const e of ledger) {
    if (!e.date) continue;
    if (e.date < weekStartIso || e.date > weekEndIso) continue;
    if (!isCountableExpense(e, config)) continue;
    sum += e.amount;
  }
  return sum;
}

/** 오늘 사용액 (간편 헬퍼) */
export function todaySpend(ledger: LedgerEntry[], config: DailyBudgetConfig): number {
  return dailySpend(ledger, getTodayKST(), config);
}

/** 사용된 일자별 합계 Map (yyyy-mm-dd → amount) */
function buildDailyTotalMap(ledger: LedgerEntry[], config: DailyBudgetConfig): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of ledger) {
    if (!e.date) continue;
    if (!isCountableExpense(e, config)) continue;
    const day = e.date.slice(0, 10);
    map.set(day, (map.get(day) ?? 0) + e.amount);
  }
  return map;
}

/**
 * 오늘부터 거꾸로 세어, 매 날짜 한도 이하인 연속 일수.
 * - 거래 없는 날도 "지킨 날"로 간주
 * - 한도 초과한 날을 만나면 거기서 stop
 * - 오늘이 이미 초과면 0
 */
export function computeStreak(
  ledger: LedgerEntry[],
  config: DailyBudgetConfig,
  todayIso: string = getTodayKST()
): number {
  const totals = buildDailyTotalMap(ledger, config);
  const limit = config.dailyLimit;
  let streak = 0;
  const cursor = parseIsoLocal(todayIso);
  if (!cursor) return 0;
  // 안전: 최대 365일까지만
  for (let i = 0; i < 365; i++) {
    const dateStr = formatIsoLocal(cursor);
    const spent = totals.get(dateStr) ?? 0;
    if (spent > limit) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

interface MonthlyBudgetStats {
  /** YYYY-MM */
  monthKey: string;
  /** 해당 월의 총 일수 (오늘이 속한 월이면 오늘까지) */
  totalDays: number;
  /** 한도 이하로 지킨 날 수 */
  successDays: number;
  /** 0~1 */
  successRate: number;
  /** 한도 초과한 날 수 (참고) */
  overDays: number;
  /** 평균 일 사용액 (KRW) */
  avgSpend: number;
}

/**
 * 월간 달성률 통계.
 * 미래 월/현재 월 모두 처리. 현재 월은 오늘까지만 카운트.
 */
export function monthlyBudgetStats(
  ledger: LedgerEntry[],
  monthKey: string,
  config: DailyBudgetConfig,
  todayIso: string = getTodayKST()
): MonthlyBudgetStats {
  const totals = buildDailyTotalMap(ledger, config);
  const limit = config.dailyLimit;
  const [year, month] = monthKey.split("-").map(Number);
  const lastDayOfMonth = new Date(year, month, 0).getDate();
  const isCurrentMonth = todayIso.startsWith(monthKey);
  const todayDay = isCurrentMonth ? Number(todayIso.slice(8, 10)) : lastDayOfMonth;
  const totalDays = Math.min(todayDay, lastDayOfMonth);

  let successDays = 0;
  let overDays = 0;
  let totalSpent = 0;
  for (let d = 1; d <= totalDays; d++) {
    const dateStr = `${monthKey}-${String(d).padStart(2, "0")}`;
    const spent = totals.get(dateStr) ?? 0;
    totalSpent += spent;
    if (spent > limit) overDays++;
    else successDays++;
  }
  return {
    monthKey,
    totalDays,
    successDays,
    overDays,
    successRate: totalDays > 0 ? successDays / totalDays : 0,
    avgSpend: totalDays > 0 ? totalSpent / totalDays : 0,
  };
}

/** 주간 평균 모드의 한도 (=dailyLimit × 7) */
export function weeklyLimit(config: DailyBudgetConfig): number {
  return config.dailyLimit * 7;
}

/** 이번 주(일~토) 시작·끝 ISO */
export function getCurrentWeekRange(todayIso: string = getTodayKST()): { start: string; end: string } {
  const d = parseIsoLocal(todayIso);
  if (!d) return { start: todayIso, end: todayIso };
  const dow = d.getDay(); // 0=일 ~ 6=토
  const start = new Date(d);
  start.setDate(d.getDate() - dow);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: formatIsoLocal(start), end: formatIsoLocal(end) };
}
