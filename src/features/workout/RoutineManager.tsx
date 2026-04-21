import React, { memo } from "react";
import type { WorkoutRoutine } from "../../types";
import { BODY_PARTS, BODY_PART_COLORS } from "./constants";

interface Props {
  routines: WorkoutRoutine[];
  sortedRoutines: WorkoutRoutine[];
  expanded: boolean;
  onToggleExpanded: () => void;
  newRoutineName: string;
  onChangeNewRoutineName: (v: string) => void;
  onCreateRoutine: () => void;
  editingRoutineId: string | null;
  onSetEditingRoutineId: (id: string | null) => void;
  onRenameRoutine: (id: string, name: string) => void;
  onDeleteRoutine: (id: string) => void;
  routineExerciseDraft: {
    name: string;
    bodyPart: import("../../types").WorkoutBodyPart;
    sets: string;
    reps: string;
    weight: string;
  };
  onChangeRoutineExerciseDraft: (updater: (d: Props["routineExerciseDraft"]) => Props["routineExerciseDraft"]) => void;
  onAddRoutineExercise: (routineId: string) => void;
  onRemoveRoutineExercise: (routineId: string, exerciseId: string) => void;
}

const RoutineManagerInner: React.FC<Props> = ({
  routines, sortedRoutines, expanded, onToggleExpanded,
  newRoutineName, onChangeNewRoutineName, onCreateRoutine,
  editingRoutineId, onSetEditingRoutineId,
  onRenameRoutine, onDeleteRoutine,
  routineExerciseDraft, onChangeRoutineExerciseDraft,
  onAddRoutineExercise, onRemoveRoutineExercise,
}) => {
  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <button
        type="button"
        onClick={onToggleExpanded}
        style={{
          width: "100%", background: "none", border: "none", cursor: "pointer",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: 0, fontSize: 16, fontWeight: 700, color: "var(--text)",
        }}
      >
        <span>운동 루틴 ({routines.length})</span>
        <span style={{ fontSize: 14, color: "var(--text-muted)" }}>
          {expanded ? "▲ 접기" : "▼ 펼치기"}
        </span>
      </button>

      {expanded && (
        <div style={{ marginTop: 14 }}>
          {/* 루틴 생성 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              type="text"
              value={newRoutineName}
              onChange={(e) => onChangeNewRoutineName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onCreateRoutine(); }}
              placeholder="새 루틴 이름 (예: 푸시 데이)"
              style={{ flex: 1, padding: "8px 12px", borderRadius: 8, fontSize: 14 }}
            />
            <button
              type="button"
              className="primary"
              onClick={onCreateRoutine}
              style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600 }}
            >
              루틴 추가
            </button>
          </div>

          {/* 루틴 목록 */}
          {routines.length === 0 ? (
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
                      onChange={(e) => onRenameRoutine(routine.id, e.target.value)}
                      style={{ flex: 1, padding: "6px 10px", borderRadius: 6, fontSize: 14, fontWeight: 600 }}
                    />
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {routine.exercises.length}종목
                    </span>
                    <button
                      type="button"
                      className="secondary"
                      style={{ padding: "6px 12px", fontSize: 13 }}
                      onClick={() => onSetEditingRoutineId(isEditing ? null : routine.id)}
                    >
                      {isEditing ? "닫기" : "편집"}
                    </button>
                    <button
                      type="button"
                      className="danger"
                      style={{ padding: "6px 12px", fontSize: 13 }}
                      onClick={() => {
                        if (window.confirm(`"${routine.name}" 루틴을 삭제하시겠습니까?`)) onDeleteRoutine(routine.id);
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
                                  onClick={() => onRemoveRoutineExercise(routine.id, rex.id)}
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
                              onClick={() => onChangeRoutineExerciseDraft((d) => ({ ...d, bodyPart: part }))}
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
                            onChange={(e) => onChangeRoutineExerciseDraft((d) => ({ ...d, name: e.target.value }))}
                            placeholder="운동 이름"
                            style={{ flex: 1, minWidth: 140, padding: "6px 10px", borderRadius: 6, fontSize: 13 }}
                          />
                          <input
                            type="number"
                            min={1}
                            value={routineExerciseDraft.sets}
                            onChange={(e) => onChangeRoutineExerciseDraft((d) => ({ ...d, sets: e.target.value }))}
                            placeholder="세트"
                            style={{ width: 56, padding: "6px 8px", borderRadius: 6, fontSize: 13, textAlign: "center" }}
                          />
                          <span style={{ fontSize: 13 }}>×</span>
                          <input
                            type="number"
                            min={1}
                            value={routineExerciseDraft.reps}
                            onChange={(e) => onChangeRoutineExerciseDraft((d) => ({ ...d, reps: e.target.value }))}
                            placeholder="횟수"
                            style={{ width: 56, padding: "6px 8px", borderRadius: 6, fontSize: 13, textAlign: "center" }}
                          />
                          <span style={{ fontSize: 13 }}>×</span>
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            value={routineExerciseDraft.weight}
                            onChange={(e) => onChangeRoutineExerciseDraft((d) => ({ ...d, weight: e.target.value }))}
                            placeholder="kg"
                            style={{ width: 70, padding: "6px 8px", borderRadius: 6, fontSize: 13, textAlign: "center" }}
                          />
                          <button
                            type="button"
                            className="primary"
                            onClick={() => onAddRoutineExercise(routine.id)}
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
  );
};

export const RoutineManager = memo(RoutineManagerInner);
