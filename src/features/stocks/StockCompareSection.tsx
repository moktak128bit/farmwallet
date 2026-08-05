/**
 * 종목 비교 — 여러 종목의 일별 종가를 공통 시작일=1 배수로 정규화해 한 차트에 겹쳐 본다.
 * 기간 프리셋(6개월~5년) + "최대 공통기간"(각 종목 전체 이력을 받아 가장 늦게 상장한
 * 종목의 첫 거래일부터 비교). 데이터는 컴포넌트 상태에만 보관(조회 전용, AppData 무변경).
 * 차트 애니메이션 끔(사용자 선호).
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { StockTrade, TickerInfo } from "../../types";
import { fetchStockLookup } from "../../yahooFinanceApi";
import type { StockLookupData } from "../../utils/stockLookup";
import {
  buildCompareRows,
  downsampleRows,
  latestMultiple,
  type CompareSeries
} from "../../utils/stockCompare";
import { searchLookupTargets, type LookupTarget } from "../../utils/lookupSearch";
import {
  canonicalTickerForMatch,
  cleanTicker,
  getCurrentHoldingsTickers,
  isKRWStock,
  isUSDStock
} from "../../utils/finance";
import { displayNameForTicker } from "../../utils/stockHelpers";

interface Props {
  tickerDatabase: TickerInfo[];
  trades: StockTrade[];
}

interface Selection {
  target: LookupTarget;
  /** 추가 시점에 배정되는 색 슬롯 — 다른 종목을 빼도 유지(색=종목 고정) */
  colorIdx: number;
}

const RANGES: Array<{ key: string; label: string }> = [
  { key: "6mo", label: "6개월" },
  { key: "1y", label: "1년" },
  { key: "2y", label: "2년" },
  { key: "5y", label: "5년" }
];
/** "최대 공통기간" — 전체 이력을 받아 공통 구간으로 자른다 */
const RANGE_COMMON = "max";

const MAX_COMPARE = 6;
const MAX_RESULTS = 12;
const MAX_CHART_POINTS = 600;
const MAX_HOLDING_CHIPS = 12;

// 시리즈 식별 색 — 라이트/다크 공용 (TargetPortfolioSection CHART_COLORS와 같은 방식)
const COMPARE_COLORS = ["#2563eb", "#dc2626", "#059669", "#7c3aed", "#d97706", "#0891b2"];

const pillStyle = (active: boolean): React.CSSProperties => ({
  fontSize: 12,
  padding: "4px 12px",
  borderRadius: 14,
  border: "1px solid var(--border)",
  background: active ? "var(--primary-light, var(--surface))" : "var(--surface)",
  color: active ? "var(--primary, var(--text))" : "var(--text-muted)",
  fontWeight: active ? 700 : 400,
  cursor: "pointer"
});

export const StockCompareSection: React.FC<Props> = ({ tickerDatabase, trades }) => {
  const [query, setQuery] = useState("");
  const [selections, setSelections] = useState<Selection[]>([]);
  const [range, setRange] = useState("1y");
  const [logScale, setLogScale] = useState(false);
  // 캐시: `${ticker}|${range}` → 데이터(null = 실패). 버전 카운터로 재계산 트리거.
  const cacheRef = useRef(new Map<string, StockLookupData | null>());
  const inFlightRef = useRef(new Set<string>());
  const [cacheVersion, setCacheVersion] = useState(0);

  const cacheKey = (ticker: string) => `${ticker}|${range}`;

  const results = useMemo(
    () => searchLookupTargets(query, tickerDatabase, MAX_RESULTS),
    [query, tickerDatabase]
  );

  // 보유 종목 빠른 추가 (야후 조회 가능한 주식만 — 코인 제외)
  const holdingTargets = useMemo((): LookupTarget[] => {
    const infoByCanonical = new Map(tickerDatabase.map((t) => [canonicalTickerForMatch(t.ticker), t]));
    return getCurrentHoldingsTickers(trades)
      .filter((t) => isKRWStock(t) || isUSDStock(t))
      .slice(0, MAX_HOLDING_CHIPS)
      .map((t) => {
        const info = infoByCanonical.get(canonicalTickerForMatch(t));
        return {
          ticker: cleanTicker(t),
          name: info?.name ?? "",
          market: isKRWStock(t) ? ("KR" as const) : ("US" as const),
          exchange: info?.exchange
        };
      });
  }, [trades, tickerDatabase]);

  const addTarget = (target: LookupTarget) => {
    setSelections((prev) => {
      if (prev.length >= MAX_COMPARE) return prev;
      if (prev.some((s) => s.target.ticker === target.ticker)) return prev;
      const used = new Set(prev.map((s) => s.colorIdx));
      let colorIdx = 0;
      while (used.has(colorIdx)) colorIdx++;
      return [...prev, { target, colorIdx }];
    });
    setQuery("");
  };

  const removeTarget = (ticker: string) => {
    setSelections((prev) => prev.filter((s) => s.target.ticker !== ticker));
  };

  // 선택·기간 변경 시 캐시에 없고 요청 중도 아닌 종목만 가져온다 (실패는 null로 기록 → 재시도 버튼으로만 갱신).
  // fetch 완료는 cleanup과 무관하게 항상 캐시에 반영 — cacheRef/inFlightRef는 ref라 언마운트 후에도 무해.
  useEffect(() => {
    const missing = selections.filter((s) => {
      const key = cacheKey(s.target.ticker);
      return !cacheRef.current.has(key) && !inFlightRef.current.has(key);
    });
    for (const sel of missing) {
      const key = cacheKey(sel.target.ticker);
      inFlightRef.current.add(key);
      void fetchStockLookup(sel.target.ticker, range, sel.target.exchange)
        .then((result) => {
          cacheRef.current.set(key, result && result.closes.length > 0 ? result : null);
        })
        .catch(() => {
          cacheRef.current.set(key, null);
        })
        .finally(() => {
          inFlightRef.current.delete(key);
          setCacheVersion((v) => v + 1);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selections, range, cacheVersion]);

  // 현재 기간 기준으로 아직 캐시에 없는 선택이 있으면 로딩 중 (완료마다 cacheVersion이 올라 재평가됨)
  const loading = selections.some((s) => !cacheRef.current.has(cacheKey(s.target.ticker)));
  const doneCount = selections.length - selections.filter((s) => !cacheRef.current.has(cacheKey(s.target.ticker))).length;

  const failedTickers = useMemo(
    () => selections.filter((s) => cacheRef.current.get(cacheKey(s.target.ticker)) === null).map((s) => s.target.ticker),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selections, range, cacheVersion]
  );

  const compare = useMemo(() => {
    if (loading) return { rows: [], bases: {}, commonStart: null } as ReturnType<typeof buildCompareRows>;
    const seriesList: CompareSeries[] = [];
    for (const s of selections) {
      const data = cacheRef.current.get(cacheKey(s.target.ticker));
      if (data && data.closes.length > 0) seriesList.push({ ticker: s.target.ticker, closes: data.closes });
    }
    return buildCompareRows(seriesList);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selections, range, cacheVersion, loading]);

  const chartRows = useMemo(() => downsampleRows(compare.rows, MAX_CHART_POINTS), [compare.rows]);

  const retryFailed = () => {
    for (const t of failedTickers) cacheRef.current.delete(cacheKey(t));
    setCacheVersion((v) => v + 1);
  };

  const chipName = (sel: Selection): string => {
    const cached = cacheRef.current.get(cacheKey(sel.target.ticker));
    return displayNameForTicker(sel.target.ticker, sel.target.name || cached?.meta.name);
  };

  const fmtMult = (v: number): string => `${v.toFixed(v >= 100 ? 1 : 2)}×`;
  const fmtPct = (m: number): string => {
    const pct = (m - 1) * 100;
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  };

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
        <div>
          <div className="card-title" style={{ marginBottom: 4 }}>종목 비교</div>
          <div className="hint" style={{ fontSize: 13 }}>
            선택한 종목들을 공통 시작일 = 1 배수로 정규화해 겹쳐 봅니다. 종가 기준(배당 재투자 미반영) · Yahoo Finance
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {RANGES.map((r) => (
            <button key={r.key} type="button" onClick={() => setRange(r.key)} style={pillStyle(range === r.key)}>
              {r.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setRange(RANGE_COMMON)}
            style={pillStyle(range === RANGE_COMMON)}
            title="각 종목의 전체 이력을 받아, 가장 늦게 상장한 종목의 첫 거래일부터 비교합니다"
          >
            최대 공통기간
          </button>
        </div>
      </div>

      {/* 종목 검색 */}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results.length > 0) {
            e.preventDefault();
            addTarget(results[0]);
          }
        }}
        placeholder={
          selections.length >= MAX_COMPARE
            ? `최대 ${MAX_COMPARE}종목까지 비교할 수 있습니다 — 먼저 하나를 제거하세요`
            : "비교할 종목 추가 — 종목명 또는 티커 검색 (예: QQQ, 삼성전자)"
        }
        disabled={selections.length >= MAX_COMPARE}
        style={{ width: "100%", padding: "10px 12px", fontSize: 14 }}
      />
      {results.length > 0 && selections.length < MAX_COMPARE && (
        <div className="card" style={{ marginTop: 6, padding: 4, maxHeight: 220, overflowY: "auto" }}>
          {results.map((r) => {
            const already = selections.some((s) => s.target.ticker === r.ticker);
            return (
              <button
                key={`${r.market}-${r.ticker}`}
                type="button"
                onClick={() => !already && addTarget(r)}
                disabled={already}
                style={{
                  display: "flex",
                  width: "100%",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "8px 10px",
                  background: "none",
                  border: "none",
                  borderRadius: 6,
                  cursor: already ? "default" : "pointer",
                  textAlign: "left",
                  opacity: already ? 0.45 : 1
                }}
                onMouseEnter={(e) => {
                  if (!already) e.currentTarget.style.backgroundColor = "var(--surface-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <span style={{ fontSize: 14 }}>
                  <strong>{r.ticker}</strong>
                  <span style={{ marginLeft: 8, color: "var(--text-muted)" }}>
                    {already ? "이미 추가됨" : r.name || "이 티커로 직접 추가"}
                  </span>
                </span>
                <span className="pill" style={{ fontSize: 11 }}>
                  {r.market === "KR" ? (r.exchange ?? "국내") : "미국"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* 보유 종목 빠른 추가 */}
      {holdingTargets.some((t) => !selections.some((s) => s.target.ticker === t.ticker)) &&
        selections.length < MAX_COMPARE && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <span className="hint" style={{ fontSize: 12 }}>보유 종목:</span>
            {holdingTargets
              .filter((t) => !selections.some((s) => s.target.ticker === t.ticker))
              .map((t) => (
                <button
                  key={t.ticker}
                  type="button"
                  onClick={() => addTarget(t)}
                  style={{ ...pillStyle(false), padding: "2px 10px" }}
                >
                  + {t.ticker}
                </button>
              ))}
          </div>
        )}

      {/* 선택 종목 칩 (색 = 차트 시리즈 색, 범례 역할) */}
      {selections.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0 4px" }}>
          {selections.map((sel) => {
            const m = latestMultiple(compare.rows, sel.target.ticker);
            const failed = failedTickers.includes(sel.target.ticker);
            const cached = cacheRef.current.get(cacheKey(sel.target.ticker));
            const stale = cached?.meta.stale;
            // 국내 관례: 상승=빨강, 하락=파랑
            const pctColor = m == null ? "var(--text-muted)" : m >= 1 ? "var(--danger)" : "var(--accent)";
            const name = chipName(sel);
            const rangeTitle = cached?.closes.length
              ? `${cached.closes[0].date} ~ ${cached.closes[cached.closes.length - 1].date} · ${cached.closes.length.toLocaleString("ko-KR")}거래일`
              : undefined;
            return (
              <span
                key={sel.target.ticker}
                title={rangeTitle}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  borderRadius: 14,
                  border: "1px solid var(--border)",
                  background: "var(--surface)",
                  fontSize: 13
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: COMPARE_COLORS[sel.colorIdx],
                    flex: "none"
                  }}
                />
                <strong>{sel.target.ticker}</strong>
                {name && name !== sel.target.ticker && (
                  <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{name}</span>
                )}
                {failed && <span style={{ color: "var(--danger)", fontSize: 12 }}>조회 실패</span>}
                {stale && <span style={{ color: "var(--warning)", fontSize: 12 }}>거래정지 추정</span>}
                {m != null && (
                  <span style={{ fontWeight: 700, color: pctColor }}>
                    {fmtMult(m)} ({fmtPct(m)})
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeTarget(sel.target.ticker)}
                  aria-label={`${sel.target.ticker} 제거`}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--text-muted)",
                    fontSize: 14,
                    padding: "0 2px",
                    lineHeight: 1
                  }}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}

      {failedTickers.length > 0 && !loading && (
        <div
          style={{
            margin: "8px 0",
            padding: "8px 12px",
            background: "var(--danger-light)",
            borderRadius: 8,
            color: "var(--danger)",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap"
          }}
        >
          <span>{failedTickers.join(", ")} 데이터를 불러오지 못했습니다.</span>
          <button type="button" className="secondary" style={{ fontSize: 12, padding: "2px 10px" }} onClick={retryFailed}>
            다시 시도
          </button>
        </div>
      )}

      {/* 차트 */}
      {selections.length === 0 ? (
        <p className="hint" style={{ textAlign: "center", padding: "48px 0" }}>
          비교할 종목을 추가하세요. 예: QQQ · QLD · TQQQ를 넣고 &ldquo;최대 공통기간&rdquo;을 눌러보세요.
        </p>
      ) : loading ? (
        <div style={{ maxWidth: 560, margin: "0 auto", padding: "40px 16px 48px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              시세 이력 불러오는 중… {doneCount}/{selections.length}
            </span>
            <span className="hint" style={{ fontSize: 12 }}>
              {range === RANGE_COMMON ? "전체 이력 (상장 이후 전부)" : RANGES.find((r) => r.key === range)?.label}
            </span>
          </div>
          <div className="compare-progress-track" style={{ marginBottom: 16 }}>
            <div
              className="compare-progress-fill compare-progress-fill--active"
              style={{ width: `${Math.max(8, (doneCount / Math.max(1, selections.length)) * 100)}%` }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {selections.map((sel) => {
              const key = cacheKey(sel.target.ticker);
              const done = cacheRef.current.has(key);
              const data = cacheRef.current.get(key);
              const name = chipName(sel);
              return (
                <div key={sel.target.ticker} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                  <span
                    aria-hidden
                    style={{ width: 10, height: 10, borderRadius: "50%", background: COMPARE_COLORS[sel.colorIdx], flex: "none" }}
                  />
                  <strong style={{ minWidth: 52 }}>{sel.target.ticker}</strong>
                  {name && name !== sel.target.ticker && (
                    <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{name}</span>
                  )}
                  <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 12 }}>
                    {!done ? (
                      <>
                        <span className="compare-row-spinner" aria-hidden />
                        불러오는 중…
                      </>
                    ) : data ? (
                      <span>
                        <strong style={{ color: "var(--text)" }}>{data.closes[0]?.date}</strong>부터 ·{" "}
                        {data.closes.length.toLocaleString("ko-KR")}거래일 ✓
                      </span>
                    ) : (
                      <span style={{ color: "var(--danger)" }}>실패</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : chartRows.length < 2 ? (
        failedTickers.length < selections.length && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 320, color: "var(--text-muted)" }}>
            표시할 데이터가 부족합니다.
          </div>
        )
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, margin: "6px 0 4px" }}>
            <span className="hint" style={{ fontSize: 12 }}>
              기준일 {compare.commonStart} = 1 · {compare.rows.length.toLocaleString("ko-KR")}거래일
              {range === RANGE_COMMON && " · 최대 공통기간(가장 늦게 상장한 종목의 첫 거래일부터)"}
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={() => setLogScale(false)} style={pillStyle(!logScale)}>
                선형
              </button>
              <button type="button" onClick={() => setLogScale(true)} style={pillStyle(logScale)}>
                로그
              </button>
            </div>
          </div>
          <div style={{ width: "100%", height: 340 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartRows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d: string) => (typeof d === "string" ? d.slice(2, 7) : d)}
                  tick={{ fontSize: 11 }}
                  minTickGap={32}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  width={56}
                  scale={logScale ? "log" : "auto"}
                  domain={["auto", "auto"]}
                  tickFormatter={(v: number) => `${Number(Number(v).toFixed(2))}×`}
                />
                <Tooltip
                  labelFormatter={(d) => String(d)}
                  formatter={(value: number | string | undefined, name: string | undefined) => [
                    typeof value === "number" ? `${fmtMult(value)} (${fmtPct(value)})` : "-",
                    name ?? ""
                  ]}
                  contentStyle={{ fontSize: 13, fontWeight: 600 }}
                />
                <ReferenceLine y={1} stroke="var(--text-faint, #94a3b8)" strokeDasharray="4 4" />
                {selections.map((sel) =>
                  compare.bases[sel.target.ticker] ? (
                    <Line
                      key={sel.target.ticker}
                      type="monotone"
                      dataKey={sel.target.ticker}
                      name={sel.target.ticker}
                      stroke={COMPARE_COLORS[sel.colorIdx]}
                      strokeWidth={2}
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ) : null
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="hint" style={{ fontSize: 11, marginTop: 6 }}>
            ⓘ 통화가 달라도 배수라 직접 비교됩니다. 휴장일이 다른 시장(국내·미국)은 빈 날을 선으로 잇습니다.
            기준일이 달라지면 교차 지점도 달라집니다 — 시작일의 산물임에 유의하세요.
          </p>
        </>
      )}
    </div>
  );
};
