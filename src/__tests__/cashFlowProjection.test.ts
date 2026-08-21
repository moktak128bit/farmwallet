import { describe, it, expect } from "vitest";
import { buildCashFlowProjection } from "../utils/cashFlowProjection";
import type { Account, LedgerEntry, Loan, RecurringExpense } from "../types";

function acc(overrides: Partial<Account> & { id: string; type: Account["type"] }): Account {
  return {
    name: "테스트계좌",
    institution: "은행",
    initialBalance: 0,
    ...overrides,
  };
}

function le(overrides: Partial<LedgerEntry> & { id: string }): LedgerEntry {
  return {
    date: "2026-01-01",
    kind: "expense",
    category: "지출",
    description: "",
    amount: 0,
    ...overrides,
  };
}

function loan(overrides: Partial<Loan> & { id: string }): Loan {
  return {
    institution: "은행",
    loanName: "테스트대출",
    loanAmount: 1_200_000,
    annualInterestRate: 12,
    repaymentMethod: "equal_principal",
    loanDate: "2025-06-15",
    maturityDate: "2027-01-15",
    ...overrides,
  };
}

function recur(overrides: Partial<RecurringExpense> & { id: string }): RecurringExpense {
  return {
    title: "반복",
    amount: 100_000,
    category: "생활비",
    frequency: "monthly",
    startDate: "2025-01-10",
    ...overrides,
  };
}

const TODAY = "2026-08-01";

describe("buildCashFlowProjection — 시작 잔고", () => {
  it("입출금·저축·기타 계좌만 가용 현금으로 잡고 증권·코인·카드는 제외", () => {
    const accounts: Account[] = [
      acc({ id: "chk", type: "checking", initialBalance: 1_000_000 }),
      acc({ id: "sav", type: "savings", initialBalance: 2_000_000 }),
      acc({ id: "sec", type: "securities", initialBalance: 5_000_000 }),
      acc({ id: "crd", type: "card", initialBalance: 0 }),
    ];
    const proj = buildCashFlowProjection(TODAY, accounts, [], [], []);
    expect(proj.openingBalance).toBe(3_000_000);
  });
});

describe("buildCashFlowProjection — 반복지출/수입", () => {
  it("kind=income은 유입, 나머지는 유출로 들어간다", () => {
    const accounts: Account[] = [acc({ id: "chk", type: "checking", initialBalance: 0 })];
    const recurring: RecurringExpense[] = [
      recur({ id: "r1", title: "월세", amount: 500_000, frequency: "monthly", startDate: "2025-01-10" }),
      recur({ id: "r2", title: "월급", amount: 3_000_000, frequency: "monthly", startDate: "2025-01-25", kind: "income", toAccountId: "chk" }),
    ];
    const proj = buildCashFlowProjection(TODAY, accounts, [], [], recurring, { horizonMonths: 1 });
    const rent = proj.events.find((e) => e.label === "월세");
    const salary = proj.events.find((e) => e.label === "월급");
    expect(rent?.amount).toBe(-500_000);
    expect(rent?.source).toBe("recurring-expense");
    expect(salary?.amount).toBe(3_000_000);
    expect(salary?.source).toBe("recurring-income");
  });
});

describe("buildCashFlowProjection — 이중계상 계약 1: 대출 상환 반복지출 제외", () => {
  it("반복지출 제목이 대출명을 포함하면 loanSchedule만 쓰고 반복은 뺀다", () => {
    const accounts: Account[] = [acc({ id: "chk", type: "checking", initialBalance: 10_000_000 })];
    const loans: Loan[] = [loan({ id: "l1", loanName: "신용대출", loanAmount: 1_200_000, loanDate: "2026-02-15", maturityDate: "2026-11-15" })];
    const recurring: RecurringExpense[] = [
      recur({ id: "r1", title: "신용대출 상환", amount: 999_999, frequency: "monthly", startDate: "2026-02-15" }),
    ];
    const proj = buildCashFlowProjection(TODAY, accounts, [], loans, recurring, { horizonMonths: 3 });
    expect(proj.events.some((e) => e.source === "recurring-expense")).toBe(false);
    expect(proj.events.some((e) => e.source === "loan")).toBe(true);
  });

  it("제목이 대출과 무관하면 반복지출과 대출상환이 함께 잡힌다(이중계상 아님)", () => {
    const accounts: Account[] = [acc({ id: "chk", type: "checking", initialBalance: 10_000_000 })];
    const loans: Loan[] = [loan({ id: "l1", loanName: "신용대출", loanDate: "2026-02-15", maturityDate: "2026-11-15" })];
    const recurring: RecurringExpense[] = [
      recur({ id: "r1", title: "넷플릭스", amount: 17_000, frequency: "monthly", startDate: "2025-01-10" }),
    ];
    const proj = buildCashFlowProjection(TODAY, accounts, [], loans, recurring, { horizonMonths: 3 });
    expect(proj.events.some((e) => e.source === "recurring-expense" && e.label === "넷플릭스")).toBe(true);
    expect(proj.events.some((e) => e.source === "loan")).toBe(true);
  });
});

describe("buildCashFlowProjection — 이중계상 계약 2: 카드결제이체 반복지출 제외", () => {
  it("toAccountId가 카드계좌인 반복이체는 제외하고 cardBillForecast만 쓴다", () => {
    const accounts: Account[] = [
      acc({ id: "chk", type: "checking", initialBalance: 5_000_000 }),
      acc({ id: "card1", type: "card", billingCycleStart: 13, paymentDay: 25 }),
    ];
    const ledger: LedgerEntry[] = [
      le({ id: "c1", date: "2026-07-20", kind: "expense", category: "지출", subCategory: "식비", amount: 300_000, fromAccountId: "card1" }),
    ];
    const recurring: RecurringExpense[] = [
      recur({ id: "r1", title: "카드값 자동이체", amount: 300_000, frequency: "monthly", startDate: "2025-01-25", toAccountId: "card1", kind: "transfer" }),
    ];
    const proj = buildCashFlowProjection(TODAY, accounts, ledger, [], recurring, { horizonMonths: 1 });
    expect(proj.events.some((e) => e.source === "recurring-expense")).toBe(false);
    expect(proj.events.some((e) => e.source === "card")).toBe(true);
  });
});

describe("buildCashFlowProjection — 선행배당 토글(계약 3)", () => {
  const dividends = { months: [{ month: "2026-08", amountKRW: 200_000 }], annualTotalKRW: 200_000, trailing12KRW: 0 };

  it("기본은 배당을 유입에 포함하지 않는다", () => {
    const accounts: Account[] = [acc({ id: "chk", type: "checking", initialBalance: 0 })];
    const proj = buildCashFlowProjection(TODAY, accounts, [], [], [], {
      horizonMonths: 1,
      forwardDividends: dividends,
    });
    expect(proj.events.some((e) => e.source === "dividend")).toBe(false);
  });

  it("includeForwardDividends=true면 유입으로 포함", () => {
    const accounts: Account[] = [acc({ id: "chk", type: "checking", initialBalance: 0 })];
    const proj = buildCashFlowProjection(TODAY, accounts, [], [], [], {
      horizonMonths: 1,
      includeForwardDividends: true,
      forwardDividends: dividends,
    });
    const div = proj.events.find((e) => e.source === "dividend");
    expect(div?.amount).toBe(200_000);
  });
});

describe("buildCashFlowProjection — 최저 잔고·첫 마이너스일", () => {
  it("이벤트 누적으로 정확한 날짜에 마이너스 진입을 잡는다", () => {
    const accounts: Account[] = [acc({ id: "chk", type: "checking", initialBalance: 100_000 })];
    const recurring: RecurringExpense[] = [
      recur({ id: "r1", title: "월세", amount: 500_000, frequency: "monthly", startDate: "2025-01-10" }),
    ];
    const proj = buildCashFlowProjection(TODAY, accounts, [], [], recurring, { horizonMonths: 2 });
    expect(proj.firstNegativeDate).toBe("2026-08-10");
    expect(proj.minBalance).toBeLessThan(0);
  });

  it("계속 플러스면 firstNegativeDate는 null", () => {
    const accounts: Account[] = [acc({ id: "chk", type: "checking", initialBalance: 100_000_000 })];
    const proj = buildCashFlowProjection(TODAY, accounts, [], [], [], { horizonMonths: 1 });
    expect(proj.firstNegativeDate).toBeNull();
    expect(proj.minBalance).toBe(100_000_000);
  });
});

describe("buildCashFlowProjection — 변동 지출 기준선", () => {
  it("최근 3개월 variable+discretionary 평균을 매달 15일 유출로 넣는다", () => {
    const accounts: Account[] = [acc({ id: "chk", type: "checking", initialBalance: 10_000_000 })];
    const ledger: LedgerEntry[] = [
      le({ id: "v1", date: "2026-05-15", kind: "expense", category: "지출", subCategory: "외식", detailCategory: "식비", amount: 300_000, fromAccountId: "chk" }),
      le({ id: "v2", date: "2026-06-15", kind: "expense", category: "지출", subCategory: "외식", detailCategory: "식비", amount: 300_000, fromAccountId: "chk" }),
      le({ id: "v3", date: "2026-07-15", kind: "expense", category: "지출", subCategory: "외식", detailCategory: "식비", amount: 300_000, fromAccountId: "chk" }),
    ];
    const proj = buildCashFlowProjection(TODAY, accounts, ledger, [], [], { horizonMonths: 1 });
    const baseline = proj.events.filter((e) => e.source === "variable-baseline");
    expect(baseline.length).toBe(1);
    expect(Math.abs(baseline[0].amount)).toBeGreaterThan(0);
  });

  it("과거 지출 기록이 없으면 기준선 이벤트를 만들지 않는다", () => {
    const accounts: Account[] = [acc({ id: "chk", type: "checking", initialBalance: 10_000_000 })];
    const proj = buildCashFlowProjection(TODAY, accounts, [], [], [], { horizonMonths: 1 });
    expect(proj.events.some((e) => e.source === "variable-baseline")).toBe(false);
  });
});

describe("buildCashFlowProjection — 월말 요약점", () => {
  it("horizonMonths개의 points를 반환하고 마지막 잔고가 openingBalance+전체순유출입과 같다", () => {
    const accounts: Account[] = [acc({ id: "chk", type: "checking", initialBalance: 1_000_000 })];
    const recurring: RecurringExpense[] = [
      recur({ id: "r1", title: "구독", amount: 10_000, frequency: "monthly", startDate: "2025-01-05" }),
    ];
    const proj = buildCashFlowProjection(TODAY, accounts, [], [], recurring, { horizonMonths: 3 });
    expect(proj.points.length).toBe(3);
    expect(proj.points.map((p) => p.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    const totalNet = proj.events.reduce((s, e) => s + e.amount, 0);
    expect(proj.points[proj.points.length - 1].balance).toBeCloseTo(1_000_000 + totalNet, 6);
  });
});

describe("buildCashFlowProjection — 경계", () => {
  it("무효 todayIso는 빈 결과", () => {
    const proj = buildCashFlowProjection("invalid", [], [], [], []);
    expect(proj.points).toEqual([]);
    expect(proj.events).toEqual([]);
    expect(proj.openingBalance).toBe(0);
  });
});
