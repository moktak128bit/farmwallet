/**
 * JSON 편집기 섹션 — JSON 붙여넣기 textarea + "JSON 불러오기" 버튼 + 오류 표시.
 * SettingsPage에서 분리. text/error 상태는 다른 카드(백업 복원·초기화 등)도 갱신하는
 * 부모 공유 상태라 props로 받는다 (타이핑 시 부모 재렌더는 기존과 동일 — 다른 카드는
 * memo로 재렌더를 건너뛴다).
 * React.memo로 감싸므로 부모가 넘기는 콜백(setText/onChangeData/onBackupRestored)은
 * setState 또는 useCallback으로 참조가 안정적이어야 한다.
 */
import React, { useCallback } from "react";
import { toast } from "react-hot-toast";
import type { AppData } from "../../types";
import { normalizeImportedData, saveSafetySnapshot } from "../../storage";
import { ERROR_MESSAGES } from "../../constants/errorMessages";

interface Props {
  text: string;
  setText: React.Dispatch<React.SetStateAction<string>>;
  error: string | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  /** 현재 데이터 — 가져오기 직전 안전 스냅샷용 */
  data: AppData;
  onChangeData: (next: AppData) => void;
  /** 로드 실패 후 백업 복원했을 때 호출 (저장 재활성화) */
  onBackupRestored?: () => void;
}

export const JsonImportSection: React.FC<Props> = React.memo(function JsonImportSection({
  text,
  setText,
  error,
  setError,
  data,
  onChangeData,
  onBackupRestored
}) {
  const handleImport = useCallback(async () => {
    try {
      if (!text || !text.trim()) {
        toast.error(ERROR_MESSAGES.JSON_INPUT_REQUIRED);
        setError(ERROR_MESSAGES.JSON_INPUT_REQUIRED);
        return;
      }
      if (!window.confirm("입력한 JSON 데이터로 현재 데이터를 덮어씁니다.\n적용 직전 현재 데이터는 안전 스냅샷으로 보관됩니다. 계속할까요?")) {
        return;
      }
      const parsed = JSON.parse(text);
      // 적용 직전 현재 데이터 안전 스냅샷
      await saveSafetySnapshot(data, "JSON 가져오기 직전 자동 스냅샷");
      const normalized = normalizeImportedData(parsed);
      onChangeData(normalized);
      setText(JSON.stringify(normalized, null, 2));
      setError(null);
      toast.success("데이터를 성공적으로 불러왔습니다.");
      onBackupRestored?.();
    } catch (e) {
      setError(ERROR_MESSAGES.JSON_FORMAT_INVALID);
      toast.error(ERROR_MESSAGES.JSON_FORMAT_INVALID);
      if (import.meta.env.DEV) {
        console.error("JSON 파싱 오류:", e);
      }
    }
  }, [text, setText, setError, data, onChangeData, onBackupRestored]);

  return (
    <>
      <textarea
        className="json-editor"
        aria-label="가져올 JSON 데이터 입력"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="JSON을 붙여넣거나 위 '현재 데이터 새로고침' 버튼을 눌러주세요."
        rows={20}
      />
      <div className="form-actions">
        <button type="button" className="primary" onClick={() => { void handleImport(); }}>
          JSON 불러오기
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </>
  );
});
