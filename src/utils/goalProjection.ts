/**
 * 목표 도달 예상(ETA) — 순수 모듈 (React 의존 없음).
 * 월별 순자산 시계열(accountTimeline total 등)의 최근 N개월 평균 증가분으로
 * "이 페이스면 언제 목표에 닿는가"와 "기한까지 맞추려면 월 얼마가 필요한가"를 계산한다.
 * 읽기 전용 — 저장 경로 없음. 인사이트 자산 탭·대시보드 투자 요약 GoalRow가 같은 문장을 쓰도록 단일 소스.
 */
import { shiftMonth } from "./date";

type GoalProjectionMethod = "trailing6" | "trailing12";

interface GoalProjectionInput {
  /** 월별 시계열 ("YYYY-MM" 오름차순, KRW). 마지막 원소 = 현재값 */
  series: { month: string; value: number }[];
  /** 목표 금액 (KRW, > 0) */
  target: number;
  /** 페이스 산정 창 (기본 trailing6) */
  method?: GoalProjectionMethod;
  /** 기한 ("YYYY-MM" 또는 "YYYY-MM-DD") — 있으면 requiredMonthlyForDate 계산 */
  targetDate?: string | null;
}

type GoalProjectionStatus =
  /** 목표 금액이 유효하지 않거나 시계열이 비어 있음 */
  | "invalid"
  /** 이미 목표 달성 */
  | "achieved"
  /** 시계열 3개월 미만 — 페이스 산정 불가 */
  | "insufficient"
  /** 페이스가 음수(감소 추세) — 도달 불가 */
  | "declining"
  /** 페이스 0(정체) — 분모 0, 도달 불가 */
  | "stalled"
  /** 양의 페이스로 ETA 산출됨 */
  | "projected";

interface GoalProjection {
  status: GoalProjectionStatus;
  /** 현재값 (시계열 마지막, 없으면 0) */
  current: number;
  /** 남은 금액 = max(0, target − current) */
  remaining: number;
  /** 실제 사용한 창 길이(개월 수, 델타 개수). 데이터 부족이면 0 */
  windowMonths: number;
  /** 창 평균 월 증가분 (KRW/월). 부족·무효면 null */
  monthlyDelta: number | null;
  /** 목표까지 남은 개월 수 (올림). 달성이면 0, 도달 불가·부족이면 null */
  monthsToTarget: number | null;
  /** 도달 예상 월 "YYYY-MM". 달성이면 현재 월, 도달 불가·부족이면 null */
  etaMonth: string | null;
  /** targetDate까지 맞추려면 필요한 월 증가분 (KRW/월). 기한 없음·이미 지남·달성이면 null */
  requiredMonthlyForDate: number | null;
  /** 기한까지 남은 개월 수 (현재 월 기준). 기한 없음/무효면 null */
  monthsToDeadline: number | null;
}

const WINDOW: Record<GoalProjectionMethod, number> = { trailing6: 6, trailing12: 12 };
const MIN_POINTS = 3;

function monthIndex(month: string): number | null {
  const m = /^(\d{4})-(\d{2})/.exec(month);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!Number.isFinite(y) || mo < 1 || mo > 12) return null;
  return y * 12 + (mo - 1);
}

/** 두 "YYYY-MM" 사이 개월 차 (to − from). 무효면 null */
function monthsBetween(fromMonth: string, toMonth: string): number | null {
  const a = monthIndex(fromMonth);
  const b = monthIndex(toMonth);
  if (a == null || b == null) return null;
  return b - a;
}

export function projectGoal(input: GoalProjectionInput): GoalProjection {
  const method = input.method ?? "trailing6";
  const points = input.series.filter(
    (p) => typeof p.month === "string" && monthIndex(p.month) != null && Number.isFinite(p.value)
  );
  const target = input.target;
  const last = points.length > 0 ? points[points.length - 1] : null;
  const current = last ? last.value : 0;

  const base: GoalProjection = {
    status: "invalid",
    current,
    remaining: 0,
    windowMonths: 0,
    monthlyDelta: null,
    monthsToTarget: null,
    etaMonth: null,
    requiredMonthlyForDate: null,
    monthsToDeadline: null,
  };

  if (!Number.isFinite(target) || target <= 0 || !last) return base;

  const remaining = Math.max(0, target - current);
  base.remaining = remaining;

  // 기한 — 페이스와 무관하게 현재값·목표만으로 계산 (데이터 부족이어도 제공)
  if (input.targetDate) {
    const diff = monthsBetween(last.month, input.targetDate.slice(0, 7));
    if (diff != null) {
      base.monthsToDeadline = diff;
      if (remaining > 0 && diff > 0) base.requiredMonthlyForDate = remaining / diff;
    }
  }

  if (remaining <= 0) {
    return { ...base, status: "achieved", monthsToTarget: 0, etaMonth: last.month, requiredMonthlyForDate: null };
  }

  if (points.length < MIN_POINTS) return { ...base, status: "insufficient" };

  const window = Math.min(WINDOW[method], points.length - 1);
  const start = points[points.length - 1 - window];
  const monthlyDelta = (last.value - start.value) / window;
  base.windowMonths = window;
  base.monthlyDelta = monthlyDelta;

  if (monthlyDelta < 0) return { ...base, status: "declining" };
  if (monthlyDelta === 0) return { ...base, status: "stalled" };

  const monthsToTarget = Math.ceil(remaining / monthlyDelta);
  return {
    ...base,
    status: "projected",
    monthsToTarget,
    etaMonth: shiftMonth(last.month, monthsToTarget),
  };
}

/**
 * 한 줄 요약 — 'ETA 2029-03 (최근 6개월 페이스 월 +120만) · 기한 맞추려면 월 +35만'.
 * fmt는 KRW 금액 포맷터(인사이트 F / 대시보드 formatKRW 등 호출처 스타일 유지).
 */
export function formatGoalProjectionLine(p: GoalProjection, fmt: (n: number) => string): string {
  const pace = p.monthlyDelta == null
    ? null
    : `최근 ${p.windowMonths}개월 페이스 월 ${p.monthlyDelta >= 0 ? "+" : "−"}${fmt(Math.abs(Math.round(p.monthlyDelta)))}`;
  let head: string;
  switch (p.status) {
    case "achieved": head = "목표 달성 ✓"; break;
    case "insufficient": head = "ETA 산정 불가 (데이터 3개월 미만)"; break;
    case "declining": head = `ETA 없음 — 감소 추세 (${pace})`; break;
    case "stalled": head = `ETA 없음 — 정체 (${pace})`; break;
    case "projected": head = `ETA ${p.etaMonth} · ${p.monthsToTarget}개월 후 (${pace})`; break;
    default: head = "ETA –";
  }
  if (p.status !== "achieved" && p.monthsToDeadline != null) {
    if (p.requiredMonthlyForDate != null) {
      head += ` · 기한 맞추려면 월 +${fmt(Math.round(p.requiredMonthlyForDate))}`;
    } else if (p.monthsToDeadline <= 0) {
      head += " · 기한 경과";
    }
  }
  return head;
}
