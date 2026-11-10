// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { getGistAutoSync, setGistAutoSync, setGistId, setGistToken } from "../services/gistSync";

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe("Gist 최초 연결 자동 동기화", () => {
  it("새 기기는 연결 정보가 완성되면 자동 동기화가 기본으로 켜짐", () => {
    expect(getGistAutoSync()).toBe(false);
    setGistToken("test-token");
    expect(getGistAutoSync()).toBe(false);
    setGistId("a".repeat(32));
    expect(getGistAutoSync()).toBe(true);
  });
  it("사용자가 명시적으로 끈 설정은 연결해도 유지함", () => {
    setGistAutoSync(false);
    setGistToken("test-token");
    setGistId("a".repeat(32));
    expect(getGistAutoSync()).toBe(false);
  });
});
