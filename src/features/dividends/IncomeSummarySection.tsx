/**
 * 요약 카드(배당/이자 총액·최근 월) + 종목별 누적 배당 표 + 월별 배당/이자 합계 표.
 * DividendsPage에서 분리 — 표시 전용. 모든 집계(byTicker/monthly*)는 부모 memo에서
 * 계산해 props로 받는다 (자식은 재계산하지 않음).
 * React.memo로 감싸 표시 자료와 무관한 부모 상태 변경 시 재렌더를 건너뛴다.
 */
import React from "react";
import { formatKRW } from "../../utils/formatter";
import type { TabType } from "./types";

interface Props {
  tab: TabType;
  totalDividend: number;
  totalInterest: number;
  /** 부모 memo — 종목별 누적 배당 (총액 내림차순) */
  byTicker: Array<{ ticker: string; name: string; total: number; count: number }>;
  /** 부모 memo — 월별 배당 합계 (최신 월 우선) */
  monthlyDividendTotal: Array<{ month: string; total: number }>;
  /** 부모 memo — 월별 이자 합계 (최신 월 우선) */
  monthlyInterestTotal: Array<{ month: string; total: number }>;
}

export const IncomeSummarySection: React.FC<Props> = React.memo(function IncomeSummarySection({
  tab,
  totalDividend,
  totalInterest,
  byTicker,
  monthlyDividendTotal,
  monthlyInterestTotal
}) {
  return (
    <>
      <div className="cards-row">
        {tab === "dividend" && (
          <>
            <div className="card highlight">
              <div className="card-title">배당 총액</div>
              <div className="card-value positive">
                {formatKRW(Math.round(totalDividend))}
              </div>
            </div>
            <div className="card">
              <div className="card-title">최근 월 배당</div>
              <div className="card-value">
                {formatKRW(Math.round(monthlyDividendTotal[0]?.total ?? 0))}
              </div>
            </div>
          </>
        )}
        {tab === "interest" && (
          <>
            <div className="card highlight">
              <div className="card-title">이자 총액</div>
              <div className="card-value positive">
                {formatKRW(Math.round(totalInterest))}
              </div>
            </div>
            <div className="card">
              <div className="card-title">최근 월 이자</div>
              <div className="card-value">
                {formatKRW(Math.round(monthlyInterestTotal[0]?.total ?? 0))}
              </div>
            </div>
          </>
        )}
      </div>

      {tab === "dividend" && byTicker.length > 0 && (
        <>
          <h3>종목별 누적 배당</h3>
          <table className="data-table compact">
            <thead>
              <tr>
                <th>티커</th>
                <th>종목명</th>
                <th>횟수</th>
                <th>총 배당금</th>
              </tr>
            </thead>
            <tbody>
              {byTicker.map((item) => (
                <tr key={item.ticker}>
                  <td style={{ fontWeight: 600 }}>{item.ticker}</td>
                  <td>{item.name || "-"}</td>
                  <td className="number">{item.count}회</td>
                  <td className="number positive" style={{ fontWeight: 600, fontSize: 15 }}>
                    {formatKRW(Math.round(item.total))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {tab === "dividend" && (
        <>
          <h3>월별 배당 합계</h3>
          <table className="data-table compact">
            <thead>
              <tr>
                <th>월</th>
                <th>총액</th>
              </tr>
            </thead>
            <tbody>
              {monthlyDividendTotal.map((row) => (
                <tr key={row.month}>
                  <td style={{ fontWeight: 500 }}>{row.month}</td>
                  <td className="number positive" style={{ fontWeight: 600, fontSize: 15 }}>
                    {formatKRW(Math.round(row.total))}
                  </td>
                </tr>
              ))}
              {monthlyDividendTotal.length === 0 && (
                <tr>
                  <td colSpan={2} style={{ textAlign: "center" }}>
                    배당 내역이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}

      {tab === "interest" && (
        <>
          <h3>월별 이자 합계</h3>
          <table className="data-table compact">
            <thead>
              <tr>
                <th>월</th>
                <th>이자 합계</th>
              </tr>
            </thead>
            <tbody>
              {monthlyInterestTotal.map((row) => (
                <tr key={row.month}>
                  <td style={{ fontWeight: 500 }}>{row.month}</td>
                  <td className="number positive" style={{ fontWeight: 600, fontSize: 15 }}>
                    {formatKRW(Math.round(row.total))}
                  </td>
                </tr>
              ))}
              {monthlyInterestTotal.length === 0 && (
                <tr>
                  <td colSpan={2} style={{ textAlign: "center" }}>
                    이자 내역이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </>
  );
});
