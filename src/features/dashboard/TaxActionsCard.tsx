/**
 * 절세 액션 카드 (4-2) — 종합과세 추적(B1)·해외주식 양도세·손실수확(B3)·절세계좌 납입(4-1)에
 * 흩어진 세 계산을 utils/taxActions.buildTaxActions로 모아 우선순위 목록으로 보여준다.
 * 클릭하면 해당 탭으로 이동(uiStore.setTab). 데이터는 useAppStore/FxRateContext에서 직접 읽는다
 * (App.tsx 자식 props 시그니처 불변 — CLAUDE.md).
 *
 * 위젯 id "taxActions"는 대시보드 대시보드/배당 탭 양쪽에 그대로 재사용된다 — 자체 완결형(props 없이도
 * 동작)이라 두 페이지 어디에 놓아도 최소 변경으로 붙는다. forwardMonths(4-6 선행배당)를 페이지가 이미
 * 계산해뒀으면 넘겨받아 연말 종합과세 투영 정확도를 높이고, 없으면 선형 페이스로 자동 대체한다.
 */
import React, { useMemo } from "react";
import { useAppStore } from "../../store/appStore";
import { useUIStore } from "../../store/uiStore";
import { useFxRateValue } from "../../context/FxRateContext";
import { useTaxGrossUp } from "../../hooks/useTaxGrossUp";
import { getTodayKST } from "../../utils/date";
import { isUSDStock } from "../../utils/finance";
import { computePositions } from "../../calculations";
import { buildComprehensiveTaxTracker } from "../../utils/taxCalculator";
import { buildForeignCapitalGainsTax } from "../../utils/usCapitalGainsTax";
import { buildFxHistory } from "../../utils/portfolioHistory";
import {
  buildShelterAccountMap,
  buildShelterContributions,
  DEFAULT_TAX_CREDIT_RATE,
  TAX_SHELTER_RULES_2026
} from "../../utils/taxShelter";
import { STORAGE_KEYS } from "../../constants/config";
import { buildTaxActions, type TaxAction } from "../../utils/taxActions";
import type { ForwardDividendMonth } from "../../utils/forwardDividends";

interface Props {
  /** 이미 계산된 선행배당(4-6, DividendsPage 등) — 있으면 종합과세 연말 투영에 재사용. 없으면 자체 계산(선형 페이스) */
  forwardMonths?: ForwardDividendMonth[];
}

/** ShelterContributionCard가 쓰는 공제율 설정과 같은 키를 읽어 카드 간 숫자를 맞춘다 (읽기 전용 — 여기서 바꾸지 않음) */
function readShelterCreditRate(): number {
  if (typeof window === "undefined") return DEFAULT_TAX_CREDIT_RATE;
  try {
    const raw = Number(localStorage.getItem(STORAGE_KEYS.TAX_CREDIT_RATE));
    const { low, high } = TAX_SHELTER_RULES_2026.creditRates;
    return raw === low || raw === high ? raw : DEFAULT_TAX_CREDIT_RATE;
  } catch {
    return DEFAULT_TAX_CREDIT_RATE;
  }
}

const SEVERITY_DOT_COLOR: Record<TaxAction["severity"], string> = {
  high: "var(--danger)",
  medium: "var(--warning)",
  low: "var(--text-muted)"
};

export const TaxActionsCard: React.FC<Props> = ({ forwardMonths }) => {
  const ledger = useAppStore((s) => s.data.ledger);
  const accounts = useAppStore((s) => s.data.accounts);
  const trades = useAppStore((s) => s.data.trades);
  const prices = useAppStore((s) => s.data.prices);
  const historicalDailyFx = useAppStore((s) => s.data.historicalDailyFx);
  const marketEnvSnapshots = useAppStore((s) => s.data.marketEnvSnapshots);
  const fxRate = useFxRateValue();
  const setTab = useUIStore((s) => s.setTab);
  // 배당 탭 ComprehensiveTaxCard와 같은 설정을 공유 — 같은 화면에서 두 카드 숫자가 어긋나지 않게
  const [grossUp] = useTaxGrossUp();

  const today = getTodayKST();
  const year = Number(today.slice(0, 4));

  const excludeAccountIds = useMemo(() => new Set(buildShelterAccountMap(accounts).keys()), [accounts]);

  const tracker = useMemo(
    () => buildComprehensiveTaxTracker(ledger, today, fxRate, { grossUp, excludeAccountIds, forwardMonths }),
    [ledger, today, fxRate, grossUp, excludeAccountIds, forwardMonths]
  );

  const hasUsd = useMemo(() => trades.some((t) => isUSDStock(t.ticker)), [trades]);
  const foreignTax = useMemo(() => {
    if (!hasUsd) return null;
    const positions = computePositions(trades, prices, accounts, { fxRate: fxRate ?? undefined });
    const fxHistory = buildFxHistory(historicalDailyFx, marketEnvSnapshots);
    return buildForeignCapitalGainsTax({ trades, positions, year, fxHistory, fxRate });
  }, [hasUsd, trades, prices, accounts, historicalDailyFx, marketEnvSnapshots, fxRate, year]);

  const hasShelter = useMemo(() => accounts.some((a) => a.taxShelter), [accounts]);
  const shelter = useMemo(() => {
    if (!hasShelter) return null;
    return buildShelterContributions(ledger, accounts, year, fxRate, { creditRate: readShelterCreditRate() });
  }, [hasShelter, ledger, accounts, year, fxRate]);

  const actions = useMemo(
    () => buildTaxActions({ tracker, foreignTax, shelter, today }),
    [tracker, foreignTax, shelter, today]
  );

  if (actions.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-title">절세 액션</div>
      <div className="hint" style={{ fontSize: 12, marginTop: 2, marginBottom: 10 }}>
        지금 해볼 만한 절세 항목을 우선순위로 모았습니다 (안내 목적 — 실제 세액은 개인 상황에 따라 다릅니다).
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {actions.map((a) => (
          <button
            key={a.kind}
            type="button"
            onClick={() => setTab(a.targetTab)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              width: "100%",
              textAlign: "left",
              padding: "10px 12px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--surface)",
              color: "inherit",
              font: "inherit",
              cursor: "pointer"
            }}
          >
            <span
              aria-hidden
              style={{ width: 8, height: 8, borderRadius: "50%", background: SEVERITY_DOT_COLOR[a.severity], flexShrink: 0 }}
            />
            <span style={{ fontSize: 13, flex: 1 }}>{a.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
