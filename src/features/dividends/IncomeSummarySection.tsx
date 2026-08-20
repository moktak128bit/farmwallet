/**
 * 요약 카드(배당/이자 총액·최근 월) + 종목별 누적 배당 표 + 월별 배당 추이 차트 + 월별 이자 합계 표.
 * DividendsPage에서 분리 — 표시 전용. 모든 집계(byTicker/monthly*)는 부모 memo에서
 * 계산해 props로 받는다 (자식은 재계산하지 않음).
 * 월별 배당은 세로 막대(시간 오름차순) + 3개월 이동평균 선. 진행 중인 달(이번 달)은 빗금 패턴으로
 * 구분해 완료된 달과 나란히 놓여도 "역대 최고"처럼 오해되지 않게 한다. 정확한 숫자는 details 표로 유지.
 * React.memo로 감싸 표시 자료와 무관한 부모 상태 변경 시 재렌더를 건너뛴다.
 */
import React from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { Payload, ValueType, NameType } from "recharts/types/component/DefaultTooltipContent";
import { formatKRW } from "../../utils/formatter";
import type { TabType } from "./types";

interface MonthlyChartRow {
  month: string;
  total: number;
  isPartial: boolean;
  movingAvg?: number;
}

interface MonthlyDividendStats {
  completedMonths: number;
  completedAvg: number;
  recentSixTotal: number;
  recentSixCount: number;
  priorSixTotal: number;
  priorSixCount: number;
  last12Total: number;
  last12Count: number;
}

interface Props {
  tab: TabType;
  totalDividend: number;
  totalInterest: number;
  /** 부모 memo — 종목별 누적 배당 (총액 내림차순) */
  byTicker: Array<{ ticker: string; name: string; total: number; count: number }>;
  /** 부모 memo — 월별 배당 합계 (최신 월 우선, 표용) */
  monthlyDividendTotal: Array<{ month: string; total: number }>;
  /** 부모 memo — 월별 배당 차트용 (오름차순 + 3개월 이동평균 + 진행 중인 달 표시) */
  monthlyDividendChart: MonthlyChartRow[];
  /** 부모 memo — 완료월 평균·최근/직전 6개월·최근 12개월 합계 */
  monthlyDividendStats: MonthlyDividendStats;
  /** 부모 memo — 월별 이자 합계 (최신 월 우선) */
  monthlyInterestTotal: Array<{ month: string; total: number }>;
}

const MiniStat: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <div>
    <div className="hint" style={{ fontSize: 12, marginBottom: 2 }}>{label}</div>
    <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{value}</div>
    {sub && <div className="hint" style={{ fontSize: 11 }}>{sub}</div>}
  </div>
);

const LegendKey: React.FC<{ kind: "bar" | "partial" | "line"; label: string }> = ({ kind, label }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
    {kind === "line" ? (
      <span style={{ width: 12, height: 2, background: "var(--text-secondary)", display: "inline-block" }} />
    ) : kind === "partial" ? (
      <span style={{ width: 10, height: 10, borderRadius: 2, border: "1px dashed var(--chart-income, var(--danger))", display: "inline-block" }} />
    ) : (
      <span style={{ width: 10, height: 10, borderRadius: 2, background: "var(--chart-income, var(--danger))", display: "inline-block" }} />
    )}
    {label}
  </span>
);

interface MonthTickProps {
  x?: number;
  y?: number;
  index?: number;
  payload?: { value: string };
}
/** X축 커스텀 틱 — "M월" + 1월(또는 첫 틱)에만 연도 보조 표시로 연도 경계 모호성 해소 */
const MonthTick: React.FC<MonthTickProps> = ({ x = 0, y = 0, index = 0, payload }) => {
  const month = payload?.value ?? "";
  const mm = Number(month.slice(5, 7));
  const showYear = mm === 1 || index === 0;
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={12} textAnchor="middle" fontSize={11} fill="var(--text-muted)">{mm}월</text>
      {showYear && (
        <text x={0} y={0} dy={25} textAnchor="middle" fontSize={10} fill="var(--text-faint)">{month.slice(0, 4)}</text>
      )}
    </g>
  );
};

interface MonthlyTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<Payload<ValueType, NameType>>;
}
const MonthlyTooltip: React.FC<MonthlyTooltipProps> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const bar = payload.find((p) => p.dataKey === "total");
  const ma = payload.find((p) => p.dataKey === "movingAvg" && p.value != null);
  const row = bar?.payload as MonthlyChartRow | undefined;
  if (!row) return null;
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px", fontSize: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 4, color: "var(--text)" }}>
        {row.month}{row.isPartial ? " · 진행 중" : ""}
      </div>
      <div style={{ color: "var(--chart-income, var(--danger))" }}>배당 {formatKRW(Math.round(Number(bar?.value ?? 0)))}</div>
      {ma && (
        <div style={{ color: "var(--text-secondary)" }}>3개월 평균 {formatKRW(Math.round(Number(ma.value)))}</div>
      )}
    </div>
  );
};

export const IncomeSummarySection: React.FC<Props> = React.memo(function IncomeSummarySection({
  tab,
  totalDividend,
  totalInterest,
  byTicker,
  monthlyDividendTotal,
  monthlyDividendChart,
  monthlyDividendStats,
  monthlyInterestTotal
}) {
  return (
    <>
      <div className="cards-row">
        {tab === "dividend" && (
          <>
            <div className="card highlight">
              <div className="card-title">배당 총액</div>
              <div className="card-value positive">
                {formatKRW(Math.round(totalDividend))}
              </div>
            </div>
            <div className="card">
              <div className="card-title">최근 월 배당</div>
              <div className="card-value">
                {formatKRW(Math.round(monthlyDividendTotal[0]?.total ?? 0))}
              </div>
            </div>
          </>
        )}
        {tab === "interest" && (
          <>
            <div className="card highlight">
              <div className="card-title">이자 총액</div>
              <div className="card-value positive">
                {formatKRW(Math.round(totalInterest))}
              </div>
            </div>
            <div className="card">
              <div className="card-title">최근 월 이자</div>
              <div className="card-value">
                {formatKRW(Math.round(monthlyInterestTotal[0]?.total ?? 0))}
              </div>
            </div>
          </>
        )}
      </div>

      {tab === "dividend" && byTicker.length > 0 && (
        <details style={{ marginBottom: 16 }}>
          <summary style={{ cursor: "pointer", fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
            종목별 누적 배당
          </summary>
          <table className="data-table compact" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>티커</th>
                <th>종목명</th>
                <th>횟수</th>
                <th>총 배당금</th>
              </tr>
            </thead>
            <tbody>
              {byTicker.map((item) => (
                <tr key={item.ticker}>
                  <td style={{ fontWeight: 600 }}>{item.ticker}</td>
                  <td>{item.name || "-"}</td>
                  <td className="number">{item.count}회</td>
                  <td className="number positive" style={{ fontWeight: 600, fontSize: 15 }}>
                    {formatKRW(Math.round(item.total))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {tab === "dividend" && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title" style={{ marginBottom: 12 }}>월별 배당 추이</div>

          {monthlyDividendChart.length === 0 ? (
            <div className="hint" style={{ fontSize: 13 }}>배당 내역이 없습니다.</div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>
                <MiniStat
                  label={`완료 ${monthlyDividendStats.completedMonths}개월 평균`}
                  value={formatKRW(Math.round(monthlyDividendStats.completedAvg))}
                />
                {monthlyDividendStats.priorSixCount > 0 && (
                  <MiniStat
                    label={`최근 ${monthlyDividendStats.recentSixCount}개월`}
                    value={formatKRW(Math.round(monthlyDividendStats.recentSixTotal))}
                    sub={
                      monthlyDividendStats.priorSixTotal > 0
                        ? `직전 ${monthlyDividendStats.priorSixCount}개월의 ${(monthlyDividendStats.recentSixTotal / monthlyDividendStats.priorSixTotal).toFixed(1)}배`
                        : undefined
                    }
                  />
                )}
                {monthlyDividendStats.last12Count > 0 && (
                  <MiniStat
                    label={`최근 ${monthlyDividendStats.last12Count}개월 합계`}
                    value={formatKRW(Math.round(monthlyDividendStats.last12Total))}
                  />
                )}
              </div>

              <div style={{ width: "100%", height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={monthlyDividendChart} margin={{ top: 8, right: 8, bottom: 8, left: 4 }}>
                    <defs>
                      <pattern id="dividendPartialHatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                        <rect width="6" height="6" fill="var(--chart-income, var(--danger))" opacity={0.15} />
                        <line x1="0" y1="0" x2="0" y2="6" stroke="var(--chart-income, var(--danger))" strokeWidth={2} opacity={0.55} />
                      </pattern>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="month" tick={<MonthTick />} interval={0} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      width={44}
                      tickFormatter={(v: number) => (v >= 10000 ? `${Math.round(v / 10000)}만` : String(v))}
                    />
                    <Tooltip content={<MonthlyTooltip />} />
                    <Bar dataKey="total" isAnimationActive={false} radius={[4, 4, 0, 0]} maxBarSize={24}>
                      {monthlyDividendChart.map((entry) => (
                        <Cell
                          key={entry.month}
                          fill={entry.isPartial ? "url(#dividendPartialHatch)" : "var(--chart-income, var(--danger))"}
                          stroke={entry.isPartial ? "var(--chart-income, var(--danger))" : "none"}
                          strokeWidth={entry.isPartial ? 1 : 0}
                        />
                      ))}
                    </Bar>
                    <Line
                      dataKey="movingAvg"
                      stroke="var(--text-secondary)"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div className="hint" style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, marginTop: 10 }}>
                <LegendKey kind="bar" label="월 배당" />
                {monthlyDividendChart.some((r) => r.isPartial) && <LegendKey kind="partial" label="진행 중인 달" />}
                {monthlyDividendChart.some((r) => r.movingAvg != null) && <LegendKey kind="line" label="3개월 이동평균" />}
              </div>

              <details style={{ marginTop: 14 }}>
                <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>
                  정확한 월별 숫자 보기
                </summary>
                <table className="data-table compact" style={{ marginTop: 12 }}>
                  <thead>
                    <tr>
                      <th>월</th>
                      <th>총액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyDividendTotal.map((row) => (
                      <tr key={row.month}>
                        <td style={{ fontWeight: 500 }}>{row.month}</td>
                        <td className="number positive" style={{ fontWeight: 600, fontSize: 15 }}>
                          {formatKRW(Math.round(row.total))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          )}
        </div>
      )}

      {tab === "interest" && (
        <details style={{ marginBottom: 16 }}>
          <summary style={{ cursor: "pointer", fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
            월별 이자 합계
          </summary>
          <table className="data-table compact" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>월</th>
                <th>이자 합계</th>
              </tr>
            </thead>
            <tbody>
              {monthlyInterestTotal.map((row) => (
                <tr key={row.month}>
                  <td style={{ fontWeight: 500 }}>{row.month}</td>
                  <td className="number positive" style={{ fontWeight: 600, fontSize: 15 }}>
                    {formatKRW(Math.round(row.total))}
                  </td>
                </tr>
              ))}
              {monthlyInterestTotal.length === 0 && (
                <tr>
                  <td colSpan={2} style={{ textAlign: "center" }}>
                    이자 내역이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </details>
      )}
    </>
  );
});
