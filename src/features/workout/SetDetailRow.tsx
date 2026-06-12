import React, { memo, useEffect, useState } from "react";
import type { WorkoutSet } from "../../types";
import { Stepper } from "./Stepper";
import { formatClockTime, formatDuration, nowIso, type CardioKind } from "./helpers";
import { CommitInput } from "../../components/ui/CommitInput";

interface Props {
  set: WorkoutSet;
  index: number;
  isCardio: boolean;
  /** 유산소 입력 타입. isCardio=false 면 무시. */
  cardioKind?: CardioKind;
  /** 오늘 날짜 기록인지 — 휴식 카운트다운은 오늘 기록에서만 동작 */
  isToday?: boolean;
  /** 직전 완료 세트 시각 (첫 세트는 운동 startedAt). 없으면 gap 미표시. */
  prevCompletedAt: string | undefined;
  onToggleDone: () => void;
  onUpdate: (patch: Partial<WorkoutSet>) => void;
  onRemove: () => void;
}

const SetDetailRowInner: React.FC<Props> = ({
  set, index, isCardio, cardioKind = "distance", isToday = false, prevCompletedAt, onToggleDone, onUpdate, onRemove
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

  // 휴식 카운트다운: 이 세트가 아직 done=false이고, 직전 세트의 완료 시각 + restSec(또는 기본 90초)
  // 이 시각보다 지금이 이전이면 남은 초 표시. 지나면 "휴식 끝" 메시지.
  // restSec이 0이면 카운트다운 숨김 (사용자 명시적으로 끔).
  // 오늘 날짜 기록에서만 동작 — 과거 기록 열람 시 "휴식 끝" 배지가 뜨는 문제 방지.
  const [now, setNow] = useState(() => Date.now());
  const restTargetSec = set.restSec ?? 90;
  const showCountdown = isToday && !set.done && !!prevCompletedAt && restTargetSec > 0;
  useEffect(() => {
    if (!showCountdown) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [showCountdown]);
  const elapsedSec = showCountdown
    ? Math.floor((now - new Date(prevCompletedAt!).getTime()) / 1000)
    : 0;
  const remainingSec = Math.max(0, restTargetSec - elapsedSec);
  const isRestOver = showCountdown && remainingSec === 0;

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
          cardioKind === "interval" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 240 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, color: "#dc2626",
                  padding: "2px 8px", borderRadius: 4, background: "rgba(220,38,38,0.12)",
                  minWidth: 24, textAlign: "center",
                }}>강</span>
                <Stepper value={set.intervalStrongSpeed ?? 0} unit="km/h" step={0.5} min={0} max={30}
                  onChange={(v) => onUpdate({ intervalStrongSpeed: v })} />
                <Stepper value={set.intervalStrongSec ?? 0} unit="초" step={15} min={0} max={1800}
                  onChange={(v) => onUpdate({ intervalStrongSec: v })} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, color: "#2563eb",
                  padding: "2px 8px", borderRadius: 4, background: "rgba(37,99,235,0.12)",
                  minWidth: 24, textAlign: "center",
                }}>약</span>
                <Stepper value={set.intervalWeakSpeed ?? 0} unit="km/h" step={0.5} min={0} max={30}
                  onChange={(v) => onUpdate({ intervalWeakSpeed: v })} />
                <Stepper value={set.intervalWeakSec ?? 0} unit="초" step={15} min={0} max={1800}
                  onChange={(v) => onUpdate({ intervalWeakSec: v })} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 24 }}>반복</span>
                <Stepper value={set.intervalReps ?? 0} unit="회" step={1} min={0} max={100}
                  onChange={(v) => onUpdate({ intervalReps: Math.round(v) })} />
              </div>
            </div>
          ) : cardioKind === "intensity" ? (
            <>
              <Stepper value={set.durationMin ?? 0} unit="분" step={5} min={0} max={600}
                onChange={(v) => onUpdate({ durationMin: v })} />
              <Stepper value={set.intensity ?? 0} unit="레벨" step={1} min={0} max={20}
                onChange={(v) => onUpdate({ intensity: Math.round(v) })} />
            </>
          ) : cardioKind === "count" ? (
            <>
              <Stepper value={set.durationMin ?? 0} unit="분" step={1} min={0} max={600}
                onChange={(v) => onUpdate({ durationMin: v })} />
              <Stepper value={set.repsCount ?? 0} unit="회" step={10} min={0} max={100000}
                onChange={(v) => onUpdate({ repsCount: Math.round(v) })} />
            </>
          ) : (
            <>
              <Stepper value={set.durationMin ?? 0} unit="분" step={5} min={0} max={600}
                onChange={(v) => onUpdate({ durationMin: v })} />
              <Stepper value={set.distanceKm ?? 0} unit="km" step={0.5} min={0} max={100}
                onChange={(v) => onUpdate({ distanceKm: v })} />
            </>
          )
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

      {showCountdown && (
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", borderRadius: 8,
          background: isRestOver ? "rgba(16,185,129,0.14)" : "rgba(59,130,246,0.10)",
          border: `1px solid ${isRestOver ? "#10b98160" : "rgba(59,130,246,0.3)"}`,
          fontSize: 12, fontWeight: 700,
          color: isRestOver ? "#10b981" : "#3b82f6",
        }}>
          {isRestOver
            ? `🔔 휴식 끝 (${restTargetSec}s 경과 — 다음 세트 시작)`
            : `⏱ 휴식 ${remainingSec}s / ${restTargetSec}s`}
          <button
            type="button"
            onClick={() => {
              const raw = window.prompt("휴식 시간(초). 0=꺼짐", String(restTargetSec));
              if (raw == null) return;
              const n = parseInt(raw, 10);
              if (!Number.isFinite(n) || n < 0) return;
              onUpdate({ restSec: n });
            }}
            style={{
              marginLeft: "auto", padding: "2px 8px", fontSize: 11, fontWeight: 600,
              background: "transparent", border: `1px solid ${isRestOver ? "#10b98180" : "#3b82f680"}`,
              borderRadius: 4, cursor: "pointer", color: "inherit",
            }}
            title="휴식 시간 변경"
          >
            변경
          </button>
        </div>
      )}

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
        <CommitInput
          type="text"
          value={set.note ?? ""}
          onCommit={(text) => onUpdate({ note: text, noteUpdatedAt: nowIso() })}
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
