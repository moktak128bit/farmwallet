/**
 * 추가 상환 시뮬 — 대출 카드 하단 접이식. 계산은 utils/loanPrepay(순수).
 *  - 금액/수수료율은 로컬 state(저장 안 함). 수수료율 초기값은 Loan.prepaymentFeeRate(폼에서 설정).
 *  - 투자 비교 힌트(TWR·배당수익률)는 펼쳤을 때만 계산 — useAppStore/FxRateContext 직접 구독
 *    (DebtPage props 시그니처 불변). 거래가 없거나 환율 미로드면 해당 행은 생략.
 *  - 카드 자체가 role=button(클릭/Enter/Space 토글)이라 내부 클릭·키 입력은 전파를 막는다.
 *  - 색: 절감(이익) = --danger 빨강, 손해/경고 = --accent 파랑 (CLAUDE.md #4).
 */
import React, { useMemo, useState } from "react";
import type { Loan } from "../../types";
import { useAppStore } from "../../store/appStore";
import { useFxRateValue } from "../../context/FxRateContext";
import { formatKRW } from "../../utils/formatter";
import { getTodayKST } from "../../utils/date";
import { parseAmount, formatAmount } from "../../utils/parseAmount";
import { simulatePrepayment, compareWithInvesting } from "../../utils/loanPrepay";
import { buildPortfolioPerformance } from "../../utils/portfolioPerformance";
import { buildForwardDividends } from "../../utils/forwardDividends";
import { computePositions, positionMarketValueKRW } from "../../calculations";
import { canonicalTickerForMatch, isUSDStock } from "../../utils/finance";

interface Props {
  loan: Loan;
  /** 현재 잔금 (loanAmount − 원금 상환 누적) */
  currentBalance: number;
}

const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 };
const muted: React.CSSProperties = { fontSize: 12, color: "var(--text-muted)" };

/** 펼쳤을 때만 마운트 — 포트폴리오 TWR·선행배당 수익률 힌트 (무거운 계산 격리) */
function useInvestHints(): { twrAnnualPct: number | null; dividendYieldPct: number | null } {
  const trades = useAppStore((s) => s.data.trades);
  const accounts = useAppStore((s) => s.data.accounts);
  const prices = useAppStore((s) => s.data.prices);
  const ledger = useAppStore((s) => s.data.ledger);
  const historicalDailyCloses = useAppStore((s) => s.data.historicalDailyCloses);
  const historicalDailyFx = useAppStore((s) => s.data.historicalDailyFx);
  const marketEnvSnapshots = useAppStore((s) => s.data.marketEnvSnapshots);
  const fxRate = useFxRateValue();
  const today = getTodayKST();

  const twrAnnualPct = useMemo(() => {
    if (trades.length === 0) return null;
    const perf = buildPortfolioPerformance({
      data: { trades, accounts, historicalDailyCloses, historicalDailyFx, marketEnvSnapshots, benchmarkDailyCloses: [] },
      fxRate,
      period: "1Y",
      endDate: today,
    });
    return perf?.annualizedPct != null ? perf.annualizedPct * 100 : null;
  }, [trades, accounts, historicalDailyCloses, historicalDailyFx, marketEnvSnapshots, fxRate, today]);

  // 배당 수익률 = 향후 12개월 예상 배당(보유 반영) ÷ 현재 포트폴리오 평가액(KRW). 평가액 0이면 생략.
  const dividendYieldPct = useMemo(() => {
    if (trades.length === 0) return null;
    const qty = new Map<string, number>();
    for (const t of trades) {
      const k = canonicalTickerForMatch(t.ticker);
      if (!k) continue;
      const q = Number(t.quantity) || 0;
      qty.set(k, (qty.get(k) ?? 0) + (t.side === "buy" ? q : -q));
    }
    for (const [k, v] of qty) if (Math.abs(v) < 1e-8) qty.set(k, 0);
    const fd = buildForwardDividends(ledger, today, fxRate, { currentQtyByTicker: qty });
    if (fd.annualTotalKRW <= 0) return null;
    const positions = computePositions(trades, prices, accounts, { fxRate: fxRate ?? undefined, priceFallback: "cost" });
    let valueKRW = 0;
    for (const p of positions) {
      if (isUSDStock(p.ticker) && !(fxRate && fxRate > 0)) continue; // 환율 미로드 시 USD 평가 제외
      valueKRW += positionMarketValueKRW(p, fxRate);
    }
    return valueKRW > 0 ? (fd.annualTotalKRW / valueKRW) * 100 : null;
  }, [trades, prices, accounts, ledger, fxRate, today]);

  return { twrAnnualPct, dividendYieldPct };
}

const SimulatorBody: React.FC<Props & { extraKRW: number; feeRate: number }> = ({ loan, currentBalance, extraKRW, feeRate }) => {
  const today = getTodayKST();
  const { twrAnnualPct, dividendYieldPct } = useInvestHints();
  const sim = useMemo(
    () => simulatePrepayment(loan, currentBalance, extraKRW, today, { feeRate }),
    [loan, currentBalance, extraKRW, today, feeRate]
  );
  const cmp = useMemo(
    () => compareWithInvesting(sim.appliedExtra, loan.annualInterestRate, { twrAnnual: twrAnnualPct, dividendYield: dividendYieldPct }),
    [sim.appliedExtra, loan.annualInterestRate, twrAnnualPct, dividendYieldPct]
  );

  if (sim.remainingMonths <= 0) {
    return <div className="hint" style={{ fontSize: 12 }}>만기가 지났거나 잔금이 없어 시뮬레이션할 수 없습니다.</div>;
  }
  if (sim.appliedExtra <= 0) {
    return <div className="hint" style={{ fontSize: 12 }}>추가 상환액을 입력하면 절감 이자·단축 기간을 계산합니다. (기준일 {today})</div>;
  }

  const feeLoses = sim.netSaved < 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {sim.appliedExtra < extraKRW && (
        <div className="hint" style={{ fontSize: 12 }}>잔금({formatKRW(Math.round(currentBalance))})까지만 적용됩니다.</div>
      )}
      <div style={row}>
        <span style={muted}>절감 이자 (잔여 {sim.remainingMonths}개월 기준)</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--danger)" }}>{formatKRW(Math.round(sim.interestSaved))}</span>
      </div>
      <div style={row}>
        <span style={muted}>단축 기간</span>
        <span style={{ fontSize: 13 }}>
          {loan.repaymentMethod === "bullet" && sim.monthsShortened === 0
            ? "만기일시 — 기간 변동 없음"
            : sim.monthsShortened > 0
              ? `${sim.monthsShortened}개월 (새 만기 ${sim.newMaturity ?? "-"})`
              : "변동 없음"}
        </span>
      </div>
      <div style={row}>
        <span style={muted}>중도상환수수료 ({feeRate}%)</span>
        <span style={{ fontSize: 13 }}>{feeRate > 0 ? `−${formatKRW(Math.round(sim.fee))}` : "없음"}</span>
      </div>
      <div style={row}>
        <span style={muted}>순 절감 (절감 − 수수료)</span>
        <span style={{ fontSize: 14, fontWeight: 700, color: feeLoses ? "var(--accent)" : "var(--danger)" }}>
          {formatKRW(Math.round(sim.netSaved))}
        </span>
      </div>
      <div style={row}>
        <span style={muted}>수수료 손익분기율</span>
        <span style={{ fontSize: 12 }}>
          {sim.breakEvenFeeRate.toFixed(2)}% {feeLoses ? "— 현재 수수료율이 더 높아 손해" : "미만이면 이득"}
        </span>
      </div>

      <div style={{ marginTop: 6, borderTop: "1px dashed var(--border)", paddingTop: 6 }}>
        <div style={{ ...muted, marginBottom: 4 }}>같은 돈을 투자하면? (연 기대, 세전)</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <tbody>
            {cmp.rows.map((r) => (
              <tr key={r.key}>
                <td style={{ padding: "2px 0", color: r.guaranteed ? "var(--text)" : "var(--text-muted)" }}>
                  {r.label}
                  {!r.guaranteed && (
                    <span
                      style={{
                        marginLeft: 6,
                        padding: "0 5px",
                        borderRadius: 8,
                        fontSize: 10,
                        background: "var(--warning-light)",
                        color: "var(--warning)",
                      }}
                    >
                      보장 아님
                    </span>
                  )}
                </td>
                <td style={{ padding: "2px 0", textAlign: "right", whiteSpace: "nowrap" }}>{r.ratePct.toFixed(2)}%</td>
                <td style={{ padding: "2px 0 2px 8px", textAlign: "right", whiteSpace: "nowrap", fontWeight: r.guaranteed ? 700 : 400 }}>
                  {formatKRW(Math.round(r.annualKRW))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {cmp.rows.length === 1 ? (
          <div className="hint" style={{ fontSize: 11, marginTop: 4 }}>
            비교할 투자 실적이 없습니다 (거래 1년 이력·배당 기록이 있으면 TWR·배당수익률을 함께 보여줍니다).
          </div>
        ) : (
          <div className="hint" style={{ fontSize: 11, marginTop: 4 }}>
            {cmp.bestAlternative
              ? `과거 실적대로라면 ${cmp.bestAlternative.label.split(" (")[0]}이(가) 연 ${formatKRW(Math.round(cmp.bestAlternative.vsLoanKRW))} 더 많지만 — `
              : "대출 상환(확정 절감)이 과거 투자 실적보다 유리합니다. "}
            {cmp.disclaimer}
          </div>
        )}
      </div>
    </div>
  );
};

export const LoanPrepaySimulator: React.FC<Props> = ({ loan, currentBalance }) => {
  const [open, setOpen] = useState(false);
  const [extraText, setExtraText] = useState("");
  const [feeText, setFeeText] = useState(() => (loan.prepaymentFeeRate != null ? String(loan.prepaymentFeeRate) : ""));

  const extraKRW = parseAmount(extraText);
  const feeParsed = feeText.trim() === "" ? 0 : Number(feeText);
  const feeRate = Number.isFinite(feeParsed) && feeParsed >= 0 ? feeParsed : 0;

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    // 카드(role=button)의 클릭/키 핸들러로 전파 차단 — 입력 중 Space/Enter가 카드 토글을 일으키지 않게
    <div onClick={stop} onKeyDown={stop} style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
      <button
        type="button"
        className="secondary"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        disabled={currentBalance <= 0}
        style={{ width: "100%", fontSize: 12, padding: "6px 10px" }}
      >
        {open ? "추가 상환 시뮬 접기 ▲" : "추가 상환 시뮬 ▼"}
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 90px", gap: 8 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={muted}>추가 상환액 (원)</span>
              <input
                type="text"
                inputMode="numeric"
                value={extraText}
                onChange={(e) => setExtraText(formatAmount(e.target.value))}
                placeholder={`최대 ${formatKRW(Math.round(currentBalance))}`}
                style={{ fontSize: 13, padding: "6px 8px" }}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={muted}>수수료율 %</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={feeText}
                onChange={(e) => setFeeText(e.target.value)}
                placeholder="0"
                style={{ fontSize: 13, padding: "6px 8px" }}
              />
            </label>
          </div>
          <SimulatorBody loan={loan} currentBalance={currentBalance} extraKRW={extraKRW} feeRate={feeRate} />
        </div>
      )}
    </div>
  );
};
