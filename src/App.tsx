import React, { useCallback, useEffect, useMemo, useState, lazy, Suspense } from "react";
import { Toaster, toast } from "react-hot-toast";
import { Moon, Sun, Menu } from "lucide-react";
import { Tabs, type TabId } from "./components/Tabs";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { SearchModal } from "./components/SearchModal";

// 동일 로더를 lazy와 프리페치에서 공유해 탭 호버 시 청크 미리 로드
const loadDashboard = () => import("./components/dashboard").then((m) => ({ default: m.DashboardView }));
const loadAccounts = () => import("./components/AccountsView").then((m) => ({ default: m.AccountsView }));
const loadLedger = () => import("./components/LedgerView").then((m) => ({ default: m.LedgerView }));
const loadCategories = () => import("./components/CategoriesView").then((m) => ({ default: m.CategoriesView }));
const loadStocks = () => import("./components/StocksView").then((m) => ({ default: m.StocksView }));
const loadDividends = () => import("./components/DividendsView").then((m) => ({ default: m.DividendsView }));
const loadDebt = () => import("./components/DebtView").then((m) => ({ default: m.DebtView }));
const loadBudget = () => import("./components/BudgetRecurringView").then((m) => ({ default: m.BudgetRecurringView }));
const loadReport = () => import("./components/ReportView").then((m) => ({ default: m.ReportView }));
const loadSettings = () => import("./components/SettingsView").then((m) => ({ default: m.SettingsView }));
const loadWorkout = () => import("./components/WorkoutView").then((m) => ({ default: m.WorkoutView }));

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

const TAB_PREFETCH: Record<TabId, () => Promise<{ default: React.ComponentType<any> }>> = {
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
  workout: loadWorkout
};
import { useAppData } from "./hooks/useAppData";
import { useUndoRedo } from "./hooks/useUndoRedo";
import { useBackup } from "./hooks/useBackup";
import { useSearch } from "./hooks/useSearch";
import { useTheme } from "./hooks/useTheme";
import { useFxRate } from "./hooks/useFxRate";
import { useTickerDatabase } from "./hooks/useTickerDatabase";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { usePortfolioWorker } from "./hooks/usePortfolioWorker";
import { APP_VERSION } from "./constants/config";
import { runIntegrityCheck } from "./utils/dataIntegrity";

export type AppLogEntry = { id: number; message: string; type: "success" | "error" | "info"; time: string };
const APP_LOG_MAX = 20;

export const App: React.FC = () => {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [copyRequest, setCopyRequest] = useState<import("./types").LedgerEntry | null>(null);
  const [highlightLedgerId, setHighlightLedgerId] = useState<string | null>(null);
  const [highlightTradeId, setHighlightTradeId] = useState<string | null>(null);
  const [integritySummary, setIntegritySummary] = useState<{ error: number; warning: number } | null>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [appLog, setAppLog] = useState<AppLogEntry[]>([]);
  const appLogIdRef = React.useRef(0);

  const addAppLog = useCallback((message: string, type: "success" | "error" | "info" = "success") => {
    const id = ++appLogIdRef.current;
    const time = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setAppLog((prev) => [...prev.slice(-(APP_LOG_MAX - 1)), { id, message, type, time }]);
  }, []);

  const handleTabChange = (id: TabId) => {
    setTab(id);
    setMobileDrawerOpen(false);
  };

  const handlePrefetchTab = useCallback((id: TabId) => {
    TAB_PREFETCH[id]?.();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const toWarmup: TabId[] = ["ledger", "stocks", "reports"];
    const runPrefetch = () => {
      toWarmup.forEach((id) => TAB_PREFETCH[id]?.());
    };

    const win = window as Window & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    if (typeof win.requestIdleCallback === "function") {
      const handle = win.requestIdleCallback(() => runPrefetch(), { timeout: 2000 });
      return () => {
        if (typeof win.cancelIdleCallback === "function") {
          win.cancelIdleCallback(handle);
        }
      };
    }

    const timeoutId = window.setTimeout(runPrefetch, 1500);
    return () => window.clearTimeout(timeoutId);
  }, []);

  // Zustand store 사용
  const { data, setData, isLoading, loadFailed, clearLoadFailed } = useAppData();
  const { setDataWithHistory, handleUndo, handleRedo } = useUndoRedo(data, setData);
  const { theme, toggleTheme } = useTheme();
  const fxRate = useFxRate();
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
            <div className="app-log-panel-list">
              {appLog.length === 0 ? (
                <div className="app-log-panel-empty">저장·시세·종목 불러오기 시 여기에 표시됩니다.</div>
              ) : (
                [...appLog].reverse().slice(0, 8).map((e) => (
                  <div key={e.id} className={`app-log-panel-item app-log-${e.type}`}>
                    <span className="app-log-time">{e.time}</span> {e.message}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
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
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="primary"
              onClick={handleManualBackup}
            >
              백업
            </button>
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
            <main className="app-main" role="main">
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
              onChangeLedger={(ledger) => setDataWithHistory((prev) => ({ ...prev, ledger }))}
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
    </div>
  );
};
