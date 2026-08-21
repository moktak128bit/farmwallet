/**
 * 중복 의심 탐지 — 순수 함수. 저장을 막지 않는다(비차단): 호출 측이 토스트/confirm을 결정.
 *  - matches: 같은 kind·같은 날·같은 금액(·같은 계좌·같은 통화) 항목 — '같은 날 같은 금액 N건 있음' 토스트
 *  - exactDescription: 그중 설명까지(정규화) 같은 항목 — 이 경우만 confirm (커피 2잔처럼 일상적 동일 금액은 흐름을 끊지 않음)
 * 반복지출 생성 경로는 자체 dedup이 있으므로 여기서 다루지 않는다.
 */
import type { LedgerEntry, LedgerKind } from "../types";
import { normalizeMerchant } from "./categoryRecommendation";

interface DuplicateProbe {
  date: string;
  /** 저장될 금액(할인 반영 후) — 기존 항목의 amount와 같은 기준 */
  amount: number;
  kind: LedgerKind;
  fromAccountId?: string;
  toAccountId?: string;
  description?: string;
  currency?: "KRW" | "USD";
  /** 수정 중인 항목 id — 자기 자신은 제외 */
  excludeId?: string;
}

interface DuplicateOptions {
  /** 같은 날만 (기본 true) */
  sameDay?: boolean;
  /** 같은 출금/입금 계좌만 (기본 true) */
  sameAccount?: boolean;
}

interface DuplicateResult {
  matches: LedgerEntry[];
  exactDescription: LedgerEntry[];
}

const norm = (s: string | undefined): string => (s || "").trim();
const descKey = (s: string | undefined): string => {
  const raw = norm(s).toLowerCase();
  if (!raw) return "";
  return normalizeMerchant(raw) || raw;
};

export function findProbableDuplicates(
  probe: DuplicateProbe,
  ledger: ReadonlyArray<LedgerEntry>,
  options: DuplicateOptions = {}
): DuplicateResult {
  const sameDay = options.sameDay ?? true;
  const sameAccount = options.sameAccount ?? true;
  const matches: LedgerEntry[] = [];
  const exactDescription: LedgerEntry[] = [];
  if (!Number.isFinite(probe.amount) || probe.amount <= 0) return { matches, exactDescription };
  const probeCurrency = probe.currency ?? "KRW";
  const probeFrom = norm(probe.fromAccountId);
  const probeTo = norm(probe.toAccountId);
  const probeDesc = descKey(probe.description);
  for (const l of ledger) {
    if (probe.excludeId && l.id === probe.excludeId) continue;
    if (l.kind !== probe.kind) continue;
    if (sameDay && l.date !== probe.date) continue;
    if (Math.abs(l.amount - probe.amount) >= 0.005) continue;
    if ((l.currency ?? "KRW") !== probeCurrency) continue;
    if (sameAccount && (norm(l.fromAccountId) !== probeFrom || norm(l.toAccountId) !== probeTo)) continue;
    matches.push(l);
    // 설명 일치는 둘 다 비어 있지 않을 때만 — 설명 없는 동일 금액 2건(커피 2잔)은 confirm 대상 아님
    if (probeDesc && descKey(l.description) === probeDesc) exactDescription.push(l);
  }
  return { matches, exactDescription };
}
