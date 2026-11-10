import type { useLocalFileRecovery } from "../hooks/useLocalFileRecovery";

interface Props {
  recovery: ReturnType<typeof useLocalFileRecovery>;
  onRestore: () => void;
  onRestoreAndUpload?: () => void;
}

export function LocalFileRecoveryBanner({ recovery, onRestore, onRestoreAndUpload }: Props) {
  const { state } = recovery;
  if (state.status === "idle") return null;
  const candidate = state.status === "ready" ? state.candidate : null;
  const savedAt = candidate?.exportedAt && Number.isFinite(Date.parse(candidate.exportedAt))
    ? new Date(candidate.exportedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : null;
  return (
    <div role="status" style={{ margin: "12px 16px", padding: 16, borderRadius: 12, background: "var(--warning-bg)", color: "var(--text)" }}>
      <strong>{candidate ? "이 브라우저에 저장된 장부가 없습니다. 불러올 파일을 찾았습니다." : state.status === "checking" ? "저장된 가계부 파일을 확인하고 있습니다…" : "가계부 파일을 확인하지 못했습니다."}</strong>
      {candidate && <p style={{ margin: "8px 0", fontSize: 14 }}>
        {candidate.source} · 가계부 {candidate.data.ledger.length.toLocaleString("ko-KR")}건 · 주식 거래 {candidate.data.trades.length.toLocaleString("ko-KR")}건
        {savedAt && <> · 저장 시각 {savedAt}</>}
      </p>}
      <p style={{ margin: "8px 0", fontSize: 13 }}>확인이 끝날 때까지 자동 저장을 멈춰 기존 장부를 보호합니다.</p>
      {candidate && <button type="button" className="primary" onClick={onRestore}>저장된 가계부 불러오기</button>}
      {candidate && onRestoreAndUpload && <button type="button" onClick={onRestoreAndUpload} style={{ marginLeft: 8 }}>불러오고 Gist에 업로드</button>}
      {state.status === "error" && <button type="button" onClick={recovery.retry}>파일 다시 확인</button>}
    </div>
  );
}
