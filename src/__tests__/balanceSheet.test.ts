import { describe, it, expect } from "vitest";
import {
  accountDebtOffset,
  computeAccountBalances,
  computeBalanceSheet,
  computeCardDebts,
  computePositions,
  computeTotalNetWorth,
  positionMarketValueKRW,
} from "../calculations";
import { buildAdjustedPrices } from "../utils/accountTimeline";
import type { Account, LedgerEntry, Loan, StockPrice, StockTrade } from "../types";

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

  it("카드 '현재 부채 직접 설정'이 남긴 음수 account.debt — 부호 그대로 반영해 목표값에 안착", () => {
    // 장부 사용 50만(잔액 −50만) 카드를 명세서 부채 30만으로 맞추면 AdjustmentModal이
    // debt = 30만 − 50만 + 0 = −20만을 저장한다. Math.abs로 부호를 버리면 70만이 됐다.
    const cards: Account[] = [acc({ id: "보정카드", type: "card", debt: -200_000 })];
    const cardLedger = [entry({ id: "c1", kind: "expense", amount: 500_000, fromAccountId: "보정카드" })];
    const cardBalances = computeAccountBalances(cards, cardLedger, []);
    expect(computeCardDebts(cardBalances).get("보정카드")).toBe(300_000);
    const sheet = computeBalanceSheet(cardBalances, [], null, [], cardLedger);
    expect(sheet.cardDebt).toBe(300_000);
    expect(sheet.netWorth).toBe(-300_000);
  });

  it("카드 외 계좌의 account.debt는 크기만 — 레거시 음수 저장분도 부채로 뺀다", () => {
    const legacy: Account[] = [acc({ id: "증권신용", type: "securities", debt: -100_000 })];
    const legacyLedger = [entry({ id: "s1", kind: "income", amount: 400_000, toAccountId: "증권신용", category: "수입" })];
    const sheet = computeBalanceSheet(computeAccountBalances(legacy, legacyLedger, []), [], null, [], legacyLedger);
    expect(sheet.securities).toBe(300_000);
  });
});

describe("computeBalanceSheet — 항등식 (USD·평가액·음수 debt 섞인 합성 데이터)", () => {
  const fx = 1372;
  const accounts: Account[] = [
    acc({ id: "농협", type: "checking" }),
    acc({ id: "마통", type: "checking" }),
    acc({ id: "적금", type: "savings" }),
    acc({ id: "카드", type: "card", debt: 100_000 }),
    acc({ id: "보정카드", type: "card", debt: -200_000 }),
    acc({ id: "증권", type: "securities", usdBalance: 100, debt: 50_000 }),
    acc({ id: "연금", type: "securities", isPension: true }),
    acc({ id: "코인", type: "crypto" }),
  ];
  const ledger: LedgerEntry[] = [
    entry({ id: "1", kind: "income", amount: 3_000_000, toAccountId: "농협", category: "수입" }),
    entry({ id: "2", kind: "expense", amount: 300_000, fromAccountId: "마통" }),
    entry({ id: "3", kind: "income", amount: 500_000, toAccountId: "적금", category: "수입" }),
    entry({ id: "4", kind: "expense", amount: 50_000, fromAccountId: "카드" }),
    entry({ id: "5", kind: "expense", amount: 500_000, fromAccountId: "보정카드" }),
    entry({ id: "6", kind: "transfer", amount: 2_000_000, fromAccountId: "농협", toAccountId: "증권", category: "이체", subCategory: "투자이체" }),
    entry({ id: "7", kind: "transfer", amount: 300_000, fromAccountId: "농협", toAccountId: "연금", category: "이체", subCategory: "투자이체" }),
    entry({ id: "8", kind: "transfer", amount: 400_000, fromAccountId: "농협", toAccountId: "코인", category: "이체", subCategory: "투자이체" }),
  ];
  const trades: StockTrade[] = [
    { id: "T1", date: "2026-09-02", accountId: "증권", ticker: "AAPL", name: "Apple", side: "buy", quantity: 2, price: 200, fee: 0, totalAmount: 400, cashImpact: 0, fxRateAtTrade: 1300 },
    { id: "T2", date: "2026-09-02", accountId: "증권", ticker: "379800", name: "KODEX 미국S&P500", side: "buy", quantity: 10, price: 20_000, fee: 0, totalAmount: 200_000, cashImpact: -200_000 },
    { id: "T3", date: "2026-09-03", accountId: "연금", ticker: "379810", name: "KODEX 미국나스닥100", side: "buy", quantity: 5, price: 30_000, fee: 0, totalAmount: 150_000, cashImpact: -150_000 },
    { id: "T4", date: "2026-09-03", accountId: "코인", ticker: "solana", name: "solana", side: "buy", quantity: 2, price: 150_000, fee: 0, totalAmount: 300_000, cashImpact: -300_000 },
  ] as StockTrade[];
  const prices: StockPrice[] = [
    { ticker: "AAPL", name: "Apple", price: 250, currency: "USD", updatedAt: "2026-10-01T00:00:00.000Z" },
    { ticker: "379800", name: "KODEX 미국S&P500", price: 23_000, currency: "KRW", updatedAt: "2026-10-01T00:00:00.000Z" },
    { ticker: "solana", name: "solana", price: 160_000, currency: "KRW", updatedAt: "2026-10-01T00:00:00.000Z" },
  ] as StockPrice[];
  const loans: Loan[] = [{ id: "L", institution: "", loanName: "학자금", loanAmount: 1_000_000, annualInterestRate: 2, repaymentMethod: "equal_payment", loanDate: "2026-01-01", maturityDate: "2030-01-01" }];

  const balances = computeAccountBalances(accounts, ledger, trades);
  // 앱과 같은 경로: USD 시세를 원화로 바꾼 adjustedPrices + 시세 없는 종목은 원가 대체(379810)
  const positions = computePositions(trades, buildAdjustedPrices(prices, fx), accounts, { fxRate: fx, priceFallback: "cost" });
  const bs = computeBalanceSheet(balances, positions, fx, loans, ledger);

  it("총자산 − 총부채 = 순자산 = computeTotalNetWorth, 묶음에 음수 없음", () => {
    expect(Math.round(bs.totalAssets - bs.totalLiabilities)).toBe(Math.round(bs.netWorth));
    expect(Math.round(computeTotalNetWorth(balances, positions, fx, loans, ledger))).toBe(Math.round(bs.netWorth));
    for (const v of [bs.cash, bs.savings, bs.securities, bs.pension, bs.cardCredit, bs.overdraft, bs.cardDebt, bs.loanDebt]) expect(v).toBeGreaterThanOrEqual(0);
    expect(bs.loanDebt).toBe(1_000_000);
  });

  it("카드: 대차의 (부채 − 선납) = computeCardDebts 합", () => {
    const cards = computeCardDebts(balances);
    expect(cards.get("카드")).toBe(150_000);
    expect(cards.get("보정카드")).toBe(300_000);
    expect(Math.round(bs.cardDebt - bs.cardCredit)).toBe(Math.round([...cards.values()].reduce((s, v) => s + v, 0)));
  });

  it("계좌별 순가치(현금 + USD 환산 + 평가액 − debt) 합 = 총자산 − (총부채 − 대출)", () => {
    const stock = new Map<string, number>();
    positions.forEach((p) => stock.set(p.accountId, (stock.get(p.accountId) ?? 0) + positionMarketValueKRW(p, fx)));
    const netByAccount = balances.reduce((s, r) => {
      const a = r.account;
      const usd = a.type === "securities" || a.type === "crypto" ? (a.usdBalance ?? 0) + (r.usdTransferNet ?? 0) : 0;
      return s + r.currentBalance + usd * fx + (stock.get(a.id) ?? 0) - accountDebtOffset(a);
    }, 0);
    expect(Math.round(netByAccount)).toBe(Math.round(bs.totalAssets - (bs.totalLiabilities - bs.loanDebt)));
  });

  it("증권: 예수금 + USD 예수금 환산 + 평가액(AAPL 2×250×fx, 379800 10×23,000) − debt", () => {
    const expected = (2_000_000 - 200_000) + 100 * fx + 2 * 250 * fx + 10 * 23_000 - 50_000 + (400_000 - 300_000) + 2 * 160_000;
    expect(Math.round(bs.securities)).toBe(Math.round(expected));
    expect(bs.pension).toBe(300_000); // 예수금 15만 + 나스닥100 원가 대체 15만
  });
});
