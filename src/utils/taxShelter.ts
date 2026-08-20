/**
 * 절세계좌(ISA·연금저축·IRP) 납입 집계 + 한도·세액공제 추정 (순수, 4-1).
 *
 * 납입 = 가계부 transfer 중 toAccountId가 절세계좌인 항목의 원화 환산 합계(연도 기준). 단,
 *  - 환전(isCurrencyExchangeEntry): 같은 계좌 안 통화 이동 — 납입 아님
 *  - 절세계좌 간 내부 이체(from·to 둘 다 절세계좌): 한도를 두 번 소진하지 않게 제외
 *  - 배당·이자 재투자(transfer인데 배당/이자로 분류된 항목): 계좌 안 재투자는 납입 아님
 *  kind=income(배당·이자 수령) 자체는 transfer가 아니라 애초에 집계 대상이 아니다.
 *
 * ⚠ 한도·공제율은 2026년 기준 개략치(TAX_SHELTER_RULES_2026) — 실제 세액은 총급여·종합소득·가입 시점·
 *  만기 등에 따라 달라지므로 안내 목적으로만 쓴다(면책 문구는 UI에서).
 */
import type { Account, AccountType, LedgerEntry, TaxShelterKind } from "../types";
import { isCurrencyExchangeEntry } from "./categoryUtils";
import { isDividendEntryLoose, isInterestEntryLoose } from "./categoryMatch";
import { toKrwByRate } from "./currency";

/**
 * 기준연도 2026 — 개략치. ISA 연 납입 2,000만·누적 1억(미사용 한도 이월은 반영 안 함).
 * 연금계좌(연금저축+IRP 합산) 납입한도 1,800만, 세액공제 대상 납입은 연금저축 600만·연금계좌 합산 900만.
 * 공제율은 총급여 5,500만(종합소득 4,500만) 이하 16.5%, 초과 13.2%(지방세 포함) — 사용자가 선택.
 */
export const TAX_SHELTER_RULES_2026 = {
  baseYear: 2026,
  isa: { annualLimit: 20_000_000, lifetimeLimit: 100_000_000 },
  pensionAccount: {
    /** 연금저축+IRP 합산 연 납입한도 */
    annualLimit: 18_000_000,
    /** 연금저축 단독 세액공제 한도 */
    pensionCreditCap: 6_000_000,
    /** 연금저축+IRP 합산 세액공제 한도 */
    combinedCreditCap: 9_000_000,
  },
  creditRates: { low: 0.165, high: 0.132 },
} as const;

/** 계좌 폼 select 옵션 — ""=일반(과세) */
export const TAX_SHELTER_OPTIONS: ReadonlyArray<{ value: TaxShelterKind | ""; label: string }> = [
  { value: "", label: "일반 (과세계좌)" },
  { value: "isa", label: "ISA (중개형·신탁형)" },
  { value: "pension", label: "연금저축 (펀드·보험)" },
  { value: "irp", label: "IRP (개인형 퇴직연금)" },
];

/** 세제 성격을 지정할 수 있는 계좌 유형 — 카드·암호화폐는 해당 없음 */
export const TAX_SHELTER_ELIGIBLE_TYPES: ReadonlySet<AccountType> = new Set<AccountType>(["securities", "savings", "checking", "other"]);

/** 기본 공제율 — 보수적으로 13.2% (과대 추정보다 과소가 안전) */
export const DEFAULT_TAX_CREDIT_RATE: number = TAX_SHELTER_RULES_2026.creditRates.high;

interface ShelterContributions {
  year: number;
  /** taxShelter가 지정된 계좌가 하나라도 있는가 (없으면 카드는 안내만) */
  hasShelterAccounts: boolean;
  isa: {
    accountCount: number;
    paid: number;
    annualLimit: number;
    /** 올해 남은 납입 가능액 (max 0) */
    limitLeft: number;
  };
  pension: {
    /** 연금저축·IRP 계좌 수 합 */
    accountCount: number;
    paidPension: number;
    paidIrp: number;
    paidTotal: number;
    annualLimit: number;
    /** 연금계좌 합산 남은 납입 가능액 (max 0) */
    limitLeft: number;
    /** 올해 납입 중 세액공제 대상 금액 (연금저축 600만·합산 900만 캡 적용) */
    creditable: number;
    /** 공제 한도까지 더 넣을 수 있는 금액 (연금저축 캡·합산 캡 중 유효한 여유분) */
    creditableLeft: number;
    creditRate: number;
    /** 예상 세액공제액 = creditable × creditRate (개략) */
    estCredit: number;
  };
  /** 제외된 건수 진단 — 환전 / 절세계좌 간 내부 이체 / 배당·이자 재투자 */
  excluded: { exchange: number; internal: number; reinvest: number };
}

/** 절세계좌 id → 종류 맵. taxShelter 미지정 계좌는 제외 */
export function buildShelterAccountMap(accounts: Account[]): Map<string, NonNullable<Account["taxShelter"]>> {
  const m = new Map<string, NonNullable<Account["taxShelter"]>>();
  for (const a of accounts) if (a.taxShelter) m.set(a.id, a.taxShelter);
  return m;
}

export function buildShelterContributions(
  ledger: LedgerEntry[],
  accounts: Account[],
  year: number,
  fxRate?: number | null,
  opts?: { creditRate?: number }
): ShelterContributions {
  const rules = TAX_SHELTER_RULES_2026;
  const creditRate = opts?.creditRate ?? DEFAULT_TAX_CREDIT_RATE;
  const shelter = buildShelterAccountMap(accounts);
  const yearStr = String(year);

  let isaCount = 0;
  let pensionCount = 0;
  for (const kind of shelter.values()) {
    if (kind === "isa") isaCount += 1;
    else pensionCount += 1;
  }

  let paidIsa = 0;
  let paidPension = 0;
  let paidIrp = 0;
  const excluded = { exchange: 0, internal: 0, reinvest: 0 };

  for (const e of ledger) {
    if (e.kind !== "transfer" || !e.toAccountId || !e.date?.startsWith(yearStr)) continue;
    const kind = shelter.get(e.toAccountId);
    if (!kind) continue;
    if (isCurrencyExchangeEntry(e)) { excluded.exchange += 1; continue; }
    if (e.fromAccountId && shelter.has(e.fromAccountId)) { excluded.internal += 1; continue; }
    if (isDividendEntryLoose(e) || isInterestEntryLoose(e)) { excluded.reinvest += 1; continue; }
    const krw = toKrwByRate(Number(e.amount) || 0, e.currency, fxRate);
    if (krw <= 0) continue;
    if (kind === "isa") paidIsa += krw;
    else if (kind === "pension") paidPension += krw;
    else paidIrp += krw;
  }

  const paidTotal = paidPension + paidIrp;
  const pr = rules.pensionAccount;
  // 세액공제 대상: 연금저축은 600만까지, 거기에 IRP를 더해 합산 900만까지
  const creditablePension = Math.min(paidPension, pr.pensionCreditCap);
  const creditable = Math.min(creditablePension + paidIrp, pr.combinedCreditCap);
  const creditableLeft = Math.max(0, pr.combinedCreditCap - creditable);

  return {
    year,
    hasShelterAccounts: shelter.size > 0,
    isa: {
      accountCount: isaCount,
      paid: paidIsa,
      annualLimit: rules.isa.annualLimit,
      limitLeft: Math.max(0, rules.isa.annualLimit - paidIsa),
    },
    pension: {
      accountCount: pensionCount,
      paidPension,
      paidIrp,
      paidTotal,
      annualLimit: pr.annualLimit,
      limitLeft: Math.max(0, pr.annualLimit - paidTotal),
      creditable,
      creditableLeft,
      creditRate,
      estCredit: creditable * creditRate,
    },
    excluded,
  };
}
