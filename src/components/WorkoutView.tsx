import React, { useMemo, useState } from "react";
import type { WorkoutWeek, WorkoutDayEntry, WorkoutExercise, WorkoutSet } from "../types";
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

const DAY_TEMPLATE: Array<{
  offset: number;
  type: "workout" | "rest";
  dayLabel: string;
}> = [
  { offset: 0, type: "workout", dayLabel: "Day 1 (상체)" },
  { offset: 1, type: "rest", dayLabel: "휴식" },
  { offset: 2, type: "workout", dayLabel: "Day 2 (하체)" }
];

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

function getDateByOffset(weekStart: string, offset: number): string {
  const d = parseDate(weekStart);
  d.setDate(d.getDate() + offset);
  return toDateString(d);
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

const AddSetForm: React.FC<{
  onAdd: (weightKg: number, reps: number) => void;
}> = ({ onAdd }) => {
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const weightKg = Number(weight.replace(/,/g, ""));
    const repsValue = Number(reps.replace(/,/g, ""));
    if (weightKg > 0 && repsValue > 0) {
      onAdd(weightKg, repsValue);
      setWeight("");
      setReps("");
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}
    >
      <input
        type="number"
        min={0}
        step={0.5}
        value={weight}
        onChange={(e) => setWeight(e.target.value)}
        placeholder="중량(kg)"
        style={{ width: 84, padding: "4px 6px", borderRadius: 4 }}
      />
      <span>x</span>
      <input
        type="number"
        min={1}
        value={reps}
        onChange={(e) => setReps(e.target.value)}
        placeholder="반복"
        style={{ width: 70, padding: "4px 6px", borderRadius: 4 }}
      />
      <span>회</span>
      <button type="submit" className="secondary" style={{ fontSize: 12, padding: "4px 10px" }}>
        세트 추가
      </button>
    </form>
  );
};

export const WorkoutView: React.FC<Props> = ({ workoutWeeks = [], onChangeWorkoutWeeks }) => {
  const today = toDateString(new Date());
  const [currentMonth, setCurrentMonth] = useState<string>(() => getMonthStart(today));
  const [selectedDate, setSelectedDate] = useState<string>(today);

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

    entryByDate.forEach(({ entry }, date) => {
      if (!date.startsWith(monthKey)) return;
      if (entry.type === "rest") {
        restDays += 1;
      } else {
        workoutDays += 1;
        volume += computeExerciseVolume(entry.exercises ?? []);
      }
    });

    return { workoutDays, restDays, volume };
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

  const upsertEntry = (date: string, updater: (entry: WorkoutDayEntry) => WorkoutDayEntry) => {
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

      nextWeeks[weekIndex] = {
        ...week,
        entries
      };
    }

    nextWeeks.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    onChangeWorkoutWeeks(nextWeeks);
  };

  const removeEntry = (date: string) => {
    const weekStart = getWeekStart(date);
    const nextWeeks = workoutWeeks
      .map((week) => {
        if (week.weekStart !== weekStart) return week;
        return {
          ...week,
          entries: (week.entries ?? []).filter((entry) => entry.date !== date)
        };
      })
      .filter((week) => (week.entries ?? []).length > 0);

    onChangeWorkoutWeeks(nextWeeks);
  };

  const addExercise = () => {
    const name = window.prompt("운동 이름을 입력하세요 (예: 벤치프레스)");
    if (!name?.trim()) return;

    upsertEntry(selectedDate, (entry) => ({
      ...entry,
      type: "workout",
      exercises: [
        ...(entry.exercises ?? []),
        {
          id: makeId("ex"),
          name: name.trim(),
          sets: []
        }
      ]
    }));
  };

  const addCurrentWeekTemplate = () => {
    const weekStart = getWeekStart(today);
    const existingWeek = workoutWeeks.find((week) => week.weekStart === weekStart);

    const templateEntries = DAY_TEMPLATE.map(({ offset, type, dayLabel }) => ({
      id: makeId("day"),
      date: getDateByOffset(weekStart, offset),
      type,
      dayLabel,
      exercises: type === "workout" ? [] : undefined,
      restNotes: type === "rest" ? "" : undefined,
      cardio: type === "workout" ? "" : undefined
    }));

    if (!existingWeek) {
      onChangeWorkoutWeeks([
        ...workoutWeeks,
        {
          id: makeId("w"),
          weekStart,
          entries: templateEntries
        }
      ]);
      return;
    }

    const existingDates = new Set((existingWeek.entries ?? []).map((entry) => entry.date));
    const mergedEntries = [
      ...(existingWeek.entries ?? []),
      ...templateEntries.filter((entry) => !existingDates.has(entry.date))
    ].sort((a, b) => a.date.localeCompare(b.date));

    onChangeWorkoutWeeks(
      workoutWeeks.map((week) =>
        week.id === existingWeek.id
          ? {
              ...week,
              entries: mergedEntries
            }
          : week
      )
    );
  };

  return (
    <div>
      <div className="section-header">
        <h2>운동 기록 캘린더</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="secondary" onClick={addCurrentWeekTemplate}>
            이번 주 기본 템플릿 추가
          </button>
          <button type="button" className="primary" onClick={goToday}>
            오늘로 이동
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <button type="button" className="secondary" onClick={() => moveMonth(-1)}>
            이전 달
          </button>
          <strong style={{ fontSize: 18 }}>{formatMonthLabel(currentMonth)}</strong>
          <button type="button" className="secondary" onClick={() => moveMonth(1)}>
            다음 달
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6, marginBottom: 6 }}>
          {WEEKDAY_LABELS.map((label) => (
            <div key={label} style={{ textAlign: "center", fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
              {label}
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
          {calendarCells.map((cell) => {
            const ref = entryByDate.get(cell.date);
            const entry = ref?.entry;
            const isSelected = cell.date === selectedDate;
            const dayVolume = entry?.type === "workout" ? computeExerciseVolume(entry.exercises ?? []) : 0;

            return (
              <button
                key={cell.date}
                type="button"
                onClick={() => {
                  setSelectedDate(cell.date);
                  if (!cell.inCurrentMonth) {
                    setCurrentMonth(getMonthStart(cell.date));
                  }
                }}
                style={{
                  minHeight: 110,
                  textAlign: "left",
                  padding: 8,
                  borderRadius: 8,
                  border: isSelected ? "2px solid var(--primary)" : "1px solid var(--border)",
                  background: entry
                    ? entry.type === "rest"
                      ? "rgba(59,130,246,0.08)"
                      : "rgba(16,185,129,0.08)"
                    : "var(--surface)",
                  opacity: cell.inCurrentMonth ? 1 : 0.5,
                  cursor: "pointer"
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 6 }}>{Number(cell.date.slice(8, 10))}</div>
                {entry ? (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>
                      {entry.type === "rest" ? "휴식" : `운동 ${entry.exercises?.length ?? 0}개`}
                    </div>
                    {entry.type === "workout" && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                        볼륨 {formatNumber(dayVolume)}kg
                      </div>
                    )}
                    {entry.cardio && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {entry.cardio}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>기록 없음</div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>운동일</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{monthStats.workoutDays}일</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>휴식일</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{monthStats.restDays}일</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>월간 볼륨</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{formatNumber(monthStats.volume)}kg</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{formatDisplayDate(selectedDate)} 기록</h3>
          {selectedEntry && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                if (window.confirm("이 날짜 기록을 삭제하시겠습니까?")) {
                  removeEntry(selectedDate);
                }
              }}
            >
              기록 삭제
            </button>
          )}
        </div>

        {!selectedEntry ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="primary"
              onClick={() =>
                upsertEntry(selectedDate, (entry) => ({
                  ...entry,
                  type: "workout",
                  dayLabel: entry.dayLabel ?? "",
                  exercises: entry.exercises ?? [],
                  cardio: entry.cardio ?? ""
                }))
              }
            >
              운동 기록 시작
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                upsertEntry(selectedDate, (entry) => ({
                  ...entry,
                  type: "rest",
                  dayLabel: entry.dayLabel || "휴식",
                  exercises: undefined,
                  restNotes: entry.restNotes ?? ""
                }))
              }
            >
              휴식 기록 시작
            </button>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 13 }}>유형</span>
              <select
                value={selectedEntry.type}
                onChange={(e) => {
                  const nextType = e.target.value as "workout" | "rest";
                  upsertEntry(selectedDate, (entry) => ({
                    ...entry,
                    type: nextType,
                    dayLabel: nextType === "rest" ? entry.dayLabel || "휴식" : entry.dayLabel || "",
                    exercises: nextType === "workout" ? entry.exercises ?? [] : undefined,
                    restNotes: nextType === "rest" ? entry.restNotes ?? "" : undefined,
                    cardio: nextType === "workout" ? entry.cardio ?? "" : undefined
                  }));
                }}
                style={{ padding: "6px 10px", borderRadius: 6 }}
              >
                <option value="workout">운동</option>
                <option value="rest">휴식</option>
              </select>
            </div>

            {selectedEntry.type === "rest" ? (
              <label style={{ display: "block" }}>
                <span style={{ display: "block", marginBottom: 6, fontSize: 13 }}>휴식 메모</span>
                <textarea
                  rows={3}
                  value={selectedEntry.restNotes ?? ""}
                  onChange={(e) =>
                    upsertEntry(selectedDate, (entry) => ({
                      ...entry,
                      restNotes: e.target.value
                    }))
                  }
                  placeholder="수면, 컨디션, 피로도 등을 기록하세요"
                  style={{ width: "100%", padding: 8, borderRadius: 6, resize: "vertical" }}
                />
              </label>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 12 }}>
                  <label>
                    <span style={{ display: "block", marginBottom: 6, fontSize: 13 }}>일정 라벨</span>
                    <input
                      type="text"
                      value={selectedEntry.dayLabel ?? ""}
                      onChange={(e) =>
                        upsertEntry(selectedDate, (entry) => ({
                          ...entry,
                          dayLabel: e.target.value
                        }))
                      }
                      placeholder="예: Day 1 (상체)"
                      style={{ width: "100%", padding: "6px 8px", borderRadius: 6 }}
                    />
                  </label>

                  <label>
                    <span style={{ display: "block", marginBottom: 6, fontSize: 13 }}>유산소</span>
                    <input
                      type="text"
                      value={selectedEntry.cardio ?? ""}
                      onChange={(e) =>
                        upsertEntry(selectedDate, (entry) => ({
                          ...entry,
                          cardio: e.target.value
                        }))
                      }
                      placeholder="예: 러닝 3km, 트레드밀 10분"
                      style={{ width: "100%", padding: "6px 8px", borderRadius: 6 }}
                    />
                  </label>
                </div>

                {(selectedEntry.exercises ?? []).map((exercise) => {
                  const volume = computeExerciseVolume([exercise]);
                  return (
                    <div key={exercise.id} style={{ marginBottom: 14, padding: 12, border: "1px solid var(--border)", borderRadius: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <strong>{exercise.name}</strong>
                        <button
                          type="button"
                          className="secondary"
                          style={{ fontSize: 12, padding: "2px 8px" }}
                          onClick={() =>
                            upsertEntry(selectedDate, (entry) => ({
                              ...entry,
                              exercises: (entry.exercises ?? []).filter((ex) => ex.id !== exercise.id)
                            }))
                          }
                        >
                          운동 삭제
                        </button>
                      </div>

                      {(exercise.sets ?? []).length > 0 ? (
                        <div style={{ fontSize: 13, marginBottom: 8 }}>
                          {exercise.sets.map((set, idx) => (
                            <span key={`${exercise.id}-${idx}`} style={{ marginRight: 10 }}>
                              {set.weightKg}kg x {set.reps}회
                            </span>
                          ))}
                          <span style={{ color: "var(--text-muted)" }}>볼륨 {formatNumber(volume)}kg</span>
                        </div>
                      ) : (
                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>세트 기록이 없습니다.</div>
                      )}

                      <AddSetForm
                        onAdd={(weightKg, reps) => {
                          const newSet: WorkoutSet = { weightKg, reps };
                          upsertEntry(selectedDate, (entry) => ({
                            ...entry,
                            exercises: (entry.exercises ?? []).map((ex) =>
                              ex.id === exercise.id ? { ...ex, sets: [...ex.sets, newSet] } : ex
                            )
                          }));
                        }}
                      />

                      <label style={{ display: "block", marginTop: 8 }}>
                        <span style={{ display: "block", marginBottom: 4, fontSize: 12 }}>메모</span>
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
                          placeholder="중량 상승, 실패 세트 등"
                          style={{ width: "100%", padding: "6px 8px", borderRadius: 6 }}
                        />
                      </label>
                    </div>
                  );
                })}

                <button type="button" className="secondary" onClick={addExercise}>
                  운동 추가
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};
