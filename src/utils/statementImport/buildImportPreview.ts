/**
 * 파싱된 카드 명세 행 → LedgerEntry 초안 미리보기 — 순수 모듈 (React 의존 없음).
 *
 * kind는 항상 "expense"(1차 범위: 카드 계좌 명세만). 분류는 새 저장 형태를 만들지 않고
 * categoryRecommendation.recommendCategory(3단 추천) → quickEntryBuild.quickEntryStoredCategory
 * (LedgerEntryForm.submitForm과 동일한 저장 형태 빌더)를 그대로 재사용한다.
 */
import type { LedgerEntry } from "../../types";
import { parseIsoLocal } from "../date";
import { newIdWithPrefix } from "../id";
import { recommendCategory } from "../categoryRecommendation";
import { quickEntryStoredCategory } from "../quickEntryBuild";
import { isCreditPayment } from "../categoryUtils";
import { type ColumnMapping, parseStatementAmount, parseStatementDate } from "./parseDelimited";

export type ImportRowStatus = "new" | "duplicate-exact" | "duplicate-probable" | "invalid";

export interface ImportPreviewRow {
  /** 원본 데이터 행 인덱스 (헤더 제외, 0-based) */
  rowIndex: number;
  status: ImportRowStatus;
  /** 기본 포함 여부 — new만 true. 중복(exact/probable)·invalid는 기본 제외(사용자가 직접 포함 체크). */
  included: boolean;
  /** invalid·중복 사유 (사용자에게 표시) */
  reason?: string;
  /** 저장할 LedgerEntry 초안(id 없음) — invalid면 undefined */
  draft?: Omit<LedgerEntry, "id">;
  /** 표에 표시할 원시 파싱 결과 (invalid여도 채워짐 — 표시용) */
  preview: { date: string; amount: number; description: string };
}

interface BuildImportPreviewOptions {
  /** 적용 대상 카드 계좌 id (필수 — 모든 행의 fromAccountId) */
  cardAccountId: string;
  /** 중복 판정·분류 추천 학습에 쓰는 기존 가계부 */
  ledger: LedgerEntry[];
  /** USD 열이 감지된 행의 환산 가능 여부 판정용 — 미로드(null)면 해당 행은 invalid */
  fxRate: number | null;
  /** 날짜 연도 추론 기준 (테스트 주입용, 기본 getTodayKST) */
  today?: string;
}

const CANCEL_STATUS_RE = /(취소|환불)/;

/**
 * 중복 판정 — 같은 카드 계좌의 지출(신용결제 이중계상 항목 제외) 중:
 *  - exact: 날짜·금액·설명(trim)까지 완전 일치
 *  - probable: 날짜 ±1일 이내 + 금액 일치(설명은 무시 — "스타벅스" vs "스타벅스커피(주)강남점" 같은
 *    표기 차이를 못 잡으므로 이쪽을 넓게 잡고 기본 제외해 사용자가 눈으로 확인하게 한다)
 */
function findDuplicateStatus(
  candidate: { date: string; amount: number; description: string },
  cardAccountId: string,
  ledger: LedgerEntry[]
): "new" | "duplicate-exact" | "duplicate-probable" {
  const pool = ledger.filter(
    (l) => l.kind === "expense" && l.fromAccountId === cardAccountId && !isCreditPayment(l)
  );
  const descNorm = candidate.description.trim();

  const exact = pool.some(
    (l) => l.date === candidate.date && l.amount === candidate.amount && (l.description || "").trim() === descNorm
  );
  if (exact) return "duplicate-exact";

  const candDate = parseIsoLocal(candidate.date);
  if (candDate) {
    const dayMs = 24 * 60 * 60 * 1000;
    const probable = pool.some((l) => {
      if (l.amount !== candidate.amount) return false;
      const d = parseIsoLocal(l.date);
      if (!d) return false;
      return Math.abs(d.getTime() - candDate.getTime()) <= dayMs;
    });
    if (probable) return "duplicate-probable";
  }
  return "new";
}

/** 파싱된 데이터 행들 → 미리보기 행 배열. rows는 헤더를 제외한 데이터 행(parseDelimited 결과). */
export function buildImportPreview(
  rows: string[][],
  mapping: ColumnMapping,
  options: BuildImportPreviewOptions
): ImportPreviewRow[] {
  const { cardAccountId, ledger, fxRate, today } = options;

  return rows.map((row, rowIndex): ImportPreviewRow => {
    const rawDate = row[mapping.dateCol] ?? "";
    const rawAmount = row[mapping.amountCol] ?? "";
    const rawMerchant = row[mapping.merchantCol] ?? "";
    const rawStatus = mapping.statusCol != null ? row[mapping.statusCol] ?? "" : "";
    const rawInstallment = mapping.installmentCol != null ? row[mapping.installmentCol] ?? "" : "";
    const rawCurrency = mapping.currencyCol != null ? row[mapping.currencyCol] ?? "" : "";

    const isUsd = /(USD|달러)/i.test(rawCurrency);
    const date = parseStatementDate(rawDate, today);
    const { amount: parsedAmount, isNegative } = parseStatementAmount(rawAmount, { allowDecimal: isUsd });
    const description = rawMerchant.trim();
    const preview = { date: date ?? rawDate.trim(), amount: parsedAmount, description };

    if (isNegative || CANCEL_STATUS_RE.test(rawStatus)) {
      return { rowIndex, status: "invalid", included: false, reason: "취소/환불 거래로 보여 제외했습니다.", preview };
    }
    if (!date) {
      return { rowIndex, status: "invalid", included: false, reason: "날짜를 인식할 수 없습니다.", preview };
    }
    if (!parsedAmount || parsedAmount <= 0) {
      return { rowIndex, status: "invalid", included: false, reason: "금액을 인식할 수 없습니다.", preview };
    }
    if (!description) {
      return { rowIndex, status: "invalid", included: false, reason: "가맹점/내용이 비어 있습니다.", preview };
    }
    if (isUsd && !(typeof fxRate === "number" && fxRate > 0)) {
      return {
        rowIndex,
        status: "invalid",
        included: false,
        reason: "환율 미로드 상태라 USD 항목을 가져올 수 없습니다.",
        preview,
      };
    }

    const status = findDuplicateStatus({ date, amount: parsedAmount, description }, cardAccountId, ledger);
    const recs = recommendCategory(description, parsedAmount, "expense", ledger);
    const stored = quickEntryStoredCategory("expense", recs[0] ?? null);

    const installmentText = rawInstallment.trim();
    const installmentSuffix =
      installmentText && !/^(일시불|0|-)$/.test(installmentText) ? ` (할부 ${installmentText})` : "";

    const draft: Omit<LedgerEntry, "id"> = {
      date,
      kind: "expense",
      isFixedExpense: false,
      category: stored.category,
      subCategory: stored.subCategory,
      ...(stored.detailCategory ? { detailCategory: stored.detailCategory } : {}),
      description: description + installmentSuffix,
      amount: parsedAmount,
      fromAccountId: cardAccountId,
      ...(isUsd ? { currency: "USD" as const } : {}),
    };

    return {
      rowIndex,
      status,
      included: status === "new",
      draft,
      preview,
    };
  });
}

/** 포함 체크된 행 → 실제 저장할 LedgerEntry 배열 (id 부여 + 일괄 되돌리기용 import 태그 추가). */
export function finalizeImportRows(previewRows: ImportPreviewRow[], importTag: string): LedgerEntry[] {
  return previewRows
    .filter((r): r is ImportPreviewRow & { draft: Omit<LedgerEntry, "id"> } => r.included && !!r.draft)
    .map((r) => ({
      ...r.draft,
      id: newIdWithPrefix("L"),
      tags: [...(r.draft.tags ?? []), importTag],
    }));
}
