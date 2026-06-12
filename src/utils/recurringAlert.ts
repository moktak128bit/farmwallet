import type { LedgerEntry, RecurringExpense } from "../types";
import { getTodayKST, getLastDayOfMonth, parseIsoLocal } from "./date";

interface RecurringDueItem {
  recurring: RecurringExpense;
  dueDate: string;
  alreadyLogged: boolean;
}

const computeDueDate = (r: RecurringExpense, refDate: string): string | null => {
  // UTC 파싱 함정 회피 — parseIsoLocal로 로컬 자정 기준 파싱
  const ref = parseIsoLocal(refDate);
  const start = parseIsoLocal(r.startDate);
  if (!ref || !start) return null;
  if (start > ref) return null;
  const end = r.endDate ? parseIsoLocal(r.endDate) : null;
  if (end && end < ref) return null;

  if (r.frequency === "monthly") {
    // 29/30/31일 시작 반복은 짧은 달에 존재하지 않는 날짜가 됨 → 월말로 클램프
    // (RecurringListSection의 월 반영 경로와 동일 패턴)
    const lastDay = getLastDayOfMonth(ref.getFullYear(), ref.getMonth() + 1);
    const dueDay = Math.min(start.getDate(), lastDay);
    return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}-${String(dueDay).padStart(2, "0")}`;
  }
  if (r.frequency === "weekly") {
    const dayOfWeek = start.getDay();
    if (ref.getDay() !== dayOfWeek) return null;
    return refDate;
  }
  if (r.frequency === "yearly") {
    if (ref.getMonth() !== start.getMonth() || ref.getDate() !== start.getDate()) return null;
    return refDate;
  }
  return null;
};

/**
 * 오늘 등록되어야 할 반복지출 중 아직 가계부에 기록되지 않은 항목 목록.
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
  const todaysEntries = ledger.filter((l) => l.date === refDate);
  const items: RecurringDueItem[] = [];
  for (const r of recurring) {
    const due = computeDueDate(r, refDate);
    if (!due || due !== refDate) continue;
    const expectedKind = r.toAccountId ? "transfer" : "expense";
    const alreadyLogged = todaysEntries.some((l) => {
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
