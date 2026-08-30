import React, { useMemo } from "react";
import type { LedgerEntry, RecurringExpense } from "../types";
import { findOverdueRecurring } from "../utils/recurringAlert";

interface Props {
  recurring: RecurringExpense[];
  ledger: LedgerEntry[];
  onClick?: () => void;
}

export const RecurringDueBadge: React.FC<Props> = ({ recurring, ledger, onClick }) => {
  const missing = useMemo(
    () => findOverdueRecurring(recurring, ledger).filter((i) => !i.alreadyLogged),
    [recurring, ledger]
  );
  if (missing.length === 0) return null;

  const titleList = missing.map((m) => m.recurring.title).join(", ");
  return (
    <button
      type="button"
      onClick={onClick}
      title={`오늘 등록 안 된 반복지출 ${missing.length}건: ${titleList}`}
      className="pill danger"
      style={{ cursor: onClick ? "pointer" : "default" }}
    >
      반복지출 {missing.length}건 미등록
    </button>
  );
};
