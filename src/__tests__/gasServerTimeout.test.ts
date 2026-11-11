// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 무한 로딩 회귀(2026-11-11): google.script.run은 성공·실패 콜백이 영영 안 오는 경우가 있다(휴대폰 잠금·
 * 네트워크 전환·세션 만료). 한도가 없으면 '저장 중'·'불러오는 중'이 영원히 남고 재진입 가드가 안 풀려
 * 이후 저장이 전부 막혔다. runServer·loadSheetForBoot는 응답 한도가 지나면 ServerTimeoutError로 끝나야 한다.
 */

type Handler = (v: unknown) => void;

/** hang에 든 함수는 콜백을 절대 부르지 않는 가짜 서버 */
function installGas(impl: Record<string, () => unknown>, hang: string[] = []) {
  const make = (ok?: Handler, fail?: Handler): Record<string, unknown> => {
    const r: Record<string, unknown> = {
      withSuccessHandler: (f: Handler) => make(f, fail),
      withFailureHandler: (f: Handler) => make(ok, f),
    };
    for (const k of [...Object.keys(impl), ...hang]) {
      r[k] = () => {
        if (hang.includes(k)) return;
        Promise.resolve().then(() => ok?.(impl[k]()));
      };
    }
    return r;
  };
  (window as unknown as { google: unknown }).google = { script: { run: make() } };
}

describe("runServer 응답 한도", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { google?: unknown }).google;
    window.__fwSheetPrefetch = undefined;
  });

  it("응답이 안 오는 saveData는 한도 뒤 ServerTimeoutError로 끝난다", async () => {
    installGas({}, ["saveData"]);
    const { runServer, ServerTimeoutError, serverTimeoutMs } = await import("../services/gas");
    const p = runServer("saveData", "{}");
    const settled = vi.fn();
    p.catch(settled);
    await vi.advanceTimersByTimeAsync(serverTimeoutMs("saveData") - 1000);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    await expect(p).rejects.toBeInstanceOf(ServerTimeoutError);
  });

  it("정상 응답은 그대로 돌려주고 한도 타이머를 남기지 않는다", async () => {
    installGas({ listPhotos: () => [{ id: "a" }] });
    const { runServer } = await import("../services/gas");
    await expect(runServer("listPhotos")).resolves.toEqual([{ id: "a" }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("미리 보낸 부팅 loadData가 끝내 안 오면 다시 기다리지 않고 실패로 넘긴다", async () => {
    installGas({}, ["loadData"]);
    window.__fwSheetPrefetch = new Promise(() => {});
    const { loadSheetForBoot, ServerTimeoutError, serverTimeoutMs } = await import("../services/gas");
    const p = loadSheetForBoot();
    p.catch(() => {});
    await vi.advanceTimersByTimeAsync(serverTimeoutMs("loadData") + 1000);
    await expect(p).rejects.toBeInstanceOf(ServerTimeoutError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("시트 확인이 응답 없이 끝나면 '확인 중'에 갇히지 않고 failed로 — 자동 저장 보류가 풀린다", async () => {
    installGas({}, ["loadData"]);
    const { startBackgroundSheetCheck, useSheetBootStore, isSheetBootPending } = await import("../store/sheetBootStore");
    const { serverTimeoutMs } = await import("../services/gas");
    startBackgroundSheetCheck();
    expect(isSheetBootPending(useSheetBootStore.getState().status)).toBe(true);
    await vi.advanceTimersByTimeAsync(serverTimeoutMs("loadData") + 1000);
    expect(useSheetBootStore.getState().status).toBe("failed");
  });
});
