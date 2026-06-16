import React, { useEffect, useMemo, useState } from "react";
import type { GistConflict } from "../store/uiStore";
import type { GistConflictResolution } from "../hooks/useGistSync";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useModalStackEntry } from "../utils/modalStack";

interface GistConflictModalProps {
  conflict: GistConflict | null;
  onResolve: (resolution: GistConflictResolution) => void;
}

interface ConflictSummary {
  ledger: number | string;
  trades: number | string;
  accounts: number | string;
  /** 가장 최신 가계부 날짜 — '같은 건수 중 1건만 수정'된 충돌을 건수만으로 구분 못 하는 문제 보완 */
  latestDate: string;
  /** 가계부 금액 합계 (원) — 금액만 바뀐 수정도 구분 */
  amountSum: number | null;
}

/**
 * 충돌 데이터 요약: 주요 컬렉션 길이 + 최신 가계부 날짜 + 금액 합계를 비교용으로 보여줌.
 * JSON 파싱 실패 시 "?"로 표시.
 */
function summarizeJson(json: string): ConflictSummary {
  try {
    const parsed = JSON.parse(json) as {
      ledger?: Array<{ date?: unknown; amount?: unknown }>;
      trades?: unknown[];
      accounts?: unknown[];
    };
    const ledger = Array.isArray(parsed.ledger) ? parsed.ledger : null;
    const latestDate = ledger
      ? ledger.reduce((max, l) => (typeof l?.date === "string" && l.date > max ? l.date : max), "")
      : "";
    const amountSum = ledger
      ? Math.round(ledger.reduce((s, l) => s + (Number(l?.amount) || 0), 0))
      : null;
    return {
      ledger: ledger ? ledger.length : "?",
      trades: Array.isArray(parsed.trades) ? parsed.trades.length : "?",
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts.length : "?",
      latestDate: latestDate || "—",
      amountSum,
    };
  } catch {
    return { ledger: "?", trades: "?", accounts: "?", latestDate: "—", amountSum: null };
  }
}

export const GistConflictModal: React.FC<GistConflictModalProps> = ({ conflict, onResolve }) => {
  const [busy, setBusy] = useState<GistConflictResolution | null>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(!!conflict);
  const isTopModal = useModalStackEntry(!!conflict);

  const summary = useMemo(() => {
    if (!conflict) return null;
    return {
      remote: summarizeJson(conflict.remoteDataJson),
      local: summarizeJson(conflict.pendingLocalDataJson),
    };
  }, [conflict]);

  // ESC = 취소 (아무것도 적용하지 않고 닫기)
  useEffect(() => {
    if (!conflict) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // 모달 중첩 시 최상위 모달만 ESC로 닫힘
      if (e.key === "Escape" && isTopModal()) {
        e.stopPropagation();
        onResolve("cancel");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [conflict, onResolve, isTopModal]);

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
              <li>최신 가계부: {summary.remote.latestDate}</li>
              <li>가계부 합계: {summary.remote.amountSum != null ? `${summary.remote.amountSum.toLocaleString()}원` : "?"}</li>
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
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: "var(--space-1)" }}>로컬 (이 기기 · 현재 화면 데이터)</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: "var(--space-1)" }}>
              push 대기 중
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              <li>가계부: {summary.local.ledger}건</li>
              <li>거래: {summary.local.trades}건</li>
              <li>계좌: {summary.local.accounts}개</li>
              <li>최신 가계부: {summary.local.latestDate}</li>
              <li>가계부 합계: {summary.local.amountSum != null ? `${summary.local.amountSum.toLocaleString()}원` : "?"}</li>
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
