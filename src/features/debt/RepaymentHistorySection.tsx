/**
 * 「지금까지 갚은 내역」 섹션 — 부채별 그룹/필터 + 상환 내역 테이블 (수정/삭제 진입).
 * DebtPage에서 분리 — React.memo로 감싸 폼 타이핑 등 무관한 상태 변경 시 재렌더를 건너뛴다.
 * 부모가 넘기는 콜백은 모두 안정적(setState 또는 useCallback)이어야 memo가 효과를 가진다.
 *
 * 이 섹션에서만 쓰는 파생값(repaymentEntries/repaymentByDebt/debtFilterOptions/visibleRepaymentGroups)은
 * 여기서 useMemo로 계산한다. matchRepaymentLoan은 부모 useCallback(부모 loanRepayments memo와 공유)을 받는다.
 * 펼침(showRepaymentHistory)·필터(repaymentFilterDebtId)는 대출 카드 클릭과 공유되어 부모 소유 상태.
 * 수정 모달(EditRepaymentModal)은 부모에서 렌더 — 여기서는 onEditRepayment(setState)로 열기만 한다.
 */
import React, { useMemo } from "react";
import { ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react";
import type { Account, LedgerEntry, Loan } from "../../types";
import { formatKRW } from "../../utils/formatter";
import { isInterestRepayment } from "../../calculations";
import { useAppStore } from "../../store/appStore";
import { isLoanRepaymentEntry } from "./debtShared";

// ─── 삭제 토스트 [실행 취소] — "삭제 항목 재삽입" 복원 ───────────────────
// 풀 스냅샷 undo가 아니다:
//  - 삭제 이후 다른 변경(시세 갱신·Gist pull·탭 동기화·다른 편집)이 있어도
//    그 변경을 보존한 채 삭제된 항목만 되살린다.
//  - 복원은 onChange*(→ setDataWithHistory) 경유의 새 히스토리 write라
//    Ctrl+Z로 복원 자체를 다시 취소할 수 있다.
// 전제: appStore.setData는 동기(zustand) — 클릭 시점 getState() 재조회가 항상 최신.
// useAppStore는 핸들러 내부 getState()만 사용 — 훅 구독 금지(재렌더 유발·memo 무력화 방지).
import { buildRestoreById, showDeleteUndoToast } from "../../utils/undoToast";

interface Props {
  loans: Loan[];
  ledger: LedgerEntry[];
  accounts: Account[];
  showRepaymentHistory: boolean;
  setShowRepaymentHistory: React.Dispatch<React.SetStateAction<boolean>>;
  repaymentFilterDebtId: string;
  setRepaymentFilterDebtId: React.Dispatch<React.SetStateAction<string>>;
  /** 부모 useCallback — 상환 내역 ↔ 대출 매칭 (부모 loanRepayments memo와 공유) */
  matchRepaymentLoan: (entry: LedgerEntry) => Loan | null;
  /** 부모 setState — 상환 내역 수정 모달 열기 */
  onEditRepayment: React.Dispatch<React.SetStateAction<LedgerEntry | null>>;
  onChangeLedger?: (ledger: LedgerEntry[]) => void;
}

export const RepaymentHistorySection: React.FC<Props> = React.memo(function RepaymentHistorySection({
  loans,
  ledger,
  accounts,
  showRepaymentHistory,
  setShowRepaymentHistory,
  repaymentFilterDebtId,
  setRepaymentFilterDebtId,
  matchRepaymentLoan,
  onEditRepayment,
  onChangeLedger
}) {
  const repaymentEntries = useMemo(() => {
    return ledger
      .filter(isLoanRepaymentEntry)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [ledger]);

  const repaymentByDebt = useMemo(() => {
    const map = new Map<string, { label: string; entries: LedgerEntry[]; total: number }>();

    loans.forEach((loan) => {
      map.set(loan.id, { label: loan.loanName, entries: [], total: 0 });
    });

    repaymentEntries.forEach((entry) => {
      const loan = matchRepaymentLoan(entry);
      const debtId = loan?.id ?? "__unmatched__";
      const label = loan?.loanName ?? "매칭 안 됨";
      const current = map.get(debtId) ?? { label, entries: [], total: 0 };
      current.entries.push(entry);
      current.total += entry.amount;
      map.set(debtId, current);
    });

    return map;
  }, [repaymentEntries, loans, matchRepaymentLoan]);

  const debtFilterOptions = useMemo(() => {
    const all = Array.from(repaymentByDebt.entries()).map(([id, group]) => ({
      id,
      label: group.label,
      count: group.entries.length,
      total: group.total
    }));

    all.sort((a, b) => {
      if (a.id === "__unmatched__") return 1;
      if (b.id === "__unmatched__") return -1;
      const ia = loans.findIndex((l) => l.id === a.id);
      const ib = loans.findIndex((l) => l.id === b.id);
      return ia - ib;
    });

    return all;
  }, [repaymentByDebt, loans]);

  const visibleRepaymentGroups = useMemo(() => {
    if (repaymentFilterDebtId) {
      const selected = repaymentByDebt.get(repaymentFilterDebtId);
      return selected ? [[repaymentFilterDebtId, selected] as const] : [];
    }

    return Array.from(repaymentByDebt.entries())
      .filter(([, group]) => group.entries.length > 0)
      .sort((a, b) => {
        if (a[0] === "__unmatched__") return 1;
        if (b[0] === "__unmatched__") return -1;
        const ia = loans.findIndex((l) => l.id === a[0]);
        const ib = loans.findIndex((l) => l.id === b[0]);
        return ia - ib;
      });
  }, [repaymentByDebt, repaymentFilterDebtId, loans]);

  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  const handleDeleteRepayment = (entry: LedgerEntry) => {
    if (!onChangeLedger) return;
    if (
      !window.confirm(
        `"${entry.description || "상환"}" 내역을 삭제하시겠습니까?\n${entry.date || "날짜 없음"} · ${formatKRW(Math.round(entry.amount))}`
      )
    )
      return;
    const deletedIndex = ledger.findIndex((l) => l.id === entry.id);
    onChangeLedger(ledger.filter((l) => l.id !== entry.id));
    showDeleteUndoToast(
      "상환 내역이 삭제되었습니다.",
      buildRestoreById(() => useAppStore.getState().data.ledger, onChangeLedger, entry, deletedIndex)
    );
  };

  return (
    /* 지금까지 갚은 내역 (가계부 지출 반영) */
    <div
      className="card"
      style={{
        marginTop: 32,
        padding: 0,
        overflow: "hidden",
        border: "2px solid var(--border)",
        borderRadius: 12
      }}
    >
      <button
        type="button"
        onClick={() => setShowRepaymentHistory((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "18px 20px",
          border: "none",
          background: "var(--surface)",
          cursor: "pointer",
          fontSize: 17,
          fontWeight: 700,
          color: "var(--text)",
          textAlign: "left"
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          지금까지 갚은 내역
          {repaymentEntries.length > 0 && (
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "var(--primary)",
                background: "var(--primary-muted)",
                padding: "4px 10px",
                borderRadius: 20
              }}
            >
              {repaymentEntries.length}건 · {formatKRW(Math.round(repaymentEntries.reduce((s, e) => s + e.amount, 0)))}
            </span>
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)" }}>
          {showRepaymentHistory ? <ChevronUp size={22} /> : <ChevronDown size={22} />}
        </span>
      </button>
      {showRepaymentHistory && (
        <>
          {repaymentEntries.length > 0 && (
            <div
              style={{
                padding: "16px 20px",
                borderTop: "1px solid var(--border)",
                background: "var(--bg)"
              }}
            >
              <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>부채별 보기</span>
                <select
                  value={repaymentFilterDebtId}
                  onChange={(e) => setRepaymentFilterDebtId(e.target.value)}
                  style={{
                    width: "100%",
                    maxWidth: 360,
                    padding: "12px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    fontSize: 14,
                    fontWeight: 500
                  }}
                >
                  <option value="">전체 부채</option>
                  {debtFilterOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label} · {opt.count}건 · {formatKRW(Math.round(opt.total))}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <div
            style={{
              maxHeight: 520,
              overflowY: "auto",
              borderTop: repaymentEntries.length > 0 ? "1px solid var(--border)" : undefined
            }}
          >
            {repaymentEntries.length === 0 ? (
              <div
                style={{
                  padding: 48,
                  textAlign: "center",
                  color: "var(--text-muted)",
                  fontSize: 15,
                  lineHeight: 1.6
                }}
              >
                <p style={{ margin: "0 0 8px", fontWeight: 600, color: "var(--text)" }}>아직 상환 내역이 없습니다</p>
                <p style={{ margin: 0 }}>부채 카드의 「갚기」 버튼으로 상환하면 가계부 지출에 자동 반영됩니다.</p>
              </div>
            ) : visibleRepaymentGroups.length === 0 ? (
              <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
                선택한 부채에 해당하는 내역이 없습니다.
              </div>
            ) : (
              visibleRepaymentGroups.map(([debtId, group]) => {
                const entries = [...group.entries].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
                const principalTotal = entries.reduce(
                  (s, e) => (isInterestRepayment(e) ? s : s + e.amount),
                  0
                );
                const interestTotal = entries.reduce(
                  (s, e) => (isInterestRepayment(e) ? s + e.amount : s),
                  0
                );
                return (
                  <div
                    key={debtId}
                    style={{
                      borderBottom: "2px solid var(--border)",
                      marginBottom: 0
                    }}
                  >
                    <div
                      style={{
                        padding: "14px 20px",
                        background: "var(--surface)",
                        fontWeight: 700,
                        fontSize: 15,
                        color: "var(--primary)",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        flexWrap: "wrap",
                        borderBottom: "1px solid var(--border)"
                      }}
                    >
                      <span>{group.label}</span>
                      <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600, display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <span>{entries.length}건 · {formatKRW(Math.round(group.total))}</span>
                        <span style={{ color: "var(--text)" }}>원금 {formatKRW(Math.round(principalTotal))}</span>
                        <span style={{ color: "var(--chart-expense)" }}>이자 {formatKRW(Math.round(interestTotal))}</span>
                      </span>
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                      <thead>
                        <tr style={{ background: "var(--bg)" }}>
                          <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--text-muted)" }}>날짜</th>
                          <th style={{ padding: "10px 20px", textAlign: "left", fontWeight: 600, fontSize: 12, color: "var(--text-muted)" }}>상세</th>
                          <th style={{ padding: "10px 20px", textAlign: "right", fontWeight: 600, fontSize: 12, color: "var(--text-muted)" }}>금액</th>
                          {onChangeLedger && <th style={{ padding: "10px 20px", width: 72 }} />}
                        </tr>
                      </thead>
                      <tbody>
                        {entries.map((e) => (
                          <tr
                            key={e.id}
                            style={{
                              borderBottom: "1px solid var(--border)",
                              transition: "background 0.15s"
                            }}
                            onMouseEnter={(ev) => (ev.currentTarget.style.background = "var(--surface)")}
                            onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
                          >
                            <td style={{ padding: "14px 20px", verticalAlign: "top", whiteSpace: "nowrap", color: "var(--text-muted)" }}>
                              {e.date}
                            </td>
                            <td style={{ padding: "14px 20px", verticalAlign: "top" }}>
                              <div>
                                <span style={{ fontWeight: 500 }}>{e.description || "(상환)"}</span>
                                {(() => {
                                  const isInterest = isInterestRepayment(e);
                                  return (
                                    <span
                                      style={{
                                        marginLeft: 8,
                                        fontSize: 11,
                                        fontWeight: 700,
                                        padding: "2px 8px",
                                        borderRadius: 10,
                                        background: isInterest ? "var(--chart-expense)" : "var(--primary)",
                                        color: "white"
                                      }}
                                    >
                                      {isInterest ? "이자" : "원금"}
                                    </span>
                                  );
                                })()}
                                {e.detailCategory && e.detailCategory !== "원금상환" && e.detailCategory !== "이자상환" && (
                                  <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text-muted)" }}>
                                    ({e.detailCategory})
                                  </span>
                                )}
                                {e.fromAccountId && (
                                  <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-muted)" }}>
                                    출금: {accountName(e.fromAccountId)}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td style={{ padding: "14px 20px", verticalAlign: "top", textAlign: "right", fontWeight: 700, color: "var(--chart-expense)", fontSize: 15 }}>
                              {formatKRW(Math.round(e.amount))}
                            </td>
                            {onChangeLedger && (
                              <td style={{ padding: "10px 20px", verticalAlign: "top" }}>
                                <div style={{ display: "flex", gap: 4 }}>
                                  <button
                                    type="button"
                                    onClick={() => onEditRepayment(e)}
                                    title="수정"
                                    style={{
                                      padding: 8,
                                      border: "none",
                                      background: "var(--surface)",
                                      cursor: "pointer",
                                      color: "var(--text-muted)",
                                      borderRadius: 6
                                    }}
                                  >
                                    <Pencil size={16} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteRepayment(e)}
                                    title="삭제"
                                    style={{
                                      padding: 8,
                                      border: "none",
                                      background: "var(--surface)",
                                      cursor: "pointer",
                                      color: "var(--danger)",
                                      borderRadius: 6
                                    }}
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
});
