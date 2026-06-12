/**
 * 자동 백업 스냅샷 카드 — 저장 시 스냅샷 토글(backupOnSave), 백업 목록 새로고침,
 * 오래된 백업 삭제, 최근 백업 요약. SettingsPage에서 분리.
 * backupOnSave 토글 상태는 이 컴포넌트가 소유 — 백업 탭 진입(마운트) 시
 * localStorage에서 다시 읽는다 (기존 탭 전환 effect와 동일 동작).
 * 백업 목록(backups)·로더(loadBackupList)는 부모 공유 상태 — props로 받는다.
 * React.memo로 감싸므로 부모가 넘기는 콜백(loadBackupList/onBackupsChanged)은
 * useCallback 등으로 참조가 안정적이어야 한다.
 */
import React, { useCallback, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { clearOldBackups, type BackupEntry } from "../../storage";
import { STORAGE_KEYS } from "../../constants/config";
import { ERROR_MESSAGES } from "../../constants/errorMessages";

interface Props {
  backups: BackupEntry[];
  /** 백업 목록 재로드 (부모 useCallback — 참조 고정) */
  loadBackupList: () => Promise<BackupEntry[]>;
  /** 백업 목록이 변경되었을 때 호출 (헤더 최신화) */
  onBackupsChanged?: () => void | Promise<void>;
}

export const BackupSnapshotCard: React.FC<Props> = React.memo(function BackupSnapshotCard({
  backups,
  loadBackupList,
  onBackupsChanged
}) {
  const latestBackup = useMemo(() => backups[0], [backups]);

  const [backupOnSave, setBackupOnSave] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEYS.BACKUP_ON_SAVE) === "true";
  });

  const handleRefreshBackups = useCallback(async () => {
    const toastId = toast.loading("백업 목록을 불러오는 중...");
    try {
      const list = await loadBackupList();
      toast.success(`백업 목록을 새로고침했습니다. (${list.length}개)`, { id: toastId });
    } catch {
      toast.error(ERROR_MESSAGES.BACKUP_REFRESH_FAILED, { id: toastId });
    }
  }, [loadBackupList]);

  const handleClearOldBackups = useCallback(() => {
    const removed = clearOldBackups(1);
    if (removed > 0) {
      toast.success(`오래된 백업 ${removed}개를 삭제했습니다. 저장 공간이 확보되었습니다.`);
      void loadBackupList();
      void onBackupsChanged?.();
    } else {
      toast("삭제할 오래된 백업이 없습니다. (최신 1개만 유지 중)");
    }
  }, [loadBackupList, onBackupsChanged]);

  return (
    <div className="card">
      <div className="card-title">자동 백업 스냅샷</div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <input
          type="checkbox"
          checked={backupOnSave}
          onChange={(e) => {
            const v = e.target.checked;
            setBackupOnSave(v);
            if (typeof window !== "undefined") {
              localStorage.setItem(STORAGE_KEYS.BACKUP_ON_SAVE, v ? "true" : "false");
              toast.success(v ? "저장 시 스냅샷 저장을 켰습니다." : "저장 시 스냅샷 저장을 껐습니다.");
            }
          }}
        />
        <span>저장할 때마다 스냅샷 저장 (자동 저장·수동 저장 시 백업 스냅샷 함께 생성)</span>
      </label>
      <p>
        백업은 KST 기준 <strong>최근 4일 × 하루 최대 5개</strong>(최대 20개)까지 보관됩니다.
        복원·가져오기·초기화 직전에 만들어지는 안전 스냅샷도 이 목록에 포함되며, 아래 백업 기록 표에서 원하는 시점으로 되돌릴 수 있습니다.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <button type="button" onClick={handleRefreshBackups}>
          백업 목록 새로고침
        </button>
        <button
          type="button"
          className="secondary"
          onClick={handleClearOldBackups}
          title="저장 공간 부족 시 브라우저의 오래된 백업을 삭제합니다. 최신 1개만 유지합니다."
        >
          저장 공간 확보 (오래된 백업 삭제)
        </button>
      </div>
      <div className="hint" style={{ marginTop: 6 }}>
        {latestBackup
          ? `총 ${backups.length}개 · 최근 백업: ${new Date(
              latestBackup.createdAt
            ).toLocaleString("ko-KR", {
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              timeZone: "Asia/Seoul"
            })}`
          : "아직 저장된 백업이 없습니다. 화면 상단 헤더의 '백업' 버튼을 눌러 백업을 만들어 주세요."}
      </div>
    </div>
  );
});
