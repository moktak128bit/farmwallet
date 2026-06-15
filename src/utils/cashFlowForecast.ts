/**
 * 현금흐름 예측 — 다가오는 고정(반복) 지출/이체를 기간 윈도우로 펼쳐 현금 일정을 만든다.
 * 순수 모듈: 시계(todayIso)를 주입받아 테스트 가능, 날짜는 KST 로컬(parseIsoLocal/formatIsoLocal).
 *
 * v1은 RecurringExpense(반복지출·구독·반복 저축이체)만 — 금액이 결정적이라 정확. 대출 상환·예정 배당은
 * 별도 이벤트 소스로 확장 가능하도록 CashFlowEvent를 일반화해 둠.
 *
 * 발생 규칙은 features/budget RecurringListSection의 월별 생성과 동일:
 *  - monthly: 시작일의 일(day-of-month), 짧은 달은 말일로 클램프
 *  - weekly : 시작일 요일 기준 7일 간격
 *  - yearly : 시작일의 월·일
 *  시작일 이전·종료일 이후 발생은 제외. 윈도우는 [오늘, 오늘+horizonDays].
 */
import type { RecurringExpense } from "../types";
import { parseIsoLocal, formatIsoLocal } from "./date";

interface CashFlowEvent {
  /** yyyy-mm-dd (KST 로컬) */
  date: string;
  title: string;
  category: string;
  /** KRW (반복지출 금액은 원화) */
  amount: number;
  /** 저축성지출/투자이체(toAccountId 존재) — 소비가 아닌 자산이동이지만 통장에서 빠져나가는 현금흐름 */
  isTransfer: boolean;
  /** 발생 주기 — UI 표시용 */
  frequency: RecurringExpense["frequency"];
}

interface CashFlowForecast {
  /** 날짜 오름차순, [오늘, 오늘+horizon] 범위 */
  events: CashFlowEvent[];
  horizonDays: number;
  /** 오늘~이번 달 말일까지 남은 고정 현금유출 합 */
  thisMonthRemaining: number;
  /** 향후 7일 합 */
  next7Days: number;
  /** 향후 30일 합 */
  next30Days: number;
  /** 윈도우 전체 합 */
  totalHorizon: number;
  /** 가장 가까운 다음 이벤트 (없으면 null) */
  nextEvent: CashFlowEvent | null;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function emptyForecast(horizonDays: number): CashFlowForecast {
  return { events: [], horizonDays, thisMonthRemaining: 0, next7Days: 0, next30Days: 0, totalHorizon: 0, nextEvent: null };
}

export function computeCashFlowForecast(
  recurring: RecurringExpense[],
  opts: { todayIso: string; horizonDays?: number }
): CashFlowForecast {
  const horizonDays = opts.horizonDays ?? 60;
  const today = parseIsoLocal(opts.todayIso);
  if (!today) return emptyForecast(horizonDays);
  const end = addDays(today, horizonDays);

  const events: CashFlowEvent[] = [];

  for (const r of recurring) {
    if (!r || !r.startDate || !r.startDate.trim()) continue;
    const start = parseIsoLocal(r.startDate);
    if (!start) continue;
    const endParsed = r.endDate ? parseIsoLocal(r.endDate) : null;
    const amount = Number(r.amount) || 0;
    if (amount <= 0) continue;

    const push = (date: Date) => {
      if (date < start) return;
      if (endParsed && date > endParsed) return;
      if (date < today || date > end) return; // 윈도우 [오늘, 오늘+horizon]
      events.push({
        date: formatIsoLocal(date),
        title: r.title || r.category || "반복지출",
        category: r.category || "",
        amount,
        isTransfer: !!r.toAccountId,
        frequency: r.frequency
      });
    };

    if (r.frequency === "monthly") {
      const day = start.getDate();
      // 윈도우와 겹치는 각 달의 해당 일자 (짧은 달은 말일로 클램프)
      let cur = new Date(today.getFullYear(), today.getMonth(), 1);
      while (cur <= end) {
        const dim = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
        push(new Date(cur.getFullYear(), cur.getMonth(), Math.min(day, dim)));
        cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      }
    } else if (r.frequency === "weekly") {
      const cursor = new Date(start);
      if (cursor < today) {
        // 시작일 요일을 유지한 채 오늘 이후 첫 발생일로 당김
        const diffDays = Math.ceil((today.getTime() - cursor.getTime()) / 86400000);
        cursor.setDate(cursor.getDate() + Math.ceil(diffDays / 7) * 7);
      }
      while (cursor <= end) {
        push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 7);
      }
    } else if (r.frequency === "yearly") {
      const mo = start.getMonth();
      const day = start.getDate();
      for (let yr = today.getFullYear(); yr <= end.getFullYear(); yr++) {
        const dim = new Date(yr, mo + 1, 0).getDate();
        push(new Date(yr, mo, Math.min(day, dim)));
      }
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));

  const monthEndIso = formatIsoLocal(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  const d7 = formatIsoLocal(addDays(today, 7));
  const d30 = formatIsoLocal(addDays(today, 30));
  const sumWhere = (pred: (e: CashFlowEvent) => boolean) =>
    events.reduce((s, e) => (pred(e) ? s + e.amount : s), 0);

  return {
    events,
    horizonDays,
    thisMonthRemaining: sumWhere((e) => e.date <= monthEndIso),
    next7Days: sumWhere((e) => e.date <= d7),
    next30Days: sumWhere((e) => e.date <= d30),
    totalHorizon: events.reduce((s, e) => s + e.amount, 0),
    nextEvent: events[0] ?? null
  };
}
