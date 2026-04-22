import React from "react";
import { F, Card, type D } from "../insightsShared";

export const FunTab = React.memo(function FunTab({ d }: { d: D }) {
  const fs = d.funStats;
  const statCards: { icon: string; title: string; value: string; sub: string }[] = [];

  if (fs.biggestSpendDay) statCards.push({ icon: "🔥", title: "역대 최고 지출일", value: F(fs.biggestSpendDay.total), sub: fs.biggestSpendDay.date });
  if (fs.mostSpendMonth) statCards.push({ icon: "💸", title: "가장 많이 쓴 달", value: F(fs.mostSpendMonth.expense), sub: d.ml[fs.mostSpendMonth.month] || fs.mostSpendMonth.month });
  if (fs.mostFrugalMonth) statCards.push({ icon: "🏆", title: "가장 절약한 달", value: F(fs.mostFrugalMonth.expense), sub: d.ml[fs.mostFrugalMonth.month] || fs.mostFrugalMonth.month });
  if (fs.bestSavingsMonth) statCards.push({ icon: "💎", title: "최고 저축률", value: `${fs.bestSavingsMonth.rate}%`, sub: d.ml[fs.bestSavingsMonth.month] || fs.bestSavingsMonth.month });
  if (fs.longestZeroStreak > 0) statCards.push({ icon: "🧘", title: "최장 무지출 연속", value: `${fs.longestZeroStreak}일`, sub: "하루도 안 쓴 기록" });
  if (fs.topStore) statCards.push({ icon: "🏪", title: "최다 이용처", value: fs.topStore.name, sub: `${fs.topStore.count}회 · ${F(fs.topStore.total)}` });
  if (fs.daysToSpendIncome) statCards.push({ icon: "⏱️", title: "월수입 소진 속도", value: `${fs.daysToSpendIncome}일`, sub: "일 평균 지출 기준" });
  statCards.push({ icon: "📝", title: "일 평균 거래", value: `${fs.avgTxPerDay}건`, sub: `총 ${d.txCount.toLocaleString()}건` });

  const prevComp = d.prev ? {
    incDiff: d.monthly[d.months[d.months.length - 1]]?.income - d.prev.income,
    expDiff: d.monthly[d.months[d.months.length - 1]]?.expense - d.prev.expense,
  } : null;

  const wkPct = fs.weekendVsWeekday.weekend + fs.weekendVsWeekday.weekday > 0
    ? Math.round(fs.weekendVsWeekday.weekend / (fs.weekendVsWeekday.weekend + fs.weekendVsWeekday.weekday) * 100) : 0;

  return (
    <div>
      <div className="grid-4" style={{ marginBottom: 20 }}>
        {statCards.map((s, i) => (
          <Card key={i} accent>
            <div style={{ textAlign: "center", padding: "8px 0" }}>
              <div style={{ fontSize: 28, marginBottom: 4 }}>{s.icon}</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.6)", fontWeight: 600, marginBottom: 6 }}>{s.title}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>{s.value}</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>{s.sub}</div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid-2">
        <Card title="주말 vs 평일 지출">
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 13 }}>
                <span>주말 ({wkPct}%)</span><span style={{ fontWeight: 700 }}>{F(fs.weekendVsWeekday.weekend)}</span>
              </div>
              <div style={{ height: 12, background: "#f0f0f0", borderRadius: 6, overflow: "hidden" }}>
                <div style={{ width: `${wkPct}%`, height: "100%", background: "#e94560", borderRadius: 6 }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, marginBottom: 8, fontSize: 13 }}>
                <span>평일 ({100 - wkPct}%)</span><span style={{ fontWeight: 700 }}>{F(fs.weekendVsWeekday.weekday)}</span>
              </div>
              <div style={{ height: 12, background: "#f0f0f0", borderRadius: 6, overflow: "hidden" }}>
                <div style={{ width: `${100 - wkPct}%`, height: "100%", background: "#3498db", borderRadius: 6 }} />
              </div>
            </div>
          </div>
        </Card>

        {prevComp && (
          <Card title="전월 대비 변화">
            <div style={{ fontSize: 13, lineHeight: 2 }}>
              <div>수입: <span style={{ fontWeight: 700, color: prevComp.incDiff >= 0 ? "#48c9b0" : "#e94560" }}>{prevComp.incDiff >= 0 ? "+" : ""}{F(prevComp.incDiff)}</span></div>
              <div>지출: <span style={{ fontWeight: 700, color: prevComp.expDiff <= 0 ? "#48c9b0" : "#e94560" }}>{prevComp.expDiff >= 0 ? "+" : ""}{F(prevComp.expDiff)}</span>
                {prevComp.expDiff > 0 ? " (주의!)" : prevComp.expDiff < 0 ? " (절약!)" : ""}
              </div>
            </div>
          </Card>
        )}

        {fs.monthOverMonthGrowth !== null && (
          <Card title="순자산 월평균 성장">
            <div style={{ textAlign: "center", padding: 16 }}>
              <div style={{ fontSize: 36, fontWeight: 800, color: fs.monthOverMonthGrowth >= 0 ? "#48c9b0" : "#e94560" }}>
                {fs.monthOverMonthGrowth >= 0 ? "+" : ""}{fs.monthOverMonthGrowth}%
              </div>
              <div style={{ fontSize: 12, color: "#999", marginTop: 8 }}>매월 평균 순자산 변화율</div>
            </div>
          </Card>
        )}

        {fs.daysToSpendIncome && (
          <Card title="수입 소진 속도 분석">
            <div style={{ fontSize: 13, lineHeight: 1.8, color: "#444" }}>
              {fs.daysToSpendIncome >= 30
                ? `월수입을 다 쓰려면 ${fs.daysToSpendIncome}일이 걸립니다. 지출 대비 수입이 넉넉합니다!`
                : fs.daysToSpendIncome >= 20
                  ? `일 평균 지출 기준으로 ${fs.daysToSpendIncome}일이면 월수입이 소진됩니다. 적정 수준입니다.`
                  : `${fs.daysToSpendIncome}일이면 월수입이 바닥납니다! 지출 감소 또는 수입 증대가 필요합니다.`
              }
              <div style={{ marginTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#999", marginBottom: 4 }}>
                  <span>0일</span><span>30일</span>
                </div>
                <div style={{ height: 16, background: "#f0f0f0", borderRadius: 8, position: "relative", overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, fs.daysToSpendIncome / 30 * 100)}%`, height: "100%", background: fs.daysToSpendIncome >= 30 ? "#48c9b0" : fs.daysToSpendIncome >= 20 ? "#f0c040" : "#e94560", borderRadius: 8, transition: "width 0.5s" }} />
                </div>
              </div>
            </div>
          </Card>
        )}

        <Card title="지출처 TOP 10" span={2}>
          <div style={{ maxHeight: 300, overflow: "auto" }}>
            {(() => {
              const stores = Array.from(
                d.expByDesc.reduce((m, e) => {
                  const k = e.desc;
                  const p = m.get(k) ?? { total: 0, count: 0 };
                  m.set(k, { total: p.total + e.amount, count: p.count + 1 });
                  return m;
                }, new Map<string, { total: number; count: number }>())
              ).sort((a, b) => b[1].total - a[1].total).slice(0, 10);
              return stores.map(([name, v], i) => (
                <div key={name} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f0f0f0", fontSize: 13 }}>
                  <span><span style={{ fontWeight: 700, color: "#999", marginRight: 8 }}>{i + 1}</span>{name} <span style={{ fontSize: 11, color: "#999" }}>({v.count}회)</span></span>
                  <span style={{ fontWeight: 700 }}>{F(v.total)}</span>
                </div>
              ));
            })()}
          </div>
        </Card>
      </div>
    </div>
  );
});
