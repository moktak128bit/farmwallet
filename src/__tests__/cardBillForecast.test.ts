import { describe, it, expect } from "vitest";
import type { Account, LedgerEntry } from "../types";
import { computeCardBillForecast } from "../utils/cardBillForecast";

function card(over: Partial<Account> = {}): Account {
  return {
    id: "CARD1",
    name: "신용카드",
    institution: "현대카드",
    type: "card",
    initialBalance: 0,
    ...over
  };
}

function expenseEntry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "L1",
    date: "2026-01-01",
    kind: "expense",
    category: "지출",
    subCategory: "식비",
    description: "테스트",
    amount: 10_000,
    fromAccountId: "CARD1",
    ...over
  };
}

function paymentEntry(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "P1",
    date: "2026-01-25",
    kind: "transfer",
    category: "이체",
    subCategory: "카드결제이체",
    description: "카드 결제",
    amount: 10_000,
    fromAccountId: "CHK1",
    toAccountId: "CARD1",
    ...over
  };
}

describe("computeCardBillForecast", () => {
  it("결제일/청구시작일 미설정 카드는 결과에서 제외된다", () => {
    const accounts = [card({ billingCycleStart: undefined, paymentDay: undefined })];
    const result = computeCardBillForecast(accounts, [], "2026-01-15");
    expect(result).toEqual([]);
  });

  it("card가 아닌 계좌는 무시된다", () => {
    const accounts: Account[] = [
      { id: "A1", name: "통장", institution: "국민", type: "checking", initialBalance: 0, billingCycleStart: 13, paymentDay: 25 }
    ];
    const result = computeCardBillForecast(accounts, [], "2026-01-15");
    expect(result).toEqual([]);
  });

  it("기본 주기 경계 — 청구주기 [13, 다음달 12] 이후 25일 결제, 경계 포함/제외가 정확", () => {
    const accounts = [card({ billingCycleStart: 13, paymentDay: 25 })];
    const ledger: LedgerEntry[] = [
      expenseEntry({ id: "E_before", date: "2026-01-12", amount: 5_000 }), // 이전 주기 — 제외
      expenseEntry({ id: "E_start", date: "2026-01-13", amount: 1_000 }), // 주기 시작일 — 포함
      expenseEntry({ id: "E_mid", date: "2026-01-20", amount: 2_000 }), // 포함
      expenseEntry({ id: "E_end", date: "2026-02-12", amount: 3_000 }), // 주기 종료일 — 포함
      expenseEntry({ id: "E_after", date: "2026-02-13", amount: 9_000 }) // 다음 주기 — 제외
    ];
    // today는 이전 주기(12/13~1/12, 결제 1/25)가 이미 지난 시점 — "다음 결제"가 1/13~2/12(결제 2/25) 주기가 되도록
    const result = computeCardBillForecast(accounts, ledger, "2026-01-26");
    expect(result).toHaveLength(1);
    const f = result[0];
    expect(f.cycleStart).toBe("2026-01-13");
    expect(f.cycleEnd).toBe("2026-02-12");
    expect(f.paymentDate).toBe("2026-02-25");
    expect(f.billedKRW).toBe(1_000 + 2_000 + 3_000);
    expect(f.remainingKRW).toBe(f.billedKRW);
  });

  it("월말 클램프 — billingCycleStart=31이면 2월은 28/29일에서 시작, paymentDay=31도 말일 클램프", () => {
    const accounts = [card({ billingCycleStart: 31, paymentDay: 31 })];
    // 2026년은 평년(2월 28일) — 오늘을 2월 20일로 두면 1/31~2/27 주기, 결제일 2/28
    const result = computeCardBillForecast(accounts, [], "2026-02-20");
    expect(result).toHaveLength(1);
    const f = result[0];
    expect(f.cycleStart).toBe("2026-01-31");
    expect(f.cycleEnd).toBe("2026-02-27"); // 다음 주기 시작(2/28, 말일클램프) - 1일
    expect(f.paymentDate).toBe("2026-02-28"); // 말일 클램프
  });

  it("USD 카드 지출은 fxRate로 원화 환산되어 billedKRW에 반영된다", () => {
    const accounts = [card({ billingCycleStart: 1, paymentDay: 10 })];
    const ledger: LedgerEntry[] = [
      expenseEntry({ id: "E_usd", date: "2026-01-05", amount: 100, currency: "USD" })
    ];
    // today=1/20 → 다가오는 결제는 1/1~1/31 주기(결제 2/10) — 1/5 지출이 그 안에 포함됨
    const result = computeCardBillForecast(accounts, ledger, "2026-01-20", { fxRate: 1_300 });
    expect(result[0].billedKRW).toBe(130_000);
  });

  it("fxRate 미로드 시 USD 금액은 액면 그대로 합산된다(대시보드 공통 정책)", () => {
    const accounts = [card({ billingCycleStart: 1, paymentDay: 10 })];
    const ledger: LedgerEntry[] = [
      expenseEntry({ id: "E_usd", date: "2026-01-05", amount: 100, currency: "USD" })
    ];
    const result = computeCardBillForecast(accounts, ledger, "2026-01-20");
    expect(result[0].billedKRW).toBe(100);
  });

  it("이미 납부(조기 결제) — 마감 후~결제일 사이 카드결제이체가 remainingKRW를 줄인다", () => {
    const accounts = [card({ billingCycleStart: 13, paymentDay: 25 })];
    const ledger: LedgerEntry[] = [
      expenseEntry({ id: "E1", date: "2026-01-20", amount: 100_000 }),
      paymentEntry({ id: "P_early", date: "2026-02-15", amount: 40_000 }) // 마감(2/12) 후, 결제일(2/25) 전 조기 결제
    ];
    // today=1/26 → 다가오는 결제는 1/13~2/12 주기(결제 2/25)
    const result = computeCardBillForecast(accounts, ledger, "2026-01-26");
    const f = result[0];
    expect(f.billedKRW).toBe(100_000);
    expect(f.alreadyPaidKRW).toBe(40_000);
    expect(f.remainingKRW).toBe(60_000);
  });

  it("전액 조기 결제 시 remainingKRW는 0으로 클램프된다(0 미만 방지)", () => {
    const accounts = [card({ billingCycleStart: 13, paymentDay: 25 })];
    const ledger: LedgerEntry[] = [
      expenseEntry({ id: "E1", date: "2026-01-20", amount: 100_000 }),
      paymentEntry({ id: "P_full", date: "2026-02-20", amount: 150_000 })
    ];
    const result = computeCardBillForecast(accounts, ledger, "2026-01-26");
    expect(result[0].remainingKRW).toBe(0);
  });

  it("주기 이전(마감 전)에 낸 카드결제이체는 이 주기의 alreadyPaidKRW에 포함되지 않는다", () => {
    const accounts = [card({ billingCycleStart: 13, paymentDay: 25 })];
    const ledger: LedgerEntry[] = [
      expenseEntry({ id: "E1", date: "2026-01-20", amount: 100_000 }),
      // 주기가 아직 마감되지 않은 시점(주기 내부)의 결제이체 — 이전 주기 결제로 간주, 포함되면 안 됨
      paymentEntry({ id: "P_mid_cycle", date: "2026-01-25", amount: 30_000 })
    ];
    const result = computeCardBillForecast(accounts, ledger, "2026-01-26");
    expect(result[0].alreadyPaidKRW).toBe(0);
  });

  it("신용결제(레거시 expense) 이중계상 방지 — classifyLedgerFlow가 제외하는 항목은 billedKRW에서 빠진다", () => {
    const accounts = [card({ billingCycleStart: 1, paymentDay: 10 })];
    const ledger: LedgerEntry[] = [
      expenseEntry({ id: "E_credit", date: "2026-01-05", amount: 50_000, category: "신용결제" })
    ];
    const result = computeCardBillForecast(accounts, ledger, "2026-01-20");
    expect(result[0].billedKRW).toBe(0);
  });

  it("다른 계좌(fromAccountId 불일치)의 지출은 집계되지 않는다", () => {
    const accounts = [card({ billingCycleStart: 1, paymentDay: 10 })];
    const ledger: LedgerEntry[] = [expenseEntry({ id: "E_other", date: "2026-01-05", fromAccountId: "OTHER" })];
    const result = computeCardBillForecast(accounts, ledger, "2026-01-20");
    expect(result[0].billedKRW).toBe(0);
  });

  it("두 카드 계좌 각각 독립적으로 계산된다", () => {
    const accounts = [
      card({ id: "CARD1", billingCycleStart: 1, paymentDay: 10 }),
      card({ id: "CARD2", billingCycleStart: 15, paymentDay: 27 })
    ];
    const ledger: LedgerEntry[] = [
      expenseEntry({ id: "E1", date: "2026-01-05", fromAccountId: "CARD1", amount: 10_000 }),
      // CARD2(bcs=15,pd=27)의 today=1/20 기준 다가오는 결제 주기는 12/15~1/14(결제 1/27) — 1/5가 그 안에 포함
      expenseEntry({ id: "E2", date: "2026-01-05", fromAccountId: "CARD2", amount: 20_000 })
    ];
    const result = computeCardBillForecast(accounts, ledger, "2026-01-20");
    expect(result).toHaveLength(2);
    expect(result.find((r) => r.accountId === "CARD1")?.billedKRW).toBe(10_000);
    expect(result.find((r) => r.accountId === "CARD2")?.billedKRW).toBe(20_000);
  });
});
