/**
 * DashboardPage에서 사용하는 인라인 recharts 컴포넌트 모음.
 * DashboardPage가 이 파일을 lazy-import함으로써 recharts가 초기 번들에 포함되지 않음.
 */
import {
  Area,
  Bar,
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
import type { ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";

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
            <Line isAnimationActive={false} type="monotone" dataKey="total" name="전체 합계" stroke="#0f172a" strokeWidth={3} dot={{ r: 3 }} connectNulls />
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

// ─── 배당 추이 ComposedChart (공통 — 두 카드에서 재사용) ─────────────────────

interface DividendTrendRow {
  month: string;
  shares: number;
  dividend: number;
  costBasis: number;
  yieldRate: number | null;
}

interface DividendTrendChartProps {
  rows: DividendTrendRow[];
}

export function DividendTrendChart({ rows }: DividendTrendChartProps) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 12, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis dataKey="month" fontSize={12} tickFormatter={(v) => String(v).slice(2)} axisLine={false} tickLine={false} />
        <YAxis yAxisId="left" hide />
        <YAxis yAxisId="right" orientation="right" hide />
        <YAxis yAxisId="yield" orientation="right" hide />
        <Legend wrapperStyle={{ fontSize: 12 }} iconSize={8} iconType="circle" />
        <Tooltip
          formatter={(val: ValueType | undefined, name?: NameType) => {
            if (name === "주수") return [`${Number(val).toLocaleString()}주`, name];
            if (name === "배당률") return [val == null ? "-" : `${Number(val).toFixed(2)}%`, name];
            return [formatKRW(Math.round(Number(val ?? 0))), name ?? ""];
          }}
          contentStyle={{ fontSize: 14, fontWeight: 600 }}
        />
        <Bar isAnimationActive={false} yAxisId="left" dataKey="dividend" name="배당금(수입)" fill="var(--chart-income)" maxBarSize={32} radius={[4, 4, 0, 0]} />
        <Line isAnimationActive={false} yAxisId="right" dataKey="shares" name="주수" stroke="var(--chart-expense)" strokeWidth={2.5} dot={{ r: 4, fill: "var(--chart-expense)" }} />
        <Line isAnimationActive={false} yAxisId="yield" dataKey="yieldRate" name="배당률" stroke="var(--chart-warning)" strokeWidth={2.5} dot={{ r: 4, fill: "var(--chart-warning)" }} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ─── CMA·현금성 계좌 잔액 추이 ───────────────────────────────────────────────

export interface CmaTrendRow {
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
        <YAxis fontSize={11} tickFormatter={(v) => formatKRW(Math.round(Number(v)))} width={70} />
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
            stroke="#0f172a"
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
          activeDot={{ r: 7, stroke: "#0f172a", strokeWidth: 2, onClick: handleDotClick }}
        />
        <Line
          isAnimationActive={false}
          type="monotone"
          dataKey="cost"
          name="매입액"
          stroke="#f59e0b"
          strokeWidth={2}
          dot={{ r: 3, fill: "#f59e0b" }}
          activeDot={{ r: 7, stroke: "#0f172a", strokeWidth: 2, onClick: handleDotClick }}
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
}

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
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows} margin={{ top: 12, right: 16, left: 8, bottom: 8 }} onClick={handleChartClick} style={{ cursor: "pointer" }}>
        <defs>
          <linearGradient id="totalMarketGrad" x1="0" y1="0" x2="0" y2="1">
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
            stroke="#0f172a"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
          />
        )}
        <Area
          isAnimationActive={false}
          type="monotone"
          dataKey="cashPlusMarket"
          name="현금+평가액"
          stroke="#2563eb"
          strokeWidth={2.5}
          fill="url(#totalMarketGrad)"
          dot={{ r: 3, fill: "#2563eb" }}
          activeDot={{ r: 7, stroke: "#0f172a", strokeWidth: 2, onClick: handleDotClick }}
        />
        <Line
          isAnimationActive={false}
          type="monotone"
          dataKey="cashPlusCost"
          name="현금+원가"
          stroke="#f59e0b"
          strokeWidth={2}
          dot={{ r: 3, fill: "#f59e0b" }}
          activeDot={{ r: 7, stroke: "#0f172a", strokeWidth: 2, onClick: handleDotClick }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
