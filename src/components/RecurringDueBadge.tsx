import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { LedgerEntry, RecurringExpense } from "../types";
import { findOverdueRecurring } from "../utils/recurringAlert";
import { showDeleteUndoToast } from "../utils/undoToast";
import { useAppStore } from "../store/appStore";
import { RecurringDuePopover } from "./RecurringDuePopover";

interface Props {
  recurring: RecurringExpense[];
  ledger: LedgerEntry[];
  /** 예산 탭 이동 — onChangeLedger가 없으면 배지 클릭 동작, 있으면 팝오버의 "예산 탭에서 자세히" */
  onClick?: () => void;
  /**
   * 미등록 항목 원클릭 반영 경로(App의 handleChangeLedger = setDataWithHistory 1회).
   * 넘기면 배지 클릭이 체크리스트 팝오버를 열고, 없으면 기존처럼 onClick만 수행.
   */
  onChangeLedger?: (next: LedgerEntry[]) => void;
}

export const RecurringDueBadge: React.FC<Props> = ({ recurring, ledger, onClick, onChangeLedger }) => {
  const [open, setOpen] = useState(false);
  const missing = useMemo(
    () => findOverdueRecurring(recurring, ledger).filter((i) => !i.alreadyLogged),
    [recurring, ledger]
  );
  const handleClose = useCallback(() => setOpen(false), []);

  // 팝오버가 열린 채 항목이 모두 반영돼(다른 탭·수동 입력 등) 배지가 사라지면 열림 상태도 정리 —
  // 다음에 새 미등록이 생겼을 때 모달이 저절로 떠 있지 않게.
  useEffect(() => {
    if (missing.length === 0) setOpen(false);
  }, [missing.length]);

  // 생성된 항목 일괄 삽입(setDataWithHistory 1회) + [실행 취소] 토스트(삽입한 id만 제거 — 이후 변경 보존)
  const handleApply = useCallback(
    (entries: LedgerEntry[]) => {
      if (!onChangeLedger) return;
      const latest = useAppStore.getState().data.ledger;
      onChangeLedger([...entries, ...latest]);
      const ids = new Set(entries.map((e) => e.id));
      showDeleteUndoToast(`반복지출 ${entries.length}건을 가계부에 반영했습니다.`, () => {
        const cur = useAppStore.getState().data.ledger;
        if (!cur.some((l) => ids.has(l.id))) return false;
        onChangeLedger(cur.filter((l) => !ids.has(l.id)));
        return true;
      });
    },
    [onChangeLedger]
  );

  if (missing.length === 0) return null;

  const titleList = missing.map((m) => m.recurring.title).join(", ");
  const interactive = !!onChangeLedger || !!onClick;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (onChangeLedger) setOpen(true);
          else onClick?.();
        }}
        title={`오늘 등록 안 된 반복지출 ${missing.length}건: ${titleList}`}
        aria-haspopup={onChangeLedger ? "dialog" : undefined}
        aria-expanded={onChangeLedger ? open : undefined}
        style={{
          background: "var(--danger)",
          color: "white",
          borderRadius: 12,
          padding: "2px 8px",
          fontSize: 11,
          fontWeight: 600,
          border: "none",
          cursor: interactive ? "pointer" : "default"
        }}
      >
        반복지출 {missing.length}건 미등록
      </button>
      {/* 닫힌 동안엔 마운트하지 않음 — 팝오버의 ledger 구독·후보 계산이 헤더 렌더마다 돌지 않게 */}
      {onChangeLedger && open && (
        <RecurringDuePopover
          isOpen={open}
          items={missing}
          onClose={handleClose}
          onApply={handleApply}
          onGoBudget={onClick}
        />
      )}
    </>

  );
};
