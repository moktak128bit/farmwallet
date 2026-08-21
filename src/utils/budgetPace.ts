/**
 * 예산 페이스 — "지금 속도면 월말에 얼마가 되나 / 남은 날 하루 얼마까지 써도 되나 / 전월 같은 기간엔 얼마였나".
 *
 * 사용액은 computeBudgetGoalSpent 단일 소스(예산 탭·대시보드 위젯과 같은 숫자)를 그대로 쓰고,
 * 여기서는 그 위에 페이스 해석만 얹는다. 한도(monthlyLimit)의 의미는 바꾸지 않는다.
 *
 * 월말 예상(projectedMonthEnd) 규칙:
 *   linear   = spent / 경과일 × 총일수                      — 단순 선형 외삽
 *   history  = spent + 최근 3개월 (전체 − 1~경과일) 평균     — "경과일 이후에 보통 더 나가는 금액"을 더한 값
 *   projected = w·linear + (1−w)·history,  w = 경과일/총일수
 *   · 월초엔 history 비중이 커서 1일에 나간 월세·보험료(고정비성 1회 결제)를 선형이 30배로 불리는 과대추정을 누르고,
 *     월말로 갈수록 w→1이라 둘 다 spent로 수렴한다.
 *   · 최근 3개월 중 해당 예산의 지출이 하나도 없는 달은 평균에서 제외, 이력이 전혀 없으면 linear만 사용.
 *   · 경과일 0(아직 시작 안 한 달)이면 w=0 → history(=최근 3개월 평균 전체 지출)만.
 *
 * 남은 하루 허용액 = (한도 − 사용액) / 남은 일수. 남은 일수는 오늘을 뺀 값(화면 "N일 남음"과 동일)이며,
 * 오늘이 마지막 날이면 분모 1(오늘 한 번).
 *
 * 전월 동기(prevSamePeriodSpent) = 전월 1~경과일(dayCap). 달이 끝났으면 전월 전체.
 */
import type { BudgetGoal, CategoryPresets, LedgerEntry } from "../types";
import { computeBudgetGoalSpent } from "./budgetUsage";
import { getLastDayOfMonth, shiftMonth } from "./date";
import { formatNumber } from "./formatter";

export type BudgetPaceStatus = "ok" | "watch" | "over-pace" | "exceeded";

export interface BudgetPace {
  spent: number;
  limit: number;
  /** 1~총일수. 달이 아직 안 왔으면 0, 지났으면 총일수 */
  elapsedDays: number;
  totalDays: number;
  /** 오늘을 제외한 남은 일수 (총일수 − 경과일) */
  remainingDays: number;
  projectedMonthEnd: number;
  /** 월말 예상이 한도 대비 몇 % 위/아래인가 (+12 = 한도보다 12% 많음). 한도 0이면 null */
  projectedVsLimitPct: number | null;
  /** (한도 − 사용액) / max(남은 일수, 1). 음수면 이미 초과 */
  dailyAllowanceRemaining: number;
  /** 전월 같은 기간(1~경과일) 사용액 */
  prevSamePeriodSpent: number;
  /** "동기(1~N일)" — 완료된 달이면 "전월 전체" */
  prevSamePeriodLabel: string;
  status: BudgetPaceStatus;
  /** 한 줄 요약 — 카드·위젯이 그대로 표시 */
  message: string;
}

interface BudgetPaceOptions {
  categoryPresets?: CategoryPresets;
  fxRate?: number | null;
}

/** 월말 예상에 섞는 이력 개월 수 */
const HISTORY_MONTHS = 3;
/** 월말 예상이 한도의 이 비율을 넘으면 'watch' */
const WATCH_RATIO = 0.9;

const won = (n: number) => `${formatNumber(n)}원`;
const signedPct = (pct: number) => `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(0)}%`;

/** 경과일: 보고 있는 달과 오늘(KST ISO)의 관계로 결정 */
function elapsedDaysOf(month: string, todayIso: string, totalDays: number): number {
  const todayMonth = todayIso.slice(0, 7);
  if (todayMonth === month) return Math.min(totalDays, Math.max(1, Number(todayIso.slice(8, 10)) || 1));
  return todayMonth < month ? 0 : totalDays;
}

export function computeBudgetPace(
  goal: BudgetGoal,
  ledger: LedgerEntry[],
  month: string,
  todayIso: string,
  opts: BudgetPaceOptions = {}
): BudgetPace {
  const { categoryPresets, fxRate = null } = opts;
  const usage = { categoryPresets, fxRate };
  const [y, m] = month.split("-").map(Number);
  const totalDays = getLastDayOfMonth(y, m);
  const elapsedDays = elapsedDaysOf(month, todayIso, totalDays);
  const remainingDays = totalDays - elapsedDays;
  /** 보고 있는 달이 이미 지났는가 (오늘이 다음 달 이후) */
  const monthDone = todayIso.slice(0, 7) > month;
  const limit = goal.monthlyLimit > 0 ? goal.monthlyLimit : 0;
  const spent = computeBudgetGoalSpent(goal, ledger, month, usage);

  // ── 월말 예상 ──
  const linear = elapsedDays > 0 ? (spent / elapsedDays) * totalDays : spent;
  let histRemainderSum = 0;
  let histCount = 0;
  for (let i = 1; i <= HISTORY_MONTHS; i++) {
    const hm = shiftMonth(month, -i);
    const full = computeBudgetGoalSpent(goal, ledger, hm, usage);
    if (full <= 0) continue; // 해당 예산 지출이 없던 달은 이력으로 치지 않는다
    const same = elapsedDays > 0 ? computeBudgetGoalSpent(goal, ledger, hm, { ...usage, dayCap: elapsedDays }) : 0;
    histRemainderSum += Math.max(0, full - same);
    histCount++;
  }
  let projectedMonthEnd: number;
  if (histCount === 0) {
    projectedMonthEnd = linear;
  } else {
    const history = spent + histRemainderSum / histCount;
    const w = totalDays > 0 ? elapsedDays / totalDays : 1;
    projectedMonthEnd = w * linear + (1 - w) * history;
  }
  if (monthDone) projectedMonthEnd = spent; // 끝난 달은 예상 = 실적
  const projectedVsLimitPct = limit > 0 ? ((projectedMonthEnd - limit) / limit) * 100 : null;

  // ── 남은 하루 허용액 ──
  const dailyAllowanceRemaining = (limit - spent) / Math.max(1, remainingDays);

  // ── 전월 동기 ──
  const prevMonth = shiftMonth(month, -1);
  const prevSamePeriodSpent =
    elapsedDays === 0
      ? 0
      : computeBudgetGoalSpent(goal, ledger, prevMonth, monthDone ? usage : { ...usage, dayCap: elapsedDays });
  const prevSamePeriodLabel = monthDone ? "전월 전체" : `동기(1~${elapsedDays}일)`;

  // ── 상태 ──
  let status: BudgetPaceStatus = "ok";
  if (limit > 0) {
    if (spent >= limit) status = "exceeded";
    else if (projectedMonthEnd > limit) status = "over-pace";
    else if (projectedMonthEnd >= limit * WATCH_RATIO) status = "watch";
  }

  // ── 메시지 ──
  let message: string;
  const vsLimit = projectedVsLimitPct == null ? "" : ` (한도 ${signedPct(projectedVsLimitPct)})`;
  if (limit <= 0) {
    message = "한도 미설정";
  } else if (monthDone) {
    message = `마감 · 사용 ${won(spent)} (한도 대비 ${((spent / limit) * 100).toFixed(0)}%)`;
  } else if (status === "exceeded") {
    message = `한도 ${won(spent - limit)} 초과 · 이 페이스면 월말 ${won(projectedMonthEnd)}${vsLimit}`;
  } else if (remainingDays === 0) {
    message = `이 페이스면 월말 ${won(projectedMonthEnd)}${vsLimit} · 오늘 ${won(dailyAllowanceRemaining)} 남음`;
  } else {
    message = `이 페이스면 월말 ${won(projectedMonthEnd)}${vsLimit} · 남은 ${remainingDays}일 하루 ${won(dailyAllowanceRemaining)}`;
  }

  return {
    spent,
    limit,
    elapsedDays,
    totalDays,
    remainingDays,
    projectedMonthEnd,
    projectedVsLimitPct,
    dailyAllowanceRemaining,
    prevSamePeriodSpent,
    prevSamePeriodLabel,
    status,
    message,
  };
}
