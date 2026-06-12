/**
 * 설정 페이지 오케스트레이터 — 탭 전환과 2개 이상 영역이 공유하는 상태만 소유한다:
 *  - text/error: JSON 편집기 내용·오류 (백업 복원/테이블 복원/초기화/JSON 불러오기가 모두 갱신)
 *  - backups/loadBackupList: 자동 백업 스냅샷 카드와 백업 기록 표가 공유
 * 카드/탭 본문은 features/settings 모듈에 위임 — 자식은 모두 React.memo이므로
 * 여기서 넘기는 콜백은 setState 그대로 또는 useCallback으로 참조를 고정한다.
 * 카드 전용 토글(backupOnSave/priceApi/gist/데이트통장/대시보드 위젯)은 각 카드가 소유하고,
 * 백업 탭 재진입 시 재마운트로 localStorage를 다시 읽는다 (기존 탭 전환 effect와 동일 동작).
 */
import React, { useCallback, useEffect, useState, lazy, Suspense } from "react";
import { toast } from "react-hot-toast";
import type { AppData } from "../types";
import { getAllBackupList, type BackupEntry } from "../storage";
import { ERROR_MESSAGES } from "../constants/errorMessages";
import { STORAGE_KEYS } from "../constants/config";
import { PWAInstallCard } from "../features/settings/PWAInstallCard";
import { DataBackupCard } from "../features/settings/DataBackupCard";
import { ExportToolsCards } from "../features/settings/ExportToolsCards";
import { MigrationToolsCards } from "../features/settings/MigrationToolsCards";
import { DataResetCard } from "../features/settings/DataResetCard";
import { BackupSnapshotCard } from "../features/settings/BackupSnapshotCard";
import { PriceApiCard } from "../features/settings/PriceApiCard";
import { GistSyncCard } from "../features/settings/GistSyncCard";
import { DateAccountCard } from "../features/settings/DateAccountCard";
import { BackupHistoryTable } from "../features/settings/BackupHistoryTable";
import { JsonImportSection } from "../features/settings/JsonImportSection";
import { DashboardWidgetSettings } from "../features/settings/DashboardWidgetSettings";

const DataIntegrityView = lazy(() => import("./DataIntegrityPage").then((m) => ({ default: m.DataIntegrityView })));
const SavingsMigrationView = lazy(() => import("./SavingsMigrationPage").then((m) => ({ default: m.SavingsMigrationView })));
const ThemeCustomizer = lazy(() => import("../components/ThemeCustomizer").then((m) => ({ default: m.ThemeCustomizer })));

interface Props {
  data: AppData;
  onChangeData: (next: AppData) => void;
  backupVersion: number;
  /** 로드 실패 후 백업 복원했을 때 호출 (저장 재활성화) */
  onBackupRestored?: () => void;
  /** 백업 목록이 변경되었을 때 호출 (헤더 최신화) */
  onBackupsChanged?: () => void | Promise<void>;
  onNavigateToRecord?: (payload: { type: "ledger" | "trade"; id: string }) => void;
  onNavigateToTab?: (tab: "accounts" | "ledger" | "stocks") => void;
  /** 자동 Gist 동기화 ON/OFF */
  autoSyncEnabled?: boolean;
  onAutoSyncChange?: (enabled: boolean) => void;
  /** 마지막 자동 저장/불러오기 시각 */
  gistLastPushAt?: string | null;
  gistLastPullAt?: string | null;
  /** 정식 Gist push/pull 경로 (useGistSync.manualPush/manualPull) — 카드 자체 fetch 우회 방지 */
  onGistManualPush?: () => Promise<void>;
  onGistManualPull?: () => Promise<void>;
}

type SettingsTab = "backup" | "integrity" | "theme" | "accessibility" | "dashboard" | "savingsMigration";

export const SettingsView: React.FC<Props> = ({
  data,
  onChangeData,
  backupVersion,
  onBackupRestored,
  onBackupsChanged,
  onNavigateToRecord,
  onNavigateToTab,
  autoSyncEnabled = false,
  onAutoSyncChange,
  gistLastPushAt,
  gistLastPullAt,
  onGistManualPush,
  onGistManualPull
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>("backup");
  const [showThemeCustomizer, setShowThemeCustomizer] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  // 고대비 모드 — 렌더 중 DOM(classList) 직접 읽기 대신 상태로 관리
  const [highContrast, setHighContrast] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("high-contrast")
  );

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

  useEffect(() => {
    if (activeTab !== "backup") return;
    void loadBackupList();
  }, [activeTab, backupVersion, loadBackupList]);

  return (
    <div>
      <h2>백업 / 복원 / 설정</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {([
          ["backup", "백업/복원"],
          ["integrity", "데이터 무결성"],
          ["theme", "테마 설정"],
          ["accessibility", "접근성"],
          ["dashboard", "대시보드 위젯"],
          ["savingsMigration", "저축성지출 수정"],
        ] as const).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            className={activeTab === tab ? "primary" : ""}
            onClick={() => setActiveTab(tab)}
            style={{ padding: "8px 16px", fontSize: 14, fontWeight: 600, borderRadius: 8 }}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "backup" && (
        <>
          <PWAInstallCard />
          <div className="cards-row">
            <DataBackupCard
              data={data}
              onChangeData={onChangeData}
              setText={setText}
              setError={setError}
              onBackupRestored={onBackupRestored}
              loadBackupList={loadBackupList}
            />
            <ExportToolsCards
              ledger={data.ledger}
              accounts={data.accounts}
              trades={data.trades}
              categoryPresets={data.categoryPresets}
            />
            <MigrationToolsCards data={data} onChangeData={onChangeData} />
            <DataResetCard data={data} onChangeData={onChangeData} setText={setText} setError={setError} />
            {/* 💰 하루 예산 한도 카드는 가계부 상단 "예산 / 반복 지출" 탭으로 이동됨. */}
            <BackupSnapshotCard
              backups={backups}
              loadBackupList={loadBackupList}
              onBackupsChanged={onBackupsChanged}
            />
            <PriceApiCard />
            <GistSyncCard
              autoSyncEnabled={autoSyncEnabled}
              onAutoSyncChange={onAutoSyncChange}
              gistLastPushAt={gistLastPushAt}
              gistLastPullAt={gistLastPullAt}
              onManualPush={onGistManualPush}
              onManualPull={onGistManualPull}
            />
            <DateAccountCard accounts={data.accounts} />
          </div>

          <BackupHistoryTable
            backups={backups}
            data={data}
            onChangeData={onChangeData}
            setText={setText}
            setError={setError}
            onBackupRestored={onBackupRestored}
            loadBackupList={loadBackupList}
          />

          <JsonImportSection
            text={text}
            setText={setText}
            error={error}
            setError={setError}
            data={data}
            onChangeData={onChangeData}
            onBackupRestored={onBackupRestored}
          />
        </>
      )}

      {activeTab === "integrity" && (
        <Suspense fallback={<div className="card" style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>로딩 중...</div>}>
          <DataIntegrityView
            data={data}
            onChangeData={onChangeData}
            onNavigateToRecord={onNavigateToRecord}
            onNavigateToTab={onNavigateToTab}
          />
        </Suspense>
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
        <Suspense fallback={<div style={{ padding: 24, textAlign: "center" }}>로딩 중...</div>}>
          <ThemeCustomizer onClose={() => setShowThemeCustomizer(false)} />
        </Suspense>
      )}

      {activeTab === "accessibility" && (
        <div className="card">
          <h3>접근성 설정</h3>
          <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={highContrast}
              onChange={(e) => {
                const next = e.target.checked;
                setHighContrast(next);
                if (typeof document !== "undefined") {
                  document.documentElement.classList.toggle("high-contrast", next);
                  try {
                    localStorage.setItem(STORAGE_KEYS.HIGH_CONTRAST, next ? "true" : "false");
                  } catch { /* 저장 실패해도 토글 자체는 유지 */ }
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
        <DashboardWidgetSettings data={data} onChangeData={onChangeData} />
      )}

      {activeTab === "savingsMigration" && (
        <Suspense fallback={<div className="card" style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>로딩 중...</div>}>
          <SavingsMigrationView data={data} onChangeData={onChangeData} />
        </Suspense>
      )}

    </div>
  );
};
