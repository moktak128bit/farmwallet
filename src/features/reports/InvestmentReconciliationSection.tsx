/**
 * 투자 정산 보고서 — 자본 흐름·손익 분해·확정/평가 손익 목록·월별 실현손익·계좌별 정산.
 * ReportPage에서 분리 — React.memo로 감싸 다른 보고서 상태 변경 시 재렌더를 건너뛴다.
 * reconciliation은 부모의 useMemo(computeInvestmentReconciliation) 결과 — 여기서 재계산하지 않는다.
 * (CSV/Excel/PDF 내보내기도 같은 객체를 쓰므로 부모 소유.)
 */
import React from "react";
import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { DeferredResponsiveContainer as ResponsiveContainer } from "../../components/charts/DeferredResponsiveContainer";
import type { InvestmentReconciliation } from "../../utils/reportGenerator";
import { formatKRW } from "../../utils/formatter";
import { signedKRW, toPercent } from "./reportShared";

interface Props {
  reconciliation: InvestmentReconciliation;
}

export const InvestmentReconciliationSection: React.FC<Props> = React.memo(function InvestmentReconciliationSection({
  reconciliation
}) {
  const rec = reconciliation;
  if (!rec.hasData) {
    return (
      <div>
        <h3>투자 정산</h3>
        <p style={{ color: "var(--text-muted)", padding: 24 }}>
          주식·코인 계좌가 없습니다. 계좌 탭에서 증권/코인 계좌를 추가하면 투자 정산이 표시됩니다.
        </p>
      </div>
    );
  }
  const positive = rec.totalReturn >= 0;
  const returnColor = positive ? "var(--danger)" : "var(--accent)";
  return (
    <div>
      <h3>투자 정산</h3>
      <div className="hint" style={{ fontSize: 13, marginBottom: 16 }}>
        주식·코인 계좌 전체 기간 누적. 입금·출금은 투자계좌 경계를 넘는 이체 기준입니다.
      </div>

      {/* 헤드라인 — 투자 총성과 */}
      <div className="card" style={{ padding: 20, marginBottom: 12, textAlign: "center" }}>
        <div style={{ fontSize: 14, color: "var(--text-muted)" }}>투자 총성과</div>
        <div style={{ fontSize: 36, fontWeight: 800, color: returnColor, margin: "4px 0" }}>
          {signedKRW(rec.totalReturn)}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
          현재 평가액 {formatKRW(rec.currentValue)} − 순투입원금 {formatKRW(rec.netContributed)}
        </div>
        <div style={{ display: "flex", gap: 20, justifyContent: "center", marginTop: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13 }}>
            총수익률{" "}
            <strong style={{ color: returnColor }}>
              {rec.returnRate != null ? `${(rec.returnRate * 100).toFixed(2)}%` : "-"}
            </strong>
          </span>
          <span style={{ fontSize: 13 }}>
            연환산 IRR <strong>{toPercent(rec.irr)}</strong>
          </span>
        </div>
      </div>

      {/* 1. 자본 흐름 */}
      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <h4 style={{ margin: "0 0 2px" }}>자본 흐름 — 내 돈이 얼마 들어갔나</h4>
        <p className="hint" style={{ fontSize: 12, margin: "0 0 12px" }}>
          매수·매도는 계좌 안에서 현금↔주식 형태만 바꾼 거래라 여기 들어가지 않습니다.
        </p>
        <table className="data-table" style={{ width: "100%" }}>
          <tbody>
            <tr>
              <td>투자계좌 초기자본</td>
              <td className="number">{formatKRW(rec.initialCapital)}</td>
            </tr>
            <tr>
              <td>(+) 누적 입금 (이체)</td>
              <td className="number positive">{formatKRW(rec.deposits)}</td>
            </tr>
            <tr>
              <td>(−) 누적 출금 (생활비 회수 등)</td>
              <td className="number negative">{formatKRW(rec.withdrawals)}</td>
            </tr>
            <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border)" }}>
              <td>순투입원금</td>
              <td className="number">{formatKRW(rec.netContributed)}</td>
            </tr>
            <tr style={{ fontWeight: 700 }}>
              <td>현재 평가액 (주식 + 계좌 현금)</td>
              <td className="number">{formatKRW(rec.currentValue)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 2. 손익 분해 — 이익/손실 갈라서 */}
      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <h4 style={{ margin: "0 0 2px" }}>이 수익의 정체 — 이익과 손실</h4>
        <p className="hint" style={{ fontSize: 12, margin: "0 0 12px" }}>
          이익과 손실을 따로 보여줍니다. 순액만 보면 손실이 이익에 가려 안 보이기 때문입니다.
        </p>
        <table className="data-table" style={{ width: "100%" }}>
          <tbody>
            <tr>
              <td>실현 이익 <span style={{ fontSize: 12, color: "var(--text-muted)" }}>(이익 본 매도)</span></td>
              <td className="number positive">{signedKRW(rec.realizedGain)}</td>
            </tr>
            <tr>
              <td>실현 손실 <span style={{ fontSize: 12, color: "var(--text-muted)" }}>(손실 본 매도)</span></td>
              <td className="number negative">{signedKRW(rec.realizedLoss)}</td>
            </tr>
            <tr style={{ borderTop: "1px solid var(--border)" }}>
              <td>실현 손익 (순)</td>
              <td className={`number ${rec.realizedPnl >= 0 ? "positive" : "negative"}`}>{signedKRW(rec.realizedPnl)}</td>
            </tr>
            <tr>
              <td>미실현 이익 <span style={{ fontSize: 12, color: "var(--text-muted)" }}>(평가이익)</span></td>
              <td className="number positive">{signedKRW(rec.unrealizedGain)}</td>
            </tr>
            <tr>
              <td>미실현 손실 <span style={{ fontSize: 12, color: "var(--text-muted)" }}>(평가손실 — 물려 있음)</span></td>
              <td className="number negative">{signedKRW(rec.unrealizedLoss)}</td>
            </tr>
            <tr style={{ borderTop: "1px solid var(--border)" }}>
              <td>미실현 손익 (순)</td>
              <td className={`number ${rec.unrealizedPnl >= 0 ? "positive" : "negative"}`}>{signedKRW(rec.unrealizedPnl)}</td>
            </tr>
            <tr>
              <td>배당 수입</td>
              <td className="number positive">{formatKRW(rec.dividendIncome)}</td>
            </tr>
            <tr style={{ fontWeight: 700, borderTop: "2px solid var(--border)" }}>
              <td>손익 합계</td>
              <td className="number">{signedKRW(rec.pnlSum)}</td>
            </tr>
            <tr style={{ color: "var(--text-muted)" }}>
              <td>분류 외 차이 <span style={{ fontSize: 12 }}>(초기 보유분·계좌 입금 수입 등)</span></td>
              <td className="number">{signedKRW(rec.residual)}</td>
            </tr>
          </tbody>
        </table>
        <p className="hint" style={{ fontSize: 12, margin: "10px 0 0" }}>
          손익 합계 + 분류 외 차이 = 투자 총성과 {signedKRW(rec.totalReturn)}.
        </p>
      </div>

      {/* 확정수익 거래 목록 */}
      {rec.winningTrades.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <h4 style={{ margin: "0 0 2px" }}>
            확정수익 거래{" "}
            <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>이익 보고 매도한 건</span>
          </h4>
          <p className="hint" style={{ fontSize: 12, margin: "0 0 12px" }}>
            매도로 이익이 확정된 거래입니다. 수익 큰 거래 순.
          </p>
          <div style={{ overflowX: "auto", width: "100%" }}>
            <table className="data-table" style={{ width: "100%", minWidth: 560 }}>
              <thead>
                <tr>
                  <th>매도일</th>
                  <th>종목</th>
                  <th>계좌</th>
                  <th className="number">실현손익</th>
                  <th className="number">수익률</th>
                </tr>
              </thead>
              <tbody>
                {rec.winningTrades.map((t, i) => (
                  <tr key={`${t.date}-${t.ticker}-${i}`}>
                    <td>{t.date}</td>
                    <td>{t.name}</td>
                    <td>{t.accountName}</td>
                    <td className="number positive">{signedKRW(t.pnl)}</td>
                    <td className="number positive">{(t.returnRate * 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 확정손실 거래 목록 */}
      {rec.losingTrades.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <h4 style={{ margin: "0 0 2px" }}>
            확정손실 거래{" "}
            <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>손실 보고 매도한 건</span>
          </h4>
          <p className="hint" style={{ fontSize: 12, margin: "0 0 12px" }}>
            매도로 손실이 확정된 거래입니다. 손실 큰 거래 순.
          </p>
          <div style={{ overflowX: "auto", width: "100%" }}>
            <table className="data-table" style={{ width: "100%", minWidth: 560 }}>
              <thead>
                <tr>
                  <th>매도일</th>
                  <th>종목</th>
                  <th>계좌</th>
                  <th className="number">실현손익</th>
                  <th className="number">수익률</th>
                </tr>
              </thead>
              <tbody>
                {rec.losingTrades.map((t, i) => (
                  <tr key={`${t.date}-${t.ticker}-${i}`}>
                    <td>{t.date}</td>
                    <td>{t.name}</td>
                    <td>{t.accountName}</td>
                    <td className="number negative">{signedKRW(t.pnl)}</td>
                    <td className="number negative">{(t.returnRate * 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 평가수익 종목 목록 */}
      {rec.winningPositions.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <h4 style={{ margin: "0 0 2px" }}>
            평가수익 종목{" "}
            <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>지금 수익 중인 종목</span>
          </h4>
          <p className="hint" style={{ fontSize: 12, margin: "0 0 12px" }}>
            아직 팔지 않아 확정되지 않은 수익입니다. 수익이 큰 종목 순.
          </p>
          <div style={{ overflowX: "auto", width: "100%" }}>
            <table className="data-table" style={{ width: "100%", minWidth: 520 }}>
              <thead>
                <tr>
                  <th>종목</th>
                  <th>계좌</th>
                  <th className="number">평가손익</th>
                  <th className="number">손익률</th>
                </tr>
              </thead>
              <tbody>
                {rec.winningPositions.map((p) => (
                  <tr key={`${p.accountName}-${p.ticker}`}>
                    <td>{p.name}</td>
                    <td>{p.accountName}</td>
                    <td className="number positive">{signedKRW(p.pnl)}</td>
                    <td className="number positive">{(p.pnlRate * 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 평가손실 종목 목록 */}
      {rec.losingPositions.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <h4 style={{ margin: "0 0 2px" }}>
            평가손실 종목{" "}
            <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>지금 물려 있는 종목</span>
          </h4>
          <p className="hint" style={{ fontSize: 12, margin: "0 0 12px" }}>
            아직 팔지 않아 확정되지 않은 손실입니다. 손실이 큰 종목 순.
          </p>
          <div style={{ overflowX: "auto", width: "100%" }}>
            <table className="data-table" style={{ width: "100%", minWidth: 520 }}>
              <thead>
                <tr>
                  <th>종목</th>
                  <th>계좌</th>
                  <th className="number">평가손익</th>
                  <th className="number">손익률</th>
                </tr>
              </thead>
              <tbody>
                {rec.losingPositions.map((p) => (
                  <tr key={`${p.accountName}-${p.ticker}`}>
                    <td>{p.name}</td>
                    <td>{p.accountName}</td>
                    <td className="number negative">{signedKRW(p.pnl)}</td>
                    <td className="number negative">{(p.pnlRate * 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 월별 실현손익 추이 */}
      {rec.monthlyPnl.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <h4 style={{ margin: "0 0 2px" }}>월별 실현손익 추이</h4>
          <p className="hint" style={{ fontSize: 12, margin: "0 0 12px" }}>
            매도로 확정된 이익(초록)·손실(빨강). 손실이 언제 터졌는지 한눈에 보입니다.
          </p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={rec.monthlyPnl}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value: number | undefined) => formatKRW(value ?? 0)} />
              <Legend />
              <Bar isAnimationActive={false} dataKey="realizedGain" fill="#10b981" name="실현 이익" />
              <Bar isAnimationActive={false} dataKey="realizedLoss" fill="#f43f5e" name="실현 손실" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 3. 거래 활동량 (참고) */}
      <div className="card" style={{ padding: 16, marginBottom: 12 }}>
        <h4 style={{ margin: "0 0 12px" }}>
          거래 활동량{" "}
          <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>참고 — 손익이 아닙니다</span>
        </h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
          <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
            <div className="hint" style={{ fontSize: 13 }}>매수 총액</div>
            <div style={{ fontWeight: 700, fontSize: 20 }}>{formatKRW(rec.buyVolume)}</div>
          </div>
          <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
            <div className="hint" style={{ fontSize: 13 }}>매도 총액</div>
            <div style={{ fontWeight: 700, fontSize: 20 }}>{formatKRW(rec.sellVolume)}</div>
          </div>
          <div style={{ padding: "10px 12px", background: "var(--surface)", borderRadius: 8 }}>
            <div className="hint" style={{ fontSize: 13 }}>매매 건수</div>
            <div style={{ fontWeight: 700, fontSize: 20 }}>{rec.tradeCount}건</div>
          </div>
        </div>
        <p className="hint" style={{ fontSize: 12, margin: "10px 0 0" }}>
          매수·매도 총액은 거래량일 뿐, 수입·지출·성과 어디에도 들어가지 않습니다.
        </p>
      </div>

      {/* 4. 계좌별 정산 */}
      <div className="card" style={{ padding: 16 }}>
        <h4 style={{ margin: "0 0 12px" }}>계좌별 정산</h4>
        <div style={{ overflowX: "auto", width: "100%" }}>
          <table className="data-table" style={{ width: "100%", minWidth: 820 }}>
            <thead>
              <tr>
                <th>계좌</th>
                <th className="number">순투입원금</th>
                <th className="number">현재 평가액</th>
                <th className="number">총성과</th>
                <th className="number">실현</th>
                <th className="number">미실현</th>
                <th className="number">배당</th>
                <th className="number">IRR</th>
              </tr>
            </thead>
            <tbody>
              {rec.accounts.map((row) => (
                <tr key={row.accountId}>
                  <td>{row.accountName}</td>
                  <td className="number">{formatKRW(row.netContributed)}</td>
                  <td className="number">{formatKRW(row.currentValue)}</td>
                  <td className={`number ${row.totalReturn >= 0 ? "positive" : "negative"}`}>{signedKRW(row.totalReturn)}</td>
                  <td className={`number ${row.realizedPnl >= 0 ? "positive" : "negative"}`}>{formatKRW(row.realizedPnl)}</td>
                  <td className={`number ${row.unrealizedPnl >= 0 ? "positive" : "negative"}`}>{formatKRW(row.unrealizedPnl)}</td>
                  <td className="number">{formatKRW(row.dividendIncome)}</td>
                  <td className={`number ${row.irr != null && row.irr >= 0 ? "positive" : "negative"}`}>{toPercent(row.irr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});
