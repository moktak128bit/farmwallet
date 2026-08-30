import React, { useId } from "react";
import { Field } from "./Field";
import { NumericInput } from "./NumericInput";

export type FieldCurrency = "KRW" | "USD";

interface Props {
  label: React.ReactNode;
  /** 표시용 문자열 (콤마 포함). 저장 시엔 parseAmount로 숫자화 */
  value: string;
  onChange: (value: string) => void;
  currency?: FieldCurrency;
  /**
   * 소수점 허용. 기본값은 통화로 결정 — USD는 허용, KRW는 정수.
   * 원화라도 증권 수수료처럼 소수가 나오는 항목은 명시적으로 true.
   */
  allowDecimal?: boolean;
  /** 허용 소수 자릿수 (기본 2) */
  maxDecimals?: number;
  /** 음수 허용 — 부채·현금 조정처럼 마이너스가 정상인 금액에만 */
  allowNegative?: boolean;
  required?: boolean;
  error?: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
  /** 가계부 금액처럼 폼의 주인공인 입력은 lg */
  size?: "md" | "lg";
  reserveErrorSpace?: boolean;
  onEnter?: () => void;
  /** 포커스 이동용 데이터 속성 (가계부 단축키가 사용) */
  focusKey?: string;
  autoFocus?: boolean;
}

const CURRENCY_SUFFIX: Record<FieldCurrency, string> = { KRW: "원", USD: "$" };

/**
 * 금액 입력 한 칸.
 *
 * type="number"를 쓰지 않는다 — 브라우저 step 검증이 "212.25는 유효하지 않다"며 저장을 막고,
 * 스크롤 휠로 금액이 바뀌며, 천 단위 콤마를 못 쓴다. 대신 text + inputMode로 숫자 키패드를 띄우고
 * formatAmount로 콤마·소수 자릿수를 통제한다.
 */
export const MoneyField: React.FC<Props> = ({
  label,
  value,
  onChange,
  currency = "KRW",
  allowDecimal,
  maxDecimals = 2,
  allowNegative,
  required,
  error,
  hint,
  action,
  placeholder,
  disabled,
  size = "md",
  reserveErrorSpace,
  onEnter,
  focusKey,
  autoFocus
}) => {
  const decimal = allowDecimal ?? currency === "USD";
  const id = useId();

  return (
    <Field
      label={label}
      htmlFor={id}
      required={required}
      error={error}
      hint={hint}
      action={action}
      reserveErrorSpace={reserveErrorSpace}
    >
      <span className="input-affix">
        <NumericInput
          id={id}
          allowDecimal={decimal}
          maxDecimals={maxDecimals}
          allowNegative={allowNegative}
          className={size === "lg" ? "lg" : undefined}
          value={value}
          onChange={onChange}
          onKeyDown={
            onEnter
              ? (e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onEnter();
                  }
                }
              : undefined
          }
          placeholder={placeholder ?? (decimal ? "0.00" : "0")}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-invalid={!!error}
          data-ledger-focus={focusKey}
        />
        <span className="input-suffix" aria-hidden>
          {CURRENCY_SUFFIX[currency]}
        </span>
      </span>
    </Field>
  );
};
