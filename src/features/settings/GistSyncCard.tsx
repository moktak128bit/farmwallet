/**
 * 클라우드 동기화 (GitHub Gist) 카드 — 토큰/Gist ID 입력, 수동 저장·불러오기,
 * 자동 동기화 토글. SettingsPage에서 분리.
 * gistToken/gistTokenPersist/gistId/gistSyncing/gistLastSync 상태는 이 카드 전용이라
 * 이 컴포넌트가 소유한다 (입력 타이핑이 부모를 재렌더하지 않음).
 * 저장/불러오기는 useGistSync의 manualPush/manualPull(정식 경로)을 props로 받아 사용 —
 * 카드 자체 fetch로 충돌 감지·lastPushAt/lastPullAt 갱신을 우회하지 않는다.
 * React.memo로 감싸므로 부모가 넘기는 콜백은 참조가 안정적이어야 한다.
 */
import React, { useState } from "react";
import { toast } from "react-hot-toast";
import {
  getGistToken,
  getGistTokenPersisted,
  setGistToken as gistSetToken,
  setGistTokenPersisted as gistSetTokenPersisted,
  getGistId,
  setGistId as gistSetId,
} from "../../services/gistSync";

interface Props {
  /** 자동 Gist 동기화 ON/OFF */
  autoSyncEnabled: boolean;
  onAutoSyncChange?: (enabled: boolean) => void;
  /** 마지막 자동 저장/불러오기 시각 */
  gistLastPushAt?: string | null;
  gistLastPullAt?: string | null;
  /** 정식 push 경로 (충돌 감지·lastPushAt·payload 기록 포함) — useGistSync.manualPush */
  onManualPush?: () => Promise<void>;
  /** 정식 pull 경로 (검증·안전 스냅샷·lastPullAt 갱신 포함) — useGistSync.manualPull */
  onManualPull?: () => Promise<void>;
}

export const GistSyncCard: React.FC<Props> = React.memo(function GistSyncCard({
  autoSyncEnabled,
  onAutoSyncChange,
  gistLastPushAt,
  gistLastPullAt,
  onManualPush,
  onManualPull
}) {
  const [gistToken, setGistToken] = useState(() => getGistToken());
  const [gistTokenPersist, setGistTokenPersist] = useState(() => getGistTokenPersisted());
  const [gistId, setGistIdState] = useState(() => getGistId());
  const [gistSyncing, setGistSyncing] = useState(false);
  const [gistLastSync, setGistLastSync] = useState<string | null>(null);

  return (
    <div className="card">
      <div className="card-title">클라우드 동기화 (GitHub Gist)</div>
      <p className="hint" style={{ marginBottom: 8 }}>
        GitHub Personal Access Token (gist 권한)으로 데이터를 Private Gist에 저장/불러옵니다.
        <br />다른 기기에서도 동일한 토큰 + Gist ID로 데이터를 공유할 수 있습니다.
      </p>
      <p className="hint" style={{ marginBottom: 12, color: "var(--warning)" }}>
        주의: secret gist도 URL을 아는 사람은 누구나 열람할 수 있습니다. 민감한 정보가 있다면 공유에 유의하세요.
      </p>
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ minWidth: 80 }}>Token</span>
        <input
          type="password"
          value={gistToken}
          onChange={(e) => setGistToken(e.target.value)}
          // 키 입력마다 storage에 기록하지 않고 입력을 마친 시점(blur)에만 저장
          onBlur={() => gistSetToken(gistToken, { persist: gistTokenPersist })}
          placeholder="ghp_xxxxxxxxxxxx"
          autoComplete="off"
          spellCheck={false}
          style={{ flex: 1, padding: "6px 10px", borderRadius: 6, fontFamily: "monospace", fontSize: 12 }}
        />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 12, color: "var(--text-muted)" }}>
        <input
          type="checkbox"
          checked={gistTokenPersist}
          onChange={(e) => {
            const next = e.target.checked;
            setGistTokenPersist(next);
            gistSetTokenPersisted(next);
            toast(next
              ? "토큰이 이 기기에 영구 저장됩니다 (XSS 위험 증가)."
              : "토큰은 이 탭에서만 유지됩니다 (탭을 닫으면 재입력 필요).");
          }}
        />
        <span>이 기기에서 기억 (꺼두면 탭 닫을 때 토큰 삭제 — 권장)</span>
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ minWidth: 80 }}>Gist ID</span>
        <input
          type="text"
          value={gistId}
          onChange={(e) => { setGistIdState(e.target.value); gistSetId(e.target.value); }}
          placeholder="자동 생성됨 (첫 저장 시)"
          style={{ flex: 1, padding: "6px 10px", borderRadius: 6, fontFamily: "monospace", fontSize: 12 }}
          readOnly={false}
        />
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--chart-income)", marginBottom: 6 }}>Gist에 저장 (안전 — 현재 데이터를 백업)</div>
          <button
            type="button"
            disabled={gistSyncing || !gistToken}
            onClick={async () => {
              if (!onManualPush) {
                toast.error("동기화 핸들러가 연결되지 않았습니다.");
                return;
              }
              setGistSyncing(true);
              try {
                // 정식 push 경로 — 충돌 감지·lastPushedPayload·GIST_LAST_PUSH_AT 갱신 포함
                // (성공/실패/충돌 토스트는 manualPush 내부에서 처리)
                await onManualPush();
                // 첫 저장 시 Gist가 새로 생성됐을 수 있어 ID 필드 동기화
                setGistIdState(getGistId());
                setGistLastSync(new Date().toISOString());
              } finally {
                setGistSyncing(false);
              }
            }}
            style={{ background: "var(--chart-income)", border: "none", color: "white", padding: "8px 20px", borderRadius: 8, fontWeight: 600 }}
          >
            {gistSyncing ? "동기화 중..." : "Gist에 저장"}
          </button>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--warning, orange)", marginBottom: 6 }}>Gist에서 불러오기 (현재 데이터 덮어쓰기)</div>
          <button
            type="button"
            disabled={gistSyncing || !gistToken || !gistId}
            onClick={async () => {
              if (!onManualPull) {
                toast.error("동기화 핸들러가 연결되지 않았습니다.");
                return;
              }
              if (!window.confirm("Gist의 데이터로 현재 데이터를 덮어씁니다.\n적용 직전 현재 데이터는 안전 스냅샷으로 보관됩니다. 계속할까요?")) {
                return;
              }
              setGistSyncing(true);
              try {
                // 정식 pull 경로 — 데이터 검증·안전 스냅샷·lastPullAt 갱신 포함
                // (성공/실패 토스트는 manualPull 내부에서 처리)
                await onManualPull();
                setGistLastSync(new Date().toISOString());
              } finally {
                setGistSyncing(false);
              }
            }}
            style={{ background: "var(--surface)", border: "2px solid var(--warning)", color: "var(--text)", padding: "8px 20px", borderRadius: 8, fontWeight: 600 }}
          >
            Gist에서 불러오기
          </button>
        </div>
      </div>
      {gistLastSync && (
        <p className="hint" style={{ marginTop: 8 }}>
          마지막 동기화: {new Date(gistLastSync).toLocaleString("ko-KR")}
        </p>
      )}
      <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <div className="card-title" style={{ fontSize: 13, marginBottom: 8 }}>자동 동기화</div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, cursor: (!gistToken || !gistId) ? "not-allowed" : "pointer" }}>
          <input
            type="checkbox"
            checked={autoSyncEnabled}
            disabled={!gistToken || !gistId}
            onChange={(e) => {
              onAutoSyncChange?.(e.target.checked);
              toast.success(e.target.checked ? "자동 동기화를 켰습니다." : "자동 동기화를 껐습니다.");
            }}
          />
          <span style={{ fontSize: 13 }}>자동 동기화 사용 (데이터 변경 후 5분 뒤 자동 저장 · 앱 시작 시 자동 불러오기)</span>
        </label>
        {(!gistToken || !gistId) && (
          <p className="hint">Token과 Gist ID를 먼저 설정해야 자동 동기화를 사용할 수 있습니다.</p>
        )}
        {gistLastPushAt && (
          <p className="hint" style={{ marginTop: 4 }}>
            마지막 자동 저장: {new Date(gistLastPushAt).toLocaleString("ko-KR")}
          </p>
        )}
        {gistLastPullAt && (
          <p className="hint" style={{ marginTop: 2 }}>
            마지막 자동 불러오기: {new Date(gistLastPullAt).toLocaleString("ko-KR")}
          </p>
        )}
      </div>
    </div>
  );
});
