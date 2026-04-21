import React, { memo, useMemo, useState } from "react";
import { formatNumber } from "../../utils/formatter";
import { detectPRs, getExerciseSessions } from "../../utils/workoutStats";
import type { WorkoutWeek } from "../../types";
import { ExerciseProgressionChart, type Metric } from "./ExerciseProgressionChart";

interface Props {
  exerciseName: string;
  workoutWeeks: WorkoutWeek[];
  onClose: () => void;
}

const METRIC_OPTIONS: { value: Metric; label: string }[] = [
  { value: "maxWeight", label: "최대중량" },
  { value: "totalVolume", label: "총볼륨" },
  { value: "estimated1RM", label: "추정 1RM" },
];

const ExerciseHistoryModalInner: React.FC<Props> = ({ exerciseName, workoutWeeks, onClose }) => {
  const [metric, setMetric] = useState<Metric>("maxWeight");

  const sessions = useMemo(
    () => detectPRs(getExerciseSessions(workoutWeeks, exerciseName)),
    [workoutWeeks, exerciseName]
  );

  const summary = useMemo(() => {
    if (sessions.length === 0) return null;
    let best = sessions[0];
    let bestVolume = sessions[0];
    let best1RM = sessions[0];
    for (const s of sessions) {
      if (s.maxWeight > best.maxWeight) best = s;
      if (s.totalVolume > bestVolume.totalVolume) bestVolume = s;
      if (s.estimated1RM > best1RM.estimated1RM) best1RM = s;
    }
    return { best, bestVolume, best1RM };
  }, [sessions]);

  const tableRows = useMemo(() => [...sessions].reverse(), [sessions]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${exerciseName} 이력`}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 680, maxHeight: "90vh", overflow: "auto",
          background: "var(--bg, #fff)", borderRadius: 14, padding: 20,
          boxShadow: "0 10px 40px rgba(0,0,0,0.25)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>{exerciseName} 진행 이력</h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 24, color: "var(--text-muted)", padding: 4, lineHeight: 1,
            }}
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        {sessions.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)" }}>
            완료된 세트 기록이 아직 없습니다.
          </div>
        ) : (
          <>
            {summary && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 14 }}>
                <StatCard label="최고 중량" value={`${formatNumber(summary.best.maxWeight)} kg`} sub={`${summary.best.topSet.reps}회 · ${summary.best.date}`} color="#ef4444" />
                <StatCard label="최고 볼륨" value={`${formatNumber(summary.bestVolume.totalVolume)} kg`} sub={summary.bestVolume.date} color="#3b82f6" />
                <StatCard label="추정 1RM" value={`${formatNumber(Math.round(summary.best1RM.estimated1RM))} kg`} sub={summary.best1RM.date} color="#8b5cf6" />
              </div>
            )}

            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {METRIC_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMetric(opt.value)}
                  className={metric === opt.value ? "primary" : "secondary"}
                  style={{ padding: "6px 12px", fontSize: 13, fontWeight: 600 }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <ExerciseProgressionChart sessions={sessions} metric={metric} />

            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>세션 목록 ({sessions.length})</div>
              <div style={{ maxHeight: 220, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
                <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "var(--surface)", position: "sticky", top: 0 }}>
                      <th style={cellStyle}>날짜</th>
                      <th style={cellStyle}>Top 세트</th>
                      <th style={cellStyle}>총 볼륨</th>
                      <th style={cellStyle}>세트</th>
                      <th style={cellStyle}>PR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((s) => (
                      <tr key={s.date} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={cellStyle}>{s.date}</td>
                        <td style={cellStyle}>{s.topSet.weight}kg × {s.topSet.reps}</td>
                        <td style={cellStyle}>{formatNumber(s.totalVolume)}</td>
                        <td style={cellStyle}>{s.completedSetCount}</td>
                        <td style={cellStyle}>
                          {s.isMaxWeightPR && <Badge color="#ef4444">중량</Badge>}
                          {s.isVolumePR && <Badge color="#3b82f6">볼륨</Badge>}
                          {s.is1RMPR && <Badge color="#8b5cf6">1RM</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const cellStyle: React.CSSProperties = {
  padding: "6px 8px", textAlign: "left", fontWeight: 500,
};

const StatCard: React.FC<{ label: string; value: string; sub?: string; color: string }> = ({ label, value, sub, color }) => (
  <div style={{
    padding: 10, borderRadius: 8,
    border: `1px solid ${color}40`, background: `${color}10`,
  }}>
    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>{label}</div>
    <div style={{ fontSize: 16, fontWeight: 700, color }}>{value}</div>
    {sub && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{sub}</div>}
  </div>
);

const Badge: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <span style={{
    display: "inline-block", padding: "1px 6px", marginRight: 3,
    fontSize: 10, fontWeight: 700, borderRadius: 4,
    background: color + "20", color,
  }}>
    {children}
  </span>
);

export const ExerciseHistoryModal = memo(ExerciseHistoryModalInner);
