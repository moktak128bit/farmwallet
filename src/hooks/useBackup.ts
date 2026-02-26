import { useCallback, useState } from "react";
import { getAllBackupList, getLatestLocalBackupIntegrity, saveBackupSnapshot, saveData } from "../storage";
import type { AppData } from "../types";
import { toast } from "react-hot-toast";
import { BACKUP_WARNING_HOURS } from "../constants/config";
import { ERROR_MESSAGES } from "../constants/errorMessages";

export interface BackupIntegrity {
  createdAt: string | null;
  status: "valid" | "missing-hash" | "mismatch" | "none";
}

export function useBackup(data: AppData) {
  const [latestBackupAt, setLatestBackupAt] = useState<string | null>(null);
  const [backupVersion, setBackupVersion] = useState<number>(0);
  const [backupIntegrity, setBackupIntegrity] = useState<BackupIntegrity>({
    createdAt: null,
    status: "none"
  });

  const refreshLatestBackup = useCallback(async () => {
    const list = await getAllBackupList();
    const latest = list[0];
    setLatestBackupAt(latest?.createdAt ?? null);
    const integrity = await getLatestLocalBackupIntegrity();
    setBackupIntegrity(integrity);
    setBackupVersion(Date.now());
  }, []);

  const handleManualBackup = useCallback(async () => {
    const toastId = "manual-backup";
    toast.loading("백업 저장 중...", { id: toastId });
    const folder = new Date().toISOString().slice(0, 10);
    try {
      saveData(data);
      await saveBackupSnapshot(data, { skipHash: false, folder });
      await refreshLatestBackup();
      toast.success("백업 저장 완료", { id: toastId });
    } catch (err) {
      toast.error(ERROR_MESSAGES.BACKUP_SAVE_FAILED, { id: toastId });
    }
  }, [data, refreshLatestBackup]);

  const getBackupWarning = () => {
    if (!latestBackupAt) return null;
    const diffHours = (Date.now() - new Date(latestBackupAt).getTime()) / 36e5;
    if (diffHours >= BACKUP_WARNING_HOURS.CRITICAL) {
      return { type: "critical" as const, message: "24시간 이상 백업 없음 • 지금 백업하세요" };
    }
    if (diffHours >= BACKUP_WARNING_HOURS.WARNING) {
      return { type: "warning" as const, message: "12시간 경과 • 필요 시 백업" };
    }
    return null;
  };

  return {
    latestBackupAt,
    backupVersion,
    backupIntegrity,
    handleManualBackup,
    refreshLatestBackup,
    backupWarning: getBackupWarning()
  };
}
