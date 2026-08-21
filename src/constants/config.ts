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
  /** 로컬 백업 — 현재는 IndexedDB('farmwallet-backups', services/backupStore.ts)에 저장. 이 키는 IDB 이관 전 레거시 배열·IDB 불가 시 폴백 전용 */
  BACKUPS: "farmwallet-backups-v1",
  THEME: "fw-theme",
  HIGH_CONTRAST: "fw-high-contrast",
  /** 테마 커스터마이저가 저장한 커스텀 색상 (JSON). 없으면 CSS 기본 팔레트 사용 */
  CUSTOM_THEME: "fw-custom-theme",
  /** 테마 커스터마이저가 저장한 폰트 크기 (small|medium|large) */
  FONT_SIZE: "fw-font-size",
  SAVED_FILTERS: "fw-saved-filters",
  DASHBOARD_WIDGETS: "fw-dashboard-widgets",
  DASHBOARD_WIDGET_ORDER: "fw-dashboard-widget-order",
  /** 대시보드에서 숨길 위젯 ID 목록 (JSON 배열). 비어있으면 전부 표시 — 신규 위젯은 기본 표시 */
  DASHBOARD_HIDDEN_WIDGETS: "fw-dashboard-hidden-widgets",
  BACKUP_ON_SAVE: "fw-backup-on-save",
  TICKER: "ticker",
  /** 가격 API 사용 여부 (켜면 외부 API로 배치 갱신 가능, 연동은 추후 구현) */
  PRICE_API_ENABLED: "fw-price-api-enabled",
  /** 마지막 시세 갱신 "시도" 시각(epoch ms) — 탭 진입 stale 판정은 체결 시각(updatedAt)이 아닌 이 값 기준 (장외엔 체결 시각이 멈춰 항상 stale로 오판) */
  LAST_QUOTE_REFRESH_AT: "fw-last-quote-refresh-at",
  /** 시장 지수(벤치마크) 자동 fetch 마지막 시도 시각(epoch ms) — 매 로드마다 야후 호출하지 않도록 throttle */
  BENCHMARK_LAST_FETCH_AT: "fw-benchmark-last-fetch-at",
  /** @deprecated 테이블 형태 백업 JSON 사본 — 더 이상 쓰지 않음(읽는 곳 0건). 구버전이 매 저장마다 기록하던 키를 loadData가 부팅 시 removeItem으로 정리하기 위해서만 유지. */
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
  DIVIDENDS_LAST_TAB: "fw-dividends-last-tab",
  /** 종합과세 트래커/세금 보고서 세전(gross-up) 환산 토글 ("true"면 켜짐, 기본 off) */
  TAX_GROSS_UP: "fw-tax-gross-up",
  /** BACKUPS JSON 파싱 실패 시 원본 문자열을 보존하는 1슬롯 (부분 복구용; 기존 슬롯이 있으면 덮지 않음) */
  BACKUPS_CORRUPT: "farmwallet-backups-corrupt-v1",
  /** 영속 활동 로그(최대 500건, uiStore.addAppLog) — 오류 리포팅(utils/errorReporting.ts)도 여기에 쌓임 */
  APP_LOG: "fw-app-log-v1",
  /** 연말정산 미리보기 총급여 입력 (JSON: {"2026": 50000000} — 귀속연도별, 기기 로컬) */
  YEAR_END_GROSS_SALARY: "fw-year-end-gross-salary",
  /** 마지막 스키마 마이그레이션 리포트(services/migrationReport.ts — from→to·시각·컬렉션별 변경 건수 요약, 소형 JSON) */
  LAST_MIGRATION_REPORT: "fw-last-migration-report",
  /** 연금계좌 세액공제율 선택 ("0.132"|"0.165", 기본 0.132 — 총급여 5,500만 초과 가정). 배당 탭 절세계좌 카드 전용 */
  TAX_CREDIT_RATE: "fw-tax-credit-rate",
  /** 환율 이력 backfill(useFxBackfill) 마지막 시도 시각 (ms epoch) — 12시간 throttle */
  FX_BACKFILL_LAST_AT: "fw-fx-backfill-last-at",
  /** 시세 CORS 프록시별 성공/실패 카운트·마지막 성공 시각 (yahooFinanceApi fetchViaProxies, 소형 JSON) */
  PROXY_STATUS: "fw-proxy-status-v1",
  /** 마지막으로 보던 최상위 탭(TabId). 부팅 시 복원 — TAB_ORDER 화이트리스트 외 값은 무시 */
  LAST_TAB: "fw-last-tab",
  /** saveSafetySnapshot이 첫 await 전에 동기 기록하는 최신 안전 스냅샷 1슬롯 — IDB 복제가 끝나면 비움 (services/backupStore.ts) */
  BACKUP_SAFETY_PENDING: "farmwallet-backup-safety-pending-v1",
  /** 가계부 메인 폼 입력 드래프트 (sessionStorage — 탭별, 24h 만료; utils/ledgerFormDraft.ts) */
  LEDGER_FORM_DRAFT: "fw-ledger-form-draft",
  /** FIRE 시뮬레이터 가정 덮어쓰기 (JSON: {monthlySaving?, returnPct?, retireSpendingAnnual?} — 기기 로컬, AppData 무변경) */
  FIRE_ASSUMPTIONS: "fw-fire-assumptions"
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

// 자동 백업 간격 (밀리초, 10분) — 저장소가 IndexedDB로 옮겨져 용량 여유가 생겨 30분→10분으로 단축
export const AUTO_BACKUP_INTERVAL_MS = 10 * 60 * 1000;

// 자동 Gist 저장 디바운스 (밀리초, 5분)
export const GIST_AUTO_PUSH_DEBOUNCE_MS = 5 * 60 * 1000;

/** 앱 복귀(visibilitychange:visible·online) 시 원격 Gist 변경 확인 최소 간격 (밀리초, 15분) */
export const GIST_REMOTE_CHECK_THROTTLE_MS = 15 * 60 * 1000;

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
