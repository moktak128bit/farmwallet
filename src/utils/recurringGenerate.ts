/**
 * 반복 지출(고정 지출/구독) → 월 발생 가계부 항목 생성기 + 중복 제거.
 *
 * RecurringListSection(예산 탭 "이번 달 반복 지출 생성"·"선택 반영")과
 * 헤더 RecurringDueBadge(미등록 배지 원클릭 반영)가 **같은 경로**를 공유한다.
 * 반복 생성은 이 모듈이 단일 진입점 — 다른 곳에서 LedgerEntry를 직접 조립하지 말 것.
 *
 * 불변 규칙(회귀 테스트 src/__tests__/recurringGenerate.test.ts):
 *  - monthly: 시작 '일'을 그 달 말일로 클램프(29/30/31일 시작 → 짧은 달 말일)
 *  - yearly:  시작 '월'이 같은 달에만, 일자는 말일 클램프(2/29 → 평년 2/28)
 *  - weekly:  시작일부터 7일 간격으로 월 범위 내 모든 발생
 *  - 시작일 이전·종료일 이후 발생은 생성하지 않음
 *  - dedup: monthly/yearly = 같은 달 + 분류(소분류 일치/설명 포함 또는 중분류+소분류 공란) + 금액 ±100원 미만,
 *           weekly = 위 조건 + 날짜까지 일치
 */
import type { CategoryPresets, LedgerEntry, Recurrence, RecurringExpense } from "../types";
import { parseIsoLocal, formatIsoLocal } from "./date";
import { newIdWithPrefix } from "./id";

/** 월 발생 항목 + 원본 주기 — 중복 판정을 주기별로 다르게 하기 위한 쌍 */
export interface RecurringOccurrence {
  entry: LedgerEntry;
  frequency: Recurrence;
}

/**
 * 프리셋 지출 대분류 중 첫 항목 (반복 반영 시 카테고리 비었을 때 사용, 버튼 필터에 잡히도록).
 * "재테크"는 제외 — 고정지출이 재테크 집계에 섞이지 않게.
 */
export function getDefaultExpenseCategory(categoryPresets: CategoryPresets | undefined): string {
  const list = categoryPresets?.expense;
  if (!list || list.length === 0) return "(고정지출)";
  const exceptRecheck = list.filter((c) => c !== "재테크");
  return exceptRecheck[0] ?? list[0] ?? "(고정지출)";
}

/**
 * 지정 월(yyyy-mm)에 발생해야 할 반복 지출 항목 생성.
 * @param defaultExpenseCategory r.category가 비어 있고 이체가 아닐 때 쓸 중분류 — getDefaultExpenseCategory(categoryPresets)
 */
export function generateOccurrencesForMonthFromRecurring(
  recurringList: RecurringExpense[],
  month: string,
  defaultExpenseCategory: string
): RecurringOccurrence[] {
  const [y, m] = month.split("-").map(Number);
  // 모두 로컬 Date — toISOString()으로 직렬화하면 UTC로 바뀌어 1일 어긋날 수 있음
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m, 0);
  const occurrences: RecurringOccurrence[] = [];

  for (const r of recurringList) {
    if (!r.startDate || !r.startDate.trim()) continue;
    const start = parseIsoLocal(r.startDate);
    if (!start) continue;
    const endParsed = r.endDate ? parseIsoLocal(r.endDate) : null;
    if (endParsed && endParsed < monthStart) continue;

    const pushIfInMonth = (date: Date) => {
      // 시작일 이전(미래 시작 반복)·종료일 이후 발생은 생성하지 않음
      if (date < start) return;
      if (endParsed && date > endParsed) return;
      if (date >= monthStart && date <= monthEnd) {
        // 3-level 구조로 저장:
        //   - kind = transfer(저축성지출) 또는 expense
        //   - category = "이체"/"지출" (대분류)
        //   - subCategory = r.category (예: "구독비") — 사용자가 폼에 적은 카테고리
        //   - detailCategory = r.title (예: "넷플릭스") — 구체 항목
        const userCat =
          (r.category && r.category.trim()) ||
          (r.toAccountId ? "저축성지출" : defaultExpenseCategory);
        const isTransfer = !!r.toAccountId;
        occurrences.push({
          frequency: r.frequency,
          entry: {
            id: newIdWithPrefix("L"),
            date: formatIsoLocal(date), // UTC가 아닌 로컬 yyyy-mm-dd
            kind: isTransfer ? "transfer" : "expense",
            category: isTransfer ? "이체" : "지출",
            subCategory: userCat,
            detailCategory: r.title || undefined,
            description: r.title,
            amount: r.amount,
            fromAccountId: r.fromAccountId,
            toAccountId: r.toAccountId,
            isFixedExpense: true // LedgerView 이전 달→현재 달 자동 복사에 사용
          }
        });
      }
    };

    if (r.frequency === "monthly") {
      const day = start.getDate();
      if (day >= 1 && day <= 31) {
        // 29/30/31일 시작은 짧은 달에서 월말로 클램프. 시작일 검사는 pushIfInMonth가 수행
        const target = new Date(y, m - 1, Math.min(day, new Date(y, m, 0).getDate()));
        pushIfInMonth(target);
      }
    } else if (r.frequency === "yearly") {
      // 해당 월이면서 시작 연도 이후만 — 연도 비교는 pushIfInMonth의 date >= start가 수행
      // (2/29 시작 같은 경우도 월말 클램프로 윤년 아닌 해에 3/1로 밀리지 않게)
      if (start.getMonth() + 1 === m) {
        const target = new Date(y, m - 1, Math.min(start.getDate(), new Date(y, m, 0).getDate()));
        pushIfInMonth(target);
      }
    } else if (r.frequency === "weekly") {
      const cursor = new Date(start);
      while (cursor <= monthEnd) {
        if (cursor >= monthStart) pushIfInMonth(new Date(cursor));
        cursor.setDate(cursor.getDate() + 7);
      }
    }
  }
  return occurrences;
}

/**
 * 중복 제거 — 주기별로 판정 기준이 다르다:
 *  - monthly/yearly: 월 1회 발생이므로 "같은 달 + 같은 중분류/소분류 + 금액 ±100원"이면 중복
 *    (수동 입력·과거 1일 고정 생성분처럼 날짜가 달라도 잡아낸다)
 *  - weekly: 한 달에 여러 번 발생하므로 날짜까지 같아야 중복
 */
export function filterDuplicateOccurrences(
  occurrences: RecurringOccurrence[],
  existingLedger: LedgerEntry[],
  month: string
): LedgerEntry[] {
  const monthLedger = existingLedger.filter((l) => l.date?.startsWith(month));
  const result: LedgerEntry[] = [];
  for (const { entry: occ, frequency } of occurrences) {
    // occ.subCategory = r.category(중분류), occ.detailCategory = r.title(소분류/구체항목)
    const occDetail = (occ.detailCategory ?? "").trim();
    const dup = monthLedger.some((l) => {
      if (frequency === "weekly" && l.date !== occ.date) return false;
      if (Math.abs(Number(l.amount) - occ.amount) >= 100) return false;
      const lDetail = (l.detailCategory ?? "").trim();
      // 소분류(title) 일치 또는 설명에 title 포함 → 같은 반복 (recurringAlert.matchesRecurringEntry titleMatch와 동일)
      const titleMatch = !!occDetail && (lDetail === occDetail || (l.description ?? "").includes(occDetail));
      if (titleMatch) return true;
      // 수동 입력이 소분류를 아예 안 적었으면 중분류+금액만으로 중복 인정 — 알림(subMatch)은 '기록됨'인데
      // 생성 dedup은 detailCategory 동등을 요구해 중복을 만들던 판정 이원화를 해소.
      if (l.subCategory === occ.subCategory && !lDetail) return true;
      return false;
    });
    if (!dup) result.push(occ);
  }
  return result;
}
