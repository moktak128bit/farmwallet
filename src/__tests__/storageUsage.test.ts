import { describe, it, expect } from "vitest";
import {
  measureLocalStorageUsage,
  formatStorageBytes,
  getStorageUsageLevel,
  LOCAL_STORAGE_LIMIT_BYTES
} from "../utils/storageUsage";
import { STORAGE_KEYS } from "../constants/config";

/** Storage 인터페이스 최소 구현 (length/key/getItem) */
function fakeStorage(entries: Record<string, string>): Pick<Storage, "length" | "key" | "getItem"> {
  const keys = Object.keys(entries);
  return {
    length: keys.length,
    key: (i: number) => keys[i] ?? null,
    getItem: (k: string) => (k in entries ? entries[k] : null)
  };
}

describe("measureLocalStorageUsage", () => {
  it("빈 스토리지 → 0 바이트, ok 레벨", () => {
    const r = measureLocalStorageUsage(fakeStorage({}), STORAGE_KEYS);
    expect(r.items).toEqual([]);
    expect(r.totalBytes).toBe(0);
    expect(r.other).toEqual({ bytes: 0, count: 0 });
    expect(r.backup).toEqual({ bytes: 0, count: 0, avgBytes: 0 });
    expect(r.ratio).toBe(0);
    expect(r.percent).toBe(0);
    expect(r.level).toBe("ok");
    expect(r.limitBytes).toBe(LOCAL_STORAGE_LIMIT_BYTES);
  });

  it("키별 바이트 = (key.length + value.length) * 2, 내림차순 정렬", () => {
    const data = "x".repeat(100);
    const theme = "dark";
    const r = measureLocalStorageUsage(
      fakeStorage({ [STORAGE_KEYS.THEME]: theme, [STORAGE_KEYS.DATA]: data }),
      STORAGE_KEYS
    );
    expect(r.items.map((i) => i.name)).toEqual(["DATA", "THEME"]);
    const dataItem = r.items[0];
    expect(dataItem.key).toBe(STORAGE_KEYS.DATA);
    expect(dataItem.bytes).toBe((STORAGE_KEYS.DATA.length + 100) * 2);
    expect(dataItem.label).toBe("앱 데이터(본문)");
    expect(dataItem.ratio).toBeCloseTo(dataItem.bytes / LOCAL_STORAGE_LIMIT_BYTES, 12);
    const themeItem = r.items[1];
    expect(themeItem.bytes).toBe((STORAGE_KEYS.THEME.length + 4) * 2);
    expect(r.totalBytes).toBe(dataItem.bytes + themeItem.bytes);
    expect(r.other.count).toBe(0);
  });

  it("STORAGE_KEYS 외 키는 other에 합산되고 items에는 포함되지 않는다", () => {
    const r = measureLocalStorageUsage(
      fakeStorage({ "some-other-lib": "abc", another: "defgh", [STORAGE_KEYS.THEME]: "light" }),
      STORAGE_KEYS
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0].name).toBe("THEME");
    expect(r.other.count).toBe(2);
    expect(r.other.bytes).toBe(("some-other-lib".length + 3) * 2 + ("another".length + 5) * 2);
    expect(r.totalBytes).toBe(r.items[0].bytes + r.other.bytes);
  });

  it("백업 키: 배열 길이 = 개수, 개당 평균 = bytes / count", () => {
    const backups = JSON.stringify([{ id: "a", text: "1234" }, { id: "b", text: "5678" }, { id: "c" }]);
    const r = measureLocalStorageUsage(fakeStorage({ [STORAGE_KEYS.BACKUPS]: backups }), STORAGE_KEYS);
    const bytes = (STORAGE_KEYS.BACKUPS.length + backups.length) * 2;
    expect(r.backup.bytes).toBe(bytes);
    expect(r.backup.count).toBe(3);
    expect(r.backup.avgBytes).toBe(Math.round(bytes / 3));
  });

  it("백업 키 JSON 손상 → count null, avg 0 (측정 자체는 계속)", () => {
    const r = measureLocalStorageUsage(fakeStorage({ [STORAGE_KEYS.BACKUPS]: "{not json" }), STORAGE_KEYS);
    expect(r.backup.count).toBeNull();
    expect(r.backup.avgBytes).toBe(0);
    expect(r.backup.bytes).toBeGreaterThan(0);
    expect(r.totalBytes).toBe(r.backup.bytes);
  });

  it("백업 키가 배열이 아닌 JSON → count null", () => {
    const r = measureLocalStorageUsage(fakeStorage({ [STORAGE_KEYS.BACKUPS]: "{}" }), STORAGE_KEYS);
    expect(r.backup.count).toBeNull();
  });

  it("빈 배열 백업 → count 0, avg 0", () => {
    const r = measureLocalStorageUsage(fakeStorage({ [STORAGE_KEYS.BACKUPS]: "[]" }), STORAGE_KEYS);
    expect(r.backup.count).toBe(0);
    expect(r.backup.avgBytes).toBe(0);
  });

  it("비율·퍼센트·레벨: limit 인자로 경계 검증 (80% 경고, 95% 위험)", () => {
    const s = fakeStorage({ [STORAGE_KEYS.THEME]: "x".repeat(100) });
    const bytes = (STORAGE_KEYS.THEME.length + 100) * 2;

    const ok = measureLocalStorageUsage(s, STORAGE_KEYS, bytes * 2);
    expect(ok.ratio).toBeCloseTo(0.5, 12);
    expect(ok.percent).toBe(50);
    expect(ok.level).toBe("ok");

    const warn = measureLocalStorageUsage(s, STORAGE_KEYS, bytes / 0.8);
    expect(warn.level).toBe("warning");
    expect(warn.percent).toBe(80);

    const justBelowWarn = measureLocalStorageUsage(s, STORAGE_KEYS, bytes / 0.799);
    expect(justBelowWarn.level).toBe("ok");

    const danger = measureLocalStorageUsage(s, STORAGE_KEYS, bytes / 0.95);
    expect(danger.level).toBe("danger");
    expect(danger.percent).toBe(95);

    const over = measureLocalStorageUsage(s, STORAGE_KEYS, bytes / 2);
    expect(over.ratio).toBeCloseTo(2, 12);
    expect(over.percent).toBe(200);
    expect(over.level).toBe("danger");
  });

  it("percent는 소수 첫째 자리 반올림", () => {
    const s = fakeStorage({ [STORAGE_KEYS.THEME]: "abc" });
    const bytes = (STORAGE_KEYS.THEME.length + 3) * 2;
    const r = measureLocalStorageUsage(s, STORAGE_KEYS, bytes * 3); // 33.333…%
    expect(r.percent).toBe(33.3);
  });

  it("limit 0 이하 → 비율 0 (0 나눗셈 방지)", () => {
    const r = measureLocalStorageUsage(fakeStorage({ [STORAGE_KEYS.THEME]: "abc" }), STORAGE_KEYS, 0);
    expect(r.ratio).toBe(0);
    expect(r.items[0].ratio).toBe(0);
    expect(r.level).toBe("ok");
  });

  it("key(i)가 null을 돌려주는 구멍은 건너뛴다", () => {
    const s: Pick<Storage, "length" | "key" | "getItem"> = {
      length: 3,
      key: (i) => (i === 1 ? null : i === 0 ? STORAGE_KEYS.THEME : "other"),
      getItem: (k) => (k === STORAGE_KEYS.THEME ? "dark" : k === "other" ? "v" : null)
    };
    const r = measureLocalStorageUsage(s, STORAGE_KEYS);
    expect(r.items).toHaveLength(1);
    expect(r.other.count).toBe(1);
  });

  it("주요 키(DATA·BACKUPS·CACHE·DATA_TABLE_BACKUP·DRAFT)는 한글 라벨로 표시된다", () => {
    const names = ["DATA", "BACKUPS", "CACHE", "DATA_TABLE_BACKUP", "DRAFT"] as const;
    const entries: Record<string, string> = {};
    for (const n of names) entries[STORAGE_KEYS[n]] = "v";
    const r = measureLocalStorageUsage(fakeStorage(entries), STORAGE_KEYS);
    expect(r.items).toHaveLength(names.length);
    for (const item of r.items) {
      expect(item.label).not.toBe(item.key);
      expect(item.label.length).toBeGreaterThan(0);
    }
  });

  it("라벨이 없는 키는 키 문자열을 라벨로 폴백한다 (새 STORAGE_KEYS 추가 시에도 측정은 깨지지 않음)", () => {
    const keys = { ...STORAGE_KEYS, __FUTURE_KEY__: "fw-future-key" } as unknown as typeof STORAGE_KEYS;
    const r = measureLocalStorageUsage(fakeStorage({ "fw-future-key": "abc" }), keys);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].name).toBe("__FUTURE_KEY__");
    expect(r.items[0].label).toBe("fw-future-key");
    expect(r.other.count).toBe(0);
  });
});

describe("getStorageUsageLevel", () => {
  it("경계값", () => {
    expect(getStorageUsageLevel(0)).toBe("ok");
    expect(getStorageUsageLevel(0.7999)).toBe("ok");
    expect(getStorageUsageLevel(0.8)).toBe("warning");
    expect(getStorageUsageLevel(0.9499)).toBe("warning");
    expect(getStorageUsageLevel(0.95)).toBe("danger");
    expect(getStorageUsageLevel(1.5)).toBe("danger");
  });
});

describe("formatStorageBytes", () => {
  it("단위 변환", () => {
    expect(formatStorageBytes(0)).toBe("0 B");
    expect(formatStorageBytes(512)).toBe("512 B");
    expect(formatStorageBytes(1023)).toBe("1,023 B");
    expect(formatStorageBytes(1024)).toBe("1.0 KB");
    expect(formatStorageBytes(1536)).toBe("1.5 KB");
    expect(formatStorageBytes(1024 * 1024)).toBe("1.00 MB");
    expect(formatStorageBytes(5 * 1024 * 1024)).toBe("5.00 MB");
  });
  it("비정상 입력은 0 B", () => {
    expect(formatStorageBytes(-1)).toBe("0 B");
    expect(formatStorageBytes(NaN)).toBe("0 B");
    expect(formatStorageBytes(Infinity)).toBe("0 B");
  });
});
