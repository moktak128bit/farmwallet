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
import { computeRealSavingsRate, isExcludedIncomeEntry } from "../../utils/savingsRate";
import { parseIsoLocal, getTodayKST, getThisMonthKST, shiftMonth } from "../../utils/date";
import { daysSinceLastRecord, latestRecordedDate, recordedDayCap } from "../../utils/ledgerFreshness";
import {
  F, SD, describeChange, isMeaningfulDesc,
  type D, type SubInsight, type IncSubInsight, type DateSubInsight,
} from "./insightsShared";
import type { LedgerEntry } from "../../types";

/** 부호 붙은 압축 금액 — "+15.8만원" / "−3만원" */
const signedF = (v: number) => `${v >= 0 ? "+" : "−"}${F(Math.abs(Math.round(v)))}원`;
import { expSubName, isSubEntry, type InsightsBase } from "./insightsBase";

export function sliceInsightsForMonth(base: InsightsBase, selMonth: string | null): D {
  const {
    ledger, allLedger, rawTrades, categoryPresets, fxRate,
    aMap, moimIds, amt, flowOf, isInvestInflow, krwLedger,
    monthly, months, ml, realFlows,
    salaryKeys, investIncKeys, nonRealKeys, salaryMonthly,
    allClosedRecords, periodSellIds, realPL,
  } = base;

  /* ===== 기록 신선도 — 진행 중인 달은 오늘이 아니라 마지막 기록일까지만 비교 (utils/ledgerFreshness) ===== */
  const todayKst = getTodayKST();
  const curMonthStr = getThisMonthKST();
  // 신선도는 기간 필터 전 전체 장부 기준 — 기간을 좁혀도 "어디까지 기록했나"는 같다
  const lastRecordedIso = latestRecordedDate(allLedger, todayKst);
  /** 이번 달 동기 비교 기준 일자 — min(오늘, 마지막 기록일). 이번 달 기록 전이면 0 */
  const recDayCap = recordedDayCap(allLedger, curMonthStr, todayKst) ?? Number(todayKst.slice(8, 10));
  let firstSpendIso: string | null = null;
  for (const l of ledger) {
    if (!l.date || Number(l.amount) <= 0 || flowOf(l) !== "expense") continue;
    if (firstSpendIso == null || l.date < firstSpendIso) firstSpendIso = l.date;
  }

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
    else if (flow === null && isInvestInflow(l)) pInvest += amt(l);
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
  // 분모 0(실질수입 없음)이면 null — UI는 N/A (0%로 폴백하면 '저축 0%' 막대·목표 대비가 거짓으로 그려진다)
  const realSavRate = computeRealSavingsRate(realIncome, realExpense);
  // 실질 흐름(savingsRate)의 수입은 투자수익을 포함하고, 장부 수입(flowOf "income")은 투자수익을 재테크로 뺀다.
  // 그 차이를 잔차로 노출해 "장부 − 정산 − 일시 + 투자수익 = 실질" 식이 화면에서 정확히 맞게 한다 (실장부 20.2만).
  // 반대로 장부 수입에 있지만 실질 흐름이 통째로 빼는 이월·원래 보유·퇴직연금(isExcludedIncomeEntry)은 따로 뺀다.
  const carryOverIncome = fInc.reduce((s, l) => s + (isExcludedIncomeEntry(l) ? amt(l) : 0), 0);
  const incomeOutsideLedgerRaw = realIncome + settlementTotal + tempIncomeTotal + carryOverIncome - pIncome;
  const incomeOutsideLedger = Math.abs(incomeOutsideLedgerRaw) < 1 ? 0 : incomeOutsideLedgerRaw;

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

  /* description breakdown (top spending items) — 설명이 비었거나 "지출"·"기타"·분류명 그대로면 지출처가 아니다 */
  const descM = new Map<string, { desc: string; cat: string; sub: string; amount: number }>();
  for (const l of fExp) {
    if (!isMeaningfulDesc(l.description, l.category, l.subCategory)) continue;
    const desc = (l.description ?? "").trim();
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

  /* tradeSummary — 종목은 ticker(canonicalTickerForMatch)로 묶고 이름은 표시용(최근 거래의 이름).
     이름으로 묶으면 "SOL"/"solana", "BTC"/"bitcoin"처럼 표기만 다른 같은 종목이 갈라진다. */
  const tM = new Map<string, { name: string; buyCount: number; sellCount: number; buyTotal: number; sellTotal: number }>();
  for (const t of fT) {
    const key = canonicalTickerForMatch(t.ticker) || t.ticker || t.name;
    if (!key) continue;
    if (!tM.has(key)) tM.set(key, { name: t.name || t.ticker, buyCount: 0, sellCount: 0, buyTotal: 0, sellTotal: 0 });
    const e = tM.get(key)!;
    if (t.name) e.name = t.name;
    const kr = tradeAmountKRW(t, fxRate);
    if (t.side === "buy") { e.buyCount += t.quantity; e.buyTotal += kr; }
    else { e.sellCount += t.quantity; e.sellTotal += kr; }
  }
  const trades = Array.from(tM.values()).filter(v => v.buyTotal > 10000).sort((a, b) => b.buyTotal - a.buyTotal);

  /* subscriptions — isSubEntry(insightsBase): category 또는 subCategory에 "구독" 포함 */
  // 월 비용은 "서비스별 건당 평균의 합"이 아니라 최근 완료 12개월 실제 결제 합 ÷ 개월 수 — 건당 평균 합산은
  // 해지한 서비스·일회성 결제까지 매달 내는 것처럼 더해 실장부에서 월 118만(실제 25.6만)이 나왔다.
  const subName = (l: LedgerEntry) => l.description || l.subCategory || l.category || "";
  const sM = new Map<string, { count: number; total: number }>();
  for (const l of fL) {
    if (!isSubEntry(l)) continue;
    const n = subName(l); if (!n) continue;
    const p = sM.get(n) ?? { count: 0, total: 0 };
    sM.set(n, { count: p.count + 1, total: p.total + amt(l) });
  }
  let firstLedgerMonth: string | null = null;
  for (const l of allLedger) { const m = l.date?.slice(0, 7); if (m && (firstLedgerMonth == null || m < firstLedgerMonth)) firstLedgerMonth = m; }
  const subWindowMonths: string[] = [];
  for (let i = 12; i >= 1; i--) { const m = shiftMonth(curMonthStr, -i); if (firstLedgerMonth != null && m >= firstLedgerMonth) subWindowMonths.push(m); }
  const subWindowSet = new Set(subWindowMonths);
  const activeSince = shiftMonth(curMonthStr, -2); // 최근 2개 완료월 + 이번 달
  const subWin = new Map<string, number>();
  const subLast = new Map<string, string>();
  for (const l of allLedger) {
    if (!isSubEntry(l) || !(Number(l.amount) > 0)) continue;
    const n = subName(l); if (!n) continue;
    const m = l.date?.slice(0, 7) ?? "";
    if (m > curMonthStr) continue; // 예약(미래) 결제 제외
    if (subWindowSet.has(m)) subWin.set(n, (subWin.get(n) ?? 0) + amt(l));
    if (m > (subLast.get(n) ?? "")) subLast.set(n, m);
  }
  const subWindowN = subWindowMonths.length;
  const subs = Array.from(sM.entries()).map(([name, v]) => {
    const lastMonth = subLast.get(name) ?? "";
    return {
      name, ...v,
      avg: v.count > 0 ? Math.round(v.total / v.count) : 0,
      monthly: subWindowN > 0 ? Math.round((subWin.get(name) ?? 0) / subWindowN) : 0,
      lastMonth,
      active: lastMonth >= activeSince,
    };
  }).filter(s => s.name).sort((a, b) => b.total - a.total);
  let subWinTotal = 0;
  for (const v of subWin.values()) subWinTotal += v;
  const subMonthly = subWindowN > 0 ? Math.round(subWinTotal / subWindowN) : 0;
  const subWindow = subWindowN > 0 ? { start: subWindowMonths[0], end: subWindowMonths[subWindowN - 1], months: subWindowN } : null;

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
      // 환율 미확보 기록은 손익이 왜곡값 — summarizeRecords(실현 KPI)와 같은 기준으로 제외해 목록 합 = KPI
      if (r.fxUnreliable) continue;
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

  /* 소비 스트릭·월별 무지출일·거래 간격 — utils/insightsPatterns 단일 소스.
     집계 구간 = 첫 지출일 ~ min(오늘, 마지막 기록일). 첫 지출 전(초기 잔액만 있던 달)과 마지막 기록 후(아직 입력 안 한 날)는
     무지출이 아니라 '기록 없음' — 예전엔 둘 다 무지출로 세어 최장 무지출 31일·"현재 5일 연속 무지출" 허위가 나왔다.
     선택월이면 그 달만(예전엔 전체 months를 넘겨 다른 달 전체가 무지출로 잡혔다). */
  const msCheck = selMonth ? [selMonth] : months;
  const patternStats = computePatternStats({ fExp, months: msCheck, ml, todayIso: todayKst, firstSpendIso, lastRecordedIso });
  /* zero spend days — patternStats 월별 집계의 합 (무지출 일수·일평균 지출의 분모가 스트릭과 같은 구간) */
  let zeroDays = 0, totalDays = 0;
  for (const z of patternStats.zeroDaysPerMonth) { zeroDays += z.zeroDays; totalDays += z.totalDays; }

  /* weekend vs weekday — parseIsoLocal 로컬 파싱 (요일 밀림 방지) */
  let weekendTot = 0, weekdayTot = 0;
  for (const l of fExp) { const d = parseIsoLocal(l.date)?.getDay(); if (d == null) continue; if (d === 0 || d === 6) weekendTot += amt(l); else weekdayTot += amt(l); }

  /* top spend dates */
  const tdM = new Map<string, { total: number; items: { desc: string; amount: number }[] }>();
  for (const l of fExp) {
    if (!tdM.has(l.date)) tdM.set(l.date, { total: 0, items: [] });
    // 설명이 없으면 분류로 — category("지출")를 그대로 쓰면 "지출 62만원" 같은 무의미한 칩이 된다
    const label = isMeaningfulDesc(l.description, l.category, l.subCategory) ? (l.description ?? "").trim() : (l.detailCategory || l.subCategory || l.category || "기타");
    const e = tdM.get(l.date)!; e.total += amt(l); e.items.push({ desc: label, amount: amt(l) });
  }
  const topDates = Array.from(tdM.entries()).map(([date, v]) => ({ date, ...v })).sort((a, b) => b.total - a.total).slice(0, 5);

  /* (재무 건강 점수는 폐지 — 대출·용돈까지 '수입원'으로 세어 90점 A+ "완벽한 재무 습관!"을 주던 등급표.
     종합 탭의 사실 체크(OverviewTab)가 실질 저축률·순유동자산·부채로 대신한다.) */

  /* prev month */
  let prev: D["prev"] = null;
  if (selMonth) {
    const [y, m] = selMonth.split("-").map(Number); const pd = new Date(y, m - 2, 1);
    const pm = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, "0")}`;
    // 선택 월이 진행 중인 이번 달이면 전월도 같은 기간(1~마지막 기록일)만 — 완결 전월 전체와 비교하면
    // 월급일 전 내내 "근로소득 −100%, 지출 감소 — 좋은 흐름" 허위 문구가 뜬다 (CLAUDE.md 규칙 13).
    // 오늘이 아니라 마지막 기록일까지 — 기록을 몰아서 입력하면 아직 안 넣은 날이 '지출 감소'로 보인다.
    const partialDay = curMonthStr === selMonth ? recDayCap : null;
    let pi = 0, pe = 0, ps = 0;
    // 당월(pIncome/pExpense)과 동일한 분류 기준 — 예전엔 전월만 재테크 제외가 빠져
    // 레거시 저축성지출이 전월 지출에 섞였고, "전월 대비" 배지가 허위 개선률을 표시했다.
    for (const l of ledger) {
      if (l.date?.slice(0, 7) !== pm) continue;
      if (partialDay != null && Number(l.date.slice(8, 10)) > partialDay) continue;
      const a = amt(l); if (a <= 0) continue;
      const flow = flowOf(l);
      if (flow === "income") { pi += a; if (salaryKeys.has(l.subCategory || l.category || "")) ps += a; }
      else if (flow === "expense") pe += a;
    }
    // 전월 실질 지출도 realFlows 단일 소스에서 가져온다 — 없으면 pe(장부 지출)로 대체.
    // (당월 값은 실질 지출인데 전월만 장부 지출과 비교하면 "실질 지출" 배지가 엉뚱한 방향을 가리킨다)
    // realFlows는 월 전체 합이라 동기 비교(partialDay)에선 쓸 수 없다 → pe로 대체 (현재 UI 미사용 필드)
    const prevRealExpense = partialDay != null ? pe : realFlows.get(pm)?.realExpense ?? pe;
    if (pi > 0 || pe > 0) prev = { income: pi, expense: pe, salary: ps, realExpense: prevRealExpense, partialDay };
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
  const doneCnt = months.filter(m => m < curMonthStr && (!selMonth || m <= selMonth)).length;
  // 키별 월별 합계 조회 — base에서 1패스로 만든 맵(mTotalsFor와 동일 값). 없는 키면 0 배열(= 매칭 0건)
  const zeroTotals = () => months.map(() => 0);

  /* ===== 지출 중분류별 인사이트 =====
     문구는 근거만 — 직전 두 완결 월의 변화를 건수 효과/건당 금액 효과로 분해하고, 새로 생기거나 빠진 지출처와
     최대 단건이 변화에서 차지하는 몫을 보여준다. 의미 있는 변화가 없으면 변화 문장을 생략한다.
     (예전엔 모든 항목에 "구매 전 필요성…", "비정기 대량 구매가 영향…" 같은 같은 조언이 붙었다) */
  const cmpA = doneCnt >= 2 ? months[doneCnt - 2] : null; // 비교 기준 완결 월
  const cmpB = doneCnt >= 1 ? months[doneCnt - 1] : null; // 최근 완결 월
  type SubMonthEntries = { a: LedgerEntry[]; b: LedgerEntry[] };
  const subCmpEntries = new Map<string, SubMonthEntries>();
  if (cmpA && cmpB) {
    for (const l of ledger) {
      const m = l.date?.slice(0, 7);
      if ((m !== cmpA && m !== cmpB) || Number(l.amount) <= 0 || flowOf(l) !== "expense") continue;
      const key = expSubName(l);
      const bucket = subCmpEntries.get(key) ?? { a: [], b: [] };
      (m === cmpA ? bucket.a : bucket.b).push(l);
      subCmpEntries.set(key, bucket);
    }
  }
  const merchantTotals = (rows: LedgerEntry[]) => {
    const mm = new Map<string, number>();
    for (const l of rows) {
      if (!isMeaningfulDesc(l.description, l.category, l.subCategory)) continue;
      const k = (l.description ?? "").trim();
      mm.set(k, (mm.get(k) ?? 0) + amt(l));
    }
    return mm;
  };
  const subInsights: SubInsight[] = expBySub.slice(0, 15).map(s => {
    // 필터·키·금액 모두 fExp/expBySub와 동일 기준 (flowOf + expSubName + 환산) — 어긋나면 월별 추세가 합계와 안 맞는다
    const mTotals = [...(base.expSubMonthly.get(s.sub) ?? zeroTotals())];
    // 추세·피크·연속증가는 완결 월만으로 계산 (수입 인사이트와 동일 기준)
    const doneTotals = mTotals.slice(0, doneCnt);
    const { nonZero, monthAvg } = calcTrend(doneTotals);
    const peakIdx = doneTotals.length > 0 ? doneTotals.indexOf(Math.max(...doneTotals)) : -1;
    // 직전 두 완결 월 변화 — 기준이 작을 때 "+4,501%"를 내세우지 않는 describeChange
    const chg = cmpA && cmpB ? describeChange(doneTotals[doneCnt - 2] ?? 0, doneTotals[doneCnt - 1] ?? 0) : null;
    const monthTrend: SubInsight["monthTrend"] = !chg ? "flat"
      : chg.kind === "new" || chg.kind === "surge" || chg.kind === "up" ? "up"
      : chg.kind === "gone" || chg.kind === "down" ? "down" : "flat";
    const mom = chg?.pct ?? 0;
    const trendLabel = chg && cmpA && cmpB ? `${ml[cmpB]} vs ${ml[cmpA]}: ${chg.text}` : "비교할 완결 월이 2개 미만";
    // 해당 중분류 최대 단건
    let maxSingle = 0, maxSingleDesc = "";
    for (const l of fExp) {
      if (expSubName(l) !== s.sub) continue;
      const a = amt(l);
      if (a > maxSingle) { maxSingle = a; maxSingleDesc = isMeaningfulDesc(l.description, l.category, l.subCategory) ? (l.description ?? "").trim() : (l.detailCategory || l.subCategory || ""); }
    }
    // 해당 중분류 내 최다 지출처 — 설명 없는 기록("기타"·"지출")은 지출처로 내세우지 않는다
    const descMap = merchantTotals(fExp.filter(l => expSubName(l) === s.sub));
    const topDescEntry = [...descMap.entries()].sort((a, b) => b[1] - a[1])[0];
    // 연속 증가 월수 (완결 월 기준 — 진행 중인 달이 끼면 항상 끊긴 것으로 보임)
    let streakUp = 0;
    for (let i = doneTotals.length - 1; i >= 1; i--) {
      if (doneTotals[i] > doneTotals[i - 1] && doneTotals[i] > 0) streakUp++; else break;
    }
    const share = Math.round(SD(s.amount, pExpense) * 100);
    const activeMonths = nonZero.length;

    const comments: string[] = [];
    // 1) 변화의 근거 — 의미 있는 변화일 때만
    const pair = subCmpEntries.get(s.sub);
    if (chg && pair && (chg.kind === "up" || chg.kind === "down" || chg.kind === "surge" || chg.kind === "new" || chg.kind === "gone")) {
      const nA = pair.a.length, nB = pair.b.length;
      const totA = pair.a.reduce((x, l) => x + amt(l), 0), totB = pair.b.reduce((x, l) => x + amt(l), 0);
      if (nA > 0 && nB > 0) {
        // 변화 = 건수 효과 (nB−nA)×이전 건당 + 건당 효과 nB×(이번 건당−이전 건당) — 두 항의 합이 정확히 변화액
        const countEff = (nB - nA) * (totA / nA);
        const ticketEff = (totB - totA) - countEff;
        comments.push(`건수 ${nA}→${nB}건(${signedF(countEff)}), 건당 ${F(Math.round(totA / nA))}→${F(Math.round(totB / nB))}원(${signedF(ticketEff)}).`);
      } else if (nA === 0) {
        comments.push(`${ml[cmpA!]}엔 기록이 없던 항목 — ${ml[cmpB!]} ${nB}건.`);
      } else {
        comments.push(`${ml[cmpB!]}엔 기록 없음 (${ml[cmpA!]} ${nA}건).`);
      }
      const ma = merchantTotals(pair.a), mb = merchantTotals(pair.b);
      const added = [...mb.entries()].filter(([k]) => !ma.has(k)).sort((x, y) => y[1] - x[1]).slice(0, 2);
      const dropped = [...ma.entries()].filter(([k]) => !mb.has(k)).sort((x, y) => y[1] - x[1]).slice(0, 2);
      if (chg.diff > 0 && added.length > 0) comments.push(`새 지출처: ${added.map(([k, v]) => `${k}(${F(v)}원)`).join(", ")}.`);
      if (chg.diff < 0 && dropped.length > 0) comments.push(`빠진 지출처: ${dropped.map(([k, v]) => `${k}(${F(v)}원)`).join(", ")}.`);
      if (chg.diff > 0 && nB > 0) {
        const big = pair.b.reduce((m, l) => amt(l) > amt(m) ? l : m, pair.b[0]);
        const bigShare = amt(big) / chg.diff;
        if (bigShare >= 0.5) {
          const name = isMeaningfulDesc(big.description, big.category, big.subCategory) ? (big.description ?? "").trim() : (big.detailCategory || s.sub);
          comments.push(`최대 단건 ${name}(${F(amt(big))}원, ${big.date})이 증가분의 ${Math.min(100, Math.round(bigShare * 100))}%.`);
        }
      }
    }
    // 2) 구조 사실 — 비중·발생 빈도·주요 지출처·최고월
    if (share >= 5) comments.push(`기간 지출의 ${share}%.`);
    if (doneCnt >= 3 && activeMonths < doneCnt * 0.5) comments.push(`완결 ${doneCnt}개월 중 ${activeMonths}개월만 발생한 비정기 지출.`);
    if (streakUp >= 3) comments.push(`${streakUp}개월 연속 증가.`);
    if (topDescEntry && s.amount > 0 && topDescEntry[1] / s.amount >= 0.3) {
      comments.push(`주요 지출처 ${topDescEntry[0]}(${F(topDescEntry[1])}원, ${Math.round(topDescEntry[1] / s.amount * 100)}%).`);
    }
    if (activeMonths >= 3 && months[peakIdx]) comments.push(`최고월 ${ml[months[peakIdx]]}(${F(doneTotals[peakIdx])}원).`);

    return {
      sub: s.sub, cat: s.cat, total: s.amount, count: s.count,
      avg: Math.round(SD(s.amount, s.count)),
      monthTrend, mom, peak: peakIdx >= 0 && months[peakIdx] ? ml[months[peakIdx]] : "", share,
      monthAvg, maxSingle, maxSingleDesc,
      activeMonths, doneMonths: doneCnt, trendLabel,
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
    return { sub, total, count: cnt, avg, monthTrend, mom, share, monthAvg, stability, maxMonth, maxMonthAmt, nature, isReal, realShare, recurring };
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
    cs.push(`데이트 지출의 ${share}%.`);
    cs.push(`총 ${entries.length}건 발생, 건당 평균 ${F(avg)}.`);
    if (uniqueDates.size > 0) {
      cs.push(`${uniqueDates.size}일에 걸쳐 이용, 이용일당 평균 ${F(avgPerVisit)}.`);
      if (entries.length > uniqueDates.size * 1.5) cs.push(`같은 날 여러 건 결제하는 패턴이 있습니다.`);
    }
    if (maxSingle > avg * 1.5 && maxSingleDesc) cs.push(`최대 단건 ${maxSingleDesc}(${F(maxSingle)}원${maxSingle > avg * 3 ? `, 건당 평균의 ${Math.round(SD(maxSingle, avg))}배` : ""}).`);
    return { sub, total, count: entries.length, avg, share, maxSingle, maxSingleDesc, avgPerVisit, comment: cs.join(" ") };
  });

  /* ===== 추가 계산 지표 ===== */
  const netProfit = realIncome - realExpense;
  let passiveIncome = 0;
  for (const [cat, val] of incByCat) { if (investIncKeys.has(cat)) passiveIncome += val; }
  // 지출/수입·순현금흐름은 근로소득 기준 — "월급으로 지출·투자를 감당하는가"를 현실적으로 표시
  const expToIncRatio = pSalary > 0 ? pExpense / pSalary * 100 : 0;
  const dailyAvgExp = totalDays > 0 ? Math.round(pExpense / totalDays) : 0;
  // 근로소득 잉여 — 예전 "근로소득−지출−투자"는 대출·용돈·기존 자산으로 한 투자까지 빼서 18개월 누적 −8,514만 같은
  // 의미 없는 숫자가 됐다. 잉여와 재테크를 나란히 두고 재원(대출 등)은 따로 보여준다.
  const salarySurplus = pSalary - pExpense;
  // 실질 지출(realFlows)은 투자손실을 포함하고 장부 지출(flowOf)은 재테크로 뺀다 — 화면 대조용
  let investLossInPeriod = 0;
  for (const l of fL) if (l.kind === "expense" && Number(l.amount) > 0 && isInvestmentLossEntry(l)) investLossInPeriod += amt(l);
  let loanInflow = 0;
  for (const [cat, val] of incByCat) if (classifyIncomeNature(cat, { salaryKeys, investIncKeys, nonRealKeys }) === "부채") loanInflow += val;
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
  // 연속 무지출 기록 — patternStats 단일 소스 (예전엔 여기서 첫~마지막 지출일로 따로 세어 4일, 패턴 탭은 31일이었다)
  const longestZeroStreak = patternStats.longestZeroStreak;
  // 주말 vs 평일
  const weekendVsWeekday = { weekend: weekendTot, weekday: weekdayTot };
  // 일평균 기록 건수 — 분모는 무지출일과 같은 집계 일수, 분자는 지출·수입·이체 모든 기록
  const avgTxPerDay = totalDays > 0 ? Math.round(fL.length / totalDays * 10) / 10 : 0;
  // 최다 이용 가게 (description 기준) — 설명 없는 기록·분류명 그대로인 설명은 가게가 아니다
  const storeMap = new Map<string, { total: number; count: number }>();
  for (const l of fExp) {
    if (!isMeaningfulDesc(l.description, l.category, l.subCategory)) continue;
    const desc = (l.description || "").trim();
    const p = storeMap.get(desc) ?? { total: 0, count: 0 };
    storeMap.set(desc, { total: p.total + amt(l), count: p.count + 1 });
  }
  let topStore: { name: string; total: number; count: number } | null = null;
  for (const [name, v] of storeMap) { if (!topStore || v.count > topStore.count) topStore = { name, ...v }; }
  // 월수입(근로소득)을 며칠만에 쓰는지 — selMonth 필터 시 1개월 기준
  const avgMonthInc = pSalary / (selMonth ? 1 : Math.max(1, months.length));
  const daysToSpendIncome = avgMonthInc > 0 && dailyAvgExp > 0 ? Math.round(avgMonthInc / dailyAvgExp) : null;

  // 가장 절약한/많이 쓴 달·최고 저축률 달 — 완결 월만 (진행 중인 달 1~9일 지출 7.7만이 "가장 절약한 달"이 되던 문제).
  // 기간 필터가 첫 달 중간을 자른 부분 월, 지출 기록이 없는 달(초기 잔액만 있던 달)도 제외.
  const recordMonths = months.filter((m, i) => m < curMonthStr && !(i === 0 && base.firstMonthCut));
  let mostFrugalMonth: D["funStats"]["mostFrugalMonth"] = null;
  let mostSpendMonth: D["funStats"]["mostSpendMonth"] = null;
  let bestSavingsMonth: D["funStats"]["bestSavingsMonth"] = null;
  for (const m of recordMonths) {
    const e = monthly[m].expense;
    if (e > 0 && (!mostFrugalMonth || e < mostFrugalMonth.expense)) mostFrugalMonth = { month: m, expense: e };
    if (e > 0 && (!mostSpendMonth || e > mostSpendMonth.expense)) mostSpendMonth = { month: m, expense: e };
    const rf = realFlows.get(m);
    const rawRate = rf ? computeRealSavingsRate(rf.realIncome, rf.realExpense) : null;
    if (rawRate != null) {
      const rate = Math.round(rawRate);
      if (!bestSavingsMonth || rate > bestSavingsMonth.rate) bestSavingsMonth = { month: m, rate };
    }
  }

  const funStats = {
    biggestSpendDay, mostFrugalMonth, mostSpendMonth, longestZeroStreak,
    weekendVsWeekday, avgTxPerDay, topStore, monthOverMonthGrowth: base.monthOverMonthGrowth,
    daysToSpendIncome, bestSavingsMonth,
  };

  /* 최근 월 이상치 감지 (z-score ≥ 2, 6개월 lookback) */
  const anomalyTargetMonth = selMonth ?? months[months.length - 1] ?? null;
  const topAnomaly = (() => {
    if (!anomalyTargetMonth) return null;
    // 진행 중인 달이면 과거 달도 같은 기간(1~마지막 기록일)만 비교 — 월말에만 경고 켜지는 사각 방지
    const anomalyDayCap = anomalyTargetMonth === curMonthStr ? recDayCap : undefined;
    // krwLedger — detectSpendAnomalies는 amount를 그대로 합산한다 (원본이면 $100 = 100원)
    const results = detectSpendAnomalies(krwLedger, anomalyTargetMonth, 6, anomalyDayCap, categoryPresets);
    const triggered = results.filter((a) => a.isAnomaly).sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
    return triggered[0] ?? null;
  })();

  /* 수입 성장률 시계열·MoM/YoY — utils/insightsTrends 단일 소스.
     진행 중인 달이면 전월·전년의 "같은 기간(1~마지막 기록일)"과 비교 (월중 -90%대 왜곡 방지).
     todayDayNum에 오늘 대신 recDayCap을 넘긴다 — 기록을 몰아 입력하는 사용자의 미입력 일자를 '감소'로 보지 않게. */
  const todayDayNum = recDayCap;
  // 아래 셋·이상감지는 amount를 그대로 합산 → 원화 환산본(krwLedger)을 넘긴다 (monthlyReview와 같은 계약)
  const incomeGrowth = computeIncomeGrowth({ ledger: krwLedger, months, ml, salaryMonthly, salaryKeys, curMonthStr, anomalyTargetMonth, todayDayNum });

  /* 지출 관성: 현재월 지출 vs 최근 3개월 평균 — utils/insightsTrends 단일 소스.
     진행 중인 달이면 과거 3개월도 "같은 기간(1~오늘 일)"만 합산 (월중 "절약 모드" 왜곡 방지). */
  const spendingInertia = computeSpendingInertia({ ledger: krwLedger, months, monthly, curMonthStr, anomalyTargetMonth, todayDayNum, categoryPresets });

  /* 카테고리 성장률 TOP — 현재월 중분류 지출 vs 최근 3개월 평균 — utils/insightsTrends 단일 소스.
     진행 중인 달이면 과거 3개월도 같은 기간(1~오늘 일)만 집계 (월중 전부 "감소" 왜곡 방지). */
  const categoryGrowth = computeCategoryGrowth({ ledger: krwLedger, months, curMonthStr, anomalyTargetMonth, todayDayNum, categoryPresets });

  /* 단건 지출 이상치 TOP — 중분류 내 z-score — utils/insightsPatterns 단일 소스 (금액은 원화 환산) */
  const entryOutliers = computeEntryOutliers(fExp.map(l => ({ ...l, amount: amt(l) })));

  /* 재정 활주로 분모 — 완결 월만의 월평균 지출. 진행 중인 달·기간 필터로 잘린 첫 달(부분 월)을 넣으면
     평균이 내려가 활주로가 ~30% 부풀었다. 완결 월이 없으면(첫 달 사용자) 전 기간으로 폴백. */
  const doneMonths = months.filter((m, i) => m < curMonthStr && !(i === 0 && base.firstMonthCut));
  const avgMonths = doneMonths.length > 0 ? doneMonths : months;
  const avgMonthExp = SD(avgMonths.reduce((s, m) => s + monthly[m].expense, 0), Math.max(avgMonths.length, 1));

  /* DOM 월 가중치 보정 — 각 일자(1~31)가 기간 내 며칠만큼 존재했는지 (base.domOccurrences) */
  const spendByDOMAvg = spendByDOM.map((v, i) => base.domOccurrences[i] > 0 ? v / base.domOccurrences[i] : 0);

  // 누적 개월·월평균 분모 — 이월(초기 잔액)만 있는 달은 흐름이 0이라 세지 않는다 (실장부: 2025-06이 이월 11건뿐이라 "18개월"로 부풀었음)
  const flowMonths = months.filter((m) => monthly[m].income !== 0 || monthly[m].expense !== 0 || monthly[m].investment !== 0);
  const { monthSpan, accumLabel } = computePeriodScope(selMonth, flowMonths.length > 0 ? flowMonths : months, ml);
  const recorded: D["recorded"] = {
    lastDate: lastRecordedIso,
    daysSince: daysSinceLastRecord(allLedger, todayKst),
    dayCap: months.includes(curMonthStr) || (selMonth === curMonthStr) ? recDayCap : null,
  };

  return {
    months, ml, selMonth, monthSpan, accumLabel, txCount: fL.length, anomalyTargetMonth, topAnomaly, incomeGrowth, spendingInertia,
    categoryGrowth, entryOutliers, spendByDOMAvg, domOccurrences: base.domOccurrences, patternStats,
    monthly, salaryMonthly, realIncomeMonthly: base.realIncomeMonthly, savRateTrend: base.savRateTrend, salaryTrend: base.salaryTrend, cumIE: base.cumIE, investTrend: base.investTrend, divTrend: base.divTrend, tradeCntTrend: base.tradeCntTrend, subTrend: base.subTrend, txCntTrend: base.txCntTrend, cumSpend: base.cumSpend, monthlyCatTrend, dateExpMonthly,
    pIncome, pSalary, pExpense, pInvest, expByCat, expBySub, topCats, acctUsage, wdSpend, dateTop, dateSubCats, dateEntries, dateTxCount, incByCat, trades, subs, largeExp, topTx, expBySubCat, expByDesc, dateMoim, datePersonal, spendByDOM, portfolio: base.portfolio, realPL: { total: realPL.total, wins: realPL.wins, losses: realPL.losses, winCnt: realPL.winCnt, lossCnt: realPL.lossCnt }, closedByStock,
    investBreakdown: base.investBreakdown, holdingsByStock: base.holdingsByStock, totalHoldingsCost: base.totalHoldingsCost,
    zeroDays, totalDays, weekendTot, weekdayTot, topDates,
    recorded, prev, avgMonthExp, investLossInPeriod, loanInflow,
    incByGroup, investBySub, dateByDetail, stockTrends: base.stockTrends,
    subInsights, incSubInsights, dateSubInsights,
    realIncome, incomeOutsideLedger, carryOverIncome, realExpense, settlementTotal, tempIncomeTotal, dateAccountSpend, datePartnerShare, moimFlow: base.moimFlow, originalAssets: base.originalAssets, originalAssetsByAcct: base.originalAssetsByAcct,
    netProfit, realSavRate, passiveIncome, expToIncRatio, dailyAvgExp, salarySurplus,
    incomeStability: base.incomeStability, investReturnRate: base.investReturnRate, subTotal, subMonthly, subWindow, fixedExpense, variableExpense, discretionaryExpense,
    netWorthByMonth: base.netWorthByMonth, netWorthChangeBasis: base.netWorthChangeBasis, accountBalances: base.accountBalances, assetAllocation: base.assetAllocation, funStats,
  };
}
