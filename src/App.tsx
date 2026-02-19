import React, { useMemo, useState } from "react";
import { Toaster, toast } from "react-hot-toast";
import { Moon, Sun } from "lucide-react";
import { Tabs, type TabId } from "./components/Tabs";
import { AccountsView } from "./components/AccountsView";
import { LedgerView } from "./components/LedgerView";
import { DashboardView } from "./components/DashboardView";
import { DividendsView } from "./components/DividendsView";
import { DebtView } from "./components/DebtView";
import { StocksView } from "./components/StocksView";
import { BudgetRecurringView } from "./components/BudgetRecurringView";
import { SettingsView } from "./components/SettingsView";
import { CategoriesView } from "./components/CategoriesView";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { ReportView } from "./components/ReportView";
import { SearchModal } from "./components/SearchModal";
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

export const App: React.FC = () => {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [copyRequest, setCopyRequest] = useState<import("./types").LedgerEntry | null>(null);

  // 커스텀 훅 사용
  const { data, setData, setManualBackupFlag } = useAppData();
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
    onShortcutsHelp: () => setShowShortcutsHelp((prev) => !prev)
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
    () => computePositions(data.trades, adjustedPrices, data.accounts),
    [data.trades, adjustedPrices, data.accounts]
  );
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
        <div>
          <h1>FarmWallet <span style={{ fontSize: "0.6em", fontWeight: "normal", color: "var(--text-muted)", marginLeft: "8px" }}>v{APP_VERSION}</span></h1>
          <p className="subtitle">자산 · 주식 관리</p>
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
              <Tabs active={tab} onChange={setTab} />
            </aside>
            <main className="app-main" role="main">
          {tab === "dashboard" && (
            <DashboardView
              accounts={data.accounts}
              ledger={data.ledger}
              trades={data.trades}
              prices={data.prices}
              categoryPresets={data.categoryPresets}
              targetPortfolios={data.targetPortfolios ?? []}
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
          {tab === "settings" && (
            <SettingsView
              data={data}
              backupVersion={backupVersion}
              onChangeData={(next) => {
                setDataWithHistory(next);
                toast.success("데이터가 업데이트되었습니다.");
              }}
            />
          )}
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
      />

      <ShortcutsHelp isOpen={showShortcutsHelp} onClose={() => setShowShortcutsHelp(false)} />
    </div>
  );
};
