/**
 * 배분 X-ray 카드 — 포트폴리오 분석 탭 상단.
 * 같은 총자산(보유 평가액 + 증권·코인계좌 예수금)을 통화·시장·자산군 3축 스택바 + 집중도로 보여준다.
 * 데이터는 useAppStore 셀렉터 + FxRateContext를 직접 구독 (App props 시그니처 불변).
 * 차트는 CSS 스택바(애니메이션 없음, 색은 CSS 변수) — 다크모드 자동 대응.
 */
import React, { useMemo } from "react";
import { useAppStore } from "../../store/appStore";
import { useFxRateValue } from "../../context/FxRateContext";
import { computeAccountBalances, computePositions } from "../../calculations";
import { buildAllocationXray, XRAY_LABEL, type XrayAxis } from "../../utils/allocationXray";
import { formatKRW } from "../../utils/formatter";
import { isUSDStock } from "../../utils/finance";

/** 항목 라벨 → 색 (현금은 모든 축에서 같은 회색, 나머지는 축 안에서 구분되는 색) */
const LABEL_COLOR: Record<string, string> = {
  [XRAY_LABEL.KRW]: "var(--chart-series-a)",
  [XRAY_LABEL.USD]: "var(--warning)",
  [XRAY_LABEL.KR]: "var(--chart-series-a)",
  [XRAY_LABEL.US]: "var(--warning)",
  [XRAY_LABEL.CRYPTO]: "var(--success)",
  [XRAY_LABEL.STOCK]: "var(--chart-series-a)",
  [XRAY_LABEL.ETF]: "var(--warning)",
  [XRAY_LABEL.COIN]: "var(--success)",
  [XRAY_LABEL.PENSION]: "var(--danger)",
  [XRAY_LABEL.CASH]: "var(--text-faint)",
};
const colorOf = (label: string) => LABEL_COLOR[label] ?? "var(--primary)";

const fmtPct = (pct: number) => `${pct.toFixed(1)}%`;

const StackBar: React.FC<{ axis: XrayAxis }> = ({ axis }) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
      <span style={{ fontWeight: 600 }}>{axis.title}</span>
      {axis.maxItem && (
        <span className="hint" style={{ fontSize: 12 }}>
          최대 {axis.maxItem.label} {fmtPct(axis.maxItem.pct)}
        </span>
      )}
    </div>
    <div
      role="img"
      aria-label={`${axis.title} 배분: ${axis.items.map((i) => `${i.label} ${fmtPct(i.pct)}`).join(", ")}`}
      style={{
        display: "flex",
        width: "100%",
        height: 18,
        borderRadius: 6,
        overflow: "hidden",
        background: "var(--surface-hover)",
      }}
    >
      {axis.items.map((it) => (
        <div
          key={it.label}
          title={`${it.label} ${formatKRW(Math.round(it.valueKRW))} (${fmtPct(it.pct)})`}
          style={{ width: `${it.pct}%`, background: colorOf(it.label), minWidth: it.pct > 0 ? 1 : 0 }}
        />
      ))}
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 6, fontSize: 12 }}>
      {axis.items.map((it) => (
        <span key={it.label} style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
          <span
            aria-hidden
            style={{ width: 10, height: 10, borderRadius: 2, background: colorOf(it.label), display: "inline-block" }}
          />
          <span>{it.label}</span>
          <strong>{fmtPct(it.pct)}</strong>
          <span style={{ color: "var(--text-muted)" }}>{formatKRW(Math.round(it.valueKRW))}</span>
        </span>
      ))}
    </div>
  </div>
);

export const AllocationXrayCard: React.FC = () => {
  const trades = useAppStore((s) => s.data.trades);
  const prices = useAppStore((s) => s.data.prices);
  const accounts = useAppStore((s) => s.data.accounts);
  const ledger = useAppStore((s) => s.data.ledger);
  const tickerDatabase = useAppStore((s) => s.data.tickerDatabase);
  const fxRate = useFxRateValue();

  const xray = useMemo(() => {
    const balances = computeAccountBalances(accounts, ledger, trades);
    // priceFallback 없음: 시세 미로드 종목은 0 → 제외·건수 보고 (매입가로 섞으면 시장가 배분이 아니게 됨)
    const positions = computePositions(trades, prices, accounts, { fxRate: fxRate ?? undefined });
    return buildAllocationXray({ positions, balances, accounts, tickerDatabase, fxRate });
  }, [trades, prices, accounts, ledger, tickerDatabase, fxRate]);

  // 환율 미로드 경고 — USD 예수금/USD 종목 거래가 있는데 환율이 없으면 USD 자산이 0으로 잡힌다고 알림
  const hasUsdExposure = useMemo(
    () =>
      accounts.some((a) => (a.type === "securities" || a.type === "crypto") && (a.usdBalance ?? 0) > 0) ||
      trades.some((t) => isUSDStock(t.ticker)),
    [accounts, trades]
  );

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>배분 X-ray</h2>
        {xray.totalKRW > 0 && (
          <span className="hint" style={{ fontSize: 13 }}>
            총 {formatKRW(Math.round(xray.totalKRW))} · 현금 비중 <strong>{fmtPct(xray.cashPct)}</strong>
            {xray.concentration && (
              <>
                {" "}· 최대 집중 {xray.concentration.axisTitle} {xray.concentration.label}{" "}
                <strong>{fmtPct(xray.concentration.pct)}</strong>
              </>
            )}
          </span>
        )}
      </div>

      {xray.totalKRW <= 0 ? (
        <div className="hint" style={{ marginTop: 12, color: "var(--text-muted)" }}>
          {xray.excludedCount > 0
            ? `시세 미로드 ${xray.excludedCount}종목 — 시세를 갱신하면 배분이 표시됩니다.`
            : "보유 종목·증권계좌 예수금이 없습니다."}
        </div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 20,
              marginTop: 14,
            }}
          >
            {xray.axes.map((ax) => (
              <StackBar key={ax.key} axis={ax} />
            ))}
          </div>
          <div className="hint" style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)" }}>
            현금 = 증권·코인계좌 예수금(KRW + USD 환산, 연금계좌 예수금 포함) · 연금 = 연금계좌 보유종목 평가액 ·
            시장은 티커 DB(market) 기준, 없으면 티커 규칙으로 추정
            {xray.excludedCount > 0 && (
              <>
                {" "}· <span style={{ color: "var(--warning)" }}>시세 미로드 {xray.excludedCount}종목 제외</span>
              </>
            )}
            {hasUsdExposure && fxRate == null && (
              <>
                {" "}· <span style={{ color: "var(--warning)" }}>환율 미로드 — USD 자산 0으로 집계</span>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};
