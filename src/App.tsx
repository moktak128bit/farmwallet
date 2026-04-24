import React, { useCallback, useEffect, useMemo, useState, lazy, Suspense } from "react";
import { Toaster, toast } from "react-hot-toast";
import { Moon, Sun, Menu } from "lucide-react";
import { Tabs, type TabId } from "./components/ui/Tabs";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { SearchModal } from "./components/SearchModal";
import { PWAStatus } from "./components/PWAStatus";
import { ConfirmModal } from "./components/ui/ConfirmModal";
import { QuickEntryModal } from "./components/QuickEntryModal";
import { RecurringDueBadge } from "./components/RecurringDueBadge";
import { TabErrorBoundary } from "./components/TabErrorBoundary";

// 동일 로더를 lazy와 프리페치에서 공유해 탭 호버 시 청크 미리 로드
const loadDashboard = () => import("./pages/DashboardPage").then((m) => ({ default: m.DashboardView }));
const loadAccounts = () => import("./pages/AccountsPage").then((m) => ({ default: m.AccountsView }));
const loadLedger = () => import("./pages/LedgerPage").then((m) => ({ default: m.LedgerView }));
const loadCategories = () => import("./pages/CategoriesPage").then((m) => ({ default: m.CategoriesView }));
const loadStocks = () => import("./pages/StocksPage").then((m) => ({ default: m.StocksView }));
const loadDividends = () => import("./pages/DividendsPage").then((m) => ({ default: m.DividendsView }));
const loadDebt = () => import("./pages/DebtPage").then((m) => ({ default: m.DebtView }));
const loadBudget = () => import("./components/BudgetRecurringView").then((m) => ({ default: m.BudgetRecurringView }));
const loadReport = () => import("./pages/ReportPage").then((m) => ({ default: m.ReportView }));
const loadSettings = () => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsView }));
const loadWorkout = () => import("./pages/WorkoutPage").then((m) => ({ default: m.WorkoutView }));
const loadInsights = () => import("./pages/InsightsPage").then((m) => ({ default: m.InsightsView }));

const DashboardView = lazy(loadDashboard);
const AccountsView = lazy(loadAccounts);
const LedgerView = lazy(loadLedger);
const CategoriesView = lazy(loadCategories);
const StocksView = lazy(loadStocks);
const DividendsView = lazy(loadDividends);
const DebtView = lazy(loadDebt);
const BudgetRecurringView = lazy(loadBudget);
const ReportView = lazy(loadReport);
const SettingsView = lazy(loadSettings);
const WorkoutView = lazy(loadWorkout);
const InsightsView = lazy(loadInsights);

// 프리페치는 청크 로드만 트리거하므로 반환 타입을 unknown으로 두면 any 없이 안전.
const TAB_PREFETCH: Record<TabId, () => Promise<unknown>> = {
  dashboard: loadDashboard,
  accounts: loadAccounts,
  ledger: loadLedger,
  categories: loadCategories,
  stocks: loadStocks,
  dividends: loadDividends,
  debt: loadDebt,
  budget: loadBudget,
  reports: loadReport,
  settings: loadSettings,
  workout: loadWorkout,
  insights: loadInsights
};
import { useAppData } from "./hooks/useAppData";
import { useStorageQuota } from "./hooks/useStorageQuota";
import { useUndoRedo } from "./hooks/useUndoRedo";
import { useBackup } from "./hooks/useBackup";
import { useSearch } from "./hooks/useSearch";
import { useTheme } from "./hooks/useTheme";
import { useFxRateValue } from "./context/FxRateContext";
import { useTickerDatabase } from "./hooks/useTickerDatabase";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { usePortfolioWorker } from "./hooks/usePortfolioWorker";
import { APP_VERSION, STORAGE_KEYS } from "./constants/config";
import { SyncActionBar } from "./components/SyncActionBar";
import { runIntegrityCheck } from "./utils/dataIntegrity";
import { useGistSync } from "./hooks/useGistSync";
import { useMarketEnvSnapshotRecorder } from "./hooks/useMarketEnvSnapshotRecorder";
import { GistVersionModal } from "./components/GistVersionModal";
import { GitVersionModal } from "./components/GitVersionModal";
import { GistConflictModal } from "./components/GistConflictModal";
import { isGistConfigured, saveToGist, setGistLastPushAt } from "./services/gistSync";
import { formatTimeAgo } from "./utils/date";
import { toUserDataJson } from "./services/dataService";
import { useUIStore, type PendingAction } from "./store/uiStore";
import { TAB_ORDER } from "./constants/tabs";

export const App: React.FC = () => {
  // UI 상태는 모두 uiStore에서 관리 (App.tsx에서 useState 17개를 슬라이스로 이전)
  const tab = useUIStore((s) => s.tab);
  const setTab = useUIStore((s) => s.setTab);
  const mobileDrawerOpen = useUIStore((s) => s.mobileDrawerOpen);
  const setMobileDrawerOpen = useUIStore((s) => s.setMobileDrawerOpen);
  const pendingAction = useUIStore((s) => s.pendingAction);
  const setPendingAction = useUIStore((s) => s.setPendingAction);
  const showShortcutsHelp = useUIStore((s) => s.showShortcutsHelp);
  const setShowShortcutsHelp = useUIStore((s) => s.setShowShortcutsHelp);
  const showQuickEntry = useUIStore((s) => s.showQuickEntry);
  const setShowQuickEntry = useUIStore((s) => s.setShowQuickEntry);
  const showGistVersionModal = useUIStore((s) => s.showGistVersionModal);
  const setShowGistVersionModal = useUIStore((s) => s.setShowGistVersionModal);
  const copyRequest = useUIStore((s) => s.copyRequest);
  const setCopyRequest = useUIStore((s) => s.setCopyRequest);
  const highlightLedgerId = useUIStore((s) => s.highlightLedgerId);
  const setHighlightLedgerId = useUIStore((s) => s.setHighlightLedgerId);
  const highlightTradeId = useUIStore((s) => s.highlightTradeId);
  const setHighlightTradeId = useUIStore((s) => s.setHighlightTradeId);
  const isPushingToGit = useUIStore((s) => s.isPushingToGit);
  const setIsPushingToGit = useUIStore((s) => s.setIsPushingToGit);
  const isPullingFromGit = useUIStore((s) => s.isPullingFromGit);
  const setIsPullingFromGit = useUIStore((s) => s.setIsPullingFromGit);
  const [showGitVersionModal, setShowGitVersionModal] = useState(false);
  const [gitCurrentBranch, setGitCurrentBranch] = useState<string>("main");
  const isOnRestoreBranch = gitCurrentBranch.startsWith("restore/");
  const [gitLastPushAt, setGitLastPushAt] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try { return localStorage.getItem(STORAGE_KEYS.GIT_LAST_PUSH_AT); } catch { return null; }
  });
  const [gitLastPullAt, setGitLastPullAt] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try { return localStorage.getItem(STORAGE_KEYS.GIT_LAST_PULL_AT); } catch { return null; }
  });

  // dev 환경에서 현재 git 브랜치 조회 (이전 버전 상태인지 감지)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);
    fetch("/api/git-log", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { currentBranch?: string } | null) => {
        if (data?.currentBranch) setGitCurrentBranch(data.currentBranch);
      })
      .catch((err: unknown) => {
        // dev server not running 등 정상 케이스 — 콘솔에만
        if (err instanceof DOMException && err.name === "AbortError") {
          console.warn("[FarmWallet] /api/git-log 시간 초과");
        }
      })
      .finally(() => clearTimeout(timeoutId));
    return () => clearTimeout(timeoutId);
  }, []);
  const isGistSaving = useUIStore((s) => s.isGistSaving);
  const setIsGistSaving = useUIStore((s) => s.setIsGistSaving);
  const newVersionAvailable = useUIStore((s) => s.newVersionAvailable);
  const gistConfigured = useUIStore((s) => s.gistConfigured);
  const setGistConfigured = useUIStore((s) => s.setGistConfigured);
  const integritySummary = useUIStore((s) => s.integritySummary);
  const setIntegritySummary = useUIStore((s) => s.setIntegritySummary);
  const appLog = useUIStore((s) => s.appLog);
  const addAppLog = useUIStore((s) => s.addAppLog);

  const appLogListRef = React.useRef<HTMLDivElement>(null);

  // 새 버전 알림은 <PWAStatus>의 useRegisterSW onNeedRefresh로 대체됨.
  // 별도의 5분 build-meta.json fetch 폴링은 제거 (Service Worker가 hourly 갱신 체크).

  const withConfirm = useCallback((opts: Omit<PendingAction, "confirmStyle"> & { confirmStyle?: "primary" | "danger" }) => {
    setPendingAction({
      confirmStyle: "primary",
      ...opts,
    });
  }, [setPendingAction]);

  React.useEffect(() => {
    if (appLogListRef.current) appLogListRef.current.scrollTop = appLogListRef.current.scrollHeight;
  }, [appLog]);

  const handleTabChange = (id: TabId) => {
    setTab(id);
    setMobileDrawerOpen(false);
  };

  const handlePrefetchTab = useCallback((id: TabId) => {
    TAB_PREFETCH[id]?.();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // 1단계: 가벼운 탭은 idle 시 즉시 (100ms 이내)
    const lightTabs: TabId[] = ["ledger", "categories", "accounts", "dividends", "debt", "budget", "workout"];
    // 2단계: 무거운 탭은 1단계 이후 750ms 뒤 (초기 렌더와 경합 방지)
    const heavyTabs: TabId[] = ["stocks", "reports", "insights"];

    const win = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    let handle1: number | undefined;
    let handle2: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (typeof win.requestIdleCallback === "function") {
      handle1 = win.requestIdleCallback(() => {
        lightTabs.forEach((id) => TAB_PREFETCH[id]?.());
        timer = setTimeout(() => {
          heavyTabs.forEach((id) => TAB_PREFETCH[id]?.());
        }, 750);
      }, { timeout: 1000 });
      return () => {
        if (handle1 !== undefined && typeof win.cancelIdleCallback === "function") win.cancelIdleCallback(handle1);
        if (handle2 !== undefined && typeof win.cancelIdleCallback === "function") win.cancelIdleCallback(handle2);
        if (timer !== undefined) clearTimeout(timer);
      };
    }

    // requestIdleCallback 미지원 폴백
    const t1 = window.setTimeout(() => lightTabs.forEach((id) => TAB_PREFETCH[id]?.()), 300);
    const t2 = window.setTimeout(() => heavyTabs.forEach((id) => TAB_PREFETCH[id]?.()), 1500);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, []);

  // Gist 설정 변경 이벤트 구독
  useEffect(() => {
    const handler = () => setGistConfigured(isGistConfigured());
    window.addEventListener("farmwallet:gist-config-change", handler);
    return () => window.removeEventListener("farmwallet:gist-config-change", handler);
  }, [setGistConfigured]);

  // Zustand store 사용
  const { data, setData, isLoading, loadFailed, clearLoadFailed } = useAppData();
  const { setDataWithHistory, handleUndo, handleRedo } = useUndoRedo(data, setData);
  const { theme, toggleTheme } = useTheme();

  const fxRate = useFxRateValue();
  const {
    isSearchOpen,
    setIsSearchOpen,
    searchQuery,
    setSearchQuery,
    savedFilters,
    filteredSearchResults,
    saveCurrentFilter,
    applySavedFilter,
    deleteSavedFilter
  } = useSearch(data);
  const {
    latestBackupAt,
    backupVersion,
    backupIntegrity,
    handleManualBackup,
    backupWarning
  } = useBackup(data, { onLog: addAppLog });

  const { isLoadingTickerDatabase, handleLoadInitialTickers } = useTickerDatabase(data, setDataWithHistory, { onLog: addAppLog });

  // Gist 동기화 훅
  const handleGistPulledData = useCallback((dataJson: string, _remoteUpdatedAt: string) => {
    try {
      const parsed = JSON.parse(dataJson);
      setDataWithHistory({
        ...parsed,
        prices: parsed.prices?.length > 0 ? parsed.prices : data.prices,
        tickerDatabase: parsed.tickerDatabase?.length > 0 ? parsed.tickerDatabase : data.tickerDatabase,
        historicalDailyCloses: parsed.historicalDailyCloses?.length > 0 ? parsed.historicalDailyCloses : data.historicalDailyCloses,
      });
      addAppLog("Gist에서 데이터 불러오기 완료", "success");
    } catch {
      addAppLog("Gist 데이터 파싱 실패", "error");
    }
  }, [data.prices, data.tickerDatabase, data.historicalDailyCloses, setDataWithHistory, addAppLog]);

  const { autoSyncEnabled, setAutoSyncEnabled, lastPushAt: gistLastPushAt, lastPullAt: gistLastPullAt, resolveGistConflict } = useGistSync(
    data,
    handleGistPulledData,
    { onLog: addAppLog }
  );

  useMarketEnvSnapshotRecorder();

  // 저장소 사용률 85% 초과 시 1회 경고 (세션당 1회)
  const storageQuota = useStorageQuota();
  useEffect(() => {
    if (!storageQuota.isNearLimit) return;
    const warnedKey = "fw-storage-near-limit-warned";
    try {
      if (sessionStorage.getItem(warnedKey) === "1") return;
      sessionStorage.setItem(warnedKey, "1");
    } catch { /* */ }
    const used = storageQuota.usage ?? 0;
    const total = storageQuota.quota ?? 0;
    const mb = (b: number) => (b / (1024 * 1024)).toFixed(1);
    const pct = storageQuota.ratio != null ? Math.round(storageQuota.ratio * 100) : "?";
    toast.error(
      `저장소 사용 ${pct}% (${mb(used)}MB / ${mb(total)}MB). 설정에서 백업 정리를 고려하세요.`,
      { duration: 8000, id: "storage-near-limit" }
    );
    addAppLog(`저장소 사용률 높음 (${pct}%) — 백업 정리 권장`, "error");
  }, [storageQuota.isNearLimit, storageQuota.usage, storageQuota.quota, storageQuota.ratio, addAppLog]);

  const gistConflict = useUIStore((s) => s.gistConflict);

  const handleGistVersionLoad = useCallback((dataJson: string, _committedAt: string) => {
    handleGistPulledData(dataJson, _committedAt);
  }, [handleGistPulledData]);

  // keyboard shortcuts
  useKeyboardShortcuts({
    tab,
    setTab,
    onUndo: () => {
      if (handleUndo()) {
        toast.success("실행 취소", { id: "undo" });
      }
    },
    onRedo: () => {
      if (handleRedo()) {
        toast.success("다시 실행", { id: "redo" });
      }
    },
    onSearch: () => setIsSearchOpen(true),
    onShortcutsHelp: () => setShowShortcutsHelp((prev) => !prev),
    onSave: () => {
      void handleManualBackup();
    },
    onAddLedger: () => {
      setTab("ledger");
      window.dispatchEvent(new CustomEvent("farmwallet:focus-ledger-form"));
    },
    onQuickEntry: () => setShowQuickEntry(true)
  });

  const handleQuickEntryAdd = useCallback((entry: import("./types").LedgerEntry) => {
    setDataWithHistory((prev) => ({ ...prev, ledger: [...prev.ledger, entry] }));
    toast.success(`가계부에 추가됨: ${entry.description}`);
  }, [setDataWithHistory]);


  const needsPortfolioAggregation = tab === "accounts" || tab === "stocks";
  const needsBalances = tab === "accounts" || tab === "ledger" || tab === "stocks";

  const { balances, positions } = usePortfolioWorker({
    accounts: data.accounts,
    ledger: data.ledger,
    trades: data.trades,
    prices: data.prices,
    fxRate,
    needsBalances,
    needsPortfolioAggregation
  });

  useEffect(() => {
    if (tab !== "settings") return;
    let cancelled = false;
    try {
      const issues = runIntegrityCheck(
        data.accounts,
        data.ledger,
        data.trades,
        data.categoryPresets
      );
      if (!cancelled) {
        setIntegritySummary({
          error: issues.filter((i) => i.severity === "error").length,
          warning: issues.filter((i) => i.severity === "warning").length
        });
      }
    } catch {
      if (!cancelled) setIntegritySummary(null);
    }
    return () => { cancelled = true; };
  }, [tab, data.accounts, data.ledger, data.trades, data.categoryPresets, setIntegritySummary]);

  const settingsTabBadge = useMemo(() => {
    if (!integritySummary) return undefined;
    if (integritySummary.error > 0) return `오류 ${integritySummary.error}`;
    if (integritySummary.warning > 0) return `경고 ${integritySummary.warning}`;
    return undefined;
  }, [integritySummary]);

  const handleRenameAccountId = (oldId: string, newId: string) => {
    if (!oldId || !newId || oldId === newId) return;
    setDataWithHistory((prev) => {
      const renameId = (id?: string) => (id === oldId ? newId : id);
      return {
        ...prev,
        accounts: prev.accounts.map((a) => (a.id === oldId ? { ...a, id: newId } : a)),
        ledger: prev.ledger.map((l) => ({
          ...l,
          fromAccountId: renameId(l.fromAccountId),
          toAccountId: renameId(l.toAccountId)
        })),
        trades: prev.trades.map((t) =>
          t.accountId === oldId ? { ...t, accountId: newId } : t
        )
      };
    });
    toast.success("계좌 ID 변경 완료");
  };


  if (isLoading) {
    return (
      <div className="app-root" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <p style={{ color: "var(--text-muted)", fontSize: 15 }}>로딩 중...</p>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="app-root" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: 24, textAlign: "center" }}>
        <p style={{ color: "var(--danger)", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>데이터를 불러오지 못했습니다.</p>
        <p style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 24, maxWidth: 400 }}>
          저장된 데이터가 손상되었거나 읽을 수 없습니다. 설정 탭에서 &quot;백업 파일 불러오기&quot;로 이전에 받아 둔 JSON 백업을 불러오세요.
        </p>
        <button type="button" className="primary" onClick={() => setTab("settings")}>
          설정 탭으로 이동
        </button>
      </div>
    );
  }

  return (
    <div className="app-root">
      <a href="#main-content" className="skip-link">본문으로 건너뛰기</a>
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 4000,
          style: {
            background: "var(--surface)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            boxShadow: "var(--shadow-lg)",
            zIndex: 9999
          }
        }}
        containerStyle={{ top: 12, zIndex: 9999 }}
      />
      <PWAStatus />
      {isOnRestoreBranch && (
        <div
          role="alert"
          style={{
            background: "#fef3c7",
            color: "#92400e",
            borderBottom: "1px solid #f59e0b",
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            textAlign: "center",
          }}
        >
          ⚠ 복구 브랜치({gitCurrentBranch}) 상태입니다 — git 업로드는 잠겨 있습니다. 작업 후 main으로 돌아가세요.
        </div>
      )}
      <header className="app-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
          <button
            type="button"
            className="mobile-menu-btn"
            onClick={() => setMobileDrawerOpen(true)}
            aria-label="메뉴 열기"
            title="메뉴"
          >
            <Menu size={24} />
          </button>
          <div>
          <h1>FarmWallet <span style={{ fontSize: "0.6em", fontWeight: "normal", color: "var(--text-muted)", marginLeft: "8px" }}>v{APP_VERSION}</span></h1>
          <p className="subtitle">자산 및 주식 관리</p>
          </div>
          <div className="app-log-panel" aria-live="polite">
            <div className="app-log-panel-title">로그</div>
            <div ref={appLogListRef} className="app-log-panel-list">
              {appLog.length === 0 ? (
                <div className="app-log-panel-empty">저장·시세·종목 불러오기 시 여기에 표시됩니다.</div>
              ) : (
                // 성능: 200개까지 쌓이는 로그 중 최신 8개만 DOM에 렌더.
                // 전체는 store(uiStore.appLog)에 유지되어 나중에 확장 UI로 열어볼 수 있음.
                appLog.slice(-8).map((e) => (
                  <div key={e.id} className={`app-log-panel-item app-log-${e.type}`}>
                    <span className="app-log-time">{e.time}</span> {e.message}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        <div className="app-header-right" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <RecurringDueBadge
              recurring={data.recurringExpenses}
              ledger={data.ledger}
              onClick={() => setTab("budget")}
            />
            <button
              type="button"
              onClick={() => setShowQuickEntry(true)}
              title="빠른 입력 (Ctrl+Shift+K)"
              style={{ fontSize: 12, padding: "4px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--surface)", cursor: "pointer" }}
            >
              ＋ 빠른 입력
            </button>
            <button
              onClick={toggleTheme}
              className="icon-button"
              title="테마 변경"
              style={{ width: 32, height: 32, border: "1px solid var(--border)" }}
            >
              {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
            </button>
          </div>
          {newVersionAvailable && (
            <div className="pill success" style={{ cursor: "pointer", fontWeight: 600 }} onClick={() => window.location.reload()}>
              새 버전이 배포되었습니다 — 클릭하여 적용
            </div>
          )}
          {backupWarning && (
            <div className={`pill ${backupWarning.type === "critical" ? "warning" : "muted"}`}>
              {backupWarning.message}
            </div>
          )}
          {backupIntegrity.status === "valid" && <div className="pill success">최근 로컬 백업 무결성 검사됨 (SHA-256)</div>}
          {backupIntegrity.status === "missing-hash" && (
            <div className="pill warning">현재 백업에 해시가 없어 무결성 검사 불가 (다시 백업 권장)</div>
          )}
          {backupIntegrity.status === "mismatch" && (
            <div className="pill danger">최근 로컬 백업 해시 불일치. 백업을 다시 생성하세요.</div>
          )}
          <SyncActionBar
            data={data}
            latestBackupAt={latestBackupAt}
            gistLastPushAt={gistLastPushAt}
            gistLastPullAt={gistLastPullAt}
            gitLastPushAt={gitLastPushAt}
            gitLastPullAt={gitLastPullAt}
            gistConfigured={gistConfigured}
            isGistSaving={isGistSaving}
            isPushingToGit={isPushingToGit}
            isPullingFromGit={isPullingFromGit}
            isOnRestoreBranch={isOnRestoreBranch}
            gitCurrentBranch={gitCurrentBranch}
            newVersionAvailable={newVersionAvailable}
            onLocalBackup={() => withConfirm({
              title: "로컬 백업",
              message: "현재 데이터를 백업 파일로 저장합니다.",
              confirmLabel: "백업",
              onConfirm: () => { void handleManualBackup(); },
            })}
            onGistSave={() => withConfirm({
              title: "Gist 저장",
              message: "현재 데이터를 Gist에 저장합니다.",
              confirmLabel: "저장",
              onConfirm: async () => {
                setIsGistSaving(true);
                addAppLog("Gist에 저장 중...", "info");
                try {
                  const jsonStr = toUserDataJson(data);
                  const result = await saveToGist(jsonStr);
                  setGistLastPushAt(result.updatedAt);
                  addAppLog("Gist 저장 완료", "success");
                  toast.success("Gist 저장 완료");
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  addAppLog(`Gist 저장 실패: ${msg}`, "error");
                  toast.error(msg || "Gist 저장 실패");
                } finally {
                  setIsGistSaving(false);
                }
              },
            })}
            onGistLoad={() => setShowGistVersionModal(true)}
            onGitPush={() => withConfirm({
              title: "git에 업로드",
              message: "현재 코드와 데이터를 git 원격에 push합니다. 약 2분 후 반영됩니다.",
              confirmLabel: "업로드",
              confirmStyle: "danger",
              onConfirm: async () => {
                setIsPushingToGit(true);
                addAppLog("최신 데이터 저장 중...", "info");
                try {
                  // auto-save 디바운스(500ms) 중일 수 있어 data/farmwallet-data.json이 구버전일 수 있음.
                  // 명시적으로 flush해 최신 데이터가 파일에 반영된 뒤 push.
                  const userDataStr = toUserDataJson(data);
                  const userFieldsWithMeta = {
                    ...JSON.parse(userDataStr),
                    _exportedAt: new Date().toISOString(),
                  };
                  // 두 단계 fetch 각각에 타임아웃 적용 (네트워크 단절·서버 응답 없음 보호)
                  const flushController = new AbortController();
                  const flushTimer = setTimeout(() => flushController.abort(), 15_000);
                  let flushRes: Response;
                  try {
                    flushRes = await fetch("/api/farmwallet-data", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(userFieldsWithMeta),
                      signal: flushController.signal,
                    });
                  } catch (err) {
                    if (err instanceof DOMException && err.name === "AbortError") {
                      throw new Error("데이터 파일 저장 시간 초과 (15s)");
                    }
                    throw err;
                  } finally {
                    clearTimeout(flushTimer);
                  }
                  if (!flushRes.ok) {
                    const flushJson = await flushRes.json().catch(() => ({}));
                    throw new Error(flushJson.error ?? "데이터 파일 저장 실패");
                  }
                  addAppLog("git에 업로드 중...", "info");
                  const pushController = new AbortController();
                  const pushTimer = setTimeout(() => pushController.abort(), 120_000);
                  let res: Response;
                  try {
                    res = await fetch("/api/git-push", { method: "POST", signal: pushController.signal });
                  } catch (err) {
                    if (err instanceof DOMException && err.name === "AbortError") {
                      throw new Error("git 업로드 시간 초과 (120s)");
                    }
                    throw err;
                  } finally {
                    clearTimeout(pushTimer);
                  }
                  const json = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(json.error ?? "git 업로드 실패");
                  const nowIso = new Date().toISOString();
                  try { localStorage.setItem(STORAGE_KEYS.GIT_LAST_PUSH_AT, nowIso); } catch { /* */ }
                  setGitLastPushAt(nowIso);
                  addAppLog("git 업로드 완료 (약 2분 후 반영)", "success");
                  toast.success("git 업로드 완료");
                } catch (e) {
                  const msg = e instanceof Error ? e.message : String(e);
                  addAppLog(`git 업로드 실패: ${msg}`, "error");
                  toast.error(msg || "git 업로드 실패");
                } finally {
                  setIsPushingToGit(false);
                }
              },
            })}
            onGitPull={() => {
              if (import.meta.env.DEV) {
                setShowGitVersionModal(true);
              } else {
                window.location.reload();
              }
            }}
            onSearch={() => setIsSearchOpen(true)}
          />
        </div>
      </header>

          <div className="layout">
            <aside className="sidebar" role="navigation" aria-label="주 메뉴">
              <Tabs active={tab} onChange={handleTabChange} onPrefetch={handlePrefetchTab} tabBadges={settingsTabBadge ? { settings: settingsTabBadge } : undefined} />
            </aside>
            {mobileDrawerOpen && (
              <>
                <div
                  className="drawer-overlay"
                  role="presentation"
                  onClick={() => setMobileDrawerOpen(false)}
                  onKeyDown={(e) => e.key === "Escape" && setMobileDrawerOpen(false)}
                  aria-hidden
                />
                <div className="drawer-panel" role="dialog" aria-label="메뉴">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ fontWeight: 600 }}>메뉴</span>
                    <button type="button" className="icon-button" onClick={() => setMobileDrawerOpen(false)} aria-label="닫기">
                      닫기
                    </button>
                  </div>
                  <Tabs active={tab} onChange={handleTabChange} onPrefetch={handlePrefetchTab} tabBadges={settingsTabBadge ? { settings: settingsTabBadge } : undefined} />
                </div>
              </>
            )}
            <main id="main-content" className="app-main" role="main">
          <Suspense fallback={<div className="card" style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>로딩 중...</div>}>
          {tab === "dashboard" && (
            <TabErrorBoundary tabName="대시보드"><DashboardView /></TabErrorBoundary>
          )}
          {tab === "accounts" && (
            <TabErrorBoundary tabName="계좌">
            <AccountsView
              accounts={data.accounts}
              balances={balances}
              positions={positions}
              ledger={data.ledger}
              trades={data.trades}
              fxRate={fxRate}
              onChangeAccounts={(accounts) => setDataWithHistory((prev) => ({ ...prev, accounts }))}
              onChangeLedger={(ledger) => setDataWithHistory((prev) => ({ ...prev, ledger }))}
              onRenameAccountId={handleRenameAccountId}
            />
            </TabErrorBoundary>
          )}
          {tab === "ledger" && (
            <TabErrorBoundary tabName="가계부">
            <LedgerView
              accounts={data.accounts}
              ledger={data.ledger}
              balances={balances}
              trades={data.trades}
              categoryPresets={data.categoryPresets}
              ledgerTemplates={data.ledgerTemplates ?? []}
              onChangeLedger={(ledger) => setDataWithHistory((prev) => ({ ...prev, ledger }))}
              onChangeTemplates={(ledgerTemplates) => setDataWithHistory((prev) => ({ ...prev, ledgerTemplates }))}
              copyRequest={copyRequest}
              onCopyComplete={() => setCopyRequest(null)}
              highlightLedgerId={highlightLedgerId}
              onClearHighlightLedger={() => setHighlightLedgerId(null)}
            />
            </TabErrorBoundary>
          )}
          {tab === "categories" && (
            <TabErrorBoundary tabName="카테고리">
            <CategoriesView
              presets={data.categoryPresets}
              onChangePresets={(categoryPresets) => setDataWithHistory((prev) => ({ ...prev, categoryPresets }))}
              ledger={data.ledger}
            />
            </TabErrorBoundary>
          )}
          {tab === "stocks" && (
            <TabErrorBoundary tabName="주식">
            <StocksView
              accounts={data.accounts}
              balances={balances}
              trades={data.trades}
              prices={data.prices}
              tickerDatabase={Array.isArray(data.tickerDatabase) ? data.tickerDatabase : []}
              highlightTradeId={highlightTradeId}
              onClearHighlightTrade={() => setHighlightTradeId(null)}
              onChangeTrades={(trades) => setDataWithHistory((prev) => ({
                ...prev,
                trades: typeof trades === "function" ? trades(prev.trades) : trades
              }))}
              onChangePrices={(prices) => setDataWithHistory((prev) => ({ ...prev, prices }))}
              onChangeTickerDatabase={(next) =>
                setDataWithHistory((prev) => {
                  const current = Array.isArray(prev.tickerDatabase) ? prev.tickerDatabase : [];
                  const nextDb = typeof next === "function" ? next(current) : next;
                  return { ...prev, tickerDatabase: Array.isArray(nextDb) ? nextDb : current };
                })
              }
              onLoadInitialTickers={handleLoadInitialTickers}
              isLoadingTickerDatabase={isLoadingTickerDatabase}
              onLog={addAppLog}
              presets={data.stockPresets}
              onChangePresets={(stockPresets) => setDataWithHistory((prev) => ({ ...prev, stockPresets }))}
              ledger={data.ledger}
              onChangeLedger={(ledger) => setDataWithHistory((prev) => ({ ...prev, ledger }))}
              onChangeAccounts={(accounts) => setDataWithHistory((prev) => ({ ...prev, accounts }))}
              fxRate={fxRate}
              targetPortfolios={data.targetPortfolios ?? []}
              onChangeTargetPortfolios={(targetPortfolios) => setDataWithHistory((prev) => ({ ...prev, targetPortfolios }))}
            />
            </TabErrorBoundary>
          )}
          {tab === "dividends" && (
            <TabErrorBoundary tabName="배당">
            <DividendsView
              accounts={data.accounts}
              ledger={data.ledger}
              trades={data.trades}
              prices={data.prices}
              tickerDatabase={Array.isArray(data.tickerDatabase) ? data.tickerDatabase : []}
              historicalDailyCloses={data.historicalDailyCloses ?? []}
              onChangeLedger={(ledger) => setDataWithHistory((prev) => ({ ...prev, ledger }))}
              fxRate={fxRate}
            />
            </TabErrorBoundary>
          )}
          {tab === "debt" && (
            <TabErrorBoundary tabName="대출">
            <DebtView
              loans={data.loans}
              ledger={data.ledger}
              accounts={data.accounts}
              categoryPresets={data.categoryPresets}
              onChangeLoans={(loans) => setDataWithHistory((prev) => ({ ...prev, loans }))}
              onChangeLedger={(ledger) => setDataWithHistory((prev) => ({ ...prev, ledger }))}
            />
            </TabErrorBoundary>
          )}
          {tab === "insights" && (
            <TabErrorBoundary tabName="인사이트">
            <InsightsView
              accounts={data.accounts}
              ledger={data.ledger}
              trades={data.trades}
              categoryPresets={data.categoryPresets}
              budgetGoals={data.budgetGoals}
              recurringExpenses={data.recurringExpenses}
              onAddLedger={(entry) => setDataWithHistory((prev) => ({ ...prev, ledger: [...prev.ledger, entry] }))}
            />
            </TabErrorBoundary>
          )}
          {tab === "budget" && (
            <TabErrorBoundary tabName="예산·반복지출">
            <BudgetRecurringView
              accounts={data.accounts}
              recurring={data.recurringExpenses}
              budgets={data.budgetGoals}
              categoryPresets={data.categoryPresets}
              ledger={data.ledger}
              onChangeRecurring={(recurringExpenses) => setDataWithHistory((prev) => ({ ...prev, recurringExpenses }))}
              onChangeBudgets={(budgetGoals) => setDataWithHistory((prev) => ({ ...prev, budgetGoals }))}
              onChangeLedger={(ledger) => setDataWithHistory((prev) => ({ ...prev, ledger }))}
            />
            </TabErrorBoundary>
          )}
          {tab === "reports" && (
            <TabErrorBoundary tabName="리포트">
            <ReportView
              accounts={data.accounts}
              ledger={data.ledger}
              trades={data.trades}
              prices={data.prices}
            />
            </TabErrorBoundary>
          )}
          {tab === "workout" && (
            <TabErrorBoundary tabName="운동">
            <WorkoutView
              workoutWeeks={data.workoutWeeks ?? []}
              onChangeWorkoutWeeks={(workoutWeeks) => setDataWithHistory((prev) => ({ ...prev, workoutWeeks }))}
              workoutRoutines={data.workoutRoutines ?? []}
              onChangeWorkoutRoutines={(workoutRoutines) => setDataWithHistory((prev) => ({ ...prev, workoutRoutines }))}
              customExercises={data.customExercises ?? []}
              onChangeCustomExercises={(customExercises) => setDataWithHistory((prev) => ({ ...prev, customExercises }))}
            />
            </TabErrorBoundary>
          )}
          {tab === "settings" && (
            <TabErrorBoundary tabName="설정">
            <SettingsView
              data={data}
              backupVersion={backupVersion}
              onBackupRestored={clearLoadFailed}
              onNavigateToRecord={({ type, id }) => {
                if (type === "ledger") {
                  setTab("ledger");
                  setHighlightLedgerId(id);
                  setHighlightTradeId(null);
                } else {
                  setTab("stocks");
                  setHighlightTradeId(id);
                  setHighlightLedgerId(null);
                }
              }}
              onNavigateToTab={(nextTab) => {
                setTab(nextTab);
                if (nextTab !== "ledger") setHighlightLedgerId(null);
                if (nextTab !== "stocks") setHighlightTradeId(null);
              }}
              onChangeData={(next) => {
                setDataWithHistory(next);
                addAppLog("저장 완료: 거래·시세·종목 등 데이터가 저장되었습니다.", "success");
              }}
              autoSyncEnabled={autoSyncEnabled}
              onAutoSyncChange={setAutoSyncEnabled}
              gistLastPushAt={gistLastPushAt}
              gistLastPullAt={gistLastPullAt}
            />
            </TabErrorBoundary>
          )}
          </Suspense>
        </main>
      </div>

      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        savedFilters={savedFilters}
        filteredResults={filteredSearchResults}
        fxRate={fxRate}
        onSaveFilter={saveCurrentFilter}
        onApplyFilter={applySavedFilter}
        onDeleteFilter={deleteSavedFilter}
        onNavigate={({ type, id }) => {
          if (type === "ledger") {
            setTab("ledger");
            setHighlightLedgerId(id);
            setHighlightTradeId(null);
          } else {
            setTab("stocks");
            setHighlightTradeId(id);
            setHighlightLedgerId(null);
          }
        }}
      />

      <ShortcutsHelp isOpen={showShortcutsHelp} onClose={() => setShowShortcutsHelp(false)} />

      <QuickEntryModal
        open={showQuickEntry}
        onClose={() => setShowQuickEntry(false)}
        data={data}
        onAdd={handleQuickEntryAdd}
      />

      <GistVersionModal
        isOpen={showGistVersionModal}
        onClose={() => setShowGistVersionModal(false)}
        onLoad={handleGistVersionLoad}
        onLog={addAppLog}
      />

      <GitVersionModal
        isOpen={showGitVersionModal}
        onClose={() => setShowGitVersionModal(false)}
        onLog={addAppLog}
        onSelect={async (ref) => {
          setIsPullingFromGit(true);
          try {
            const res = await fetch("/api/git-pull", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ref })
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error ?? "git 내려받기 실패");
            const branch = json.branch ?? "main";
            setGitCurrentBranch(branch);
            const nowIso = new Date().toISOString();
            try { localStorage.setItem(STORAGE_KEYS.GIT_LAST_PULL_AT, nowIso); } catch { /* */ }
            setGitLastPullAt(nowIso);
            const msg = ref === ""
              ? "git 내려받기 완료 — main 최신. F5로 새로고침하세요."
              : `git 내려받기 완료 — ${branch}. F5로 새로고침하세요.`;
            addAppLog(msg, "success");
            toast.success(msg);
          } catch (e) {
            const err = e instanceof Error ? e.message : String(e);
            addAppLog(`git 내려받기 실패: ${err}`, "error");
            toast.error(err || "git 내려받기 실패");
            throw e;
          } finally {
            setIsPullingFromGit(false);
          }
        }}
      />

      <ConfirmModal
        isOpen={pendingAction !== null}
        title={pendingAction?.title ?? ""}
        message={pendingAction?.message ?? ""}
        confirmLabel={pendingAction?.confirmLabel ?? "확인"}
        confirmStyle={pendingAction?.confirmStyle ?? "primary"}
        onConfirm={() => {
          const action = pendingAction;
          setPendingAction(null);
          action?.onConfirm();
        }}
        onCancel={() => setPendingAction(null)}
      />

      <GistConflictModal conflict={gistConflict} onResolve={(r) => void resolveGistConflict(r)} />
    </div>
  );
};
