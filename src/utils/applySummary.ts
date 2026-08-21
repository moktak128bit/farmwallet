/**
 * "덮어쓰기 적용" 게이트(ApplyConfirmModal) 요약 계산 — 순수 함수 (1-6/1-10).
 *
 * 백업 복원·JSON/파일 가져오기·드래프트 복구·Gist 수동 pull 등 현재 데이터를 다른 데이터로
 * 완전히 대체하는 6개 게이트가 공유한다. "현재(before) vs 적용될(after, 정규화 후)" 데이터의
 *  - 컬렉션별 건수 차·kind별 합계 차 (1-3 migrationReport.diffAppData 재사용)
 *  - 최신 가계부 날짜 (전/후)
 *  - **새로 생기는** 무결성 오류 수(runStructuralChecks 재사용 — 잔액 계산 없이 빠르게, 1-10)
 * 를 계산해 [적용]/[취소] 판단 자료를 만든다. 실데이터는 이미 무결성 경고를 갖고 있을 수 있으므로
 * "이미 있던 것"은 세지 않고 "새로 생기는 것"만 센다 — 그래야 매번 뜨는 숫자에 습관적으로
 * [확인]을 누르게 되는 것을 막을 수 있다(1-10 설계 의도).
 */
import type { AppData } from "../types";
import { diffAppData } from "../services/migrationReport";
import { runStructuralChecks, type IntegrityIssue } from "./dataIntegrity";

export type ApplyDiff = ReturnType<typeof diffAppData>;

export interface ApplySummary {
  diff: ApplyDiff;
  /** 적용 전(현재) 데이터의 최신 가계부 날짜. 항목이 없으면 "" */
  latestLedgerDateBefore: string;
  /** 적용될(after) 데이터의 최신 가계부 날짜. 항목이 없으면 "" */
  latestLedgerDateAfter: string;
  /** before에는 없던, after에서 새로 생기는 무결성 오류(severity=error) 건수 */
  newIntegrityErrorCount: number;
  /** 위 항목들 중 하나라도 달라졌으면 true — false면 모달을 생략하고 바로 적용해도 안전 */
  hasChanges: boolean;
}

function latestLedgerDate(ledger: AppData["ledger"]): string {
  if (!Array.isArray(ledger)) return "";
  return ledger.reduce((max, l) => (typeof l?.date === "string" && l.date > max ? l.date : max), "");
}

/** 항목 비교용 안정 직렬화 (키 정렬) — migrationReport.ts의 동명 헬퍼와 동일한 목적, 독립 구현 */
function stableStringify(value: unknown): string {
  try {
    return (
      JSON.stringify(value, (_k, v) => {
        if (v && typeof v === "object" && !Array.isArray(v)) {
          const sorted: Record<string, unknown> = {};
          for (const key of Object.keys(v as Record<string, unknown>).sort()) {
            sorted[key] = (v as Record<string, unknown>)[key];
          }
          return sorted;
        }
        return v;
      }) ?? String(value)
    );
  } catch {
    return `[unserializable:${typeof value}]`;
  }
}

function issueKey(issue: IntegrityIssue): string {
  return `${issue.type}|${stableStringify(issue.data)}`;
}

/** issue 배열을 키별 출현 횟수 맵으로 (동일 이슈가 여러 번 나올 수 있음을 대비) */
function countByKey(issues: IntegrityIssue[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const issue of issues) {
    const key = issueKey(issue);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

/** runStructuralChecks 호출은 순수하지만, 입력이 예상 밖 형태여도 모달 계산 자체가 죽지 않도록 방어 */
function safeStructuralErrors(data: AppData): IntegrityIssue[] {
  try {
    return runStructuralChecks({
      accounts: data.accounts,
      ledger: data.ledger,
      trades: data.trades,
      loans: data.loans,
      categoryPresets: data.categoryPresets
    }).filter((issue) => issue.severity === "error");
  } catch {
    return [];
  }
}

/**
 * before → after로 새로 생기는 무결성 오류(error) 수. 키가 같은 이슈는 "이미 있던 것"으로 상쇄하고,
 * after 쪽에 남는(before보다 더 많이 출현하는) 만큼만 더한다.
 */
export function countNewIntegrityErrors(before: AppData, after: AppData): number {
  const beforeCounts = countByKey(safeStructuralErrors(before));
  const afterCounts = countByKey(safeStructuralErrors(after));
  let added = 0;
  for (const [key, afterCount] of afterCounts) {
    const beforeCount = beforeCounts.get(key) ?? 0;
    if (afterCount > beforeCount) added += afterCount - beforeCount;
  }
  return added;
}

/** ApplyConfirmModal·게이트 호출부가 쓰는 메인 진입점 */
export function buildApplySummary(before: AppData, after: AppData): ApplySummary {
  const diff = diffAppData(before, after);
  const latestLedgerDateBefore = latestLedgerDate(before.ledger);
  const latestLedgerDateAfter = latestLedgerDate(after.ledger);
  const newIntegrityErrorCount = countNewIntegrityErrors(before, after);
  const hasChanges =
    diff.hasChanges || latestLedgerDateBefore !== latestLedgerDateAfter || newIntegrityErrorCount > 0;

  return {
    diff,
    latestLedgerDateBefore,
    latestLedgerDateAfter,
    newIntegrityErrorCount,
    hasChanges
  };
}
