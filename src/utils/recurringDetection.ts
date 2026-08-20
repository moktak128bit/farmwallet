/**
 * 구독·반복결제 자동 감지 — 순수 모듈 (React 의존 없음).
 *
 * 가계부의 '실질 지출'(classifyLedgerFlow === "expense") 중 같은 상호(정규화 설명)+출금계좌로
 * 규칙적인 간격·비슷한 금액으로 반복되는 결제를 찾아 "반복지출로 등록" 후보를 만든다.
 *
 * 판정 규칙 (오탐 < 미탐 — 장보기·편의점처럼 잦지만 불규칙한 결제는 걸러야 한다):
 *   - 같은 키 안에서 금액을 ±10% 클러스터로 나눈 뒤 가장 큰 클러스터만 평가
 *     (쿠팡 와우 4,990원과 쿠팡 일반 구매가 한 상호에 섞여도 멤버십만 잡힌다)
 *   - 클러스터의 **서로 다른 날짜** ≥ 3회, 간격 중앙값이 월(28~33)/주(6~8)/연(360~370) 창 안,
 *     개별 간격의 2/3 이상이 느슨한 창(월 25~36 / 주 5~9 / 연 350~380) 안
 *   - 클러스터 이후 이어지는 꼬리(가격 인상 등)가 같은 간격으로 계속되면 status "amountChanged"
 *
 * 상태: stopped(마지막 발생 후 기준일 초과 미발생) > amountChanged > new(첫 발생 ≤ 90일) > active.
 * alreadyRegistered: 기존 RecurringExpense와 **제목/소분류 느슨 매칭** — matchesRecurringEntry(금액 ±1)는
 * 인상·환율 변동에 깨지므로 쓰지 않는다.
 *
 * USD 항목은 fxRate로 원화 환산해 비교·집계한다(컨벤션 5). 환율이 없으면 액면 그대로(대시보드 공통 정책).
 */
import type { CategoryPresets, LedgerEntry, Recurrence, RecurringExpense } from "../types";
import { classifyLedgerFlow } from "../features/dashboard/summaryMath";
import { normalizeMerchant } from "./categoryRecommendation";
import { toKrwByRate } from "./currency";
import { getMonthEndDate, parseIsoLocal, shiftMonth } from "./date";

export type RecurringCandidateStatus = "active" | "new" | "stopped" | "amountChanged";

export interface RecurringCandidate {
  /** 정규화 설명 + "|" + 출금계좌 id — 같은 결제 흐름의 식별자 */
  key: string;
  /** 표시용 상호 — 가장 최근 발생의 원문 설명(없으면 소분류) */
  label: string;
  fromAccountId?: string;
  /** 대표 분류(최빈) — 등록 prefill의 카테고리로 쓴다 */
  subCategory?: string;
  detailCategory?: string;
  currency: "KRW" | "USD";
  /** 클러스터 발생 횟수(서로 다른 날짜 기준, 꼬리 포함) */
  occurrences: number;
  /** 발생 간격 중앙값(일) */
  intervalDays: number;
  cadence: Recurrence;
  /** 클러스터 금액 중앙값(KRW 환산) */
  amountMedian: number;
  /** 마지막 발생 금액(KRW 환산) — amountChanged면 인상/인하 후 금액 */
  lastAmount: number;
  /** (lastAmount − amountMedian) / amountMedian × 100 */
  amountDriftPct: number;
  firstSeen: string;
  lastSeen: string;
  status: RecurringCandidateStatus;
  alreadyRegistered: boolean;
  /** 후보를 이룬 가계부 항목 id (UI에서 근거 표시·디버깅용) */
  entryIds: string[];
}

interface DetectRecurringOptions {
  /** 기준일(오늘)부터 몇 개월 전까지 볼지. 기본 12 */
  lookbackMonths?: number;
  fxRate?: number | null;
  categoryPresets?: CategoryPresets;
}

interface CadenceRule {
  cadence: Recurrence;
  /** 간격 중앙값 허용 창 */
  strict: [number, number];
  /** 개별 간격 허용 창 — 2/3 이상이 이 안에 있어야 한다 */
  loose: [number, number];
  /** 마지막 발생 후 이 일수를 넘기면 "stopped" */
  stoppedAfterDays: number;
}

const CADENCE_RULES: CadenceRule[] = [
  { cadence: "weekly", strict: [6, 8], loose: [5, 9], stoppedAfterDays: 14 },
  { cadence: "monthly", strict: [28, 33], loose: [25, 36], stoppedAfterDays: 45 },
  { cadence: "yearly", strict: [360, 370], loose: [350, 380], stoppedAfterDays: 400 },
];

const MIN_OCCURRENCES = 3;
const AMOUNT_TOLERANCE = 0.1; // ±10%
const NEW_WITHIN_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const withinTolerance = (amount: number, base: number): boolean =>
  base > 0 && Math.abs(amount - base) / base <= AMOUNT_TOLERANCE;

const daysBetween = (a: string, b: string): number | null => {
  const da = parseIsoLocal(a);
  const db = parseIsoLocal(b);
  if (!da || !db) return null;
  return Math.round((db.getTime() - da.getTime()) / DAY_MS);
};

const mode = (values: (string | undefined)[]): string | undefined => {
  const counts = new Map<string, number>();
  for (const v of values) {
    const t = (v || "").trim();
    if (!t) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  return best;
};

interface Occ {
  entry: LedgerEntry;
  date: string;
  amountKrw: number;
}

/** 날짜 오름차순 발생 목록에서 서로 다른 날짜만 뽑아 간격 배열 계산 (같은 날 이중 결제는 1회로) */
function distinctDates(occs: Occ[]): string[] {
  const out: string[] = [];
  for (const o of occs) if (out[out.length - 1] !== o.date) out.push(o.date);
  return out;
}

function intervalsOf(dates: string[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const d = daysBetween(dates[i - 1], dates[i]);
    if (d != null) out.push(d);
  }
  return out;
}

/** 간격 배열이 어떤 주기 규칙에 맞는지 — 중앙값 strict 창 + 개별 간격 2/3 이상 loose 창 */
function matchCadence(intervals: number[]): { rule: CadenceRule; medianDays: number } | null {
  if (intervals.length < MIN_OCCURRENCES - 1) return null;
  const med = median(intervals);
  for (const rule of CADENCE_RULES) {
    if (med < rule.strict[0] || med > rule.strict[1]) continue;
    const inLoose = intervals.filter((d) => d >= rule.loose[0] && d <= rule.loose[1]).length;
    if (inLoose / intervals.length >= 2 / 3) return { rule, medianDays: med };
  }
  return null;
}

/**
 * 금액 ±10% 클러스터링 — 금액 오름차순으로 훑으며 현재 클러스터 중앙값의 ±10% 안이면 편입.
 * 가장 큰 클러스터(동률이면 더 최근 것)를 반환.
 */
function largestAmountCluster(occs: Occ[]): Occ[] {
  const sorted = [...occs].sort((a, b) => a.amountKrw - b.amountKrw);
  const clusters: Occ[][] = [];
  let cur: Occ[] = [];
  for (const o of sorted) {
    if (cur.length === 0 || withinTolerance(o.amountKrw, median(cur.map((c) => c.amountKrw)))) {
      cur.push(o);
    } else {
      clusters.push(cur);
      cur = [o];
    }
  }
  if (cur.length) clusters.push(cur);
  let best: Occ[] = [];
  let bestLast = "";
  for (const c of clusters) {
    const last = c.reduce((m, o) => (o.date > m ? o.date : m), "");
    if (c.length > best.length || (c.length === best.length && last > bestLast)) {
      best = c;
      bestLast = last;
    }
  }
  return best.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 설명(없으면 소분류)을 정규화한 식별 키. 빈 문자열이면 감지 불가 */
function merchantKeyOf(l: LedgerEntry): string {
  const src = (l.description || "").trim() || (l.detailCategory || "").trim();
  return src ? normalizeMerchant(src) : "";
}

/**
 * 기존 반복지출과의 느슨 매칭 — 제목 정규화 동일/포함, 또는 제목이 후보 항목의 소분류/설명에 등장.
 * 금액은 보지 않는다(인상·환율 변동에 깨짐). 종료일이 지난 반복은 '등록됨'으로 치지 않는다.
 */
export function isCandidateRegistered(
  cand: Pick<RecurringCandidate, "key" | "label" | "detailCategory">,
  entries: Pick<LedgerEntry, "description" | "detailCategory">[],
  recurring: RecurringExpense[],
  todayIso: string
): boolean {
  const normKey = cand.key.split("|")[0];
  for (const r of recurring) {
    if (r.endDate && r.endDate < todayIso) continue;
    const title = (r.title || "").trim();
    if (!title) continue;
    const normTitle = normalizeMerchant(title);
    if (normTitle && normKey) {
      if (normTitle === normKey) return true;
      if (normTitle.length >= 2 && normKey.length >= 2 && (normKey.includes(normTitle) || normTitle.includes(normKey))) return true;
    }
    if (cand.detailCategory && cand.detailCategory === title) return true;
    if (cand.label && cand.label.includes(title)) return true;
    if (entries.some((e) => e.detailCategory === title || (e.description || "").includes(title))) return true;
  }
  return false;
}

/** 기준일 이전 lookbackMonths개월 시작일(YYYY-MM-DD) — 말일 클램프 */
function lookbackStart(todayIso: string, months: number): string {
  const m = shiftMonth(todayIso.slice(0, 7), -months);
  const day = todayIso.slice(8, 10);
  const end = getMonthEndDate(m);
  const candidate = `${m}-${day}`;
  return candidate > end ? end : candidate;
}

const STATUS_ORDER: Record<RecurringCandidateStatus, number> = { new: 0, amountChanged: 1, stopped: 2, active: 3 };

/**
 * 반복결제 후보 감지. 정렬: 신규 → 금액변경 → 해지 → 활성, 같은 상태면 금액 큰 순.
 */
export function detectRecurringCandidates(
  ledger: LedgerEntry[],
  recurring: RecurringExpense[],
  todayIso: string,
  options: DetectRecurringOptions = {}
): RecurringCandidate[] {
  const lookbackMonths = options.lookbackMonths ?? 12;
  const fxRate = options.fxRate ?? null;
  const startIso = lookbackStart(todayIso, lookbackMonths);

  // 1) 실질 지출만, 기간 내, 식별 가능한 상호 → 키별 그룹
  const groups = new Map<string, Occ[]>();
  for (const l of ledger) {
    if (!l.date || l.date < startIso || l.date > todayIso) continue;
    if (classifyLedgerFlow(l, options.categoryPresets) !== "expense") continue;
    const amount = Number(l.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const mk = merchantKeyOf(l);
    if (!mk) continue;
    const key = `${mk}|${l.fromAccountId ?? ""}`;
    const list = groups.get(key) ?? [];
    list.push({ entry: l, date: l.date, amountKrw: toKrwByRate(amount, l.currency, fxRate) });
    groups.set(key, list);
  }

  const out: RecurringCandidate[] = [];
  for (const [key, occsRaw] of groups) {
    if (occsRaw.length < MIN_OCCURRENCES) continue;
    const occs = occsRaw.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    // 2) 금액 클러스터 → 간격 검사
    const cluster = largestAmountCluster(occs);
    const clusterDates = distinctDates(cluster);
    if (clusterDates.length < MIN_OCCURRENCES) continue;
    const matched = matchCadence(intervalsOf(clusterDates));
    if (!matched) continue;
    const { rule, medianDays } = matched;

    const amountMedian = median(cluster.map((o) => o.amountKrw));
    const clusterLast = clusterDates[clusterDates.length - 1];

    // 3) 클러스터 이후 꼬리 — 같은 간격으로 이어지면 금액 변경으로 본다 (간격이 끊기면 무시)
    const tail: Occ[] = [];
    let prevDate = clusterLast;
    for (const o of occs) {
      if (o.date <= clusterLast) continue;
      if (o.date === prevDate) { tail.push(o); continue; }
      const gap = daysBetween(prevDate, o.date);
      if (gap == null || gap < rule.loose[0] || gap > rule.loose[1]) break;
      tail.push(o);
      prevDate = o.date;
    }
    const all = [...cluster, ...tail];
    const allDates = distinctDates(all);
    const lastOcc = all[all.length - 1];
    const lastSeen = allDates[allDates.length - 1];
    const firstSeen = allDates[0];
    const lastAmount = lastOcc.amountKrw;
    const amountDriftPct = amountMedian > 0 ? ((lastAmount - amountMedian) / amountMedian) * 100 : 0;

    // 4) 상태
    const sinceLast = daysBetween(lastSeen, todayIso) ?? 0;
    const sinceFirst = daysBetween(firstSeen, todayIso) ?? 0;
    let status: RecurringCandidateStatus = "active";
    if (sinceLast > rule.stoppedAfterDays) status = "stopped";
    else if (!withinTolerance(lastAmount, amountMedian)) status = "amountChanged";
    else if (sinceFirst <= NEW_WITHIN_DAYS) status = "new";

    const entries = all.map((o) => o.entry);
    const label =
      (lastOcc.entry.description || "").trim() || (lastOcc.entry.detailCategory || "").trim() || key.split("|")[0];
    const detailCategory = mode(entries.map((e) => e.detailCategory));
    const subCategory = mode(entries.map((e) => e.subCategory));
    const currency: "KRW" | "USD" = entries.filter((e) => e.currency === "USD").length * 2 > entries.length ? "USD" : "KRW";

    const cand: RecurringCandidate = {
      key,
      label,
      fromAccountId: lastOcc.entry.fromAccountId,
      subCategory,
      detailCategory,
      currency,
      occurrences: allDates.length,
      intervalDays: medianDays,
      cadence: rule.cadence,
      amountMedian,
      lastAmount,
      amountDriftPct,
      firstSeen,
      lastSeen,
      status,
      alreadyRegistered: false,
      entryIds: entries.map((e) => e.id),
    };
    cand.alreadyRegistered = isCandidateRegistered(cand, entries, recurring, todayIso);
    out.push(cand);
  }

  return out.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.amountMedian - a.amountMedian);
}

/**
 * 후보 → 반복지출 폼 prefill. 생성은 사용자가 폼에서 확인 후 "추가"를 눌러야 한다(자동 생성 금지).
 * - 금액: 마지막 발생 금액(KRW, 반올림) — 인상 후 금액이 앞으로의 고정비
 * - 시작일: 마지막 발생일 — 월간은 그 '일', 주간은 그 '요일', 연간은 그 '월/일'이 다음 주기 기준
 * - 카테고리: 대표 중분류(없으면 "구독비")
 */
export function candidateToRecurringPrefill(
  cand: RecurringCandidate
): Pick<RecurringExpense, "title" | "amount" | "category" | "frequency" | "startDate" | "fromAccountId"> {
  return {
    title: cand.label,
    amount: Math.round(cand.lastAmount),
    category: cand.subCategory || "구독비",
    frequency: cand.cadence,
    startDate: cand.lastSeen,
    fromAccountId: cand.fromAccountId,
  };
}

export const RECURRING_STATUS_LABEL: Record<RecurringCandidateStatus, string> = {
  new: "신규",
  amountChanged: "금액 변경",
  stopped: "해지 추정",
  active: "활성",
};

export const CADENCE_LABEL: Record<Recurrence, string> = { monthly: "매월", weekly: "매주", yearly: "매년" };
