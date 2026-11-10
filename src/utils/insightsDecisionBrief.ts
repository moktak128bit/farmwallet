import type { CategoryPresets, LedgerEntry } from "../types";
import { classifyLedgerFlow, toKrwAmount } from "../features/dashboard/summaryMath";
import { expenseMainName } from "./categoryMerge";
import { getTodayKST, parseIsoLocal, shiftMonth } from "./date";
import { daysSinceLastRecord as daysSinceLast, latestRecordedDate, recordedDayCap } from "./ledgerFreshness";

interface SpendingBucket {
  amount: number;
  count: number;
}

export function buildInsightsDecisionBrief({ ledger, targetMonth, categoryPresets, fxRate, today = getTodayKST() }: {
  ledger: LedgerEntry[];
  targetMonth: string;
  categoryPresets?: CategoryPresets;
  fxRate: number | null;
  today?: string;
}) {
  // 진행 중인 달은 오늘이 아니라 마지막 기록일까지만 — 캡처를 모았다가 입력하면 아직 안 넣은 날이 '지출 감소'로 보인다.
  // 이번 달 기록이 하나도 없으면 0 → hasTarget=false(비교 보류)
  const partialDay = recordedDayCap(ledger, targetMonth, today);
  const buckets = new Map<string, SpendingBucket>();
  const categories = new Map<string, Map<string, SpendingBucket>>();
  const largestEntries = new Map<string, Map<string, { date: string; description: string; amount: number }>>();
  const recordedMonths = new Set<string>();
  let latestRecordDate: string | null = null;
  let missingFx = false;
  for (const entry of ledger) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date ?? "") || !parseIsoLocal(entry.date) || entry.date > today) continue;
    const month = entry.date.slice(0, 7);
    if (month < shiftMonth(targetMonth, -12) || month > targetMonth) continue;
    // A recorded income/transfer month can legitimately have zero spending.
    recordedMonths.add(month);
    if (month === targetMonth && (!latestRecordDate || entry.date > latestRecordDate)) latestRecordDate = entry.date;
    if (partialDay != null && Number(entry.date.slice(8, 10)) > partialDay) continue;
    if (classifyLedgerFlow(entry, categoryPresets) !== "expense" || !Number.isFinite(Number(entry.amount)) || Number(entry.amount) <= 0) continue;
    if (entry.currency === "USD" && !(fxRate != null && Number.isFinite(fxRate) && fxRate > 0)) {
      missingFx = true;
      continue;
    }
    const amount = toKrwAmount(entry, fxRate);
    const bucket = buckets.get(month) ?? { amount: 0, count: 0 };
    bucket.amount += amount;
    bucket.count++;
    buckets.set(month, bucket);
    const name = expenseMainName(entry) || "기타";
    const monthCategories = categories.get(month) ?? new Map<string, SpendingBucket>();
    const category = monthCategories.get(name) ?? { amount: 0, count: 0 };
    category.amount += amount;
    category.count++;
    monthCategories.set(name, category);
    categories.set(month, monthCategories);
    const largest = largestEntries.get(month) ?? new Map<string, { date: string; description: string; amount: number }>();
    if (amount > (largest.get(name)?.amount ?? 0)) largest.set(name, { date: entry.date, description: entry.description || entry.detailCategory || name, amount });
    largestEntries.set(month, largest);
  }
  const target = buckets.get(targetMonth) ?? { amount: 0, count: 0 };
  const hasTarget = recordedMonths.has(targetMonth) && targetMonth <= today.slice(0, 7) && partialDay !== 0;
  const definitions = [
    { id: "previous", label: "전월", offsets: [1] },
    { id: "average3", label: "직전 3개월 평균", offsets: [1, 2, 3] },
    { id: "average6", label: "직전 6개월 평균", offsets: [1, 2, 3, 4, 5, 6] },
    { id: "average12", label: "직전 12개월 평균", offsets: Array.from({ length: 12 }, (_, i) => i + 1) },
    { id: "year", label: "전년 동월", offsets: [12] },
  ];
  const comparisons = definitions.map(({ id, label, offsets }) => {
    const months = offsets.map(offset => shiftMonth(targetMonth, -offset));
    const recordedCount = months.filter(month => recordedMonths.has(month)).length;
    const available = hasTarget && recordedCount === months.length && !missingFx;
    const amount = available ? months.reduce((sum, month) => sum + (buckets.get(month)?.amount ?? 0), 0) / months.length : null;
    const delta = amount == null ? null : target.amount - amount;
    return { id, label, months, recordedCount, requiredCount: months.length, amount, delta,
      percent: amount != null && amount > 0 && delta != null ? delta / amount * 100 : null };
  });
  const baseline = comparisons.find(row => row.id === "average3")!;
  const drivers = baseline.amount == null ? [] : [...new Set([
    ...[...(categories.get(targetMonth)?.keys() ?? [])],
    ...baseline.months.flatMap(month => [...(categories.get(month)?.keys() ?? [])]),
  ])].map(name => {
    const current = categories.get(targetMonth)?.get(name) ?? { amount: 0, count: 0 };
    const previous = baseline.months.map(month => categories.get(month)?.get(name) ?? { amount: 0, count: 0 });
    const averageAmount = previous.reduce((sum, bucket) => sum + bucket.amount, 0) / previous.length;
    const averageCount = previous.reduce((sum, bucket) => sum + bucket.count, 0) / previous.length;
    // 변화 = 건수 효과 (n − 평균n)×기준 건당 + 건당 효과 n×(이번 건당 − 기준 건당) — 두 항의 합이 정확히 delta
    const baseTicket = averageCount > 0 ? averageAmount / averageCount : null;
    const countEffect = baseTicket != null && current.count > 0 ? (current.count - averageCount) * baseTicket : null;
    const ticketEffect = countEffect != null ? (current.amount - averageAmount) - countEffect : null;
    return { name, amount: current.amount, count: current.count, averageAmount, averageCount,
      delta: current.amount - averageAmount, countEffect, ticketEffect,
      largestEntry: largestEntries.get(targetMonth)?.get(name) ?? null,
      averageTicket: current.count > 0 ? current.amount / current.count : null,
      baselineTicket: averageCount > 0 ? averageAmount / averageCount : null };
  }).filter(row => Math.abs(row.delta) > 0.01).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5);
  // 마지막 기록 후 경과일 — 진행 중인 달만 의미가 있다(비교는 이미 그 날짜까지로 잘랐음)
  const lastAny = latestRecordedDate(ledger, today);
  const daysSinceLastRecord = partialDay != null ? daysSinceLast(ledger, today) : null;
  return { targetMonth, partialDay, target, hasTarget, missingFx, comparisons, drivers, latestRecordDate: partialDay != null ? lastAny : latestRecordDate, daysSinceLastRecord };
}
