import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  computeAccountBalances,
  computeBalanceSheet,
  computeCardDebts,
  computePositions,
  computeTotalNetWorth,
  positionMarketValueKRW,
} from "../calculations";
import { buildAdjustedPrices } from "../utils/accountTimeline";
import type { Account, AppData, LedgerEntry, Loan } from "../types";

const acc = (over: Partial<Account> & { id: string; type: Account["type"] }): Account => ({
  name: over.id,
  institution: "",
  ...over,
} as Account);

const entry = (over: Partial<LedgerEntry> & { id: string; kind: LedgerEntry["kind"]; amount: number }): LedgerEntry =>
  ({ date: "2026-09-01", category: "지출", subCategory: "식비", description: "", ...over } as LedgerEntry);

describe("computeBalanceSheet — 총자산·총부채·순자산 단일 소스", () => {
  const accounts: Account[] = [
    acc({ id: "농협", type: "checking" }),
    acc({ id: "마통", type: "checking" }),
    acc({ id: "적금", type: "savings" }),
    acc({ id: "카드", type: "card", debt: 100_000 }),
    acc({ id: "선납카드", type: "card", debt: 0 }),
    acc({ id: "증권", type: "securities" }),
    acc({ id: "연금", type: "securities", isPension: true }),
  ];
  const ledger: LedgerEntry[] = [
    entry({ id: "1", kind: "income", amount: 1_000_000, toAccountId: "농협", category: "수입" }),
    entry({ id: "2", kind: "expense", amount: 300_000, fromAccountId: "마통" }), // 잔액 −30만 → 마이너스 통장
    entry({ id: "3", kind: "income", amount: 500_000, toAccountId: "적금", category: "수입" }),
    entry({ id: "4", kind: "expense", amount: 50_000, fromAccountId: "카드" }), // 카드 부채 10만 + 5만 = 15만
    entry({ id: "5", kind: "transfer", amount: 30_000, fromAccountId: "농협", toAccountId: "선납카드", category: "이체", subCategory: "카드결제이체" }), // 선납 3만
    entry({ id: "6", kind: "income", amount: 200_000, toAccountId: "연금", category: "수입" }),
  ];
  const balances = computeAccountBalances(accounts, ledger, []);
  const bs = computeBalanceSheet(balances, [], null, [], ledger);

  it("자산 묶음: 현금(양수 입출금)·저축·증권·연금, 카드 선납은 자산", () => {
    expect(bs.cash).toBe(970_000);
    expect(bs.savings).toBe(500_000);
    expect(bs.securities).toBe(0);
    expect(bs.pension).toBe(200_000);
    expect(bs.cardCredit).toBe(30_000);
    expect(bs.totalAssets).toBe(970_000 + 500_000 + 200_000 + 30_000);
  });

  it("부채 묶음: 마이너스 통장은 부채(현금 아님)·카드 부채는 라이브·대출", () => {
    expect(bs.overdraft).toBe(300_000);
    expect(bs.cardDebt).toBe(150_000);
    expect(bs.loanDebt).toBe(0);
    expect(bs.totalLiabilities).toBe(450_000);
  });

  it("순자산 = 총자산 − 총부채, 유동자산 = 총자산 − 연금", () => {
    expect(bs.netWorth).toBe(bs.totalAssets - bs.totalLiabilities);
    expect(bs.liquidAssets).toBe(bs.totalAssets - 200_000);
  });

  it("대출 잔금은 원금 상환만 차감", () => {
    const loans: Loan[] = [{ id: "L", institution: "", loanName: "학자금", loanAmount: 1_000_000, annualInterestRate: 2, repaymentMethod: "equal_payment", loanDate: "2026-01-01", maturityDate: "2030-01-01" }];
    const withLoan = computeBalanceSheet(balances, [], null, loans, [
      ...ledger,
      entry({ id: "7", kind: "expense", amount: 100_000, fromAccountId: "농협", category: "지출", subCategory: "대출상환", detailCategory: "원금상환", description: "학자금 상환" }),
      entry({ id: "8", kind: "expense", amount: 5_000, fromAccountId: "농협", category: "지출", subCategory: "대출상환", detailCategory: "이자상환", description: "학자금 상환" }),
    ]);
    expect(withLoan.loanDebt).toBe(900_000);
  });

  it("computeCardDebts — 카드별 지금 갚을 돈 (양수=부채, 음수=선납)", () => {
    const m = computeCardDebts(balances);
    expect(m.get("카드")).toBe(150_000);
    expect(m.get("선납카드")).toBe(-30_000);
    expect(m.has("농협")).toBe(false);
  });
});

describe("computeBalanceSheet — 실데이터 정합 (backups/ 최신 파일 · 앱이 4일 보존으로 옛 백업을 지우므로 항등식만 고정)", () => {
  const dir = "D:/05farmwallet/backups";
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).flatMap((d) => {
        const sub = path.join(dir, d);
        return fs.statSync(sub).isDirectory() ? fs.readdirSync(sub).filter((f) => f.startsWith("backup-") && f.endsWith(".json")).map((f) => path.join(sub, f)) : [];
      }).sort()
    : [];
  const latest = files[files.length - 1];
  it.skipIf(!latest)("총자산 − 총부채 = 순자산 = computeTotalNetWorth · 묶음 합이 계좌별 순가치 합과 일치 · 자산에 음수 없음", () => {
    const data = JSON.parse(fs.readFileSync(latest, "utf-8")) as AppData;
    const fx = 1372;
    const balances = computeAccountBalances(data.accounts, data.ledger, data.trades);
    const positions = computePositions(data.trades, buildAdjustedPrices(data.prices ?? [], fx), data.accounts, { fxRate: fx, priceFallback: "cost" });
    const bs = computeBalanceSheet(balances, positions, fx, data.loans ?? [], data.ledger);
    expect(Math.round(bs.totalAssets - bs.totalLiabilities)).toBe(Math.round(bs.netWorth));
    expect(Math.round(computeTotalNetWorth(balances, positions, fx, data.loans ?? [], data.ledger))).toBe(Math.round(bs.netWorth));
    for (const v of [bs.cash, bs.savings, bs.securities, bs.pension, bs.cardCredit, bs.overdraft, bs.cardDebt, bs.loanDebt]) expect(v).toBeGreaterThanOrEqual(0);
    // 카드: 대차의 (부채 − 선납) = computeCardDebts 합
    const cards = computeCardDebts(balances);
    expect(Math.round(bs.cardDebt - bs.cardCredit)).toBe(Math.round([...cards.values()].reduce((s, v) => s + v, 0)));
    // 계좌별 순가치(현금 + USD 환산 + 평가액 − account.debt) 합 = 총자산 − (총부채 − 대출)
    const stock = new Map<string, number>();
    positions.forEach((p) => stock.set(p.accountId, (stock.get(p.accountId) ?? 0) + positionMarketValueKRW(p, fx)));
    const netByAccount = balances.reduce((s, r) => {
      const a = r.account;
      const usd = a.type === "securities" || a.type === "crypto" ? (a.usdBalance ?? 0) + (r.usdTransferNet ?? 0) : 0;
      return s + r.currentBalance + usd * fx + (stock.get(a.id) ?? 0) - Math.abs(a.debt ?? 0);
    }, 0);
    expect(Math.round(netByAccount)).toBe(Math.round(bs.totalAssets - (bs.totalLiabilities - bs.loanDebt)));
    expect(bs.loanDebt).toBeGreaterThan(0);
  });
});
