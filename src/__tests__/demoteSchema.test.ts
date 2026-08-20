import { describe, it, expect } from "vitest";
import { applyDemoteSchema, previewDemoteSchema } from "../utils/demoteSchema";
import type { AppData, LedgerEntry } from "../types";

/**
 * 3세대 혼재 픽스처.
 *  - 표준(옛 구조): cat=지출/수입/이체, sub=대분류, det=소분류
 *  - 잘못 저장된 새 구조: cat=대분류 직접, sub=소분류
 *  - 시스템 분류(신용결제/재테크)는 cat 직접이어도 demote 대상 아님
 */
function entry(partial: Partial<LedgerEntry> & Pick<LedgerEntry, "id" | "kind" | "category">): LedgerEntry {
  return {
    date: "2026-03-10",
    description: "",
    amount: 10_000,
    ...partial,
  };
}

const STANDARD: LedgerEntry[] = [
  entry({ id: "S1", kind: "expense", category: "지출", subCategory: "식비", detailCategory: "시장/마트", description: "장보기" }),
  entry({ id: "S2", kind: "income", category: "수입", subCategory: "급여", description: "월급", toAccountId: "A1" }),
  entry({ id: "S3", kind: "transfer", category: "이체", subCategory: "저축이체", fromAccountId: "A1", toAccountId: "A2" }),
  // 신용결제(현행 transfer) — 카드결제이체
  entry({ id: "S4", kind: "transfer", category: "이체", subCategory: "카드결제이체", fromAccountId: "A1", toAccountId: "C1" }),
  // 정산 입금 (kind income + toAccountId)
  entry({ id: "S5", kind: "income", category: "수입", subCategory: "정산", toAccountId: "A1", settledLedgerIds: ["X1", "X2"] }),
  // 환전(표준 구조)
  entry({ id: "S6", kind: "transfer", category: "이체", subCategory: "환전", fromAccountId: "A1", toAccountId: "A3", currency: "USD", amount: 100 }),
  // 대출 상환 3세대 (detailCategory=이자상환)
  entry({ id: "S7", kind: "expense", category: "지출", subCategory: "대출상환", detailCategory: "이자상환", loanId: "LN1", description: "주담대" }),
];

const SYSTEM_DIRECT: LedgerEntry[] = [
  // 레거시 신용결제 expense (category 직접) — demote 금지
  entry({ id: "Y1", kind: "expense", category: "신용결제", subCategory: "카드대금", description: "카드값" }),
  // 레거시 재테크 expense — demote 금지
  entry({ id: "Y2", kind: "expense", category: "재테크", subCategory: "투자손실", description: "손절" }),
];

const WRONG_NEW: LedgerEntry[] = [
  // cat=대분류 직접 / sub=소분류 / det 없음
  entry({ id: "W1", kind: "expense", category: "식비", subCategory: "시장/마트", description: "마트" }),
  // det까지 있는 드문 케이스 → det는 description 마커로 보존
  entry({ id: "W2", kind: "expense", category: "유류교통비", subCategory: "택시", detailCategory: "심야", description: "택시비" }),
  // 수입: cat=급여 직접
  entry({ id: "W3", kind: "income", category: "급여", description: "월급", toAccountId: "A1" }),
  // 이체: cat=환전 직접
  entry({ id: "W4", kind: "transfer", category: "환전", fromAccountId: "A1", toAccountId: "A3", currency: "USD", amount: 50 }),
  // 대출상환 2세대: cat=대출상환 직접, sub=이자상환
  entry({ id: "W5", kind: "expense", category: "대출상환", subCategory: "이자상환", loanId: "LN1" }),
  // 정산: cat=정산 직접(kind income)
  entry({ id: "W6", kind: "income", category: "정산", toAccountId: "A1", settledLedgerIds: ["X3"] }),
  // 빈 category
  entry({ id: "W7", kind: "expense", category: "", description: "빈값" }),
];

function makeData(ledger: LedgerEntry[]): AppData {
  return {
    accounts: [],
    ledger,
    trades: [],
    prices: [],
    categoryPresets: { income: [], expense: [], transfer: [] },
    recurringExpenses: [],
    budgetGoals: [],
    customSymbols: [],
  };
}

describe("demoteSchema — applyDemoteSchema", () => {
  const data = makeData([...STANDARD, ...SYSTEM_DIRECT, ...WRONG_NEW]);
  const snapshot = JSON.parse(JSON.stringify(data)) as AppData;
  const result = applyDemoteSchema(data);
  const byId = new Map(result.ledger.map((e) => [e.id, e]));

  it("입력 데이터를 변형하지 않는다(불변)", () => {
    expect(data).toEqual(snapshot);
  });

  it("표준 구조 + 시스템 분류(신용결제/재테크)는 같은 참조 그대로 유지", () => {
    for (const e of [...STANDARD, ...SYSTEM_DIRECT]) {
      expect(byId.get(e.id)).toBe(e);
    }
  });

  it("ledger 외 필드는 그대로, ledger 길이·순서 보존", () => {
    expect(result.ledger.map((e) => e.id)).toEqual(data.ledger.map((e) => e.id));
    expect(result.accounts).toBe(data.accounts);
    expect(result.categoryPresets).toBe(data.categoryPresets);
  });

  it("W1: cat=식비/sub=시장/마트 → cat=지출/sub=식비/det=시장/마트 (나머지 필드 보존)", () => {
    const w1 = byId.get("W1")!;
    expect(w1.category).toBe("지출");
    expect(w1.subCategory).toBe("식비");
    expect(w1.detailCategory).toBe("시장/마트");
    expect(w1.description).toBe("마트");
    expect(w1.amount).toBe(10_000);
    expect(w1.date).toBe("2026-03-10");
  });

  it("W2: det가 이미 있던 항목은 description 마커 [원래소소분류:…]로 보존", () => {
    const w2 = byId.get("W2")!;
    expect(w2.category).toBe("지출");
    expect(w2.subCategory).toBe("유류교통비");
    expect(w2.detailCategory).toBe("택시");
    expect(w2.description).toBe("택시비 [원래소소분류:심야]");
  });

  it("W3: 수입 cat=급여 → cat=수입/sub=급여, toAccountId 보존", () => {
    const w3 = byId.get("W3")!;
    expect(w3.category).toBe("수입");
    expect(w3.subCategory).toBe("급여");
    expect(w3.detailCategory).toBeUndefined();
    expect(w3.toAccountId).toBe("A1");
  });

  it("W4: 이체 cat=환전 → cat=이체/sub=환전, currency/계좌 보존", () => {
    const w4 = byId.get("W4")!;
    expect(w4.category).toBe("이체");
    expect(w4.subCategory).toBe("환전");
    expect(w4.currency).toBe("USD");
    expect(w4.fromAccountId).toBe("A1");
    expect(w4.toAccountId).toBe("A3");
    expect(w4.amount).toBe(50);
  });

  it("W5: 대출상환 2세대 → cat=지출/sub=대출상환/det=이자상환, loanId 보존", () => {
    const w5 = byId.get("W5")!;
    expect(w5).toMatchObject({ category: "지출", subCategory: "대출상환", detailCategory: "이자상환", loanId: "LN1" });
  });

  it("W6: 정산 cat 직접 → cat=수입/sub=정산, settledLedgerIds 보존", () => {
    const w6 = byId.get("W6")!;
    expect(w6).toMatchObject({ category: "수입", subCategory: "정산", toAccountId: "A1", settledLedgerIds: ["X3"] });
  });

  it("W7: 빈 category → cat=지출, subCategory는 undefined", () => {
    const w7 = byId.get("W7")!;
    expect(w7.category).toBe("지출");
    expect(w7.subCategory).toBeUndefined();
    expect(w7.detailCategory).toBeUndefined();
    expect(w7.description).toBe("빈값");
  });

  it("멱등성: 두 번 적용해도 동일", () => {
    const twice = applyDemoteSchema(result);
    expect(twice).toEqual(result);
    // 두 번째 적용은 모든 항목이 표준이므로 참조도 그대로
    twice.ledger.forEach((e, i) => expect(e).toBe(result.ledger[i]));
  });

  it("기존 [원래소소분류:…] 마커는 중복 부착 없이 교체", () => {
    const d = makeData([
      entry({ id: "M1", kind: "expense", category: "식비", subCategory: "카페", detailCategory: "아침", description: "커피 [원래소소분류:옛값]" }),
    ]);
    const out = applyDemoteSchema(d).ledger[0];
    expect(out.description).toBe("커피 [원래소소분류:아침]");
    expect(out.description.match(/\[원래소소분류:/g)?.length).toBe(1);
  });

  it("det만 있고 sub가 없는 항목: det는 그대로 남고 마커도 부착 (preview.samples의 after.det와 다름)", () => {
    // 런타임 동작 기록: `...(oldSub ? {detailCategory: oldSub} : {})` 이라 oldSub가 없으면
    // spread된 원본 detailCategory가 남는다. preview.samples는 after.det=undefined 로 보여준다.
    const d = makeData([
      entry({ id: "D1", kind: "expense", category: "식비", detailCategory: "점심", description: "밥" }),
    ]);
    const out = applyDemoteSchema(d).ledger[0];
    expect(out.category).toBe("지출");
    expect(out.subCategory).toBe("식비");
    expect(out.detailCategory).toBe("점심");
    expect(out.description).toBe("밥 [원래소소분류:점심]");
    const pv = previewDemoteSchema(d);
    expect(pv.samples[0].after).toEqual({ cat: "지출", sub: "식비", det: undefined });
  });

  it("ledger가 비어 있거나 없어도 안전", () => {
    expect(applyDemoteSchema(makeData([])).ledger).toEqual([]);
    const noLedger = { ...makeData([]), ledger: undefined as unknown as LedgerEntry[] };
    expect(applyDemoteSchema(noLedger).ledger).toEqual([]);
  });
});

describe("demoteSchema — previewDemoteSchema", () => {
  const data = makeData([...STANDARD, ...SYSTEM_DIRECT, ...WRONG_NEW]);
  const preview = previewDemoteSchema(data);

  it("건수: affected = 실제 바뀐 항목 수, alreadyStandard + affected = totalLedger", () => {
    const result = applyDemoteSchema(data);
    const changed = result.ledger.filter((e, i) => e !== data.ledger[i]).length;
    expect(preview.affected).toBe(changed);
    expect(preview.affected).toBe(WRONG_NEW.length);
    expect(preview.alreadyStandard).toBe(STANDARD.length + SYSTEM_DIRECT.length);
    expect(preview.totalLedger).toBe(data.ledger.length);
    expect(preview.alreadyStandard + preview.affected).toBe(preview.totalLedger);
  });

  it("kind별 분포", () => {
    expect(preview.byKind).toEqual({ expense: 4, income: 2, transfer: 1 });
  });

  it("옛 cat 값별 건수 (빈 값은 '(빈값)')", () => {
    expect(preview.byOldCategory).toEqual({
      "식비": 1,
      "유류교통비": 1,
      "급여": 1,
      "환전": 1,
      "대출상환": 1,
      "정산": 1,
      "(빈값)": 1,
    });
  });

  it("samples는 최대 5개, before/after가 실제 변환과 일치", () => {
    expect(preview.samples.length).toBe(5);
    const result = applyDemoteSchema(data);
    const byId = new Map(result.ledger.map((e) => [e.id, e]));
    const w1 = byId.get("W1")!;
    expect(preview.samples[0]).toEqual({
      before: { cat: "식비", sub: "시장/마트", det: undefined },
      after: { cat: w1.category, sub: w1.subCategory, det: w1.detailCategory },
    });
  });

  it("모두 표준이면 affected 0, samples 빈 배열", () => {
    const pv = previewDemoteSchema(makeData([...STANDARD, ...SYSTEM_DIRECT]));
    expect(pv.affected).toBe(0);
    expect(pv.samples).toEqual([]);
    expect(pv.byOldCategory).toEqual({});
  });

  it("알 수 없는 kind는 집계에서 제외", () => {
    const weird = entry({ id: "Z1", kind: "bogus" as LedgerEntry["kind"], category: "식비" });
    const pv = previewDemoteSchema(makeData([weird]));
    expect(pv.affected).toBe(0);
    expect(pv.alreadyStandard).toBe(0);
    expect(pv.totalLedger).toBe(1);
    expect(applyDemoteSchema(makeData([weird])).ledger[0]).toBe(weird);
  });
});
