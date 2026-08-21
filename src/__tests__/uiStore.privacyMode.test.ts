// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { STORAGE_KEYS } from "../constants/config";
import { isAmountMasked, setAmountMask } from "../utils/formatter";

describe("uiStore — privacyMode", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setAmountMask(false);
  });
  afterEach(() => {
    setAmountMask(false);
  });

  it("저장된 값이 없으면 기본 off, formatter 마스킹도 off", async () => {
    const { useUIStore } = await import("../store/uiStore");
    expect(useUIStore.getState().privacyMode).toBe(false);
    expect(isAmountMasked()).toBe(false);
  });

  it("setPrivacyMode(true) — store·localStorage·formatter가 모두 동기화", async () => {
    const { useUIStore } = await import("../store/uiStore");
    useUIStore.getState().setPrivacyMode(true);
    expect(useUIStore.getState().privacyMode).toBe(true);
    expect(isAmountMasked()).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEYS.PRIVACY_MODE)).toBe("true");
  });

  it("함수형 업데이트로 토글 가능", async () => {
    const { useUIStore } = await import("../store/uiStore");
    useUIStore.getState().setPrivacyMode(true);
    useUIStore.getState().setPrivacyMode((prev) => !prev);
    expect(useUIStore.getState().privacyMode).toBe(false);
    expect(isAmountMasked()).toBe(false);
  });

  it("저장된 'true'가 있으면 모듈 로드 시 privacyMode·마스킹이 복원된다", async () => {
    window.localStorage.setItem(STORAGE_KEYS.PRIVACY_MODE, "true");
    // 모듈 캐시를 새로 태워야 최초 로드 시점 초기화 로직(loadPrivacyMode)이 다시 실행됨.
    // resetModules는 formatter.ts 인스턴스도 새로 만들므로, 검증도 새로 import한 인스턴스로 한다.
    vi.resetModules();
    const { useUIStore } = await import("../store/uiStore");
    const freshFormatter = await import("../utils/formatter");
    expect(useUIStore.getState().privacyMode).toBe(true);
    expect(freshFormatter.isAmountMasked()).toBe(true);
  });
});
