import React from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { F, W, Card, Kpi, Insight, CT, type D } from "../insightsShared";

export const SubTab = React.memo(function SubTab({ d }: { d: D }) {
  const subs = d.subs;
  const totalMonthly = subs.reduce((a, s) => a + s.avg, 0);
  const totalAnnual = totalMonthly * 12;
  const subPctIncome = d.pIncome > 0 ? (subs.reduce((a, s) => a + s.total, 0) / d.pIncome * 100) : 0;
  const aiSubs = subs.filter(s => /chatgpt|claude|cursor|ai|gpt|copilot/i.test(s.name));
  const videoSubs = subs.filter(s => /유튜브|넷플릭스|왓챠|디즈니|웨이브|프리미엄/i.test(s.name));
  const commerceSubs = subs.filter(s => /쿠팡|로켓|네이버플러스|멤버십/i.test(s.name));
  const costPerDay = totalMonthly > 0 ? Math.round(totalMonthly / 30) : 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
      <Card accent><Kpi label="월 구독 비용" value={F(totalMonthly)} sub={`일 ${W(costPerDay)}`} color="#f0c040" /></Card>
      <Card accent><Kpi label="연간 구독 비용" value={F(totalAnnual)} color="#e94560" /></Card>
      <Card accent><Kpi label="수입 대비 비율" value={subPctIncome.toFixed(1) + "%"} sub={subPctIncome > 5 ? "구독 비중이 높아요" : "적정 수준"} color="#48c9b0" /></Card>

      <Card title="구독 서비스 상세" span={3}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {subs.map(({ name, count, total, avg }) => (
            <div key={name} style={{ background: "#f8f9fa", borderRadius: 12, padding: 14, border: "1px solid #eee" }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{name}</div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#666" }}>
                <span>월 ~{W(avg)}</span><span>{count}회 결제</span>
              </div>
              <div style={{ fontSize: 12, color: "#e94560", fontWeight: 600, marginTop: 4 }}>누적 {W(total)}</div>
            </div>
          ))}
        </div>
        {subs.length === 0 && <div style={{ textAlign: "center", padding: 40, color: "#999" }}>구독 데이터 없음</div>}
      </Card>

      <Card title="월별 구독 지출 추이" span={2}>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={d.subTrend}><CartesianGrid strokeDasharray="3 3" stroke="#eee" /><XAxis dataKey="l" tick={{ fontSize: 12 }} /><YAxis tickFormatter={F} tick={{ fontSize: 11 }} /><Tooltip content={<CT />} />
            <Bar dataKey="amount" fill="#533483" radius={[4, 4, 0, 0]} name="구독비" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card title="구독 카테고리 분류" span={1}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
          {[
            { label: "AI/생산성", items: aiSubs, color: "#e94560", total: aiSubs.reduce((s, sub) => s + sub.avg, 0) },
            { label: "영상/엔터", items: videoSubs, color: "#0f3460", total: videoSubs.reduce((s, sub) => s + sub.avg, 0) },
            { label: "커머스/배송", items: commerceSubs, color: "#48c9b0", total: commerceSubs.reduce((s, sub) => s + sub.avg, 0) },
          ].filter(g => g.items.length > 0).map(g => (
            <div key={g.label} style={{ padding: "10px 12px", background: "#f8f9fa", borderRadius: 8, borderLeft: `4px solid ${g.color}` }}>
              <div style={{ fontWeight: 700, color: g.color }}>{g.label} — 월 {W(g.total)}</div>
              <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{g.items.map(s => s.name).join(", ")}</div>
            </div>
          ))}
          {aiSubs.length === 0 && videoSubs.length === 0 && commerceSubs.length === 0 && (
            <div style={{ textAlign: "center", padding: 20, color: "#999" }}>분류할 구독이 없습니다</div>
          )}
        </div>
      </Card>

      <Card title="구독 최적화 제안" span={3}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {aiSubs.length > 1 && <Insight title="AI 구독 점검" color="#b45309" bg="#fff3cd">{aiSubs.map(s => `${s.name}(${F(s.avg)})`).join(" + ")} = 월 {F(aiSubs.reduce((s, sub) => s + sub.avg, 0))}. 둘 다 필요한지 점검.</Insight>}
          {videoSubs.length > 1 && <Insight title="영상 구독 중복" color="#2563eb" bg="#cce5ff">{videoSubs.map(s => s.name).join(" + ")}. 사용빈도 대비 효율 점검.</Insight>}
          {commerceSubs.length > 1 && <Insight title="커머스 통합" color="#059669" bg="#d4edda">{commerceSubs.map(s => s.name).join(" + ")}. 주 사용처 하나로 통합하면 절약.</Insight>}
          <Insight title="비용 대비 가치" color="#7c3aed" bg="rgba(139,92,246,0.08)">
            연간 {F(totalAnnual)} 지출. {totalAnnual > 1000000 ? "100만원 이상! 미사용 구독을 정리해보세요." : "적정 수준입니다."}
          </Insight>
          {costPerDay > 0 && <Insight title="일일 구독 비용" color="#e94560" bg="#fff5f5">하루 {W(costPerDay)} 지출. {costPerDay > 3000 ? "커피 한 잔 이상!" : "커피 한 잔 미만."}</Insight>}
        </div>
      </Card>
    </div>
  );
});
