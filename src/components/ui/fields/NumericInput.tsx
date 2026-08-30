import React, { useCallback, useLayoutEffect, useRef, forwardRef } from "react";
import { formatAmount } from "../../../utils/parseAmount";
import { caretAfterDigits, countDigitsBefore } from "../../../utils/caret";

interface Props
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "value" | "onChange" | "type" | "inputMode"
  > {
  value: string;
  onChange: (value: string) => void;
  allowDecimal?: boolean;
  maxDecimals?: number;
  /** 음수 허용 (부채·조정 금액 등) */
  allowNegative?: boolean;
}

/**
 * 라벨 없는 숫자 입력 — 표 셀 인라인 수정처럼 Field 껍데기가 들어갈 자리가 없는 곳용.
 *
 * MoneyField/QuantityField도 결국 이걸 쓴다. 숫자 입력 규칙(콤마·소수 자릿수·
 * type="number" 금지)이 한 군데에만 있도록 하기 위함.
 *
 * 콤마를 다시 붙일 때 커서를 원래 자리에 되돌린다 — 안 하면 금액 중간을 고칠 때마다
 * 커서가 맨 뒤로 튄다. ref는 그대로 input에 전달된다(포커스·select 제어용).
 */
export const NumericInput = forwardRef<HTMLInputElement, Props>(function NumericInput(
  { value, onChange, allowDecimal = false, maxDecimals = 2, allowNegative = false, className, ...rest },
  ref
) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  /** 다음 렌더에서 복원할 커서 위치 (숫자 개수 기준) */
  const pendingDigits = useRef<number | null>(null);

  const setRefs = useCallback(
    (node: HTMLInputElement | null) => {
      innerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
    },
    [ref]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const el = e.target;
      pendingDigits.current = countDigitsBefore(el.value, el.selectionStart ?? el.value.length);
      onChange(formatAmount(el.value, { allowDecimal, maxDecimals, allowNegative }));
    },
    [onChange, allowDecimal, maxDecimals, allowNegative]
  );

  useLayoutEffect(() => {
    const el = innerRef.current;
    const digits = pendingDigits.current;
    pendingDigits.current = null;
    // 포커스가 있을 때만 — 다른 곳을 보고 있는데 커서를 옮기지 않는다
    if (el == null || digits == null || document.activeElement !== el) return;
    const pos = caretAfterDigits(el.value, digits);
    try {
      el.setSelectionRange(pos, pos);
    } catch {
      /* number/date 등 selection 미지원 타입 방어 — 여기서는 text라 정상 동작 */
    }
  }, [value]);

  return (
    <input
      {...rest}
      ref={setRefs}
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      className={className ? `money-input ${className}` : "money-input"}
      value={value}
      onChange={handleChange}
    />
  );
});
