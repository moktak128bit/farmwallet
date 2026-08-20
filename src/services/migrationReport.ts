/**
 * 스키마 마이그레이션 diff 리포트 (순수 함수 + 소형 localStorage 기록).
 *
 * loadData가 migrateBySchema로 저장 데이터를 v{from}→v{to}로 올릴 때,
 *  - 파싱 원본을 라벨 스냅샷(saveSafetySnapshot)으로 보존하고
 *  - 원본 vs 마이그레이션 결과의 차이를 여기서 계산해 STORAGE_KEYS.LAST_MIGRATION_REPORT에 남긴다.
 * 설정 > 백업의 '마지막 마이그레이션' 카드(MigrationReportCard)가 읽기 전용으로 보여준다.
 *
 * 설계 메모
 *  - 입력은 신뢰하지 않는다(unknown): 손상 입력(배열 아님·항목이 객체 아님·amount NaN)도 throw 없이 집계.
 *  - 항목 키는 `id`(문자열) 우선, 없으면 JSON 직렬화 문자열 — id 없는 컬렉션은 added/removed만 잡히고 changed=0.
 *  - 금액 합계는 통화 환산 없이 원 값 그대로(USD 항목 포함). 회계 수치가 아니라 "마이그레이션이 금액을 건드렸는가"
 *    전/후 비교용이므로 양쪽 동일 기준이면 충분하다.
 *  - 리포트는 소형이어야 한다(localStorage): id 샘플은 컬렉션당 최대 ID_SAMPLE_LIMIT개.
 */
import { STORAGE_KEYS } from "../constants/config";

/** diff 대상 컬렉션 — AppData 배열 필드 중 사용자 입력 데이터(캐시·시계열 제외). */
export const DIFF_COLLECTIONS = [
  "accounts",
  "ledger",
  "trades",
  "loans",
  "recurringExpenses",
  "budgetGoals",
  "customSymbols",
  "ledgerTemplates",
  "stockPresets",
  "targetPortfolios",
  "workoutWeeks",
  "workoutRoutines",
  "customExercises",
  "isaPortfolio"
] as const;

export type DiffCollectionName = (typeof DIFF_COLLECTIONS)[number];

const ID_SAMPLE_LIMIT = 10;

interface CollectionDiff {
  before: number;
  after: number;
  added: number;
  removed: number;
  /** 같은 키(id)인데 내용이 달라진 항목 수 */
  changed: number;
  /** 추가/제거된 id 샘플(최대 ID_SAMPLE_LIMIT). id 없는 컬렉션은 빈 배열. */
  addedIds: string[];
  removedIds: string[];
}

interface BeforeAfter {
  before: number;
  after: number;
}

interface MigrationDiff {
  collections: Record<DiffCollectionName, CollectionDiff>;
  /** kind별 ledger amount 합계 전/후 (kind 미상은 "unknown") */
  ledgerAmountByKind: Record<string, BeforeAfter>;
  /** ledger amount 총합 전/후 (kind 무관) */
  ledgerAmountTotal: BeforeAfter;
  /** trades totalAmount 합계 전/후 */
  tradesTotalAmount: BeforeAfter;
  /** 어떤 컬렉션이든 added/removed/changed > 0 이거나 합계가 달라졌으면 true */
  hasChanges: boolean;
}

interface MigrationReport {
  fromVersion: number;
  toVersion: number;
  /** 기록 시각 (ISO instant) */
  at: string;
  diff: MigrationDiff;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finiteOrZero(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 항목 비교용 안정 직렬화 (키 정렬) — 순환 참조/직렬화 실패는 타입 문자열로 대체 */
function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(v as Record<string, unknown>).sort()) {
          sorted[key] = (v as Record<string, unknown>)[key];
        }
        return sorted;
      }
      return v;
    }) ?? String(value);
  } catch {
    return `[unserializable:${typeof value}]`;
  }
}

/** 항목 키: 문자열 id가 있으면 `id:…`, 없으면 직렬화 문자열 (동일 내용 중복은 같은 키로 합쳐짐) */
function itemKey(item: unknown): { key: string; hasId: boolean } {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const id = (item as Record<string, unknown>).id;
    if (typeof id === "string" && id.length > 0) return { key: `id:${id}`, hasId: true };
  }
  return { key: `json:${stableStringify(item)}`, hasId: false };
}

function diffCollection(beforeArr: unknown[], afterArr: unknown[]): CollectionDiff {
  // 같은 키가 여러 번 나오면(중복 id) 건수로 비교 — 키별 출현 횟수와 마지막 직렬화를 보관
  const index = (arr: unknown[]) => {
    const map = new Map<string, { count: number; json: string; hasId: boolean }>();
    for (const item of arr) {
      const { key, hasId } = itemKey(item);
      const prev = map.get(key);
      if (prev) {
        prev.count += 1;
      } else {
        map.set(key, { count: 1, json: hasId ? stableStringify(item) : "", hasId });
      }
    }
    return map;
  };
  const b = index(beforeArr);
  const a = index(afterArr);

  let added = 0;
  let removed = 0;
  let changed = 0;
  const addedIds: string[] = [];
  const removedIds: string[] = [];

  for (const [key, av] of a) {
    const bv = b.get(key);
    if (!bv) {
      added += av.count;
      if (av.hasId && addedIds.length < ID_SAMPLE_LIMIT) addedIds.push(key.slice(3));
      continue;
    }
    if (av.count > bv.count) added += av.count - bv.count;
    else if (av.count < bv.count) removed += bv.count - av.count;
    if (av.hasId && av.json !== bv.json) changed += Math.min(av.count, bv.count);
  }
  for (const [key, bv] of b) {
    if (a.has(key)) continue;
    removed += bv.count;
    if (bv.hasId && removedIds.length < ID_SAMPLE_LIMIT) removedIds.push(key.slice(3));
  }

  return { before: beforeArr.length, after: afterArr.length, added, removed, changed, addedIds, removedIds };
}

function sumLedgerByKind(ledger: unknown[]): { byKind: Record<string, number>; total: number } {
  const byKind: Record<string, number> = {};
  let total = 0;
  for (const item of ledger) {
    const rec = asRecord(item);
    const kind = typeof rec.kind === "string" && rec.kind ? rec.kind : "unknown";
    const amount = finiteOrZero(rec.amount);
    byKind[kind] = (byKind[kind] ?? 0) + amount;
    total += amount;
  }
  return { byKind, total };
}

function sumTrades(trades: unknown[]): number {
  let total = 0;
  for (const item of trades) total += finiteOrZero(asRecord(item).totalAmount);
  return total;
}

/**
 * 두 AppData 형태 객체(마이그레이션 전/후)의 차이를 계산한다. 순수 함수 — 입력을 변형하지 않는다.
 * 입력이 객체가 아니거나 컬렉션이 배열이 아니면 빈 컬렉션으로 취급(throw 없음).
 */
export function diffAppData(before: unknown, after: unknown): MigrationDiff {
  const b = asRecord(before);
  const a = asRecord(after);

  const collections = {} as Record<DiffCollectionName, CollectionDiff>;
  let hasChanges = false;
  for (const name of DIFF_COLLECTIONS) {
    const d = diffCollection(asArray(b[name]), asArray(a[name]));
    collections[name] = d;
    if (d.added > 0 || d.removed > 0 || d.changed > 0) hasChanges = true;
  }

  const lb = sumLedgerByKind(asArray(b.ledger));
  const la = sumLedgerByKind(asArray(a.ledger));
  const ledgerAmountByKind: Record<string, BeforeAfter> = {};
  for (const kind of new Set([...Object.keys(lb.byKind), ...Object.keys(la.byKind)])) {
    const entry = { before: lb.byKind[kind] ?? 0, after: la.byKind[kind] ?? 0 };
    ledgerAmountByKind[kind] = entry;
    if (entry.before !== entry.after) hasChanges = true;
  }
  const ledgerAmountTotal = { before: lb.total, after: la.total };
  const tradesTotalAmount = { before: sumTrades(asArray(b.trades)), after: sumTrades(asArray(a.trades)) };
  if (ledgerAmountTotal.before !== ledgerAmountTotal.after) hasChanges = true;
  if (tradesTotalAmount.before !== tradesTotalAmount.after) hasChanges = true;

  return { collections, ledgerAmountByKind, ledgerAmountTotal, tradesTotalAmount, hasChanges };
}

/** 마이그레이션 직전 원본 스냅샷의 라벨 — loadData(저장)와 MigrationReportCard(백업 목록에서 찾기)가 공유 */
export function migrationSnapshotLabel(fromVersion: number, toVersion: number): string {
  return `스키마 v${fromVersion}→v${toVersion} 마이그레이션 직전 원본`;
}

export function buildMigrationReport(
  fromVersion: number,
  toVersion: number,
  diff: MigrationDiff,
  at: string = new Date().toISOString()
): MigrationReport {
  return { fromVersion, toVersion, at, diff };
}

/** 리포트를 localStorage(LAST_MIGRATION_REPORT)에 기록. quota 등 실패는 false (로드를 막지 않는다). */
export function writeLastMigrationReport(report: MigrationReport): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(STORAGE_KEYS.LAST_MIGRATION_REPORT, JSON.stringify(report));
    return true;
  } catch (e) {
    console.warn("[FarmWallet] 마이그레이션 리포트 기록 실패", e);
    return false;
  }
}

function isBeforeAfter(v: unknown): v is BeforeAfter {
  const r = asRecord(v);
  return typeof r.before === "number" && typeof r.after === "number";
}

/** 기록된 마지막 마이그레이션 리포트. 없거나 형태가 깨졌으면 null. */
export function readLastMigrationReport(): MigrationReport | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.LAST_MIGRATION_REPORT);
    if (!raw) return null;
    const parsed = asRecord(JSON.parse(raw));
    const diff = asRecord(parsed.diff);
    if (
      typeof parsed.fromVersion !== "number" ||
      typeof parsed.toVersion !== "number" ||
      typeof parsed.at !== "string" ||
      !isBeforeAfter(diff.ledgerAmountTotal) ||
      !isBeforeAfter(diff.tradesTotalAmount)
    ) {
      return null;
    }
    const collections = asRecord(diff.collections);
    const safeCollections = {} as Record<DiffCollectionName, CollectionDiff>;
    for (const name of DIFF_COLLECTIONS) {
      const c = asRecord(collections[name]);
      safeCollections[name] = {
        before: finiteOrZero(c.before),
        after: finiteOrZero(c.after),
        added: finiteOrZero(c.added),
        removed: finiteOrZero(c.removed),
        changed: finiteOrZero(c.changed),
        addedIds: asArray(c.addedIds).filter((x): x is string => typeof x === "string"),
        removedIds: asArray(c.removedIds).filter((x): x is string => typeof x === "string")
      };
    }
    const byKindRaw = asRecord(diff.ledgerAmountByKind);
    const ledgerAmountByKind: Record<string, BeforeAfter> = {};
    for (const [kind, v] of Object.entries(byKindRaw)) {
      if (isBeforeAfter(v)) ledgerAmountByKind[kind] = { before: v.before, after: v.after };
    }
    return {
      fromVersion: parsed.fromVersion,
      toVersion: parsed.toVersion,
      at: parsed.at,
      diff: {
        collections: safeCollections,
        ledgerAmountByKind,
        ledgerAmountTotal: diff.ledgerAmountTotal,
        tradesTotalAmount: diff.tradesTotalAmount,
        hasChanges: diff.hasChanges === true
      }
    };
  } catch {
    return null;
  }
}
