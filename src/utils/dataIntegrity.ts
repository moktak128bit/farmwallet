/**
 * 데이터 무결성 검증 유틸리티
 */

import type { Account, LedgerEntry, StockTrade, CategoryPresets } from "../types";
import { computeAccountBalances } from "../calculations";

export interface DuplicateTrade {
  type: "ledger" | "trade";
  entries: (LedgerEntry | StockTrade)[];
  similarity: number;
}

export interface BalanceMismatch {
  accountId: string;
  accountName: string;
  calculatedBalance: number;
  expectedBalance: number;
  difference: number;
}

export interface MissingReference {
  type: "account" | "ticker";
  id: string;
  usedIn: Array<{ type: "ledger" | "trade"; id: string; field: string }>;
}

export interface CategoryMismatch {
  entryId: string;
  kind: string;
  category: string;
  subCategory?: string;
  expectedMain?: string[];
  expectedSubs?: string[];
}

export interface IntegrityIssue {
  type: "duplicate" | "balance_mismatch" | "missing_reference" | "date_order" | "amount_consistency" | "category_mismatch";
  severity: "error" | "warning" | "info";
  message: string;
  data: DuplicateTrade | BalanceMismatch | MissingReference | CategoryMismatch | any;
}

/**
 * 중복 거래 감지
 */
export function detectDuplicateTrades(
  ledger: LedgerEntry[],
  trades: StockTrade[],
  threshold: number = 0.95
): DuplicateTrade[] {
  const duplicates: DuplicateTrade[] = [];

  // 가계부 중복 감지
  const ledgerGroups = new Map<string, LedgerEntry[]>();
  ledger.forEach((entry) => {
    const key = `${entry.date}_${entry.amount}_${entry.fromAccountId || ""}_${entry.toAccountId || ""}_${entry.category}`;
    if (!ledgerGroups.has(key)) {
      ledgerGroups.set(key, []);
    }
    ledgerGroups.get(key)!.push(entry);
  });

  ledgerGroups.forEach((entries) => {
    if (entries.length > 1) {
      duplicates.push({
        type: "ledger",
        entries,
        similarity: 1.0
      });
    }
  });

  // 주식 거래 중복 감지
  const tradeGroups = new Map<string, StockTrade[]>();
  trades.forEach((trade) => {
    const key = `${trade.date}_${trade.accountId}_${trade.ticker}_${trade.side}_${trade.quantity}_${trade.price}`;
    if (!tradeGroups.has(key)) {
      tradeGroups.set(key, []);
    }
    tradeGroups.get(key)!.push(trade);
  });

  tradeGroups.forEach((entries) => {
    if (entries.length > 1) {
      duplicates.push({
        type: "trade",
        entries,
        similarity: 1.0
      });
    }
  });

  return duplicates;
}

/**
 * 계좌 잔액 검증
 */
export function validateAccountBalances(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[]
): BalanceMismatch[] {
  const mismatches: BalanceMismatch[] = [];
  const balances = computeAccountBalances(accounts, ledger, trades);

  accounts.forEach((account) => {
    const balanceRow = balances.find((b) => b.account.id === account.id);
    if (!balanceRow) return;

    // 초기 잔액 + 현금 조정 + 초기 현금 잔액
    const expectedBalance =
      account.initialBalance +
      (account.cashAdjustment ?? 0) +
      (account.initialCashBalance ?? 0);

    const calculatedBalance = balanceRow.currentBalance;
    const difference = calculatedBalance - expectedBalance;

    // 차이가 1원 이상이면 불일치로 간주
    if (Math.abs(difference) >= 1) {
      mismatches.push({
        accountId: account.id,
        accountName: account.name,
        calculatedBalance,
        expectedBalance,
        difference
      });
    }
  });

  return mismatches;
}

/**
 * 누락된 참조 확인
 */
export function checkMissingReferences(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[]
): MissingReference[] {
  const issues: MissingReference[] = [];
  const accountIds = new Set(accounts.map((a) => a.id));
  const tickerSet = new Set<string>(); // 주식 티커는 동적으로 추가되므로 경고만

  // 가계부에서 누락된 계좌 참조 확인
  const missingAccountRefs = new Map<string, Array<{ type: "ledger" | "trade"; id: string; field: string }>>();

  ledger.forEach((entry) => {
    if (entry.fromAccountId && !accountIds.has(entry.fromAccountId)) {
      if (!missingAccountRefs.has(entry.fromAccountId)) {
        missingAccountRefs.set(entry.fromAccountId, []);
      }
      missingAccountRefs.get(entry.fromAccountId)!.push({
        type: "ledger",
        id: entry.id,
        field: "fromAccountId"
      });
    }
    if (entry.toAccountId && !accountIds.has(entry.toAccountId)) {
      if (!missingAccountRefs.has(entry.toAccountId)) {
        missingAccountRefs.set(entry.toAccountId, []);
      }
      missingAccountRefs.get(entry.toAccountId)!.push({
        type: "ledger",
        id: entry.id,
        field: "toAccountId"
      });
    }
  });

  // 주식 거래에서 누락된 계좌 참조 확인
  trades.forEach((trade) => {
    if (trade.accountId && !accountIds.has(trade.accountId)) {
      if (!missingAccountRefs.has(trade.accountId)) {
        missingAccountRefs.set(trade.accountId, []);
      }
      missingAccountRefs.get(trade.accountId)!.push({
        type: "trade",
        id: trade.id,
        field: "accountId"
      });
    }
  });

  missingAccountRefs.forEach((usedIn, accountId) => {
    issues.push({
      type: "account",
      id: accountId,
      usedIn
    });
  });

  return issues;
}

/**
 * 날짜 순서 검증
 */
export function validateDateOrder(
  ledger: LedgerEntry[],
  trades: StockTrade[]
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];

  // 가계부 날짜 검증 (미래 날짜 체크)
  const today = new Date().toISOString().slice(0, 10);
  ledger.forEach((entry) => {
    if (entry.date > today) {
      issues.push({
        type: "date_order",
        severity: "warning",
        message: `가계부 항목 ${entry.id}의 날짜가 미래입니다: ${entry.date}`,
        data: { entryId: entry.id, date: entry.date }
      });
    }
  });

  // 주식 거래 날짜 검증
  trades.forEach((trade) => {
    if (trade.date > today) {
      issues.push({
        type: "date_order",
        severity: "warning",
        message: `주식 거래 ${trade.id}의 날짜가 미래입니다: ${trade.date}`,
        data: { tradeId: trade.id, date: trade.date }
      });
    }
  });

  return issues;
}

/**
 * 금액 일관성 검증
 */
export function validateAmountConsistency(
  ledger: LedgerEntry[],
  trades: StockTrade[]
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];

  // 주식 거래의 totalAmount 검증
  trades.forEach((trade) => {
    // 매수: totalAmount = quantity * price + fee (지불한 총액)
    // 매도: totalAmount = quantity * price - fee (받은 총액, 수수료 차감)
    const expectedTotal = trade.side === "buy" 
      ? trade.quantity * trade.price + trade.fee
      : trade.quantity * trade.price - trade.fee;
    const actualTotal = trade.totalAmount;
    const difference = Math.abs(expectedTotal - actualTotal);

    // 1원 이상 차이나면 경고
    if (difference >= 1) {
      issues.push({
        type: "amount_consistency",
        severity: "warning",
        message: `주식 거래 ${trade.id}의 총액이 계산값과 다릅니다. 계산: ${expectedTotal.toLocaleString()}, 실제: ${actualTotal.toLocaleString()}`,
        data: { tradeId: trade.id, expected: expectedTotal, actual: actualTotal, difference }
      });
    }
  });

  return issues;
}

/**
 * 카테고리 일관성 검증: 가계부 항목의 category/subCategory가 CategoryPresets와 맞는지 검사
 */
export function checkCategoryConsistency(
  ledger: LedgerEntry[],
  categoryPresets: CategoryPresets
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const incomeSet = new Set(categoryPresets.income ?? []);
  const expenseSet = new Set(categoryPresets.expense ?? []);
  const transferSet = new Set(categoryPresets.transfer ?? []);
  const expenseDetails = categoryPresets.expenseDetails ?? [];
  const savingsCategories = new Set(categoryPresets.categoryTypes?.savings ?? ["저축성지출"]);

  ledger.forEach((entry) => {
    const main = (entry.category ?? "").trim();
    const sub = (entry.subCategory ?? "").trim();

    if (entry.kind === "income") {
      if (main && !incomeSet.has(main)) {
        issues.push({
          type: "category_mismatch",
          severity: "warning",
          message: `가계부 항목 ${entry.id}: 수입 카테고리 "${main}"이(가) 수입 프리셋에 없습니다`,
          data: {
            entryId: entry.id,
            kind: "income",
            category: main,
            subCategory: sub || undefined,
            expectedMain: categoryPresets.income
          } as CategoryMismatch
        });
      }
      return;
    }

    if (entry.kind === "transfer") {
      if (main && !transferSet.has(main) && !savingsCategories.has(main)) {
        issues.push({
          type: "category_mismatch",
          severity: "warning",
          message: `가계부 항목 ${entry.id}: 이체 카테고리 "${main}"이(가) 이체/저축성지출 프리셋에 없습니다`,
          data: {
            entryId: entry.id,
            kind: "transfer",
            category: main,
            subCategory: sub || undefined,
            expectedMain: categoryPresets.transfer
          } as CategoryMismatch
        });
      }
      return;
    }

    if (entry.kind === "expense") {
      if (main && !expenseSet.has(main) && !savingsCategories.has(main)) {
        issues.push({
          type: "category_mismatch",
          severity: "warning",
          message: `가계부 항목 ${entry.id}: 지출 대분류 "${main}"이(가) 지출 프리셋에 없습니다`,
          data: {
            entryId: entry.id,
            kind: "expense",
            category: main,
            subCategory: sub || undefined,
            expectedMain: categoryPresets.expense
          } as CategoryMismatch
        });
        return;
      }
      const detailGroup = expenseDetails.find((g) => g.main === main);
      const allowedSubs = detailGroup ? new Set(detailGroup.subs ?? []) : null;
      if (sub && allowedSubs && !allowedSubs.has(sub)) {
        issues.push({
          type: "category_mismatch",
          severity: "warning",
          message: `가계부 항목 ${entry.id}: 지출 세부분류 "${main} > ${sub}"이(가) 프리셋에 없습니다`,
          data: {
            entryId: entry.id,
            kind: "expense",
            category: main,
            subCategory: sub,
            expectedMain: categoryPresets.expense,
            expectedSubs: detailGroup?.subs
          } as CategoryMismatch
        });
      }
    }
  });

  return issues;
}

/**
 * 전체 무결성 체크 실행
 */
export function runIntegrityCheck(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[],
  categoryPresets?: CategoryPresets
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];

  // 중복 거래 감지
  const duplicates = detectDuplicateTrades(ledger, trades);
  duplicates.forEach((dup) => {
    issues.push({
      type: "duplicate",
      severity: dup.entries.length > 2 ? "error" : "warning",
      message: `${dup.type === "ledger" ? "가계부" : "주식"} 중복 거래 ${dup.entries.length}건 발견`,
      data: dup
    });
  });

  // 계좌 잔액 검증
  const balanceMismatches = validateAccountBalances(accounts, ledger, trades);
  balanceMismatches.forEach((mismatch) => {
    issues.push({
      type: "balance_mismatch",
      severity: Math.abs(mismatch.difference) > 1000 ? "error" : "warning",
      message: `계좌 ${mismatch.accountName}(${mismatch.accountId})의 잔액이 불일치합니다. 차이: ${mismatch.difference.toLocaleString()}원`,
      data: mismatch
    });
  });

  // 누락된 참조 확인
  const missingRefs = checkMissingReferences(accounts, ledger, trades);
  missingRefs.forEach((ref) => {
    issues.push({
      type: "missing_reference",
      severity: "error",
      message: `존재하지 않는 ${ref.type === "account" ? "계좌" : "티커"} 참조: ${ref.id}`,
      data: ref
    });
  });

  // 날짜 순서 검증
  const dateIssues = validateDateOrder(ledger, trades);
  issues.push(...dateIssues);

  // 금액 일관성 검증
  const amountIssues = validateAmountConsistency(ledger, trades);
  issues.push(...amountIssues);

  // 카테고리 일관성 검증
  if (categoryPresets) {
    const categoryIssues = checkCategoryConsistency(ledger, categoryPresets);
    issues.push(...categoryIssues);
  }

  return issues;
}

/**
 * 중복 항목 병합
 */
export function mergeDuplicates(
  duplicates: DuplicateTrade[],
  keepFirst: boolean = true
): { ledger: Set<string>; trades: Set<string> } {
  const ledgerToRemove = new Set<string>();
  const tradesToRemove = new Set<string>();

  duplicates.forEach((dup) => {
    if (keepFirst) {
      // 첫 번째 항목을 유지하고 나머지 제거
      for (let i = 1; i < dup.entries.length; i++) {
        if (dup.type === "ledger") {
          ledgerToRemove.add((dup.entries[i] as LedgerEntry).id);
        } else {
          tradesToRemove.add((dup.entries[i] as StockTrade).id);
        }
      }
    } else {
      // 마지막 항목을 유지하고 나머지 제거
      for (let i = 0; i < dup.entries.length - 1; i++) {
        if (dup.type === "ledger") {
          ledgerToRemove.add((dup.entries[i] as LedgerEntry).id);
        } else {
          tradesToRemove.add((dup.entries[i] as StockTrade).id);
        }
      }
    }
  });

  return {
    ledger: ledgerToRemove,
    trades: tradesToRemove
  };
}

