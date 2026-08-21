import { describe, it, expect } from "vitest";
import type { ColumnMapping } from "../utils/statementImport/parseDelimited";
import { buildImportPreview, finalizeImportRows } from "../utils/statementImport/buildImportPreview";
import type { LedgerEntry } from "../types";

const MAPPING: ColumnMapping = { dateCol: 0, merchantCol: 1, amountCol: 2 };
const MAPPING_WITH_STATUS: ColumnMapping = { dateCol: 0, merchantCol: 1, amountCol: 2, statusCol: 3 };
const MAPPING_WITH_CURRENCY: ColumnMapping = { dateCol: 0, merchantCol: 1, amountCol: 2, currencyCol: 3 };
const CARD_ID = "acc-card-1";

const baseOptions = { cardAccountId: CARD_ID, ledger: [] as LedgerEntry[], fxRate: 1300, today: "2026-08-21" };

describe("buildImportPreview — 지출 전용, kind=expense 고정", () => {
  it("신규 행은 status=new, included=true, kind=expense 초안", () => {
    const rows = [["2026.08.15", "스타벅스 강남점", "5,500"]];
    const [r] = buildImportPreview(rows, MAPPING, baseOptions);
    expect(r.status).toBe("new");
    expect(r.included).toBe(true);
    expect(r.draft?.kind).toBe("expense");
    expect(r.draft?.fromAccountId).toBe(CARD_ID);
    expect(r.draft?.amount).toBe(5500);
    expect(r.draft?.date).toBe("2026-08-15");
    expect(r.draft?.category).toBe("지출");
  });

  it("날짜를 인식할 수 없으면 invalid", () => {
    const rows = [["알수없음", "스타벅스", "5,500"]];
    const [r] = buildImportPreview(rows, MAPPING, baseOptions);
    expect(r.status).toBe("invalid");
    expect(r.included).toBe(false);
    expect(r.reason).toContain("날짜");
    expect(r.draft).toBeUndefined();
  });

  it("금액이 0/빈 값이면 invalid", () => {
    const rows = [["2026.08.15", "스타벅스", ""]];
    const [r] = buildImportPreview(rows, MAPPING, baseOptions);
    expect(r.status).toBe("invalid");
    expect(r.reason).toContain("금액");
  });

  it("가맹점/내용이 비어 있으면 invalid", () => {
    const rows = [["2026.08.15", "  ", "5,500"]];
    const [r] = buildImportPreview(rows, MAPPING, baseOptions);
    expect(r.status).toBe("invalid");
    expect(r.reason).toContain("가맹점");
  });

  it("선행 마이너스 금액(취소)은 invalid + 경고, 기본 제외", () => {
    const rows = [["2026.08.15", "스타벅스", "-5,500"]];
    const [r] = buildImportPreview(rows, MAPPING, baseOptions);
    expect(r.status).toBe("invalid");
    expect(r.included).toBe(false);
    expect(r.reason).toContain("취소");
  });

  it("승인구분 열에 '취소'가 있으면 invalid + 경고", () => {
    const rows = [["2026.08.15", "스타벅스", "5,500", "취소"]];
    const [r] = buildImportPreview(rows, MAPPING_WITH_STATUS, baseOptions);
    expect(r.status).toBe("invalid");
    expect(r.reason).toContain("취소");
  });

  it("환불 상태도 제외", () => {
    const rows = [["2026.08.15", "스타벅스", "5,500", "환불완료"]];
    const [r] = buildImportPreview(rows, MAPPING_WITH_STATUS, baseOptions);
    expect(r.status).toBe("invalid");
  });
});

describe("buildImportPreview — 중복 판정", () => {
  const existing: LedgerEntry = {
    id: "L-1",
    date: "2026-08-15",
    kind: "expense",
    category: "지출",
    subCategory: "식비",
    description: "스타벅스 강남점",
    amount: 5500,
    fromAccountId: CARD_ID,
  };

  it("날짜·금액·설명 완전 일치 → duplicate-exact, 기본 제외", () => {
    const rows = [["2026.08.15", "스타벅스 강남점", "5,500"]];
    const [r] = buildImportPreview(rows, MAPPING, { ...baseOptions, ledger: [existing] });
    expect(r.status).toBe("duplicate-exact");
    expect(r.included).toBe(false);
    // 사용자가 원하면 다시 켤 수 있게 draft는 여전히 만들어져 있어야 함
    expect(r.draft).toBeDefined();
  });

  it("날짜 ±1일 + 금액 일치, 설명 다름 → duplicate-probable, 기본 제외", () => {
    const rows = [["2026.08.16", "스타벅스코리아 강남2호점", "5,500"]];
    const [r] = buildImportPreview(rows, MAPPING, { ...baseOptions, ledger: [existing] });
    expect(r.status).toBe("duplicate-probable");
    expect(r.included).toBe(false);
  });

  it("금액이 다르면 중복이 아니다", () => {
    const rows = [["2026.08.15", "스타벅스 강남점", "6,000"]];
    const [r] = buildImportPreview(rows, MAPPING, { ...baseOptions, ledger: [existing] });
    expect(r.status).toBe("new");
    expect(r.included).toBe(true);
  });

  it("다른 계좌의 동일 거래는 중복으로 보지 않는다", () => {
    const rows = [["2026.08.15", "스타벅스 강남점", "5,500"]];
    const [r] = buildImportPreview(rows, MAPPING, { ...baseOptions, cardAccountId: "acc-other", ledger: [existing] });
    expect(r.status).toBe("new");
  });

  it("같은 배치 안에 완전 동일한 행이 나란히 있으면 두 번째는 duplicate-exact", () => {
    const rows = [
      ["2026.08.01", "스타벅스 강남점", "5,500"],
      ["2026.08.02", "GS25", "3,200"],
      ["2026.08.01", "스타벅스 강남점", "5,500"],
    ];
    const [first, second, third] = buildImportPreview(rows, MAPPING, baseOptions);
    expect(first.status).toBe("new");
    expect(first.included).toBe(true);
    expect(second.status).toBe("new");
    expect(third.status).toBe("duplicate-exact");
    expect(third.included).toBe(false);
  });

  it("같은 배치 내 날짜 ±1일 + 금액 일치(설명 다름)도 duplicate-probable로 잡는다", () => {
    const rows = [
      ["2026.08.01", "스타벅스 강남점", "5,500"],
      ["2026.08.02", "스타벅스코리아 강남2호점", "5,500"],
    ];
    const [first, second] = buildImportPreview(rows, MAPPING, baseOptions);
    expect(first.status).toBe("new");
    expect(second.status).toBe("duplicate-probable");
    expect(second.included).toBe(false);
  });
});

describe("buildImportPreview — USD 열", () => {
  it("환율 로드됨 → USD 항목 포함", () => {
    const rows = [["2026.08.15", "Amazon", "12.34", "USD"]];
    const [r] = buildImportPreview(rows, MAPPING_WITH_CURRENCY, baseOptions);
    expect(r.status).toBe("new");
    expect(r.draft?.currency).toBe("USD");
    expect(r.draft?.amount).toBeCloseTo(12.34);
  });

  it("환율 미로드(null) → USD 항목은 invalid로 차단", () => {
    const rows = [["2026.08.15", "Amazon", "12.34", "USD"]];
    const [r] = buildImportPreview(rows, MAPPING_WITH_CURRENCY, { ...baseOptions, fxRate: null });
    expect(r.status).toBe("invalid");
    expect(r.reason).toContain("환율");
    expect(r.draft).toBeUndefined();
  });
});

describe("buildImportPreview — 할부 표기", () => {
  it("할부 열이 있으면 설명에 접미사로 보존", () => {
    const mapping: ColumnMapping = { dateCol: 0, merchantCol: 1, amountCol: 2, installmentCol: 3 };
    const rows = [["2026.08.15", "하이마트", "300,000", "3개월"]];
    const [r] = buildImportPreview(rows, mapping, baseOptions);
    expect(r.draft?.description).toBe("하이마트 (할부 3개월)");
  });

  it("일시불 표기는 접미사를 붙이지 않는다", () => {
    const mapping: ColumnMapping = { dateCol: 0, merchantCol: 1, amountCol: 2, installmentCol: 3 };
    const rows = [["2026.08.15", "하이마트", "300,000", "일시불"]];
    const [r] = buildImportPreview(rows, mapping, baseOptions);
    expect(r.draft?.description).toBe("하이마트");
  });
});

describe("finalizeImportRows — 적용 시 id·태그 부여", () => {
  it("included 행만 LedgerEntry로 변환하고 import 태그를 추가한다", () => {
    const rows = [
      ["2026.08.15", "스타벅스", "5,500"],
      ["2026.08.16", "이마트", "30,000"],
    ];
    const preview = buildImportPreview(rows, MAPPING, baseOptions);
    // 두 번째 행은 사용자가 수동으로 제외했다고 가정
    preview[1].included = false;

    const entries = finalizeImportRows(preview, "import:2026-08-21-1200");
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toMatch(/^L-/);
    expect(entries[0].tags).toContain("import:2026-08-21-1200");
    expect(entries[0].amount).toBe(5500);
  });

  it("draft 없는(invalid) 행은 included여도 제외된다", () => {
    const rows = [["알수없음", "스타벅스", "5,500"]];
    const preview = buildImportPreview(rows, MAPPING, baseOptions);
    preview[0].included = true; // draft가 없으므로 강제로 true를 넣어도 안전해야 함
    const entries = finalizeImportRows(preview, "import:2026-08-21-1200");
    expect(entries).toHaveLength(0);
  });
});
