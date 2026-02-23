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
import { usePWAInstall } from "../hooks/usePWAInstall";
import { STORAGE_KEYS } from "../constants/config";
import { ERROR_MESSAGES } from "../constants/errorMessages";

interface Props {
  data: AppData;
  onChangeData: (next: AppData) => void;
  backupVersion: number;
  /** 로드 실패 후 백업 복원했을 때 호출 (저장 재활성화) */
  onBackupRestored?: () => void;
}

type SettingsTab = "backup" | "integrity" | "theme" | "accessibility" | "dashboard";

const DASHBOARD_WIDGET_ORDER = ["summary", "assets", "income", "budget", "stocks", "portfolio", "targetPortfolio", "458730", "isa"];
const DASHBOARD_WIDGET_NAMES: Record<string, string> = {
  summary: "요약 카드",
  assets: "자산 구성",
  income: "수입/지출",
  budget: "예산 요약",
  stocks: "주식 성과",
  portfolio: "포트폴리오",
  targetPortfolio: "목표 포트폴리오",
  "458730": "458730 배당율 (TIGER 미국배당다우존스)",
  isa: "ISA 포트폴리오"
};

export const SettingsView: React.FC<Props> = ({ data, onChangeData, backupVersion, onBackupRestored }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>("backup");
  const [showThemeCustomizer, setShowThemeCustomizer] = useState(false);
  const [text, setText] = useState(JSON.stringify(data, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const latestBackup = useMemo(() => backups[0], [backups]);
  const { canInstall, isStandalone, install: installPWA } = usePWAInstall();

  const [backupOnSave, setBackupOnSave] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEYS.BACKUP_ON_SAVE) === "true";
  });

  const [priceApiEnabled, setPriceApiEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEYS.PRICE_API_ENABLED) === "true";
  });

  const [dashboardVisibleWidgets, setDashboardVisibleWidgets] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set(DASHBOARD_WIDGET_ORDER);
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.DASHBOARD_WIDGETS);
      if (raw) return new Set(JSON.parse(raw));
    } catch (e) {
      console.warn("[SettingsView] 대시보드 위젯 설정 로드 실패", e);
    }
    return new Set(DASHBOARD_WIDGET_ORDER);
  });
  const [dashboardWidgetOrder, setDashboardWidgetOrder] = useState<string[]>(() => {
    if (typeof window === "undefined") return [...DASHBOARD_WIDGET_ORDER];
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.DASHBOARD_WIDGET_ORDER);
      if (raw) {
        const parsed = JSON.parse(raw) as string[];
        if (Array.isArray(parsed) && parsed.length === DASHBOARD_WIDGET_ORDER.length) return parsed;
      }
    } catch (e) {
      console.warn("[SettingsView] 위젯 순서 로드 실패", e);
    }
    return [...DASHBOARD_WIDGET_ORDER];
  });
  const loadBackupList = useCallback(async () => {
    try {
      const list = await getAllBackupList();
      setBackups(list);
      return list;
    } catch (error) {
      console.error("백업 목록 로드 실패:", error);
      toast.error(ERROR_MESSAGES.BACKUP_LIST_LOAD_FAILED);
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
      toast.error(ERROR_MESSAGES.DATA_LOAD_FAILED);
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
      toast.error(ERROR_MESSAGES.BACKUP_DOWNLOAD_FAILED);
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
      toast.error(ERROR_MESSAGES.EXPORT_MARKDOWN_FAILED);
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
  }, [onChangeData, loadBackupList, onBackupRestored]);

  const handleImport = useCallback(() => {
    try {
      if (!text || !text.trim()) {
        toast.error(ERROR_MESSAGES.JSON_INPUT_REQUIRED);
        setError(ERROR_MESSAGES.JSON_INPUT_REQUIRED);
        return;
      }
      const parsed = JSON.parse(text) as AppData;
      onChangeData(parsed);
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
  }, [text, onChangeData, onBackupRestored]);

  const handleRefreshBackups = useCallback(async () => {
    const toastId = toast.loading("백업 목록을 불러오는 중...");
    try {
      const list = await loadBackupList();
      toast.success(`백업 목록을 새로고침했습니다. (${list.length}개)`, { id: toastId });
    } catch (error) {
      toast.error(ERROR_MESSAGES.BACKUP_REFRESH_FAILED, { id: toastId });
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
        toast.error(ERROR_MESSAGES.SERVER_BACKUP_DISABLED, { id: toastId });
        return;
      }

      if (!restored) {
        setError(ERROR_MESSAGES.BACKUP_SELECTED_NOT_FOUND);
        toast.error(ERROR_MESSAGES.BACKUP_SELECTED_NOT_FOUND, { id: toastId });
        return;
      }
      
      onChangeData(restored);
      setText(JSON.stringify(restored, null, 2));
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
  }, [onChangeData, loadBackupList, onBackupRestored]);

  useEffect(() => {
    void loadBackupList();
  }, [backupVersion, loadBackupList]);

  useEffect(() => {
    if (activeTab === "backup") {
      setBackupOnSave(localStorage.getItem(STORAGE_KEYS.BACKUP_ON_SAVE) === "true");
      setPriceApiEnabled(localStorage.getItem(STORAGE_KEYS.PRICE_API_ENABLED) === "true");
    }
    if (activeTab !== "dashboard") return;
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.DASHBOARD_WIDGETS);
      if (raw) setDashboardVisibleWidgets(new Set(JSON.parse(raw)));
      const rawOrder = localStorage.getItem(STORAGE_KEYS.DASHBOARD_WIDGET_ORDER);
      if (rawOrder) {
        const parsed = JSON.parse(rawOrder) as string[];
        if (Array.isArray(parsed) && parsed.length === DASHBOARD_WIDGET_ORDER.length) setDashboardWidgetOrder(parsed);
      }
    } catch (e) {
      console.warn("[SettingsView] 탭 전환 시 위젯 순서 로드 실패", e);
    }
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEYS.DASHBOARD_WIDGETS, JSON.stringify(Array.from(dashboardVisibleWidgets)));
  }, [dashboardVisibleWidgets]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEYS.DASHBOARD_WIDGET_ORDER, JSON.stringify(dashboardWidgetOrder));
  }, [dashboardWidgetOrder]);

  const toggleDashboardWidget = (id: string) => {
    setDashboardVisibleWidgets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const moveDashboardWidgetOrder = (id: string, direction: "up" | "down") => {
    const idx = dashboardWidgetOrder.indexOf(id);
    if (idx === -1) return;
    const swap = direction === "up" ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= dashboardWidgetOrder.length) return;
    setDashboardWidgetOrder((prev) => {
      const next = [...prev];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  };

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
        <button
          type="button"
          className={activeTab === "dashboard" ? "primary" : ""}
          onClick={() => setActiveTab("dashboard")}
        >
          대시보드 위젯
        </button>
      </div>

      {activeTab === "backup" && (
        <>
          {(canInstall || isStandalone) && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">앱처럼 사용하기</div>
              {isStandalone ? (
                <p style={{ margin: 0, color: "var(--text-muted)" }}>
                  홈 화면에서 실행 중입니다. 오프라인에서도 캐시된 화면을 볼 수 있습니다.
                </p>
              ) : canInstall ? (
                <p style={{ margin: "0 0 12px 0", color: "var(--text-muted)" }}>
                  홈 화면에 추가하면 앱처럼 실행하고, 오프라인에서도 사용할 수 있습니다.
                </p>
              ) : null}
              {canInstall && (
                <button type="button" className="primary" onClick={async () => {
                  const ok = await installPWA();
                  if (ok) toast.success("홈 화면에 추가되었습니다.");
                }}>
                  홈 화면에 추가
                </button>
              )}
            </div>
          )}
          <div className="cards-row">
        <div className="card">
          <div className="card-title">데이터 백업</div>
          <p>
            <strong style={{ color: "var(--warning)" }}>⚠️ 중요:</strong> 웹 브라우저와 Cursor 내부 브라우저는 서로 다른 저장소(localStorage)를 사용합니다. 
            웹에서 저장한 백업은 Cursor 내부에서 보이지 않으며, 그 반대도 마찬가지입니다.
            <br />
            <strong>다른 환경에서 백업을 사용하려면:</strong> "백업 파일 다운로드"로 파일을 저장한 후, 다른 환경에서 "백업 파일 불러오기"로 불러오세요.
            <br />
            <strong style={{ color: "var(--primary)" }}>권장:</strong> 데이터 안전을 위해 정기적으로 "백업 파일 다운로드"로 JSON 파일을 저장해 두세요.
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
            수입·지출·저축성 지출·이체 전체가 포함된 마크다운을 <code>정리.md</code>로 다운로드합니다.
            표 스타일로 정리된 문서를 프로젝트에 저장해 두면 됩니다.
          </p>
          <button type="button" className="primary" onClick={handleExportLedgerMd}>
            정리.md 내보내기
          </button>
        </div>
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
        <div className="card">
          <div className="card-title">가격 API</div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={priceApiEnabled}
              onChange={(e) => {
                const v = e.target.checked;
                setPriceApiEnabled(v);
                if (typeof window !== "undefined") {
                  localStorage.setItem(STORAGE_KEYS.PRICE_API_ENABLED, v ? "true" : "false");
                  toast.success(v ? "가격 API 사용을 켰습니다." : "가격 API 사용을 껐습니다.");
                }
              }}
            />
            <span>가격 API 사용 (외부 API로 주식 가격 배치 갱신)</span>
          </label>
          <p className="hint" style={{ marginTop: 4 }}>
            켜면 티커 백업 로드 후 선택한 제공자의 API로 가격을 배치 갱신할 수 있습니다. 실제 API 연동은 추후 제공 예정입니다.
          </p>
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

      {activeTab === "dashboard" && (
        <div className="card">
          <h3>대시보드 위젯 표시 및 순서</h3>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
            표시 여부를 선택하고, 순서는 위/아래로 변경할 수 있습니다. 대시보드 탭에서도 동일하게 적용됩니다.
          </p>
          {dashboardWidgetOrder.map((id, index) => (
            <div
              key={id}
              style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}
            >
              <input
                type="checkbox"
                id={`settings-widget-${id}`}
                checked={dashboardVisibleWidgets.has(id)}
                onChange={() => toggleDashboardWidget(id)}
              />
              <label htmlFor={`settings-widget-${id}`} style={{ flex: 1 }}>
                {DASHBOARD_WIDGET_NAMES[id] ?? id}
              </label>
              <button
                type="button"
                className="secondary"
                style={{ padding: "4px 8px", fontSize: 11 }}
                onClick={() => moveDashboardWidgetOrder(id, "up")}
                disabled={index === 0}
                title="위로"
              >
                위
              </button>
              <button
                type="button"
                className="secondary"
                style={{ padding: "4px 8px", fontSize: 11 }}
                onClick={() => moveDashboardWidgetOrder(id, "down")}
                disabled={index === dashboardWidgetOrder.length - 1}
                title="아래로"
              >
                아래
              </button>
            </div>
          ))}
        </div>
      )}

    </div>
  );
};
