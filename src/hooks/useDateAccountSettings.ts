/**
 * 데이트통장 계좌 — 장부(AppData.dateAccountId) 단일 소스. 시트와 함께 동기화된다.
 * (예전엔 기기 localStorage(fw-date-account-id)에만 있어 새 기기에서 "선택 안 함"이 되고
 *  리포트·인사이트 실질 지출에서 50% 분담이 빠졌다. 레거시 값은 dataService.migrateLegacyDateAccount가 1회 이관.)
 */
import { useAppStore } from "../store/appStore";

/** 데이트통장 계좌 id. 미설정·"선택 안 함"이면 null */
export function useDateAccountId(): string | null {
  return useAppStore((s) => s.data.dateAccountId) || null;
}

/** 장부에 데이트통장 설정이 아예 없는지(undefined) — "선택 안 함"("")과 구분해 경고에 쓴다 */
export function useDateAccountUnset(): boolean {
  return useAppStore((s) => s.data.dateAccountId === undefined);
}
