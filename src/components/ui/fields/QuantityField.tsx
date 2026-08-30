import React, { useId } from "react";
import { Field } from "./Field";
import { NumericInput } from "./NumericInput";

interface Props {
  label: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  /**
   * 허용 소수 자릿수.
   * 국내주식 0(정수), 미국주식·ETF 6(소수점 매수), 암호화폐 8.
   */
  maxDecimals?: number;
  required?: boolean;
  error?: string;
  hint?: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
  reserveErrorSpace?: boolean;
  unit?: string;
}

/**
 * 수량 입력 — 금액과 규칙이 다르다(통화 없음, 소수 자릿수가 종목 종류로 결정됨).
 * BTC 0.00382828처럼 8자리가 필요한 값이 잘리지 않게 maxDecimals를 호출부가 정한다.
 */
export const QuantityField: React.FC<Props> = ({
  label,
  value,
  onChange,
  maxDecimals = 0,
  required,
  error,
  hint,
  placeholder,
  disabled,
  reserveErrorSpace,
  unit
}) => {
  const decimal = maxDecimals > 0;
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
      <span className="input-affix">
        <NumericInput
          id={id}
          allowDecimal={decimal}
          maxDecimals={maxDecimals}
          value={value}
          onChange={onChange}
          placeholder={placeholder ?? "0"}
          disabled={disabled}
          aria-invalid={!!error}
        />
        {unit && (
          <span className="input-suffix" aria-hidden>
            {unit}
          </span>
        )}
      </span>
    </Field>
  );
};
