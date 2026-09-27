import { describe, it, expect } from "vitest";
import fs from "node:fs";
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

describe("computeBalanceSheet — 실데이터 정합 (잔액 엔진 기준 · 카테고리 없는 카드 결제도 결제로 인식)", () => {
  const path = "D:/05farmwallet/backups/2026-09-21/backup-2026-09-21T16-39-49-003KST.json";
  const has = fs.existsSync(path);
  it.skipIf(!has)("순자산 27,873,266원 · 총자산 − 총부채 항등 · 묶음 합이 계좌 표와 일치", () => {
    const data = JSON.parse(fs.readFileSync(path, "utf-8")) as AppData;
    const fx = 1372;
    const balances = computeAccountBalances(data.accounts, data.ledger, data.trades);
    const positions = computePositions(data.trades, buildAdjustedPrices(data.prices ?? [], fx), data.accounts, { fxRate: fx, priceFallback: "cost" });
    const bs = computeBalanceSheet(balances, positions, fx, data.loans ?? [], data.ledger);
    expect(Math.round(bs.netWorth)).toBe(27_873_266);
    expect(Math.round(bs.loanDebt)).toBe(37_769_380);
    // 카드: 잔액 엔진 기준. 2025-07-25 농협→삼성페이카드 620,466원 '지출'(카테고리 없음)도 결제로 잡혀 삼성은 선납 상태
    const cards = computeCardDebts(balances);
    expect(Math.round(bs.cardDebt - bs.cardCredit)).toBe(Math.round([...cards.values()].reduce((s, v) => s + v, 0)));
    expect(Math.round(cards.get("삼성페이카드") ?? 0)).toBe(-226_573);
    // 마이너스 통장(청년사다리 −2,706,808 · 데이트저축 −806 · 카카오페이 −2,763)은 현금이 아니라 부채
    expect(Math.round(bs.overdraft)).toBe(2_710_377);
    expect(Math.round(bs.cash)).toBe(17_484_390);
    expect(Math.round(bs.savings)).toBe(13_221_215);
    expect(Math.round(bs.totalAssets - bs.totalLiabilities)).toBe(Math.round(bs.netWorth));
    // 증권+연금 = 계좌 탭 '주식' 합 (포지션 평가 + 예수금 + USD)
    const stockSum = positions.reduce((s, p) => s + positionMarketValueKRW(p, fx), 0);
    expect(stockSum).toBeGreaterThan(0);
    expect(Math.round(bs.securities + bs.pension)).toBe(39_634_949);
    // 대시보드가 쓰는 순자산 함수와 항등
    expect(Math.round(computeTotalNetWorth(balances, positions, fx, data.loans ?? [], data.ledger))).toBe(27_873_266);
  });
});
