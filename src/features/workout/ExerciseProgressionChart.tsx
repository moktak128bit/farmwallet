import React, { memo } from "react";
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { DeferredResponsiveContainer } from "../../components/charts/DeferredResponsiveContainer";
import { formatNumber } from "../../utils/formatter";
import type { ExerciseSessionWithPR } from "../../utils/workoutStats";

export type Metric = "maxWeight" | "totalVolume" | "estimated1RM";

interface Props {
  sessions: ExerciseSessionWithPR[];
  metric: Metric;
}

const METRIC_LABEL: Record<Metric, string> = {
  maxWeight: "최대 중량 (kg)",
  totalVolume: "총 볼륨 (kg)",
  estimated1RM: "추정 1RM (kg)",
};

const METRIC_COLOR: Record<Metric, string> = {
  maxWeight: "#ef4444",
  totalVolume: "#3b82f6",
  estimated1RM: "#8b5cf6",
};

function metricPRFlag(s: ExerciseSessionWithPR, metric: Metric): boolean {
  if (metric === "maxWeight") return s.isMaxWeightPR;
  if (metric === "totalVolume") return s.isVolumePR;
  return s.is1RMPR;
}

function metricValue(s: ExerciseSessionWithPR, metric: Metric): number {
  if (metric === "maxWeight") return s.maxWeight;
  if (metric === "totalVolume") return s.totalVolume;
  return Math.round(s.estimated1RM * 10) / 10;
}

const ExerciseProgressionChartInner: React.FC<Props> = ({ sessions, metric }) => {
  if (sessions.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
        기록이 없습니다.
      </div>
    );
  }

  const data = sessions.map((s) => ({
    date: s.date.slice(5), // MM-DD
    value: metricValue(s, metric),
    isPR: metricPRFlag(s, metric),
  }));

  const color = METRIC_COLOR[metric];

  return (
    <DeferredResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 16, right: 20, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatNumber(Number(v))} />
        <Tooltip
          formatter={(v) => [`${formatNumber(Number(v))} kg`, METRIC_LABEL[metric]]}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line
          type="monotone"
          dataKey="value"
          name={METRIC_LABEL[metric]}
          stroke={color}
          strokeWidth={2.5}
          dot={(props) => {
            const { cx, cy, payload, index } = props as { cx?: number; cy?: number; payload?: { isPR?: boolean }; index?: number };
            if (cx == null || cy == null) return <g key={index} />;
            const isPR = !!payload?.isPR;
            return (
              <circle
                key={index}
                cx={cx}
                cy={cy}
                r={isPR ? 6 : 3}
                fill={isPR ? "#dc2626" : color}
                stroke={isPR ? "#fff" : "none"}
                strokeWidth={isPR ? 2 : 0}
              />
            );
          }}
        />
      </LineChart>
    </DeferredResponsiveContainer>
  );
};

export const ExerciseProgressionChart = memo(ExerciseProgressionChartInner);
