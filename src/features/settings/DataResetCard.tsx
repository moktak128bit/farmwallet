/**
 * 데이터 초기화 카드 — 모든 앱 데이터를 빈 상태로 되돌린다 (위험 흐름).
 * SettingsPage에서 분리. window.confirm 문구·토스트 순서는 원본 그대로 유지.
 * React.memo로 감싸므로 부모가 넘기는 콜백(onChangeData/setText/setError)은
 * setState 또는 useCallback으로 참조가 안정적이어야 한다.
 */
import React, { useCallback } from "react";
import { toast } from "react-hot-toast";
import type { AppData } from "../../types";
import { getEmptyData, saveData, saveSafetySnapshot } from "../../storage";

interface Props {
  /** 현재 데이터 — 초기화 직전 안전 스냅샷용 */
  data: AppData;
  onChangeData: (next: AppData) => void;
  setText: React.Dispatch<React.SetStateAction<string>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}

export const DataResetCard: React.FC<Props> = React.memo(function DataResetCard({
  data,
  onChangeData,
  setText,
  setError
}) {
  const handleResetAllData = useCallback(async () => {
    const confirmed = window.confirm(
      "가계부, 주식, 계좌 등 모든 데이터가 삭제됩니다. 복구할 수 없습니다.\n" +
      "Gist 자동 동기화가 켜져 있으면 초기화된 빈 데이터가 원격(Gist)에도 push됩니다.\n" +
      "초기화 직전 현재 데이터는 안전 스냅샷으로 보관됩니다.\n\n정말 초기화하시겠습니까?"
    );
    if (!confirmed) return;
    try {
      // 초기화 직전 안전 스냅샷 — 실수로 초기화해도 백업 기록에서 되돌릴 수 있게
      await saveSafetySnapshot(data, "데이터 초기화 직전 자동 스냅샷");
      const empty = getEmptyData();
      saveData(empty);
      onChangeData(empty);
      setText(JSON.stringify(empty, null, 2));
      setError(null);
      toast.success("모든 데이터가 초기화되었습니다. 처음부터 다시 사용할 수 있습니다.");
    } catch (err) {
      if (import.meta.env.DEV) console.error("데이터 초기화 실패:", err);
      toast.error("초기화 중 오류가 발생했습니다.");
    }
  }, [data, onChangeData, setText, setError]);

  return (
    <div className="card">
      <div className="card-title">데이터 초기화</div>
      <p>
        <strong style={{ color: "var(--danger)" }}>⚠️ 주의:</strong> 가계부, 주식 거래, 계좌, 예산, 배당·이자 등 <strong>모든 앱 데이터를 삭제</strong>하고 빈 상태로 되돌립니다. 복구할 수 없으니 필요 시 먼저 "백업 파일 다운로드"로 저장해 두세요.
        <br />
        <strong style={{ color: "var(--danger)" }}>Gist 자동 동기화가 켜져 있으면 초기화된 빈 데이터가 원격(Gist)에 push되어 다른 기기 데이터도 덮어쓸 수 있습니다.</strong>
      </p>
      <button
        type="button"
        onClick={() => { void handleResetAllData(); }}
        style={{ background: "var(--danger)", color: "white", border: "none", fontWeight: 700, padding: "10px 20px", fontSize: 14 }}
      >
        🗑️ 모든 데이터 초기화하고 처음부터 다시 하기
      </button>
    </div>
  );
});
