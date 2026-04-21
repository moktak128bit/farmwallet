import React, { memo } from "react";
import type { WorkoutBodyPart } from "../../types";
import { formatNumber } from "../../utils/formatter";
import { BODY_PART_COLORS } from "./constants";

export interface MonthStatsData {
  workoutDays: number;
  restDays: number;
  volume: number;
  partCounts: Map<WorkoutBodyPart, number>;
}

interface Props {
  stats: MonthStatsData;
}

const MonthStatsInner: React.FC<Props> = ({ stats }) => {
  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 12 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>운동일</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--success)" }}>{stats.workoutDays}일</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>휴식일</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#3b82f6" }}>{stats.restDays}일</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>월간 볼륨</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{formatNumber(stats.volume)}kg</div>
        </div>
      </div>
      {stats.partCounts.size > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          {[...stats.partCounts.entries()].sort((a, b) => b[1] - a[1]).map(([part, count]) => (
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
  );
};

export const MonthStats = memo(MonthStatsInner);
