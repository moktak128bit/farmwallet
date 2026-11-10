/**
 * 저장 위치 — Google 스프레드시트 (GAS 웹앱의 동기화 탭). Gist 설정 카드 대신 보인다.
 * 지금 저장/다시 불러오기는 useGistSync의 정식 경로(manualPush/manualPull)를 그대로 쓴다 — 충돌 감지 공용.
 */
import React, { useState } from "react";
import { toast } from "react-hot-toast";
import { getGasSheetInfo } from "../../services/gas";

interface Props {
  gistLastPushAt?: string | null;
  gistLastPullAt?: string | null;
  onManualPush?: () => Promise<void>;
  onManualPull?: () => Promise<void>;
}

const formatAt = (iso?: string | null): string =>
  iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "아직 없음";

export const GasStorageCard: React.FC<Props> = ({ gistLastPushAt, gistLastPullAt, onManualPush, onManualPull }) => {
  const [busy, setBusy] = useState(false);
  // 시트 원본 정보(rev·최종 저장 시각)와 이 기기에서 불러온 시각 — 저장·불러오기마다 갱신(services/gas recordGasSheetInfo).
  // 예전엔 '마지막 저장'·'마지막 불러오기' 둘 다 시트 updatedAt이라 같은 값이었다. props 시각은 다시 그리는 트리거로만 쓴다.
  void gistLastPushAt;
  void gistLastPullAt;
  const sheet = getGasSheetInfo();
  const run = async (fn?: () => Promise<void>) => {
    if (!fn) {
      toast.error("동기화 핸들러가 연결되지 않았습니다.");
      return;
    }
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-title">저장 위치 — Google 스프레드시트</div>
      <p className="hint" style={{ marginBottom: 12 }}>
        데이터는 Drive 데이터 폴더의 &quot;FarmWallet 데이터&quot; 시트에 자동 저장됩니다(본인 계정만 접근). 휴대폰·PC 어디서
        열어도 같은 데이터입니다. 시트는 보관용이라 직접 고치지 말고 앱에서 수정하세요.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <button type="button" className="primary" disabled={busy} onClick={() => void run(onManualPush)}>
          {busy ? "진행 중..." : "지금 저장"}
        </button>
        <button type="button" disabled={busy} onClick={() => void run(onManualPull)}>
          시트에서 다시 불러오기
        </button>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        시트 최종 저장: {formatAt(sheet.updatedAt)}
        {sheet.revision != null ? ` (rev ${sheet.revision})` : ""} · 이 기기에서 불러온 시각: {formatAt(sheet.loadedAt)}
      </p>
    </div>
  );
};
