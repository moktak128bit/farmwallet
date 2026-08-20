import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  saveSafetySnapshot,
  getBackupList,
  getCorruptBackupsInfo,
  getCorruptBackupsRaw,
  clearCorruptBackups
} from "../services/backupService";
import { STORAGE_KEYS } from "../constants/config";
import type { AppData } from "../types";

function makeAppData(overrides: Partial<AppData> = {}): AppData {
  return {
    accounts: [],
    ledger: [],
    trades: [],
    prices: [],
    categoryPresets: { income: [], expense: [], transfer: [] },
    recurringExpenses: [],
    budgetGoals: [],
    customSymbols: [],
    ...overrides,
  };
}

interface SeedBackup {
  id: string;
  createdAt: string;
  data: AppData;
  label?: string;
}

function seedBackups(backups: SeedBackup[]): void {
  window.localStorage.setItem(STORAGE_KEYS.BACKUPS, JSON.stringify(backups));
}

describe("backupService — 보존 정책 (일별 최대 5개 × 최근 4일)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("saveSafetySnapshot이 사유 라벨과 함께 로컬 백업으로 저장된다", async () => {
    const ok = await saveSafetySnapshot(makeAppData(), "백업 복원 직전 자동 스냅샷");
    expect(ok).toBe(true);
    const list = getBackupList();
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe("백업 복원 직전 자동 스냅샷");
  });

  it("같은 날 백업이 5개를 넘으면 최신 5개만 보존 (당일 안전 백업이 1개로 뭉개지지 않음)", async () => {
    // 같은 KST 날짜 안의 기존 백업 7개 시드 (초 단위 간격)
    const now = Date.now();
    const seeds: SeedBackup[] = Array.from({ length: 7 }, (_, i) => ({
      id: `OLD${i}`,
      createdAt: new Date(now - (i + 1) * 1000).toISOString(),
      data: makeAppData(),
    }));
    seedBackups(seeds);

    await saveSafetySnapshot(makeAppData(), "새 스냅샷");
    const list = getBackupList();
    // 당일 최대 5개 (새 스냅샷 포함)
    expect(list).toHaveLength(5);
    // 최신순 정렬 — 첫 항목이 방금 만든 스냅샷
    expect(list[0].label).toBe("새 스냅샷");
    // 가장 최신인 OLD0~OLD3가 살아남고 오래된 OLD4~OLD6은 정리됨
    const ids = list.map((b) => b.id);
    expect(ids).toContain("OLD0");
    expect(ids).not.toContain("OLD6");
  });

  it("위험 작업 직전 안전 스냅샷은 같은 날 자동백업 cap에 밀려도 보존된다 (#10)", async () => {
    const now = Date.now();
    // 오래된 라벨 스냅샷 1개 + 더 최신 무라벨 자동백업 5개 (모두 오늘) → 라벨이 perDay(5) cap에 밀릴 위치
    const seeds: SeedBackup[] = [
      { id: "SAFE", createdAt: new Date(now - 60_000).toISOString(), data: makeAppData(), label: "위험 작업 직전 자동 스냅샷" },
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `AUTO${i}`,
        createdAt: new Date(now - (i + 1) * 1000).toISOString(),
        data: makeAppData(),
      })),
    ];
    seedBackups(seeds);
    await saveSafetySnapshot(makeAppData(), "새 스냅샷");
    const ids = getBackupList().map((b) => b.id);
    // SAFE는 가장 오래돼 perDay cap이라면 잘려야 하지만, 라벨 스냅샷이라 보존됨
    expect(ids).toContain("SAFE");
  });

  it("백업이 있는 날짜는 최근 4일치만 유지", async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    // 과거 1~6일 전 각 1개 시드
    const seeds: SeedBackup[] = Array.from({ length: 6 }, (_, i) => ({
      id: `D${i + 1}`,
      createdAt: new Date(now - (i + 1) * day).toISOString(),
      data: makeAppData(),
    }));
    seedBackups(seeds);

    await saveSafetySnapshot(makeAppData(), "오늘 스냅샷");
    const list = getBackupList();
    // 오늘 + 1일 전 + 2일 전 + 3일 전 = 4개 날짜만 유지
    expect(list).toHaveLength(4);
    const ids = list.map((b) => b.id);
    expect(ids).toContain("D1");
    expect(ids).toContain("D3");
    expect(ids).not.toContain("D4");
    expect(ids).not.toContain("D6");
  });
});

describe("backupService — BACKUPS 손상 시 원본 보존 (BACKUPS_CORRUPT 1슬롯)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("손상 JSON → 원본을 BACKUPS_CORRUPT로 옮기고 빈 목록으로 시작, 다음 저장이 원본을 덮지 않는다", async () => {
    const corruptRaw = '[{"id":"B1","createdAt":"2026-08-01T00:00:00.000Z","data":{"accounts":[';
    window.localStorage.setItem(STORAGE_KEYS.BACKUPS, corruptRaw);

    expect(getBackupList()).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEYS.BACKUPS_CORRUPT)).toBe(corruptRaw);
    expect(getCorruptBackupsRaw()).toBe(corruptRaw);
    expect(getCorruptBackupsInfo()).toEqual({ sizeBytes: new TextEncoder().encode(corruptRaw).length });

    // 다음 저장은 새 목록을 쓰지만 보존 슬롯의 원본은 그대로
    const ok = await saveSafetySnapshot(makeAppData(), "손상 후 첫 스냅샷");
    expect(ok).toBe(true);
    expect(getBackupList()).toHaveLength(1);
    expect(window.localStorage.getItem(STORAGE_KEYS.BACKUPS_CORRUPT)).toBe(corruptRaw);

    // 삭제하면 슬롯이 비고 정보도 null
    expect(clearCorruptBackups()).toBe(true);
    expect(getCorruptBackupsInfo()).toBeNull();
    expect(clearCorruptBackups()).toBe(false);
  });

  it("이미 BACKUPS_CORRUPT 슬롯이 있으면 더 오래된 것을 유지하고 새 손상본은 덮지 않는다 (1슬롯 정책)", async () => {
    const olderCorrupt = '[{"id":"OLDER","data":{"ledger":[{"id":"L1"';
    window.localStorage.setItem(STORAGE_KEYS.BACKUPS_CORRUPT, olderCorrupt);
    const newerCorrupt = '{"broken":true';
    window.localStorage.setItem(STORAGE_KEYS.BACKUPS, newerCorrupt);

    expect(getBackupList()).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEYS.BACKUPS_CORRUPT)).toBe(olderCorrupt);

    await saveSafetySnapshot(makeAppData(), "스냅샷");
    expect(getBackupList()).toHaveLength(1);
    expect(window.localStorage.getItem(STORAGE_KEYS.BACKUPS_CORRUPT)).toBe(olderCorrupt);
  });

  it("정상 JSON은 보존 슬롯을 만들지 않고 기존 백업도 그대로 유지된다", async () => {
    seedBackups([{ id: "OK1", createdAt: new Date(Date.now() - 1000).toISOString(), data: makeAppData() }]);

    await saveSafetySnapshot(makeAppData(), "정상 스냅샷");
    const ids = getBackupList().map((b) => b.id);
    expect(ids).toContain("OK1");
    expect(ids).toHaveLength(2);
    expect(window.localStorage.getItem(STORAGE_KEYS.BACKUPS_CORRUPT)).toBeNull();
    expect(getCorruptBackupsInfo()).toBeNull();
    expect(getCorruptBackupsRaw()).toBeNull();
  });

  it("배열이 아닌 정상 JSON(객체)은 손상으로 취급하지 않고 빈 목록만 반환한다", () => {
    window.localStorage.setItem(STORAGE_KEYS.BACKUPS, '{"not":"array"}');
    expect(getBackupList()).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEYS.BACKUPS_CORRUPT)).toBeNull();
  });
});
