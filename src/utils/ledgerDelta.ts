/**
 * 변경분(delta) 파일 — Claude가 스크린샷을 읽어 만든 "장부에 더할 것"을 앱이 적용한다.
 *
 * 흐름(GAS 운영): 사진 올리기 → Claude가 Drive 사진을 읽어 farmwallet-delta-v1 JSON 작성 →
 * 사용자가 설정 > 백업 / 복원 > [가계부 파일 불러오기]로 적용(미리보기 확인) → 자동 동기화가 시트에 저장 →
 * sourcePhotos에 적힌 사진은 처리 완료로 표시.
 *
 * 백업 파일과 달리 통째로 바꾸지 않고 지금 데이터에 더한다. 같은 파일을 두 번 적용해도 안전하도록
 * 추가 항목은 id가 같거나 (날짜·종류·금액·통화·출금·입금 계좌)가 같으면 건너뛴다.
 */
import type { Account, AppData, LedgerEntry, StockTrade } from "../types";

export const LEDGER_DELTA_FORMAT = "farmwallet-delta-v1" as const;

export interface LedgerDelta {
  format: typeof LEDGER_DELTA_FORMAT;
  ledger?: {
    add?: LedgerEntry[];
    /** id로 찾아 필드를 덮는다 */
    update?: Array<Partial<LedgerEntry> & { id: string }>;
    remove?: string[];
  };
  trades?: { add?: StockTrade[]; remove?: string[] };
  accounts?: { patch?: Array<Partial<Account> & { id: string }> };
  /** 이 변경분을 만든 Drive 사진 파일 이름(올린 시각 접두 포함) — 적용 후 처리 완료로 표시 */
  sourcePhotos?: string[];
}

export interface LedgerDeltaReport {
  added: number;
  updated: number;
  removed: number;
  /** 이미 있어 건너뛴 추가 항목 */
  skippedDuplicates: LedgerEntry[];
  /** 수정·삭제·계좌 패치 대상 id가 지금 데이터에 없음 */
  missing: string[];
}

export function isLedgerDelta(raw: unknown): raw is LedgerDelta {
  return !!raw && typeof raw === "object" && (raw as { format?: unknown }).format === LEDGER_DELTA_FORMAT;
}

/**
 * 같은 거래로 볼 조건 — id가 달라도 날짜·종류·금액·통화·계좌가 모두 같으면 중복.
 * 단 둘 다 시각이 있고 시각이 다르면 다른 거래(같은 곳에서 7,000원을 15:55·15:58에 두 번 낸 경우).
 */
const sameLedgerTxn = (a: LedgerEntry, b: LedgerEntry): boolean =>
  a.date === b.date &&
  a.kind === b.kind &&
  a.amount === b.amount &&
  (a.currency ?? "KRW") === (b.currency ?? "KRW") &&
  (a.fromAccountId ?? "") === (b.fromAccountId ?? "") &&
  (a.toAccountId ?? "") === (b.toAccountId ?? "") &&
  !(a.time && b.time && a.time !== b.time);

/** 순서: 가계부 수정 → 삭제 → 추가, 주식 삭제 → 추가, 계좌 패치. 입력 data는 바꾸지 않는다. */
export function applyLedgerDelta(data: AppData, delta: LedgerDelta): { next: AppData; report: LedgerDeltaReport } {
  const report: LedgerDeltaReport = { added: 0, updated: 0, removed: 0, skippedDuplicates: [], missing: [] };

  let ledger = data.ledger.map((l) => ({ ...l }));
  for (const patch of delta.ledger?.update ?? []) {
    const idx = ledger.findIndex((l) => l.id === patch.id);
    if (idx < 0) {
      report.missing.push(patch.id);
      continue;
    }
    ledger[idx] = { ...ledger[idx], ...patch };
    report.updated++;
  }
  for (const id of delta.ledger?.remove ?? []) {
    const before = ledger.length;
    ledger = ledger.filter((l) => l.id !== id);
    if (ledger.length === before) report.missing.push(id);
    else report.removed++;
  }
  // 중복 대조는 적용 전부터 있던 거래와만, 한 건당 한 번씩 — 같은 변경분 안의 똑같은 거래 두 건(시각 없는 같은 금액
  // 두 번 결제)이 서로를 중복으로 지우지 않고, 다시 적용하면 이미 있는 두 건이 각각 하나씩 짝지어 둘 다 건너뛴다.
  const existing = [...ledger];
  const consumed = new Set<number>();
  for (const entry of delta.ledger?.add ?? []) {
    if (ledger.some((l) => l.id === entry.id)) {
      report.skippedDuplicates.push(entry);
      continue;
    }
    const match = existing.findIndex((l, i) => !consumed.has(i) && sameLedgerTxn(l, entry));
    if (match >= 0) {
      consumed.add(match);
      report.skippedDuplicates.push(entry);
      continue;
    }
    ledger.push({ ...entry });
    report.added++;
  }

  let trades = data.trades.map((t) => ({ ...t }));
  for (const id of delta.trades?.remove ?? []) {
    const before = trades.length;
    trades = trades.filter((t) => t.id !== id);
    if (trades.length === before) report.missing.push(id);
    else report.removed++;
  }
  for (const trade of delta.trades?.add ?? []) {
    if (trades.some((t) => t.id === trade.id)) continue;
    trades.push({ ...trade });
    report.added++;
  }

  const patches = delta.accounts?.patch ?? [];
  const accounts = data.accounts.map((a) => {
    const patch = patches.find((p) => p.id === a.id);
    return patch ? { ...a, ...patch } : { ...a };
  });
  for (const patch of patches) {
    if (!data.accounts.some((a) => a.id === patch.id)) report.missing.push(patch.id);
  }

  return { next: { ...data, ledger, trades, accounts }, report };
}

/** 적용 결과 토스트 문구 */
export function formatDeltaReport(report: LedgerDeltaReport): string {
  const skipped = report.skippedDuplicates.length ? ` · 이미 있어 건너뜀 ${report.skippedDuplicates.length}` : "";
  const missing = report.missing.length ? ` · 대상 없음 ${report.missing.length}` : "";
  return `변경분 적용: 추가 ${report.added} · 수정 ${report.updated} · 삭제 ${report.removed}${skipped}${missing}`;
}
