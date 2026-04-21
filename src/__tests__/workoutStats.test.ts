import { describe, it, expect } from "vitest";
import { getExerciseSessions, detectPRs, upsertCustomExercise } from "../utils/workoutStats";
import type { WorkoutWeek, WorkoutSet } from "../types";

function mkSet(weight: number, reps: number, done = true): WorkoutSet {
  return { weightKg: weight, reps, done };
}

function mkWeek(weekStart: string, days: Array<{ date: string; exercises: Array<{ name: string; sets: WorkoutSet[] }> }>): WorkoutWeek {
  return {
    id: `W-${weekStart}`,
    weekStart,
    entries: days.map((d, i) => ({
      id: `E-${d.date}-${i}`,
      date: d.date,
      type: "workout",
      exercises: d.exercises.map((ex, j) => ({ id: `EX-${j}`, name: ex.name, sets: ex.sets }))
    }))
  };
}

describe("getExerciseSessions", () => {
  it("빈 입력은 빈 배열", () => {
    expect(getExerciseSessions(undefined, "벤치프레스")).toEqual([]);
    expect(getExerciseSessions([], "벤치프레스")).toEqual([]);
    expect(getExerciseSessions([mkWeek("2026-01-04", [])], "")).toEqual([]);
  });

  it("단일 세션: 최대중량·총볼륨·1RM·topSet 계산", () => {
    const weeks = [
      mkWeek("2026-01-04", [
        { date: "2026-01-06", exercises: [{ name: "벤치프레스", sets: [mkSet(60, 10), mkSet(80, 5), mkSet(70, 8)] }] }
      ])
    ];
    const [s] = getExerciseSessions(weeks, "벤치프레스");
    expect(s.date).toBe("2026-01-06");
    expect(s.maxWeight).toBe(80);
    expect(s.totalVolume).toBe(60 * 10 + 80 * 5 + 70 * 8); // 1560
    expect(s.topSet).toEqual({ weight: 80, reps: 5 });
    expect(s.estimated1RM).toBeCloseTo(80 * (1 + 5 / 30), 3);
    expect(s.completedSetCount).toBe(3);
  });

  it("done=false 세트는 제외", () => {
    const weeks = [
      mkWeek("2026-01-04", [
        { date: "2026-01-06", exercises: [{ name: "벤치프레스", sets: [mkSet(100, 5, false), mkSet(60, 10, true)] }] }
      ])
    ];
    const [s] = getExerciseSessions(weeks, "벤치프레스");
    expect(s.maxWeight).toBe(60);
    expect(s.totalVolume).toBe(600);
  });

  it("타 종목은 필터링", () => {
    const weeks = [
      mkWeek("2026-01-04", [
        {
          date: "2026-01-06",
          exercises: [
            { name: "벤치프레스", sets: [mkSet(80, 5)] },
            { name: "스쿼트", sets: [mkSet(120, 8)] }
          ]
        }
      ])
    ];
    const sessions = getExerciseSessions(weeks, "스쿼트");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].maxWeight).toBe(120);
  });

  it("여러 날짜 세션은 date 오름차순 정렬", () => {
    const weeks = [
      mkWeek("2026-01-04", [
        { date: "2026-01-10", exercises: [{ name: "벤치프레스", sets: [mkSet(80, 5)] }] },
        { date: "2026-01-06", exercises: [{ name: "벤치프레스", sets: [mkSet(70, 5)] }] }
      ])
    ];
    const sessions = getExerciseSessions(weeks, "벤치프레스");
    expect(sessions.map((s) => s.date)).toEqual(["2026-01-06", "2026-01-10"]);
  });

  it("같은 날짜 여러 exercise 항목은 합쳐짐", () => {
    const weeks = [
      mkWeek("2026-01-04", [
        {
          date: "2026-01-06",
          exercises: [
            { name: "벤치프레스", sets: [mkSet(60, 10)] },
            { name: "벤치프레스", sets: [mkSet(80, 5)] }
          ]
        }
      ])
    ];
    const [s] = getExerciseSessions(weeks, "벤치프레스");
    expect(s.completedSetCount).toBe(2);
    expect(s.maxWeight).toBe(80);
    expect(s.totalVolume).toBe(600 + 400);
  });

  it("rest 타입 entry는 제외", () => {
    const weeks: WorkoutWeek[] = [
      {
        id: "W1",
        weekStart: "2026-01-04",
        entries: [
          { id: "E1", date: "2026-01-06", type: "rest", exercises: [{ id: "EX1", name: "벤치프레스", sets: [mkSet(80, 5)] }] }
        ]
      }
    ];
    expect(getExerciseSessions(weeks, "벤치프레스")).toEqual([]);
  });
});

describe("detectPRs", () => {
  it("빈 배열", () => {
    expect(detectPRs([])).toEqual([]);
  });

  it("첫 세션은 모든 PR 플래그 true (기준점)", () => {
    const [s] = detectPRs([
      { date: "2026-01-06", maxWeight: 80, totalVolume: 1000, estimated1RM: 93, topSet: { weight: 80, reps: 5 }, completedSetCount: 3 }
    ]);
    expect(s.isMaxWeightPR).toBe(true);
    expect(s.isVolumePR).toBe(true);
    expect(s.is1RMPR).toBe(true);
  });

  it("지표별 독립 PR 판정", () => {
    const result = detectPRs([
      { date: "2026-01-06", maxWeight: 80, totalVolume: 1000, estimated1RM: 93, topSet: { weight: 80, reps: 5 }, completedSetCount: 3 },
      // 중량만 증가, 볼륨 감소, 1RM도 약간 증가
      { date: "2026-01-13", maxWeight: 85, totalVolume: 900, estimated1RM: 99, topSet: { weight: 85, reps: 5 }, completedSetCount: 2 },
      // 볼륨 PR 갱신
      { date: "2026-01-20", maxWeight: 85, totalVolume: 1100, estimated1RM: 99, topSet: { weight: 85, reps: 5 }, completedSetCount: 4 },
    ]);
    expect(result[1].isMaxWeightPR).toBe(true);
    expect(result[1].isVolumePR).toBe(false);
    expect(result[1].is1RMPR).toBe(true);
    expect(result[2].isMaxWeightPR).toBe(false);
    expect(result[2].isVolumePR).toBe(true);
    expect(result[2].is1RMPR).toBe(false);
  });

  it("동률은 PR 아님", () => {
    const result = detectPRs([
      { date: "2026-01-06", maxWeight: 80, totalVolume: 1000, estimated1RM: 93, topSet: { weight: 80, reps: 5 }, completedSetCount: 3 },
      { date: "2026-01-13", maxWeight: 80, totalVolume: 1000, estimated1RM: 93, topSet: { weight: 80, reps: 5 }, completedSetCount: 3 }
    ]);
    expect(result[1].isMaxWeightPR).toBe(false);
    expect(result[1].isVolumePR).toBe(false);
    expect(result[1].is1RMPR).toBe(false);
  });
});

describe("upsertCustomExercise", () => {
  it("빈 리스트에 추가", () => {
    const out = upsertCustomExercise(undefined, "덤벨 풀오버", "가슴", "2026-04-21T00:00:00Z");
    expect(out).toEqual([{ name: "덤벨 풀오버", bodyPart: "가슴", addedAt: "2026-04-21T00:00:00Z" }]);
  });

  it("중복 이름은 무시 (기존 entry 유지)", () => {
    const initial = [{ name: "덤벨 풀오버", bodyPart: "가슴" as const, addedAt: "2026-04-01T00:00:00Z" }];
    const out = upsertCustomExercise(initial, "덤벨 풀오버", "등", "2026-04-21T00:00:00Z");
    expect(out).toBe(initial); // 동일 참조 반환
  });

  it("공백 이름은 no-op", () => {
    const initial = [{ name: "기존", bodyPart: "가슴" as const, addedAt: "2026-04-01T00:00:00Z" }];
    expect(upsertCustomExercise(initial, "   ", "가슴")).toBe(initial);
    expect(upsertCustomExercise(undefined, "", "가슴")).toEqual([]);
  });

  it("다른 부위의 다른 이름은 정상 추가", () => {
    const initial = [{ name: "스쿼트", bodyPart: "하체" as const, addedAt: "2026-04-01T00:00:00Z" }];
    const out = upsertCustomExercise(initial, "데드리프트", "등", "2026-04-21T00:00:00Z");
    expect(out).toHaveLength(2);
    expect(out[1].name).toBe("데드리프트");
  });
});
