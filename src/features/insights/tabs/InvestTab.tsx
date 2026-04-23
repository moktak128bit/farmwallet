import React from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { C, F, W, SD, Card, Kpi, Insight, Section, CT, pieLabel, type D } from "../insightsShared";

export const InvestTab = React.memo(function InvestTab({ d }: { d: D }) {
  const holdings = d.trades.map((v) => ({
    name: v.name.length > 20 ? v.name.slice(0, 20) + "…" : v.name,
    fullName: v.name,
    매수: v.buyTotal,
    매도: v.sellTotal,
    보유수량: v.buyCount - v.sellCount,
    실현손익: v.sellTotal - (v.sellCount > 0 ? SD(v.buyTotal, v.buyCount) * v.sellCount : 0),
  }));
  const holdOnly = holdings.filter((h) => h.보유수량 > 0);
  const closedPL = holdings.filter((h) => h.보유수량 === 0 && h.매도 > 0);
  const noSellHoldings = holdOnly.filter((h) => h.매도 === 0 && h.매수 > 500000);
  const totalInvested = holdOnly.reduce((s, h) => s + h.매수, 0);
  const totalDiv = d.divTrend.reduce((s, m) => s + m.amount, 0);
  const totalBuy = holdings.reduce((s, h) => s + h.매수, 0);
  const totalSell = holdings.reduce((s, h) => s + h.매도, 0);

  // 포트폴리오 집중도 (HHI)
  const hhi = totalInvested > 0 ? holdOnly.reduce((s, h) => s + Math.pow(h.매수 / totalInvested, 2), 0) : 0;
  const effectiveHoldings = hhi > 0 ? 1 / hhi : 0;
  const topShare = totalInvested > 0 && holdOnly[0] ? (holdOnly[0].매수 / totalInvested) * 100 : 0;

  // 승수 (수익:손실 배수)
  const avgWin = d.realPL.winCnt > 0 ? d.realPL.wins / d.realPL.winCnt : 0;
  const avgLoss = d.realPL.lossCnt > 0 ? d.realPL.losses / d.realPL.lossCnt : 0;
  const winLossRatio = avgLoss > 0 ? avgWin / avgLoss : null;
  const winRate = d.realPL.winCnt + d.realPL.lossCnt > 0
    ? (d.realPL.winCnt / (d.realPL.winCnt + d.realPL.lossCnt)) * 100
    : null;

  // 연환산 배당률 (기간 평균 투자원금 기준)
  const divYieldAnnualized = totalInvested > 0 && d.months.length > 0
    ? (totalDiv / totalInvested) * (12 / d.months.length) * 100
    : 0;

  // 매매 회전율 (연환산)
  const turnoverAnnualized = totalInvested > 0 && d.months.length > 0
    ? ((totalBuy + totalSell) / 2) / totalInvested * (12 / d.months.length)
    : 0;

  const periodLabel = d.months.length > 0 ? `${d.months[0]} ~ ${d.months[d.months.length - 1]}` : "-";

  return (
    <div>
      {/* 상단 배너 */}
      <div style={{ padding: "10px 14px", background: "#f8f9fa", borderRadius: 8, marginBottom: 16, fontSize: 12, color: "#666", lineHeight: 1.6 }}>
        ℹ️ 범위: <strong>{d.months.length}개월</strong> ({periodLabel}) · 단위: <strong>원</strong> · 매수/매도 기준 (현재 시가 평가는 대시보드 참조) · 실현손익·배당은 기간 내 체결 기준
      </div>

      {/* ============ 한눈에 ============ */}
      <Section storageKey="invest-section-overview" title="📊 한눈에 보기">
        <Card accent><Kpi label="총 매수금액 (보유)" value={F(totalInvested) + "원"} sub={`청산 포함 ${F(totalBuy)}원`} color="#f0c040" info="현재 보유 중인 종목의 매수금액 합 (매도 제외)" /></Card>
        <Card accent>
          <Kpi
            label="실현 손익"
            value={(d.realPL.total >= 0 ? "+" : "") + F(Math.round(d.realPL.total)) + "원"}
            sub={d.investReturnRate !== 0 ? `수익률 ${d.investReturnRate.toFixed(1)}%` : "매도 내역 없음"}
            color={d.realPL.total >= 0 ? "#48c9b0" : "#e94560"}
            info="청산 종목의 매도금액 − 비례 매수금액. 미실현 손익 제외"
          />
        </Card>
        <Card accent>
          <Kpi
            label="배당/이자 수입"
            value={F(totalDiv) + "원"}
            sub={totalInvested > 0 ? `연환산 배당률 ${divYieldAnnualized.toFixed(2)}%` : "투자 원금 없음"}
            color="#48c9b0"
            info="투자 계좌 배당·이자 수입 합 · 연환산 = (합/원금) × (12/개월수)"
          />
        </Card>
        <Card accent>
          <Kpi
            label="보유 종목 수"
            value={`${holdOnly.length}종목`}
            sub={`청산 ${closedPL.length} · 실효 ${effectiveHoldings.toFixed(1)}개`}
            color="#fff"
            info="실효 종목 수 = 1 / HHI — 한 종목에 몰릴수록 작아짐"
          />
        </Card>

        <Card title="보유 종목 (매수금액 기준)" span={2}>
          {holdOnly.length === 0 ? <div style={{ textAlign: "center", padding: 40, color: "#999" }}>보유 종목 없음</div> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={holdOnly.slice(0, 10)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis type="number" tickFormatter={F} tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" width={150} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} />
                <Bar dataKey="매수" fill="#0f3460" radius={[0, 6, 6, 0]} name="매수금액" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="포트폴리오 자산배분 (계좌별)" span={2}>
          {d.portfolio.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={d.portfolio} dataKey="value" cx="50%" cy="50%" outerRadius={100} innerRadius={45} label={pieLabel} labelLine={false} style={{ fontSize: 10 }}>
                  {d.portfolio.map((_, i) => <Cell key={i} fill={C[i]} />)}
                </Pie>
                <Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div style={{ textAlign: "center", padding: 40, color: "#999" }}>데이터 없음</div>}
        </Card>
      </Section>

      {/* ============ 포트폴리오 분산 ============ */}
      <Section storageKey="invest-section-diversification" title="🎯 포트폴리오 분산">
        <Card accent>
          <Kpi
            label="실효 종목 수"
            value={effectiveHoldings.toFixed(1) + "개"}
            sub={`실제 ${holdOnly.length}종목 · HHI ${(hhi * 100).toFixed(1)}`}
            color={effectiveHoldings >= 10 ? "#48c9b0" : effectiveHoldings >= 5 ? "#f0c040" : "#e94560"}
            info="1 / Σ(비중²). 같은 비율 N개면 N, 한 종목에 몰릴수록 작음. 10개↑ 권장"
          />
        </Card>
        <Card accent>
          <Kpi
            label="최대 종목 비중"
            value={topShare.toFixed(1) + "%"}
            sub={holdOnly[0]?.fullName ?? "-"}
            color={topShare > 50 ? "#e94560" : topShare > 30 ? "#f0c040" : "#48c9b0"}
            info="단일 종목 집중 위험 지표. 30% 이하 권장, 50% 초과면 집중 위험"
          />
        </Card>
        <Card accent>
          <Kpi
            label="매매 회전율 (연환산)"
            value={turnoverAnnualized.toFixed(2) + "x"}
            sub={`기간 거래 ${F(totalBuy + totalSell)}원`}
            color={turnoverAnnualized > 2 ? "#e94560" : turnoverAnnualized > 1 ? "#f0c040" : "#48c9b0"}
            info="연간 (매수+매도)/2 / 평균 원금. 1↓ 장기보유형, 2↑ 빈번 매매"
          />
        </Card>
        <Card accent>
          <Kpi
            label="매도 없는 종목"
            value={`${noSellHoldings.length}종목`}
            sub={`매수 50만원↑ · 총 ${F(noSellHoldings.reduce((s, h) => s + h.매수, 0))}원`}
            color={noSellHoldings.length > 5 ? "#e94560" : noSellHoldings.length > 2 ? "#f0c040" : "#48c9b0"}
            info="매수 후 한 번도 매도 안 한 종목 (50만원 이상만). 장기 보유 or 리밸런싱 검토 대상"
          />
        </Card>

        {noSellHoldings.length > 0 && (
          <Card title="매도 없는 종목 리스트" span={4}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
              {noSellHoldings.map((h, i) => (
                <div key={h.fullName} style={{ padding: "10px 14px", background: "#fff5f5", borderRadius: 8, border: "1px solid #fcc", fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontWeight: 700 }}>
                      <span style={{ color: "#e94560", marginRight: 6 }}>{i + 1}</span>
                      {h.fullName}
                    </span>
                    <span style={{ fontWeight: 800, color: "#e94560" }}>{F(h.매수)}원</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#666", marginTop: 3 }}>
                    포트폴리오 비중 {totalInvested > 0 ? ((h.매수 / totalInvested) * 100).toFixed(1) : 0}%
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </Section>

      {/* ============ 수익·매매 성과 ============ */}
      <Section storageKey="invest-section-performance" title="💰 수익·매매 성과">
        <Card title="매매 성과 요약" span={2}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", background: d.realPL.total >= 0 ? "#d4edda" : "#f8d7da", borderRadius: 8 }}>
              <span style={{ fontWeight: 600 }}>순 실현손익</span>
              <span style={{ fontWeight: 800, color: d.realPL.total >= 0 ? "#2ecc71" : "#e94560", fontSize: 18 }}>
                {d.realPL.total >= 0 ? "+" : ""}{F(Math.round(d.realPL.total))}원
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ padding: "10px 12px", background: "#d4edda", borderRadius: 8, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#666" }}>수익 ({d.realPL.winCnt}건)</div>
                <div style={{ fontWeight: 700, color: "#2ecc71" }}>+{F(Math.round(d.realPL.wins))}원</div>
                <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>평균 {F(Math.round(avgWin))}원</div>
              </div>
              <div style={{ padding: "10px 12px", background: "#f8d7da", borderRadius: 8, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#666" }}>손실 ({d.realPL.lossCnt}건)</div>
                <div style={{ fontWeight: 700, color: "#e94560" }}>−{F(Math.round(d.realPL.losses))}원</div>
                <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>평균 {F(Math.round(avgLoss))}원</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
              <div style={{ padding: "8px 10px", background: "#f8f9fa", borderRadius: 6, textAlign: "center" }}>
                <div style={{ color: "#999" }}>승률</div>
                <div style={{ fontWeight: 700, color: winRate != null && winRate >= 50 ? "#2ecc71" : "#e94560" }}>
                  {winRate == null ? "-" : winRate.toFixed(0) + "%"}
                </div>
              </div>
              <div style={{ padding: "8px 10px", background: "#f8f9fa", borderRadius: 6, textAlign: "center" }}>
                <div style={{ color: "#999" }}>수익:손실 배수</div>
                <div style={{ fontWeight: 700, color: winLossRatio != null && winLossRatio >= 1 ? "#2ecc71" : "#e94560" }}>
                  {winLossRatio == null ? "-" : winLossRatio.toFixed(2) + "x"}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#999", padding: "6px 10px", background: "#f8f9fa", borderRadius: 6, lineHeight: 1.5 }}>
              수익:손실 배수 1↑ + 승률 50%↑ → 기댓값 플러스. 배수가 높을수록 "한 번 크게, 자주 작게 손절" 전략.
            </div>
          </div>
        </Card>

        <Card title="청산 종목 손익" span={2}>
          <div style={{ maxHeight: 340, overflow: "auto" }}>
            {closedPL.length === 0 ? <div style={{ textAlign: "center", padding: 40, color: "#999" }}>청산 종목 없음</div> : closedPL.map(({ fullName, 매수, 매도, 실현손익 }) => (
              <div key={fullName} style={{ padding: "8px 0", borderBottom: "1px solid #f5f5f5" }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{fullName}</div>
                <div style={{ display: "flex", gap: 12, fontSize: 11, marginTop: 2 }}>
                  <span style={{ color: "#999" }}>매수 {F(매수)}원</span>
                  <span style={{ color: "#999" }}>매도 {F(매도)}원</span>
                  <span style={{ color: 실현손익 >= 0 ? "#2ecc71" : "#e94560", fontWeight: 700, marginLeft: "auto" }}>
                    {실현손익 >= 0 ? "+" : ""}{F(Math.round(실현손익))}원
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="배당/이자 수입 추이 (월별)" span={4}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={d.divTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="l" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={F} tick={{ fontSize: 10 }} />
              <Tooltip content={<CT />} />
              <Bar dataKey="amount" fill="#f0c040" radius={[4, 4, 0, 0]} name="배당/이자" />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: "#999", textAlign: "center", marginTop: 4 }}>
            투자 계좌에서 발생한 배당·이자·투자수익 월별 합
          </div>
        </Card>
      </Section>

      {/* ============ 인사이트 ============ */}
      <Section storageKey="invest-section-insights" title="💡 인사이트">
        {d.investBySub.length > 0 && (() => {
          const pieData = d.investBySub.map((v) => ({ name: v.sub, value: v.amount }));
          const investSubTotal = d.investBySub.reduce((s, x) => s + x.amount, 0);
          return (
            <Card title="재테크 중분류 구성" span={4}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, alignItems: "center" }}>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" cx="50%" cy="50%" outerRadius={90} innerRadius={40} label={pieLabel} labelLine={false} style={{ fontSize: 10 }}>
                      {d.investBySub.map((_, i) => <Cell key={i} fill={C[i]} />)}
                    </Pie>
                    <Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} />
                  </PieChart>
                </ResponsiveContainer>
                <div>
                  {d.investBySub.map((v, i) => (
                    <div key={v.sub} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f5f5f5", fontSize: 13 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i], display: "inline-block" }} />
                        {v.sub} <span style={{ fontSize: 10, color: "#999" }}>({v.count}건)</span>
                      </span>
                      <span style={{ fontWeight: 700 }}>
                        {F(v.amount)}원
                        <span style={{ fontSize: 10, color: "#999", marginLeft: 4 }}>
                          ({investSubTotal > 0 ? Math.round((v.amount / investSubTotal) * 100) : 0}%)
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          );
        })()}

        <Card title="투자 종합 인사이트" span={4}>
          <div className="grid-2" style={{ gap: 12 }}>
            {holdOnly[0] && <Insight title="최대 보유 종목 분석" color="#0f3460" bg="#f0f8ff">
              {holdOnly[0].fullName} — 총 매수금액 {F(holdOnly[0].매수)}원. 포트폴리오 비중 {topShare.toFixed(1)}%.
              {holdOnly[0].매도 > 0 ? ` 일부 매도(${F(holdOnly[0].매도)}원). 실현손익 ${holdOnly[0].실현손익 >= 0 ? "+" : ""}${F(Math.round(holdOnly[0].실현손익))}원.` : " 매도 없이 보유 중."}
              {topShare > 50 ? " ⚠️ 단일 종목 비중 50% 초과 — 분산 투자 고려 권장." : ""}
              {holdOnly.length > 1 ? ` 2위: ${holdOnly[1].fullName}(${F(holdOnly[1].매수)}원).` : ""}
            </Insight>}
            <Insight title="포트폴리오 분산" color="#7c3aed" bg="rgba(124,58,237,0.08)">
              {holdOnly.length}종목 보유, 실효 {effectiveHoldings.toFixed(1)}개.
              {effectiveHoldings < 5 ? " 분산 부족 — 5개 이상 실효 종목 권장. 한두 종목 실패가 전체에 큰 타격." :
                effectiveHoldings < 10 ? " 적당한 수준. 10개↑로 더 분산하면 안정성 상승." :
                " 훌륭한 분산. 시장 충격에 강한 구조."}
              {" "}매매 회전율 {turnoverAnnualized.toFixed(2)}x (연환산).
              {turnoverAnnualized > 2 ? " 거래가 잦음 — 수수료·세금 누적 주의." : turnoverAnnualized < 0.3 ? " 장기 보유형 전략." : ""}
            </Insight>
            <Insight title="배당/이자 수입" color="#059669" bg="#d4edda">
              {totalDiv > 0 ? `총 ${F(totalDiv)}원 · 월평균 ${F(Math.round(totalDiv / Math.max(d.months.length, 1)))}원. 투자 원금 대비 연환산 배당률 ${divYieldAnnualized.toFixed(2)}%. ${divYieldAnnualized >= 4 ? "배당률 4%↑ — 우수한 패시브 수입 구조!" : divYieldAnnualized >= 2 ? "배당률 2~4% — 안정적 수준." : "배당률 2% 미만 — 배당 ETF·고배당주 비중을 늘리면 패시브 수입이 커집니다."}` : "아직 배당/이자 수입이 없습니다. 배당 ETF·고배당주·CMA 이자 등으로 패시브 수입을 만들어 보세요."}
            </Insight>
            <Insight title="매매 전략 평가" color="#b45309" bg="#fff3cd">
              {d.realPL.winCnt + d.realPL.lossCnt > 0
                ? `${d.realPL.winCnt + d.realPL.lossCnt}건 청산 · 승률 ${winRate?.toFixed(0)}% · 수익:손실 배수 ${winLossRatio?.toFixed(2) ?? "-"}x. ${d.realPL.total >= 0 ? `순이익 +${F(Math.round(d.realPL.total))}원.` : `순손실 ${F(Math.round(d.realPL.total))}원 — 전략 재점검 필요.`} ${winLossRatio != null && winLossRatio >= 2 ? " 수익 > 손실의 2배 — 잘 끊어내고 있음." : winLossRatio != null && winLossRatio < 1 ? " 손실이 수익보다 큼 — 손절 기준 점검 필요." : ""}`
                : "매도 내역이 없어 성과 평가 보류. 장기 보유 전략이라면 정상."}
            </Insight>
          </div>
        </Card>

        {d.investSubInsights.length > 0 && (
          <Card title="재테크 중분류별 상세 인사이트" span={4}>
            <div className="grid-2" style={{ gap: 10 }}>
              {d.investSubInsights.map((v, i) => (
                <div key={v.sub} style={{ padding: "12px 14px", borderRadius: 10, background: v.monthTrend === "up" ? "#f0fdf4" : v.monthTrend === "down" ? "#fff5f5" : "#f0f8ff", border: `1px solid ${v.monthTrend === "up" ? "#86efac" : v.monthTrend === "down" ? "#fcc" : "#cce5ff"}`, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i % 12], display: "inline-block" }} />
                      {v.sub}
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: "#0f3460" }}>{F(v.amount)}원</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, fontSize: 11, color: "#555", marginBottom: 4 }}>
                    <span>비중 {v.share}%</span>
                    <span>{v.count}건</span>
                    <span>건당 {F(v.avg)}원</span>
                    <span>월평균 {F(v.monthAvg)}원</span>
                    <span style={{ color: v.monthTrend === "up" ? "#059669" : v.monthTrend === "down" ? "#e94560" : "#999", fontWeight: 600 }}>
                      {v.monthTrend === "up" ? `▲ ${v.mom}%` : v.monthTrend === "down" ? `▼ ${Math.abs(v.mom)}%` : "유지"}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "#666", lineHeight: 1.6, borderTop: "1px solid #eee", paddingTop: 4 }}>
                    {v.comment}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </Section>
    </div>
  );
});
