/**
 * 카드 청구 예정액 계산 — 신용카드 계좌의 청구주기(billingCycleStart)·결제일(paymentDay) 기준으로
 * "다가오는 결제일에 얼마가 빠져나갈지"를 계산한다. 순수 함수 — 시계(todayIso)를 주입받아 테스트 가능.
 * 날짜는 KST 로컬(parseIsoLocal/formatIsoLocal) — UTC 파싱/직렬화 금지 컨벤션을 따른다.
 *
 * 모델:
 *  - 청구주기: billingCycleStart일(매월)부터 다음 달 (billingCycleStart-1)일까지. 짧은 달은 말일로 클램프.
 *    (예: billingCycleStart=13 → 7/13~8/12가 한 주기)
 *  - 결제일: 주기 종료일(cycleEnd) 이후(당일 포함) 처음 오는 paymentDay일 — 월말 클램프.
 *    (마감월에 결제되는 카드사·다음 달에 결제되는 카드사 모두 이 규칙 하나로 커버됨)
 *  - "지금 시점에 다가오는 결제"를 찾기 위해 오늘 기준 -2~+2개월 범위의 주기를 모두 계산해
 *    결제일이 오늘 이상인 것 중 가장 이른 것을 고른다 (여러 달치가 밀려 있어도 다음 결제 하나만 표시).
 *
 * 집계:
 *  - billedKRW: 주기 내(cycleStart~cycleEnd) fromAccountId=카드계좌 expense 중 classifyLedgerFlow가
 *    "expense"로 분류하는 것만 합산 — 신용결제(레거시 이중계상)·환전·저축성지출은 자동 제외(대시보드와 동일 기준).
 *  - alreadyPaidKRW: 주기 마감(cycleEnd) 후 ~ 결제일까지 기록된 "카드결제이체"(transfer,
 *    subCategory="카드결제이체", toAccountId=카드계좌) 합 — 조기 결제를 반영해 남은 결제액을 줄인다.
 *  - USD 항목은 toKrwByRate로 환산(환율 미로드 시 액면 그대로 — 대시보드 공통 정책과 동일).
 *
 * paymentDay/billingCycleStart 미설정 카드는 결과에서 제외 — 호출부(UI)가 "결제일 설정 필요"를 안내.
 */
import type { Account, CategoryPresets, LedgerEntry } from "../types";
import { parseIsoLocal, formatIsoLocal } from "./date";
import { classifyLedgerFlow } from "../features/dashboard/summaryMath";
import { toKrwByRate } from "./currency";

interface CardBillForecastEntry {
  accountId: string;
  /** yyyy-mm-dd — 이 결제에 해당하는 청구주기 시작일 */
  cycleStart: string;
  /** yyyy-mm-dd — 청구주기 종료일(마감일) */
  cycleEnd: string;
  /** yyyy-mm-dd — 결제일(월말 클램프) */
  paymentDate: string;
  /** 주기 내 카드 실사용액(원화 환산) */
  billedKRW: number;
  /** 마감 후 결제일까지 이미 낸 금액(조기 결제) */
  alreadyPaidKRW: number;
  /** 결제일에 실제로 빠져나갈 남은 금액 (billedKRW - alreadyPaidKRW, 0 미만은 0으로 클램프) */
  remainingKRW: number;
}

interface ForecastOptions {
  fxRate?: number | null;
  categoryPresets?: CategoryPresets;
  salaryKeys?: Set<string>;
}

const clampDay = (n: number): number => Math.min(31, Math.max(1, Math.round(n) || 1));

function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

/** year/month0(0-based)의 day일 — 짧은 달은 말일로 클램프 */
function monthDateClamped(year: number, month0: number, day: number): Date {
  return new Date(year, month0, Math.min(day, daysInMonth(year, month0)));
}

function addMonths(year: number, month0: number, delta: number): { year: number; month0: number } {
  const total = year * 12 + month0 + delta;
  return { year: Math.floor(total / 12), month0: ((total % 12) + 12) % 12 };
}

/** billingCycleStart 기준 해당 월(year/month0)에 시작하는 주기 [cycleStart, cycleEnd] (월말 클램프) */
function cycleForMonth(
  year: number,
  month0: number,
  billingCycleStart: number
): { cycleStart: Date; cycleEnd: Date } {
  const cycleStart = monthDateClamped(year, month0, billingCycleStart);
  const next = addMonths(year, month0, 1);
  const nextCycleStart = monthDateClamped(next.year, next.month0, billingCycleStart);
  const cycleEnd = new Date(nextCycleStart);
  cycleEnd.setDate(cycleEnd.getDate() - 1);
  return { cycleStart, cycleEnd };
}

/** cycleEnd 이후(당일 포함) 처음 오는 paymentDay일 (월말 클램프). 최대 3개월 탐색(안전망). */
function paymentDateForCycle(cycleEnd: Date, paymentDay: number): Date {
  let y = cycleEnd.getFullYear();
  let m0 = cycleEnd.getMonth();
  for (let i = 0; i < 3; i++) {
    const candidate = monthDateClamped(y, m0, paymentDay);
    if (candidate.getTime() >= cycleEnd.getTime()) return candidate;
    const next = addMonths(y, m0, 1);
    y = next.year;
    m0 = next.month0;
  }
  return monthDateClamped(y, m0, paymentDay);
}

/** 오늘 기준 "다가오는 결제"에 해당하는 청구주기 — 결제일이 오늘 이상인 것 중 결제일이 가장 이른 주기 */
function findRelevantCycle(
  billingCycleStart: number,
  paymentDay: number,
  today: Date
): { cycleStart: Date; cycleEnd: Date; paymentDate: Date } | null {
  let best: { cycleStart: Date; cycleEnd: Date; paymentDate: Date } | null = null;
  const y0 = today.getFullYear();
  const m0 = today.getMonth();
  for (let offset = -2; offset <= 2; offset++) {
    const { year, month0 } = addMonths(y0, m0, offset);
    const { cycleStart, cycleEnd } = cycleForMonth(year, month0, billingCycleStart);
    const paymentDate = paymentDateForCycle(cycleEnd, paymentDay);
    if (paymentDate.getTime() >= today.getTime() && (!best || paymentDate.getTime() < best.paymentDate.getTime())) {
      best = { cycleStart, cycleEnd, paymentDate };
    }
  }
  return best;
}

export function computeCardBillForecast(
  accounts: Account[],
  ledger: LedgerEntry[],
  todayIso: string,
  opts: ForecastOptions = {}
): CardBillForecastEntry[] {
  const today = parseIsoLocal(todayIso);
  if (!today) return [];
  const { fxRate = null, categoryPresets, salaryKeys } = opts;
  const results: CardBillForecastEntry[] = [];

  for (const acc of accounts) {
    if (acc.type !== "card") continue;
    if (!acc.billingCycleStart || !acc.paymentDay) continue; // 결제일 설정 필요 — UI가 안내
    const billingCycleStart = clampDay(acc.billingCycleStart);
    const paymentDay = clampDay(acc.paymentDay);

    const cycle = findRelevantCycle(billingCycleStart, paymentDay, today);
    if (!cycle) continue;
    const cycleStartIso = formatIsoLocal(cycle.cycleStart);
    const cycleEndIso = formatIsoLocal(cycle.cycleEnd);
    const paymentDateIso = formatIsoLocal(cycle.paymentDate);

    let billedKRW = 0;
    let alreadyPaidKRW = 0;
    for (const l of ledger) {
      if (!l.date) continue;
      if (l.fromAccountId === acc.id && l.date >= cycleStartIso && l.date <= cycleEndIso) {
        const flow = classifyLedgerFlow(l, categoryPresets, salaryKeys);
        if (flow === "expense") billedKRW += toKrwByRate(l.amount, l.currency, fxRate);
      }
      // 이미 납부: 주기 마감 후(초과) ~ 결제일까지(포함) 기록된 카드결제이체 — 조기 결제 반영
      if (
        l.kind === "transfer" &&
        l.subCategory === "카드결제이체" &&
        l.toAccountId === acc.id &&
        l.date > cycleEndIso &&
        l.date <= paymentDateIso
      ) {
        alreadyPaidKRW += toKrwByRate(l.amount, l.currency, fxRate);
      }
    }

    results.push({
      accountId: acc.id,
      cycleStart: cycleStartIso,
      cycleEnd: cycleEndIso,
      paymentDate: paymentDateIso,
      billedKRW,
      alreadyPaidKRW,
      remainingKRW: Math.max(0, billedKRW - alreadyPaidKRW)
    });
  }

  return results;
}
