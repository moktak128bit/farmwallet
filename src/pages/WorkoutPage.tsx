import React, { useMemo, useState, useCallback } from "react";
import { toast } from "react-hot-toast";
import type { WorkoutWeek, WorkoutDayEntry, WorkoutExercise, WorkoutSet, WorkoutBodyPart, WorkoutRoutine, WorkoutRoutineExercise } from "../types";
import { formatNumber } from "../utils/formatter";

interface Props {
  workoutWeeks?: WorkoutWeek[];
  onChangeWorkoutWeeks: (weeks: WorkoutWeek[]) => void;
  workoutRoutines?: WorkoutRoutine[];
  onChangeWorkoutRoutines: (routines: WorkoutRoutine[]) => void;
}

interface CalendarCell {
  date: string;
  inCurrentMonth: boolean;
}

interface EntryRef {
  weekId: string;
  weekStart: string;
  entry: WorkoutDayEntry;
}

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

const BODY_PARTS: WorkoutBodyPart[] = ["가슴", "등", "어깨", "팔", "하체", "코어", "유산소", "기타"];

const BODY_PART_COLORS: Record<WorkoutBodyPart, string> = {
  "가슴": "#ef4444",
  "등": "#3b82f6",
  "어깨": "#f59e0b",
  "팔": "#8b5cf6",
  "하체": "#10b981",
  "코어": "#ec4899",
  "유산소": "#06b6d4",
  "기타": "#64748b",
};

const EXERCISE_PRESETS: Record<WorkoutBodyPart, string[]> = {
  "가슴": ["벤치프레스", "인클라인 벤치프레스", "덤벨 프레스", "인클라인 덤벨", "체스트 플라이", "딥스", "케이블 크로스오버", "펙덱 플라이"],
  "등": ["데드리프트", "랫풀다운", "바벨 로우", "시티드 로우", "풀업", "원암 덤벨 로우", "케이블 로우", "티바 로우"],
  "어깨": ["오버헤드 프레스", "사이드 레터럴", "페이스풀", "덤벨 숄더 프레스", "프론트 레이즈", "리어 델트 플라이", "업라이트 로우", "아놀드 프레스"],
  "팔": ["바벨 컬", "해머 컬", "트라이셉 푸시다운", "스컬크러셔", "덤벨 컬", "케이블 컬", "오버헤드 익스텐션", "딥스(삼두)"],
  "하체": ["스쿼트", "레그 프레스", "레그 컬", "레그 익스텐션", "런지", "힙 쓰러스트", "RDL", "불가리안 스플릿"],
  "코어": ["크런치", "플랭크", "레그 레이즈", "사이드 플랭크", "행잉 레그 레이즈", "러시안 트위스트", "ab롤아웃", "케이블 크런치"],
  "유산소": ["러닝", "트레드밀", "사이클", "로잉머신", "줄넘기", "버피", "인터벌", "계단오르기"],
  "기타": [],
};

function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDate(dateStr: string): Date {
  // 유효한 "YYYY-MM-DD"면 정오 기준 로컬 Date. 잘못된 입력은 Invalid Date 대신
  // epoch 대체로 downstream에서 NaN 전파 차단.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr ?? "");
  if (!m) return new Date(1970, 0, 1, 12, 0, 0);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d, 12, 0, 0);
  if (Number.isNaN(dt.getTime())) return new Date(1970, 0, 1, 12, 0, 0);
  return dt;
}

function getWeekStart(dateLike: Date | string): string {
  const date = typeof dateLike === "string" ? parseDate(dateLike) : new Date(dateLike);
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
  local.setDate(local.getDate() - local.getDay());
  return toDateString(local);
}

function getMonthStart(dateLike: Date | string): string {
  const date = typeof dateLike === "string" ? parseDate(dateLike) : new Date(dateLike);
  const first = new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0);
  return toDateString(first);
}

function formatMonthLabel(monthStart: string): string {
  const d = parseDate(monthStart);
  return `${d.getFullYear()}년 ${String(d.getMonth() + 1).padStart(2, "0")}월`;
}

function formatDisplayDate(dateStr: string): string {
  return parseDate(dateStr).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  });
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function computeExerciseVolume(exercises: WorkoutExercise[]): number {
  return exercises.reduce(
    (sum, exercise) =>
      sum + exercise.sets.reduce((setSum, set) => setSum + set.weightKg * set.reps, 0),
    0
  );
}

/** 부위별 색상 도트 */
function getEntryBodyParts(entry: WorkoutDayEntry): WorkoutBodyPart[] {
  const parts = new Set<WorkoutBodyPart>();
  (entry.exercises ?? []).forEach((ex) => {
    if (ex.bodyPart) parts.add(ex.bodyPart);
  });
  return [...parts];
}

export const WorkoutView: React.FC<Props> = ({
  workoutWeeks = [],
  onChangeWorkoutWeeks,
  workoutRoutines = [],
  onChangeWorkoutRoutines,
}) => {
  const today = toDateString(new Date());
  const [currentMonth, setCurrentMonth] = useState<string>(() => getMonthStart(today));
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [selectedBodyPart, setSelectedBodyPart] = useState<WorkoutBodyPart | null>(null);
  const [customExerciseName, setCustomExerciseName] = useState("");
  // 빠른 세트 추가 상태: exerciseId별
  const [quickSetState, setQuickSetState] = useState<Record<string, { weight: string; reps: string; sets: string }>>({});
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

  const calendarCells = useMemo<CalendarCell[]>(() => {
    const monthDate = parseDate(currentMonth);
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstDay = new Date(year, month, 1, 12, 0, 0);
    const gridStart = new Date(year, month, 1 - firstDay.getDay(), 12, 0, 0);

    const cells: CalendarCell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      cells.push({
        date: toDateString(d),
        inCurrentMonth: d.getMonth() === month
      });
    }
    return cells;
  }, [currentMonth]);

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
    upsertEntry(selectedDate, (entry) => ({
      ...entry,
      type: "workout",
      exercises: [
        ...(entry.exercises ?? []),
        { id: makeId("ex"), name: name.trim(), bodyPart, sets: [] }
      ]
    }));
    setSelectedBodyPart(null);
    setCustomExerciseName("");
  };

  const removeExercise = (exerciseId: string) => {
    upsertEntry(selectedDate, (entry) => ({
      ...entry,
      exercises: (entry.exercises ?? []).filter((ex) => ex.id !== exerciseId)
    }));
  };

  const addSet = (exerciseId: string, weightKg: number, reps: number) => {
    // 빠른 추가는 "방금 수행" 의미라 done=true. 계획 세트(applyRoutine)는 false.
    upsertEntry(selectedDate, (entry) => ({
      ...entry,
      exercises: (entry.exercises ?? []).map((ex) =>
        ex.id === exerciseId ? { ...ex, sets: [...ex.sets, { weightKg, reps, done: true }] } : ex
      )
    }));
  };

  const addMultipleSets = (exerciseId: string, weightKg: number, reps: number, count: number) => {
    const newSets: WorkoutSet[] = Array.from({ length: count }, () => ({ weightKg, reps, done: true }));
    upsertEntry(selectedDate, (entry) => ({
      ...entry,
      exercises: (entry.exercises ?? []).map((ex) =>
        ex.id === exerciseId ? { ...ex, sets: [...ex.sets, ...newSets] } : ex
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
    upsertEntry(selectedDate, (entry) => ({
      ...entry,
      exercises: (entry.exercises ?? []).map((ex) =>
        ex.id === exerciseId
          ? {
              ...ex,
              sets: ex.sets.map((s, i) => (i === setIndex ? { ...s, done: !s.done } : s)),
            }
          : ex
      )
    }));
  };

  const getQuickSet = (exId: string) => quickSetState[exId] ?? { weight: "", reps: "", sets: "1" };
  const setQuickSet = (exId: string, field: string, value: string) => {
    setQuickSetState((prev) => ({ ...prev, [exId]: { ...getQuickSet(exId), [field]: value } }));
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

  // 운동 시작 (날짜에 기록 없을 때)
  const startWorkout = () => {
    upsertEntry(selectedDate, (entry) => ({
      ...entry,
      type: "workout",
      dayLabel: entry.dayLabel ?? "",
      exercises: entry.exercises ?? [],
      cardio: entry.cardio ?? ""
    }));
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

      {/* 루틴 관리 (펼침/접힘) */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setRoutinesExpanded((v) => !v)}
          style={{
            width: "100%", background: "none", border: "none", cursor: "pointer",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: 0, fontSize: 16, fontWeight: 700, color: "var(--text)",
          }}
        >
          <span>운동 루틴 ({workoutRoutines.length})</span>
          <span style={{ fontSize: 14, color: "var(--text-muted)" }}>
            {routinesExpanded ? "▲ 접기" : "▼ 펼치기"}
          </span>
        </button>

        {routinesExpanded && (
          <div style={{ marginTop: 14 }}>
            {/* 루틴 생성 */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                type="text"
                value={newRoutineName}
                onChange={(e) => setNewRoutineName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") createRoutine(); }}
                placeholder="새 루틴 이름 (예: 푸시 데이)"
                style={{ flex: 1, padding: "8px 12px", borderRadius: 8, fontSize: 14 }}
              />
              <button
                type="button"
                className="primary"
                onClick={createRoutine}
                style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600 }}
              >
                루틴 추가
              </button>
            </div>

            {/* 루틴 목록 */}
            {workoutRoutines.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                아직 루틴이 없습니다. 이름을 입력하고 추가하세요.
              </div>
            ) : (
              sortedRoutines.map((routine) => {
                const isEditing = editingRoutineId === routine.id;
                return (
                  <div key={routine.id} style={{
                    marginBottom: 10, padding: 12, borderRadius: 10,
                    border: "1px solid var(--border)", background: "var(--surface)",
                  }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: isEditing ? 10 : 0 }}>
                      <input
                        type="text"
                        value={routine.name}
                        onChange={(e) => renameRoutine(routine.id, e.target.value)}
                        style={{ flex: 1, padding: "6px 10px", borderRadius: 6, fontSize: 14, fontWeight: 600 }}
                      />
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                        {routine.exercises.length}종목
                      </span>
                      <button
                        type="button"
                        className="secondary"
                        style={{ padding: "6px 12px", fontSize: 13 }}
                        onClick={() => setEditingRoutineId(isEditing ? null : routine.id)}
                      >
                        {isEditing ? "닫기" : "편집"}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        style={{ padding: "6px 12px", fontSize: 13 }}
                        onClick={() => {
                          if (window.confirm(`"${routine.name}" 루틴을 삭제하시겠습니까?`)) deleteRoutine(routine.id);
                        }}
                      >
                        삭제
                      </button>
                    </div>

                    {isEditing && (
                      <div>
                        {/* 루틴 내 운동 목록 */}
                        {routine.exercises.length > 0 && (
                          <div style={{ marginBottom: 10 }}>
                            {routine.exercises.map((rex) => {
                              const color = BODY_PART_COLORS[rex.bodyPart];
                              return (
                                <div key={rex.id} style={{
                                  display: "flex", alignItems: "center", gap: 8,
                                  padding: "6px 10px", marginBottom: 4, borderRadius: 6,
                                  background: color + "10", border: `1px solid ${color}30`,
                                }}>
                                  <span style={{
                                    padding: "2px 6px", fontSize: 11, fontWeight: 700, borderRadius: 4,
                                    background: color + "20", color,
                                  }}>
                                    {rex.bodyPart}
                                  </span>
                                  <strong style={{ fontSize: 14, flex: 1 }}>{rex.name}</strong>
                                  <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                                    {rex.targetSets}세트 × {rex.targetReps}회 × {rex.targetWeightKg}kg
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => removeRoutineExercise(routine.id, rex.id)}
                                    style={{
                                      background: "none", border: "none", cursor: "pointer",
                                      color: "var(--text-muted)", fontSize: 16,
                                    }}
                                    title="운동 삭제"
                                  >
                                    ×
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* 운동 추가 입력 */}
                        <div style={{
                          padding: 10, borderRadius: 8, background: "var(--bg, transparent)",
                          border: "1px dashed var(--border)",
                        }}>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                            {BODY_PARTS.map((part) => (
                              <button
                                key={part}
                                type="button"
                                onClick={() => setRoutineExerciseDraft((d) => ({ ...d, bodyPart: part }))}
                                style={{
                                  padding: "5px 10px", fontSize: 12, fontWeight: 600, borderRadius: 6,
                                  border: routineExerciseDraft.bodyPart === part
                                    ? `2px solid ${BODY_PART_COLORS[part]}`
                                    : "1px solid var(--border)",
                                  background: routineExerciseDraft.bodyPart === part
                                    ? BODY_PART_COLORS[part] + "18"
                                    : "var(--surface)",
                                  color: routineExerciseDraft.bodyPart === part
                                    ? BODY_PART_COLORS[part]
                                    : "var(--text)",
                                  cursor: "pointer",
                                }}
                              >
                                {part}
                              </button>
                            ))}
                          </div>
                          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                            <input
                              type="text"
                              value={routineExerciseDraft.name}
                              onChange={(e) => setRoutineExerciseDraft((d) => ({ ...d, name: e.target.value }))}
                              placeholder="운동 이름"
                              style={{ flex: 1, minWidth: 140, padding: "6px 10px", borderRadius: 6, fontSize: 13 }}
                            />
                            <input
                              type="number"
                              min={1}
                              value={routineExerciseDraft.sets}
                              onChange={(e) => setRoutineExerciseDraft((d) => ({ ...d, sets: e.target.value }))}
                              placeholder="세트"
                              style={{ width: 56, padding: "6px 8px", borderRadius: 6, fontSize: 13, textAlign: "center" }}
                            />
                            <span style={{ fontSize: 13 }}>×</span>
                            <input
                              type="number"
                              min={1}
                              value={routineExerciseDraft.reps}
                              onChange={(e) => setRoutineExerciseDraft((d) => ({ ...d, reps: e.target.value }))}
                              placeholder="횟수"
                              style={{ width: 56, padding: "6px 8px", borderRadius: 6, fontSize: 13, textAlign: "center" }}
                            />
                            <span style={{ fontSize: 13 }}>×</span>
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              value={routineExerciseDraft.weight}
                              onChange={(e) => setRoutineExerciseDraft((d) => ({ ...d, weight: e.target.value }))}
                              placeholder="kg"
                              style={{ width: 70, padding: "6px 8px", borderRadius: 6, fontSize: 13, textAlign: "center" }}
                            />
                            <button
                              type="button"
                              className="primary"
                              onClick={() => addRoutineExercise(routine.id)}
                              style={{ padding: "6px 14px", fontSize: 13, fontWeight: 600 }}
                            >
                              추가
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* 캘린더 */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <button type="button" className="secondary" onClick={() => moveMonth(-1)} style={{ padding: "8px 14px", fontSize: 14, fontWeight: 600 }}>
            ◀ 이전
          </button>
          <strong style={{ fontSize: 18 }}>{formatMonthLabel(currentMonth)}</strong>
          <button type="button" className="secondary" onClick={() => moveMonth(1)} style={{ padding: "8px 14px", fontSize: 14, fontWeight: 600 }}>
            다음 ▶
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4, marginBottom: 4 }}>
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} style={{ textAlign: "center", fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
              {label}
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4 }}>
          {calendarCells.map((cell) => {
            const ref = entryByDate.get(cell.date);
            const entry = ref?.entry;
            const isSelected = cell.date === selectedDate;
            const isToday = cell.date === today;
            const parts = entry?.type === "workout" ? getEntryBodyParts(entry) : [];

            return (
              <button
                key={cell.date}
                type="button"
                onClick={() => {
                  setSelectedDate(cell.date);
                  if (!cell.inCurrentMonth) setCurrentMonth(getMonthStart(cell.date));
                }}
                style={{
                  minHeight: 72,
                  textAlign: "left",
                  padding: 6,
                  borderRadius: 8,
                  border: isSelected ? "2px solid var(--primary)" : isToday ? "2px solid var(--text-muted)" : "1px solid var(--border)",
                  background: entry
                    ? entry.type === "rest"
                      ? "rgba(59,130,246,0.08)"
                      : "rgba(16,185,129,0.08)"
                    : "var(--surface)",
                  opacity: cell.inCurrentMonth ? 1 : 0.4,
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13 }}>{Number(cell.date.slice(8, 10))}</div>
                {entry ? (
                  <>
                    {entry.type === "rest" ? (
                      <div style={{ fontSize: 11, color: "#3b82f6", fontWeight: 600 }}>휴식</div>
                    ) : (
                      <>
                        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                          {parts.map((p) => (
                            <span
                              key={p}
                              style={{
                                width: 8, height: 8, borderRadius: "50%",
                                background: BODY_PART_COLORS[p],
                                display: "inline-block",
                              }}
                              title={p}
                            />
                          ))}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                          {(entry.exercises?.length ?? 0)}종목
                        </div>
                      </>
                    )}
                  </>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* 월간 통계 */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 12 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>운동일</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "var(--success)" }}>{monthStats.workoutDays}일</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>휴식일</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#3b82f6" }}>{monthStats.restDays}일</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>월간 볼륨</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{formatNumber(monthStats.volume)}kg</div>
          </div>
        </div>
        {monthStats.partCounts.size > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            {[...monthStats.partCounts.entries()].sort((a, b) => b[1] - a[1]).map(([part, count]) => (
              <span key={part} style={{
                padding: "4px 10px", fontSize: 12, fontWeight: 600, borderRadius: 12,
                background: BODY_PART_COLORS[part] + "20", color: BODY_PART_COLORS[part],
                border: `1px solid ${BODY_PART_COLORS[part]}40`,
              }}>
                {part} {count}회
              </span>
            ))}
          </div>
        )}
      </div>

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

        {!selectedEntry ? (
          <div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: workoutRoutines.length > 0 ? 12 : 0 }}>
              <button type="button" className="primary" onClick={startWorkout}
                style={{ padding: "14px 28px", fontSize: 16, fontWeight: 700, borderRadius: 12, flex: 1, minWidth: 140 }}>
                운동 기록 시작
              </button>
              <button type="button" className="secondary" onClick={startRest}
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
                  onChange={(e) => { if (e.target.value) applyRoutine(e.target.value); }}
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
                    onClick={() => applyRoutine(suggestedRoutineId)}
                    style={{ padding: "8px 14px", fontSize: 13, fontWeight: 700 }}
                    title={suggestedRoutineName ? `${suggestedRoutineName} 적용` : "요일 루틴 적용"}
                  >
                    이 요일 계획 적용
                  </button>
                )}
              </div>
            )}
          </div>
        ) : selectedEntry.type === "rest" ? (
          <div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button type="button" className={selectedEntry.type === "rest" ? "primary" : "secondary"}
                style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600 }}
                onClick={() => upsertEntry(selectedDate, (e) => ({ ...e, type: "rest" }))}>
                휴식
              </button>
              <button type="button" className="secondary"
                style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600 }}
                onClick={() => upsertEntry(selectedDate, (e) => ({ ...e, type: "workout", exercises: e.exercises ?? [] }))}>
                운동으로 변경
              </button>
            </div>
            <textarea
              rows={3}
              value={selectedEntry.restNotes ?? ""}
              onChange={(e) => upsertEntry(selectedDate, (entry) => ({ ...entry, restNotes: e.target.value }))}
              placeholder="수면, 컨디션, 피로도 등을 기록하세요"
              style={{ width: "100%", padding: 12, borderRadius: 8, resize: "vertical", fontSize: 14 }}
            />
          </div>
        ) : (
          <>
            {/* 유형 전환 + 라벨 + 유산소 */}
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" className="primary" style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600 }}>
                운동
              </button>
              <button type="button" className="secondary"
                style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600 }}
                onClick={() => upsertEntry(selectedDate, (e) => ({ ...e, type: "rest", restNotes: e.restNotes ?? "" }))}>
                휴식으로 변경
              </button>
              <input
                type="text"
                value={selectedEntry.dayLabel ?? ""}
                onChange={(e) => upsertEntry(selectedDate, (entry) => ({ ...entry, dayLabel: e.target.value }))}
                placeholder="라벨 (예: 상체, 등+이두)"
                style={{ padding: "8px 12px", borderRadius: 8, fontSize: 14, flex: 1, minWidth: 140 }}
              />
              {workoutRoutines.length > 0 && (
                <select
                  value=""
                  onChange={(e) => { if (e.target.value) applyRoutine(e.target.value); }}
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

            {/* 유산소 입력 */}
            <div style={{ marginBottom: 16 }}>
              <input
                type="text"
                value={selectedEntry.cardio ?? ""}
                onChange={(e) => upsertEntry(selectedDate, (entry) => ({ ...entry, cardio: e.target.value }))}
                placeholder="유산소 (예: 러닝 3km, 트레드밀 10분)"
                style={{ width: "100%", padding: "10px 12px", borderRadius: 8, fontSize: 14 }}
              />
            </div>

            {/* 기록된 운동들 */}
            {(selectedEntry.exercises ?? []).map((exercise) => {
              const volume = computeExerciseVolume([exercise]);
              const qs = getQuickSet(exercise.id);
              const partColor = exercise.bodyPart ? BODY_PART_COLORS[exercise.bodyPart] : "#64748b";
              const doneCount = exercise.sets.filter((s) => s.done).length;
              const totalCount = exercise.sets.length;
              const isAllDone = totalCount > 0 && doneCount === totalCount;

              return (
                <div key={exercise.id} style={{
                  marginBottom: 14,
                  padding: 14,
                  border: `2px solid ${partColor}30`,
                  borderRadius: 12,
                  background: `${partColor}08`,
                }}>
                  {/* 운동 헤더 */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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
                      {volume > 0 && (
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          볼륨 {formatNumber(volume)}kg
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="danger"
                      style={{ fontSize: 13, padding: "6px 12px" }}
                      onClick={() => removeExercise(exercise.id)}
                    >
                      삭제
                    </button>
                  </div>

                  {/* 워밍업 지침 */}
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

                  {/* 자극 포인트 / 수행 큐 */}
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

                  {/* 세트 목록 — 따라하기 레이아웃: [✓] 세트N | 중량입력 × 반복입력 | 목표표시 | 삭제 */}
                  {exercise.sets.length > 0 && (
                    <div style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                      {exercise.sets.map((set, idx) => {
                        const hasTarget = set.targetWeightKg !== undefined || set.targetReps !== undefined;
                        const targetLabel = hasTarget
                          ? `목표 ${set.targetWeightKg ?? 0}kg × ${set.targetRepsRange ?? set.targetReps ?? 0}회`
                          : null;
                        return (
                          <div key={idx} style={{
                            display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                            padding: "8px 10px", borderRadius: 8,
                            background: set.done ? "rgba(16,185,129,0.12)" : "var(--surface)",
                            border: `1px solid ${set.done ? "#10b98150" : "var(--border)"}`,
                            opacity: 1,
                          }}>
                            <button
                              type="button"
                              onClick={() => toggleSetDone(exercise.id, idx)}
                              aria-label={set.done ? "완료 해제" : "완료로 표시"}
                              title={set.done ? "완료 해제" : "완료로 표시"}
                              style={{
                                width: 28, height: 28, borderRadius: 8,
                                border: `2px solid ${set.done ? "#10b981" : "var(--border)"}`,
                                background: set.done ? "#10b981" : "var(--surface)",
                                color: set.done ? "#fff" : "transparent",
                                cursor: "pointer", fontSize: 16, fontWeight: 900,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                flexShrink: 0,
                              }}
                            >
                              ✓
                            </button>
                            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, minWidth: 40 }}>
                              세트 {idx + 1}
                            </span>
                            <input
                              type="number"
                              min={0}
                              step={0.5}
                              value={set.weightKg}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value);
                                updateSet(exercise.id, idx, { weightKg: Number.isFinite(v) ? v : 0 });
                              }}
                              style={{
                                width: 72, padding: "6px 8px", borderRadius: 6, fontSize: 14,
                                textAlign: "center", fontWeight: 600,
                              }}
                              aria-label="중량(kg)"
                            />
                            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>kg ×</span>
                            <input
                              type="number"
                              min={0}
                              value={set.reps}
                              onChange={(e) => {
                                const v = parseInt(e.target.value, 10);
                                updateSet(exercise.id, idx, { reps: Number.isFinite(v) ? v : 0 });
                              }}
                              style={{
                                width: 58, padding: "6px 8px", borderRadius: 6, fontSize: 14,
                                textAlign: "center", fontWeight: 600,
                              }}
                              aria-label="횟수"
                            />
                            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>회</span>
                            {targetLabel && (
                              <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 4 }}>
                                {targetLabel}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => removeSet(exercise.id, idx)}
                              style={{
                                marginLeft: "auto",
                                background: "none", border: "none", cursor: "pointer",
                                color: "var(--text-muted)", fontSize: 18, padding: "0 4px",
                              }}
                              title="세트 삭제"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* 빠른 세트 추가 */}
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={qs.weight}
                      onChange={(e) => setQuickSet(exercise.id, "weight", e.target.value)}
                      placeholder="중량(kg)"
                      style={{ width: 90, padding: "8px 10px", borderRadius: 8, fontSize: 14, textAlign: "center" }}
                    />
                    <span style={{ fontWeight: 700 }}>×</span>
                    <input
                      type="number"
                      min={1}
                      value={qs.reps}
                      onChange={(e) => setQuickSet(exercise.id, "reps", e.target.value)}
                      placeholder="횟수"
                      style={{ width: 70, padding: "8px 10px", borderRadius: 8, fontSize: 14, textAlign: "center" }}
                    />
                    <span style={{ fontWeight: 700 }}>×</span>
                    <input
                      type="number"
                      min={1}
                      value={qs.sets}
                      onChange={(e) => setQuickSet(exercise.id, "sets", e.target.value)}
                      placeholder="세트"
                      style={{ width: 60, padding: "8px 10px", borderRadius: 8, fontSize: 14, textAlign: "center" }}
                    />
                    <span style={{ fontSize: 13, color: "var(--text-muted)" }}>세트</span>
                    <button
                      type="button"
                      className="primary"
                      style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600, borderRadius: 8 }}
                      onClick={() => {
                        // 파싱 + 엣지 방어: NaN/Infinity/음수/0 모두 차단 + 사용자 피드백
                        const w = parseFloat(qs.weight);
                        const r = parseInt(qs.reps, 10);
                        const s = Math.max(1, Math.min(100, parseInt(qs.sets, 10) || 1));
                        if (!Number.isFinite(w) || w <= 0) {
                          toast.error("중량을 0보다 큰 숫자로 입력하세요");
                          return;
                        }
                        if (!Number.isFinite(r) || r <= 0) {
                          toast.error("횟수를 1 이상으로 입력하세요");
                          return;
                        }
                        if (s === 1) addSet(exercise.id, w, r);
                        else addMultipleSets(exercise.id, w, r, s);
                        // 입력 리셋 정책: 동일 무게로 연속 세트 추가하는 워크플로우가 많아
                        // weight/reps는 유지하되 sets 개수는 기본 "1"로 되돌려 실수 방지
                        setQuickSet(exercise.id, "sets", "1");
                      }}
                    >
                      추가
                    </button>
                  </div>

                  {/* 메모 */}
                  <input
                    type="text"
                    value={exercise.note ?? ""}
                    onChange={(e) =>
                      upsertEntry(selectedDate, (entry) => ({
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

            {/* 운동 추가 — 부위 선택 → 운동 선택 */}
            <div style={{
              marginTop: 16, padding: 16, borderRadius: 12,
              border: "2px dashed var(--border)", background: "var(--surface)",
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>운동 추가</div>

              {/* 부위 선택 버튼 */}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                {BODY_PARTS.map((part) => (
                  <button
                    key={part}
                    type="button"
                    onClick={() => setSelectedBodyPart(selectedBodyPart === part ? null : part)}
                    style={{
                      padding: "8px 16px",
                      fontSize: 14,
                      fontWeight: 700,
                      borderRadius: 10,
                      border: selectedBodyPart === part
                        ? `2px solid ${BODY_PART_COLORS[part]}`
                        : "2px solid var(--border)",
                      background: selectedBodyPart === part
                        ? BODY_PART_COLORS[part] + "18"
                        : "var(--surface)",
                      color: selectedBodyPart === part
                        ? BODY_PART_COLORS[part]
                        : "var(--text)",
                      cursor: "pointer",
                    }}
                  >
                    {part}
                  </button>
                ))}
              </div>

              {/* 선택된 부위의 운동 목록 */}
              {selectedBodyPart && (
                <div>
                  {/* 최근 사용 운동 */}
                  {(recentExercises[selectedBodyPart] ?? []).length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, fontWeight: 600 }}>최근 사용</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {(recentExercises[selectedBodyPart] ?? []).filter((name) =>
                          !EXERCISE_PRESETS[selectedBodyPart].includes(name)
                        ).slice(0, 8).map((name) => (
                          <button
                            key={name}
                            type="button"
                            onClick={() => addExercise(name, selectedBodyPart)}
                            style={{
                              padding: "8px 14px", fontSize: 13, fontWeight: 600, borderRadius: 8,
                              border: `1px solid ${BODY_PART_COLORS[selectedBodyPart]}40`,
                              background: BODY_PART_COLORS[selectedBodyPart] + "10",
                              color: "var(--text)", cursor: "pointer",
                            }}
                          >
                            {name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 프리셋 운동 */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, fontWeight: 600 }}>추천 운동</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {EXERCISE_PRESETS[selectedBodyPart].map((name) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => addExercise(name, selectedBodyPart)}
                          style={{
                            padding: "8px 14px", fontSize: 13, fontWeight: 600, borderRadius: 8,
                            border: "1px solid var(--border)", background: "var(--surface)",
                            color: "var(--text)", cursor: "pointer",
                          }}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 직접 입력 */}
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="text"
                      value={customExerciseName}
                      onChange={(e) => setCustomExerciseName(e.target.value)}
                      placeholder="직접 입력"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && customExerciseName.trim()) {
                          addExercise(customExerciseName, selectedBodyPart);
                        }
                      }}
                      style={{ flex: 1, padding: "8px 12px", borderRadius: 8, fontSize: 14 }}
                    />
                    <button
                      type="button"
                      className="secondary"
                      style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600 }}
                      onClick={() => {
                        if (customExerciseName.trim()) addExercise(customExerciseName, selectedBodyPart);
                      }}
                    >
                      추가
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
