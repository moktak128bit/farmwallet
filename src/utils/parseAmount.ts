/**
 * 금액 파싱·포맷 유틸. 전체 앱에서 동일한 정책을 쓰도록 중앙화.
 *
 * 정책:
 * - 숫자만 유지 (콤마·원 등 장식 제거). 음수는 허용하지 않음 (수입/지출 구분은 kind로).
 * - 과학표기(1e3) 입력은 `[^\d]` 필터로 자연스럽게 차단됨.
 * - 다중 소수점("1.2.3")은 첫 번째 점만 유지하고 나머지 자리를 이어 붙임.
 * - NaN/Infinity는 0 반환.
 * - allowDecimal=true는 외화 환전·이체 등 소수점이 실제 필요한 경우에만.
 */

export interface ParseAmountOptions {
  /** 소수점 허용 (USD 이체 등). 기본 false — 정수만 */
  allowDecimal?: boolean;
}

/**
 * 문자열 → 금액(number). 실패 시 0.
 */
export function parseAmount(value: string | null | undefined, options?: ParseAmountOptions): number {
  if (!value) return 0;
  const allowDecimal = options?.allowDecimal ?? false;
  if (allowDecimal) {
    const cleaned = String(value).replace(/[^\d.]/g, "");
    if (!cleaned) return 0;
    const parts = cleaned.split(".");
    const safe = parts.length > 1 ? `${parts[0]}.${parts.slice(1).join("")}` : cleaned;
    const parsed = parseFloat(safe);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }
  const numeric = String(value).replace(/[^\d]/g, "");
  if (!numeric) return 0;
  const n = Number(numeric);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * 입력용 포맷터. 천 단위 콤마, allowDecimal 시 소수점 2자리까지.
 * (가계부/계좌 입력 필드의 onChange에서 사용)
 */
export function formatAmount(value: string | null | undefined, options?: ParseAmountOptions): string {
  if (!value) return "";
  const allowDecimal = options?.allowDecimal ?? false;
  if (allowDecimal) {
    const cleaned = String(value).replace(/[^\d.]/g, "");
    if (!cleaned) return "";
    const parts = cleaned.split(".");
    if (parts.length > 1) {
      return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + parts.slice(1).join("").slice(0, 2);
    }
    return parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  const numeric = String(value).replace(/[^\d]/g, "");
  if (!numeric) return "";
  const n = Number(numeric);
  if (!Number.isFinite(n)) return "";
  return Math.round(n).toLocaleString();
}
