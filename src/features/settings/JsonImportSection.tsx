/**
 * JSON 편집기 섹션 — 파일 선택 / 드롭 / 붙여넣기로 JSON을 가져온다.
 * 내보내기 파일은 수백 KB라 붙여넣기가 현실적이지 않아 파일 입력이 기본 경로다.
 * 파일·드롭은 textarea 상태를 거치지 않고 읽은 문자열로 바로 importFrom을 호출한다
 * (setText 직후 handleImport를 부르면 클로저가 이전 text를 본다).
 * SettingsPage에서 분리. text/error 상태는 다른 카드(백업 복원·초기화 등)도 갱신하는
 * 부모 공유 상태라 props로 받는다 (타이핑 시 부모 재렌더는 기존과 동일 — 다른 카드는
 * memo로 재렌더를 건너뛴다).
 * React.memo로 감싸므로 부모가 넘기는 콜백(setText/onChangeData/onBackupRestored)은
 * setState 또는 useCallback으로 참조가 안정적이어야 한다.
 */
import React, { useCallback, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "react-hot-toast";
import type { AppData } from "../../types";
import { normalizeImportedData, saveSafetySnapshot } from "../../storage";
import { isSchemaTooNewError } from "../../services/dataService";
import { ERROR_MESSAGES } from "../../constants/errorMessages";
import { requestApply } from "../../components/ApplyConfirmModal";

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
  const [dragOver, setDragOver] = useState(false);

  const importFrom = useCallback((raw: string) => {
    try {
      if (!raw || !raw.trim()) {
        toast.error(ERROR_MESSAGES.JSON_INPUT_REQUIRED);
        setError(ERROR_MESSAGES.JSON_INPUT_REQUIRED);
        return;
      }
      const parsed = JSON.parse(raw);
      const normalized = normalizeImportedData(parsed);

      requestApply({
        title: "JSON 데이터 가져오기",
        before: data,
        after: normalized,
        onConfirm: () => {
          void (async () => {
            // 적용 직전 현재 데이터 안전 스냅샷
            await saveSafetySnapshot(data, "JSON 가져오기 직전 자동 스냅샷");
            onChangeData(normalized);
            setText(JSON.stringify(normalized, null, 2));
            setError(null);
            toast.success("데이터를 성공적으로 불러왔습니다.");
            onBackupRestored?.();
          })();
        }
      });
    } catch (e) {
      // 스키마가 앱보다 높은 파일은 "형식 오류"가 아니라 앱 업데이트 안내가 맞다
      const msg = isSchemaTooNewError(e) ? e.message : ERROR_MESSAGES.JSON_FORMAT_INVALID;
      setError(msg);
      toast.error(msg);
      if (import.meta.env.DEV) {
        console.error("JSON 파싱 오류:", e);
      }
    }
  }, [setText, setError, data, onChangeData, onBackupRestored]);

  const handleImport = useCallback(() => { importFrom(text); }, [importFrom, text]);

  /** 파일 → 문자열. 같은 파일을 다시 고를 수 있게 input 값을 비운다. */
  const readFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        const raw = await file.text();
        setText(raw);
        importFrom(raw);
      } catch {
        const msg = ERROR_MESSAGES.JSON_FORMAT_INVALID;
        setError(msg);
        toast.error(msg);
      }
    },
    [importFrom, setText, setError]
  );

  return (
    <>
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void readFile(e.dataTransfer.files?.[0]);
        }}
        style={{
          border: `2px dashed ${dragOver ? "var(--primary)" : "var(--border)"}`,
          background: dragOver ? "var(--primary-light)" : "transparent",
          borderRadius: "var(--radius-md)",
          padding: 4
        }}
      >
        <textarea
          className="json-editor"
          aria-label="가져올 JSON 데이터 입력"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="JSON 파일을 여기로 끌어다 놓거나, 아래 '파일 선택'을 누르세요. 직접 붙여넣어도 됩니다."
          rows={20}
        />
      </div>
      <div className="form-actions">
        <label
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer",
            padding: "6px 12px", border: "1px solid var(--border)", borderRadius: 6,
            background: "var(--surface)", color: "var(--text)"
          }}
        >
          <Upload size={14} />
          파일 선택 (.json)
          <input
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              void readFile(file);
            }}
          />
        </label>
        <button type="button" className="primary" onClick={() => { void handleImport(); }}>
          JSON 불러오기
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </>
  );
});
