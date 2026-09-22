/**
 * 대출 표 + 합계 줄 — 한 대출은 한 줄(잔금·금리·남은 기간·상환·진행), 위에 총 부채 히어로.
 * 상세(대출금액·총 이자·원금/이자 납입·거치·추가 상환 시뮬)는 선택한 행 아래에 펼친다.
 * 이전의 카드 4장 × 9줄(3,000px)은 합계가 없어 빨간 잔금 넷을 머릿속으로 더해야 했다.
 *
 * DebtPage에서 분리 — React.memo. 부모가 넘기는 콜백은 모두 안정적(setState 또는 useCallback)이어야 memo가 효과를 가진다.
 * loanRepayments(대출별 원금/이자 누적)는 부모 memo — 여기서 재계산하지 않는다.
 * 행 선택(repaymentFilterDebtId)은 부모 소유 — 아래 상환 내역 필터와 같은 상태라 행 하나가 곧 "이 대출 보기"다.
 */
import React from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { Loan, RepaymentMethod } from "../../types";
import { formatKRW } from "../../utils/formatter";
import { Money } from "../../components/ui/Money";
import { getTodayKST } from "../../utils/date";
import { useAppStore } from "../../store/appStore";
import { buildRestoreById, showDeleteUndoToast } from "../../utils/undoToast";
import { daysBetween, summarizeLoans, type LoanRepayments } from "./debtShared";
import { LoanPrepaySimulator } from "./LoanPrepaySimulator";

const formatPeriod = (days: number): string => {
  if (Number.isNaN(days)) return "-";
  if (days < 0) return "만료";
  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  const remainingDays = days % 30;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years}년`);
  if (months > 0) parts.push(`${months}개월`);
  if (remainingDays > 0 && years === 0) parts.push(`${remainingDays}일`);
  return parts.length > 0 ? parts.join(" ") : "0일";
};

/**
 * 총 대출이자 추정.
 * - 거치기간 동안은 원금 전액에 대한 이자만 납부 — 이 이자도 총액에 가산한다 (기존엔 누락).
 * - 만기일시(bullet)는 전 기간(거치 포함) 원금 전액 이자.
 * - 상환 개월수는 정수로 보정 — 소수 개월(예: 53.4)로 회차 수·월 원금이 어긋나는 문제 방지.
 * (테스트용 export)
 */
export const calculateTotalInterest = (loan: Loan): number => {
  const totalDays = daysBetween(loan.loanDate, loan.maturityDate);
  const totalYears = totalDays / 365;
  if (totalYears <= 0) return 0;
  // 거치기간은 전체 기간을 넘지 않게 클램프
  const graceYears = Math.min(loan.gracePeriodYears || 0, totalYears);
  const repaymentYears = totalYears - graceYears;
  const annualRate = loan.annualInterestRate / 100;
  // 거치기간 이자: 원금 전액 × 연이율 × 거치년수
  const graceInterest = loan.loanAmount * annualRate * graceYears;

  if (loan.repaymentMethod === "bullet") {
    // 만기일시: 거치 여부와 무관하게 전 기간 원금 전액에 이자 발생
    return loan.loanAmount * annualRate * totalYears;
  }

  if (repaymentYears <= 0) return graceInterest;

  const monthlyRate = annualRate / 12;
  const months = Math.max(1, Math.round(repaymentYears * 12));

  if (loan.repaymentMethod === "equal_payment") {
    if (monthlyRate === 0) return graceInterest;
    const monthlyPayment =
      (loan.loanAmount * monthlyRate * Math.pow(1 + monthlyRate, months)) /
      (Math.pow(1 + monthlyRate, months) - 1);
    return graceInterest + (monthlyPayment * months - loan.loanAmount);
  }

  // equal_principal (원금균등)
  const monthlyPrincipal = loan.loanAmount / months;
  let totalInterest = 0;
  let remainingPrincipal = loan.loanAmount;
  for (let i = 0; i < months; i++) {
    totalInterest += remainingPrincipal * monthlyRate;
    remainingPrincipal -= monthlyPrincipal;
  }
  return graceInterest + totalInterest;
};

const repaymentMethodLabel: Record<RepaymentMethod, string> = {
  equal_payment: "원리금균등",
  equal_principal: "원금균등",
  bullet: "만기일시"
};

interface Props {
  loans: Loan[];
  /** 부모 memo — 대출별 원금/이자 상환 누적 */
  loanRepayments: LoanRepayments;
  /** 이번 달(KST) 납입한 이자 합 — 합계 줄 보조 문구 */
  monthInterestPaid: number;
  repaymentFilterDebtId: string;
  setRepaymentFilterDebtId: React.Dispatch<React.SetStateAction<string>>;
  setShowRepaymentHistory: React.Dispatch<React.SetStateAction<boolean>>;
  /** 부모 useCallback — 폼 ref.startEdit + setShowForm(true) */
  onEditLoan: (loan: Loan) => void;
  onChangeLoans: (loans: Loan[]) => void;
  /** onChangeLedger 존재 여부 — 「갚기」 버튼 표시 조건 */
  canRepay: boolean;
  /** 부모 setState — 상환 모달 열기 */
  onStartRepay: React.Dispatch<React.SetStateAction<Loan | null>>;
}

export const LoanTableSection: React.FC<Props> = React.memo(function LoanTableSection({
  loans,
  loanRepayments,
  monthInterestPaid,
  repaymentFilterDebtId,
  setRepaymentFilterDebtId,
  setShowRepaymentHistory,
  onEditLoan,
  onChangeLoans,
  canRepay,
  onStartRepay
}) {
  const handleDelete = (id: string) => {
    const index = loans.findIndex((l) => l.id === id);
    const deleted = index >= 0 ? loans[index] : undefined;
    if (!deleted) return;
    const ok = window.confirm(
      `"${deleted.loanName}" 대출을 삭제할까요?\n\n가계부의 상환 내역 기록은 삭제되지 않고 그대로 유지됩니다.`
    );
    if (!ok) return;
    onChangeLoans(loans.filter((l) => l.id !== id));
    // 삭제 토스트 [실행 취소] — restore-by-id 재삽입 (showDeleteUndoToast 공용 패턴).
    // 대출 삭제는 상환 내역(ledger)을 건드리지 않으므로 재삽입만으로 완전 복원된다.
    showDeleteUndoToast(
      `"${deleted.loanName}" 대출이 삭제되었습니다. 상환 내역은 가계부에 그대로 남아 있습니다.`,
      buildRestoreById(() => useAppStore.getState().data.loans, onChangeLoans, deleted, index)
    );
  };

  // 행 클릭 = 이 대출 보기: 상세 펼침 + 아래 상환 내역 필터 (같은 상태). 다시 누르면 해제.
  const toggleSelect = (id: string) => {
    setRepaymentFilterDebtId((prev) => (prev === id ? "" : id));
    setShowRepaymentHistory(true);
  };

  if (loans.length === 0) {
    return (
      <p className="hint" style={{ textAlign: "center", padding: 20 }}>
        등록된 대출이 없습니다 — 위 '새 대출 추가' 버튼으로 첫 대출을 등록해 보세요.
      </p>
    );
  }

  // KST 기준 오늘 — UTC 변환 시 00:00~08:59에 전날로 계산되는 문제 방지
  const summary = summarizeLoans(loans, loanRepayments, getTodayKST());

  return (
    <>
      {/* 합계 줄 — 부채 페이지의 첫 질문 "얼마 남았나"에 먼저 답한다 */}
      <div className="card loan-summary">
        <div>
          <div className="card-title">총 부채</div>
          <div className="card-value">
            <Money value={summary.totalBalance} compact />
          </div>
        </div>
        <div className="hint" style={{ marginTop: 0 }}>
          {summary.count}건
          {summary.weightedRate != null && <> · 잔금 가중 금리 {summary.weightedRate.toFixed(1)}%</>}
          {" · 이번 달 갚은 이자 "}
          {formatKRW(Math.round(monthInterestPaid))}
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table className="data-table loan-table" style={{ tableLayout: "auto" }}>
          <thead>
            <tr>
              <th>대출</th>
              <th className="number">잔금</th>
              <th className="number">금리</th>
              <th className="col-hide-mobile">남은 기간</th>
              <th className="col-hide-mobile">상환</th>
              <th className="col-hide-mobile" style={{ minWidth: 140 }}>진행</th>
              <th aria-label="작업" />
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((r) => {
              const { loan } = r;
              const selected = repaymentFilterDebtId === loan.id;
              const pct = Math.round(r.progress * 100);
              return (
                <React.Fragment key={loan.id}>
                  <tr
                    className={selected ? "selected" : undefined}
                    role="button"
                    tabIndex={0}
                    aria-expanded={selected}
                    title="클릭: 상세 · 아래 상환 내역을 이 대출로 필터"
                    onClick={() => toggleSelect(loan.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleSelect(loan.id);
                      }
                    }}
                  >
                    <td>
                      <div style={{ fontWeight: 600 }}>{loan.loanName}</div>
                      <div className="hint" style={{ marginTop: 2, fontSize: 12 }}>{loan.institution}</div>
                    </td>
                    {/* 잔금은 사실이지 경보가 아니다 — 잉크. 다 갚은 대출만 흐리게 */}
                    <td className="number" style={{ fontWeight: 700, color: r.balance > 0 ? "var(--text)" : "var(--text-muted)" }}>
                      {formatKRW(Math.round(r.balance))}
                    </td>
                    <td className="number">{loan.annualInterestRate}%</td>
                    <td className="col-hide-mobile">{formatPeriod(r.remainingDays)}</td>
                    <td className="col-hide-mobile">
                      {repaymentMethodLabel[loan.repaymentMethod]}
                      {r.graceEnd && (
                        <div className="hint" style={{ marginTop: 2, fontSize: 11, color: r.inGrace ? "var(--text-secondary)" : undefined }}>
                          {r.inGrace ? "거치 중" : "거치 종료"} ~{r.graceEnd.slice(2, 7)}
                        </div>
                      )}
                    </td>
                    <td className="col-hide-mobile">
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div
                          className="loan-progress"
                          role="progressbar"
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          title={`갚은 원금 ${formatKRW(Math.round(r.principalPaid))} / ${formatKRW(loan.loanAmount)}`}
                        >
                          <div className="loan-progress-fill" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="hint" style={{ marginTop: 0, fontSize: 12, minWidth: 32, textAlign: "right" }}>{pct}%</span>
                      </div>
                    </td>
                    <td>
                      <div className="loan-row-actions">
                        {canRepay && (
                          <button
                            type="button"
                            className="secondary"
                            style={{ fontSize: 12, padding: "5px 10px" }}
                            disabled={r.balance <= 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              onStartRepay(loan);
                            }}
                          >
                            갚기
                          </button>
                        )}
                        <button
                          type="button"
                          className="icon-action"
                          aria-label="대출 수정"
                          title="수정"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEditLoan(loan);
                          }}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-action danger"
                          aria-label="대출 삭제"
                          title="삭제"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(loan.id);
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {selected && (
                    <tr className="loan-detail-row">
                      <td colSpan={7}>
                        <div className="loan-detail">
                          <div>
                            <div className="card-title">대출금액</div>
                            <div>{formatKRW(loan.loanAmount)}</div>
                          </div>
                          <div>
                            <div className="card-title">총 대출이자 (추정)</div>
                            <div>{formatKRW(Math.round(calculateTotalInterest(loan)))}</div>
                          </div>
                          <div>
                            <div className="card-title">원금 상환</div>
                            <div>{formatKRW(Math.round(r.principalPaid))}</div>
                          </div>
                          <div>
                            <div className="card-title">이자 납입</div>
                            <div>{formatKRW(Math.round(r.interestPaid))}</div>
                          </div>
                          <div>
                            <div className="card-title">기간</div>
                            <div>{loan.loanDate} ~ {loan.maturityDate}</div>
                          </div>
                          {r.graceEnd && (
                            <div>
                              <div className="card-title">거치 {r.inGrace ? "중" : "종료"}</div>
                              <div>~ {r.graceEnd}</div>
                            </div>
                          )}
                        </div>
                        {/* 추가 상환 시뮬 — 접이식, 로컬 state. 내부에서 클릭/키 전파를 막는다 */}
                        <LoanPrepaySimulator loan={loan} currentBalance={r.balance} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ fontWeight: 700 }}>합계</td>
              <td className="number" style={{ fontWeight: 700 }}>{formatKRW(Math.round(summary.totalBalance))}</td>
              <td colSpan={5} />
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
});
