/**
 * DashboardPage에서 사용하는 인라인 recharts 컴포넌트 모음.
 * DashboardPage가 이 파일을 lazy-import함으로써 recharts가 초기 번들에 포함되지 않음.
 */
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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

export const ACCOUNT_LINE_COLORS = [
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

// ─── 주말/평일 지출 미니차트 ─────────────────────────────────────────────────

interface WeekendChartProps {
  rows: Array<{ label: string; amount: number }>;
}

export function WeekendChart({ rows }: WeekendChartProps) {
  return (
    <div style={{ width: "100%", height: 140, marginTop: 12 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 12, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis dataKey="label" fontSize={12} axisLine={false} tickLine={false} tick={{ fontWeight: 600 }} />
          <YAxis hide />
          <Tooltip formatter={(val: ValueType | undefined) => [formatKRW(Math.round(Number(val ?? 0))), "지출"]} contentStyle={{ fontSize: 14, fontWeight: 600 }} />
          <Bar dataKey="amount" name="지출" maxBarSize={48} radius={[6, 6, 0, 0]}>
            {rows.map((_, index) => (
              <Cell key={index} fill={index === 0 ? "var(--chart-series-a)" : "var(--chart-series-b)"} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── 자산 구성 Treemap ───────────────────────────────────────────────────────

interface TreemapItem {
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
          <Line type="monotone" dataKey="total" name="전체 합계" stroke={ACCOUNT_LINE_COLORS[0]} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
        )}
        {accountBalanceChartView === "all" && (
          <>
            <Line type="monotone" dataKey="total" name="전체 합계" stroke="#0f172a" strokeWidth={3} dot={{ r: 3 }} connectNulls />
            {accounts.map((acc, i) => (
              <Line key={acc.id} type="monotone" dataKey={acc.id} name={acc.name || acc.id} stroke={ACCOUNT_LINE_COLORS[i % ACCOUNT_LINE_COLORS.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls />
            ))}
          </>
        )}
        {accountBalanceChartView !== "total" && accountBalanceChartView !== "all" && accounts.some((a) => a.id === accountBalanceChartView) && (
          <Line type="monotone" dataKey={accountBalanceChartView} name={accounts.find((a) => a.id === accountBalanceChartView)?.name || accountBalanceChartView} stroke={ACCOUNT_LINE_COLORS[0]} strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
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
        <Bar yAxisId="left" dataKey="dividend" name="배당금(수입)" fill="var(--chart-income)" maxBarSize={32} radius={[4, 4, 0, 0]} />
        <Line yAxisId="right" dataKey="shares" name="주수" stroke="var(--chart-expense)" strokeWidth={2.5} dot={{ r: 4, fill: "var(--chart-expense)" }} />
        <Line yAxisId="yield" dataKey="yieldRate" name="배당률" stroke="var(--chart-warning)" strokeWidth={2.5} dot={{ r: 4, fill: "var(--chart-warning)" }} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ─── 지출 추이 LineChart ─────────────────────────────────────────────────────

interface AssetGrowthRow {
  month: string;
  value: number;
  change: number;
  changeRate: number | null;
  stock: number;
  savings: number;
}

interface SpendingLineChartProps {
  rows: AssetGrowthRow[];
}

export function SpendingLineChart({ rows }: SpendingLineChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 16, right: 24, left: 20, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis dataKey="month" fontSize={12} axisLine={false} tickLine={false} />
        <YAxis fontSize={12} tickFormatter={(v) => `${Math.round(Number(v) / 10000)}만`} axisLine={false} tickLine={false} width={56} />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload?.[0]?.payload) return null;
            const p = payload[0].payload as { value: number; change?: number; changeRate?: number | null };
            return (
              <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", fontSize: 13 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>{label}</div>
                <div>당월 지출: {formatKRW(Math.round(p.value))}</div>
                {p.change != null && (
                  <div>전일 대비 <span className={p.change >= 0 ? "positive" : "negative"}>{p.change >= 0 ? "+" : ""}{formatKRW(Math.round(p.change))}</span></div>
                )}
                {p.changeRate != null && (
                  <div>전일 비율 <span className={p.changeRate >= 0 ? "positive" : "negative"}>{p.changeRate >= 0 ? "+" : ""}{p.changeRate.toFixed(2)}%</span></div>
                )}
              </div>
            );
          }}
        />
        <Line type="monotone" dataKey="value" name="전체 지출" stroke={ACCOUNT_LINE_COLORS[0]} strokeWidth={2.4} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── 월별 자산/저축 BarChart ─────────────────────────────────────────────────

interface MonthlySavingsBarChartProps {
  rows: AssetGrowthRow[];
}

export function MonthlySavingsBarChart({ rows }: MonthlySavingsBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={[...rows].reverse()} margin={{ top: 8, right: 12, left: 8, bottom: 8 }} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
        <XAxis type="number" tickFormatter={(v) => `${Math.round(Number(v) / 10000)}만`} fontSize={12} axisLine={false} tickLine={false} width={50} />
        <YAxis type="category" dataKey="month" width={56} fontSize={12} axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(val: number | string | undefined) => formatKRW(Math.round(Number(val ?? 0)))} contentStyle={{ fontSize: 13, fontWeight: 600 }} labelFormatter={(v) => String(v)} />
        <Bar dataKey="stock" name="주식(주식)" stackId="a" fill="var(--chart-primary)" radius={[0, 4, 4, 0]} />
        <Bar dataKey="savings" name="저축 적금" stackId="a" fill="var(--chart-positive)" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── 카테고리별 지출 BarChart ────────────────────────────────────────────────

interface CategorySpendBarChartProps {
  rows: Array<{ catalog: string; amount: number; ratio: number }>;
}

export function CategorySpendBarChart({ rows }: CategorySpendBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={[...rows].reverse()} layout="vertical" margin={{ top: 4, right: 24, left: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
        <XAxis type="number" tickFormatter={(v) => `${Math.round(v / 10000)}만`} fontSize={12} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="catalog" width={120} fontSize={12} axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(val: ValueType | undefined) => [formatKRW(Math.round(Number(val ?? 0))), "금액"]}
          contentStyle={{ fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}
        />
        <Bar dataKey="amount" name="지출" fill="var(--chart-expense)" maxBarSize={28} radius={[0, 6, 6, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── 순자산 누적 곡선 LineChart ──────────────────────────────────────────────

interface NetWorthCurveChartProps {
  rows: Array<{ month: string; total: number }>;
}

export function NetWorthCurveChart({ rows }: NetWorthCurveChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis dataKey="month" fontSize={12} axisLine={false} tickLine={false} tickFormatter={(v) => String(v).slice(2)} />
        <YAxis fontSize={12} tickFormatter={(v) => `${Math.round(Number(v) / 10000)}만`} axisLine={false} tickLine={false} width={56} />
        <Tooltip
          formatter={(val: number | string | undefined) => [formatKRW(Math.round(Number(val ?? 0))), "순자산"]}
          contentStyle={{ fontSize: 14, fontWeight: 600 }}
          labelFormatter={(v) => String(v)}
        />
        <Line type="monotone" dataKey="total" name="순자산" stroke={ACCOUNT_LINE_COLORS[0]} strokeWidth={2.5} dot={false} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── 요일별 지출 패턴 BarChart ────────────────────────────────────────────────

interface DowPatternRow {
  label: string;
  avg: number;
}

interface DowPatternChartProps {
  rows: DowPatternRow[];
}

export function DowPatternChart({ rows }: DowPatternChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 8, right: 12, left: 4, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" fontSize={12} axisLine={false} tickLine={false} />
        <YAxis fontSize={12} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}천`} axisLine={false} tickLine={false} width={44} />
        <Tooltip
          formatter={(val: ValueType | undefined) => [formatKRW(Math.round(Number(val ?? 0))), "평균 지출"]}
          contentStyle={{ fontSize: 13, fontWeight: 600 }}
        />
        <Bar dataKey="avg" name="평균 지출" maxBarSize={44} radius={[6, 6, 0, 0]}>
          {rows.map((_, i) => (
            <Cell key={i} fill={i === 0 || i === 6 ? "var(--chart-warning)" : "var(--chart-expense)"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── 월별 저축률 추이 LineChart ───────────────────────────────────────────────

interface SavingsRateRow {
  month: string;
  rate: number | null;
}

interface MonthlySavingsRateChartProps {
  rows: SavingsRateRow[];
}

export function MonthlySavingsRateChart({ rows }: MonthlySavingsRateChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis dataKey="month" fontSize={12} axisLine={false} tickLine={false} tickFormatter={(v) => String(v).slice(2)} />
        <YAxis fontSize={12} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} axisLine={false} tickLine={false} width={40} />
        <ReferenceLine y={30} stroke="var(--chart-warning)" strokeDasharray="4 4" strokeWidth={1.5} label={{ value: "30%", fontSize: 10, fill: "var(--chart-warning)", position: "insideTopRight" }} />
        <Tooltip
          formatter={(val: ValueType | undefined) => [val == null ? "-" : `${Number(val).toFixed(1)}%`, "저축률"]}
          contentStyle={{ fontSize: 13, fontWeight: 600 }}
          labelFormatter={(v) => String(v)}
        />
        <Line type="monotone" dataKey="rate" name="저축률" stroke="var(--chart-positive)" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── 누적 실현손익 AreaChart ──────────────────────────────────────────────────

interface CumulativePnlRow {
  date: string;
  label: string;
  value: number;
}

interface CumulativePnlAreaChartProps {
  rows: CumulativePnlRow[];
}

export function CumulativePnlAreaChart({ rows }: CumulativePnlAreaChartProps) {
  const isPositive = rows.length > 0 && rows[rows.length - 1].value >= 0;
  const strokeColor = isPositive ? "#059669" : "#dc2626";
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={rows} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
        <defs>
          <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={strokeColor} stopOpacity={0.3} />
            <stop offset="95%" stopColor={strokeColor} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis dataKey="label" fontSize={12} axisLine={false} tickLine={false} />
        <YAxis fontSize={12} tickFormatter={(v) => `${Math.round(Number(v) / 10000)}만`} axisLine={false} tickLine={false} width={56} />
        <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
        <Tooltip
          formatter={(val: number | string | undefined) => [formatKRW(Math.round(Number(val ?? 0))), "누적 실현손익"]}
          contentStyle={{ fontSize: 13, fontWeight: 600 }}
          labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""}
        />
        <Area type="monotone" dataKey="value" name="누적 실현손익" stroke={strokeColor} strokeWidth={2.5} fill="url(#pnlGrad)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
