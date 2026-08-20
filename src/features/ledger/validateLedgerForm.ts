import type { Account, LedgerKind } from "../../types";
import {
  validateDate,
  validateRequired,
  validateAccountExists,
  validateTransfer,
} from "../../utils/validation";
import { getTodayKST, parseIsoLocal } from "../../utils/date";
import { evaluateAmountExpression, isAmountExpression } from "../../utils/amountExpression";

export interface LedgerFormSnapshot {
  date: string;
  amount: string;
  currency: "KRW" | "USD";
  fromAccountId: string;
  toAccountId: string;
  mainCategory: string;
  subCategory: string;
  discountAmount?: string;
}

interface ValidateLedgerFormArgs {
  form: LedgerFormSnapshot;
  kindForTab: LedgerKind;
  effectiveFormKind: LedgerKind;
  accounts: Account[];
  parseAmount: (value: string, allowDecimal?: boolean) => number;
  /** 신용결제 탭 여부 (kind=expense인 expense 탭과 검증 규칙이 다름) */
  isCreditPayment?: boolean;
}

/**
 * 가계부 입력 폼 검증. 순수 함수 — 에러 Record 반환.
 * - 날짜: 미래 날짜 금지 (KST 기준 오늘까지)
 * - 금액: > 0 (USD 이체는 소수점 허용). 계산식("12000+3500/2")은 evaluateAmountExpression으로 평가 — 평가 불가면 에러
 * - 계좌: kind별 from/to 필수
 * - 이체: from ≠ to
 * - 할인: 금액(할인 전) 초과 금지 (수입·지출 공통), 수입은 순액 > 0
 * - 카테고리: kind별 필수 항목
 */
export function validateLedgerForm({
  form,
  kindForTab,
  effectiveFormKind,
  accounts,
  parseAmount,
  isCreditPayment = false,
}: ValidateLedgerFormArgs): Record<string, string> {
  const errors: Record<string, string> = {};

  // parseIsoLocal로 만들면 maxDate의 로컬 성분이 KST 날짜와 일치 — validateDate가
  // getFullYear/Month/Date(로컬)로 상한을 재구성하므로, KST 자정 인스턴트를 넘기면
  // 비-KST 머신(UTC·유럽·미주)에서 상한이 하루 당겨져 오늘(KST) 날짜가 거부된다.
  const todayDate = parseIsoLocal(getTodayKST()) ?? undefined;

  const dateValidation = validateDate(form.date, todayDate);
  if (!dateValidation.valid) errors.date = dateValidation.error || "";

  const allowDecimal = kindForTab === "transfer" && form.currency === "USD";
  const trimmedAmount = (form.amount ?? "").trim();
  // 계산식 입력(연산자 포함)은 안전 파서로 평가한 값을 금액으로 본다 — 폼의 parseAmount 어댑터와 동일 규칙
  const amountIsExpression = isAmountExpression(trimmedAmount);
  const evaluated = amountIsExpression ? evaluateAmountExpression(trimmedAmount, { allowDecimal }) : null;
  const parsedAmount = amountIsExpression ? (evaluated ?? 0) : parseAmount(form.amount, allowDecimal);
  // 숫자·콤마·(허용 시) 점 외의 문자가 섞이면 명시적 에러 (공백만/이모지/한글 거부)
  const amountPattern = allowDecimal ? /^[\d.,]+$/ : /^[\d,]+$/;
  if (!trimmedAmount) {
    errors.amount = "금액을 입력해주세요";
  } else if (amountIsExpression) {
    if (evaluated === null) errors.amount = "계산식이 올바르지 않습니다 (예: 12000+3500/2)";
  } else if (!amountPattern.test(trimmedAmount)) {
    errors.amount = allowDecimal
      ? "숫자·소수점·콤마만 입력 가능합니다"
      : "숫자와 콤마만 입력 가능합니다";
  } else if (parsedAmount <= 0) {
    errors.amount = "금액은 0보다 커야 합니다";
  }

  // 신용결제: 출금(은행) → 입금(카드) 둘 다 필수
  const requireFromAccount = kindForTab === "transfer" || kindForTab === "expense";
  const requireToAccount = isCreditPayment || kindForTab === "income" || kindForTab === "transfer";

  if (requireFromAccount) {
    const v = validateRequired(form.fromAccountId, "출금 계좌");
    if (!v.valid) errors.fromAccountId = v.error || "";
    else {
      const ex = validateAccountExists(form.fromAccountId, accounts);
      if (!ex.valid) errors.fromAccountId = ex.error || "";
    }
  }

  if (requireToAccount) {
    const v = validateRequired(form.toAccountId, "입금 계좌");
    if (!v.valid) errors.toAccountId = v.error || "";
    else {
      const ex = validateAccountExists(form.toAccountId, accounts);
      if (!ex.valid) errors.toAccountId = ex.error || "";
    }
  }

  if (kindForTab === "transfer") {
    const t = validateTransfer(form.fromAccountId, form.toAccountId);
    if (!t.valid) errors.transfer = t.error || "";
  }

  const allowLedgerDiscount =
    effectiveFormKind === "income" || effectiveFormKind === "expense";
  if (allowLedgerDiscount && form.discountAmount?.trim()) {
    // parseAmount는 음수를 반환하지 않으므로 discount < 0 분기는 불필요 (dead branch 제거)
    const discount = parseAmount(form.discountAmount, false);
    if (effectiveFormKind === "income") {
      if (discount > parsedAmount) {
        errors.discountAmount = "할인은 금액(할인 전)을 넘을 수 없습니다";
      } else if (parsedAmount - discount <= 0) {
        errors.amount = "할인 후 실제 수입액은 0보다 커야 합니다";
      }
    } else if (effectiveFormKind === "expense") {
      // 지출도 할인이 금액을 넘으면 음수 금액이 저장됨 — 동일하게 거부 (전액 할인=0원은 허용)
      if (discount > parsedAmount) {
        errors.discountAmount = "할인은 금액(할인 전)을 넘을 수 없습니다";
      }
    }
  }

  if (isCreditPayment) {
    // 신용결제는 카테고리 자동 ("신용결제") — 사용자 입력 불필요
  } else if (kindForTab === "income") {
    const v = validateRequired(form.subCategory, "수입 중분류");
    if (!v.valid) errors.subCategory = v.error || "";
  } else {
    const m = validateRequired(form.mainCategory, "대분류");
    if (!m.valid) errors.mainCategory = m.error || "";
    const s = validateRequired(form.subCategory, "중분류");
    if (!s.valid) errors.subCategory = s.error || "";
  }

  return errors;
}
