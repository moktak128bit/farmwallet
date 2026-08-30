/**
 * 금액 파싱·포맷 유틸. 전체 앱에서 동일한 정책을 쓰도록 중앙화.
 *
 * 정책:
 * - 숫자만 유지 (콤마·원 등 장식 제거).
 * - 과학표기(1e3) 입력은 `[^\d]` 필터로 자연스럽게 차단됨.
 * - 다중 소수점("1.2.3")은 첫 번째 점만 유지하고 나머지 자리를 이어 붙임.
 * - NaN/Infinity는 0 반환.
 * - allowDecimal=true는 외화·수수료 등 소수점이 실제 필요한 경우에만.
 * - maxDecimals로 자릿수 제한 (기본 2). 암호화폐 수량 등은 8을 넘긴다.
 * - allowNegative=true는 부채·현금 조정처럼 음수가 정상인 항목에만.
 *   (수입/지출 금액은 kind로 방향을 구분하므로 음수를 받지 않는다)
 */

interface ParseAmountOptions {
  /** 소수점 허용 (USD 이체 등). 기본 false — 정수만 */
  allowDecimal?: boolean;
  /** 허용 소수 자릿수. allowDecimal=true일 때만 의미 있음. 기본 2 */
  maxDecimals?: number;
  /** 음수 허용 (부채·현금 조정 등). 기본 false */
  allowNegative?: boolean;
}

/** 맨 앞 마이너스만 부호로 인정하고 나머지에서 제거 */
function splitSign(raw: string, allowNegative: boolean): { negative: boolean; rest: string } {
  const trimmed = raw.trimStart();
  const negative = allowNegative && trimmed.startsWith("-");
  return { negative, rest: raw.replace(/-/g, "") };
}

/** 소수점이 여러 개인 입력을 "정수부.소수부" 한 쌍으로 정리 */
function splitDecimal(raw: string, maxDecimals: number): { int: string; frac: string | null } {
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned) return { int: "", frac: null };
  const parts = cleaned.split(".");
  if (parts.length === 1) return { int: parts[0], frac: null };
  return { int: parts[0], frac: parts.slice(1).join("").slice(0, Math.max(0, maxDecimals)) };
}

/**
 * 문자열 → 금액(number). 실패 시 0.
 */
export function parseAmount(value: string | null | undefined, options?: ParseAmountOptions): number {
  if (!value) return 0;
  const allowNegative = options?.allowNegative ?? false;
  const { negative, rest } = splitSign(String(value), allowNegative);
  const sign = negative ? -1 : 1;

  if (options?.allowDecimal) {
    const { int, frac } = splitDecimal(rest, options?.maxDecimals ?? 2);
    if (!int && !frac) return 0;
    const parsed = parseFloat(frac != null ? `${int || "0"}.${frac || "0"}` : int);
    return Number.isFinite(parsed) && parsed >= 0 ? sign * parsed : 0;
  }

  const numeric = rest.replace(/[^\d]/g, "");
  if (!numeric) return 0;
  const n = Number(numeric);
  return Number.isFinite(n) && n >= 0 ? sign * n : 0;
}

const withThousands = (intPart: string): string => intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * 입력용 포맷터. 천 단위 콤마, allowDecimal 시 maxDecimals(기본 2)자리까지.
 * (가계부/계좌/주식 입력 필드의 onChange에서 사용)
 *
 * 입력 중인 상태를 지우지 않는다 — "1234."처럼 끝에 점만 찍힌 값도,
 * allowNegative에서 "-"만 친 상태도 그대로 살려 둔다.
 */
export function formatAmount(value: string | null | undefined, options?: ParseAmountOptions): string {
  if (!value) return "";
  const allowNegative = options?.allowNegative ?? false;
  const { negative, rest } = splitSign(String(value), allowNegative);
  const prefix = negative ? "-" : "";

  if (options?.allowDecimal) {
    const { int, frac } = splitDecimal(rest, options?.maxDecimals ?? 2);
    if (!int && frac == null) return prefix;
    if (frac == null) return prefix + withThousands(int);
    return `${prefix}${withThousands(int)}.${frac}`;
  }

  const numeric = rest.replace(/[^\d]/g, "");
  if (!numeric) return prefix;
  const n = Number(numeric);
  if (!Number.isFinite(n)) return "";
  return prefix + Math.round(n).toLocaleString();
}
