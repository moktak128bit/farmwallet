// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildConnectUrl,
  decodeConnectPayload,
  takeConnectPayloadFromLocation,
  isEmptyLocalData,
  describeConnectTarget
} from "../services/deviceConnect";
import { getGistVersionsWithCredentials } from "../services/gistSync";

const P = { gistId: "0123456789abcdef0123456789abcdef", token: "ghp_TESTTOKEN123" };
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("deviceConnect", () => {
  it("buildConnectUrl ↔ decodeConnectPayload 왕복", () => {
    const url = buildConnectUrl(P);
    expect(url.startsWith("https://moktak128bit.github.io/farmwallet/#fw-connect=")).toBe(true);
    expect(url).not.toContain("ghp_");
    expect(decodeConnectPayload(url)).toEqual(P);
  });
  it("decodeConnectPayload: 공백·뒤 파라미터 허용", () => {
    const value = buildConnectUrl(P).split("#fw-connect=")[1];
    expect(decodeConnectPayload(`  \n${buildConnectUrl(P)}\n `)).toEqual(P);
    expect(decodeConnectPayload(`fw-connect=${value}`)).toEqual(P);
    expect(decodeConnectPayload(value)).toEqual(P);
    expect(decodeConnectPayload(`https://x/#fw-connect=${value}&x=1`)).toEqual(P);
  });
  it("decodeConnectPayload: 깨진 입력은 null", () => {
    expect(decodeConnectPayload("")).toBeNull();
    expect(decodeConnectPayload("#fw-connect=%%%")).toBeNull();
    expect(decodeConnectPayload(b64({ v: 2, g: P.gistId, t: P.token }))).toBeNull();
    expect(decodeConnectPayload(b64({ v: 1, g: P.gistId }))).toBeNull();
    expect(decodeConnectPayload(b64({ v: 1, g: "not-hex!", t: P.token }))).toBeNull();
    expect(decodeConnectPayload(b64({ v: 1, g: P.gistId, t: "a b" }))).toBeNull();
  });
  it("takeConnectPayloadFromLocation: 해시 없으면 none", () => {
    window.history.replaceState(null, "", "/farmwallet/?tab=dashboard");
    expect(takeConnectPayloadFromLocation()).toEqual({ status: "none" });
    expect(window.location.search).toBe("?tab=dashboard");
  });
  it("takeConnectPayloadFromLocation: 유효하면 ok + 해시 제거, 쿼리 보존, 두 번째 호출은 none", () => {
    window.history.replaceState(null, "", `/farmwallet/?tab=dashboard#fw-connect=${buildConnectUrl(P).split("#fw-connect=")[1]}`);
    expect(takeConnectPayloadFromLocation()).toEqual({ status: "ok", payload: P });
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?tab=dashboard");
    expect(takeConnectPayloadFromLocation()).toEqual({ status: "none" });
  });
  it("takeConnectPayloadFromLocation: 깨졌으면 invalid + 해시 제거", () => {
    window.history.replaceState(null, "", "/farmwallet/#fw-connect=%%%");
    expect(takeConnectPayloadFromLocation()).toEqual({ status: "invalid" });
    expect(window.location.hash).toBe("");
  });
  it("isEmptyLocalData", () => {
    const empty = { ledger: [], accounts: [], trades: [] };
    expect(isEmptyLocalData(empty)).toBe(true);
    expect(isEmptyLocalData({ ...empty, ledger: [{}] as never })).toBe(false);
    expect(isEmptyLocalData({ ...empty, accounts: [{}] as never })).toBe(false);
  });
  it("describeConnectTarget", () => {
    expect(describeConnectTarget("", P.gistId)).toEqual({ shortId: "abcdef", currentShortId: null, replacesOther: false });
    expect(describeConnectTarget(P.gistId, P.gistId).replacesOther).toBe(false);
    expect(describeConnectTarget("ffffffffffffffffffff999999", P.gistId)).toEqual({ shortId: "abcdef", currentShortId: "999999", replacesOther: true });
  });
  it("getGistVersionsWithCredentials: 주어진 토큰으로 호출, 401이면 토큰 오류 메시지", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getGistVersionsWithCredentials("ghp_X", "abc", 1)).rejects.toThrow("토큰이 유효하지 않습니다");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer ghp_X");
  });
});
