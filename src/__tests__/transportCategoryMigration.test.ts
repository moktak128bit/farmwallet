import { describe, it, expect } from "vitest";
import {
  applyTransportMigration,
  previewTransportMigration,
  NEW_TRANSPORT_SUBS,
} from "../utils/transportCategoryMigration";
import type { AppData, LedgerEntry } from "../types";

function entry(partial: Partial<LedgerEntry> & Pick<LedgerEntry, "id" | "kind" | "category">): LedgerEntry {
  return {
    date: "2026-03-10",
    description: "",
    amount: 5_000,
    ...partial,
  };
}

const OLD_14 = [
  "버스/지하철", "택시", "기타교통", "유류비/충전비", "자동차용품", "수리비", "유지보수비",
  "톨비/하이패스", "주차비", "범칙금", "자동차보험", "자동차할부", "자동차세", "기차", "항공",
];

/** 변환 대상: A) 옛 구조 */
const A_OLD_STRUCT: LedgerEntry[] = [
  entry({ id: "A1", kind: "expense", category: "지출", subCategory: "유류교통비", detailCategory: "택시", description: "심야 귀가" }),
  entry({ id: "A2", kind: "expense", category: "지출", subCategory: "유류교통비", detailCategory: "톨비/하이패스" }),
  entry({ id: "A3", kind: "expense", category: "지출", subCategory: "유류교통비", detailCategory: "기차", fromAccountId: "ACC1", tags: ["출장"] }),
];

/** 변환 대상: B) 새 구조 */
const B_NEW_STRUCT: LedgerEntry[] = [
  entry({ id: "B1", kind: "expense", category: "유류교통비", subCategory: "주차비", description: "백화점 주차" }),
  entry({ id: "B2", kind: "expense", category: "유류교통비", subCategory: "자동차보험", isFixedExpense: true }),
];

/** 변경 없음 */
const UNTOUCHED: LedgerEntry[] = [
  // 이미 새 6개 소분류 (재적용 시 불변)
  entry({ id: "U1", kind: "expense", category: "지출", subCategory: "유류교통비", detailCategory: "대중교통", description: "지하철 [원래소분류:버스/지하철]" }),
  // 매핑 외 소분류
  entry({ id: "U2", kind: "expense", category: "지출", subCategory: "유류교통비", detailCategory: "세차" }),
  // det 빈값
  entry({ id: "U3", kind: "expense", category: "지출", subCategory: "유류교통비" }),
  // 다른 대분류
  entry({ id: "U4", kind: "expense", category: "지출", subCategory: "식비", detailCategory: "택시" }),
  // kind가 expense가 아님
  entry({ id: "U5", kind: "income", category: "수입", subCategory: "유류교통비", detailCategory: "택시" }),
  entry({ id: "U6", kind: "transfer", category: "이체", subCategory: "유류교통비", detailCategory: "택시", fromAccountId: "A", toAccountId: "B" }),
  // 신용결제·재테크 레거시
  entry({ id: "U7", kind: "expense", category: "신용결제", subCategory: "카드대금" }),
  entry({ id: "U8", kind: "expense", category: "재테크", subCategory: "투자손실" }),
  // 새 구조이나 매핑 외 sub
  entry({ id: "U9", kind: "expense", category: "유류교통비", subCategory: "렌트" }),
];

function makeData(ledger: LedgerEntry[], presets?: AppData["categoryPresets"]): AppData {
  return {
    accounts: [],
    ledger,
    trades: [],
    prices: [],
    categoryPresets: presets ?? {
      income: ["급여"],
      expense: ["식비", "유류교통비"],
      transfer: ["저축이체"],
      expenseDetails: [
        { main: "식비", subs: ["시장/마트", "카페"] },
        { main: "유류교통비", subs: [...OLD_14] },
      ],
    },
    recurringExpenses: [],
    budgetGoals: [],
    customSymbols: [],
  };
}

describe("transportCategoryMigration — applyTransportMigration", () => {
  const data = makeData([...A_OLD_STRUCT, ...B_NEW_STRUCT, ...UNTOUCHED]);
  const snapshot = JSON.parse(JSON.stringify(data)) as AppData;
  const result = applyTransportMigration(data);
  const byId = new Map(result.ledger.map((e) => [e.id, e]));

  it("입력 불변", () => {
    expect(data).toEqual(snapshot);
  });

  it("변경 대상 외 항목은 같은 참조", () => {
    for (const e of UNTOUCHED) expect(byId.get(e.id)).toBe(e);
    expect(result.ledger.map((e) => e.id)).toEqual(data.ledger.map((e) => e.id));
  });

  it("A) 옛 구조: det만 매핑, description에 [원래소분류:…] 부착, 나머지 필드 보존", () => {
    expect(byId.get("A1")).toMatchObject({
      category: "지출", subCategory: "유류교통비", detailCategory: "대중교통",
      description: "심야 귀가 [원래소분류:택시]",
    });
    expect(byId.get("A2")).toMatchObject({ detailCategory: "통행·주차", description: "[원래소분류:톨비/하이패스]" });
    expect(byId.get("A3")).toMatchObject({
      detailCategory: "장거리", description: "[원래소분류:기차]", fromAccountId: "ACC1", tags: ["출장"], amount: 5_000,
    });
  });

  it("B) 새 구조: sub만 매핑, det는 건드리지 않음", () => {
    expect(byId.get("B1")).toMatchObject({ category: "유류교통비", subCategory: "통행·주차", description: "백화점 주차 [원래소분류:주차비]" });
    expect(byId.get("B1")!.detailCategory).toBeUndefined();
    expect(byId.get("B2")).toMatchObject({ subCategory: "차량 고정비", isFixedExpense: true, description: "[원래소분류:자동차보험]" });
  });

  it("15개 옛 이름 전부 6개 중 하나로 매핑", () => {
    const d = makeData(OLD_14.map((name, i) => entry({ id: `X${i}`, kind: "expense", category: "지출", subCategory: "유류교통비", detailCategory: name })));
    const out = applyTransportMigration(d);
    for (const e of out.ledger) {
      expect(NEW_TRANSPORT_SUBS).toContain(e.detailCategory);
    }
    expect(new Set(out.ledger.map((e) => e.detailCategory)).size).toBe(6);
  });

  it("categoryPresets: 유류교통비 그룹만 6개로 교체, 다른 그룹 유지", () => {
    const groups = result.categoryPresets.expenseDetails!;
    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual({ main: "식비", subs: ["시장/마트", "카페"] });
    expect(groups[1]).toEqual({ main: "유류교통비", subs: NEW_TRANSPORT_SUBS });
    expect(result.categoryPresets.income).toEqual(["급여"]);
    expect(result.categoryPresets.expense).toEqual(["식비", "유류교통비"]);
  });

  it("categoryPresets에 유류교통비 그룹이 없으면 추가, presets 자체가 없으면 생성", () => {
    const noGroup = applyTransportMigration(makeData([], { income: [], expense: [], transfer: [], expenseDetails: [{ main: "식비", subs: [] }] }));
    expect(noGroup.categoryPresets.expenseDetails).toEqual([
      { main: "식비", subs: [] },
      { main: "유류교통비", subs: NEW_TRANSPORT_SUBS },
    ]);
    const noPresets = applyTransportMigration({ ...makeData([]), categoryPresets: undefined as unknown as AppData["categoryPresets"] });
    expect(noPresets.categoryPresets).toEqual({
      income: [], expense: [], transfer: [],
      expenseDetails: [{ main: "유류교통비", subs: NEW_TRANSPORT_SUBS }],
    });
  });

  it("멱등성: 두 번 적용해도 동일 + 마커 중복 없음", () => {
    const twice = applyTransportMigration(result);
    expect(twice).toEqual(result);
    twice.ledger.forEach((e, i) => expect(e).toBe(result.ledger[i]));
    for (const e of twice.ledger) {
      const n = (e.description.match(/\[원래소분류:/g) ?? []).length;
      expect(n).toBeLessThanOrEqual(1);
    }
  });

  it("기존 [원래소분류:…] 마커가 있으면 교체(중복 부착 없음)", () => {
    const d = makeData([
      entry({ id: "M1", kind: "expense", category: "지출", subCategory: "유류교통비", detailCategory: "택시", description: "이동 [원래소분류:옛값]" }),
    ]);
    const out = applyTransportMigration(d).ledger[0];
    expect(out.description).toBe("이동 [원래소분류:택시]");
  });

  it("ledger 없음/빈 배열도 안전", () => {
    expect(applyTransportMigration(makeData([])).ledger).toEqual([]);
    const noLedger = { ...makeData([]), ledger: undefined as unknown as LedgerEntry[] };
    expect(applyTransportMigration(noLedger).ledger).toEqual([]);
  });
});

describe("transportCategoryMigration — previewTransportMigration", () => {
  const data = makeData([...A_OLD_STRUCT, ...B_NEW_STRUCT, ...UNTOUCHED]);
  const preview = previewTransportMigration(data);

  it("ledgerAffected = 실제 변경 건수", () => {
    const result = applyTransportMigration(data);
    const changed = result.ledger.filter((e, i) => e !== data.ledger[i]).length;
    expect(preview.ledgerAffected).toBe(changed);
    expect(preview.ledgerAffected).toBe(A_OLD_STRUCT.length + B_NEW_STRUCT.length);
  });

  it("구조별 분포 / 옛·새 이름별 건수", () => {
    expect(preview.byStructure).toEqual({ oldStructure: 3, newStructure: 2 });
    expect(preview.countByOldName).toEqual({ "택시": 1, "톨비/하이패스": 1, "기차": 1, "주차비": 1, "자동차보험": 1 });
    expect(preview.countByNewName).toEqual({ "대중교통": 1, "통행·주차": 2, "장거리": 1, "차량 고정비": 1 });
  });

  it("매핑 외 값은 unmappedNotices(정렬·중복 제거), 변경되지 않음", () => {
    expect(preview.unmappedNotices).toEqual(["(빈값)", "대중교통", "렌트", "세차"]);
  });

  it("presetsNeedUpdate: 적용 전 true, 적용 후 false", () => {
    expect(preview.presetsNeedUpdate).toBe(true);
    const after = previewTransportMigration(applyTransportMigration(data));
    expect(after.presetsNeedUpdate).toBe(false);
    expect(after.ledgerAffected).toBe(0);
    expect(after.countByOldName).toEqual({});
  });

  it("presets 순서가 다르면 presetsNeedUpdate true", () => {
    const reversed = makeData([], { income: [], expense: [], transfer: [], expenseDetails: [{ main: "유류교통비", subs: [...NEW_TRANSPORT_SUBS].reverse() }] });
    expect(previewTransportMigration(reversed).presetsNeedUpdate).toBe(true);
  });
});
