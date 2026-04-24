import type { LedgerEntry, RecurringExpense } from "../types";

export interface RecurringDueItem {
  recurring: RecurringExpense;
  dueDate: string;
  alreadyLogged: boolean;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

const computeDueDate = (r: RecurringExpense, refDate: string): string | null => {
  const ref = new Date(refDate);
  const start = new Date(r.startDate);
  if (start > ref) return null;
  if (r.endDate && new Date(r.endDate) < ref) return null;

  if (r.frequency === "monthly") {
    const dueDay = start.getDate();
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
 */
export function findOverdueRecurring(
  recurring: RecurringExpense[],
  ledger: LedgerEntry[],
  refDate: string = todayIso()
): RecurringDueItem[] {
  const todaysEntries = ledger.filter((l) => l.date === refDate);
  const items: RecurringDueItem[] = [];
  for (const r of recurring) {
    const due = computeDueDate(r, refDate);
    if (!due || due !== refDate) continue;
    const alreadyLogged = todaysEntries.some(
      (l) => l.category === r.category && Math.abs(l.amount - r.amount) < 1
    );
    items.push({ recurring: r, dueDate: due, alreadyLogged });
  }
  return items;
}

