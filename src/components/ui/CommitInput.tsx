import React, { useEffect, useRef, useState } from "react";

/**
 * 키 입력마다 상위 상태(undo 히스토리)를 쓰지 않고,
 * blur(또는 Enter) 시점에 1회만 onCommit을 호출하는 텍스트 입력.
 * 운동 dayLabel·루틴 이름·세트 메모 등에서 키스트로크 단위 undo 오염 방지용.
 */
interface CommitInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: string;
  onCommit: (value: string) => void;
  /** Enter 키로도 커밋(blur) 처리할지 (기본 true) */
  commitOnEnter?: boolean;
}

export const CommitInput: React.FC<CommitInputProps> = ({
  value,
  onCommit,
  commitOnEnter = true,
  ...rest
}) => {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);

  // 외부 값 변경(undo/redo·동기화 등)은 입력 중이 아닐 때만 반영
  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  return (
    <input
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => {
        focusedRef.current = true;
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        focusedRef.current = false;
        if (draft !== value) onCommit(draft);
        rest.onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (commitOnEnter && e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
        rest.onKeyDown?.(e);
      }}
    />
  );
};

/** CommitInput의 textarea 버전 (Enter는 줄바꿈으로 유지, blur 시에만 커밋) */
interface CommitTextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> {
  value: string;
  onCommit: (value: string) => void;
}

export const CommitTextarea: React.FC<CommitTextareaProps> = ({ value, onCommit, ...rest }) => {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  return (
    <textarea
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => {
        focusedRef.current = true;
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        focusedRef.current = false;
        if (draft !== value) onCommit(draft);
        rest.onBlur?.(e);
      }}
    />
  );
};
