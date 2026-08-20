import { describe, it, expect, vi, afterEach } from "vitest";
import {
  formatErrorRecord,
  formatErrorLogLine,
  shouldSkipDuplicate,
  reportError
} from "../utils/errorReporting";
import { useUIStore } from "../store/uiStore";

describe("formatErrorRecord", () => {
  const now = new Date("2026-08-20T01:02:03.000Z");

  it("Error 객체 → message·stack(첫 줄 제외)·scope·version·ISO 시각", () => {
    const err = new Error("boom");
    err.stack = "Error: boom\n    at fnA (a.ts:1:1)\n    at fnB (b.ts:2:2)";
    const rec = formatErrorRecord("scopeA", err, undefined, now, "9.9.9");
    expect(rec).toEqual({
      scope: "scopeA",
      message: "boom",
      stack: "at fnA (a.ts:1:1)\nat fnB (b.ts:2:2)",
      version: "9.9.9",
      at: "2026-08-20T01:02:03.000Z"
    });
  });

  it("기본 version은 __APP_VERSION__(테스트 환경 'test')", () => {
    expect(formatErrorRecord("s", new Error("x"), undefined, now).version).toBe("test");
  });

  it("문자열·객체·null 등 non-Error도 메시지로 정규화", () => {
    expect(formatErrorRecord("s", "plain string", undefined, now).message).toBe("plain string");
    expect(formatErrorRecord("s", { message: "obj msg" }, undefined, now).message).toBe("obj msg");
    expect(formatErrorRecord("s", { code: 42 }, undefined, now).message).toBe('{"code":42}');
    expect(formatErrorRecord("s", null, undefined, now).message).toBe("null");
    expect(formatErrorRecord("s", undefined, undefined, now).stack).toBe("");
  });

  it("메시지·스택·extra는 300자에서 잘린다", () => {
    const long = "x".repeat(1000);
    const err = new Error(long);
    err.stack = `Error: ${long}\n${"y".repeat(1000)}`;
    const rec = formatErrorRecord("s", err, "z".repeat(1000), now);
    expect(rec.message.length).toBe(301); // 300 + 말줄임
    expect(rec.message.endsWith("…")).toBe(true);
    expect(rec.stack.length).toBe(301);
    expect(rec.extra?.length).toBe(301);
  });

  it("extra 객체는 JSON 직렬화, 빈 scope는 unknown", () => {
    const rec = formatErrorRecord("", new Error("e"), { componentStack: "in Foo" }, now);
    expect(rec.scope).toBe("unknown");
    expect(rec.extra).toBe('{"componentStack":"in Foo"}');
  });

  it("formatErrorLogLine은 scope·message·version·시각·extra·stack을 한 줄로", () => {
    const line = formatErrorLogLine({
      scope: "win",
      message: "m",
      stack: "at a",
      version: "1.0.0",
      at: "2026-08-20T00:00:00.000Z",
      extra: "ex"
    });
    expect(line).toBe("[오류:win] m | v1.0.0 | 2026-08-20T00:00:00.000Z | extra: ex | stack: at a");
    const noStack = formatErrorLogLine({ scope: "w", message: "m", stack: "", version: "1", at: "t" });
    expect(noStack).toBe("[오류:w] m | v1 | t");
  });
});

describe("shouldSkipDuplicate (5초 dedup)", () => {
  it("같은 scope+message가 5초 안에 오면 건너뛰고, 5초 지나면 다시 허용", () => {
    const t0 = 1_000_000;
    expect(shouldSkipDuplicate("dedupA", "msg", t0)).toBe(false);
    expect(shouldSkipDuplicate("dedupA", "msg", t0 + 1)).toBe(true);
    expect(shouldSkipDuplicate("dedupA", "msg", t0 + 4999)).toBe(true);
    expect(shouldSkipDuplicate("dedupA", "msg", t0 + 5000)).toBe(false);
  });

  it("scope 또는 message가 다르면 별개로 취급", () => {
    const t0 = 2_000_000;
    expect(shouldSkipDuplicate("dedupB", "msg", t0)).toBe(false);
    expect(shouldSkipDuplicate("dedupB", "msg2", t0)).toBe(false);
    expect(shouldSkipDuplicate("dedupC", "msg", t0)).toBe(false);
  });
});

describe("reportError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("활동 로그에 'error' 타입으로 쌓고 console.error 호출, 5초 내 반복은 1건만", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T10:00:00.000Z"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const before = useUIStore.getState().appLog.length;

    reportError("reportA", new Error("loop error"));
    reportError("reportA", new Error("loop error"));
    reportError("reportA", new Error("loop error"));

    const after = useUIStore.getState().appLog;
    expect(after.length).toBe(before + 1);
    const last = after[after.length - 1];
    expect(last.type).toBe("error");
    expect(last.message).toContain("[오류:reportA] loop error");
    expect(last.message).toContain("vtest");
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    // 5초 경과 후 같은 오류는 다시 기록
    vi.setSystemTime(new Date("2026-08-20T10:00:05.000Z"));
    reportError("reportA", new Error("loop error"));
    expect(useUIStore.getState().appLog.length).toBe(before + 2);
  });

  it("어떤 입력에도 throw하지 않는다", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => reportError("reportB", cyclic, cyclic)).not.toThrow();
  });
});
