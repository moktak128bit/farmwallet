/**
 * 자주 쓰는 거래 템플릿 ↔ 폼 매핑(순수 함수) 단위 테스트.
 * - ledgerTemplateToForm: 템플릿 → 폼 적재 (날짜=오늘, id=undefined, 없는 계좌는 비우고 보고)
 * - ledgerFormToTemplate: 폼 → 템플릿 저장 (빈 값 undefined, kind별 계좌 필드 제거, USD amount 생략)
 */
import { describe, it, expect } from "vitest";
import {
  ledgerTemplateToForm,
  ledgerFormToTemplate,
  createDefaultLedgerForm,
} from "../utils/ledgerHelpers";
import { getTodayKST } from "../utils/date";
import type { LedgerTemplate } from "../types";

const accounts = [{ id: "농협" }, { id: "카카오" }];

describe("ledgerTemplateToForm", () => {
  it("지출 템플릿 → 카테고리/출금계좌/금액(콤마 포맷) 매핑 + 날짜=오늘 + id=undefined", () => {
    const t: LedgerTemplate = {
      id: "LT-1",
      name: "점심",
      kind: "expense",
      mainCategory: "식비",
      subCategory: "외식",
      description: "김밥천국",
      amount: 12000,
      fromAccountId: "농협",
    };
    const { form, clearedAccountIds } = ledgerTemplateToForm(t, accounts);
    expect(form.kind).toBe("expense");
    expect(form.mainCategory).toBe("식비");
    expect(form.subCategory).toBe("외식");
    expect(form.description).toBe("김밥천국");
    expect(form.fromAccountId).toBe("농협");
    expect(form.toAccountId).toBe("");
    expect(form.amount).toBe("12,000");
    expect(form.date).toBe(getTodayKST());
    expect(form.id).toBeUndefined();
    expect(clearedAccountIds).toEqual([]);
  });

  it("수입 템플릿 → mainCategory='' · fromAccountId='' (입금계좌만 사용)", () => {
    const t: LedgerTemplate = {
      id: "LT-2",
      name: "월급",
      kind: "income",
      subCategory: "급여",
      amount: 3000000,
      fromAccountId: "농협", // 수입엔 무의미한 값 — 무시되고 보고도 안 됨
      toAccountId: "카카오",
    };
    const { form, clearedAccountIds } = ledgerTemplateToForm(t, accounts);
    expect(form.kind).toBe("income");
    expect(form.mainCategory).toBe("");
    expect(form.subCategory).toBe("급여");
    expect(form.fromAccountId).toBe("");
    expect(form.toAccountId).toBe("카카오");
    expect(clearedAccountIds).toEqual([]);
  });

  it("이체 템플릿 → mainCategory='이체' 고정", () => {
    const t: LedgerTemplate = {
      id: "LT-3",
      name: "저축",
      kind: "transfer",
      mainCategory: "아무거나", // 무시되고 "이체"로 고정
      subCategory: "저축이체",
      fromAccountId: "농협",
      toAccountId: "카카오",
    };
    const { form } = ledgerTemplateToForm(t, accounts);
    expect(form.kind).toBe("transfer");
    expect(form.mainCategory).toBe("이체");
    expect(form.subCategory).toBe("저축이체");
    expect(form.fromAccountId).toBe("농협");
    expect(form.toAccountId).toBe("카카오");
  });

  it("존재하지 않는 계좌 → 해당 필드 비우고 clearedAccountIds로 보고", () => {
    const t: LedgerTemplate = {
      id: "LT-4",
      name: "환전",
      kind: "transfer",
      fromAccountId: "삭제된계좌",
      toAccountId: "카카오",
    };
    const { form, clearedAccountIds } = ledgerTemplateToForm(t, accounts);
    expect(form.fromAccountId).toBe("");
    expect(form.toAccountId).toBe("카카오");
    expect(clearedAccountIds).toEqual(["삭제된계좌"]);
  });

  it("amount 없으면 폼 amount는 빈 문자열", () => {
    const t: LedgerTemplate = {
      id: "LT-5",
      name: "커피",
      kind: "expense",
      mainCategory: "식비",
    };
    const { form } = ledgerTemplateToForm(t, accounts);
    expect(form.amount).toBe("");
  });
});

describe("ledgerFormToTemplate", () => {
  it("빈 문자열 필드는 undefined로 저장", () => {
    const form = {
      ...createDefaultLedgerForm(),
      kind: "expense" as const,
      mainCategory: "",
      subCategory: "",
      description: "  ",
      fromAccountId: "",
      amount: "",
    };
    const t = ledgerFormToTemplate(form, "expense", "빈칸", "LT-10");
    expect(t.id).toBe("LT-10");
    expect(t.mainCategory).toBeUndefined();
    expect(t.subCategory).toBeUndefined();
    expect(t.description).toBeUndefined();
    expect(t.amount).toBeUndefined();
    expect(t.fromAccountId).toBeUndefined();
    expect(t.toAccountId).toBeUndefined();
  });

  it("수입 → mainCategory/fromAccountId 제거", () => {
    const form = {
      ...createDefaultLedgerForm(),
      kind: "income" as const,
      mainCategory: "식비", // 잔존 값 — income이면 버려야 함
      subCategory: "급여",
      fromAccountId: "농협",
      toAccountId: "카카오",
      amount: "3,000,000",
    };
    const t = ledgerFormToTemplate(form, "income", "월급", "LT-11");
    expect(t.kind).toBe("income");
    expect(t.mainCategory).toBeUndefined();
    expect(t.subCategory).toBe("급여");
    expect(t.fromAccountId).toBeUndefined();
    expect(t.toAccountId).toBe("카카오");
    expect(t.amount).toBe(3000000);
  });

  it("지출 → toAccountId 제거", () => {
    const form = {
      ...createDefaultLedgerForm(),
      kind: "expense" as const,
      mainCategory: "식비",
      subCategory: "외식",
      fromAccountId: "농협",
      toAccountId: "카카오", // 잔존 값 — expense면 버려야 함
      amount: "12,000",
    };
    const t = ledgerFormToTemplate(form, "expense", "점심", "LT-12");
    expect(t.mainCategory).toBe("식비");
    expect(t.fromAccountId).toBe("농협");
    expect(t.toAccountId).toBeUndefined();
    expect(t.amount).toBe(12000);
  });

  it("currency=USD → amount 저장 생략 (KRW 오해석 방지)", () => {
    const form = {
      ...createDefaultLedgerForm(),
      kind: "transfer" as const,
      mainCategory: "이체",
      subCategory: "환전",
      fromAccountId: "농협",
      toAccountId: "카카오",
      amount: "1,234.56",
      currency: "USD" as const,
    };
    const t = ledgerFormToTemplate(form, "transfer", "환전", "LT-13");
    expect(t.amount).toBeUndefined();
    expect(t.subCategory).toBe("환전");
  });

  it("name은 trim해서 저장", () => {
    const form = { ...createDefaultLedgerForm(), kind: "expense" as const, mainCategory: "식비" };
    const t = ledgerFormToTemplate(form, "expense", "  점심  ", "LT-14");
    expect(t.name).toBe("점심");
  });
});
