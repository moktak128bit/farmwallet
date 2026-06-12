/**
 * 백업 기록 표 — 자동 백업 스냅샷 목록과 시점 복원 버튼. SettingsPage에서 분리.
 * 복원 핸들러(handleRestoreBackup)는 이 표에서만 쓰여 이 컴포넌트가 소유한다.
 * JSON 편집기 텍스트(text)·오류(error)는 부모 공유 상태 — setText/setError로만 갱신.
 * React.memo로 감싸므로 부모가 넘기는 콜백(onChangeData/setText/setError/
 * onBackupRestored/loadBackupList)은 setState 또는 useCallback으로 참조가 안정적이어야 한다.
 */
import React, { useCallback } from "react";
import { toast } from "react-hot-toast";
import type { AppData } from "../../types";
import { loadBackupData, normalizeImportedData, saveSafetySnapshot, type BackupEntry } from "../../storage";
import { ERROR_MESSAGES } from "../../constants/errorMessages";

interface Props {
  backups: BackupEntry[];
  /** 현재 데이터 — 복원 직전 안전 스냅샷용 */
  data: AppData;
  onChangeData: (next: AppData) => void;
  setText: React.Dispatch<React.SetStateAction<string>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  /** 로드 실패 후 백업 복원했을 때 호출 (저장 재활성화) */
  onBackupRestored?: () => void;
  /** 복원 후 백업 목록 갱신 (부모 useCallback — 참조 고정) */
  loadBackupList: () => Promise<unknown>;
}

export const BackupHistoryTable: React.FC<Props> = React.memo(function BackupHistoryTable({
  backups,
  data,
  onChangeData,
  setText,
  setError,
  onBackupRestored,
  loadBackupList
}) {
  const handleRestoreBackup = useCallback(async (entry: BackupEntry) => {
    const when = new Date(entry.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
    if (!window.confirm(`${when} 시점 백업으로 현재 데이터를 덮어씁니다.\n복원 직전 현재 데이터는 안전 스냅샷으로 보관됩니다. 계속할까요?`)) {
      return;
    }
    const toastId = toast.loading("백업을 복원하는 중...");
    try {
      // 복원 직전 현재 데이터 안전 스냅샷 (실수 복원 시 되돌릴 수 있게)
      await saveSafetySnapshot(data, "백업 복원 직전 자동 스냅샷");

      // 백업 목록은 로컬(브라우저) 백업만 제공됨 — getAllBackupList 참조
      const restored = loadBackupData(entry.id);

      if (!restored) {
        setError(ERROR_MESSAGES.BACKUP_SELECTED_NOT_FOUND);
        toast.error(ERROR_MESSAGES.BACKUP_SELECTED_NOT_FOUND, { id: toastId });
        return;
      }

      const normalized = normalizeImportedData(restored);
      onChangeData(normalized);
      setText(JSON.stringify(normalized, null, 2));
      setError(null);
      toast.success("백업이 성공적으로 복원되었습니다.", { id: toastId });
      onBackupRestored?.();
      await loadBackupList();
    } catch (e) {
      setError(ERROR_MESSAGES.BACKUP_RESTORE_FAILED);
      toast.error(ERROR_MESSAGES.BACKUP_RESTORE_FAILED, { id: toastId });
      if (import.meta.env.DEV) {
        console.error("백업 복원 오류:", e);
      }
    }
  }, [data, onChangeData, setText, setError, loadBackupList, onBackupRestored]);

  return (
    <table className="data-table compact">
      <thead>
        <tr>
          <th style={{ width: "55%" }}>백업 시각</th>
          <th style={{ width: "25%" }}>저장 위치</th>
          <th>복원</th>
        </tr>
      </thead>
      <tbody>
        {backups.length === 0 && (
          <tr>
            <td colSpan={3} style={{ textAlign: "center" }}>
              백업 기록이 없습니다.
            </td>
          </tr>
        )}
        {backups.map((b) => (
          <tr key={`${b.source}-${b.id}`}>
            <td>
              {new Date(b.createdAt).toLocaleString("ko-KR", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Seoul"
              })}
              {b.label && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{b.label}</div>
              )}
            </td>
            <td>브라우저 저장소</td>
            <td>
              <button type="button" onClick={() => handleRestoreBackup(b)}>
                이 시점으로 복원
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
});
