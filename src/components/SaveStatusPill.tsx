import React, { useEffect, useState } from "react";
import { useUIStore } from "../store/uiStore";

const SAVED_VISIBLE_MS = 2000;

function formatRelative(ms: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 5) return "방금";
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  return `${Math.floor(min / 60)}시간 전`;
}

/**
 * 자동저장 상태 pill — useBackup의 saveStatus 신호를 시각화.
 * - saving: 진행 중. 보통 <1ms이라 거의 안 보임.
 * - saved: 2초 보여준 뒤 자동 idle 복귀.
 * - error: 다음 시도까지 sticky.
 */
export const SaveStatusPill: React.FC = () => {
  const status = useUIStore((s) => s.saveStatus);
  const error = useUIStore((s) => s.saveStatusError);
  const at = useUIStore((s) => s.saveStatusAt);
  const setSaveStatus = useUIStore((s) => s.setSaveStatus);

  // "N초 전" 표시를 매 초 갱신 — saved 상태에서만 활성화
  const [, force] = useState(0);
  useEffect(() => {
    if (status !== "saved") return;
    const id = window.setInterval(() => force((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  // saved → idle 자동 복귀
  useEffect(() => {
    if (status !== "saved") return;
    const id = window.setTimeout(() => setSaveStatus("idle"), SAVED_VISIBLE_MS);
    return () => window.clearTimeout(id);
  }, [status, at, setSaveStatus]);

  if (status === "idle") return null;
  if (status === "saving") {
    return <div className="pill muted" aria-live="polite">저장 중…</div>;
  }
  if (status === "saved") {
    return <div className="pill success" aria-live="polite">저장됨 · {formatRelative(at)}</div>;
  }
  return (
    <div className="pill danger" aria-live="assertive" title={error ?? undefined}>
      저장 실패{error ? `: ${error}` : ""}
    </div>
  );
};
