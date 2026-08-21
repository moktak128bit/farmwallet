/**
 * 가계부 폼 드래프트 직렬화/복원 — 수정 모드 제외·손상 JSON·만료·필드 보정.
 */
import { describe, it, expect } from "vitest";
import {
  serializeLedgerFormDraft,
  parseLedgerFormDraft,
  hasLedgerDraftContent,
  LEDGER_FORM_DRAFT_MAX_AGE_MS,
  type LedgerFormDraft,
} from "../utils/ledgerFormDraft";
import { createDefaultLedgerForm } from "../utils/ledgerHelpers";

const NOW = 1_700_000_000_000;

const mkDraft = (over: Partial<LedgerFormDraft["form"]> = {}, tab: LedgerFormDraft["ledgerTab"] = "expense"): LedgerFormDraft => ({
  form: { ...createDefaultLedgerForm(), kind: "expense", mainCategory: "식비", subCategory: "카페", amount: "4,500", description: "스타벅스", fromAccountId: "신한", ...over },
  ledgerTab: tab,
  formKind: "expense",
});

describe("serializeLedgerFormDraft", () => {
  it("금액/설명이 있는 신규 입력은 직렬화되고 왕복 복원된다", () => {
    const d = mkDraft();
    const raw = serializeLedgerFormDraft(d, NOW);
    expect(raw).toBeTruthy();
    const back = parseLedgerFormDraft(raw, NOW + 1000);
    expect(back).not.toBeNull();
    expect(back!.form).toEqual(d.form);
    expect(back!.ledgerTab).toBe("expense");
    expect(back!.formKind).toBe("expense");
  });

  it("수정 모드(form.id)는 저장하지 않는다", () => {
    expect(serializeLedgerFormDraft(mkDraft({ id: "L1" }), NOW)).toBeNull();
  });

  it("금액·설명 둘 다 비면 저장하지 않는다 (카테고리만 누른 상태)", () => {
    expect(serializeLedgerFormDraft(mkDraft({ amount: "", description: "  " }), NOW)).toBeNull();
    expect(hasLedgerDraftContent({ amount: "", description: "" })).toBe(false);
    expect(hasLedgerDraftContent({ amount: "", description: "x" })).toBe(true);
    expect(hasLedgerDraftContent({ amount: "1", description: "" })).toBe(true);
  });
});

describe("parseLedgerFormDraft", () => {
  it("손상 JSON·빈 값·엉뚱한 형태는 null", () => {
    expect(parseLedgerFormDraft(null, NOW)).toBeNull();
    expect(parseLedgerFormDraft("", NOW)).toBeNull();
    expect(parseLedgerFormDraft("{not json", NOW)).toBeNull();
    expect(parseLedgerFormDraft("42", NOW)).toBeNull();
    expect(parseLedgerFormDraft(JSON.stringify({ v: 1, savedAt: NOW }), NOW)).toBeNull();
    expect(parseLedgerFormDraft(JSON.stringify({ v: 99, savedAt: NOW, draft: mkDraft() }), NOW)).toBeNull();
  });

  it("24시간 지나면 만료 / 미래 savedAt(시계 역행)도 거부", () => {
    const raw = serializeLedgerFormDraft(mkDraft(), NOW)!;
    expect(parseLedgerFormDraft(raw, NOW + LEDGER_FORM_DRAFT_MAX_AGE_MS - 1)).not.toBeNull();
    expect(parseLedgerFormDraft(raw, NOW + LEDGER_FORM_DRAFT_MAX_AGE_MS + 1)).toBeNull();
    expect(parseLedgerFormDraft(raw, NOW - 120_000)).toBeNull();
  });

  it("수정 모드 드래프트(저장소에 직접 들어온 id)는 복원하지 않는다", () => {
    const raw = JSON.stringify({ v: 1, savedAt: NOW, draft: { ...mkDraft(), form: { ...mkDraft().form, id: "L9" } } });
    expect(parseLedgerFormDraft(raw, NOW)).toBeNull();
  });

  it("알 수 없는 탭/kind는 거부, 손상 필드는 기본값으로 보정", () => {
    const bad = JSON.stringify({ v: 1, savedAt: NOW, draft: { ...mkDraft(), ledgerTab: "weird" } });
    expect(parseLedgerFormDraft(bad, NOW)).toBeNull();
    const badKind = JSON.stringify({ v: 1, savedAt: NOW, draft: { ...mkDraft(), formKind: "nope" } });
    expect(parseLedgerFormDraft(badKind, NOW)).toBeNull();
    const corruptFields = JSON.stringify({
      v: 1,
      savedAt: NOW,
      draft: {
        ledgerTab: "income",
        formKind: "income",
        form: { amount: 1234, description: "월급", kind: "income", tags: ["a", 5, null], currency: "EUR", mainCategory: null, date: 20260101 },
      },
    });
    const r = parseLedgerFormDraft(corruptFields, NOW);
    expect(r).not.toBeNull();
    expect(r!.form.amount).toBe(""); // 숫자형 금액은 버림
    expect(r!.form.description).toBe("월급");
    expect(r!.form.tags).toEqual(["a"]);
    expect(r!.form.currency).toBe("KRW");
    expect(r!.form.mainCategory).toBe("");
    expect(r!.form.date).toBe("");
    expect(r!.form.id).toBeUndefined();
  });
});
