import React, { useMemo, useState, useCallback } from "react";
import type { WorkoutWeek, WorkoutDayEntry, WorkoutExercise, WorkoutSet, WorkoutBodyPart } from "../types";
import { formatNumber } from "../utils/formatter";

interface Props {
  workoutWeeks?: WorkoutWeek[];
  onChangeWorkoutWeeks: (weeks: WorkoutWeek[]) => void;
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
  return new Date(`${dateStr}T12:00:00`);
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

export const WorkoutView: React.FC<Props> = ({ workoutWeeks = [], onChangeWorkoutWeeks }) => {
  const today = toDateString(new Date());
  const [currentMonth, setCurrentMonth] = useState<string>(() => getMonthStart(today));
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [selectedBodyPart, setSelectedBodyPart] = useState<WorkoutBodyPart | null>(null);
  const [customExerciseName, setCustomExerciseName] = useState("");
  // 빠른 세트 추가 상태: exerciseId별
  const [quickSetState, setQuickSetState] = useState<Record<string, { weight: string; reps: string; sets: string }>>({});

  const sortedWeeks = useMemo(
    () => [...workoutWeeks].sort((a, b) => b.weekStart.localeCompare(a.weekStart)),
    [workoutWeeks]
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
    upsertEntry(selectedDate, (entry) => ({
      ...entry,
      exercises: (entry.exercises ?? []).map((ex) =>
        ex.id === exerciseId ? { ...ex, sets: [...ex.sets, { weightKg, reps }] } : ex
      )
    }));
  };

  const addMultipleSets = (exerciseId: string, weightKg: number, reps: number, count: number) => {
    const newSets: WorkoutSet[] = Array.from({ length: count }, () => ({ weightKg, reps }));
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

  return (
    <div>
      <div className="section-header">
        <h2>운동 기록</h2>
        <button type="button" className="primary" onClick={goToday} style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600 }}>
          오늘로 이동
        </button>
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
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button type="button" className="primary" onClick={startWorkout}
              style={{ padding: "14px 28px", fontSize: 16, fontWeight: 700, borderRadius: 12, flex: 1, minWidth: 140 }}>
              운동 기록 시작
            </button>
            <button type="button" className="secondary" onClick={startRest}
              style={{ padding: "14px 28px", fontSize: 16, fontWeight: 700, borderRadius: 12, flex: 1, minWidth: 140 }}>
              휴식 기록
            </button>
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

              return (
                <div key={exercise.id} style={{
                  marginBottom: 14,
                  padding: 14,
                  border: `2px solid ${partColor}30`,
                  borderRadius: 12,
                  background: `${partColor}08`,
                }}>
                  {/* 운동 헤더 */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {exercise.bodyPart && (
                        <span style={{
                          padding: "3px 8px", fontSize: 11, fontWeight: 700, borderRadius: 6,
                          background: partColor + "20", color: partColor,
                        }}>
                          {exercise.bodyPart}
                        </span>
                      )}
                      <strong style={{ fontSize: 15 }}>{exercise.name}</strong>
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

                  {/* 세트 목록 */}
                  {exercise.sets.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      {exercise.sets.map((set, idx) => (
                        <div key={idx} style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "6px 12px", margin: "0 6px 6px 0",
                          background: "var(--surface)", borderRadius: 8,
                          border: "1px solid var(--border)", fontSize: 14, fontWeight: 600,
                        }}>
                          <span>{set.weightKg}kg × {set.reps}회</span>
                          <button
                            type="button"
                            onClick={() => removeSet(exercise.id, idx)}
                            style={{
                              background: "none", border: "none", cursor: "pointer",
                              color: "var(--text-muted)", fontSize: 14, padding: "0 2px", marginLeft: 4,
                            }}
                            title="세트 삭제"
                          >
                            ×
                          </button>
                        </div>
                      ))}
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
                        const w = Number(qs.weight);
                        const r = Number(qs.reps);
                        const s = Number(qs.sets) || 1;
                        if (w > 0 && r > 0) {
                          if (s === 1) addSet(exercise.id, w, r);
                          else addMultipleSets(exercise.id, w, r, s);
                          setQuickSet(exercise.id, "weight", qs.weight);
                          setQuickSet(exercise.id, "reps", qs.reps);
                        }
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
