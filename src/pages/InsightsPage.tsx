import React, { useMemo, useState } from "react";
import type { Account, LedgerEntry, StockTrade, StockPrice, CategoryPresets, BudgetGoal, RecurringExpense } from "../types";
import { ForecastView } from "../features/insights/ForecastView";
import { SettlementView } from "../features/dating/SettlementView";
import { calcTrend, mTotalsFor } from "../utils/insightsHelpers";
import { isInvestmentEntry } from "../utils/category";
import { detectSpendAnomalies } from "../utils/anomaly";
import {
  F, W, SD,
  type D, type SubInsight, type IncSubInsight, type DateSubInsight, type InvestSubInsight,
} from "../features/insights/insightsShared";
import { OverviewTab } from "../features/insights/tabs/OverviewTab";
import { ExpenseTab } from "../features/insights/tabs/ExpenseTab";
import { IncomeTab } from "../features/insights/tabs/IncomeTab";
import { DateTab } from "../features/insights/tabs/DateTab";
import { InvestTab } from "../features/insights/tabs/InvestTab";
import { SubTab } from "../features/insights/tabs/SubTab";
import { PatternTab } from "../features/insights/tabs/PatternTab";
import { AssetTab } from "../features/insights/tabs/AssetTab";
import { FunTab } from "../features/insights/tabs/FunTab";

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "overview", label: "종합 대시보드", icon: "📊" },
  { id: "expense", label: "지출 분석", icon: "💸" },
  { id: "income", label: "수입 구조", icon: "💰" },
  { id: "asset", label: "자산 분석", icon: "🏦" },
  { id: "date", label: "데이트 분석", icon: "💕" },
  { id: "settle", label: "데이트 정산", icon: "🤝" },
  { id: "invest", label: "투자 포트폴리오", icon: "📈" },
  { id: "sub", label: "구독 관리", icon: "🔄" },
  { id: "pattern", label: "소비 패턴", icon: "🔍" },
  { id: "forecast", label: "다음 달 예측", icon: "🔮" },
  { id: "fun", label: "재미 통계", icon: "🎯" },
];
type TabId = "overview" | "expense" | "income" | "asset" | "date" | "settle" | "invest" | "sub" | "pattern" | "forecast" | "fun";

/* ================================================================== */
/*  Data computation hook                                              */
/* ================================================================== */

function useD(ledger: LedgerEntry[], rawTrades: StockTrade[], accounts: Account[], selMonth: string | null, categoryPresets?: CategoryPresets, budgetGoals?: BudgetGoal[]): D {
  return useMemo(() => {
    const aMap = new Map(accounts.map(a => [a.id, a.name]));
    const invIds = new Set(accounts.filter(a => a.type === "securities" || a.type === "crypto").map(a => a.id));
    const moimIds = new Set(accounts.filter(a => a.name.includes("모임")).map(a => a.id));

    /* ===== monthly (full period) ===== */
    const monthly: Record<string, { income: number; expense: number; investment: number }> = {};
    const em = (m: string) => { if (!monthly[m]) monthly[m] = { income: 0, expense: 0, investment: 0 }; };
    for (const l of ledger) {
      const m = l.date?.slice(0, 7); if (!m) continue; em(m);
      const a = Number(l.amount); if (a <= 0) continue;
      if (l.kind === "income") monthly[m].income += a;
      else if (isInvestmentEntry(l)) monthly[m].investment += a; // 저축·투자 이체
      else if (l.kind === "expense") monthly[m].expense += a;
      else if (l.kind === "transfer" && l.toAccountId && invIds.has(l.toAccountId)) monthly[m].investment += a;
    }
    const months = Object.keys(monthly).sort();
    const ml: Record<string, string> = {};
    months.forEach(m => { ml[m] = parseInt(m.slice(5)) + "월"; });

    /* ===== filter for period ===== */
    const fL = selMonth ? ledger.filter(l => l.date?.startsWith(selMonth)) : ledger;
    const fT = selMonth ? rawTrades.filter(t => t.date?.startsWith(selMonth)) : rawTrades;
    // 일반 지출: expense kind 중 재테크/환전 제외 (투자손실은 category=재테크라 자동 제외)
    const fExp = fL.filter(l => l.kind === "expense" && Number(l.amount) > 0 && l.category !== "재테크" && l.category !== "환전");
    // 수입 (투자수익도 kind=income으로 마이그레이션되어 자연 포함)
    const fInc = fL.filter(l => l.kind === "income" && Number(l.amount) > 0);

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
    const pSavRate = SD(pIncome - pExpense, pIncome) * 100;

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

    /* weekdaySpending */
    const wdSpend: { total: number; count: number }[] = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
    for (const l of fExp) {
      if (!l.date) continue;
      const js = new Date(l.date).getDay();
      const idx = js === 0 ? 6 : js - 1;
      wdSpend[idx].total += Number(l.amount); wdSpend[idx].count++;
    }

    /* dateExpense — category 또는 subCategory에 "데이트" 포함 시 매칭 */
    const isDateEntry = (l: LedgerEntry) => {
      if (l.kind !== "expense") return false;
      const cat = (l.category || "").trim();
      const sub = (l.subCategory || "").trim();
      return cat.includes("데이트") || sub.includes("데이트") || cat === "데이트비" || sub === "데이트비";
    };
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

    /* incomeByCategory — 원래 보유 자산(이월)은 실질 수입이 아니므로 제외 */
    const isCarryOverStr = (s: string) => s === "이월" || s.includes("이월") || s === "원래 보유 자산" || s.includes("보유 자산");
    const isCarryOver = (l: LedgerEntry) => isCarryOverStr(l.category || "") || isCarryOverStr(l.subCategory || "");
    const icM = new Map<string, number>();
    for (const l of fInc) {
      const c = l.subCategory || l.category || "기타";
      if (isCarryOver(l)) continue;
      icM.set(c, (icM.get(c) ?? 0) + Number(l.amount));
    }
    const incByCat = Array.from(icM.entries()).sort((a, b) => b[1] - a[1]);

    /* tradeSummary */
    const tM = new Map<string, { buyCount: number; sellCount: number; buyTotal: number; sellTotal: number }>();
    for (const t of fT) {
      const n = t.name || t.ticker;
      if (!tM.has(n)) tM.set(n, { buyCount: 0, sellCount: 0, buyTotal: 0, sellTotal: 0 });
      const e = tM.get(n)!;
      const kr = t.fxRateAtTrade ? t.totalAmount * t.fxRateAtTrade : t.totalAmount;
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

    /* ===== 소득 분류 자동 감지 (하드코딩 제거) ===== */
    // 급여성: 활동 월의 40% 이상에 나타나는 수입 중분류 → 정기 소득
    const incSubMonths = new Map<string, Set<string>>();
    for (const l of ledger) {
      if (l.kind !== "income" || Number(l.amount) <= 0) continue;
      const m = l.date?.slice(0, 7); const sub = l.subCategory || l.category || "";
      if (!m || !sub || isCarryOver(l)) continue;
      if (!incSubMonths.has(sub)) incSubMonths.set(sub, new Set());
      incSubMonths.get(sub)!.add(m);
    }
    const salaryThreshold = Math.max(months.length * 0.4, 2);
    const salaryKeys = new Set<string>();
    for (const [sub, ms] of incSubMonths) { if (ms.size >= salaryThreshold) salaryKeys.add(sub); }
    // 빈도 기준으로는 놓치지만 명백한 회사소득 (연 1-2회 상여 등)
    const ALWAYS_SALARY = ["상여", "급여", "수당"];
    for (const k of ALWAYS_SALARY) salaryKeys.add(k);
    // 자주 나타나도 회사소득이 아닌 카테고리 (빈도 자동감지 오분류 보정)
    //  - 캐시백: 카드 리워드 → 기타수입
    //  - 배당/이자/투자수익: 투자/패시브로 강제 이동
    const NEVER_SALARY = ["캐시백", "배당", "이자", "투자수익"];
    for (const k of NEVER_SALARY) salaryKeys.delete(k);
    // 투자/패시브: 투자 계좌에서 발생하는 수입 중분류 (급여성 제외) + 명시적 목록
    const investIncKeys = new Set<string>();
    for (const l of ledger) {
      if (l.kind !== "income" || Number(l.amount) <= 0) continue;
      const sub = l.subCategory || l.category || "";
      if (!sub || salaryKeys.has(sub)) continue;
      if (invIds.has(l.toAccountId || "") || invIds.has(l.fromAccountId || "")) investIncKeys.add(sub);
    }
    const ALWAYS_INVEST_INCOME = ["배당", "이자", "투자수익"];
    for (const k of ALWAYS_INVEST_INCOME) investIncKeys.add(k);

    /* ===== trend data (full period) ===== */
    const savRateTrend: D["savRateTrend"] = [];
    {
      let cumInc = 0, cumExp = 0;
      for (const m of months) {
        const i = monthly[m].income, e = monthly[m].expense;
        cumInc += i; cumExp += e;
        savRateTrend.push({ l: ml[m], rate: SD(i - e, i) * 100, cumRate: SD(cumInc - cumExp, cumInc) * 100, sav: i - e });
      }
    }
    const salaryTrend = months.map(m => {
      let sal = 0, non = 0;
      for (const l of ledger) {
        if (l.kind !== "income" || l.date?.slice(0, 7) !== m || Number(l.amount) <= 0) continue;
        const sub = l.subCategory || l.category || "";
        if (isCarryOver(l)) continue;
        if (salaryKeys.has(sub)) sal += Number(l.amount); else non += Number(l.amount);
      }
      return { l: ml[m], salary: sal, nonSalary: non };
    });
    let ci = 0, ce = 0;
    const cumIE = months.map(m => { ci += monthly[m].income; ce += monthly[m].expense; return { l: ml[m], 누적수입: ci, 누적지출: ce }; });
    const investTrend = months.map(m => ({ l: ml[m], amount: monthly[m].investment }));
    const divTrend = months.map(m => {
      let d = 0;
      for (const l of ledger) { if (l.kind !== "income" || l.date?.slice(0, 7) !== m) continue; if (investIncKeys.has(l.subCategory || "")) d += Number(l.amount); }
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

    /* portfolio allocation */
    const pM = new Map<string, number>();
    for (const t of trades) {
      if (t.buyCount - t.sellCount <= 0) continue;
      const n = t.name.toLowerCase();
      let tp = "개별주식";
      if (/tiger|kodex|rise|sol |1q |ace |kbstar|hanaro/i.test(n)) tp = "ETF";
      else if (/solana|ethereum|bitcoin|sol$|eth$|btc$/i.test(n)) tp = "암호화폐";
      pM.set(tp, (pM.get(tp) ?? 0) + t.buyTotal);
    }
    const portfolio = Array.from(pM.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

    /* realized PL */
    let plTot = 0, plWin = 0, plLoss = 0, plWC = 0, plLC = 0;
    for (const t of trades) {
      if (t.sellCount === 0) continue;
      const avg = SD(t.buyTotal, t.buyCount);
      const pl = t.sellTotal - avg * t.sellCount;
      plTot += pl; if (pl >= 0) { plWin += pl; plWC++; } else { plLoss += Math.abs(pl); plLC++; }
    }

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

    /* weekend vs weekday */
    let weekendTot = 0, weekdayTot = 0;
    for (const l of fExp) { const d = new Date(l.date).getDay(); if (d === 0 || d === 6) weekendTot += Number(l.amount); else weekdayTot += Number(l.amount); }

    /* top spend dates */
    const tdM = new Map<string, { total: number; items: { desc: string; amount: number }[] }>();
    for (const l of fExp) {
      if (!tdM.has(l.date)) tdM.set(l.date, { total: 0, items: [] });
      const e = tdM.get(l.date)!; e.total += Number(l.amount); e.items.push({ desc: l.description || l.category || "기타", amount: Number(l.amount) });
    }
    const topDates = Array.from(tdM.entries()).map(([date, v]) => ({ date, ...v })).sort((a, b) => b.total - a.total).slice(0, 5);

    /* financial score */
    let scorePts = 0;
    const sr = pSavRate;
    if (sr >= 50) scorePts += 40; else if (sr >= 30) scorePts += 30; else if (sr >= 20) scorePts += 20; else if (sr >= 10) scorePts += 10;
    if (zeroDays > totalDays * 0.2) scorePts += 20; else if (zeroDays > totalDays * 0.1) scorePts += 10;
    if (pInvest > 0) scorePts += 20; else scorePts += 5;
    const incDiv = incByCat.length;
    if (incDiv >= 5) scorePts += 20; else if (incDiv >= 3) scorePts += 15; else if (incDiv >= 2) scorePts += 10; else scorePts += 5;
    const grade = scorePts >= 90 ? "A+" : scorePts >= 80 ? "A" : scorePts >= 70 ? "B+" : scorePts >= 60 ? "B" : scorePts >= 50 ? "C+" : scorePts >= 40 ? "C" : "D";
    const comments: Record<string, string> = { "A+": "완벽한 재무 습관!", A: "훌륭하게 관리 중!", "B+": "꽤 건강한 재무 상태!", B: "나쁘지 않아요!", "C+": "개선의 여지가 있어요.", C: "소비 조절이 필요해요.", D: "재무 점검이 필요해요!" };

    /* prev month */
    let prev: { income: number; expense: number } | null = null;
    if (selMonth) {
      const [y, m] = selMonth.split("-").map(Number); const pd = new Date(y, m - 2, 1);
      const pm = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, "0")}`;
      let pi = 0, pe = 0;
      for (const l of ledger) {
        if (l.date?.slice(0, 7) !== pm) continue;
        const a = Number(l.amount); if (a <= 0) continue;
        if (l.kind === "income") pi += a;
        // 지출: 일반 지출 + 투자손실(category=재테크). 환전은 제외.
        else if (l.kind === "expense" && l.category !== "환전") pe += a;
      }
      if (pi > 0 || pe > 0) prev = { income: pi, expense: pe };
    }

    const fullMonths = Math.max(months.length, 1);
    const avgMonthExp = SD(months.reduce((s, m) => s + monthly[m].expense, 0), fullMonths);

    /* ===== 소득 그룹별 분류 ===== */
    const groupMap: Record<string, { total: number; items: Map<string, number> }> = {
      "회사소득": { total: 0, items: new Map() },
      "투자/패시브": { total: 0, items: new Map() },
      "기타수입": { total: 0, items: new Map() },
    };
    for (const [cat, val] of incByCat) {
      const g = salaryKeys.has(cat) ? "회사소득" : investIncKeys.has(cat) ? "투자/패시브" : "기타수입";
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
      stockBuyTotals.set(name, (stockBuyTotals.get(name) ?? 0) + (t.fxRateAtTrade ? t.totalAmount * t.fxRateAtTrade : t.totalAmount));
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
          const kr = t.fxRateAtTrade ? t.totalAmount * t.fxRateAtTrade : t.totalAmount;
          if (t.side === "buy") cum += kr; else cum -= kr;
        }
        cumByMonth.set(m, cum);
      }
      const data = months.filter(m => cumByMonth.get(m) !== 0 || months.indexOf(m) >= months.findIndex(mm => (cumByMonth.get(mm) ?? 0) !== 0))
        .map(m => ({ l: ml[m], 누적매수: cumByMonth.get(m) ?? 0 }));
      return { name: stockName, data };
    }).filter(s => s.data.length > 0);

    /* ===== 지출 중분류별 인사이트 ===== */
    const subInsights: SubInsight[] = expBySub.slice(0, 15).map(s => {
      const mTotals = mTotalsFor(months, ledger, l =>
        l.kind === "expense" && l.category !== "재테크" && l.category !== "환전" &&
        (l.subCategory || l.category || "기타") === s.sub
      );
      const { monthTrend, mom, nonZero, monthAvg } = calcTrend(mTotals);
      const last2 = mTotals.slice(-2);
      const peakIdx = mTotals.length > 0 ? mTotals.indexOf(Math.max(...mTotals)) : -1;
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
      // 연속 증가 월수
      let streakUp = 0;
      for (let i = mTotals.length - 1; i >= 1; i--) {
        if (mTotals[i] > mTotals[i - 1] && mTotals[i] > 0) streakUp++; else break;
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
      if (months[peakIdx]) comments.push(`지출 최고월: ${ml[months[peakIdx]]}(${F(mTotals[peakIdx])}).`);

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
    const incSubInsights: IncSubInsight[] = incByCat.slice(0, 12).map(([sub, total]) => {
      const cnt = fInc.filter(l => (l.subCategory || l.category || "기타") === sub).length;
      const fullMTotals = mTotalsFor(months, ledger, l =>
        l.kind === "income" && (l.subCategory || l.category || "기타") === sub
      );
      const { monthTrend, mom, nonZero, monthAvg } = calcTrend(fullMTotals);
      // 안정성 지수
      let stability = 0;
      if (nonZero.length >= 2) {
        const mean = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
        const std = Math.sqrt(nonZero.reduce((s, v) => s + (v - mean) ** 2, 0) / nonZero.length);
        stability = mean > 0 ? Math.round((1 - SD(std, mean)) * 100) : 0;
      }
      // 최대 수입 월
      const maxIdx = fullMTotals.length > 0 ? fullMTotals.indexOf(Math.max(...fullMTotals)) : -1;
      const maxMonth = maxIdx >= 0 && months[maxIdx] ? ml[months[maxIdx]] : "";
      const maxMonthAmt = fullMTotals[maxIdx] ?? 0;
      const avg = Math.round(SD(total, cnt));
      const share = Math.round(SD(total, pIncome) * 100);
      // 수입 발생 빈도
      const incFreq = Math.round(SD(nonZero.length, months.length) * 100);
      // 코멘트
      const cs: string[] = [];
      if (share > 50) cs.push(`전체 수입의 ${share}%로 핵심 수입원입니다. 이 수입이 줄어들면 가계에 큰 영향을 미칩니다.`);
      else if (share > 20) cs.push(`전체 수입의 ${share}%를 차지하는 중요한 수입원입니다.`);
      else if (share > 5) cs.push(`전체 수입의 ${share}%를 차지합니다.`);
      else cs.push(`전체 수입의 ${share}%로 소규모 수입원입니다.`);
      // 안정성 상세
      if (stability >= 80) cs.push(`안정성 ${stability}%로 매우 안정적입니다. 예측 가능한 수입으로 재무 계획에 신뢰할 수 있습니다.`);
      else if (stability >= 60) cs.push(`안정성 ${stability}%로 비교적 안정적입니다.`);
      else if (stability >= 40) cs.push(`안정성 ${stability}%로 변동이 있습니다. 이 수입에만 의존하지 않도록 주의하세요.`);
      else if (nonZero.length >= 2) cs.push(`안정성 ${stability}%로 변동폭이 매우 큽니다. 비정기적 수입이므로 이를 고정 지출 계획에 포함하면 위험합니다.`);
      // 추세 상세
      if (monthTrend === "up" && mom > 30) cs.push(`최근 ${mom}% 급증! 매우 긍정적인 흐름입니다.`);
      else if (monthTrend === "up") cs.push(`최근 ${mom}% 증가 추세로 좋은 방향입니다.`);
      else if (monthTrend === "down" && Math.abs(mom) > 30) cs.push(`최근 ${Math.abs(mom)}% 급감! 원인을 파악하고 대응 방안을 마련하세요.`);
      else if (monthTrend === "down") cs.push(`최근 ${Math.abs(mom)}% 감소 중입니다.`);
      else cs.push("최근 안정적인 수준을 유지 중입니다.");
      // 빈도
      if (incFreq >= 90) cs.push(`${months.length}개월 중 ${nonZero.length}개월 발생 — 매월 꾸준히 들어오는 수입입니다.`);
      else if (incFreq >= 50) cs.push(`${months.length}개월 중 ${nonZero.length}개월 발생 — 비교적 자주 들어옵니다.`);
      else if (nonZero.length >= 1) cs.push(`${months.length}개월 중 ${nonZero.length}개월만 발생 — 비정기 수입입니다.`);
      // 월평균과 최대 비교
      if (maxMonth && maxMonthAmt > monthAvg * 2) cs.push(`최대 수입월 ${maxMonth}(${F(maxMonthAmt)})은 월평균(${F(monthAvg)})의 ${Math.round(SD(maxMonthAmt, monthAvg))}배 — 특별 수입이 있었습니다.`);
      else if (maxMonth) cs.push(`최대 수입월: ${maxMonth}(${F(maxMonthAmt)}), 월평균 ${F(monthAvg)}.`);
      if (cnt > 0) cs.push(`총 ${cnt}건 발생, 건당 평균 ${F(avg)}.`);
      return { sub, total, count: cnt, avg, monthTrend, mom, share, monthAvg, stability, maxMonth, maxMonthAmt, comment: cs.join(" ") };
    });

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
      // 월별 추이
      const ivMTotals = mTotalsFor(months, ledger, l =>
        isInvestmentEntry(l) && (l.subCategory || "기타") === v.sub
      );
      const { monthTrend: ivTrend, mom: ivMom, nonZero: ivNonZero, monthAvg } = calcTrend(ivMTotals);
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
      // 빈도 분석
      const ivFreq = Math.round(SD(ivNonZero.length, months.length) * 100);
      if (ivFreq >= 90) cs.push(`${months.length}개월 중 ${ivNonZero.length}개월 투자 — 매월 꾸준히 적립하는 훌륭한 습관입니다!`);
      else if (ivFreq >= 60) cs.push(`${months.length}개월 중 ${ivNonZero.length}개월 투자 — 비교적 자주 투자합니다.`);
      else if (ivNonZero.length >= 2) cs.push(`${months.length}개월 중 ${ivNonZero.length}개월만 투자 — 비정기적 투자 패턴입니다. 자동이체 적립식 투자를 추천합니다.`);
      else if (ivNonZero.length === 1) cs.push("단 1번만 투자한 항목입니다.");
      return { sub: v.sub, amount: v.amount, count: v.count, avg, share, monthAvg, monthTrend: ivTrend, mom: ivMom, comment: cs.join(" ") };
    });

    /* ===== 실질 수입/지출 (정산·일시소득 제외, 데이트 50% 분담) ===== */
    const NON_REAL_INCOME = new Set(["정산", "용돈", "이월", "원래 보유 자산", "대출", "처분소득", "지원"]);
    let settlementTotal = 0, tempIncomeTotal = 0;
    for (const l of fInc) {
      const sub = (l.subCategory || l.category || "").trim();
      if (sub === "정산" || sub.includes("정산")) settlementTotal += Number(l.amount);
      else if (NON_REAL_INCOME.has(sub)) tempIncomeTotal += Number(l.amount);
    }
    // 원래 보유 자산: Account.initialBalance 기반 (계좌별)
    const originalAssetsByAcct = accounts
      .filter(a => (a.initialBalance ?? 0) > 0)
      .map(a => ({ name: a.name, amount: a.initialBalance ?? 0 }))
      .sort((a, b) => b.amount - a.amount);
    const originalAssets = originalAssetsByAcct.reduce((s, a) => s + a.amount, 0);
    // 데이트 계좌 지출: 50/50 분담 → 절반은 상대 부담이므로 실 지출에서 제거
    const dateAccountId = typeof window !== "undefined" ? localStorage.getItem("fw-date-account-id") : null;
    const dateAccountSpend = dateAccountId
      ? fExp.reduce((s, l) => (l.fromAccountId === dateAccountId ? s + Number(l.amount) : s), 0)
      : 0;
    const datePartnerShare = dateAccountSpend * 0.5; // 상대 부담분
    // 실질 수입: 정산(이미 상대가 돌려준 돈) + 일시소득(용돈/지원 등) 제외 → 진짜 내 힘으로 번 돈
    const realIncome = pIncome - settlementTotal - tempIncomeTotal;
    // 실질 지출: 데이트 계좌 50% 제거 (상대 부담). 정산은 수입에서 이미 제외했으므로 여기서 중복 차감 안 함
    const realExpense = pExpense - datePartnerShare;

    /* ===== 추가 계산 지표 ===== */
    const netProfit = realIncome - realExpense;
    const realSavRate = realIncome > 0 ? (realIncome - realExpense) / realIncome * 100 : 0;
    let passiveIncome = 0;
    for (const [cat, val] of incByCat) { if (investIncKeys.has(cat)) passiveIncome += val; }
    const expToIncRatio = pIncome > 0 ? pExpense / pIncome * 100 : 0;
    const dailyAvgExp = totalDays > 0 ? Math.round(pExpense / totalDays) : 0;
    const netCashFlow = pIncome - pExpense - pInvest;
    // 수입 안정성
    const incVals = months.filter(m => monthly[m].income > 0).map(m => monthly[m].income);
    let incomeStability: number | null = null;
    if (incVals.length >= 2) {
      const iMean = incVals.reduce((a, b) => a + b, 0) / incVals.length;
      const iStd = Math.sqrt(incVals.reduce((s, v) => s + (v - iMean) ** 2, 0) / incVals.length);
      incomeStability = iMean > 0 ? Math.round((1 - iStd / iMean) * 100) : 0;
    }
    // totalInvested for invest return (보유종목 총 매수)
    const totalInvested = trades.filter(v => v.buyCount - v.sellCount > 0).reduce((s, v) => s + v.buyTotal, 0);
    const investReturnRate = plTot !== 0 && totalInvested > 0 ? plTot / totalInvested * 100 : 0;
    const subTotal = subs.reduce((a, s) => a + s.total, 0);
    // 고정비 vs 변동비 — categoryPresets.categoryTypes.fixed 기반
    const fixedMains = new Set(categoryPresets?.categoryTypes?.fixed ?? []);
    const fixedCats = new Set<string>(fixedMains);
    // 고정비 대분류에 속하는 중분류도 고정비로 포함
    for (const g of categoryPresets?.expenseDetails ?? []) {
      if (fixedMains.has(g.main)) for (const s of g.subs) fixedCats.add(s);
    }
    // isFixedExpense 플래그가 있는 항목도 고정비 처리
    let fixedExpense = 0, variableExpense = 0;
    for (const l of fExp) {
      const cat = (l.subCategory || l.category || "").trim();
      if (l.isFixedExpense || fixedCats.has(cat) || fixedCats.has(l.category || "")) fixedExpense += Number(l.amount);
      else variableExpense += Number(l.amount);
    }

    /* ===== 순자산/자산 분석 ===== */
    // 월별 순자산 추이 (누적 수입-지출 + 초기잔액)
    const totalInitBal = accounts.reduce((s, a) => s + (a.initialBalance ?? 0) + (a.cashAdjustment ?? 0) + (a.savings ?? 0), 0);
    let cumInc = 0, cumExp = 0, cumSav = 0;
    const netWorthByMonth = months.map(m => {
      cumInc += monthly[m].income; cumExp += monthly[m].expense; cumSav += monthly[m].investment;
      return { month: m, label: ml[m], total: totalInitBal + cumInc - cumExp, income: monthly[m].income, expense: monthly[m].expense, savings: cumSav };
    });
    // 계좌별 현재 잔액 추정
    const acctBal = new Map<string, number>();
    accounts.forEach(a => acctBal.set(a.id, (a.initialBalance ?? 0) + (a.cashAdjustment ?? 0) + (a.savings ?? 0)));
    for (const l of ledger) {
      if (l.kind === "income" && l.toAccountId) acctBal.set(l.toAccountId, (acctBal.get(l.toAccountId) ?? 0) + l.amount);
      if (l.kind === "expense" && l.fromAccountId) acctBal.set(l.fromAccountId, (acctBal.get(l.fromAccountId) ?? 0) - l.amount);
      if (l.kind === "expense" && l.toAccountId) acctBal.set(l.toAccountId, (acctBal.get(l.toAccountId) ?? 0) + l.amount);
      if (l.kind === "transfer" && l.currency !== "USD") {
        if (l.fromAccountId) acctBal.set(l.fromAccountId, (acctBal.get(l.fromAccountId) ?? 0) - l.amount);
        if (l.toAccountId) acctBal.set(l.toAccountId, (acctBal.get(l.toAccountId) ?? 0) + l.amount);
      }
    }
    const accountBalances = accounts.map(a => ({ name: a.name, type: a.type || "checking", balance: acctBal.get(a.id) ?? 0 })).sort((a, b) => b.balance - a.balance);
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
      const start = new Date(allDates[0]); const end = new Date(allDates[allDates.length - 1]);
      const spendDays = new Set(allDates);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const ds = d.toISOString().slice(0, 10);
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
    // 순자산 월평균 성장률
    let monthOverMonthGrowth: number | null = null;
    if (netWorthByMonth.length >= 2) {
      const first = netWorthByMonth[0].total;
      const last = netWorthByMonth[netWorthByMonth.length - 1].total;
      if (first > 0) monthOverMonthGrowth = Math.round((last / first - 1) / netWorthByMonth.length * 100 * 10) / 10;
    }
    // 월수입을 며칠만에 쓰는지
    const avgMonthInc = months.length > 0 ? pIncome / months.length : 0;
    const daysToSpendIncome = avgMonthInc > 0 && dailyAvgExp > 0 ? Math.round(avgMonthInc / dailyAvgExp) : null;
    // 최고 저축률 달
    let bestSavingsMonth: { month: string; rate: number } | null = null;
    for (const m of months) {
      const mi = monthly[m].income, me = monthly[m].expense;
      if (mi > 0) {
        const rate = Math.round((mi - me) / mi * 100);
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
      const results = detectSpendAnomalies(ledger, anomalyTargetMonth, 6);
      const triggered = results.filter((a) => a.isAnomaly).sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
      return triggered[0] ?? null;
    })();

    /* 수입 성장률 시계열 (MoM %) + 핵심 지표 MoM/YoY */
    const incomeGrowth = (() => {
      const series = months.map((m, i) => {
        const cur = monthly[m]?.income ?? 0;
        const prev = i > 0 ? monthly[months[i - 1]]?.income ?? 0 : 0;
        const mom = prev > 0 ? ((cur - prev) / prev) * 100 : null;
        return { l: ml[m], month: m, income: cur, momPct: mom };
      });
      const targetMonth = anomalyTargetMonth ?? (months.length ? months[months.length - 1] : null);
      const targetIdx = targetMonth ? months.indexOf(targetMonth) : -1;
      const targetInc = targetIdx >= 0 ? monthly[months[targetIdx]].income : 0;
      const prevInc = targetIdx > 0 ? monthly[months[targetIdx - 1]].income : 0;
      const mom = prevInc > 0 ? ((targetInc - prevInc) / prevInc) * 100 : null;
      // YoY: find same month 12 months ago
      let yoy: number | null = null;
      if (targetMonth) {
        const [y, mo] = targetMonth.split("-").map(Number);
        const yoyKey = `${y - 1}-${String(mo).padStart(2, "0")}`;
        const yoyInc = monthly[yoyKey]?.income;
        if (yoyInc && yoyInc > 0) yoy = ((targetInc - yoyInc) / yoyInc) * 100;
      }
      // 3-month avg MoM growth
      const last3Moms = series.slice(-3).map((s) => s.momPct).filter((x): x is number => x != null);
      const avg3MoM = last3Moms.length > 0 ? last3Moms.reduce((s, x) => s + x, 0) / last3Moms.length : null;
      return { series, mom, yoy, avg3MoM, targetInc, prevInc };
    })();

    /* 지출 관성: 현재월 지출 vs 최근 3개월 평균 */
    const spendingInertia = (() => {
      const targetMonth = anomalyTargetMonth ?? (months.length ? months[months.length - 1] : null);
      if (!targetMonth) return null;
      const idx = months.indexOf(targetMonth);
      if (idx < 0) return null;
      const curExp = monthly[targetMonth]?.expense ?? 0;
      const lookback = months.slice(Math.max(0, idx - 3), idx);
      if (lookback.length === 0) return null;
      const avg = lookback.reduce((s, m) => s + (monthly[m]?.expense ?? 0), 0) / lookback.length;
      const deviation = avg > 0 ? ((curExp - avg) / avg) * 100 : null;
      return { curExp, avg, deviation, lookbackMonths: lookback.length };
    })();

    /* 예산 vs 실적 (현재월 기준) */
    const budgetProgress = (() => {
      const targetMonth = anomalyTargetMonth;
      if (!targetMonth || !budgetGoals || budgetGoals.length === 0) return [];
      const monthExp = ledger.filter((l) => l.kind === "expense" && l.date?.startsWith(targetMonth) && l.category !== "재테크" && l.category !== "환전" && Number(l.amount) > 0);
      return budgetGoals.map((g) => {
        let spent = 0;
        if (g.category === "전체") {
          const excl = new Set(g.excludeCategories ?? []);
          spent = monthExp.filter((l) => !excl.has(l.category || "") && !excl.has(l.subCategory || "")).reduce((s, l) => s + Number(l.amount), 0);
        } else {
          spent = monthExp.filter((l) => l.category === g.category || l.subCategory === g.category).reduce((s, l) => s + Number(l.amount), 0);
        }
        const pct = g.monthlyLimit > 0 ? (spent / g.monthlyLimit) * 100 : 0;
        const status: "safe" | "warning" | "over" = pct >= 100 ? "over" : pct >= 80 ? "warning" : "safe";
        return { category: g.category, limit: g.monthlyLimit, spent, remaining: g.monthlyLimit - spent, pct, status };
      }).sort((a, b) => b.pct - a.pct);
    })();

    /* 카테고리 성장률 TOP — 현재월 중분류 지출 vs 최근 3개월 평균 */
    const categoryGrowth = (() => {
      const targetMonth = anomalyTargetMonth;
      if (!targetMonth) return { up: [], down: [] as { sub: string; cur: number; avg3: number; pctChange: number }[] };
      const idx = months.indexOf(targetMonth);
      if (idx < 0) return { up: [], down: [] };
      const prevMonths = months.slice(Math.max(0, idx - 3), idx);
      if (prevMonths.length === 0) return { up: [], down: [] };
      // subCategory별 월별 지출
      const subMonthly = new Map<string, Map<string, number>>();
      for (const l of ledger) {
        if (l.kind !== "expense" || Number(l.amount) <= 0) continue;
        if (l.category === "신용결제" || l.category === "재테크" || l.category === "환전") continue;
        const sub = (l.subCategory || l.category || "").trim(); if (!sub) continue;
        const mo = l.date?.slice(0, 7); if (!mo) continue;
        if (mo !== targetMonth && !prevMonths.includes(mo)) continue;
        if (!subMonthly.has(sub)) subMonthly.set(sub, new Map());
        subMonthly.get(sub)!.set(mo, (subMonthly.get(sub)!.get(mo) ?? 0) + Number(l.amount));
      }
      const rows: { sub: string; cur: number; avg3: number; pctChange: number }[] = [];
      for (const [sub, mm] of subMonthly) {
        const cur = mm.get(targetMonth) ?? 0;
        const avg3 = prevMonths.reduce((s, m) => s + (mm.get(m) ?? 0), 0) / prevMonths.length;
        if (cur === 0 && avg3 === 0) continue;
        const pct = avg3 > 0 ? ((cur - avg3) / avg3) * 100 : cur > 0 ? 999 : 0;
        rows.push({ sub, cur, avg3, pctChange: pct });
      }
      const upRows = [...rows].filter((r) => r.cur > 50000 || r.avg3 > 50000).sort((a, b) => b.pctChange - a.pctChange).slice(0, 5);
      const downRows = [...rows].filter((r) => r.avg3 > 50000).sort((a, b) => a.pctChange - b.pctChange).slice(0, 5);
      return { up: upRows, down: downRows };
    })();

    /* 단건 지출 이상치 TOP — 중분류 내 z-score */
    const entryOutliers = (() => {
      // subCategory별 entries
      const bySub = new Map<string, { date: string; desc: string; cat: string; amount: number }[]>();
      for (const l of fExp) {
        if (l.category === "신용결제") continue;
        const sub = (l.subCategory || l.category || "").trim(); if (!sub) continue;
        if (!bySub.has(sub)) bySub.set(sub, []);
        bySub.get(sub)!.push({ date: l.date || "", desc: l.description || "", cat: l.category || "", amount: Number(l.amount) });
      }
      const outliers: { date: string; desc: string; sub: string; cat: string; amount: number; zScore: number; avg: number }[] = [];
      for (const [sub, entries] of bySub) {
        if (entries.length < 4) continue; // 표본 작은 카테고리는 건너뜀
        const mean = entries.reduce((s, e) => s + e.amount, 0) / entries.length;
        const variance = entries.reduce((s, e) => s + (e.amount - mean) ** 2, 0) / entries.length;
        const std = Math.sqrt(variance);
        if (std <= 0) continue;
        for (const e of entries) {
          const z = (e.amount - mean) / std;
          if (Math.abs(z) >= 2) outliers.push({ date: e.date, desc: e.desc, sub, cat: e.cat, amount: e.amount, zScore: z, avg: mean });
        }
      }
      return outliers.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore)).slice(0, 10);
    })();

    /* DOM 월 가중치 보정 — 각 일자(1~31)가 기간 내 며칠만큼 존재했는지 */
    const domOccurrences = new Array(31).fill(0);
    for (const m of months) {
      const [y, mo] = m.split("-").map(Number);
      const daysInMonth = new Date(y, mo, 0).getDate(); // 28-31
      for (let i = 0; i < daysInMonth; i++) domOccurrences[i]++;
    }
    const spendByDOMAvg = spendByDOM.map((v, i) => domOccurrences[i] > 0 ? v / domOccurrences[i] : 0);

    /* 소비 스트릭·월별 무지출일·거래 간격 */
    const patternStats = (() => {
      const spendDaySet = new Set<string>();
      for (const l of fExp) if (l.date) spendDaySet.add(l.date);
      if (months.length === 0) {
        return {
          longestSpendStreak: 0,
          longestZeroStreak: 0,
          currentStreakType: "none" as "none" | "spend" | "zero",
          currentStreakDays: 0,
          zeroDaysPerMonth: [] as { month: string; label: string; zeroDays: number; totalDays: number }[],
          avgIntervalDays: 0,
        };
      }
      const start = new Date(months[0] + "-01");
      const [ly, lm] = months[months.length - 1].split("-").map(Number);
      const end = new Date(ly, lm, 0);
      let longestSpend = 0, longestZero = 0, curSpend = 0, curZero = 0;
      for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
        const iso = cur.toISOString().slice(0, 10);
        if (spendDaySet.has(iso)) { curSpend++; curZero = 0; if (curSpend > longestSpend) longestSpend = curSpend; }
        else { curZero++; curSpend = 0; if (curZero > longestZero) longestZero = curZero; }
      }
      const lastIso = end.toISOString().slice(0, 10);
      const currentStreakType: "none" | "spend" | "zero" = spendDaySet.has(lastIso) ? "spend" : "zero";
      const currentStreakDays = currentStreakType === "spend" ? curSpend : curZero;

      const zeroDaysPerMonth = months.map((m) => {
        const [y, mo] = m.split("-").map(Number);
        const daysInMonth = new Date(y, mo, 0).getDate();
        let zd = 0;
        for (let dd = 1; dd <= daysInMonth; dd++) {
          const iso = `${m}-${String(dd).padStart(2, "0")}`;
          if (!spendDaySet.has(iso)) zd++;
        }
        return { month: m, label: ml[m], zeroDays: zd, totalDays: daysInMonth };
      });

      const sortedSpendDays = Array.from(spendDaySet).sort();
      let sumGap = 0, gapCount = 0;
      for (let i = 1; i < sortedSpendDays.length; i++) {
        const a = new Date(sortedSpendDays[i - 1]);
        const b = new Date(sortedSpendDays[i]);
        sumGap += Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
        gapCount++;
      }
      const avgIntervalDays = gapCount > 0 ? sumGap / gapCount : 0;

      return { longestSpendStreak: longestSpend, longestZeroStreak: longestZero, currentStreakType, currentStreakDays, zeroDaysPerMonth, avgIntervalDays };
    })();

    return {
      months, ml, selMonth, txCount: fL.length, anomalyTargetMonth, topAnomaly, incomeGrowth, spendingInertia,
      budgetProgress, categoryGrowth, entryOutliers, spendByDOMAvg, domOccurrences, patternStats,
      monthly, savRateTrend, salaryTrend, cumIE, investTrend, divTrend, tradeCntTrend, subTrend, txCntTrend, cumSpend, monthlyCatTrend, dateExpMonthly,
      pIncome, pExpense, pInvest, pSavRate, expByCat, expBySub, topCats, acctUsage, wdSpend, dateTop, dateSubCats, dateEntries, dateTxCount, incByCat, trades, subs, largeExp, topTx, expBySubCat, expByDesc, dateMoim, datePersonal, spendByDOM, portfolio, realPL: { total: plTot, wins: plWin, losses: plLoss, winCnt: plWC, lossCnt: plLC },
      zeroDays, totalDays, weekendTot, weekdayTot, topDates,
      score: { total: scorePts, grade, comment: comments[grade] || "" }, prev, avgMonthExp,
      incByGroup, investBySub, dateByDetail, stockTrends,
      subInsights, incSubInsights, dateSubInsights, investSubInsights,
      realIncome, realExpense, settlementTotal, tempIncomeTotal, dateAccountSpend, datePartnerShare, originalAssets, originalAssetsByAcct,
      netProfit, realSavRate, passiveIncome, expToIncRatio, dailyAvgExp, netCashFlow,
      incomeStability, investReturnRate, subTotal, fixedExpense, variableExpense,
      netWorthByMonth, accountBalances, assetAllocation, funStats,
    };
  }, [ledger, rawTrades, accounts, selMonth, categoryPresets]);
}

/* ================================================================== */
/*  Main Component                                                     */
/* ================================================================== */

interface Props {
  accounts: Account[];
  ledger: LedgerEntry[];
  trades?: StockTrade[];
  prices?: StockPrice[];
  fxRate?: number;
  categoryPresets: CategoryPresets;
  budgetGoals?: BudgetGoal[];
  recurringExpenses?: RecurringExpense[];
  onAddLedger?: (entry: LedgerEntry) => void;
}

export const InsightsView: React.FC<Props> = ({ accounts, ledger, trades = [], prices: _p, fxRate: _f, categoryPresets, budgetGoals: _b, recurringExpenses = [], onAddLedger }) => {
  const [tab, setTab] = useState<TabId>("overview");
  const [selMonth, setSelMonth] = useState<string | null>(null);
  const [periodMonths, setPeriodMonths] = useState<number | null>(null); // null = 전체
  const { filteredLedger, filteredTrades } = useMemo(() => {
    if (periodMonths == null) return { filteredLedger: ledger, filteredTrades: trades };
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - periodMonths);
    const cutoffIso = cutoff.toISOString().slice(0, 10);
    return {
      filteredLedger: ledger.filter((l) => (l.date ?? "") >= cutoffIso),
      filteredTrades: trades.filter((t) => (t.date ?? "") >= cutoffIso),
    };
  }, [ledger, trades, periodMonths]);
  const d = useD(filteredLedger, filteredTrades, accounts, selMonth, categoryPresets, _b);

  const dateRange = d.months.length > 0 ? `${d.months[0].replace("-", ".")} ~ ${d.months[d.months.length - 1].replace("-", ".")}` : "";
  const TabMap: Record<TabId, React.FC<{ d: D }>> = { overview: OverviewTab, expense: ExpenseTab, income: IncomeTab, asset: AssetTab, date: DateTab, invest: InvestTab, sub: SubTab, pattern: PatternTab, fun: FunTab, settle: () => null, forecast: () => null };
  const ActiveTab = TabMap[tab];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, fontFamily: "'Pretendard Variable', 'Pretendard', -apple-system, sans-serif" }}>
      <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" rel="stylesheet" />

      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%)", padding: "24px 32px 18px", color: "#fff", borderRadius: "12px 12px 0 0", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase" as const, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>FarmWallet Analytics</div>
          <div style={{ fontSize: 26, fontWeight: 800 }}>가계부 인사이트 대시보드</div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>{dateRange} · {d.txCount.toLocaleString()}건 분석</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.1)", borderRadius: 8, padding: 2 }}>
            {[
              { label: "3M", v: 3 },
              { label: "6M", v: 6 },
              { label: "1Y", v: 12 },
              { label: "전체", v: null as number | null },
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setPeriodMonths(p.v)}
                style={{
                  padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer",
                  fontSize: 12, fontWeight: 700,
                  background: periodMonths === p.v ? "#fff" : "transparent",
                  color: periodMonths === p.v ? "#1a1a2e" : "rgba(255,255,255,0.7)",
                  transition: "all 0.15s",
                }}
              >{p.label}</button>
            ))}
          </div>
          <select value={selMonth ?? "all"} onChange={e => setSelMonth(e.target.value === "all" ? null : e.target.value)} style={{
            padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.1)",
            color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", outline: "none", minWidth: 120,
          }}>
            <option value="all" style={{ color: "#1a1a2e" }}>전체 월</option>
            {[...d.months].reverse().map(m => <option key={m} value={m} style={{ color: "#1a1a2e" }}>{d.ml[m]} ({m})</option>)}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, padding: "12px 24px", background: "#fff", borderBottom: "1px solid #eee", overflowX: "auto", flexWrap: "nowrap" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "8px 16px", borderRadius: 20, border: "none", cursor: "pointer", whiteSpace: "nowrap",
            fontSize: 13, fontWeight: tab === t.id ? 700 : 500,
            background: tab === t.id ? "#1a1a2e" : "transparent", color: tab === t.id ? "#fff" : "#666", transition: "all 0.2s",
          }}>{t.icon} {t.label}</button>
        ))}
        {selMonth && <span style={{ marginLeft: "auto", fontSize: 12, color: "#e94560", fontWeight: 700, alignSelf: "center", whiteSpace: "nowrap" }}>{d.ml[selMonth]} 선택됨</span>}
      </div>

      {/* Content */}
      <div style={{ padding: "20px 24px", maxWidth: 1200, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        {tab === "forecast" ? (
          <ForecastView ledger={ledger} recurring={recurringExpenses} formatNumber={W} />
        ) : tab === "settle" ? (
          <SettlementView
            data={{ accounts, ledger, trades, prices: [], categoryPresets, recurringExpenses, budgetGoals: _b ?? [], customSymbols: [] }}
            onSettle={(entry) => onAddLedger?.(entry)}
            formatNumber={W}
          />
        ) : (
          <ActiveTab d={d} />
        )}
      </div>
    </div>
  );
};
