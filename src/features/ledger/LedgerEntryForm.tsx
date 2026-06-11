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
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Autocomplete } from "../../components/ui/Autocomplete";
import type { Account, CategoryPresets, ExpenseDetailGroup, LedgerEntry, LedgerKind, LedgerTemplate } from "../../types";
import { shortcutManager, type ShortcutAction } from "../../utils/shortcuts";
import { validateLedgerForm } from "./validateLedgerForm";
import { parseAmount as sharedParseAmount, formatAmount as sharedFormatAmount } from "../../utils/parseAmount";
import { newIdWithPrefix } from "../../utils/id";
import { DEFAULT_DAILY_BUDGET, todaySpend, weeklySpend, weeklyLimit, getCurrentWeekRange } from "../../utils/dailyBudget";
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

export type LedgerTab = "all" | "income" | "expense" | "savingsExpense" | "transfer" | "creditPayment";

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
  /** 종류 탭 전환 시 하위 카테고리 필터 초기화용 (부모 setState — 참조 안정) */
  setFilterMainCategory: React.Dispatch<React.SetStateAction<string | undefined>>;
  setFilterSubCategory: React.Dispatch<React.SetStateAction<string | undefined>>;
  setFilterDetailCategory: React.Dispatch<React.SetStateAction<string | undefined>>;
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
    copyRequest,
    onCopyComplete,
    onEntryAdded,
    ledgerTemplates,
    onChangeTemplates
  }, ref) {
    // dailyBudget 설정 — store에서 직접 읽음 (props로 안 받음)
    const dailyBudgetConfig = useAppStore((s) => s.data.dailyBudget) ?? DEFAULT_DAILY_BUDGET;
    const [form, setForm] = useState(createDefaultForm);
    const [formKindWhenAll, setFormKindWhenAll] = useState<"income"|"expense"|"transfer">("expense");
    const effectiveFormKind: LedgerKind =
      ledgerTab === "all"
        ? formKindWhenAll
        : ledgerTab === "savingsExpense"
          ? "expense"
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
    // 폼 확장/축소 상태 (progressive disclosure)
    const [formExpanded] = useState<boolean>(() => {
      try { return localStorage.getItem("fw-ledger-form-expanded") === "true"; } catch { return false; }
    });

    // 폼 검증 오류는 validateForm useMemo에서 직접 계산됨

    // 폼 확장 상태 localStorage 동기화
    useEffect(() => {
      try { localStorage.setItem("fw-ledger-form-expanded", String(formExpanded)); } catch {}
    }, [formExpanded]);

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

    // parseAmount/formatAmount는 src/utils/parseAmount.ts로 중앙화됨.
    // 기존 (value, allowDecimal) 시그니처를 유지하기 위한 어댑터.
    const parseAmount = useCallback((value: string, allowDecimal?: boolean): number => {
      return sharedParseAmount(value, { allowDecimal });
    }, []);

    const formatAmount = useCallback((value: string, allowDecimal?: boolean): string => {
      return sharedFormatAmount(value, { allowDecimal });
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
          effectiveFormKind === "transfer" ? "이체" : "",
        subCategory: "",
        fromAccountId: kindForTab === "income" ? "" : prev.fromAccountId,
        toAccountId: kindForTab === "expense" ? "" : prev.toAccountId
      }));
    }, [effectiveFormKind, kindForTab]);

    // 실시간 폼 검증
    const validateForm = useMemo(
      () => validateLedgerForm({ form, kindForTab, effectiveFormKind, accounts, parseAmount, isCreditPayment: ledgerTab === "creditPayment" }),
      [form, effectiveFormKind, parseAmount, accounts, kindForTab, ledgerTab]
    );

    // formErrors를 직접 사용 (useEffect 제거로 성능 개선)
    const formErrors = validateForm;
    const isFormValid = Object.keys(formErrors).length === 0;

    const submitForm = useCallback((keepContext: boolean) => {
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

      const isFixed = false;

      // 하루 예산 사전 경고: kindForTab=expense이고 dailyBudget enabled일 때만
      // 이 거래로 인해 한도 초과 시 confirm 표시 (취소 시 입력 안 됨)
      if (
        dailyBudgetConfig.enabled &&
        dailyBudgetConfig.warnOnExceed &&
        kindForTab === "expense" &&
        ledgerTab !== "creditPayment"
      ) {
        const isExcludedCat = dailyBudgetConfig.excludedCategories.includes("지출");
        const subToCheck = form.mainCategory?.trim() || "";
        const isExcludedSub = subToCheck && dailyBudgetConfig.excludedSubCategories.includes(subToCheck);
        if (!isExcludedCat && !isExcludedSub) {
          const isWeekly = dailyBudgetConfig.mode === "weekly";
          const limit = isWeekly ? weeklyLimit(dailyBudgetConfig) : dailyBudgetConfig.dailyLimit;
          const range = isWeekly ? getCurrentWeekRange(form.date) : null;
          const currentSpent = isWeekly && range
            ? weeklySpend(ledger, range.start, range.end, dailyBudgetConfig)
            : todaySpend(ledger, dailyBudgetConfig);
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
        ...(kindForTab === "transfer" && form.currency === "USD" ? { currency: "USD" as const } : {})
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
    }, [isFormValid, validateForm, kindForTab, form, parseAmount, effectiveFormKind, ledger, onChangeLedger, onEntryAdded, ledgerTab, dailyBudgetConfig]);

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      submitForm(false);
    };

    const startCopy = useCallback((entry: LedgerEntry) => {
      try {
        const nextTab: LedgerTab =
          entry.kind === "income"
            ? "income"
            : entry.kind === "transfer"
              ? "transfer"
              : "expense";

        // 폼 데이터 준비
        const newForm = {
          id: undefined as string | undefined,
          date: entry.date,
          kind: entry.kind,
          isFixedExpense: entry.isFixedExpense ?? false,
          mainCategory: entry.kind === "income" ? "" : (entry.category || ""),
          subCategory: entry.kind === "income" ? (entry.subCategory || entry.category || "") : (entry.subCategory || ""),
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
    const applyTemplate = useCallback((t: LedgerTemplate) => {
      if (latestFormRef.current.id) {
        if (!confirm(`수정 중인 항목이 있습니다. 템플릿 "${t.name}"을(를) 적용하면 수정 내용이 사라집니다. 계속할까요?`)) return;
      }
      const { form: nextForm, clearedAccountIds } = ledgerTemplateToForm(t, accounts);
      const nextTab: LedgerTab = t.kind; // income|expense|transfer ⊂ LedgerTab
      isCopyingRef.current = true;
      setFormKindWhenAll(t.kind); // "전체" 복귀 시 kind 유지 — 종류 토글 버튼과 동일 규칙
      if (nextTab !== ledgerTab) {
        // kind가 바뀌면 하위 카테고리 필터 초기화 — 종류 토글 버튼과 동일 규칙 (빈 목록 방지)
        setFilterMainCategory(undefined);
        setFilterSubCategory(undefined);
        setFilterDetailCategory(undefined);
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
    }, [accounts, ledgerTab, setLedgerTab, setFilterMainCategory, setFilterSubCategory, setFilterDetailCategory]);

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

    // 템플릿 삭제 — confirm + 성공 토스트 (기존 행 삭제 UX와 동일)
    const deleteTemplate = useCallback((t: LedgerTemplate) => {
      if (!onChangeTemplates) return;
      if (!confirm(`템플릿 "${t.name}"을(를) 삭제하시겠습니까?`)) return;
      onChangeTemplates((ledgerTemplates ?? EMPTY_TEMPLATES).filter((x) => x.id !== t.id));
      toast.success(`템플릿 "${t.name}" 삭제됨`);
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
    const dateInputRef = useRef<HTMLInputElement>(null);

    // 키보드 단축키 처리 (close-modal/ESC는 셀 편집 취소용 — 부모 소유)
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
        }
      ];

      handlers.forEach(handler => shortcutManager.register(handler));
      return () => {
        handlers.forEach(handler => shortcutManager.unregister(handler));
      };
    }, [isEditing, form, effectiveFormKind, parseAmount, resetForm, submitForm]);

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
    }, [form, effectiveFormKind, parseAmount, submitForm]);

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
                  setFilterMainCategory(undefined);
                  setFilterSubCategory(undefined);
                  setFilterDetailCategory(undefined);
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
                    // kind가 바뀌면 하위 카테고리 필터 초기화 (kind별 카테고리가 다르므로)
                    setFilterMainCategory(undefined);
                    setFilterSubCategory(undefined);
                    setFilterDetailCategory(undefined);
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
                  setFilterMainCategory(undefined);
                  setFilterSubCategory(undefined);
                  setFilterDetailCategory(undefined);
                }}
                style={{ fontSize: 13, padding: "6px 12px" }}
                title="재테크 보기 — 배당/이자/매매/저축·투자 이체를 한 화면에 모음 (입력은 본래 위치에서)"
              >
                📊 재테크 보기
              </button>
              {/* 신용결제 — 별도 탭. 내부 kind=expense, category=신용결제 고정 */}
              <button
                type="button"
                tabIndex={-1}
                className={ledgerTab === "creditPayment" ? "primary" : "secondary"}
                onClick={() => {
                  setLedgerTab("creditPayment");
                  setFilterMainCategory(undefined);
                  setFilterSubCategory(undefined);
                  setFilterDetailCategory(undefined);
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
                  padding: "20px 16px",
                  textAlign: "center",
                  lineHeight: 1.7,
                  fontSize: 13,
                  background: "var(--surface)",
                  borderRadius: 8,
                  marginTop: 4
                }}
              >
                <strong>📊 재테크 보기 전용 탭</strong>
                <br />
                흩어진 재테크 활동을 모아서 보여줍니다. 입력은 본래 위치에서:
                <br />
                · 배당·이자 → <strong>배당/이자</strong> 탭
                &nbsp;·&nbsp; 매수·매도 → <strong>주식</strong> 탭
                &nbsp;·&nbsp; 저축·투자 이체 → <strong>이체</strong> 탭
                &nbsp;·&nbsp; 투자손실 → 가계부 행 더블클릭으로 직접 편집
              </div>
            )}
            <div style={{ display: ledgerTab === "savingsExpense" ? "none" : "block" }}>
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
                          // 폼 입력 전용 — 리스트 필터에는 영향 주지 않음 (필터는 별도 바에서)
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
                        onClick={() => {
                          // 폼 입력 전용 — 리스트 필터에는 영향 주지 않음 (필터는 별도 바에서)
                          if (form.mainCategory === c) {
                            setForm((prev) => ({ ...prev, mainCategory: "", subCategory: "" }));
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
                            onClick={() => {
                              // 폼 입력 전용 — 리스트 필터에는 영향 주지 않음 (필터는 별도 바에서)
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
