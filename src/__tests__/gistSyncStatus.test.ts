import { describe, it, expect } from "vitest";
import { deriveGistSyncStatus, type GistSyncHealth } from "../services/gistSyncStatus";

const okHealth: GistSyncHealth = { lastCheckAt: null, consecutiveFailures: 0, lastError: null };

describe("deriveGistSyncStatus", () => {
  it("off: 자동 동기화가 꺼져 있으면", () => {
    const r = deriveGistSyncStatus({ autoSyncEnabled: false, hasToken: true, hasGistId: true, health: okHealth });
    expect(r).toEqual({ kind: "off", message: null });
  });

  it("disconnected: ID+자동동기화인데 토큰이 없으면 안내 메시지", () => {
    const r = deriveGistSyncStatus({ autoSyncEnabled: true, hasToken: false, hasGistId: true, health: okHealth });
    expect(r.kind).toBe("disconnected");
    expect(r.message).toBe("토큰이 없어 동기화가 멈췄어요. PC에서 연결 QR을 다시 찍거나 설정에서 토큰을 입력하세요.");
  });

  it("실패 1회는 ok", () => {
    const r = deriveGistSyncStatus({
      autoSyncEnabled: true, hasToken: true, hasGistId: true,
      health: { lastCheckAt: null, consecutiveFailures: 1, lastError: "x" },
    });
    expect(r).toEqual({ kind: "ok", message: null });
  });

  it("실패 2회는 error", () => {
    const r = deriveGistSyncStatus({
      autoSyncEnabled: true, hasToken: true, hasGistId: true,
      health: { lastCheckAt: null, consecutiveFailures: 2, lastError: "네트워크 연결을 확인해주세요." },
    });
    expect(r).toEqual({ kind: "error", message: "동기화 오류: 네트워크 연결을 확인해주세요." });
  });

  it("disconnected가 error보다 우선", () => {
    const r = deriveGistSyncStatus({
      autoSyncEnabled: true, hasToken: false, hasGistId: true,
      health: { lastCheckAt: null, consecutiveFailures: 5, lastError: "x" },
    });
    expect(r.kind).toBe("disconnected");
  });
});
