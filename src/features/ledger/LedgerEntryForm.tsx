/**
 * 가계부 입력 폼 — 종류 탭 토글 + 날짜/금액 + 대분류·중분류 picker + 계좌 선택 + 영수증 OCR.
 * LedgerPage에서 분리 — form 상태를 이 컴포넌트가 소유해 폼 타이핑이 부모(LedgerPage)를 재렌더하지 않는다.
 * React.memo(forwardRef)로 감싸 폼과 무관한 부모 상태 변경 시 재렌더를 건너뛴다.
 * 부모가 넘기는 콜백은 모두 안정적(setState 또는 useCallback)이어야 memo가 효과를 가진다.
 *
 * 부모 → 폼 외부 접점은 ref API로 노출:
 *   - patchForm(partial): 필터 일괄 초기화 시 폼의 카테고리/계좌만 부분 리셋
 *   - startCopy(entry):   빠른 복사 모달 "폼에서 수정" — 기존 항목을 폼에 적재
 * 새 항목 추가 후 행 하이라이트는 부모 소유 — onEntryAdded(id) 콜백으로 알림.
 */
import React, { useCallback, useDeferredValue, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Autocomplete } from "../../components/ui/Autocomplete";
import type { Account, CategoryPresets, ExpenseDetailGroup, LedgerEntry, LedgerKind, LedgerTemplate } from "../../types";
import { shortcutManager, type ShortcutAction } from "../../utils/shortcuts";
import { validateLedgerForm } from "./validateLedgerForm";
import { parseAmount as sharedParseAmount, formatAmount as sharedFormatAmount } from "../../utils/parseAmount";
import { newIdWithPrefix } from "../../utils/id";
import { DEFAULT_DAILY_BUDGET, dailySpend, weeklySpend, weeklyLimit, getCurrentWeekRange } from "../../utils/dailyBudget";
import { useAppStore } from "../../store/appStore";
import { toast } from "react-hot-toast";
import { ERROR_MESSAGES } from "../../constants/errorMessages";
import { ReceiptScanner, type OcrResult } from "../ocr/ReceiptScanner";
import {
  createDefaultLedgerForm as createDefaultForm,
  ledgerTemplateToForm,
  ledgerFormToTemplate,
  type LedgerFormState,
} from "../../utils/ledgerHelpers";
import { LedgerTemplateChips } from "./LedgerTemplateChips";
import { LedgerTemplateManageModal } from "./LedgerTemplateManageModal";
import { buildRestoreById, showDeleteUndoToast } from "../../utils/undoToast";
import { useFxRateValue } from "../../context/FxRateContext";
import {
  buildDescriptionIndex,
  describeSuggestion,
  fillEmptyFormFields,
  suggestDescriptions,
  type DescriptionSuggestion,
} from "../../utils/ledgerSuggest";
import { recommendCategory, type Recommendation } from "../../utils/categoryRecommendation";

export type LedgerTab = "all" | "income" | "expense" | "savingsExpense" | "transfer" | "creditPayment";

/**
 * 재테크 탭에서 직접 입력 가능한 중분류 — 신용결제처럼 자동 매핑된다.
 * 저장 형태(분류 단일소스와 일치):
 *  - 투자손실 → 지출(expense), category="재테크", subCategory="투자손실"
 *  - 투자수익 → 수입(income), category="수입", subCategory="투자수익"
 *  - 배당/이자 → 수입(income), category="수입", subCategory="배당"/"이자" (배당/이자 탭 입력과 동일 형태)
 */
export const SAVINGS_INVEST_SUBS = ["투자수익", "투자손실", "배당", "이자"] as const;
const SAVINGS_INVEST_DEFAULT = "투자수익";
/** 재테크 중분류 → 저장 kind (투자손실만 지출, 나머지는 수입) */
const savingsKindForSub = (sub: string): LedgerKind => (sub === "투자손실" ? "expense" : "income");

/**
 * 재테크 중분류 → 저장 형태 (kind/category/subCategory). 분류 단일소스와 일치.
 * 폼 submit과 테스트가 공유하는 단일 진입점.
 */
export function savingsInvestStored(sub: string): { kind: LedgerKind; category: string; subCategory: string } {
  if (sub === "투자손실") return { kind: "expense", category: "재테크", subCategory: "투자손실" };
  // 투자수익/배당/이자 → 수입 (배당/이자 탭 입력과 동일 형태 — isDividendEntry/isInterestEntry 정확 매칭)
  return { kind: "income", category: "수입", subCategory: sub };
}

/** 부모(LedgerPage)에서 ref로 호출하는 폼 외부 접점 */
export interface LedgerEntryFormHandle {
  /** 폼 일부 필드만 갱신 — 필터 일괄 초기화 등에서 사용 */
  patchForm: (partial: Partial<LedgerFormState>) => void;
  /** 기존 항목을 폼에 복사 적재 (빠른 복사 모달 → "폼에서 수정") */
  startCopy: (entry: LedgerEntry) => void;
}

// 종류 토글 버튼 라벨 (income/expense/transfer만 폼에서 사용)
const tabLabel: Record<"income" | "expense" | "transfer", string> = {
  income: "수입",
  expense: "지출",
  transfer: "이체"
};

// `?? []` 신규 배열 생성으로 인한 LedgerTemplateChips memo 무효화 방지용 안정 참조
const EMPTY_TEMPLATES: LedgerTemplate[] = [];

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  categoryPresets: CategoryPresets;
  onChangeLedger: (next: LedgerEntry[]) => void;
  /** 종류 탭은 목록 필터와 공유되므로 부모 소유 */
  ledgerTab: LedgerTab;
  setLedgerTab: React.Dispatch<React.SetStateAction<LedgerTab>>;
  /**
   * 리스트 필터 setter (부모 setState — 참조 안정).
   * 두 용도: ① 종류 탭 전환 시 하위 필터 초기화, ② 입력 폼 버튼이 곧 필터 (사용자 요청).
   */
  setFilterMainCategory: React.Dispatch<React.SetStateAction<string | undefined>>;
  setFilterSubCategory: React.Dispatch<React.SetStateAction<string | undefined>>;
  setFilterDetailCategory: React.Dispatch<React.SetStateAction<string | undefined>>;
  setFilterFromAccountId: React.Dispatch<React.SetStateAction<string | undefined>>;
  setFilterToAccountId: React.Dispatch<React.SetStateAction<string | undefined>>;
  /** 계좌(통합) 필터 — 출금/입금 선택 시 상호 배타 규칙 적용(LedgerFilterBar와 동일) */
  setFilterAccountId: React.Dispatch<React.SetStateAction<string | null>>;
  /** 외부(검색 등)에서 복사 요청 — 폼에 적재 후 onCopyComplete 호출 */
  copyRequest?: LedgerEntry | null;
  onCopyComplete?: () => void;
  /** 새 항목 추가 알림 — 부모가 행 스크롤/하이라이트 처리 (setState — 참조 안정) */
  onEntryAdded: (id: string) => void;
  /** 자주 쓰는 거래 템플릿 — onChangeTemplates가 없으면 칩 UI를 렌더하지 않음 */
  ledgerTemplates?: LedgerTemplate[];
  onChangeTemplates?: (next: LedgerTemplate[]) => void;
}

export const LedgerEntryForm = React.memo(React.forwardRef<LedgerEntryFormHandle, Props>(
  function LedgerEntryForm({
    accounts,
    ledger,
    categoryPresets,
    onChangeLedger,
    ledgerTab,
    setLedgerTab,
    setFilterMainCategory,
    setFilterSubCategory,
    setFilterDetailCategory,
    setFilterFromAccountId,
    setFilterToAccountId,
    setFilterAccountId,
    copyRequest,
    onCopyComplete,
    onEntryAdded,
    ledgerTemplates,
    onChangeTemplates
  }, ref) {
    // dailyBudget 설정 — store에서 직접 읽음 (props로 안 받음)
    const dailyBudgetConfig = useAppStore((s) => s.data.dailyBudget) ?? DEFAULT_DAILY_BUDGET;
    // 하루 예산 사전 경고의 USD 환산용 환율 (DailyBudgetBar와 동일 기준)
    const fxRate = useFxRateValue();
    const [form, setForm] = useState(createDefaultForm);
    const [formKindWhenAll, setFormKindWhenAll] = useState<"income"|"expense"|"transfer">("expense");
    const effectiveFormKind: LedgerKind =
      ledgerTab === "all"
        ? formKindWhenAll
        : ledgerTab === "savingsExpense"
          ? savingsKindForSub(form.subCategory) // 중분류에 따라 투자손실=지출, 나머지=수입
          : ledgerTab === "creditPayment"
            ? "transfer"
            : ledgerTab;
    const kindForTab: LedgerKind = effectiveFormKind;
    const isCopyingRef = useRef(false);
    const [showTemplateManage, setShowTemplateManage] = useState(false);
    // form 최신값 미러 — 템플릿 콜백을 form 의존 없이 안정 참조로 유지 (memo 계약).
    // form을 deps에 넣으면 키 입력마다 콜백 참조가 바뀌어 LedgerTemplateChips의 memo가 무효가 된다.
    const latestFormRef = useRef(form);
    useEffect(() => { latestFormRef.current = form; });
    const [showReceiptScanner, setShowReceiptScanner] = useState(false);

    // 폼 검증 오류는 validateForm useMemo에서 직접 계산됨

    // 탭 전환 시 필터는 유지 — 필터는 폼과 독립이라 사용자가 의도적으로 끄거나 바꿀 때만 변경됨

    // 이체 탭일 때 form.mainCategory를 "이체"로 설정 (중분류 목록 표시용)
    useEffect(() => {
      if (ledgerTab === "transfer" && form.mainCategory !== "이체") {
        setForm((prev) => ({ ...prev, mainCategory: "이체" }));
      }
    }, [ledgerTab, form.mainCategory]);

    // 신용결제 탭은 이제 이체로 저장 (kind=transfer, category=이체, subCategory=카드결제이체).
    // 카드 대금 납부는 새 소비가 아니라 은행→카드(부채)계좌 자산 이동이므로 transfer가 정확.
    // 제출 시 category="이체", subCategory="카드결제이체"로 저장됨.
    useEffect(() => {
      if (ledgerTab === "creditPayment") {
        if (form.mainCategory !== "이체" || form.subCategory !== "카드결제이체") {
          setForm((prev) => ({ ...prev, mainCategory: "이체", subCategory: "카드결제이체" }));
        }
      }
    }, [ledgerTab, form.mainCategory, form.subCategory]);


    const expenseSubSuggestions = useMemo(() => {
      // 이체 탭: transfer 카테고리를 중분류로 사용 (계좌이체/저축/투자/환전/카드결제이체)
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
    }, [effectiveFormKind, categoryPresets, form.mainCategory]);

    // 대분류 옵션 (카테고리 탭에서 입력한 순서 그대로)
    const mainCategoryOptions = useMemo(() => {
      if (effectiveFormKind === "transfer") {
        return ["이체"];
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
    }, [effectiveFormKind, categoryPresets]);

    // 수입 중분류 옵션 (카테고리 탭에서 입력한 순서 그대로)
    const incomeCategoryOptions = useMemo(() => {
      return categoryPresets?.income ?? [];
    }, [categoryPresets?.income]);

    // ── 설명 자동완성 + 빈 필드 자동 채움 (읽기 전용 — 저장 형태 불변) ──────────
    // 인덱스는 ledger 참조가 바뀔 때만 재구축. 재테크/신용결제 탭은 분류가 자동 고정이라 채움·추천 칩 생략.
    const descriptionIndex = useMemo(() => buildDescriptionIndex(ledger), [ledger]);
    const suggestFillEnabled = ledgerTab !== "savingsExpense" && ledgerTab !== "creditPayment";
    const descriptionOptions = useMemo(
      () => suggestDescriptions(descriptionIndex, form.description, effectiveFormKind, { limit: 8 })
        .map((s) => ({
          value: s.description,
          label: `${s.count}회`,
          subLabel: describeSuggestion(s) || undefined,
        })),
      [descriptionIndex, form.description, effectiveFormKind]
    );
    // 설명 2자 이상 → 추천 칩 3개 (categoryRecommendation). 타이핑 중 무거운 재계산은 deferred.
    const deferredDescription = useDeferredValue(form.description);
    const deferredAmount = useDeferredValue(form.amount);
    const recommendationChips = useMemo((): Recommendation[] => {
      if (!suggestFillEnabled) return [];
      const desc = deferredDescription.trim();
      if (desc.length < 2) return [];
      const amount = sharedParseAmount(deferredAmount, { allowDecimal: true });
      const recs = recommendCategory(desc, amount, effectiveFormKind, ledger);
      // 같은 분류 라벨(계좌만 다른 조합)은 하나로
      const seen = new Set<string>();
      const out: Recommendation[] = [];
      for (const r of recs) {
        const key = `${r.subCategory || ""}|${r.detailCategory || ""}`;
        if (!r.subCategory || seen.has(key)) continue;
        seen.add(key);
        out.push(r);
        if (out.length >= 3) break;
      }
      return out;
    }, [suggestFillEnabled, deferredDescription, deferredAmount, effectiveFormKind, ledger]);

    /**
     * 자동완성 선택 → 비어 있는 필드만 채움. setForm만 바꾸고 목록 필터는 건드리지 않는다
     * (applyTemplate과 동일 — '폼 버튼=목록 필터'는 버튼 클릭에만 적용, 자동 채움은 필터 의도가 아님).
     * 사용자가 이미 고른 값은 절대 덮지 않는다(fillEmptyFormFields).
     */
    const applyDescriptionSuggestion = useCallback((s: DescriptionSuggestion) => {
      if (!suggestFillEnabled) return;
      const f = latestFormRef.current;
      const { next, applied } = fillEmptyFormFields(
        { mainCategory: f.mainCategory, subCategory: f.subCategory, fromAccountId: f.fromAccountId, toAccountId: f.toAccountId },
        s
      );
      if (applied.length === 0) return;
      setForm((prev) => ({ ...prev, ...next }));
      const catParts: string[] = [];
      if (applied.includes("mainCategory") && s.kind === "expense") catParts.push(next.mainCategory);
      if (applied.includes("subCategory")) catParts.push(next.subCategory);
      const acctParts: string[] = [];
      if (applied.includes("fromAccountId")) acctParts.push(next.fromAccountId);
      if (applied.includes("toAccountId")) acctParts.push(next.toAccountId);
      const label = [catParts.join(">"), acctParts.join("→")].filter(Boolean).join("·");
      toast(`지난 ${s.comboCount}회 ${label} 적용`, { id: "ledger-suggest-fill", duration: 2500 });
    }, [suggestFillEnabled]);

    /** 추천 칩 클릭 — 분류는 명시 선택이므로 덮어쓰고, 계좌는 비어 있을 때만. 필터 미변경(위와 동일 규칙). */
    const applyRecommendationChip = useCallback((r: Recommendation) => {
      setForm((prev) => {
        const isExpense = effectiveFormKind === "expense";
        return {
          ...prev,
          mainCategory: isExpense ? (r.subCategory || "") : prev.mainCategory,
          subCategory: isExpense ? (r.detailCategory || "") : (r.subCategory || ""),
          fromAccountId: prev.fromAccountId || (effectiveFormKind !== "income" ? (r.fromAccountId || "") : ""),
          toAccountId: prev.toAccountId || (effectiveFormKind !== "expense" ? (r.toAccountId || "") : ""),
        };
      });
    }, [effectiveFormKind]);

    // parseAmount/formatAmount는 src/utils/parseAmount.ts로 중앙화됨.
    // 기존 (value, allowDecimal) 시그니처를 유지하기 위한 어댑터.
    const parseAmount = useCallback((value: string, allowDecimal?: boolean): number => {
      return sharedParseAmount(value, { allowDecimal });
    }, []);

    const formatAmount = useCallback((value: string, allowDecimal?: boolean): string => {
      return sharedFormatAmount(value, { allowDecimal });
    }, []);

    // 금액 입력 onChange — JSX 속성 안 useCallback(rules-of-hooks 위반 패턴)을 컴포넌트 상단으로 이동
    const handleAmountChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      const allowDec = effectiveFormKind === "transfer" && form.currency === "USD";
      const formatted = formatAmount(e.target.value, allowDec);
      setForm((prev) => ({ ...prev, amount: formatted }));
    }, [formatAmount, effectiveFormKind, form.currency]);

    // 종류 탭 전환·"전체" 시 폼-구동 리스트 필터(대/중/소분류 + 출금/입금계좌)를 일괄 해제.
    // 종류마다 카테고리·계좌 의미가 달라(수입엔 출금계좌가 없는 등) 남겨두면 빈 목록이 된다.
    const clearListFilters = useCallback(() => {
      setFilterMainCategory(undefined);
      setFilterSubCategory(undefined);
      setFilterDetailCategory(undefined);
      setFilterFromAccountId(undefined);
      setFilterToAccountId(undefined);
    }, [setFilterMainCategory, setFilterSubCategory, setFilterDetailCategory, setFilterFromAccountId, setFilterToAccountId]);

    useEffect(() => {
      // 복사 중일 때는 폼을 초기화하지 않음
      if (isCopyingRef.current) {
        // 복사가 완료될 때까지 기다림 - 플래그는 startCopy에서 해제됨
        return;
      }
      // 재테크 탭은 중분류에 따라 kind가 바뀌므로(effectiveFormKind 변동) 이 리셋이 중분류를 지우면 안 됨
      // → 아래 전용 effect가 mainCategory/subCategory/kind를 관리한다.
      if (ledgerTab === "savingsExpense") return;
      setForm((prev) => ({
        ...prev,
        kind: kindForTab,
        isFixedExpense: false,
        mainCategory:
          effectiveFormKind === "transfer" ? "이체" : "",
        subCategory: "",
        // 복사로 들어온 태그가 종류 전환 후에도 잔존해 이후 항목에 붙는 것을 방지 (보이지 않는 오염)
        tags: [],
        fromAccountId: kindForTab === "income" ? "" : prev.fromAccountId,
        toAccountId: kindForTab === "expense" ? "" : prev.toAccountId
      }));
    }, [effectiveFormKind, kindForTab, ledgerTab]);

    // 재테크 탭 전용: 대분류를 "재테크"로 고정, 중분류는 4종 중 하나(기본 투자수익),
    // form.kind는 선택 중분류에 맞춰 수입/지출 동기화 (신용결제 탭의 자동 매핑과 동일 패턴).
    useEffect(() => {
      if (ledgerTab !== "savingsExpense" || isCopyingRef.current) return;
      setForm((prev) => {
        const sub = (SAVINGS_INVEST_SUBS as readonly string[]).includes(prev.subCategory)
          ? prev.subCategory
          : SAVINGS_INVEST_DEFAULT;
        const k = savingsKindForSub(sub);
        if (prev.mainCategory === "재테크" && prev.subCategory === sub && prev.kind === k) return prev;
        return { ...prev, mainCategory: "재테크", subCategory: sub, kind: k };
      });
    }, [ledgerTab, form.subCategory]);

    // 실시간 폼 검증
    const validateForm = useMemo(
      () => validateLedgerForm({ form, kindForTab, effectiveFormKind, accounts, parseAmount, isCreditPayment: ledgerTab === "creditPayment" }),
      [form, effectiveFormKind, parseAmount, accounts, kindForTab, ledgerTab]
    );

    // formErrors를 직접 사용 (useEffect 제거로 성능 개선)
    const formErrors = validateForm;
    const isFormValid = Object.keys(formErrors).length === 0;

    // 제출 후에는 항상 컨텍스트 유지(구분/카테고리/계좌) + 금액·설명만 비움 — 모든 제출 경로 동일 동작
    const submitForm = useCallback(() => {
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
        effectiveFormKind === "income" || effectiveFormKind === "expense";
      const discountParsed =
        allowLedgerDiscount && form.discountAmount?.trim()
          ? parseAmount(form.discountAmount, false)
          : 0;
      const amount = discountParsed > 0 ? gross - discountParsed : gross;
      if (!form.date) return;
      if (discountParsed > 0 && effectiveFormKind === "expense") {
        if (!Number.isFinite(amount)) return;
      } else if (!amount || amount <= 0) {
        return;
      }

      // 폼에 복원된 isFixedExpense(복사 경로에서 채워짐)를 보존 — 하드코딩 false는 반복 지출
      // 복사 시 고정비 플래그를 버려 고정/변동 분해·배당커버리지에서 변동비로 오분류됐다.
      const isFixed = form.isFixedExpense ?? false;

      // 하루 예산 사전 경고: kindForTab=expense이고 dailyBudget enabled일 때만
      // 이 거래로 인해 한도 초과 시 confirm 표시 (취소 시 입력 안 됨).
      // 재테크 탭(투자손실)은 kindForTab=expense지만 category="재테크"로 저장돼 예산 집계에서
      // 제외되므로(dailyBudget excludedCategories 기본값) 경고 대상이 아니다 — 오탐 confirm 방지.
      if (
        dailyBudgetConfig.enabled &&
        dailyBudgetConfig.warnOnExceed &&
        kindForTab === "expense" &&
        ledgerTab !== "creditPayment" &&
        ledgerTab !== "savingsExpense"
      ) {
        const isExcludedCat = dailyBudgetConfig.excludedCategories.includes("지출");
        const subToCheck = form.mainCategory?.trim() || "";
        const isExcludedSub = subToCheck && dailyBudgetConfig.excludedSubCategories.includes(subToCheck);
        if (!isExcludedCat && !isExcludedSub) {
          const isWeekly = dailyBudgetConfig.mode === "weekly";
          const limit = isWeekly ? weeklyLimit(dailyBudgetConfig) : dailyBudgetConfig.dailyLimit;
          const range = isWeekly ? getCurrentWeekRange(form.date) : null;
          const currentSpent = isWeekly && range
            ? weeklySpend(ledger, range.start, range.end, dailyBudgetConfig, fxRate)
            // 입력 폼의 날짜(form.date) 기준 — 과거/미래 날짜 입력 시 '오늘' 합계와 비교하던 오류 수정
            : dailySpend(ledger, form.date, dailyBudgetConfig, fxRate);
          const projected = currentSpent + amount;
          if (projected > limit) {
            const periodLabel = isWeekly ? "이번 주" : "오늘";
            const confirmMsg =
              `이 거래(₩${amount.toLocaleString()})를 추가하면 ${periodLabel} 한도 초과:\n` +
              `  현재 ₩${Math.round(currentSpent).toLocaleString()} → ₩${Math.round(projected).toLocaleString()} (한도 ₩${limit.toLocaleString()})\n` +
              `  ${Math.round(projected - limit).toLocaleString()}원 초과\n\n계속 추가하시겠습니까?`;
            if (!window.confirm(confirmMsg)) return;
          }
        }
      }

      // 카테고리 값 정규화 (빈 문자열 체크)
      const normalizedMainCategory = form.mainCategory?.trim() || "";
      const normalizedSubCategory = form.subCategory?.trim() || "";

      // 3-level 구조로 저장:
      //   - category    = "지출" / "수입" / "이체"  (대분류 — kind 자동매핑)
      //   - subCategory = 식비 / 유류교통비 / ...   (중분류 — picker의 첫째 행)
      //   - detailCategory = 시장/마트 / 주차비 / .. (소분류 — picker의 둘째 행, 지출만)
      // 신용결제 탭은 이체로 저장 (AccountsPage 부채 탕감은 카드계좌로 들어온 transfer를 인식)
      let storedCategory: string;
      let storedSubCategory: string;
      let storedDetailCategory: string | undefined;
      if (ledgerTab === "creditPayment") {
        // 카드 대금 납부 = 이체 (은행 → 카드 부채계좌)
        storedCategory = "이체";
        storedSubCategory = "카드결제이체";
        storedDetailCategory = undefined;
      } else if (ledgerTab === "savingsExpense") {
        // 재테크 자동 매핑 — 분류 단일소스와 일치하는 형태로 저장 (kind는 kindForTab과 동일)
        const mapped = savingsInvestStored(normalizedSubCategory || SAVINGS_INVEST_DEFAULT);
        storedCategory = mapped.category;
        storedSubCategory = mapped.subCategory;
        storedDetailCategory = undefined;
      } else if (kindForTab === "income") {
        storedCategory = "수입";
        storedSubCategory = normalizedSubCategory || "(미분류)";
        storedDetailCategory = undefined;
      } else if (kindForTab === "transfer") {
        storedCategory = "이체";
        storedSubCategory = normalizedSubCategory || "(미분류)";
        storedDetailCategory = undefined;
      } else {
        // expense
        storedCategory = "지출";
        storedSubCategory = normalizedMainCategory || "(미분류)";
        storedDetailCategory = normalizedSubCategory || undefined;
      }

      const base: Omit<LedgerEntry, "id"> = {
        date: form.date,
        kind: kindForTab,
        isFixedExpense: isFixed,
        category: storedCategory,
        subCategory: storedSubCategory,
        ...(storedDetailCategory ? { detailCategory: storedDetailCategory } : {}),
        description: form.description?.trim() || "",
        amount,
        fromAccountId:
          (kindForTab === "expense" || kindForTab === "transfer")
            ? (form.fromAccountId?.trim() || undefined)
            : undefined,
        toAccountId:
          (kindForTab === "income" || kindForTab === "transfer")
            ? (form.toAccountId?.trim() || undefined)
            : undefined,
        ...(allowLedgerDiscount
          ? { discountAmount: discountParsed > 0 ? discountParsed : undefined }
          : {}),
        ...(kindForTab === "transfer" && form.currency === "USD" ? { currency: "USD" as const } : {}),
        // 태그 보존 — 복사/편집 시 form.tags가 채워져 있으면 저장 (누락 시 태그가 영구 소실)
        ...(form.tags?.length ? { tags: form.tags } : {})
      };

      if (form.id) {
        const updated = ledger.map((l) => (l.id === form.id ? { ...base, id: l.id } : l));
        onChangeLedger(updated);
      } else {
        const id = newIdWithPrefix("L");
        const entry: LedgerEntry = { id, ...base };
        onChangeLedger([entry, ...ledger]);
        onEntryAdded(id);
        // 필터는 폼과 독립이라 새 항목 추가 시 자동 클리어 안 함 — 사용자가 의도적으로 좁힌 view를 유지
        const amountStr = kindForTab === "transfer" && form.currency === "USD"
          ? `${amount.toLocaleString()} USD`
          : `${amount.toLocaleString()}원`;
        const msg = effectiveFormKind === "income"
          ? `${normalizedSubCategory || "수입"} ${amountStr} 추가 되었습니다.`
          : effectiveFormKind === "transfer"
            ? `${amountStr} 이체 추가 되었습니다.`
            : `지출 - ${normalizedMainCategory} - ${normalizedSubCategory} ${amountStr} 추가 되었습니다.`;
        toast.success(msg);
      }

      // 같은 구분/카테고리/계좌를 유지하고 금액·설명만 비우기 (연속 입력 최적화).
      // tags·isFixedExpense는 복사 1건에만 적용 — 다음 연속 입력엔 보이지 않게 잔존하지 않도록 초기화
      // (폼에 태그/고정비 입력 UI가 없어 사용자가 잔존값을 보거나 지울 수 없다).
      setForm((prev) => ({
        ...prev,
        id: undefined,
        date: form.date,
        kind: kindForTab,
        isFixedExpense: false,
        mainCategory: form.mainCategory,
        subCategory: form.subCategory,
        description: "",
        fromAccountId: form.fromAccountId,
        toAccountId: form.toAccountId,
        amount: "",
        tags: [],
        ...(allowLedgerDiscount ? { discountAmount: "" } : {})
      }));
    }, [isFormValid, validateForm, kindForTab, form, parseAmount, effectiveFormKind, ledger, onChangeLedger, onEntryAdded, ledgerTab, dailyBudgetConfig, fxRate]);

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      submitForm();
    };

    const startCopy = useCallback((entry: LedgerEntry) => {
      try {
        // 재테크(투자손실/투자수익/배당/이자)는 재테크 탭에서 자동 매핑(savingsInvestStored)으로 저장된다.
        // 이걸 expense/income 탭으로 실으면 폼이 dead-end(중분류 후보 없음)가 되거나 일반 지출로 오분류된다.
        const savingsSubs = SAVINGS_INVEST_SUBS as readonly string[];
        const isSavingsInvestCopy =
          (entry.category === "재테크" && entry.subCategory === "투자손실") ||
          (entry.kind === "income" && !!entry.subCategory && savingsSubs.includes(entry.subCategory));
        // 현행 지출 스키마: category="지출", subCategory=중분류, detailCategory=소분류.
        // 레거시 지출: category=대분류 직접, subCategory=소분류 (→ 폼엔 mainCategory=category/subCategory=subCategory).
        const isCurrentExpenseSchema = entry.category === "지출";

        const nextTab: LedgerTab = isSavingsInvestCopy
          ? "savingsExpense"
          : entry.kind === "income"
            ? "income"
            : entry.kind === "transfer"
              ? "transfer"
              : "expense";

        // 폼 데이터 준비 — 저장 스키마 → 폼 스키마 매핑
        const newForm = {
          id: undefined as string | undefined,
          date: entry.date,
          kind: entry.kind,
          isFixedExpense: entry.isFixedExpense ?? false,
          mainCategory: isSavingsInvestCopy
            ? "재테크"
            : entry.kind === "income"
              ? ""
              : entry.kind === "transfer"
                ? "이체"
                : isCurrentExpenseSchema
                  ? (entry.subCategory || "")
                  : (entry.category || ""), // 레거시: 대분류가 category에
          subCategory: isSavingsInvestCopy
            ? (entry.subCategory || SAVINGS_INVEST_DEFAULT)
            : entry.kind === "income"
              ? (entry.subCategory || entry.category || "")
              : entry.kind === "transfer"
                ? (entry.subCategory || "")
                : isCurrentExpenseSchema
                  ? (entry.detailCategory || "")
                  : (entry.subCategory || ""), // 레거시: 소분류가 subCategory에
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
    }, [setLedgerTab]);

    // 외부에서 복사 요청이 들어온 경우 처리
    useEffect(() => {
      if (copyRequest) {
        startCopy(copyRequest);
        onCopyComplete?.();
      }
    }, [copyRequest, onCopyComplete, startCopy]);

    // 부모(LedgerPage)에서 쓰는 폼 외부 접점 — ref API
    useImperativeHandle(ref, () => ({
      patchForm: (partial) => setForm((prev) => ({ ...prev, ...partial })),
      startCopy
    }), [startCopy]);

    // ── 자주 쓰는 거래 템플릿 ──────────────────────────────
    // 템플릿 적용 — startCopy 호출 금지(저장 스키마 경로). isCopyingRef + setTimeout 가드 패턴 재사용.
    // 반환값: 적용 성공 여부 — 관리 모달이 이 값으로 onClose 여부를 결정한다(취소 시 모달 유지).
    const applyTemplate = useCallback((t: LedgerTemplate): boolean => {
      const f = latestFormRef.current;
      // 수정 중이거나(폼 id 존재), 신규 입력 드래프트(금액·설명)가 있으면 확인 — 드래프트는
      // 히스토리 밖이라 경고 없이 덮어쓰면 Ctrl+Z로도 복구할 수 없다.
      const hasEditingOrDraft = Boolean(f.id) || !!(f.amount?.trim() || f.description?.trim());
      if (hasEditingOrDraft) {
        const what = f.id ? "수정 중인 항목" : "입력 중인 내용";
        if (!confirm(`${what}이 있습니다. 템플릿 "${t.name}"을(를) 적용하면 사라집니다. 계속할까요?`)) return false;
      }
      const { form: nextForm, clearedAccountIds } = ledgerTemplateToForm(t, accounts);
      // 재테크(투자손실/투자수익/배당/이자) 템플릿은 재테크 탭으로 — expense 탭으로 적재하면
      // submitForm이 {category:"지출", subCategory:"재테크"}로 오분류 저장한다(재테크 순집계 누락).
      const savingsSubs = SAVINGS_INVEST_SUBS as readonly string[];
      const isSavingsTemplate =
        (t.mainCategory === "재테크" && t.subCategory === "투자손실") ||
        (t.kind === "income" && !!t.subCategory && savingsSubs.includes(t.subCategory));
      const nextTab: LedgerTab = isSavingsTemplate ? "savingsExpense" : t.kind;
      isCopyingRef.current = true;
      setFormKindWhenAll(t.kind); // "전체" 복귀 시 kind 유지 — 종류 토글 버튼과 동일 규칙
      if (nextTab !== ledgerTab) {
        // kind가 바뀌면 하위 필터 초기화 — 종류 토글 버튼과 동일 규칙 (빈 목록 방지)
        clearListFilters();
      }
      setLedgerTab(nextTab);
      setTimeout(() => {
        setForm(nextForm);
        setTimeout(() => { isCopyingRef.current = false; }, 200);
      }, 10);
      for (const accountId of clearedAccountIds) {
        toast(`계좌 "${accountId}"가 없어 해당 항목을 비웠습니다.`);
      }
      toast.success(`템플릿 "${t.name}" 적용됨`);
      return true;
    }, [accounts, ledgerTab, setLedgerTab, clearListFilters]);

    // 현재 입력을 템플릿으로 저장 — form은 latestFormRef로 읽음 (deps에 form 금지: 칩 memo 계약)
    const saveCurrentAsTemplate = useCallback(() => {
      if (!onChangeTemplates) return;
      const f = latestFormRef.current;
      const list = ledgerTemplates ?? EMPTY_TEMPLATES;
      if (list.length >= 20) { toast.error("템플릿은 최대 20개까지 저장할 수 있습니다."); return; }
      // 이체 탭은 mainCategory가 "이체"로 자동 설정되므로 검사에서 제외 (쓰레기 템플릿 방지)
      const meaningful = effectiveFormKind === "transfer"
        ? (f.subCategory || f.fromAccountId || f.toAccountId || f.description.trim())
        : (f.mainCategory || f.subCategory || f.fromAccountId || f.toAccountId || f.description.trim());
      if (!meaningful) { toast.error("저장할 내용이 없습니다 — 카테고리나 계좌를 먼저 선택하세요."); return; }
      const suggested = f.description.trim() || [f.mainCategory, f.subCategory].filter(Boolean).join("-");
      const name = prompt("템플릿 이름을 입력하세요:", suggested);
      if (!name || !name.trim()) return;
      const t = ledgerFormToTemplate(f, effectiveFormKind, name, newIdWithPrefix("LT"));
      onChangeTemplates([...list, t]);
      toast.success(`템플릿 "${t.name}" 저장됨`);
    }, [ledgerTemplates, onChangeTemplates, effectiveFormKind]);

    // 템플릿 삭제 — confirm + showDeleteUndoToast(restore-by-id) (삭제 계약 #8, 행 삭제와 동일 UX).
    // 기존엔 성공 토스트만 있어 실수 삭제 후 실행취소 버튼이 없었고, Ctrl+Z는 이후 다른 변경까지 되돌렸다.
    const deleteTemplate = useCallback((t: LedgerTemplate) => {
      if (!onChangeTemplates) return;
      if (!confirm(`템플릿 "${t.name}"을(를) 삭제하시겠습니까?`)) return;
      const list = ledgerTemplates ?? EMPTY_TEMPLATES;
      const deletedIndex = list.findIndex((x) => x.id === t.id);
      onChangeTemplates(list.filter((x) => x.id !== t.id));
      showDeleteUndoToast(
        `템플릿 "${t.name}" 삭제됨`,
        buildRestoreById(
          () => useAppStore.getState().data.ledgerTemplates ?? [],
          onChangeTemplates,
          t,
          deletedIndex >= 0 ? deletedIndex : undefined
        )
      );
    }, [ledgerTemplates, onChangeTemplates]);

    const openTemplateManage = useCallback(() => setShowTemplateManage(true), []);
    const closeTemplateManage = useCallback(() => setShowTemplateManage(false), []);

    const resetForm = useCallback(() => {
      setForm({
        ...createDefaultForm(),
        kind: kindForTab,
        isFixedExpense: false
      });
    }, [kindForTab]);

    const isEditing = Boolean(form.id);

    // Ctrl+Enter(submit-form) = 폼 제출 (입력 포커스 중에도 동작 — 핵심 시나리오).
    // Ctrl+S는 앱 전역 백업 전용. Alt+N(새 항목)은 App이 단독 소유하고 아래 focus 이벤트로 위임받는다
    // (과거: 여기서도 new-entry를 register해 App.onAddLedger와 이중 발화).
    useEffect(() => {
      const handler = {
        action: "submit-form" as ShortcutAction,
        handler: () => {
          submitForm();
        },
        enabled: () => {
          const allowDec = effectiveFormKind === "transfer" && form.currency === "USD";
          return Boolean(form.date && parseAmount(form.amount, allowDec) > 0);
        }
      };
      shortcutManager.register(handler);
      return () => shortcutManager.unregister(handler);
    }, [form, effectiveFormKind, parseAmount, submitForm]);

    // Alt+N(App.onAddLedger) → "farmwallet:focus-ledger-form" 이벤트로 위임:
    // 편집 중이 아니면 폼을 초기화한 뒤 금액 칸으로 포커스 (새 항목 입력 준비).
    useEffect(() => {
      const handler = () => {
        if (!isEditing) resetForm();
        // resetForm 직후 리렌더를 기다렸다가 포커스 (편집 중이면 즉시 포커스만)
        setTimeout(() => {
          const el = document.querySelector("[data-ledger-focus=\"amount\"]") as HTMLInputElement | null;
          if (el) {
            el.focus();
            el.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }, isEditing ? 0 : 60);
      };
      window.addEventListener("farmwallet:focus-ledger-form", handler);
      return () => window.removeEventListener("farmwallet:focus-ledger-form", handler);
    }, [isEditing, resetForm]);

    // ── 입력 폼 버튼 = 리스트 필터 (사용자 요청) ──────────────────
    // 폼의 카테고리·계좌 버튼을 누르면 폼 값과 함께 아래 목록도 그 값으로 즉시 필터링한다.
    // 필터 필드는 저장 스키마 매핑과 동일하게 고른다(LedgerPage.filteredLedger와 일치):
    //   지출:     대분류 버튼 → subCategory필터,  소분류 버튼 → detailCategory필터
    //   수입/이체: 중분류 버튼 → subCategory필터
    //   계좌:     출금 → fromAccountId필터,  입금 → toAccountId필터
    // 같은 버튼을 다시 눌러 해제하면 해당 필터도 함께 해제. 종류 탭(income/expense/…)은 ledgerByTab이 담당.
    const pickExpenseMain = (c: string) => {
      const off = form.mainCategory === c;
      setForm((prev) => ({ ...prev, mainCategory: off ? "" : c, subCategory: "" }));
      // 지출 대분류만 필터로 매핑(저장 subCategory). 이체의 고정 "이체" 버튼은 필터 의미 없음.
      if (effectiveFormKind === "expense") {
        setFilterSubCategory(off ? undefined : c);
        setFilterDetailCategory(undefined); // 대분류가 바뀌면 하위 소분류 필터는 무효
      }
    };
    // 지출 소분류 / 이체 중분류 공용 — 저장 위치가 kind에 따라 detailCategory/subCategory로 갈림
    // (submitForm의 저장 매핑과 동일하게 effectiveFormKind 기준 — "전체" 탭에서 입력 kind가 이체인 경우 포함)
    const pickSecondLevel = (c: string) => {
      const off = form.subCategory === c;
      setForm((prev) => ({ ...prev, subCategory: off ? "" : c }));
      if (effectiveFormKind === "transfer") setFilterSubCategory(off ? undefined : c);
      else setFilterDetailCategory(off ? undefined : c);
    };
    const pickIncomeSub = (c: string) => {
      const off = form.subCategory === c;
      setForm((prev) => ({ ...prev, subCategory: off ? "" : c }));
      setFilterSubCategory(off ? undefined : c);
    };
    const pickSavingsSub = (c: string) => {
      setForm((prev) => ({ ...prev, mainCategory: "재테크", subCategory: c, kind: savingsKindForSub(c) }));
      setFilterSubCategory(c); // 저장 subCategory와 동일(투자수익/투자손실/배당/이자)
    };
    const pickFromAccount = (id: string) => {
      const off = form.fromAccountId === id;
      setForm((prev) => ({ ...prev, fromAccountId: off ? "" : id }));
      setFilterFromAccountId(off ? undefined : id);
      // 계좌(통합) 필터와 상호 배타 — 동시에 걸면 AND로 좁혀져 빈 목록이 된다(LedgerFilterBar 규칙과 통일)
      if (!off) setFilterAccountId(null);
    };
    const pickToAccount = (id: string) => {
      const off = form.toAccountId === id;
      setForm((prev) => ({ ...prev, toAccountId: off ? "" : id }));
      setFilterToAccountId(off ? undefined : id);
      if (!off) setFilterAccountId(null);
    };

    return (
      <>
      {/* 입력 폼 */}
      <form className="card" onSubmit={handleSubmit} style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* 대분류 토글 (전체/수입/지출/이체) — "전체"는 목록 필터만 풀고 입력 kind는 유지 */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                tabIndex={-1}
                className={ledgerTab === "all" ? "primary" : "secondary"}
                onClick={() => {
                  // 전체: 목록 필터만 풀기 — 입력용 kind는 그대로 (formKindWhenAll 유지)
                  setLedgerTab("all");
                  clearListFilters();
                }}
                style={{ fontSize: 13, padding: "6px 12px" }}
              >
                전체
              </button>
              {(["income", "expense", "transfer"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  tabIndex={-1}
                  className={ledgerTab === k && effectiveFormKind === k ? "primary" : "secondary"}
                  onClick={() => {
                    // 입력 kind 선택 = 아래 목록도 해당 탭으로 필터
                    setFormKindWhenAll(k);
                    setLedgerTab(k);
                    // kind가 바뀌면 하위 필터 초기화 (kind별 카테고리·계좌 의미가 다르므로)
                    clearListFilters();
                  }}
                  style={{ fontSize: 13, padding: "6px 12px" }}
                >
                  {tabLabel[k]}
                </button>
              ))}
              {/* 재테크 — 보기 전용 탭. 입력은 각 본래 위치(배당/이자/주식/이체)에서. 여기선 흩어진 항목을 모아 보여줌. */}
              <button
                type="button"
                tabIndex={-1}
                className={ledgerTab === "savingsExpense" ? "primary" : "secondary"}
                onClick={() => {
                  setLedgerTab("savingsExpense");
                  clearListFilters();
                }}
                style={{ fontSize: 13, padding: "6px 12px" }}
                title="재테크 — 배당/이자/매매/저축·투자 이체를 한 화면에 모음 (입력은 본래 위치에서)"
              >
                📊 재테크
              </button>
              {/* 신용결제 — 별도 탭. 이체로 저장 (kind=transfer, 이체 > 카드결제이체) */}
              <button
                type="button"
                tabIndex={-1}
                className={ledgerTab === "creditPayment" ? "primary" : "secondary"}
                onClick={() => {
                  setLedgerTab("creditPayment");
                  clearListFilters();
                }}
                style={{ fontSize: 13, padding: "6px 12px" }}
                title="신용카드 결제 (은행 → 카드)"
              >
                💳 신용결제
              </button>
            </div>
            {ledgerTab === "savingsExpense" && (
              <div
                className="hint"
                style={{
                  padding: "10px 14px",
                  lineHeight: 1.6,
                  fontSize: 12,
                  background: "var(--surface)",
                  borderRadius: 8,
                  marginTop: 4,
                  marginBottom: 8
                }}
              >
                <strong>📊 재테크 입력</strong> — 투자수익·투자손실·배당·이자를 직접 기록합니다.
                매수·매도는 <strong>주식</strong> 탭, 저축·투자 이체는 <strong>이체</strong> 탭에서.
                아래 표에 재테크 항목이 모여 보입니다.
              </div>
            )}
            <div style={{ display: "block" }}>
            {/* 자주 쓰는 거래 템플릿 칩 — onChangeTemplates 없으면 미렌더 */}
            {onChangeTemplates && (
              <LedgerTemplateChips
                templates={ledgerTemplates ?? EMPTY_TEMPLATES}
                onApply={applyTemplate}
                onSaveCurrent={saveCurrentAsTemplate}
                onOpenManage={openTemplateManage}
              />
            )}
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
                  {(effectiveFormKind === "income" || effectiveFormKind === "expense") && (
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
                  onChange={handleAmountChange}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submitForm();
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
                {(effectiveFormKind === "income" || effectiveFormKind === "expense") &&
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
            {ledgerTab === "savingsExpense" ? (
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 12, marginBottom: 8, display: "block", fontWeight: 600 }}>대분류: 재테크 (자동) · 중분류 선택 *</span>
                <span style={{ fontSize: 11, color: "var(--danger)", display: "block", marginBottom: 4, visibility: formErrors.subCategory ? "visible" : "hidden" }}>
                  {formErrors.subCategory || " "}
                </span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
                  {SAVINGS_INVEST_SUBS.map((c) => {
                    const active = form.subCategory === c;
                    // 색 의미: 수익/배당/이자(수입) = 빨강 계열, 손실(지출) = 파랑 계열
                    const accent = c === "투자손실" ? "var(--accent)" : "var(--danger)";
                    return (
                      <button
                        key={c}
                        type="button"
                        tabIndex={-1}
                        onClick={() => pickSavingsSub(c)}
                        style={{
                          padding: "12px 8px",
                          fontSize: 14,
                          fontWeight: active ? 700 : 500,
                          border: active ? `2px solid ${accent}` : "1px solid var(--border)",
                          borderRadius: 8,
                          background: active ? "var(--surface-hover)" : "var(--surface)",
                          color: active ? accent : "var(--text)",
                          cursor: "pointer",
                          textAlign: "center"
                        }}
                      >
                        {c}
                        <span style={{ display: "block", fontSize: 10, color: "var(--text-muted)", marginTop: 2, fontWeight: 400 }}>
                          {c === "투자손실" ? "지출" : "수입"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : form.kind === "income" ? (
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
                        onClick={() => pickIncomeSub(c)}
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
            ) : ledgerTab === "creditPayment" ? (
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 12, marginBottom: 8, display: "block", fontWeight: 600 }}>💳 신용결제 (자동)</span>
                <div style={{
                  padding: "10px 12px",
                  background: "var(--primary-light)",
                  border: "2px solid var(--primary)",
                  borderRadius: 8,
                  fontSize: 13,
                  color: "var(--text-muted)",
                }}>
                  자동으로 "이체 &gt; 카드결제이체"로 저장됩니다. 출금계좌(은행) → 입금계좌(카드)만 선택하세요.
                </div>
              </div>
            ) : (
              <>
                {/* 이체 탭일 때는 대분류를 숨기고 "이체"로 고정 */}
                {ledgerTab === "transfer" ? (
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ fontSize: 12, marginBottom: 8, display: "block", fontWeight: 600 }}>대분류: 이체 (자동)</span>
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
                    <span style={{ fontSize: 12, marginBottom: 8, display: "block" }}>중분류 * <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>(대분류: 지출)</span></span>
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
                        onClick={() => pickExpenseMain(c)}
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

                {/* 3. 소분류 - 중분류 선택 시에만 표시 (이체 탭일 때는 항상 표시) */}
                {(form.mainCategory || ledgerTab === "transfer") ? (
                  <label>
                    <span style={{ fontSize: 12, marginBottom: 8, display: "block" }}>
                      {ledgerTab === "transfer" ? "중분류 *" : "소분류 *"} <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>({ledgerTab === "transfer" ? "이체" : form.mainCategory}의 {ledgerTab === "transfer" ? "중분류" : "소분류"})</span>
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
                            onClick={() => pickSecondLevel(c)}
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
                    중분류를 먼저 선택하세요
                  </div>
                )}
              </>
            )}

            {/* 4. 상세내역 (선택) - 작게 */}
            <label style={{ margin: 0 }}>
              <span style={{ fontSize: 10, marginBottom: 4, display: "flex", alignItems: "center", justifyContent: "space-between", color: "var(--text-muted)" }}>
                <span>상세내역 (선택)</span>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); setShowReceiptScanner(true); }}
                  style={{ fontSize: 10, padding: "2px 8px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", cursor: "pointer" }}
                  title="영수증 사진을 OCR로 자동 인식"
                >
                  📷 영수증 스캔
                </button>
              </span>
              {/* 설명 자동완성 — 과거 설명(빈도×최근성) 후보. 선택 시 비어 있는 분류/계좌만 채움 */}
              <Autocomplete
                value={form.description}
                onChange={(val) => setForm((prev) => ({ ...prev, description: val }))}
                onSelect={(opt) => {
                  const s = suggestDescriptions(descriptionIndex, opt.value, effectiveFormKind, { limit: 8 })
                    .find((x) => x.description === opt.value);
                  if (s) applyDescriptionSuggestion(s);
                }}
                options={descriptionOptions}
                placeholder="예: 김밥천국, 아파트 관리비 등"
                ariaLabel="상세내역"
              />
              {recommendationChips.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>추천</span>
                  {recommendationChips.map((r) => {
                    const label = effectiveFormKind === "expense"
                      ? [r.subCategory, r.detailCategory].filter(Boolean).join(" > ")
                      : r.subCategory || "";
                    const active = effectiveFormKind === "expense"
                      ? form.mainCategory === r.subCategory && form.subCategory === (r.detailCategory || "")
                      : form.subCategory === r.subCategory;
                    return (
                      <button
                        key={label}
                        type="button"
                        tabIndex={-1}
                        className={active ? "primary" : "secondary"}
                        onClick={() => applyRecommendationChip(r)}
                        title="이 분류 적용 (목록 필터는 바뀌지 않음)"
                        style={{ fontSize: 11, padding: "3px 8px", borderRadius: 10 }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
            </label>

            {/* 확장 영역: 할인 · 출금계좌 · 입금계좌 */}
            {(<>
            {/* 할인 (수입·지출, 선택) — 저장 시 금액−할인이 실제 반영액 */}
            {(effectiveFormKind === "income" || effectiveFormKind === "expense") && (
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

            {/* 5. 출금계좌 (지출/이체/신용결제) */}
            {(form.kind === "transfer" || form.kind === "expense") && (
              <div>
                <div style={{ fontSize: 11, marginBottom: 8, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
                  <span>{ledgerTab === "creditPayment" ? "🏦 결제할 계좌 (출금/은행) *" : "출금계좌 *"}</span>
                  {(formErrors.fromAccountId || formErrors.transfer) && (
                    <span style={{ fontSize: 10, color: "var(--danger)" }}>({(formErrors.fromAccountId || formErrors.transfer)})</span>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                  {accounts
                    // 숨김 처리된 계좌는 입력 폼에서 제외. 단, 이미 선택된 계좌면 보이도록 유지
                    .filter((a) => !a.archived || form.fromAccountId === a.id)
                    .filter((a) => ledgerTab !== "creditPayment" || a.type !== "card")
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
                          tabIndex={-1}
                          onClick={() => pickFromAccount(a.id)}
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

            {/* 입금계좌 (수입/이체) */}
            {(form.kind === "income" || form.kind === "transfer" || ledgerTab === "creditPayment") && (
              <div>
                <div style={{ fontSize: 11, marginBottom: 8, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
                  <span>{ledgerTab === "creditPayment" ? "💳 갚을 카드 (입금계좌) *" : "입금계좌 *"}</span>
                  {(formErrors.toAccountId || formErrors.transfer) && (
                    <span style={{ fontSize: 10, color: "var(--danger)" }}>({(formErrors.toAccountId || formErrors.transfer)})</span>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                  {accounts
                    .filter((a) => !a.archived || form.toAccountId === a.id)
                    .filter((a) => ledgerTab !== "creditPayment" || a.type === "card")
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
                        tabIndex={-1}
                        onClick={() => pickToAccount(a.id)}
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
            </div>
          </div>
            </div>
        </form>
      <ReceiptScanner
        open={showReceiptScanner}
        onClose={() => setShowReceiptScanner(false)}
        onParsed={(result: OcrResult) => {
          setForm((prev) => ({
            ...prev,
            description: result.merchant ?? prev.description,
            amount: result.amount != null ? String(result.amount) : prev.amount,
            date: result.date ?? prev.date
          }));
          toast.success("영수증 인식 완료 — 폼에 채워졌습니다.");
        }}
      />
      {onChangeTemplates && showTemplateManage && (
        <LedgerTemplateManageModal
          templates={ledgerTemplates ?? EMPTY_TEMPLATES}
          onClose={closeTemplateManage}
          onApply={applyTemplate}
          onDelete={deleteTemplate}
        />
      )}
      </>
    );
  }
));
