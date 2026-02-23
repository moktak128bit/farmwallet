/**
 * 가계부 정리 마크다운 리포트 생성
 * 수입 / 지출 / 저축성 지출 / 이체 구분
 */

import type { Account, LedgerEntry } from "../types";
import { isSavingsExpenseEntry } from "./categoryUtils";

function formatAmount(amount: number): string {
  return new Intl.NumberFormat("ko-KR").format(amount) + "원";
}

function accountName(accounts: Account[], id: string | undefined): string {
  if (!id) return "-";
  const a = accounts.find((x) => x.id === id);
  return a?.name ?? id;
}

export function generateLedgerMarkdownReport(
  ledger: LedgerEntry[],
  accounts: Account[]
): string {
  const income: LedgerEntry[] = [];
  const expense: LedgerEntry[] = [];
  const savingsExpense: LedgerEntry[] = [];
  const transfer: LedgerEntry[] = [];

  for (const e of ledger) {
    if (e.kind === "income") {
      income.push(e);
    } else if (isSavingsExpenseEntry(e, accounts)) {
      savingsExpense.push(e);
    } else if (e.kind === "transfer") {
      transfer.push(e);
    } else if (e.kind === "expense") {
      expense.push(e);
    }
  }

  const sorted = [...ledger].sort((a, b) => a.date.localeCompare(b.date));

  let md = `# 가계부 정리\n\n`;
  md += `> 이 문서는 Farm Wallet 앱의 **설정 > 백업/복원 > 정리.md 내보내기**로 생성되었습니다.\n\n`;
  md += `생성일: ${new Date().toLocaleString("ko-KR")}\n\n`;
  md += `총 ${ledger.length}건 (수입 ${income.length} / 지출 ${expense.length} / 저축성 지출 ${savingsExpense.length} / 이체 ${transfer.length})\n\n`;
  md += `> 아래 통계는 원장(수입·지출·이체) 합계만 포함합니다. 앱에서 보이는 계좌 잔액·총액과 다를 수 있습니다.\n\n`;

  const totalIncome = income.reduce((s, e) => s + e.amount, 0);
  const totalExpense = expense.reduce((s, e) => s + e.amount, 0);
  const totalSavings = savingsExpense.reduce((s, e) => s + e.amount, 0);
  const totalTransfer = transfer.reduce((s, e) => s + e.amount, 0);
  const net = totalIncome - totalExpense - totalSavings;

  md += `## 통계\n\n`;
  md += `| 항목 | 금액 |\n`;
  md += `|------|------|\n`;
  md += `| 총 수입 | ${formatAmount(totalIncome)} |\n`;
  md += `| 총 지출 | ${formatAmount(totalExpense)} |\n`;
  md += `| 저축성 지출 | ${formatAmount(totalSavings)} |\n`;
  md += `| 이체 | ${formatAmount(totalTransfer)} |\n`;
  md += `| 순수입 (수입 - 지출 - 저축) | ${formatAmount(net)} |\n\n`;

  // 계좌별 조정값 (초기잔액 + 현금조정 + 저축 등, 원장에 없는 부분)
  md += `## 계좌별 조정값\n\n`;
  md += `| 계좌 | 조정값 |\n`;
  md += `|------|------|\n`;
  for (const a of accounts) {
    const baseBalance = a.type === "securities"
      ? (a.initialCashBalance ?? a.initialBalance)
      : a.initialBalance;
    const cashAdjustment = a.cashAdjustment ?? 0;
    const savings = a.savings ?? 0;
    const adjustment = baseBalance + cashAdjustment + savings;
    md += `| ${a.name} | ${formatAmount(adjustment)} |\n`;
  }
  md += `\n`;

  const monthMap = new Map<
    string,
    { income: number; expense: number; savings: number; transfer: number }
  >();
  for (const e of sorted) {
    const m = e.date.slice(0, 7);
    if (!monthMap.has(m)) {
      monthMap.set(m, { income: 0, expense: 0, savings: 0, transfer: 0 });
    }
    const row = monthMap.get(m)!;
    if (e.kind === "income") row.income += e.amount;
    else if (isSavingsExpenseEntry(e, accounts)) row.savings += e.amount;
    else if (e.kind === "transfer") row.transfer += e.amount;
    else row.expense += e.amount;
  }

  const months = Array.from(monthMap.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  md += `### 월별 통계\n\n`;
  md += `| 월 | 수입 | 지출 | 저축성 지출 | 이체 | 순수입 |\n`;
  md += `|------|------|------|-------------|------|--------|\n`;
  for (const [month, d] of months) {
    const netMonth = d.income - d.expense - d.savings;
    md += `| ${month} | ${formatAmount(d.income)} | ${formatAmount(d.expense)} | ${formatAmount(d.savings)} | ${formatAmount(d.transfer)} | ${formatAmount(netMonth)} |\n`;
  }
  md += `\n`;

  const categoryMap = new Map<string, number>();
  for (const e of expense) {
    const key = e.subCategory ? `${e.category} > ${e.subCategory}` : e.category;
    categoryMap.set(key, (categoryMap.get(key) ?? 0) + e.amount);
  }
  const categoryRows = Array.from(categoryMap.entries()).sort(
    (a, b) => b[1] - a[1]
  );

  md += `## 지출 카테고리별 (저축성 지출 제외)\n\n`;
  md += `| 카테고리 | 금액 |\n`;
  md += `|----------|------|\n`;
  for (const [cat, amt] of categoryRows) {
    md += `| ${cat} | ${formatAmount(amt)} |\n`;
  }
  md += `\n`;

  const tableHeader =
    "| 날짜 | 종류 | 카테고리 | 세부분류 | 설명 | 금액 | 계좌 | 비고 |\n";
  const tableSep =
    "|------|------|----------|----------|------|------|------|------|\n";

  function row(e: LedgerEntry, kindLabel: string): string {
    const fix = e.isFixedExpense ? " (고정)" : "";
    const cat = e.category || "-";
    const sub = e.subCategory || "-";
    const desc = e.description || "-";
    let acc: string;
    if (e.kind === "income") acc = accountName(accounts, e.toAccountId);
    else if (e.kind === "transfer" && e.fromAccountId && e.toAccountId)
      acc = `${accountName(accounts, e.fromAccountId)} → ${accountName(accounts, e.toAccountId)}`;
    else acc = accountName(accounts, e.fromAccountId ?? e.toAccountId);
    const note = e.note || "-";
    return `| ${e.date} | ${kindLabel}${fix} | ${cat} | ${sub} | ${desc} | ${formatAmount(e.amount)} | ${acc} | ${note} |\n`;
  }

  md += `## 수입 내역\n\n`;
  md += tableHeader + tableSep;
  income
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((e) => (md += row(e, "수입")));
  md += `\n**${income.length}건, 합계 ${formatAmount(totalIncome)}**\n\n`;

  md += `## 지출 내역\n\n`;
  md += tableHeader + tableSep;
  expense
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((e) => (md += row(e, "지출")));
  md += `\n**${expense.length}건, 합계 ${formatAmount(totalExpense)}**\n\n`;

  md += `## 저축성 지출 내역\n\n`;
  md += tableHeader + tableSep;
  savingsExpense
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((e) => (md += row(e, "저축성 지출")));
  md += `\n**${savingsExpense.length}건, 합계 ${formatAmount(totalSavings)}**\n\n`;

  md += `## 이체 내역\n\n`;
  md += tableHeader + tableSep;
  transfer
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((e) => (md += row(e, "이체")));
  md += `\n**${transfer.length}건, 합계 ${formatAmount(totalTransfer)}**\n\n`;

  return md;
}
