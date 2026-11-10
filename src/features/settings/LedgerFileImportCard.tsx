/**
 * 가계부 파일 불러오기 — Claude가 만든 변경분(farmwallet-delta-v1) 또는 백업 파일(일반·테이블).
 * 변경분은 지금 데이터에 더하고(utils/ledgerDelta), 백업 파일은 통째로 바꾼다. 둘 다 적용 전 미리보기
 * (requestApply) + 직전 안전 스냅샷. 변경분의 sourcePhotos는 적용 후 GAS 사진 목록에서 처리 완료로 표시.
 */
import React, { useCallback } from "react";
import { toast } from "react-hot-toast";
import type { AppData } from "../../types";
import { mergeCurrentCaches, normalizeImportedData, saveSafetySnapshot } from "../../storage";
import { isSchemaTooNewError } from "../../services/dataService";
import { ERROR_MESSAGES } from "../../constants/errorMessages";
import { appDataFromTableBackupPayload, TABLE_BACKUP_FORMAT } from "../../utils/tableDataBackup";
import { applyLedgerDelta, formatDeltaReport, isLedgerDelta, type LedgerDeltaReport } from "../../utils/ledgerDelta";
import { requestApply } from "../../components/ApplyConfirmModal";
import { isGas, runServer } from "../../services/gas";

interface Props {
  data: AppData;
  onChangeData: (next: AppData) => void;
  setText: React.Dispatch<React.SetStateAction<string>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  onBackupRestored?: () => void;
  loadBackupList: () => Promise<unknown>;
}

const isTableBackup = (raw: unknown): boolean =>
  !!raw && typeof raw === "object" && (raw as { format?: unknown }).format === TABLE_BACKUP_FORMAT;

async function markPhotosProcessed(names: string[]): Promise<void> {
  const ids = await runServer<string[]>("photoIdsByName", names);
  await runServer("setPhotosProcessed", ids.filter(Boolean), true);
}

export const LedgerFileImportCard: React.FC<Props> = React.memo(function LedgerFileImportCard({
  data,
  onChangeData,
  setText,
  setError,
  onBackupRestored,
  loadBackupList
}) {
  const handlePick = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      let invalidMessage: string = ERROR_MESSAGES.BACKUP_FILE_INVALID;
      try {
        const raw = JSON.parse(await file.text()) as unknown;
        let after: AppData;
        let label: string;
        let delta: { report: LedgerDeltaReport; photos: string[] } | null = null;
        if (isLedgerDelta(raw)) {
          const applied = applyLedgerDelta(data, raw);
          delta = { report: applied.report, photos: raw.sourcePhotos ?? [] };
          after = mergeCurrentCaches(normalizeImportedData(applied.next), data);
          label = "변경분";
        } else if (isTableBackup(raw)) {
          invalidMessage = ERROR_MESSAGES.TABLE_BACKUP_FILE_INVALID;
          after = mergeCurrentCaches(normalizeImportedData(appDataFromTableBackupPayload(raw)), data);
          label = "테이블 백업";
        } else {
          after = mergeCurrentCaches(normalizeImportedData(raw), data);
          label = "파일";
        }

        requestApply({
          title: delta ? "변경분 적용" : `${label}에서 불러오기`,
          before: data,
          after,
          propagatesToGist: true,
          onConfirm: () => {
            void (async () => {
              const toastId = toast.loading(`${label}에서 불러오는 중...`);
              try {
                await saveSafetySnapshot(data, `${label} 불러오기 직전 자동 스냅샷`);
                onChangeData(after);
                setText(JSON.stringify(after, null, 2));
                setError(null);
                if (delta) {
                  toast.success(formatDeltaReport(delta.report), { id: toastId, duration: 8000 });
                  if (delta.photos.length && isGas()) {
                    markPhotosProcessed(delta.photos).catch((err: unknown) =>
                      toast.error(`사진 처리 완료 표시 실패: ${err instanceof Error ? err.message : String(err)}`)
                    );
                  }
                } else {
                  toast.success(`${label}에서 데이터를 불러왔습니다.`, { id: toastId });
                }
                onBackupRestored?.();
                await loadBackupList();
              } catch (error) {
                const msg = isSchemaTooNewError(error) ? error.message : invalidMessage;
                setError(msg);
                toast.error(msg, { id: toastId });
              }
            })();
          }
        });
      } catch (error) {
        const msg = isSchemaTooNewError(error) ? error.message : invalidMessage;
        setError(msg);
        toast.error(msg);
      }
    };
    input.click();
  }, [data, onChangeData, setText, setError, onBackupRestored, loadBackupList]);

  return (
    <div className="card">
      <div className="card-title">가계부 파일 불러오기</div>
      <p className="hint" style={{ marginBottom: 12 }}>
        Claude가 만든 변경분 파일이나 백업 파일(.json). 적용 전에 바뀌는 내용을 먼저 보여줍니다 — 변경분은 지금 데이터에
        더해지고, 백업 파일은 통째로 바꿉니다.
      </p>
      <button type="button" className="primary" onClick={handlePick} style={{ padding: "10px 22px", fontSize: 14 }}>
        파일 선택
      </button>
    </div>
  );
});
