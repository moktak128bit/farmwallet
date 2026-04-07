import React, { useEffect, useMemo, useState, useRef, useCallback, useDeferredValue } from "react";
import { Autocomplete } from "../components/ui/Autocomplete";
import type { Account, AccountBalanceRow, CategoryPresets, ExpenseDetailGroup, LedgerEntry, LedgerKind, LedgerTemplate, StockTrade } from "../types";
import { formatShortDate, formatUSD, formatKRW } from "../utils/formatter";
import { shortcutManager, type ShortcutAction } from "../utils/shortcuts";
import { validateDate, validateRequired, validateTransfer, validateAccountExists } from "../utils/validation";
import { isSavingsExpenseEntry } from "../utils/category";
import { getKoreaTime, getTodayKST, getThisMonthKST } from "../utils/date";
import { toast } from "react-hot-toast";
import { ERROR_MESSAGES } from "../constants/errorMessages";
import { STORAGE_KEYS } from "../constants/config";
import { computeRealizedPnlByTradeId } from "../calculations";
import { isUSDStock } from "../utils/finance";

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  balances?: AccountBalanceRow[];
  trades?: StockTrade[];
  categoryPresets: CategoryPresets;
  ledgerTemplates?: LedgerTemplate[];
  onChangeLedger: (next: LedgerEntry[]) => void;
  onChangeTemplates?: (next: LedgerTemplate[]) => void;
  copyRequest?: LedgerEntry | null;
  onCopyComplete?: () => void;
  highlightLedgerId?: string | null;
  onClearHighlightLedger?: () => void;
}

const KIND_LABEL: Record<LedgerKind, string> = {
  income: "수입",
  expense: "지출",
  transfer: "이체"
};

type LedgerTab = "all" | "income" | "expense" | "savingsExpense" | "transfer" | "creditPayment";

/** 기록표: 수입·지출은 할인 전 금액 = 순액 + 할인. 이체 등은 amount만. */
function ledgerEntryGross(l: Pick<LedgerEntry, "kind" | "amount" | "discountAmount">): number {
  if (l.kind === "income" || l.kind === "expense") {
    return l.amount + (l.discountAmount ?? 0);
  }
  return l.amount;
}

/** 가계부에 표시하는 한 행: ledger 항목 또는 주식 거래를 ledger 형태로 만든 것 */
export type LedgerDisplayRow = LedgerEntry & { _tradeId?: string };

function tradeToLedgerRow(t: StockTrade, realizedPnlByTradeId: Map<string, number>): LedgerDisplayRow {
  const isSell = t.side === "sell";
  const isUsd = isUSDStock(t.ticker);
  const priceStr = isUsd ? `${formatUSD(t.price)}` : `${formatKRW(Math.round(t.price))}`;
  const qty = t.quantity % 1 === 0 ? String(t.quantity) : t.quantity.toFixed(2);
  const label = t.name ? `${t.ticker} ${t.name}` : t.ticker;
  const action = isSell ? "매도" : "매수";
  const description = `${label} ${qty}주 ${priceStr}에 ${action}`;
  const rawPnl = isSell ? (realizedPnlByTradeId.get(t.id) ?? t.totalAmount) : t.totalAmount;
  if (isSell) {
    const isProfit = rawPnl >= 0;
    return {
      id: `trade-${t.id}`,
      date: t.date,
      kind: "expense",
      category: "재테크",
      subCategory: isProfit ? "투자수익" : "투자손실",
      description,
      amount: Math.abs(rawPnl),
      toAccountId: isProfit ? t.accountId : undefined,
      fromAccountId: isProfit ? undefined : t.accountId,
      currency: isUsd ? "USD" : "KRW",
      _tradeId: t.id
    };
  }
  return {
    id: `trade-${t.id}`,
    date: t.date,
    kind: "expense",
    category: "재테크",
    subCategory: "주식매수",
    description,
    amount: Math.abs(rawPnl),
    fromAccountId: t.accountId,
    toAccountId: undefined,
    currency: isUsd ? "USD" : "KRW",
    _tradeId: t.id
  };
}

function createDefaultForm(): {
  id?: string;
  date: string;
  kind: LedgerKind;
  isFixedExpense: boolean;
  mainCategory: string;
  subCategory: string;
  description: string;
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  discountAmount: string;
  currency: "KRW" | "USD";
  tags: string[];
} {
  return {
    id: undefined,
    date: getTodayKST(),
    kind: "income",
    isFixedExpense: false,
    mainCategory: "",
    subCategory: "",
    description: "",
    fromAccountId: "",
    toAccountId: "",
    amount: "",
    discountAmount: "",
    currency: "KRW",
    tags: []
  };
}

export const LedgerView: React.FC<Props> = ({
  accounts,
  ledger,
  balances = [],
  trades = [],
  categoryPresets,
  ledgerTemplates = [],
  onChangeLedger,
  onChangeTemplates,
  copyRequest,
  onCopyComplete,
  highlightLedgerId,
  onClearHighlightLedger
}) => {
  const deferredLedger = useDeferredValue(ledger);
  const deferredTrades = useDeferredValue(trades);
  const [form, setForm] = useState(createDefaultForm);
  // 기본값을 월별 보기로 설정하여 성능 최적화
  const [viewMode, setViewMode] = useState<"all" | "monthly">("monthly");
  const ledgerScrollRef = useRef<HTMLDivElement>(null);
  const ledgerTableRef = useRef<HTMLTableElement>(null);
  const [ledgerTab, setLedgerTab] = useState<LedgerTab>("all");
  const [formKindWhenAll, setFormKindWhenAll] = useState<"income"|"expense"|"savingsExpense"|"transfer"|"creditPayment">("expense");
  const effectiveFormKind = ledgerTab === "all" ? formKindWhenAll : ledgerTab;
  // 저축성 지출 = 지출(expense)로만 저장. 이체 = transfer만.
  const kindForTab: LedgerKind = useMemo(
    () =>
      effectiveFormKind === "income"
        ? "income"
        : effectiveFormKind === "transfer"
          ? "transfer"
          : effectiveFormKind === "creditPayment"
            ? "expense"
            : "expense",
    [effectiveFormKind]
  );
  const isCopyingRef = useRef(false);
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(() => new Set([getThisMonthKST()]));
  const [currentYear, setCurrentYear] = useState(() => String(getKoreaTime().getFullYear()));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<{ id: string; field: string } | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const [filterMainCategory, setFilterMainCategory] = useState<string | undefined>();
  const [filterSubCategory, setFilterSubCategory] = useState<string | undefined>();
  const [filterDetailCategory, setFilterDetailCategory] = useState<string | undefined>();
  const [filterFromAccountId, setFilterFromAccountId] = useState<string | undefined>();
  const [filterToAccountId, setFilterToAccountId] = useState<string | undefined>();
  /** 계좌별 보기: null = 전체, 값 있으면 from/to 중 하나라도 해당 계좌인 항목만 */
  const [filterAccountId, setFilterAccountId] = useState<string | null>(null);
  const [filterAmountMin, setFilterAmountMin] = useState<number | undefined>();
  const [filterAmountMax, setFilterAmountMax] = useState<number | undefined>();
  const [filterTagsInput, setFilterTagsInput] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  // 페이지네이션 상태
  const [listPage, setListPage] = useState(0);
  const PAGE_SIZE = 50;
  // 폼 확장/축소 상태 (progressive disclosure)
  const [formExpanded, setFormExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem("fw-ledger-form-expanded") === "true"; } catch { return false; }
  });
  // 정렬 상태
  type LedgerSortKey =
    | "date"
    | "category"
    | "subCategory"
    | "detailCategory"
    | "description"
    | "fromAccountId"
    | "toAccountId"
    | "amount"
    | "grossAmount"
    | "discountAmount";
  const [ledgerSort, setLedgerSort] = useState<{ key: LedgerSortKey; direction: "asc" | "desc" }>({
    key: "date",
    direction: "desc"
  });
  const [lastAddedEntryId, setLastAddedEntryId] = useState<string | null>(null);
  
  // 컬럼 너비 상태 (localStorage에서 로드; 10개 = 데이터 9 + 작업 1: 할인 전·할인·최종)
  const [columnWidths, setColumnWidths] = useState<number[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("ledger-column-widths");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const normalize = (arr: number[]) => {
              const t = arr.reduce((sum, w) => sum + w, 0);
              return t > 0 ? arr.map((w) => w * (100 / t)) : arr;
            };
            let w = [...parsed];
            // 아주 옛 10열(앞 2칸 순서·구분)만 제거
            if (w.length === 10 && w[0] < 6 && w[1] < 6) {
              w = w.slice(2);
            }
            if (w.length === 8) {
              w = [...w.slice(0, 7), 6, w[7]];
              w = normalize(w);
            }
            if (w.length === 9) {
              w = [...w.slice(0, 8), 9, w[8]];
              w = normalize(w);
            }
            // 10열(소분류 없음) → 11열(소분류 추가)
            if (w.length === 10) {
              w = [...w.slice(0, 3), w[2], ...w.slice(3)];
              w = normalize(w);
            }
            if (w.length === 11) {
              return normalize(w);
            }
          }
        } catch (e) {
          // 파싱 실패 시 기본값 사용
        }
      }
    }
    // 날짜, 대분류, 중분류, 소분류, 상세내역, 출금, 입금, 할인 전, 할인, 최종, 작업
    return [8, 9, 9, 9, 19, 9, 9, 9, 5, 8, 9];
  });
  const [resizingColumn, setResizingColumn] = useState<number | null>(null);
  const [liveColumnWidths, setLiveColumnWidths] = useState<number[] | null>(null);
  const resizeStartRef = useRef<{ x: number; width: number; widths: number[] }>({ x: 0, width: 0, widths: [] });

  const widthsForRender =
    resizingColumn !== null && liveColumnWidths && liveColumnWidths.length === 11 ? liveColumnWidths : columnWidths;

  // 폼 검증 오류는 validateForm useMemo에서 직접 계산됨
  
  // 즐겨찾기 카테고리 상태
  const [favoriteCategories, setFavoriteCategories] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("fw-favorite-categories");
        if (saved) return new Set(JSON.parse(saved));
      } catch (e) {
        console.warn("[LedgerView] 즐겨찾기 카테고리 로드 실패", e);
      }
    }
    return new Set();
  });
  
  // 즐겨찾기 계좌 상태
  const [favoriteAccounts, setFavoriteAccounts] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("fw-favorite-accounts");
        if (saved) return new Set(JSON.parse(saved));
      } catch (e) {
        console.warn("[LedgerView] 즐겨찾기 계좌 로드 실패", e);
      }
    }
    return new Set();
  });
  
  // 즐겨찾기 카테고리 목록
  const favoriteCategoryList = useMemo(() => {
    const list = effectiveFormKind === "income"
      ? (categoryPresets?.income ?? [])
      : effectiveFormKind === "transfer"
        ? (categoryPresets?.transfer ?? [])
        : (categoryPresets?.expense ?? []);
    return list.filter((c) => favoriteCategories.has(c));
  }, [effectiveFormKind, categoryPresets, favoriteCategories]);
  
  // 즐겨찾기 계좌 목록
  const favoriteAccountList = useMemo(() => {
    return accounts.filter((a) => favoriteAccounts.has(a.id));
  }, [accounts, favoriteAccounts]);
  
  // 즐겨찾기 카테고리 토글
  const toggleFavoriteCategory = (category: string) => {
    setFavoriteCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      if (typeof window !== "undefined") {
        localStorage.setItem("fw-favorite-categories", JSON.stringify(Array.from(next)));
      }
      return next;
    });
  };
  
  // 즐겨찾기 계좌 토글
  const toggleFavoriteAccount = (accountId: string) => {
    setFavoriteAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      if (typeof window !== "undefined") {
        localStorage.setItem("fw-favorite-accounts", JSON.stringify(Array.from(next)));
      }
      return next;
    });
  };
  
  // 배치 편집 모드 상태
  const [isBatchEditMode, setIsBatchEditMode] = useState(false);
  const [selectedLedgerIds, setSelectedLedgerIds] = useState<Set<string>>(new Set());
  // Ctrl+드래그 구간 선택 / Shift+클릭 추가·제거
  const [selectedLedgerIdsForSum, setSelectedLedgerIdsForSum] = useState<Set<string>>(new Set());
  const [dragSumStartIndex, setDragSumStartIndex] = useState<number | null>(null);
  const [dragSumEndIndex, setDragSumEndIndex] = useState<number | null>(null);
  const dragSumListenersRef = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);
  const dragSumStartRef = useRef<number>(0);
  const dragSumEndRef = useRef<number>(0);

  // 컬럼 너비 변경 시 localStorage에 저장
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("ledger-column-widths", JSON.stringify(columnWidths));
    }
  }, [columnWidths]);

  // 폼 확장 상태 localStorage 동기화
  useEffect(() => {
    try { localStorage.setItem("fw-ledger-form-expanded", String(formExpanded)); } catch {}
  }, [formExpanded]);
  
  // 정렬 함수
  const toggleLedgerSort = (key: LedgerSortKey) => {
    setLedgerSort((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc"
    }));
  };
  
  const sortIndicator = (activeKey: string, key: string, direction: "asc" | "desc") => {
    if (activeKey !== key) return "↕";
    return direction === "asc" ? "↑" : "↓";
  };
  
  // 컬럼 리사이즈: ref에 시작값 고정, 리사이즈 중에는 liveColumnWidths로 표시
  const handleResizeStart = (e: React.MouseEvent | React.PointerEvent, columnIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    const clientX = "clientX" in e ? e.clientX : (e as React.PointerEvent).clientX;
    resizeStartRef.current = {
      x: clientX,
      width: columnWidths[columnIndex],
      widths: [...columnWidths]
    };
    setLiveColumnWidths([...columnWidths]);
    setResizingColumn(columnIndex);
  };

  useEffect(() => {
    if (resizingColumn === null) return;

    const handleMove = (e: MouseEvent | PointerEvent) => {
      const table = ledgerTableRef.current || document.querySelector(".ledger-table") as HTMLElement | null;
      if (!table) return;
      let tableWidth = table.offsetWidth;
      if (tableWidth <= 0) tableWidth = table.getBoundingClientRect().width || (table.parentElement?.clientWidth ?? 0);
      if (tableWidth <= 0) return;

      const { x, width, widths } = resizeStartRef.current;
      if (!widths.length) return;
      const clientX = "clientX" in e ? e.clientX : (e as PointerEvent).clientX;
      const deltaX = clientX - x;
      const deltaPercent = (deltaX / tableWidth) * 100;

      const newWidths = [...widths];
      const newWidth = Math.max(1, Math.min(80, width + deltaPercent));
      newWidths[resizingColumn] = newWidth;

      const total = newWidths.reduce((sum, w) => sum + w, 0);
      if (total <= 0) return;
      const scale = 100 / total;
      const adjustedWidths = newWidths.map((w) => w * scale);

      setLiveColumnWidths(adjustedWidths);
      setColumnWidths(adjustedWidths);
      if (typeof window !== "undefined") {
        localStorage.setItem("ledger-column-widths", JSON.stringify(adjustedWidths));
      }
    };

    const handleUp = () => {
      setResizingColumn(null);
      setLiveColumnWidths(null);
    };

    const opts = { capture: true };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", handleMove as (e: MouseEvent) => void, opts);
    document.addEventListener("mouseup", handleUp, opts);
    document.addEventListener("pointermove", handleMove as (e: PointerEvent) => void, opts);
    document.addEventListener("pointerup", handleUp, opts);
    document.addEventListener("pointercancel", handleUp, opts);
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", handleMove as (e: MouseEvent) => void, opts);
      document.removeEventListener("mouseup", handleUp, opts);
      document.removeEventListener("pointermove", handleMove as (e: PointerEvent) => void, opts);
      document.removeEventListener("pointerup", handleUp, opts);
      document.removeEventListener("pointercancel", handleUp, opts);
    };
  }, [resizingColumn]);

  // 탭 전환 시 필터 초기화
  useEffect(() => {
    setFilterMainCategory(undefined);
    setFilterSubCategory(undefined);
    setFilterFromAccountId(undefined);
    setFilterToAccountId(undefined);
    setFilterAccountId(null);
  }, [ledgerTab]);

  // 이체 탭일 때 form.mainCategory를 "이체"로 설정 (중분류 목록 표시용)
  useEffect(() => {
    if (ledgerTab === "transfer" && form.mainCategory !== "이체") {
      setForm((prev) => ({ ...prev, mainCategory: "이체" }));
    }
  }, [ledgerTab]);

  // 신용결제 탭일 때 mainCategory/subCategory 비우기 (고정값 사용)
  useEffect(() => {
    if (ledgerTab === "creditPayment" && (form.mainCategory || form.subCategory)) {
      setForm((prev) => ({ ...prev, mainCategory: "", subCategory: "" }));
    }
  }, [ledgerTab]);
  
  
  // 최근 사용한 대분류 추적
  const recentMainCategories = useMemo(() => {
    const items = new Map<string, { count: number; lastUsed: string }>();
    ledger
      .filter((l) => l.kind === "expense" && l.category)
      .forEach((l) => {
        const key = l.category || "";
        if (!key) return;
        const existing = items.get(key);
        if (existing) {
          items.set(key, { count: existing.count + 1, lastUsed: l.date > existing.lastUsed ? l.date : existing.lastUsed });
        } else {
          items.set(key, { count: 1, lastUsed: l.date });
        }
      });
    return Array.from(items.entries())
      .sort((a, b) => {
        if (a[1].lastUsed !== b[1].lastUsed) return b[1].lastUsed.localeCompare(a[1].lastUsed);
        return b[1].count - a[1].count;
      })
      .slice(0, 10)
      .map(([key]) => key);
  }, [ledger]);

  // 최근 사용한 중분류 추적 (대분류별)
  const recentSubCategories = useMemo(() => {
    if (!form.mainCategory && effectiveFormKind !== "transfer") return [];
    const items = new Map<string, { count: number; lastUsed: string }>();
    // 이체 탭일 때는 transfer kind의 항목도 포함
    if (effectiveFormKind === "transfer") {
      ledger
        .filter((l) => l.kind === "transfer" && l.category === "이체" && l.subCategory)
        .forEach((l) => {
          const key = l.subCategory || "";
          if (!key) return;
          const existing = items.get(key);
          if (existing) {
            items.set(key, { count: existing.count + 1, lastUsed: l.date > existing.lastUsed ? l.date : existing.lastUsed });
          } else {
            items.set(key, { count: 1, lastUsed: l.date });
          }
        });
    } else {
      ledger
        .filter((l) => l.kind === "expense" && l.category === form.mainCategory && l.subCategory)
        .forEach((l) => {
          const key = l.subCategory || "";
          if (!key) return;
          const existing = items.get(key);
          if (existing) {
            items.set(key, { count: existing.count + 1, lastUsed: l.date > existing.lastUsed ? l.date : existing.lastUsed });
          } else {
            items.set(key, { count: 1, lastUsed: l.date });
          }
        });
    }
    return Array.from(items.entries())
      .sort((a, b) => {
        if (a[1].lastUsed !== b[1].lastUsed) return b[1].lastUsed.localeCompare(a[1].lastUsed);
        return b[1].count - a[1].count;
      })
      .slice(0, 10)
      .map(([key]) => key);
  }, [ledger, form.mainCategory, effectiveFormKind]);

  // 최근 사용한 수입 중분류 추적
  const recentIncomeCategories = useMemo(() => {
    const items = new Map<string, { count: number; lastUsed: string }>();
    ledger
      .filter((l) => l.kind === "income" && (l.subCategory || l.category))
      .forEach((l) => {
        const key = l.subCategory || l.category || "";
        if (!key) return;
        const existing = items.get(key);
        if (existing) {
          items.set(key, { count: existing.count + 1, lastUsed: l.date > existing.lastUsed ? l.date : existing.lastUsed });
        } else {
          items.set(key, { count: 1, lastUsed: l.date });
        }
      });
    return Array.from(items.entries())
      .sort((a, b) => {
        if (a[1].lastUsed !== b[1].lastUsed) return b[1].lastUsed.localeCompare(a[1].lastUsed);
        return b[1].count - a[1].count;
      })
      .slice(0, 10)
      .map(([key]) => key);
  }, [ledger]);
  
  // 최근 사용한 계좌 추적
  const recentAccounts = useMemo(() => {
    const accountMap = new Map<string, { count: number; lastUsed: string }>();
    ledger.forEach((l) => {
      if (l.fromAccountId) {
        const existing = accountMap.get(l.fromAccountId);
        if (existing) {
          accountMap.set(l.fromAccountId, { count: existing.count + 1, lastUsed: l.date > existing.lastUsed ? l.date : existing.lastUsed });
        } else {
          accountMap.set(l.fromAccountId, { count: 1, lastUsed: l.date });
        }
      }
      if (l.toAccountId) {
        const existing = accountMap.get(l.toAccountId);
        if (existing) {
          accountMap.set(l.toAccountId, { count: existing.count + 1, lastUsed: l.date > existing.lastUsed ? l.date : existing.lastUsed });
        } else {
          accountMap.set(l.toAccountId, { count: 1, lastUsed: l.date });
        }
      }
    });
    return Array.from(accountMap.entries())
      .sort((a, b) => {
        if (a[1].lastUsed !== b[1].lastUsed) return b[1].lastUsed.localeCompare(a[1].lastUsed);
        return b[1].count - a[1].count;
      })
      .slice(0, 3)
      .map(([id]) => id);
  }, [ledger]);

  const expenseSubSuggestions = useMemo(() => {
    // 재테크 탭: categoryPresets.expenseDetails의 재테크 그룹 사용 (저축, 투자, 투자수익, 투자손실 등)
    if (effectiveFormKind === "savingsExpense") {
      if (!categoryPresets?.expenseDetails) return ["저축", "투자", "투자수익", "투자손실"];
      const recheck = categoryPresets.expenseDetails.find((g) => g.main === "재테크");
      return (recheck?.subs && recheck.subs.length > 0) ? [...recheck.subs] : ["저축", "투자", "투자수익", "투자손실"];
    }
    // 이체 탭일 때는 transfer 카테고리를 중분류로 사용 (카테고리 탭 순서 그대로)
    if (effectiveFormKind === "transfer" && form.mainCategory === "이체") {
      return categoryPresets.transfer || [];
    }
    
    // 카테고리 프리셋이 제대로 로드되었는지 확인
    if (!categoryPresets || !categoryPresets.expenseDetails) {
      if (import.meta.env.DEV) {
        console.warn("[LedgerView] categoryPresets.expenseDetails가 없습니다.", categoryPresets);
      }
      return [];
    }
    
    const groups: ExpenseDetailGroup[] = categoryPresets.expenseDetails;
    let suggestions: string[] = [];
    
    if (form.mainCategory) {
      // 대분류에 해당하는 그룹 찾기 (정확히 일치하는 것만)
      const g = groups.find((x) => x.main === form.mainCategory);
      if (g && g.subs && Array.isArray(g.subs) && g.subs.length > 0) {
        // 해당 대분류의 중분류를 카테고리 탭 입력 순서 그대로 사용
        suggestions = [...g.subs];
      } else {
        suggestions = [];
        if (import.meta.env.DEV) {
          console.warn(`[LedgerView] 대분류 "${form.mainCategory}"에 해당하는 중분류 그룹을 찾을 수 없습니다.`, {
            availableGroups: groups.map((g) => g.main),
            totalGroups: groups.length,
            categoryPresetsExpenseDetails: categoryPresets.expenseDetails
          });
        }
      }
    } else {
      suggestions = [];
    }
    
    // 중복 제거 (순서 유지)
    const seen = new Set<string>();
    return suggestions.filter((s) => s && s.trim().length > 0 && !seen.has(s) && (seen.add(s), true));
  }, [effectiveFormKind, categoryPresets, categoryPresets?.expenseDetails, categoryPresets?.transfer, form.mainCategory]);

  // 대분류 옵션 (카테고리 탭에서 입력한 순서 그대로)
  const mainCategoryOptions = useMemo(() => {
    if (effectiveFormKind === "transfer") {
      return ["이체"];
    }
    if (effectiveFormKind === "savingsExpense") {
      return ["재테크"];
    }
    if (!categoryPresets || !categoryPresets.expense) {
      if (import.meta.env.DEV) {
        console.warn("[LedgerView] categoryPresets.expense가 없습니다.", categoryPresets);
      }
      return [];
    }
    const list = categoryPresets.expense;
    return effectiveFormKind === "expense"
      ? list.filter((c) => c !== "재테크")
      : list;
  }, [effectiveFormKind, categoryPresets, categoryPresets?.expense]);

  // 수입 중분류 옵션 (카테고리 탭에서 입력한 순서 그대로)
  const incomeCategoryOptions = useMemo(() => {
    return categoryPresets?.income ?? [];
  }, [categoryPresets?.income]);

  // parseAmount와 formatAmount (USD 이체 시 소수점 허용)
  const parseAmount = useCallback((value: string, allowDecimal?: boolean): number => {
    if (allowDecimal) {
      const cleaned = value.replace(/[^\d.]/g, "");
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? 0 : parsed;
    }
    const numeric = value.replace(/[^\d]/g, "");
    if (!numeric) return 0;
    return Number(numeric);
  }, []);

  const formatAmount = useCallback((value: string, allowDecimal?: boolean): string => {
    if (allowDecimal) {
      const cleaned = value.replace(/[^\d.]/g, "");
      if (!cleaned) return "";
      const parts = cleaned.split(".");
      if (parts.length > 1) {
        return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + parts[1].slice(0, 2);
      }
      return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
    const numeric = value.replace(/[^\d]/g, "");
    if (!numeric) return "";
    return Math.round(Number(numeric)).toLocaleString();
  }, []);

  useEffect(() => {
    // 복사 중일 때는 폼을 초기화하지 않음
    if (isCopyingRef.current) {
      // 복사가 완료될 때까지 기다림 - 플래그는 startCopy에서 해제됨
      return;
    }
    setForm((prev) => ({
      ...prev,
      kind: kindForTab,
      isFixedExpense: false,
      mainCategory:
        effectiveFormKind === "savingsExpense" ? "재테크" : effectiveFormKind === "transfer" ? "이체" : "",
      subCategory: "",
      fromAccountId: kindForTab === "income" ? "" : prev.fromAccountId,
      toAccountId: (kindForTab === "expense" && effectiveFormKind !== "creditPayment") ? "" : prev.toAccountId
    }));
  }, [effectiveFormKind, kindForTab]);

  // 실시간 폼 검증
  const validateForm = useMemo(() => {
    const errors: Record<string, string> = {};
    // 날짜 검증
    // 주의: 가계부(Ledger)는 미래 날짜를 제한합니다 (현재 날짜까지만 허용)
    // StocksView와 달리 maxDate를 전달하여 미래 날짜 입력을 방지합니다
    // 한국 시간 기준으로 현재 날짜 계산
    const todayStr = getTodayKST();
    const todayDate = new Date(todayStr + "T00:00:00+09:00"); // 한국 시간 기준
    
    const dateValidation = validateDate(form.date, todayDate); // 미래 날짜 제한
    if (!dateValidation.valid) {
      errors.date = dateValidation.error || "";
    }
    
    // 금액 검증 (USD 이체 시 소수점 허용)
    const allowDecimal = kindForTab === "transfer" && form.currency === "USD";
    const parsedAmount = parseAmount(form.amount, allowDecimal);
    if (parsedAmount <= 0) {
      if (!form.amount || form.amount.trim() === "") {
        errors.amount = "금액을 입력해주세요";
      } else {
        errors.amount = "금액은 0보다 커야 합니다";
      }
    }
    
    // 계좌 검증 (재테크: 투자손실=출금만, 투자수익=입금만, 저축·투자=둘 다)
    // 주의: savingsExpense도 저장 kind는 "expense"라 kindForTab===expense가 항상 참이면 안 됨 → 재테크는 effectiveFormKind로 구분
    const isRecheckLoss = effectiveFormKind === "savingsExpense" && form.subCategory === "투자손실";
    const requireFromAccount =
      kindForTab === "transfer" ||
      effectiveFormKind === "creditPayment" ||
      (kindForTab === "expense" && effectiveFormKind !== "savingsExpense") ||
      (effectiveFormKind === "savingsExpense" && form.subCategory !== "투자수익");
    const requireToAccount = (kindForTab === "income" || kindForTab === "transfer" || effectiveFormKind === "creditPayment") || (effectiveFormKind === "savingsExpense" && !isRecheckLoss);

    if (requireFromAccount) {
      const fromAccountValidation = validateRequired(form.fromAccountId, "출금 계좌");
      if (!fromAccountValidation.valid) {
        errors.fromAccountId = fromAccountValidation.error || "";
      } else {
        const fromExists = validateAccountExists(form.fromAccountId, accounts);
        if (!fromExists.valid) {
          errors.fromAccountId = fromExists.error || "";
        }
      }
    }

    if (requireToAccount) {
      const toAccountValidation = validateRequired(form.toAccountId, effectiveFormKind === "creditPayment" ? "카드" : "입금 계좌");
      if (!toAccountValidation.valid) {
        errors.toAccountId = toAccountValidation.error || "";
      } else {
        const toExists = validateAccountExists(form.toAccountId, accounts);
        if (!toExists.valid) {
          errors.toAccountId = toExists.error || "";
        }
      }
    }
    
    // 이체/신용결제 검증 (출금계좌와 입금계좌가 다른지). 재테크는 같은 계좌 허용
    if (kindForTab === "transfer" || effectiveFormKind === "creditPayment") {
      const transferValidation = validateTransfer(form.fromAccountId, form.toAccountId);
      if (!transferValidation.valid) {
        errors.transfer = transferValidation.error || "";
      }
    }
    
    // 할인 검증 (수입·지출·재테크·신용결제: 금액=할인 전, 저장 시 amount=금액−할인)
    const allowLedgerDiscount =
      effectiveFormKind === "income" ||
      effectiveFormKind === "expense" ||
      effectiveFormKind === "savingsExpense" ||
      effectiveFormKind === "creditPayment";
    if (allowLedgerDiscount && form.discountAmount?.trim()) {
      const discount = parseAmount(form.discountAmount, false);
      if (discount < 0) {
        errors.discountAmount = "할인금액은 0 이상이어야 합니다";
      } else if (effectiveFormKind === "income") {
        if (discount > parsedAmount) {
          errors.discountAmount = "할인은 금액(할인 전)을 넘을 수 없습니다";
        } else if (parsedAmount - discount <= 0) {
          errors.amount = "할인 후 실제 수입액은 0보다 커야 합니다";
        }
      }
      // 지출·재테크·신용결제: 순액 0/음수·할인이 금액 초과 허용(환급·전액 할인 등)
    }
    
    // 대분류/중분류/상세내역 검증 (신용결제는 제외)
    if (effectiveFormKind === "creditPayment") {
      // 신용결제는 mainCategory/subCategory 검증 없음
    } else if (kindForTab === "income") {
      const subCategoryValidation = validateRequired(form.subCategory, "수입 중분류");
      if (!subCategoryValidation.valid) {
        errors.subCategory = subCategoryValidation.error || "";
      }
    } else {
      const mainCategoryValidation = validateRequired(form.mainCategory, "대분류");
      if (!mainCategoryValidation.valid) {
        errors.mainCategory = mainCategoryValidation.error || "";
      }
      const subCategoryValidation = validateRequired(form.subCategory, "중분류");
      if (!subCategoryValidation.valid) {
        errors.subCategory = subCategoryValidation.error || "";
      }
    }
    // 상세내역은 선택사항이므로 검증하지 않음
    
    return errors;
  }, [form, effectiveFormKind, parseAmount, accounts]);
  
  // formErrors를 직접 사용 (useEffect 제거로 성능 개선)
  const formErrors = validateForm;
  const isFormValid = Object.keys(formErrors).length === 0;

  const submitForm = (keepContext: boolean) => {
    // 검증 실패 시 제출 방지
    if (!isFormValid) {
      const firstError = Object.values(validateForm)[0];
      if (firstError) {
        toast.error(firstError);
      }
      return;
    }
    const allowDecimal = kindForTab === "transfer" && form.currency === "USD";
    const gross = parseAmount(form.amount, allowDecimal);
    const allowLedgerDiscount =
      effectiveFormKind === "income" ||
      effectiveFormKind === "expense" ||
      effectiveFormKind === "savingsExpense" ||
      effectiveFormKind === "creditPayment";
    const discountParsed =
      allowLedgerDiscount && form.discountAmount?.trim()
        ? parseAmount(form.discountAmount, false)
        : 0;
    const amount = discountParsed > 0 ? gross - discountParsed : gross;
    if (!form.date) return;
    const expenseLikeSubmit =
      effectiveFormKind === "expense" ||
      effectiveFormKind === "savingsExpense" ||
      effectiveFormKind === "creditPayment";
    if (discountParsed > 0 && expenseLikeSubmit) {
      if (!Number.isFinite(amount)) return;
    } else if (!amount || amount <= 0) {
      return;
    }

    const isFixed = false;

    // 카테고리 값 정규화 (빈 문자열 체크)
    const normalizedMainCategory = form.mainCategory?.trim() || "";
    const normalizedSubCategory = form.subCategory?.trim() || "";
    
    const base: Omit<LedgerEntry, "id"> = {
      date: form.date,
      kind: kindForTab,
      isFixedExpense: isFixed,
      category:
        effectiveFormKind === "creditPayment"
          ? "신용결제"
          : kindForTab === "income"
            ? "수입"
            : normalizedMainCategory || "(미분류)",
      subCategory:
        effectiveFormKind === "creditPayment"
          ? "신용결제"
          : kindForTab === "income"
            ? normalizedSubCategory || "(미분류)"
            : normalizedSubCategory || "(미분류)",
      description: form.description?.trim() || "",
      amount,
      fromAccountId:
        effectiveFormKind === "savingsExpense" && normalizedSubCategory === "투자수익"
          ? undefined
          : (kindForTab === "expense" || kindForTab === "transfer" || effectiveFormKind === "creditPayment" || (effectiveFormKind === "savingsExpense" && normalizedSubCategory === "투자손실"))
            ? (form.fromAccountId?.trim() || undefined)
            : undefined,
      toAccountId:
        effectiveFormKind === "savingsExpense" && normalizedSubCategory === "투자손실"
          ? undefined
          : (kindForTab === "income" || kindForTab === "transfer" || effectiveFormKind === "savingsExpense" || effectiveFormKind === "creditPayment")
            ? (form.toAccountId?.trim() || undefined)
            : undefined,
      ...(allowLedgerDiscount
        ? { discountAmount: discountParsed > 0 ? discountParsed : undefined }
        : {}),
      ...(kindForTab === "transfer" && form.currency === "USD" ? { currency: "USD" as const } : {})
    };

    if (form.id) {
      const updated = ledger.map((l) => (l.id === form.id ? { ...base, id: l.id } : l));
      onChangeLedger(updated);
    } else {
      const id = `L${Date.now()}`;
      const entry: LedgerEntry = { id, ...base };
      onChangeLedger([entry, ...ledger]);
      setLastAddedEntryId(id);
      // 새 내역 추가 시 기존 필터 초기화
      setFilterMainCategory(undefined);
      setFilterSubCategory(undefined);
      setFilterFromAccountId(undefined);
      setFilterToAccountId(undefined);
      setFilterAmountMin(undefined);
      setFilterAmountMax(undefined);
      setDateFilter({});
      const amountStr = kindForTab === "transfer" && form.currency === "USD"
        ? `${amount.toLocaleString()} USD`
        : `${amount.toLocaleString()}원`;
      const msg = effectiveFormKind === "income"
        ? `${normalizedSubCategory || "수입"} ${amountStr} 추가 되었습니다.`
        : effectiveFormKind === "savingsExpense"
          ? `재테크 - ${normalizedSubCategory || "(미분류)"} ${amountStr} 추가 되었습니다.`
          : effectiveFormKind === "transfer"
            ? `${amountStr} 이체 추가 되었습니다.`
            : effectiveFormKind === "creditPayment"
              ? `신용결제 ${amountStr} 추가 되었습니다.`
              : `지출 - ${normalizedMainCategory} - ${normalizedSubCategory} ${amountStr} 추가 되었습니다.`;
      toast.success(msg);
    }

    setForm((prev) => {
      if (keepContext) {
        // 같은 구분/카테고리/계좌를 유지하고 금액만 비우기
        return {
          ...prev,
          id: undefined,
          date: form.date,
          kind: kindForTab,
          isFixedExpense: isFixed,
          mainCategory: "",
          subCategory: "",
          description: form.description,
          fromAccountId: form.fromAccountId,
          toAccountId: form.toAccountId,
          amount: "",
          ...(allowLedgerDiscount ? { discountAmount: "" } : {})
        };
      }
      return {
        ...createDefaultForm(),
        kind: kindForTab,
        isFixedExpense: false
      };
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitForm(false);
  };

  const isCreditPaymentEntry = (l: LedgerEntry) => l.kind === "expense" && l.category === "신용결제";

  const startEdit = (entry: LedgerEntry) => {
    setForm({
      id: entry.id,
      date: entry.date,
      kind: entry.kind,
      isFixedExpense: entry.isFixedExpense ?? false,
      mainCategory: isCreditPaymentEntry(entry) ? "" : (entry.kind === "income" ? "" : entry.category),
      subCategory: isCreditPaymentEntry(entry) ? "" : (entry.subCategory ?? (entry.kind === "income" ? entry.category : "")),
      description: entry.description,
      fromAccountId: entry.fromAccountId ?? "",
      toAccountId: entry.toAccountId ?? "",
      amount:
        entry.currency === "USD"
          ? String(
              (entry.kind === "expense" || entry.kind === "income") && (entry.discountAmount ?? 0) > 0
                ? entry.amount + (entry.discountAmount ?? 0)
                : entry.amount
            )
          : String(
              Math.round(
                (entry.kind === "expense" || entry.kind === "income") && (entry.discountAmount ?? 0) > 0
                  ? entry.amount + (entry.discountAmount ?? 0)
                  : entry.amount
              )
            ),
      discountAmount: entry.discountAmount != null ? String(Math.round(entry.discountAmount)) : "",
      currency: entry.currency ?? "KRW",
      tags: entry.tags || []
    });
    const nextTab: LedgerTab =
      entry.kind === "income"
        ? "income"
        : entry.kind === "transfer"
          ? "transfer"
          : isCreditPaymentEntry(entry)
            ? "creditPayment"
            : isSavingsExpenseEntry(entry, accounts, categoryPresets)
              ? "savingsExpense"
              : "expense";
    setLedgerTab(nextTab);
  };

  const startCopy = (entry: LedgerEntry) => {
    try {
      const isSavings = isSavingsExpenseEntry(entry, accounts, categoryPresets);
      const isCredit = isCreditPaymentEntry(entry);
      
      const nextTab: LedgerTab =
        entry.kind === "income"
          ? "income"
          : isCredit
            ? "creditPayment"
            : isSavings
              ? "savingsExpense"
              : entry.kind === "transfer"
                ? "transfer"
                : "expense";
      
      // 폼 데이터 준비
      const newForm = {
        id: undefined as string | undefined,
        date: entry.date,
        kind: entry.kind,
        isFixedExpense: entry.isFixedExpense ?? false,
        mainCategory: isCredit ? "" : (entry.kind === "income" ? "" : (entry.category || "")),
        subCategory: isCredit ? "" : (entry.kind === "income" ? (entry.subCategory || entry.category || "") : (entry.subCategory || "")),
        description: entry.description || "",
        fromAccountId: entry.fromAccountId ?? "",
        toAccountId: entry.toAccountId ?? "",
        amount: "",
        discountAmount: "",
        currency: (entry.currency ?? "KRW") as "KRW" | "USD",
        tags: entry.tags ? [...entry.tags] : []
      };
      
      // 복사 중 플래그 설정
      isCopyingRef.current = true;
      
      // 탭과 폼을 동시에 업데이트
      setLedgerTab(nextTab);
      
      // 폼 업데이트를 약간 지연시켜서 탭 변경이 완료된 후 실행
      setTimeout(() => {
        setForm(newForm);
        // 복사 완료 후 플래그 해제 (더 긴 지연)
        setTimeout(() => {
          isCopyingRef.current = false;
        }, 200);
      }, 10);
    } catch (error) {
      console.error("복사 중 오류 발생:", error);
      toast.error(ERROR_MESSAGES.COPY_FAILED);
      isCopyingRef.current = false;
    }
  };

  // 외부에서 복사 요청이 들어온 경우 처리
  useEffect(() => {
    if (copyRequest) {
      startCopy(copyRequest);
      onCopyComplete?.();
    }
  }, [copyRequest, onCopyComplete]);

  const resetForm = () => {
    setForm({
      ...createDefaultForm(),
      kind: kindForTab,
      isFixedExpense: false
    });
  };

  // 템플릿 적용: 클릭 시 해당 템플릿 값으로 폼 채우기
  const applyTemplate = (tpl: LedgerTemplate) => {
    // 탭 전환이 필요하면 먼저 탭 변경
    const tplKind = tpl.kind;
    const nextTab: typeof ledgerTab =
      tplKind === "income" ? "income" :
      tplKind === "transfer" ? "transfer" :
      "expense";
    setLedgerTab(nextTab);
    if (ledgerTab === "all") {
      const fk: typeof formKindWhenAll =
        tplKind === "income" ? "income" :
        tplKind === "transfer" ? "transfer" :
        "expense";
      setFormKindWhenAll(fk);
    }
    setForm((prev) => ({
      ...prev,
      kind: tplKind,
      mainCategory: tpl.mainCategory ?? "",
      subCategory: tpl.subCategory ?? "",
      description: tpl.description ?? "",
      fromAccountId: tpl.fromAccountId ?? "",
      toAccountId: tpl.toAccountId ?? "",
      amount: tpl.amount ? String(tpl.amount) : "",
    }));
    // lastUsed 업데이트
    if (onChangeTemplates) {
      const updated = ledgerTemplates.map((t) =>
        t.id === tpl.id ? { ...t, lastUsed: getTodayKST() } : t
      );
      onChangeTemplates(updated);
    }
    toast.success(`템플릿 "${tpl.name}" 적용됨`);
  };

  // 현재 폼을 템플릿으로 저장
  const saveFormAsTemplate = () => {
    const tplName = prompt("템플릿 이름을 입력하세요:");
    if (!tplName || !tplName.trim()) return;
    const newTpl: LedgerTemplate = {
      id: `T${Date.now()}`,
      name: tplName.trim(),
      kind: kindForTab,
      mainCategory: form.mainCategory || undefined,
      subCategory: form.subCategory || undefined,
      description: form.description || undefined,
      fromAccountId: form.fromAccountId || undefined,
      toAccountId: form.toAccountId || undefined,
      amount: form.amount ? Number(form.amount.replace(/[^\d.]/g, "")) || undefined : undefined,
      lastUsed: getTodayKST(),
    };
    if (onChangeTemplates) {
      onChangeTemplates([...ledgerTemplates, newTpl]);
    }
    toast.success(`템플릿 "${newTpl.name}" 저장됨`);
  };

  // 템플릿 삭제
  const deleteTemplate = (tplId: string) => {
    if (!onChangeTemplates) return;
    onChangeTemplates(ledgerTemplates.filter((t) => t.id !== tplId));
  };

  const startEditField = (id: string, field: string, currentValue: string | number) => {
    if (id.startsWith("trade-")) {
      toast("주식 거래는 주식 탭에서 수정하세요.");
      return;
    }
    setEditingField({ id, field });
    setEditingValue(String(currentValue));
  };

  const saveEditField = () => {
    if (!editingField) return;
    const { id, field } = editingField;
    const entry = ledger.find((l) => l.id === id);
    if (!entry) return;

    const updated: LedgerEntry = { ...entry };
    if (field === "date") {
      updated.date = editingValue;
    } else if (field === "category") {
      updated.category = editingValue;
    } else if (field === "subCategory") {
      updated.subCategory = editingValue || undefined;
    } else if (field === "detailCategory") {
      updated.detailCategory = editingValue || undefined;
    } else if (field === "description") {
      updated.description = editingValue;
    } else if (field === "fromAccountId") {
      updated.fromAccountId = editingValue || undefined;
    } else if (field === "toAccountId") {
      updated.toAccountId = editingValue || undefined;
    } else if (field === "grossAmount") {
      const isUSD = entry.currency === "USD";
      const gross = isUSD
        ? parseFloat(editingValue.replace(/[^\d.]/g, ""))
        : Number(editingValue.replace(/[^\d]/g, ""));
      if (!Number.isFinite(gross) || isNaN(gross)) {
        setEditingField(null);
        setEditingValue("");
        return;
      }
      const disc = entry.discountAmount ?? 0;
      updated.amount = gross - disc;
    } else if (field === "amount") {
      const isUSD = entry.currency === "USD";
      const amount = isUSD
        ? parseFloat(editingValue.replace(/[^\d.]/g, ""))
        : Number(editingValue.replace(/[^\d]/g, ""));
      if (Number.isFinite(amount) && !isNaN(amount)) {
        updated.amount = amount;
        if ((entry.kind === "expense" || entry.kind === "income") && (entry.discountAmount ?? 0) > 0) {
          updated.discountAmount = undefined;
        }
      } else {
        setEditingField(null);
        setEditingValue("");
        return;
      }
    } else if (field === "discountAmount") {
      if (entry.kind !== "income" && entry.kind !== "expense") {
        setEditingField(null);
        setEditingValue("");
        return;
      }
      const isUSD = entry.currency === "USD";
      const trimmed = editingValue.trim();
      const disc =
        trimmed === ""
          ? 0
          : isUSD
            ? parseFloat(editingValue.replace(/[^\d.]/g, ""))
            : Number(editingValue.replace(/[^\d]/g, ""));
      if (trimmed !== "" && (isNaN(disc) || disc < 0)) {
        toast.error("할인은 0 이상이어야 합니다");
        setEditingField(null);
        setEditingValue("");
        return;
      }
      const gross = entry.amount + (entry.discountAmount ?? 0);
      if (entry.kind === "income") {
        if (disc > gross) {
          toast.error("할인은 금액(할인 전)을 넘을 수 없습니다");
          setEditingField(null);
          setEditingValue("");
          return;
        }
        const net = gross - disc;
        if (net <= 0) {
          toast.error("할인 후 실제 수입액은 0보다 커야 합니다");
          setEditingField(null);
          setEditingValue("");
          return;
        }
        updated.amount = net;
      } else {
        updated.amount = gross - disc;
      }
      updated.discountAmount = disc > 0 ? disc : undefined;
    }

    onChangeLedger(ledger.map((l) => (l.id === id ? updated : l)));
    setEditingField(null);
    setEditingValue("");
  };

  const cancelEditField = () => {
    setEditingField(null);
    setEditingValue("");
  };

  const isEditing = Boolean(form.id);
  const formRef = useRef<HTMLFormElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);

  // 키보드 단축키 처리
  useEffect(() => {
    const handlers = [
      {
        action: "new-entry" as ShortcutAction,
        handler: () => {
          resetForm();
          setTimeout(() => dateInputRef.current?.focus(), 100);
        },
        enabled: () => !isEditing
      },
      {
        action: "save-entry" as ShortcutAction,
        handler: () => {
          submitForm(false);
        },
        enabled: () => {
          const allowDec = effectiveFormKind === "transfer" && form.currency === "USD";
          return Boolean(form.date && parseAmount(form.amount, allowDec) > 0);
        }
      },
      {
        action: "close-modal" as ShortcutAction,
        handler: () => {
          if (editingField) cancelEditField();
        }
      }
    ];

    handlers.forEach(handler => shortcutManager.register(handler));
    return () => {
      handlers.forEach(handler => shortcutManager.unregister(handler));
    };
  }, [isEditing, form, editingField]);

  // 빠른 필터 상태
  const [dateFilter, setDateFilter] = useState<{
    startDate?: string;
    endDate?: string;
  }>({});

  // 빠른 필터 함수들
  const applyQuickFilter = (filterType: "thisMonth" | "lastMonth" | "thisYear" | "last3Months" | "last6Months" | "lastYear") => {
    // 한국 시간 기준으로 계산
    const koreaTime = getKoreaTime();
    const year = koreaTime.getFullYear();
    const month = koreaTime.getMonth();
    const day = koreaTime.getDate();
    let startDate: string;
    const endDateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    let endDate: string = endDateStr;

    switch (filterType) {
      case "thisMonth":
        startDate = `${year}-${String(month + 1).padStart(2, "0")}-01`;
        break;
      case "lastMonth":
        const lastMonth = new Date(year, month - 1, 1);
        const lastMonthYear = lastMonth.getFullYear();
        const lastMonthMonth = lastMonth.getMonth();
        startDate = `${lastMonthYear}-${String(lastMonthMonth + 1).padStart(2, "0")}-01`;
        endDate = `${lastMonthYear}-${String(lastMonthMonth + 1).padStart(2, "0")}-${new Date(lastMonthYear, lastMonthMonth + 1, 0).getDate()}`;
        break;
      case "thisYear":
        startDate = `${year}-01-01`;
        break;
      case "last3Months":
        const threeMonthsAgo = new Date(year, month - 3, 1);
        startDate = `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, "0")}-01`;
        break;
      case "last6Months":
        const sixMonthsAgo = new Date(year, month - 6, 1);
        startDate = `${sixMonthsAgo.getFullYear()}-${String(sixMonthsAgo.getMonth() + 1).padStart(2, "0")}-01`;
        break;
      case "lastYear":
        const oneYearAgo = new Date(year - 1, month, 1);
        startDate = `${oneYearAgo.getFullYear()}-${String(oneYearAgo.getMonth() + 1).padStart(2, "0")}-01`;
        endDate = `${year - 1}-12-31`;
        break;
    }

    setDateFilter({ startDate, endDate });
    setViewMode("all");
  };

  const clearDateFilter = () => {
    setDateFilter({});
  };

  const clearAllFilters = () => {
    setFilterMainCategory(undefined);
    setFilterSubCategory(undefined);
    setFilterFromAccountId(undefined);
    setFilterToAccountId(undefined);
    setFilterAccountId(null);
    setFilterAmountMin(undefined);
    setFilterAmountMax(undefined);
    setFilterTagsInput("");
    setSearchQuery("");
    setDateFilter({});
    setForm((p) => ({ ...p, mainCategory: "", subCategory: "", fromAccountId: "", toAccountId: "" }));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S: 저장
      if (e.ctrlKey && e.key === "s" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const allowDec = effectiveFormKind === "transfer" && form.currency === "USD";
        const amount = parseAmount(form.amount, allowDec);
        if (form.date && amount && amount > 0) {
          submitForm(true);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [form]);

  const realizedPnlByTradeId = useMemo(
    () => computeRealizedPnlByTradeId(deferredTrades),
    [deferredTrades]
  );
  const tradesAsLedgerRows = useMemo(
    (): LedgerDisplayRow[] =>
      deferredTrades.filter((t) => t.side === "sell").map((t) => tradeToLedgerRow(t, realizedPnlByTradeId)),
    [deferredTrades, realizedPnlByTradeId]
  );
  const combinedLedger = useMemo(
    (): LedgerDisplayRow[] =>
      [...deferredLedger.map((l) => ({ ...l, _tradeId: undefined })), ...tradesAsLedgerRows],
    [deferredLedger, tradesAsLedgerRows]
  );

  // 탭별 필터링된 거래 목록 (가계부 + 주식 매수/매도)
  const ledgerByTab = useMemo(() => {
    return combinedLedger.filter((l) => {
      if (ledgerTab === "all") return true;
      if (ledgerTab === "income") return l.kind === "income";
      if (ledgerTab === "transfer") return l.kind === "transfer";
      if (ledgerTab === "savingsExpense") return isSavingsExpenseEntry(l, accounts, categoryPresets);
      if (ledgerTab === "creditPayment") return isCreditPaymentEntry(l);
      return l.kind === "expense" && !isSavingsExpenseEntry(l, accounts, categoryPresets) && !isCreditPaymentEntry(l) && !(l.isFixedExpense ?? false);
    });
  }, [combinedLedger, ledgerTab, accounts, categoryPresets]);

  const filteredLedger = useMemo(() => {
    const base = ledgerByTab;
    // 월별 보기: 월 선택이 없으면 전체 표시(날짜 필터는 아래에서 적용). 월 선택 있으면 해당 월만.
    let filtered =
      viewMode === "all"
        ? base
        : selectedMonths.size > 0
          ? base.filter((l) => l.date && selectedMonths.has(l.date.slice(0, 7)))
          : base;

    // 날짜 필터 적용
    if (dateFilter.startDate || dateFilter.endDate) {
      filtered = filtered.filter((l) => {
        if (!l.date) return false;
        if (dateFilter.startDate && l.date < dateFilter.startDate) return false;
        if (dateFilter.endDate && l.date > dateFilter.endDate) return false;
        return true;
      });
    }

    // 대분류/중분류/소분류 필터
    if (filterMainCategory || filterSubCategory || filterDetailCategory) {
      filtered = filtered.filter((l) => {
        if (filterMainCategory) {
          if (ledgerTab === "savingsExpense" && filterMainCategory === "재테크") {
            // 재테크 탭에서 재테크 필터: 대분류 필터 생략 (전체 재테크/저축 중분류 표시)
          } else if (ledgerTab === "income") {
            // 수입: 대분류 = 수입 유형 (subCategory 또는 category)
            const incomeType = (l.category === "수입" ? l.subCategory : l.category)?.trim();
            if (incomeType !== filterMainCategory) return false;
          } else if (l.category !== filterMainCategory) {
            return false;
          }
        }
        if (filterSubCategory) {
          if (ledgerTab === "income") {
            // 수입: 중분류 = description
            if ((l.description?.trim() || "") !== filterSubCategory) return false;
          } else if (l.subCategory !== filterSubCategory) return false;
        }
        if (filterDetailCategory && l.detailCategory !== filterDetailCategory) return false;
        return true;
      });
    }

    // 계좌별 보기 (from 또는 to 중 하나라도 해당 계좌)
    if (filterAccountId) {
      filtered = filtered.filter(
        (l) => l.fromAccountId === filterAccountId || l.toAccountId === filterAccountId
      );
    }

    // 출금계좌 필터
    if (filterFromAccountId) {
      filtered = filtered.filter((l) => l.fromAccountId === filterFromAccountId);
    }

    // 입금계좌 필터 (수입/이체/저축성지출 탭)
    if (filterToAccountId) {
      filtered = filtered.filter((l) => l.toAccountId === filterToAccountId);
    }

    // 금액 범위 필터
    if (filterAmountMin != null) {
      filtered = filtered.filter((l) => (l.amount ?? 0) >= filterAmountMin);
    }
    if (filterAmountMax != null) {
      filtered = filtered.filter((l) => (l.amount ?? 0) <= filterAmountMax);
    }

    const selectedTags = new Set(
      filterTagsInput.split(",").map((s) => s.trim()).filter(Boolean)
    );
    if (selectedTags.size > 0) {
      filtered = filtered.filter((l) => {
        const entryTags = l.tags ?? [];
        return [...selectedTags].every((tag) => entryTags.includes(tag));
      });
    }

    // 전문 검색 필터
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter((l) => {
        return (
          (l.date || "").toLowerCase().includes(q) ||
          (l.category || "").toLowerCase().includes(q) ||
          (l.subCategory || "").toLowerCase().includes(q) ||
          (l.description || "").toLowerCase().includes(q) ||
          (l.fromAccountId || "").toLowerCase().includes(q) ||
          (l.toAccountId || "").toLowerCase().includes(q) ||
          (l.tags ?? []).some((t) => t.toLowerCase().includes(q))
        );
      });
    }

    // 정렬 적용
    const sorted = [...filtered].sort((a, b) => {
      const dir = ledgerSort.direction === "asc" ? 1 : -1;
      const key = ledgerSort.key;
      
      if (key === "date") {
        return (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) * dir;
      } else if (key === "amount") {
        return ((a.amount ?? 0) - (b.amount ?? 0)) * dir;
      } else if (key === "grossAmount") {
        return (ledgerEntryGross(a) - ledgerEntryGross(b)) * dir;
      } else if (key === "discountAmount") {
        return ((a.discountAmount ?? 0) - (b.discountAmount ?? 0)) * dir;
      } else if (key === "category") {
        return ((a.category || "") < (b.category || "") ? -1 : (a.category || "") > (b.category || "") ? 1 : 0) * dir;
      } else if (key === "subCategory") {
        return ((a.subCategory || "") < (b.subCategory || "") ? -1 : (a.subCategory || "") > (b.subCategory || "") ? 1 : 0) * dir;
      } else if (key === "detailCategory") {
        return ((a.detailCategory || "") < (b.detailCategory || "") ? -1 : (a.detailCategory || "") > (b.detailCategory || "") ? 1 : 0) * dir;
      } else if (key === "description") {
        return ((a.description || "") < (b.description || "") ? -1 : (a.description || "") > (b.description || "") ? 1 : 0) * dir;
      } else if (key === "fromAccountId") {
        return ((a.fromAccountId || "") < (b.fromAccountId || "") ? -1 : (a.fromAccountId || "") > (b.fromAccountId || "") ? 1 : 0) * dir;
      } else if (key === "toAccountId") {
        return ((a.toAccountId || "") < (b.toAccountId || "") ? -1 : (a.toAccountId || "") > (b.toAccountId || "") ? 1 : 0) * dir;
      }
      return 0;
    });
    
    return sorted;
  }, [ledgerByTab, ledgerTab, viewMode, selectedMonths, dateFilter, filterMainCategory, filterSubCategory, filterAccountId, filterFromAccountId, filterToAccountId, filterAmountMin, filterAmountMax, filterTagsInput, searchQuery, ledgerSort]);

  // 필터 변경 시 페이지 초기화
  useEffect(() => {
    setListPage(0);
  }, [filteredLedger.length]);

  const tabLabel: Record<LedgerTab, string> = {
    all: "전체",
    income: "수입",
    savingsExpense: "재테크",
    expense: "지출",
    transfer: "이체",
    creditPayment: "신용결제"
  };
  const summaryTabLabel = ledgerTab === "all" ? "거래" : tabLabel[ledgerTab];

  const totalByTab = useMemo(
    () => ledgerByTab.reduce((s, l) => s + l.amount, 0),
    [ledgerByTab]
  );
  const monthlyTotalByTab = useMemo(
    () => filteredLedger.reduce((s, l) => s + l.amount, 0),
    [filteredLedger]
  );

  // 필터 적용 시 지출액/수입액/전체 요약 (지출 = 재테크·저축성지출 제외한 expense만)
  const filteredSummary = useMemo(() => {
    const savingsAmount = filteredLedger
      .filter((l) => isSavingsExpenseEntry(l, accounts, categoryPresets))
      .reduce((s, l) => s + l.amount, 0);
    const expenseAmount = filteredLedger
      .filter(
        (l) =>
          l.kind === "expense" &&
          !isSavingsExpenseEntry(l, accounts, categoryPresets)
      )
      .reduce((s, l) => s + l.amount, 0);
    const incomeAmount = filteredLedger
      .filter((l) => l.kind === "income")
      .reduce((s, l) => s + l.amount, 0);
    const total = incomeAmount - expenseAmount;
    return { expenseAmount, savingsAmount, incomeAmount, total };
  }, [filteredLedger, accounts, categoryPresets]);

  // 출금/입금 셀에 표시할 계좌별 금액·잔액 (ledger + trades 혼합, 날짜순 역산)
  const balanceAfterByLedgerId = useMemo(() => {
    const result = new Map<
      string,
      { from?: { amount: number; balance: number }; to?: { amount: number; balance: number } }
    >();
    const balanceById = new Map<string, number>();
    for (const row of balances) {
      balanceById.set(row.account.id, row.currentBalance);
    }
    type Event = { type: "ledger"; id: string; date: string; l: LedgerEntry } | { type: "trade"; id: string; date: string; t: StockTrade };
    const events: Event[] = [
      ...deferredLedger.map((l) => ({ type: "ledger" as const, id: l.id, date: l.date, l })),
      ...deferredTrades.map((t) => ({ type: "trade" as const, id: t.id, date: t.date, t }))
    ].sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.id.localeCompare(b.id)));
    const futureImpact = new Map<string, number>();
    const addImpact = (accId: string, delta: number) =>
      futureImpact.set(accId, (futureImpact.get(accId) ?? 0) + delta);
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === "ledger") {
        const l = e.l;
        let fromImpact = 0;
        let toImpact = 0;
        if (l.kind === "income" && l.toAccountId) toImpact = l.amount;
        else if (l.kind === "expense") {
          if (l.fromAccountId) fromImpact = -l.amount;
          if (l.toAccountId) toImpact = l.amount;
        } else if (l.kind === "transfer") {
          if (l.fromAccountId) fromImpact = -l.amount;
          if (l.toAccountId) toImpact = l.amount;
        }
        const fromBalance = l.fromAccountId
          ? (balanceById.get(l.fromAccountId) ?? 0) - (futureImpact.get(l.fromAccountId) ?? 0)
          : 0;
        const toBalance = l.toAccountId
          ? (balanceById.get(l.toAccountId) ?? 0) - (futureImpact.get(l.toAccountId) ?? 0)
          : 0;
        result.set(e.id, {
          from: l.fromAccountId ? { amount: fromImpact, balance: fromBalance } : undefined,
          to: l.toAccountId ? { amount: toImpact, balance: toBalance } : undefined
        });
        if (l.fromAccountId) addImpact(l.fromAccountId, fromImpact);
        if (l.toAccountId) addImpact(l.toAccountId, toImpact);
      } else {
        const t = e.t;
        addImpact(t.accountId, t.cashImpact);
      }
    }
    return result;
  }, [deferredLedger, deferredTrades, balances]);

  const filteredLedgerRef = useRef<LedgerDisplayRow[]>([]);
  useEffect(() => {
    filteredLedgerRef.current = filteredLedger;
  }, [filteredLedger]);

  // 필터/보기 변경 시 테이블 영역 리마운트용 키 (스크롤은 하지 않음)
  const ledgerScrollKey = useMemo(
    () =>
      [
        viewMode,
        Array.from(selectedMonths).sort().join(","),
        dateFilter.startDate ?? "",
        dateFilter.endDate ?? "",
        ledgerTab,
        filterMainCategory ?? "",
        filterSubCategory ?? "",
        filterFromAccountId ?? "",
        filterToAccountId ?? "",
        filterTagsInput
      ].join("|"),
    [
      viewMode,
      selectedMonths,
      dateFilter.startDate,
      dateFilter.endDate,
      ledgerTab,
      filterMainCategory,
      filterSubCategory,
      filterFromAccountId,
      filterToAccountId,
      filterTagsInput
    ]
  );

  // 헤더·본문 열 너비 — 리사이즈 중에는 liveColumnWidths(widthsForRender)로 실시간 반영
  const ledgerColumnWidthStyles = useMemo(() => {
    const workColPx = 168;
    return widthsForRender.map((width, index) => {
      if (index === 10) return `${workColPx}px`;
      const sumFirst10 = widthsForRender.slice(0, 10).reduce((s, w) => s + w, 0);
      const pct = sumFirst10 > 0 ? (width / sumFirst10) * 100 : 100 / 10;
      return `calc((100% - ${workColPx}px) * ${pct / 100})`;
    });
  }, [widthsForRender]);

  // 필터 변경 시 선택 합계 초기화
  useEffect(() => {
    setSelectedLedgerIdsForSum(new Set());
  }, [filteredLedger.length]);

  const scrollToLedgerTop = () => {
    ledgerScrollRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // 검색에서 이동: 해당 행으로 스크롤
  useEffect(() => {
    if (!highlightLedgerId) return;
    const el = document.querySelector(`tr[data-ledger-id="${highlightLedgerId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightLedgerId]);

  // 검색에서 이동: 행 하이라이트 후 해제 (DOM 반영 후 실행)
  const highlightClearTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!highlightLedgerId || !onClearHighlightLedger) return;
    const t1 = window.setTimeout(() => {
      const el = document.querySelector(`tr[data-ledger-id="${highlightLedgerId}"]`);
      if (!el) return;
      el.classList.add("ledger-row-highlight");
      highlightClearTimerRef.current = window.setTimeout(() => {
        el.classList.remove("ledger-row-highlight");
        onClearHighlightLedger();
        highlightClearTimerRef.current = null;
      }, 2500);
    }, 150);
    return () => {
      window.clearTimeout(t1);
      if (highlightClearTimerRef.current !== null) {
        window.clearTimeout(highlightClearTimerRef.current);
        highlightClearTimerRef.current = null;
      }
    };
  }, [highlightLedgerId, onClearHighlightLedger]);

  // Ctrl+N 시 전역 이벤트로 가계부 폼 포커스
  useEffect(() => {
    const handler = () => {
      const el = document.querySelector("[data-ledger-focus=\"amount\"]") as HTMLInputElement | null;
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };
    window.addEventListener("farmwallet:focus-ledger-form", handler);
    return () => window.removeEventListener("farmwallet:focus-ledger-form", handler);
  }, []);

  // 선택된 행 기준 합계 (표시용)
  const sumResultFromSelection = useMemo(() => {
    if (selectedLedgerIdsForSum.size === 0) return null;
    const slice = filteredLedger.filter((e) => selectedLedgerIdsForSum.has(e.id));
    if (slice.length === 0) return null;
    let incomeSum = 0;
    let expenseSum = 0;
    let transferSum = 0;
    slice.forEach((e) => {
      if (e.kind === "income") incomeSum += e.amount;
      else if (e.kind === "transfer" || isSavingsExpenseEntry(e, accounts, categoryPresets)) transferSum += e.amount;
      else expenseSum += e.amount;
    });
    return {
      count: slice.length,
      incomeSum,
      expenseSum,
      transferSum,
      net: incomeSum - expenseSum - transferSum
    };
  }, [filteredLedger, selectedLedgerIdsForSum, accounts]);

  // 사용 가능한 월 목록 (거래가 있는 월들) - 년도별로 정리
  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    ledgerByTab.forEach((l) => {
      // 날짜 형식 검증 및 정규화
      if (l.date && l.date.length >= 7) {
        const month = l.date.slice(0, 7); // YYYY-MM
        // 유효한 형식인지 확인 (YYYY-MM)
        if (/^\d{4}-\d{2}$/.test(month)) {
          months.add(month);
        }
      }
    });
    return Array.from(months).sort().reverse(); // 최신순
  }, [ledgerByTab]);

  // 년도별로 사용 가능한 월 목록
  const availableMonthsByYear = useMemo(() => {
    const monthsByYear = new Map<string, string[]>();
    availableMonths.forEach((month) => {
      const year = month.slice(0, 4);
      if (!monthsByYear.has(year)) {
        monthsByYear.set(year, []);
      }
      monthsByYear.get(year)!.push(month);
    });
    // 각 년도의 월을 정렬 (최신순)
    monthsByYear.forEach((months, year) => {
      months.sort().reverse();
    });
    return monthsByYear;
  }, [availableMonths]);

  // 선택된 월 표시용 레이블
  const selectedMonthsLabel = useMemo(() => {
    if (selectedMonths.size === 0) return "";
    return Array.from(selectedMonths).sort().join(", ");
  }, [selectedMonths]);

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    ledgerByTab.forEach((l) => {
      if (l.date && l.date.length >= 4) {
        const year = l.date.slice(0, 4);
        // 유효한 년도인지 확인 (4자리 숫자)
        if (/^\d{4}$/.test(year)) {
          years.add(year);
        }
      }
    });
    // 선택된 월들의 년도 포함
    selectedMonths.forEach((m) => {
      if (m.length >= 4) {
        const y = m.slice(0, 4);
        if (/^\d{4}$/.test(y)) years.add(y);
      }
    });
    // 현재 년도와 다음 년도도 항상 포함 (입력 편의를 위해)
    const koreaTime = getKoreaTime();
    const currentYear = String(koreaTime.getFullYear());
    const nextYear = String(koreaTime.getFullYear() + 1);
    years.add(currentYear);
    years.add(nextYear);
    
    return Array.from(years).sort((a, b) => b.localeCompare(a)); // 최신순 (내림차순)
  }, [ledgerByTab, selectedMonths]);

  
  // 현재 선택된 년도에 해당하는 월만 필터링
  const availableMonthsForCurrentYear = useMemo(() => {
    return availableMonthsByYear.get(currentYear) || [];
  }, [availableMonthsByYear, currentYear]);

  const handleReorder = (id: string, newPosition: number) => {
    if (viewMode !== "all") return;
    const currentIndex = ledger.findIndex((l) => l.id === id);
    if (currentIndex === -1) return;
    const clamped = Math.max(0, Math.min(ledger.length - 1, newPosition));
    if (clamped === currentIndex) return;
    const next = [...ledger];
    const [item] = next.splice(currentIndex, 1);
    next.splice(clamped, 0, item);
    onChangeLedger(next);
  };

  const handleDragSumStart = useCallback((index: number) => {
    dragSumStartRef.current = index;
    dragSumEndRef.current = index;
    setDragSumStartIndex(index);
    setDragSumEndIndex(index);

    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const tr = el?.closest?.("tr[data-ledger-id]");
      if (tr) {
        const id = tr.getAttribute("data-ledger-id");
        const list = filteredLedgerRef.current;
        const idx = list.findIndex((l) => l.id === id);
        if (idx >= 0) {
          dragSumEndRef.current = idx;
          setDragSumEndIndex(idx);
        }
      }
    };
    const onUp = () => {
      const start = dragSumStartRef.current;
      const end = dragSumEndRef.current;
      const list = filteredLedgerRef.current;
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      const slice = list.slice(lo, hi + 1);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      dragSumListenersRef.current = null;
      setDragSumStartIndex(null);
      setDragSumEndIndex(null);
      if (slice.length > 0) {
        setSelectedLedgerIdsForSum((prev) => {
          const next = new Set(prev);
          for (const row of slice) {
            if (next.has(row.id)) next.delete(row.id);
            else next.add(row.id);
          }
          return next;
        });
        toast.success("구간 선택을 토글했습니다.", { duration: 2000 });
      }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    dragSumListenersRef.current = { move: onMove, up: onUp };
  }, [accounts]);

  useEffect(() => {
    if (!lastAddedEntryId) return;
    const id = lastAddedEntryId;
    setLastAddedEntryId(null);
    const t = setTimeout(() => {
      const el = document.querySelector(`tr[data-ledger-id="${id}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
    return () => clearTimeout(t);
  }, [lastAddedEntryId]);

  const hasCategoryFilter = !!(filterMainCategory || filterSubCategory || filterFromAccountId || filterToAccountId);
  const hasDateFilter = !!(dateFilter.startDate || dateFilter.endDate);
  const hasAmountFilter = filterAmountMin != null || filterAmountMax != null;
  const hasTagFilter = filterTagsInput.trim() !== "";
  const hasFilter = hasCategoryFilter || hasDateFilter || hasAmountFilter || hasTagFilter || !!filterAccountId || searchQuery.trim() !== "";

  // 현재 탭 기준 계좌 버튼 목록 (ledgerByTab에 등장하는 계좌만)
  const accountsWithLedger = useMemo(() => {
    const ids = new Set<string>();
    for (const l of ledgerByTab) {
      if (l.fromAccountId) ids.add(l.fromAccountId);
      if (l.toAccountId) ids.add(l.toAccountId);
    }
    return accounts.filter((a) => ids.has(a.id));
  }, [ledgerByTab, accounts]);

  // 현재 탭 기준 대분류 목록 (ledgerByTab에 등장하는 category만, 등장 빈도순)
  // 수입 탭: category가 "수입"이면 subCategory에서, 아니면 category에서 수입 유형 추출
  const categoriesInTab = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of ledgerByTab) {
      let cat: string | undefined;
      if (ledgerTab === "income") {
        cat = (l.category === "수입" ? l.subCategory : l.category)?.trim();
      } else {
        cat = l.category?.trim();
      }
      if (cat) counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cat]) => cat);
  }, [ledgerByTab, ledgerTab]);

  // 중분류 목록 (빈도순) — 대분류 선택 시 해당 대분류만, 미선택 시 전체
  // 수입 탭: 대분류=수입유형이므로 중분류는 description 기반
  const subCategoriesInTab = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of ledgerByTab) {
      if (ledgerTab === "income") {
        if (filterMainCategory) {
          const incomeType = (l.category === "수입" ? l.subCategory : l.category)?.trim();
          if (incomeType !== filterMainCategory) continue;
        }
        const sub = l.description?.trim();
        if (sub) counts.set(sub, (counts.get(sub) || 0) + 1);
      } else {
        if (filterMainCategory && l.category !== filterMainCategory) continue;
        const sub = l.subCategory?.trim();
        if (sub) counts.set(sub, (counts.get(sub) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([sub]) => sub);
  }, [ledgerByTab, filterMainCategory, ledgerTab]);

  // 소분류 목록 (빈도순) — 중분류 선택 시 해당 중분류만, 미선택 시 전체
  // 수입 탭: 소분류 없음 (수입은 대분류=수입유형, 중분류=메모)
  const detailCategoriesInTab = useMemo(() => {
    if (ledgerTab === "income") return [];
    const counts = new Map<string, number>();
    for (const l of ledgerByTab) {
      if (filterMainCategory && l.category !== filterMainCategory) continue;
      if (filterSubCategory && l.subCategory !== filterSubCategory) continue;
      const det = l.detailCategory?.trim();
      if (det) counts.set(det, (counts.get(det) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([det]) => det);
  }, [ledgerByTab, filterMainCategory, filterSubCategory, ledgerTab]);

  const filterFromAccount = filterFromAccountId ? accounts.find((a) => a.id === filterFromAccountId) : null;
  const filterFromAccountName = filterFromAccountId ? (filterFromAccount?.name || filterFromAccount?.id || filterFromAccountId) : null;
  const filterToAccount = filterToAccountId ? accounts.find((a) => a.id === filterToAccountId) : null;
  const filterToAccountName = filterToAccountId ? (filterToAccount?.name || filterToAccount?.id || filterToAccountId) : null;

  return (
    <div>
      <div className="section-header">
        <h2>가계부 (거래 입력)</h2>
      </div>

      {/* 요약 카드: 항상 표시, 필터 적용 시 해당 결과 합계 */}
      <div style={{
        marginBottom: "16px",
        padding: "20px 24px",
        background: "var(--surface)",
        borderRadius: "12px",
        border: "2px solid var(--border)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.06)"
      }}>
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          alignItems: "stretch"
        }}>
          {/* 전체: 가장 크게, 가운데 */}
          <div style={{ textAlign: "center" }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, display: "block", marginBottom: 4 }}>
              {hasFilter
                ? `필터 적용 · ${viewMode === "monthly" ? selectedMonthsLabel || "월 선택" : "전체"} ${summaryTabLabel}`
                : viewMode === "monthly"
                  ? `${selectedMonthsLabel || "월 선택"} ${summaryTabLabel}`
                  : `전체 ${summaryTabLabel}`}
            </span>
            <span style={{
              fontSize: 28,
              fontWeight: 800,
              color: filteredSummary.total >= 0 ? "var(--primary)" : "var(--danger)",
              letterSpacing: "-0.5px"
            }}>
              {formatKRW(filteredSummary.total)}
            </span>
          </div>
          {/* 지출 / 수입: 나란히, 색상·크기로 구분 */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "16px",
            alignItems: "center"
          }}>
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              padding: "12px 16px",
              background: "rgba(239, 68, 68, 0.08)",
              borderRadius: "8px",
              border: "1px solid rgba(239, 68, 68, 0.2)"
            }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>지출</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: "var(--danger)" }}>
                {formatKRW(filteredSummary.expenseAmount)}
              </span>
            </div>
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              padding: "12px 16px",
              background: "rgba(245, 158, 11, 0.08)",
              borderRadius: "8px",
              border: "1px solid rgba(245, 158, 11, 0.24)"
            }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>재테크</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: "#d97706" }}>
                {formatKRW(filteredSummary.savingsAmount)}
              </span>
            </div>
            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              padding: "12px 16px",
              background: "rgba(34, 197, 94, 0.08)",
              borderRadius: "8px",
              border: "1px solid rgba(34, 197, 94, 0.2)"
            }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>수입</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: "var(--success)" }}>
                {formatKRW(filteredSummary.incomeAmount)}
              </span>
            </div>
          </div>
          {/* 필터 칩: 적용된 조건 한 줄에 표시 */}
          {hasFilter && (
            <div style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "8px",
              alignItems: "center",
              paddingTop: "8px",
              borderTop: "1px solid var(--border)"
            }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)", marginRight: 4 }}>필터:</span>
              {filterMainCategory && (
                <button
                  type="button"
                  onClick={() => { setFilterMainCategory(undefined); setFilterSubCategory(undefined); setForm((p) => ({ ...p, mainCategory: "", subCategory: "" })); }}
                  style={{
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: "20px",
                    border: "1px solid var(--primary)",
                    background: "var(--primary-light)",
                    color: "var(--primary)",
                    cursor: "pointer"
                  }}
                >
                  {filterMainCategory} ×
                </button>
              )}
              {filterSubCategory && (
                <button
                  type="button"
                  onClick={() => { setFilterSubCategory(undefined); setForm((p) => ({ ...p, subCategory: "" })); }}
                  style={{
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: "20px",
                    border: "1px solid var(--primary)",
                    background: "var(--primary-light)",
                    color: "var(--primary)",
                    cursor: "pointer"
                  }}
                >
                  {filterSubCategory} ×
                </button>
              )}
              {filterFromAccountId && (
                <button
                  type="button"
                  onClick={() => { setFilterFromAccountId(undefined); setForm((p) => ({ ...p, fromAccountId: "" })); }}
                  style={{
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: "20px",
                    border: "1px solid var(--primary)",
                    background: "var(--primary-light)",
                    color: "var(--primary)",
                    cursor: "pointer"
                  }}
                >
                  출금: {filterFromAccountName} ×
                </button>
              )}
              {filterToAccountId && (
                <button
                  type="button"
                  onClick={() => { setFilterToAccountId(undefined); setForm((p) => ({ ...p, toAccountId: "" })); }}
                  style={{
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: "20px",
                    border: "1px solid var(--primary)",
                    background: "var(--primary-light)",
                    color: "var(--primary)",
                    cursor: "pointer"
                  }}
                >
                  입금: {filterToAccountName} ×
                </button>
              )}
              {hasDateFilter && (
                <button
                  type="button"
                  onClick={clearDateFilter}
                  style={{
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: "20px",
                    border: "1px solid var(--primary)",
                    background: "var(--primary-light)",
                    color: "var(--primary)",
                    cursor: "pointer"
                  }}
                >
                  {dateFilter.startDate && dateFilter.endDate
                    ? `${dateFilter.startDate} ~ ${dateFilter.endDate}`
                    : dateFilter.startDate
                      ? `${dateFilter.startDate} ~`
                      : `~ ${dateFilter.endDate}`} ×
                </button>
              )}
              {hasAmountFilter && (
                <button
                  type="button"
                  onClick={() => { setFilterAmountMin(undefined); setFilterAmountMax(undefined); }}
                  style={{
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: "20px",
                    border: "1px solid var(--primary)",
                    background: "var(--primary-light)",
                    color: "var(--primary)",
                    cursor: "pointer"
                  }}
                >
                  금액: {filterAmountMin != null && filterAmountMax != null
                    ? `${formatKRW(filterAmountMin)} ~ ${formatKRW(filterAmountMax)}`
                    : filterAmountMin != null
                      ? `${formatKRW(filterAmountMin)} 이상`
                      : filterAmountMax != null
                        ? `${formatKRW(filterAmountMax)} 이하`
                        : ""} ×
                </button>
              )}
              {hasTagFilter && (
                <button
                  type="button"
                  onClick={() => setFilterTagsInput("")}
                  style={{
                    padding: "6px 12px",
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: "20px",
                    border: "1px solid var(--primary)",
                    background: "var(--primary-light)",
                    color: "var(--primary)",
                    cursor: "pointer"
                  }}
                >
                  태그: {filterTagsInput.trim()} ×
                </button>
              )}
              <button
                type="button"
                onClick={clearAllFilters}
                style={{
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: "20px",
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  color: "var(--text-secondary)",
                  cursor: "pointer"
                }}
              >
                필터 한번에 지우기
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 월별 비교 모드: 2개 이상 월 선택 시 */}
      {viewMode === "monthly" && selectedMonths.size >= 2 && (() => {
        const sortedMonths = Array.from(selectedMonths).sort();
        const monthSummaries = sortedMonths.map((monthKey) => {
          const entries = filteredLedger.filter((l) => l.date && l.date.startsWith(monthKey));
          const expenseAmount = entries
            .filter(
              (l) =>
                l.kind === "expense" &&
                l.category !== "재테크" &&
                l.category !== "저축성지출"
            )
            .reduce((s, l) => s + l.amount, 0);
          const incomeAmount = entries
            .filter((l) => l.kind === "income")
            .reduce((s, l) => s + l.amount, 0);
          const total = incomeAmount - expenseAmount;
          return { monthKey, expenseAmount, incomeAmount, total };
        });
        return (
          <div style={{
            marginBottom: "16px",
            padding: "16px 20px",
            background: "var(--surface)",
            borderRadius: "12px",
            border: "2px solid var(--border)",
            overflowX: "auto"
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 12 }}>월별 비교</div>
            <div style={{ display: "flex", gap: 16, minWidth: "max-content" }}>
              {monthSummaries.map(({ monthKey, expenseAmount, incomeAmount, total }) => (
                <div
                  key={monthKey}
                  style={{
                    flex: "0 0 auto",
                    width: 140,
                    padding: 12,
                    background: "var(--bg)",
                    borderRadius: 8,
                    border: "1px solid var(--border)"
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10, color: "var(--primary)" }}>{monthKey}</div>
                  <div style={{ fontSize: 11, color: "var(--danger)", marginBottom: 4 }}>지출 {formatKRW(expenseAmount)}</div>
                  <div style={{ fontSize: 11, color: "var(--success)", marginBottom: 4 }}>수입 {formatKRW(incomeAmount)}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: total >= 0 ? "var(--primary)" : "var(--danger)", borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 8 }}>
                    순액 {formatKRW(total)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* 빠른 입력 템플릿 */}
      {ledgerTemplates.length > 0 && (
        <div className="card" style={{ padding: "12px 16px", marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginBottom: 8 }}>빠른 입력</div>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4 }}>
            {ledgerTemplates.map((tpl) => (
              <div key={tpl.id} style={{ position: "relative", flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => applyTemplate(tpl)}
                  style={{
                    padding: "8px 14px",
                    fontSize: 13,
                    fontWeight: 500,
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    color: "var(--text)",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    paddingRight: 28,
                  }}
                >
                  {tpl.name}
                  {tpl.mainCategory && (
                    <span style={{ marginLeft: 6, fontSize: 11, color: "var(--text-muted)" }}>
                      {tpl.mainCategory}{tpl.subCategory ? ` / ${tpl.subCategory}` : ""}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => deleteTemplate(tpl.id)}
                  title="템플릿 삭제"
                  style={{
                    position: "absolute",
                    top: 2,
                    right: 4,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 12,
                    color: "var(--text-muted)",
                    lineHeight: 1,
                    padding: "2px 3px",
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 입력 폼 */}
      <form className="card" onSubmit={handleSubmit} style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* 수입/지출/이체 구분 선택 — 항상 표시 */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["income", "savingsExpense", "expense", "transfer", "creditPayment"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  tabIndex={-1}
                  className={effectiveFormKind === k ? "primary" : "secondary"}
                  onClick={() => {
                    setFormKindWhenAll(k);
                    // 특정 탭이 선택된 상태라면 "전체" 탭으로 전환하여 kind 선택이 반영되도록
                    if (ledgerTab !== "all") setLedgerTab("all");
                  }}
                  style={{ fontSize: 13, padding: "6px 12px" }}
                >
                  {tabLabel[k]}
                </button>
              ))}
            </div>
            {/* 상단: 날짜와 금액을 한 줄에 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "12px", alignItems: "start" }}>
              {/* 날짜 */}
              <label style={{ margin: 0 }}>
                <span style={{ fontSize: 11, marginBottom: 4, display: "block", color: "var(--text-muted)" }}>날짜 *</span>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  style={{ 
                    padding: "10px", 
                    fontSize: 14,
                    width: "100%",
                    border: formErrors.date ? "2px solid var(--danger)" : "1px solid var(--border)",
                    borderRadius: "6px"
                  }}
                  aria-invalid={!!formErrors.date}
                  aria-describedby={formErrors.date ? "date-error" : undefined}
                />
                <span id="date-error" style={{ fontSize: 10, color: "var(--danger)", display: "block", marginTop: 4, visibility: formErrors.date ? "visible" : "hidden" }}>
                  {formErrors.date || "\u00A0"}
                </span>
              </label>
              
              {/* 금액 */}
              <label style={{ margin: 0 }}>
                <span style={{ fontSize: 11, marginBottom: 4, display: "block", color: "var(--text-muted)" }}>
                  금액 *{" "}
                  {(effectiveFormKind === "income" ||
                    effectiveFormKind === "expense" ||
                    effectiveFormKind === "savingsExpense" ||
                    effectiveFormKind === "creditPayment") && (
                    <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(할인 전) </span>
                  )}
                  {effectiveFormKind === "transfer" && (
                    <span style={{ marginLeft: 8 }}>
                      <button
                        type="button"
                        tabIndex={-1}
                        className={form.currency === "KRW" ? "primary" : "secondary"}
                        onClick={() => setForm((prev) => ({ ...prev, currency: "KRW" }))}
                        style={{ fontSize: 11, padding: "2px 8px" }}
                      >
                        KRW
                      </button>
                      <button
                        type="button"
                        tabIndex={-1}
                        className={form.currency === "USD" ? "primary" : "secondary"}
                        onClick={() => setForm((prev) => ({ ...prev, currency: "USD" }))}
                        style={{ fontSize: 11, padding: "2px 8px", marginLeft: 4 }}
                      >
                        USD
                      </button>
                    </span>
                  )}
                </span>
                <input
                  data-ledger-focus="amount"
                  type="text"
                  inputMode={effectiveFormKind === "transfer" && form.currency === "USD" ? "decimal" : "numeric"}
                  placeholder={effectiveFormKind === "transfer" && form.currency === "USD" ? "0.00" : "0"}
                  value={form.amount}
                  onChange={useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
                    const allowDec = effectiveFormKind === "transfer" && form.currency === "USD";
                    const formatted = formatAmount(e.target.value, allowDec);
                    setForm((prev) => ({ ...prev, amount: formatted }));
                  }, [formatAmount, effectiveFormKind, form.currency])}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitForm(true);
                    }
                  }}
                  style={{ 
                    padding: "12px", 
                    fontSize: 18, 
                    fontWeight: 600,
                    textAlign: "right",
                    width: "100%",
                    border: formErrors.amount ? "2px solid var(--danger)" : "1px solid var(--border)",
                    borderRadius: "6px"
                  }}
                  aria-invalid={!!formErrors.amount}
                  aria-describedby={formErrors.amount ? "amount-error" : undefined}
                />
                <span id="amount-error" style={{ fontSize: 10, color: "var(--danger)", display: "block", marginTop: 4, visibility: formErrors.amount ? "visible" : "hidden" }}>
                  {formErrors.amount || "\u00A0"}
                </span>
                {(effectiveFormKind === "income" ||
                  effectiveFormKind === "expense" ||
                  effectiveFormKind === "savingsExpense" ||
                  effectiveFormKind === "creditPayment") &&
                  form.discountAmount?.trim() &&
                  parseAmount(form.discountAmount, false) > 0 &&
                  parseAmount(form.amount, false) > 0 && (
                    <span style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginTop: 4 }}>
                      {effectiveFormKind === "income" ? "실제 수입액" : "실제 지출액"}:{" "}
                      <strong style={{ color: "var(--text)" }}>
                        {(
                          parseAmount(form.amount, false) - parseAmount(form.discountAmount, false)
                        ).toLocaleString()}
                        원
                      </strong>
                    </span>
                  )}
              </label>
            </div>

            {/* 2. 대분류 (지출/이체만) 또는 수입 중분류 */}
            {form.kind === "income" ? (
              <label>
                <span style={{ fontSize: 14, marginBottom: 8, display: "block", fontWeight: 600 }}>수입 중분류 *</span>
                <div style={{ borderColor: formErrors.subCategory ? "var(--danger)" : undefined, border: formErrors.subCategory ? "1px solid var(--danger)" : "1px solid var(--border)" }}>
                  <Autocomplete
                    value={form.subCategory}
                    onChange={(val) => {
                      setForm((prev) => ({ ...prev, subCategory: val || "" }));
                    }}
                    options={incomeCategoryOptions
                      .filter((c: string) => c.toLowerCase().includes(form.subCategory.toLowerCase()))
                      .map((c: string) => ({ value: c, label: c }))}
                    placeholder="급여, 배당 등"
                  />
                </div>
                <span style={{ fontSize: 11, color: "var(--danger)", display: "block", marginTop: 4, visibility: formErrors.subCategory ? "visible" : "hidden" }}>
                  {formErrors.subCategory || "\u00A0"}
                </span>
                <div className="category-chip-row" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
                  {incomeCategoryOptions.map((c) => (
                      <button
                        key={c}
                        type="button"
                        tabIndex={-1}
                        className={`category-chip ${form.subCategory === c ? "active" : ""}`}
                        onClick={() => {
                          if (form.subCategory === c) {
                            setForm((prev) => ({ ...prev, subCategory: "" }));
                          } else {
                            setForm((prev) => ({ ...prev, subCategory: c || "" }));
                          }
                        }}
                        style={{
                          fontSize: 15,
                          fontWeight: form.subCategory === c ? 600 : 500,
                          padding: "12px 16px",
                          border: form.subCategory === c ? "2px solid var(--primary)" : "1px solid var(--border)",
                          background: form.subCategory === c ? "var(--primary-light)" : "var(--surface)",
                          color: form.subCategory === c ? "var(--primary)" : "var(--text)",
                          borderRadius: "8px",
                          textAlign: "center",
                          transition: "all 0.2s"
                        }}
                      >
                        {c}
                      </button>
                  ))}
                </div>
              </label>
            ) : effectiveFormKind === "creditPayment" ? (
              /* 신용결제: 대분류/중분류 없음, 출금·카드·할인금액은 아래 계좌 영역에서 표시 */
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--primary)" }}>신용결제</span>
              </div>
            ) : (
              <>
                {/* 이체 탭일 때는 대분류를 숨기고 "이체"로 고정 */}
                {ledgerTab === "transfer" ? (
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ fontSize: 12, marginBottom: 8, display: "block", fontWeight: 600 }}>대분류: 이체</span>
                    <div style={{ 
                      padding: "10px 12px", 
                      background: "var(--primary-light)", 
                      border: "2px solid var(--primary)", 
                      borderRadius: "8px",
                      color: "var(--primary)",
                      fontWeight: 600,
                      textAlign: "center"
                    }}>
                      이체
                    </div>
                  </div>
                ) : (
                  <label>
                    <span style={{ fontSize: 12, marginBottom: 8, display: "block" }}>대분류 *</span>
                    <span style={{ fontSize: 11, color: "var(--danger)", display: "block", marginBottom: 4, visibility: formErrors.mainCategory ? "visible" : "hidden" }}>
                      {formErrors.mainCategory || "\u00A0"}
                    </span>
                    {/* 대분류 버튼 그리드 - 모든 대분류 표시 */}
                    <div style={{ 
                      display: "grid", 
                      gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", 
                      gap: 8,
                      marginBottom: 8
                    }}>
                    {mainCategoryOptions.map((c) => (
                      <button
                        key={c}
                        type="button"
                        tabIndex={-1}
                        onClick={() => {
                          if (form.mainCategory === c) {
                            if (effectiveFormKind === "savingsExpense") {
                              // savingsExpense: mainCategory stays "재테크", just clear subCategory
                            } else {
                              setForm((prev) => ({ ...prev, mainCategory: "", subCategory: "" }));
                            }
                          } else {
                            setForm((prev) => ({ ...prev, mainCategory: c || "", subCategory: "" }));
                          }
                        }}
                        style={{
                          padding: "10px 8px",
                          fontSize: 13,
                          fontWeight: form.mainCategory === c ? 600 : 400,
                          border: form.mainCategory === c ? "2px solid var(--primary)" : "1px solid var(--border)",
                          borderRadius: "8px",
                          background: form.mainCategory === c ? "var(--primary-light)" : "var(--surface)",
                          color: form.mainCategory === c ? "var(--primary)" : "var(--text)",
                          cursor: "pointer",
                          transition: "all 0.2s",
                          textAlign: "center"
                        }}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </label>
                )}

                {/* 3. 중분류 - 대분류 선택 시에만 표시 (이체 탭일 때는 항상 표시) */}
                {(form.mainCategory || ledgerTab === "transfer") ? (
                  <label>
                    <span style={{ fontSize: 12, marginBottom: 8, display: "block" }}>
                      중분류 * <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>({ledgerTab === "transfer" ? "이체" : form.mainCategory}의 중분류)</span>
                    </span>
                    <span style={{ fontSize: 11, color: "var(--danger)", display: "block", marginBottom: 4, visibility: formErrors.subCategory ? "visible" : "hidden" }}>
                      {formErrors.subCategory || "\u00A0"}
                    </span>
                    {/* 중분류 버튼 그리드 - 선택된 대분류에 해당하는 항목만 표시 */}
                    <div style={{ 
                      display: "grid", 
                      gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", 
                      gap: 8
                    }}>
                      {expenseSubSuggestions.map((c) => {
                        const isSelected = form.subCategory === c;
                        return (
                          <button
                            key={c}
                            type="button"
                            tabIndex={-1}
                            onClick={() => {
                              if (form.subCategory === c) {
                                setForm((prev) => ({ ...prev, subCategory: "" }));
                              } else {
                                setForm((prev) => ({ ...prev, subCategory: c || "" }));
                              }
                            }}
                            style={{
                              padding: "10px 8px",
                              fontSize: 13,
                              fontWeight: isSelected ? 600 : 400,
                              border: isSelected ? "2px solid var(--primary)" : "1px solid var(--border)",
                              borderRadius: "8px",
                              background: isSelected ? "var(--primary-light)" : "var(--surface)",
                              color: isSelected ? "var(--primary)" : "var(--text)",
                              cursor: "pointer",
                              transition: "all 0.2s",
                              textAlign: "center"
                            }}
                          >
                            {c}
                          </button>
                        );
                      })}
                    </div>
                  </label>
                ) : (
                  <div style={{ 
                    padding: "16px", 
                    textAlign: "center", 
                    color: "var(--text-muted)",
                    fontSize: 13,
                    border: "1px dashed var(--border)",
                    borderRadius: "8px",
                    background: "var(--surface)"
                  }}>
                    대분류를 먼저 선택하세요
                  </div>
                )}
              </>
            )}

            {/* 4. 상세내역 (선택) - 작게 */}
            <label style={{ margin: 0 }}>
              <span style={{ fontSize: 10, marginBottom: 4, display: "block", color: "var(--text-muted)" }}>상세내역 (선택)</span>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="예: 김밥천국, 아파트 관리비 등"
                style={{ 
                  padding: "8px", 
                  fontSize: 13,
                  width: "100%",
                  border: "1px solid var(--border)",
                  borderRadius: "6px"
                }}
              />
            </label>

            {/* 확장 영역: 할인 · 출금계좌 · 입금계좌 */}
            {(<>
            {/* 할인 (수입·지출·재테크·신용결제, 선택) — 저장 시 금액−할인이 실제 반영액 */}
            {(effectiveFormKind === "income" ||
              effectiveFormKind === "expense" ||
              effectiveFormKind === "savingsExpense" ||
              effectiveFormKind === "creditPayment") && (
              <label style={{ margin: 0 }}>
                <span style={{ fontSize: 10, marginBottom: 4, display: "block", color: "var(--text-muted)" }}>
                  할인 (선택)
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.discountAmount}
                  onChange={(e) => {
                    const formatted = formatAmount(e.target.value, false);
                    setForm((prev) => ({ ...prev, discountAmount: formatted }));
                  }}
                  placeholder="0"
                  style={{ 
                    padding: "8px", 
                    fontSize: 13,
                    width: "100%",
                    border: formErrors.discountAmount ? "2px solid var(--danger)" : "1px solid var(--border)",
                    borderRadius: "6px"
                  }}
                />
                <span style={{ fontSize: 10, color: "var(--danger)", display: "block", marginTop: 4, visibility: formErrors.discountAmount ? "visible" : "hidden" }}>{formErrors.discountAmount || "\u00A0"}</span>
              </label>
            )}

            {/* 5. 출금계좌 (지출/이체/신용결제, 재테크는 투자수익 제외) - 재테크도 kind는 expense라 savingsExpense일 때 일반 지출과 분리 */}
            {(form.kind === "transfer" ||
              effectiveFormKind === "creditPayment" ||
              (form.kind === "expense" && effectiveFormKind !== "savingsExpense") ||
              (effectiveFormKind === "savingsExpense" && form.subCategory !== "투자수익")) && (
              <div>
                <div style={{ fontSize: 11, marginBottom: 8, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
                  <span>출금계좌 *</span>
                  {(formErrors.fromAccountId || formErrors.transfer) && (
                    <span style={{ fontSize: 10, color: "var(--danger)" }}>({(formErrors.fromAccountId || formErrors.transfer)})</span>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                  {accounts.map((a) => {
                      const accountName = (a.name + a.id).toLowerCase();
                      const isUSD = a.currency === "USD" ||
                                   accountName.includes("usd") ||
                                   accountName.includes("dollar") ||
                                   accountName.includes("달러");
                      return (
                        <button
                          key={a.id}
                          type="button"
                          tabIndex={-1}
                          onClick={() => {
                            if (form.fromAccountId === a.id) {
                              setForm((prev) => ({ ...prev, fromAccountId: "" }));
                            } else {
                              setForm((prev) => ({ ...prev, fromAccountId: a.id || "" }));
                            }
                          }}
                          style={{
                            padding: "10px 8px",
                            fontSize: 13,
                            fontWeight: form.fromAccountId === a.id ? 600 : 400,
                            border: form.fromAccountId === a.id ? "2px solid var(--primary)" : "1px solid var(--border)",
                            borderRadius: "8px",
                            background: form.fromAccountId === a.id ? "var(--primary-light)" : "var(--surface)",
                            color: form.fromAccountId === a.id ? "var(--primary)" : "var(--text)",
                            cursor: "pointer",
                            transition: "all 0.2s",
                            textAlign: "left"
                          }}
                        >
                          {a.id} {isUSD ? "(USD)" : ""}
                        </button>
                      );
                  })}
                </div>
              </div>
            )}

            {/* 입금계좌/카드 (수입/이체/재테크 투자수익·저축·투자/신용결제) - 버튼 그리드. 재테크 투자손실일 땐 미표시 */}
            {(form.kind === "income" || form.kind === "transfer" || effectiveFormKind === "creditPayment" || (effectiveFormKind === "savingsExpense" && form.subCategory !== "투자손실")) && (
              <div>
                <div style={{ fontSize: 11, marginBottom: 8, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
                  <span>{effectiveFormKind === "creditPayment" ? "카드 *" : ledgerTab === "savingsExpense" ? "저축계좌 (증권/저축) *" : "입금계좌 *"}</span>
                  {(formErrors.toAccountId || formErrors.transfer) && (
                    <span style={{ fontSize: 10, color: "var(--danger)" }}>({(formErrors.toAccountId || formErrors.transfer)})</span>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                  {(() => {
                    const targetAccounts = effectiveFormKind === "creditPayment"
                      ? accounts.filter((a) => a.type === "card")
                      : ledgerTab === "savingsExpense"
                        ? accounts.filter((a) => a.type === "securities" || a.type === "savings")
                        : accounts;
                    return targetAccounts.map((a) => {
                            const accountName = (a.name + a.id).toLowerCase();
                            const isUSD = a.currency === "USD" ||
                                         accountName.includes("usd") ||
                                         accountName.includes("dollar") ||
                                         accountName.includes("달러");
                            return (
                              <button
                                key={a.id}
                                type="button"
                                tabIndex={-1}
                                onClick={() => {
                              if (form.toAccountId === a.id) {
                                setForm((prev) => ({ ...prev, toAccountId: "" }));
                              } else {
                                setForm((prev) => ({ ...prev, toAccountId: a.id || "" }));
                              }
                            }}
                                style={{
                                  padding: "10px 8px",
                                  fontSize: 13,
                                  fontWeight: form.toAccountId === a.id ? 600 : 400,
                                  border: form.toAccountId === a.id ? "2px solid var(--primary)" : "1px solid var(--border)",
                                  borderRadius: "8px",
                                  background: form.toAccountId === a.id ? "var(--primary-light)" : "var(--surface)",
                                  color: form.toAccountId === a.id ? "var(--primary)" : "var(--text)",
                                  cursor: "pointer",
                                  transition: "all 0.2s",
                                  textAlign: "left"
                                }}
                              >
                                {a.id} {isUSD ? "(USD)" : ""}
                              </button>
                            );
                          });
                  })()}
                </div>
              </div>
            )}
            </>)}

            {/* 제출 버튼 */}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                type="submit"
                tabIndex={-1}
                className="primary"
                style={{
                  padding: "14px 24px",
                  fontSize: 16,
                  fontWeight: 600,
                  flex: 1,
                  borderRadius: "8px"
                }}
                disabled={!isFormValid}
                title={!isFormValid ? "필수 항목을 입력해주세요" : ""}
              >
                추가
              </button>
              {onChangeTemplates && (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={saveFormAsTemplate}
                  title="현재 폼을 템플릿으로 저장"
                  style={{
                    padding: "14px 16px",
                    fontSize: 13,
                    fontWeight: 500,
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  템플릿 저장
                </button>
              )}
            </div>
          </div>
        </form>

      {/* ── 필터 영역 ── */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        {/* 검색 입력 */}
        <div style={{ position: "relative", marginBottom: 14 }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="거래 검색 (날짜, 카테고리, 내용, 계좌...)"
            style={{
              width: "100%",
              padding: "12px 16px",
              paddingRight: searchQuery ? 40 : 16,
              fontSize: 15,
              borderRadius: 10,
              border: "2px solid var(--border)",
              background: "var(--surface)",
              color: "var(--text)",
              boxSizing: "border-box",
              outline: "none",
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 18,
                color: "var(--text-muted)",
                lineHeight: 1,
                padding: "0 4px",
              }}
              aria-label="검색어 지우기"
            >
              ×
            </button>
          )}
        </div>

        {/* 종류 필터 — 큰 버튼 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8, marginBottom: 14 }}>
          {([
            ["all", "전체"],
            ["income", "수입"],
            ["expense", "지출"],
            ["savingsExpense", "재테크"],
            ["transfer", "이체"],
            ["creditPayment", "신용결제"],
          ] as const).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              onClick={() => setLedgerTab(tab)}
              style={{
                padding: "12px 8px",
                fontSize: 15,
                fontWeight: 700,
                borderRadius: 10,
                border: ledgerTab === tab ? "2px solid var(--primary)" : "2px solid var(--border)",
                background: ledgerTab === tab ? "var(--primary)" : "var(--surface)",
                color: ledgerTab === tab ? "white" : "var(--text)",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* 대분류 필터 — 종류 탭이 전체가 아닐 때, 또는 전체 탭이지만 카테고리가 2개 이상일 때 */}
        {categoriesInTab.length > 1 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>대분류</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => { setFilterMainCategory(undefined); setFilterSubCategory(undefined); setFilterDetailCategory(undefined); }}
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: !filterMainCategory ? "2px solid var(--primary)" : "1px solid var(--border)",
                  background: !filterMainCategory ? "var(--primary)" : "var(--surface)",
                  color: !filterMainCategory ? "white" : "var(--text)",
                  cursor: "pointer",
                }}
              >
                전체
              </button>
              {categoriesInTab.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    if (filterMainCategory === cat) {
                      setFilterMainCategory(undefined);
                      setFilterSubCategory(undefined);
                      setFilterDetailCategory(undefined);
                    } else {
                      setFilterMainCategory(cat);
                      setFilterSubCategory(undefined);
                      setFilterDetailCategory(undefined);
                    }
                  }}
                  style={{
                    padding: "8px 16px",
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: 8,
                    border: filterMainCategory === cat ? "2px solid var(--primary)" : "1px solid var(--border)",
                    background: filterMainCategory === cat ? "var(--primary)" : "var(--surface)",
                    color: filterMainCategory === cat ? "white" : "var(--text)",
                    cursor: "pointer",
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 중분류 필터 — 대분류 선택 시 표시 (수입 탭: 메모 기준) */}
        {filterMainCategory && subCategoriesInTab.length > 1 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>{ledgerTab === "income" ? "메모" : "중분류"}{filterMainCategory ? ` (${filterMainCategory})` : ""}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => { setFilterSubCategory(undefined); setFilterDetailCategory(undefined); }}
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: !filterSubCategory ? "2px solid var(--primary)" : "1px solid var(--border)",
                  background: !filterSubCategory ? "var(--primary)" : "var(--surface)",
                  color: !filterSubCategory ? "white" : "var(--text)",
                  cursor: "pointer",
                }}
              >
                전체
              </button>
              {subCategoriesInTab.map((sub) => (
                <button
                  key={sub}
                  type="button"
                  onClick={() => { setFilterSubCategory(filterSubCategory === sub ? undefined : sub); setFilterDetailCategory(undefined); }}
                  style={{
                    padding: "8px 16px",
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: 8,
                    border: filterSubCategory === sub ? "2px solid var(--primary)" : "1px solid var(--border)",
                    background: filterSubCategory === sub ? "var(--primary)" : "var(--surface)",
                    color: filterSubCategory === sub ? "white" : "var(--text)",
                    cursor: "pointer",
                  }}
                >
                  {sub}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 소분류 필터 — 중분류 선택 시 표시 */}
        {filterSubCategory && detailCategoriesInTab.length > 1 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>소분류{filterSubCategory ? ` (${filterSubCategory})` : ""}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setFilterDetailCategory(undefined)}
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: !filterDetailCategory ? "2px solid var(--primary)" : "1px solid var(--border)",
                  background: !filterDetailCategory ? "var(--primary)" : "var(--surface)",
                  color: !filterDetailCategory ? "white" : "var(--text)",
                  cursor: "pointer",
                }}
              >
                전체
              </button>
              {detailCategoriesInTab.map((det) => (
                <button
                  key={det}
                  type="button"
                  onClick={() => setFilterDetailCategory(filterDetailCategory === det ? undefined : det)}
                  style={{
                    padding: "8px 16px",
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: 8,
                    border: filterDetailCategory === det ? "2px solid var(--primary)" : "1px solid var(--border)",
                    background: filterDetailCategory === det ? "var(--primary)" : "var(--surface)",
                    color: filterDetailCategory === det ? "white" : "var(--text)",
                    cursor: "pointer",
                  }}
                >
                  {det}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 계좌 필터 */}
        {accountsWithLedger.length > 1 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>계좌</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setFilterAccountId(null)}
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: filterAccountId === null ? "2px solid var(--primary)" : "1px solid var(--border)",
                  background: filterAccountId === null ? "var(--primary)" : "var(--surface)",
                  color: filterAccountId === null ? "white" : "var(--text)",
                  cursor: "pointer",
                }}
              >
                전체
              </button>
              {accountsWithLedger.map((acc) => (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => setFilterAccountId(filterAccountId === acc.id ? null : acc.id)}
                  style={{
                    padding: "8px 16px",
                    fontSize: 13,
                    fontWeight: 600,
                    borderRadius: 8,
                    border: filterAccountId === acc.id ? "2px solid var(--primary)" : "1px solid var(--border)",
                    background: filterAccountId === acc.id ? "var(--primary)" : "var(--surface)",
                    color: filterAccountId === acc.id ? "white" : "var(--text)",
                    cursor: "pointer",
                  }}
                >
                  {acc.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 기간 필터 */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>기간</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" onClick={() => { setViewMode("monthly"); clearDateFilter(); }}
              style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: viewMode === "monthly" ? "2px solid var(--primary)" : "1px solid var(--border)", background: viewMode === "monthly" ? "var(--primary)" : "var(--surface)", color: viewMode === "monthly" ? "white" : "var(--text)", cursor: "pointer" }}>
              월별
            </button>
            <button type="button" onClick={() => { setViewMode("all"); clearDateFilter(); }}
              style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: viewMode === "all" && !dateFilter.startDate ? "2px solid var(--primary)" : "1px solid var(--border)", background: viewMode === "all" && !dateFilter.startDate ? "var(--primary)" : "var(--surface)", color: viewMode === "all" && !dateFilter.startDate ? "white" : "var(--text)", cursor: "pointer" }}>
              전체
            </button>
            <span style={{ width: 1, height: 24, background: "var(--border)", margin: "0 4px" }} />
            {([
              ["thisMonth", "이번 달"],
              ["lastMonth", "지난 달"],
              ["thisYear", "올해"],
              ["last3Months", "3개월"],
              ["last6Months", "6개월"],
              ["lastYear", "1년"],
            ] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => applyQuickFilter(key)}
                style={{ padding: "8px 12px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", cursor: "pointer" }}>
                {label}
              </button>
            ))}
            <span style={{ width: 1, height: 24, background: "var(--border)", margin: "0 4px" }} />
            <input type="date" value={dateFilter.startDate || ""} onChange={(e) => { setDateFilter((prev) => ({ ...prev, startDate: e.target.value || undefined })); setViewMode("all"); }}
              style={{ padding: "8px 10px", fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }} title="시작일" />
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>~</span>
            <input type="date" value={dateFilter.endDate || ""} onChange={(e) => { setDateFilter((prev) => ({ ...prev, endDate: e.target.value || undefined })); setViewMode("all"); }}
              style={{ padding: "8px 10px", fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }} title="종료일" />
          </div>
        </div>

        {/* 상세 필터 + 액션 */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input type="number" value={filterAmountMin ?? ""} onChange={(e) => { const v = e.target.value; setFilterAmountMin(v === "" ? undefined : Number(v) || undefined); }}
            placeholder="최소 금액" style={{ padding: "8px 10px", fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", width: 100, background: "var(--surface)", color: "var(--text)" }} />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>~</span>
          <input type="number" value={filterAmountMax ?? ""} onChange={(e) => { const v = e.target.value; setFilterAmountMax(v === "" ? undefined : Number(v) || undefined); }}
            placeholder="최대 금액" style={{ padding: "8px 10px", fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", width: 100, background: "var(--surface)", color: "var(--text)" }} />
          <input type="text" value={filterTagsInput} onChange={(e) => setFilterTagsInput(e.target.value)}
            placeholder="태그 (쉼표 구분)" style={{ padding: "8px 10px", fontSize: 12, borderRadius: 8, border: "1px solid var(--border)", width: 150, background: "var(--surface)", color: "var(--text)" }} />
          {hasFilter && (
            <button type="button" onClick={clearAllFilters}
              style={{ padding: "8px 16px", fontSize: 13, fontWeight: 700, borderRadius: 8, border: "2px solid var(--danger)", background: "transparent", color: "var(--danger)", cursor: "pointer" }}>
              필터 초기화
            </button>
          )}
          {filteredLedger.length > 0 && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                const headers = [
                  "date",
                  "kind",
                  "category",
                  "subCategory",
                  "description",
                  "tags",
                  "fromAccount",
                  "toAccount",
                  "grossAmount",
                  "discountAmount",
                  "amount"
                ];
                const rows = filteredLedger.map((l) => {
                  const exportKind =
                    l.kind === "income"
                      ? "income"
                      : l.kind === "transfer"
                        ? "transfer"
                        : isSavingsExpenseEntry(l, accounts, categoryPresets)
                          ? "investment"
                          : "expense";
                  return [
                    l.date,
                    exportKind,
                    l.category || "",
                    l.subCategory || "",
                    l.description || "",
                    Array.isArray(l.tags) ? l.tags.join(",") : "",
                    l.fromAccountId || "",
                    l.toAccountId || "",
                    String(ledgerEntryGross(l)),
                    l.discountAmount != null && l.discountAmount > 0 ? String(l.discountAmount) : "",
                    l.amount.toString()
                  ];
                });
                const csvContent = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n");
                const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8" });
                const link = document.createElement("a");
                const url = URL.createObjectURL(blob);
                link.setAttribute("href", url);
                const koreaTime = getKoreaTime();
                const year = koreaTime.getFullYear();
                const month = String(koreaTime.getMonth() + 1).padStart(2, "0");
                const day = String(koreaTime.getDate()).padStart(2, "0");
                link.setAttribute("download", `가계부_${year}-${month}-${day}.csv`);
                link.style.visibility = "hidden";
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                toast.success("CSV 파일로 내보냈습니다");
              }}
              style={{ fontSize: 12, padding: "6px 12px", marginLeft: 8 }}
            >
              📥 검색 결과 내보내기 (CSV)
            </button>
          )}
        </div>
      </div>
      {viewMode === "monthly" && (
          <>
            {/* 년/월 화살표 네비게이션 */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const k = getKoreaTime();
                  const yyyy = k.getFullYear();
                  const mm = String(k.getMonth() + 1).padStart(2, "0");
                  setSelectedMonths(new Set([`${yyyy}-${mm}`]));
                  setCurrentYear(String(yyyy));
                }}
                style={{ padding: "6px 10px", fontSize: 13 }}
              >
                이번 달
              </button>
              <button
                type="button"
                className="icon-button"
                style={{ width: 32, height: 32, border: "1px solid var(--border)", borderRadius: 8, fontSize: 16, cursor: "pointer" }}
                onClick={() => {
                  let y = Number(currentYear);
                  // 현재 선택된 월 중 가장 이른 월을 기준으로 이전 달로 이동
                  const sorted = [...selectedMonths].sort();
                  if (sorted.length > 0) {
                    const [sy, sm] = sorted[0].split("-").map(Number);
                    const prev = sm === 1 ? `${sy - 1}-12` : `${sy}-${String(sm - 1).padStart(2, "0")}`;
                    const prevYear = sm === 1 ? String(sy - 1) : String(sy);
                    setCurrentYear(prevYear);
                    setSelectedMonths(new Set([prev]));
                  } else {
                    const m = 1;
                    y -= 1;
                    setCurrentYear(String(y));
                    setSelectedMonths(new Set([`${y}-${String(m).padStart(2, "0")}`]));
                  }
                }}
              >
                ◀
              </button>
              <span style={{ fontWeight: 700, fontSize: 15, minWidth: 100, textAlign: "center" }}>
                {currentYear}년
              </span>
              <button
                type="button"
                className="icon-button"
                style={{ width: 32, height: 32, border: "1px solid var(--border)", borderRadius: 8, fontSize: 16, cursor: "pointer" }}
                onClick={() => {
                  let y = Number(currentYear);
                  const sorted = [...selectedMonths].sort();
                  if (sorted.length > 0) {
                    const [sy, sm] = sorted[sorted.length - 1].split("-").map(Number);
                    const next = sm === 12 ? `${sy + 1}-01` : `${sy}-${String(sm + 1).padStart(2, "0")}`;
                    const nextYear = sm === 12 ? String(sy + 1) : String(sy);
                    setCurrentYear(nextYear);
                    setSelectedMonths(new Set([next]));
                  } else {
                    y += 1;
                    setCurrentYear(String(y));
                    setSelectedMonths(new Set([`${y}-01`]));
                  }
                }}
              >
                ▶
              </button>
            </div>
            {/* 월 선택 그리드 */}
            <div className="month-tabs">
              {Array.from({ length: 12 }).map((_, idx) => {
                const monthNum = idx + 1;
                const monthPart = String(monthNum).padStart(2, "0");
                const key = `${currentYear}-${monthPart}`;
                const hasData = availableMonthsForCurrentYear.includes(key);
                const isActive = selectedMonths.has(key);
                return (
                  <button
                    key={key}
                    type="button"
                    className={`month-tab ${isActive ? "active" : ""} ${
                      !hasData ? "empty" : ""
                    }`}
                    onClick={() => {
                      setSelectedMonths((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) {
                          next.delete(key);
                        } else {
                          next.add(key);
                        }
                        return next;
                      });
                    }}
                  >
                    {monthNum}월
                  </button>
                );
              })}
            </div>
            {selectedMonths.size === 0 && (
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, marginBottom: 0 }}>
                월을 선택하면 해당 월만 표시됩니다. 선택 없음 시 전체 기간이 표시됩니다.
              </p>
            )}
          </>
        )}

      {viewMode === "all" && !isBatchEditMode && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
          <strong>Shift+드래그</strong>로 구간 토글(선택된 건 해제), <strong>Shift+클릭</strong>으로 1건 토글. 합계는 아래에 고정 표시됩니다.
        </p>
      )}
      {dragSumStartIndex != null && (
        <div
          style={{
            marginBottom: 8,
            padding: "10px 14px",
            background: "var(--primary-light)",
            borderRadius: 8,
            border: "2px solid var(--primary)",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--primary)"
          }}
        >
          선택 중: {Math.min(dragSumStartIndex, dragSumEndIndex ?? dragSumStartIndex) + 1}행 ~ {Math.max(dragSumStartIndex, dragSumEndIndex ?? dragSumStartIndex) + 1}행 (
          {Math.abs((dragSumEndIndex ?? dragSumStartIndex) - dragSumStartIndex) + 1}건) — 마우스를 놓으면 구간 선택/해제(토글)
        </div>
      )}
      {sumResultFromSelection != null && (
        <div
          style={{
            marginBottom: 12,
            padding: "14px 18px",
            background: "var(--surface)",
            borderRadius: 10,
            border: "2px solid var(--primary)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.08)"
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
                선택 {sumResultFromSelection.count}건 합계
              </span>
              {sumResultFromSelection.incomeSum > 0 && (
                <span style={{ fontSize: 13, color: "var(--success)", fontWeight: 600 }}>수입 {formatKRW(sumResultFromSelection.incomeSum)}</span>
              )}
              {sumResultFromSelection.expenseSum > 0 && (
                <span style={{ fontSize: 13, color: "var(--danger)", fontWeight: 600 }}>지출 {formatKRW(sumResultFromSelection.expenseSum)}</span>
              )}
              {sumResultFromSelection.transferSum > 0 && (
                <span style={{ fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>이체 {formatKRW(sumResultFromSelection.transferSum)}</span>
              )}
              <span style={{ fontSize: 14, fontWeight: 800, color: sumResultFromSelection.net >= 0 ? "var(--primary)" : "var(--danger)" }}>
                순합계 {formatKRW(sumResultFromSelection.net)}
              </span>
            </div>
            <button
              type="button"
              className="secondary"
              onClick={() => setSelectedLedgerIdsForSum(new Set())}
              style={{ fontSize: 12, padding: "6px 12px" }}
            >
              선택 해제
            </button>
          </div>
        </div>
      )}
      {filteredLedger.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8, gap: 8 }}>
          <button
            type="button"
            className="secondary"
            onClick={scrollToLedgerTop}
            style={{ fontSize: 12, padding: "6px 12px" }}
            title="목록 맨 위로 스크롤"
          >
            목록 맨 위로
          </button>
        </div>
      )}
      <div ref={ledgerScrollRef} style={{ overflowX: "hidden" }}>
        <div key={ledgerScrollKey}>
        <table ref={ledgerTableRef} className="data-table ledger-table" style={{ width: "100%", minWidth: 0, tableLayout: "fixed" }}>
          <colgroup>
            {isBatchEditMode && <col key="cb" style={{ width: "40px" }} />}
            {widthsForRender.map((width, index) => {
              const workColPx = 168;
              if (index === 10) {
                return <col key={index} style={{ width: `${workColPx}px` }} />;
              }
              const sumFirst10 = widthsForRender.slice(0, 10).reduce((s, w) => s + w, 0);
              const pct = sumFirst10 > 0 ? (width / sumFirst10) * 100 : 100 / 10;
              return <col key={index} style={{ width: `calc((100% - ${workColPx}px) * ${pct / 100})` }} />;
            })}
          </colgroup>
          <thead>
          <tr>
            {isBatchEditMode && (
              <th style={{ width: "40px", minWidth: "40px" }}>
                <input
                  type="checkbox"
                  checked={selectedLedgerIds.size === filteredLedger.length && filteredLedger.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedLedgerIds(new Set(filteredLedger.map((l) => l.id)));
                    } else {
                      setSelectedLedgerIds(new Set());
                    }
                  }}
                  title="전체 선택/해제"
                />
              </th>
            )}
            <th className="ledger-col-date" style={{ position: "relative", width: ledgerColumnWidthStyles[0] }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("date")}>
                날짜 <span className="arrow">{sortIndicator(ledgerSort.key, "date", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 0)}
                onPointerDown={(e) => handleResizeStart(e, 0)}
                title="컬럼 너비 조절"
              />
            </th>
            <th style={{ position: "relative", width: ledgerColumnWidthStyles[1] }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("category")}>
                대분류 <span className="arrow">{sortIndicator(ledgerSort.key, "category", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 1)}
                onPointerDown={(e) => handleResizeStart(e, 1)}
                title="컬럼 너비 조절"
              />
            </th>
            <th style={{ position: "relative", width: ledgerColumnWidthStyles[2] }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("subCategory")}>
                중분류 <span className="arrow">{sortIndicator(ledgerSort.key, "subCategory", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 2)}
                onPointerDown={(e) => handleResizeStart(e, 2)}
                title="컬럼 너비 조절"
              />
            </th>
            <th style={{ position: "relative", width: ledgerColumnWidthStyles[3] }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("detailCategory")}>
                소분류 <span className="arrow">{sortIndicator(ledgerSort.key, "detailCategory", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 3)}
                onPointerDown={(e) => handleResizeStart(e, 3)}
                title="컬럼 너비 조절"
              />
            </th>
            <th style={{ position: "relative", width: ledgerColumnWidthStyles[4] }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("description")}>
                상세내역 <span className="arrow">{sortIndicator(ledgerSort.key, "description", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 4)}
                onPointerDown={(e) => handleResizeStart(e, 4)}
                title="컬럼 너비 조절"
              />
            </th>
            <th style={{ position: "relative", width: ledgerColumnWidthStyles[5] }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("fromAccountId")}>
                출금 <span className="arrow">{sortIndicator(ledgerSort.key, "fromAccountId", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 5)}
                onPointerDown={(e) => handleResizeStart(e, 5)}
                title="컬럼 너비 조절"
              />
            </th>
            <th style={{ position: "relative", width: ledgerColumnWidthStyles[6] }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("toAccountId")}>
                입금 <span className="arrow">{sortIndicator(ledgerSort.key, "toAccountId", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 6)}
                onPointerDown={(e) => handleResizeStart(e, 6)}
                title="컬럼 너비 조절"
              />
            </th>
            <th style={{ position: "relative", width: ledgerColumnWidthStyles[7] }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("grossAmount")}>
                할인 전 <span className="arrow">{sortIndicator(ledgerSort.key, "grossAmount", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 7)}
                onPointerDown={(e) => handleResizeStart(e, 7)}
                title="컬럼 너비 조절"
              />
            </th>
            <th style={{ position: "relative", width: ledgerColumnWidthStyles[8] }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("discountAmount")}>
                할인 <span className="arrow">{sortIndicator(ledgerSort.key, "discountAmount", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 8)}
                onPointerDown={(e) => handleResizeStart(e, 8)}
                title="컬럼 너비 조절"
              />
            </th>
            <th style={{ position: "relative", width: ledgerColumnWidthStyles[9] }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("amount")}>
                최종 <span className="arrow">{sortIndicator(ledgerSort.key, "amount", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 9)}
                onPointerDown={(e) => handleResizeStart(e, 9)}
                title="컬럼 너비 조절"
              />
            </th>
            <th style={{ position: "relative", width: ledgerColumnWidthStyles[10] }}>
              작업
            </th>
          </tr>
        </thead>
        <tbody>
          {filteredLedger.slice(listPage * PAGE_SIZE, (listPage + 1) * PAGE_SIZE).map((l, index) => {
            const isDraggingRange =
              dragSumStartIndex != null &&
              index >= Math.min(dragSumStartIndex, dragSumEndIndex ?? dragSumStartIndex) &&
              index <= Math.max(dragSumStartIndex, dragSumEndIndex ?? dragSumStartIndex);
            const isInSumSelection = selectedLedgerIdsForSum.has(l.id);
            const isInDragSumRange = isDraggingRange || isInSumSelection;
            const balanceKey = (l as LedgerDisplayRow)._tradeId ?? l.id;
            return (
            <tr
              key={l.id}
              data-ledger-id={l.id}
              draggable={viewMode === "all" && !isBatchEditMode && !(l as LedgerDisplayRow)._tradeId}
              onMouseDown={(e) => {
                if (e.shiftKey && viewMode === "all" && !isBatchEditMode) {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDragSumStart(index);
                }
              }}
              onClick={(e) => {
                if (e.shiftKey && viewMode === "all" && !isBatchEditMode) {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelectedLedgerIdsForSum((prev) => {
                    const next = new Set(prev);
                    if (next.has(l.id)) next.delete(l.id);
                    else next.add(l.id);
                    return next;
                  });
                }
              }}
              onDragStart={(e) => {
                if (e.shiftKey) {
                  e.preventDefault();
                  return;
                }
                if (viewMode !== "all" || isBatchEditMode) return;
                setDraggingId(l.id);
              }}
              onDragOver={(e) => {
                if (viewMode !== "all") return;
                e.preventDefault();
              }}
              onDrop={(e) => {
                if (viewMode !== "all") return;
                e.preventDefault();
                if (draggingId && draggingId !== l.id && !(l as LedgerDisplayRow)._tradeId) {
                  const targetLedgerIndex = ledger.findIndex((x) => x.id === l.id);
                  if (targetLedgerIndex >= 0) handleReorder(draggingId, targetLedgerIndex);
                }
                setDraggingId(null);
              }}
              onDragEnd={() => setDraggingId(null)}
              style={
                isInDragSumRange
                  ? {
                      backgroundColor: "var(--primary-light)",
                      outline: isInSumSelection ? "2px solid var(--primary)" : undefined,
                      outlineOffset: -1
                    }
                  : undefined
              }
            >
              {isBatchEditMode && (
                <td style={{ width: "40px", minWidth: "40px" }}>
                  {(l as LedgerDisplayRow)._tradeId ? (
                    <span style={{ color: "var(--text-muted)", fontSize: 11 }}>주식</span>
                  ) : (
                    <input
                      type="checkbox"
                      checked={selectedLedgerIds.has(l.id)}
                      onChange={(e) => {
                        const newSet = new Set(selectedLedgerIds);
                        if (e.target.checked) {
                          newSet.add(l.id);
                        } else {
                          newSet.delete(l.id);
                        }
                        setSelectedLedgerIds(newSet);
                      }}
                    />
                  )}
                </td>
              )}
              <td
                className="ledger-col-date"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(l.id, "date", l.date);
                }}
                style={{ cursor: "pointer", position: "relative", width: ledgerColumnWidthStyles[0] }}
                title="더블클릭하여 수정"
              >
                {editingField?.id === l.id && editingField.field === "date" ? (
                  <>
                    {viewMode === "all" && (
                      <span style={{ position: "absolute", left: "4px", color: "var(--muted)", fontSize: "12px" }}>=</span>
                    )}
                    <input
                      type="date"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onBlur={saveEditField}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEditField();
                        if (e.key === "Escape") cancelEditField();
                      }}
                      autoFocus
                      style={{ width: "100%", padding: "4px", fontSize: 14, marginLeft: viewMode === "all" ? "16px" : "0" }}
                    />
                  </>
                ) : (
                  <>
                    {viewMode === "all" && (
                      <span style={{ position: "absolute", left: "4px", color: "var(--muted)", fontSize: "12px" }}>=</span>
                    )}
                    <span style={{ marginLeft: viewMode === "all" ? "16px" : "0" }}>
                      {formatShortDate(l.date)}
                    </span>
                  </>
                )}
              </td>
              <td
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(l.id, "category", l.category);
                }}
                style={{ cursor: "pointer", width: ledgerColumnWidthStyles[1] }}
                title={l.category ? l.category + " (더블클릭하여 수정)" : "더블클릭하여 수정"}
              >
                {editingField?.id === l.id && editingField.field === "category" ? (
                  <select
                    className="ledger-cell-select"
                    value={editingValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      let updated: LedgerEntry = { ...l, category: v, subCategory: undefined };
                      // 대분류에 따라 kind 자동 변경
                      if (v === "이체") {
                        updated = { ...updated, kind: "transfer" };
                      } else if (v === "수입") {
                        updated = { ...updated, kind: "income" };
                      } else {
                        updated = { ...updated, kind: "expense" };
                      }
                      onChangeLedger(ledger.map((x) => (x.id === l.id ? updated : x)));
                      // 대분류 변경 후 바로 중분류 편집으로 이동
                      startEditField(l.id, "subCategory", "");
                      setEditingValue("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") cancelEditField();
                    }}
                    autoFocus
                    style={{ width: "100%" }}
                  >
                    {(() => {
                      const mainCats = ["수입", "지출", "재테크", "이체", "신용결제"];
                      const current = l.category?.trim();
                      const hasCurrent = current && !mainCats.includes(current);
                      const options = hasCurrent ? [current, ...mainCats] : mainCats;
                      return options.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ));
                    })()}
                  </select>
                ) : (
                  l.category
                )}
              </td>
              <td
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(l.id, "subCategory", l.subCategory || "");
                }}
                style={{ cursor: "pointer", width: ledgerColumnWidthStyles[2] }}
                title={l.subCategory ? l.subCategory + " (더블클릭하여 수정)" : "더블클릭하여 수정"}
              >
                {editingField?.id === l.id && editingField.field === "subCategory" ? (
                  <select
                    className="ledger-cell-select"
                    value={editingValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      const updated = { ...l, subCategory: v || undefined };
                      onChangeLedger(ledger.map((x) => (x.id === l.id ? updated : x)));
                      setEditingField(null);
                      setEditingValue("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") cancelEditField();
                    }}
                    autoFocus
                    style={{ width: "100%" }}
                  >
                    <option value="">-</option>
                    {(() => {
                      const cat = l.category?.trim();
                      let subs: string[] = [];
                      if (cat === "수입") {
                        subs = categoryPresets?.income ?? [];
                      } else if (cat === "이체") {
                        subs = categoryPresets?.transfer ?? [];
                      } else if (cat === "지출") {
                        // 지출 대분류 → 중분류 = 지출 세부 카테고리 전체
                        subs = (categoryPresets?.expenseDetails ?? []).map((g) => g.main);
                      } else if (cat === "신용결제") {
                        subs = ["카드대금", "할부금"];
                      } else {
                        // 재테크 등 expenseDetails에서 직접 매칭
                        const g = (categoryPresets?.expenseDetails ?? []).find((x) => x.main === cat);
                        subs = g?.subs ?? [];
                      }
                      const current = l.subCategory?.trim();
                      const hasCurrent = current && !subs.includes(current);
                      const options = hasCurrent ? [current, ...subs] : subs;
                      return options.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ));
                    })()}
                  </select>
                ) : (
                  l.subCategory ?? "-"
                )}
              </td>
              <td
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(l.id, "detailCategory", l.detailCategory || "");
                }}
                style={{ cursor: "pointer", width: ledgerColumnWidthStyles[3] }}
                title={l.detailCategory ? l.detailCategory + " (더블클릭하여 수정)" : "더블클릭하여 수정"}
              >
                {editingField?.id === l.id && editingField.field === "detailCategory" ? (
                  <select
                    className="ledger-cell-select"
                    value={editingValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      const updated = { ...l, detailCategory: v || undefined };
                      onChangeLedger(ledger.map((x) => (x.id === l.id ? updated : x)));
                      setEditingField(null);
                      setEditingValue("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") cancelEditField();
                    }}
                    autoFocus
                    style={{ width: "100%" }}
                  >
                    <option value="">-</option>
                    {(() => {
                      const sub = l.subCategory?.trim();
                      // 중분류에 해당하는 소분류 목록 (expenseDetails에서 검색)
                      const g = (categoryPresets?.expenseDetails ?? []).find((x) => x.main === sub);
                      const subs = g?.subs ?? [];
                      const current = l.detailCategory?.trim();
                      const hasCurrent = current && !subs.includes(current);
                      const options = hasCurrent ? [current, ...subs] : subs;
                      return options.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ));
                    })()}
                  </select>
                ) : (
                  l.detailCategory ?? "-"
                )}
              </td>
              <td
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(l.id, "description", l.description || "");
                }}
                style={{ cursor: "pointer", whiteSpace: "normal", wordBreak: "break-word", width: ledgerColumnWidthStyles[4] }}
                title={l.description ? l.description + " (더블클릭하여 수정)" : "더블클릭하여 수정"}
              >
                {editingField?.id === l.id && editingField.field === "description" ? (
                  <input
                    type="text"
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onBlur={saveEditField}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEditField();
                      if (e.key === "Escape") cancelEditField();
                    }}
                    autoFocus
                    style={{ width: "100%", padding: "4px", fontSize: 14 }}
                  />
                ) : (
                  l.description || "-"
                )}
              </td>
              <td
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(l.id, "fromAccountId", l.fromAccountId || "");
                }}
                style={{ cursor: "pointer", width: ledgerColumnWidthStyles[5] }}
                title={l.fromAccountId ? l.fromAccountId + " (더블클릭하여 수정)" : "더블클릭하여 수정"}
              >
                {editingField?.id === l.id && editingField.field === "fromAccountId" ? (
                  <select
                    className="ledger-cell-select"
                    value={editingValue}
                    onChange={(e) => {
                      setEditingValue(e.target.value);
                      const entry = ledger.find((l) => l.id === editingField.id);
                      if (entry) {
                        const updated = { ...entry, fromAccountId: e.target.value || undefined };
                        onChangeLedger(ledger.map((l) => (l.id === editingField.id ? updated : l)));
                        setEditingField(null);
                        setEditingValue("");
                      }
                    }}
                    autoFocus
                    style={{ width: "100%" }}
                  >
                    <option value="">-</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.id}
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    <div>{l.fromAccountId ?? "-"}</div>
                    {l.fromAccountId && balanceAfterByLedgerId.get(balanceKey)?.from && (() => {
                      const fromAcc = accounts.find((a) => a.id === l.fromAccountId);
                      const isUsd = l.currency === "USD" || fromAcc?.currency === "USD";
                      const fmt = (n: number) => isUsd ? formatUSD(n) : formatKRW(Math.round(n));
                      const info = balanceAfterByLedgerId.get(balanceKey)!.from!;
                      return (
                        <div
                          style={{
                            fontSize: 10,
                            color: info.amount >= 0 ? "var(--danger)" : "var(--primary)",
                            marginTop: 2
                          }}
                        >
                          {info.amount >= 0 ? "+" : ""}{fmt(info.amount)} · {fmt(info.balance)}
                        </div>
                      );
                    })()}
                  </>
                )}
              </td>
              <td
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(l.id, "toAccountId", l.toAccountId || "");
                }}
                style={{ cursor: "pointer", width: ledgerColumnWidthStyles[6] }}
                title={l.toAccountId ? l.toAccountId + " (더블클릭하여 수정)" : "더블클릭하여 수정"}
              >
                {editingField?.id === l.id && editingField.field === "toAccountId" ? (
                  <select
                    className="ledger-cell-select"
                    value={editingValue}
                    onChange={(e) => {
                      setEditingValue(e.target.value);
                      const entry = ledger.find((l) => l.id === editingField.id);
                      if (entry) {
                        const updated = { ...entry, toAccountId: e.target.value || undefined };
                        onChangeLedger(ledger.map((l) => (l.id === editingField.id ? updated : l)));
                        setEditingField(null);
                        setEditingValue("");
                      }
                    }}
                    autoFocus
                    style={{ width: "100%" }}
                  >
                    <option value="">-</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.id}
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    <div>{l.toAccountId ?? "-"}</div>
                    {l.toAccountId && balanceAfterByLedgerId.get(balanceKey)?.to && (() => {
                      const toAcc = accounts.find((a) => a.id === l.toAccountId);
                      const isUsd = l.currency === "USD" || toAcc?.currency === "USD";
                      const fmt = (n: number) => isUsd ? formatUSD(n) : formatKRW(Math.round(n));
                      const info = balanceAfterByLedgerId.get(balanceKey)!.to!;
                      return (
                        <div
                          style={{
                            fontSize: 10,
                            color: info.amount >= 0 ? "var(--danger)" : "var(--primary)",
                            marginTop: 2
                          }}
                        >
                          {info.amount >= 0 ? "+" : ""}{fmt(info.amount)} · {fmt(info.balance)}
                        </div>
                      );
                    })()}
                  </>
                )}
              </td>
              <td
                className="number"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if ((l as LedgerDisplayRow)._tradeId) {
                    toast("주식 거래는 주식 탭에서 수정하세요.");
                    return;
                  }
                  startEditField(l.id, "grossAmount", ledgerEntryGross(l));
                }}
                style={{ cursor: "pointer", width: ledgerColumnWidthStyles[7] }}
                title="할인 적용 전 금액 · 더블클릭하여 수정"
              >
                {editingField?.id === l.id && editingField.field === "grossAmount" ? (
                  <input
                    type="text"
                    inputMode={l.currency === "USD" ? "decimal" : "numeric"}
                    value={editingValue}
                    onChange={(e) => {
                      const re = l.currency === "USD" ? /[^\d.]/g : /[^\d]/g;
                      setEditingValue(e.target.value.replace(re, ""));
                    }}
                    onBlur={saveEditField}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEditField();
                      if (e.key === "Escape") cancelEditField();
                    }}
                    autoFocus
                    style={{ width: "100%", padding: "4px", fontSize: 14 }}
                  />
                ) : l.currency === "USD" ? (
                  formatUSD(ledgerEntryGross(l))
                ) : (
                  Math.round(ledgerEntryGross(l)).toLocaleString()
                )}
              </td>
              <td
                className="number"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if ((l as LedgerDisplayRow)._tradeId) {
                    toast("주식 거래는 주식 탭에서 수정하세요.");
                    return;
                  }
                  if (l.kind !== "income" && l.kind !== "expense") {
                    toast("할인은 수입·지출만 수정할 수 있습니다.");
                    return;
                  }
                  const cur =
                    (l.discountAmount ?? 0) > 0
                      ? l.currency === "USD"
                        ? String(l.discountAmount)
                        : String(Math.round(l.discountAmount!))
                      : "";
                  startEditField(l.id, "discountAmount", cur);
                }}
                style={{ cursor: "pointer", width: ledgerColumnWidthStyles[8], color: "var(--text-muted)" }}
                title="할인액 · 더블클릭하여 수정"
              >
                {editingField?.id === l.id && editingField.field === "discountAmount" ? (
                  <input
                    type="text"
                    inputMode={l.currency === "USD" ? "decimal" : "numeric"}
                    value={editingValue}
                    onChange={(e) => {
                      const re = l.currency === "USD" ? /[^\d.]/g : /[^\d]/g;
                      setEditingValue(e.target.value.replace(re, ""));
                    }}
                    onBlur={saveEditField}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEditField();
                      if (e.key === "Escape") cancelEditField();
                    }}
                    autoFocus
                    style={{ width: "100%", padding: "4px", fontSize: 14 }}
                  />
                ) : (l.discountAmount ?? 0) > 0 ? (
                  l.currency === "USD" ? (
                    formatUSD(l.discountAmount!)
                  ) : (
                    Math.round(l.discountAmount!).toLocaleString()
                  )
                ) : (
                  "—"
                )}
              </td>
              <td
                className="number"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(l.id, "amount", l.amount);
                }}
                style={{ cursor: "pointer", width: ledgerColumnWidthStyles[9], fontWeight: 600 }}
                title="할인 반영 후 금액 · 더블클릭하여 수정"
              >
                {editingField?.id === l.id && editingField.field === "amount" ? (
                  <input
                    type="text"
                    inputMode={l.currency === "USD" ? "decimal" : "numeric"}
                    value={editingValue}
                    onChange={(e) => {
                      const re = l.currency === "USD" ? /[^\d.]/g : /[^\d]/g;
                      setEditingValue(e.target.value.replace(re, ""));
                    }}
                    onBlur={saveEditField}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEditField();
                      if (e.key === "Escape") cancelEditField();
                    }}
                    autoFocus
                    style={{ width: "100%", padding: "4px", fontSize: 14 }}
                  />
                ) : (
                  l.currency === "USD"
                    ? formatUSD(l.amount)
                    : Math.round(l.amount).toLocaleString()
                )}
              </td>
              <td style={{ width: ledgerColumnWidthStyles[10] }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={(e) => {
                    e.stopPropagation();
                    if ((l as LedgerDisplayRow)._tradeId) {
                      toast("주식 거래는 복사할 수 없습니다.");
                      return;
                    }
                    startCopy(l);
                  }}>
                    복사
                  </button>
                  <button 
                    type="button" 
                    className="danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      if ((l as LedgerDisplayRow)._tradeId) {
                        toast("주식 거래는 주식 탭에서 삭제하세요.");
                        return;
                      }
                      if (confirm("이 항목을 삭제하시겠습니까?")) {
                        onChangeLedger(ledger.filter((entry) => entry.id !== l.id));
                      }
                    }}
                  >
                    삭제
                  </button>
                </div>
              </td>
            </tr>
            );
          })}
        </tbody>
        </table>
        </div>
      </div>
      {filteredLedger.length === 0 && (
        <p>
          {viewMode === "all"
            ? "아직 거래가 없습니다. 위 폼에서 첫 거래를 입력해 보세요."
            : "이 달에는 내역이 없습니다."}
        </p>
      )}
      {filteredLedger.length > 0 && (
        <div style={{ marginTop: "8px", fontSize: "14px", color: "var(--text-muted)" }}>
          총 {filteredLedger.length}건
        </div>
      )}
      {filteredLedger.length > PAGE_SIZE && (
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 12 }}>
          <button type="button" className="secondary" disabled={listPage === 0} onClick={() => setListPage(p => p - 1)} style={{ padding: "6px 16px" }}>
            ← 이전
          </button>
          <span style={{ padding: "6px 12px", fontSize: 13 }}>
            {listPage + 1} / {Math.ceil(filteredLedger.length / PAGE_SIZE)} 페이지
          </span>
          <button type="button" className="secondary" disabled={(listPage + 1) * PAGE_SIZE >= filteredLedger.length} onClick={() => setListPage(p => p + 1)} style={{ padding: "6px 16px" }}>
            다음 →
          </button>
        </div>
      )}

    </div>
  );
};
