/**
 * 충돌 가능성이 사실상 없는 unique ID 생성.
 *
 * - 우선순위: crypto.randomUUID (모든 모던 브라우저, secure context)
 * - 폴백: Date.now() + 카운터 + Math.random — 같은 ms 내 다중 호출도 카운터로 분리
 *
 * 기존 `${Date.now()}${Math.random()}` 패턴은 같은 밀리초·동일 시드에서 충돌 가능
 * (Birthday paradox 기준 수만건 입력 시 위험). UUID v4는 122-bit 엔트로피로 사실상 안전.
 */

let _seq = 0;

function fallbackId(): string {
  _seq = (_seq + 1) % 0xffff;
  const seqHex = _seq.toString(16).padStart(4, "0");
  const rand = Math.random().toString(16).slice(2, 10);
  return `${Date.now().toString(36)}${seqHex}${rand}`;
}

/** 접두사 없는 raw UUID-like 문자열 */
export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try { return crypto.randomUUID(); } catch { /* secure context 외 */ }
  }
  return fallbackId();
}

/** 접두사가 필요한 도메인용 (예: "L", "T", "R") */
export function newIdWithPrefix(prefix: string): string {
  return `${prefix}-${newId()}`;
}
