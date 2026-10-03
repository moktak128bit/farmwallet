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

/** CommitInput·CommitTextarea 공용 draft 로직 */
function useCommitDraft(value: string, onCommit: (value: string) => void) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);
  // 포커스 시점의 값 — blur 때 draft를 '지금 value'가 아니라 이것과 비교해야, 포커스 중 들어온
  // 외부 변경(Gist pull·다른 탭)을 손대지 않은 옛 draft로 덮어 조용히 되돌리지 않는다
  const focusValueRef = useRef(value);

  // 외부 값 변경(undo/redo·동기화 등)은 입력 중이 아닐 때만 반영
  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  const onFocus = () => {
    focusedRef.current = true;
    focusValueRef.current = value;
  };
  const onBlur = () => {
    focusedRef.current = false;
    if (draft === value) return;
    if (draft !== focusValueRef.current) onCommit(draft); // 사용자가 고친 경우만 커밋
    else setDraft(value); // 안 고쳤는데 그새 외부 값이 바뀜 → 외부 값 반영
  };
  return { draft, setDraft, onFocus, onBlur };
}

export const CommitInput: React.FC<CommitInputProps> = ({
  value,
  onCommit,
  commitOnEnter = true,
  ...rest
}) => {
  const c = useCommitDraft(value, onCommit);

  return (
    <input
      {...rest}
      value={c.draft}
      onChange={(e) => c.setDraft(e.target.value)}
      onFocus={(e) => {
        c.onFocus();
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        c.onBlur();
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
  const c = useCommitDraft(value, onCommit);

  return (
    <textarea
      {...rest}
      value={c.draft}
      onChange={(e) => c.setDraft(e.target.value)}
      onFocus={(e) => {
        c.onFocus();
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        c.onBlur();
        rest.onBlur?.(e);
      }}
    />
  );
};
