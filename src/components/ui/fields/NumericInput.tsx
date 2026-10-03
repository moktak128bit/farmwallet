import React, { useCallback, useLayoutEffect, useRef, useState, forwardRef } from "react";
import { formatAmount } from "../../../utils/parseAmount";
import { caretAfterDigits, countDigitsBefore } from "../../../utils/caret";

/**
 * 입력 중인 draft가 부모 value와 같은 수인지 — "22."↔22, "2.50"↔2.5, "1,000"↔1000, "-"·""↔0.
 * 부모 value가 빈 값(폼 리셋 등)이면 빈 draft만 같다고 본다.
 */
function sameNumber(value: string, draft: string): boolean {
  if (value === draft) return true;
  if (value.trim() === "") return false;
  const num = (s: string) => Number(s.replace(/,/g, "").trim().replace(/^-?\.?$/, "0"));
  return num(value) === num(draft);
}

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
  { value, onChange, allowDecimal = false, maxDecimals = 2, allowNegative = false, className, onBlur, ...rest },
  ref
) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  /** 다음 렌더에서 복원할 커서 위치 (숫자 개수 기준) */
  const pendingDigits = useRef<number | null>(null);
  // 화면에 보이는 글자는 로컬 draft — 부모가 number로 저장했다 String(n)으로 돌려주면 "22."가 "22"로
  // 깎여 소수점을 칠 수 없었다(22.5 → 225kg 저장). 부모 값이 '다른 수'로 바뀔 때만 draft를 교체한다.
  const [draft, setDraft] = useState(value);
  const [seenValue, setSeenValue] = useState(value);
  if (value !== seenValue) {
    setSeenValue(value);
    if (!sameNumber(value, draft)) setDraft(value);
  }

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
      const next = formatAmount(el.value, { allowDecimal, maxDecimals, allowNegative });
      setDraft(next);
      onChange(next);
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
  }, [draft]);

  return (
    <input
      {...rest}
      ref={setRefs}
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      className={className ? `money-input ${className}` : "money-input"}
      value={draft}
      onChange={handleChange}
      onBlur={(e) => {
        onBlur?.(e);
        // 부모가 거부한 입력(예: 반복 1 미만)이 화면에만 남지 않게 — 떠날 때 저장된 값으로 맞춘다
        if (!sameNumber(value, draft)) setDraft(value);
      }}
    />
  );
});
