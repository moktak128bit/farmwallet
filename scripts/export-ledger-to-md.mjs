#!/usr/bin/env node
/**
 * data/app-data.json → 정리.md
 * 수입 / 지출 / 저축성 지출 / 이체 구분 (LedgerView·categoryUtils와 동일 로직)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataPath = path.join(root, "data", "app-data.json");
const outPath = path.join(root, "정리.md");

function isSavingsExpenseEntry(entry, accounts) {
  if (entry.category === "이체") return false;
  if (entry.kind === "transfer" && entry.toAccountId) {
    const to = accounts.find((a) => a.id === entry.toAccountId);
    if (to && (to.type === "securities" || to.type === "savings")) return true;
  }
  if (entry.kind === "expense" && entry.category === "저축성지출") return true;
  return false;
}

function formatAmount(amount) {
  return new Intl.NumberFormat("ko-KR").format(amount) + "원";
}

function accountName(accounts, id) {
  if (!id) return "-";
  const a = accounts.find((x) => x.id === id);
  return a?.name ?? id;
}

function generateReport(ledger, accounts) {
  const income = [];
  const expense = [];
  const savingsExpense = [];
  const transfer = [];

  for (const e of ledger) {
    if (e.kind === "income") income.push(e);
    else if (isSavingsExpenseEntry(e, accounts)) savingsExpense.push(e);
    else if (e.kind === "transfer") transfer.push(e);
    else if (e.kind === "expense") expense.push(e);
  }

  const sorted = [...ledger].sort((a, b) => a.date.localeCompare(b.date));

  let md = `# 가계부 정리\n\n`;
  md += `생성일: ${new Date().toLocaleString("ko-KR")}\n\n`;
  md += `총 ${ledger.length}건 (수입 ${income.length} / 지출 ${expense.length} / 저축성 지출 ${savingsExpense.length} / 이체 ${transfer.length})\n\n`;

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

  const monthMap = new Map();
  for (const e of sorted) {
    const m = e.date.slice(0, 7);
    if (!monthMap.has(m))
      monthMap.set(m, { income: 0, expense: 0, savings: 0, transfer: 0 });
    const row = monthMap.get(m);
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

  const categoryMap = new Map();
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

  function row(e, kindLabel) {
    const fix = e.isFixedExpense ? " (고정)" : "";
    const cat = e.category || "-";
    const sub = e.subCategory || "-";
    const desc = e.description || "-";
    let acc;
    if (e.kind === "income") acc = accountName(accounts, e.toAccountId);
    else if (
      e.kind === "transfer" &&
      e.fromAccountId &&
      e.toAccountId
    )
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

try {
  const raw = fs.readFileSync(dataPath, "utf-8");
  const data = JSON.parse(raw);
  const ledger = data.ledger ?? [];
  const accounts = data.accounts ?? [];

  const md = generateReport(ledger, accounts);
  fs.writeFileSync(outPath, md, "utf-8");

  let ni = 0, ne = 0, ns = 0, nt = 0;
  for (const e of ledger) {
    if (e.kind === "income") ni++;
    else if (isSavingsExpenseEntry(e, accounts)) ns++;
    else if (e.kind === "transfer") nt++;
    else if (e.kind === "expense") ne++;
  }
  console.log(`정리.md 생성 완료: ${outPath}`);
  console.log(`수입 ${ni} / 지출 ${ne} / 저축성 지출 ${ns} / 이체 ${nt}`);
} catch (err) {
  console.error(err);
  process.exit(1);
}
