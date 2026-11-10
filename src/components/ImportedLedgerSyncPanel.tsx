import { useState } from "react";
import { GistSyncCard } from "../features/settings/GistSyncCard";
import { getGistToken } from "../services/gistSync";

interface Props {
  ledgerCount: number;
  tradeCount: number;
  isSyncing: boolean;
  autoSyncEnabled: boolean;
  lastPushAt: string | null;
  lastPullAt: string | null;
  onAutoSyncChange: (enabled: boolean) => void;
  onPush: () => Promise<void>;
  onPull: () => Promise<void>;
}

/** 복구가 끝나도 업로드·연결 동작은 화면에 남겨 별도 메뉴를 찾지 않게 한다. */
export function ImportedLedgerSyncPanel(props: Props) {
  const [settingsOpen, setSettingsOpen] = useState(() => !getGistToken());
  return (
    <section className="card" style={{ margin: "12px 16px" }} aria-label="불러온 장부와 Gist 저장">
      <strong>이 브라우저에 가계부 {props.ledgerCount.toLocaleString("ko-KR")}건 · 주식 거래 {props.tradeCount.toLocaleString("ko-KR")}건을 불러왔습니다.</strong>
      <p className="hint">Gist 업로드가 완료되면 아래에 저장 시각이 표시됩니다. 다른 기기의 변경이 있으면 먼저 비교합니다.</p>
      <button type="button" className="primary" disabled={props.isSyncing} onClick={() => {
        if (!getGistToken()) { setSettingsOpen(true); return; }
        void props.onPush();
      }}>{props.isSyncing ? "Gist 저장 중…" : "Gist에 업로드"}</button>
      <button type="button" style={{ marginLeft: 8 }} onClick={() => setSettingsOpen((open) => !open)}>Gist 연결 설정</button>
      {props.lastPushAt && <p style={{ fontSize: 13 }}>최근 Gist 저장: {new Date(props.lastPushAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>}
      {settingsOpen && <GistSyncCard autoSyncEnabled={props.autoSyncEnabled} onAutoSyncChange={props.onAutoSyncChange}
        gistLastPushAt={props.lastPushAt} gistLastPullAt={props.lastPullAt} onManualPush={props.onPush} onManualPull={props.onPull} />}
    </section>
  );
}
