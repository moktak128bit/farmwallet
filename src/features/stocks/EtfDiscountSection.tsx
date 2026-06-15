/**
 * ETF 괴리율 스캔 섹션 — 한국 ETF 전 종목의 시장가 vs NAV 괴리율을 받아 저평가 순으로 보여준다.
 * 시세 갱신과 독립된 on-demand 호출(버튼). 데이터는 컴포넌트 상태에만 보관(영속화 안 함 — 실시간 시세).
 * NAV는 네이버 제공(전일/지연 기준)으로 장중 실시간 iNAV가 아님 — 헤더에 명시.
 */
import React, { useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { fetchKoreanEtfDiscounts } from "../../yahooFinanceApi";
import { filterDiscountedEtfs, type EtfDiscountRow } from "../../utils/etfDiscount";

const VOLUME_PRESETS: { label: string; value: number }[] = [
  { label: "전체", value: 0 },
  { label: "1만주↑", value: 10_000 },
  { label: "10만주↑", value: 100_000 },
];

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");
const fmtGap = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
// 괴리율 색: 음수(시장가<NAV=저평가)는 파랑(아래), 양수(프리미엄)는 빨강(위) — 국내 색 관례
const gapColor = (g: number) => (g < -0.01 ? "var(--accent)" : g > 0.01 ? "var(--danger)" : "var(--text-muted)");

export const EtfDiscountSection: React.FC = () => {
  const [rows, setRows] = useState<EtfDiscountRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [discountOnly, setDiscountOnly] = useState(true);
  const [minVolume, setMinVolume] = useState(0);

  const load = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchKoreanEtfDiscounts();
      setRows(data);
      setLoadedAt(new Date().toLocaleTimeString("ko-KR"));
      if (data.length === 0) toast("불러온 ETF가 없습니다. 잠시 후 다시 시도해 주세요.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ETF 목록 불러오기에 실패했습니다.";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // 표시 대상 — 저평가만/전체 + 거래량 필터, 상위 100개만(가독성·성능)
  const display = useMemo(() => {
    if (!rows) return [];
    const base = discountOnly
      ? filterDiscountedEtfs(rows, { minVolume })
      : rows.filter((r) => r.volume >= minVolume);
    return base.slice(0, 100);
  }, [rows, discountOnly, minVolume]);

  const discountCount = useMemo(
    () => (rows ? rows.filter((r) => r.gapPct < 0).length : 0),
    [rows]
  );

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="card-title" style={{ margin: 0 }}>ETF 괴리율 스캔 (저평가 찾기)</div>
          <div className="hint" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>
            괴리율 = (시장가 − NAV) / NAV. <strong style={{ color: "var(--accent)" }}>음수=저평가(할인)</strong>,
            양수=프리미엄. NAV는 네이버 제공(전일·지연 기준)이라 장중 실시간 iNAV와 다를 수 있습니다.
          </div>
        </div>
        <button type="button" className="primary" onClick={load} disabled={loading} style={{ whiteSpace: "nowrap" }}>
          {loading ? "불러오는 중…" : rows ? "새로고침" : "ETF 스캔 불러오기"}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--danger-light)", borderRadius: 8, color: "var(--danger)", fontSize: 13 }}>
          {error}
        </div>
      )}

      {rows && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 12, fontSize: 13 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input type="checkbox" checked={discountOnly} onChange={(e) => setDiscountOnly(e.target.checked)} />
              저평가만 (괴리율 ≤ 0)
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="hint" style={{ fontSize: 12 }}>거래량</span>
              {VOLUME_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className={minVolume === p.value ? "primary" : "secondary"}
                  onClick={() => setMinVolume(p.value)}
                  style={{ fontSize: 12, padding: "3px 10px" }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <span className="hint" style={{ fontSize: 12, marginLeft: "auto" }}>
              전체 {rows.length}종목 · 저평가 {discountCount}종목{loadedAt ? ` · ${loadedAt} 기준` : ""}
            </span>
          </div>

          {display.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-faint)", fontSize: 14 }}>
              조건에 맞는 ETF가 없습니다.
            </div>
          ) : (
            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table className="data-table" style={{ width: "100%", minWidth: 560 }}>
                <thead>
                  <tr>
                    <th style={{ width: 36, textAlign: "right" }}>#</th>
                    <th>종목</th>
                    <th style={{ textAlign: "right" }}>현재가</th>
                    <th style={{ textAlign: "right" }}>NAV</th>
                    <th style={{ textAlign: "right" }}>괴리율</th>
                    <th style={{ textAlign: "right" }}>등락률</th>
                    <th style={{ textAlign: "right" }}>거래량</th>
                  </tr>
                </thead>
                <tbody>
                  {display.map((r, i) => (
                    <tr key={r.code}>
                      <td style={{ textAlign: "right", color: "var(--text-faint)", fontSize: 12 }}>{i + 1}</td>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                        <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{r.code}</div>
                      </td>
                      <td style={{ textAlign: "right" }}>{fmt(r.price)}</td>
                      <td style={{ textAlign: "right", color: "var(--text-muted)" }}>{fmt(r.nav)}</td>
                      <td style={{ textAlign: "right", fontWeight: 700, color: gapColor(r.gapPct) }}>
                        {fmtGap(r.gapPct)}
                        {r.gapPct < 0 && (
                          <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "var(--accent)", border: "1px solid var(--accent)", borderRadius: 6, padding: "0 4px" }}>저평가</span>
                        )}
                      </td>
                      <td style={{ textAlign: "right", color: r.changeRate < 0 ? "var(--accent)" : r.changeRate > 0 ? "var(--danger)" : "var(--text-muted)" }}>
                        {fmtGap(r.changeRate)}
                      </td>
                      <td style={{ textAlign: "right", color: "var(--text-muted)", fontSize: 12 }}>{fmt(r.volume)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {display.length >= 100 && (
                <div className="hint" style={{ fontSize: 12, textAlign: "center", marginTop: 8 }}>
                  상위 100종목만 표시합니다 (괴리율 낮은 순).
                </div>
              )}
            </div>
          )}
        </>
      )}

      {!rows && !error && (
        <div style={{ padding: 20, textAlign: "center", color: "var(--text-faint)", fontSize: 13, marginTop: 8 }}>
          버튼을 눌러 한국 ETF 전 종목의 괴리율을 스캔하세요.
        </div>
      )}
    </div>
  );
};
