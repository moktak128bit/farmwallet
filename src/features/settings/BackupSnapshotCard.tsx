/**
 * 자동 백업 스냅샷 카드 — 저장 시 스냅샷 토글(backupOnSave), 백업 목록 새로고침,
 * 오래된 백업 삭제, 최근 백업 요약. SettingsPage에서 분리.
 * backupOnSave 토글 상태는 이 컴포넌트가 소유 — 백업 탭 진입(마운트) 시
 * localStorage에서 다시 읽는다 (기존 탭 전환 effect와 동일 동작).
 * 백업 목록(backups)·로더(loadBackupList)는 부모 공유 상태 — props로 받는다.
 * React.memo로 감싸므로 부모가 넘기는 콜백(loadBackupList/onBackupsChanged)은
 * useCallback 등으로 참조가 안정적이어야 한다.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { clearOldBackups, isBackupOnSaveEnabled, type BackupEntry } from "../../storage";
import {
  clearCorruptBackups,
  getCorruptBackupsInfo,
  getCorruptBackupsRaw
} from "../../services/backupService";
import { STORAGE_KEYS } from "../../constants/config";
import { ERROR_MESSAGES } from "../../constants/errorMessages";
import { getTodayKST } from "../../utils/date";

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

  // 저장된 설정이 없으면 기본 on (isBackupOnSaveEnabled 단일 판정 — useBackup과 동일)
  const [backupOnSave, setBackupOnSave] = useState(() => isBackupOnSaveEnabled());

  const handleRefreshBackups = useCallback(async () => {
    const toastId = toast.loading("백업 목록을 불러오는 중...");
    try {
      const list = await loadBackupList();
      toast.success(`백업 목록을 새로고침했습니다. (${list.length}개)`, { id: toastId });
    } catch {
      toast.error(ERROR_MESSAGES.BACKUP_REFRESH_FAILED, { id: toastId });
    }
  }, [loadBackupList]);

  // 손상된 BACKUPS 원본 보존 슬롯(BACKUPS_CORRUPT) — 백업 목록이 갱신될 때마다 다시 읽는다
  const [corruptInfo, setCorruptInfo] = useState(() => getCorruptBackupsInfo());
  useEffect(() => {
    setCorruptInfo(getCorruptBackupsInfo());
  }, [backups]);

  const handleDownloadCorruptBackups = useCallback(() => {
    const raw = getCorruptBackupsRaw();
    if (!raw) {
      toast.error("보존된 손상 백업 원본이 없습니다.");
      return;
    }
    try {
      const blob = new Blob([raw], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `farmwallet-backups-corrupt-${getTodayKST()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("손상된 백업 원본을 다운로드했습니다.");
    } catch {
      toast.error("손상된 백업 원본 다운로드에 실패했습니다.");
    }
  }, []);

  const handleClearCorruptBackups = useCallback(() => {
    if (!window.confirm("보존된 손상 백업 원본을 삭제할까요? 삭제하면 되돌릴 수 없습니다.")) return;
    if (clearCorruptBackups()) {
      setCorruptInfo(null);
      toast.success("손상된 백업 원본을 삭제했습니다.");
    } else {
      setCorruptInfo(null);
      toast("삭제할 손상 백업 원본이 없습니다.");
    }
  }, []);

  const handleClearOldBackups = useCallback(async () => {
    const removed = await clearOldBackups(1);
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
        <span>저장할 때마다 스냅샷 저장 (자동 저장·수동 저장 시 백업 스냅샷 함께 생성 — 기본 켜짐, 10분 간격)</span>
      </label>
      <p>
        백업은 KST 기준 <strong>최근 4일 × 하루 최대 5개</strong>(최대 20개)까지 보관됩니다.
        브라우저 IndexedDB에 사용자 데이터만(시세·티커 캐시 제외) 저장되어 localStorage 용량을 차지하지 않습니다.
        복원·가져오기·초기화 직전에 만들어지는 안전 스냅샷도 이 목록에 포함되며, 아래 백업 기록 표에서 원하는 시점으로 되돌릴 수 있습니다.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <button type="button" onClick={handleRefreshBackups}>
          백업 목록 새로고침
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => { void handleClearOldBackups(); }}
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
      {corruptInfo && (
        <div
          role="status"
          style={{
            marginTop: 12,
            padding: "8px 10px",
            borderRadius: 8,
            background: "var(--warning-light)",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
            fontSize: "0.9em"
          }}
        >
          <span style={{ flex: "1 1 auto" }}>
            손상된 백업 원본이 보존되어 있습니다 ({Math.max(1, Math.round(corruptInfo.sizeBytes / 1024))} KB).
            JSON으로 내려받아 수동 복구를 시도할 수 있습니다.
          </span>
          <button type="button" className="secondary" onClick={handleDownloadCorruptBackups}>
            JSON 다운로드
          </button>
          <button type="button" className="secondary" onClick={handleClearCorruptBackups}>
            삭제
          </button>
        </div>
      )}
    </div>
  );
});
