// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 휴대폰에서 7장 중 4장만 올라가고 실패가 안 보이던 문제(2026-11-10) 회귀:
 * 모든 사진을 먼저 읽고, 실패는 자동 재시도, 끝나면 서버 목록으로 대조한다.
 * + 시작 시 index.html이 미리 보낸 loadData를 한 번만 쓰는 loadSheetForBoot.
 */

type Handler = (v: unknown) => void;
interface Call { fn: string; args: unknown[] }

function installGas(impl: Record<string, (...a: unknown[]) => unknown>) {
  const calls: Call[] = [];
  const make = (ok?: Handler, fail?: Handler): Record<string, unknown> => {
    const r: Record<string, unknown> = {
      withSuccessHandler: (f: Handler) => make(f, fail),
      withFailureHandler: (f: Handler) => make(ok, f),
    };
    for (const k of Object.keys(impl)) {
      r[k] = (...args: unknown[]) => {
        calls.push({ fn: k, args });
        Promise.resolve().then(() => {
          try {
            ok?.(impl[k](...args));
          } catch (e) {
            fail?.(e);
          }
        });
      };
    }
    return r;
  };
  (window as unknown as { google: unknown }).google = { script: { run: make() } };
  return calls;
}

/** 업로드 묶음이 끝날 때까지 가짜 타이머(재시도 대기)와 실제 비동기(FileReader)를 번갈아 돌린다 */
async function drain(p: Promise<unknown>) {
  let done = false;
  void p.finally(() => { done = true; });
  for (let i = 0; i < 500 && !done; i++) {
    await new Promise((r) => setImmediate(r));
    await vi.advanceTimersByTimeAsync(500);
  }
  await p;
}

const file = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

describe("사진 업로드 — 재시도·대조", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { google?: unknown }).google;
  });

  it("일시 실패는 자동 재시도로 올리고, 계속 실패한 사진은 이유와 함께 남긴다", async () => {
    const stored: { id: string; name: string; uploadedAt: string; status: string }[] = [];
    const tries: Record<string, number> = {};
    const calls = installGas({
      uploadPhoto: (name) => {
        const n = String(name);
        tries[n] = (tries[n] ?? 0) + 1;
        if (n === "c.png" && tries[n] <= 2) throw new Error("Exception: 서버 시간 초과");
        if (n === "e.png") throw new Error("Exception: 요청이 너무 큼");
        const p = { id: `D${stored.length + 1}`, name: n, uploadedAt: "2026-11-10T00:00:00Z", status: "처리 전" };
        stored.push(p);
        return p;
      },
      listPhotos: () => stored.slice().reverse(),
    });
    const { useGasPhotoStore } = await import("../store/gasPhotoStore");
    const run = useGasPhotoStore.getState().uploadFiles(["a.png", "b.png", "c.png", "d.png", "e.png"].map(file));
    await drain(run);

    const s = useGasPhotoStore.getState();
    expect(s.uploading).toBe(false);
    expect(s.panelOpen).toBe(true);
    expect(s.items.map((x) => x.state)).toEqual(["완료", "완료", "완료", "완료", "실패"]);
    expect(s.items[4].error).toBe("요청이 너무 큼");
    expect(tries["c.png"]).toBe(3);
    expect(tries["e.png"]).toBe(3);
    expect(s.verify).toEqual({ confirmed: 4, missing: 0 });
    // 한 장씩(동시 호출 없음) — 업로드 호출 순서가 고른 순서
    expect(calls.filter((c) => c.fn === "uploadPhoto").map((c) => c.args[0])).toEqual([
      "a.png", "b.png", "c.png", "c.png", "c.png", "d.png", "e.png", "e.png", "e.png",
    ]);

    // 실패한 것만 다시 — 이미 올린 사진은 다시 안 올린다
    const before = calls.length;
    const retry = useGasPhotoStore.getState().retryFailed();
    await drain(retry);
    expect(calls.slice(before).filter((c) => c.fn === "uploadPhoto").every((c) => c.args[0] === "e.png")).toBe(true);
  });

  it("올렸다는 응답을 받았는데 서버 목록에 없으면 missing으로 알린다", async () => {
    installGas({
      uploadPhoto: (name) => ({ id: `X-${String(name)}`, name, uploadedAt: "", status: "처리 전" }),
      listPhotos: () => [{ id: "X-a.png", name: "a.png", uploadedAt: "", status: "처리 전" }],
    });
    const { useGasPhotoStore } = await import("../store/gasPhotoStore");
    const run = useGasPhotoStore.getState().uploadFiles([file("a.png"), file("b.png")]);
    await drain(run);
    expect(useGasPhotoStore.getState().verify).toEqual({ confirmed: 1, missing: 1 });
  });

  it("전부 성공하면 패널은 잠시 뒤 스스로 닫힌다", async () => {
    const stored: { id: string }[] = [];
    installGas({
      uploadPhoto: () => {
        const p = { id: `D${stored.length}`, name: "x", uploadedAt: "", status: "처리 전" };
        stored.push(p);
        return p;
      },
      listPhotos: () => stored,
    });
    const { useGasPhotoStore } = await import("../store/gasPhotoStore");
    const run = useGasPhotoStore.getState().uploadFiles([file("a.png")]);
    await drain(run);
    expect(useGasPhotoStore.getState().panelOpen).toBe(true);
    await vi.advanceTimersByTimeAsync(7000);
    expect(useGasPhotoStore.getState().panelOpen).toBe(false);
  });
});

describe("loadSheetForBoot — 미리 보낸 시트 요청은 한 번만", () => {
  afterEach(() => {
    delete (window as unknown as { google?: unknown }).google;
    window.__fwSheetPrefetch = undefined;
  });

  it("미리 받은 결과를 쓰고, 두 번째는 새로 요청한다", async () => {
    const calls = installGas({ loadData: () => ({ dataJson: "fresh", updatedAt: "t2", revision: 2, schemaVersion: 12 }) });
    window.__fwSheetPrefetch = Promise.resolve({ dataJson: "pre", updatedAt: "t1", revision: 1, schemaVersion: 12 });
    const { loadSheetForBoot } = await import("../services/gas");
    expect((await loadSheetForBoot()).dataJson).toBe("pre");
    expect(calls.length).toBe(0);
    expect((await loadSheetForBoot()).dataJson).toBe("fresh");
    expect(calls.map((c) => c.fn)).toEqual(["loadData"]);
  });

  it("미리 보낸 요청이 실패했으면 지금 다시 요청한다", async () => {
    const calls = installGas({ loadData: () => ({ dataJson: "fresh", updatedAt: "t2", revision: 2, schemaVersion: 12 }) });
    const failed = Promise.reject(new Error("no-gas"));
    failed.catch(() => {});
    window.__fwSheetPrefetch = failed;
    const { loadSheetForBoot } = await import("../services/gas");
    expect((await loadSheetForBoot()).dataJson).toBe("fresh");
    expect(calls.length).toBe(1);
  });
});
