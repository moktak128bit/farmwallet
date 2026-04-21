import type { WorkoutWeek, WorkoutSet, WorkoutBodyPart, CustomExercise } from "../types";

export interface ExerciseSession {
  /** yyyy-mm-dd */
  date: string;
  /** 완료 세트 중 최대 중량 (kg) */
  maxWeight: number;
  /** 완료 세트의 sum(weight × reps) */
  totalVolume: number;
  /** Epley 공식 추정 1RM = weight × (1 + reps/30). 세트별 최대값. */
  estimated1RM: number;
  /** 최대 중량이 나온 세트 (동률이면 reps 큰 쪽 우선) */
  topSet: { weight: number; reps: number };
  /** 참고용 완료 세트 수 */
  completedSetCount: number;
}

export interface ExerciseSessionWithPR extends ExerciseSession {
  isMaxWeightPR: boolean;
  isVolumePR: boolean;
  is1RMPR: boolean;
}

function epley1RM(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  return weight * (1 + reps / 30);
}

/**
 * 지정 종목명에 대한 세션별 집계. `done===true`인 세트만 반영. 완료 세트가 하나도 없는 날은 제외.
 * 반환은 date 오름차순.
 */
export function getExerciseSessions(
  weeks: WorkoutWeek[] | undefined,
  exerciseName: string
): ExerciseSession[] {
  if (!weeks || weeks.length === 0 || !exerciseName) return [];
  const normalized = exerciseName.trim();
  if (!normalized) return [];

  const byDate = new Map<string, { sets: WorkoutSet[] }>();
  for (const week of weeks) {
    if (!week || !Array.isArray(week.entries)) continue;
    for (const entry of week.entries) {
      if (!entry || entry.type !== "workout" || !Array.isArray(entry.exercises)) continue;
      for (const ex of entry.exercises) {
        if (!ex || (ex.name ?? "").trim() !== normalized) continue;
        const doneSets = (ex.sets ?? []).filter((s) => s && s.done === true);
        if (doneSets.length === 0) continue;
        const bucket = byDate.get(entry.date) ?? { sets: [] };
        bucket.sets.push(...doneSets);
        byDate.set(entry.date, bucket);
      }
    }
  }

  const sessions: ExerciseSession[] = [];
  for (const [date, { sets }] of byDate) {
    let maxWeight = 0;
    let totalVolume = 0;
    let estimated1RM = 0;
    let topSet: { weight: number; reps: number } = { weight: 0, reps: 0 };
    for (const s of sets) {
      const w = Number(s.weightKg) || 0;
      const r = Number(s.reps) || 0;
      if (w <= 0 || r <= 0) continue;
      totalVolume += w * r;
      const e1rm = epley1RM(w, r);
      if (e1rm > estimated1RM) estimated1RM = e1rm;
      if (w > maxWeight || (w === maxWeight && r > topSet.reps)) {
        maxWeight = w;
        topSet = { weight: w, reps: r };
      }
    }
    if (totalVolume <= 0) continue;
    sessions.push({
      date,
      maxWeight,
      totalVolume,
      estimated1RM,
      topSet,
      completedSetCount: sets.length
    });
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date));
  return sessions;
}

/**
 * 각 세션에 PR (personal record) 플래그 부여.
 * 누적 최대값이 갱신되는 시점에 플래그. 동률은 PR 아님.
 * 첫 세션은 모든 플래그 true (기준점).
 */
export function detectPRs(sessions: ExerciseSession[]): ExerciseSessionWithPR[] {
  const result: ExerciseSessionWithPR[] = [];
  let bestWeight = -Infinity;
  let bestVolume = -Infinity;
  let best1RM = -Infinity;
  for (const s of sessions) {
    const isMaxWeightPR = s.maxWeight > bestWeight;
    const isVolumePR = s.totalVolume > bestVolume;
    const is1RMPR = s.estimated1RM > best1RM;
    if (isMaxWeightPR) bestWeight = s.maxWeight;
    if (isVolumePR) bestVolume = s.totalVolume;
    if (is1RMPR) best1RM = s.estimated1RM;
    result.push({ ...s, isMaxWeightPR, isVolumePR, is1RMPR });
  }
  return result;
}

/**
 * customExercises 배열에 (name, bodyPart) upsert. 중복 이름은 무시 (bodyPart 덮어쓰기 없음).
 * 반환: 새로운 배열 (불변).
 */
export function upsertCustomExercise(
  list: CustomExercise[] | undefined,
  name: string,
  bodyPart: WorkoutBodyPart,
  nowISO: string = new Date().toISOString()
): CustomExercise[] {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return list ?? [];
  const current = list ?? [];
  if (current.some((c) => c.name === trimmed)) return current;
  return [...current, { name: trimmed, bodyPart, addedAt: nowISO }];
}
