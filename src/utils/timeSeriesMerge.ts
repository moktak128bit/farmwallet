/**
 * Gist 충돌 해소용 날짜키 시계열 date-union 병합 — 순수 모듈.
 *
 * 배경: toUserDataJson(dataService)은 historicalDailyFx·benchmarkDailyCloses·marketEnvSnapshots를
 * Gist payload에 포함하고, 각 기기의 자동 적립(useDailyFxRecorder·useBenchmarkRecorder·
 * useMarketEnvSnapshotRecorder)이 payload를 바꿔 push를 유발한다. 두 기기가 서로 다른 날 앱을 열면
 * 양쪽 모두 dirty → 충돌 모달 → '원격 적용'이든 '로컬 강제 푸시'든 한쪽이 쌓은 append-only
 * 시계열이 사라졌다. 이 모듈은 충돌 해소 직전에 **날짜 키 시계열만** 양쪽 합집합으로 만든다.
 *
 * 규칙:
 *  - 합치는 대상은 날짜(+종목) 키의 append-only 시계열 3종뿐. ledger/trades/accounts 같은
 *    id 키 배열은 **절대 병합하지 않는다** — 3-way(공통 조상) 없이는 삭제 vs 미동기화를 구분할 수
 *    없어 지운 항목이 되살아나는 등 위험하다.
 *  - 같은 키(날짜 / 종목|날짜)가 양쪽에 있으면 **base(사용자가 선택한 쪽)가 이긴다.** other는
 *    base에 없는 키만 채운다(gap-fill). 근거: (1) 환율·지수 종가에는 갱신 시각이 없어 '더 최근
 *    갱신'을 판정할 수 없고, (2) marketEnvSnapshots의 recordedAt은 소급 박제(backfill)가 실시간
 *    박제보다 늦을 수 있어 '늦은 쪽이 좋은 값'이 아니며, (3) 사용자가 모달에서 고른 쪽을 존중하는
 *    것이 가장 예측 가능하고 결정적(idempotent)이다.
 *  - 결과 형태는 각 시계열의 기존 정책과 동일: historicalDailyFx = date 오름차순·날짜당 1건
 *    (utils/dailyFx upsertDailyFx), benchmarkDailyCloses = ticker→date 오름차순·종목|날짜당 1건
 *    (utils/portfolioPerformance upsertBenchmarkCloses), marketEnvSnapshots = date 오름차순·날짜당
 *    1건(services/dataNormalizers normalizeMarketEnvSnapshots). dailyFx의 180일 월말 압축은 여기서
 *    다시 적용하지 않는다 — 다음 upsertDailyFx 호출이 전체를 재압축하므로 합집합이 일시적으로
 *    일별 점을 더 갖는 것은 무해(정보가 많을 뿐)하다.
 *  - 손상 항목(날짜 형식 불일치·0 이하 값)은 양쪽 모두에서 걸러낸다(각 normalizer와 동일 기준).
 */
import type { HistoricalDailyClose, HistoricalDailyFx, MarketEnvSnapshot } from "../types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(d: unknown): d is string {
  return typeof d === "string" && DATE_RE.test(d);
}

function isPositive(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

/** 일별 환율 union — date 키, base 우선, date 오름차순. */
export function mergeDailyFx(
  base: readonly HistoricalDailyFx[] | undefined,
  other: readonly HistoricalDailyFx[] | undefined
): HistoricalDailyFx[] {
  const map = new Map<string, HistoricalDailyFx>();
  // other를 먼저 넣고 base로 덮어써 base 우선을 보장 (같은 쪽 내부 중복은 뒤 항목이 이김 — upsert와 동일)
  for (const f of other ?? []) {
    if (!f || !isValidDate(f.date) || !isPositive(f.rate)) continue;
    map.set(f.date, { date: f.date, rate: f.rate });
  }
  for (const f of base ?? []) {
    if (!f || !isValidDate(f.date) || !isPositive(f.rate)) continue;
    map.set(f.date, { date: f.date, rate: f.rate });
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const normTicker = (t: unknown): string => (typeof t === "string" ? t.trim().toUpperCase() : "");

/** 벤치마크 일별 종가 union — ticker|date 키, base 우선, ticker→date 오름차순. */
export function mergeBenchmarkCloses(
  base: readonly HistoricalDailyClose[] | undefined,
  other: readonly HistoricalDailyClose[] | undefined
): HistoricalDailyClose[] {
  const map = new Map<string, HistoricalDailyClose>();
  const put = (c: HistoricalDailyClose | null | undefined) => {
    if (!c) return;
    const ticker = normTicker(c.ticker);
    if (!ticker || !isValidDate(c.date) || !isPositive(c.close)) return;
    map.set(`${ticker}|${c.date}`, { ...c, ticker });
  };
  for (const c of other ?? []) put(c);
  for (const c of base ?? []) put(c);
  return [...map.values()].sort(
    (a, b) => a.ticker.localeCompare(b.ticker) || a.date.localeCompare(b.date)
  );
}

/** 반월 시세 환경 스냅샷 union — date 키, base 우선(박제 불변 원칙), date 오름차순. */
export function mergeMarketEnvSnapshots(
  base: readonly MarketEnvSnapshot[] | undefined,
  other: readonly MarketEnvSnapshot[] | undefined
): MarketEnvSnapshot[] {
  const map = new Map<string, MarketEnvSnapshot>();
  const put = (s: MarketEnvSnapshot | null | undefined) => {
    if (!s || !isValidDate(s.date) || !isPositive(s.fxRate)) return;
    map.set(s.date, s);
  };
  for (const s of other ?? []) put(s);
  for (const s of base ?? []) put(s);
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Gist payload 안에서 union 대상이 되는 시계열 필드 묶음 (AppData의 부분집합) */
interface GistTimeSeriesFields {
  historicalDailyFx?: HistoricalDailyFx[];
  benchmarkDailyCloses?: HistoricalDailyClose[];
  marketEnvSnapshots?: MarketEnvSnapshot[];
}

interface TimeSeriesMergeResult {
  fields: Required<GistTimeSeriesFields>;
  /** base에 없어서 other에서 채워진 항목 수(3종 합계). 0이면 base만으로 충분 → 호출부가 원본 유지 가능 */
  filledFromOther: number;
}

/** 3종 시계열을 한 번에 union. base 우선. */
export function mergeTimeSeriesFields(
  base: GistTimeSeriesFields,
  other: GistTimeSeriesFields
): TimeSeriesMergeResult {
  const fx = mergeDailyFx(base.historicalDailyFx, other.historicalDailyFx);
  const bench = mergeBenchmarkCloses(base.benchmarkDailyCloses, other.benchmarkDailyCloses);
  const env = mergeMarketEnvSnapshots(base.marketEnvSnapshots, other.marketEnvSnapshots);

  // base 단독 결과(정규화 후)와 비교해 other가 실제로 채운 키 수 계산
  const fxBaseOnly = mergeDailyFx(base.historicalDailyFx, undefined).length;
  const benchBaseOnly = mergeBenchmarkCloses(base.benchmarkDailyCloses, undefined).length;
  const envBaseOnly = mergeMarketEnvSnapshots(base.marketEnvSnapshots, undefined).length;
  const filledFromOther =
    fx.length - fxBaseOnly + (bench.length - benchBaseOnly) + (env.length - envBaseOnly);

  return {
    fields: { historicalDailyFx: fx, benchmarkDailyCloses: bench, marketEnvSnapshots: env },
    filledFromOther,
  };
}

function pickSeriesFields(raw: unknown): GistTimeSeriesFields {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  return {
    historicalDailyFx: Array.isArray(r.historicalDailyFx) ? (r.historicalDailyFx as HistoricalDailyFx[]) : undefined,
    benchmarkDailyCloses: Array.isArray(r.benchmarkDailyCloses)
      ? (r.benchmarkDailyCloses as HistoricalDailyClose[])
      : undefined,
    marketEnvSnapshots: Array.isArray(r.marketEnvSnapshots)
      ? (r.marketEnvSnapshots as MarketEnvSnapshot[])
      : undefined,
  };
}

interface GistPayloadMergeResult {
  /** 시계열만 union된 base payload JSON. other가 채운 게 없거나 파싱 실패면 baseJson 원본 그대로 */
  json: string;
  /** other에서 채워진 항목 수. 0이면 json === baseJson */
  filledFromOther: number;
  /** 시계열 필드(typed) — 호출부가 로컬 스토어에도 같은 union을 반영할 때 사용 */
  fields: Required<GistTimeSeriesFields> | null;
}

/**
 * Gist payload(JSON 문자열) 수준 병합: baseJson의 모든 필드는 그대로 두고 3종 시계열만
 * otherJson과 union한다. id 키 컬렉션은 base의 것이 그대로 남는다.
 * 어느 한쪽이라도 JSON 파싱에 실패하면 baseJson을 건드리지 않고 돌려준다(안전 우선).
 */
export function mergeGistPayloadTimeSeries(baseJson: string, otherJson: string): GistPayloadMergeResult {
  let baseRaw: unknown;
  let otherRaw: unknown;
  try {
    baseRaw = JSON.parse(baseJson);
    otherRaw = JSON.parse(otherJson);
  } catch {
    return { json: baseJson, filledFromOther: 0, fields: null };
  }
  if (!baseRaw || typeof baseRaw !== "object" || Array.isArray(baseRaw)) {
    return { json: baseJson, filledFromOther: 0, fields: null };
  }
  const merged = mergeTimeSeriesFields(pickSeriesFields(baseRaw), pickSeriesFields(otherRaw));
  if (merged.filledFromOther === 0) {
    // 바뀐 게 없으면 재직렬화하지 않는다 — 해시·payload 비교(lastPushedPayloadRef)가 흔들리지 않게
    return { json: baseJson, filledFromOther: 0, fields: merged.fields };
  }
  const out: Record<string, unknown> = { ...(baseRaw as Record<string, unknown>) };
  out.historicalDailyFx = merged.fields.historicalDailyFx;
  out.benchmarkDailyCloses = merged.fields.benchmarkDailyCloses;
  out.marketEnvSnapshots = merged.fields.marketEnvSnapshots;
  return { json: JSON.stringify(out), filledFromOther: merged.filledFromOther, fields: merged.fields };
}
