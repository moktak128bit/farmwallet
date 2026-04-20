import React, { useMemo, useState } from "react";
import type { GistConflict } from "../store/uiStore";
import type { GistConflictResolution } from "../hooks/useGistSync";

interface GistConflictModalProps {
  conflict: GistConflict | null;
  onResolve: (resolution: GistConflictResolution) => void;
}

/**
 * 충돌 데이터 요약: 주요 컬렉션 길이를 비교용으로 보여줌.
 * JSON 파싱 실패 시 "?"로 표시.
 */
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

export const GistConflictModal: React.FC<GistConflictModalProps> = ({ conflict, onResolve }) => {
  const [busy, setBusy] = useState<GistConflictResolution | null>(null);

  const summary = useMemo(() => {
    if (!conflict) return null;
    return {
      remote: summarizeJson(conflict.remoteDataJson),
      local: summarizeJson(conflict.pendingLocalDataJson),
    };
  }, [conflict]);

  if (!conflict || !summary) return null;

  const handle = async (resolution: GistConflictResolution) => {
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
      aria-labelledby="gist-conflict-title"
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
        <h3 id="gist-conflict-title" style={{ marginTop: 0, marginBottom: "var(--space-2)" }}>
          Gist 동기화 충돌
        </h3>
        <p style={{ marginTop: 0, color: "var(--text-muted)" }}>
          자동 저장 직전에 원격 Gist가 다른 기기에서 변경되었습니다. 어떻게 처리할지 선택하세요.
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
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: "var(--space-1)" }}>원격 (Gist)</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: "var(--space-1)" }}>
              {new Date(conflict.remoteUpdatedAt).toLocaleString("ko-KR")}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              <li>가계부: {summary.remote.ledger}건</li>
              <li>거래: {summary.remote.trades}건</li>
              <li>계좌: {summary.remote.accounts}개</li>
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
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: "var(--space-1)" }}>로컬 (이 기기)</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: "var(--space-1)" }}>
              push 대기 중
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              <li>가계부: {summary.local.ledger}건</li>
              <li>거래: {summary.local.trades}건</li>
              <li>계좌: {summary.local.accounts}개</li>
            </ul>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <button
            type="button"
            className="primary"
            disabled={busy !== null}
            onClick={() => void handle("apply-remote")}
            style={{ textAlign: "left", padding: "var(--space-3) var(--space-4)" }}
          >
            <div style={{ fontWeight: 600 }}>원격 적용 (권장)</div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
              원격 Gist 데이터를 로컬에 반영합니다. 이 기기의 미저장 변경은 폐기됩니다.
            </div>
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy !== null}
            onClick={() => void handle("force-push-local")}
            style={{ textAlign: "left", padding: "var(--space-3) var(--space-4)", borderColor: "var(--danger)" }}
          >
            <div style={{ fontWeight: 600, color: "var(--danger)" }}>로컬 강제 푸시 (주의)</div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
              이 기기의 데이터를 원격에 강제 저장합니다. 다른 기기의 최근 변경은 폐기됩니다.
            </div>
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy !== null}
            onClick={() => void handle("cancel")}
            style={{ textAlign: "left", padding: "var(--space-3) var(--space-4)" }}
          >
            <div style={{ fontWeight: 600 }}>취소</div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
              아무것도 하지 않습니다. 다음 자동 저장 시 다시 충돌이 감지될 수 있습니다.
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};
