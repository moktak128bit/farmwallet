/**
 * 대차 한 줄 — 총자산 · 총부채 · 순자산을 항상 같은 순서, 같은 정의(calculations.computeBalanceSheet)로 보여준다.
 * 계좌 탭·대시보드 자산 섹션·인사이트 자산 분석·부채 탭이 공유한다. 이 셋을 나란히 두면
 * "빚을 뺀 값인가, 포함한 값인가"라는 질문이 사라진다: 총자산은 빚을 빼기 전, 순자산은 뺀 후.
 */
import React from "react";
import type { BalanceSheet } from "../calculations";
import { Money } from "./ui/Money";
import { formatKrwCompact } from "../utils/formatter";

const part = (label: string, v: number): string | null => (v > 0 ? `${label} ${formatKrwCompact(v)}` : null);

interface Props {
  bs: BalanceSheet;
}

export const BalanceSheetStrip: React.FC<Props> = ({ bs }) => {
  const assets = [
    part("현금", bs.cash),
    part("저축", bs.savings),
    part("주식", bs.securities),
    part("연금", bs.pension),
    part("카드 선납", bs.cardCredit),
  ].filter(Boolean).join(" · ");
  const liabilities = [
    part("대출", bs.loanDebt),
    part("마이너스 통장", bs.overdraft),
    part("카드", bs.cardDebt),
  ].filter(Boolean).join(" · ");
  return (
    <div className="card balance-sheet" role="table" aria-label="총자산·총부채·순자산">
      <div className="bs-row" role="row">
        <span className="bs-label">총자산</span>
        <span className="bs-value"><Money value={bs.totalAssets} compact /></span>
        <span className="bs-parts">{assets}</span>
      </div>
      <div className="bs-row" role="row">
        <span className="bs-label">총부채</span>
        <span className="bs-value"><Money value={bs.totalLiabilities} compact /></span>
        <span className="bs-parts">{liabilities || "없음"}</span>
      </div>
      <div className="bs-row bs-net" role="row">
        <span className="bs-label">순자산</span>
        <span className="bs-value" style={{ color: bs.netWorth >= 0 ? "var(--text)" : "var(--danger)" }}>
          <Money value={bs.netWorth} compact />
        </span>
        <span className="bs-parts">총자산 − 총부채</span>
      </div>
    </div>
  );
};
