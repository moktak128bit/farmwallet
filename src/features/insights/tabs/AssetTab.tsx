import React from "react";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { C, F, W, Card, Kpi, pieLabel, type D } from "../insightsShared";

export const AssetTab = React.memo(function AssetTab({ d }: { d: D }) {
  const nw = d.netWorthByMonth;
  const current = nw.length > 0 ? nw[nw.length - 1].total : 0;
  const first = nw.length > 0 ? nw[0].total : 0;
  const growth = first > 0 ? Math.round((current / first - 1) * 100) : 0;
  const maxNW = nw.length > 0 ? Math.max(...nw.map(n => n.total)) : 0;
  const minNW = nw.length > 0 ? Math.min(...nw.map(n => n.total)) : 0;

  return (
    <div className="grid-2">
      <Card accent><Kpi label="현재 순자산" value={F(current)} sub={`${nw.length}개월 추적`} color="#48c9b0" /></Card>
      <Card accent><Kpi label="총 성장률" value={`${growth >= 0 ? "+" : ""}${growth}%`} sub={`시작: ${F(first)}`} color={growth >= 0 ? "#48c9b0" : "#e94560"} /></Card>

      {nw.length >= 2 && (
        <Card title="순자산 추이" span={2}>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={nw}>
              <defs><linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#48c9b0" stopOpacity={0.3} /><stop offset="95%" stopColor="#48c9b0" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={F} tick={{ fontSize: 11 }} domain={[Math.max(0, minNW * 0.9), maxNW * 1.05]} />
              <Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} />
              <Area type="monotone" dataKey="total" stroke="#48c9b0" fill="url(#nwGrad)" strokeWidth={2} name="순자산" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      )}

      {nw.length >= 2 && (
        <Card title="월별 수입 vs 지출" span={2}>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={nw}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={F} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="income" fill="#48c9b0" name="수입" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" fill="#e94560" name="지출" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {d.assetAllocation.length > 0 && (
        <Card title="자산 유형별 배분">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart><Pie data={d.assetAllocation} dataKey="value" cx="50%" cy="50%" outerRadius={105} innerRadius={50} label={pieLabel} labelLine={false} style={{ fontSize: 10 }}>
              {d.assetAllocation.map((_, i) => <Cell key={i} fill={C[i % C.length]} />)}
            </Pie><Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} /></PieChart>
          </ResponsiveContainer>
        </Card>
      )}

      <Card title="계좌별 잔액">
        <div style={{ maxHeight: 300, overflow: "auto" }}>
          {d.accountBalances.filter(a => a.balance !== 0).map(a => (
            <div key={a.name} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f0f0f0", fontSize: 13 }}>
              <span>{a.name} <span style={{ fontSize: 10, color: "#999" }}>({a.type})</span></span>
              <span style={{ fontWeight: 700, color: a.balance >= 0 ? "#333" : "#e94560" }}>{F(a.balance)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="AI 요약" span={2}>
        <div style={{ fontSize: 13, lineHeight: 1.8, color: "#444" }}>
          {nw.length >= 2 && (() => {
            const last3 = nw.slice(-3);
            const trend3 = last3.length >= 2 ? last3[last3.length - 1].total - last3[0].total : 0;
            const avgSav = d.months.length > 0 ? Math.round((d.pIncome - d.pExpense) / d.months.length) : 0;
            const lines: string[] = [];
            lines.push(`현재 순자산은 ${W(current)}이며, 추적 시작 이후 ${growth >= 0 ? "+" : ""}${growth}% 변화했습니다.`);
            if (trend3 > 0) lines.push(`최근 3개월간 ${W(trend3)} 증가 추세입니다.`);
            else if (trend3 < 0) lines.push(`최근 3개월간 ${W(Math.abs(trend3))} 감소했습니다. 지출 점검이 필요합니다.`);
            if (avgSav > 0) lines.push(`월 평균 ${W(avgSav)}를 저축하고 있습니다.`);
            if (d.passiveIncome > 0) lines.push(`패시브 수입(배당/이자)이 총 ${W(d.passiveIncome)}으로, 전체 수입의 ${Math.round(d.passiveIncome / d.pIncome * 100)}%입니다.`);
            if (d.assetAllocation.length >= 2) {
              const top = d.assetAllocation[0];
              lines.push(`자산의 ${Math.round(top.value / current * 100)}%가 ${top.name}에 집중되어 있습니다.`);
            }
            return lines.join(" ");
          })()}
        </div>
      </Card>
    </div>
  );
});
