import React, { useEffect, useMemo, useState } from "react";
import type { TabConflict } from "../store/uiStore";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useModalStackEntry } from "../utils/modalStack";

export type TabConflictResolution = "keep-local" | "apply-remote";

interface TabConflictModalProps {
  conflict: TabConflict | null;
  onResolve: (resolution: TabConflictResolution) => void;
  /** ESC로 결정 없이 닫기 (충돌은 미해결 상태로 남음 — 다음 변경 시 다시 감지될 수 있음) */
  onDismiss?: () => void;
}

function summarizeJson(json: string): { ledger: number | string; trades: number | string; accounts: number | string } {
  try {
    const parsed = JSON.parse(json) as {
      ledger?: unknown[];
      trades?: unknown[];
      accounts?: unknown[];
    };
    return {
      ledger: Array.isArray(parsed.ledger) ? parsed.ledger.length : "?",
      trades: Array.isArray(parsed.trades) ? parsed.trades.length : "?",
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts.length : "?",
    };
  } catch {
    return { ledger: "?", trades: "?", accounts: "?" };
  }
}

/**
 * 탭 간 편집 충돌. 우리 탭에 미저장 dirty가 있는 동안 다른 탭이 저장한 경우 노출.
 * 양쪽 데이터의 주요 컬렉션 카운트를 보여 사용자가 어느 쪽을 살릴지 결정.
 */
export const TabConflictModal: React.FC<TabConflictModalProps> = ({ conflict, onResolve, onDismiss }) => {
  const [busy, setBusy] = useState<TabConflictResolution | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(!!conflict);
  const isTopModal = useModalStackEntry(!!conflict);

  // ESC = 결정 없이 닫기 (onDismiss가 주어진 경우만)
  useEffect(() => {
    if (!conflict || !onDismiss) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // 모달 중첩 시 최상위 모달만 ESC로 닫힘
      if (e.key === "Escape" && isTopModal()) {
        e.stopPropagation();
        onDismiss();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [conflict, onDismiss, isTopModal]);

  const summary = useMemo(() => {
    if (!conflict) return null;
    return {
      remote: summarizeJson(conflict.remoteDataJson),
      local: summarizeJson(conflict.localDataJson),
    };
  }, [conflict]);

  if (!conflict || !summary) return null;

  const handle = async (resolution: TabConflictResolution) => {
    setBusy(resolution);
    try {
      await Promise.resolve(onResolve(resolution));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tab-conflict-title"
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
          maxWidth: 560,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-xl)",
          padding: "var(--space-8)",
        }}
      >
        <h3 id="tab-conflict-title" style={{ marginTop: 0, marginBottom: "var(--space-2)" }}>
          탭 간 편집 충돌
        </h3>
        <p style={{ marginTop: 0, color: "var(--text-muted)" }}>
          이 탭에 미저장 변경이 있는 동안 다른 탭에서 데이터가 저장되었습니다. 어느 쪽을 유지할지 선택하세요.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "var(--space-4)",
            margin: "var(--space-6) 0",
          }}
        >
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "var(--space-4)",
              background: "var(--bg)",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: "var(--space-1)" }}>이 탭 (미저장)</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: "var(--space-1)" }}>
              디바운스 대기 중
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              <li>가계부: {summary.local.ledger}건</li>
              <li>거래: {summary.local.trades}건</li>
              <li>계좌: {summary.local.accounts}개</li>
            </ul>
          </div>
          <div
            style={{
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              padding: "var(--space-4)",
              background: "var(--bg)",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: "var(--space-1)" }}>다른 탭 (저장됨)</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: "var(--space-1)" }}>
              {new Date(conflict.detectedAt).toLocaleTimeString("ko-KR")}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              <li>가계부: {summary.remote.ledger}건</li>
              <li>거래: {summary.remote.trades}건</li>
              <li>계좌: {summary.remote.accounts}개</li>
            </ul>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <button
            type="button"
            className="primary"
            disabled={busy !== null}
            onClick={() => void handle("keep-local")}
            style={{ textAlign: "left", padding: "var(--space-3) var(--space-4)" }}
          >
            <div style={{ fontWeight: 600 }}>이 탭 유지 (다른 탭 덮어쓰기)</div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
              지금 즉시 저장하고 다른 탭에 이 값을 동기화합니다. 다른 탭의 변경은 폐기됩니다.
            </div>
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy !== null}
            onClick={() => void handle("apply-remote")}
            style={{ textAlign: "left", padding: "var(--space-3) var(--space-4)", borderColor: "var(--danger)" }}
          >
            <div style={{ fontWeight: 600, color: "var(--danger)" }}>다른 탭 적용 (이 탭 변경 폐기)</div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
              다른 탭에서 저장된 데이터를 이 탭에도 반영합니다. 이 탭의 미저장 변경은 폐기됩니다.
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
