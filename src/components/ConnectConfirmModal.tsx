import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { describeConnectTarget, type ConnectPayload } from "../services/deviceConnect";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useModalStackEntry } from "../utils/modalStack";

interface ConnectConfirmModalProps {
  /** 연결 링크로 받은 토큰·Gist ID — null이면 닫힘 */
  payload: ConnectPayload | null;
  /** 이 기기에 현재 설정된 Gist ID (없으면 "") — 다른 Gist로 바뀌는지 경고용 */
  currentGistId: string;
  /** [연결] — 연결 테스트·저장·불러오기가 끝날 때까지 대기 */
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

/**
 * 받는 쪽 기기 연결 확인 — 타인이 보낸 링크로 내 데이터가 남의 Gist에 올라가지 않도록 반드시 사용자 확인을 거친다.
 * Gist ID는 끝 6자리만 보여주고, ⚠ 토큰은 화면에 표시하지 않는다.
 */
export const ConnectConfirmModal: React.FC<ConnectConfirmModalProps> = ({ payload, currentGistId, onConfirm, onCancel }) => {
  const [busy, setBusy] = useState(false);
  const trapRef = useFocusTrap<HTMLDivElement>(!!payload);
  const isTopModal = useModalStackEntry(!!payload);

  // ESC = 취소 (최상위 모달만, 연결 진행 중에는 무시)
  useEffect(() => {
    if (!payload) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isTopModal()) {
        e.stopPropagation();
        // busy면 거부를 알림 — 뒤로가기(closeTopModal)가 즉시 모달 항목을 되살린다 (Q4)
        if (busy) e.preventDefault();
        else onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [payload, busy, onCancel, isTopModal]);

  if (!payload) return null;

  const { shortId, currentShortId, replacesOther } = describeConnectTarget(currentGistId, payload.gistId);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-confirm-title"
      aria-describedby="connect-confirm-desc"
      aria-busy={busy}
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--overlay-bg)",
        zIndex: "var(--z-modal)" as unknown as number,
        padding: "var(--space-8)",
      }}
    >
      <div
        ref={trapRef}
        className="card"
        style={{
          width: "100%",
          maxWidth: 420,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          padding: "var(--space-8)",
        }}
      >
        <h3 id="connect-confirm-title" style={{ marginTop: 0, marginBottom: "var(--space-2)" }}>
          이 기기 연결
        </h3>
        <p id="connect-confirm-desc" style={{ marginTop: 0, fontSize: 13 }}>
          {`이 기기를 Gist(…${shortId})에 연결할까요?`}
        </p>
        {replacesOther && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "var(--space-2)",
              padding: "var(--space-3) var(--space-4)",
              borderRadius: "var(--radius-md)",
              background: "var(--warning-light)",
              fontSize: 12,
              marginBottom: "var(--space-2)",
            }}
          >
            <AlertTriangle size={16} aria-hidden="true" style={{ color: "var(--warning)", flexShrink: 0, marginTop: 1 }} />
            <span>{`현재 연결된 Gist(…${currentShortId ?? ""})와 다릅니다. 연결하면 이후 동기화 대상이 바뀝니다.`}</span>
          </div>
        )}
        <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end", marginTop: "var(--space-6)" }}>
          <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
            취소
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void handleConfirm()}>
            {busy ? "연결 중..." : "연결"}
          </button>
        </div>
      </div>
    </div>
  );
};
