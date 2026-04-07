import React, { useCallback, useEffect, useMemo, useState, lazy, Suspense } from "react";
import { Toaster, toast } from "react-hot-toast";
import { Moon, Sun, Menu } from "lucide-react";
import { Tabs, type TabId } from "./components/ui/Tabs";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { SearchModal } from "./components/SearchModal";
import { PWAStatus } from "./components/PWAStatus";
import { useSwipe } from "./hooks/useSwipe";
import { ConfirmModal } from "./components/ui/ConfirmModal";
import { GistVersionModal } from "./components/GistVersionModal";

// 동일 로더를 lazy와 프리페치에서 공유해 탭 호버 시 청크 미리 로드
const loadDashboard = () => import("./pages/DashboardPage").then((m) => ({ default: m.DashboardView }));
const loadAccounts = () => import("./pages/AccountsPage").then((m) => ({ default: m.AccountsView }));
const loadLedger = () => import("./pages/LedgerPage").then((m) => ({ default: m.LedgerView }));
const loadCategories = () => import("./pages/CategoriesPage").then((m) => ({ default: m.CategoriesView }));
const loadStocks = () => import("./pages/StocksPage").then((m) => ({ default: m.StocksView }));
const loadDividends = () => import("./pages/DividendsPage").then((m) => ({ default: m.DividendsView }));
const loadDebt = () => import("./pages/DebtPage").then((m) => ({ default: m.DebtView }));
const loadSpend = () => import("./pages/SpendPage").then((m) => ({ default: m.SpendView }));
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
const SpendView = lazy(loadSpend);
const BudgetRecurringView = lazy(loadBudget);
const ReportView = lazy(loadReport);
const SettingsView = lazy(loadSettings);
const WorkoutView = lazy(loadWorkout);
const InsightsView = lazy(loadInsights);

const TAB_PREFETCH: Record<TabId, () => Promise<{ default: React.ComponentType<any> }>> = {
  dashboard: loadDashboard,
  accounts: loadAccounts,
  ledger: loadLedger,
  categories: loadCategories,
  stocks: loadStocks,
  dividends: loadDividends,
  debt: loadDebt,
  spend: loadSpend,
  budget: loadBudget,
  reports: loadReport,
  settings: loadSettings,
  workout: loadWorkout,
  insights: loadInsights
};
import { useAppData } from "./hooks/useAppData";
import { useUndoRedo } from "./hooks/useUndoRedo";
import { useBackup } from "./hooks/useBackup";
import { useSearch } from "./hooks/useSearch";
import { useTheme } from "./hooks/useTheme";
import { useFxRateValue } from "./context/FxRateContext";
import { useTickerDatabase } from "./hooks/useTickerDatabase";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { usePortfolioWorker } from "./hooks/usePortfolioWorker";
import { APP_VERSION, BUILD_HASH } from "./constants/config";
import { saveToGist, getGistToken, getGistId, setGistLastPushAt, isGistConfigured, GIST_CONFIG_CHANGE_EVENT } from "./services/gistSync";
import { toUserDataJson } from "./services/dataService";
import { useGistSync } from "./hooks/useGistSync";
import { runIntegrityCheck } from "./utils/dataIntegrity";

export type AppLogEntry = { id: number; message: string; type: "success" | "error" | "info"; time: string };
const APP_LOG_MAX = 200;

const TAB_ORDER: TabId[] = ["dashboard", "accounts", "ledger", "categories", "stocks", "dividends", "debt", "spend", "budget", "reports", "insights", "workout", "settings"];

export const App: React.FC = () => {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [isPushingToGit, setIsPushingToGit] = useState(false);
  const [isPullingFromGit, setIsPullingFromGit] = useState(false);
  const [showGistVersionModal, setShowGistVersionModal] = useState(false);
  const [newVersionAvailable, setNewVersionAvailable] = useState(false);

  // Gist 설정 반응형 상태 — Settings에서 변경 시 헤더 버튼 즉시 갱신
  const [hasGistToken, setHasGistToken] = useState(() => !!getGistToken());
  const [gistReady, setGistReady] = useState(() => isGistConfigured());

  useEffect(() => {
    const handler = () => {
      setHasGistToken(!!getGistToken());
      setGistReady(isGistConfigured());
    };
    window.addEventListener(GIST_CONFIG_CHANGE_EVENT, handler);
    return () => window.removeEventListener(GIST_CONFIG_CHANGE_EVENT, handler);
  }, []);

  // 프로덕션 자동 버전 감지 — 5분마다 build-meta.json 확인
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const checkForUpdate = async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}build-meta.json`, { cache: "no-store" });
        if (!res.ok) return;
        const meta = await res.json() as { hash?: string };
        if (meta.hash && meta.hash !== BUILD_HASH) {
          setNewVersionAvailable(true);
        }
      } catch { /* ignore */ }
    };
    const tid = setTimeout(checkForUpdate, 30_000);
    const iid = setInterval(checkForUpdate, 5 * 60_000);
    return () => { clearTimeout(tid); clearInterval(iid); };
  }, []);

  const [pendingAction, setPendingAction] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    confirmStyle: "primary" | "danger";
    onConfirm: () => void;
  } | null>(null);

  const withConfirm = (opts: {
    title: string;
    message: string;
    confirmLabel: string;
    confirmStyle?: "primary" | "danger";
    onConfirm: () => void;
  }) => {
    setPendingAction({
      confirmStyle: "primary",
      ...opts,
    });
  };
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [copyRequest, setCopyRequest] = useState<import("./types").LedgerEntry | null>(null);
  const [highlightLedgerId, setHighlightLedgerId] = useState<string | null>(null);
  const [highlightTradeId, setHighlightTradeId] = useState<string | null>(null);
  const [integritySummary, setIntegritySummary] = useState<{ error: number; warning: number } | null>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [appLog, setAppLog] = useState<AppLogEntry[]>([]);
  const appLogIdRef = React.useRef(0);
  const appLogListRef = React.useRef<HTMLDivElement>(null);

  const addAppLog = useCallback((message: string, type: "success" | "error" | "info" = "success") => {
    const id = ++appLogIdRef.current;
    const time = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setAppLog((prev) => [...prev.slice(-(APP_LOG_MAX - 1)), { id, message, type, time }]);
  }, []);

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
    const heavyTabs: TabId[] = ["stocks", "reports", "spend", "insights"];

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

  // Zustand store 사용
  const { data, setData, isLoading, loadFailed, clearLoadFailed } = useAppData();
  const { setDataWithHistory, handleUndo, handleRedo } = useUndoRedo(data, setData);
  const { theme, toggleTheme } = useTheme();

  // 모바일 좌/우 스와이프로 탭 이동
  const swipeHandlers = useSwipe(
    () => { const i = TAB_ORDER.indexOf(tab); if (i < TAB_ORDER.length - 1) setTab(TAB_ORDER[i + 1]); },
    () => { const i = TAB_ORDER.indexOf(tab); if (i > 0) setTab(TAB_ORDER[i - 1]); },
  );
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

  const handleGistVersionLoad = useCallback((dataJson: string, committedAt: string) => {
    try {
      const parsed = JSON.parse(dataJson);
      setDataWithHistory((prev) => ({
        ...parsed,
        prices: parsed.prices?.length > 0 ? parsed.prices : prev.prices,
        tickerDatabase: parsed.tickerDatabase?.length > 0 ? parsed.tickerDatabase : prev.tickerDatabase,
        historicalDailyCloses: parsed.historicalDailyCloses?.length > 0 ? parsed.historicalDailyCloses : prev.historicalDailyCloses,
      }));
      toast.success(`Gist 버전 불러오기 완료 (${new Date(committedAt).toLocaleString("ko-KR")})`);
    } catch {
      addAppLog("Gist 버전 불러오기 실패: 데이터 파싱 오류", "error");
      toast.error("Gist 버전 불러오기 실패");
    }
  }, [setDataWithHistory, addAppLog]);

  const handleGistAutoPull = useCallback((dataJson: string, remoteUpdatedAt: string) => {
    try {
      const parsed = JSON.parse(dataJson);
      // Gist에는 API 캐시가 없으므로, 현재 메모리의 캐시를 그대로 유지
      setDataWithHistory((prev) => ({
        ...parsed,
        prices: parsed.prices?.length > 0 ? parsed.prices : prev.prices,
        tickerDatabase: parsed.tickerDatabase?.length > 0 ? parsed.tickerDatabase : prev.tickerDatabase,
        historicalDailyCloses: parsed.historicalDailyCloses?.length > 0 ? parsed.historicalDailyCloses : prev.historicalDailyCloses,
      }));
      addAppLog(`Gist 자동 불러오기 완료 (${new Date(remoteUpdatedAt).toLocaleString("ko-KR")})`, "success");
    } catch {
      addAppLog("Gist 자동 불러오기 실패: 데이터 파싱 오류", "error");
    }
  }, [setDataWithHistory, addAppLog]);

  const { autoSyncEnabled, setAutoSyncEnabled, lastPushAt, lastPullAt } = useGistSync(
    data,
    handleGistAutoPull,
    { onLog: addAppLog }
  );

  const { isLoadingTickerDatabase, handleLoadInitialTickers } = useTickerDatabase(data, setDataWithHistory, { onLog: addAppLog });

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
    }
  });


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
  }, [tab, data.accounts, data.ledger, data.trades, data.categoryPresets]);

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
                appLog.map((e) => (
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
            <button
              onClick={toggleTheme}
              className="icon-button"
              title="테마 변경"
              style={{ width: 32, height: 32, border: "1px solid var(--border)" }}
            >
              {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            {latestBackupAt ? (
              <div className="pill">
                최근 백업:{" "}
                {new Date(latestBackupAt).toLocaleString("ko-KR", {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit"
                })}
              </div>
            ) : (
              <div className="pill muted">백업 기록 없음</div>
            )}
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
          <div className="app-header-actions" style={{ display: 'flex', gap: 12 }}>
            {/* 그룹 1: 백업 · 저장 · 배포 */}
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', background: 'var(--surface)', borderRadius: 8, padding: '2px 4px' }}>
              <button
                type="button"
                className="primary"
                onClick={() => withConfirm({
                  title: "로컬 백업",
                  message: "현재 데이터를 백업 파일로 저장합니다.",
                  confirmLabel: "백업",
                  onConfirm: () => { void handleManualBackup(); },
                })}
              >
                백업
              </button>
              <button
                type="button"
                className="primary"
                style={{ background: hasGistToken ? "var(--chart-primary)" : undefined, opacity: hasGistToken ? 1 : 0.5 }}
                disabled={!hasGistToken}
                title={!hasGistToken ? "설정 → 클라우드 동기화에서 GitHub 토큰을 먼저 입력하세요" : "현재 데이터를 Gist에 저장"}
                onClick={() => withConfirm({
                  title: "Gist 저장",
                  message: "현재 데이터를 GitHub Gist에 저장합니다. 기존 Gist 데이터가 덮어씌워집니다.",
                  confirmLabel: "저장",
                  onConfirm: async () => {
                    addAppLog("백업 + Gist 저장 시작...", "info");
                    try {
                      await handleManualBackup();
                      const result = await saveToGist(toUserDataJson(data));
                      setGistLastPushAt(result.updatedAt);
                      addAppLog(`Gist 저장 완료 (${new Date(result.updatedAt).toLocaleString("ko-KR")})`, "success");
                      toast.success("백업 + Gist 저장 완료");
                    } catch (e: any) {
                      addAppLog(`Gist 저장 실패: ${e.message}`, "error");
                      toast.error(e.message ?? "Gist 저장 실패");
                    }
                  },
                })}
              >
                Gist 저장
              </button>
              {import.meta.env.DEV && (
                <button
                  type="button"
                  className="primary"
                  style={{ background: "var(--success, #22c55e)" }}
                  disabled={isPushingToGit}
                  onClick={() => withConfirm({
                    title: "GitHub 배포",
                    message: "현재 코드와 데이터를 GitHub에 push합니다. 약 2분 후 반영됩니다.",
                    confirmLabel: "배포",
                    confirmStyle: "danger",
                    onConfirm: async () => {
                      setIsPushingToGit(true);
                      addAppLog("GitHub 배포 중...", "info");
                      try {
                        const res = await fetch("/api/git-push", { method: "POST" });
                        const json = await res.json();
                        if (!res.ok) throw new Error(json.error ?? "배포 실패");
                        addAppLog("GitHub 배포 완료 (약 2분 후 반영)", "success");
                        toast.success("GitHub에 배포 완료");
                      } catch (e: any) {
                        addAppLog(`GitHub 배포 실패: ${e.message}`, "error");
                        toast.error(e.message ?? "GitHub 배포 실패");
                      } finally {
                        setIsPushingToGit(false);
                      }
                    },
                  })}
                >
                  {isPushingToGit ? "배포 중..." : "배포"}
                </button>
              )}
            </div>
            {/* 그룹 2: 불러오기 · 업데이트 */}
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', background: 'var(--surface)', borderRadius: 8, padding: '2px 4px' }}>
              <button
                type="button"
                className="secondary"
                style={gistReady
                  ? { borderColor: "var(--chart-primary)", color: "var(--chart-primary)" }
                  : { opacity: 0.45 }
                }
                disabled={!gistReady}
                title={!hasGistToken ? "설정 → 클라우드 동기화에서 GitHub 토큰을 먼저 입력하세요" : !gistReady ? "Gist에 먼저 저장해야 불러올 수 있습니다" : "저장된 Gist 버전에서 불러오기"}
                onClick={() => setShowGistVersionModal(true)}
              >
                Gist 불러오기
              </button>
              <button
                type="button"
                className="secondary"
                style={newVersionAvailable ? { borderColor: "var(--success, #22c55e)", color: "var(--success, #22c55e)", fontWeight: 600 } : undefined}
                disabled={isPullingFromGit}
                onClick={() => {
                  if (import.meta.env.DEV) {
                    withConfirm({
                      title: "업데이트",
                      message: "원격에서 최신 코드를 내려받습니다. 완료 후 F5로 새로고침이 필요합니다.",
                      confirmLabel: "업데이트",
                      confirmStyle: "danger",
                      onConfirm: async () => {
                        setIsPullingFromGit(true);
                        addAppLog("원격 업데이트 가져오는 중...", "info");
                        try {
                          const res = await fetch("/api/git-pull", { method: "POST" });
                          const json = await res.json();
                          if (!res.ok) throw new Error(json.error ?? "업데이트 실패");
                          addAppLog("업데이트 완료. F5로 새로고침하세요.", "success");
                          toast.success("업데이트 완료 — F5로 새로고침");
                        } catch (e: any) {
                          addAppLog(`업데이트 실패: ${e.message}`, "error");
                          toast.error(e.message ?? "업데이트 실패");
                        } finally {
                          setIsPullingFromGit(false);
                        }
                      },
                    });
                  } else {
                    // 프로덕션: 새 배포 버전으로 페이지 새로고침
                    window.location.reload();
                  }
                }}
              >
                {isPullingFromGit ? "업데이트 중..." : newVersionAvailable ? "새 버전 적용" : "업데이트"}
              </button>
            </div>
            <button
              type="button"
              className="secondary"
              onClick={() => setIsSearchOpen(true)}
            >
              빠른 검색
            </button>
          </div>
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
            <main id="main-content" className="app-main" role="main" {...swipeHandlers}>
          <Suspense fallback={<div className="card" style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>로딩 중...</div>}>
          {tab === "dashboard" && <DashboardView />}
          {tab === "accounts" && (
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
          )}
          {tab === "ledger" && (
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
          )}
          {tab === "categories" && (
            <CategoriesView
              presets={data.categoryPresets}
              onChangePresets={(categoryPresets) => setDataWithHistory((prev) => ({ ...prev, categoryPresets }))}
              ledger={data.ledger}
            />
          )}
          {tab === "stocks" && (
            <StocksView
              accounts={data.accounts}
              balances={balances}
              trades={data.trades}
              prices={data.prices}
              customSymbols={data.customSymbols ?? []}
              tickerDatabase={Array.isArray(data.tickerDatabase) ? data.tickerDatabase : []}
              historicalDailyCloses={data.historicalDailyCloses ?? []}
              highlightTradeId={highlightTradeId}
              onClearHighlightTrade={() => setHighlightTradeId(null)}
              onChangeTrades={(trades) => setDataWithHistory((prev) => ({ 
                ...prev, 
                trades: typeof trades === "function" ? trades(prev.trades) : trades 
              }))}
              onChangePrices={(prices) => setDataWithHistory((prev) => ({ ...prev, prices }))}
              onChangeCustomSymbols={(customSymbols) => setDataWithHistory((prev) => ({ ...prev, customSymbols }))}
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
          )}
          {tab === "dividends" && (
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
          )}
          {tab === "debt" && (
            <DebtView
              loans={data.loans}
              ledger={data.ledger}
              accounts={data.accounts}
              categoryPresets={data.categoryPresets}
              onChangeLoans={(loans) => setDataWithHistory((prev) => ({ ...prev, loans }))}
              onChangeLedger={(ledger) => setDataWithHistory((prev) => ({ ...prev, ledger }))}
            />
          )}
          {tab === "spend" && (
            <SpendView
              accounts={data.accounts}
              ledger={data.ledger}
              categoryPresets={data.categoryPresets}
            />
          )}
          {tab === "insights" && (
            <InsightsView
              accounts={data.accounts}
              ledger={data.ledger}
              trades={data.trades}
              prices={data.prices}
              fxRate={fxRate ?? undefined}
              categoryPresets={data.categoryPresets}
              budgetGoals={data.budgetGoals}
            />
          )}
          {tab === "budget" && (
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
          )}
          {tab === "reports" && (
            <ReportView
              accounts={data.accounts}
              ledger={data.ledger}
              trades={data.trades}
              prices={data.prices}
            />
          )}
          {tab === "workout" && (
            <WorkoutView
              workoutWeeks={data.workoutWeeks ?? []}
              onChangeWorkoutWeeks={(workoutWeeks) => setDataWithHistory((prev) => ({ ...prev, workoutWeeks }))}
            />
          )}
          {tab === "settings" && (
            <SettingsView
              data={data}
              backupVersion={backupVersion}
              onBackupRestored={clearLoadFailed}
              autoSyncEnabled={autoSyncEnabled}
              onAutoSyncChange={setAutoSyncEnabled}
              gistLastPushAt={lastPushAt}
              gistLastPullAt={lastPullAt}
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
            />
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

      <GistVersionModal
        isOpen={showGistVersionModal}
        onClose={() => setShowGistVersionModal(false)}
        onLoad={handleGistVersionLoad}
        onLog={addAppLog}
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
    </div>
  );
};
