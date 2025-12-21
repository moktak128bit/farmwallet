import React, { useCallback, useEffect, useState } from "react";
import type { AppData } from "../types";
import {
  getAllBackupList,
  loadBackupData,
  loadServerBackupData,
  type BackupEntry
} from "../storage";

interface Props {
  data: AppData;
  onChangeData: (next: AppData) => void;
  backupVersion: number;
}

export const SettingsView: React.FC<Props> = ({ data, onChangeData, backupVersion }) => {
  const [text, setText] = useState(JSON.stringify(data, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const latestBackup = backups[0];
  const loadBackupList = useCallback(async () => {
    const list = await getAllBackupList();
    setBackups(list);
  }, []);

  const handleExport = () => {
    setText(JSON.stringify(data, null, 2));
    setError(null);
  };

  const handleImport = () => {
    try {
      const parsed = JSON.parse(text) as AppData;
      onChangeData(parsed);
      setError(null);
    } catch (e) {
      setError("JSON 형식이 올바르지 않습니다. 중괄호/쉼표를 다시 확인해 주세요.");
    }
  };

  const handleRefreshBackups = () => {
    void loadBackupList();
  };

  const handleRestoreBackup = async (entry: BackupEntry) => {
    try {
      let restored: AppData | null = null;
      if (entry.source === "server") {
        restored = await loadServerBackupData(entry.fileName ?? entry.id);
      } else {
        restored = loadBackupData(entry.id);
      }

      if (!restored) {
        setError("선택한 백업을 불러올 수 없습니다.");
        return;
      }
      onChangeData(restored);
      setText(JSON.stringify(restored, null, 2));
      setError(null);
    } catch (e) {
      setError("백업을 불러오는 중 문제가 발생했습니다.");
    }
  };

  useEffect(() => {
    void loadBackupList();
  }, [backupVersion, loadBackupList]);

  return (
    <div>
      <h2>백업 / 복원 / 설정</h2>
      <div className="cards-row">
        <div className="card">
          <div className="card-title">데이터 백업</div>
          <p>
            데이터가 변경될 때마다 자동으로 백업 스냅샷을 남깁니다. 아래 JSON을 복사해 두면 다른
            곳으로 옮길 수도 있습니다. 모든 스냅샷은 브라우저 저장소와 로컬 파일 두 곳에 기록되어
            다른 브라우저에서도 동일하게 복원됩니다.
          </p>
          <button type="button" onClick={handleExport}>
            현재 데이터 다시 불러오기
          </button>
        </div>
        <div className="card">
          <div className="card-title">자동 백업 스냅샷</div>
          <p>최근 20개까지 자동으로 저장된 백업 목록입니다. 원하는 시점으로 되돌릴 수 있습니다.</p>
          <button type="button" onClick={handleRefreshBackups}>
            백업 목록 새로고침
          </button>
          <div className="hint" style={{ marginTop: 6 }}>
            {latestBackup
              ? `총 ${backups.length}개 · 최근 백업: ${new Date(
                  latestBackup.createdAt
                ).toLocaleString("ko-KR", {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit"
                })}`
              : "아직 저장된 백업이 없습니다. 상단의 '백업 스냅샷 저장' 버튼을 눌러주세요."}
          </div>
        </div>
      </div>

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
                  minute: "2-digit"
                })}
              </td>
              <td>{b.source === "server" ? "로컬 파일" : "브라우저 저장소"}</td>
              <td>
                <button type="button" onClick={() => handleRestoreBackup(b)}>
                  이 시점으로 복원
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <textarea
        className="json-editor"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={20}
      />
      <div className="form-actions">
        <button type="button" className="primary" onClick={handleImport}>
          JSON 불러오기
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
};
