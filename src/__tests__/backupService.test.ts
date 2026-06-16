import { describe, it, expect, beforeEach } from "vitest";
import { saveSafetySnapshot, getBackupList } from "../services/backupService";
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
