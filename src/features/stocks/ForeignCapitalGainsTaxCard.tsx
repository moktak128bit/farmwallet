/**
 * 미국주식 양도소득세 카드 (B3) — 올해 실현 양도차익(KRW, 손익통산) vs 연 250만 공제, 초과분 22% 추정 +
 * 손실수확(평가손실 종목을 연내 매도하면 줄어드는 세금) 제안.
 * 계산은 utils/usCapitalGainsTax(순수). USD 거래가 없으면 렌더하지 않는다.
 *
 * 색: 세금 = 부담(주의) → warning, 절세 가능액 = 이득 → danger(이익=빨강 관례, CLAUDE.md #4).
 */
import React, { useMemo } from "react";
import { useAppStore } from "../../store/appStore";
import { useFxRateValue } from "../../context/FxRateContext";
import { computePositions } from "../../calculations";
import { isUSDStock } from "../../utils/finance";
import { getTodayKST } from "../../utils/date";
import { formatKRW } from "../../utils/formatter";
import { buildFxHistory } from "../../utils/portfolioHistory";
import { buildForeignCapitalGainsTax } from "../../utils/usCapitalGainsTax";

export const ForeignCapitalGainsTaxCard: React.FC = () => {
  const trades = useAppStore((s) => s.data.trades);
  const accounts = useAppStore((s) => s.data.accounts);
  const prices = useAppStore((s) => s.data.prices);
  const historicalDailyFx = useAppStore((s) => s.data.historicalDailyFx);
  const marketEnvSnapshots = useAppStore((s) => s.data.marketEnvSnapshots);
  const fxRate = useFxRateValue();

  const hasUsd = useMemo(() => trades.some((t) => isUSDStock(t.ticker)), [trades]);

  const tax = useMemo(() => {
    if (!hasUsd) return null;
    const positions = computePositions(trades, prices, accounts, { fxRate: fxRate ?? undefined });
    const fxHistory = buildFxHistory(historicalDailyFx, marketEnvSnapshots);
    const year = Number(getTodayKST().slice(0, 4));
    return buildForeignCapitalGainsTax({ trades, positions, year, fxHistory, fxRate });
  }, [hasUsd, trades, prices, accounts, historicalDailyFx, marketEnvSnapshots, fxRate]);

  if (!tax) return null;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div className="card-title">미국주식 양도소득세 ({tax.year}년)</div>
        <div className="hint" style={{ fontSize: 12 }}>연 250만 공제 · 초과분 22% · 다음해 5월 신고</div>
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", margin: "10px 0 8px" }}>
        <Stat label="올해 실현 양도차익" value={`${tax.realizedGainKRW >= 0 ? "+" : ""}${formatKRW(Math.round(tax.realizedGainKRW))}`} />
        <Stat label="과세표준 (250만 공제 후)" value={formatKRW(Math.round(tax.taxableGain))} />
        <Stat
          label="예상 세금 (22%)"
          value={formatKRW(Math.round(tax.estimatedTax))}
          color={tax.estimatedTax > 0 ? "var(--warning, var(--text))" : "var(--text-muted)"}
        />
      </div>

      {tax.taxableGain <= 0 ? (
        <div className="hint" style={{ fontSize: 13 }}>
          아직 공제(250만) 범위 안입니다. <strong style={{ color: "var(--text)" }}>비과세로 {formatKRW(Math.round(tax.deductionRemaining))}만큼 이익을 더 실현</strong>할 수 있어요
          (이익 종목 일부 매도→재매수로 매입원가를 높여두는 전략).
        </div>
      ) : tax.harvestCandidates.length > 0 ? (
        <div style={{ fontSize: 13 }}>
          <div style={{ marginBottom: 6 }}>
            💡 평가손실 종목을 연내 매도하면 손익통산으로 절세 가능 —{" "}
            <strong style={{ color: "var(--danger)" }}>최대 {formatKRW(Math.round(tax.taxSavingIfHarvestAll))} 절감</strong>
            {" "}(손실 {formatKRW(Math.round(tax.harvestableLossKRW))} 실현 시).
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-muted)" }}>
            {tax.harvestCandidates.slice(0, 5).map((c) => (
              <li key={`${c.ticker}-${c.accountName}`}>
                {c.ticker} <span style={{ color: "var(--text-muted)" }}>{c.name}</span> ·{" "}
                <span style={{ color: "var(--accent)" }}>−{formatKRW(Math.round(c.unrealizedLossKRW))}</span> ({c.accountName})
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="hint" style={{ fontSize: 13 }}>
          과세 대상 양도차익이 발생했습니다. 보유 종목 중 평가손실이 없어 추가 손실수확 여지는 없습니다.
        </div>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div>
    <div className="hint" style={{ fontSize: 12, marginBottom: 2 }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 700, color: color ?? "var(--text)" }}>{value}</div>
  </div>
);
