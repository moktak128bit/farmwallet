import React, { memo } from "react";
import type { WorkoutSet } from "../../types";
import { Stepper } from "./Stepper";
import { formatClockTime, formatDuration, nowIso } from "./helpers";

interface Props {
  set: WorkoutSet;
  index: number;
  isCardio: boolean;
  /** 직전 완료 세트 시각 (첫 세트는 운동 startedAt). 없으면 gap 미표시. */
  prevCompletedAt: string | undefined;
  onToggleDone: () => void;
  onUpdate: (patch: Partial<WorkoutSet>) => void;
  onRemove: () => void;
}

const SetDetailRowInner: React.FC<Props> = ({
  set, index, isCardio, prevCompletedAt, onToggleDone, onUpdate, onRemove
}) => {
  const hasTarget = set.targetWeightKg !== undefined || set.targetReps !== undefined;
  const targetLabel = hasTarget
    ? `목표 ${set.targetWeightKg ?? 0}kg × ${set.targetRepsRange ?? set.targetReps ?? 0}회`
    : null;
  const gapMs = set.completedAt && prevCompletedAt
    ? new Date(set.completedAt).getTime() - new Date(prevCompletedAt).getTime()
    : 0;
  const gapLabel = formatDuration(gapMs);
  const completedClock = formatClockTime(set.completedAt);

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 6,
      padding: "10px 10px", borderRadius: 10,
      background: set.done ? "rgba(16,185,129,0.14)" : "var(--surface)",
      border: `1px solid ${set.done ? "#10b98160" : "var(--border)"}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onToggleDone}
          aria-label={set.done ? "완료 해제" : "완료로 표시"}
          style={{
            width: 44, height: 44, borderRadius: 10,
            border: `2px solid ${set.done ? "#10b981" : "var(--border)"}`,
            background: set.done ? "#10b981" : "var(--surface)",
            color: set.done ? "#fff" : "transparent",
            cursor: "pointer", fontSize: 22, fontWeight: 900,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}
        >
          ✓
        </button>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 700, minWidth: 38 }}>
          #{index + 1}
        </span>

        {isCardio ? (
          <>
            <Stepper value={set.durationMin ?? 0} unit="분" step={5} min={0} max={600}
              onChange={(v) => onUpdate({ durationMin: v })} />
            <Stepper value={set.distanceKm ?? 0} unit="km" step={0.5} min={0} max={100}
              onChange={(v) => onUpdate({ distanceKm: v })} />
          </>
        ) : (
          <>
            <Stepper value={set.weightKg} unit="kg" step={2.5} min={0}
              onChange={(v) => onUpdate({ weightKg: v })} />
            <Stepper value={set.reps} unit="회" step={1} min={0}
              onChange={(v) => onUpdate({ reps: Math.round(v) })} />
          </>
        )}

        {!isCardio && targetLabel && (
          <span style={{
            fontSize: 11, color: "var(--text-muted)",
            padding: "4px 8px", borderRadius: 6, background: "var(--surface)",
            border: "1px solid var(--border)",
          }}>
            {targetLabel}
          </span>
        )}

        <button
          type="button"
          onClick={onRemove}
          style={{
            marginLeft: "auto",
            width: 36, height: 36, borderRadius: 8,
            background: "var(--surface)", border: "1px solid var(--border)",
            cursor: "pointer", color: "var(--text-muted)", fontSize: 20,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          title="세트 삭제"
          aria-label="세트 삭제"
        >
          ×
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {set.done && completedClock && (
          <span style={{
            fontSize: 11, fontWeight: 700, color: "#10b981",
            padding: "2px 8px", borderRadius: 6,
            background: "rgba(16,185,129,0.10)",
          }}>
            {completedClock}{gapLabel ? ` (+${gapLabel})` : ""}
          </span>
        )}
        <input
          type="text"
          value={set.note ?? ""}
          onChange={(e) => onUpdate({ note: e.target.value, noteUpdatedAt: nowIso() })}
          placeholder="특이사항 (예: 오른쪽 어깨 시큰함)"
          style={{
            flex: 1, minWidth: 140, padding: "6px 10px",
            borderRadius: 6, fontSize: 13,
            background: "var(--surface)", border: "1px solid var(--border)",
          }}
        />
        {set.noteUpdatedAt && set.note && (
          <span style={{ fontSize: 10, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
            {formatClockTime(set.noteUpdatedAt)} 저장
          </span>
        )}
      </div>
    </div>
  );
};

export const SetDetailRow = memo(SetDetailRowInner);
