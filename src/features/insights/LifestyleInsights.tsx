import React, { useMemo, useState } from "react";
import type { Account, CategoryPresets, LedgerEntry } from "../../types";
import { STORAGE_KEYS } from "../../constants/config";
import { CommitInput } from "../../components/ui/CommitInput";
import { Money } from "../../components/ui/Money";
import { exportLedgerCsv } from "../../utils/csvExport";
import { getTodayKST } from "../../utils/date";
import { buildLifestyleInsights, parseLifestyleAssumptions, VEHICLE_COST_LABELS,
  type LifestyleAssumptions, type VehicleOverride } from "../../utils/lifestyleInsights";
import { W } from "./insightsShared";

const cardStyle: React.CSSProperties = { border: "1px solid var(--border)", borderRadius: 10, padding: 16 };
const gridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 270px), 1fr))", gap: 12 };
const hintStyle: React.CSSProperties = { fontSize: 12, lineHeight: 1.7, color: "var(--text-muted)" };
const money = (value: number | null) => value == null ? "—" : W(Math.round(value));

function loadAssumptions(): LifestyleAssumptions {
  try { return parseLifestyleAssumptions(localStorage.getItem(STORAGE_KEYS.LIFESTYLE_INSIGHTS)); }
  catch { return parseLifestyleAssumptions(null); }
}

export function LifestyleInsights({ ledger, accounts, categoryPresets, fxRate, targetMonth, holdings }: {
  ledger: LedgerEntry[]; accounts: Account[]; categoryPresets: CategoryPresets; fxRate: number | null;
  targetMonth: string; holdings: { name: string; valueKRW: number; costKRW: number }[];
}) {
  const [assumptions, setAssumptions] = useState(loadAssumptions);
  const [error, setError] = useState("");
  const [categoryChoice, setCategoryChoice] = useState("");
  const [scenarioScope, setScenarioScope] = useState("main");
  const [cancelledSubscriptions, setCancelledSubscriptions] = useState<Set<string>>(new Set());
  const [recordSearch, setRecordSearch] = useState("");
  const today = getTodayKST();
  const model = useMemo(() => buildLifestyleInsights({ ledger, accounts, categoryPresets, fxRate, targetMonth, holdings, assumptions, today }),
    [ledger, accounts, categoryPresets, fxRate, targetMonth, holdings, assumptions, today]);
  const update = (next: LifestyleAssumptions) => {
    setAssumptions(next);
    try { localStorage.setItem(STORAGE_KEYS.LIFESTYLE_INSIGHTS, JSON.stringify(next)); setError(""); }
    catch { setError("가정은 적용됐지만 기기에 저장하지 못했습니다."); }
  };
  const commitNumber = (field: "replacementMonthly" | "depreciationMonthly" | "plannedInvestmentMonthly" | "reductionPct", raw: string) => {
    const cleaned = raw.replace(/[,\s]/g, "");
    if (!cleaned && (field === "replacementMonthly" || field === "depreciationMonthly")) {
      update({ ...assumptions, [field]: null }); return;
    }
    if (!/^\d+(\.\d+)?$/.test(cleaned)) { setError("0 이상의 숫자를 입력하세요. 쉼표는 사용할 수 있습니다."); return; }
    const value = Number(cleaned);
    if (!Number.isFinite(value) || value > (field === "reductionPct" ? 100 : 1_000_000_000)) {
      setError(field === "reductionPct" ? "감축률은 0~100%로 입력하세요." : "금액은 10억 원 이하로 입력하세요."); return;
    }
    update({ ...assumptions, [field]: value });
  };
  const field = (label: string, name: "replacementMonthly" | "depreciationMonthly" | "plannedInvestmentMonthly" | "reductionPct", suffix = "원/월") => <label style={{ display: "block", fontSize: 13, marginTop: 12 }}>
    <span style={{ display: "block", marginBottom: 6 }}>{label}</span>
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <CommitInput aria-label={label} inputMode="decimal" value={assumptions[name] == null ? "" : String(assumptions[name])}
        placeholder={name === "replacementMonthly" ? "대중교통·택시·렌트 합계" : "직접 입력"}
        onCommit={raw => commitNumber(name, raw)} style={{ width: "100%", minWidth: 0 }} />
      <span style={{ whiteSpace: "nowrap", color: "var(--text-muted)", fontSize: 12 }}>{suffix}</span>
    </div>
  </label>;
  const scenarioCategories = scenarioScope === "detail" ? model.detailCategories : model.categories;
  const category = scenarioCategories.find(row => row.name === categoryChoice) ?? scenarioCategories[0];
  const cancelledMonthly = model.subscriptions.filter(row => cancelledSubscriptions.has(row.name)).reduce((sum, row) => sum + (row.monthlyAverage ?? 0), 0);
  const referenceLabel = `직전 12개월 중 기록이 있는 ${model.baselineMonths.length}개월의 월평균`;
  const targetLabel = `${targetMonth.replace("-", ".")} ${model.partialDay == null ? "월 전체" : `1~${model.partialDay}일 기록`}`;
  const records = model.current.records.filter(row => [row.main, row.detail, row.entry.description].join(" ").toLowerCase().includes(recordSearch.toLowerCase()));

  return <section className="card" aria-label="월별 생활 분석과 시나리오" style={{ padding: 18, marginTop: 16, marginBottom: 20 }}>
    <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>월별 생활 분석과 시나리오</h2>
    <p style={hintStyle}>{targetLabel} · 모든 지출 분류를 정리합니다. 월 선택은 상단에서 바꿀 수 있습니다.
      계획용 평균은 기간 버튼과 관계없이 {referenceLabel}을 사용합니다. 기록이 없는 달은 평균에서 제외합니다.</p>
    {error && <p role="alert" style={{ ...hintStyle, color: "var(--danger)" }}>{error}</p>}
    {model.missingFx ? <p role="status">달러 거래의 환율이 없어 생활비 계산을 보류합니다. 환율을 불러온 뒤 확인하세요.</p> : <>
      {model.daysSinceLastRecord != null && model.daysSinceLastRecord >= 7 && <p style={{ ...hintStyle, background: "var(--warning-light)", padding: 12, borderRadius: 8 }}>
        마지막 기록 {model.latestRecord} · {model.daysSinceLastRecord}일간 새 기록이 없습니다. 낮게 표시된 지출을 절약 성과로 단정하지 말고 누락 거래를 확인하세요.
      </p>}
      <div style={gridStyle}>
        <article style={cardStyle}><h3 style={{ fontSize: 14, marginTop: 0 }}>한 달 주유·충전비</h3>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{model.hasCurrent ? <Money value={Math.round(model.current.fuel)} /> : "기록 없음"}</div>
          <p style={hintStyle}>{targetLabel}<br />완료된 기록월 평균 {money(model.averages.fuel)} · 연 환산 {money(model.averages.fuel == null ? null : model.averages.fuel * 12)}</p>
          <p style={hintStyle}>선택월 {model.fuelCount}건 · 건당 {model.fuelCount > 0 ? money(model.current.fuel / model.fuelCount) : "거래 없음"}. 주행거리·연료량이 없어 km당 비용이나 연비는 추정하지 않습니다.</p>
        </article>
        <article style={cardStyle}><h3 style={{ fontSize: 14, marginTop: 0 }}>차량 운영비 전체</h3>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{model.hasCurrent ? <Money value={Math.round(model.current.vehicleOperating)} /> : "기록 없음"}</div>
          <p style={hintStyle}>주유·정비·보험·세금·주차·통행료·세차<br />완료된 기록월 평균 {money(model.averages.vehicleOperating)}<br />구입·할부는 별도: {model.hasCurrent ? money(model.current.vehicleCapital) : "—"}</p>
        </article>
        <article style={cardStyle}><h3 style={{ fontSize: 14, marginTop: 0 }}>매달 투자 계획 점검</h3>
          {field("월 투자 계획", "plannedInvestmentMonthly")}
          <p style={hintStyle}>근로소득 평균 {money(model.averageIncome)} − 장부지출 평균 {money(model.averageExpense)} − 투자 계획 {money(assumptions.plannedInvestmentMonthly)}</p>
          <div style={{ fontSize: 20, fontWeight: 700, color: model.afterPlannedInvestment != null && model.afterPlannedInvestment < 0 ? "var(--danger)" : "var(--text)" }}>
            투자 후 {money(model.afterPlannedInvestment)}
          </div>
          <p style={hintStyle}>근로소득은 상여·수당을 포함합니다. 정산·대출·처분소득은 계획 수입으로 넣지 않습니다. 공동계좌 분담·환급을 차감하지 않은 장부 기준입니다. 추가 저축·별도 상환·앞으로의 지출은 직접 확인하세요.</p>
        </article>
      </div>

      <details open style={{ marginTop: 20 }}><summary style={{ fontSize: 15, fontWeight: 700, cursor: "pointer" }}>차가 없었다면 · 월/연간/5년 비용 차이</summary>
        <div style={{ ...gridStyle, marginTop: 12 }}>
          <article style={cardStyle}><h3 style={{ fontSize: 14, marginTop: 0 }}>계산 가정</h3>
            {field("차 없이 쓸 대체 교통비", "replacementMonthly")}
            {field("추정 감가상각 비용 (선택)", "depreciationMonthly")}
            <p style={hintStyle}>대체 교통비는 기존 버스·택시비 외에 새로 늘어날 월 비용을 입력하세요. 빈칸은 미입력, 0원은 대체 비용이 없다는 가정입니다.</p>
          </article>
          <article style={cardStyle}><h3 style={{ fontSize: 14, marginTop: 0 }}>차량 운영비 − 추가 대체 교통비</h3>
            <p style={{ fontSize: 14, lineHeight: 1.8 }}>월 {money(model.averages.vehicleOperating)} − {money(assumptions.replacementMonthly)}</p>
            <div style={{ fontSize: 23, fontWeight: 700 }}>{money(model.carless.monthly)} / 월</div>
            <p style={{ fontSize: 14, lineHeight: 1.8 }}>연 환산 {money(model.carless.annual)}<br />5년 단순 합계 {money(model.carless.fiveYears)}</p>
            <p style={hintStyle}>{model.carless.monthly == null ? "과거 기록과 대체 교통비가 있어야 계산합니다." : model.carless.monthly < 0 ? "이 가정에서는 대체 교통비가 더 큽니다." : "양수는 이 가정에서 현금 지출이 줄어드는 금액입니다."}</p>
          </article>
          <article style={cardStyle}><h3 style={{ fontSize: 14, marginTop: 0 }}>감가상각을 포함한 비용 차이</h3>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{money(model.carless.withDepreciationMonthly)} / 월</div>
            <p style={hintStyle}>감가상각은 차량 가치 하락에 대한 직접 입력 추정이며 통장에 남는 돈과 다릅니다.
              차 판매대금·할부 잔액·중도상환·보험 환급·출퇴근 시간은 계산하지 않습니다. 구입·할부는 자동 절약액에서 제외합니다.
              연/5년은 같은 비용이 유지된다는 가정이며 투자 수익·물가 상승을 넣지 않습니다.</p>
          </article>
        </div>
        <div style={{ overflowX: "auto", marginTop: 14 }}><table className="data-table" style={{ width: "100%", fontSize: 13 }}>
          <caption style={{ textAlign: "left", marginBottom: 8 }}>차량 비용 분해 · 실제 기록과 계획용 월평균</caption>
          <thead><tr><th>항목</th><th className="number">선택월 기록</th><th className="number">기록월 월평균</th></tr></thead>
          <tbody>{model.vehicleBreakdown.map(row => <tr key={row.kind}><td>{row.label}</td><td className="number">{model.hasCurrent ? money(row.amount) : "—"}</td><td className="number">{money(row.monthlyAverage)}</td></tr>)}</tbody>
        </table></div>
      </details>

      <details style={{ marginTop: 20 }}><summary style={{ fontSize: 15, fontWeight: 700, cursor: "pointer" }}>최근 12개월 생활비·주유비·차량비 전체 표</summary>
        <div style={{ overflowX: "auto", marginTop: 12 }}><table className="data-table" style={{ width: "100%", fontSize: 13 }}>
          <thead><tr><th>월</th>{["근로소득", "지출", "주유·충전", "차량 운영", "차량 구입·할부", "구독", "저축·투자이체"].map(label => <th className="number" key={label}>{label}</th>)}</tr></thead>
          <tbody>{model.monthly.map(row => <tr key={row.month}><td style={{ whiteSpace: "nowrap" }}>{row.month}{row.partial && " (진행 중)"}{!row.recorded && " · 기록 없음"}</td>
            {[row.income, row.expense, row.fuel, row.vehicleOperating, row.vehicleCapital, row.subscription, row.investmentTransfers].map((value, i) => <td className="number" key={i}>{row.recorded ? money(value) : "—"}</td>)}
          </tr>)}</tbody>
        </table></div><p style={hintStyle}>각 달은 월 전체 기록, 이번 달은 오늘까지 기록입니다. 진행 중인 달을 완료월 전체와 직접 비교하지 않습니다. 주유·차량·구독은 지출에 이미 포함된 부분합이므로 다시 더하지 마세요.</p>
      </details>

      <details open style={{ marginTop: 20 }}><summary style={{ fontSize: 15, fontWeight: 700, cursor: "pointer" }}>모든 지출 분류와 줄였을 때의 변화</summary>
        <p style={hintStyle}>고정비 평균 {money(model.averages.fixed)} · 변동비 {money(model.averages.variable)} · 재량 지출 {money(model.averages.discretionary)}</p>
        <div style={{ overflowX: "auto" }}><table className="data-table" style={{ width: "100%", fontSize: 13 }}>
          <thead><tr><th>지출 분류</th><th className="number">선택월</th><th className="number">건수</th><th className="number">기록월 월평균</th></tr></thead>
          <tbody>{model.categories.map(row => <tr key={row.name}><td>{row.name}</td><td className="number">{model.hasCurrent ? money(row.amount) : "—"}</td><td className="number">{model.hasCurrent ? row.count : "—"}</td><td className="number">{money(row.monthlyAverage)}</td></tr>)}</tbody>
        </table></div>
        <details style={{ marginTop: 12 }}><summary style={{ fontSize: 13, fontWeight: 600, cursor: "pointer" }}>세부 분류·지출처까지 보기</summary>
          <div style={{ overflowX: "auto", marginTop: 10 }}><table className="data-table" style={{ width: "100%", fontSize: 13 }}>
            <thead><tr><th>세부 분류·지출처</th><th className="number">선택월</th><th className="number">건수</th><th className="number">기록월 월평균</th></tr></thead>
            <tbody>{model.detailCategories.map(row => <tr key={row.name}><td>{row.name}</td><td className="number">{model.hasCurrent ? money(row.amount) : "—"}</td><td className="number">{model.hasCurrent ? row.count : "—"}</td><td className="number">{money(row.monthlyAverage)}</td></tr>)}</tbody>
          </table></div>
        </details>
        <div style={{ ...gridStyle, marginTop: 14 }}><article style={cardStyle}>
          <h3 style={{ fontSize: 14, marginTop: 0 }}>이 지출을 줄인다면</h3>
          <label style={{ display: "block", fontSize: 13, marginBottom: 10 }}>감축 대상 범위<select aria-label="감축 대상 범위" value={scenarioScope} onChange={event => setScenarioScope(event.target.value)} style={{ display: "block", width: "100%", marginTop: 6 }}>
            <option value="main">대분류 전체</option><option value="detail">세부 분류·지출처</option>
          </select></label>
          <label style={{ fontSize: 13 }}>줄일 지출 분류<select aria-label="줄일 지출 분류" value={category?.name ?? ""} onChange={event => setCategoryChoice(event.target.value)} style={{ display: "block", width: "100%", marginTop: 6 }}>
            {scenarioCategories.map(row => <option key={row.name} value={row.name}>{row.name}</option>)}
          </select></label>{field("지출 감축률", "reductionPct", "%")}
          <p style={{ fontSize: 14, lineHeight: 1.8 }}>월 {money(category?.reductionMonthly ?? null)} · 연 환산 {money(category?.reductionMonthly == null ? null : category.reductionMonthly * 12)}</p>
          <p style={hintStyle}>이 항목만 감축했을 때 투자 계획 후 잔여: {money(model.afterPlannedInvestment != null && category?.reductionMonthly != null ? model.afterPlannedInvestment + category.reductionMonthly : null)}</p>
          <p style={hintStyle}>과거 월평균의 {assumptions.reductionPct}%를 줄인다는 가정입니다. 실제로 줄일 수 있는 금액이라는 뜻은 아닙니다. 다른 시나리오와 중복 합산하지 않습니다.</p>
        </article><article style={cardStyle}><h3 style={{ fontSize: 14, marginTop: 0 }}>기록된 구독 결제를 정리한다면</h3>
          {model.subscriptions.length === 0 ? <p style={hintStyle}>기준 기간에 구독 결제가 없습니다. 구독비 분류로 기록한 결제를 분석합니다.</p> : model.subscriptions.map(row => <label key={row.name} style={{ display: "flex", gap: 8, fontSize: 13, marginBottom: 8, lineHeight: 1.7 }}>
            <input type="checkbox" checked={cancelledSubscriptions.has(row.name)} onChange={event => setCancelledSubscriptions(previous => {
              const next = new Set(previous); if (event.target.checked) next.add(row.name); else next.delete(row.name); return next;
            })} /><span>{row.name} · 월평균 {money(row.monthlyAverage)} ({row.activeMonths}개월 결제 기록)</span>
          </label>)}
          <p style={{ fontSize: 14, fontWeight: 700 }}>선택한 결제를 없앤 가정: 월 {money(cancelledMonthly)} · 연 {money(cancelledMonthly * 12)}</p>
          <p style={hintStyle}>해지 기능이 아닌 계산입니다. 현재 구독 상태·연간 약정·환불 조건은 직접 확인하세요.</p>
        </article></div>
      </details>

      <details style={{ marginTop: 20 }}><summary style={{ fontSize: 15, fontWeight: 700, cursor: "pointer" }}>비정기·큰 지출을 위한 월 준비금</summary>
        <p style={hintStyle}>3개월 이상 기록에서 절반 이하의 달에 발생하고 합계 5만 원 이상인 세부 항목입니다. 일회성 거래도 포함되므로 앞으로 반복될 비용만 준비금에 반영하세요.</p>
        <div style={{ overflowX: "auto" }}><table className="data-table" style={{ width: "100%", fontSize: 13 }}>
          <thead><tr><th>항목</th><th className="number">기준기간 합계</th><th className="number">발생월</th><th className="number">월 준비금 참고액</th></tr></thead>
          <tbody>{model.occasional.map(row => <tr key={row.name}><td>{row.name}</td><td className="number">{money(row.amount)}</td><td className="number">{row.activeMonths}/{model.baselineMonths.length}</td><td className="number">{money(row.monthlyReserve)}</td></tr>)}</tbody>
        </table></div>{model.occasional.length === 0 && <p style={hintStyle}>분석할 기록이 부족하거나 조건에 맞는 비정기 지출이 없습니다.</p>}
        <p style={hintStyle}>참고액 = 기준기간 지출 ÷ 기록월 수. 앞으로의 청구액이나 연간 확정 비용을 예측한 값이 아니며, 위 지출 평균에 이미 포함되어 있습니다.</p>
      </details>

      <details style={{ marginTop: 20 }}><summary style={{ fontSize: 15, fontWeight: 700, cursor: "pointer" }}>분류 확인·수정과 선택월 거래 전체</summary>
        <p style={hintStyle}>차량 분류는 분류명·메모에 따른 자동 추정입니다. 교통비 전체를 주유비로 보지 않습니다. 수정은 원본 가계부를 바꾸지 않고 이 분석에만 적용됩니다.</p>
        <input aria-label="생활 분석 거래 검색" placeholder="주유소·카테고리·메모 검색" value={recordSearch} onChange={event => setRecordSearch(event.target.value)} style={{ width: "100%", marginBottom: 10 }} />
        <button type="button" className="secondary" disabled={records.length === 0} onClick={() => exportLedgerCsv(records.map(row => row.entry), accounts, `생활분석_${targetMonth}.csv`)}>표시된 거래 CSV 저장</button>
        <div style={{ overflowX: "auto", marginTop: 10 }}><table className="data-table" style={{ width: "100%", fontSize: 13 }}>
          <thead><tr><th>날짜</th><th>분류·거래</th><th className="number">금액</th><th>차량 분류</th></tr></thead>
          <tbody>{records.map(row => <tr key={row.entry.id}><td style={{ whiteSpace: "nowrap" }}>{row.entry.date}</td><td>{row.main} · {row.entry.description || row.detail}</td><td className="number">{money(row.amount)}</td><td>
            <select aria-label={`차량 분류 ${row.entry.id}`} value={assumptions.vehicleOverrides[row.entry.id] ?? "auto"} onChange={event => {
              const next = { ...assumptions.vehicleOverrides };
              if (event.target.value === "auto") delete next[row.entry.id]; else next[row.entry.id] = event.target.value as VehicleOverride;
              update({ ...assumptions, vehicleOverrides: next });
            }}><option value="auto">자동: {row.vehicle ? VEHICLE_COST_LABELS[row.vehicle] : "차량 아님"}</option><option value="exclude">차량 비용에서 제외</option>
              {Object.entries(VEHICLE_COST_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
            </select></td></tr>)}</tbody>
        </table></div>
      </details>
    </>}

    <details style={{ marginTop: 20 }}><summary style={{ fontSize: 15, fontWeight: 700, cursor: "pointer" }}>투자 집중도와 하락 시 금액 변화</summary>
      <p style={hintStyle}>앱에 집계된 현재 보유 평가액 기준입니다. 시세가 갱신되지 않았다면 오래된 값일 수 있습니다. 월 선택과 관계없고, ETF 내부 편입 종목·산업까지 분산을 확인한 결과는 아닙니다.</p>
      {model.investmentValue > 0 ? <>
        <p style={{ fontSize: 14 }}>최대 보유 종목 {model.holdings[0].name} · {model.holdings[0].share.toFixed(1)}% · {money(model.holdings[0].valueKRW)}</p>
        <div style={{ overflowX: "auto" }}><table className="data-table" style={{ width: "100%", fontSize: 13 }}><thead><tr><th>종목</th><th className="number">평가액</th><th className="number">비중</th></tr></thead>
          <tbody>{model.holdings.map(row => <tr key={row.name}><td>{row.name}</td><td className="number">{money(row.valueKRW)}</td><td className="number">{row.share.toFixed(1)}%</td></tr>)}</tbody></table></div>
        <p style={hintStyle}>현재 평가액에서 모든 보유 종목이 같은 비율로 하락한다고 가정합니다. 하락 예측이나 매매 권유가 아닙니다.</p>
        <div style={gridStyle}>{[10, 20, 30].map(pct => <article key={pct} style={cardStyle}><strong>{pct}% 하락 가정</strong><p>감소액 {money(model.investmentValue * pct / 100)}<br />남는 평가액 {money(model.investmentValue * (1 - pct / 100))}</p></article>)}</div>
      </> : <p style={hintStyle}>양수 평가액의 보유 종목이 없어 투자 집중도를 계산하지 않습니다.</p>}
    </details>
    <p style={{ ...hintStyle, marginBottom: 0, marginTop: 18 }}>가정과 차량 분류 수정은 이 기기에 저장되며 Gist·데이터 백업에는 포함되지 않습니다.
      실제 기록과 시나리오는 구분됩니다. 미입력·분류 오류가 있으면 결과가 달라지며, 별도 표시된 부분합·시나리오를 서로 더하지 마세요.</p>
  </section>;
}
