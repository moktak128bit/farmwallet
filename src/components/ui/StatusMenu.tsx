import React, { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useModalStackEntry } from "../../utils/modalStack";

export type StatusTone = "ok" | "warn" | "danger";

interface Props {
  /** 점 색으로 표현할 전체 상태 */
  tone: StatusTone;
  /** 버튼에 한 줄로 요약 (예: "저장됨", "백업 필요") */
  summary: string;
  /** 팝오버 안에 들어갈 내용 — 동기화 버튼·경고·로그 등 */
  children: React.ReactNode;
}

/**
 * 헤더의 "기계 상태"(자동저장·백업·Gist·git·로그·무결성)를 점 하나로 접는다.
 *
 * 기존 헤더는 이 정보를 항상 펼쳐 두어서 사용자의 돈보다 앱 상태가 더 눈에 띄었다.
 * 평소엔 점+요약만, 필요할 때만 펼쳐 본다.
 */
export const StatusMenu: React.FC<Props> = ({ tone, summary, children }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const trapRef = useFocusTrap<HTMLDivElement>(open);
  const isTopModal = useModalStackEntry(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // 모달 중첩 시 최상위 모달만 ESC로 닫힘
      if (e.key === "Escape" && isTopModal()) setOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [open, isTopModal]);

  return (
    <div className="status-menu" ref={rootRef}>
      <button
        type="button"
        className={`status-trigger tone-${tone} ${open ? "open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="저장·백업·동기화 상태"
      >
        <span className="status-dot" aria-hidden />
        <span className="status-summary">{summary}</span>
      </button>
      {open && (
        <div ref={trapRef} className="status-popover" role="dialog" aria-modal="true" aria-label="앱 상태">
          {children}
        </div>
      )}
    </div>
  );
};
