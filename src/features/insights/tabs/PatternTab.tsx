import React from "react";
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { WDN, C, F, W, Card, Kpi, Insight, Section, CT, type D } from "../insightsShared";
import { FunTab } from "./FunTab";

export const PatternTab = React.memo(function PatternTab({ d }: { d: D }) {
  const ps = d.patternStats;
  const wdData = WDN.map((name, i) => ({
    name,
    count: d.wdSpend[i].count,
    avg: d.wdSpend[i].count > 0 ? Math.round(d.wdSpend[i].total / d.wdSpend[i].count) : 0,
  }));
  const sortedByCount = [...wdData].sort((a, b) => b.count - a.count);
  const totalExpTx = d.wdSpend.reduce((s, w) => s + w.count, 0);
  const avgDaily = d.totalDays > 0 ? Math.round(d.pExpense / d.totalDays) : 0;
  const weekendPct = d.weekendTot + d.weekdayTot > 0 ? Math.round(d.weekendTot / (d.weekendTot + d.weekdayTot) * 100) : 0;

  // 상·중·하순
  const byThird = [0, 0, 0];
  d.spendByDOM.forEach((v, i) => { if (i < 10) byThird[0] += v; else if (i < 20) byThird[1] += v; else byThird[2] += v; });
  const thirdData = [
    { name: "상순(1~10)", 지출: byThird[0] },
    { name: "중순(11~20)", 지출: byThird[1] },
    { name: "하순(21~31)", 지출: byThird[2] },
  ];

  // 월별 무지출일 데이터
  const zeroTrendData = ps.zeroDaysPerMonth.map((m) => ({
    name: m.label,
    무지출: m.zeroDays,
    pct: m.totalDays > 0 ? (m.zeroDays / m.totalDays) * 100 : 0,
  }));

  const periodLabel = d.months.length > 0 ? `${d.months[0]} ~ ${d.months[d.months.length - 1]}` : "-";

  return (
    <div>
      <div style={{ padding: "10px 14px", background: "#f8f9fa", borderRadius: 8, marginBottom: 16, fontSize: 12, color: "#666", lineHeight: 1.6 }}>
        ℹ️ 범위: <strong>{d.months.length}개월</strong> ({periodLabel}) · 단위: <strong>원</strong> · 초점: <strong>언제·어떻게</strong> 소비하는지 (타이밍·빈도·스트릭). 금액 심층 분석은 지출 분석 탭 참조
      </div>

      {/* ============ 한눈에 ============ */}
      <Section storageKey="pattern-section-overview" title="📊 한눈에 보기">
        <Card accent><Kpi label="무지출 일수" value={`${d.zeroDays}일`} sub={`${d.totalDays}일 중 ${d.totalDays > 0 ? Math.round((d.zeroDays / d.totalDays) * 100) : 0}%`} color="#48c9b0" info="기간 내 지출이 0원인 날 수" /></Card>
        <Card accent><Kpi label="일 평균 지출" value={F(avgDaily) + "원"} sub={`${d.totalDays}일 기준`} color="#f0c040" info="총 지출 / 총 일수 (무지출일 포함)" /></Card>
        <Card accent><Kpi label="주말 지출 비중" value={weekendPct + "%"} sub={`주말 ${F(d.weekendTot)}원 / 주중 ${F(d.weekdayTot)}원`} color={weekendPct > 40 ? "#e94560" : "#48c9b0"} info="토+일 지출 / (토+일+평일) 지출" /></Card>
        <Card accent><Kpi label="평균 거래 간격" value={`${ps.avgIntervalDays.toFixed(1)}일`} sub={`총 ${totalExpTx}건 거래`} color="#3498db" info="연속된 지출 발생일 사이의 평균 일수" /></Card>
      </Section>

      {/* ============ 소비 스트릭 ============ */}
      <Section storageKey="pattern-section-streaks" title="🔥 소비 습관·스트릭">
        <Card accent>
          <Kpi
            label="현재 진행 중"
            value={ps.currentStreakType === "none" ? "–" : `${ps.currentStreakDays}일`}
            sub={ps.currentStreakType === "zero" ? "연속 무지출 중" : ps.currentStreakType === "spend" ? "연속 소비 중" : "-"}
            color={ps.currentStreakType === "zero" ? "#48c9b0" : ps.currentStreakType === "spend" ? "#e94560" : "#999"}
            info="기간 마지막 날 기준 진행 중인 연속 스트릭"
          />
        </Card>
        <Card accent>
          <Kpi
            label="최장 무지출"
            value={`${ps.longestZeroStreak}일`}
            sub="연속 무지출 기록"
            color="#48c9b0"
            info="기간 내 가장 오래 이어진 연속 무지출 일수"
          />
        </Card>
        <Card accent>
          <Kpi
            label="최장 연속 소비"
            value={`${ps.longestSpendStreak}일`}
            sub="하루도 안 쉼"
            color="#e94560"
            info="기간 내 가장 오래 이어진 연속 지출 일수"
          />
        </Card>
        <Card accent>
          <Kpi
            label="무지출 달성률"
            value={d.totalDays > 0 ? `${Math.round((d.zeroDays / d.totalDays) * 100)}%` : "-"}
            sub={d.totalDays > 0 && d.zeroDays / d.totalDays >= 0.2 ? "✅ 통제력 우수" : "목표 20%+"}
            color={d.totalDays > 0 && d.zeroDays / d.totalDays >= 0.2 ? "#48c9b0" : "#f0c040"}
            info="전체 기간 대비 무지출일 비율. 20%↑면 소비 통제력 우수"
          />
        </Card>

        <Card title="월별 무지출일 추이" span={4}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={zeroTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => v.toFixed(0) + "%"} tick={{ fontSize: 10 }} domain={[0, 100]} />
              <Tooltip formatter={(v: ValueType | undefined, n) => n === "무지출" ? `${v}일` : `${Number(v ?? 0).toFixed(0)}%`} />
              <Bar yAxisId="left" dataKey="무지출" radius={[4, 4, 0, 0]}>
                {zeroTrendData.map((e, i) => <Cell key={i} fill={e.pct >= 20 ? "#48c9b0" : e.pct >= 10 ? "#f0c040" : "#e94560"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: "#999", textAlign: "center", marginTop: 4 }}>
            녹색 ≥20% · 노랑 10~20% · 빨강 &lt;10%
          </div>
        </Card>
      </Section>

      {/* ============ 타이밍 ============ */}
      <Section storageKey="pattern-section-timing" title="📅 타이밍 패턴">
        <Card title="요일별 거래 빈도" span={2}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={wdData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: ValueType | undefined, _n, p) => [`${v}건`, `건당 평균 ${F(p.payload.avg)}원`]} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {wdData.map((e, i) => <Cell key={i} fill={i >= 5 ? "#e94560" : "#0f3460"} opacity={0.8} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: "#999", textAlign: "center", marginTop: 4 }}>
            빈도(건수) 기준 · 최다: {sortedByCount[0]?.name}요일 ({sortedByCount[0]?.count}건) · 금액 기준은 지출 분석 탭
          </div>
        </Card>

        <Card title="상·중·하순 지출 분포" span={2}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={thirdData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={F} tick={{ fontSize: 10 }} />
              <Tooltip content={<CT />} />
              <Bar dataKey="지출" radius={[6, 6, 0, 0]}>
                {thirdData.map((_, i) => <Cell key={i} fill={C[i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: "#999", textAlign: "center", marginTop: 4 }}>
            {byThird[2] > byThird[0] && byThird[2] > byThird[1] ? "하순 집중 (카드 결제일·월말 소비)" :
              byThird[0] > byThird[1] ? "상순 집중 (고정비 결제)" : "중순 집중"}
          </div>
        </Card>

        <Card title="지출 많은 날 TOP 5" span={4}>
          {d.topDates.length === 0 ? <div style={{ textAlign: "center", padding: 20, color: "#999" }}>데이터 없음</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {d.topDates.map((dt, idx) => (
                <div key={dt.date} style={{ background: idx < 3 ? "#fff5f5" : "#f8f9fa", borderRadius: 10, padding: "10px 14px", border: idx < 3 ? "1px solid #fcc" : "1px solid #eee", position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${d.topDates[0] ? (dt.total / d.topDates[0].total) * 100 : 0}%`, background: "rgba(233,69,96,0.06)", borderRadius: 10 }} />
                  <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 18, fontWeight: 800, color: idx < 3 ? "#e94560" : "#999", width: 28 }}>{idx + 1}</span>
                    <span style={{ fontSize: 13, color: "#666", fontWeight: 600, minWidth: 85 }}>{dt.date}</span>
                    <span style={{ fontWeight: 700, fontSize: 15, color: "#e94560", marginLeft: "auto" }}>{F(dt.total)}원</span>
                  </div>
                  <div style={{ position: "relative", display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                    {dt.items.slice(0, 4).map((it, j) => (
                      <span key={j} style={{ fontSize: 10, color: "#999", background: "#fff", border: "1px solid #eee", borderRadius: 4, padding: "1px 6px" }}>
                        {it.desc} {F(it.amount)}원
                      </span>
                    ))}
                    {dt.items.length > 4 && <span style={{ fontSize: 10, color: "#999" }}>+{dt.items.length - 4}건</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Section>

      {/* ============ 인사이트 ============ */}
      <Section storageKey="pattern-section-insights" title="💡 인사이트">
        <Card title="소비 패턴 종합 분석" span={4}>
          <div className="grid-2" style={{ gap: 12 }}>
            <Insight title="요일 빈도 패턴" color="#e94560" bg="#f8d7da">
              가장 자주 지출하는 요일: {sortedByCount.slice(0, 2).map((w) => `${w.name}(${w.count}건, 건당 ${F(w.avg)}원)`).join(", ")}.
              가장 적게 지출하는 요일: {sortedByCount.slice(-1).map((w) => `${w.name}(${w.count}건)`).join("")}.
              {sortedByCount[0] && sortedByCount[sortedByCount.length - 1] && sortedByCount[0].count > sortedByCount[sortedByCount.length - 1].count * 3
                ? ` ${sortedByCount[0].name}요일 거래 빈도가 ${sortedByCount[sortedByCount.length - 1].name}요일의 ${Math.round(sortedByCount[0].count / Math.max(sortedByCount[sortedByCount.length - 1].count, 1))}배 — 특정 요일에 소비가 몰립니다.`
                : " 요일별 빈도는 비교적 고름."}
            </Insight>
            <Insight title="주말 vs 주중" color="#0f3460" bg="#f0f8ff">
              주말 {weekendPct}% ({F(d.weekendTot)}원), 주중 {100 - weekendPct}% ({F(d.weekdayTot)}원).
              {weekendPct > 40 ? " 주말 지출 집중 — 외식·여가·쇼핑이 주말에 몰리는 패턴. 주말 예산 설정이 효과적." :
                weekendPct > 25 ? " 주중·주말 균형적." :
                " 주중 지출 압도적 — 출퇴근·점심값 등 고정 패턴."}
            </Insight>
            <Insight title="월 주기성 (상·중·하순)" color="#b45309" bg="#fff3cd">
              상순 {F(byThird[0])}원 ({d.pExpense > 0 ? Math.round((byThird[0] / d.pExpense) * 100) : 0}%), 중순 {F(byThird[1])}원 ({d.pExpense > 0 ? Math.round((byThird[1] / d.pExpense) * 100) : 0}%), 하순 {F(byThird[2])}원 ({d.pExpense > 0 ? Math.round((byThird[2] / d.pExpense) * 100) : 0}%).
              {byThird[2] > byThird[0] && byThird[2] > byThird[1] ? " 하순에 집중 — 카드 결제일·월말 효과." :
                byThird[0] > byThird[1] ? " 상순에 집중 — 고정비 결제(월세·보험 등)." :
                " 중순에 집중."}
            </Insight>
            <Insight title="스트릭·소비 통제력" color="#059669" bg="#d4edda">
              {ps.currentStreakType === "zero" ? `🔥 현재 ${ps.currentStreakDays}일 연속 무지출 중!` : ps.currentStreakType === "spend" ? `${ps.currentStreakDays}일 연속 지출 중.` : ""}
              {" "}최장 무지출 {ps.longestZeroStreak}일, 최장 연속 소비 {ps.longestSpendStreak}일.
              {" "}평균 {ps.avgIntervalDays.toFixed(1)}일에 한 번 지출.
              {d.zeroDays >= d.totalDays * 0.3 ? " 무지출일 30%↑ — 뛰어난 통제력!" :
                d.zeroDays >= d.totalDays * 0.15 ? " 주 1~2일 무지출 습관이 잡혀 있음." :
                " 주 1일 무지출 챌린지부터 시작해 보세요."}
            </Insight>
          </div>
        </Card>
      </Section>

      {/* ============ 재미 통계 (흡수) ============ */}
      <FunTab d={d} />
    </div>
  );
});
