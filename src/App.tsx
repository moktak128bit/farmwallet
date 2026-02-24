import React, { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { Toaster, toast } from "react-hot-toast";
import { Moon, Sun, Menu } from "lucide-react";
import { Tabs, type TabId } from "./components/Tabs";
import { DashboardView } from "./components/DashboardView";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { SearchModal } from "./components/SearchModal";

const AccountsView = lazy(() => import("./components/AccountsView").then((m) => ({ default: m.AccountsView })));
const LedgerView = lazy(() => import("./components/LedgerView").then((m) => ({ default: m.LedgerView })));
const CategoriesView = lazy(() => import("./components/CategoriesView").then((m) => ({ default: m.CategoriesView })));
const StocksView = lazy(() => import("./components/StocksView").then((m) => ({ default: m.StocksView })));
const DividendsView = lazy(() => import("./components/DividendsView").then((m) => ({ default: m.DividendsView })));
const DebtView = lazy(() => import("./components/DebtView").then((m) => ({ default: m.DebtView })));
const BudgetRecurringView = lazy(() => import("./components/BudgetRecurringView").then((m) => ({ default: m.BudgetRecurringView })));
const ReportView = lazy(() => import("./components/ReportView").then((m) => ({ default: m.ReportView })));
const SettingsView = lazy(() => import("./components/SettingsView").then((m) => ({ default: m.SettingsView })));
const WorkoutView = lazy(() => import("./components/WorkoutView").then((m) => ({ default: m.WorkoutView })));
import { useAppData } from "./hooks/useAppData";
import { useUndoRedo } from "./hooks/useUndoRedo";
import { useBackup } from "./hooks/useBackup";
import { useSearch } from "./hooks/useSearch";
import { useTheme } from "./hooks/useTheme";
import { useFxRate } from "./hooks/useFxRate";
import { useTickerDatabase } from "./hooks/useTickerDatabase";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { computeAccountBalances, computePositions } from "./calculations";
import { APP_VERSION } from "./constants/config";
import { runIntegrityCheck } from "./utils/dataIntegrity";

export const App: React.FC = () => {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [copyRequest, setCopyRequest] = useState<import("./types").LedgerEntry | null>(null);
  const [highlightLedgerId, setHighlightLedgerId] = useState<string | null>(null);
  const [highlightTradeId, setHighlightTradeId] = useState<string | null>(null);
  const [integritySummary, setIntegritySummary] = useState<{ error: number; warning: number } | null>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const handleTabChange = (id: TabId) => {
    setTab(id);
    setMobileDrawerOpen(false);
  };

  // 커스텀 훅 사용
  const { data, setData, isLoading, loadFailed, clearLoadFailed, setManualBackupFlag, saveNow } = useAppData();
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
  } = useBackup(data, setManualBackupFlag);
  const { isLoadingTickerDatabase, handleLoadInitialTickers } = useTickerDatabase(data, setDataWithHistory);

  // 키보드 단축키
  useKeyboardShortcuts({
    tab,
    setTab,
    onUndo: () => {
      if (handleUndo()) {
        toast.success("실행 취소됨", { id: "undo" });
      }
    },
    onRedo: () => {
      if (handleRedo()) {
        toast.success("다시 실행됨", { id: "redo" });
      }
    },
    onSearch: () => setIsSearchOpen(true),
    onShortcutsHelp: () => setShowShortcutsHelp((prev) => !prev),
    onSave: () => {
      saveNow();
      toast.success("저장됨", { id: "save" });
    },
    onAddLedger: () => {
      setTab("ledger");
      window.dispatchEvent(new CustomEvent("farmwallet:focus-ledger-form"));
    }
  });


  const balances = useMemo(
    () => computeAccountBalances(data.accounts, data.ledger, data.trades),
    [data.accounts, data.ledger, data.trades]
  );
  // USD 주식 가격을 KRW로 변환
  const adjustedPrices = useMemo(() => {
    if (!fxRate) return data.prices;
    
    return data.prices.map((p) => {
      if (p.currency && p.currency !== "KRW" && p.currency === "USD") {
        return { ...p, price: p.price * fxRate, currency: "KRW" };
      }
      return p;
    });
  }, [data.prices, fxRate]);

  const positions = useMemo(
    () => computePositions(data.trades, adjustedPrices, data.accounts, { fxRate: fxRate ?? undefined }),
    [data.trades, adjustedPrices, data.accounts, fxRate]
  );

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
        <p style={{ color: "var(--danger)", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>데이터를 불러오지 못했습니다</p>
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
      <Toaster position="bottom-center" toastOptions={{
        style: {
          background: 'var(--surface)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
        }
      }} />
      <header className="app-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
          <p className="subtitle">자산 · 주식 관리</p>
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
              <div className="pill muted">백업 기록이 아직 없습니다</div>
            )}
          </div>
          {backupWarning && (
            <div className={`pill ${backupWarning.type === "critical" ? "warning" : "muted"}`}>
              {backupWarning.message}
            </div>
          )}
          {backupIntegrity.status === "valid" && <div className="pill success">최근 로컬 백업 무결성 확인됨 (SHA-256)</div>}
          {backupIntegrity.status === "missing-hash" && (
            <div className="pill warning">이전 백업에 해시가 없어 무결성 확인 불가 (새로 백업 권장)</div>
          )}
          {backupIntegrity.status === "mismatch" && (
            <div className="pill danger">최근 로컬 백업 해시 불일치! 새 백업을 다시 생성하세요</div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="primary"
              onClick={handleManualBackup}
            >
              백업 스냅샷 저장
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setIsSearchOpen(true)}
            >
              🔍 전역 검색
            </button>
          </div>
        </div>
      </header>

          <div className="layout">
            <aside className="sidebar" role="navigation" aria-label="주 메뉴">
              <Tabs active={tab} onChange={handleTabChange} tabBadges={settingsTabBadge ? { settings: settingsTabBadge } : undefined} />
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
                      ✕
                    </button>
                  </div>
                  <Tabs active={tab} onChange={handleTabChange} tabBadges={settingsTabBadge ? { settings: settingsTabBadge } : undefined} />
                </div>
              </>
            )}
            <main className="app-main" role="main">
          <Suspense fallback={<div className="card" style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>로딩 중...</div>}>
          {tab === "dashboard" && (
            <DashboardView
              accounts={data.accounts}
              ledger={data.ledger}
              trades={data.trades}
              prices={data.prices}
              categoryPresets={data.categoryPresets}
              targetPortfolios={data.targetPortfolios ?? []}
              budgets={data.budgetGoals ?? []}
            />
          )}
          {tab === "accounts" && (
            <AccountsView
              accounts={data.accounts}
              balances={balances}
              positions={positions}
              ledger={data.ledger}
              onChangeAccounts={(accounts) => setDataWithHistory({ ...data, accounts })}
              onRenameAccountId={handleRenameAccountId}
            />
          )}
          {tab === "ledger" && (
            <LedgerView
              accounts={data.accounts}
              ledger={data.ledger}
              categoryPresets={data.categoryPresets}
              onChangeLedger={(ledger) => setDataWithHistory({ ...data, ledger })}
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
              tickerDatabase={data.tickerDatabase ?? []}
              highlightTradeId={highlightTradeId}
              onClearHighlightTrade={() => setHighlightTradeId(null)}
              onChangeTrades={(trades) => setDataWithHistory((prev) => ({ 
                ...prev, 
                trades: typeof trades === "function" ? trades(prev.trades) : trades 
              }))}
              onChangePrices={(prices) => setDataWithHistory({ ...data, prices })}
              onChangeCustomSymbols={(customSymbols) => setDataWithHistory({ ...data, customSymbols })}
              onChangeTickerDatabase={(tickerDatabase) => setDataWithHistory({ ...data, tickerDatabase })}
              onLoadInitialTickers={handleLoadInitialTickers}
              isLoadingTickerDatabase={isLoadingTickerDatabase}
              presets={data.stockPresets}
              onChangePresets={(stockPresets) => setDataWithHistory({ ...data, stockPresets })}
              ledger={data.ledger}
              onChangeLedger={(ledger) => setDataWithHistory({ ...data, ledger })}
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
              tickerDatabase={data.tickerDatabase ?? []}
              onChangeLedger={(ledger) => setDataWithHistory({ ...data, ledger })}
              fxRate={fxRate}
            />
          )}
          {tab === "debt" && (
            <DebtView
              loans={data.loans}
              ledger={data.ledger}
              onChangeLoans={(loans) => setDataWithHistory({ ...data, loans })}
            />
          )}
          {tab === "budget" && (
            <BudgetRecurringView
              accounts={data.accounts}
              recurring={data.recurringExpenses}
              budgets={data.budgetGoals}
              ledger={data.ledger}
              onChangeRecurring={(recurringExpenses) => setDataWithHistory({ ...data, recurringExpenses })}
              onChangeBudgets={(budgetGoals) => setDataWithHistory({ ...data, budgetGoals })}
              onChangeLedger={(ledger) => setDataWithHistory({ ...data, ledger })}
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
              onChangeWorkoutWeeks={(workoutWeeks) => setDataWithHistory({ ...data, workoutWeeks })}
            />
          )}
          {tab === "settings" && (
            <SettingsView
              data={data}
              backupVersion={backupVersion}
              onBackupRestored={clearLoadFailed}
              onChangeData={(next) => {
                setDataWithHistory(next);
                toast.success("데이터가 업데이트되었습니다.");
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
