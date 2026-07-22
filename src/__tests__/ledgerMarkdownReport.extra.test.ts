import { describe, it, expect } from "vitest";
import { generateLedgerMarkdownReport } from "../utils/ledgerMarkdownReport";
import type { Account, LedgerEntry } from "../types";

const account = (o: Partial<Account> & { id: string }): Account =>
  ({ name: o.id, institution: "", type: "checking", initialBalance: 0, ...o } as Account);
const entry = (o: Partial<LedgerEntry> & { id: string }): LedgerEntry =>
  ({ date: "2026-01-15", kind: "expense", category: "지출", description: "", amount: 1000, ...o } as LedgerEntry);

describe("정리.md — P2 정합 회귀 (2026-07-22)", () => {
  it("월별 통계도 신용결제를 제외한다 — 총계 지출과 일치 (이중계상 회귀)", () => {
    const accounts = [account({ id: "a1" })];
    const ledger = [
      entry({ id: "e1", subCategory: "식비", fromAccountId: "a1", amount: 20_000 }),
      // 레거시 신용결제 — 그룹 분류는 제외했지만 예전 월별 루프는 지출로 더해 어긋났다
      entry({ id: "e2", category: "신용결제", fromAccountId: "a1", amount: 500_000 }),
    ];
    const md = generateLedgerMarkdownReport(ledger, accounts);
    // 총계 지출 = 20,000원, 월별(2026-01) 지출도 20,000원이어야 한다
    expect(md).toContain("| 총 지출 | 20,000원 |");
    expect(md).toContain("| 2026-01 | 0원 | 20,000원 |");
  });

  it("카테고리별 표가 '대분류 > 소분류' 키를 쓴다 (래퍼 '지출 >' 제거)", () => {
    const accounts = [account({ id: "a1" })];
    const ledger = [
      entry({ id: "e1", subCategory: "식비", detailCategory: "시장", fromAccountId: "a1", amount: 30_000 }),
      entry({ id: "e2", subCategory: "식비", fromAccountId: "a1", amount: 5_000 }),
    ];
    const md = generateLedgerMarkdownReport(ledger, accounts);
    expect(md).toContain("| 식비 > 시장 | 30,000원 |");
    expect(md).toContain("| 식비 | 5,000원 |");
    expect(md).not.toContain("지출 > 식비");
  });
});
