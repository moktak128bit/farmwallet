// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBackup } from "../hooks/useBackup";
import {
  saveDataSerialized,
  saveBackupSnapshot,
  getAllBackupList,
  getLatestLocalBackupIntegrity,
  clearOldBackups,
  toUserDataJson,
} from "../storage";
import * as tabSync from "../services/tabSync";
import { toast } from "react-hot-toast";
import { useUIStore } from "../store/uiStore";
import { AUTO_SAVE_DELAY, AUTO_BACKUP_INTERVAL_MS, DATA_SCHEMA_VERSION, STORAGE_KEYS } from "../constants/config";
import type { AppData } from "../types";

vi.mock("../storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage")>();
  return {
    ...actual,
    saveDataSerialized: vi.fn(),
    saveBackupSnapshot: vi.fn(),
    getAllBackupList: vi.fn(),
    getLatestLocalBackupIntegrity: vi.fn(),
    clearOldBackups: vi.fn(),
  };
});

vi.mock("../services/tabSync", () => ({
  notifyDataChanged: vi.fn(),
}));

vi.mock("react-hot-toast", () => {
  const t = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  });
  return { toast: t, default: t };
});

// 네임스페이스 import(import * as) 대신 named import — knip이 배럴의 나머지 re-export를 미사용으로 오판하지 않게
const mocked = {
  saveDataSerialized: vi.mocked(saveDataSerialized),
  saveBackupSnapshot: vi.mocked(saveBackupSnapshot),
  getAllBackupList: vi.mocked(getAllBackupList),
  getLatestLocalBackupIntegrity: vi.mocked(getLatestLocalBackupIntegrity),
  clearOldBackups: vi.mocked(clearOldBackups),
};
const mockedNotify = vi.mocked(tabSync.notifyDataChanged);
const mockedToast = vi.mocked(toast);

/** 사용자 데이터만 바뀌는 픽스처 (stamp가 ledger 금액) */
function makeData(stamp: number, extra: Partial<AppData> = {}): AppData {
  return {
    accounts: [],
    ledger: [{ id: `L${stamp}`, date: "2026-01-01", kind: "expense", category: "지출", subCategory: "식비", description: "n", amount: stamp }],
    trades: [],
    prices: [],
    categoryPresets: { income: [], expense: [], transfer: [] },
    recurringExpenses: [],
    budgetGoals: [],
    customSymbols: [],
    ...extra,
  };
}

function userJson(d: AppData) {
  return toUserDataJson(d);
}

function quotaError(): DOMException {
  return new DOMException("The quota has been exceeded.", "QuotaExceededError");
}

/** 500ms 디바운스 경과 + 후속 micro task 소화 */
async function passDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(AUTO_SAVE_DELAY);
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** 비동기 백업 정리(clearOldBackups → then) 체인 소화 */
async function flushMicrotasks(n = 4) {
  await act(async () => {
    for (let i = 0; i < n; i++) await Promise.resolve();
  });
}

type HookProps = { data: AppData; disabled?: boolean };

function renderBackup(initial: AppData, opts?: { disabled?: boolean; onLog?: (m: string, t?: string) => void }) {
  const initialProps: HookProps = { data: initial, disabled: opts?.disabled };
  return renderHook(
    ({ data, disabled }: HookProps) => useBackup(data, { disabled, onLog: opts?.onLog }),
    { initialProps },
  );
}

describe("useBackup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T09:00:00+09:00"));
    vi.clearAllMocks();
    window.localStorage.clear();
    // 저장 시 스냅샷은 기본 on(설정 없음=on) — 자동저장 본연의 동작 테스트는 명시적으로 끄고, 백업 옵션 테스트에서만 켠다
    window.localStorage.setItem(STORAGE_KEYS.BACKUP_ON_SAVE, "false");
    mocked.getAllBackupList.mockResolvedValue([]);
    mocked.getLatestLocalBackupIntegrity.mockResolvedValue({ createdAt: null, status: "none" });
    mocked.saveBackupSnapshot.mockResolvedValue({ fileSaved: false, localSaved: true, fileSkipped: true });
    mocked.clearOldBackups.mockResolvedValue(0);
    mocked.saveDataSerialized.mockImplementation(() => {});
    useUIStore.setState({ saveStatus: "idle", saveStatusError: null, hasDirtyChanges: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("자동저장 디바운스", () => {
    it("마운트만으로는 저장하지 않는다(첫 effect 건너뜀), 최근 백업 목록은 조회", async () => {
      renderBackup(makeData(1));
      await passDebounce();
      await passDebounce();
      expect(mocked.saveDataSerialized).not.toHaveBeenCalled();
      expect(mocked.getAllBackupList).toHaveBeenCalledTimes(1);
      expect(useUIStore.getState().hasDirtyChanges).toBe(false);
    });

    it("데이터 변경 → dirty 표시 → 500ms 뒤 1회 저장(full payload) + 드래프트 기록/정리 + 방송(user payload)", async () => {
      const d1 = makeData(1);
      const d2 = makeData(2);
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
      const { rerender } = renderBackup(d1);
      rerender({ data: d2 });
      // 디바운스 중: dirty만 표시, 저장·드래프트 없음
      expect(useUIStore.getState().hasDirtyChanges).toBe(true);
      expect(mocked.saveDataSerialized).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(STORAGE_KEYS.DRAFT)).toBeNull();

      await passDebounce();

      expect(mocked.saveDataSerialized).toHaveBeenCalledTimes(1);
      expect(mocked.saveDataSerialized).toHaveBeenCalledWith(JSON.stringify(d2));
      // 드래프트: 저장 직전 1회 기록(user payload) → 저장 성공 후 제거
      expect(setItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.DRAFT, userJson(d2));
      expect(setItemSpy).toHaveBeenCalledWith(STORAGE_KEYS.DRAFT_AT, String(Date.now()));
      expect(window.localStorage.getItem(STORAGE_KEYS.DRAFT)).toBeNull();
      expect(window.localStorage.getItem(STORAGE_KEYS.DRAFT_AT)).toBeNull();
      // 상태·방송
      expect(useUIStore.getState().saveStatus).toBe("saved");
      expect(useUIStore.getState().hasDirtyChanges).toBe(false);
      expect(mockedNotify).toHaveBeenCalledTimes(1);
      expect(mockedNotify).toHaveBeenCalledWith(userJson(d2));
      // 백업 옵션 꺼짐 → 자동 백업 없음
      expect(mocked.saveBackupSnapshot).not.toHaveBeenCalled();
      setItemSpy.mockRestore();
    });

    it("500ms 안에 여러 번 바뀌면 마지막 데이터로 1회만 저장", async () => {
      const { rerender } = renderBackup(makeData(1));
      rerender({ data: makeData(2) });
      act(() => { vi.advanceTimersByTime(200); });
      rerender({ data: makeData(3) });
      act(() => { vi.advanceTimersByTime(200); });
      rerender({ data: makeData(4) });
      act(() => { vi.advanceTimersByTime(400); });
      expect(mocked.saveDataSerialized).not.toHaveBeenCalled(); // 마지막 변경 후 400ms
      await passDebounce();
      expect(mocked.saveDataSerialized).toHaveBeenCalledTimes(1);
      expect(mocked.saveDataSerialized).toHaveBeenCalledWith(JSON.stringify(makeData(4)));
    });

    it("부팅 round-trip: localStorage DATA와 같은 user payload가 들어오면 저장·드래프트·dirty 없음", async () => {
      const d1 = makeData(1);
      window.localStorage.setItem(STORAGE_KEYS.DATA, userJson(d1));
      const { rerender } = renderBackup(d1);
      rerender({ data: JSON.parse(JSON.stringify(d1)) as AppData }); // 새 참조, 같은 내용
      expect(useUIStore.getState().hasDirtyChanges).toBe(false);
      await passDebounce();
      expect(mocked.saveDataSerialized).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(STORAGE_KEYS.DRAFT)).toBeNull();
      expect(mockedNotify).not.toHaveBeenCalled();
      expect(useUIStore.getState().saveStatus).toBe("idle"); // 상태 깜빡임 없음
    });

    it("캐시 필드(prices)만 바뀐 경우는 user payload가 같으므로 저장하지 않는다", async () => {
      const d1 = makeData(1);
      window.localStorage.setItem(STORAGE_KEYS.DATA, userJson(d1));
      const { rerender } = renderBackup(d1);
      rerender({ data: makeData(1, { prices: [{ ticker: "AAPL", price: 100 }] }) });
      await passDebounce();
      expect(mocked.saveDataSerialized).not.toHaveBeenCalled();
      expect(useUIStore.getState().hasDirtyChanges).toBe(false);
    });

    it("한 번 저장한 뒤 같은 내용이 다시 들어오면 재저장하지 않음(lastSavedPayload 갱신)", async () => {
      const { rerender } = renderBackup(makeData(1));
      rerender({ data: makeData(2) });
      await passDebounce();
      expect(mocked.saveDataSerialized).toHaveBeenCalledTimes(1);
      rerender({ data: makeData(2) });
      await passDebounce();
      expect(mocked.saveDataSerialized).toHaveBeenCalledTimes(1);
      expect(mockedNotify).toHaveBeenCalledTimes(1);
    });

    it("언마운트 시 대기 중인 타이머는 취소된다", async () => {
      const { rerender, unmount } = renderBackup(makeData(1));
      rerender({ data: makeData(2) });
      unmount();
      await passDebounce();
      expect(mocked.saveDataSerialized).not.toHaveBeenCalled();
    });
  });

  describe("disabled(loadFailed) 차단", () => {
    it("disabled=true면 변경돼도 자동저장·드래프트·방송 없음", async () => {
      const { rerender } = renderBackup(makeData(1), { disabled: true });
      rerender({ data: makeData(2), disabled: true });
      await passDebounce();
      expect(mocked.saveDataSerialized).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(STORAGE_KEYS.DRAFT)).toBeNull();
      expect(mockedNotify).not.toHaveBeenCalled();
      expect(useUIStore.getState().hasDirtyChanges).toBe(false);
    });

    it("disabled면 수동 백업·flushPendingSave·unload flush도 차단", async () => {
      const { result, rerender } = renderBackup(makeData(1), { disabled: true });
      rerender({ data: makeData(2), disabled: true });
      await act(async () => { await result.current.handleManualBackup(); });
      expect(mockedToast.error).toHaveBeenCalledWith(expect.stringContaining("로드 실패"));
      expect(mocked.saveDataSerialized).not.toHaveBeenCalled();
      expect(mocked.saveBackupSnapshot).not.toHaveBeenCalled();

      act(() => { result.current.flushPendingSave(); });
      expect(mocked.saveDataSerialized).not.toHaveBeenCalled();

      act(() => { window.dispatchEvent(new Event("beforeunload")); });
      expect(window.localStorage.getItem(STORAGE_KEYS.DATA)).toBeNull();
    });
  });

  describe("flush / discard", () => {
    it("flushPendingSave는 디바운스를 기다리지 않고 즉시 저장하고 타이머를 취소한다", async () => {
      const { result, rerender } = renderBackup(makeData(1));
      rerender({ data: makeData(2) });
      act(() => { result.current.flushPendingSave(); });
      expect(mocked.saveDataSerialized).toHaveBeenCalledTimes(1);
      expect(mocked.saveDataSerialized).toHaveBeenCalledWith(JSON.stringify(makeData(2)));
      expect(useUIStore.getState().saveStatus).toBe("saved");
      await passDebounce();
      expect(mocked.saveDataSerialized).toHaveBeenCalledTimes(1); // 타이머 중복 저장 없음
    });

    it("저장할 변경이 없을 때 flushPendingSave는 dirty만 내리고 상태를 건드리지 않는다", () => {
      const d1 = makeData(1);
      window.localStorage.setItem(STORAGE_KEYS.DATA, userJson(d1));
      const { result } = renderBackup(d1);
      useUIStore.getState().setHasDirtyChanges(true);
      act(() => { result.current.flushPendingSave(); });
      expect(mocked.saveDataSerialized).not.toHaveBeenCalled();
      expect(useUIStore.getState().hasDirtyChanges).toBe(false);
      expect(useUIStore.getState().saveStatus).toBe("idle");
    });

    it("discardPendingSaveAndApply: 대기 저장 폐기, 외부 payload를 저장된 것으로 인식, 드래프트 정리, 방송 없음", async () => {
      const { result, rerender } = renderBackup(makeData(1));
      rerender({ data: makeData(2) });
      window.localStorage.setItem(STORAGE_KEYS.DRAFT, "stale-draft");
      const applied = makeData(99);
      act(() => { result.current.discardPendingSaveAndApply(userJson(applied)); });
      expect(window.localStorage.getItem(STORAGE_KEYS.DRAFT)).toBeNull();
      expect(useUIStore.getState().saveStatus).toBe("saved");
      expect(useUIStore.getState().hasDirtyChanges).toBe(false);
      await passDebounce();
      expect(mocked.saveDataSerialized).not.toHaveBeenCalled();
      expect(mockedNotify).not.toHaveBeenCalled();
      // 호출 측이 store를 applied로 갱신하면 (같은 payload) 재저장되지 않는다
      rerender({ data: applied });
      await passDebounce();
      expect(mocked.saveDataSerialized).not.toHaveBeenCalled();
      // 이후 실제 변경은 정상 저장
      rerender({ data: makeData(100) });
      await passDebounce();
      expect(mocked.saveDataSerialized).toHaveBeenCalledTimes(1);
    });
  });

  describe("저장 실패", () => {
    it("일반 오류: saveStatus=error(메시지), toast.error, 드래프트는 남겨 다음 부팅 복구 가능", async () => {
      mocked.saveDataSerialized.mockImplementation(() => { throw new Error("disk on fire"); });
      const { rerender } = renderBackup(makeData(1));
      rerender({ data: makeData(2) });
      await passDebounce();
      expect(useUIStore.getState().saveStatus).toBe("error");
      expect(useUIStore.getState().saveStatusError).toBe("disk on fire");
      expect(mockedToast.error).toHaveBeenCalledWith("disk on fire", expect.objectContaining({ id: "auto-save-error" }));
      expect(window.localStorage.getItem(STORAGE_KEYS.DRAFT)).toBe(userJson(makeData(2)));
      expect(mockedNotify).not.toHaveBeenCalled();
      expect(mocked.clearOldBackups).not.toHaveBeenCalled();
    });

    it("quota 초과: 오래된 백업 정리 후 1회 재시도 성공 → saved + 안내 toast", async () => {
      mocked.saveDataSerialized
        .mockImplementationOnce(() => { throw quotaError(); })
        .mockImplementation(() => {});
      mocked.clearOldBackups.mockResolvedValue(2);
      const { rerender } = renderBackup(makeData(1));
      rerender({ data: makeData(2) });
      await passDebounce();
      await flushMicrotasks();
      expect(mocked.clearOldBackups).toHaveBeenCalledWith(3);
      expect(mocked.saveDataSerialized).toHaveBeenCalledTimes(2);
      expect(useUIStore.getState().saveStatus).toBe("saved");
      expect(window.localStorage.getItem(STORAGE_KEYS.DRAFT)).toBeNull();
      expect(mockedNotify).toHaveBeenCalledWith(userJson(makeData(2)));
      expect(mockedToast.success).toHaveBeenCalledWith(expect.stringContaining("오래된 백업 2개"), expect.objectContaining({ id: "auto-save-error" }));
    });

    it("quota 초과인데 정리할 백업이 없으면 재시도 없이 error + 용량 안내", async () => {
      mocked.saveDataSerialized.mockImplementation(() => { throw quotaError(); });
      mocked.clearOldBackups.mockResolvedValue(0);
      const { rerender } = renderBackup(makeData(1));
      rerender({ data: makeData(2) });
      await passDebounce();
      await flushMicrotasks();
      expect(mocked.saveDataSerialized).toHaveBeenCalledTimes(1);
      expect(useUIStore.getState().saveStatus).toBe("error");
      expect(mockedToast.error).toHaveBeenCalledWith(expect.stringContaining("저장 공간이 가득"), expect.objectContaining({ id: "auto-save-error" }));
    });

    it("quota 재시도도 실패하면 error 상태 유지 + 용량 안내", async () => {
      mocked.saveDataSerialized.mockImplementation(() => { throw quotaError(); });
      mocked.clearOldBackups.mockResolvedValue(1);
      const { rerender } = renderBackup(makeData(1));
      rerender({ data: makeData(2) });
      await passDebounce();
      await flushMicrotasks();
      expect(mocked.saveDataSerialized).toHaveBeenCalledTimes(2);
      expect(useUIStore.getState().saveStatus).toBe("error");
      expect(mockedToast.error).toHaveBeenCalledWith(expect.stringContaining("저장 공간이 가득"), expect.anything());
      expect(mockedNotify).not.toHaveBeenCalled();
    });

    it("quota 정리 중 더 새로운 변경이 들어오면 오래된 payload로 재시도하지 않는다 (최신 저장 덮어쓰기 방지)", async () => {
      mocked.saveDataSerialized
        .mockImplementationOnce(() => { throw quotaError(); })
        .mockImplementation(() => {});
      let resolveClear: (n: number) => void = () => {};
      mocked.clearOldBackups.mockImplementation(() => new Promise<number>((res) => { resolveClear = res; }));
      const { rerender } = renderBackup(makeData(1));
      rerender({ data: makeData(2) });
      await passDebounce();
      expect(mocked.saveDataSerialized).toHaveBeenCalledTimes(1);
      // 정리가 끝나기 전에 새 변경 → 그 변경은 자체 디바운스 저장으로 기록된다
      rerender({ data: makeData(3) });
      await passDebounce();
      expect(mocked.saveDataSerialized).toHaveBeenCalledTimes(2);
      expect(mocked.saveDataSerialized).toHaveBeenLastCalledWith(JSON.stringify(makeData(3)));
      // 뒤늦게 정리 완료 → 오래된 makeData(2)로 재시도하지 않음
      act(() => { resolveClear(2); });
      await flushMicrotasks();
      expect(mocked.saveDataSerialized).toHaveBeenCalledTimes(2);
      expect(mockedToast.success).not.toHaveBeenCalledWith(expect.stringContaining("오래된 백업"), expect.anything());
    });
  });

  describe("unload flush", () => {
    it("beforeunload: 디바운스 중이면 동기적으로 DATA(user payload)+스키마버전을 직접 기록, 방송, 타이머 취소", async () => {
      const { rerender } = renderBackup(makeData(1));
      rerender({ data: makeData(2) });
      act(() => { window.dispatchEvent(new Event("beforeunload")); });
      expect(window.localStorage.getItem(STORAGE_KEYS.DATA)).toBe(userJson(makeData(2)));
      expect(window.localStorage.getItem(STORAGE_KEYS.DATA_SCHEMA_VERSION)).toBe(String(DATA_SCHEMA_VERSION));
      expect(mockedNotify).toHaveBeenCalledWith(userJson(makeData(2)));
      expect(window.localStorage.getItem(STORAGE_KEYS.DRAFT)).toBeNull();
      await passDebounce();
      expect(mocked.saveDataSerialized).not.toHaveBeenCalled(); // 타이머는 flush가 취소
    });

    it("pagehide도 같은 flush 경로, 이미 저장된 내용이면 아무것도 쓰지 않음", async () => {
      const d1 = makeData(1);
      window.localStorage.setItem(STORAGE_KEYS.DATA, userJson(d1));
      renderBackup(d1);
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
      act(() => { window.dispatchEvent(new Event("pagehide")); });
      expect(setItemSpy).not.toHaveBeenCalled();
      expect(mockedNotify).not.toHaveBeenCalled();
      setItemSpy.mockRestore();
    });

    it("unload flush에서 setItem이 실패하면 드래프트 슬롯에라도 기록 시도", () => {
      const { rerender } = renderBackup(makeData(1));
      rerender({ data: makeData(2) });
      const original = Storage.prototype.setItem;
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === STORAGE_KEYS.DATA) throw quotaError();
        return original.call(this, key, value);
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      act(() => { window.dispatchEvent(new Event("beforeunload")); });
      expect(window.localStorage.getItem(STORAGE_KEYS.DATA)).toBeNull();
      expect(window.localStorage.getItem(STORAGE_KEYS.DRAFT)).toBe(userJson(makeData(2)));
      expect(mockedNotify).not.toHaveBeenCalled();
      setItemSpy.mockRestore();
      warn.mockRestore();
    });

    it("언마운트 후에는 unload 리스너가 해제된다", () => {
      const { rerender, unmount } = renderBackup(makeData(1));
      rerender({ data: makeData(2) });
      unmount();
      act(() => { window.dispatchEvent(new Event("beforeunload")); });
      expect(window.localStorage.getItem(STORAGE_KEYS.DATA)).toBeNull();
    });
  });

  describe("저장 시 자동 백업 옵션", () => {
    it("BACKUP_ON_SAVE=true면 저장 후 스냅샷(skipHash, 파일용 full payload + 로컬용 user-only) 1회, AUTO_BACKUP_INTERVAL_MS 간격 가드", async () => {
      window.localStorage.setItem(STORAGE_KEYS.BACKUP_ON_SAVE, "true");
      const { rerender } = renderBackup(makeData(1));
      rerender({ data: makeData(2) });
      await passDebounce();
      expect(mocked.saveBackupSnapshot).toHaveBeenCalledTimes(1);
      expect(mocked.saveBackupSnapshot).toHaveBeenCalledWith(
        makeData(2),
        expect.objectContaining({ skipHash: true, dataJson: JSON.stringify(makeData(2)), userDataJson: userJson(makeData(2)) }),
      );
      // 간격 내 두 번째 저장 → 백업 생략
      rerender({ data: makeData(3) });
      await passDebounce();
      expect(mocked.saveDataSerialized).toHaveBeenCalledTimes(2);
      expect(mocked.saveBackupSnapshot).toHaveBeenCalledTimes(1);
      // 간격 경과 후 → 다시 백업
      act(() => { vi.advanceTimersByTime(AUTO_BACKUP_INTERVAL_MS + 1000); });
      rerender({ data: makeData(4) });
      await passDebounce();
      expect(mocked.saveBackupSnapshot).toHaveBeenCalledTimes(2);
    });

    it("옵션을 명시적으로 껐으면 저장만 하고 백업 안 함", async () => {
      expect(window.localStorage.getItem(STORAGE_KEYS.BACKUP_ON_SAVE)).toBe("false");
      const { rerender } = renderBackup(makeData(1));
      rerender({ data: makeData(2) });
      await passDebounce();
      expect(mocked.saveDataSerialized).toHaveBeenCalledTimes(1);
      expect(mocked.saveBackupSnapshot).not.toHaveBeenCalled();
    });

    it("설정이 저장된 적 없으면 기본 on — 저장 후 스냅샷이 만들어진다", async () => {
      window.localStorage.removeItem(STORAGE_KEYS.BACKUP_ON_SAVE);
      const { rerender } = renderBackup(makeData(1));
      rerender({ data: makeData(2) });
      await passDebounce();
      expect(mocked.saveBackupSnapshot).toHaveBeenCalledTimes(1);
    });
  });

  describe("수동 백업", () => {
    it("성공: 저장 + 스냅샷(skipHash=false) + 토스트/로그, 목록 갱신", async () => {
      const onLog = vi.fn();
      const d = makeData(1);
      const { result } = renderBackup(d, { onLog });
      mocked.getAllBackupList.mockClear();
      await act(async () => { await result.current.handleManualBackup(); });
      expect(mocked.saveDataSerialized).toHaveBeenCalledWith(JSON.stringify(d));
      expect(mocked.saveBackupSnapshot).toHaveBeenCalledWith(d, expect.objectContaining({ skipHash: false, dataJson: JSON.stringify(d), userDataJson: userJson(d) }));
      expect(mocked.getAllBackupList).toHaveBeenCalledTimes(1);
      expect(mockedToast.success).toHaveBeenCalledWith("백업 저장 완료", { id: "manual-backup" });
      expect(onLog).toHaveBeenCalledWith("백업 완료.", "success");
    });

    it("파일·로컬 모두 실패 → toast.error + 실패 로그", async () => {
      mocked.saveBackupSnapshot.mockResolvedValue({ fileSaved: false, localSaved: false, fileError: "f", localError: "l" });
      const onLog = vi.fn();
      const { result } = renderBackup(makeData(1), { onLog });
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      await act(async () => { await result.current.handleManualBackup(); });
      expect(mockedToast.error).toHaveBeenCalledWith("f / l", { id: "manual-backup" });
      expect(onLog).toHaveBeenCalledWith(expect.stringContaining("백업 실패"), "error");
      errSpy.mockRestore();
    });

    it("부분 성공(파일만) → 부분 백업 토스트", async () => {
      mocked.saveBackupSnapshot.mockResolvedValue({ fileSaved: true, localSaved: false, localError: "idb" });
      const { result } = renderBackup(makeData(1));
      await act(async () => { await result.current.handleManualBackup(); });
      expect(mockedToast.success).toHaveBeenCalledWith(expect.stringContaining("부분 백업 완료"), { id: "manual-backup" });
    });
  });

  describe("백업 경고", () => {
    it("최근 백업 시각으로 12h/24h 경고 단계 산출", async () => {
      const now = Date.now();
      mocked.getAllBackupList.mockResolvedValue([{ createdAt: new Date(now - 13 * 36e5).toISOString() } as never]);
      const { result } = renderBackup(makeData(1));
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(result.current.latestBackupAt).toBe(new Date(now - 13 * 36e5).toISOString());
      expect(result.current.backupWarning?.type).toBe("warning");

      mocked.getAllBackupList.mockResolvedValue([{ createdAt: new Date(now - 25 * 36e5).toISOString() } as never]);
      await act(async () => { await result.current.refreshLatestBackup(); });
      expect(result.current.backupWarning?.type).toBe("critical");

      mocked.getAllBackupList.mockResolvedValue([{ createdAt: new Date(now - 1 * 36e5).toISOString() } as never]);
      await act(async () => { await result.current.refreshLatestBackup(); });
      expect(result.current.backupWarning).toBeNull();
    });
  });
});
