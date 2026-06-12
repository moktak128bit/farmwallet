import type { Account, LedgerKind } from "../../types";
import {
  validateDate,
  validateRequired,
  validateAccountExists,
  validateTransfer,
} from "../../utils/validation";
import { getTodayKST } from "../../utils/date";

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

export interface ValidateLedgerFormArgs {
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
 * - 금액: > 0 (USD 이체는 소수점 허용)
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

  const todayStr = getTodayKST();
  const todayDate = new Date(todayStr + "T00:00:00+09:00");

  const dateValidation = validateDate(form.date, todayDate);
  if (!dateValidation.valid) errors.date = dateValidation.error || "";

  const allowDecimal = kindForTab === "transfer" && form.currency === "USD";
  const parsedAmount = parseAmount(form.amount, allowDecimal);
  const trimmedAmount = (form.amount ?? "").trim();
  // 숫자·콤마·(허용 시) 점 외의 문자가 섞이면 명시적 에러 (공백만/이모지/한글 거부)
  const amountPattern = allowDecimal ? /^[\d.,]+$/ : /^[\d,]+$/;
  if (!trimmedAmount) {
    errors.amount = "금액을 입력해주세요";
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
