/**
 * 인사이트 전기간(full-period) 기반 집계 — 순수 함수 (React 의존 없음).
 *
 * useInsightsData를 2단으로 분층한 1단:
 *   buildInsightsBase(원본 데이터) → InsightsBase   … 월 선택(selMonth)과 무관한 전기간 맵·추세·계좌·포지션
 *   sliceInsightsForMonth(base, selMonth) → D        … 선택월 파생 (insightsSlice.ts)
 *
 * 예전엔 하나의 useMemo가 11개 deps로 묶여 selMonth만 바뀌어도 전 기간을 재계산했다.
 * 이 파일의 결과는 데이터·환율·프리셋이 바뀔 때만 재계산되고, 월 선택은 slice만 다시 돈다.
 *
 * ⚠ 동작 불변 리팩터 — 각 블록은 useInsightsData 원본을 그대로 옮겼다(부동소수 합산 순서 포함).
 *   골든 스냅샷(src/__tests__/insightsDataGolden.test.tsx)이 D 출력 전체를 고정한다.
 * ⚠ 오늘 날짜(getTodayKST)에 의존하는 값은 여기 두지 않는다 — base는 데이터가 안 바뀌면 캐시되므로
 *   자정/월 경계를 넘겨도 stale 되지 않게 slice가 매번 계산한다.
 */
import type { Account, LedgerEntry, StockTrade, StockPrice, CategoryPresets } from "../../types";
import { computeAccountBalances, computePositions, positionMarketValueKRW } from "../../calculations";
import { computePortfolioMetrics, computeUnrealizedPL } from "../../utils/portfolioMetrics";
import { isInvestmentEntry, isCurrencyExchangeEntry, isInvestmentLossEntry } from "../../utils/category";
import { classifyLedgerFlow, toKrwAmount } from "../dashboard/summaryMath";
import { tradeAmountKRW } from "../../utils/finance";
import { buildClosedTradeRecords, summarizeRecords, summaryToRealPL } from "../../utils/investmentRecord";
import { computeOriginalAssets } from "../../utils/realIncome";
import { computeIncomeNatureKeys } from "../../utils/incomeClassification";
import { getMoimAccountIds, computeMoimAccountFlow, type MoimFlowAnalysis } from "../../utils/dateAccounting";
import { isExcludedIncomeEntry, computeRealSavingsRate, computeMonthlyRealFlows } from "../../utils/savingsRate";
import type { AccountTimelineRow } from "../../utils/accountTimeline";
import { SD, type D } from "./insightsShared";

interface InsightsBaseInput {
  /** 기간(periodMonths) 필터된 가계부 — InsightsPage filteredLedger */
  ledger: LedgerEntry[];
  /** 기간 필터된 거래 — InsightsPage filteredTrades */
  rawTrades: StockTrade[];
  /** 전체 거래 — FIFO 원가·포지션은 전체 이력으로 */
  allTrades: StockTrade[];
  accounts: Account[];
  prices: StockPrice[];
  categoryPresets: CategoryPresets | undefined;
  dateAccountId: string | null;
  fxRate: number | null;
  timelineRows: AccountTimelineRow[];
  /** 기간 필터 전 전체 가계부 — 계좌별 현재 잔액(누적) 정확성용 */
  allLedger: LedgerEntry[];
}

/** 월별 합계 배열 맵 — key → months 인덱스 순 합계(mTotalsFor와 동일 합산 순서: ledger 순서대로 월 버킷에 누적) */
export type MonthlyTotalsByKey = Map<string, number[]>;

export interface InsightsBase {
  /* 원본 참조 (slice가 선택월 필터에 사용) */
  ledger: LedgerEntry[];
  rawTrades: StockTrade[];
  accounts: Account[];
  categoryPresets: CategoryPresets | undefined;
  fxRate: number | null;
  /* 단일 진입점 헬퍼 */
  aMap: Map<string, string>;
  invIds: Set<string>;
  moimIds: Set<string>;
  amt: (l: LedgerEntry) => number;
  flowOf: (l: LedgerEntry) => ReturnType<typeof classifyLedgerFlow>;
  /* 전기간 월 축 */
  monthly: D["monthly"];
  months: string[];
  ml: Record<string, string>;
  realFlows: ReturnType<typeof computeMonthlyRealFlows>;
  /* 소득 분류 */
  salaryKeys: Set<string>;
  investIncKeys: Set<string>;
  nonRealKeys: Set<string>;
  salaryMonthly: Record<string, number>;
  realIncomeMonthly: Record<string, number>;
  /* 추세(전기간) */
  savRateTrend: D["savRateTrend"];
  salaryTrend: D["salaryTrend"];
  cumIE: D["cumIE"];
  investTrend: D["investTrend"];
  divTrend: D["divTrend"];
  tradeCntTrend: D["tradeCntTrend"];
  subTrend: D["subTrend"];
  txCntTrend: D["txCntTrend"];
  cumSpend: D["cumSpend"];
  /* 중분류별 월별 합계(전기간) — sub 인사이트가 월별 재스캔 대신 조회 */
  expSubMonthly: MonthlyTotalsByKey;
  incSubMonthly: MonthlyTotalsByKey;
  investSubMonthly: MonthlyTotalsByKey;
  /* 포지션·실현손익 */
  portfolio: D["portfolio"];
  holdingsByStock: D["holdingsByStock"];
  totalHoldingsCost: number;
  allClosedRecords: ReturnType<typeof buildClosedTradeRecords>;
  periodSellIds: Set<string>;
  realPL: D["realPL"];
  investReturnRate: number;
  investBreakdown: D["investBreakdown"];
  stockTrends: D["stockTrends"];
  /* 원래 보유·분담 통장 */
  originalAssets: number;
  originalAssetsByAcct: D["originalAssetsByAcct"];
  moimFlow: MoimFlowAnalysis;
  incomeStability: number | null;
  /* 순자산/자산 */
  netWorthByMonth: D["netWorthByMonth"];
  netWorthNow: D["netWorthNow"];
  accountBalances: D["accountBalances"];
  assetAllocation: D["assetAllocation"];
  /* 전기간 스칼라 */
  avgMonthExp: number;
  mostFrugalMonth: D["funStats"]["mostFrugalMonth"];
  mostSpendMonth: D["funStats"]["mostSpendMonth"];
  monthOverMonthGrowth: number | null;
  bestSavingsMonth: D["funStats"]["bestSavingsMonth"];
  domOccurrences: number[];
}

/** 지출 중분류 키 — 표준: detailCategory. ⚠ subInsights 항목 매칭에도 쓰인다(키가 갈라지면 매칭 0건). */
export const expSubName = (l: LedgerEntry) => l.detailCategory || l.subCategory || l.category || "기타";

/** 구독 판정 — category 또는 subCategory에 "구독" 포함 */
export const isSubEntry = (l: LedgerEntry) => {
  if (l.kind !== "expense") return false;
  const cat = (l.category || "").trim();
  const sub = (l.subCategory || "").trim();
  return cat.includes("구독") || sub.includes("구독");
};

/**
 * 전기간 월별 합계를 키별로 1패스 누적 — 키 k에 대해 mTotalsFor(months, ledger, l => keyOf(l)===k, amt)와
 * 동일한 결과(월 버킷마다 ledger 순서대로 더하므로 부동소수 합산 순서도 같다).
 * keyOf가 null을 돌려주면 해당 항목 제외.
 */
function monthlyTotalsByKey(
  ledger: LedgerEntry[],
  months: string[],
  keyOf: (l: LedgerEntry) => string | null,
  amt: (l: LedgerEntry) => number,
): MonthlyTotalsByKey {
  const monthIdx = new Map<string, number>();
  months.forEach((m, i) => monthIdx.set(m, i));
  const out: MonthlyTotalsByKey = new Map();
  for (const l of ledger) {
    const m = l.date?.slice(0, 7);
    const idx = m ? monthIdx.get(m) : undefined;
    if (idx === undefined) continue;
    const key = keyOf(l);
    if (key === null) continue;
    let arr = out.get(key);
    if (!arr) { arr = new Array<number>(months.length).fill(0); out.set(key, arr); }
    arr[idx] += amt(l);
  }
  return out;
}

export function buildInsightsBase(input: InsightsBaseInput): InsightsBase {
  const { ledger, rawTrades, allTrades, accounts, prices, categoryPresets, dateAccountId, fxRate, timelineRows, allLedger } = input;
  const aMap = new Map(accounts.map(a => [a.id, a.name]));
  const invIds = new Set(accounts.filter(a => a.type === "securities" || a.type === "crypto").map(a => a.id));
  const moimIds = getMoimAccountIds(accounts);
  /** 금액 단일 진입점 — USD는 환율 환산. 원본 amount를 직접 합산하지 말 것
   *  (예전엔 fxRate를 받고도 전 구간이 원본을 더해 USD 투자이체가 1/1400로 집계됐다). */
  const amt = (l: LedgerEntry) => toKrwAmount(l, fxRate);
  /** 흐름 분류 단일 진입점 — 대시보드 classifyLedgerFlow와 동일 기준.
   *  (예전엔 이 파일이 `category!=="재테크"` 하드코딩 + 투자손실을 지출에 가산해
   *  대시보드와 "지출" 숫자가 달랐다. 투자손익은 재테크 순집계 — 확정 정책.) */
  const flowOf = (l: LedgerEntry) => classifyLedgerFlow(l, categoryPresets);

  /* ===== monthly (full period) ===== */
  const monthly: Record<string, { income: number; expense: number; investment: number }> = {};
  const em = (m: string) => { if (!monthly[m]) monthly[m] = { income: 0, expense: 0, investment: 0 }; };
  for (const l of ledger) {
    const m = l.date?.slice(0, 7); if (!m) continue; em(m);
    const a = amt(l); if (a <= 0) continue;
    const flow = flowOf(l);
    // 이월/원래보유·소득 집계 제외(퇴직연금)·신용결제·환전은 classifyLedgerFlow가 null로 거른다
    if (flow === "income") monthly[m].income += a;
    else if (flow === "expense") monthly[m].expense += a;
    // 재테크 = 저축·투자 이체 + 투자수익(+) − 투자손실(−) — 대시보드와 동일 순집계
    else if (flow === "investing") monthly[m].investment += isInvestmentLossEntry(l) ? -a : a;
    // 인사이트 확장: 증권·코인 계좌로 들어간 일반 이체(계좌이체 등)도 투자 유입으로 본다
    else if (l.kind === "transfer" && l.toAccountId && invIds.has(l.toAccountId)) monthly[m].investment += a;
  }
  const months = Object.keys(monthly).sort();
  const ml: Record<string, string> = {};
  months.forEach(m => { ml[m] = parseInt(m.slice(5)) + "월"; });

  /* ===== 실질 수입/지출 월별 (정산·일시소득 제외, USD 환산, 데이트 50% 분담) — utils/savingsRate 단일 소스 ===== */
  const realFlows = computeMonthlyRealFlows(ledger, { fxRate, dateAccountId, nonRealIncomeOverride: categoryPresets?.categoryTypes?.nonRealIncome });

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
    if (isExcludedIncomeEntry(l)) continue;
    if (salaryKeys.has(l.subCategory || l.category || "")) salaryMonthly[m] += amt(l);
  }
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
      if (isExcludedIncomeEntry(l)) continue;
      if (salaryKeys.has(sub)) sal += amt(l); else non += amt(l);
    }
    return { l: ml[m], salary: sal, nonSalary: non };
  });
  let ci = 0, ce = 0;
  // 누적수입은 근로소득 기준 (정산·용돈·배당 등 비근로 유입 제외 — 위 salaryMonthly 주석 참조)
  const cumIE = months.map(m => { ci += salaryMonthly[m]; ce += monthly[m].expense; return { l: ml[m], 누적수입: ci, 누적지출: ce }; });
  const investTrend = months.map(m => ({ l: ml[m], amount: monthly[m].investment }));
  const divTrend = months.map(m => {
    let d = 0;
    // subCategory 없으면 category 폴백 — incByCat·investIncKeys 산출과 동일 키 규칙.
    // flowOf "income" 게이트: 투자수익(재테크 순집계 대상)·이월/퇴직연금 제외 + 양수만 —
    // 패시브 KPI(incByCat 기반 passiveIncome)와 같은 모집단이라 같은 화면의 KPI·차트가 일치한다.
    for (const l of ledger) {
      if (l.date?.slice(0, 7) !== m || Number(l.amount) <= 0) continue;
      if (flowOf(l) !== "income") continue;
      if (investIncKeys.has(l.subCategory || l.category || "")) d += amt(l);
    }
    return { l: ml[m], amount: d };
  });
  const tradeCntTrend = months.map(m => ({ l: ml[m], count: rawTrades.filter(t => t.date?.slice(0, 7) === m).length }));
  const subTrend = months.map(m => {
    let a = 0; for (const l of ledger) { if (l.date?.slice(0, 7) !== m || !isSubEntry(l)) continue; a += amt(l); }
    return { l: ml[m], amount: a };
  });
  const txCntTrend = months.map(m => ({ l: ml[m], count: ledger.filter(l => l.date?.slice(0, 7) === m).length }));

  /* cumulativeSpending (full) */
  const cumSpend: Record<string, number[]> = {};
  for (const m of months) {
    const [y, mo] = m.split("-").map(Number); const dim = new Date(y, mo, 0).getDate();
    const daily = new Array(31).fill(0);
    for (const l of ledger) {
      if (l.kind !== "expense" || isCurrencyExchangeEntry(l) || isInvestmentEntry(l) || l.date?.slice(0, 7) !== m) continue;
      const d = parseInt(l.date.slice(8, 10)) - 1; if (d >= 0 && d < 31) daily[d] += amt(l);
    }
    const cum: number[] = []; let r = 0;
    for (let d = 0; d < 31; d++) { if (d < dim) r += daily[d]; cum.push(r); }
    cumSpend[m] = cum;
  }

  /* ===== 중분류별 월별 합계(전기간) — 지출/수입/재테크 sub 인사이트의 mTotals 조회용 =====
     예전엔 sub마다 mTotalsFor(months × ledger)를 돌렸다(상위 15+12+N개 × 월 × 원장). 키별 1패스로 동일 결과. */
  // 지출: fExp/expBySub와 동일 기준(flowOf + expSubName + 환산) — 어긋나면 월별 추세가 합계와 안 맞는다
  const expSubMonthly = monthlyTotalsByKey(ledger, months, l => flowOf(l) === "expense" ? expSubName(l) : null, amt);
  const incSubMonthly = monthlyTotalsByKey(ledger, months, l => flowOf(l) === "income" ? (l.subCategory || l.category || "기타") : null, amt);
  // 모집단은 총액(investBySub: expense+재테크)과 반드시 동일해야 한다 — 이전의 isInvestmentEntry는
  // sub '저축'/'투자'만 참이라 '투자손실' 등의 카드가 총액은 크게, 추세·월평균은 항상 0으로 나왔다.
  const investSubMonthly = monthlyTotalsByKey(ledger, months, l => l.kind === "expense" && l.category === "재테크" ? (l.subCategory || "기타") : null, amt);

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
  // 기간 판정은 rawTrades(일 단위 컷오프 적용된 거래) 소속 여부 — closedByStock(slice)에서 사용
  const periodSellIds = new Set(rawTrades.filter((t) => t.side === "sell").map((t) => t.id));
  // 실현 수익률: FIFO 청산 거래의 totalPnl / totalCostBasis (대시보드와 동일)
  const investReturnRate = lifetimeRealizedSummary.totalCost > 0
    ? lifetimeRealizedSummary.totalPnl / lifetimeRealizedSummary.totalCost * 100
    : 0;

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

  /* ===== 원래 보유 자산·분담 통장 흐름 (실질 수입/지출은 realFlows 소유) ===== */
  const { originalAssetsByAcct, originalAssets } = computeOriginalAssets(accounts);
  // 분담 통장 월별 흐름 — 전체 ledger·전체 months 사용 (현재 잔액 누적 의미)
  const moimFlow = computeMoimAccountFlow(ledger, dateAccountId, months);

  // 수입 안정성 — 근로소득의 월별 편차 (정기 소득의 안정성이 의미 있음)
  const incVals = months.filter(m => salaryMonthly[m] > 0).map(m => salaryMonthly[m]);
  let incomeStability: number | null = null;
  if (incVals.length >= 2) {
    const iMean = incVals.reduce((a, b) => a + b, 0) / incVals.length;
    const iStd = Math.sqrt(incVals.reduce((s, v) => s + (v - iMean) ** 2, 0) / incVals.length);
    incomeStability = iMean > 0 ? Math.round((1 - iStd / iMean) * 100) : 0;
  }

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

  /* ===== 전기간 스칼라 (재미 통계·평균) ===== */
  const fullMonths = Math.max(months.length, 1);
  const avgMonthExp = SD(months.reduce((s, m) => s + monthly[m].expense, 0), fullMonths);
  // 가장 절약한 달 / 가장 많이 쓴 달
  let mostFrugalMonth: { month: string; expense: number } | null = null;
  let mostSpendMonth: { month: string; expense: number } | null = null;
  for (const m of months) {
    const e = monthly[m].expense;
    if (e > 0 && (!mostFrugalMonth || e < mostFrugalMonth.expense)) mostFrugalMonth = { month: m, expense: e };
    if (!mostSpendMonth || e > mostSpendMonth.expense) mostSpendMonth = { month: m, expense: e };
  }
  // 순자산 월평균 성장률 — 분모는 구간 수(개월 수 − 1). N개월이면 월간 변화는 N−1번.
  let monthOverMonthGrowth: number | null = null;
  if (netWorthByMonth.length >= 2) {
    const first = netWorthByMonth[0].total;
    const last = netWorthByMonth[netWorthByMonth.length - 1].total;
    if (first > 0) monthOverMonthGrowth = Math.round((last / first - 1) / (netWorthByMonth.length - 1) * 100 * 10) / 10;
  }
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

  /* DOM 월 가중치 보정 — 각 일자(1~31)가 기간 내 며칠만큼 존재했는지 */
  const domOccurrences = new Array(31).fill(0);
  for (const m of months) {
    const [y, mo] = m.split("-").map(Number);
    const daysInMonth = new Date(y, mo, 0).getDate(); // 28-31
    for (let i = 0; i < daysInMonth; i++) domOccurrences[i]++;
  }

  // 투자 손익 4분할 (실현/미실현 × 수익/손실, KRW 환산).
  // 실현: plWin/plLoss (FIFO 청산 손익, 라이프타임 누적).
  // 미실현: 보유 종목 × (현재가 - 평단) — utils/portfolioMetrics.computeUnrealizedPL.
  //   ⚠ priceFallback 없이(실제 시세만) 재계산 — curPositions(priceFallback:"cost")와 구분.
  const _positions = computePositions(allTrades, prices, accounts, { fxRate: fxRate ?? undefined });
  const { unrealizedGain, unrealizedLoss } = computeUnrealizedPL(_positions, fxRate);
  const investBreakdown = {
    realizedGain: realPL.wins,
    realizedLoss: realPL.losses,
    unrealizedGain,
    unrealizedLoss,
  };

  return {
    ledger, rawTrades, accounts, categoryPresets, fxRate,
    aMap, invIds, moimIds, amt, flowOf,
    monthly, months, ml, realFlows,
    salaryKeys, investIncKeys, nonRealKeys, salaryMonthly, realIncomeMonthly,
    savRateTrend, salaryTrend, cumIE, investTrend, divTrend, tradeCntTrend, subTrend, txCntTrend, cumSpend,
    expSubMonthly, incSubMonthly, investSubMonthly,
    portfolio, holdingsByStock, totalHoldingsCost, allClosedRecords, periodSellIds, realPL, investReturnRate, investBreakdown, stockTrends,
    originalAssets, originalAssetsByAcct, moimFlow, incomeStability,
    netWorthByMonth, netWorthNow, accountBalances, assetAllocation,
    avgMonthExp, mostFrugalMonth, mostSpendMonth, monthOverMonthGrowth, bestSavingsMonth, domOccurrences,
  };
}
