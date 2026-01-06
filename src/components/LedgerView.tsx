import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { Autocomplete } from "./Autocomplete";
import { AdvancedSearch } from "./AdvancedSearch";
import type { Account, CategoryPresets, ExpenseDetailGroup, LedgerEntry, LedgerKind, LedgerTemplate } from "../types";
import { formatShortDate, formatUSD, formatKRW } from "../utils/format";
import { shortcutManager, type ShortcutAction } from "../utils/shortcuts";
import { recommendCategory } from "../utils/categoryRecommendation";
import { parseCSV, convertToLedgerEntries } from "../utils/csvParser";
import * as XLSX from "xlsx";
import { validateAmount, validateDate, validateRequired, validateTransfer } from "../utils/validation";
import { toast } from "react-hot-toast";

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  categoryPresets: CategoryPresets;
  onChangeLedger: (next: LedgerEntry[]) => void;
  templates?: LedgerTemplate[];
  onChangeTemplates?: (next: LedgerTemplate[]) => void;
  copyRequest?: LedgerEntry | null;
  onCopyComplete?: () => void;
}

const KIND_LABEL: Record<LedgerKind, string> = {
  income: "수입",
  expense: "지출",
  transfer: "이체"
};

type LedgerTab = "income" | "expense" | "savingsExpense" | "transfer";

// 한국 시간을 얻는 헬퍼 함수
function getKoreaTime(): Date {
  const now = new Date();
  // 한국 시간대 오프셋: UTC+9
  const koreaOffset = 9 * 60; // 분 단위
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utcTime + (koreaOffset * 60000));
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
  tags: string[];
} {
  // 한국 시간 기준으로 날짜 생성
  const koreaTime = getKoreaTime();
  const year = koreaTime.getFullYear();
  const month = String(koreaTime.getMonth() + 1).padStart(2, "0");
  const day = String(koreaTime.getDate()).padStart(2, "0");
  return {
    id: undefined,
    date: `${year}-${month}-${day}`,
    kind: "income",
    isFixedExpense: false,
    mainCategory: "",
    subCategory: "",
    description: "",
    fromAccountId: "",
    toAccountId: "",
    amount: "",
    tags: []
  };
}

export const LedgerView: React.FC<Props> = ({
  accounts,
  ledger,
  categoryPresets,
  onChangeLedger,
  templates = [],
  onChangeTemplates,
  copyRequest,
  onCopyComplete
}) => {
  const [form, setForm] = useState(createDefaultForm);
  // 기본값을 월별 보기로 설정하여 성능 최적화
  const [viewMode, setViewMode] = useState<"all" | "monthly">("monthly");
  // 페이징 상태
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  // 기본 탭을 지출로 설정해 입력 흐름을 간소화
  const [ledgerTab, setLedgerTab] = useState<LedgerTab>("expense");
  const isCopyingRef = useRef(false);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    // 한국 시간 기준으로 현재 월 계산
    const now = new Date();
    const koreaOffset = 9 * 60; // 분 단위 (UTC+9)
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    const koreaTime = new Date(utcTime + (koreaOffset * 60000));
    return `${koreaTime.getFullYear()}-${String(koreaTime.getMonth() + 1).padStart(2, "0")}`;
  });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<LedgerTemplate | null>(null);
  const [editingField, setEditingField] = useState<{ id: string; field: string } | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false);
  const [advancedSearchQuery, setAdvancedSearchQuery] = useState<{
    keyword: string;
    startDate?: string;
    endDate?: string;
    minAmount?: number;
    maxAmount?: number;
    accountIds?: string[];
    categories?: string[];
    kinds?: ("income" | "expense" | "transfer")[];
    tags?: string[];
  }>({ keyword: "" });
  const [savedFilters, setSavedFilters] = useState<
    { id: string; name: string; query: typeof advancedSearchQuery }[]
  >(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("fw-ledger-saved-filters");
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return [];
  });
  // 정렬 상태
  type LedgerSortKey = "date" | "category" | "subCategory" | "description" | "fromAccountId" | "toAccountId" | "amount";
  const [ledgerSort, setLedgerSort] = useState<{ key: LedgerSortKey; direction: "asc" | "desc" }>({
    key: "date",
    direction: "desc"
  });
  
  // 컬럼 너비 상태 (localStorage에서 로드, 순서/구분 컬럼 제거로 8개)
  const [columnWidths, setColumnWidths] = useState<number[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("ledger-column-widths");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            // 기존 10개 배열이면 첫 번째(순서), 두 번째(구분) 제거하고 8개로 변환
            if (parsed.length === 10) {
              const newWidths = parsed.slice(2); // 첫 번째, 두 번째 컬럼 제거
              const total = newWidths.reduce((sum, w) => sum + w, 0);
              return newWidths.map(w => w * (100 / total)); // 100%로 재조정
            }
            // 기존 9개 배열이면 두 번째(구분) 제거하고 8개로 변환
            if (parsed.length === 9) {
              const newWidths = [...parsed.slice(0, 1), ...parsed.slice(2)]; // 두 번째 컬럼 제거
              const total = newWidths.reduce((sum, w) => sum + w, 0);
              return newWidths.map(w => w * (100 / total)); // 100%로 재조정
            }
            // 이미 8개면 그대로 사용
            if (parsed.length === 8) {
              return parsed;
            }
          }
        } catch (e) {
          // 파싱 실패 시 기본값 사용
        }
      }
    }
    // 최적화된 컬럼 너비: 날짜, 대분류, 항목, 상세내역, 출금, 입금, 금액, 작업
    // 더 넓고 읽기 좋은 비율로 조정
    return [10, 12, 12, 28, 11, 11, 13, 3];
  });
  const [resizingColumn, setResizingColumn] = useState<number | null>(null);
  const [resizeStartX, setResizeStartX] = useState(0);
  const [resizeStartWidth, setResizeStartWidth] = useState(0);
  
  // 폼 검증 오류는 validateForm useMemo에서 직접 계산됨
  
  // 즐겨찾기 카테고리 상태
  const [favoriteCategories, setFavoriteCategories] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("fw-favorite-categories");
        if (saved) return new Set(JSON.parse(saved));
      } catch {}
    }
    return new Set();
  });
  
  // 즐겨찾기 계좌 상태
  const [favoriteAccounts, setFavoriteAccounts] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("fw-favorite-accounts");
        if (saved) return new Set(JSON.parse(saved));
      } catch {}
    }
    return new Set();
  });
  
  // 즐겨찾기 카테고리 목록
  const favoriteCategoryList = useMemo(() => {
    if (ledgerTab === "income") {
      return categoryPresets.income.filter((c) => favoriteCategories.has(c));
    } else if (ledgerTab === "transfer") {
      return categoryPresets.transfer.filter((c) => favoriteCategories.has(c));
    } else {
      return categoryPresets.expense.filter((c) => favoriteCategories.has(c));
    }
  }, [ledgerTab, categoryPresets, favoriteCategories]);
  
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
  
  // 컬럼 너비 변경 시 localStorage에 저장
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("ledger-column-widths", JSON.stringify(columnWidths));
    }
  }, [columnWidths]);
  
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
  
  // 컬럼 리사이즈 핸들러
  const handleResizeStart = (e: React.MouseEvent, columnIndex: number) => {
    e.preventDefault();
    setResizingColumn(columnIndex);
    setResizeStartX(e.clientX);
    setResizeStartWidth(columnWidths[columnIndex]);
  };
  
  useEffect(() => {
    if (resizingColumn === null) return;
    
    const handleMouseMove = (e: MouseEvent) => {
      const table = document.querySelector(".data-table") as HTMLElement;
      if (!table) return;
      
      const tableWidth = table.offsetWidth;
      const deltaX = e.clientX - resizeStartX;
      const deltaPercent = (deltaX / tableWidth) * 100;
      
      const newWidths = [...columnWidths];
      const newWidth = Math.max(3, Math.min(30, resizeStartWidth + deltaPercent));
      newWidths[resizingColumn] = newWidth;
      
      // 총합이 100%가 되도록 조정
      const total = newWidths.reduce((sum, w) => sum + w, 0);
      if (total > 0) {
        const scale = 100 / total;
        const adjustedWidths = newWidths.map(w => w * scale);
        setColumnWidths(adjustedWidths);
        // localStorage에 즉시 저장
        if (typeof window !== "undefined") {
          localStorage.setItem("ledger-column-widths", JSON.stringify(adjustedWidths));
        }
      }
    };
    
    const handleMouseUp = () => {
      setResizingColumn(null);
    };
    
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizingColumn, resizeStartX, resizeStartWidth, columnWidths]);
  
  // 고정지출 자동 생성: 이전 달의 고정지출을 현재 달로 복사
  useEffect(() => {
    // 한국 시간 기준으로 계산
    const koreaTime = getKoreaTime();
    const currentMonth = `${koreaTime.getFullYear()}-${String(koreaTime.getMonth() + 1).padStart(2, "0")}`;
    const currentDay = String(koreaTime.getDate()).padStart(2, "0");
    
    // 이전 달 계산
    const prevMonthDate = new Date(koreaTime.getFullYear(), koreaTime.getMonth() - 1, 1);
    const prevMonth = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, "0")}`;
    
    // 현재 달의 고정지출 확인
    const currentMonthFixed = ledger.filter(
      (l) => l.isFixedExpense && l.date.startsWith(currentMonth)
    );
    
    // 이전 달의 고정지출 확인
    const prevMonthFixed = ledger.filter(
      (l) => l.isFixedExpense && l.date.startsWith(prevMonth)
    );
    
    // 이전 달의 고정지출이 있고, 현재 달에 해당하는 항목이 없으면 생성
    if (prevMonthFixed.length > 0 && currentMonthFixed.length === 0) {
      const newEntries: LedgerEntry[] = prevMonthFixed.map((prev) => {
        // 날짜를 현재 달의 같은 날짜로 변경 (한국 시간 기준)
        const prevDate = new Date(prev.date);
        const newDate = new Date(koreaTime.getFullYear(), koreaTime.getMonth(), prevDate.getDate());
        const year = newDate.getFullYear();
        const month = String(newDate.getMonth() + 1).padStart(2, "0");
        const day = String(newDate.getDate()).padStart(2, "0");
        const newDateStr = `${year}-${month}-${day}`;
        
        // 같은 내용의 항목이 이미 있는지 확인 (같은 날짜, 같은 카테고리, 같은 금액)
        const exists = ledger.some(
          (l) =>
            l.date === newDateStr &&
            l.category === prev.category &&
            l.subCategory === prev.subCategory &&
            l.amount === prev.amount &&
            l.fromAccountId === prev.fromAccountId
        );
        
        if (exists) return null;
        
        return {
          ...prev,
          id: `L${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          date: newDateStr
        };
      }).filter((e): e is LedgerEntry => e !== null);
      
      if (newEntries.length > 0) {
        onChangeLedger([...newEntries, ...ledger]);
      }
    }
  }, [ledger, onChangeLedger]);
  
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

  // 최근 사용한 세부 항목 추적 (대분류별)
  const recentSubCategories = useMemo(() => {
    if (!form.mainCategory && ledgerTab !== "transfer") return [];
    const items = new Map<string, { count: number; lastUsed: string }>();
    // 이체 탭일 때는 transfer kind의 항목도 포함
    if (ledgerTab === "transfer") {
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
  }, [ledger, form.mainCategory, ledgerTab]);

  // 최근 사용한 수입 항목 추적
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
    // 이체 탭일 때는 transfer 카테고리를 세부 항목으로 사용
    if (ledgerTab === "transfer" && form.mainCategory === "이체") {
      const transferCategories = categoryPresets.transfer || [];
      // 최근 사용한 항목을 앞에 배치
      const recent = recentSubCategories.filter((c) => transferCategories.includes(c));
      const other = transferCategories.filter((s) => !recent.includes(s));
      return [...recent, ...other];
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
        // 해당 대분류의 모든 세부 항목 사용
        suggestions = [...g.subs];
      } else {
        // 대분류에 해당하는 그룹이 없으면 빈 배열 반환
        suggestions = [];
        // 디버깅: 대분류가 있는데 그룹을 찾지 못한 경우
        if (import.meta.env.DEV) {
          console.warn(`[LedgerView] 대분류 "${form.mainCategory}"에 해당하는 세부 항목 그룹을 찾을 수 없습니다.`, {
            availableGroups: groups.map((g) => g.main),
            totalGroups: groups.length,
            categoryPresetsExpenseDetails: categoryPresets.expenseDetails
          });
        }
      }
    } else {
      // 대분류가 선택되지 않았으면 빈 배열 반환
      suggestions = [];
    }
    
    // 중복 제거 및 유효성 검사
    suggestions = Array.from(new Set(suggestions)).filter((s) => s && s.trim().length > 0);
    
    // 최근 사용한 항목을 앞에 배치 (현재 대분류에 해당하는 것만)
    const recent = recentSubCategories.filter((c) => suggestions.includes(c));
    const other = suggestions.filter((s) => !recent.includes(s));
    const result = [...recent, ...other];
    
    // 디버깅: 결과 확인
    if (import.meta.env.DEV && form.mainCategory) {
      console.log(`[LedgerView] 대분류 "${form.mainCategory}"의 세부 항목:`, {
        total: result.length,
        items: result,
        fromPreset: suggestions.length,
        recent: recent.length,
        other: other.length,
        allGroups: groups.map((g) => ({ main: g.main, subsCount: g.subs?.length || 0 }))
      });
    }
    
    return result;
  }, [ledgerTab, categoryPresets, categoryPresets?.expenseDetails, categoryPresets?.transfer, form.mainCategory, recentSubCategories]);

  // 대분류 옵션 (최근 사용한 항목 우선)
  const mainCategoryOptions = useMemo(() => {
    // 이체 탭일 때는 "이체"만 반환 (대분류 고정)
    if (ledgerTab === "transfer") {
      return ["이체"];
    }
    // 지출/저축성 지출 탭일 때는 expense 카테고리 사용
    if (!categoryPresets || !categoryPresets.expense) {
      if (import.meta.env.DEV) {
        console.warn("[LedgerView] categoryPresets.expense가 없습니다.", categoryPresets);
      }
      return [];
    }
    const all = categoryPresets.expense || [];
    const recent = recentMainCategories;
    const other = all.filter((c) => !recent.includes(c));
    const result = [...recent, ...other];
    
    // 디버깅: 대분류 목록 확인
    if (import.meta.env.DEV) {
      console.log("[LedgerView] 대분류 옵션:", {
        total: result.length,
        allCategories: all,
        recent: recent.length,
        other: other.length,
        result: result
      });
    }
    
    return result;
  }, [ledgerTab, categoryPresets, categoryPresets?.expense, recentMainCategories]);

  // 수입 항목 옵션 (최근 사용한 항목 우선)
  const incomeCategoryOptions = useMemo(() => {
    const all = categoryPresets.income || [];
    const recent = recentIncomeCategories;
    const other = all.filter((c) => !recent.includes(c));
    return [...recent, ...other];
  }, [categoryPresets.income, recentIncomeCategories]);

  // parseAmount와 formatAmount를 먼저 정의 (다른 useMemo에서 사용되므로)
  const parseAmount = useCallback((value: string): number => {
    const numeric = value.replace(/[^\d]/g, "");
    if (!numeric) return 0;
    return Number(numeric);
  }, []);

  const formatAmount = useCallback((value: string): string => {
    const numeric = value.replace(/[^\d]/g, "");
    if (!numeric) return "";
    return Math.round(Number(numeric)).toLocaleString();
  }, []);

  // 자동 카테고리 추천
  const categoryRecommendations = useMemo(() => {
    if (!form.description || form.description.length < 2) return [];
    const amount = parseAmount(form.amount);
    if (amount <= 0) return [];
    try {
      return recommendCategory(form.description, amount, form.kind, ledger);
    } catch {
      return [];
    }
  }, [form.description, form.amount, form.kind, ledger]);

  useEffect(() => {
    // 복사 중일 때는 폼을 초기화하지 않음
    if (isCopyingRef.current) {
      // 복사가 완료될 때까지 기다림 - 플래그는 startCopy에서 해제됨
      return;
    }
    
    const kindForTab: LedgerKind =
      ledgerTab === "income" ? "income" : ledgerTab === "transfer" || ledgerTab === "savingsExpense" ? "transfer" : "expense";
    setForm((prev) => ({
      ...prev,
      kind: kindForTab,
      isFixedExpense: false,
      mainCategory: "",
      subCategory: "",
      fromAccountId: kindForTab === "income" ? "" : prev.fromAccountId,
      toAccountId: kindForTab === "expense" ? "" : prev.toAccountId
    }));
  }, [ledgerTab]);

  // 실시간 폼 검증
  const validateForm = useMemo(() => {
    const errors: Record<string, string> = {};
    const kindForTab: LedgerKind =
      ledgerTab === "income" ? "income" : ledgerTab === "transfer" || ledgerTab === "savingsExpense" ? "transfer" : "expense";
    
    // 날짜 검증
    // 주의: 가계부(Ledger)는 미래 날짜를 제한합니다 (현재 날짜까지만 허용)
    // StocksView와 달리 maxDate를 전달하여 미래 날짜 입력을 방지합니다
    // 한국 시간 기준으로 현재 날짜 계산
    const koreaTime = getKoreaTime();
    const todayStr = `${koreaTime.getFullYear()}-${String(koreaTime.getMonth() + 1).padStart(2, "0")}-${String(koreaTime.getDate()).padStart(2, "0")}`;
    const todayDate = new Date(todayStr + "T00:00:00+09:00"); // 한국 시간 기준
    
    const dateValidation = validateDate(form.date, todayDate); // 미래 날짜 제한
    if (!dateValidation.valid) {
      errors.date = dateValidation.error || "";
    }
    
    // 금액 검증 (최소값 제한 제거 - 1원 이상만 허용)
    const parsedAmount = parseAmount(form.amount);
    if (parsedAmount <= 0) {
      if (!form.amount || form.amount.trim() === "") {
        errors.amount = "금액을 입력해주세요";
      } else {
        errors.amount = "금액은 0보다 커야 합니다";
      }
    }
    
    // 계좌 검증
    if (kindForTab === "expense" || kindForTab === "transfer") {
      const fromAccountValidation = validateRequired(form.fromAccountId, "출금 계좌");
      if (!fromAccountValidation.valid) {
        errors.fromAccountId = fromAccountValidation.error || "";
      }
    }
    
    if (kindForTab === "income" || kindForTab === "transfer") {
      const toAccountValidation = validateRequired(form.toAccountId, "입금 계좌");
      if (!toAccountValidation.valid) {
        errors.toAccountId = toAccountValidation.error || "";
      }
    }
    
    // 이체 검증 (출금계좌와 입금계좌가 다른지)
    if (kindForTab === "transfer") {
      const transferValidation = validateTransfer(form.fromAccountId, form.toAccountId);
      if (!transferValidation.valid) {
        errors.transfer = transferValidation.error || "";
      }
    }
    
    // 대분류/세부 항목/상세내역 검증
    if (kindForTab === "income") {
      const subCategoryValidation = validateRequired(form.subCategory, "수입 항목");
      if (!subCategoryValidation.valid) {
        errors.subCategory = subCategoryValidation.error || "";
      }
    } else {
      const mainCategoryValidation = validateRequired(form.mainCategory, "대분류");
      if (!mainCategoryValidation.valid) {
        errors.mainCategory = mainCategoryValidation.error || "";
      }
      const subCategoryValidation = validateRequired(form.subCategory, "세부 항목");
      if (!subCategoryValidation.valid) {
        errors.subCategory = subCategoryValidation.error || "";
      }
    }
    // 상세내역은 선택사항이므로 검증하지 않음
    
    return errors;
  }, [form, ledgerTab, parseAmount]);
  
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
    
    const amount = parseAmount(form.amount);
    if (!form.date || !amount || amount <= 0) return;

    const kindForTab: LedgerKind =
      ledgerTab === "income" ? "income" : ledgerTab === "transfer" || ledgerTab === "savingsExpense" ? "transfer" : "expense";
    const isFixed = false;

    // 카테고리 값 정규화 (빈 문자열 체크)
    const normalizedMainCategory = form.mainCategory?.trim() || "";
    const normalizedSubCategory = form.subCategory?.trim() || "";
    
    const base: Omit<LedgerEntry, "id"> = {
      date: form.date,
      kind: kindForTab,
      isFixedExpense: isFixed,
      category:
        kindForTab === "income"
          ? "수입"
          : normalizedMainCategory || "(미분류)",
      subCategory:
        kindForTab === "income"
          ? normalizedSubCategory || "(미분류)"
          : normalizedSubCategory || "(미분류)",
      description: form.description?.trim() || "",
      amount,
      fromAccountId:
        kindForTab === "expense" || kindForTab === "transfer"
          ? (form.fromAccountId?.trim() || undefined)
          : undefined,
      toAccountId:
        kindForTab === "income" || kindForTab === "transfer"
          ? (form.toAccountId?.trim() || undefined)
          : undefined
    };

    if (form.id) {
      const updated = ledger.map((l) => (l.id === form.id ? { ...base, id: l.id } : l));
      onChangeLedger(updated);
    } else {
      const id = `L${Date.now()}`;
      const entry: LedgerEntry = { id, ...base };
      onChangeLedger([entry, ...ledger]);
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
          amount: ""
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

  const startEdit = (entry: LedgerEntry) => {
    setForm({
      id: entry.id,
      date: entry.date,
      kind: entry.kind,
      isFixedExpense: entry.isFixedExpense ?? false,
      mainCategory: entry.kind === "income" ? "" : entry.category,
      subCategory: entry.subCategory ?? (entry.kind === "income" ? entry.category : ""),
      description: entry.description,
      fromAccountId: entry.fromAccountId ?? "",
      toAccountId: entry.toAccountId ?? "",
      amount: String(entry.amount),
      tags: entry.tags || []
    });
    const nextTab: LedgerTab =
      entry.kind === "income"
        ? "income"
        : entry.kind === "transfer"
          ? "transfer"
          : "expense";
    setLedgerTab(nextTab);
  };

  const startCopy = (entry: LedgerEntry) => {
    try {
      // 저축성 지출 판단: transfer이고 toAccountId가 증권/저축 계좌인 경우
      const isSavingsExpense = entry.kind === "transfer" && entry.toAccountId && 
        accounts.find(a => a.id === entry.toAccountId && (a.type === "securities" || a.type === "savings"));
      
      const nextTab: LedgerTab =
        entry.kind === "income"
          ? "income"
          : isSavingsExpense
            ? "savingsExpense"
            : entry.kind === "transfer"
              ? "transfer"
              : "expense";
      
      // 폼 데이터 준비
      const newForm = {
        id: undefined as string | undefined,
        date: entry.date, // 날짜도 복사
        kind: entry.kind,
        isFixedExpense: entry.isFixedExpense ?? false,
        mainCategory: entry.kind === "income" ? "" : (entry.category || ""),
        subCategory: entry.kind === "income" 
          ? (entry.subCategory || entry.category || "")
          : (entry.subCategory || ""),
        description: entry.description || "",
        fromAccountId: entry.fromAccountId ?? "",
        toAccountId: entry.toAccountId ?? "",
        amount: "", // 스마트 복사: 금액은 비워둠
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
      toast.error("복사 중 오류가 발생했습니다.");
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

  // 탭 변경 시 대분류 자동 설정
  useEffect(() => {
    if (ledgerTab === "savingsExpense") {
      // 저축성 지출 탭일 때 대분류를 "저축성지출"로 설정
      setForm((prev) => ({
        ...prev,
        mainCategory: "저축성지출",
        subCategory: "",
        description: ""
      }));
    } else if (ledgerTab === "transfer") {
      // 이체 탭일 때 대분류를 "이체"로 고정
      setForm((prev) => ({
        ...prev,
        mainCategory: "이체",
        subCategory: "",
        description: ""
      }));
    }
  }, [ledgerTab]);

  const resetForm = () => {
    const kindForTab: LedgerKind =
      ledgerTab === "income" ? "income" : ledgerTab === "transfer" || ledgerTab === "savingsExpense" ? "transfer" : "expense";
    setForm({
      ...createDefaultForm(),
      kind: kindForTab,
      isFixedExpense: false
    });
  };

  const startEditField = (id: string, field: string, currentValue: string | number) => {
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
    } else if (field === "description") {
      updated.description = editingValue;
    } else if (field === "fromAccountId") {
      updated.fromAccountId = editingValue || undefined;
    } else if (field === "toAccountId") {
      updated.toAccountId = editingValue || undefined;
    } else if (field === "amount") {
      const amount = Number(editingValue.replace(/[^\d]/g, ""));
      if (amount > 0) {
        updated.amount = amount;
      } else {
        // 금액이 0 이하면 저장하지 않음
        setEditingField(null);
        setEditingValue("");
        return;
      }
    }

    onChangeLedger(ledger.map((l) => (l.id === id ? updated : l)));
    setEditingField(null);
    setEditingValue("");
  };

  const cancelEditField = () => {
    setEditingField(null);
    setEditingValue("");
  };

  // 템플릿 관련 함수들
  const applyTemplate = (template: LedgerTemplate) => {
    const kindForTab: LedgerKind =
      ledgerTab === "income" ? "income" : ledgerTab === "transfer" || ledgerTab === "savingsExpense" ? "transfer" : "expense";
    
    // 템플릿의 kind와 현재 탭이 일치하는지 확인
    if (template.kind !== kindForTab) {
      // 탭을 템플릿에 맞게 변경
      if (template.kind === "income") {
        setLedgerTab("income");
      } else if (template.kind === "transfer") {
        setLedgerTab(ledgerTab === "savingsExpense" ? "savingsExpense" : "transfer");
      } else {
        setLedgerTab("expense");
      }
    }

    setForm((prev) => ({
      ...prev,
      kind: template.kind,
      mainCategory: template.mainCategory || prev.mainCategory,
      subCategory: template.subCategory || prev.subCategory,
      description: template.description || prev.description,
      fromAccountId: template.fromAccountId || prev.fromAccountId,
      toAccountId: template.toAccountId || prev.toAccountId,
      amount: template.amount ? String(template.amount) : prev.amount
    }));

    // 템플릿 사용 기록 업데이트
    if (onChangeTemplates) {
      const updated = templates.map((t) =>
        t.id === template.id ? { ...t, lastUsed: new Date().toISOString() } : t
      );
      onChangeTemplates(updated);
    }
  };

  const saveCurrentAsTemplate = () => {
    const kindForTab: LedgerKind =
      ledgerTab === "income" ? "income" : ledgerTab === "transfer" || ledgerTab === "savingsExpense" ? "transfer" : "expense";
    
    const templateName = prompt("템플릿 이름을 입력하세요:");
    if (!templateName || !templateName.trim()) return;

    const newTemplate: LedgerTemplate = {
      id: `TEMPLATE-${Date.now()}`,
      name: templateName.trim(),
      kind: kindForTab,
      mainCategory: form.mainCategory || undefined,
      subCategory: form.subCategory || undefined,
      description: form.description || undefined,
      fromAccountId: form.fromAccountId || undefined,
      toAccountId: form.toAccountId || undefined,
      amount: form.amount ? parseAmount(form.amount) : undefined
    };

    if (onChangeTemplates) {
      onChangeTemplates([...templates, newTemplate]);
    }
  };

  const deleteTemplate = (id: string) => {
    if (!confirm("템플릿을 삭제하시겠습니까?")) return;
    if (onChangeTemplates) {
      onChangeTemplates(templates.filter((t) => t.id !== id));
    }
  };

  // 현재 탭에 맞는 템플릿 필터링
  const filteredTemplates = useMemo(() => {
    const kindForTab: LedgerKind =
      ledgerTab === "income" ? "income" : ledgerTab === "transfer" || ledgerTab === "savingsExpense" ? "transfer" : "expense";
    return templates
      .filter((t) => t.kind === kindForTab)
      .sort((a, b) => {
        // 최근 사용한 것 우선, 그 다음 이름순
        if (a.lastUsed && b.lastUsed) {
          return b.lastUsed.localeCompare(a.lastUsed);
        }
        if (a.lastUsed) return -1;
        if (b.lastUsed) return 1;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 9); // 최대 9개만 표시 (Ctrl+1~9)
  }, [templates, ledgerTab]);

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
        enabled: () => Boolean(form.date && parseAmount(form.amount) > 0)
      },
      {
        action: "close-modal" as ShortcutAction,
        handler: () => {
          if (showTemplateModal) setShowTemplateModal(false);
          if (editingField) cancelEditField();
        }
      }
    ];

    handlers.forEach(handler => shortcutManager.register(handler));
    return () => {
      handlers.forEach(handler => shortcutManager.unregister(handler));
    };
  }, [isEditing, form, showTemplateModal, editingField]);

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+1~9: 템플릿 적용
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key >= "1" && e.key <= "9") {
        const index = parseInt(e.key) - 1;
        if (filteredTemplates[index]) {
          e.preventDefault();
          applyTemplate(filteredTemplates[index]);
        }
      }
      // Ctrl+S: 저장
      if (e.ctrlKey && e.key === "s" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const amount = parseAmount(form.amount);
        if (form.date && amount && amount > 0) {
          submitForm(true);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [filteredTemplates, form]);

  // 월별 필터링된 거래 목록
  const ledgerByTab = useMemo(() => {
    return ledger.filter((l) => {
      if (ledgerTab === "income") return l.kind === "income";
      if (ledgerTab === "transfer") {
        // 일반 이체만 (저축성 지출 제외)
        if (l.kind !== "transfer") return false;
        const toAccount = accounts.find(a => a.id === l.toAccountId);
        return !toAccount || (toAccount.type !== "securities" && toAccount.type !== "savings");
      }
      if (ledgerTab === "savingsExpense") {
        // 저축성 지출: transfer이고 toAccountId가 증권/저축 계좌이거나, expense이고 대분류가 저축성지출
        if (l.kind === "transfer") {
          const toAccount = accounts.find(a => a.id === l.toAccountId);
          return toAccount && (toAccount.type === "securities" || toAccount.type === "savings");
        }
        if (l.kind === "expense") {
          return l.category === "저축성지출";
        }
        return false;
      }
      // 지출 탭: expense이고 고정지출이 아니며, 대분류가 저축성지출이 아닌 것만
      return l.kind === "expense" && !(l.isFixedExpense ?? false) && l.category !== "저축성지출";
    });
  }, [ledger, ledgerTab, accounts]);

  const filteredLedger = useMemo(() => {
    const base = ledgerByTab;
    let filtered = viewMode === "all" ? base : base.filter((l) => l.date.startsWith(selectedMonth));
    
    // 날짜 필터 적용
    if (dateFilter.startDate || dateFilter.endDate) {
      filtered = filtered.filter((l) => {
        if (dateFilter.startDate && l.date < dateFilter.startDate) return false;
        if (dateFilter.endDate && l.date > dateFilter.endDate) return false;
        return true;
      });
    }

    // 고급 검색 필터 적용
    if (advancedSearchQuery.keyword || advancedSearchQuery.startDate || advancedSearchQuery.endDate || 
        advancedSearchQuery.minAmount || advancedSearchQuery.maxAmount || 
        advancedSearchQuery.accountIds || advancedSearchQuery.categories || 
        advancedSearchQuery.kinds || advancedSearchQuery.tags) {
      filtered = filtered.filter((l) => {
        // 키워드 검색
        if (advancedSearchQuery.keyword) {
          const keyword = advancedSearchQuery.keyword.toLowerCase();
          const matchesKeyword = 
            l.description.toLowerCase().includes(keyword) ||
            (l.note && l.note.toLowerCase().includes(keyword)) ||
            l.category.toLowerCase().includes(keyword) ||
            (l.subCategory && l.subCategory.toLowerCase().includes(keyword));
          if (!matchesKeyword) return false;
        }

        // 날짜 범위
        if (advancedSearchQuery.startDate && l.date < advancedSearchQuery.startDate) return false;
        if (advancedSearchQuery.endDate && l.date > advancedSearchQuery.endDate) return false;

        // 금액 범위
        if (advancedSearchQuery.minAmount && l.amount < advancedSearchQuery.minAmount) return false;
        if (advancedSearchQuery.maxAmount && l.amount > advancedSearchQuery.maxAmount) return false;

        // 계좌 필터
        if (advancedSearchQuery.accountIds && advancedSearchQuery.accountIds.length > 0) {
          const matchesAccount = 
            (l.fromAccountId && advancedSearchQuery.accountIds.includes(l.fromAccountId)) ||
            (l.toAccountId && advancedSearchQuery.accountIds.includes(l.toAccountId));
          if (!matchesAccount) return false;
        }

        // 카테고리 필터
        if (advancedSearchQuery.categories && advancedSearchQuery.categories.length > 0) {
          const matchesCategory = 
            advancedSearchQuery.categories.includes(l.category) ||
            (l.subCategory && advancedSearchQuery.categories.includes(l.subCategory));
          if (!matchesCategory) return false;
        }

        // 구분 필터
        if (advancedSearchQuery.kinds && advancedSearchQuery.kinds.length > 0) {
          if (!advancedSearchQuery.kinds.includes(l.kind)) return false;
        }

        // 태그 필터
        if (advancedSearchQuery.tags && advancedSearchQuery.tags.length > 0) {
          const entryTags = l.tags || [];
          const hasMatchingTag = advancedSearchQuery.tags.some(tag => entryTags.includes(tag));
          if (!hasMatchingTag) return false;
        }

        return true;
      });
    }
    
    // 정렬 적용
    const sorted = [...filtered].sort((a, b) => {
      const dir = ledgerSort.direction === "asc" ? 1 : -1;
      const key = ledgerSort.key;
      
      if (key === "date") {
        return (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) * dir;
      } else if (key === "amount") {
        return (a.amount - b.amount) * dir;
      } else if (key === "category") {
        return ((a.category || "") < (b.category || "") ? -1 : (a.category || "") > (b.category || "") ? 1 : 0) * dir;
      } else if (key === "subCategory") {
        return ((a.subCategory || "") < (b.subCategory || "") ? -1 : (a.subCategory || "") > (b.subCategory || "") ? 1 : 0) * dir;
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
  }, [ledgerByTab, viewMode, selectedMonth, ledgerSort]);

  const tabLabel: Record<LedgerTab, string> = {
    income: "수입",
    expense: "지출",
    savingsExpense: "저축성 지출",
    transfer: "이체"
  };

  const totalByTab = useMemo(
    () => ledgerByTab.reduce((s, l) => s + l.amount, 0),
    [ledgerByTab]
  );
  const monthlyTotalByTab = useMemo(
    () => filteredLedger.reduce((s, l) => s + l.amount, 0),
    [filteredLedger]
  );

  // 페이징된 데이터 계산
  const paginatedLedger = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return filteredLedger.slice(startIndex, endIndex);
  }, [filteredLedger, currentPage, pageSize]);

  const totalPages = useMemo(() => {
    return Math.ceil(filteredLedger.length / pageSize);
  }, [filteredLedger.length, pageSize]);

  // 페이지 변경 시 첫 페이지로 리셋
  useEffect(() => {
    setCurrentPage(1);
  }, [filteredLedger.length, viewMode, selectedMonth, dateFilter]);

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
    // 현재 선택된 월의 년도도 포함
    if (selectedMonth && selectedMonth.length >= 4) {
      const currentYear = selectedMonth.slice(0, 4);
      if (/^\d{4}$/.test(currentYear)) {
        years.add(currentYear);
      }
    }
    // 현재 년도와 다음 년도도 항상 포함 (입력 편의를 위해)
    const koreaTime = getKoreaTime();
    const currentYear = String(koreaTime.getFullYear());
    const nextYear = String(koreaTime.getFullYear() + 1);
    years.add(currentYear);
    years.add(nextYear);
    
    return Array.from(years).sort((a, b) => b.localeCompare(a)); // 최신순 (내림차순)
  }, [ledgerByTab, selectedMonth]);

  const currentYear = selectedMonth && selectedMonth.length >= 4 ? selectedMonth.slice(0, 4) : String(getKoreaTime().getFullYear());
  
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

  return (
    <div>
      <div className="section-header">
        <h2>가계부 (거래 입력)</h2>
        <div className="pill">
          {viewMode === "all"
            ? `${tabLabel[ledgerTab]} 합계: ${Math.round(totalByTab).toLocaleString()}원`
            : `${selectedMonth} ${tabLabel[ledgerTab]}: ${Math.round(monthlyTotalByTab).toLocaleString()}원`}
        </div>
      </div>

      <div style={{ marginBottom: "12px", display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          className={ledgerTab === "expense" ? "primary" : ""}
          onClick={() => setLedgerTab("expense")}
        >
          지출
        </button>
        <button
          type="button"
          className={ledgerTab === "savingsExpense" ? "primary" : ""}
          onClick={() => setLedgerTab("savingsExpense")}
        >
          저축성 지출
        </button>
        <button
          type="button"
          className={ledgerTab === "income" ? "primary" : ""}
          onClick={() => setLedgerTab("income")}
        >
          수입
        </button>
        <button
          type="button"
          className={ledgerTab === "transfer" ? "primary" : ""}
          onClick={() => setLedgerTab("transfer")}
        >
          이체
        </button>
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px", alignItems: "center" }}>
        </div>
      </div>

      <div style={{ marginBottom: "16px", display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          className={viewMode === "monthly" ? "primary" : ""}
          onClick={() => {
            setViewMode("monthly");
            clearDateFilter();
          }}
        >
          월별 보기
        </button>
        <button
          type="button"
          className={viewMode === "all" && !dateFilter.startDate ? "primary" : ""}
          onClick={() => {
            setViewMode("all");
            clearDateFilter();
          }}
        >
          전체 보기
        </button>
          <button
            type="button"
            className={showAdvancedSearch ? "primary" : "secondary"}
            onClick={() => setShowAdvancedSearch(!showAdvancedSearch)}
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            🔍 고급 검색
          </button>
          {filteredLedger.length > 0 && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                // CSV 내보내기
                const headers = ["날짜", "대분류", "항목", "상세내역", "출금", "입금", "금액"];
                const rows = filteredLedger.map((l) => [
                  l.date,
                  l.category || "",
                  l.subCategory || "",
                  l.description || "",
                  l.fromAccountId || "",
                  l.toAccountId || "",
                  l.amount.toString()
                ]);
                const csvContent = [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
                const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
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
              style={{ fontSize: 12, padding: "6px 12px" }}
            >
              📥 검색 결과 내보내기 (CSV)
            </button>
          )}
        {(dateFilter.startDate || dateFilter.endDate) && (
          <button
            type="button"
            className="secondary"
            onClick={clearDateFilter}
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            필터 해제
          </button>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <button
            type="button"
            className={(() => {
              const koreaTime = getKoreaTime();
              const thisMonthStart = `${koreaTime.getFullYear()}-${String(koreaTime.getMonth() + 1).padStart(2, "0")}-01`;
              return dateFilter.startDate === thisMonthStart && !dateFilter.endDate ? "primary" : "secondary";
            })()}
            onClick={() => applyQuickFilter("thisMonth")}
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            이번 달
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => applyQuickFilter("lastMonth")}
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            지난 달
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => applyQuickFilter("thisYear")}
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            올해
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => applyQuickFilter("last3Months")}
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            지난 3개월
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => applyQuickFilter("last6Months")}
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            지난 6개월
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => applyQuickFilter("lastYear")}
            style={{ fontSize: 12, padding: "6px 12px" }}
          >
            지난 1년
          </button>
        </div>
        {viewMode === "monthly" && (
          <>
            <select
              value={currentYear}
              onChange={(e) => {
                const year = e.target.value;
                // 년도 변경 시 해당 년도의 첫 번째 월로 이동 (또는 유효한 월 유지)
                const monthsForYear = availableMonthsByYear.get(year) || [];
                if (monthsForYear.length > 0) {
                  // 해당 년도에 데이터가 있으면 가장 최근 월로 이동
                  setSelectedMonth(monthsForYear[0]);
                } else {
                  // 데이터가 없으면 해당 년도의 현재 월로 설정
                  const currentMonth = selectedMonth && selectedMonth.length >= 7 ? selectedMonth.slice(5, 7) : String(getKoreaTime().getMonth() + 1).padStart(2, "0");
                  setSelectedMonth(`${year}-${currentMonth}`);
                }
              }}
              style={{
                padding: "8px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border)"
              }}
            >
              {availableYears.map((year) => {
                const monthCount = availableMonthsByYear.get(year)?.length || 0;
                return (
                  <option key={year} value={year}>
                    {year}년 {monthCount > 0 ? `(${monthCount}개월)` : ""}
                  </option>
                );
              })}
            </select>
            <div className="month-tabs">
              {Array.from({ length: 12 }).map((_, idx) => {
                const monthNum = idx + 1;
                const monthPart = String(monthNum).padStart(2, "0");
                const key = `${currentYear}-${monthPart}`;
                // 현재 선택된 년도에 해당하는 월만 확인
                const hasData = availableMonthsForCurrentYear.includes(key);
                const isActive = selectedMonth === key;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`month-tab ${isActive ? "active" : ""} ${
                      !hasData ? "empty" : ""
                    }`}
                    onClick={() => setSelectedMonth(key)}
                  >
                    {monthNum}월
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* 템플릿 버튼 영역 */}
      <div className="card" style={{ padding: 12, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--muted)" }}>
            템플릿 {filteredTemplates.length > 0 ? `(Ctrl+1~9)` : ""}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="secondary"
              onClick={saveCurrentAsTemplate}
              style={{ fontSize: 11, padding: "4px 8px" }}
            >
              현재 저장
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setShowTemplateModal(true)}
              style={{ fontSize: 11, padding: "4px 8px" }}
            >
              관리
            </button>
          </div>
        </div>
        {filteredTemplates.length > 0 ? (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {filteredTemplates.map((template, index) => (
              <button
                key={template.id}
                type="button"
                className="secondary"
                onClick={() => applyTemplate(template)}
                style={{ fontSize: 12, padding: "6px 12px" }}
                title={`Ctrl+${index + 1}: ${template.name}`}
              >
                {index + 1}. {template.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="hint" style={{ margin: 0, fontSize: 12 }}>
            템플릿이 없습니다. 자주 사용하는 항목을 입력한 후 "현재 저장" 버튼을 클릭하세요.
          </p>
        )}
      </div>

      {/* 버튼식 입력 모드 */}
      <form className="card" onSubmit={handleSubmit} style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
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
                {formErrors.date && (
                  <span id="date-error" style={{ fontSize: 10, color: "var(--danger)", display: "block", marginTop: 4 }}>
                    {formErrors.date}
                  </span>
                )}
              </label>
              
              {/* 금액 */}
              <label style={{ margin: 0 }}>
                <span style={{ fontSize: 11, marginBottom: 4, display: "block", color: "var(--text-muted)" }}>금액 *</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  value={form.amount}
                  onChange={useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
                    const formatted = formatAmount(e.target.value);
                    setForm((prev) => ({ ...prev, amount: formatted }));
                  }, [formatAmount])}
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
                {formErrors.amount && (
                  <span id="amount-error" style={{ fontSize: 10, color: "var(--danger)", display: "block", marginTop: 4 }}>
                    {formErrors.amount}
                  </span>
                )}
              </label>
            </div>

            {/* 2. 대분류 (지출/이체만) 또는 수입 항목 */}
            {form.kind === "income" ? (
              <label>
                <span style={{ fontSize: 14, marginBottom: 8, display: "block", fontWeight: 600 }}>수입 항목 *</span>
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
                {formErrors.subCategory && (
                  <span style={{ fontSize: 11, color: "var(--danger)", display: "block", marginTop: 4 }}>
                    {formErrors.subCategory}
                  </span>
                )}
                <div className="category-chip-row" style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
                  {recentIncomeCategories.slice(0, 5).map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`category-chip ${form.subCategory === c ? "active" : ""}`}
                      onClick={() => {
                        setForm((prev) => ({ ...prev, subCategory: c || "" }));
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
                      title="최근 사용"
                    >
                      {c}
                    </button>
                  ))}
                  {incomeCategoryOptions.slice(0, 12).map((c) => {
                    if (recentIncomeCategories.includes(c)) return null;
                    return (
                      <button
                        key={c}
                        type="button"
                        className={`category-chip ${form.subCategory === c ? "active" : ""}`}
                        onClick={() => {
                        setForm((prev) => ({ ...prev, subCategory: c || "" }));
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
                    );
                  })}
                </div>
              </label>
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
                    {formErrors.mainCategory && (
                      <span style={{ fontSize: 11, color: "var(--danger)", display: "block", marginBottom: 4 }}>
                        {formErrors.mainCategory}
                      </span>
                    )}
                    {/* 대분류 버튼 그리드 - 모든 대분류 표시 */}
                    <div style={{ 
                      display: "grid", 
                      gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", 
                      gap: 8,
                      marginBottom: 8
                    }}>
                    {/* 최근 사용한 대분류 - 모든 최근 항목 표시 (이체 탭 제외) */}
                    {(ledgerTab === "income" || ledgerTab === "expense" || ledgerTab === "savingsExpense") && recentMainCategories.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          setForm((prev) => ({ ...prev, mainCategory: c || "", subCategory: "" }));
                        }}
                        style={{
                          padding: "10px 8px",
                          fontSize: 13,
                          fontWeight: form.mainCategory === c ? 600 : 400,
                          border: form.mainCategory === c ? "2px solid var(--primary)" : "2px solid var(--primary)",
                          borderRadius: "8px",
                          background: form.mainCategory === c ? "var(--primary-light)" : "var(--primary-lightest)",
                          color: form.mainCategory === c ? "var(--primary)" : "var(--primary)",
                          cursor: "pointer",
                          transition: "all 0.2s",
                          textAlign: "center"
                        }}
                        title="최근 사용"
                      >
                        {c}
                      </button>
                    ))}
                    {/* 즐겨찾기 대분류 */}
                    {favoriteCategoryList.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => {
                          setForm((prev) => ({ ...prev, mainCategory: c || "", subCategory: "" }));
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          toggleFavoriteCategory(c);
                        }}
                        style={{
                          padding: "10px 8px",
                          fontSize: 13,
                          fontWeight: form.mainCategory === c ? 600 : 400,
                          border: form.mainCategory === c ? "2px solid var(--primary)" : "2px solid var(--primary)",
                          borderRadius: "8px",
                          background: form.mainCategory === c ? "var(--primary-light)" : "var(--primary-lightest)",
                          color: form.mainCategory === c ? "var(--primary)" : "var(--primary)",
                          cursor: "pointer",
                          transition: "all 0.2s",
                          textAlign: "center"
                        }}
                        title="우클릭하여 즐겨찾기 제거"
                      >
                        ⭐ {c}
                      </button>
                    ))}
                    {/* 나머지 모든 대분류 */}
                    {mainCategoryOptions.map((c) => {
                      if (((ledgerTab === "income" || ledgerTab === "expense" || ledgerTab === "savingsExpense") && recentMainCategories.includes(c)) || favoriteCategories.has(c)) return null;
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => {
                            setForm((prev) => ({ ...prev, mainCategory: c || "", subCategory: "" }));
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            toggleFavoriteCategory(c);
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
                          title="우클릭하여 즐겨찾기 추가"
                        >
                          {c}
                        </button>
                      );
                    })}
                  </div>
                </label>
                )}

                {/* 3. 항목 (세부 항목) - 대분류 선택 시에만 표시 (이체 탭일 때는 항상 표시) */}
                {(form.mainCategory || ledgerTab === "transfer") ? (
                  <label>
                    <span style={{ fontSize: 12, marginBottom: 8, display: "block" }}>
                      항목 * <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>({ledgerTab === "transfer" ? "이체" : form.mainCategory}의 세부 항목)</span>
                    </span>
                    {formErrors.subCategory && (
                      <span style={{ fontSize: 11, color: "var(--danger)", display: "block", marginBottom: 4 }}>
                        {formErrors.subCategory}
                      </span>
                    )}
                    {/* 세부 항목 버튼 그리드 - 선택된 대분류에 해당하는 항목만 표시 */}
                    <div style={{ 
                      display: "grid", 
                      gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", 
                      gap: 8
                    }}>
                      {/* 모든 세부 항목 표시 (expenseSubSuggestions는 이미 최근 사용한 항목을 앞에 배치한 상태) */}
                      {expenseSubSuggestions.map((c, index) => {
                        const isRecent = recentSubCategories.includes(c);
                        const isSelected = form.subCategory === c;
                        return (
                          <button
                            key={c}
                            type="button"
                            onClick={() => {
                              setForm((prev) => ({ ...prev, subCategory: c || "" }));
                            }}
                            style={{
                              padding: "10px 8px",
                              fontSize: 13,
                              fontWeight: isSelected ? 600 : 400,
                              border: isSelected 
                                ? "2px solid var(--primary)" 
                                : isRecent 
                                  ? "2px solid var(--primary)" 
                                  : "1px solid var(--border)",
                              borderRadius: "8px",
                              background: isSelected 
                                ? "var(--primary-light)" 
                                : isRecent 
                                  ? "var(--primary-lightest)" 
                                  : "var(--surface)",
                              color: isSelected 
                                ? "var(--primary)" 
                                : isRecent 
                                  ? "var(--primary)" 
                                  : "var(--text)",
                              cursor: "pointer",
                              transition: "all 0.2s",
                              textAlign: "center"
                            }}
                            title={isRecent ? "최근 사용" : undefined}
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

            {/* 5. 출금계좌 (지출/이체만) - 버튼 그리드 */}
            {(form.kind === "expense" || form.kind === "transfer") && (
              <div>
                <div style={{ fontSize: 11, marginBottom: 8, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
                  <span>출금계좌 *</span>
                  {(formErrors.fromAccountId || formErrors.transfer) && (
                    <span style={{ fontSize: 10, color: "var(--danger)" }}>({(formErrors.fromAccountId || formErrors.transfer)})</span>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                  {favoriteAccountList.map((acc) => {
                    const accountName = (acc.name + acc.id).toLowerCase();
                    const isUSD = acc.currency === "USD" || 
                                 accountName.includes("usd") || 
                                 accountName.includes("dollar") || 
                                 accountName.includes("달러");
                    return (
                      <button
                        key={acc.id}
                        type="button"
                        onClick={() => {
                          setForm((prev) => ({ ...prev, fromAccountId: acc.id || "" }));
                        }}
                        style={{
                          padding: "10px 8px",
                          fontSize: 13,
                          fontWeight: form.fromAccountId === acc.id ? 600 : 400,
                          border: form.fromAccountId === acc.id ? "2px solid var(--primary)" : "1px solid var(--border)",
                          borderRadius: "8px",
                          background: form.fromAccountId === acc.id ? "var(--primary-light)" : "var(--surface)",
                          color: form.fromAccountId === acc.id ? "var(--primary)" : "var(--text)",
                          cursor: "pointer",
                          transition: "all 0.2s",
                          textAlign: "left"
                        }}
                      >
                        ⭐ {acc.id} {isUSD ? "(USD)" : ""}
                      </button>
                    );
                  })}
                  {recentAccounts.map((id) => {
                    const acc = accounts.find((a) => a.id === id);
                    if (!acc || favoriteAccounts.has(id)) return null;
                    const accountName = (acc.name + acc.id).toLowerCase();
                    const isUSD = acc.currency === "USD" || 
                                 accountName.includes("usd") || 
                                 accountName.includes("dollar") || 
                                 accountName.includes("달러");
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setForm((prev) => ({ ...prev, fromAccountId: id || "" }));
                        }}
                        style={{
                          padding: "10px 8px",
                          fontSize: 13,
                          fontWeight: form.fromAccountId === id ? 600 : 400,
                          border: form.fromAccountId === id ? "2px solid var(--primary)" : "1px solid var(--border)",
                          borderRadius: "8px",
                          background: form.fromAccountId === id ? "var(--primary-light)" : "var(--surface)",
                          color: form.fromAccountId === id ? "var(--primary)" : "var(--text)",
                          cursor: "pointer",
                          transition: "all 0.2s",
                          textAlign: "left"
                        }}
                      >
                        {acc.id} {isUSD ? "(USD)" : ""}
                      </button>
                    );
                  })}
                  {accounts
                    .filter((a) => !recentAccounts.includes(a.id) && !favoriteAccounts.has(a.id))
                    .map((a) => {
                      const accountName = (a.name + a.id).toLowerCase();
                      const isUSD = a.currency === "USD" || 
                                   accountName.includes("usd") || 
                                   accountName.includes("dollar") || 
                                   accountName.includes("달러");
                      return (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => {
                          setForm((prev) => ({ ...prev, fromAccountId: a.id || "" }));
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

            {/* 입금계좌 (수입/이체만) - 버튼 그리드 */}
            {(form.kind === "income" || form.kind === "transfer") && (
              <div>
                <div style={{ fontSize: 11, marginBottom: 8, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
                  <span>{ledgerTab === "savingsExpense" ? "저축계좌 (증권/저축) *" : "입금계좌 *"}</span>
                  {(formErrors.toAccountId || formErrors.transfer) && (
                    <span style={{ fontSize: 10, color: "var(--danger)" }}>({(formErrors.toAccountId || formErrors.transfer)})</span>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                  {(() => {
                    const targetAccounts = ledgerTab === "savingsExpense"
                      ? accounts.filter((a) => a.type === "securities" || a.type === "savings")
                      : accounts;
                    
                    return (
                      <>
                        {favoriteAccountList
                          .filter((acc) => targetAccounts.some((a) => a.id === acc.id))
                          .map((acc) => {
                            const accountName = (acc.name + acc.id).toLowerCase();
                            const isUSD = acc.currency === "USD" || 
                                         accountName.includes("usd") || 
                                         accountName.includes("dollar") || 
                                         accountName.includes("달러");
                            return (
                              <button
                                key={acc.id}
                                type="button"
                                onClick={() => {
                          setForm((prev) => ({ ...prev, toAccountId: acc.id || "" }));
                        }}
                                style={{
                                  padding: "10px 8px",
                                  fontSize: 13,
                                  fontWeight: form.toAccountId === acc.id ? 600 : 400,
                                  border: form.toAccountId === acc.id ? "2px solid var(--primary)" : "1px solid var(--border)",
                                  borderRadius: "8px",
                                  background: form.toAccountId === acc.id ? "var(--primary-light)" : "var(--surface)",
                                  color: form.toAccountId === acc.id ? "var(--primary)" : "var(--text)",
                                  cursor: "pointer",
                                  transition: "all 0.2s",
                                  textAlign: "left"
                                }}
                              >
                                ⭐ {acc.id} {isUSD ? "(USD)" : ""}
                              </button>
                            );
                          })}
                        {recentAccounts
                          .map((id) => targetAccounts.find((a) => a.id === id))
                          .filter((acc): acc is Account => acc !== undefined && !favoriteAccounts.has(acc.id))
                          .map((acc) => {
                            const accountName = (acc.name + acc.id).toLowerCase();
                            const isUSD = acc.currency === "USD" || 
                                         accountName.includes("usd") || 
                                         accountName.includes("dollar") || 
                                         accountName.includes("달러");
                            return (
                              <button
                                key={acc.id}
                                type="button"
                                onClick={() => {
                          setForm((prev) => ({ ...prev, toAccountId: acc.id || "" }));
                        }}
                                style={{
                                  padding: "10px 8px",
                                  fontSize: 13,
                                  fontWeight: form.toAccountId === acc.id ? 600 : 400,
                                  border: form.toAccountId === acc.id ? "2px solid var(--primary)" : "1px solid var(--border)",
                                  borderRadius: "8px",
                                  background: form.toAccountId === acc.id ? "var(--primary-light)" : "var(--surface)",
                                  color: form.toAccountId === acc.id ? "var(--primary)" : "var(--text)",
                                  cursor: "pointer",
                                  transition: "all 0.2s",
                                  textAlign: "left"
                                }}
                              >
                                {acc.id} {isUSD ? "(USD)" : ""}
                              </button>
                            );
                          })}
                        {targetAccounts
                          .filter((a) => !recentAccounts.includes(a.id) && !favoriteAccounts.has(a.id))
                          .map((a) => {
                            const accountName = (a.name + a.id).toLowerCase();
                            const isUSD = a.currency === "USD" || 
                                         accountName.includes("usd") || 
                                         accountName.includes("dollar") || 
                                         accountName.includes("달러");
                            return (
                              <button
                                key={a.id}
                                type="button"
                                onClick={() => {
                          setForm((prev) => ({ ...prev, toAccountId: a.id || "" }));
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
                          })}
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* 제출 버튼 */}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button 
                type="submit" 
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
            </div>
          </div>
        </form>

      <table className="data-table">
        <colgroup>
          {columnWidths.map((width, index) => (
            <col key={index} style={{ width: `${width}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {isBatchEditMode && (
              <th style={{ width: "40px" }}>
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
            <th style={{ position: "relative" }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("date")}>
                날짜 <span className="arrow">{sortIndicator(ledgerSort.key, "date", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 0)}
              />
            </th>
            <th style={{ position: "relative" }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("category")}>
                대분류 <span className="arrow">{sortIndicator(ledgerSort.key, "category", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 1)}
              />
            </th>
            <th style={{ position: "relative" }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("subCategory")}>
                항목 <span className="arrow">{sortIndicator(ledgerSort.key, "subCategory", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 2)}
              />
            </th>
            <th style={{ position: "relative" }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("description")}>
                상세내역 <span className="arrow">{sortIndicator(ledgerSort.key, "description", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 3)}
              />
            </th>
            <th style={{ position: "relative" }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("fromAccountId")}>
                출금 <span className="arrow">{sortIndicator(ledgerSort.key, "fromAccountId", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 4)}
              />
            </th>
            <th style={{ position: "relative" }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("toAccountId")}>
                입금 <span className="arrow">{sortIndicator(ledgerSort.key, "toAccountId", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 5)}
              />
            </th>
            <th style={{ position: "relative" }}>
              <button type="button" className="sort-header" onClick={() => toggleLedgerSort("amount")}>
                금액 <span className="arrow">{sortIndicator(ledgerSort.key, "amount", ledgerSort.direction)}</span>
              </button>
              <div
                className="resize-handle"
                onMouseDown={(e) => handleResizeStart(e, 6)}
              />
            </th>
            <th style={{ position: "relative" }}>
              작업
            </th>
          </tr>
        </thead>
        <tbody>
          {paginatedLedger.map((l, index) => {
            const actualIndex = (currentPage - 1) * pageSize + index;
            return (
            <tr
              key={l.id}
              draggable={viewMode === "all" && !isBatchEditMode}
              onDragStart={() => {
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
                if (draggingId && draggingId !== l.id) {
                  handleReorder(draggingId, index);
                }
                setDraggingId(null);
              }}
              onDragEnd={() => setDraggingId(null)}
            >
              {isBatchEditMode && (
                <td>
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
                </td>
              )}
              <td
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(l.id, "date", l.date);
                }}
                style={{ cursor: "pointer", position: "relative" }}
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
                style={{ cursor: "pointer" }}
                title={l.category ? l.category + " (더블클릭하여 수정)" : "더블클릭하여 수정"}
              >
                {editingField?.id === l.id && editingField.field === "category" ? (
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
                  l.category
                )}
              </td>
              <td
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(l.id, "subCategory", l.subCategory || "");
                }}
                style={{ cursor: "pointer" }}
                title={l.subCategory ? l.subCategory + " (더블클릭하여 수정)" : "더블클릭하여 수정"}
              >
                {editingField?.id === l.id && editingField.field === "subCategory" ? (
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
                  l.subCategory ?? "-"
                )}
              </td>
              <td
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(l.id, "description", l.description || "");
                }}
                style={{ cursor: "pointer", whiteSpace: "normal", wordBreak: "break-word" }}
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
                style={{ cursor: "pointer" }}
                title={l.fromAccountId ? l.fromAccountId + " (더블클릭하여 수정)" : "더블클릭하여 수정"}
              >
                {editingField?.id === l.id && editingField.field === "fromAccountId" ? (
                  <select
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
                    style={{ width: "100%", padding: "4px", fontSize: 14 }}
                  >
                    <option value="">-</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.id}
                      </option>
                    ))}
                  </select>
                ) : (
                  l.fromAccountId ?? "-"
                )}
              </td>
              <td
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(l.id, "toAccountId", l.toAccountId || "");
                }}
                style={{ cursor: "pointer" }}
                title={l.toAccountId ? l.toAccountId + " (더블클릭하여 수정)" : "더블클릭하여 수정"}
              >
                {editingField?.id === l.id && editingField.field === "toAccountId" ? (
                  <select
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
                    style={{ width: "100%", padding: "4px", fontSize: 14 }}
                  >
                    <option value="">-</option>
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.id}
                      </option>
                    ))}
                  </select>
                ) : (
                  l.toAccountId ?? "-"
                )}
              </td>
              <td
                className="number"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditField(l.id, "amount", l.amount);
                }}
                style={{ cursor: "pointer" }}
                title="더블클릭하여 수정"
              >
                {editingField?.id === l.id && editingField.field === "amount" ? (
                  <input
                    type="text"
                    value={editingValue}
                    onChange={(e) => {
                      const formatted = e.target.value.replace(/[^\d]/g, "");
                      setEditingValue(formatted);
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
                  Math.round(l.amount).toLocaleString()
                )}
              </td>
              <td>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" onClick={(e) => {
                    e.stopPropagation();
                    startCopy(l);
                  }}>
                    복사
                  </button>
                  <button 
                    type="button" 
                    className="danger"
                    onClick={(e) => {
                      e.stopPropagation();
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
      {filteredLedger.length === 0 && (
        <p>
          {viewMode === "all"
            ? "아직 거래가 없습니다. 위 폼에서 첫 거래를 입력해 보세요."
            : `${selectedMonth}에 거래 내역이 없습니다.`}
        </p>
      )}
      {filteredLedger.length > 0 && totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "16px", padding: "12px", background: "var(--surface)", borderRadius: "8px" }}>
          <div style={{ fontSize: "14px", color: "var(--text-muted)" }}>
            총 {filteredLedger.length}건 중 {((currentPage - 1) * pageSize) + 1}-{Math.min(currentPage * pageSize, filteredLedger.length)}건 표시
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <button
              type="button"
              className="secondary"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
            >
              처음
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
            >
              이전
            </button>
            <span style={{ padding: "0 12px", fontSize: "14px" }}>
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              className="secondary"
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
            >
              다음
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
            >
              마지막
            </button>
          </div>
        </div>
      )}

      {/* 템플릿 관리 모달 */}
      {showTemplateModal && (
        <div className="modal-backdrop" onClick={() => setShowTemplateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ margin: 0 }}>템플릿 관리</h3>
              <button type="button" className="secondary" onClick={() => setShowTemplateModal(false)}>
                닫기
              </button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: 16 }}>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    setEditingTemplate(null);
                    setShowTemplateModal(true);
                  }}
                >
                  새 템플릿 추가
                </button>
              </div>
              <div style={{ maxHeight: 400, overflowY: "auto" }}>
                {templates.length === 0 ? (
                  <p className="hint">저장된 템플릿이 없습니다.</p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>이름</th>
                        <th>구분</th>
                        <th>카테고리</th>
                        <th>계좌</th>
                        <th>금액</th>
                        <th>마지막 사용</th>
                        <th>작업</th>
                      </tr>
                    </thead>
                    <tbody>
                      {templates.map((template) => (
                        <tr key={template.id}>
                          <td>{template.name}</td>
                          <td>{KIND_LABEL[template.kind]}</td>
                          <td>
                            {template.description || template.subCategory || template.mainCategory || ""}
                          </td>
                          <td>
                            {template.fromAccountId || ""}
                            {template.toAccountId ? ` → ${template.toAccountId}` : ""}
                          </td>
                          <td className="number">
                            {template.amount ? Math.round(template.amount).toLocaleString() : "-"}
                          </td>
                          <td>{template.lastUsed ? new Date(template.lastUsed).toLocaleDateString() : "-"}</td>
                          <td>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => {
                                applyTemplate(template);
                                setShowTemplateModal(false);
                              }}
                              style={{ marginRight: 4, fontSize: 11, padding: "4px 8px" }}
                            >
                              적용
                            </button>
                            <button
                              type="button"
                              className="danger"
                              onClick={() => deleteTemplate(template.id)}
                              style={{ fontSize: 11, padding: "4px 8px" }}
                            >
                              삭제
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 고급 검색 모달 */}
      {showAdvancedSearch && (
        <AdvancedSearch
          accounts={accounts}
          ledger={ledger}
          categories={categoryPresets.expense.concat(categoryPresets.income).concat(categoryPresets.transfer)}
          tags={Array.from(new Set(ledger.flatMap(l => l.tags || [])))}
          query={advancedSearchQuery}
          onChange={setAdvancedSearchQuery}
          onSave={(name, query) => {
            const newFilter = { id: `FILTER-${Date.now()}`, name, query };
            setSavedFilters([...savedFilters, newFilter]);
            if (typeof window !== "undefined") {
              localStorage.setItem("fw-ledger-saved-filters", JSON.stringify([...savedFilters, newFilter]));
            }
          }}
          savedFilters={savedFilters}
          onLoadFilter={(query) => setAdvancedSearchQuery(query)}
          onDeleteFilter={(id) => {
            const updated = savedFilters.filter(f => f.id !== id);
            setSavedFilters(updated);
            if (typeof window !== "undefined") {
              localStorage.setItem("fw-ledger-saved-filters", JSON.stringify(updated));
            }
          }}
          onClose={() => setShowAdvancedSearch(false)}
        />
      )}
    </div>
  );
};
