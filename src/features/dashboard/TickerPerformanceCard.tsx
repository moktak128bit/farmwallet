import React, { useMemo, useState } from "react";
import type { Account, LedgerEntry, StockPrice, StockTrade } from "../../types";
import { formatKRW } from "../../utils/formatter";
import { computeTickerPerformance, type TickerPerformance } from "../../utils/tickerPerformance";

interface Props {
  trades: StockTrade[];
  accounts: Account[];
  prices: StockPrice[];
  ledger: LedgerEntry[];
  fxRate: number | null;
  /** 기본 표시 개수. 나머지는 "더보기"로 확장 */
  initialLimit?: number;
}

const posColor = "var(--success, #059669)";
const negColor = "var(--danger, #dc2626)";
const mutedColor = "var(--text-muted)";

function pnlColor(v: number): string {
  if (v > 0) return posColor;
  if (v < 0) return negColor;
  return mutedColor;
}

function signed(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "" : ""; // 음수는 이미 "-" 포함
  return sign + formatKRW(Math.round(v));
}

function signedPct(v: number, digits = 1): string {
  const sign = v > 0 ? "+" : "";
  return sign + v.toFixed(digits) + "%";
}

export const TickerPerformanceCard: React.FC<Props> = ({
  trades,
  accounts,
  prices,
  ledger,
  fxRate,
  initialLimit = 10,
}) => {
  const rows = useMemo(
    () => computeTickerPerformance(trades, accounts, prices, ledger, fxRate),
    [trades, accounts, prices, ledger, fxRate],
  );

  const [expanded, setExpanded] = useState(false);
  const [openTicker, setOpenTicker] = useState<string | null>(null);

  const visible = expanded ? rows : rows.slice(0, initialLimit);
  const totalReturn = rows.reduce((s, r) => s + r.totalReturnKRW, 0);
  const totalUnrealized = rows.reduce((s, r) => s + r.unrealizedPnlKRW, 0);
  const totalRealized = rows.reduce((s, r) => s + r.realizedPnlKRW, 0);
  const totalDividends = rows.reduce((s, r) => s + r.dividendsKRW, 0);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="card-title">종목별 매매 성과</div>
          <div className="hint" style={{ fontSize: 12 }}>
            현재 보유 중인 종목만 · 총 수익(실현+미실현+배당) 내림차순 · 계좌 합산
          </div>
        </div>
        {rows.length > 0 && (
          <div style={{ display: "flex", gap: 16, fontSize: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <KPI label="총 수익" value={signed(totalReturn)} color={pnlColor(totalReturn)} />
            <KPI label="실현" value={signed(totalRealized)} color={pnlColor(totalRealized)} />
            <KPI label="미실현" value={signed(totalUnrealized)} color={pnlColor(totalUnrealized)} />
            <KPI label="배당" value={signed(totalDividends)} color={totalDividends > 0 ? posColor : mutedColor} />
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="hint" style={{ marginTop: 16 }}>현재 보유 중인 종목이 없습니다.</div>
      ) : (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {visible.map((r) => (
            <TickerRow
              key={r.tickerCanonical}
              row={r}
              isOpen={openTicker === r.tickerCanonical}
              onToggle={() => setOpenTicker(openTicker === r.tickerCanonical ? null : r.tickerCanonical)}
            />
          ))}
          {rows.length > initialLimit && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              style={{
                marginTop: 6,
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--surface)",
                color: "var(--text)",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {expanded ? "접기" : `${rows.length - initialLimit}개 더 보기`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

function KPI({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div className="hint" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function TickerRow({ row, isOpen, onToggle }: { row: TickerPerformance; isOpen: boolean; onToggle: () => void }) {
  const roi =
    row.currentCostBasisKRW > 0 ? (row.unrealizedPnlKRW / row.currentCostBasisKRW) * 100 : null;
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "10px 12px",
        background: "var(--surface)",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        style={{
          all: "unset",
          width: "100%",
          cursor: "pointer",
          display: "grid",
          gridTemplateColumns: "minmax(140px, 2fr) 1fr 1fr 1fr auto",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{row.name}</span>
            <span className="hint" style={{ fontSize: 11 }}>{row.tickerDisplay}</span>
            {row.isUsd && <span className="hint" style={{ fontSize: 10 }}>USD</span>}
          </div>
          <div className="hint" style={{ fontSize: 11 }}>
            보유 {row.currentQuantity.toLocaleString(undefined, { maximumFractionDigits: 4 })}
            {" · "}
            평가 {formatKRW(Math.round(row.currentMarketValueKRW))}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="hint" style={{ fontSize: 10 }}>총 수익</div>
          <div style={{ fontWeight: 700, fontSize: 14, color: pnlColor(row.totalReturnKRW) }}>
            {signed(row.totalReturnKRW)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="hint" style={{ fontSize: 10 }}>미실현</div>
          <div style={{ fontWeight: 600, fontSize: 13, color: pnlColor(row.unrealizedPnlKRW) }}>
            {signed(row.unrealizedPnlKRW)}
            {roi != null && (
              <span style={{ marginLeft: 4, fontSize: 11 }}>({signedPct(roi)})</span>
            )}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="hint" style={{ fontSize: 10 }}>실현 / 배당</div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            <span style={{ color: pnlColor(row.realizedPnlKRW) }}>{signed(row.realizedPnlKRW)}</span>
            {row.dividendsKRW > 0 && (
              <>
                <span className="hint" style={{ margin: "0 4px" }}>/</span>
                <span style={{ color: posColor }}>{signed(row.dividendsKRW)}</span>
              </>
            )}
          </div>
        </div>
        <div className="hint" style={{ fontSize: 14 }}>{isOpen ? "▾" : "▸"}</div>
      </button>

      {isOpen && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 10,
            borderTop: "1px solid var(--border)",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 10,
            fontSize: 12,
          }}
        >
          <Detail label="현재 원가" value={formatKRW(Math.round(row.currentCostBasisKRW))} />
          <Detail
            label="매매 횟수"
            value={`${row.tradeCount}회 (완료 ${row.closedCount})`}
          />
          <Detail
            label="승률"
            value={
              row.winRate == null
                ? "-"
                : `${row.winRate.toFixed(0)}% (${row.winCount}승 ${row.lossCount}패)`
            }
          />
          <Detail
            label="평균 보유기간"
            value={row.avgHoldingDays == null ? "-" : `${Math.round(row.avgHoldingDays)}일`}
          />
          <Detail label="첫 거래" value={row.firstTradeDate} />
          <Detail
            label="마지막 거래"
            value={`${row.lastActionDate} (${row.lastActionSide === "buy" ? "매수" : "매도"})`}
          />
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="hint" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );
}
