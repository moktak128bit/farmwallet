/**
 * 감지된 정기 결제(구독·반복결제) 목록 — utils/recurringDetection 순수 감지기의 표시 계층.
 *
 *  - RecurringCandidateList : 후보 행 목록(배지·주기·금액·근거). onRegister가 있으면 "반복지출로 등록" 버튼 표시.
 *    인사이트 SubTab(읽기전용)과 예산 탭(등록 버튼)이 같은 컴포넌트를 쓴다.
 *  - RecurringSuggestionsSection : 예산/반복 지출 화면용 래퍼 — 환율은 FxRateContext에서 직접 읽고(App props 시그니처 불변),
 *    등록 버튼은 RecurringFormCard.prefillNew 로 **폼만 채운다**(자동 생성 금지).
 */
import React, { useMemo, useState } from "react";
import type { Account, CategoryPresets, LedgerEntry, RecurringExpense } from "../../types";
import { getTodayKST } from "../../utils/date";
import { useFxRateValue } from "../../context/FxRateContext";
import {
  CADENCE_LABEL,
  RECURRING_STATUS_LABEL,
  candidateToRecurringPrefill,
  detectRecurringCandidates,
  type RecurringCandidate,
  type RecurringCandidateStatus,
} from "../../utils/recurringDetection";

const STATUS_PILL: Record<RecurringCandidateStatus, string> = {
  new: "danger", // 새 고정비 = 지출 증가 주의
  amountChanged: "warning",
  stopped: "muted",
  active: "success",
};

const fmtKrw = (n: number) => Math.round(n).toLocaleString() + "원";

export function RecurringCandidateList({
  candidates,
  accounts,
  onRegister,
  emptyText = "규칙적인 간격·비슷한 금액으로 3회 이상 반복된 지출이 아직 없습니다.",
}: {
  candidates: RecurringCandidate[];
  accounts?: Account[];
  /** 지정 시 미등록 후보에 "반복지출로 등록" 버튼 노출 */
  onRegister?: (cand: RecurringCandidate) => void;
  emptyText?: string;
}) {
  const accountName = (id?: string) => (id ? accounts?.find((a) => a.id === id)?.name ?? id : "");
  if (candidates.length === 0) {
    return <p className="hint" style={{ margin: 0 }}>{emptyText}</p>;
  }
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      {candidates.map((c) => {
        const drift = Math.round(c.amountDriftPct);
        const driftText =
          c.status === "amountChanged" ? ` (${drift > 0 ? "+" : ""}${drift}% · 기존 ${fmtKrw(c.amountMedian)})` : "";
        const acct = accountName(c.fromAccountId);
        return (
          <li
            key={c.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              padding: "10px 12px",
              borderRadius: 10,
              background: "var(--bg)",
              border: "1px solid var(--border-light)",
              fontSize: 13,
            }}
          >
            <span className={`pill ${STATUS_PILL[c.status]}`} style={{ fontSize: 11 }}>
              {RECURRING_STATUS_LABEL[c.status]}
            </span>
            {c.alreadyRegistered && (
              <span className="pill muted" style={{ fontSize: 11 }} title="이미 반복지출 목록에 같은 제목/소분류가 있습니다">
                등록됨
              </span>
            )}
            <span style={{ fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c.label}
            </span>
            <span style={{ color: "var(--text-muted)" }}>
              {CADENCE_LABEL[c.cadence]} · {fmtKrw(c.lastAmount)}
              {c.currency === "USD" ? " (USD 환산)" : ""}
              {driftText}
            </span>
            <span style={{ color: "var(--text-faint)", fontSize: 12 }}>
              {c.occurrences}회 · 마지막 {c.lastSeen}
              {acct ? ` · ${acct}` : ""}
              {c.subCategory ? ` · ${c.subCategory}` : ""}
            </span>
            {onRegister && !c.alreadyRegistered && (
              <button
                type="button"
                className="secondary"
                style={{ marginLeft: "auto", fontSize: 12, padding: "4px 10px" }}
                onClick={() => onRegister(c)}
                title="상단 폼에 값을 채웁니다. 확인 후 '추가'를 눌러야 등록됩니다."
              >
                반복지출로 등록
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

interface SectionProps {
  accounts: Account[];
  recurring: RecurringExpense[];
  ledger: LedgerEntry[];
  categoryPresets: CategoryPresets;
  /** 후보 → 상단 폼 prefill (BudgetRecurringView → RecurringFormCard.prefillNew) */
  onPrefill: (partial: Partial<Omit<RecurringExpense, "id">>) => void;
}

export const RecurringSuggestionsSection: React.FC<SectionProps> = React.memo(function RecurringSuggestionsSection({
  accounts,
  recurring,
  ledger,
  categoryPresets,
  onPrefill,
}) {
  const fxRate = useFxRateValue();
  const today = getTodayKST();
  const [showRegistered, setShowRegistered] = useState(false);

  const candidates = useMemo(
    () => detectRecurringCandidates(ledger, recurring, today, { lookbackMonths: 12, fxRate, categoryPresets }),
    [ledger, recurring, today, fxRate, categoryPresets]
  );
  const unregistered = useMemo(() => candidates.filter((c) => !c.alreadyRegistered), [candidates]);
  const visible = showRegistered ? candidates : unregistered;

  // 후보가 전혀 없으면 화면을 차지하지 않는다
  if (candidates.length === 0) return null;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0 }}>
          감지된 정기 결제 <span style={{ color: "var(--text-muted)", fontWeight: 500, fontSize: 13 }}>미등록 {unregistered.length}개</span>
        </h3>
        {candidates.length !== unregistered.length && (
          <label style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={showRegistered} onChange={(e) => setShowRegistered(e.target.checked)} />
            등록된 항목도 보기 ({candidates.length - unregistered.length})
          </label>
        )}
      </div>
      <p className="hint" style={{ marginTop: 4, marginBottom: 10 }}>
        최근 12개월 가계부에서 같은 상호·출금계좌로 규칙적인 간격(매주/매월/매년)·±10% 금액으로 3회 이상 반복된 지출입니다.
        "반복지출로 등록"은 상단 폼에 값만 채우며, 확인 후 "추가"를 눌러야 저장됩니다.
      </p>
      <RecurringCandidateList
        candidates={visible}
        accounts={accounts}
        onRegister={(c) => onPrefill(candidateToRecurringPrefill(c))}
        emptyText="미등록 후보가 없습니다 — 감지된 정기 결제가 모두 반복지출 목록에 있습니다."
      />
    </div>
  );
});
