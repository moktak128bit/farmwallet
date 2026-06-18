/**
 * DashboardPage에서 사용하는 인라인 recharts 컴포넌트 모음.
 * DashboardPage가 이 파일을 lazy-import함으로써 recharts가 초기 번들에 포함되지 않음.
 */
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from "recharts";
import { DeferredResponsiveContainer as ResponsiveContainer } from "../../components/charts/DeferredResponsiveContainer";
import { formatKRW } from "../../utils/formatter";
import type { Account } from "../../types";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";

// ─── 공통 상수 ──────────────────────────────────────────────────────────────

const ACCOUNT_LINE_COLORS = [
  "#2563eb",
  "#dc2626",
  "#059669",
  "#7c3aed",
  "#d97706",
  "#db2777",
  "#0891b2",
  "#84cc16",
];

// ─── Treemap 커스텀 셀 ───────────────────────────────────────────────────────

export function AssetTreemapContent(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  value?: number;
  fill?: string;
  depth?: number;
  percent?: number;
}) {
  const { x = 0, y = 0, width = 0, height = 0, name = "", fill, depth = 0, percent } = props;
  if (depth === 0 || width < 40 || height < 32) return null;
  const pct = percent != null ? percent : 0;
  const rx = Math.round(x);
  const ry = Math.round(y);
  const rw = Math.max(0, Math.round(width));
  const rh = Math.max(0, Math.round(height));
  return (
    <g>
      <rect x={rx} y={ry} width={rw} height={rh} fill={fill || "var(--chart-series-a)"} stroke="var(--surface)" strokeWidth={1} shapeRendering="crispEdges" />
      <text x={rx + rw / 2} y={ry + rh / 2 - 8} textAnchor="middle" dominantBaseline="middle" fontSize={14} fontWeight={700} fill="white" stroke="#0f172a" strokeWidth={2} strokeLinejoin="round" paintOrder="stroke">
        {name}
      </text>
      <text x={rx + rw / 2} y={ry + rh / 2 + 10} textAnchor="middle" dominantBaseline="middle" fontSize={13} fontWeight={600} fill="rgba(255,255,255,0.95)" stroke="#0f172a" strokeWidth={2} strokeLinejoin="round" paintOrder="stroke">
        {pct.toFixed(1)}%
      </text>
    </g>
  );
}

// ─── 자산 구성 Treemap ───────────────────────────────────────────────────────

export interface TreemapItem {
  name: string;
  children?: Array<{ name: string; value: number; fill: string; percent: number }>;
  [key: string]: unknown;
}

interface AssetTreemapProps {
  portfolioTreemapData: TreemapItem[];
  portfolioByType: { cashTotal: number; savingsTotal: number; stockTotal: number };
}

export function AssetTreemap({ portfolioTreemapData, portfolioByType }: AssetTreemapProps) {
  if (portfolioTreemapData.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: 13 }}>
        자산 데이터가 없습니다.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <Treemap
        isAnimationActive={false}
        data={portfolioTreemapData}
        dataKey="value"
        nameKey="name"
        stroke="var(--surface)"
        content={(props: Parameters<typeof AssetTreemapContent>[0]) => {
          const total = portfolioByType.cashTotal + portfolioByType.savingsTotal + portfolioByType.stockTotal;
          const pct = total > 0 && props.value != null ? (Number(props.value) / total) * 100 : 0;
          return <AssetTreemapContent {...props} percent={pct} />;
        }}
      >
        <Tooltip
          formatter={(val: number | string | undefined) => formatKRW(Math.round(Number(val ?? 0)))}
          contentStyle={{ fontSize: 13, fontWeight: 600 }}
          labelFormatter={(label, payload) => payload?.[0]?.payload?.name ?? label}
        />
      </Treemap>
    </ResponsiveContainer>
  );
}

// ─── 계좌 잔고 추이 LineChart ────────────────────────────────────────────────

interface AccountBalanceChartProps {
  accountBalanceSnapshots: Array<Record<string, number | string>>;
  accountBalanceChartView: string;
  accounts: Account[];
}

export function AccountBalanceChart({ accountBalanceSnapshots, accountBalanceChartView, accounts }: AccountBalanceChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={accountBalanceSnapshots} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" fontSize={12} axisLine={false} tickLine={false} />
        <YAxis fontSize={12} tickFormatter={(v) => `${Math.round(Number(v) / 10000)}만`} axisLine={false} tickLine={false} width={48} />
        <Tooltip
          formatter={(val: number | string | undefined) => formatKRW(Math.round(Number(val ?? 0)))}
          contentStyle={{ fontSize: 14, fontWeight: 600 }}
          labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""}
        />
        {accountBalanceChartView === "total" && (
          <Line isAnimationActive={false} type="monotone" dataKey="total" name="전체 합계" stroke={ACCOUNT_LINE_COLORS[0]} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
        )}
        {accountBalanceChartView === "all" && (
          <>
            {/* 합계선 — 테마 본문색 (다크모드에서도 보이도록 하드코딩 금지) */}
            <Line isAnimationActive={false} type="monotone" dataKey="total" name="전체 합계" stroke="var(--text)" strokeWidth={3} dot={{ r: 3 }} connectNulls />
            {accounts.map((acc, i) => (
              <Line isAnimationActive={false} key={acc.id} type="monotone" dataKey={acc.id} name={acc.name || acc.id} stroke={ACCOUNT_LINE_COLORS[i % ACCOUNT_LINE_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls />
            ))}
          </>
        )}
        {accountBalanceChartView !== "total" && accountBalanceChartView !== "all" && accounts.some((a) => a.id === accountBalanceChartView) && (
          <Line isAnimationActive={false} type="monotone" dataKey={accountBalanceChartView} name={accounts.find((a) => a.id === accountBalanceChartView)?.name || accountBalanceChartView} stroke={ACCOUNT_LINE_COLORS[0]} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── CMA·현금성 계좌 잔액 추이 ───────────────────────────────────────────────

interface CmaTrendRow {
  date: string;
  label: string;
  balance: number;
}

interface CmaBalanceChartProps {
  rows: CmaTrendRow[];
}

export function CmaBalanceChart({ rows }: CmaBalanceChartProps) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={rows} margin={{ top: 8, right: 12, left: 12, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" fontSize={11} axisLine={false} tickLine={false} />
        {/* 축 라벨은 "N만" 축약 — formatKRW 전체 표기는 길어서 잘림 */}
        <YAxis fontSize={11} tickFormatter={(v) => `${Math.round(Number(v) / 10000)}만`} axisLine={false} tickLine={false} width={48} />
        <Tooltip
          formatter={(val: ValueType | undefined) => formatKRW(Math.round(Number(val ?? 0)))}
          labelFormatter={(label, payload) => {
            const date = payload?.[0]?.payload?.date;
            return date ?? label;
          }}
          contentStyle={{ fontSize: 14, fontWeight: 600 }}
        />
        <Line
          isAnimationActive={false}
          dataKey="balance"
          name="잔액"
          stroke="var(--chart-primary)"
          strokeWidth={2.5}
          dot={{ r: 3 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── 주식 매입액 vs 평가액 (15일 간격) ───────────────────────────────────────

export interface CostVsMarketRow {
  date: string;
  label: string;
  cost: number;
  market: number;
}

interface CostVsMarketChartProps {
  rows: CostVsMarketRow[];
  activeDate?: string | null;
  onPointClick?: (date: string) => void;
}

export function CostVsMarketValueChart({ rows, activeDate, onPointClick }: CostVsMarketChartProps) {
  // 라벨 과밀 방지: 대략 10개 이하가 되도록 tick을 솎아낸다.
  const xInterval = rows.length > 10 ? Math.ceil(rows.length / 10) - 1 : 0;
  const handleChartClick = (state: unknown) => {
    if (!onPointClick) return;
    const s = state as
      | {
          activePayload?: Array<{ payload?: CostVsMarketRow }>;
          activeLabel?: string;
          activeTooltipIndex?: number;
        }
      | null;
    if (!s) return;
    const payloadDate = s.activePayload?.[0]?.payload?.date;
    if (payloadDate) {
      onPointClick(payloadDate);
      return;
    }
    if (
      typeof s.activeTooltipIndex === "number" &&
      s.activeTooltipIndex >= 0 &&
      s.activeTooltipIndex < rows.length
    ) {
      onPointClick(rows[s.activeTooltipIndex].date);
      return;
    }
    if (s.activeLabel) {
      const found = rows.find((r) => r.label === s.activeLabel);
      if (found) onPointClick(found.date);
    }
  };
  const handleDotClick = (data: unknown) => {
    if (!onPointClick) return;
    const d = data as { payload?: CostVsMarketRow } | null;
    if (d?.payload?.date) onPointClick(d.payload.date);
  };
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows} margin={{ top: 12, right: 16, left: 8, bottom: 8 }} onClick={handleChartClick} style={{ cursor: "pointer" }}>
        <defs>
          <linearGradient id="marketGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.28} />
            <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" fontSize={12} axisLine={false} tickLine={false} interval={xInterval} minTickGap={16} />
        <YAxis fontSize={12} tickFormatter={(v) => `${Math.round(Number(v) / 10000)}만`} axisLine={false} tickLine={false} width={56} />
        <Tooltip
          formatter={(val: number | string | undefined, name: string | number | undefined) => [
            formatKRW(Math.round(Number(val ?? 0))),
            String(name ?? ""),
          ]}
          contentStyle={{ fontSize: 13, fontWeight: 600 }}
          labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""}
        />
        <Legend wrapperStyle={{ fontSize: 13 }} />
        {activeDate && (
          <ReferenceLine
            x={rows.find((r) => r.date === activeDate)?.label}
            stroke="var(--text)"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
          />
        )}
        <Area
          isAnimationActive={false}
          type="monotone"
          dataKey="market"
          name="평가액"
          stroke="#2563eb"
          strokeWidth={2.5}
          fill="url(#marketGrad)"
          dot={{ r: 3, fill: "#2563eb" }}
          activeDot={{ r: 7, stroke: "var(--text)", strokeWidth: 2, onClick: handleDotClick }}
        />
        <Line
          isAnimationActive={false}
          type="monotone"
          dataKey="cost"
          name="매입액"
          stroke="#f59e0b"
          strokeWidth={2}
          dot={{ r: 3, fill: "#f59e0b" }}
          activeDot={{ r: 7, stroke: "var(--text)", strokeWidth: 2, onClick: handleDotClick }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ─── 총자산 추이 (현금+원가, 현금+평가) ─────────────────────────────────────

export interface TotalAssetRow {
  date: string;
  label: string;
  cashPlusCost: number;   // 계좌 현금 + 주식 원가 (KRW)
  cashPlusMarket: number; // 계좌 현금 + 주식 평가액 (KRW)
  // 자산군별 평가액 (누적 영역 차트용) — 합 = cashPlusMarket
  pension: number;        // 연금 (isPension 증권계좌)
  securities: number;     // 증권 (일반 securities + crypto)
  cash: number;           // 현금 (입출금)
  savings: number;        // 저축
  etc: number;            // 기타 (other)
}

/** 자산군 누적 영역 시리즈 정의 — 아래(현금)→위(연금) 순으로 쌓인다. 색은 CSS 변수(다크 대응). */
const ASSET_SEGMENTS: Array<{ key: keyof TotalAssetRow; name: string; color: string }> = [
  { key: "cash", name: "현금", color: "var(--chart-warning)" },
  { key: "savings", name: "저축", color: "var(--chart-positive)" },
  { key: "securities", name: "증권", color: "var(--chart-accent)" },
  { key: "pension", name: "연금", color: "var(--chart-primary)" },
  { key: "etc", name: "기타", color: "var(--text-muted)" },
];

interface TotalAssetChartProps {
  rows: TotalAssetRow[];
  activeDate?: string | null;
  onPointClick?: (date: string) => void;
}

export function TotalAssetValueChart({ rows, activeDate, onPointClick }: TotalAssetChartProps) {
  const xInterval = rows.length > 10 ? Math.ceil(rows.length / 10) - 1 : 0;
  const handleChartClick = (state: unknown) => {
    if (!onPointClick) return;
    const s = state as
      | {
          activePayload?: Array<{ payload?: TotalAssetRow }>;
          activeLabel?: string;
          activeTooltipIndex?: number;
        }
      | null;
    if (!s) return;
    const payloadDate = s.activePayload?.[0]?.payload?.date;
    if (payloadDate) {
      onPointClick(payloadDate);
      return;
    }
    if (
      typeof s.activeTooltipIndex === "number" &&
      s.activeTooltipIndex >= 0 &&
      s.activeTooltipIndex < rows.length
    ) {
      onPointClick(rows[s.activeTooltipIndex].date);
      return;
    }
    if (s.activeLabel) {
      const found = rows.find((r) => r.label === s.activeLabel);
      if (found) onPointClick(found.date);
    }
  };
  const handleDotClick = (data: unknown) => {
    if (!onPointClick) return;
    const d = data as { payload?: TotalAssetRow } | null;
    if (d?.payload?.date) onPointClick(d.payload.date);
  };
  // 값이 한 번이라도 0이 아닌 자산군만 렌더 (연금·기타가 없으면 범례에서 숨김)
  const segments = ASSET_SEGMENTS.filter((s) => rows.some((r) => Number(r[s.key] ?? 0) !== 0));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={rows} margin={{ top: 12, right: 16, left: 8, bottom: 8 }} onClick={handleChartClick} style={{ cursor: "pointer" }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" fontSize={12} axisLine={false} tickLine={false} interval={xInterval} minTickGap={16} />
        <YAxis fontSize={12} tickFormatter={(v) => `${Math.round(Number(v) / 10000)}만`} axisLine={false} tickLine={false} width={56} />
        <Tooltip
          formatter={(val: number | string | undefined, name: string | number | undefined) => [
            formatKRW(Math.round(Number(val ?? 0))),
            String(name ?? ""),
          ]}
          contentStyle={{ fontSize: 13, fontWeight: 600 }}
          labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""}
        />
        <Legend wrapperStyle={{ fontSize: 13 }} />
        {activeDate && (
          <ReferenceLine
            x={rows.find((r) => r.date === activeDate)?.label}
            stroke="var(--text)"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
          />
        )}
        {segments.map((s) => (
          <Area
            key={s.key}
            isAnimationActive={false}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stackId="asset"
            stroke={s.color}
            strokeWidth={1.5}
            fill={s.color}
            fillOpacity={0.65}
            dot={false}
            activeDot={{ r: 5, stroke: "var(--text)", strokeWidth: 1.5, onClick: handleDotClick }}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
