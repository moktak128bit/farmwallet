/**
 * 배당/이자 도메인 공용 타입 — DividendsPage(부모)와 features/dividends 자식들이 공유.
 * (부모 ↔ 자식 순환 import를 피하기 위해 별도 파일로 둔다)
 */

/** 배당/이자 단일 탭 구분 */
export type TabType = "dividend" | "interest";

export interface DividendRow {
  /** 원본 ledger 엔트리 id — 편집/삭제 시 행→ledger 매칭에 사용 (티커/금액 매칭은 fragile해서 ID 직접 사용) */
  id: string;
  month: string;
  date: string;
  source: string;
  amount: number;
  ticker?: string;
  name?: string; // 종목명 (별도 필드로 명확히)
  /** 주당배당금 (총 배당금 ÷ 보유주수) */
  dividendPerShare?: number;
  /** 배당율 매입대비 (소수, 예: 0.0325 = 3.25%) */
  yieldRate?: number;
  /** 해당 시점 매입금액(원). 평단가·배당률 계산에 사용 */
  costBasis?: number;
  accountId?: string;
  accountName?: string;
  quantity?: number;
  /** ledger category/description 기준 이자 여부 (배당 테이블에서 제외) */
  isInterest?: boolean;
}
