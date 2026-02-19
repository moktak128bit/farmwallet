/**
 * 한국 시간(KST, UTC+9) 관련 유틸
 * LedgerView, DashboardView, SettingsView, backupService 등에서 공통 사용
 */

/**
 * 한국 시간 기준 현재 시각
 */
export function getKoreaTime(): Date {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 9 * 60 * 60000);
}

/**
 * 한국 시간 기준 이번 달 (YYYY-MM)
 * 가계부·대시보드 일치용
 */
export function getThisMonthKST(): string {
  const kst = getKoreaTime();
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * 한국 시간 기준 오늘 날짜 문자열 (yyyy-mm-dd)
 */
export function getTodayKST(): string {
  const kst = getKoreaTime();
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, "0");
  const d = String(kst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
