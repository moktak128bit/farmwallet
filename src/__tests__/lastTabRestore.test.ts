// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { STORAGE_KEYS } from "../constants/config";

/** uiStore는 모듈 로드 시점에 localStorage를 읽으므로 매 케이스 모듈을 새로 올린다 */
async function freshStore() {
  vi.resetModules();
  const mod = await import("../store/uiStore");
  return mod.useUIStore;
}

describe("마지막 탭 복원(STORAGE_KEYS.LAST_TAB)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("키가 없으면 dashboard", async () => {
    const store = await freshStore();
    expect(store.getState().tab).toBe("dashboard");
  });

  it("저장된 탭이 TAB_ORDER에 있으면 복원", async () => {
    window.localStorage.setItem(STORAGE_KEYS.LAST_TAB, "stocks");
    const store = await freshStore();
    expect(store.getState().tab).toBe("stocks");
  });

  it("화이트리스트 외 값·오염 값은 무시하고 dashboard", async () => {
    window.localStorage.setItem(STORAGE_KEYS.LAST_TAB, "admin");
    expect((await freshStore()).getState().tab).toBe("dashboard");
    window.localStorage.setItem(STORAGE_KEYS.LAST_TAB, "__proto__");
    expect((await freshStore()).getState().tab).toBe("dashboard");
    window.localStorage.setItem(STORAGE_KEYS.LAST_TAB, "");
    expect((await freshStore()).getState().tab).toBe("dashboard");
  });

  it("setTab 시 저장되고 다음 부팅에 복원된다", async () => {
    const store = await freshStore();
    store.getState().setTab("dividends");
    expect(window.localStorage.getItem(STORAGE_KEYS.LAST_TAB)).toBe("dividends");
    const again = await freshStore();
    expect(again.getState().tab).toBe("dividends");
  });

  it("localStorage 예외(quota 등)에도 setTab은 동작한다", async () => {
    const store = await freshStore();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => store.getState().setTab("budget")).not.toThrow();
    expect(store.getState().tab).toBe("budget");
    spy.mockRestore();
  });
});
