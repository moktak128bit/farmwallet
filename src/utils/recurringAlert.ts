import type { LedgerEntry, Recurrence, RecurringExpense } from "../types";
import { getTodayKST, getLastDayOfMonth, parseIsoLocal, formatIsoLocal } from "./date";

interface RecurringDueItem {
  recurring: RecurringExpense;
  dueDate: string;
  alreadyLogged: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 마감일이 지난 뒤에도 '며칠'까지 미등록 알림을 유지할지.
 * 서버 없는 PWA라 푸시 보완이 불가능 — 마감 당일에만 알리면 하루만 안 열어도
 * 그 달 고정비가 조용히 누락된다. grace 윈도우로 '조용한 누락 방지'와
 * '과도한 알림' 사이를 잡는다. (월간은 다음 달이 되면 마감일이 미래가 되어 자연 종료)
 */
const OVERDUE_GRACE_DAYS: Record<Recurrence, number> = {
  monthly: 31, // 이번 달 내내
  weekly: 6, // 다음 발생 전까지
  yearly: 31 // 기념일 후 약 한 달
};

/**
 * refDate 기준 '이미 지났거나 오늘인' 가장 최근 마감일(YYYY-MM-DD). 알림 대상이 아니면 null.
 * - 마감일이 아직 안 왔거나(미래), 시작일 이전이거나, grace를 초과해 오래 지났으면 null.
 */
const computeDueDate = (r: RecurringExpense, refDate: string): string | null => {
  // UTC 파싱 함정 회피 — parseIsoLocal로 로컬 자정 기준 파싱
  const ref = parseIsoLocal(refDate);
  const start = parseIsoLocal(r.startDate);
  if (!ref || !start) return null;
  if (start > ref) return null;
  const end = r.endDate ? parseIsoLocal(r.endDate) : null;
  if (end && end < ref) return null;

  let due: string | null = null;
  if (r.frequency === "monthly") {
    // 29/30/31일 시작 반복은 짧은 달에 존재하지 않는 날짜가 됨 → 월말로 클램프
    // (RecurringListSection의 월 반영 경로와 동일 패턴)
    const lastDay = getLastDayOfMonth(ref.getFullYear(), ref.getMonth() + 1);
    const dueDay = Math.min(start.getDate(), lastDay);
    due = `${ref.getFullYear()}-${pad(ref.getMonth() + 1)}-${pad(dueDay)}`;
  } else if (r.frequency === "weekly") {
    // refDate 이전(또는 당일)의 가장 최근 같은 요일
    const diff = (ref.getDay() - start.getDay() + 7) % 7;
    const occ = new Date(ref);
    occ.setDate(ref.getDate() - diff);
    due = formatIsoLocal(occ);
  } else if (r.frequency === "yearly") {
    const lastDay = getLastDayOfMonth(ref.getFullYear(), start.getMonth() + 1);
    const dueDay = Math.min(start.getDate(), lastDay);
    due = `${ref.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(dueDay)}`;
  }
  if (!due) return null;

  const dueDt = parseIsoLocal(due);
  if (!dueDt) return null;
  if (dueDt < start) return null; // 시작일 이전 기념일/마감일
  if (dueDt > ref) return null; // 아직 마감일이 안 옴 (미래)
  const overdueDays = Math.round((ref.getTime() - dueDt.getTime()) / DAY_MS);
  if (overdueDays > OVERDUE_GRACE_DAYS[r.frequency]) return null; // 너무 오래 지남 → 알림 종료
  return due;
};

/**
 * 등록되어야 할 반복지출 중 아직 가계부에 기록되지 않은 항목 목록.
 *
 * 마감일이 지나도 grace 윈도우 안이면 계속 알리며(하루 결근 시 영구 누락 방지),
 * alreadyLogged는 '마감일~오늘' 구간 전체를 검사한다(마감 당일에 기록했어도 인식).
 *
 * alreadyLogged 판정은 실제 생성 스키마와 일치시킨다:
 *  - kind: toAccountId 있으면 "transfer", 없으면 "expense"
 *  - subCategory = r.category, detailCategory = r.title (category는 "지출"/"이체" 대분류)
 *  - description은 r.title 또는 "[반복] {title}" 형태 → 포함 일치로 허용
 */
export function findOverdueRecurring(
  recurring: RecurringExpense[],
  ledger: LedgerEntry[],
  refDate: string = getTodayKST()
): RecurringDueItem[] {
  const items: RecurringDueItem[] = [];
  for (const r of recurring) {
    const due = computeDueDate(r, refDate);
    if (!due) continue;
    const expectedKind = r.toAccountId ? "transfer" : "expense";
    // 마감일~오늘 구간의 기록을 검사 (당일만 보면 마감 당일 등록을 놓침)
    const windowEntries = ledger.filter((l) => l.date >= due && l.date <= refDate);
    const alreadyLogged = windowEntries.some((l) => {
      if (l.kind !== expectedKind) return false;
      if (Math.abs(Number(l.amount) - r.amount) >= 1) return false;
      const subMatch = !!r.category && l.subCategory === r.category;
      const titleMatch =
        !!r.title && (l.detailCategory === r.title || (l.description ?? "").includes(r.title));
      return subMatch || titleMatch;
    });
    items.push({ recurring: r, dueDate: due, alreadyLogged });
  }
  return items;
}
