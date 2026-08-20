/**
 * localStorage 사용량 측정 — 순수 함수.
 * navigator.storage.estimate()는 origin 전체(IndexedDB 포함, 수백 MB 기준)라 localStorage 5MB 압박을 감지하지 못한다.
 * 여기서는 키별 (key.length + value.length) * 2 바이트(UTF-16 코드 유닛 기준 근사)로 합산하고
 * 5MB(5 * 1024 * 1024) 대비 비율을 낸다. 브라우저마다 실제 한계·계산 방식이 조금씩 달라 근사치다.
 */
import type { STORAGE_KEYS } from "../constants/config";

export const LOCAL_STORAGE_LIMIT_BYTES = 5 * 1024 * 1024;
/** 80% 이상 경고, 95% 이상 위험 */
const STORAGE_WARNING_RATIO = 0.8;
const STORAGE_DANGER_RATIO = 0.95;

export type StorageUsageLevel = "ok" | "warning" | "danger";

interface StorageKeyUsage {
  /** STORAGE_KEYS의 속성 이름 (예: DATA, BACKUPS) */
  name: string;
  /** 실제 localStorage 키 문자열 */
  key: string;
  /** 사용자용 한글 라벨 */
  label: string;
  bytes: number;
  /** 전체 한계(5MB) 대비 비율 0~1 */
  ratio: number;
}

interface BackupUsage {
  bytes: number;
  /** 백업 스냅샷 개수 (JSON 배열 파싱 실패 시 null) */
  count: number | null;
  /** 개당 평균 바이트 (count 0이면 0) */
  avgBytes: number;
}

export interface StorageUsageReport {
  /** 현재 저장돼 있는 STORAGE_KEYS 항목 (bytes 내림차순, 비어 있는 키 제외) */
  items: StorageKeyUsage[];
  /** STORAGE_KEYS 외 키 합계 (다른 앱·라이브러리·레거시 잔재) */
  other: { bytes: number; count: number };
  backup: BackupUsage;
  totalBytes: number;
  limitBytes: number;
  /** 0~1 (한계 초과 시 1 초과 가능) */
  ratio: number;
  /** 0~100 소수 첫째 자리 반올림 */
  percent: number;
  level: StorageUsageLevel;
}

type StorageKeyName = keyof typeof STORAGE_KEYS;

const KEY_LABELS: Partial<Record<StorageKeyName, string>> = {
  DATA: "앱 데이터(본문)",
  DATA_SCHEMA_VERSION: "스키마 버전",
  BACKUPS: "자동 백업 스냅샷",
  THEME: "테마",
  HIGH_CONTRAST: "고대비 모드",
  CUSTOM_THEME: "커스텀 테마 색상",
  FONT_SIZE: "폰트 크기",
  SAVED_FILTERS: "저장된 필터",
  DASHBOARD_WIDGETS: "대시보드 위젯",
  DASHBOARD_WIDGET_ORDER: "대시보드 위젯 순서",
  DASHBOARD_HIDDEN_WIDGETS: "대시보드 숨김 위젯",
  BACKUP_ON_SAVE: "저장 시 스냅샷 설정",
  TICKER: "티커",
  PRICE_API_ENABLED: "가격 API 설정",
  LAST_QUOTE_REFRESH_AT: "마지막 시세 갱신 시각",
  BENCHMARK_LAST_FETCH_AT: "벤치마크 갱신 시각",
  DATA_TABLE_BACKUP: "테이블 백업 JSON",
  LAST_FX_RATE: "환율 캐시",
  DATE_ACCOUNT_ID: "데이트통장 계좌",
  DATE_ACCOUNT_RATIO: "데이트통장 비율",
  GIST_AUTO_SYNC: "Gist 자동 동기화 설정",
  GIST_LAST_PUSH_AT: "Gist 마지막 저장 시각",
  GIST_LAST_PULL_AT: "Gist 마지막 불러오기 시각",
  GIT_LAST_PUSH_AT: "git 마지막 업로드 시각",
  GIT_LAST_PULL_AT: "git 마지막 내려받기 시각",
  CACHE: "API 캐시(시세·티커·일별 종가)",
  DRAFT: "저장 드래프트(크래시 복구)",
  DRAFT_AT: "드래프트 작성 시각",
  SALARY_TIMER: "월급 타이머 설정",
  DIVIDENDS_LAST_TAB: "배당 탭 마지막 선택"
};

/** UTF-16 코드 유닛 기준 근사 바이트 */
function utf16Bytes(key: string, value: string): number {
  return (key.length + value.length) * 2;
}

/** 한계 대비 레벨 판정 — 카드·헤더 경고가 같은 기준을 쓰도록 단일 진입점 */
export function getStorageUsageLevel(ratio: number): StorageUsageLevel {
  if (ratio >= STORAGE_DANGER_RATIO) return "danger";
  if (ratio >= STORAGE_WARNING_RATIO) return "warning";
  return "ok";
}

function parseBackupCount(raw: string): number | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

/**
 * @param storage window.localStorage 또는 동일 인터페이스의 가짜 객체(테스트)
 * @param keys STORAGE_KEYS (속성명 → 실제 키)
 * @param limitBytes 기본 5MB
 */
export function measureLocalStorageUsage(
  storage: Pick<Storage, "length" | "key" | "getItem">,
  keys: typeof STORAGE_KEYS,
  limitBytes: number = LOCAL_STORAGE_LIMIT_BYTES
): StorageUsageReport {
  const knownKeyToName = new Map<string, StorageKeyName>();
  for (const name of Object.keys(keys) as StorageKeyName[]) {
    knownKeyToName.set(keys[name], name);
  }

  const items: StorageKeyUsage[] = [];
  let otherBytes = 0;
  let otherCount = 0;
  let totalBytes = 0;
  let backup: BackupUsage = { bytes: 0, count: 0, avgBytes: 0 };

  // 동일 키가 중복 열거되는 구현은 없지만(스펙상 불가) 방어적으로 한 번만 센다
  const seen = new Set<string>();
  const count = storage.length;
  for (let i = 0; i < count; i++) {
    const key = storage.key(i);
    if (key == null || seen.has(key)) continue;
    seen.add(key);
    const value = storage.getItem(key);
    if (value == null) continue;
    const bytes = utf16Bytes(key, value);
    totalBytes += bytes;

    const name = knownKeyToName.get(key);
    if (name === undefined) {
      otherBytes += bytes;
      otherCount += 1;
      continue;
    }
    items.push({
      name,
      key,
      label: KEY_LABELS[name] ?? key,
      bytes,
      ratio: limitBytes > 0 ? bytes / limitBytes : 0
    });
    if (name === "BACKUPS") {
      const backupCount = parseBackupCount(value);
      backup = {
        bytes,
        count: backupCount,
        avgBytes: backupCount != null && backupCount > 0 ? Math.round(bytes / backupCount) : 0
      };
    }
  }

  items.sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key));

  const ratio = limitBytes > 0 ? totalBytes / limitBytes : 0;
  return {
    items,
    other: { bytes: otherBytes, count: otherCount },
    backup,
    totalBytes,
    limitBytes,
    ratio,
    percent: Math.round(ratio * 1000) / 10,
    level: getStorageUsageLevel(ratio)
  };
}

/** 1,234 B / 12.3 KB / 1.23 MB — 사용량 카드 표시용 */
export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes).toLocaleString("ko-KR")} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
