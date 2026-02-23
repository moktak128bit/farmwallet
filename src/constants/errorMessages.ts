/**
 * 공통 에러/안내 메시지 상수
 */
export const ERROR_MESSAGES = {
  ACCOUNT_REQUIRED: "계좌를 선택해주세요.",
  ACCOUNT_NOT_FOUND: "계좌를 찾을 수 없습니다.",
  USD_ACCOUNT_USD_ONLY: "달러 계좌에서는 달러 종목만 거래할 수 있습니다.",
  KRW_ACCOUNT_KRW_ONLY: "원화 계좌에서는 원화 종목만 거래할 수 있습니다.",
  FX_ACCOUNTS_REQUIRED: "출발 계좌와 도착 계좌를 선택해주세요",
  FX_SAME_ACCOUNT: "출발 계좌와 도착 계좌가 같을 수 없습니다",
  FX_AMOUNT_RATE_REQUIRED: "금액과 환율을 올바르게 입력해주세요",
  FX_KRW_USD_ONLY: "KRW 계좌와 USD 계좌 간의 환전만 가능합니다",
  QUOTE_FETCH_FAILED: "환율 조회 실패",

  BACKUP_LIST_LOAD_FAILED: "백업 목록을 불러오는 중 오류가 발생했습니다. 다시 시도해 보세요.",
  DATA_LOAD_FAILED: "데이터를 불러오는 중 오류가 발생했습니다.",
  BACKUP_DOWNLOAD_FAILED: "백업 파일 다운로드 중 오류가 발생했습니다. 다시 시도해 보세요.",
  EXPORT_MARKDOWN_FAILED: "정리.md 내보내기 중 오류가 발생했습니다.",
  JSON_INPUT_REQUIRED: "JSON 데이터를 입력해주세요.",
  BACKUP_REFRESH_FAILED: "백업 목록 새로고침 실패. 다시 시도해 보세요.",
  SERVER_BACKUP_DISABLED: "서버 백업 복원은 비활성화되어 있습니다. 로컬 백업만 사용할 수 있습니다.",
  BACKUP_FILE_INVALID: "백업 파일 형식이 올바르지 않습니다. JSON 파일인지 확인해 보세요.",
  BACKUP_SELECTED_NOT_FOUND: "선택한 백업을 불러올 수 없습니다.",
  BACKUP_RESTORE_FAILED: "백업을 불러오는 중 문제가 발생했습니다. 다시 시도해 보세요.",
  JSON_FORMAT_INVALID: "JSON 형식이 올바르지 않습니다. 중괄호/쉼표를 다시 확인해 주세요.",

  INTEGRITY_CHECK_FAILED: "무결성 검사 중 오류가 발생했습니다",
  NO_DUPLICATES: "중복 항목이 없습니다",
  NO_MISSING_REFERENCE: "누락된 참조가 없습니다",

  COPY_FAILED: "복사 중 오류가 발생했습니다.",
  NO_DATA_TO_EXPORT: "내보낼 데이터가 없습니다",
  QUOTE_UNAVAILABLE: "시세를 조회할 수 없습니다. 티커를 확인하거나 고급 옵션에서 가격을 직접 입력하세요.",
  DATE_AMOUNT_REQUIRED: "날짜와 금액을 올바르게 입력해주세요.",
  BUDGET_ALREADY_APPLIED: "해당 월에 이미 반영된 항목만 선택되었습니다. 새로운 항목을 선택해주세요.",

  BACKUP_SAVE_FAILED: "백업 저장 실패",
  TICKER_DB_CREATE_FAILED: "티커 데이터베이스 생성 실패",
} as const;
