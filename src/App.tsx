import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  fetchServerData,
  getAllBackupList,
  getLatestLocalBackupIntegrity,
  loadData,
  saveData,
  saveBackupSnapshot,
  loadTickerDatabaseFromBackup,
  saveTickerDatabaseBackup
} from "./storage";
import type { AppData } from "./types";
import { computeAccountBalances, computePositions } from "./calculations";
import { buildInitialTickerDatabase, fetchYahooQuotes } from "./yahooFinanceApi";

const TAB_ORDER: TabId[] = [
  "dashboard",
  "accounts",
  "ledger",
  "stocks",
  "dividends",
  "debt",
  "budget",
  "categories",
  "settings"
];

export const App: React.FC = () => {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [data, setData] = useState<AppData>(() => loadData());
  const [latestBackupAt, setLatestBackupAt] = useState<string | null>(null);
  const [backupVersion, setBackupVersion] = useState<number>(0);
  const [backupIntegrity, setBackupIntegrity] = useState<{
    createdAt: string | null;
    status: "valid" | "missing-hash" | "mismatch" | "none";
  }>({ createdAt: null, status: "none" });
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState<{
    keyword: string;
    minAmount?: number;
    maxAmount?: number;
    includeLedger: boolean;
    includeTrades: boolean;
  }>({ keyword: "", includeLedger: true, includeTrades: true });
  const [isLoadingTickerDatabase, setIsLoadingTickerDatabase] = useState(false);
  const [savedFilters, setSavedFilters] = useState<
    { id: string; name: string; query: typeof searchQuery }[]
  >([]);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [fxRate, setFxRate] = useState<number | null>(null);
  
  // 실행 취소/다시 실행을 위한 히스토리
  const undoStackRef = useRef<AppData[]>([]);
  const redoStackRef = useRef<AppData[]>([]);
  const isUndoRedoRef = useRef(false);

  // 테마 초기화
  useEffect(() => {
    const saved = localStorage.getItem("fw-theme") as "light" | "dark" | null;
    if (saved) {
      setTheme(saved);
      document.documentElement.classList.toggle("dark", saved === "dark");
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
      document.documentElement.classList.add("dark");
    }
  }, []);

  // 환율 가져오기
  useEffect(() => {
    const updateFxRate = async () => {
      try {
        const res = await fetchYahooQuotes(["USDKRW=X"]);
        const r = res[0];
        if (r?.price) {
          setFxRate(r.price);
        }
      } catch (err) {
        console.warn("FX fetch failed", err);
      }
    };
    updateFxRate();
    // 1시간마다 환율 업데이트
    const interval = setInterval(updateFxRate, 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("fw-theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
  };

  const refreshLatestBackup = useCallback(async () => {
    const list = await getAllBackupList();
    const latest = list[0];
    setLatestBackupAt(latest?.createdAt ?? null);
    const integrity = await getLatestLocalBackupIntegrity();
    setBackupIntegrity(integrity);
    setBackupVersion(Date.now());
  }, []);

  // Saved filters 로드
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("fw-saved-filters");
      if (raw) {
        const parsed = JSON.parse(raw) as { id: string; name: string; query: typeof searchQuery }[];
        setSavedFilters(parsed);
      }
    } catch {
      //
    }
  }, []);

  // 데이터 변경 시 히스토리에 저장 (실행 취소/다시 실행용)
  const setDataWithHistory = useCallback((newData: AppData | ((prev: AppData) => AppData)) => {
    if (isUndoRedoRef.current) {
      // 실행 취소/다시 실행 중에는 히스토리에 저장하지 않음
      setData(newData);
      return;
    }
    
    setData((prev) => {
      const next = typeof newData === "function" ? newData(prev) : newData;
      // 이전 상태를 undo 스택에 저장
      undoStackRef.current.push(prev);
      // 최대 20개까지만 저장
      if (undoStackRef.current.length > 20) {
        undoStackRef.current.shift();
      }
      // redo 스택 초기화
      redoStackRef.current = [];
      return next;
    });
  }, []);

  // 실행 취소
  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const prevData = undoStackRef.current.pop()!;
    isUndoRedoRef.current = true;
    redoStackRef.current.push(data);
    setData(prevData);
    toast.success("실행 취소됨", { id: "undo" });
    setTimeout(() => {
      isUndoRedoRef.current = false;
    }, 0);
  }, [data]);

  // 다시 실행
  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const nextData = redoStackRef.current.pop()!;
    isUndoRedoRef.current = true;
    undoStackRef.current.push(data);
    setData(nextData);
    toast.success("다시 실행됨", { id: "redo" });
    setTimeout(() => {
      isUndoRedoRef.current = false;
    }, 0);
  }, [data]);

  // Alt+화살표로 탭 이동
  const navigateTab = useCallback((direction: "prev" | "next") => {
    const currentIndex = TAB_ORDER.indexOf(tab);
    if (currentIndex === -1) return;
    
    const nextIndex = direction === "prev" 
      ? (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length
      : (currentIndex + 1) % TAB_ORDER.length;
    
    setTab(TAB_ORDER[nextIndex]);
  }, [tab]);

  // 전역 키보드 이벤트 리스너
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Z (실행 취소)
      if (e.ctrlKey && e.key === "z" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        handleUndo();
        return;
      }
      
      // Ctrl+Y 또는 Ctrl+Shift+Z (다시 실행)
      if ((e.ctrlKey && e.key === "y") || (e.ctrlKey && e.shiftKey && e.key === "z")) {
        e.preventDefault();
        handleRedo();
        return;
      }
      
      // Ctrl+S (빠른 저장)
      if (e.ctrlKey && e.key === "s" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        handleManualBackup();
        return;
      }
      
      // Ctrl+F (전역 검색)
      if (e.ctrlKey && e.key === "f" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setIsSearchOpen(true);
        return;
      }
      
      // Ctrl+N (새 항목 추가 - 현재 탭에 따라 다르게 동작)
      if (e.ctrlKey && e.key === "n" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        // 현재 탭에 따라 새 항목 추가 로직은 각 뷰에서 처리
        toast.success("새 항목 추가는 각 탭에서 버튼을 사용하세요", { duration: 2000 });
        return;
      }
      
      // Esc (모달 닫기)
      if (e.key === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        if (isSearchOpen) {
          setIsSearchOpen(false);
        }
        return;
      }
      
      // Alt+화살표 (탭 이동)
      if (e.altKey && !e.ctrlKey && !e.shiftKey) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          navigateTab("prev");
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          navigateTab("next");
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleUndo, handleRedo, navigateTab, isSearchOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    fetchServerData().then((serverData) => {
      if (serverData) {
        setDataWithHistory((prev) => ({
          ...prev,
          ...serverData,
          customSymbols: serverData.customSymbols ?? prev.customSymbols ?? [],
          usTickers: serverData.usTickers ?? prev.usTickers,
          tickerDatabase: serverData.tickerDatabase ?? prev.tickerDatabase ?? []
        }));
        toast.success("서버 데이터 동기화 완료");
      }
    });
    void refreshLatestBackup();
  }, [refreshLatestBackup, setDataWithHistory]);

  // 초기 티커 목록 로드 (localStorage와 백업에서만 로드, 자동 생성하지 않음)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (data.tickerDatabase && data.tickerDatabase.length > 0) return; // 이미 있으면 스킵
    
    let isMounted = true;
    const loadTickerDb = async () => {
      // 1) backups/ticker-latest.json 시도
      try {
        const backupTickers = await loadTickerDatabaseFromBackup();
        if (isMounted && backupTickers && backupTickers.length > 0) {
          setDataWithHistory((prev) => ({ ...prev, tickerDatabase: backupTickers }));
          localStorage.setItem("ticker", JSON.stringify(backupTickers));
          return;
        }
      } catch (err) {
        console.warn("티커 백업 파일 로드 실패:", err);
      }

      // 2) localStorage 확인
      const stored = localStorage.getItem("ticker");
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            if (isMounted) setDataWithHistory((prev) => ({ ...prev, tickerDatabase: parsed }));
            return;
          }
        } catch (err) {
          console.error("저장된 티커 목록 파싱 실패:", err);
        }
      }
      // 3) 없으면 빈 배열로 두고 사용자가 수동으로 "종목 불러오기" 버튼을 눌러야 함
    };

    void loadTickerDb();
    return () => {
      isMounted = false;
    };
  }, [data.tickerDatabase, setDataWithHistory]);

  // 수동으로 초기 티커 목록 생성하는 함수
  const handleLoadInitialTickers = useCallback(async () => {
    setIsLoadingTickerDatabase(true);
    const toastId = toast.loading("티커 데이터베이스 생성 중...");
    try {
      const tickers = await buildInitialTickerDatabase();
      const updatedData = { ...data, tickerDatabase: tickers };
      setDataWithHistory(updatedData);
      saveData(updatedData); // 명시적으로 저장
      localStorage.setItem("ticker", JSON.stringify(tickers)); // 별도 백업 (호환성 유지)
      await saveTickerDatabaseBackup(tickers); // 서버 백업 파일 저장
      toast.success(`티커 데이터베이스 생성 완료 (${tickers.length}개)`, { id: toastId });
    } catch (err) {
      console.error("초기 티커 목록 생성 실패:", err);
      toast.error("티커 데이터베이스 생성 실패", { id: toastId });
    } finally {
      setIsLoadingTickerDatabase(false);
    }
  }, [setDataWithHistory, data]);

  const handleManualBackup = async () => {
    const toastId = toast.loading("백업 저장 중...");
    try {
      // 백업 전에는 즉시 저장
      const { saveDataImmediate } = await import("./storage");
      saveDataImmediate(data);
      await saveBackupSnapshot(data);
      await refreshLatestBackup();
      toast.success("백업 스냅샷 저장 완료", { id: toastId });
    } catch (err) {
      toast.error("백업 저장 실패", { id: toastId });
    }
  };

  const unifiedRecords = useMemo(() => {
    const ledgerRecords = data.ledger.map((l) => ({
      type: "ledger" as const,
      id: l.id,
      date: l.date,
      title: l.description || l.category || l.kind,
      amount: l.amount,
      meta: `${l.kind} ${l.category ?? ""} ${l.subCategory ?? ""} ${l.description ?? ""}`.toLowerCase(),
      accounts: [l.fromAccountId, l.toAccountId].filter(Boolean).join(" / "),
      ticker: "",
      accountId: l.toAccountId || l.fromAccountId || ""
    }));
    const tradeRecords = data.trades.map((t) => ({
      type: "trade" as const,
      id: t.id,
      date: t.date,
      title: `${t.ticker} ${t.name ?? ""} ${t.side === "buy" ? "매수" : "매도"}`,
      amount: t.totalAmount,
      meta: `${t.ticker} ${t.name ?? ""} ${t.side}`.toLowerCase(),
      accounts: t.accountId,
      ticker: t.ticker,
      accountId: t.accountId
    }));
    return [...ledgerRecords, ...tradeRecords].sort((a, b) => b.date.localeCompare(a.date));
  }, [data.ledger, data.trades]);

  const filteredSearchResults = useMemo(() => {
    const { keyword, minAmount, maxAmount, includeLedger, includeTrades } = searchQuery;
    const key = keyword.trim().toLowerCase();
    return unifiedRecords.filter((r) => {
      if (r.type === "ledger" && !includeLedger) return false;
      if (r.type === "trade" && !includeTrades) return false;
      if (key) {
        const hay = `${r.title} ${r.meta} ${r.accounts}`.toLowerCase();
        if (!hay.includes(key)) return false;
      }
      if (minAmount != null && r.amount < minAmount) return false;
      if (maxAmount != null && r.amount > maxAmount) return false;
      return true;
    });
  }, [searchQuery, unifiedRecords]);

  const saveCurrentFilter = (name: string) => {
    if (!name.trim()) return;
    const entry = { id: `F${Date.now()}`, name: name.trim(), query: searchQuery };
    const next = [entry, ...savedFilters].slice(0, 10);
    setSavedFilters(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("fw-saved-filters", JSON.stringify(next));
      toast.success("필터 저장됨");
    }
  };

  const applySavedFilter = (id: string) => {
    const found = savedFilters.find((f) => f.id === id);
    if (!found) return;
    setSearchQuery(found.query);
    setIsSearchOpen(true);
    toast.success(`'${found.name}' 필터 적용`);
  };

  const deleteSavedFilter = (id: string) => {
    const next = savedFilters.filter((f) => f.id !== id);
    setSavedFilters(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("fw-saved-filters", JSON.stringify(next));
      toast.success("필터 삭제됨");
    }
  };

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
          <h1>FarmWallet</h1>
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
          {latestBackupAt && (() => {
            const diffHours = (Date.now() - new Date(latestBackupAt).getTime()) / 36e5;
            if (diffHours >= 24) {
              return <div className="pill warning">24시간 이상 백업 없음 • 지금 백업하세요</div>;
            }
            if (diffHours >= 12) {
              return <div className="pill muted">12시간 경과 • 필요 시 백업</div>;
            }
            return null;
          })()}
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
        <aside className="sidebar">
          <Tabs active={tab} onChange={setTab} />
        </aside>
        <main className="app-main">
          {tab === "dashboard" && (
            <DashboardView
              accounts={data.accounts}
              ledger={data.ledger}
              trades={data.trades}
              prices={data.prices}
              loans={data.loans}
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
              templates={data.ledgerTemplates}
              onChangeTemplates={(ledgerTemplates) => setDataWithHistory({ ...data, ledgerTemplates })}
            />
          )}
          {tab === "categories" && (
            <CategoriesView
              presets={data.categoryPresets}
              onChangePresets={(categoryPresets) => setDataWithHistory({ ...data, categoryPresets })}
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
              onChangeTrades={(trades) => setDataWithHistory({ ...data, trades })}
              onChangePrices={(prices) => setDataWithHistory({ ...data, prices })}
              onChangeCustomSymbols={(customSymbols) => setDataWithHistory({ ...data, customSymbols })}
              onChangeTickerDatabase={(tickerDatabase) => setDataWithHistory({ ...data, tickerDatabase })}
              onLoadInitialTickers={handleLoadInitialTickers}
              isLoadingTickerDatabase={isLoadingTickerDatabase}
              presets={data.stockPresets}
              onChangePresets={(stockPresets) => setDataWithHistory({ ...data, stockPresets })}
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

      {isSearchOpen && (
        <div className="modal-backdrop" onClick={() => setIsSearchOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ margin: 0 }}>전역 검색</h3>
              <button type="button" className="secondary" onClick={() => setIsSearchOpen(false)}>
                닫기
              </button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <label>
                  <span>키워드 (티커/메모/계좌/카테고리)</span>
                  <input
                    type="text"
                    value={searchQuery.keyword}
                    onChange={(e) => setSearchQuery((prev) => ({ ...prev, keyword: e.target.value }))}
                    placeholder="예: 삼성전자, 식비, CHK_KB"
                  />
                </label>
                <label>
                  <span>최소 금액</span>
                  <input
                    type="number"
                    value={searchQuery.minAmount ?? ""}
                    onChange={(e) =>
                      setSearchQuery((prev) => ({
                        ...prev,
                        minAmount: e.target.value ? Number(e.target.value) : undefined
                      }))
                    }
                    placeholder="0"
                  />
                </label>
                <label>
                  <span>최대 금액</span>
                  <input
                    type="number"
                    value={searchQuery.maxAmount ?? ""}
                    onChange={(e) =>
                      setSearchQuery((prev) => ({
                        ...prev,
                        maxAmount: e.target.value ? Number(e.target.value) : undefined
                      }))
                    }
                    placeholder="무제한"
                  />
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={searchQuery.includeLedger}
                    onChange={(e) => setSearchQuery((prev) => ({ ...prev, includeLedger: e.target.checked }))}
                  />
                  <span>가계부 포함</span>
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={searchQuery.includeTrades}
                    onChange={(e) => setSearchQuery((prev) => ({ ...prev, includeTrades: e.target.checked }))}
                  />
                  <span>주식 거래 포함</span>
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
                <input
                  type="text"
                  placeholder="필터 이름 저장"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      saveCurrentFilter((e.target as HTMLInputElement).value);
                      (e.target as HTMLInputElement).value = "";
                    }
                  }}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const input = (document.activeElement as HTMLInputElement);
                    if (input && input.value) {
                      saveCurrentFilter(input.value);
                      input.value = "";
                    }
                  }}
                >
                  뷰 저장
                </button>
              </div>

              {savedFilters.length > 0 && (
                <div className="saved-filters">
                  {savedFilters.map((f) => (
                    <div key={f.id} className="saved-filter-item">
                      <span style={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => applySavedFilter(f.id)}>
                        {f.name}
                      </span>
                      <button type="button" className="link" onClick={() => deleteSavedFilter(f.id)}>
                        삭제
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="search-results" style={{ maxHeight: 320, overflow: "auto", marginTop: 8 }}>
                {filteredSearchResults.length === 0 && <p className="hint">검색 결과가 없습니다.</p>}
                {filteredSearchResults.map((r) => (
                  <div key={r.id} className="search-row">
                    <div className="search-row-title">
                      <span className={`pill ${r.type === "trade" ? "muted" : ""}`} style={{ padding: "3px 8px", fontSize: 11 }}>
                        {r.type === "trade" ? "거래" : "가계부"}
                      </span>
                      <strong>{r.title}</strong>
                    </div>
                    <div className="search-row-meta">
                      <span>{r.date}</span>
                      <span>{r.accounts || r.accountId}</span>
                      <span>{Math.round(r.amount).toLocaleString()} 원</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
