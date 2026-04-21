import React, { memo, useEffect, useState } from "react";
import type { WorkoutDayEntry } from "../../types";
import { formatClockTime, formatDuration } from "./helpers";

interface Props {
  entry: WorkoutDayEntry;
  onStart: () => void;
  onEnd: () => void;
  onResume: () => void;
}

/**
 * 진행 중 운동의 경과 시간을 1분 간격으로 갱신. 내부 state로 tick을 소유해
 * 부모(WorkoutPage) 리렌더를 유발하지 않는다. endedAt 설정 시 interval 해제.
 */
const TimerSummaryInner: React.FC<Props> = ({ entry, onStart, onEnd, onResume }) => {
  const startedAt = entry.startedAt;
  const endedAt = entry.endedAt;
  const running = Boolean(startedAt && !endedAt);

  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNowTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [running]);

  const endMs = endedAt ? new Date(endedAt).getTime() : nowTick;
  const startMs = startedAt ? new Date(startedAt).getTime() : 0;
  const totalMs = startedAt ? Math.max(0, endMs - startMs) : 0;
  const totalLabel = formatDuration(totalMs);

  return (
    <div
      style={{
        marginBottom: 12, padding: "10px 12px", borderRadius: 10,
        background: endedAt ? "rgba(100,116,139,0.10)" : "rgba(16,185,129,0.10)",
        border: `1px solid ${endedAt ? "var(--border)" : "#10b98140"}`,
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 700, color: endedAt ? "var(--text-muted)" : "#10b981" }}>
        {endedAt ? "완료" : "진행 중"}
      </span>
      <span style={{ fontSize: 14, fontWeight: 700 }}>
        {startedAt ? `총 ${totalLabel || "0초"}` : "시작 전"}
      </span>
      {startedAt && (
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {formatClockTime(startedAt)}{endedAt ? ` → ${formatClockTime(endedAt)}` : " ~ 지금"}
        </span>
      )}
      <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
        {!startedAt && (
          <button type="button" className="primary"
            style={{ padding: "6px 14px", fontSize: 13, fontWeight: 700 }}
            onClick={onStart}>
            시작
          </button>
        )}
        {startedAt && !endedAt && (
          <button type="button" className="secondary"
            style={{ padding: "6px 14px", fontSize: 13, fontWeight: 700 }}
            onClick={onEnd}>
            운동 끝내기
          </button>
        )}
        {endedAt && (
          <button type="button" className="secondary"
            style={{ padding: "6px 14px", fontSize: 13, fontWeight: 700 }}
            onClick={onResume}>
            재개
          </button>
        )}
      </div>
    </div>
  );
};

export const TimerSummary = memo(TimerSummaryInner);
