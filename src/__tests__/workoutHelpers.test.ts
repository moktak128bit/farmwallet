import { describe, it, expect } from "vitest";
import { computeExerciseVolume, getCardioKind, makeId } from "../features/workout/helpers";
import type { WorkoutExercise, WorkoutSet } from "../types";

function mkSet(weight: number, reps: number, done?: boolean): WorkoutSet {
  return { weightKg: weight, reps, done };
}

function mkExercise(name: string, bodyPart: WorkoutExercise["bodyPart"], sets: WorkoutSet[]): WorkoutExercise {
  return { id: `EX-${name}`, name, bodyPart, sets };
}

describe("computeExerciseVolume", () => {
  it("done=true 세트만 합산 (계획 세트는 볼륨 미포함 — workoutStats 기준과 일치)", () => {
    const exercises = [
      mkExercise("벤치프레스", "가슴", [
        mkSet(60, 10, true),   // 600
        mkSet(80, 5, false),   // 계획만 — 제외
        mkSet(70, 8, true),    // 560
        mkSet(100, 5),         // done 미정의 — 제외
      ]),
    ];
    expect(computeExerciseVolume(exercises)).toBe(600 + 560);
  });

  it("모든 세트가 미수행이면 볼륨 0 (루틴 적용 직후 상태)", () => {
    const exercises = [
      mkExercise("스쿼트", "하체", [mkSet(100, 5, false), mkSet(100, 5, false)]),
    ];
    expect(computeExerciseVolume(exercises)).toBe(0);
  });

  it("유산소 종목은 제외", () => {
    const exercises = [
      mkExercise("트레드밀", "유산소", [mkSet(0, 15, true)]),
      mkExercise("벤치프레스", "가슴", [mkSet(60, 10, true)]),
    ];
    expect(computeExerciseVolume(exercises)).toBe(600);
  });

  it("빈 배열은 0", () => {
    expect(computeExerciseVolume([])).toBe(0);
  });

  it("여러 종목 합산", () => {
    const exercises = [
      mkExercise("벤치프레스", "가슴", [mkSet(60, 10, true)]),  // 600
      mkExercise("랫풀다운", "등", [mkSet(45, 10, true)]),      // 450
    ];
    expect(computeExerciseVolume(exercises)).toBe(1050);
  });
});

describe("makeId", () => {
  it("접두사 포함 + 호출마다 고유", () => {
    const a = makeId("ex");
    const b = makeId("ex");
    expect(a.startsWith("ex-")).toBe(true);
    expect(b.startsWith("ex-")).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("getCardioKind", () => {
  it.each(["버피", "점핑 잭", "제자리 뛰기", "하이 니", "줄넘기"])("%s는 시간·횟수로 기록", (name) => {
    expect(getCardioKind(name)).toBe("count");
  });
  it("기존 거리·강도·인터벌 입력을 유지", () => {
    expect(getCardioKind("러닝")).toBe("distance");
    expect(getCardioKind("계단오르기")).toBe("intensity");
    expect(getCardioKind("인터벌")).toBe("interval");
  });
});
