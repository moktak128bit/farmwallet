// 앱 버전은 vite.config.ts에서 __APP_VERSION__으로 주입됨
declare const __APP_VERSION__: string;
export const APP_VERSION = __APP_VERSION__;
export const DATA_SCHEMA_VERSION = 3;

/** 저축 목표: 월급의 비율 (%) */
export const SAVINGS_RATE_GOAL = 70;

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
  /** 고정지출 자동복사 ON/OFF (기본: true) */
  AUTO_COPY_FIXED: "fw-auto-copy-fixed",
  /** 데이트통장 계좌 ID (해당 계좌 지출은 설정 비율만 본인 부담) */
  DATE_ACCOUNT_ID: "fw-date-account-id",
  /** 데이트통장 본인 부담 비율 (0~100, 기본 50) */
  DATE_ACCOUNT_RATIO: "fw-date-account-ratio"
} as const;

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
