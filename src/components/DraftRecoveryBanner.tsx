import React from "react";
import { useUIStore } from "../store/uiStore";

interface DraftRecoveryBannerProps {
  onRecover: () => void;
  onDiscard: () => void;
}

function formatRelative(ms: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
}

/**
 * boot 시 발견된 미저장 드래프트가 있을 때 노출되는 banner.
 * 토스트가 아닌 banner인 이유: 데이터 안전 결정은 자동 사라지면 안 됨.
 */
export const DraftRecoveryBanner: React.FC<DraftRecoveryBannerProps> = ({ onRecover, onDiscard }) => {
  const draftRecovery = useUIStore((s) => s.draftRecovery);
  if (!draftRecovery) return null;

  return (
    <div
      role="alert"
      className="pill warning"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        padding: "var(--space-2) var(--space-3)",
      }}
    >
      <span>
        복구 가능한 미저장 변경이 있습니다 ({formatRelative(draftRecovery.draftAt)})
      </span>
      <button
        type="button"
        className="primary"
        onClick={onRecover}
        style={{ padding: "2px 10px", fontSize: 12 }}
      >
        복구
      </button>
      <button
        type="button"
        className="secondary"
        onClick={onDiscard}
        style={{ padding: "2px 10px", fontSize: 12 }}
      >
        폐기
      </button>
    </div>
  );
};
