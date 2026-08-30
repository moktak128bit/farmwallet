import React, { useId } from "react";
import { Field } from "./Field";

interface Props {
  label?: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  error?: string;
  hint?: React.ReactNode;
  disabled?: boolean;
  reserveErrorSpace?: boolean;
  /** "오늘" 버튼 표시 (기본 true) */
  showToday?: boolean;
  min?: string;
  max?: string;
}

/** KST 기준 오늘 (UTC 변환으로 하루 밀리는 것 방지) */
const todayKST = (): string => {
  const now = new Date();
  const kst = new Date(now.getTime() + (now.getTimezoneOffset() + 540) * 60_000);
  return kst.toISOString().slice(0, 10);
};

/** 날짜 입력 — 어디서나 같은 모양 + "오늘" 한 번에 채우기 */
export const DateField: React.FC<Props> = ({
  label = "날짜",
  value,
  onChange,
  required,
  error,
  hint,
  disabled,
  reserveErrorSpace,
  showToday = true,
  min,
  max
}) => {
  const id = useId();
  return (
  <Field
    label={label}
    htmlFor={id}
    required={required}
    error={error}
    hint={hint}
    reserveErrorSpace={reserveErrorSpace}
    action={
      showToday && !disabled ? (
        <button
          type="button"
          className="field-action-btn"
          tabIndex={-1}
          onClick={(e) => {
            e.preventDefault();
            onChange(todayKST());
          }}
        >
          오늘
        </button>
      ) : undefined
    }
  >
    <input
      id={id}
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      min={min}
      max={max}
      aria-invalid={!!error}
    />
  </Field>
  );
};
