import React, { memo } from "react";
import type { WorkoutDayEntry } from "../../types";
import { Stepper } from "./Stepper";

interface Props {
  entry: WorkoutDayEntry;
  onUpdateEntry: (updater: (e: WorkoutDayEntry) => WorkoutDayEntry) => void;
}

const CardioInputsInner: React.FC<Props> = ({ entry, onUpdateEntry }) => {
  return (
    <div style={{
      marginBottom: 16, padding: 12, borderRadius: 10,
      background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.3)",
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#0891b2", marginBottom: 8 }}>
        유산소
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 28 }}>시간</span>
          <Stepper
            value={entry.cardioMinutes ?? 0}
            unit="분"
            step={5}
            min={0}
            max={600}
            onChange={(v) => onUpdateEntry((e) => ({ ...e, cardioMinutes: v }))}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 28 }}>거리</span>
          <Stepper
            value={entry.cardioDistanceKm ?? 0}
            unit="km"
            step={0.5}
            min={0}
            max={100}
            onChange={(v) => onUpdateEntry((e) => ({ ...e, cardioDistanceKm: v }))}
          />
        </div>
      </div>
      <input
        type="text"
        value={entry.cardio ?? ""}
        onChange={(e) => onUpdateEntry((prev) => ({ ...prev, cardio: e.target.value }))}
        placeholder="유산소 메모 (예: 트레드밀 경사 5%, 사이클)"
        style={{ width: "100%", padding: "8px 12px", borderRadius: 8, fontSize: 13 }}
      />
    </div>
  );
};

export const CardioInputs = memo(CardioInputsInner);
