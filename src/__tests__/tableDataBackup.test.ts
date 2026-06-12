import { describe, it, expect } from "vitest";
import { buildTableBackupFile, appDataFromTableBackupPayload } from "../utils/tableDataBackup";
import type { AppData } from "../types";

function makeAppData(overrides: Partial<AppData> = {}): AppData {
  return {
    accounts: [],
    ledger: [],
    trades: [],
    prices: [],
    categoryPresets: { income: [], expense: [], transfer: [] },
    recurringExpenses: [],
    budgetGoals: [],
    customSymbols: [],
    ...overrides,
  };
}

describe("tableDataBackup — 누락 5필드 백업·복원 (workoutRoutines/customExercises/marketEnvSnapshots/investmentGoals/dailyBudget)", () => {
  const fixture = makeAppData({
    workoutRoutines: [
      {
        id: "rt1",
        name: "푸시 데이",
        days: [],
      } as unknown as NonNullable<AppData["workoutRoutines"]>[number],
    ],
    customExercises: [{ id: "ce1", name: "케이블 크런치" } as unknown as NonNullable<AppData["customExercises"]>[number]],
    marketEnvSnapshots: [
      { date: "2026-06-01", fxRate: 1380, prices: [{ ticker: "AAPL", price: 200, currency: "USD" }], recordedAt: "2026-06-01T00:00:00Z" },
    ],
    investmentGoals: { annualDepositTarget: 12_000_000, targetAnnualDividend: 3_600_000 },
    dailyBudget: {
      enabled: true,
      dailyLimit: 30_000,
      mode: "daily",
      excludedCategories: ["이체"],
      excludedSubCategories: ["통신비"],
      warnOnExceed: true,
    },
  });

  it("buildTableBackupFile이 5개 필드를 테이블로 포함", () => {
    const file = buildTableBackupFile(fixture);
    expect(file.tables.workout_routines).toHaveLength(1);
    expect(file.tables.custom_exercises).toHaveLength(1);
    expect(file.tables.market_env_snapshots).toHaveLength(1);
    expect(file.tables.investment_goals).toHaveLength(1);
    expect(file.tables.daily_budget).toHaveLength(1);
  });

  it("build → restore 왕복으로 5개 필드 복원", () => {
    const file = buildTableBackupFile(fixture);
    const restored = appDataFromTableBackupPayload(file);
    expect(restored.workoutRoutines).toEqual(fixture.workoutRoutines);
    expect(restored.customExercises).toEqual(fixture.customExercises);
    expect(restored.marketEnvSnapshots).toEqual(fixture.marketEnvSnapshots);
    expect(restored.investmentGoals).toEqual(fixture.investmentGoals);
    expect(restored.dailyBudget).toEqual(fixture.dailyBudget);
  });

  it("빈 배열 루틴도 '존재'로 복원 (사용자 전부 삭제 존중 — 시드 재주입 안 됨)", () => {
    const file = buildTableBackupFile(makeAppData({ workoutRoutines: [] }));
    const restored = appDataFromTableBackupPayload(file);
    expect(restored.workoutRoutines).toEqual([]);
  });

  it("구버전 파일(해당 테이블 부재)은 필드를 '부재'로 복원 — 이후 기본값 주입 정책 정상 동작", () => {
    const file = buildTableBackupFile(fixture);
    const tables = file.tables as Record<string, unknown>;
    delete tables.workout_routines;
    delete tables.custom_exercises;
    delete tables.market_env_snapshots;
    delete tables.investment_goals;
    delete tables.daily_budget;
    const restored = appDataFromTableBackupPayload(file);
    expect(restored.workoutRoutines).toBeUndefined();
    expect(restored.customExercises).toBeUndefined();
    expect(restored.marketEnvSnapshots).toBeUndefined();
    expect(restored.investmentGoals).toBeUndefined();
    expect(restored.dailyBudget).toBeUndefined();
  });

  it("루트 schemaVersion이 복원 객체에 전파되어 마이그레이션 기준으로 사용 가능", () => {
    const file = buildTableBackupFile(fixture);
    const restored = appDataFromTableBackupPayload(file) as AppData & { schemaVersion?: number };
    expect(typeof restored.schemaVersion).toBe("number");
    expect(restored.schemaVersion).toBe(file.schemaVersion);
  });
});
