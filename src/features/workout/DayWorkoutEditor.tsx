import React, { memo, useEffect, useMemo, useState } from "react";
import type { WorkoutBodyPart, WorkoutDayEntry, WorkoutRoutine, WorkoutSet, WorkoutExercise } from "../../types";
import { formatNumber } from "../../utils/formatter";
import { TimerSummary } from "./TimerSummary";
import { SetDetailRow } from "./SetDetailRow";
import { BODY_PART_COLORS } from "./constants";
import {
  computeExerciseVolume,
  computeExerciseTimings,
  computeExercisePrevEnd,
  formatDuration,
  isCardioExercise,
  getCardioKind,
} from "./helpers";
import { ExercisePicker } from "./ExercisePicker";
import type { CustomExercise } from "../../types";

interface Props {
  selectedEntry: WorkoutDayEntry | null;
  selectedDate: string;
  workoutRoutines: WorkoutRoutine[];
  sortedRoutines: WorkoutRoutine[];
  suggestedRoutineId: string | null;
  suggestedRoutineName: string | null;
  customExercises: CustomExercise[];
  recentExercises: Record<WorkoutBodyPart, string[]>;
  onStartWorkout: () => void;
  onStartRest: () => void;
  onEndWorkout: () => void;
  onResumeWorkout: () => void;
  onApplyRoutine: (routineId: string) => void;
  onUpsertEntry: (date: string, updater: (e: WorkoutDayEntry) => WorkoutDayEntry) => void;
  onAddExercise: (name: string, bodyPart: WorkoutBodyPart) => void;
  onRemoveExercise: (exerciseId: string) => void;
  onReorderExercise: (exerciseId: string, direction: "up" | "down") => void;
  onAddSet: (exerciseId: string, patch: Partial<WorkoutSet>) => void;
  onRemoveSet: (exerciseId: string, idx: number) => void;
  onToggleSetDone: (exerciseId: string, idx: number) => void;
  onUpdateSet: (exerciseId: string, idx: number, patch: Partial<WorkoutSet>) => void;
  /** 종목 이력 모달을 열고 싶을 때 (Step 9에서 연결). null이면 버튼 미표시. */
  onOpenHistory?: (exerciseName: string) => void;
}

const DayWorkoutEditorInner: React.FC<Props> = ({
  selectedEntry, selectedDate,
  workoutRoutines, sortedRoutines, suggestedRoutineId, suggestedRoutineName,
  customExercises, recentExercises,
  onStartWorkout, onStartRest, onEndWorkout, onResumeWorkout,
  onApplyRoutine, onUpsertEntry,
  onAddExercise, onRemoveExercise, onReorderExercise,
  onAddSet, onRemoveSet, onToggleSetDone, onUpdateSet,
  onOpenHistory,
}) => {
  const [nowTick, setNowTick] = useState(() => Date.now());
  const exercises = selectedEntry?.exercises ?? [];

  const timings = useMemo(() => {
    if (!selectedEntry) return new Map();
    return computeExerciseTimings(selectedEntry, nowTick);
  }, [selectedEntry, nowTick]);

  const prevEndByExercise = useMemo(() => {
    if (!selectedEntry) return new Map<string, string | undefined>();
    return computeExercisePrevEnd(selectedEntry);
  }, [selectedEntry]);

  const hasLive = useMemo(() => {
    for (const t of timings.values()) if (t.isLive) return true;
    return false;
  }, [timings]);

  useEffect(() => {
    if (!hasLive) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [hasLive]);

  if (!selectedEntry) {
    return (
      <div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: workoutRoutines.length > 0 ? 12 : 0 }}>
          <button type="button" className="primary" onClick={onStartWorkout}
            style={{ padding: "14px 28px", fontSize: 16, fontWeight: 700, borderRadius: 12, flex: 1, minWidth: 140 }}>
            운동 기록 시작
          </button>
          <button type="button" className="secondary" onClick={onStartRest}
            style={{ padding: "14px 28px", fontSize: 16, fontWeight: 700, borderRadius: 12, flex: 1, minWidth: 140 }}>
            휴식 기록
          </button>
        </div>
        {workoutRoutines.length > 0 && (
          <div style={{
            display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
            padding: 12, borderRadius: 10, border: "1px dashed var(--border)",
            background: "var(--surface)",
          }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>루틴 따라하기:</span>
            <select
              value=""
              onChange={(e) => { if (e.target.value) onApplyRoutine(e.target.value); }}
              style={{ flex: 1, minWidth: 180, padding: "8px 12px", borderRadius: 8, fontSize: 14 }}
            >
              <option value="">루틴 선택...</option>
              {sortedRoutines.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}{r.restDay ? " · 휴식" : ` (${r.exercises.length}종목)`}
                </option>
              ))}
            </select>
            {suggestedRoutineId && (
              <button
                type="button"
                className="primary"
                onClick={() => onApplyRoutine(suggestedRoutineId)}
                style={{ padding: "8px 14px", fontSize: 13, fontWeight: 700 }}
                title={suggestedRoutineName ? `${suggestedRoutineName} 적용` : "요일 루틴 적용"}
              >
                이 요일 계획 적용
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (selectedEntry.type === "rest") {
    return (
      <div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button type="button" className="primary"
            style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600 }}
            onClick={() => onUpsertEntry(selectedDate, (e) => ({ ...e, type: "rest" }))}>
            휴식
          </button>
          <button type="button" className="secondary"
            style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600 }}
            onClick={() => onUpsertEntry(selectedDate, (e) => ({ ...e, type: "workout", exercises: e.exercises ?? [] }))}>
            운동으로 변경
          </button>
        </div>
        <textarea
          rows={3}
          value={selectedEntry.restNotes ?? ""}
          onChange={(e) => onUpsertEntry(selectedDate, (entry) => ({ ...entry, restNotes: e.target.value }))}
          placeholder="수면, 컨디션, 피로도 등을 기록하세요"
          style={{ width: "100%", padding: 12, borderRadius: 8, resize: "vertical", fontSize: 14 }}
        />
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="primary" style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600 }}>
          운동
        </button>
        <button type="button" className="secondary"
          style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600 }}
          onClick={() => onUpsertEntry(selectedDate, (e) => ({ ...e, type: "rest", restNotes: e.restNotes ?? "" }))}>
          휴식으로 변경
        </button>
        <input
          type="text"
          value={selectedEntry.dayLabel ?? ""}
          onChange={(e) => onUpsertEntry(selectedDate, (entry) => ({ ...entry, dayLabel: e.target.value }))}
          placeholder="라벨 (예: 상체, 등+이두)"
          style={{ padding: "8px 12px", borderRadius: 8, fontSize: 14, flex: 1, minWidth: 140 }}
        />
        {workoutRoutines.length > 0 && (
          <select
            value=""
            onChange={(e) => { if (e.target.value) onApplyRoutine(e.target.value); }}
            style={{ padding: "8px 12px", borderRadius: 8, fontSize: 14, minWidth: 140 }}
            title="루틴의 운동을 현재 기록에 추가합니다"
          >
            <option value="">루틴 불러오기...</option>
            {sortedRoutines.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}{r.restDay ? " · 휴식" : ` (${r.exercises.length}종목)`}
              </option>
            ))}
          </select>
        )}
      </div>

      <TimerSummary
        entry={selectedEntry}
        onStart={onStartWorkout}
        onEnd={onEndWorkout}
        onResume={onResumeWorkout}
      />

      {exercises.map((exercise: WorkoutExercise, exerciseIdx: number) => {
        const volume = computeExerciseVolume([exercise]);
        const partColor = exercise.bodyPart ? BODY_PART_COLORS[exercise.bodyPart] : "#64748b";
        const doneCount = exercise.sets.filter((s) => s.done).length;
        const totalCount = exercise.sets.length;
        const isAllDone = totalCount > 0 && doneCount === totalCount;
        const timing = timings.get(exercise.id);
        const durLabel = timing?.durationMs != null ? formatDuration(timing.durationMs) : "";
        const canMoveUp = exerciseIdx > 0;
        const canMoveDown = exerciseIdx < exercises.length - 1;
        const firstSetPrev = prevEndByExercise.get(exercise.id);
        const isCardio = isCardioExercise(exercise);
        const cardioKind = isCardio ? getCardioKind(exercise.name) : "distance";

        return (
          <div key={exercise.id} style={{
            marginBottom: 14,
            padding: 14,
            border: `2px solid ${partColor}30`,
            borderRadius: 12,
            background: `${partColor}08`,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <button
                    type="button"
                    onClick={() => onReorderExercise(exercise.id, "up")}
                    disabled={!canMoveUp}
                    aria-label="위로 이동"
                    title="위로 이동"
                    style={{
                      width: 22, height: 18, padding: 0, fontSize: 10, lineHeight: 1,
                      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 4,
                      cursor: canMoveUp ? "pointer" : "not-allowed",
                      opacity: canMoveUp ? 1 : 0.35, color: "var(--text-muted)",
                    }}
                  >▲</button>
                  <button
                    type="button"
                    onClick={() => onReorderExercise(exercise.id, "down")}
                    disabled={!canMoveDown}
                    aria-label="아래로 이동"
                    title="아래로 이동"
                    style={{
                      width: 22, height: 18, padding: 0, fontSize: 10, lineHeight: 1,
                      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 4,
                      cursor: canMoveDown ? "pointer" : "not-allowed",
                      opacity: canMoveDown ? 1 : 0.35, color: "var(--text-muted)",
                    }}
                  >▼</button>
                </div>
                {exercise.bodyPart && (
                  <span style={{
                    padding: "3px 8px", fontSize: 11, fontWeight: 700, borderRadius: 6,
                    background: partColor + "20", color: partColor,
                  }}>
                    {exercise.bodyPart}
                  </span>
                )}
                <strong style={{ fontSize: 15 }}>{exercise.name}</strong>
                {totalCount > 0 && (
                  <span style={{
                    fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                    background: isAllDone ? "rgba(16,185,129,0.18)" : "var(--surface)",
                    color: isAllDone ? "#10b981" : "var(--text-muted)",
                    border: `1px solid ${isAllDone ? "#10b981" : "var(--border)"}`,
                  }}>
                    {doneCount}/{totalCount} 완료{isAllDone ? " ✓" : ""}
                  </span>
                )}
                {durLabel && (
                  <span
                    style={{
                      fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                      background: timing?.isLive ? "rgba(16,185,129,0.14)" : "var(--surface)",
                      color: timing?.isLive ? "#10b981" : "var(--text-muted)",
                      border: `1px solid ${timing?.isLive ? "#10b98160" : "var(--border)"}`,
                    }}
                    title={timing?.isLive ? "이 종목 경과 (진행 중)" : "이 종목 소요 시간"}
                  >
                    ⏱ {durLabel}
                  </span>
                )}
                {volume > 0 && (
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    볼륨 {formatNumber(volume)}kg
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {onOpenHistory && (
                  <button
                    type="button"
                    className="secondary"
                    style={{ fontSize: 13, padding: "6px 12px" }}
                    onClick={() => onOpenHistory(exercise.name)}
                    title="이 종목의 과거 진행 기록 보기"
                  >
                    📈 이력
                  </button>
                )}
                <button
                  type="button"
                  className="danger"
                  style={{ fontSize: 13, padding: "6px 12px" }}
                  onClick={() => onRemoveExercise(exercise.id)}
                >
                  삭제
                </button>
              </div>
            </div>

            {exercise.warmupNote && (
              <div style={{
                padding: "8px 12px", marginBottom: 8, borderRadius: 8,
                background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.4)",
                fontSize: 13, color: "var(--text)",
              }}>
                <span style={{ fontWeight: 700, color: "#b45309", marginRight: 6 }}>워밍업</span>
                {exercise.warmupNote}
              </div>
            )}

            {exercise.cueNote && (
              <div style={{
                padding: "8px 12px", marginBottom: 10, borderRadius: 8,
                background: `${partColor}14`, border: `1px solid ${partColor}40`,
                fontSize: 13, lineHeight: 1.55, color: "var(--text)",
              }}>
                <span style={{ fontWeight: 700, color: partColor, marginRight: 6 }}>자극</span>
                {exercise.cueNote}
              </div>
            )}

            {exercise.sets.length > 0 && (
              <div style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                {exercise.sets.map((set, idx) => (
                  <SetDetailRow
                    key={idx}
                    set={set}
                    index={idx}
                    isCardio={isCardio}
                    cardioKind={cardioKind}
                    prevCompletedAt={idx > 0 ? exercise.sets[idx - 1]?.completedAt : firstSetPrev}
                    onToggleDone={() => onToggleSetDone(exercise.id, idx)}
                    onUpdate={(patch) => onUpdateSet(exercise.id, idx, patch)}
                    onRemove={() => onRemoveSet(exercise.id, idx)}
                  />
                ))}
              </div>
            )}

            <button
              type="button"
              className="primary"
              style={{
                width: "100%", padding: "12px 16px", fontSize: 15, fontWeight: 700,
                borderRadius: 10, marginTop: 4,
              }}
              onClick={() => {
                const last = exercise.sets[exercise.sets.length - 1];
                if (isCardio) {
                  if (cardioKind === "interval") {
                    onAddSet(exercise.id, {
                      intervalStrongSpeed: last?.intervalStrongSpeed ?? 10,
                      intervalStrongSec: last?.intervalStrongSec ?? 30,
                      intervalWeakSpeed: last?.intervalWeakSpeed ?? 6,
                      intervalWeakSec: last?.intervalWeakSec ?? 60,
                      intervalReps: last?.intervalReps ?? 10,
                    });
                  } else if (cardioKind === "intensity") {
                    onAddSet(exercise.id, {
                      durationMin: last?.durationMin ?? 20,
                      intensity: last?.intensity ?? 10,
                    });
                  } else if (cardioKind === "count") {
                    onAddSet(exercise.id, {
                      durationMin: last?.durationMin ?? 5,
                      repsCount: last?.repsCount ?? 100,
                    });
                  } else {
                    onAddSet(exercise.id, {
                      durationMin: last?.durationMin ?? 20,
                      distanceKm: last?.distanceKm ?? 0,
                    });
                  }
                } else {
                  const w = last?.weightKg ?? last?.targetWeightKg ?? exercise.sets[0]?.targetWeightKg ?? 0;
                  const r = last?.reps ?? last?.targetReps ?? exercise.sets[0]?.targetReps ?? 0;
                  onAddSet(exercise.id, { weightKg: w, reps: r });
                }
              }}
            >
              + 세트 추가 {exercise.sets.length > 0 && (
                <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.85 }}>
                  (마지막과 동일)
                </span>
              )}
            </button>

            <input
              type="text"
              value={exercise.note ?? ""}
              onChange={(e) =>
                onUpsertEntry(selectedDate, (entry) => ({
                  ...entry,
                  exercises: (entry.exercises ?? []).map((ex) =>
                    ex.id === exercise.id ? { ...ex, note: e.target.value } : ex
                  )
                }))
              }
              placeholder="메모 (중량 상승, 실패 세트 등)"
              style={{ width: "100%", padding: "8px 12px", borderRadius: 8, fontSize: 13, marginTop: 8, color: "var(--text-muted)" }}
            />
          </div>
        );
      })}

      <ExercisePicker
        customExercises={customExercises}
        recentExercises={recentExercises}
        alreadyAddedNames={new Set(exercises.map((ex) => ex.name))}
        onAddExercise={onAddExercise}
      />
    </>
  );
};

export const DayWorkoutEditor = memo(DayWorkoutEditorInner);
