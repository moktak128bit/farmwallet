import type { AccountType } from "../../types";

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  checking: "입출금",
  savings: "저축",
  card: "신용카드",
  securities: "증권",
  crypto: "암호화폐",
  other: "기타",
};

export function sanitizeSignedNumericInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9+\-.,]/g, "");
  if (!cleaned) return "";
  const first = cleaned[0];
  const sign = first === "+" || first === "-" ? first : "";
  const body = (sign ? cleaned.slice(1) : cleaned).replace(/[+-]/g, "");
  return `${sign}${body}`;
}

export function parseSignedAmount(raw: string): number | null {
  const normalized = raw.trim().replace(/,/g, "");
  if (!normalized) return null;
  if (!/^[+-]?\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}
