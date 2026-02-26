/**
 * 데이터 무결성 검증 유틸리티
 */

import type { Account, LedgerEntry, StockTrade, CategoryPresets } from "../types";
import { computeAccountBalances } from "../calculations";
import { isUSDStock } from "./finance";

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
  type: "duplicate" | "balance_mismatch" | "missing_reference" | "date_order" | "amount_consistency" | "category_mismatch" | "transfer_pair_mismatch" | "transfer_invalid_reference" | "usd_securities_mismatch";
  severity: "error" | "warning" | "info";
  message: string;
  data: DuplicateTrade | BalanceMismatch | MissingReference | CategoryMismatch | any;
}

function isCardPaymentTransfer(l: LedgerEntry): boolean {
  return (
    l.kind === "transfer" &&
    ((l.category === "\uC2E0\uC6A9\uCE74\uB4DC" && l.subCategory === "\uCE74\uB4DC\uB300\uAE08") ||
      (l.category === "\uC774\uCCB4" && l.subCategory === "\uCE74\uB4DC\uACB0\uC81C\uC774\uCCB4"))
  );
}

function isUsdEntry(l: LedgerEntry): boolean {
  return l.currency === "USD";
}

/**
 * 중복 거래 탐지
 */
export function detectDuplicateTrades(
  ledger: LedgerEntry[],
  trades: StockTrade[],
  threshold: number = 0.95
): DuplicateTrade[] {
  const duplicates: DuplicateTrade[] = [];

  // 원장 중복 탐지
  const ledgerGroups = new Map<string, LedgerEntry[]>();
  ledger.forEach((entry) => {
    const key = [
      entry.date,
      entry.kind,
      entry.amount,
      entry.fromAccountId || "",
      entry.toAccountId || "",
      (entry.category || "").trim(),
      (entry.subCategory || "").trim(),
      (entry.description || "").trim(),
      entry.currency || "KRW"
    ].join("|");
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

  // 주식 거래 중복 탐지
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
 * 계좌 잔액 검증 */
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

    const expectedBalance =
      account.initialBalance +
      (account.cashAdjustment ?? 0) +
      (account.initialCashBalance ?? 0);

    const calculatedBalance = balanceRow.currentBalance;
    const difference = calculatedBalance - expectedBalance;

    // 차이가 1원 이상이면 이슈로 추가
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
 * 주식 거래 참조 검사 */
export function checkMissingReferences(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[]
): MissingReference[] {
  const issues: MissingReference[] = [];
  const accountIds = new Set(accounts.map((a) => a.id));
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
 * 날짜 순서 검증 */
export function validateDateOrder(
  ledger: LedgerEntry[],
  trades: StockTrade[]
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];

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
 * 금액 일관성 검증 */
export function validateAmountConsistency(
  ledger: LedgerEntry[],
  trades: StockTrade[]
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];

  trades.forEach((trade) => {
    const f = trade.fee ?? 0;
    const expectedTotal = trade.side === "buy"
      ? trade.quantity * trade.price + f
      : trade.quantity * trade.price - f;
    const actualTotal = trade.totalAmount;
    const difference = Math.abs(expectedTotal - actualTotal);

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
  * 내부 이체 쌍 검증: fromAccountId·toAccountId 모두 있는 이체는 계좌 간 합계 0이어야 함 */
export function validateTransferPairConsistency(
  ledger: LedgerEntry[],
  accounts: Account[]
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const accountIds = new Set(accounts.map((a) => a.id));

  const internalTransfers = ledger.filter(
    (l) =>
      l.kind === "transfer" &&
      l.fromAccountId &&
      l.toAccountId &&
      !isCardPaymentTransfer(l)
  );

  const krwNetByAccount = new Map<string, number>();
  const usdNetByAccount = new Map<string, number>();

  internalTransfers.forEach((l) => {
    const from = l.fromAccountId!;
    const to = l.toAccountId!;
    if (!accountIds.has(from) || !accountIds.has(to)) return;

    if (isUsdEntry(l)) {
      usdNetByAccount.set(from, (usdNetByAccount.get(from) ?? 0) - l.amount);
      usdNetByAccount.set(to, (usdNetByAccount.get(to) ?? 0) + l.amount);
    } else {
      krwNetByAccount.set(from, (krwNetByAccount.get(from) ?? 0) - l.amount);
      krwNetByAccount.set(to, (krwNetByAccount.get(to) ?? 0) + l.amount);
    }
  });

  const totalKrw = Array.from(krwNetByAccount.values()).reduce((s, v) => s + v, 0);
  const totalUsd = Array.from(usdNetByAccount.values()).reduce((s, v) => s + v, 0);

  if (internalTransfers.length > 0 && Math.abs(totalKrw) >= 1) {
    issues.push({
      type: "transfer_pair_mismatch",
      severity: "error",
      message: `내부 이체(KRW) 합계가 0이 아닙니다. 차이: ${totalKrw.toLocaleString()}원`,
      data: { currency: "KRW", totalNet: totalKrw }
    });
  }
  if (internalTransfers.length > 0 && Math.abs(totalUsd) >= 0.01) {
    issues.push({
      type: "transfer_pair_mismatch",
      severity: "error",
      message: `내부 이체(USD) 합계가 0이 아닙니다. 차이: ${totalUsd.toLocaleString()} USD`,
      data: { currency: "USD", totalNet: totalUsd }
    });
  }

  return issues;
}

/**
 * 이체 항목 쌍 검증: kind=transfer일 때 fromAccountId 또는 toAccountId가 없으면 검사 */
export function validateTransferRequiredFields(
  ledger: LedgerEntry[]
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];

  ledger.forEach((entry) => {
    if (entry.kind !== "transfer") return;
    const hasFrom = !!entry.fromAccountId;
    const hasTo = !!entry.toAccountId;
    if (!hasFrom || !hasTo) {
      issues.push({
        type: "transfer_invalid_reference",
        severity: "warning",
        message: `이체 항목 ${entry.id}: fromAccountId 또는 toAccountId가 없습니다. 내부 이체는 양쪽 모두 필요합니다.`,
        data: { entryId: entry.id, hasFrom, hasTo }
      });
    }
  });

  return issues;
}

/**
 * USD 증권 계좌 일관성 검증: USD 거래 순합계와 usdBalance+usdTransferNet 비교
 */
export function validateUsdSecuritiesConsistency(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[]
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const balances = computeAccountBalances(accounts, ledger, trades);

  const securitiesAccounts = accounts.filter((a) => a.type === "securities");
  securitiesAccounts.forEach((account) => {
    const accountTrades = trades.filter(
      (t) => t.accountId === account.id && isUSDStock(t.ticker)
    );
    const tradeUsdNet = accountTrades.reduce(
      (sum, t) => sum + (t.side === "sell" ? t.totalAmount : -t.totalAmount),
      0
    );
    const balanceRow = balances.find((b) => b.account.id === account.id);
    const reportedUsd =
      (account.usdBalance ?? 0) + (balanceRow?.usdTransferNet ?? 0);

    if (accountTrades.length > 0 && Math.abs(tradeUsdNet) >= 0.01) {
      const diff = Math.abs(reportedUsd - tradeUsdNet);
      if (diff >= 1) {
        issues.push({
          type: "usd_securities_mismatch",
          severity: "warning",
          message: `증권 계좌 ${account.name}: USD 거래 순합계(${tradeUsdNet.toFixed(2)})와 usdBalance+usdTransferNet(${reportedUsd.toFixed(2)})이 다릅니다. USD 잔액을 수동 반영했는지 확인하세요.`,
          data: { accountId: account.id, tradeUsdNet, reportedUsd }
        });
      }
    }
  });

  return issues;
}

/**
 * 카테고리 일관성 검증: 원장 항목의 category/subCategory가 CategoryPresets에 있는지 검사
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
  const systemExpenseCategories = new Set(["신용결제"]);
  const incomeWrapperCategories = new Set(["수입"]);
  const transferWrapperCategories = new Set(["이체"]);
  const unclassifiedSubCategories = new Set(["(미분류)", "미분류", "-"]);

  const normalizeKey = (value: string) => value.replace(/\s+/g, "").trim();
  const hasCategory = (set: Set<string>, normalizedSet: Set<string>, value: string) =>
    set.has(value) || normalizedSet.has(normalizeKey(value));

  const normalizedIncomeSet = new Set(Array.from(incomeSet).map(normalizeKey));
  const normalizedExpenseSet = new Set(Array.from(expenseSet).map(normalizeKey));
  const normalizedTransferSet = new Set(Array.from(transferSet).map(normalizeKey));
  const normalizedSavingsSet = new Set(Array.from(savingsCategories).map(normalizeKey));
  const expenseDetailsByMain = new Map<
    string,
    { subs: Set<string>; normalizedSubs: Set<string> }
  >();
  expenseDetails.forEach((group) => {
    const subs = new Set(group.subs ?? []);
    expenseDetailsByMain.set(normalizeKey(group.main), {
      subs,
      normalizedSubs: new Set(Array.from(subs).map(normalizeKey))
    });
  });

  ledger.forEach((entry) => {
    const main = (entry.category ?? "").trim();
    const sub = (entry.subCategory ?? "").trim();

    if (entry.kind === "income") {
      const usesWrapperMain = !main || incomeWrapperCategories.has(main);
      const candidate = usesWrapperMain ? sub : main;
      if (!candidate || !hasCategory(incomeSet, normalizedIncomeSet, candidate)) {
        issues.push({
          type: "category_mismatch",
          severity: "warning",
          message: `가계부 항목 ${entry.id}: 수입 항목 "${candidate || main || sub || "(빈값)"}"이(가) 수입 프리셋에 없습니다`,
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
      const usesWrapperMain = !main || transferWrapperCategories.has(main);
      const candidate = usesWrapperMain ? sub : main;
      if (!candidate || !hasCategory(transferSet, normalizedTransferSet, candidate)) {
        issues.push({
          type: "category_mismatch",
          severity: "warning",
          message: `가계부 항목 ${entry.id}: 이체 항목 "${candidate || main || sub || "(빈값)"}"이(가) 이체 프리셋에 없습니다`,
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
      const isKnownExpenseMain =
        !!main &&
        (hasCategory(expenseSet, normalizedExpenseSet, main) ||
          hasCategory(savingsCategories, normalizedSavingsSet, main) ||
          systemExpenseCategories.has(main));

      if (main && !isKnownExpenseMain) {
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

      if (
        !main ||
        systemExpenseCategories.has(main) ||
        hasCategory(savingsCategories, normalizedSavingsSet, main)
      ) {
        return;
      }

      if (
        !sub ||
        unclassifiedSubCategories.has(sub) ||
        normalizeKey(main) === normalizeKey(sub)
      ) {
        return;
      }

      const detailGroup = expenseDetailsByMain.get(normalizeKey(main));
      if (detailGroup && !hasCategory(detailGroup.subs, detailGroup.normalizedSubs, sub)) {
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
            expectedSubs: Array.from(detailGroup.subs)
          } as CategoryMismatch
        });
      }
    }
  });

  return issues;
}
/**
 * 무결성 검사 전체 실행 진입점
 */
export function runIntegrityCheck(
  accounts: Account[],
  ledger: LedgerEntry[],
  trades: StockTrade[],
  categoryPresets?: CategoryPresets
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];

  // 중복 거래 탐지
  const duplicates = detectDuplicateTrades(ledger, trades);
  duplicates.forEach((dup) => {
    issues.push({
      type: "duplicate",
      severity: dup.entries.length > 2 ? "error" : "warning",
      message: `${dup.type === "ledger" ? "가계부" : "주식"} 중복 거래 ${dup.entries.length}건 발견`,
      data: dup
    });
  });

  // 계좌 잔액 검증 생략

  const missingRefs = checkMissingReferences(accounts, ledger, trades);
  missingRefs.forEach((ref) => {
    issues.push({
      type: "missing_reference",
      severity: "error",
      message: `존재하지 않는 ${ref.type === "account" ? "계좌" : "티커"} 참조: ${ref.id}`,
      data: ref
    });
  });

  const dateIssues = validateDateOrder(ledger, trades);
  issues.push(...dateIssues);

  const amountIssues = validateAmountConsistency(ledger, trades);
  issues.push(...amountIssues);

  const transferPairIssues = validateTransferPairConsistency(ledger, accounts);
  issues.push(...transferPairIssues);

  const transferRefIssues = validateTransferRequiredFields(ledger);
  issues.push(...transferRefIssues);

  const usdSecuritiesIssues = validateUsdSecuritiesConsistency(
    accounts,
    ledger,
    trades
  );
  issues.push(...usdSecuritiesIssues);

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
      // 첫 번째 항목만 남기고 제거
      for (let i = 1; i < dup.entries.length; i++) {
        if (dup.type === "ledger") {
          ledgerToRemove.add((dup.entries[i] as LedgerEntry).id);
        } else {
          tradesToRemove.add((dup.entries[i] as StockTrade).id);
        }
      }
    } else {
      // 마지막 항목만 남기고 제거
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








