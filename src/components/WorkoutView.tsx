import React, { useState, useMemo } from "react";
import type { WorkoutWeek, WorkoutDayEntry, WorkoutExercise, WorkoutSet } from "../types";
import { formatNumber } from "../utils/format";

interface Props {
  workoutWeeks?: WorkoutWeek[];
  onChangeWorkoutWeeks: (weeks: WorkoutWeek[]) => void;
}

/** 해당 날짜가 속한 주의 일요일 (yyyy-mm-dd) */
function getWeekStart(d: Date): string {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day;
  const sunday = new Date(date);
  sunday.setDate(diff);
  return sunday.toISOString().slice(0, 10);
}

/** weekStart(일요일) 기준 offset일째 날짜 (0=일, 1=월, 2=화) */
function getDateByOffset(weekStart: string, offset: number): string {
  const d = new Date(weekStart + "T12:00:00");
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

const DAY_LABELS: [string, string][] = [
  ["일요일", "Day 1 (상체)"],
  ["월요일", "휴식"],
  ["화요일", "Day 2 (하체)"]
];

function computeExerciseVolume(exercises: WorkoutExercise[]): number {
  return exercises.reduce((sum, ex) => {
    return sum + ex.sets.reduce((s, set) => s + set.weightKg * set.reps, 0);
  }, 0);
}

const AddSetForm: React.FC<{
  onAdd: (weightKg: number, reps: number) => void;
}> = ({ onAdd }) => {
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const w = Number(weight.replace(/,/g, ""));
    const r = Number(reps.replace(/,/g, ""));
    if (w > 0 && r > 0) {
      onAdd(w, r);
      setWeight("");
      setReps("");
    }
  };
  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
      <input
        type="number"
        min={0}
        step={0.5}
        value={weight}
        onChange={(e) => setWeight(e.target.value)}
        placeholder="중량(kg)"
        style={{ width: 72, padding: "4px 6px", borderRadius: 4 }}
      />
      <span>×</span>
      <input
        type="number"
        min={1}
        value={reps}
        onChange={(e) => setReps(e.target.value)}
        placeholder="반복"
        style={{ width: 56, padding: "4px 6px", borderRadius: 4 }}
      />
      <span>회</span>
      <button type="submit" className="secondary" style={{ fontSize: 12, padding: "4px 10px" }}>
        세트 추가
      </button>
    </form>
  );
};

function ensureWeekEntries(week: WorkoutWeek): WorkoutDayEntry[] {
  const entries = [...(week.entries || [])];
  for (let i = 0; i < 3; i++) {
    const date = getDateByOffset(week.weekStart, i);
    const existing = entries.find((e) => e.date === date);
    if (!existing) {
      entries.push({
        id: `day-${week.id}-${i}-${Date.now()}`,
        date,
        type: i === 1 ? "rest" : "workout",
        dayLabel: DAY_LABELS[i][1],
        exercises: i === 1 ? undefined : [],
        restNotes: i === 1 ? "" : undefined
      });
    }
  }
  return entries.sort((a, b) => a.date.localeCompare(b.date));
}

export const WorkoutView: React.FC<Props> = ({ workoutWeeks = [], onChangeWorkoutWeeks }) => {
  const weeks = useMemo(() => {
    const list = [...workoutWeeks].sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    if (list.length === 0) {
      const sun = getWeekStart(new Date());
      return [{ id: `w-${Date.now()}`, weekStart: sun, entries: [] }];
    }
    return list;
  }, [workoutWeeks]);

  const [selectedWeekId, setSelectedWeekId] = useState<string>(weeks[0]?.id ?? "");
  const selectedWeek = useMemo(() => weeks.find((w) => w.id === selectedWeekId) ?? weeks[0], [weeks, selectedWeekId]);

  const dayEntries = useMemo(() => ensureWeekEntries(selectedWeek), [selectedWeek]);

  const updateWeek = (updater: (w: WorkoutWeek) => WorkoutWeek) => {
    if (workoutWeeks.length === 0) {
      onChangeWorkoutWeeks([updater(selectedWeek)]);
      return;
    }
    onChangeWorkoutWeeks(
      workoutWeeks.map((w) => (w.id === selectedWeek.id ? updater(w) : w))
    );
  };

  const setDayEntries = (entries: WorkoutDayEntry[]) => {
    updateWeek((w) => ({ ...w, entries }));
  };

  const updateDay = (date: string, updater: (e: WorkoutDayEntry) => WorkoutDayEntry) => {
    const next = dayEntries.map((e) => (e.date === date ? updater(e) : e));
    setDayEntries(next);
  };

  const addWeek = () => {
    const sun = getWeekStart(new Date());
    const id = `w-${Date.now()}`;
    const newWeek: WorkoutWeek = { id, weekStart: sun, entries: [] };
    onChangeWorkoutWeeks([newWeek, ...workoutWeeks]);
    setSelectedWeekId(id);
  };

  // 주별 3일 요약: 날짜, 내용, 웨이트 볼륨
  const summaryRows = useMemo(() => {
    return dayEntries.map((e) => {
      const content =
        e.type === "rest"
          ? "휴식"
          : (e.dayLabel ?? "") + (e.exercises?.length ? ` (${e.exercises.map((x) => x.name).join(", ")})` : "");
      const volume = e.type === "workout" && e.exercises?.length ? computeExerciseVolume(e.exercises) : 0;
      return { date: e.date, content, volume };
    });
  }, [dayEntries]);

  const totalVolume = useMemo(() => summaryRows.reduce((s, r) => s + r.volume, 0), [summaryRows]);

  return (
    <div>
      <div className="section-header">
        <h2>📅 주간 기록 정리</h2>
        <button type="button" className="primary" onClick={addWeek}>
          새 주 추가
        </button>
      </div>

      <div style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>주 선택:</span>
          <select
            value={selectedWeekId}
            onChange={(e) => setSelectedWeekId(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 6, minWidth: 160 }}
          >
            {weeks.map((w) => {
              const sun = new Date(w.weekStart + "T12:00:00");
              const mon = getDateByOffset(w.weekStart, 1);
              const label = `${w.weekStart} (일~화 ${mon})`;
              return (
                <option key={w.id} value={w.id}>
                  {label}
                </option>
              );
            })}
          </select>
        </label>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {dayEntries.map((entry, idx) => {
          const [dayName] = DAY_LABELS[idx];
          const isRest = entry.type === "rest";
          return (
            <div key={entry.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>
                  {dayName} – {entry.date}
                  {entry.dayLabel && (
                    <span style={{ marginLeft: 8, color: "var(--text-muted)", fontWeight: 500 }}>
                      {entry.dayLabel}
                    </span>
                  )}
                </h3>
                <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 13 }}>유형</span>
                  <select
                    value={entry.type}
                    onChange={(e) =>
                      updateDay(entry.date, (e) => ({
                        ...e,
                        type: e.target.value as "workout" | "rest",
                        exercises: e.target.value === "workout" ? e.exercises ?? [] : undefined,
                        restNotes: e.target.value === "rest" ? e.restNotes ?? "" : undefined
                      }))
                    }
                    style={{ padding: "4px 8px", borderRadius: 4 }}
                  >
                    <option value="workout">운동</option>
                    <option value="rest">휴식</option>
                  </select>
                </label>
              </div>

              {isRest ? (
                <div>
                  <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
                    특이사항 (수면, 근육통, 컨디션)
                  </label>
                  <textarea
                    value={entry.restNotes ?? ""}
                    onChange={(e) => updateDay(entry.date, (d) => ({ ...d, restNotes: e.target.value }))}
                    placeholder="기록 안 하면 다음 중량 조정 어려움"
                    rows={2}
                    style={{ width: "100%", padding: 8, borderRadius: 6, resize: "vertical" }}
                  />
                </div>
              ) : (
                <>
                  <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>
                    일차 라벨 (선택)
                  </label>
                  <input
                    type="text"
                    value={entry.dayLabel ?? ""}
                    onChange={(e) => updateDay(entry.date, (d) => ({ ...d, dayLabel: e.target.value }))}
                    placeholder="예: Day 1 (상체)"
                    style={{ width: "100%", maxWidth: 240, marginBottom: 12, padding: "6px 8px", borderRadius: 4 }}
                  />
                  {(entry.exercises ?? []).map((ex) => (
                    <div key={ex.id} style={{ marginBottom: 16, padding: 12, background: "var(--bg-secondary)", borderRadius: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <strong>{ex.name}</strong>
                        <button
                          type="button"
                          className="secondary"
                          style={{ fontSize: 12, padding: "2px 8px" }}
                          onClick={() =>
                            updateDay(entry.date, (d) => ({
                              ...d,
                              exercises: (d.exercises ?? []).filter((e) => e.id !== ex.id)
                            }))
                          }
                        >
                          삭제
                        </button>
                      </div>
                      <div style={{ fontSize: 13, marginBottom: 6 }}>
                        {ex.sets.map((set, i) => (
                          <span key={i} style={{ marginRight: 12 }}>
                            {set.weightKg}kg × {set.reps}회
                          </span>
                        ))}
                        <span style={{ color: "var(--text-muted)" }}>
                          (볼륨: {formatNumber(computeExerciseVolume([ex]))}kg)
                        </span>
                      </div>
                      <AddSetForm
                        onAdd={(weightKg, reps) => {
                          const newSet: WorkoutSet = { weightKg, reps };
                          updateDay(entry.date, (d) => ({
                            ...d,
                            exercises: (d.exercises ?? []).map((e) =>
                              e.id === ex.id ? { ...e, sets: [...e.sets, newSet] } : e
                            )
                          }));
                        }}
                      />
                      <label style={{ display: "block", marginTop: 6, fontSize: 12 }}>
                        메모 (상태, 실패 등)
                        <input
                          type="text"
                          value={ex.note ?? ""}
                          onChange={(ev) =>
                            updateDay(entry.date, (d) => ({
                              ...d,
                              exercises: (d.exercises ?? []).map((e) =>
                                e.id === ex.id ? { ...e, note: ev.target.value } : e
                              )
                            }))
                          }
                          placeholder="선택"
                          style={{ marginLeft: 8, padding: "4px 6px", width: "60%", maxWidth: 280, borderRadius: 4 }}
                        />
                      </label>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="secondary"
                    style={{ marginBottom: 12 }}
                    onClick={() => {
                      const name = window.prompt("운동 이름 (예: 벤치프레스, 스쿼트)");
                      if (!name?.trim()) return;
                      const newEx: WorkoutExercise = {
                        id: `ex-${Date.now()}`,
                        name: name.trim(),
                        sets: []
                      };
                      updateDay(entry.date, (d) => ({
                        ...d,
                        exercises: [...(d.exercises ?? []), newEx]
                      }));
                    }}
                  >
                    + 운동 추가
                  </button>
                  <label style={{ display: "block", marginBottom: 4, fontSize: 13 }}>유산소</label>
                  <input
                    type="text"
                    value={entry.cardio ?? ""}
                    onChange={(e) => updateDay(entry.date, (d) => ({ ...d, cardio: e.target.value }))}
                    placeholder="예: 러닝 3km, 트레드밀 10분"
                    style={{ width: "100%", maxWidth: 320, padding: "6px 8px", borderRadius: 4 }}
                  />
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: 24, padding: 16 }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>📊 3일 요약</h3>
        <table className="data-table" style={{ marginBottom: 8 }}>
          <thead>
            <tr>
              <th>날짜</th>
              <th>내용</th>
              <th style={{ textAlign: "right" }}>웨이트 볼륨</th>
            </tr>
          </thead>
          <tbody>
            {summaryRows.map((row) => (
              <tr key={row.date}>
                <td>{row.date}</td>
                <td>{row.content || "—"}</td>
                <td style={{ textAlign: "right" }}>{row.volume > 0 ? `${formatNumber(row.volume)}kg` : "0"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ margin: 0, fontSize: 14, color: "var(--text-muted)" }}>
          총 웨이트: <strong>{formatNumber(totalVolume)}kg</strong>
        </p>
      </div>
    </div>
  );
}
