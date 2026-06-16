/**
 * 가계부 (LedgerPage) — 데이터 스키마 규칙
 * ───────────────────────────────────────────────────────
 * 사용자 멘탈 모델: 대분류 → 중분류 → 소분류 (3-level)
 * 데이터 저장 매핑:
 *   - kind                = 입력 토글 (income/expense/transfer)
 *   - category            = 대분류 ("지출"/"수입"/"이체"/"신용결제"/"재테크")
 *   - subCategory         = 중분류 (예: 식비, 유류교통비, 저축이체)
 *   - detailCategory      = 소분류 (예: 시장/마트, 주차비)  — 지출에만 의미 있음
 *
 * 폼과 필터는 완전히 독립.
 *   - 폼 picker는 form.{mainCategory,subCategory}만 변경 — setFilter* 호출 없음.
 *   - 리스트 필터는 LedgerFilterBar 컴포넌트의 5개 드롭다운에서만 변경 (대/중/소/출금계좌/입금계좌).
 *   - 칩 바(L1500대)의 × 버튼은 해당 필터만 끔 — 폼 상태 건드리지 않음.
 *   - 탭 전환·새 항목 추가 시 필터 자동 클리어 안 함 — 사용자가 명시적으로 끄거나 바꿀 때만 변경됨.
 *
 * 신용결제 탭은 이체로 저장 (kind=transfer, category="이체", subCategory="카드결제이체").
 * 레거시(kind=expense, category="신용결제") 데이터도 같은 탭에 표시. AccountsPage 카드부채 로직 의존.
 *
 * 입력 폼은 LedgerEntryForm(분리 컴포넌트)이 form 상태를 소유 — 폼 타이핑이 이 페이지를 재렌더하지 않음.
 * 외부 접점(필터 일괄 초기화·복사 적재)은 ledgerFormRef의 patchForm/startCopy로 처리.
 */
import React, { useEffect, useMemo, useState, useRef, useCallback, useDeferredValue } from "react";
import type { Account, AccountBalanceRow, CategoryPresets, LedgerEntry, LedgerTemplate, StockTrade } from "../types";
import { formatKRW } from "../utils/formatter";
import { shortcutManager, type ShortcutAction } from "../utils/shortcuts";
import { isSavingsExpenseEntry, makeIsSavingsExpense, isCreditPayment, isInvestmentKind, isInvestmentEntry } from "../utils/category";
import { parseAmount as sharedParseAmount } from "../utils/parseAmount";
import { newIdWithPrefix } from "../utils/id";
import { DailyBudgetBar } from "../features/ledger/DailyBudgetBar";
import { DEFAULT_DAILY_BUDGET } from "../utils/dailyBudget";
import { useAppStore } from "../store/appStore";
import { saveSafetySnapshot } from "../services/backupService";
import { getKoreaTime, getThisMonthKST, getTodayKST } from "../utils/date";
import { toast } from "react-hot-toast";
import { computeRealizedPnlByTradeId } from "../calculations";
import { exportLedgerCsv } from "../utils/csvExport";
import { QuickCopyModal } from "../features/ledger/QuickCopyModal";
import { DescriptionMergeModal } from "../features/ledger/DescriptionMergeModal";
import { TaxiSplitWizard } from "../features/ledger/TaxiSplitWizard";
import {
  ledgerEntryGross,
  tradeToLedgerRow,
  type LedgerDisplayRow,
} from "../utils/ledgerHelpers";
import { MonthNavigator } from "../components/ledger/MonthNavigator";
import { EXPENSE_BOX_EXCLUDED_NAMES, isExcludedExpenseName } from "../features/dashboard/summaryMath";
import { useFxRateValue } from "../context/FxRateContext";
import { LedgerEntryForm, type LedgerEntryFormHandle, type LedgerTab } from "../features/ledger/LedgerEntryForm";
import { LedgerFilterCard } from "../features/ledger/LedgerFilterCard";
import { LedgerSummarySection } from "../features/ledger/LedgerSummarySection";
import { LedgerTable, type LedgerSortState } from "../features/ledger/LedgerTable";

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  balances?: AccountBalanceRow[];
  trades?: StockTrade[];
  categoryPresets: CategoryPresets;
  ledgerTemplates?: LedgerTemplate[];
  onChangeLedger: (next: LedgerEntry[]) => void;
  onChangeTemplates?: (next: LedgerTemplate[]) => void;
  onChangeCategoryPresets?: (next: CategoryPresets) => void;
  copyRequest?: LedgerEntry | null;
  onCopyComplete?: () => void;
  highlightLedgerId?: string | null;
  onClearHighlightLedger?: () => void;
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
  onChangeCategoryPresets,
  copyRequest,
  onCopyComplete,
  highlightLedgerId,
  onClearHighlightLedger
}) => {
  const deferredLedger = useDeferredValue(ledger);
  const deferredTrades = useDeferredValue(trades);
  // USD 항목 KRW 환산용 환율 — 합산 시 대시보드 summaryMath.toKrw와 동일 정책
  const fxRate = useFxRateValue();
  // dailyBudget 설정 — store에서 직접 읽음 (props로 안 받음)
  const dailyBudgetConfig = useAppStore((s) => s.data.dailyBudget) ?? DEFAULT_DAILY_BUDGET;
  // 입력 폼 상태는 LedgerEntryForm이 소유 — 외부 접점(필터 초기화·복사 적재)은 ref API로
  const ledgerFormRef = useRef<LedgerEntryFormHandle>(null);
  // 기본값을 월별 보기로 설정하여 성능 최적화
  const [viewMode, setViewMode] = useState<"all" | "monthly">("monthly");
  const [ledgerTab, setLedgerTab] = useState<LedgerTab>("all");
  const [quickCopyEntry, setQuickCopyEntry] = useState<LedgerEntry | null>(null);
  const [quickCopyAmount, setQuickCopyAmount] = useState("");
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [showTaxiSplitWizard, setShowTaxiSplitWizard] = useState(false);
  // 가계부 필터 영역은 기본 접힘 — 화면 너무 차지하던 문제 해결.
  // 접힌 상태에서도 활성 필터 요약 칩이 헤더 한 줄에 표시됨 (LedgerFilterCard).
  const [showFilters, setShowFilters] = useState(false);
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(() => new Set([getThisMonthKST()]));
  const [currentYear, setCurrentYear] = useState(() => String(getKoreaTime().getFullYear()));
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
  // 정렬 상태 — 정렬 적용은 filteredLedger memo에서, 헤더 토글 UI는 LedgerTable에서
  const [ledgerSort, setLedgerSort] = useState<LedgerSortState>({
    key: "date",
    direction: "desc"
  });
  const [lastAddedEntryId, setLastAddedEntryId] = useState<string | null>(null);

  // Shift+드래그 구간 선택 / Shift+클릭 추가·제거
  const [selectedLedgerIdsForSum, setSelectedLedgerIdsForSum] = useState<Set<string>>(new Set());
  const [dragSumStartIndex, setDragSumStartIndex] = useState<number | null>(null);
  const [dragSumEndIndex, setDragSumEndIndex] = useState<number | null>(null);
  const dragSumListenersRef = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);
  const dragSumStartRef = useRef<number>(0);
  const dragSumEndRef = useRef<number>(0);

  const submitQuickCopy = () => {
    if (!quickCopyEntry) return;
    // USD 항목은 소수점 입력 허용 (폼의 USD 이체 입력과 동일 규칙)
    const parsed = sharedParseAmount(quickCopyAmount, { allowDecimal: quickCopyEntry.currency === "USD" });
    if (parsed <= 0) {
      toast.error("금액을 입력해주세요.");
      return;
    }
    const id = newIdWithPrefix("L");
    const entry: LedgerEntry = {
      ...quickCopyEntry,
      id,
      amount: parsed,
      discountAmount: undefined,
    };
    onChangeLedger([entry, ...ledger]);
    setLastAddedEntryId(id);
    // 필터는 폼과 독립이라 빠른 복사 후에도 유지
    const amountStr = quickCopyEntry.currency === "USD"
      ? `${parsed.toLocaleString()} USD`
      : `${parsed.toLocaleString()}원`;
    toast.success(`${quickCopyEntry.category || "항목"} ${amountStr} 복사 추가`);
    setQuickCopyEntry(null);
    setQuickCopyAmount("");
  };

  // 셀 편집 취소 — ESC 단축키(부모)와 memo된 LedgerTable 양쪽에서 쓰므로 useCallback으로 참조 고정
  const cancelEditField = useCallback(() => {
    setEditingField(null);
    setEditingValue("");
  }, []);

  // 키보드 단축키 처리 — 폼 단축키(new-entry/submit-form)는 LedgerEntryForm으로 이동
  useEffect(() => {
    const handler = {
      action: "close-modal" as ShortcutAction,
      handler: () => {
        if (editingField) cancelEditField();
      }
    };

    shortcutManager.register(handler);
    return () => {
      shortcutManager.unregister(handler);
    };
  }, [editingField, cancelEditField]);

  // 빠른 필터 상태
  const [dateFilter, setDateFilter] = useState<{
    startDate?: string;
    endDate?: string;
  }>({});

  // memo된 하위 컴포넌트(LedgerSummarySection/LedgerFilterCard)에 넘기므로 참조 안정성 필요
  const clearDateFilter = useCallback(() => {
    setDateFilter({});
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilterMainCategory(undefined);
    setFilterSubCategory(undefined);
    setFilterDetailCategory(undefined);
    setFilterFromAccountId(undefined);
    setFilterToAccountId(undefined);
    setFilterAccountId(null);
    setFilterAmountMin(undefined);
    setFilterAmountMax(undefined);
    setFilterTagsInput("");
    setSearchQuery("");
    setDateFilter({});
    // 폼 상태는 LedgerEntryForm 소유 — ref API로 부분 리셋 (ref는 참조 안정이라 deps는 [] 유지)
    ledgerFormRef.current?.patchForm({ mainCategory: "", subCategory: "", fromAccountId: "", toAccountId: "" });
    // 월별 보기 / 종류 탭은 사용자가 유지 — 일부러 건드리지 않음
  }, []);

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
  // 특수 탭 처리:
  //   - "creditPayment": 이체>카드결제이체(신버전) + expense/신용결제(레거시) 항목
  //   - "savingsExpense" (재테크 탭): 재테크 관련 모든 항목을 한 화면에 모음:
  //       · expense: category="재테크" OR isSavingsExpenseEntry (사용자 categoryTypes.savings)
  //       · income: 배당·이자·투자수익 (category/subCategory/description 매칭)
  //       · transfer: subCategory ∈ {저축이체, 투자이체, 저축, 투자}
  //       · trade: tradesAsLedgerRows로 합쳐진 매수/매도 행 (_tradeId 마커)
  //   - "all": 전체
  //   - "income"/"expense"/"transfer": 해당 kind만
  const ledgerByTab = useMemo(() => {
    const investmentRelated = (l: LedgerDisplayRow): boolean => {
      if (l._tradeId) return true; // 매수·매도 가상 행
      if (l.kind === "expense") {
        if (l.category === "재테크") return true;
        return isSavingsExpenseEntry(l, accounts, categoryPresets);
      }
      if (l.kind === "income") {
        const cat = l.category ?? "";
        const sub = l.subCategory ?? "";
        const desc = l.description ?? "";
        if (cat === "배당" || cat === "이자") return true;
        if (sub === "배당" || sub === "이자" || sub === "투자수익") return true;
        if (desc.includes("배당") || desc.includes("이자")) return true;
        return false;
      }
      if (l.kind === "transfer") {
        const sub = l.subCategory ?? "";
        return sub === "저축이체" || sub === "투자이체" || sub === "저축" || sub === "투자";
      }
      return false;
    };
    return combinedLedger.filter((l) => {
      if (ledgerTab === "all") return true;
      if (ledgerTab === "creditPayment") {
        // 신버전: 이체 > 카드결제이체. 레거시: expense + 신용결제 (미마이그레이션 데이터)
        return (
          (l.kind === "transfer" && l.subCategory === "카드결제이체") ||
          (l.kind === "expense" && l.category === "신용결제")
        );
      }
      if (ledgerTab === "savingsExpense") {
        return investmentRelated(l);
      }
      return l.kind === ledgerTab;
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

    // 대분류/중분류/소분류 필터 (모든 탭 동일: category / subCategory / detailCategory)
    // "재테크" 대분류는 특수 처리 — 데이터 구조상 재테크 관련 항목이 여러 형태로 흩어져 있음:
    //  - kind=expense, category=재테크 (투자손실)
    //  - kind=transfer, subCategory=저축이체/투자이체 (자산 이전)
    //  - kind=income, subCategory=투자수익 (실현 수익)
    // category=="재테크"만 매칭하면 transfer류가 누락돼서 대시보드 "이번 달 재테크"와 숫자가 다름.
    if (filterMainCategory || filterSubCategory || filterDetailCategory) {
      filtered = filtered.filter((l) => {
        if (filterMainCategory) {
          if (filterMainCategory === "재테크") {
            if (!isInvestmentKind(l)) return false;
          } else if (l.category !== filterMainCategory) {
            return false;
          }
        }
        if (filterSubCategory && l.subCategory !== filterSubCategory) return false;
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

    // 입금계좌 필터 (수입/이체 탭)
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
      // 금액 검색: 쉼표·공백 제거 후 전부 숫자면 금액(절삭·절대값)에도 부분 일치 허용
      const digitQuery = q.replace(/[,\s]/g, "");
      const isDigitQuery = digitQuery.length > 0 && /^\d+$/.test(digitQuery);
      filtered = filtered.filter((l) => {
        return (
          (isDigitQuery && String(Math.trunc(Math.abs(l.amount ?? 0))).includes(digitQuery)) ||
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
  }, [ledgerByTab, viewMode, selectedMonths, dateFilter, filterMainCategory, filterSubCategory, filterDetailCategory, filterAccountId, filterFromAccountId, filterToAccountId, filterAmountMin, filterAmountMax, filterTagsInput, searchQuery, ledgerSort]);

  const tabLabel: Record<LedgerTab, string> = {
    all: "전체",
    income: "수입",
    expense: "지출",
    savingsExpense: "재테크",
    transfer: "이체",
    creditPayment: "신용결제"
  };
  const summaryTabLabel = ledgerTab === "all" ? "거래" : tabLabel[ledgerTab];

  // 필터 적용 시 지출액/수입액/전체 요약 (지출 = 재테크·저축성지출 제외한 expense만)
  // 성능: 5000건 기준 3회→1회 루프로 감소. makeIsSavingsExpense로 Set을 한 번만 생성.
  const filteredSummary = useMemo(() => {
    // "전월" 기준: 월별 보기에서 월을 선택했으면 가장 이른 선택 월 기준, 아니면 실제 오늘(KST) 기준
    const sortedSelected = Array.from(selectedMonths).sort();
    const baseMonth =
      viewMode === "monthly" && sortedSelected.length > 0 ? sortedSelected[0] : getThisMonthKST();
    const [ty, tm] = baseMonth.split("-").map(Number);
    const prevMonth = `${tm === 1 ? ty - 1 : ty}-${String(tm === 1 ? 12 : tm - 1).padStart(2, "0")}`;
    const isSavings = makeIsSavingsExpense(categoryPresets);
    // USD 항목은 환율로 KRW 환산 후 합산 — 대시보드 summaryMath.toKrw와 동일 정책
    const toKrw = (l: LedgerDisplayRow) => (l.currency === "USD" && fxRate ? l.amount * fxRate : l.amount);

    let savingsAmount = 0;
    let expenseAmount = 0;
    let excludedExpenseAmount = 0; // 지출 중 데이터비 등 제외 대상 합계 ('제외 후' 표시용)
    let incomeAmount = 0;
    const excludedNames = new Set(EXPENSE_BOX_EXCLUDED_NAMES);
    for (const l of filteredLedger) {
      // 재테크 = 저축성지출(expense 재테크/저축성지출) + 저축·투자 이체(transfer 저축이체/투자이체).
      // 옛 기준(isSavings, expense만)은 현행 데이터(이체로 기록된 저축/투자)를 못 잡아 0으로 나왔음.
      if (isInvestmentEntry(l) || isSavings(l)) {
        savingsAmount += toKrw(l);
      } else if (l.kind === "expense" && !isCreditPayment(l)) {
        // 신용결제는 카드 사용 시점에 이미 expense로 잡힘 — 이중계상 방지
        expenseAmount += toKrw(l);
        if (isExcludedExpenseName(l, excludedNames)) excludedExpenseAmount += toKrw(l);
      }
      if (l.kind === "income") {
        incomeAmount += toKrw(l);
      }
    }

    // 전월 대비 비교 — 현재 합계와 동일한 데이터 소스(ledgerByTab: 탭 필터 + trade 가상 행 포함)와
    // 동일한 분류 기준(재테크 제외·신용결제 제외)으로 1회 순회.
    // 진행 중인 이번 달을 보는 중이면 전월도 같은 기간(1~오늘 일)만 합산 —
    // 부분 월 vs 완전한 월 비교 왜곡 방지 (월급 25일이면 월중 내내 수입이 급감으로 보임)
    const prevDayCap =
      viewMode === "monthly" && baseMonth === getThisMonthKST() ? Number(getTodayKST().slice(8, 10)) : null;
    let prevExpense = 0;
    let prevIncome = 0;
    let prevCount = 0;
    for (const l of ledgerByTab) {
      if (!l.date?.startsWith(prevMonth)) continue;
      if (prevDayCap != null && Number(l.date.slice(8, 10)) > prevDayCap) continue;
      prevCount += 1;
      if (l.kind === "income") {
        prevIncome += toKrw(l);
      } else if (
        l.kind === "expense" &&
        !isInvestmentEntry(l) &&
        !isSavings(l) &&
        !isCreditPayment(l)
      ) {
        prevExpense += toKrw(l);
      }
    }

    return {
      expenseAmount,
      excludedExpenseAmount,
      savingsAmount,
      incomeAmount,
      total: incomeAmount - expenseAmount,
      prevExpense,
      prevIncome,
      hasPrev: prevCount > 0,
      prevMonth,
      prevDayCap,
    };
  }, [filteredLedger, categoryPresets, ledgerByTab, viewMode, selectedMonths, fxRate]);

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

  // 필터 변경 시 선택 합계 초기화
  useEffect(() => {
    setSelectedLedgerIdsForSum(new Set());
  }, [filteredLedger.length]);

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

  // 선택된 행 기준 합계 (표시용)
  const sumResultFromSelection = useMemo(() => {
    if (selectedLedgerIdsForSum.size === 0) return null;
    const slice = filteredLedger.filter((e) => selectedLedgerIdsForSum.has(e.id));
    if (slice.length === 0) return null;
    let incomeSum = 0;
    let expenseSum = 0;
    let transferSum = 0;
    slice.forEach((e) => {
      // USD 항목은 환율로 KRW 환산 후 합산 (요약 카드와 동일 정책)
      const amt = e.currency === "USD" && fxRate ? e.amount * fxRate : e.amount;
      if (e.kind === "income") incomeSum += amt;
      else if (e.kind === "transfer" || isSavingsExpenseEntry(e, accounts, categoryPresets)) transferSum += amt;
      else expenseSum += amt;
    });
    return {
      count: slice.length,
      incomeSum,
      expenseSum,
      transferSum,
      net: incomeSum - expenseSum - transferSum
    };
  }, [filteredLedger, selectedLedgerIdsForSum, accounts, categoryPresets, fxRate]);

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
    monthsByYear.forEach((months) => {
      months.sort().reverse();
    });
    return monthsByYear;
  }, [availableMonths]);

  // 선택된 월 표시용 레이블
  const selectedMonthsLabel = useMemo(() => {
    if (selectedMonths.size === 0) return "";
    return Array.from(selectedMonths).sort().join(", ");
  }, [selectedMonths]);

  // 현재 선택된 년도에 해당하는 월만 필터링
  const availableMonthsForCurrentYear = useMemo(() => {
    return availableMonthsByYear.get(currentYear) || [];
  }, [availableMonthsByYear, currentYear]);

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
  }, []);

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

  const filterFromAccount = filterFromAccountId ? accounts.find((a) => a.id === filterFromAccountId) : null;
  const filterFromAccountName = filterFromAccountId ? (filterFromAccount?.name || filterFromAccount?.id || filterFromAccountId) : null;
  const filterToAccount = filterToAccountId ? accounts.find((a) => a.id === filterToAccountId) : null;
  const filterToAccountName = filterToAccountId ? (filterToAccount?.name || filterToAccount?.id || filterToAccountId) : null;

  return (
    <div>
      <DailyBudgetBar ledger={ledger} config={dailyBudgetConfig} />
      <div className="section-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>가계부 (거래 입력)</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className="secondary"
            style={{ fontSize: 12, padding: "6px 12px" }}
            onClick={() => setShowTaxiSplitWizard(true)}
            title="유류교통비에서 택시를 별도 소분류로 분리"
          >
            🚕 택시 분리
          </button>
          <button
            type="button"
            className="secondary"
            style={{ fontSize: 12, padding: "6px 12px" }}
            onClick={() => setShowMergeModal(true)}
            title="유사한 description을 한 번에 통합"
          >
            🔀 유사 설명 통합
          </button>
          <button
            type="button"
            className="secondary"
            style={{ fontSize: 12, padding: "6px 12px" }}
            onClick={() => {
              // 주식 매매 가상 행(_tradeId)은 가계부 원본이 아니므로 제외 — 주식 탭 CSV에서 따로 내보냄
              const entries = filteredLedger.filter((l) => !l._tradeId);
              exportLedgerCsv(entries, accounts);
              toast.success(`${entries.length}건 CSV 내보내기 완료`);
            }}
          >
            CSV 내보내기
          </button>
        </div>
      </div>

      {showMergeModal && (
        <DescriptionMergeModal
          ledger={ledger}
          onApply={(next) => {
            const changedCount = next.reduce(
              (count, l, i) => count + (l !== ledger[i] ? 1 : 0),
              0
            );
            if (changedCount > 0) {
              // 다건 일괄 변경 → 안전 스냅샷 (불변식 #9)
              void saveSafetySnapshot(useAppStore.getState().data, "description 통합 직전 자동 스냅샷");
            }
            onChangeLedger(next);
            if (changedCount > 0) {
              toast.success(`${changedCount}건 description 통합 완료`);
            }
          }}
          onClose={() => setShowMergeModal(false)}
        />
      )}

      {showTaxiSplitWizard && (
        <TaxiSplitWizard
          ledger={ledger}
          categoryPresets={categoryPresets}
          onChangeLedger={(next) => {
            const changedCount = next.reduce(
              (count, l, i) => count + (l !== ledger[i] ? 1 : 0),
              0
            );
            if (changedCount > 0) {
              // 다건 일괄 변경 → 안전 스냅샷 (불변식 #9)
              void saveSafetySnapshot(useAppStore.getState().data, "택시 분리 일괄 변경 직전 자동 스냅샷");
            }
            onChangeLedger(next);
            if (changedCount > 0) {
              toast.success(`${changedCount}건 detailCategory를 '택시'로 변경`);
            }
          }}
          onChangeCategoryPresets={(next) => {
            if (onChangeCategoryPresets) {
              onChangeCategoryPresets(next);
              toast.success("프리셋에 '택시' 소분류 추가");
            } else {
              toast.error("카테고리 프리셋 변경 핸들러 미연결 — 앱 재시작 필요");
            }
          }}
          onClose={() => setShowTaxiSplitWizard(false)}
        />
      )}

      {/* 요약 카드 + 필터 칩 + 월별 비교 — 분리 컴포넌트 (React.memo) */}
      <LedgerSummarySection
        hasFilter={hasFilter}
        viewMode={viewMode}
        selectedMonthsLabel={selectedMonthsLabel}
        summaryTabLabel={summaryTabLabel}
        filteredSummary={filteredSummary}
        filterMainCategory={filterMainCategory}
        filterSubCategory={filterSubCategory}
        filterDetailCategory={filterDetailCategory}
        filterFromAccountId={filterFromAccountId}
        filterToAccountId={filterToAccountId}
        filterFromAccountName={filterFromAccountName}
        filterToAccountName={filterToAccountName}
        setFilterMainCategory={setFilterMainCategory}
        setFilterSubCategory={setFilterSubCategory}
        setFilterDetailCategory={setFilterDetailCategory}
        setFilterFromAccountId={setFilterFromAccountId}
        setFilterToAccountId={setFilterToAccountId}
        hasDateFilter={hasDateFilter}
        dateFilter={dateFilter}
        clearDateFilter={clearDateFilter}
        hasAmountFilter={hasAmountFilter}
        filterAmountMin={filterAmountMin}
        filterAmountMax={filterAmountMax}
        setFilterAmountMin={setFilterAmountMin}
        setFilterAmountMax={setFilterAmountMax}
        hasTagFilter={hasTagFilter}
        filterTagsInput={filterTagsInput}
        setFilterTagsInput={setFilterTagsInput}
        clearAllFilters={clearAllFilters}
        selectedMonths={selectedMonths}
        filteredLedger={filteredLedger}
        categoryPresets={categoryPresets}
      />

      {/* 입력 폼 — 분리 컴포넌트 (React.memo + forwardRef). 폼 상태는 자식 소유 */}
      <LedgerEntryForm
        ref={ledgerFormRef}
        accounts={accounts}
        ledger={ledger}
        categoryPresets={categoryPresets}
        onChangeLedger={onChangeLedger}
        ledgerTab={ledgerTab}
        setLedgerTab={setLedgerTab}
        setFilterMainCategory={setFilterMainCategory}
        setFilterSubCategory={setFilterSubCategory}
        setFilterDetailCategory={setFilterDetailCategory}
        copyRequest={copyRequest}
        onCopyComplete={onCopyComplete}
        onEntryAdded={setLastAddedEntryId}
        ledgerTemplates={ledgerTemplates}
        onChangeTemplates={onChangeTemplates}
      />

      {/* ── 필터 영역 (기본 접힘 — 너무 큰 영역 차지하던 문제 해결) ── */}
      <LedgerFilterCard
        ledger={ledger}
        tabLedger={ledgerByTab}
        accounts={accounts}
        showFilters={showFilters}
        setShowFilters={setShowFilters}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        filterMainCategory={filterMainCategory}
        filterSubCategory={filterSubCategory}
        filterDetailCategory={filterDetailCategory}
        filterFromAccountId={filterFromAccountId}
        filterToAccountId={filterToAccountId}
        setFilterMainCategory={setFilterMainCategory}
        setFilterSubCategory={setFilterSubCategory}
        setFilterDetailCategory={setFilterDetailCategory}
        setFilterFromAccountId={setFilterFromAccountId}
        setFilterToAccountId={setFilterToAccountId}
        filterAccountId={filterAccountId}
        filterAmountMin={filterAmountMin}
        filterAmountMax={filterAmountMax}
        filterTagsInput={filterTagsInput}
        dateFilter={dateFilter}
        viewMode={viewMode}
        setViewMode={setViewMode}
        clearAllFilters={clearAllFilters}
      />
      {viewMode === "monthly" && (
          <MonthNavigator
            selectedMonths={selectedMonths}
            onChangeSelectedMonths={setSelectedMonths}
            currentYear={currentYear}
            onChangeCurrentYear={setCurrentYear}
            availableMonthsForCurrentYear={availableMonthsForCurrentYear}
          />
        )}

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
        <strong>Shift+드래그</strong>로 구간 토글(선택된 건 해제), <strong>Shift+클릭</strong>으로 1건 토글. 합계는 아래에 고정 표시됩니다.
        {viewMode === "all" && ledgerSort.key === "date" && (
          <> 행 앞 ☰를 드래그하면 같은 날짜 안에서 순서를 바꿀 수 있습니다.</>
        )}
      </p>
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
      {/* 거래 테이블 — 분리 컴포넌트 (React.memo) */}
      <LedgerTable
        ledger={ledger}
        accounts={accounts}
        categoryPresets={categoryPresets}
        filteredLedger={filteredLedger}
        balanceAfterByLedgerId={balanceAfterByLedgerId}
        viewMode={viewMode}
        ledgerScrollKey={ledgerScrollKey}
        ledgerSort={ledgerSort}
        setLedgerSort={setLedgerSort}
        editingField={editingField}
        editingValue={editingValue}
        setEditingField={setEditingField}
        setEditingValue={setEditingValue}
        cancelEditField={cancelEditField}
        dragSumStartIndex={dragSumStartIndex}
        dragSumEndIndex={dragSumEndIndex}
        handleDragSumStart={handleDragSumStart}
        selectedLedgerIdsForSum={selectedLedgerIdsForSum}
        setSelectedLedgerIdsForSum={setSelectedLedgerIdsForSum}
        onChangeLedger={onChangeLedger}
        setQuickCopyEntry={setQuickCopyEntry}
        setQuickCopyAmount={setQuickCopyAmount}
      />

      {/* 빠른 복사 모달 */}
      {quickCopyEntry && (() => {
        const qe = quickCopyEntry;
        const fromName = accounts.find((a) => a.id === qe.fromAccountId)?.name ?? qe.fromAccountId;
        const toName = accounts.find((a) => a.id === qe.toAccountId)?.name ?? qe.toAccountId;
        const categoryLabel = [qe.category, qe.subCategory, qe.detailCategory].filter(Boolean).join(" > ");
        const kindLabel = qe.kind === "income" ? "수입" : qe.kind === "transfer" ? "이체" : "지출";
        return (
          <QuickCopyModal
            kindLabel={kindLabel}
            date={qe.date}
            categoryLabel={categoryLabel}
            description={qe.description}
            fromName={fromName}
            toName={toName}
            amount={quickCopyAmount}
            allowDecimal={qe.currency === "USD"}
            onAmountChange={setQuickCopyAmount}
            onSubmit={submitQuickCopy}
            onEditInForm={() => {
              // 폼 적재는 LedgerEntryForm 소유 — ref API로 위임
              ledgerFormRef.current?.startCopy(quickCopyEntry);
              setQuickCopyEntry(null);
              setQuickCopyAmount("");
            }}
            onClose={() => { setQuickCopyEntry(null); setQuickCopyAmount(""); }}
          />
        );
      })()}
    </div>
  );
};

