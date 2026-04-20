/**
 * KST (UTC+9) date helpers.
 */

export function getKoreaTime(): Date {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 9 * 60 * 60000);
}

export function getThisMonthKST(): string {
  const kst = getKoreaTime();
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function getTodayKST(): string {
  const kst = getKoreaTime();
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, "0");
  const d = String(kst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 해당 연/월의 마지막 일자 (1-based month) */
export function getLastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** "YYYY-MM-DD" → 로컬 Date. 유효하지 않으면 null. */
export function parseIsoLocal(date: string): Date | null {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return null;
  const parsed = new Date(y, m - 1, d);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

/** Date → "YYYY-MM-DD" 로컬 포맷. TZ 이슈 없는 직렬화. */
export function formatIsoLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** "YYYY-MM-DD" 에 days 더한 결과 "YYYY-MM-DD". 유효하지 않으면 원본 반환. */
export function addDaysToIso(date: string, days: number): string {
  const parsed = parseIsoLocal(date);
  if (!parsed) return date;
  parsed.setDate(parsed.getDate() + days);
  return formatIsoLocal(parsed);
}

/** "YYYY-MM"에 offset(월) 더한 결과. 유효하지 않으면 원본 반환. */
export function shiftMonth(month: string, offset: number): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  const shifted = new Date(y, m - 1 + offset, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

/** "YYYY-MM"의 마지막 일자를 "YYYY-MM-DD"로 반환 */
export function getMonthEndDate(month: string): string {
  const [year, monthNum] = month.split("-").map(Number);
  const lastDay = new Date(year, monthNum, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

/** startMonth~endMonth 사이의 "YYYY-MM" 배열 (양 끝 포함) */
export function buildMonthRange(startMonth: string, endMonth: string): string[] {
  const result: string[] = [];
  let [year, month] = startMonth.split("-").map(Number);
  const [endYear, endMonthNum] = endMonth.split("-").map(Number);
  while (year < endYear || (year === endYear && month <= endMonthNum)) {
    result.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return result;
}
