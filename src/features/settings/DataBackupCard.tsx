/**
 * 데이터 백업 카드 — 백업 파일 다운로드/복원, 테이블 백업 다운로드/복원, 현재 데이터 새로고침.
 * SettingsPage에서 분리. 파일 input 생성·읽기 흐름은 이 컴포넌트가 소유한다.
 * JSON 편집기 텍스트(text)·오류(error)는 부모 공유 상태 — setText/setError로만 갱신.
 * React.memo로 감싸므로 부모가 넘기는 콜백(onChangeData/setText/setError/onBackupRestored/
 * loadBackupList)은 setState 또는 useCallback으로 참조가 안정적이어야 한다.
 */
import React, { useCallback } from "react";
import { toast } from "react-hot-toast";
import type { AppData } from "../../types";
import { normalizeImportedData } from "../../storage";
import { getKoreaTime } from "../../utils/date";
import { ERROR_MESSAGES } from "../../constants/errorMessages";
import { appDataFromTableBackupPayload, buildTableBackupFile } from "../../utils/tableDataBackup";

interface Props {
  data: AppData;
  onChangeData: (next: AppData) => void;
  setText: React.Dispatch<React.SetStateAction<string>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  /** 로드 실패 후 백업 복원했을 때 호출 (저장 재활성화) */
  onBackupRestored?: () => void;
  /** 복원 후 백업 목록 갱신 (부모 useCallback — 참조 고정) */
  loadBackupList: () => Promise<unknown>;
}

export const DataBackupCard: React.FC<Props> = React.memo(function DataBackupCard({
  data,
  onChangeData,
  setText,
  setError,
  onBackupRestored,
  loadBackupList
}) {
  const handleExport = () => {
    try {
      setText(JSON.stringify(data, null, 2));
      setError(null);
      toast.success("현재 데이터를 불러왔습니다.");
    } catch (error) {
      console.error("데이터 내보내기 실패:", error);
      toast.error(ERROR_MESSAGES.DATA_LOAD_FAILED);
      setError("데이터를 불러오는 중 오류가 발생했습니다.");
    }
  };

  // 백업 파일로 다운로드
  const handleDownloadBackup = useCallback(() => {
    try {
      const jsonData = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonData], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const koreaTime = getKoreaTime();
      const year = koreaTime.getFullYear();
      const month = String(koreaTime.getMonth() + 1).padStart(2, "0");
      const day = String(koreaTime.getDate()).padStart(2, "0");
      const hours = String(koreaTime.getHours()).padStart(2, "0");
      const minutes = String(koreaTime.getMinutes()).padStart(2, "0");
      a.download = `farmwallet-backup-${year}${month}${day}-${hours}${minutes}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("백업 파일을 다운로드했습니다.");
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("백업 다운로드 실패:", error);
      }
      toast.error(ERROR_MESSAGES.BACKUP_DOWNLOAD_FAILED);
    }
  }, [data]);

  const handleDownloadTableBackup = useCallback(() => {
    try {
      const payload = buildTableBackupFile(data);
      const jsonData = JSON.stringify(payload, null, 2);
      const blob = new Blob([jsonData], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const koreaTime = getKoreaTime();
      const year = koreaTime.getFullYear();
      const month = String(koreaTime.getMonth() + 1).padStart(2, "0");
      const day = String(koreaTime.getDate()).padStart(2, "0");
      const hours = String(koreaTime.getHours()).padStart(2, "0");
      const minutes = String(koreaTime.getMinutes()).padStart(2, "0");
      a.download = `farmwallet-tables-${year}${month}${day}-${hours}${minutes}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("테이블 백업 JSON을 다운로드했습니다.");
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("테이블 백업 다운로드 실패:", error);
      }
      toast.error(ERROR_MESSAGES.BACKUP_DOWNLOAD_FAILED);
    }
  }, [data]);

  const handleUploadTableBackup = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const toastId = toast.loading("테이블 백업에서 복원하는 중...");
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;
        const appJson = appDataFromTableBackupPayload(parsed);
        const normalized = normalizeImportedData(appJson);
        onChangeData(normalized);
        setText(JSON.stringify(normalized, null, 2));
        setError(null);
        toast.success("테이블 백업에서 데이터를 복원했습니다.", { id: toastId });
        onBackupRestored?.();
        await loadBackupList();
      } catch (error) {
        setError(ERROR_MESSAGES.TABLE_BACKUP_FILE_INVALID);
        toast.error(ERROR_MESSAGES.TABLE_BACKUP_FILE_INVALID, { id: toastId });
        if (import.meta.env.DEV) {
          console.error("테이블 백업 불러오기 오류:", error);
        }
      }
    };
    input.click();
  }, [onChangeData, setText, setError, loadBackupList, onBackupRestored]);

  // 백업 파일에서 불러오기
  const handleUploadBackup = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      const toastId = toast.loading("백업 파일을 불러오는 중...");
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const normalized = normalizeImportedData(parsed);
        onChangeData(normalized);
        setText(JSON.stringify(normalized, null, 2));
        setError(null);
        toast.success("백업 파일을 성공적으로 불러왔습니다.", { id: toastId });
        onBackupRestored?.();
        await loadBackupList();
      } catch (error) {
        setError(ERROR_MESSAGES.BACKUP_FILE_INVALID);
        toast.error(ERROR_MESSAGES.BACKUP_FILE_INVALID, { id: toastId });
        if (import.meta.env.DEV) {
          console.error("백업 파일 불러오기 오류:", error);
        }
      }
    };
    input.click();
  }, [onChangeData, setText, setError, loadBackupList, onBackupRestored]);

  return (
    <div className="card">
      <div className="card-title">데이터 백업</div>
      <p>
        <strong style={{ color: "var(--warning)" }}>⚠️ 중요:</strong> 웹 브라우저와 Cursor 내부 브라우저는 서로 다른 저장소(localStorage)를 사용합니다.
        웹에서 저장한 백업은 Cursor 내부에서 보이지 않으며, 그 반대도 마찬가지입니다.
        <br />
        <strong>다른 환경에서 백업을 사용하려면:</strong> "백업 파일 다운로드"로 파일을 저장한 후, 다른 환경에서 "백업 파일 불러오기"로 불러오세요.
        <br />
        <strong style={{ color: "var(--primary)" }}>권장:</strong> 데이터 안전을 위해 정기적으로 "백업 파일 다운로드"로 JSON 파일을 저장해 두세요.
        <br />
        <strong>테이블 백업:</strong> 같은 데이터를 <code>tables</code> 아래 행 배열로도 저장합니다. 일반 백업 JSON 없이{" "}
        <strong>테이블 백업 파일만</strong>으로도 복구할 수 있습니다. 데이터를 저장할 때마다 브라우저에 사본이 갱신되고,{" "}
        <code>npm run dev</code>일 때는 프로젝트 <code>data/farmwallet-data.json</code>에도 기록됩니다.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--chart-income)", marginBottom: 6 }}>💾 내보내기 (안전)</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="primary" onClick={handleDownloadBackup} style={{ background: "var(--chart-income)", border: "none", color: "white" }}>
              백업 파일 다운로드
            </button>
            <button type="button" onClick={handleDownloadTableBackup} style={{ background: "var(--surface)", border: "1px solid var(--chart-income)", color: "var(--chart-income)" }}>
              테이블 백업 다운로드
            </button>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--warning, orange)", marginBottom: 6 }}>⚠️ 불러오기 (현재 데이터 덮어쓰기)</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={handleUploadBackup} style={{ background: "var(--surface)", border: "2px solid orange", color: "var(--text)" }}>
              백업 파일에서 복원
            </button>
            <button type="button" onClick={handleUploadTableBackup} style={{ background: "var(--surface)", border: "2px solid orange", color: "var(--text)" }}>
              테이블 백업에서 복원
            </button>
            <button type="button" onClick={handleExport} style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 12 }}>
              현재 데이터 새로고침
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
