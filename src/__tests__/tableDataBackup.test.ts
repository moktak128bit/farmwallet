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

describe("tableDataBackup — 운동 weeks 무손실 왕복 (done/목표/휴식 보존)", () => {
  const workoutWeeks = [
    {
      id: "wk1",
      weekStart: "2026-06-07",
      entries: [
        {
          id: "d1",
          date: "2026-06-08",
          type: "workout" as const,
          dayLabel: "Day 1 (상체)",
          cardioMinutes: 20,
          cardioDistanceKm: 3.2,
          startedAt: "2026-06-08T09:00:00Z",
          endedAt: "2026-06-08T10:10:00Z",
          exercises: [
            {
              id: "ex1",
              name: "벤치프레스",
              bodyPart: "가슴" as const,
              warmupNote: "빈 바 × 10",
              cueNote: "견갑 고정",
              sets: [
                { weightKg: 60, reps: 10, done: true, targetWeightKg: 60, targetReps: 10, targetRepsRange: "8~10", restSec: 90, note: "워밍업" },
                { weightKg: 80, reps: 5, done: false, targetReps: 5, restSec: 120 },
              ],
            },
            // 맨몸운동(중량 0) 도 보존되는지
            { id: "ex2", name: "푸시업", sets: [{ weightKg: 0, reps: 20, done: true }] },
          ],
        },
      ],
    },
  ] as unknown as NonNullable<AppData["workoutWeeks"]>;

  it("done·목표중량·목표반복·휴식·맨몸세트가 build→restore 후 그대로 보존", () => {
    const file = buildTableBackupFile(makeAppData({ workoutWeeks }));
    const restored = appDataFromTableBackupPayload(file);
    // 완전 JSON 보존 → 깊은 동등성 (예전 표 백업은 done/목표/휴식을 떨궈 실패했음)
    expect(restored.workoutWeeks).toEqual(workoutWeeks);
  });

  it("완전 JSON 테이블(workout_data_json)이 백업에 포함됨", () => {
    const file = buildTableBackupFile(makeAppData({ workoutWeeks }));
    expect(file.tables.workout_data_json).toHaveLength(1);
  });

  it("구버전 백업(JSON 테이블 없음)은 표 기반으로 폴백 복원 (하위호환)", () => {
    const file = buildTableBackupFile(makeAppData({ workoutWeeks }));
    const tables = file.tables as Record<string, unknown>;
    delete tables.workout_data_json;
    const restored = appDataFromTableBackupPayload(file);
    // 표 기반 폴백은 가독 필드(weight/reps/구조)는 복원하되 done 등은 없음 — 최소한 주차·날짜 구조는 살아있어야 함
    expect(restored.workoutWeeks?.[0]?.id).toBe("wk1");
    expect(restored.workoutWeeks?.[0]?.entries?.[0]?.exercises?.[0]?.name).toBe("벤치프레스");
  });
});
