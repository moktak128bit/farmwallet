import React, { useMemo, useState, useCallback } from "react";
import { toast } from "react-hot-toast";
import type { WorkoutWeek, WorkoutDayEntry, WorkoutExercise, WorkoutSet, WorkoutBodyPart, WorkoutRoutine, WorkoutRoutineExercise, CustomExercise } from "../types";
import { MonthCalendar, type EntryRef } from "../features/workout/MonthCalendar";
import { MonthStats } from "../features/workout/MonthStats";
import { RoutineManager } from "../features/workout/RoutineManager";
import { DayWorkoutEditor } from "../features/workout/DayWorkoutEditor";
import { ExerciseHistoryModal } from "../features/workout/ExerciseHistoryModal";
import { EXERCISE_PRESETS } from "../features/workout/constants";
import { getExerciseSessions, upsertCustomExercise } from "../utils/workoutStats";
import {
  toDateString, parseDate, getWeekStart, getMonthStart,
  formatDisplayDate, makeId, nowIso,
  computeExerciseVolume, getEntryBodyParts,
} from "../features/workout/helpers";

interface Props {
  workoutWeeks?: WorkoutWeek[];
  onChangeWorkoutWeeks: (weeks: WorkoutWeek[]) => void;
  workoutRoutines?: WorkoutRoutine[];
  onChangeWorkoutRoutines: (routines: WorkoutRoutine[]) => void;
  customExercises?: CustomExercise[];
  onChangeCustomExercises?: (list: CustomExercise[]) => void;
}

export const WorkoutView: React.FC<Props> = ({
  workoutWeeks = [],
  onChangeWorkoutWeeks,
  workoutRoutines = [],
  onChangeWorkoutRoutines,
  customExercises = [],
  onChangeCustomExercises,
}) => {
  const today = toDateString(new Date());
  const [currentMonth, setCurrentMonth] = useState<string>(() => getMonthStart(today));
  const [selectedDate, setSelectedDate] = useState<string>(today);
  // 종목별 진행 이력 모달
  const [historyExercise, setHistoryExercise] = useState<string | null>(null);
  const openHistory = useCallback((name: string) => {
    const sessions = getExerciseSessions(workoutWeeks, name);
    if (sessions.length === 0) {
      toast("아직 완료된 세트 기록이 없습니다");
      return;
    }
    setHistoryExercise(name);
  }, [workoutWeeks]);

  // 루틴 관리 섹션 펼침/편집 상태
  const [routinesExpanded, setRoutinesExpanded] = useState(false);
  const [editingRoutineId, setEditingRoutineId] = useState<string | null>(null);
  const [newRoutineName, setNewRoutineName] = useState("");
  const [routineExerciseDraft, setRoutineExerciseDraft] = useState<{
    name: string;
    bodyPart: WorkoutBodyPart;
    sets: string;
    reps: string;
    weight: string;
  }>({ name: "", bodyPart: "가슴", sets: "3", reps: "10", weight: "20" });

  const sortedWeeks = useMemo(
    () => [...workoutWeeks].sort((a, b) => b.weekStart.localeCompare(a.weekStart)),
    [workoutWeeks]
  );

  // 루틴 정렬: weekday 가 지정된 것부터 요일 순, 그 다음 생성 순서.
  const sortedRoutines = useMemo(() => {
    return [...workoutRoutines].sort((a, b) => {
      const aw = typeof a.weekday === "number" ? a.weekday : 99;
      const bw = typeof b.weekday === "number" ? b.weekday : 99;
      if (aw !== bw) return aw - bw;
      return 0;
    });
  }, [workoutRoutines]);

  // 선택된 날짜의 요일과 매칭되는 추천 루틴 id (버튼이 현재 보고 있는 날짜에 작동해야 자연스러움)
  const selectedWeekday = useMemo(() => parseDate(selectedDate).getDay(), [selectedDate]);
  const suggestedRoutineId = useMemo(
    () => sortedRoutines.find((r) => r.weekday === selectedWeekday)?.id ?? null,
    [sortedRoutines, selectedWeekday]
  );
  const suggestedRoutineName = useMemo(
    () => sortedRoutines.find((r) => r.id === suggestedRoutineId)?.name ?? null,
    [sortedRoutines, suggestedRoutineId]
  );

  const entryByDate = useMemo(() => {
    const map = new Map<string, EntryRef>();
    sortedWeeks.forEach((week) => {
      (week.entries ?? []).forEach((entry) => {
        if (!entry.date) return;
        if (!map.has(entry.date)) {
          map.set(entry.date, { weekId: week.id, weekStart: week.weekStart, entry });
        }
      });
    });
    return map;
  }, [sortedWeeks]);

  const selectedRef = entryByDate.get(selectedDate);
  const selectedEntry = selectedRef?.entry ?? null;

  const monthStats = useMemo(() => {
    const monthKey = currentMonth.slice(0, 7);
    let workoutDays = 0;
    let restDays = 0;
    let volume = 0;
    const partCounts = new Map<WorkoutBodyPart, number>();

    entryByDate.forEach(({ entry }, date) => {
      if (!date.startsWith(monthKey)) return;
      if (entry.type === "rest") {
        restDays += 1;
      } else {
        workoutDays += 1;
        volume += computeExerciseVolume(entry.exercises ?? []);
        getEntryBodyParts(entry).forEach((p) => partCounts.set(p, (partCounts.get(p) || 0) + 1));
      }
    });

    return { workoutDays, restDays, volume, partCounts };
  }, [currentMonth, entryByDate]);

  const moveMonth = (delta: number) => {
    setCurrentMonth((prev) => {
      const d = parseDate(prev);
      d.setMonth(d.getMonth() + delta);
      return getMonthStart(d);
    });
  };

  const goToday = () => {
    setCurrentMonth(getMonthStart(today));
    setSelectedDate(today);
  };

  const upsertEntry = useCallback((date: string, updater: (entry: WorkoutDayEntry) => WorkoutDayEntry) => {
    const weekStart = getWeekStart(date);

    const nextWeeks = [...workoutWeeks];
    const weekIndex = nextWeeks.findIndex((week) => week.weekStart === weekStart);

    const createBaseEntry = (): WorkoutDayEntry => ({
      id: makeId("day"),
      date,
      type: "workout",
      dayLabel: "",
      exercises: [],
      cardio: ""
    });

    if (weekIndex === -1) {
      const entry = updater(createBaseEntry());
      const newWeek: WorkoutWeek = {
        id: makeId("w"),
        weekStart,
        entries: [entry]
      };
      nextWeeks.push(newWeek);
    } else {
      const week = nextWeeks[weekIndex];
      const entries = [...(week.entries ?? [])];
      const entryIndex = entries.findIndex((entry) => entry.date === date);
      const baseEntry = entryIndex >= 0 ? entries[entryIndex] : createBaseEntry();
      const updatedEntry = updater({ ...baseEntry });

      if (entryIndex >= 0) {
        entries[entryIndex] = updatedEntry;
      } else {
        entries.push(updatedEntry);
      }
      entries.sort((a, b) => a.date.localeCompare(b.date));

      nextWeeks[weekIndex] = { ...week, entries };
    }

    nextWeeks.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    onChangeWorkoutWeeks(nextWeeks);
  }, [workoutWeeks, onChangeWorkoutWeeks]);

  const removeEntry = (date: string) => {
    const weekStart = getWeekStart(date);
    const nextWeeks = workoutWeeks
      .map((week) => {
        if (week.weekStart !== weekStart) return week;
        return { ...week, entries: (week.entries ?? []).filter((entry) => entry.date !== date) };
      })
      .filter((week) => (week.entries ?? []).length > 0);
    onChangeWorkoutWeeks(nextWeeks);
  };

  const addExercise = (name: string, bodyPart: WorkoutBodyPart) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    upsertEntry(selectedDate, (entry) => ({
      ...entry,
      type: "workout",
      exercises: [
        ...(entry.exercises ?? []),
        { id: makeId("ex"), name: trimmed, bodyPart, sets: [] }
      ]
    }));
    // 프리셋에 없는 이름이면 customExercises에 upsert (부위별 영구 저장)
    const isPreset = EXERCISE_PRESETS[bodyPart]?.includes(trimmed) ?? false;
    if (!isPreset && onChangeCustomExercises) {
      onChangeCustomExercises(upsertCustomExercise(customExercises, trimmed, bodyPart));
    }
  };

  const removeExercise = (exerciseId: string) => {
    upsertEntry(selectedDate, (entry) => ({
      ...entry,
      exercises: (entry.exercises ?? []).filter((ex) => ex.id !== exerciseId)
    }));
  };

  const addSet = (exerciseId: string, partial: Partial<WorkoutSet>) => {
    // 빠른 추가는 "방금 수행" 의미라 done=true 로 저장하며 완료 시각도 기록.
    const ts = nowIso();
    upsertEntry(selectedDate, (entry) => ({
      ...entry,
      startedAt: entry.startedAt ?? ts,
      exercises: (entry.exercises ?? []).map((ex) =>
        ex.id === exerciseId
          ? {
              ...ex,
              sets: [
                ...ex.sets,
                {
                  weightKg: partial.weightKg ?? 0,
                  reps: partial.reps ?? 0,
                  durationMin: partial.durationMin,
                  distanceKm: partial.distanceKm,
                  done: true,
                  completedAt: ts,
                },
              ],
            }
          : ex
      )
    }));
  };

  const removeSet = (exerciseId: string, setIndex: number) => {
    upsertEntry(selectedDate, (entry) => ({
      ...entry,
      exercises: (entry.exercises ?? []).map((ex) =>
        ex.id === exerciseId ? { ...ex, sets: ex.sets.filter((_, i) => i !== setIndex) } : ex
      )
    }));
  };

  const updateSet = (exerciseId: string, setIndex: number, patch: Partial<WorkoutSet>) => {
    upsertEntry(selectedDate, (entry) => ({
      ...entry,
      exercises: (entry.exercises ?? []).map((ex) =>
        ex.id === exerciseId
          ? {
              ...ex,
              sets: ex.sets.map((s, i) => (i === setIndex ? { ...s, ...patch } : s)),
            }
          : ex
      )
    }));
  };

  const toggleSetDone = (exerciseId: string, setIndex: number) => {
    const ts = nowIso();
    upsertEntry(selectedDate, (entry) => {
      const nextExercises = (entry.exercises ?? []).map((ex) =>
        ex.id === exerciseId
          ? {
              ...ex,
              // done=true 로 전환할 때만 completedAt 기록. 해제 시 지움.
              sets: ex.sets.map((s, i) => {
                if (i !== setIndex) return s;
                const nextDone = !s.done;
                return {
                  ...s,
                  done: nextDone,
                  completedAt: nextDone ? ts : undefined,
                };
              }),
            }
          : ex
      );
      // 모든 세트가 done 이면 endedAt 자동 기록 (없을 때만). 한 개라도 undone 이면 endedAt 유지.
      const allDone =
        nextExercises.length > 0 &&
        nextExercises.every((ex) => ex.sets.length > 0 && ex.sets.every((s) => s.done));
      return {
        ...entry,
        exercises: nextExercises,
        startedAt: entry.startedAt ?? ts,
        endedAt: allDone ? (entry.endedAt ?? ts) : entry.endedAt,
      };
    });
  };

  // 최근 사용한 운동 이름 (부위별)
  const recentExercises = useMemo(() => {
    const byPart = new Map<WorkoutBodyPart, Map<string, number>>();
    for (const week of workoutWeeks) {
      for (const entry of week.entries ?? []) {
        for (const ex of entry.exercises ?? []) {
          const part = ex.bodyPart ?? "기타";
          if (!byPart.has(part)) byPart.set(part, new Map());
          const nameMap = byPart.get(part)!;
          nameMap.set(ex.name, (nameMap.get(ex.name) || 0) + 1);
        }
      }
    }
    const result: Record<string, string[]> = {};
    byPart.forEach((nameMap, part) => {
      result[part] = [...nameMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name);
    });
    return result;
  }, [workoutWeeks]);

  // 운동 시작 (날짜에 기록 없을 때). 첫 시작 시각 기록.
  const startWorkout = () => {
    const ts = nowIso();
    upsertEntry(selectedDate, (entry) => ({
      ...entry,
      type: "workout",
      dayLabel: entry.dayLabel ?? "",
      exercises: entry.exercises ?? [],
      cardio: entry.cardio ?? "",
      startedAt: entry.startedAt ?? ts,
    }));
  };

  const endWorkout = () => {
    const ts = nowIso();
    upsertEntry(selectedDate, (entry) => ({
      ...entry,
      startedAt: entry.startedAt ?? ts,
      endedAt: ts,
    }));
  };

  const resumeWorkout = () => {
    upsertEntry(selectedDate, (entry) => ({ ...entry, endedAt: undefined }));
  };

  const startRest = () => {
    upsertEntry(selectedDate, (entry) => ({
      ...entry,
      type: "rest",
      dayLabel: entry.dayLabel || "휴식",
      exercises: undefined,
      restNotes: entry.restNotes ?? ""
    }));
  };

  // ---- 루틴 관리 ----
  const createRoutine = () => {
    const name = newRoutineName.trim();
    if (!name) {
      toast.error("루틴 이름을 입력하세요");
      return;
    }
    const routine: WorkoutRoutine = {
      id: makeId("routine"),
      name,
      exercises: [],
    };
    onChangeWorkoutRoutines([...workoutRoutines, routine]);
    setNewRoutineName("");
    setEditingRoutineId(routine.id);
  };

  const renameRoutine = (routineId: string, name: string) => {
    onChangeWorkoutRoutines(
      workoutRoutines.map((r) => (r.id === routineId ? { ...r, name } : r))
    );
  };

  const deleteRoutine = (routineId: string) => {
    onChangeWorkoutRoutines(workoutRoutines.filter((r) => r.id !== routineId));
    if (editingRoutineId === routineId) setEditingRoutineId(null);
  };

  const addRoutineExercise = (routineId: string) => {
    const name = routineExerciseDraft.name.trim();
    const sets = parseInt(routineExerciseDraft.sets, 10);
    const reps = parseInt(routineExerciseDraft.reps, 10);
    const weight = parseFloat(routineExerciseDraft.weight);
    if (!name) { toast.error("운동 이름을 입력하세요"); return; }
    if (!Number.isFinite(sets) || sets < 1) { toast.error("세트 수는 1 이상"); return; }
    if (!Number.isFinite(reps) || reps < 1) { toast.error("횟수는 1 이상"); return; }
    if (!Number.isFinite(weight) || weight < 0) { toast.error("중량은 0 이상"); return; }

    const newEx: WorkoutRoutineExercise = {
      id: makeId("rex"),
      name,
      bodyPart: routineExerciseDraft.bodyPart,
      targetSets: Math.min(100, sets),
      targetReps: reps,
      targetWeightKg: weight,
    };
    onChangeWorkoutRoutines(
      workoutRoutines.map((r) =>
        r.id === routineId ? { ...r, exercises: [...r.exercises, newEx] } : r
      )
    );
    setRoutineExerciseDraft((d) => ({ ...d, name: "" }));
  };

  const removeRoutineExercise = (routineId: string, exerciseId: string) => {
    onChangeWorkoutRoutines(
      workoutRoutines.map((r) =>
        r.id === routineId
          ? { ...r, exercises: r.exercises.filter((ex) => ex.id !== exerciseId) }
          : r
      )
    );
  };

  // 루틴 따라하기: 선택 날짜 기록에 루틴 운동 + 목표 세트 일괄 삽입.
  // 휴식 권장 루틴(restDay)은 휴식 기록으로 전환.
  const applyRoutine = (routineId: string) => {
    const routine = workoutRoutines.find((r) => r.id === routineId);
    if (!routine) return;

    if (routine.restDay) {
      upsertEntry(selectedDate, (entry) => ({
        ...entry,
        type: "rest",
        dayLabel: entry.dayLabel || routine.name,
        exercises: undefined,
        restNotes: [entry.restNotes, routine.note].filter(Boolean).join("\n") || routine.note || "",
      }));
      toast.success(`"${routine.name}" 적용`);
      return;
    }

    if (routine.exercises.length === 0) {
      toast.error("루틴에 운동이 없습니다");
      return;
    }
    upsertEntry(selectedDate, (entry) => {
      const generated: WorkoutExercise[] = routine.exercises.map((rex) => {
        // 계획 세트: 중량/반복을 목표치로 미리 채워 두고 done=false.
        // 사용자는 실제 수행 후 [✓] 체크 + 필요시 값 인라인 수정.
        const sets: WorkoutSet[] = Array.from({ length: rex.targetSets }, () => ({
          weightKg: rex.targetWeightKg,
          reps: rex.targetReps,
          done: false,
          targetWeightKg: rex.targetWeightKg,
          targetReps: rex.targetReps,
          targetRepsRange: rex.targetRepsRange,
          restSec: rex.restSec,
        }));
        return {
          id: makeId("ex"),
          name: rex.name,
          bodyPart: rex.bodyPart,
          sets,
          warmupNote: rex.warmupNote,
          cueNote: rex.cueNote,
        };
      });
      // 유산소 메모는 기존 값과 합치지 않고 루틴의 것으로 덮어쓴다 (비어 있을 때만).
      const nextCardio = entry.cardio && entry.cardio.trim().length > 0
        ? entry.cardio
        : (routine.cardioNote ?? "");
      return {
        ...entry,
        type: "workout",
        dayLabel: entry.dayLabel || routine.name,
        exercises: [...(entry.exercises ?? []), ...generated],
        cardio: nextCardio,
        startedAt: entry.startedAt ?? nowIso(),
      };
    });
    toast.success(`"${routine.name}" 루틴 불러옴`);
  };

  return (
    <div>
      <div className="section-header">
        <h2>운동 기록</h2>
        <button type="button" className="primary" onClick={goToday} style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600 }}>
          오늘로 이동
        </button>
      </div>

      <RoutineManager
        routines={workoutRoutines}
        sortedRoutines={sortedRoutines}
        expanded={routinesExpanded}
        onToggleExpanded={() => setRoutinesExpanded((v) => !v)}
        newRoutineName={newRoutineName}
        onChangeNewRoutineName={setNewRoutineName}
        onCreateRoutine={createRoutine}
        editingRoutineId={editingRoutineId}
        onSetEditingRoutineId={setEditingRoutineId}
        onRenameRoutine={renameRoutine}
        onDeleteRoutine={deleteRoutine}
        routineExerciseDraft={routineExerciseDraft}
        onChangeRoutineExerciseDraft={setRoutineExerciseDraft}
        onAddRoutineExercise={addRoutineExercise}
        onRemoveRoutineExercise={removeRoutineExercise}
      />

      <MonthCalendar
        currentMonth={currentMonth}
        selectedDate={selectedDate}
        today={today}
        entryByDate={entryByDate}
        onSelectDate={setSelectedDate}
        onMoveMonth={moveMonth}
        onEnsureMonthFor={setCurrentMonth}
      />

      <MonthStats stats={monthStats} />

      {/* 선택된 날짜 기록 */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{formatDisplayDate(selectedDate)}</h3>
          <div style={{ display: "flex", gap: 8 }}>
            {selectedEntry && (
              <button
                type="button"
                className="danger"
                style={{ padding: "8px 14px", fontSize: 13, fontWeight: 600 }}
                onClick={() => {
                  if (window.confirm("이 날짜 기록을 삭제하시겠습니까?")) removeEntry(selectedDate);
                }}
              >
                기록 삭제
              </button>
            )}
          </div>
        </div>

        <DayWorkoutEditor
          selectedEntry={selectedEntry}
          selectedDate={selectedDate}
          workoutRoutines={workoutRoutines}
          sortedRoutines={sortedRoutines}
          suggestedRoutineId={suggestedRoutineId}
          suggestedRoutineName={suggestedRoutineName}
          customExercises={customExercises}
          recentExercises={recentExercises}
          onStartWorkout={startWorkout}
          onStartRest={startRest}
          onEndWorkout={endWorkout}
          onResumeWorkout={resumeWorkout}
          onApplyRoutine={applyRoutine}
          onUpsertEntry={upsertEntry}
          onAddExercise={addExercise}
          onRemoveExercise={removeExercise}
          onAddSet={addSet}
          onRemoveSet={removeSet}
          onToggleSetDone={toggleSetDone}
          onUpdateSet={updateSet}
          onOpenHistory={openHistory}
        />

        {historyExercise && (
          <ExerciseHistoryModal
            exerciseName={historyExercise}
            workoutWeeks={workoutWeeks}
            onClose={() => setHistoryExercise(null)}
          />
        )}
      </div>
    </div>
  );
};
