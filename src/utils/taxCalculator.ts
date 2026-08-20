import type { LedgerEntry } from "../types";
import { isDividendEntry, isInterestEntry } from "./categoryMatch";
import { addDaysToIso, parseIsoLocal } from "./date";
import { toKrwByRate } from "./currency";

/** ?쒓뎅 遺꾨━怨쇱꽭 諛곕떦쨌?댁옄?뚮뱷?몄쑉 (?뚮뱷??14% + 吏諛⑹꽭 1.4%) */
export const SEPARATE_TAX_RATE = 0.154;

/** 醫낇빀怨쇱꽭 ?꾪솚 湲곗? (諛곕떦+?댁옄 ?⑷퀎, ?? */
export const COMPREHENSIVE_TAX_THRESHOLD = 20_000_000;

/** ?댁쇅(USD) 諛곕떦 ?먯쿇吏뺤닔????誘멸뎅 二쇱떇 諛곕떦? ?꾩??먯꽌 15% ?먯쿇吏뺤닔 ???낃툑 */
export const US_DIVIDEND_WITHHOLDING_RATE = 0.15;

/** ?멸툑 怨꾩궛 ?듭뀡 */
interface TaxComputeOptions {
  /**
   * ?몄쟾(gross-up) ?섏궛. 媛怨꾨? amount???명썑 ?낃툑???먯쿇吏뺤닔 ????媛?μ꽦???믪???醫낇빀怨쇱꽭
   * ?꾧퀎(2,000留????몄쟾 湲곗??대?濡?洹몃?濡??곕㈃ ~15% 怨쇱냼 ??寃쎄퀬媛 ??쾶 ?몃┛??
   * true硫???ぉ蹂꾨줈 ??궛: USD 諛곕떦 첨(1??.15), 洹???援?궡 諛곕떦쨌?댁옄, USD ?댁옄) 첨(1??.154).
   * 湲곕낯 false = 湲곗〈 ?숈옉(?낅젰 湲덉븸 洹몃?濡? 100% ?좎?.
   */
  grossUp?: boolean;
}

/**
 * ??ぉ 1嫄댁쓽 怨쇱꽭?쒖? 湲곗뿬遺???. grossUp?대㈃ ?먯쿇吏뺤닔 ??궛(?몄쟾 ?섏궛), ?꾨땲硫??낅젰 湲덉븸(?먰솕 ?섏궛)??洹몃?濡??대떎.
 * USD ?댁옄??援?궡 湲덉쑖???щ윭 RP쨌?명솕?덇툑 ???먯꽌 15.4% ?먯쿇吏뺤닔?섎뒗 寃쎌슦媛 ?遺遺꾩씠??援?궡?⑥쓣 ?곸슜?쒕떎 ?? * LedgerEntry?먮뒗 醫낅ぉ ?뺣낫媛 ?놁쑝誘濡??댁쇅 ?먯젙? currency==="USD"(諛곕떦)留뚯쑝濡??쒕떎.
 */
function taxableKrw(e: LedgerEntry, fxRate: number | null | undefined, grossUp: boolean, isDividend: boolean): number {
  const krw = toKrwByRate(e.amount, e.currency, fxRate);
  if (!grossUp) return krw;
  const rate = isDividend && e.currency === "USD" ? US_DIVIDEND_WITHHOLDING_RATE : SEPARATE_TAX_RATE;
  return krw / (1 - rate);
}

export interface TaxYearSummary {
  year: number;
  dividendGross: number;
  interestGross: number;
  totalGross: number;
  separateTax: number;
  netIncome: number;
  exceedsThreshold: boolean;
  amountOverThreshold: number;
  estimatedAdditionalTaxIfComprehensive: number;
  /** ?몄쟾 ?섏궛(grossUp) ?곸슜 ?щ? */
  grossUpApplied: boolean;
  /** ?낅젰 湲덉븸(?명썑 ?낃툑??媛?? ?⑷퀎 ???섏궛 ??(?? */
  netTotal: number;
  /** 怨쇱꽭?쒖??쇰줈 ???⑷퀎 ???섏궛 ??(??. grossUp=false硫?netTotal怨?媛숇떎 */
  grossTotal: number;
}

/**
 * 媛怨꾨? ??ぉ 以?移댄뀒怨좊━媛 "諛곕떦" ?먮뒗 "?댁옄"瑜??ы븿?섎뒗 ?섏엯 ?⑷퀎 湲곗??쇰줈
 * ?쒓뎅 ?몃쾿???곕Ⅸ 遺꾨━怨쇱꽭/醫낇빀怨쇱꽭 ?쒕??덉씠?섏쓣 ?섑뻾?쒕떎.
 *
 * 媛怨꾨? amount???명썑 ?낃툑?≪씪 媛?μ꽦???믪?留?????먮룞 李④컧), 蹂?怨꾩궛?
 * ?ъ슜?먭? ?낅젰??湲덉븸??grossTaxable濡?媛?뺥븯怨??쒖떆?쒕떎.
 */
export function summarizeTaxYear(
  ledger: LedgerEntry[],
  year: number,
  fxRate?: number | null,
  options?: TaxComputeOptions
): TaxYearSummary {
  const yearStr = String(year);
  const grossUp = options?.grossUp === true;
  // USD 諛곕떦/?댁옄???먰솕濡??섏궛?댁빞 怨쇱꽭?쒖???留욌떎 (?섏쑉 誘몃줈?????〓㈃ ?대갚 ???⑹궛 ?뺤콉 ?쇨?)
  const toKrw = (e: LedgerEntry) => toKrwByRate(e.amount, e.currency, fxRate);

  let dividendGross = 0;
  let interestGross = 0;
  let netTotal = 0;
  for (const e of ledger) {
    if (e.kind !== "income" || !e.date?.startsWith(yearStr)) continue;
    if (isDividendEntry(e)) { dividendGross += taxableKrw(e, fxRate, grossUp, true); netTotal += toKrw(e); continue; }
    if (isInterestEntry(e)) { interestGross += taxableKrw(e, fxRate, grossUp, false); netTotal += toKrw(e); }
  }

  const totalGross = dividendGross + interestGross;
  const separateTax = totalGross * SEPARATE_TAX_RATE;
  const netIncome = totalGross - separateTax;

  const exceedsThreshold = totalGross > COMPREHENSIVE_TAX_THRESHOLD;
  const amountOverThreshold = Math.max(0, totalGross - COMPREHENSIVE_TAX_THRESHOLD);

  // 醫낇빀怨쇱꽭 ?꾩쭊?몄쑉(媛쒕왂): 珥덇낵遺꾩뿉 24% ?곸슜 媛??(1.5???댄븯 援ш컙)
  const estimatedAdditionalTaxIfComprehensive = exceedsThreshold
    ? amountOverThreshold * (0.24 - SEPARATE_TAX_RATE)
    : 0;

  return {
    year,
    dividendGross,
    interestGross,
    totalGross,
    separateTax,
    netIncome,
    exceedsThreshold,
    amountOverThreshold,
    estimatedAdditionalTaxIfComprehensive,
    grossUpApplied: grossUp,
    netTotal,
    grossTotal: totalGross
  };
}

interface ComprehensiveTaxTracker {
  year: number;
  /** ?ы빐 ?꾩쟻 湲덉쑖?뚮뱷 (諛곕떦+?댁옄, ?? today源뚯?) */
  ytdGross: number;
  dividendGross: number;
  interestGross: number;
  threshold: number;
  /** ?꾧퀎源뚯? ?⑥? 湲덉븸 (max 0) */
  remainingToThreshold: number;
  exceeded: boolean;
  /** ytd / threshold (0~) */
  pctOfThreshold: number;
  /** YTD ?섏씠?ㅻ줈 異붿젙???곕쭚 湲덉쑖?뚮뱷 */
  projectedYearEndGross: number;
  /** ?섏씠??湲곗? ?꾧퀎 ?꾨떖 ?덉긽??(YYYY-MM-DD). ?대? 珥덇낵?덇굅???ы빐 ?덉뿉 ?꾨떖 ?꾨쭩 ?놁쑝硫?null */
  projectedThresholdDate: string | null;
  /** ?몄쟾 ?섏궛(grossUp) ?곸슜 ?щ? */
  grossUpApplied: boolean;
  /** ?낅젰 湲덉븸(?명썑 ?낃툑??媛?? YTD ?⑷퀎 ???섏궛 ??(?? */
  netTotal: number;
  /** ?꾧퀎 鍮꾧탳????YTD ?⑷퀎 ???섏궛 ??(?? = ytdGross). grossUp=false硫?netTotal怨?媛숇떎 */
  grossTotal: number;
}

function dayOfYear(today: string): number {
  const d = parseIsoLocal(today);
  if (!d) return 1;
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.floor((d.getTime() - start.getTime()) / 86_400_000) + 1;
}

function daysInYear(year: number): number {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/**
 * 醫낇빀怨쇱꽭 ?꾧퀎(2,000留? ?ㅼ떆媛?異붿쟻 ??"?ы빐 ?쇰쭏 諛쏆븯怨? ?꾧퀎源뚯? ?쇰쭏 ?⑥븯怨? ?대?濡쒕㈃ ?몄젣 ?섎뒗吏".
 * 諛곕떦 ?섎졊 ??대컢/洹쒕え 議곗젅(?덉꽭) ?섏궗寃곗젙?? today(KST YYYY-MM-DD)???몄텧遺媛 二쇱엯(?뚯뒪??寃곗젙??.
 */
export function buildComprehensiveTaxTracker(
  ledger: LedgerEntry[],
  today: string,
  fxRate?: number | null,
  options?: TaxComputeOptions
): ComprehensiveTaxTracker {
  const year = parseIsoLocal(today)?.getFullYear() ?? new Date().getFullYear();
  const yearStr = String(year);
  const grossUp = options?.grossUp === true;
  const toKrw = (e: LedgerEntry) => toKrwByRate(e.amount, e.currency, fxRate);

  let dividendGross = 0;
  let interestGross = 0;
  let netTotal = 0;
  for (const e of ledger) {
    if (e.kind !== "income" || !e.date || e.date < `${yearStr}-01-01` || e.date > today) continue;
    if (isDividendEntry(e)) { dividendGross += taxableKrw(e, fxRate, grossUp, true); netTotal += toKrw(e); continue; }
    if (isInterestEntry(e)) { interestGross += taxableKrw(e, fxRate, grossUp, false); netTotal += toKrw(e); }
  }

  const ytdGross = dividendGross + interestGross;
  const threshold = COMPREHENSIVE_TAX_THRESHOLD;
  const remainingToThreshold = Math.max(0, threshold - ytdGross);
  const exceeded = ytdGross > threshold;

  const elapsed = Math.max(1, dayOfYear(today));
  const totalDays = daysInYear(year);
  const dailyPace = ytdGross / elapsed;
  const projectedYearEndGross = dailyPace * totalDays;

  let projectedThresholdDate: string | null = null;
  if (!exceeded && dailyPace > 0) {
    const daysToHit = Math.ceil(threshold / dailyPace);
    if (daysToHit <= totalDays) {
      projectedThresholdDate = addDaysToIso(`${yearStr}-01-01`, daysToHit - 1);
    }
  }

  return {
    year,
    ytdGross,
    dividendGross,
    interestGross,
    threshold,
    remainingToThreshold,
    exceeded,
    pctOfThreshold: threshold > 0 ? ytdGross / threshold : 0,
    projectedYearEndGross,
    projectedThresholdDate,
    grossUpApplied: grossUp,
    netTotal,
    grossTotal: ytdGross
  };
}
