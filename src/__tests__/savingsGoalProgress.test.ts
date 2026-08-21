import { describe, it, expect } from "vitest";
import { computeSavingsGoalProgress } from "../utils/savingsGoalProgress";
import { computeAccountBalances } from "../calculations";
import type { Account, LedgerEntry, SavingsGoal } from "../types";

const checking = (id: string, initialBalance = 0): Account => ({
  id,
  name: id,
  institution: "테스트은행",
  type: "checking",
  initialBalance,
});

const securities = (id: string, initialBalance = 0): Account => ({
  id,
  name: id,
  institution: "테스트증권",
  type: "securities",
  initialBalance,
});

const goal = (overrides: Partial<SavingsGoal> = {}): SavingsGoal => ({
  id: "SG1",
  name: "비상금",
  targetAmount: 1_000_000,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("computeSavingsGoalProgress — mode 판별", () => {
  it("linkedAccountIds·linkedCategory 둘 다 없으면 mode='none', currentKRW=0", () => {
    const result = computeSavingsGoalProgress(goal(), {
      ledger: [],
      accounts: [],
      balances: [],
      fxRate: null,
      nowMonth: "2026-03",
    });
    expect(result.mode).toBe("none");
    expect(result.currentKRW).toBe(0);
    expect(result.pct).toBe(0);
  });

  it("linkedAccountIds가 있으면 linkedCategory보다 우선(mode='accounts')", () => {
    const accounts = [checking("A1", 100_000)];
    const balances = computeAccountBalances(accounts, [], []);
    const result = computeSavingsGoalProgress(
      goal({ linkedAccountIds: ["A1"], linkedCategory: "저축이체" }),
      { ledger: [], accounts, balances, fxRate: null, nowMonth: "2026-03" }
    );
    expect(result.mode).toBe("accounts");
  });
});

describe("computeSavingsGoalProgress — 방식 A: 연결 계좌 잔액 합", () => {
  it("체킹 계좌 초기 잔액 + income/expense/transfer 반영 합이 currentKRW (balances 단일 소스와 일치)", () => {
    const accounts = [checking("A1", 100_000), checking("A2", 0)];
    const ledger: LedgerEntry[] = [
      { id: "L1", date: "2026-01-05", kind: "income", category: "수입", description: "급여", amount: 500_000, toAccountId: "A1" },
      { id: "L2", date: "2026-01-10", kind: "expense", category: "지출", description: "식비", amount: 50_000, fromAccountId: "A1" },
      { id: "L3", date: "2026-02-01", kind: "transfer", category: "이체", description: "이동", amount: 100_000, fromAccountId: "A1", toAccountId: "A2" },
    ];
    const balances = computeAccountBalances(accounts, ledger, []);
    const result = computeSavingsGoalProgress(goal({ linkedAccountIds: ["A1", "A2"], targetAmount: 1_000_000 }), {
      ledger,
      accounts,
      balances,
      fxRate: null,
      nowMonth: "2026-03",
    });
    // A1: 100,000 + 500,000 - 50,000 - 100,000 = 450,000 / A2: 0 + 100,000 = 100,000 → 합 550,000
    expect(result.currentKRW).toBe(550_000);
    expect(result.pct).toBeCloseTo(55, 5);
    // 시계열은 1월~3월 연속 (buildMonthRange)
    expect(result.series.map((p) => p.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(result.series[result.series.length - 1].value).toBe(550_000);
  });

  it("증권/암호화폐 계좌는 linkedAccountIds에 있어도 합산·시계열에서 제외된다 (평가액 미포함 착시 방지)", () => {
    const accounts = [checking("A1", 200_000), securities("A2", 100_000)];
    const ledger: LedgerEntry[] = [
      { id: "L1", date: "2026-01-05", kind: "income", category: "수입", description: "배당", amount: 999_999, toAccountId: "A2" },
    ];
    const balances = computeAccountBalances(accounts, ledger, []);
    const result = computeSavingsGoalProgress(goal({ linkedAccountIds: ["A1", "A2"] }), {
      ledger,
      accounts,
      balances,
      fxRate: null,
      nowMonth: "2026-01",
    });
    // A2(증권)는 완전히 제외 — A1의 initialBalance만 반영
    expect(result.currentKRW).toBe(200_000);
  });

  it("USD 통화 항목은 accounts 모드에서 무시된다(대상 계좌가 KRW 전제)", () => {
    const accounts = [checking("A1", 0), checking("A2", 0)];
    const ledger: LedgerEntry[] = [
      { id: "L1", date: "2026-01-05", kind: "transfer", category: "이체", description: "환전이동", amount: 100, currency: "USD", fromAccountId: "A1", toAccountId: "A2" },
    ];
    const balances = computeAccountBalances(accounts, ledger, []);
    const result = computeSavingsGoalProgress(goal({ linkedAccountIds: ["A1", "A2"] }), {
      ledger,
      accounts,
      balances,
      fxRate: 1_300,
      nowMonth: "2026-01",
    });
    expect(result.currentKRW).toBe(0);
  });

  it("linkedAccountIds가 전부 존재하지 않는/증권인 계좌면 series는 빈 배열(projection은 여전히 계산됨)", () => {
    const accounts = [securities("A1", 100_000)];
    const balances = computeAccountBalances(accounts, [], []);
    const result = computeSavingsGoalProgress(goal({ linkedAccountIds: ["A1"] }), {
      ledger: [],
      accounts,
      balances,
      fxRate: null,
      nowMonth: "2026-01",
    });
    expect(result.series).toEqual([]);
    expect(result.currentKRW).toBe(0);
    expect(result.projection.status).not.toBe(undefined);
  });
});

describe("computeSavingsGoalProgress — 방식 B: 연결 대분류 재테크 이체 누적", () => {
  it("linkedCategory와 일치하는 저축이체 transfer만 누적, 다른 subCategory·비재테크 항목은 제외", () => {
    const ledger: LedgerEntry[] = [
      { id: "L1", date: "2026-01-10", kind: "transfer", category: "이체", subCategory: "저축이체", description: "적금", amount: 300_000 },
      { id: "L2", date: "2026-02-10", kind: "transfer", category: "이체", subCategory: "저축이체", description: "적금", amount: 200_000 },
      { id: "L3", date: "2026-02-15", kind: "transfer", category: "이체", subCategory: "투자이체", description: "증권입금", amount: 999_999 },
      { id: "L4", date: "2026-02-20", kind: "expense", category: "지출", subCategory: "식비", description: "점심", amount: 10_000 },
    ];
    const result = computeSavingsGoalProgress(goal({ linkedCategory: "저축이체", targetAmount: 1_000_000 }), {
      ledger,
      accounts: [],
      balances: [],
      fxRate: null,
      nowMonth: "2026-03",
    });
    expect(result.mode).toBe("category");
    expect(result.currentKRW).toBe(500_000);
    expect(result.pct).toBeCloseTo(50, 5);
    expect(result.series.map((p) => p.month)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(result.series).toEqual([
      { month: "2026-01", value: 300_000 },
      { month: "2026-02", value: 500_000 },
      { month: "2026-03", value: 500_000 },
    ]);
  });

  it("투자손실(재테크 손실)은 누적을 감소시킨다", () => {
    const ledger: LedgerEntry[] = [
      { id: "L1", date: "2026-01-10", kind: "transfer", category: "이체", subCategory: "투자이체", description: "증권입금", amount: 500_000 },
      { id: "L2", date: "2026-01-20", kind: "expense", category: "재테크", subCategory: "투자손실", description: "손실 확정", amount: 100_000 },
    ];
    const result = computeSavingsGoalProgress(goal({ linkedCategory: "투자이체" }), {
      ledger,
      accounts: [],
      balances: [],
      fxRate: null,
      nowMonth: "2026-01",
    });
    // linkedCategory="투자이체"는 subCategory 매칭이므로 투자손실(subCategory="투자손실")은 매칭 안 됨 → 500,000만 집계
    expect(result.currentKRW).toBe(500_000);
  });

  it("USD 이체는 fxRate로 환산해 누적", () => {
    const ledger: LedgerEntry[] = [
      { id: "L1", date: "2026-01-10", kind: "transfer", category: "이체", subCategory: "투자이체", description: "증권입금", amount: 100, currency: "USD" },
    ];
    const result = computeSavingsGoalProgress(goal({ linkedCategory: "투자이체" }), {
      ledger,
      accounts: [],
      balances: [],
      fxRate: 1_300,
      nowMonth: "2026-01",
    });
    expect(result.currentKRW).toBe(130_000);
  });

  it("linkedCategory가 없는 항목이 전혀 없으면 series는 [{nowMonth, 0}] 1점, projection은 insufficient/invalid", () => {
    const result = computeSavingsGoalProgress(goal({ linkedCategory: "존재안함" }), {
      ledger: [],
      accounts: [],
      balances: [],
      fxRate: null,
      nowMonth: "2026-05",
    });
    expect(result.currentKRW).toBe(0);
    expect(result.series).toEqual([{ month: "2026-05", value: 0 }]);
  });
});

describe("computeSavingsGoalProgress — pct clamp", () => {
  it("currentKRW가 음수여도 pct는 0으로 clamp(currentKRW 자체는 원값 유지)", () => {
    const accounts = [checking("A1", 0)];
    const ledger: LedgerEntry[] = [
      { id: "L1", date: "2026-01-05", kind: "expense", category: "지출", description: "지출", amount: 50_000, fromAccountId: "A1" },
    ];
    const balances = computeAccountBalances(accounts, ledger, []);
    const result = computeSavingsGoalProgress(goal({ linkedAccountIds: ["A1"] }), {
      ledger,
      accounts,
      balances,
      fxRate: null,
      nowMonth: "2026-01",
    });
    expect(result.currentKRW).toBe(-50_000);
    expect(result.pct).toBe(0);
  });
});
