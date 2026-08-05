import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { TickerInfo } from "../../types";
import { fetchStockLookup } from "../../yahooFinanceApi";
import { buildLookupSummary, type StockLookupData } from "../../utils/stockLookup";
import { isKRWStock } from "../../utils/finance";
import { searchLookupTargets, type LookupTarget } from "../../utils/lookupSearch";
import { displayNameForTicker } from "../../utils/stockHelpers";
import { formatKRW } from "../../utils/formatter";
import { getTodayKST } from "../../utils/date";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useModalStackEntry } from "../../utils/modalStack";

/**
 * 종목 조회 모달 — 보유 여부와 무관하게 종목을 검색해 과거 주가 추이·배당 이력을 조회.
 * 데이터는 컴포넌트 상태에만 보관(영속화 안 함 — 조회 전용, AppData 무변경).
 */

interface Props {
  tickerDatabase: TickerInfo[];
  onClose: () => void;
}

const RANGES: Array<{ key: string; label: string }> = [
  { key: "6mo", label: "6개월" },
  { key: "1y", label: "1년" },
  { key: "2y", label: "2년" },
  { key: "5y", label: "5년" },
  { key: "max", label: "전체" }
];

const MAX_RESULTS = 20;
const MAX_CHART_POINTS = 600;
const MAX_DIVIDEND_ROWS = 40;

export const StockLookupModal: React.FC<Props> = ({ tickerDatabase, onClose }) => {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<LookupTarget | null>(null);
  const [range, setRange] = useState("1y");
  const [data, setData] = useState<StockLookupData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef(new Map<string, StockLookupData>());
  const reqIdRef = useRef(0);

  const modalRef = useFocusTrap<HTMLDivElement>(true);
  const isTopModal = useModalStackEntry(true);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 모달 중첩 시 최상위 모달만 ESC로 닫힘
      if (e.key === "Escape" && isTopModal()) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, isTopModal]);

  // 로컬 검색: 티커DB(이름·코드) + 전체 상장 한글명(krNames) + 티커 직접 입력
  const results = useMemo(
    () => searchLookupTargets(query, tickerDatabase, MAX_RESULTS),
    [query, tickerDatabase]
  );

  const handleSelect = (target: LookupTarget) => {
    setSelected(target);
    setQuery("");
  };

  useEffect(() => {
    if (!selected) return;
    // 캐시 히트 포함 매번 reqId를 올려 이전 in-flight 응답이 현재 화면을 덮어쓰지 못하게 한다
    const reqId = ++reqIdRef.current;
    const key = `${selected.ticker}|${range}`;
    const cached = cacheRef.current.get(key);
    if (cached) {
      setData(cached);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setData(null);
    void fetchStockLookup(selected.ticker, range, selected.exchange)
      .then((result) => {
        if (reqIdRef.current !== reqId) return; // stale 응답 폐기
        if (!result) {
          setError("데이터를 불러오지 못했습니다. 티커를 확인하거나 잠시 후 다시 시도하세요.");
          return;
        }
        cacheRef.current.set(key, result);
        setData(result);
      })
      .catch(() => {
        if (reqIdRef.current === reqId) setError("조회 중 오류가 발생했습니다.");
      })
      .finally(() => {
        if (reqIdRef.current === reqId) setLoading(false);
      });
  }, [selected, range]);

  const summary = useMemo(
    () => (data ? buildLookupSummary(data, getTodayKST(), data.meta.price) : null),
    [data]
  );

  // 장기 구간은 포인트 수를 줄여 렌더 부담 완화 (마지막 점은 항상 유지)
  const chartRows = useMemo(() => {
    if (!data) return [];
    const closes = data.closes;
    if (closes.length <= MAX_CHART_POINTS) return closes;
    const step = Math.ceil(closes.length / MAX_CHART_POINTS);
    return closes.filter((_, i) => i % step === 0 || i === closes.length - 1);
  }, [data]);

  const currency = data?.meta.currency ?? (selected && isKRWStock(selected.ticker) ? "KRW" : "USD");
  const fmtPrice = (v: number): string =>
    currency === "KRW"
      ? formatKRW(Math.round(v))
      : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDividend = (v: number): string =>
    currency === "KRW"
      ? formatKRW(Math.round(v))
      : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

  const displayName = selected
    ? displayNameForTicker(selected.ticker, selected.name || data?.meta.name)
    : "";
  const currentPrice = data?.meta.price ?? summary?.lastClose ?? null;
  // 국내 관례: 상승=빨강, 하락=파랑
  const changeColor =
    summary?.rangeChangePct == null
      ? "var(--text)"
      : summary.rangeChangePct >= 0
        ? "var(--danger)"
        : "var(--accent)";
  const recentDividends = data ? [...data.dividends].reverse() : [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="종목 조회"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "900px", width: "90vw", maxHeight: "90vh", overflow: "auto" }}
      >
        <div className="modal-header">
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>종목 조회</h2>
            <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "var(--text-muted)" }}>
              보유하지 않은 종목도 과거 주가·배당 이력을 확인할 수 있습니다.
            </p>
          </div>
          <button type="button" className="secondary" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="modal-body">
          {/* 검색 */}
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results.length > 0) {
                e.preventDefault();
                handleSelect(results[0]);
              }
            }}
            placeholder="종목명 또는 티커 검색 (예: 삼성전자, 005930, SCHD)"
            autoFocus
            style={{ width: "100%", padding: "10px 12px", fontSize: 14 }}
          />
          {results.length > 0 && (
            <div
              className="card"
              style={{ marginTop: 6, padding: 4, maxHeight: 260, overflowY: "auto" }}
            >
              {results.map((r) => (
                <button
                  key={`${r.market}-${r.ticker}`}
                  type="button"
                  onClick={() => handleSelect(r)}
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
                    cursor: "pointer",
                    textAlign: "left"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--surface-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                  }}
                >
                  <span style={{ fontSize: 14 }}>
                    <strong>{r.ticker}</strong>
                    <span style={{ marginLeft: 8, color: "var(--text-muted)" }}>
                      {r.name || "이 티커로 직접 조회"}
                    </span>
                  </span>
                  <span className="pill" style={{ fontSize: 11 }}>
                    {r.market === "KR" ? (r.exchange ?? "국내") : "미국"}
                  </span>
                </button>
              ))}
            </div>
          )}

          {query.trim() !== "" && results.length === 0 && (
            <p className="hint" style={{ marginTop: 6 }}>
              &ldquo;{query.trim()}&rdquo; 검색 결과가 없습니다. 종목명 일부(예: 삼성)나 티커로 검색해 보세요.
            </p>
          )}

          {!selected && query.trim() === "" && (
            <p className="hint" style={{ textAlign: "center", padding: "40px 0" }}>
              종목을 검색해 주가 추이와 배당 이력을 확인하세요.
            </p>
          )}

          {selected && (
            <div style={{ marginTop: 16 }}>
              {/* 선택 종목 헤더 + 기간 선택 */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  flexWrap: "wrap",
                  marginBottom: 12
                }}
              >
                <div>
                  <span style={{ fontSize: 18, fontWeight: 700 }}>{selected.ticker}</span>
                  {displayName && displayName !== selected.ticker && (
                    <span style={{ marginLeft: 8, fontSize: 14, color: "var(--text-muted)" }}>
                      {displayName}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {RANGES.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => setRange(r.key)}
                      style={{
                        fontSize: 12,
                        padding: "4px 12px",
                        borderRadius: 14,
                        border: "1px solid var(--border)",
                        background: range === r.key ? "var(--primary-light, var(--surface))" : "var(--surface)",
                        color: range === r.key ? "var(--primary, var(--text))" : "var(--text-muted)",
                        fontWeight: range === r.key ? 700 : 400,
                        cursor: "pointer"
                      }}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: "10px 14px",
                    background: "var(--danger-light)",
                    borderRadius: 8,
                    color: "var(--danger)",
                    fontSize: 13
                  }}
                >
                  {error}
                </div>
              )}

              {data?.meta.stale && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: "10px 14px",
                    background: "var(--warning-light)",
                    borderRadius: 8,
                    color: "var(--warning)",
                    fontSize: 13
                  }}
                >
                  거래정지/상장폐지 추정 종목입니다 — 마지막 거래일(
                  {data.closes[data.closes.length - 1]?.date}) 기준 가격이 표시됩니다.
                </div>
              )}

              {/* 요약 통계 */}
              {summary && data && (
                <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                      gap: 12
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>현재가</div>
                      <div style={{ fontSize: 16, fontWeight: 600 }}>
                        {currentPrice != null ? fmtPrice(currentPrice) : "-"}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                        기간 수익률 ({RANGES.find((r) => r.key === range)?.label})
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: changeColor }}>
                        {summary.rangeChangePct != null
                          ? `${summary.rangeChangePct >= 0 ? "+" : ""}${summary.rangeChangePct.toFixed(1)}%`
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                        {summary.ttmCoversFullYear ? "52주 최고/최저" : "조회구간 최고/최저"}
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>
                        {summary.high52w != null && summary.low52w != null
                          ? `${fmtPrice(summary.high52w)} / ${fmtPrice(summary.low52w)}`
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                        최근 1년 주당 배당{!summary.ttmCoversFullYear && " *"}
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 600 }}>
                        {summary.ttmDividend > 0
                          ? `${fmtDividend(summary.ttmDividend)} (${summary.ttmDividendCount}회)`
                          : "-"}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                        배당수익률(TTM){!summary.ttmCoversFullYear && " *"}
                      </div>
                      <div style={{ fontSize: 16, fontWeight: 600, color: "var(--success)" }}>
                        {summary.ttmYieldPct != null ? `${summary.ttmYieldPct.toFixed(2)}%` : "-"}
                      </div>
                    </div>
                  </div>
                  {!summary.ttmCoversFullYear && (
                    <p className="hint" style={{ margin: "10px 0 0 0" }}>
                      {range === "6mo"
                        ? "* 조회 구간이 1년 미만이라 실제 연간 배당보다 적게 표시될 수 있습니다. (기간을 1년 이상으로 선택)"
                        : "* 데이터 제공(상장) 기간이 1년 미만이라 연간 배당·배당수익률이 실제보다 적을 수 있습니다."}
                    </p>
                  )}
                </div>
              )}

              {/* 주가 차트 */}
              <div style={{ width: "100%", height: 300 }}>
                {loading ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      height: "100%",
                      color: "var(--text-muted)"
                    }}
                  >
                    불러오는 중…
                  </div>
                ) : chartRows.length < 2 ? (
                  !error && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        height: "100%",
                        color: "var(--text-muted)"
                      }}
                    >
                      표시할 주가 데이터가 없습니다.
                    </div>
                  )
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartRows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(d: string) => d.slice(2, 7)}
                        tick={{ fontSize: 11 }}
                        minTickGap={32}
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        domain={["auto", "auto"]}
                        width={70}
                        tickFormatter={(v: number) => Number(v).toLocaleString("ko-KR")}
                      />
                      <Tooltip
                        formatter={(value: number | string | undefined) => [
                          typeof value === "number" ? fmtPrice(value) : (value ?? "-"),
                          "종가"
                        ]}
                        contentStyle={{ fontSize: 13, fontWeight: 600 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="close"
                        stroke={changeColor}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* 배당 이력 */}
              {data && !loading && (
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ marginTop: 0, marginBottom: 8 }}>배당 이력</h3>
                  {data.dividends.length === 0 ? (
                    <p className="hint" style={{ padding: "8px 0" }}>
                      조회 구간에 배당 지급 이력이 없습니다. (기간을 늘려보세요)
                    </p>
                  ) : (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                        gap: 16,
                        alignItems: "start"
                      }}
                    >
                      <div style={{ overflowX: "auto" }}>
                        <table className="data-table" style={{ width: "100%" }}>
                          <thead>
                            <tr>
                              <th>연도</th>
                              <th style={{ textAlign: "right" }}>횟수</th>
                              <th style={{ textAlign: "right" }}>주당 합계</th>
                            </tr>
                          </thead>
                          <tbody>
                            {summary?.dividendsByYear.map((y) => (
                              <tr key={y.year}>
                                <td>{y.year}{y.partial && " *"}</td>
                                <td style={{ textAlign: "right" }}>{y.count}회</td>
                                <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtDividend(y.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {summary?.dividendsByYear.some((y) => y.partial) && (
                          <p className="hint" style={{ marginTop: 6 }}>
                            * 조회 구간이 해당 연도 일부만 포함하거나 진행 중인 연도의 부분합입니다.
                          </p>
                        )}
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <table className="data-table" style={{ width: "100%" }}>
                          <thead>
                            <tr>
                              <th>배당락일</th>
                              <th style={{ textAlign: "right" }}>주당 배당금</th>
                            </tr>
                          </thead>
                          <tbody>
                            {recentDividends.slice(0, MAX_DIVIDEND_ROWS).map((d) => (
                              <tr key={d.date}>
                                <td>{d.date}</td>
                                <td style={{ textAlign: "right", fontWeight: 600 }}>{fmtDividend(d.amount)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {recentDividends.length > MAX_DIVIDEND_ROWS && (
                          <p className="hint" style={{ marginTop: 6 }}>
                            최근 {MAX_DIVIDEND_ROWS}건만 표시 (전체 {recentDividends.length}건)
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  <p className="hint" style={{ marginTop: 10 }}>
                    데이터: Yahoo Finance — 주당 세전 기준, 배당락일 기준. 국내 종목은 일부 이력이 누락될 수 있습니다.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
