/**
 * 인사이트 선택월(selMonth) 파생 — 순수 함수 (React 의존 없음).
 *
 * useInsightsData 2단 분층의 2단: buildInsightsBase(insightsBase.ts) 결과에 selMonth를 적용해
 * 탭들이 쓰는 D 객체를 만든다. 월 선택이 바뀌면 이 함수만 다시 돈다(전기간 집계는 base에서 재사용).
 *
 * ⚠ 동작 불변 리팩터 — 블록·키·값은 useInsightsData 원본 그대로. 반환 객체의 키 순서도 동일하게 유지.
 *   골든 스냅샷(src/__tests__/insightsDataGolden.test.tsx)이 출력 전체를 고정한다.
 * ⚠ 오늘(KST) 의존 값(무지출일 분모·진행 중인 달 캡·완결 월 수)은 여기서 매번 계산 — base 캐시와 무관.
 */
import { computeIncomeGrowth, computeSpendingInertia, computeCategoryGrowth } from "../../utils/insightsTrends";
import { computeEntryOutliers, computePatternStats } from "../../utils/insightsPatterns";
import { calcTrend, computePeriodScope } from "../../utils/insightsHelpers";
import { isInvestmentLossEntry } from "../../utils/category";
import { expenseMainName } from "../../utils/categoryMerge";
import { tradeAmountKRW, canonicalTickerForMatch } from "../../utils/finance";
import { detectSpendAnomalies } from "../../utils/anomaly";
import { classifyIncomeNature } from "../../utils/realIncome";
import { computeExpenseNatureTotals } from "../../utils/fixedExpense";
import { isDateEntry } from "../../utils/dateAccounting";
import { computeRealSavingsRate } from "../../utils/savingsRate";
import { parseIsoLocal, formatIsoLocal, getTodayKST, getThisMonthKST } from "../../utils/date";
import {
  F, SD,
  type D, type SubInsight, type IncSubInsight, type DateSubInsight, type InvestSubInsight,
} from "./insightsShared";
import { expSubName, isSubEntry, type InsightsBase } from "./insightsBase";

export function sliceInsightsForMonth(base: InsightsBase, selMonth: string | null): D {
  const {
    ledger, rawTrades, categoryPresets, fxRate,
    aMap, invIds, moimIds, amt, flowOf,
    monthly, months, ml, realFlows,
    salaryKeys, investIncKeys, nonRealKeys, salaryMonthly,
    allClosedRecords, periodSellIds, realPL,
  } = base;

  /* ===== filter for period ===== */
  const fL = selMonth ? ledger.filter(l => l.date?.startsWith(selMonth)) : ledger;
  const fT = selMonth ? rawTrades.filter(t => t.date?.startsWith(selMonth)) : rawTrades;
  // 일반 지출 = classifyLedgerFlow "expense" — 신용결제·환전·저축성지출·투자손실 제외가 대시보드와 동일 기준.
  // (신용결제: 카드 사용 시점에 이미 잡힘 — 이중계상 방지. 투자손익: 재테크 순집계로.)
  const fExp = fL.filter(l => Number(l.amount) > 0 && flowOf(l) === "expense");
  // 수입 = classifyLedgerFlow "income" — 이월/퇴직연금·투자수익 제외 (투자수익은 재테크로).
  const fInc = fL.filter(l => Number(l.amount) > 0 && flowOf(l) === "income");

  /* period totals */
  const pIncome = fInc.reduce((s, l) => s + amt(l), 0);
  const pExpense = fExp.reduce((s, l) => s + amt(l), 0);
  // 재테크 = 저축·투자 이체 + 투자수익(+) − 투자손실(−) + 증권계좌로의 일반 이체(인사이트 확장)
  let pInvest = 0;
  for (const l of fL) {
    if (Number(l.amount) <= 0) continue;
    const flow = flowOf(l);
    if (flow === "investing") pInvest += isInvestmentLossEntry(l) ? -amt(l) : amt(l);
    else if (flow === null && l.kind === "transfer" && l.toAccountId && invIds.has(l.toAccountId)) pInvest += amt(l);
  }
  /* ===== 실질 수입/지출 (정산·일시소득 제외, USD 환산, 데이트 50% 분담) — base.realFlows(utils/savingsRate 단일 소스) ===== */
  let realIncome = 0, realExpense = 0, settlementTotal = 0, tempIncomeTotal = 0, dateAccountSpend = 0, datePartnerShare = 0;
  {
    const flowMonths = selMonth ? [selMonth] : months;
    for (const m of flowMonths) {
      const rf = realFlows.get(m); if (!rf) continue;
      realIncome += rf.realIncome; realExpense += rf.realExpense;
      settlementTotal += rf.settlementTotal; tempIncomeTotal += rf.tempIncomeTotal;
      dateAccountSpend += rf.dateAccountSpend; datePartnerShare += rf.datePartnerShare;
    }
  }
  // D.realSavRate는 number 계약 — 분모 0(실질수입 없음)이면 0 폴백
  const realSavRate = computeRealSavingsRate(realIncome, realExpense) ?? 0;

  /* ===== expenseByCategory (대분류) =====
   * 대분류는 expenseMainName 단일 소스 — 표준 스키마(cat="지출", sub=식비)에서 category를 직접 키로
   * 쓰면 전부 "지출" 한 덩어리로 뭉친다 (예전 버그: "총 1개 대분류"). */
  const catM = new Map<string, number>();
  for (const l of fExp) { const c = expenseMainName(l) || "기타"; catM.set(c, (catM.get(c) ?? 0) + amt(l)); }
  const expByCat = Array.from(catM.entries()).sort((a, b) => b[1] - a[1]);
  const topCats = expByCat.slice(0, 6).map(([c]) => c);

  /* ===== expenseBySubCategory (중분류) =====
   * 중분류 = 대분류 아래 단계(표준: detailCategory). 예전엔 subCategory를 키로 써서
   * 실제로는 대분류(식비…)가 "중분류"로 표시됐다 — 대분류 축이 고쳐지며 한 단계씩 내린다.
   * ⚠ expSubName(insightsBase)은 아래 subInsights의 항목 매칭에도 쓰인다 — 키가 갈라지면 매칭이 0건이 된다. */
  const subM = new Map<string, { cat: string; sub: string; amount: number; count: number }>();
  for (const l of fExp) {
    const cat = expenseMainName(l) || "기타";
    const sub = expSubName(l);
    const key = sub;
    const prev = subM.get(key) ?? { cat, sub, amount: 0, count: 0 };
    subM.set(key, { cat: prev.cat, sub, amount: prev.amount + amt(l), count: prev.count + 1 });
  }
  const expBySub = Array.from(subM.values()).sort((a, b) => b.amount - a.amount);

  /* monthlyCategoryTrend (full) — fExp와 동일 분류 기준(flowOf). 예전엔 신용결제를 안 걸러
   * 레거시 카드대금이 추이에 이중계상됐다. (topCats가 선택월에 따라 달라 slice에 둔다 — 키 삽입 순서 보존) */
  const monthlyCatTrend: Record<string, Record<string, number>> = {};
  for (const l of ledger) {
    if (Number(l.amount) <= 0 || flowOf(l) !== "expense") continue;
    const m = l.date?.slice(0, 7); if (!m) continue;
    const c = expenseMainName(l) || "기타"; if (!topCats.includes(c)) continue;
    if (!monthlyCatTrend[m]) monthlyCatTrend[m] = {};
    monthlyCatTrend[m][c] = (monthlyCatTrend[m][c] ?? 0) + amt(l);
  }

  /* accountUsage */
  const auM = new Map<string, { count: number; total: number }>();
  for (const l of fExp) {
    if (!l.fromAccountId) continue;
    const n = aMap.get(l.fromAccountId) || l.fromAccountId;
    const p = auM.get(n) ?? { count: 0, total: 0 };
    auM.set(n, { count: p.count + 1, total: p.total + amt(l) });
  }
  const acctUsage = Array.from(auM.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total);

  /* subcategory breakdown — 대분류(expenseMainName) 아래 세부(det→desc 폴백) 그룹 */
  const scM = new Map<string, { cat: string; sub: string; amount: number; count: number }>();
  for (const l of fExp) {
    const cat = expenseMainName(l) || "기타";
    const sub = l.detailCategory || l.description || "기타";
    const key = `${cat}__${sub}`;
    const prev = scM.get(key) ?? { cat, sub, amount: 0, count: 0 };
    scM.set(key, { cat, sub, amount: prev.amount + amt(l), count: prev.count + 1 });
  }
  const expBySubCat = Array.from(scM.values()).sort((a, b) => b.amount - a.amount);

  /* description breakdown (top spending items) */
  const descM = new Map<string, { desc: string; cat: string; sub: string; amount: number }>();
  for (const l of fExp) {
    const desc = l.description || l.subCategory || "기타";
    const key = desc;
    const prev = descM.get(key) ?? { desc, cat: l.category || "기타", sub: l.subCategory || "", amount: 0 };
    descM.set(key, { ...prev, amount: prev.amount + amt(l) });
  }
  const expByDesc = Array.from(descM.values()).sort((a, b) => b.amount - a.amount).slice(0, 30);

  /* weekdaySpending — parseIsoLocal로 로컬 파싱 (UTC 파싱 시 음수 타임존에서 요일이 하루 밀림) */
  const wdSpend: { total: number; count: number }[] = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
  for (const l of fExp) {
    if (!l.date) continue;
    const d = parseIsoLocal(l.date);
    if (!d) continue;
    const js = d.getDay();
    const idx = js === 0 ? 6 : js - 1;
    wdSpend[idx].total += amt(l); wdSpend[idx].count++;
  }

  /* dateExpense — utils/dateAccounting.isDateEntry로 판정 */
  const dateExpMonthly: Record<string, number> = {};
  const dateDescM = new Map<string, number>();
  const dateSubCatM = new Map<string, number>();
  const dateEntries: { date: string; desc: string; sub: string; amount: number }[] = [];
  let dateMoim = 0, datePersonal = 0;
  for (const l of fL) {
    if (!isDateEntry(l)) continue;
    const a = amt(l); const m = l.date?.slice(0, 7);
    if (m) dateExpMonthly[m] = (dateExpMonthly[m] ?? 0) + a;
    const desc = l.description || l.subCategory || "기타";
    dateDescM.set(desc, (dateDescM.get(desc) ?? 0) + a);
    const sub = l.subCategory || l.description || "기타";
    dateSubCatM.set(sub, (dateSubCatM.get(sub) ?? 0) + a);
    if (l.fromAccountId && moimIds.has(l.fromAccountId)) dateMoim += a; else datePersonal += a;
    dateEntries.push({ date: l.date, desc: l.description || "", sub: l.subCategory || l.category || "", amount: a });
  }
  dateEntries.sort((a, b) => b.amount - a.amount);
  const dateTxCount = dateEntries.length;
  // full period dateExpMonthly (always)
  if (selMonth) {
    for (const l of ledger) {
      if (!isDateEntry(l)) continue;
      const m = l.date?.slice(0, 7); if (!m || dateExpMonthly[m] !== undefined) continue;
      dateExpMonthly[m] = 0;
    }
    for (const l of ledger) {
      if (!isDateEntry(l)) continue;
      const m = l.date?.slice(0, 7); if (!m) continue;
      if (selMonth && m === selMonth) continue;
      dateExpMonthly[m] = (dateExpMonthly[m] ?? 0) + amt(l);
    }
  }

  const dateTop = Array.from(dateDescM.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);
  const dateSubCats = Array.from(dateSubCatM.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);

  /* incomeByCategory — fInc가 이미 이월/원래보유자산을 제외했으므로 추가 필터 불필요 */
  const icM = new Map<string, number>();
  for (const l of fInc) {
    const c = l.subCategory || l.category || "기타";
    icM.set(c, (icM.get(c) ?? 0) + amt(l));
  }
  const incByCat = Array.from(icM.entries()).sort((a, b) => b[1] - a[1]);

  /* tradeSummary */
  const tM = new Map<string, { buyCount: number; sellCount: number; buyTotal: number; sellTotal: number }>();
  for (const t of fT) {
    const n = t.name || t.ticker;
    if (!tM.has(n)) tM.set(n, { buyCount: 0, sellCount: 0, buyTotal: 0, sellTotal: 0 });
    const e = tM.get(n)!;
    const kr = tradeAmountKRW(t, fxRate);
    if (t.side === "buy") { e.buyCount += t.quantity; e.buyTotal += kr; }
    else { e.sellCount += t.quantity; e.sellTotal += kr; }
  }
  const trades = Array.from(tM.entries()).map(([name, v]) => ({ name, ...v })).filter(v => v.buyTotal > 10000).sort((a, b) => b.buyTotal - a.buyTotal);

  /* subscriptions — isSubEntry(insightsBase): category 또는 subCategory에 "구독" 포함 */
  const sM = new Map<string, { count: number; total: number }>();
  for (const l of fL) {
    if (!isSubEntry(l)) continue;
    const n = l.description || l.subCategory || l.category || ""; if (!n) continue;
    const p = sM.get(n) ?? { count: 0, total: 0 };
    sM.set(n, { count: p.count + 1, total: p.total + amt(l) });
  }
  const subs = Array.from(sM.entries()).map(([name, v]) => ({ name, ...v, avg: v.count > 0 ? Math.round(v.total / v.count) : 0 })).filter(s => s.name).sort((a, b) => b.total - a.total);

  /* largeExpenses */
  const largeExp = fExp.filter(l => amt(l) >= 100000).sort((a, b) => amt(b) - amt(a)).slice(0, 20)
    .map(l => ({ date: l.date, desc: l.description || "", sub: l.subCategory || l.category || "", amount: amt(l) }));

  /* topTransactions (top 10) */
  const topTx = [...fExp].sort((a, b) => amt(b) - amt(a)).slice(0, 10)
    .map(l => ({ date: l.date, desc: l.description || "", cat: l.category || "", sub: l.subCategory || "", amount: amt(l) }));

  /* spendingByDayOfMonth */
  const spendByDOM = new Array(31).fill(0);
  for (const l of fExp) { const d = parseInt(l.date?.slice(8, 10) || "0") - 1; if (d >= 0 && d < 31) spendByDOM[d] += amt(l); }

  const pSalary = (selMonth ? [selMonth] : months).reduce((s, m) => s + (salaryMonthly[m] ?? 0), 0);

  /* 청산 종목 손익 — FIFO 기록을 종목별 합산. 매도일 기준 기간 필터, 원가는 전체 이력에서 소진.
     (기간 필터된 거래의 평균단가로 계산하면 이전 기간 매수 원가가 빠져 부호까지 반전된다)
     기간 판정은 rawTrades(일 단위 컷오프 적용된 거래) 소속 여부 — 월 단위 근사는 같은 탭의
     매수/매도 집계(일 단위)와 모집단이 어긋난다. */
  const closedByStock = (() => {
    const m = new Map<string, { name: string; pnl: number; cost: number; proceeds: number; count: number }>();
    for (const r of allClosedRecords) {
      const ym = r.sellDate.slice(0, 7);
      if (selMonth ? ym !== selMonth : !periodSellIds.has(r.tradeId)) continue;
      const key = canonicalTickerForMatch(r.ticker) || r.ticker;
      const cur = m.get(key) ?? { name: r.name || r.ticker, pnl: 0, cost: 0, proceeds: 0, count: 0 };
      cur.pnl += r.realizedPnlKRW;
      cur.cost += r.costBasisKRW;
      cur.proceeds += r.proceedsKRW;
      cur.count += 1;
      if (r.name) cur.name = r.name;
      m.set(key, cur);
    }
    return [...m.values()].sort((a, b) => b.pnl - a.pnl);
  })();

  /* zero spend days */
  let zeroDays = 0, totalDays = 0;
  const spendSet = new Set(fExp.map(l => l.date));
  const msCheck = selMonth ? [selMonth] : months;
  // '오늘'은 KST 기준(getTodayKST) — new Date()는 KST 자정 전후(UTC 15:00)에 하루 어긋나 무지출일 분모가 틀어짐
  const todayKst = getTodayKST();
  for (const m of msCheck) {
    const [y, mo] = m.split("-").map(Number); const dim = new Date(y, mo, 0).getDate();
    const isCur = todayKst.slice(0, 7) === m;
    const md = isCur ? Number(todayKst.slice(8, 10)) : dim;
    for (let d = 1; d <= md; d++) { totalDays++; if (!spendSet.has(`${m}-${String(d).padStart(2, "0")}`)) zeroDays++; }
  }

  /* weekend vs weekday — parseIsoLocal 로컬 파싱 (요일 밀림 방지) */
  let weekendTot = 0, weekdayTot = 0;
  for (const l of fExp) { const d = parseIsoLocal(l.date)?.getDay(); if (d == null) continue; if (d === 0 || d === 6) weekendTot += amt(l); else weekdayTot += amt(l); }

  /* top spend dates */
  const tdM = new Map<string, { total: number; items: { desc: string; amount: number }[] }>();
  for (const l of fExp) {
    if (!tdM.has(l.date)) tdM.set(l.date, { total: 0, items: [] });
    const e = tdM.get(l.date)!; e.total += amt(l); e.items.push({ desc: l.description || l.category || "기타", amount: amt(l) });
  }
  const topDates = Array.from(tdM.entries()).map(([date, v]) => ({ date, ...v })).sort((a, b) => b.total - a.total).slice(0, 5);

  /* financial score — 저축률 항목은 실질 저축률 기준 (정의 통일) */
  let scorePts = 0;
  const sr = realSavRate;
  if (sr >= 50) scorePts += 40; else if (sr >= 30) scorePts += 30; else if (sr >= 20) scorePts += 20; else if (sr >= 10) scorePts += 10;
  if (zeroDays > totalDays * 0.2) scorePts += 20; else if (zeroDays > totalDays * 0.1) scorePts += 10;
  if (pInvest > 0) scorePts += 20; else scorePts += 5;
  const incDiv = incByCat.length;
  if (incDiv >= 5) scorePts += 20; else if (incDiv >= 3) scorePts += 15; else if (incDiv >= 2) scorePts += 10; else scorePts += 5;
  const grade = scorePts >= 90 ? "A+" : scorePts >= 80 ? "A" : scorePts >= 70 ? "B+" : scorePts >= 60 ? "B" : scorePts >= 50 ? "C+" : scorePts >= 40 ? "C" : "D";
  const comments: Record<string, string> = { "A+": "완벽한 재무 습관!", A: "훌륭하게 관리 중!", "B+": "꽤 건강한 재무 상태!", B: "나쁘지 않아요!", "C+": "개선의 여지가 있어요.", C: "소비 조절이 필요해요.", D: "재무 점검이 필요해요!" };

  /* prev month */
  let prev: { income: number; expense: number; salary: number } | null = null;
  if (selMonth) {
    const [y, m] = selMonth.split("-").map(Number); const pd = new Date(y, m - 2, 1);
    const pm = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, "0")}`;
    let pi = 0, pe = 0, ps = 0;
    // 당월(pIncome/pExpense)과 동일한 분류 기준 — 예전엔 전월만 재테크 제외가 빠져
    // 레거시 저축성지출이 전월 지출에 섞였고, "전월 대비" 배지가 허위 개선률을 표시했다.
    for (const l of ledger) {
      if (l.date?.slice(0, 7) !== pm) continue;
      const a = amt(l); if (a <= 0) continue;
      const flow = flowOf(l);
      if (flow === "income") { pi += a; if (salaryKeys.has(l.subCategory || l.category || "")) ps += a; }
      else if (flow === "expense") pe += a;
    }
    if (pi > 0 || pe > 0) prev = { income: pi, expense: pe, salary: ps };
  }

  /* ===== 소득 그룹별 분류 ===== */
  // "비실질"은 환급(정산·환불)·일시(지원·용돈)·부채(대출) — 장부엔 수입이지만 번 돈이 아닌 유입
  const groupMap: Record<string, { total: number; items: Map<string, number> }> = {
    "회사소득": { total: 0, items: new Map() },
    "투자/패시브": { total: 0, items: new Map() },
    "기타수입": { total: 0, items: new Map() },
    "비실질": { total: 0, items: new Map() },
  };
  for (const [cat, val] of incByCat) {
    const nature = classifyIncomeNature(cat, { salaryKeys, investIncKeys, nonRealKeys });
    const g = nature === "근로" ? "회사소득" : nature === "패시브" ? "투자/패시브" : nature === "기타" ? "기타수입" : "비실질";
    groupMap[g].total += val;
    groupMap[g].items.set(cat, (groupMap[g].items.get(cat) ?? 0) + val);
  }
  const incByGroup = Object.entries(groupMap)
    .filter(([, v]) => v.total > 0)
    .map(([name, v]) => ({ name, value: v.total, items: [...v.items.entries()].sort((a, b) => b[1] - a[1]) }))
    .sort((a, b) => b.value - a.value);

  /* ===== 재테크 중분류별 분류 ===== */
  const ivSubM = new Map<string, { amount: number; count: number }>();
  for (const l of fL) {
    if (l.kind !== "expense" || l.category !== "재테크") continue;
    const sub = l.subCategory || "기타";
    const p = ivSubM.get(sub) ?? { amount: 0, count: 0 };
    ivSubM.set(sub, { amount: p.amount + amt(l), count: p.count + 1 });
  }
  const investBySub = [...ivSubM.entries()].map(([sub, v]) => ({ sub, ...v })).sort((a, b) => b.amount - a.amount);

  /* ===== 데이트 소분류별 ===== */
  const dateDetM = new Map<string, number>();
  for (const l of fL) {
    if (!isDateEntry(l)) continue;
    const det = l.detailCategory || l.description || "기타";
    dateDetM.set(det, (dateDetM.get(det) ?? 0) + amt(l));
  }
  const dateByDetail = [...dateDetM.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

  /* ===== 완결 월 수 (지출·수입·재테크 중분류 인사이트 공용) =====
     진행 중인 달은 추세(MoM)·연속증가 계산에서 제외 — 월말까지 안 들어온 달과
     비교하면 월초마다 모든 항목이 "급감"으로 표시되는 왜곡이 생김. KST 기준. */
  const curMonthStr = getThisMonthKST();
  const doneCnt = months.length > 1 && months[months.length - 1] === curMonthStr ? months.length - 1 : months.length;
  // 키별 월별 합계 조회 — base에서 1패스로 만든 맵(mTotalsFor와 동일 값). 없는 키면 0 배열(= 매칭 0건)
  const zeroTotals = () => months.map(() => 0);

  /* ===== 지출 중분류별 인사이트 ===== */
  const subInsights: SubInsight[] = expBySub.slice(0, 15).map(s => {
    // 필터·키·금액 모두 fExp/expBySub와 동일 기준 (flowOf + expSubName + 환산) — 어긋나면 월별 추세가 합계와 안 맞는다
    const mTotals = [...(base.expSubMonthly.get(s.sub) ?? zeroTotals())];
    // 추세·피크·연속증가는 완결 월만으로 계산 (수입 인사이트와 동일 기준)
    const doneTotals = mTotals.slice(0, doneCnt);
    const { monthTrend, mom, nonZero, monthAvg } = calcTrend(doneTotals);
    const last2 = doneTotals.slice(-2);
    const peakIdx = doneTotals.length > 0 ? doneTotals.indexOf(Math.max(...doneTotals)) : -1;
    // 해당 중분류 최대 단건
    let maxSingle = 0, maxSingleDesc = "";
    for (const l of fExp) {
      if (expSubName(l) !== s.sub) continue;
      const a = amt(l);
      if (a > maxSingle) { maxSingle = a; maxSingleDesc = l.description || l.subCategory || ""; }
    }
    // 해당 중분류 내 최다 지출 항목(description)
    const descMap = new Map<string, number>();
    for (const l of fExp) {
      if (expSubName(l) !== s.sub) continue;
      const d = l.description || "기타";
      descMap.set(d, (descMap.get(d) ?? 0) + amt(l));
    }
    const topDescEntry = [...descMap.entries()].sort((a, b) => b[1] - a[1])[0];
    // 연속 증가 월수 (완결 월 기준 — 진행 중인 달이 끼면 항상 끊긴 것으로 보임)
    let streakUp = 0;
    for (let i = doneTotals.length - 1; i >= 1; i--) {
      if (doneTotals[i] > doneTotals[i - 1] && doneTotals[i] > 0) streakUp++; else break;
    }
    const share = Math.round(SD(s.amount, pExpense) * 100);
    // 2번째 지출처
    const topDesc2 = [...descMap.entries()].sort((a, b) => b[1] - a[1])[1];
    // 월별 변동성
    const mStd = nonZero.length >= 2 ? Math.sqrt(nonZero.reduce((ss, v) => ss + (v - monthAvg) ** 2, 0) / nonZero.length) : 0;
    const mCV = monthAvg > 0 ? Math.round(mStd / monthAvg * 100) : 0;
    // 지출 빈도 (월당 평균 건수)
    const freqPerMonth = nonZero.length > 0 ? Math.round(s.count / nonZero.length * 10) / 10 : 0;
    // 자동 코멘트 생성
    const comments: string[] = [];
    // 추세 코멘트
    if (monthTrend === "up" && mom > 50) comments.push(`전월 대비 ${mom}% 급증했습니다. 일시적 지출인지 구조적 증가인지 확인이 필요합니다. 이 속도가 계속되면 연간 ${F(Math.round(last2[1] * 12))} 이상 지출될 수 있습니다.`);
    else if (monthTrend === "up" && mom > 30) comments.push(`전월 대비 ${mom}% 증가했습니다. 특정 이벤트나 구매가 있었는지 확인해 보세요.`);
    else if (monthTrend === "up") comments.push(`전월 대비 ${mom}% 소폭 증가 추세입니다.`);
    else if (monthTrend === "down" && Math.abs(mom) > 50) comments.push(`전월 대비 ${Math.abs(mom)}% 대폭 감소! 훌륭한 절약입니다. 이 습관을 유지하세요.`);
    else if (monthTrend === "down" && Math.abs(mom) > 30) comments.push(`전월 대비 ${Math.abs(mom)}% 감소했습니다. 좋은 흐름이에요!`);
    else if (monthTrend === "down") comments.push(`전월 대비 ${Math.abs(mom)}% 소폭 감소 중입니다.`);
    else comments.push("전월과 비슷한 수준을 유지하고 있습니다.");
    // 연속 증가 경고
    if (streakUp >= 4) comments.push(`${streakUp}개월 연속 증가 중! 습관적 소비 증가가 고착화되고 있을 수 있습니다. 예산 한도를 설정해 보세요.`);
    else if (streakUp >= 2) comments.push(`${streakUp}개월 연속 증가 추세입니다.`);
    // 비중 코멘트
    if (share > 30) comments.push(`전체 지출의 ${share}%로 압도적 비중입니다. 이 카테고리를 10%만 줄여도 월 ${F(Math.round(monthAvg * 0.1))} 절약 효과가 있습니다.`);
    else if (share > 15) comments.push(`전체 지출의 ${share}%로 주요 지출 카테고리입니다.`);
    else if (share > 5) comments.push(`전체 지출의 ${share}%를 차지합니다.`);
    // 빈도 코멘트
    if (freqPerMonth > 15) comments.push(`월평균 ${freqPerMonth}건으로 거의 매일 지출합니다. 자동결제나 습관적 소비가 포함되어 있을 수 있습니다.`);
    else if (freqPerMonth > 8) comments.push(`월평균 ${freqPerMonth}건으로 빈번하게 지출합니다.`);
    else if (freqPerMonth < 2 && s.count > 0) comments.push(`월평균 ${freqPerMonth}건으로 비정기 지출입니다. 고액 지출이 간헐적으로 발생하는 패턴입니다.`);
    // 건당 평균
    const avgPerTx = Math.round(SD(s.amount, s.count));
    if (avgPerTx > 100000) comments.push(`건당 평균 ${F(avgPerTx)}으로 고단가 지출입니다. 구매 전 필요성을 한 번 더 확인하는 습관이 도움됩니다.`);
    else if (avgPerTx > 30000) comments.push(`건당 평균 ${F(avgPerTx)} 수준입니다.`);
    // 변동성 코멘트
    if (mCV > 60) comments.push(`월별 변동성이 ${mCV}%로 큽니다. 비정기 대량 구매가 영향을 줍니다.`);
    else if (mCV < 20 && nonZero.length >= 3) comments.push(`월별 변동성이 ${mCV}%로 매우 안정적인 지출 패턴입니다.`);
    // 지출처 정보
    if (topDescEntry) {
      const topShare = s.amount > 0 ? Math.round(topDescEntry[1] / s.amount * 100) : 0;
      comments.push(`주요 지출처: ${topDescEntry[0]}(${F(topDescEntry[1])}, ${topShare}%).`);
      if (topDesc2) comments.push(`2위: ${topDesc2[0]}(${F(topDesc2[1])}).`);
    }
    // 최대 단건
    if (maxSingle > avgPerTx * 3 && maxSingleDesc) comments.push(`최대 단건 ${maxSingleDesc}(${F(maxSingle)})은 평균의 ${Math.round(SD(maxSingle, avgPerTx))}배입니다.`);
    // 피크월
    if (months[peakIdx]) comments.push(`지출 최고월: ${ml[months[peakIdx]]}(${F(doneTotals[peakIdx])}).`);

    return {
      sub: s.sub, cat: s.cat, total: s.amount, count: s.count,
      avg: Math.round(SD(s.amount, s.count)),
      monthTrend, mom, peak: peakIdx >= 0 && months[peakIdx] ? ml[months[peakIdx]] : "", share,
      monthAvg, maxSingle, maxSingleDesc,
      streakUp,
      topDesc: topDescEntry?.[0] ?? "", topDescAmt: topDescEntry?.[1] ?? 0,
      comment: comments.join(" "),
      mTotals,
    };
  });

  /* ===== 수입 중분류별 인사이트 ===== */
  // 진행 중인 달은 추세·안정성 계산에서 제외 — doneCnt(위 공용 계산) 사용
  const incSubInsights: IncSubInsight[] = incByCat.slice(0, 12).map(([sub, total]) => {
    const cnt = fInc.filter(l => (l.subCategory || l.category || "기타") === sub).length;
    const fullMTotals = base.incSubMonthly.get(sub) ?? zeroTotals();
    const doneTotals = fullMTotals.slice(0, doneCnt);
    const { monthTrend, mom, nonZero, monthAvg } = calcTrend(doneTotals);
    // 수입 성격 — 같은 "수입"이라도 근로/패시브/환급/일시/부채는 전혀 다른 돈
    const nature = classifyIncomeNature(sub, { salaryKeys, investIncKeys, nonRealKeys });
    const isReal = nature === "근로" || nature === "패시브" || nature === "기타";
    const realShare = isReal && realIncome > 0 ? Math.round(SD(total, realIncome) * 100) : null;
    // 안정성 지수 — 표본 3개월 미만이면 의미 없으므로 null (음수는 0으로 클램프)
    let stability: number | null = null;
    if (nonZero.length >= 3) {
      const mean = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
      const std = Math.sqrt(nonZero.reduce((s, v) => s + (v - mean) ** 2, 0) / nonZero.length);
      stability = mean > 0 ? Math.max(0, Math.round((1 - SD(std, mean)) * 100)) : 0;
    }
    // 최대 수입 월 (완결월 기준)
    const maxIdx = doneTotals.length > 0 ? doneTotals.indexOf(Math.max(...doneTotals)) : -1;
    const maxMonth = maxIdx >= 0 && months[maxIdx] ? ml[months[maxIdx]] : "";
    const maxMonthAmt = doneTotals[maxIdx] ?? 0;
    const avg = Math.round(SD(total, cnt));
    const share = Math.round(SD(total, pIncome) * 100);
    // 수입 발생 빈도 (완결월 기준)
    const incFreq = Math.round(SD(nonZero.length, doneCnt) * 100);
    const recurring = incFreq >= 50 && nonZero.length >= 3;
    // 코멘트 — 성격별로 완전히 다른 서사
    const cs: string[] = [];
    if (nature === "부채") {
      cs.push(`대출 유입은 수입이 아니라 갚아야 할 부채입니다. 실질 수입에서 제외되며, 비중·안정성 분석 대상이 아닙니다.`);
      cs.push(`총 ${cnt}건, ${F(total)} 유입. 상환 계획과 함께 관리하세요.`);
    } else if (nature === "환급") {
      if (sub.includes("환불")) cs.push(`결제 취소·이중 결제 등을 돌려받은 정정성 입금입니다. 번 돈이 아니므로 실질 수입에서 제외됩니다.`);
      else if (sub === "데이트통장") cs.push(`데이트 통장 분담금 입금입니다. 상대 부담분은 실질 지출에서 이미 차감되므로 수입으로 집계하지 않습니다.`);
      else cs.push(`내가 먼저 쓴 돈을 돌려받은 정산성 입금입니다. 번 돈이 아니므로 실질 수입에서 제외됩니다.`);
      cs.push(`총 ${cnt}건, ${F(total)} 회수.`);
    } else if (nature === "일시") {
      cs.push(`${sub} 같은 일시·이전성 소득은 반복된다는 보장이 없습니다. 실질 수입에서 제외되며, 고정 지출 계획의 근거로 삼지 마세요.`);
      cs.push(`${doneCnt}개월 중 ${nonZero.length}개월 발생, 총 ${F(total)}. 들어올 때 저축·투자로 돌리는 것이 안전합니다.`);
    } else {
      // 근로·패시브·기타 — 실질 수입을 구성하는 진짜 수입원
      if (realShare !== null) {
        if (realShare > 50) cs.push(`실질 수입의 ${realShare}%를 책임지는 핵심 수입원입니다. 이 수입이 줄어들면 가계에 직접 타격이 옵니다.`);
        else if (realShare > 20) cs.push(`실질 수입의 ${realShare}%를 차지하는 중요한 수입원입니다.`);
        else if (realShare > 5) cs.push(`실질 수입의 ${realShare}%를 차지합니다.`);
        else cs.push(`실질 수입의 ${realShare}%인 소규모 수입원입니다.`);
      }
      if (nature === "패시브") {
        cs.push(`자산이 일해서 번 패시브 수입입니다.`);
        if (monthTrend === "up") cs.push(`증가 추세 — 투자 자산 축적 효과가 나타나고 있습니다.`);
      }
      if (nature === "근로" && !recurring && nonZero.length >= 1) {
        cs.push(`상여·수당처럼 비정기로 들어오는 근로소득입니다. 고정 지출은 정기 급여 기준으로 계획하고, 이런 목돈은 저축·투자로 돌리세요.`);
      }
      // 안정성·추세는 정기적으로 들어오는 수입원에만 의미가 있음
      if (recurring) {
        if (stability !== null) {
          if (stability >= 80) cs.push(`안정성 ${stability}%로 매우 안정적 — 재무 계획의 기준으로 삼을 수 있습니다.`);
          else if (stability >= 60) cs.push(`안정성 ${stability}%로 비교적 안정적입니다.`);
          else cs.push(`안정성 ${stability}%로 월별 변동이 큽니다. 이 수입에만 의존하지 않도록 주의하세요.`);
        }
        if (monthTrend === "up" && mom > 30) cs.push(`전월 대비 ${mom}% 급증했습니다.`);
        else if (monthTrend === "down" && Math.abs(mom) > 30) cs.push(`전월 대비 ${Math.abs(mom)}% 급감 — 일시적인지 구조적인지 확인해 보세요.`);
      } else if (nonZero.length >= 1 && nature !== "근로") {
        cs.push(`${doneCnt}개월 중 ${nonZero.length}개월 발생한 비정기 수입 — 보너스로 보고 계획에는 넣지 않는 것이 좋습니다.`);
      }
      if (maxMonth && monthAvg > 0 && maxMonthAmt > monthAvg * 2) cs.push(`최대 수입월 ${maxMonth}(${F(maxMonthAmt)})은 발생월 평균(${F(monthAvg)})의 ${Math.round(SD(maxMonthAmt, monthAvg))}배였습니다.`);
      if (cnt > 0) cs.push(`총 ${cnt}건, 건당 평균 ${F(avg)}.`);
    }
    return { sub, total, count: cnt, avg, monthTrend, mom, share, monthAvg, stability, maxMonth, maxMonthAmt, nature, isReal, realShare, recurring, comment: cs.join(" ") };
  });
  // 진짜 수입원(근로→패시브→기타)을 앞에, 환급·일시·부채는 뒤로 — 각 그룹 안에서는 금액순
  const natureOrder: Record<string, number> = { 근로: 0, 패시브: 1, 기타: 2, 일시: 3, 환급: 4, 부채: 5 };
  incSubInsights.sort((a, b) => (natureOrder[a.nature] ?? 9) - (natureOrder[b.nature] ?? 9) || b.total - a.total);

  /* ===== 데이트 중분류별 인사이트 ===== */
  const dTotal = dateEntries.reduce((s, e) => s + e.amount, 0);
  const dateSubInsights: DateSubInsight[] = dateSubCats.slice(0, 10).map(([sub, total]) => {
    const entries = dateEntries.filter(e => e.sub === sub);
    const avg = Math.round(SD(total, entries.length));
    // 최대 단건
    let maxSingle = 0, maxSingleDesc = "";
    for (const e of entries) { if (e.amount > maxSingle) { maxSingle = e.amount; maxSingleDesc = e.desc || sub; } }
    // 방문(날짜) 기준 평균
    const uniqueDates = new Set(entries.map(e => e.date));
    const avgPerVisit = Math.round(SD(total, uniqueDates.size));
    const share = Math.round(SD(total, dTotal) * 100);
    // 코멘트
    const cs: string[] = [];
    if (share > 40) cs.push(`데이트 지출의 ${share}%로 압도적 비중! 이 카테고리가 데이트비의 핵심입니다.`);
    else if (share > 25) cs.push(`데이트 지출의 ${share}%로 가장 큰 비중을 차지합니다.`);
    else if (share > 10) cs.push(`데이트 지출의 ${share}%로 주요 데이트 활동입니다.`);
    else cs.push(`데이트 지출의 ${share}%를 차지합니다.`);
    cs.push(`총 ${entries.length}건 발생, 건당 평균 ${F(avg)}.`);
    if (uniqueDates.size > 0) {
      cs.push(`${uniqueDates.size}일에 걸쳐 이용, 이용일당 평균 ${F(avgPerVisit)}.`);
      if (entries.length > uniqueDates.size * 1.5) cs.push(`같은 날 여러 건 결제하는 패턴이 있습니다.`);
    }
    if (maxSingle > avg * 3 && maxSingleDesc) cs.push(`최대 단건 ${maxSingleDesc}(${F(maxSingle)})은 평균의 ${Math.round(SD(maxSingle, avg))}배로 특별한 지출이었습니다.`);
    else if (maxSingle > avg * 1.5 && maxSingleDesc) cs.push(`최대 단건: ${maxSingleDesc}(${F(maxSingle)}).`);
    // 가성비 제안
    if (avg > 50000) cs.push(`건당 평균이 높은 편입니다. 할인 혜택이나 가성비 좋은 대안을 찾아보세요.`);
    else if (avg < 10000 && entries.length > 5) cs.push(`소액 다빈도 패턴입니다. 알뜰하게 데이트하고 있어요!`);
    return { sub, total, count: entries.length, avg, share, maxSingle, maxSingleDesc, avgPerVisit, comment: cs.join(" ") };
  });

  /* ===== 재테크 중분류별 인사이트 ===== */
  const investSubInsights: InvestSubInsight[] = investBySub.map(v => {
    const ivTotal = investBySub.reduce((s, x) => s + x.amount, 0);
    const share = Math.round(SD(v.amount, ivTotal) * 100);
    const avg = Math.round(SD(v.amount, v.count));
    // 월별 추이 — 완결 월만으로 추세 계산 (수입·지출 인사이트와 동일 기준).
    // 모집단은 총액(investBySub: expense+재테크)과 동일 — base.investSubMonthly가 같은 술어로 만든 맵.
    const ivMTotals = base.investSubMonthly.get(v.sub) ?? zeroTotals();
    const ivDoneTotals = ivMTotals.slice(0, doneCnt);
    const { monthTrend: ivTrend, mom: ivMom, nonZero: ivNonZero, monthAvg } = calcTrend(ivDoneTotals);
    const cs: string[] = [];
    if (share > 40) cs.push(`재테크 지출의 ${share}%로 가장 큰 투자 카테고리입니다.`);
    else if (share > 20) cs.push(`재테크 지출의 ${share}%로 주요 투자 항목입니다.`);
    else cs.push(`재테크 지출의 ${share}%를 차지합니다.`);
    cs.push(`총 ${v.count}건 거래, 건당 평균 ${F(avg)}.`);
    if (monthAvg > 0) cs.push(`월평균 ${F(monthAvg)} 투자. 연간으로 환산하면 약 ${F(monthAvg * 12)}.`);
    if (ivTrend === "up" && ivMom > 30) cs.push(`최근 투자 금액이 ${ivMom}% 급증! 투자 확대 중입니다.`);
    else if (ivTrend === "up") cs.push(`최근 ${ivMom}% 투자 금액이 증가 중입니다.`);
    else if (ivTrend === "down" && Math.abs(ivMom) > 30) cs.push(`최근 ${Math.abs(ivMom)}% 투자 금액이 급감했습니다. 시장 상황이나 자금 사정 변화를 확인하세요.`);
    else if (ivTrend === "down") cs.push(`최근 ${Math.abs(ivMom)}% 투자 금액이 감소 중입니다.`);
    else cs.push("최근 안정적인 투자 금액을 유지하고 있습니다.");
    // 빈도 분석 (완결 월 기준)
    const ivFreq = Math.round(SD(ivNonZero.length, doneCnt) * 100);
    if (ivFreq >= 90) cs.push(`${doneCnt}개월 중 ${ivNonZero.length}개월 투자 — 매월 꾸준히 적립하는 훌륭한 습관입니다!`);
    else if (ivFreq >= 60) cs.push(`${doneCnt}개월 중 ${ivNonZero.length}개월 투자 — 비교적 자주 투자합니다.`);
    else if (ivNonZero.length >= 2) cs.push(`${doneCnt}개월 중 ${ivNonZero.length}개월만 투자 — 비정기적 투자 패턴입니다. 자동이체 적립식 투자를 추천합니다.`);
    else if (ivNonZero.length === 1) cs.push("단 1번만 투자한 항목입니다.");
    return { sub: v.sub, amount: v.amount, count: v.count, avg, share, monthAvg, monthTrend: ivTrend, mom: ivMom, comment: cs.join(" ") };
  });

  /* ===== 추가 계산 지표 ===== */
  const netProfit = realIncome - realExpense;
  let passiveIncome = 0;
  for (const [cat, val] of incByCat) { if (investIncKeys.has(cat)) passiveIncome += val; }
  // 지출/수입·순현금흐름은 근로소득 기준 — "월급으로 지출·투자를 감당하는가"를 현실적으로 표시
  const expToIncRatio = pSalary > 0 ? pExpense / pSalary * 100 : 0;
  const dailyAvgExp = totalDays > 0 ? Math.round(pExpense / totalDays) : 0;
  const netCashFlow = pSalary - pExpense - pInvest;
  const subTotal = subs.reduce((a, s) => a + s.total, 0);
  // 고정비/변동비/재량 3분해 — utils/fixedExpense 단일 정의(대시보드 배당 커버리지 고정비와 동일), USD는 환산(pExpense와 같은 기준)
  const expenseNature = computeExpenseNatureTotals(fExp, categoryPresets, fxRate);
  const fixedExpense = expenseNature.fixed;
  const variableExpense = expenseNature.variable;
  const discretionaryExpense = expenseNature.discretionary;

  /* ===== 재미 통계 (선택월 의존분) ===== */
  // 최고 지출일
  const dayTotals = new Map<string, number>();
  for (const l of fExp) { const d = l.date; if (d) dayTotals.set(d, (dayTotals.get(d) ?? 0) + amt(l)); }
  let biggestSpendDay: { date: string; total: number } | null = null;
  for (const [date, total] of dayTotals) { if (!biggestSpendDay || total > biggestSpendDay.total) biggestSpendDay = { date, total }; }
  // 연속 무지출 기록
  const allDates = Array.from(dayTotals.keys()).sort();
  let longestZeroStreak = 0, streak = 0;
  if (allDates.length >= 2) {
    // KST 로컬 파싱/직렬화 — UTC(toISOString) 혼용 시 음수 타임존에서 하루 밀려 patternStats와 값이 어긋남
    const start = parseIsoLocal(allDates[0])!;
    const end = parseIsoLocal(allDates[allDates.length - 1])!;
    const spendDays = new Set(allDates);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const ds = formatIsoLocal(d);
      if (!spendDays.has(ds)) { streak++; longestZeroStreak = Math.max(longestZeroStreak, streak); }
      else streak = 0;
    }
  }
  // 주말 vs 평일
  const weekendVsWeekday = { weekend: weekendTot, weekday: weekdayTot };
  // 일평균 거래 건수
  const avgTxPerDay = totalDays > 0 ? Math.round(fL.length / totalDays * 10) / 10 : 0;
  // 최다 이용 가게 (description 기준)
  const storeMap = new Map<string, { total: number; count: number }>();
  for (const l of fExp) {
    const desc = (l.description || "").trim();
    if (!desc) continue;
    const p = storeMap.get(desc) ?? { total: 0, count: 0 };
    storeMap.set(desc, { total: p.total + amt(l), count: p.count + 1 });
  }
  let topStore: { name: string; total: number; count: number } | null = null;
  for (const [name, v] of storeMap) { if (!topStore || v.count > topStore.count) topStore = { name, ...v }; }
  // 월수입(근로소득)을 며칠만에 쓰는지 — selMonth 필터 시 1개월 기준
  const avgMonthInc = pSalary / (selMonth ? 1 : Math.max(1, months.length));
  const daysToSpendIncome = avgMonthInc > 0 && dailyAvgExp > 0 ? Math.round(avgMonthInc / dailyAvgExp) : null;

  const funStats = {
    biggestSpendDay, mostFrugalMonth: base.mostFrugalMonth, mostSpendMonth: base.mostSpendMonth, longestZeroStreak,
    weekendVsWeekday, avgTxPerDay, topStore, monthOverMonthGrowth: base.monthOverMonthGrowth,
    daysToSpendIncome, bestSavingsMonth: base.bestSavingsMonth,
  };

  /* 최근 월 이상치 감지 (z-score ≥ 2, 6개월 lookback) */
  const anomalyTargetMonth = selMonth ?? months[months.length - 1] ?? null;
  const topAnomaly = (() => {
    if (!anomalyTargetMonth) return null;
    // 진행 중인 달이면 과거 달도 같은 기간(1~오늘 일)만 비교 — 월말에만 경고 켜지는 사각 방지
    const anomalyDayCap = anomalyTargetMonth === curMonthStr ? Number(getTodayKST().slice(8, 10)) : undefined;
    const results = detectSpendAnomalies(ledger, anomalyTargetMonth, 6, anomalyDayCap, categoryPresets);
    const triggered = results.filter((a) => a.isAnomaly).sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
    return triggered[0] ?? null;
  })();

  /* 수입 성장률 시계열·MoM/YoY — utils/insightsTrends 단일 소스.
     진행 중인 달이면 전월·전년의 "같은 기간(1~오늘 일)"과 비교 (월중 -90%대 왜곡 방지). */
  const todayDayNum = Number(getTodayKST().slice(8, 10));
  const incomeGrowth = computeIncomeGrowth({ ledger, months, ml, salaryMonthly, salaryKeys, curMonthStr, anomalyTargetMonth, todayDayNum });

  /* 지출 관성: 현재월 지출 vs 최근 3개월 평균 — utils/insightsTrends 단일 소스.
     진행 중인 달이면 과거 3개월도 "같은 기간(1~오늘 일)"만 합산 (월중 "절약 모드" 왜곡 방지). */
  const spendingInertia = computeSpendingInertia({ ledger, months, monthly, curMonthStr, anomalyTargetMonth, todayDayNum });

  /* 카테고리 성장률 TOP — 현재월 중분류 지출 vs 최근 3개월 평균 — utils/insightsTrends 단일 소스.
     진행 중인 달이면 과거 3개월도 같은 기간(1~오늘 일)만 집계 (월중 전부 "감소" 왜곡 방지). */
  const categoryGrowth = computeCategoryGrowth({ ledger, months, curMonthStr, anomalyTargetMonth, todayDayNum, categoryPresets });

  /* 단건 지출 이상치 TOP — 중분류 내 z-score — utils/insightsPatterns 단일 소스 */
  const entryOutliers = computeEntryOutliers(fExp);

  /* DOM 월 가중치 보정 — 각 일자(1~31)가 기간 내 며칠만큼 존재했는지 (base.domOccurrences) */
  const spendByDOMAvg = spendByDOM.map((v, i) => base.domOccurrences[i] > 0 ? v / base.domOccurrences[i] : 0);

  /* 소비 스트릭·월별 무지출일·거래 간격 — utils/insightsPatterns 단일 소스.
     미래 날짜를 무지출일로 세지 않도록 루프 끝을 오늘(KST)로 캡. */
  const patternStats = computePatternStats({ fExp, months, ml, todayIso: getTodayKST() });

  const { monthSpan, accumLabel } = computePeriodScope(selMonth, months, ml);

  return {
    months, ml, selMonth, monthSpan, accumLabel, txCount: fL.length, anomalyTargetMonth, topAnomaly, incomeGrowth, spendingInertia,
    categoryGrowth, entryOutliers, spendByDOMAvg, domOccurrences: base.domOccurrences, patternStats,
    monthly, salaryMonthly, realIncomeMonthly: base.realIncomeMonthly, savRateTrend: base.savRateTrend, salaryTrend: base.salaryTrend, cumIE: base.cumIE, investTrend: base.investTrend, divTrend: base.divTrend, tradeCntTrend: base.tradeCntTrend, subTrend: base.subTrend, txCntTrend: base.txCntTrend, cumSpend: base.cumSpend, monthlyCatTrend, dateExpMonthly,
    pIncome, pSalary, pExpense, pInvest, expByCat, expBySub, topCats, acctUsage, wdSpend, dateTop, dateSubCats, dateEntries, dateTxCount, incByCat, trades, subs, largeExp, topTx, expBySubCat, expByDesc, dateMoim, datePersonal, spendByDOM, portfolio: base.portfolio, realPL: { total: realPL.total, wins: realPL.wins, losses: realPL.losses, winCnt: realPL.winCnt, lossCnt: realPL.lossCnt }, closedByStock,
    investBreakdown: base.investBreakdown, holdingsByStock: base.holdingsByStock, totalHoldingsCost: base.totalHoldingsCost,
    zeroDays, totalDays, weekendTot, weekdayTot, topDates,
    score: { total: scorePts, grade, comment: comments[grade] || "" }, prev, avgMonthExp: base.avgMonthExp,
    incByGroup, investBySub, dateByDetail, stockTrends: base.stockTrends,
    subInsights, incSubInsights, dateSubInsights, investSubInsights,
    realIncome, realExpense, settlementTotal, tempIncomeTotal, dateAccountSpend, datePartnerShare, moimFlow: base.moimFlow, originalAssets: base.originalAssets, originalAssetsByAcct: base.originalAssetsByAcct,
    netProfit, realSavRate, passiveIncome, expToIncRatio, dailyAvgExp, netCashFlow,
    incomeStability: base.incomeStability, investReturnRate: base.investReturnRate, subTotal, fixedExpense, variableExpense, discretionaryExpense,
    netWorthByMonth: base.netWorthByMonth, netWorthNow: base.netWorthNow, accountBalances: base.accountBalances, assetAllocation: base.assetAllocation, funStats,
  };
}
