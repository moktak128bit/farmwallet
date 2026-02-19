import React, { useCallback, useEffect, useState, useMemo } from "react";
import { toast } from "react-hot-toast";
import type { AppData } from "../types";
import {
  getAllBackupList,
  loadBackupData,
  loadServerBackupData,
  type BackupEntry
} from "../storage";
import { generateLedgerMarkdownReport } from "../utils/ledgerMarkdownReport";
import { DataIntegrityView } from "./DataIntegrityView";
import { ThemeCustomizer } from "./ThemeCustomizer";
import { getKoreaTime } from "../utils/dateUtils";

interface Props {
  data: AppData;
  onChangeData: (next: AppData) => void;
  backupVersion: number;
}

type SettingsTab = "backup" | "integrity" | "theme" | "accessibility";

export const SettingsView: React.FC<Props> = ({ data, onChangeData, backupVersion }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>("backup");
  const [showThemeCustomizer, setShowThemeCustomizer] = useState(false);
  const [text, setText] = useState(JSON.stringify(data, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const latestBackup = useMemo(() => backups[0], [backups]);
  const loadBackupList = useCallback(async () => {
    try {
      const list = await getAllBackupList();
      setBackups(list);
      return list;
    } catch (error) {
      console.error("백업 목록 로드 실패:", error);
      toast.error("백업 목록을 불러오는 중 오류가 발생했습니다. 다시 시도해 보세요.");
      return [];
    }
  }, []);

  const handleExport = () => {
    try {
      setText(JSON.stringify(data, null, 2));
      setError(null);
      toast.success("현재 데이터를 불러왔습니다.");
    } catch (error) {
      console.error("데이터 내보내기 실패:", error);
      toast.error("데이터를 불러오는 중 오류가 발생했습니다.");
      setError("데이터를 불러오는 중 오류가 발생했습니다.");
    }
  };

  // 백업 파일로 다운로드
  const handleDownloadBackup = useCallback(() => {
    try {
      const jsonData = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonData], { type: "application/json" });
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
      toast.error("백업 파일 다운로드 중 오류가 발생했습니다. 다시 시도해 보세요.");
    }
  }, [data]);

  const handleExportLedgerMd = useCallback(() => {
    try {
      const md = generateLedgerMarkdownReport(data.ledger, data.accounts);
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "정리.md";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("정리.md를 다운로드했습니다. 프로젝트의 정리.md를 덮어쓰면 됩니다.");
    } catch (err) {
      if (import.meta.env.DEV) console.error("정리.md 내보내기 실패:", err);
      toast.error("정리.md 내보내기 중 오류가 발생했습니다.");
    }
  }, [data.ledger, data.accounts]);

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
        const parsed = JSON.parse(text) as AppData;
        onChangeData(parsed);
        setText(text);
        setError(null);
        toast.success("백업 파일을 성공적으로 불러왔습니다.", { id: toastId });
        await loadBackupList();
      } catch (error) {
        const errorMsg = "백업 파일 형식이 올바르지 않습니다. JSON 파일인지 확인해 보세요.";
        setError(errorMsg);
        toast.error(errorMsg, { id: toastId });
        if (import.meta.env.DEV) {
          console.error("백업 파일 불러오기 오류:", error);
        }
      }
    };
    input.click();
  }, [onChangeData, loadBackupList]);

  const handleImport = useCallback(() => {
    try {
      if (!text || !text.trim()) {
        toast.error("JSON 데이터를 입력해주세요.");
        setError("JSON 데이터를 입력해주세요.");
        return;
      }
      const parsed = JSON.parse(text) as AppData;
      onChangeData(parsed);
      setError(null);
      toast.success("데이터를 성공적으로 불러왔습니다.");
    } catch (e) {
      const errorMessage = "JSON 형식이 올바르지 않습니다. 중괄호/쉼표를 다시 확인해 주세요.";
      setError(errorMessage);
      toast.error(errorMessage);
      if (import.meta.env.DEV) {
        console.error("JSON 파싱 오류:", e);
      }
    }
  }, [text, onChangeData]);

  const handleRefreshBackups = useCallback(async () => {
    const toastId = toast.loading("백업 목록을 불러오는 중...");
    try {
      const list = await loadBackupList();
      toast.success(`백업 목록을 새로고침했습니다. (${list.length}개)`, { id: toastId });
    } catch (error) {
      toast.error("백업 목록 새로고침 실패. 다시 시도해 보세요.", { id: toastId });
    }
  }, [loadBackupList]);

  const handleRestoreBackup = useCallback(async (entry: BackupEntry) => {
    const toastId = toast.loading("백업을 복원하는 중...");
    try {
      let restored: AppData | null = null;
      // 로컬 백업만 복원
      if (entry.source === "browser") {
        restored = loadBackupData(entry.id);
      } else {
        // 서버 백업은 복원하지 않음
        toast.error("서버 백업 복원은 비활성화되어 있습니다. 로컬 백업만 사용할 수 있습니다.", { id: toastId });
        return;
      }

      if (!restored) {
        const errorMsg = "선택한 백업을 불러올 수 없습니다.";
        setError(errorMsg);
        toast.error(errorMsg, { id: toastId });
        return;
      }
      
      onChangeData(restored);
      setText(JSON.stringify(restored, null, 2));
      setError(null);
      toast.success("백업이 성공적으로 복원되었습니다.", { id: toastId });
      
      // 백업 목록도 새로고침
      await loadBackupList();
    } catch (e) {
      const errorMsg = "백업을 불러오는 중 문제가 발생했습니다. 다시 시도해 보세요.";
      setError(errorMsg);
      toast.error(errorMsg, { id: toastId });
      if (import.meta.env.DEV) {
        console.error("백업 복원 오류:", e);
      }
    }
  }, [onChangeData, loadBackupList]);

  useEffect(() => {
    void loadBackupList();
  }, [backupVersion, loadBackupList]);

  return (
    <div>
      <h2>백업 / 복원 / 설정</h2>
      
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          className={activeTab === "backup" ? "primary" : ""}
          onClick={() => setActiveTab("backup")}
        >
          백업/복원
        </button>
        <button
          type="button"
          className={activeTab === "integrity" ? "primary" : ""}
          onClick={() => setActiveTab("integrity")}
        >
          데이터 무결성
        </button>
        <button
          type="button"
          className={activeTab === "theme" ? "primary" : ""}
          onClick={() => setActiveTab("theme")}
        >
          테마 설정
        </button>
        <button
          type="button"
          className={activeTab === "accessibility" ? "primary" : ""}
          onClick={() => setActiveTab("accessibility")}
        >
          접근성
        </button>
      </div>

      {activeTab === "backup" && (
        <>
          <div className="cards-row">
        <div className="card">
          <div className="card-title">데이터 백업</div>
          <p>
            <strong style={{ color: "var(--warning)" }}>⚠️ 중요:</strong> 웹 브라우저와 Cursor 내부 브라우저는 서로 다른 저장소(localStorage)를 사용합니다. 
            웹에서 저장한 백업은 Cursor 내부에서 보이지 않으며, 그 반대도 마찬가지입니다.
            <br />
            <strong>다른 환경에서 백업을 사용하려면:</strong> "백업 파일 다운로드"로 파일을 저장한 후, 다른 환경에서 "백업 파일 불러오기"로 불러오세요.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={handleExport}>
              현재 데이터 다시 불러오기
            </button>
            <button type="button" className="primary" onClick={handleDownloadBackup}>
              백업 파일 다운로드
            </button>
            <button type="button" className="secondary" onClick={handleUploadBackup}>
              백업 파일 불러오기
            </button>
          </div>
        </div>
        <div className="card">
          <div className="card-title">가계부 정리 (정리.md)</div>
          <p>
            수입 / 지출 / 저축성 지출 / 이체를 구분해 표 스타일로 정리한 마크다운을 내보냅니다.
            다운로드한 파일을 프로젝트의 <code>정리.md</code>에 저장하면 됩니다.
          </p>
          <button type="button" className="primary" onClick={handleExportLedgerMd}>
            정리.md 내보내기
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
                  minute: "2-digit",
                  timeZone: "Asia/Seoul"
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
                  minute: "2-digit",
                  timeZone: "Asia/Seoul"
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
        </>
      )}

      {activeTab === "integrity" && (
        <DataIntegrityView data={data} onChangeData={onChangeData} />
      )}

      {activeTab === "theme" && (
        <div className="card">
          <h3>테마 및 표시 설정</h3>
          <button
            type="button"
            className="primary"
            onClick={() => setShowThemeCustomizer(true)}
          >
            테마 커스터마이저 열기
          </button>
        </div>
      )}

      {showThemeCustomizer && (
        <ThemeCustomizer onClose={() => setShowThemeCustomizer(false)} />
      )}

      {activeTab === "accessibility" && (
        <div className="card">
          <h3>접근성 설정</h3>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={typeof document !== "undefined" && document.documentElement.classList.contains("high-contrast")}
              onChange={(e) => {
                if (typeof document !== "undefined") {
                  if (e.target.checked) {
                    document.documentElement.classList.add("high-contrast");
                    localStorage.setItem("fw-high-contrast", "true");
                  } else {
                    document.documentElement.classList.remove("high-contrast");
                    localStorage.setItem("fw-high-contrast", "false");
                  }
                }
              }}
            />
            <span>고대비 모드 활성화</span>
          </label>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
            고대비 모드는 시각적 대비를 높여 가독성을 향상시킵니다.
          </p>
        </div>
      )}

    </div>
  );
};
