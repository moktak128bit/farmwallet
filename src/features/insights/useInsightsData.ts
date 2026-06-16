/**
 * 인사이트 파생 데이터셋(D) 계산 훅 — InsightsPage에서 분리.
 * 가계부·거래 원본을 받아 탭들이 공유하는 대형 memo 데이터셋(D)을 반환한다.
 * 로직은 InsightsPage의 useD를 그대로 이동 (memo deps 동일).
 */
import { useMemo } from "react";
import type { Account, LedgerEntry, StockTrade, StockPrice, CategoryPresets, BudgetGoal } from "../../types";
import { computeAccountBalances, computePositions, positionMarketValueKRW } from "../../calculations";
import { computePortfolioMetrics, computeUnrealizedPL } from "../../utils/portfolioMetrics";
import { computeIncomeGrowth, computeSpendingInertia, computeCategoryGrowth } from "../../utils/insightsTrends";
import { computeEntryOutliers, computePatternStats } from "../../utils/insightsPatterns";
import { calcTrend, mTotalsFor, computePeriodScope } from "../../utils/insightsHelpers";
import { isInvestmentEntry, isCreditPayment } from "../../utils/category";
import { tradeAmountKRW } from "../../utils/finance";
import { detectSpendAnomalies } from "../../utils/anomaly";
import { buildClosedTradeRecords, summarizeRecords, summaryToRealPL } from "../../utils/investmentRecord";
import { computeOriginalAssets, classifyIncomeNature } from "../../utils/realIncome";
import { computeIncomeNatureKeys } from "../../utils/incomeClassification";
import { classifyExpenses } from "../../utils/expenseClassification";
import { isDateEntry, getMoimAccountIds, computeMoimAccountFlow } from "../../utils/dateAccounting";
import { isCarryOverIncomeEntry, computeRealSavingsRate, computeMonthlyRealFlows } from "../../utils/savingsRate";
import { parseIsoLocal, formatIsoLocal, getTodayKST, getThisMonthKST } from "../../utils/date";
import type { AccountTimelineRow } from "../../utils/accountTimeline";
import {
  F, SD,
  type D, type SubInsight, type IncSubInsight, type DateSubInsight, type InvestSubInsight,
} from "./insightsShared";

// _budgetGoals: 예산 vs 실적 파생 제거(대시보드 BudgetAlertWidget 단일화) 후 미사용 — 호출부 시그니처 유지용
// timelineRows: 대시보드와 동일한 순자산 타임라인(시세·환율·대출 반영) — InsightsPage가 전체 기간으로 1회 계산
// allLedger: 기간 필터 전 전체 가계부 — 계좌별 현재 잔액(누적)의 정확성을 위해 별도 전달
export function useInsightsData(ledger: LedgerEntry[], rawTrades: StockTrade[], allTrades: StockTrade[], accounts: Account[], prices: StockPrice[], selMonth: string | null, categoryPresets: CategoryPresets | undefined, _budgetGoals: BudgetGoal[] | undefined, dateAccountId: string | null, fxRate: number | null, timelineRows: AccountTimelineRow[], allLedger: LedgerEntry[]): D {
  return useMemo(() => {
    const aMap = new Map(accounts.map(a => [a.id, a.name]));
    const invIds = new Set(accounts.filter(a => a.type === "securities" || a.type === "crypto").map(a => a.id));
    const moimIds = getMoimAccountIds(accounts);

    /* ===== monthly (full period) ===== */
    const monthly: Record<string, { income: number; expense: number; investment: number }> = {};
    const em = (m: string) => { if (!monthly[m]) monthly[m] = { income: 0, expense: 0, investment: 0 }; };
    for (const l of ledger) {
      const m = l.date?.slice(0, 7); if (!m) continue; em(m);
      const a = Number(l.amount); if (a <= 0) continue;
      // 이월/원래 보유 자산은 실수입이 아니므로 월별 수입에서도 제외 (모든 수입 지표 일관)
      if (l.kind === "income") { if (!isCarryOverIncomeEntry(l)) monthly[m].income += a; }
      else if (isInvestmentEntry(l)) monthly[m].investment += a; // 저축·투자 이체
      // 환전은 계좌 간 이동이라 지출 아님 — fExp/pExpense와 동일 기준으로 제외 (월별 추세 ↔ 기간 합계 정합)
      else if (l.kind === "expense" && !isCreditPayment(l) && l.category !== "환전") monthly[m].expense += a;  // 신용결제는 카드 사용시 이미 잡힘 — 이중계상 방지
      else if (l.kind === "transfer" && l.toAccountId && invIds.has(l.toAccountId)) monthly[m].investment += a;
    }
    const months = Object.keys(monthly).sort();
    const ml: Record<string, string> = {};
    months.forEach(m => { ml[m] = parseInt(m.slice(5)) + "월"; });

    /* ===== filter for period ===== */
    const fL = selMonth ? ledger.filter(l => l.date?.startsWith(selMonth)) : ledger;
    const fT = selMonth ? rawTrades.filter(t => t.date?.startsWith(selMonth)) : rawTrades;
    // 일반 지출: expense kind 중 재테크/환전/신용결제 제외 (투자손실은 category=재테크라 자동 제외)
    // 신용결제 제외 이유: 카드 사용 시점에 이미 expense로 기록됨. 카드 대금 결제까지 합치면 이중계상 → 월 지출 ~2배 부풀려짐.
    const fExp = fL.filter(l => l.kind === "expense" && Number(l.amount) > 0 && l.category !== "재테크" && l.category !== "환전" && !isCreditPayment(l));
    // 수입 (투자수익도 kind=income으로 마이그레이션되어 자연 포함). 이월/원래보유자산 제외 — utils/savingsRate 단일 판정.
    const fInc = fL.filter(l => l.kind === "income" && Number(l.amount) > 0 && !isCarryOverIncomeEntry(l));

    /* period totals */
    const pIncome = fInc.reduce((s, l) => s + Number(l.amount), 0);
    // 투자손실은 지출 합계에 포함 (kind=expense, category=재테크, subCategory=투자손실)
    const pExpense = fExp.reduce((s, l) => s + Number(l.amount), 0) +
      fL.filter(l => l.kind === "expense" && l.category === "재테크" && l.subCategory === "투자손실" && Number(l.amount) > 0)
        .reduce((s, l) => s + Number(l.amount), 0);
    let pInvest = 0;
    for (const l of fL) {
      if (isInvestmentEntry(l)) pInvest += Number(l.amount);
      else if (l.kind === "transfer" && l.toAccountId && invIds.has(l.toAccountId)) pInvest += Number(l.amount);
    }
    /* ===== 실질 수입/지출 (정산·일시소득 제외, USD 환산, 데이트 50% 분담) — utils/savingsRate 단일 소스 ===== */
    const realFlows = computeMonthlyRealFlows(ledger, { fxRate, dateAccountId, nonRealIncomeOverride: categoryPresets?.categoryTypes?.nonRealIncome });
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

    /* ===== expenseByCategory (대분류) ===== */
    const catM = new Map<string, number>();
    for (const l of fExp) { const c = l.category || "기타"; catM.set(c, (catM.get(c) ?? 0) + Number(l.amount)); }
    const expByCat = Array.from(catM.entries()).sort((a, b) => b[1] - a[1]);
    const topCats = expByCat.slice(0, 6).map(([c]) => c);

    /* ===== expenseBySubCategory (중분류) ===== */
    const subM = new Map<string, { cat: string; sub: string; amount: number; count: number }>();
    for (const l of fExp) {
      const cat = l.category || "기타";
      const sub = l.subCategory || l.category || "기타";
      const key = sub;
      const prev = subM.get(key) ?? { cat, sub, amount: 0, count: 0 };
      subM.set(key, { cat: prev.cat, sub, amount: prev.amount + Number(l.amount), count: prev.count + 1 });
    }
    const expBySub = Array.from(subM.values()).sort((a, b) => b.amount - a.amount);

    /* monthlyCategoryTrend (full) */
    const monthlyCatTrend: Record<string, Record<string, number>> = {};
    for (const l of ledger) {
      if (l.kind !== "expense" || Number(l.amount) <= 0 || l.category === "환전" || isInvestmentEntry(l)) continue;
      const m = l.date?.slice(0, 7); if (!m) continue;
      const c = l.category || "기타"; if (!topCats.includes(c)) continue;
      if (!monthlyCatTrend[m]) monthlyCatTrend[m] = {};
      monthlyCatTrend[m][c] = (monthlyCatTrend[m][c] ?? 0) + Number(l.amount);
    }

    /* accountUsage */
    const auM = new Map<string, { count: number; total: number }>();
    for (const l of fExp) {
      if (!l.fromAccountId) continue;
      const n = aMap.get(l.fromAccountId) || l.fromAccountId;
      const p = auM.get(n) ?? { count: 0, total: 0 };
      auM.set(n, { count: p.count + 1, total: p.total + Number(l.amount) });
    }
    const acctUsage = Array.from(auM.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.total - a.total);

    /* subcategory breakdown */
    const scM = new Map<string, { cat: string; sub: string; amount: number; count: number }>();
    for (const l of fExp) {
      const cat = l.category || "기타";
      const sub = l.subCategory || l.description || "기타";
      const key = `${cat}__${sub}`;
      const prev = scM.get(key) ?? { cat, sub, amount: 0, count: 0 };
      scM.set(key, { cat, sub, amount: prev.amount + Number(l.amount), count: prev.count + 1 });
    }
    const expBySubCat = Array.from(scM.values()).sort((a, b) => b.amount - a.amount);

    /* description breakdown (top spending items) */
    const descM = new Map<string, { desc: string; cat: string; sub: string; amount: number }>();
    for (const l of fExp) {
      const desc = l.description || l.subCategory || "기타";
      const key = desc;
      const prev = descM.get(key) ?? { desc, cat: l.category || "기타", sub: l.subCategory || "", amount: 0 };
      descM.set(key, { ...prev, amount: prev.amount + Number(l.amount) });
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
      wdSpend[idx].total += Number(l.amount); wdSpend[idx].count++;
    }

    /* dateExpense — utils/dateAccounting.isDateEntry로 판정 */
    const dateExpMonthly: Record<string, number> = {};
    const dateDescM = new Map<string, number>();
    const dateSubCatM = new Map<string, number>();
    const dateEntries: { date: string; desc: string; sub: string; amount: number }[] = [];
    let dateMoim = 0, datePersonal = 0;
    for (const l of fL) {
      if (!isDateEntry(l)) continue;
      const a = Number(l.amount); const m = l.date?.slice(0, 7);
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
        dateExpMonthly[m] = (dateExpMonthly[m] ?? 0) + Number(l.amount);
      }
    }

    const dateTop = Array.from(dateDescM.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);
    const dateSubCats = Array.from(dateSubCatM.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);

    /* incomeByCategory — fInc가 이미 이월/원래보유자산을 제외했으므로 추가 필터 불필요 */
    const icM = new Map<string, number>();
    for (const l of fInc) {
      const c = l.subCategory || l.category || "기타";
      icM.set(c, (icM.get(c) ?? 0) + Number(l.amount));
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

    /* subscriptions — category 또는 subCategory에 "구독" 포함 */
    const isSubEntry = (l: LedgerEntry) => {
      if (l.kind !== "expense") return false;
      const cat = (l.category || "").trim();
      const sub = (l.subCategory || "").trim();
      return cat.includes("구독") || sub.includes("구독");
    };
    const sM = new Map<string, { count: number; total: number }>();
    for (const l of fL) {
      if (!isSubEntry(l)) continue;
      const n = l.description || l.subCategory || l.category || ""; if (!n) continue;
      const p = sM.get(n) ?? { count: 0, total: 0 };
      sM.set(n, { count: p.count + 1, total: p.total + Number(l.amount) });
    }
    const subs = Array.from(sM.entries()).map(([name, v]) => ({ name, ...v, avg: v.count > 0 ? Math.round(v.total / v.count) : 0 })).filter(s => s.name).sort((a, b) => b.total - a.total);

    /* largeExpenses */
    const largeExp = fExp.filter(l => Number(l.amount) >= 100000).sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 20)
      .map(l => ({ date: l.date, desc: l.description || "", sub: l.subCategory || l.category || "", amount: Number(l.amount) }));

    /* topTransactions (top 10) */
    const topTx = [...fExp].sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 10)
      .map(l => ({ date: l.date, desc: l.description || "", cat: l.category || "", sub: l.subCategory || "", amount: Number(l.amount) }));

    /* spendingByDayOfMonth */
    const spendByDOM = new Array(31).fill(0);
    for (const l of fExp) { const d = parseInt(l.date?.slice(8, 10) || "0") - 1; if (d >= 0 && d < 31) spendByDOM[d] += Number(l.amount); }

    /* ===== 소득 분류 자동 감지 — utils/incomeClassification 단일 소스 (대시보드와 공유) ===== */
    const { salaryKeys, investIncKeys } = computeIncomeNatureKeys(ledger, accounts, categoryPresets?.categoryTypes);
    // 설정에서 "비실질"로 지정한 수입 카테고리 — classifyIncomeNature가 비실질로 분류하도록
    const nonRealKeys = new Set(categoryPresets?.categoryTypes?.nonRealIncome ?? []);

    /* ===== 근로소득(월급·수당·상여) 단일 기준 =====
       수입 추세·흐름·비율(성장률·누적·순현금흐름·안정성·지출/수입·소진속도)은 "정기적으로 버는 돈"만
       보여줘야 현실적 — 정산·용돈·지원·환불·대출(비실질)뿐 아니라 배당·이자·캐시백(비근로)도 추세에서 제외.
       salaryKeys = 회사소득 그룹. 수입원 구성(incByCat)·장부 표시·패시브 비율은 이 기준을 쓰지 않는다. */
    const salaryMonthly: Record<string, number> = {};
    for (const m of months) salaryMonthly[m] = 0;
    for (const l of ledger) {
      if (l.kind !== "income" || Number(l.amount) <= 0) continue;
      const m = l.date?.slice(0, 7); if (!m || salaryMonthly[m] === undefined) continue;
      if (isCarryOverIncomeEntry(l)) continue;
      if (salaryKeys.has(l.subCategory || l.category || "")) salaryMonthly[m] += Number(l.amount);
    }
    const pSalary = (selMonth ? [selMonth] : months).reduce((s, m) => s + (salaryMonthly[m] ?? 0), 0);
    // 월별 실질 수입 — 패시브 비율 추이의 분모(정산·용돈 제외, 배당·이자 포함)로 사용. realFlows 단일 소스.
    const realIncomeMonthly: Record<string, number> = {};
    for (const m of months) realIncomeMonthly[m] = realFlows.get(m)?.realIncome ?? 0;

    /* ===== trend data (full period) ===== */
    // 저축률 추이 — 실질 저축률 정의로 통일 (realFlows 기반, 분모 0이면 0)
    const savRateTrend: D["savRateTrend"] = [];
    {
      let cumInc = 0, cumExp = 0;
      for (const m of months) {
        const rf = realFlows.get(m);
        const i = rf?.realIncome ?? 0, e = rf?.realExpense ?? 0;
        cumInc += i; cumExp += e;
        savRateTrend.push({
          l: ml[m],
          rate: computeRealSavingsRate(i, e) ?? 0,
          cumRate: computeRealSavingsRate(cumInc, cumExp) ?? 0,
          sav: i - e,
        });
      }
    }
    const salaryTrend = months.map(m => {
      let sal = 0, non = 0;
      for (const l of ledger) {
        if (l.kind !== "income" || l.date?.slice(0, 7) !== m || Number(l.amount) <= 0) continue;
        const sub = l.subCategory || l.category || "";
        if (isCarryOverIncomeEntry(l)) continue;
        if (salaryKeys.has(sub)) sal += Number(l.amount); else non += Number(l.amount);
      }
      return { l: ml[m], salary: sal, nonSalary: non };
    });
    let ci = 0, ce = 0;
    // 누적수입은 근로소득 기준 (정산·용돈·배당 등 비근로 유입 제외 — 위 salaryMonthly 주석 참조)
    const cumIE = months.map(m => { ci += salaryMonthly[m]; ce += monthly[m].expense; return { l: ml[m], 누적수입: ci, 누적지출: ce }; });
    const investTrend = months.map(m => ({ l: ml[m], amount: monthly[m].investment }));
    const divTrend = months.map(m => {
      let d = 0;
      // subCategory 없으면 category 폴백 — incByCat·investIncKeys 산출과 동일 키 규칙
      for (const l of ledger) { if (l.kind !== "income" || l.date?.slice(0, 7) !== m) continue; if (investIncKeys.has(l.subCategory || l.category || "")) d += Number(l.amount); }
      return { l: ml[m], amount: d };
    });
    const tradeCntTrend = months.map(m => ({ l: ml[m], count: rawTrades.filter(t => t.date?.slice(0, 7) === m).length }));
    const subTrend = months.map(m => {
      let a = 0; for (const l of ledger) { if (l.date?.slice(0, 7) !== m || !isSubEntry(l)) continue; a += Number(l.amount); }
      return { l: ml[m], amount: a };
    });
    const txCntTrend = months.map(m => ({ l: ml[m], count: ledger.filter(l => l.date?.slice(0, 7) === m).length }));

    /* cumulativeSpending (full) */
    const cumSpend: Record<string, number[]> = {};
    for (const m of months) {
      const [y, mo] = m.split("-").map(Number); const dim = new Date(y, mo, 0).getDate();
      const daily = new Array(31).fill(0);
      for (const l of ledger) {
        if (l.kind !== "expense" || l.category === "환전" || isInvestmentEntry(l) || l.date?.slice(0, 7) !== m) continue;
        const d = parseInt(l.date.slice(8, 10)) - 1; if (d >= 0 && d < 31) daily[d] += Number(l.amount);
      }
      const cum: number[] = []; let r = 0;
      for (let d = 0; d < 31; d++) { if (d < dim) r += daily[d]; cum.push(r); }
      cumSpend[m] = cum;
    }

    /* portfolio allocation — 현재 보유 포지션의 시세 평가액 기준.
       기존 buyTotal(누적 매수금액) 합산은 ① 이미 매도한 종목이 계속 잡히고(이름이 "BTC"/"bitcoin"처럼
       다르면 상쇄도 실패) ② 보유 규모가 아닌 과거 매수 규모를 보여줘 오해 유발 — 평가액으로 교체.
       암호화폐 판정은 이름 정규식 대신 계좌 타입(crypto)으로 — 거래 이름 표기에 의존하지 않음. */
    const curPositions = computePositions(allTrades, prices, accounts, { fxRate: fxRate ?? undefined, priceFallback: "cost" });
    // 포트폴리오 배분 + 종목별 FIFO 보유원가 — utils/portfolioMetrics 단일 소스(순수·테스트됨).
    // (누적 매수액 gross가 아닌 FIFO 잔여원가 기준 — 매도 후 재매수·부분 매도 부풀림 방지)
    const { portfolio, holdingsByStock, totalHoldingsCost } = computePortfolioMetrics(curPositions, accounts, fxRate);

    /* realized PL — FIFO 매칭 (리포트 InvestmentRecordCard와 동일 로직). 라이프타임 기준 (전체 trades) */
    const allClosedRecords = buildClosedTradeRecords(allTrades, accounts, fxRate ?? undefined);
    const lifetimeRealizedSummary = summarizeRecords(allClosedRecords);
    const realPL = summaryToRealPL(lifetimeRealizedSummary);
    const { total: plTot, wins: plWin, losses: plLoss, winCnt: plWC, lossCnt: plLC } = realPL;

    /* zero spend days */
    let zeroDays = 0, totalDays = 0;
    const spendSet = new Set(fExp.map(l => l.date));
    const msCheck = selMonth ? [selMonth] : months;
    for (const m of msCheck) {
      const [y, mo] = m.split("-").map(Number); const dim = new Date(y, mo, 0).getDate();
      const now = new Date(); const isCur = now.getFullYear() === y && now.getMonth() + 1 === mo;
      const md = isCur ? now.getDate() : dim;
      for (let d = 1; d <= md; d++) { totalDays++; if (!spendSet.has(`${m}-${String(d).padStart(2, "0")}`)) zeroDays++; }
    }

    /* weekend vs weekday — parseIsoLocal 로컬 파싱 (요일 밀림 방지) */
    let weekendTot = 0, weekdayTot = 0;
    for (const l of fExp) { const d = parseIsoLocal(l.date)?.getDay(); if (d == null) continue; if (d === 0 || d === 6) weekendTot += Number(l.amount); else weekdayTot += Number(l.amount); }

    /* top spend dates */
    const tdM = new Map<string, { total: number; items: { desc: string; amount: number }[] }>();
    for (const l of fExp) {
      if (!tdM.has(l.date)) tdM.set(l.date, { total: 0, items: [] });
      const e = tdM.get(l.date)!; e.total += Number(l.amount); e.items.push({ desc: l.description || l.category || "기타", amount: Number(l.amount) });
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
      for (const l of ledger) {
        if (l.date?.slice(0, 7) !== pm) continue;
        const a = Number(l.amount); if (a <= 0) continue;
        // 이월/원래 보유 자산은 전월 수입에서도 제외 (모든 수입 지표 일관)
        if (l.kind === "income") { if (!isCarryOverIncomeEntry(l)) { pi += a; if (salaryKeys.has(l.subCategory || l.category || "")) ps += a; } }
        // 지출: 일반 지출 + 투자손실(category=재테크). 환전·신용결제는 제외.
        else if (l.kind === "expense" && l.category !== "환전" && !isCreditPayment(l)) pe += a;
      }
      if (pi > 0 || pe > 0) prev = { income: pi, expense: pe, salary: ps };
    }

    const fullMonths = Math.max(months.length, 1);
    const avgMonthExp = SD(months.reduce((s, m) => s + monthly[m].expense, 0), fullMonths);

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
      ivSubM.set(sub, { amount: p.amount + Number(l.amount), count: p.count + 1 });
    }
    const investBySub = [...ivSubM.entries()].map(([sub, v]) => ({ sub, ...v })).sort((a, b) => b.amount - a.amount);

    /* ===== 데이트 소분류별 ===== */
    const dateDetM = new Map<string, number>();
    for (const l of fL) {
      if (!isDateEntry(l)) continue;
      const det = l.detailCategory || l.description || "기타";
      dateDetM.set(det, (dateDetM.get(det) ?? 0) + Number(l.amount));
    }
    const dateByDetail = [...dateDetM.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);

    /* ===== 종목별 누적 매수금액 추이 (상위 종목 자동 감지) ===== */
    const stockBuyTotals = new Map<string, number>();
    for (const t of rawTrades) {
      if (t.side !== "buy") continue;
      const name = t.name || t.ticker || "";
      if (!name) continue;
      stockBuyTotals.set(name, (stockBuyTotals.get(name) ?? 0) + tradeAmountKRW(t, fxRate));
    }
    const trackedStocks = [...stockBuyTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => e[0]);
    const stockTrends = trackedStocks.map(stockName => {
      const prefix = stockName.split(" ").slice(0, 2).join(" ");
      const cumByMonth = new Map<string, number>();
      let cum = 0;
      for (const m of months) {
        for (const t of rawTrades) {
          if (t.date?.slice(0, 7) !== m) continue;
          if (!t.name?.includes(prefix)) continue;
          const kr = tradeAmountKRW(t, fxRate);
          if (t.side === "buy") cum += kr; else cum -= kr;
        }
        cumByMonth.set(m, cum);
      }
      const data = months.filter(m => cumByMonth.get(m) !== 0 || months.indexOf(m) >= months.findIndex(mm => (cumByMonth.get(mm) ?? 0) !== 0))
        .map(m => ({ l: ml[m], 누적매수: cumByMonth.get(m) ?? 0 }));
      return { name: stockName, data };
    }).filter(s => s.data.length > 0);

    /* ===== 완결 월 수 (지출·수입·재테크 중분류 인사이트 공용) =====
       진행 중인 달은 추세(MoM)·연속증가 계산에서 제외 — 월말까지 안 들어온 달과
       비교하면 월초마다 모든 항목이 "급감"으로 표시되는 왜곡이 생김. KST 기준. */
    const curMonthStr = getThisMonthKST();
    const doneCnt = months.length > 1 && months[months.length - 1] === curMonthStr ? months.length - 1 : months.length;

    /* ===== 지출 중분류별 인사이트 ===== */
    const subInsights: SubInsight[] = expBySub.slice(0, 15).map(s => {
      const mTotals = mTotalsFor(months, ledger, l =>
        l.kind === "expense" && l.category !== "재테크" && l.category !== "환전" && !isCreditPayment(l) &&
        (l.subCategory || l.category || "기타") === s.sub
      );
      // 추세·피크·연속증가는 완결 월만으로 계산 (수입 인사이트와 동일 기준)
      const doneTotals = mTotals.slice(0, doneCnt);
      const { monthTrend, mom, nonZero, monthAvg } = calcTrend(doneTotals);
      const last2 = doneTotals.slice(-2);
      const peakIdx = doneTotals.length > 0 ? doneTotals.indexOf(Math.max(...doneTotals)) : -1;
      // 해당 중분류 최대 단건
      let maxSingle = 0, maxSingleDesc = "";
      for (const l of fExp) {
        if ((l.subCategory || l.category || "기타") !== s.sub) continue;
        const a = Number(l.amount);
        if (a > maxSingle) { maxSingle = a; maxSingleDesc = l.description || l.subCategory || ""; }
      }
      // 해당 중분류 내 최다 지출 항목(description)
      const descMap = new Map<string, number>();
      for (const l of fExp) {
        if ((l.subCategory || l.category || "기타") !== s.sub) continue;
        const d = l.description || "기타";
        descMap.set(d, (descMap.get(d) ?? 0) + Number(l.amount));
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
      const fullMTotals = mTotalsFor(months, ledger, l =>
        l.kind === "income" && (l.subCategory || l.category || "기타") === sub
      );
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
      // 월별 추이 — 완결 월만으로 추세 계산 (수입·지출 인사이트와 동일 기준)
      const ivMTotals = mTotalsFor(months, ledger, l =>
        isInvestmentEntry(l) && (l.subCategory || "기타") === v.sub
      );
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

    /* ===== 원래 보유 자산·분담 통장 흐름 (실질 수입/지출은 위 realFlows 블록 소유) ===== */
    const { originalAssetsByAcct, originalAssets } = computeOriginalAssets(accounts);
    // 분담 통장 월별 흐름 — 전체 ledger·전체 months 사용 (현재 잔액 누적 의미)
    const moimFlow = computeMoimAccountFlow(ledger, dateAccountId, months);

    /* ===== 추가 계산 지표 ===== */
    const netProfit = realIncome - realExpense;
    let passiveIncome = 0;
    for (const [cat, val] of incByCat) { if (investIncKeys.has(cat)) passiveIncome += val; }
    // 지출/수입·순현금흐름은 근로소득 기준 — "월급으로 지출·투자를 감당하는가"를 현실적으로 표시
    const expToIncRatio = pSalary > 0 ? pExpense / pSalary * 100 : 0;
    const dailyAvgExp = totalDays > 0 ? Math.round(pExpense / totalDays) : 0;
    const netCashFlow = pSalary - pExpense - pInvest;
    // 수입 안정성 — 근로소득의 월별 편차 (정기 소득의 안정성이 의미 있음)
    const incVals = months.filter(m => salaryMonthly[m] > 0).map(m => salaryMonthly[m]);
    let incomeStability: number | null = null;
    if (incVals.length >= 2) {
      const iMean = incVals.reduce((a, b) => a + b, 0) / incVals.length;
      const iStd = Math.sqrt(incVals.reduce((s, v) => s + (v - iMean) ** 2, 0) / incVals.length);
      incomeStability = iMean > 0 ? Math.round((1 - iStd / iMean) * 100) : 0;
    }
    // 실현 수익률: FIFO 청산 거래의 totalPnl / totalCostBasis (대시보드와 동일)
    const investReturnRate = lifetimeRealizedSummary.totalCost > 0
      ? lifetimeRealizedSummary.totalPnl / lifetimeRealizedSummary.totalCost * 100
      : 0;
    const subTotal = subs.reduce((a, s) => a + s.total, 0);
    // 고정비 vs 변동비 — categoryPresets.categoryTypes.fixed 기반
    const { fixedExpense, variableExpense } = classifyExpenses(fExp, categoryPresets);

    /* ===== 순자산/자산 분석 ===== */
    // 월별 순자산 추이 — 대시보드 타임라인(시세·환율·대출 반영)과 동일 계산.
    // 기간 필터 시 '전체 기간 누적의 윈도우 절단' — 끝은 자르지 않음(마지막 행 = currentMonth, 대시보드 현재값과 정합).
    const timelineSlice = months.length === 0 ? [] : timelineRows.filter(r => r.month >= months[0]);
    let cumSav = 0;
    const netWorthByMonth = timelineSlice.map(r => {
      cumSav += monthly[r.month]?.investment ?? 0;
      return {
        month: r.month,
        label: ml[r.month] ?? `${parseInt(r.month.slice(5))}월`,
        total: r.total,
        income: monthly[r.month]?.income ?? 0,
        expense: monthly[r.month]?.expense ?? 0,
        savings: cumSav,
      };
    });
    // 현재 순자산/총자산/총부채 — 타임라인 슬라이스 마지막 행 (대시보드와 동일 숫자)
    const lastTimelineRow = timelineSlice.length > 0 ? timelineSlice[timelineSlice.length - 1] : null;
    const netWorthNow = lastTimelineRow
      ? { total: lastTimelineRow.total, asset: lastTimelineRow.asset, debt: lastTimelineRow.debt }
      : null;
    // 계좌별 현재 잔액 — 현금(computeAccountBalances) + USD 환산 + 보유 포지션 평가액.
    // 평가액을 빼면 증권/암호화폐 계좌가 예수금 몇 푼으로만 보여 순자산 KPI(타임라인: 시세 반영)와 모순됨
    const stockValueByAccount = new Map<string, number>();
    for (const p of curPositions) {
      if (p.quantity <= 1e-9) continue;
      stockValueByAccount.set(p.accountId, (stockValueByAccount.get(p.accountId) ?? 0) + positionMarketValueKRW(p, fxRate));
    }
    const accountBalances = computeAccountBalances(accounts, allLedger, allTrades)
      .map(row => {
        const a = row.account;
        const usdToKrw = a.type === "securities" || a.type === "crypto"
          ? ((a.usdBalance ?? 0) + row.usdTransferNet) * (fxRate ?? 0)
          : 0;
        return { name: a.name, type: a.type || "checking", balance: row.currentBalance + usdToKrw + (stockValueByAccount.get(a.id) ?? 0) };
      })
      .sort((a, b) => b.balance - a.balance);
    // 자산 유형별 배분
    const typeMap: Record<string, number> = {};
    const typeLabels: Record<string, string> = { checking: "입출금", savings: "저축", securities: "증권", crypto: "암호화폐", credit: "신용카드", cash: "현금", loan: "대출" };
    for (const ab of accountBalances) {
      const label = typeLabels[ab.type] || ab.type;
      typeMap[label] = (typeMap[label] ?? 0) + ab.balance;
    }
    const assetAllocation = Object.entries(typeMap).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

    /* ===== 재미 통계 ===== */
    // 최고 지출일
    const dayTotals = new Map<string, number>();
    for (const l of fExp) { const d = l.date; if (d) dayTotals.set(d, (dayTotals.get(d) ?? 0) + Number(l.amount)); }
    let biggestSpendDay: { date: string; total: number } | null = null;
    for (const [date, total] of dayTotals) { if (!biggestSpendDay || total > biggestSpendDay.total) biggestSpendDay = { date, total }; }
    // 가장 절약한 달 / 가장 많이 쓴 달
    let mostFrugalMonth: { month: string; expense: number } | null = null;
    let mostSpendMonth: { month: string; expense: number } | null = null;
    for (const m of months) {
      const e = monthly[m].expense;
      if (e > 0 && (!mostFrugalMonth || e < mostFrugalMonth.expense)) mostFrugalMonth = { month: m, expense: e };
      if (!mostSpendMonth || e > mostSpendMonth.expense) mostSpendMonth = { month: m, expense: e };
    }
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
      storeMap.set(desc, { total: p.total + Number(l.amount), count: p.count + 1 });
    }
    let topStore: { name: string; total: number; count: number } | null = null;
    for (const [name, v] of storeMap) { if (!topStore || v.count > topStore.count) topStore = { name, ...v }; }
    // 순자산 월평균 성장률 — 분모는 구간 수(개월 수 − 1). N개월이면 월간 변화는 N−1번.
    let monthOverMonthGrowth: number | null = null;
    if (netWorthByMonth.length >= 2) {
      const first = netWorthByMonth[0].total;
      const last = netWorthByMonth[netWorthByMonth.length - 1].total;
      if (first > 0) monthOverMonthGrowth = Math.round((last / first - 1) / (netWorthByMonth.length - 1) * 100 * 10) / 10;
    }
    // 월수입(근로소득)을 며칠만에 쓰는지 — selMonth 필터 시 1개월 기준
    const avgMonthInc = pSalary / (selMonth ? 1 : Math.max(1, months.length));
    const daysToSpendIncome = avgMonthInc > 0 && dailyAvgExp > 0 ? Math.round(avgMonthInc / dailyAvgExp) : null;
    // 최고 실질 저축률 달 — realFlows 기반 (savRateTrend와 동일 정의)
    let bestSavingsMonth: { month: string; rate: number } | null = null;
    for (const m of months) {
      const rf = realFlows.get(m);
      const rawRate = rf ? computeRealSavingsRate(rf.realIncome, rf.realExpense) : null;
      if (rawRate != null) {
        const rate = Math.round(rawRate);
        if (!bestSavingsMonth || rate > bestSavingsMonth.rate) bestSavingsMonth = { month: m, rate };
      }
    }

    const funStats = {
      biggestSpendDay, mostFrugalMonth, mostSpendMonth, longestZeroStreak,
      weekendVsWeekday, avgTxPerDay, topStore, monthOverMonthGrowth,
      daysToSpendIncome, bestSavingsMonth,
    };

    /* 최근 월 이상치 감지 (z-score ≥ 2, 6개월 lookback) */
    const anomalyTargetMonth = selMonth ?? months[months.length - 1] ?? null;
    const topAnomaly = (() => {
      if (!anomalyTargetMonth) return null;
      // 진행 중인 달이면 과거 달도 같은 기간(1~오늘 일)만 비교 — 월말에만 경고 켜지는 사각 방지
      const anomalyDayCap = anomalyTargetMonth === curMonthStr ? Number(getTodayKST().slice(8, 10)) : undefined;
      const results = detectSpendAnomalies(ledger, anomalyTargetMonth, 6, anomalyDayCap);
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
    const categoryGrowth = computeCategoryGrowth({ ledger, months, curMonthStr, anomalyTargetMonth, todayDayNum });

    /* 단건 지출 이상치 TOP — 중분류 내 z-score — utils/insightsPatterns 단일 소스 */
    const entryOutliers = computeEntryOutliers(fExp);

    /* DOM 월 가중치 보정 — 각 일자(1~31)가 기간 내 며칠만큼 존재했는지 */
    const domOccurrences = new Array(31).fill(0);
    for (const m of months) {
      const [y, mo] = m.split("-").map(Number);
      const daysInMonth = new Date(y, mo, 0).getDate(); // 28-31
      for (let i = 0; i < daysInMonth; i++) domOccurrences[i]++;
    }
    const spendByDOMAvg = spendByDOM.map((v, i) => domOccurrences[i] > 0 ? v / domOccurrences[i] : 0);

    /* 소비 스트릭·월별 무지출일·거래 간격 — utils/insightsPatterns 단일 소스.
       미래 날짜를 무지출일로 세지 않도록 루프 끝을 오늘(KST)로 캡. */
    const patternStats = computePatternStats({ fExp, months, ml, todayIso: getTodayKST() });

    const { monthSpan, accumLabel } = computePeriodScope(selMonth, months, ml);

    // 투자 손익 4분할 (실현/미실현 × 수익/손실, KRW 환산).
    // 실현: plWin/plLoss (FIFO 청산 손익, 라이프타임 누적).
    // 미실현: 보유 종목 × (현재가 - 평단) — utils/portfolioMetrics.computeUnrealizedPL.
    //   ⚠ priceFallback 없이(실제 시세만) 재계산 — curPositions(priceFallback:"cost")와 구분.
    const _positions = computePositions(allTrades, prices, accounts, { fxRate: fxRate ?? undefined });
    const { unrealizedGain, unrealizedLoss } = computeUnrealizedPL(_positions, fxRate);
    const investBreakdown = {
      realizedGain: plWin,
      realizedLoss: plLoss,
      unrealizedGain,
      unrealizedLoss,
    };

    return {
      months, ml, selMonth, monthSpan, accumLabel, txCount: fL.length, anomalyTargetMonth, topAnomaly, incomeGrowth, spendingInertia,
      categoryGrowth, entryOutliers, spendByDOMAvg, domOccurrences, patternStats,
      monthly, salaryMonthly, realIncomeMonthly, savRateTrend, salaryTrend, cumIE, investTrend, divTrend, tradeCntTrend, subTrend, txCntTrend, cumSpend, monthlyCatTrend, dateExpMonthly,
      pIncome, pSalary, pExpense, pInvest, expByCat, expBySub, topCats, acctUsage, wdSpend, dateTop, dateSubCats, dateEntries, dateTxCount, incByCat, trades, subs, largeExp, topTx, expBySubCat, expByDesc, dateMoim, datePersonal, spendByDOM, portfolio, realPL: { total: plTot, wins: plWin, losses: plLoss, winCnt: plWC, lossCnt: plLC },
      investBreakdown, holdingsByStock, totalHoldingsCost,
      zeroDays, totalDays, weekendTot, weekdayTot, topDates,
      score: { total: scorePts, grade, comment: comments[grade] || "" }, prev, avgMonthExp,
      incByGroup, investBySub, dateByDetail, stockTrends,
      subInsights, incSubInsights, dateSubInsights, investSubInsights,
      realIncome, realExpense, settlementTotal, tempIncomeTotal, dateAccountSpend, datePartnerShare, moimFlow, originalAssets, originalAssetsByAcct,
      netProfit, realSavRate, passiveIncome, expToIncRatio, dailyAvgExp, netCashFlow,
      incomeStability, investReturnRate, subTotal, fixedExpense, variableExpense,
      netWorthByMonth, netWorthNow, accountBalances, assetAllocation, funStats,
    };
  }, [ledger, rawTrades, allTrades, accounts, prices, selMonth, categoryPresets, dateAccountId, fxRate, timelineRows, allLedger]);
}
