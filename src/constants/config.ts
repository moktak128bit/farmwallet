// 앱 버전은 vite.config.ts에서 __APP_VERSION__으로 주입됨
declare const __APP_VERSION__: string;
export const APP_VERSION = __APP_VERSION__;
export const DATA_SCHEMA_VERSION = 12;

/** ISA 기준 포트폴리오 (목표 비중 %) */
export const ISA_PORTFOLIO = [
  { ticker: "485540", name: "KODEX 미국AI테크TOP10", weight: 20, label: "AI" },
  { ticker: "0131V0", name: "1Q 미국우주항공테크", weight: 20, label: "우주항공" },
  { ticker: "0023A0", name: "SOL 미국양자컴퓨팅TOP10", weight: 20, label: "양자" },
  { ticker: "458730", name: "TIGER 미국배당다우존스", weight: 20, label: "배당" },
  { ticker: "411060", name: "ACE KRX금현물", weight: 10, label: "금" },
  { ticker: "0046A0", name: "TIGER 미국초단기(3개월이하)국채", weight: 10, label: "달러" }
] as const;

// 스토리지 키
export const STORAGE_KEYS = {
  DATA: "farmwallet-data-v1",
  DATA_SCHEMA_VERSION: "farmwallet-data-schema-version",
  BACKUPS: "farmwallet-backups-v1",
  THEME: "fw-theme",
  HIGH_CONTRAST: "fw-high-contrast",
  SAVED_FILTERS: "fw-saved-filters",
  DASHBOARD_WIDGETS: "fw-dashboard-widgets",
  DASHBOARD_WIDGET_ORDER: "fw-dashboard-widget-order",
  BACKUP_ON_SAVE: "fw-backup-on-save",
  TICKER: "ticker",
  /** 가격 API 사용 여부 (켜면 외부 API로 배치 갱신 가능, 연동은 추후 구현) */
  PRICE_API_ENABLED: "fw-price-api-enabled",
  /** 테이블 형태 백업 JSON (일반 DATA와 별도; 저장 시 동기 갱신) */
  DATA_TABLE_BACKUP: "farmwallet-data-tables-v1",
  /** 마지막으로 성공한 USD/KRW 환율 캐시 */
  LAST_FX_RATE: "fw-last-fx-rate",
  /** 데이트통장 계좌 ID (해당 계좌 지출은 설정 비율만 본인 부담) */
  DATE_ACCOUNT_ID: "fw-date-account-id",
  /** 데이트통장 본인 부담 비율 (0~100, 기본 50) */
  DATE_ACCOUNT_RATIO: "fw-date-account-ratio",
  /** 자동 Gist 동기화 ON/OFF (기본: false) */
  GIST_AUTO_SYNC: "fw-gist-auto-sync",
  /** 마지막 자동 Gist 저장 성공 시각 (ISO 8601) */
  GIST_LAST_PUSH_AT: "fw-gist-last-push-at",
  /** 마지막 자동 Gist 불러오기 성공 시각 (ISO 8601) */
  GIST_LAST_PULL_AT: "fw-gist-last-pull-at",
  /** 마지막 git 업로드(push) 성공 시각 (ISO 8601) — 헤더 버튼 표시용 */
  GIT_LAST_PUSH_AT: "fw-git-last-push-at",
  /** 마지막 git 내려받기(pull) 성공 시각 (ISO 8601) — 헤더 버튼 표시용 */
  GIT_LAST_PULL_AT: "fw-git-last-pull-at",
  /** API로 수집한 캐시 데이터 (prices, tickerDatabase, historicalDailyCloses) */
  CACHE: "farmwallet-cache-v1",
  /** 디바운스 대기 중 크래시 시 복구를 위한 드래프트 슬롯 (write-through, 정상 저장 직후 삭제) */
  DRAFT: "farmwallet-data-v1__draft",
  /** 드래프트 작성 시각 (ms epoch). 너무 오래된 드래프트는 자동 폐기. */
  DRAFT_AT: "farmwallet-data-v1__draft__at",
  /** 월급 실시간 타이머 설정 (월급일·월급액). 대시보드 위젯 전용, 로컬 저장. */
  SALARY_TIMER: "fw-salary-timer",
  /** 배당/이자 탭의 마지막 선택 (dividend|interest). 다음 방문 시 복원. */
  DIVIDENDS_LAST_TAB: "fw-dividends-last-tab"
} as const;

/** 드래프트 슬롯이 이보다 오래되면 boot 시 무시·삭제 (스테일 복구 안내 방지) */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// 백업 설정
export const BACKUP_CONFIG = {
  API_PATH: "/api/backup",
  MAX_UNDO_HISTORY: 50,
  API_TIMEOUT_MS: 3000,
  MAX_LOCAL_BACKUPS: 120,
  MAX_BACKUP_PAYLOAD_BYTES: 20 * 1024 * 1024
} as const;

// 기본 US 티커 목록
export const DEFAULT_US_TICKERS = [
  "AAPL",
  "MSFT",
  "QQQ",
  "SPY",
  "VOO",
  "IVV"
] as const;

// 환율 업데이트 간격 (밀리초)
export const FX_UPDATE_INTERVAL = 60 * 60 * 1000; // 1시간

// 자동 저장 지연 시간 (밀리초)
export const AUTO_SAVE_DELAY = 500;

// 백업 경고 시간 (시간)
export const BACKUP_WARNING_HOURS = {
  WARNING: 12,
  CRITICAL: 24
} as const;

// 자동 백업 간격 (밀리초, 30분)
export const AUTO_BACKUP_INTERVAL_MS = 30 * 60 * 1000;

// 자동 Gist 저장 디바운스 (밀리초, 5분)
export const GIST_AUTO_PUSH_DEBOUNCE_MS = 5 * 60 * 1000;

/**
 * Gist 자동 푸시가 N시간 이상 안 됐을 때 사용자에게 경고 (모바일 백그라운드 suspend·연속 실패 감지용).
 * 로컬 백업 경고와 동일한 단계 구조 (BACKUP_WARNING_HOURS 참조).
 */
export const GIST_STALE_WARNING_HOURS = {
  WARNING: 12,
  CRITICAL: 48
} as const;

/** Gist push 일시적 실패 시 재시도 횟수와 대기 시간 (지수 백오프 base). */
export const GIST_PUSH_RETRY = {
  MAX_ATTEMPTS: 3,
  BASE_DELAY_MS: 1000
} as const;
