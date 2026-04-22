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
}

/**
 * 가계부 입력 폼 검증. 순수 함수 — 에러 Record 반환.
 * - 날짜: 미래 날짜 금지 (KST 기준 오늘까지)
 * - 금액: > 0 (USD 이체는 소수점 허용)
 * - 계좌: kind별 from/to 필수
 * - 이체: from ≠ to
 * - 할인: 0 이상, 수입은 금액 초과 금지·순액 > 0
 * - 카테고리: kind별 필수 항목
 */
export function validateLedgerForm({
  form,
  kindForTab,
  effectiveFormKind,
  accounts,
  parseAmount,
}: ValidateLedgerFormArgs): Record<string, string> {
  const errors: Record<string, string> = {};

  const todayStr = getTodayKST();
  const todayDate = new Date(todayStr + "T00:00:00+09:00");

  const dateValidation = validateDate(form.date, todayDate);
  if (!dateValidation.valid) errors.date = dateValidation.error || "";

  const allowDecimal = kindForTab === "transfer" && form.currency === "USD";
  const parsedAmount = parseAmount(form.amount, allowDecimal);
  if (parsedAmount <= 0) {
    errors.amount = !form.amount || form.amount.trim() === ""
      ? "금액을 입력해주세요"
      : "금액은 0보다 커야 합니다";
  }

  const requireFromAccount = kindForTab === "transfer" || kindForTab === "expense";
  const requireToAccount = kindForTab === "income" || kindForTab === "transfer";

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
  }

  if (kindForTab === "income") {
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
