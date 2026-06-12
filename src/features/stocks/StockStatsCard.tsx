import React from "react";
import { formatKRW, formatUSD } from "../../utils/formatter";

interface StockStatsCardProps {
  totalMarketValue: number;
  totalMarketValueUSD?: number;
  fxRate?: number | null;
  dayPnl: number;
  totalPnl: number;
  totalCost: number;
  totalReturnRate: number;
  totalDividend?: number;
  /** FIFO 기반 누적 실현손익 (KRW). 청산된 거래의 매도금액 − 비례 매수원가 합. */
  realizedPnl?: number;
  /** 실현손익 / 청산 거래 누적 원가 — 0이면 청산 내역 없음. */
  realizedReturnRate?: number;
  /** 청산 건수 (참고 표시용) */
  realizedTradeCount?: number;
}

export const StockStatsCard: React.FC<StockStatsCardProps> = ({
  totalMarketValue,
  totalMarketValueUSD,
  fxRate,
  dayPnl,
  totalPnl,
  totalCost,
  totalReturnRate,
  totalDividend = 0,
  realizedPnl = 0,
  realizedReturnRate = 0,
  realizedTradeCount = 0
}) => {
  // 색 컨벤션(국내 관례): 이익/상승=빨강(var(--danger)), 손실/하락=파랑(var(--accent))
  const valueColor = (value: number) => (value >= 0 ? "var(--danger)" : "var(--accent)");
  // 다크모드 대응: 하드코딩 라이트 팔레트 대신 테마 변수 사용
  const statBox: React.CSSProperties = {
    background: "var(--surface-hover)",
    color: "var(--text)",
    padding: 12,
    borderRadius: 12,
    border: "1px solid var(--border)"
  };

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <div style={statBox}>
          <div style={{ color: "var(--text-muted)", fontSize: 14, fontWeight: 600, marginBottom: 4 }}>원금</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text)" }}>{formatKRW(totalCost)}</div>
          {fxRate != null && fxRate > 0 && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>≈ {formatUSD(totalCost / fxRate)}</div>
          )}
        </div>

        <div style={statBox}>
          <div style={{ color: "var(--text-muted)", fontSize: 14, fontWeight: 600, marginBottom: 4 }}>평가금</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: valueColor(totalMarketValue) }}>{formatKRW(totalMarketValue)}</div>
          {fxRate != null && fxRate > 0 && totalMarketValueUSD != null && totalMarketValueUSD > 0 && (
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>≈ {formatUSD(totalMarketValueUSD)}</div>
          )}
        </div>

        <div style={statBox}>
          <div style={{ color: "var(--text-muted)", fontSize: 14, fontWeight: 600, marginBottom: 4 }}>배당금</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--success)" }}>{formatKRW(totalDividend)}</div>
        </div>

        <div
          style={statBox}
          title="현재 보유 종목의 시가평가 − 매수원가. 매도하지 않은 평가상 손익."
        >
          <div style={{ color: "var(--text-muted)", fontSize: 14, fontWeight: 600, marginBottom: 4 }}>평가손익 (미실현)</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: valueColor(totalPnl) }}>
            {formatKRW(totalPnl)} ({(totalReturnRate * 100).toFixed(2)}%)
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
            일일손익 {formatKRW(dayPnl)} ({totalMarketValue ? ((dayPnl / totalMarketValue) * 100).toFixed(2) : "0.00"}%)
          </div>
        </div>

        <div
          style={statBox}
          title="청산된 거래의 매도금액 − 비례 매수원가 (FIFO 매칭). 라이프타임 누적. 대시보드 '투자 기록'·인사이트와 동일."
        >
          <div style={{ color: "var(--text-muted)", fontSize: 14, fontWeight: 600, marginBottom: 4 }}>실현손익 (누적)</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: valueColor(realizedPnl) }}>
            {formatKRW(realizedPnl)} ({(realizedReturnRate * 100).toFixed(2)}%)
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
            {realizedTradeCount > 0 ? `청산 ${realizedTradeCount}건 · FIFO 기준` : "청산 내역 없음"}
          </div>
        </div>
      </div>
    </div>
  );
};
