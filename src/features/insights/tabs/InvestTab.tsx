import React from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { C, F, W, SD, Card, Kpi, Insight, CT, pieLabel, type D } from "../insightsShared";

export const InvestTab = React.memo(function InvestTab({ d }: { d: D }) {
  const holdings = d.trades.map(v => ({
    name: v.name.length > 20 ? v.name.slice(0, 20) + "…" : v.name, fullName: v.name,
    매수: v.buyTotal, 매도: v.sellTotal, 보유수량: v.buyCount - v.sellCount,
    실현손익: v.sellTotal - (v.sellCount > 0 ? SD(v.buyTotal, v.buyCount) * v.sellCount : 0),
  }));
  const holdOnly = holdings.filter(h => h.보유수량 > 0);
  const closedPL = holdings.filter(h => h.보유수량 === 0 && h.매도 > 0);
  const noSellHoldings = holdOnly.filter(h => h.매도 === 0 && h.매수 > 500000);
  const totalInvested = holdOnly.reduce((s, h) => s + h.매수, 0);
  const totalDiv = d.divTrend.reduce((s, m) => s + m.amount, 0);

  return (
    <div className="grid-4">
      <Card accent><Kpi label="총 매수금액" value={F(totalInvested)} color="#f0c040" /></Card>
      <Card accent><Kpi label="실현 손익" value={F(Math.round(d.realPL.total))} sub={d.investReturnRate !== 0 ? `수익률 ${d.investReturnRate.toFixed(1)}%` : undefined} color={d.realPL.total >= 0 ? "#48c9b0" : "#e94560"} /></Card>
      <Card accent><Kpi label="배당/이자 수입" value={F(totalDiv)} sub={totalInvested > 0 ? `배당률 ${(SD(totalDiv, totalInvested) * 100).toFixed(1)}%` : undefined} color="#48c9b0" /></Card>
      <Card accent><Kpi label="보유 종목 수" value={`${holdOnly.length}종목`} sub={`청산 ${closedPL.length}종목`} color="#fff" /></Card>

      <Card title="보유 종목 (매수금액 기준)" span={2}>
        {holdOnly.length === 0 ? <div style={{ textAlign: "center", padding: 40, color: "#999" }}>보유 종목 없음</div> : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={holdOnly.slice(0, 10)} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis type="number" tickFormatter={F} tick={{ fontSize: 11 }} /><YAxis dataKey="name" type="category" width={150} tick={{ fontSize: 10 }} />
              <Tooltip content={<CT />} /><Bar dataKey="매수" fill="#0f3460" radius={[0, 6, 6, 0]} name="매수금액" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title="포트폴리오 자산배분" span={1}>
        {d.portfolio.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart><Pie data={d.portfolio} dataKey="value" cx="50%" cy="50%" outerRadius={100} innerRadius={45} label={pieLabel} labelLine={false} style={{ fontSize: 10 }}>
              {d.portfolio.map((_, i) => <Cell key={i} fill={C[i]} />)}
            </Pie><Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} /></PieChart>
          </ResponsiveContainer>
        ) : <div style={{ textAlign: "center", padding: 40, color: "#999" }}>데이터 없음</div>}
      </Card>

      <Card title="청산 종목 손익" span={1}>
        <div style={{ maxHeight: 280, overflow: "auto" }}>
          {closedPL.length === 0 ? <div style={{ textAlign: "center", padding: 40, color: "#999" }}>청산 종목 없음</div> : closedPL.map(({ fullName, 매수, 매도, 실현손익 }) => (
            <div key={fullName} style={{ padding: "8px 0", borderBottom: "1px solid #f5f5f5" }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{fullName}</div>
              <div style={{ display: "flex", gap: 12, fontSize: 11, marginTop: 2 }}>
                <span style={{ color: "#999" }}>매수 {F(매수)}</span><span style={{ color: "#999" }}>매도 {F(매도)}</span>
                <span style={{ color: 실현손익 >= 0 ? "#2ecc71" : "#e94560", fontWeight: 700 }}>{실현손익 >= 0 ? "+" : ""}{F(Math.round(실현손익))}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="월별 투자금액 추이" span={2}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={d.investTrend}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="l" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} />
            <Bar dataKey="amount" fill="#48c9b0" radius={[4, 4, 0, 0]} name="투자금액" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="월별 매매 횟수" span={1}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={d.tradeCntTrend}><XAxis dataKey="l" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip />
            <Bar dataKey="count" fill="#533483" radius={[4, 4, 0, 0]} name="거래수" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="배당/이자 수입 추이" span={1}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={d.divTrend.filter(m => m.amount > 0)}><XAxis dataKey="l" tick={{ fontSize: 10 }} /><YAxis tickFormatter={F} tick={{ fontSize: 10 }} /><Tooltip content={<CT />} />
            <Bar dataKey="amount" fill="#f0c040" radius={[4, 4, 0, 0]} name="배당/이자" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="매매 성과" span={1}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: d.realPL.total >= 0 ? "#d4edda" : "#f8d7da", borderRadius: 8 }}>
            <span>총 실현손익</span><span style={{ fontWeight: 800, color: d.realPL.total >= 0 ? "#2ecc71" : "#e94560" }}>{d.realPL.total >= 0 ? "+" : ""}{F(Math.round(d.realPL.total))}</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1, padding: "8px 10px", background: "#d4edda", borderRadius: 8, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#666" }}>수익</div>
              <div style={{ fontWeight: 700, color: "#2ecc71" }}>{d.realPL.winCnt}건 +{F(Math.round(d.realPL.wins))}</div>
            </div>
            <div style={{ flex: 1, padding: "8px 10px", background: "#f8d7da", borderRadius: 8, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: "#666" }}>손실</div>
              <div style={{ fontWeight: 700, color: "#e94560" }}>{d.realPL.lossCnt}건 -{F(Math.round(d.realPL.losses))}</div>
            </div>
          </div>
          {d.realPL.winCnt + d.realPL.lossCnt > 0 && (
            <div style={{ textAlign: "center", fontSize: 12, color: "#666" }}>
              승률 {Math.round(d.realPL.winCnt / (d.realPL.winCnt + d.realPL.lossCnt) * 100)}%
            </div>
          )}
        </div>
      </Card>

      {d.investBySub.length > 0 && (() => {
        const pieData = d.investBySub.map((v) => ({ name: v.sub, value: v.amount }));
        const investSubTotal = d.investBySub.reduce((s, x) => s + x.amount, 0);
        return (
        <Card title="재테크 중분류별 분류" span={2}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <ResponsiveContainer width="45%" height={200}>
              <PieChart><Pie data={pieData} dataKey="value" cx="50%" cy="50%" outerRadius={80} innerRadius={35} label={pieLabel} labelLine={false} style={{ fontSize: 10 }}>
                {d.investBySub.map((_, i) => <Cell key={i} fill={C[i]} />)}
              </Pie><Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} /></PieChart>
            </ResponsiveContainer>
            <div style={{ flex: 1 }}>
              {d.investBySub.map((v, i) => (
                <div key={v.sub} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #f5f5f5", fontSize: 13 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 5, background: C[i], display: "inline-block" }} />{v.sub} ({v.count}건)
                  </span>
                  <span style={{ fontWeight: 700 }}>{F(v.amount)} <span style={{ fontSize: 10, color: "#999" }}>({investSubTotal > 0 ? Math.round(v.amount / investSubTotal * 100) : 0}%)</span></span>
                </div>
              ))}
            </div>
          </div>
        </Card>
        );
      })()}

      {d.stockTrends.map(st => (
        <Card key={st.name} title={`${st.name} 누적 매수금액 변동`} span={2}>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={st.data}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="l" tick={{ fontSize: 10 }} /><YAxis tickFormatter={F} tick={{ fontSize: 10 }} /><Tooltip content={<CT />} />
              <Area type="monotone" dataKey="누적매수" stroke="#0f3460" fill="#0f346020" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      ))}

      <Card title="투자 종합 인사이트" span={4}>
        <div className="grid-2" style={{ gap: 12 }}>
          {holdOnly[0] && <Insight title="최대 보유 종목 분석" color="#0f3460" bg="#f0f8ff">
            {holdOnly[0].fullName} — 총 매수금액 {F(holdOnly[0].매수)}. 포트폴리오 비중 {totalInvested > 0 ? Math.round(holdOnly[0].매수 / totalInvested * 100) : 0}%.
            {holdOnly[0].매도 > 0 ? ` 일부 매도(${F(holdOnly[0].매도)}) 실행. 실현손익 ${holdOnly[0].실현손익 >= 0 ? "+" : ""}${F(Math.round(holdOnly[0].실현손익))}.` : " 매도 없이 보유 중입니다."}
            {totalInvested > 0 && holdOnly[0].매수 / totalInvested > 0.5 ? " 단일 종목 비중이 50%를 넘습니다. 분산 투자를 고려해 보세요." : ""}
            {holdOnly.length > 1 ? ` 2위: ${holdOnly[1].fullName}(${F(holdOnly[1].매수)}).` : ""}
          </Insight>}
          {noSellHoldings.length > 0 && <Insight title="매도 없는 종목 점검" color="#e94560" bg="#f8d7da">
            {noSellHoldings.map(h => `${h.fullName}(${F(h.매수)})`).join(", ")}.
            총 {noSellHoldings.length}종목이 매수 후 매도 없이 보유 중입니다.
            {noSellHoldings.length >= 3 ? " 보유 종목이 많습니다. 손실이 난 종목은 손절을 검토해 보세요. 포트폴리오 리밸런싱 시점이 될 수 있습니다." : " 장기 투자 전략이라면 좋지만, 정기적으로 포트폴리오를 점검하세요."}
          </Insight>}
          <Insight title="배당/이자 수입 분석" color="#059669" bg="#d4edda">
            {totalDiv > 0 ? `총 ${F(totalDiv)} 수령, 월평균 ${F(Math.round(totalDiv / Math.max(d.months.length, 1)))}. ${totalInvested > 0 ? `투자 원금 대비 수익률 약 ${(totalDiv / totalInvested * 100).toFixed(1)}%.` : ""} ${d.divTrend.filter(m => m.amount > 0).length > 0 ? `${d.divTrend.filter(m => m.amount > 0).length}개월간 배당 수령. ` : ""}배당 수입이 꾸준히 들어오고 있어 복리 효과가 기대됩니다.` : "아직 배당/이자 수입이 없습니다. 배당 ETF나 고배당주를 통해 패시브 수입을 만들어 보세요."}
          </Insight>
          <Insight title="매매 전략 평가" color="#b45309" bg="#fff3cd">
            {d.realPL.winCnt + d.realPL.lossCnt > 0
              ? `총 ${d.realPL.winCnt + d.realPL.lossCnt}건 청산, 승률 ${Math.round(d.realPL.winCnt / (d.realPL.winCnt + d.realPL.lossCnt) * 100)}%. 수익 ${d.realPL.winCnt}건(+${F(Math.round(d.realPL.wins))}), 손실 ${d.realPL.lossCnt}건(-${F(Math.round(d.realPL.losses))}). ${d.realPL.total >= 0 ? `순이익 +${F(Math.round(d.realPL.total))}. 전체적으로 수익을 내고 있습니다!` : `순손실 ${F(Math.round(d.realPL.total))}. 매매 전략을 재점검해 보세요.`} ${d.realPL.winCnt / Math.max(d.realPL.winCnt + d.realPL.lossCnt, 1) < 0.5 ? "승률이 50% 미만입니다. 진입 시점과 손절 기준을 검토해 보세요." : ""}`
              : "아직 매도한 종목이 없어 매매 성과를 평가할 수 없습니다. 장기 보유 전략이라면 괜찮습니다."}
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
                  <span style={{ fontSize: 16, fontWeight: 800, color: "#0f3460" }}>{F(v.amount)}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4, fontSize: 11, color: "#555", marginBottom: 4 }}>
                  <span>비중 {v.share}%</span>
                  <span>{v.count}건</span>
                  <span>건당 {F(v.avg)}</span>
                  <span>월평균 {F(v.monthAvg)}</span>
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
    </div>
  );
});
