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
import { StorageUsageCard } from "../features/settings/StorageUsageCard";
import { MigrationReportCard } from "../features/settings/MigrationReportCard";
import { StatementImportCard } from "../features/settings/StatementImportCard";

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

type SettingsTab = "backup" | "transfer" | "sync" | "integrity" | "display" | "advanced";

/** 탭 6개 유지하되 균형을 맞춘다 — 예전엔 "백업/복원" 하나에 17개 섹션이 몰려 있었다. */
const SETTINGS_TABS = [
  ["backup", "백업 / 복원"],
  ["transfer", "가져오기 / 내보내기"],
  ["sync", "동기화"],
  ["integrity", "데이터 무결성"],
  ["display", "화면 설정"],
  ["advanced", "고급 / 진단"],
] as const;

/** 기본 접힘 섹션. 제목은 summary가 맡고 자식 카드의 .card-title은 CSS로 숨긴다. */
const Collapsible: React.FC<{ title: string; hint?: string; children: React.ReactNode }> = ({
  title,
  hint,
  children
}) => (
  <details className="settings-collapsible">
    <summary>
      {title}
      {hint && <span className="hint">{hint}</span>}
    </summary>
    <div className="settings-collapsible-body">{children}</div>
  </details>
);

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
    if (activeTab !== "backup" && activeTab !== "advanced") return;
    void loadBackupList();
  }, [activeTab, backupVersion, loadBackupList]);

  return (
    <div>
      <h2>백업 / 복원 / 설정</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {SETTINGS_TABS.map(([tab, label]) => (
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
          <div className="settings-grid">
            <DataBackupCard
              data={data}
              onChangeData={onChangeData}
              setText={setText}
              setError={setError}
              onBackupRestored={onBackupRestored}
              loadBackupList={loadBackupList}
            />
            <BackupSnapshotCard
              backups={backups}
              loadBackupList={loadBackupList}
              onBackupsChanged={onBackupsChanged}
            />
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
        </>
      )}

      {activeTab === "transfer" && (
        <>
          <div className="settings-grid">
            <ExportToolsCards
              ledger={data.ledger}
              accounts={data.accounts}
              trades={data.trades}
              categoryPresets={data.categoryPresets}
            />
          </div>
          <Collapsible title="JSON 가져오기" hint="파일 선택 · 끌어다 놓기 · 붙여넣기">
            <JsonImportSection
              text={text}
              setText={setText}
              error={error}
              setError={setError}
              data={data}
              onChangeData={onChangeData}
              onBackupRestored={onBackupRestored}
            />
          </Collapsible>
          {/* 카드 명세 CSV/붙여넣기 임포트 — 카드 계좌 한정, dry-run 기본, 적용 시 단일 undo */}
          <Collapsible title="카드 명세 가져오기" hint="CSV/TSV → 가계부 지출">
            <StatementImportCard data={data} onChangeData={onChangeData} />
          </Collapsible>
        </>
      )}

      {activeTab === "sync" && (
        <div className="settings-grid">
          <GistSyncCard
            autoSyncEnabled={autoSyncEnabled}
            onAutoSyncChange={onAutoSyncChange}
            gistLastPushAt={gistLastPushAt}
            gistLastPullAt={gistLastPullAt}
            onManualPush={onGistManualPush}
            onManualPull={onGistManualPull}
          />
          <PriceApiCard />
        </div>
      )}

      {activeTab === "display" && (
        <>
          <div className="settings-grid">
            <div className="card">
              <div className="card-title">테마</div>
              <button type="button" className="primary" onClick={() => setShowThemeCustomizer(true)}>
                테마 커스터마이저 열기
              </button>
            </div>
            <div className="card">
              <div className="card-title">접근성</div>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                <span>고대비 모드</span>
              </label>
              <p className="hint" style={{ marginTop: 8 }}>시각적 대비를 높여 가독성을 올립니다.</p>
            </div>
            <DateAccountCard accounts={data.accounts} />
          </div>
          <DashboardWidgetSettings data={data} onChangeData={onChangeData} />
        </>
      )}

      {activeTab === "advanced" && (
        <>
          <div className="settings-grid">
            <MigrationToolsCards data={data} onChangeData={onChangeData} />
          </div>
          <Collapsible title="저축성지출 수정" hint="레거시 지출 → 저축/투자 이체 일괄 전환">
            <Suspense fallback={<div style={{ padding: 16, color: "var(--text-muted)" }}>로딩 중...</div>}>
              <SavingsMigrationView data={data} onChangeData={onChangeData} />
            </Suspense>
          </Collapsible>
          <Collapsible title="저장 공간 사용량" hint="localStorage (읽기 전용)">
            <StorageUsageCard />
          </Collapsible>
          <Collapsible title="마지막 마이그레이션 리포트" hint="스키마 변환 결과 (읽기 전용)">
            <MigrationReportCard backups={backups} />
          </Collapsible>
          <div className="settings-danger">
            <div className="settings-danger-title">⚠️ 위험 구역 — 되돌리기 어려운 작업</div>
            <DataResetCard data={data} onChangeData={onChangeData} setText={setText} setError={setError} />
          </div>
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

      {showThemeCustomizer && (
        <Suspense fallback={<div style={{ padding: 24, textAlign: "center" }}>로딩 중...</div>}>
          <ThemeCustomizer onClose={() => setShowThemeCustomizer(false)} />
        </Suspense>
      )}

    </div>
  );
};
