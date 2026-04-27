import type { LedgerEntry, StockTrade } from "../types";

/**
 * 데이터 적재 경계에서 사용하는 엔트리 단위 검증.
 *
 * 목적: 손상된 데이터(localStorage 손상, gist sync 실패, 외부 import 누락 등)가
 * 계산 로직에 들어가 NaN을 전파하지 않도록 차단.
 *
 * 정책: **손상된 엔트리는 조용히 폐기**하고 정상 엔트리는 통과.
 *  - 사용자 데이터를 임의로 수정하지 않음 (값 보정 X, 폐기 O)
 *  - 폐기 건수를 함께 반환해 호출 측에서 console.warn 등으로 알림 가능
 *
 * 개별 폼 입력 검증은 utils/validation.ts (UX 메시지 포함) 별도 사용.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isValidIsoDate(v: unknown): v is string {
  return typeof v === "string" && ISO_DATE_RE.test(v);
}

export interface SanitizeResult<T> {
  clean: T[];
  dropped: number;
  /** 디버깅용 — 폐기된 엔트리의 raw 값 (대량 데이터 시 비활성화 권장). 최대 10개 보관. */
  droppedSamples?: unknown[];
}

/**
 * LedgerEntry 검증 — 다음 필드 모두 정상이어야 통과:
 *  - id: 비어있지 않은 문자열
 *  - date: ISO yyyy-mm-dd 패턴
 *  - kind: "income"|"expense"|"transfer"|"savings_expense" (LedgerKind 중 하나)
 *  - amount: 유한 숫자
 *  - description: 문자열 (빈 문자열 허용)
 *  - category: 문자열 (빈 문자열 허용)
 */
export function sanitizeLedger(raw: unknown[]): SanitizeResult<LedgerEntry> {
  const clean: LedgerEntry[] = [];
  const droppedSamples: unknown[] = [];
  let dropped = 0;
  const validKinds = new Set(["income", "expense", "transfer"]);

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      dropped++;
      if (droppedSamples.length < 10) droppedSamples.push(item);
      continue;
    }
    const l = item as Record<string, unknown>;
    if (
      !isNonEmptyString(l.id) ||
      !isValidIsoDate(l.date) ||
      !validKinds.has(l.kind as string) ||
      !isFiniteNumber(l.amount) ||
      typeof l.description !== "string" ||
      typeof l.category !== "string"
    ) {
      dropped++;
      if (droppedSamples.length < 10) droppedSamples.push(l);
      continue;
    }
    clean.push(l as unknown as LedgerEntry);
  }
  return { clean, dropped, droppedSamples: dropped > 0 ? droppedSamples : undefined };
}

/**
 * StockTrade 검증 — 다음 필드 모두 정상이어야 통과:
 *  - id, accountId, ticker, name: 비어있지 않은 문자열
 *  - date: ISO yyyy-mm-dd
 *  - side: "buy" | "sell"
 *  - quantity, price, totalAmount, fee, cashImpact: 유한 숫자
 *  - fxRateAtTrade: 있다면 유한 숫자
 */
export function sanitizeTrades(raw: unknown[]): SanitizeResult<StockTrade> {
  const clean: StockTrade[] = [];
  const droppedSamples: unknown[] = [];
  let dropped = 0;

  for (const item of raw) {
    if (!item || typeof item !== "object") {
      dropped++;
      if (droppedSamples.length < 10) droppedSamples.push(item);
      continue;
    }
    const t = item as Record<string, unknown>;
    if (
      !isNonEmptyString(t.id) ||
      !isNonEmptyString(t.accountId) ||
      !isNonEmptyString(t.ticker) ||
      !isNonEmptyString(t.name) ||
      !isValidIsoDate(t.date) ||
      (t.side !== "buy" && t.side !== "sell") ||
      !isFiniteNumber(t.quantity) ||
      !isFiniteNumber(t.price) ||
      !isFiniteNumber(t.totalAmount) ||
      !isFiniteNumber(t.fee) ||
      !isFiniteNumber(t.cashImpact) ||
      (t.fxRateAtTrade !== undefined && !isFiniteNumber(t.fxRateAtTrade))
    ) {
      dropped++;
      if (droppedSamples.length < 10) droppedSamples.push(t);
      continue;
    }
    clean.push(t as unknown as StockTrade);
  }
  return { clean, dropped, droppedSamples: dropped > 0 ? droppedSamples : undefined };
}
