import React, { useId } from "react";
import type { Account, AccountType } from "../../../types";
import { Field } from "./Field";

interface Props {
  label: React.ReactNode;
  value: string;
  onChange: (accountId: string) => void;
  accounts: Account[];
  /** 이 유형만 후보로 (예: 증권 거래 → securities·crypto) */
  types?: AccountType[];
  required?: boolean;
  error?: string;
  hint?: React.ReactNode;
  disabled?: boolean;
  reserveErrorSpace?: boolean;
  placeholder?: string;
  /** 통화를 함께 보여줄지 (달러 계좌 구분용) */
  showCurrency?: boolean;
  /** 목록에 표시할 값. 주식 화면은 계좌 id를 이름처럼 쓴다 */
  labelBy?: "name" | "id";
}

/**
 * 계좌 선택 — 후보 필터·표시 규칙을 한 곳에.
 *
 * 폼마다 accounts.filter(...)를 손으로 짜다 보니 어떤 화면은 달러 계좌를 빼먹고
 * 어떤 화면은 카드까지 보여 주는 식으로 목록이 달랐다.
 */
export const AccountSelect: React.FC<Props> = ({
  label,
  value,
  onChange,
  accounts,
  types,
  required,
  error,
  hint,
  disabled,
  reserveErrorSpace,
  placeholder = "선택",
  showCurrency,
  labelBy = "name"
}) => {
  const options = types ? accounts.filter((a) => types.includes(a.type)) : accounts;
  const id = useId();

  return (
    <Field
      label={label}
      htmlFor={id}
      required={required}
      error={error}
      hint={hint}
      reserveErrorSpace={reserveErrorSpace}
    >
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={!!error}
      >
        <option value="">{placeholder}</option>
        {options.map((a) => (
          <option key={a.id} value={a.id}>
            {labelBy === "id" ? a.id : a.name}
            {showCurrency && a.currency === "USD" ? " ($)" : ""}
          </option>
        ))}
      </select>
    </Field>
  );
};
