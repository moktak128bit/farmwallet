import React from "react";
import { Info } from "lucide-react";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { C, F, W, Card, Kpi, Insight, Section, CT, pieLabel, type D } from "../insightsShared";
import { useFxRateValue } from "../../../context/FxRateContext";
import { useAppStore } from "../../../store/appStore";
import { isUSDStock } from "../../../utils/finance";

/** 손익 금액 부호 표기 — 0은 부호 없이 */
const signed = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + F(Math.abs(Math.round(n))) + "원";
/** 국내 관례: 이익 빨강 · 손실 파랑 */
const pnlColor = (n: number) => (n > 0 ? "var(--danger)" : n < 0 ? "var(--accent)" : "var(--text-muted)");

export const InvestTab = React.memo(function InvestTab({ d }: { d: D }) {
  const fxRate = useFxRateValue();
  const allTrades = useAppStore((s) => s.data.trades);
  // 환율 미로드 + 달러 거래 존재 → 실현손익 확정 불가. 환율 없이 계산하면 fxRateAtTrade 없는 달러 로트가 0원으로
  // 평가돼 매도대금 전액이 이익(또는 원가 전액이 손실)으로 잡혀 수백만 원씩 흔들린다 → 숫자 대신 "—".
  const fxPending = fxRate == null && (allTrades ?? []).some((t) => isUSDStock(t.ticker));
  const holdings = d.trades.map((v) => ({
    name: v.name.length > 20 ? v.name.slice(0, 20) + "…" : v.name,
    fullName: v.name,
    매수: v.buyTotal,
    매도: v.sellTotal,
  }));
  // 청산 종목 손익 = FIFO 기록(closedByStock) — 기간 필터된 거래의 평균단가로 계산하면
  // 이전 기간 매수 원가가 빠져 부호까지 반전됐다 (감사 확정). KPI '실현 손익'과 동일 방법론.
  // 매도원가·매도금액이 모두 0인 행은 금액이 비어 있는 매도 기록(데이터 확인 필요) — 손익 목록에서 뺀다.
  const zeroClosed = d.closedByStock.filter((s) => Math.round(s.cost) === 0 && Math.round(s.proceeds) === 0);
  const closedPL = d.closedByStock.filter((s) => !(Math.round(s.cost) === 0 && Math.round(s.proceeds) === 0));
  // 보유 규모·원금·집중도는 FIFO 잔여원가(holdingsByStock) 기준 — 누적 매수액(gross)은 매도-재매수 시 부풀려짐.
  const holdCost = d.holdingsByStock;
  // holdingsByStock은 시세가 없으면 평가액=원가(priceFallback "cost")라 평가손익 0으로 보인다 → 시세 없음으로 구분
  const noQuote = holdCost.filter((h) => Math.abs(h.valueKRW - h.costKRW) < 1);
  const quotesMissing = holdCost.length > 0 && noQuote.length === holdCost.length;
  const holdPnl = holdCost
    .filter((h) => Math.abs(h.valueKRW - h.costKRW) >= 1)
    .map((h) => ({ name: h.name, cost: h.costKRW, value: h.valueKRW, pnl: h.valueKRW - h.costKRW }))
    .sort((a, b) => a.pnl - b.pnl);
  const holdPnlTotal = holdPnl.reduce((s, h) => s + h.pnl, 0);
  const totalInvested = d.totalHoldingsCost;
  // selMonth 필터 시 해당 월만, 아니면 전체 합 — totalInvested(d.trades 기반)와 스코프 일치
  // divTrend는 d.months와 평행 배열 — YYYY-MM 인덱스로 조회 ("6월" 라벨 find는 다른 해와 충돌)
  const totalDiv = d.selMonth
    ? (d.divTrend[d.months.indexOf(d.selMonth)]?.amount ?? 0)
    : d.divTrend.reduce((s, m) => s + m.amount, 0);
  const totalBuy = holdings.reduce((s, h) => s + h.매수, 0);
  const totalSell = holdings.reduce((s, h) => s + h.매도, 0);

  // 포트폴리오 집중도 (HHI) — FIFO 보유원가(costKRW) 기준
  const hhi = totalInvested > 0 ? holdCost.reduce((s, h) => s + Math.pow(h.costKRW / totalInvested, 2), 0) : 0;
  const effectiveHoldings = hhi > 0 ? 1 / hhi : 0;
  const topShare = totalInvested > 0 && holdCost[0] ? (holdCost[0].costKRW / totalInvested) * 100 : 0;

  // 승수 (수익:손실 배수)
  const avgWin = d.realPL.winCnt > 0 ? d.realPL.wins / d.realPL.winCnt : 0;
  const avgLoss = d.realPL.lossCnt > 0 ? d.realPL.losses / d.realPL.lossCnt : 0;
  const winLossRatio = avgLoss > 0 ? avgWin / avgLoss : null;
  const winRate = d.realPL.winCnt + d.realPL.lossCnt > 0
    ? (d.realPL.winCnt / (d.realPL.winCnt + d.realPL.lossCnt)) * 100
    : null;
  // 건당 기댓값 = 승률×평균이익 − 패률×평균손실 (= 순 실현손익 ÷ 승패 건수)
  const decided = d.realPL.winCnt + d.realPL.lossCnt;
  const expectancy = decided > 0 ? (d.realPL.wins - d.realPL.losses) / decided : null;
  const topGain = closedPL.length > 0 && closedPL[0].pnl > 0 ? closedPL[0] : null;
  const topLoss = closedPL.length > 0 && closedPL[closedPL.length - 1].pnl < 0 ? closedPL[closedPL.length - 1] : null;
  // 배당이 들어온 달 수·마지막 수령 달 (기간 내)
  const divMonths = d.divTrend.filter((m) => m.amount > 0);
  const lastDiv = divMonths.length > 0 ? divMonths[divMonths.length - 1] : null;

  // 연환산 배당률 (기간 평균 투자원금 기준) — selMonth 시 해당 월만 보고 12배 환산
  const divYieldAnnualized = totalInvested > 0
    ? (totalDiv / totalInvested) * (12 / d.monthSpan) * 100
    : 0;

  // 매매 회전율 (연환산)
  const turnoverAnnualized = totalInvested > 0
    ? ((totalBuy + totalSell) / 2) / totalInvested * (12 / d.monthSpan)
    : 0;

  const periodLabel = d.selMonth
    ? d.selMonth
    : (d.months.length > 0 ? `${d.months[0]} ~ ${d.months[d.months.length - 1]}` : "-");
  const rangeLabel = d.selMonth ? `1개월 (${d.ml[d.selMonth] ?? d.selMonth})` : `${d.months.length}개월`;

  return (
    <div>
      {/* 상단 배너 */}
      <div style={{ padding: "10px 14px", background: "var(--bg)", borderRadius: 8, marginBottom: 16, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
        <Info size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} aria-hidden />범위: <strong>{rangeLabel}</strong> ({periodLabel}) · 단위: <strong>원</strong> · 실현손익 KPI는 라이프타임 누적(FIFO), 청산 목록·배당은 기간 내 체결 기준
        <div style={{ marginTop: 4 }}>
          손익 세 가지는 서로 다릅니다 — <strong>실현 손익</strong>: 다 판 거래의 매도금액 − FIFO 원가(현재가 무관) · <strong>평가손익</strong>: 보유분의 (현재가 − 평단) · 대시보드 <strong>누적 손익</strong>: 투자 계좌 평가액 − 넣은 원금(실현·평가·배당·수수료 모두 포함)
        </div>
        {fxPending && <div style={{ marginTop: 4, color: "var(--warning)" }}>환율을 아직 불러오지 못해 달러 거래가 섞인 실현손익은 "—"로 둡니다. 환율이 들어오면 확정됩니다.</div>}
      </div>

      {/* ============ 한눈에 ============ */}
      <Section storageKey="invest-section-overview" title="한눈에 보기">
        <Card accent><Kpi label="보유 종목 매입원가" value={F(totalInvested) + "원"} sub={`누적 매수(청산 포함) ${F(totalBuy)}원`} color="var(--warning)" info="현재 보유분의 매입원가(FIFO 잔여원가). 매도분·재매수 중복을 제외 — 누적 매수액과 다름" /></Card>
        <Card accent>
          <Kpi
            label="실현 손익 (전체 누적)"
            value={fxPending ? "—" : signed(d.realPL.total)}
            sub={fxPending ? "환율 확인 후 확정" : d.investReturnRate !== 0 ? `매도 원가 대비 ${d.investReturnRate.toFixed(1)}%` : "매도 내역 없음"}
            color={fxPending ? "var(--text-muted)" : pnlColor(d.realPL.total)}
            info="다 판 거래의 매도금액 − FIFO 매입원가 합(라이프타임, 기간 필터 무관). 현재 시세와 무관하며 보유분 평가손익·배당은 빠진다. 달러 거래는 거래 당시 환율로 환산"
          />
        </Card>
        <Card accent>
          <Kpi
            label="배당/이자 수입"
            value={F(totalDiv) + "원"}
            sub={totalInvested > 0 ? `원금 대비 연환산 ${divYieldAnnualized.toFixed(2)}% (이자 포함)` : "투자 원금 없음"}
            color="var(--success)"
            info="배당 + 이자 수입 합(예금·적금 이자 포함) · 연환산 = (합 ÷ 보유 종목 매입원가) × (12/개월수) — 분모는 주식 원가뿐이라 이자가 많으면 순수 배당률보다 높게 나온다"
          />
        </Card>
        <Card accent>
          <Kpi
            label="보유 종목 수"
            value={`${holdCost.length}종목`}
            sub={`청산 ${closedPL.length} · 실효 ${effectiveHoldings.toFixed(1)}개`}
            color="var(--text)"
            info="실효 종목 수 = 1 / HHI — 한 종목에 몰릴수록 작아짐"
          />
        </Card>

        <Card title="보유 종목 (매입원가 기준)" span={2}>
          {holdCost.length === 0 ? <div style={{ textAlign: "center", padding: 40, color: "var(--text-faint)" }}>보유 종목 없음</div> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={holdCost.slice(0, 10)} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                <XAxis type="number" tickFormatter={F} tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" width={150} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} />
                <Bar isAnimationActive={false} dataKey="costKRW" fill="var(--chart-series-b)" radius={[0, 6, 6, 0]} name="매입원가" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="포트폴리오 자산배분 (현재 보유 평가액)" span={2}>
          {d.portfolio.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie isAnimationActive={false} data={d.portfolio} dataKey="value" cx="50%" cy="50%" outerRadius={100} innerRadius={45} label={pieLabel} labelLine={false} style={{ fontSize: 11 }}>
                  {d.portfolio.map((_, i) => <Cell key={i} fill={C[i]} />)}
                </Pie>
                <Tooltip formatter={(v: ValueType | undefined) => W(Number(v ?? 0))} />
              </PieChart>
            </ResponsiveContainer>
          ) : <div style={{ textAlign: "center", padding: 40, color: "var(--text-faint)" }}>데이터 없음</div>}
        </Card>
      </Section>

      {/* ============ 손익 분해 (실현/미실현 × 수익/손실) ============ */}
      <Section storageKey="invest-section-pnl-breakdown" title="손익 분해 (실현/미실현 × 수익/손실)">
        <Card accent>
          <Kpi
            label="실현 수익"
            value={fxPending ? "—" : "+" + F(Math.round(d.investBreakdown.realizedGain)) + "원"}
            sub={fxPending ? "환율 확인 후 확정" : `이익 본 매도 ${d.realPL.winCnt}건`}
            color={fxPending ? "var(--text-muted)" : "var(--danger)"}
            info="FIFO 매칭으로 청산된 거래 중 이익 본 매도의 합 (양수). 라이프타임 누적"
          />
        </Card>
        <Card accent>
          <Kpi
            label="미실현 수익"
            value={quotesMissing ? "—" : "+" + F(Math.round(d.investBreakdown.unrealizedGain)) + "원"}
            sub={quotesMissing ? "시세 불러온 뒤 표시" : "보유 중 현재가 > 평단"}
            color={quotesMissing ? "var(--text-muted)" : "var(--danger)"}
            info="보유 종목별 (현재가 − 평단) × 수량 중 양수만 합. USD 종목은 현재 환율로 KRW 환산"
          />
        </Card>
        <Card accent>
          <Kpi
            label="실현 손실"
            value={fxPending ? "—" : "−" + F(Math.round(d.investBreakdown.realizedLoss)) + "원"}
            sub={fxPending ? "환율 확인 후 확정" : `손실 본 매도 ${d.realPL.lossCnt}건`}
            color={fxPending ? "var(--text-muted)" : "var(--accent)"}
            info="FIFO 매칭으로 청산된 거래 중 손실 본 매도의 절대값 합. 라이프타임 누적"
          />
        </Card>
        <Card accent>
          <Kpi
            label="미실현 손실"
            value={quotesMissing ? "—" : "−" + F(Math.round(d.investBreakdown.unrealizedLoss)) + "원"}
            sub={quotesMissing ? "시세 불러온 뒤 표시" : "보유 중 현재가 < 평단"}
            color={quotesMissing ? "var(--text-muted)" : "var(--accent)"}
            info="보유 종목별 (현재가 − 평단) × 수량 중 음수만 절대값 합. USD 종목은 현재 환율로 KRW 환산"
          />
        </Card>
      </Section>

      {/* ============ 포트폴리오 분산 ============ */}
      <Section storageKey="invest-section-diversification" title="포트폴리오 분산">
        <Card accent>
          <Kpi
            label="실효 종목 수"
            value={effectiveHoldings.toFixed(1) + "개"}
            sub={`실제 ${holdCost.length}종목 · HHI ${(hhi * 100).toFixed(1)}`}
            color="var(--text)"
            info="1 / Σ(비중²). 같은 비율 N개면 N, 한 종목에 몰릴수록 작음"
          />
        </Card>
        <Card accent>
          <Kpi
            label="최대 종목 비중"
            value={topShare.toFixed(1) + "%"}
            sub={holdCost[0]?.name ?? "-"}
            color="var(--text)"
            info="보유 매입원가 중 1위 종목 비중"
          />
        </Card>
        <Card accent>
          <Kpi
            label="매매 회전율 (연환산)"
            value={turnoverAnnualized.toFixed(2) + "x"}
            sub={`기간 거래 ${F(totalBuy + totalSell)}원`}
            color="var(--text)"
            info="연간 (매수+매도)/2 ÷ 보유 매입원가. 1x = 1년에 보유 원금만큼 사고판 셈"
          />
        </Card>
        <Card accent>
          <Kpi
            label="보유분 평가손익"
            value={quotesMissing ? "—" : signed(holdPnlTotal)}
            sub={quotesMissing ? "시세 불러온 뒤 표시" : noQuote.length > 0 ? `시세 없는 ${noQuote.length}종목 제외` : `${holdPnl.length}종목 · 현재가 기준`}
            color={quotesMissing ? "var(--text-muted)" : pnlColor(holdPnlTotal)}
            info="보유 종목별 (평가액 − FIFO 매입원가) 합. 달러 종목은 현재 환율로 환산"
          />
        </Card>

        {!quotesMissing && holdPnl.length > 0 && (
          <Card title="보유 종목별 평가손익 (손실 큰 순)" span={4}>
            <table className="data-table" style={{ width: "100%", fontSize: 12 }}>
              <thead>
                <tr><th>종목</th><th className="number">매입원가</th><th className="number">평가액</th><th className="number">평가손익</th><th className="number">수익률</th></tr>
              </thead>
              <tbody>
                {holdPnl.map((h) => (
                  <tr key={h.name}>
                    <td>{h.name}</td>
                    <td className="number">{F(Math.round(h.cost))}</td>
                    <td className="number">{F(Math.round(h.value))}</td>
                    <td className="number" style={{ color: pnlColor(h.pnl), fontWeight: 700 }}>{signed(h.pnl)}</td>
                    <td className="number" style={{ color: pnlColor(h.pnl) }}>{h.cost > 0 ? `${h.pnl >= 0 ? "+" : ""}${((h.pnl / h.cost) * 100).toFixed(1)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {noQuote.length > 0 && (
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>
                시세를 못 받은 종목: {noQuote.map((h) => h.name).join(", ")} — 평가손익에서 제외
              </div>
            )}
          </Card>
        )}
      </Section>

      {/* ============ 수익·매매 성과 ============ */}
      <Section storageKey="invest-section-performance" title="수익·매매 성과">
        <Card title="매매 성과 요약" span={2}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 14px", background: "var(--bg)", borderRadius: 8, color: "var(--text)" }}>
              <span style={{ fontWeight: 600 }}>순 실현손익</span>
              <span style={{ fontWeight: 800, color: fxPending ? "var(--text-muted)" : pnlColor(d.realPL.total), fontSize: 18 }}>
                {fxPending ? "—" : signed(d.realPL.total)}
              </span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ padding: "10px 12px", background: "var(--bg)", borderRadius: 8, textAlign: "center", color: "var(--text)" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>수익 ({d.realPL.winCnt}건)</div>
                <div style={{ fontWeight: 700, color: "var(--danger)" }}>{fxPending ? "—" : `+${F(Math.round(d.realPL.wins))}원`}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>평균 {F(Math.round(avgWin))}원</div>
              </div>
              <div style={{ padding: "10px 12px", background: "var(--bg)", borderRadius: 8, textAlign: "center", color: "var(--text)" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>손실 ({d.realPL.lossCnt}건)</div>
                <div style={{ fontWeight: 700, color: "var(--accent)" }}>{fxPending ? "—" : `−${F(Math.round(d.realPL.losses))}원`}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>평균 {F(Math.round(avgLoss))}원</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
              <div style={{ padding: "8px 10px", background: "var(--bg)", borderRadius: 6, textAlign: "center" }}>
                <div style={{ color: "var(--text-faint)" }}>승률</div>
                <div style={{ fontWeight: 700, color: "var(--text)" }}>
                  {winRate == null ? "-" : winRate.toFixed(0) + "%"}
                </div>
              </div>
              <div style={{ padding: "8px 10px", background: "var(--bg)", borderRadius: 6, textAlign: "center" }}>
                <div style={{ color: "var(--text-faint)" }}>수익:손실 배수</div>
                <div style={{ fontWeight: 700, color: "var(--text)" }}>
                  {winLossRatio == null ? "-" : winLossRatio.toFixed(2) + "x"}
                </div>
              </div>
            </div>
            {expectancy != null && !fxPending && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "6px 10px", background: "var(--bg)", borderRadius: 6, lineHeight: 1.5 }}>
                매도 1건당 평균 {signed(expectancy)} = 승률 {winRate?.toFixed(0)}% × 평균 이익 {F(Math.round(avgWin))}원 − {(100 - (winRate ?? 0)).toFixed(0)}% × 평균 손실 {F(Math.round(avgLoss))}원
              </div>
            )}
          </div>
        </Card>

        <Card title="청산 종목 손익 (FIFO 실현)" span={2}>
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 6 }}>
            매도 체결 건별 FIFO 실현손익의 종목 합 — 원가는 전체 매수 이력에서 소진. 상단 "실현 손익" KPI와 동일 방법 (기간 필터 시 매도일 기준).
            {zeroClosed.length > 0 && ` 금액이 0원인 매도 기록 ${zeroClosed.map((s) => `${s.name}(${s.count}건)`).join(", ")}은 제외 — 거래 금액을 확인하세요.`}
          </div>
          <div style={{ maxHeight: 340, overflow: "auto" }}>
            {fxPending ? <div style={{ textAlign: "center", padding: 40, color: "var(--text-faint)" }}>환율을 불러오면 표시합니다</div> : closedPL.length === 0 ? <div style={{ textAlign: "center", padding: 40, color: "var(--text-faint)" }}>기간 내 청산 매도 없음</div> : closedPL.map((s) => (
              <div key={s.name} style={{ padding: "8px 0", borderBottom: "1px solid var(--border-light)" }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{s.name} <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>({s.count}건)</span></div>
                <div style={{ display: "flex", gap: 12, fontSize: 11, marginTop: 2 }}>
                  <span style={{ color: "var(--text-faint)" }}>매도원가 {F(Math.round(s.cost))}원</span>
                  <span style={{ color: "var(--text-faint)" }}>매도금액 {F(Math.round(s.proceeds))}원</span>
                  <span style={{ color: s.pnl >= 0 ? "var(--danger)" : "var(--accent)", fontWeight: 700, marginLeft: "auto" }}>
                    {s.pnl >= 0 ? "+" : ""}{F(Math.round(s.pnl))}원
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="배당/이자 수입 추이 (월별)" span={4}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={d.divTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
              <XAxis dataKey="l" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={F} tick={{ fontSize: 11 }} />
              <Tooltip content={<CT />} />
              <Bar isAnimationActive={false} dataKey="amount" fill="var(--chart-income)" radius={[4, 4, 0, 0]} name="배당/이자" />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11, color: "var(--text-faint)", textAlign: "center", marginTop: 4 }}>
            투자 계좌에서 발생한 배당·이자 등 패시브 수입 월별 합 (투자수익은 실현손익·재테크로 별도 집계)
          </div>
        </Card>
      </Section>

      {/* ============ 인사이트 ============ */}
      <Section storageKey="invest-section-insights" title="인사이트">
        <Card title="투자 종합 인사이트" span={4}>
          <div className="grid-2" style={{ gap: 12 }}>
            {holdCost[0] && <Insight title="어디에 몰려 있나" tone="info">
              1위 {holdCost[0].name} {F(holdCost[0].costKRW)}원({topShare.toFixed(1)}%)
              {holdCost.length > 1 ? ` · 2위 ${holdCost[1].name} ${F(holdCost[1].costKRW)}원` : ""}
              {holdCost.length > 2 && totalInvested > 0 ? ` · 상위 3종목 합계 ${((holdCost.slice(0, 3).reduce((s, h) => s + h.costKRW, 0) / totalInvested) * 100).toFixed(0)}%` : ""}
              . 보유 {holdCost.length}종목이지만 집중도로 보면 같은 비중 {effectiveHoldings.toFixed(1)}종목을 들고 있는 것과 같습니다(매입원가 기준).
            </Insight>}
            <Insight title="얼마나 사고팔았나" color="var(--chart-series-c)" bg="var(--bg)">
              {d.selMonth ? "이 달" : "기간"} 매수 {F(totalBuy)}원 · 매도 {F(totalSell)}원. 연환산 회전율 {turnoverAnnualized.toFixed(2)}x — 1년에 보유 원금의 {turnoverAnnualized.toFixed(1)}배를 사고판 속도입니다.
            </Insight>
            <Insight title="배당/이자 수입" tone="success">
              {totalDiv > 0
                ? `${d.selMonth ? "이 달" : `${d.months.length}개월`} ${F(totalDiv)}원 · ${divMonths.length}개월에 수령${lastDiv ? ` · 마지막 수령 ${lastDiv.l} ${F(lastDiv.amount)}원` : ""}. 보유 매입원가 대비 연환산 ${divYieldAnnualized.toFixed(2)}% (예금·CMA 이자 포함, 매도한 종목의 과거 배당도 섞임).`
                : "기간 내 배당·이자 기록이 없습니다."}
            </Insight>
            <Insight title="매매 결과" tone="warning">
              {fxPending ? "환율을 불러오면 달러 거래까지 포함해 계산합니다."
                : decided > 0
                  ? <>
                      {decided}건 청산 · 이긴 매도 {d.realPL.winCnt}건(승률 {winRate?.toFixed(0)}%) · 순 실현손익 {signed(d.realPL.total)}.
                      {winLossRatio != null && winLossRatio < 1
                        ? ` 평균 손실 ${F(Math.round(avgLoss))}원이 평균 이익 ${F(Math.round(avgWin))}원의 ${(1 / winLossRatio).toFixed(1)}배 — ${d.realPL.total >= 0 ? "자주 이겨서 남겼지만 질 때 크게 졌습니다" : "이긴 횟수로 큰 손실을 메우지 못했습니다"}.`
                        : winLossRatio != null ? ` 평균 이익 ${F(Math.round(avgWin))}원 · 평균 손실 ${F(Math.round(avgLoss))}원 (배수 ${winLossRatio.toFixed(2)}x).` : ""}
                      {topGain ? ` 가장 많이 번 종목 ${topGain.name} ${signed(topGain.pnl)}` : ""}
                      {topLoss ? `${topGain ? "," : ""} 가장 많이 잃은 종목 ${topLoss.name} ${signed(topLoss.pnl)}` : ""}
                      {(topGain || topLoss) ? (d.selMonth ? " (이 달 매도 기준)." : " (기간 내 매도 기준).") : ""}
                    </>
                  : "매도 내역이 없어 실현 성과가 없습니다."}
            </Insight>
          </div>
        </Card>

        {d.investBySub.length > 0 && (
          <Card title="가계부에 직접 입력한 재테크 손익·비용" span={4}>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 6 }}>
              주식 거래 기록이 아니라 가계부에 재테크 분류로 적은 항목(투자손익·수수료 등)입니다. 매매 실현손익과는 따로 집계됩니다.
            </div>
            <table className="data-table" style={{ width: "100%", fontSize: 12 }}>
              <thead><tr><th>분류</th><th className="number">건수</th><th className="number">합계</th></tr></thead>
              <tbody>
                {d.investBySub.map((v) => (
                  <tr key={v.sub}><td>{v.sub}</td><td className="number">{v.count}</td><td className="number">{F(v.amount)}원</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </Section>
    </div>
  );
});
