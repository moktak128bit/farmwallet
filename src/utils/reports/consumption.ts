// ---------------------------------------------------------------------------
// reportGenerator 분해 — 소비 분석(투자 여력·실투자 비교).
// (순수 이동만 — 로직 변경 없음. 원본 src/utils/reportGenerator.ts 참조)
// ---------------------------------------------------------------------------

import type { Account, LedgerEntry } from "../../types";
import { isSavingsExpenseEntry, isCreditPayment, isInvestmentEntry } from "../category";
import { INVESTING_ACCOUNT_TYPES, toKrwAmount, buildMonthRange } from "./shared";

export interface ConsumptionImpactMonthlyRow {
  month: string;
  income: number;
  consumptionExpense: number;
  investmentCapacity: number;
  actualInvested: number;
  capacityGap: number;
  capacityUtilizationRate: number | null;
}

export function generateConsumptionImpactMonthlyReport(
  ledger: LedgerEntry[],
  accounts: Account[],
  startMonth?: string,
  endMonth?: string,
  fxRate?: number
): ConsumptionImpactMonthlyRow[] {
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  const availableMonths = Array.from(new Set(ledger.map((entry) => entry.date.slice(0, 7)))).sort();
  const rangeStart = startMonth ?? availableMonths[0];
  const rangeEnd = endMonth ?? availableMonths[availableMonths.length - 1];
  if (!rangeStart || !rangeEnd) return [];

  const months = buildMonthRange(rangeStart, rangeEnd);
  const rows = new Map<string, { income: number; consumptionExpense: number; actualInvested: number }>();
  for (const month of months) {
    rows.set(month, { income: 0, consumptionExpense: 0, actualInvested: 0 });
  }

  for (const entry of ledger) {
    const month = entry.date.slice(0, 7);
    if (month < rangeStart || month > rangeEnd) continue;

    const row = rows.get(month);
    if (!row) continue;

    const amount = toKrwAmount(entry.amount, entry.currency, fxRate);

    if (entry.kind === "income") {
      row.income += amount;
      continue;
    }

    if (entry.kind === "expense") {
      // 신용결제는 카드 사용 시점에 이미 잡힘 — 이중계상 방지
      if (isCreditPayment(entry)) continue;
      if (isSavingsExpenseEntry(entry, accounts)) {
        row.actualInvested += amount;
      } else {
        // 일반 소비지출 + 투자손실(category="재테크", isSavingsExpenseEntry가 false 반환)도 소비로 집계
        row.consumptionExpense += amount;
      }
      continue;
    }

    // 재테크 이체 판정은 isInvestmentEntry 단일 소스 (kind 가드 유지 — expense 절 도달 방지)
    if (entry.kind === "transfer" && isInvestmentEntry(entry)) {
      row.actualInvested += amount;
      continue;
    }

    if (entry.kind === "transfer") {
      const fromAccount = entry.fromAccountId ? accountById.get(entry.fromAccountId) : undefined;
      const toAccount = entry.toAccountId ? accountById.get(entry.toAccountId) : undefined;
      const fromInvesting = !!fromAccount && INVESTING_ACCOUNT_TYPES.has(fromAccount.type);
      const toInvesting = !!toAccount && INVESTING_ACCOUNT_TYPES.has(toAccount.type);

      if (!fromInvesting && toInvesting) row.actualInvested += amount;
      else if (fromInvesting && !toInvesting) row.actualInvested -= amount;
    }
  }

  return months.map((month) => {
    const row = rows.get(month)!;
    const investmentCapacity = row.income - row.consumptionExpense;
    const capacityGap = investmentCapacity - row.actualInvested;
    const capacityUtilizationRate =
      investmentCapacity > 0 ? (row.actualInvested / investmentCapacity) * 100 : null;

    return {
      month,
      income: row.income,
      consumptionExpense: row.consumptionExpense,
      investmentCapacity,
      actualInvested: row.actualInvested,
      capacityGap,
      capacityUtilizationRate
    };
  });
}
