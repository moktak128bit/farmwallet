import { beforeEach, describe, expect, it } from "vitest";
import { decideSheetAdoption } from "../hooks/useSheetBootAdoption";
import { deriveGasSaveState, formatSavedAt } from "../components/GasSaveIndicator";
import { payloadContentHash } from "../services/gistSync";
import { selectPendingPhotoCount } from "../store/gasPhotoStore";

describe("GAS 백그라운드 시트 채택 판정 (내용 기준)", () => {
  const A = JSON.stringify({ ledger: [{ id: "L1" }], accounts: [] });
  const B = JSON.stringify({ ledger: [{ id: "L1" }, { id: "L2" }], accounts: [] });
  const base = payloadContentHash(A);

  it("화면 = 시트면 아무것도 안 함", () => {
    expect(decideSheetAdoption(A, A, base)).toBe("same");
  });
  it("재직렬화(최상위 키 순서)·자동 적립 시계열 차이만이면 같은 내용 — 스냅샷 없음", () => {
    const reordered = JSON.stringify({ accounts: [], ledger: [{ id: "L1" }], historicalDailyFx: [{ date: "2026-11-10", rate: 1460 }] });
    expect(decideSheetAdoption(reordered, A, base)).toBe("same");
    // 기준선이 없거나 어긋나도 내용이 시트와 같으면 same
    expect(decideSheetAdoption(reordered, A, null)).toBe("same");
  });
  it("이 기기 편집 없이 시트만 바뀜(다른 기기) → 조용히 시트로", () => {
    expect(decideSheetAdoption(A, B, base)).toBe("sheet-newer");
  });
  it("이 기기에 시트에 안 올라간 편집 → 스냅샷 후 시트로", () => {
    expect(decideSheetAdoption(B, A, base)).toBe("local-unsynced");
  });
  it("기준선 없음(첫 실행)·내용 다름 → 보수적으로 편집 있음", () => {
    expect(decideSheetAdoption(A, B, null)).toBe("local-unsynced");
  });
});

describe("GAS 저장 상태 표시", () => {
  const ok = { lastCheckAt: null, consecutiveFailures: 0, lastError: null };
  const base = { sheetBootPending: false, blockedReason: null, autoSyncEnabled: true, isSyncing: false, dirty: false, health: ok, lastPushAt: "2026-11-10T01:00:00.000Z" };

  it("시트 확인 중 > 저장 상태", () => {
    expect(deriveGasSaveState({ ...base, sheetBootPending: true, dirty: true }).kind).toBe("checking");
  });
  it("막힌 경로(로드 실패 등)는 그대로 보여 준다", () => {
    expect(deriveGasSaveState({ ...base, blockedReason: "x", sheetBootPending: true })).toEqual({ kind: "blocked", reason: "x" });
  });
  it("편집 대기·전송 중 = 저장 중, 끝나면 저장됨", () => {
    expect(deriveGasSaveState({ ...base, dirty: true }).kind).toBe("saving");
    expect(deriveGasSaveState({ ...base, isSyncing: true }).kind).toBe("saving");
    expect(deriveGasSaveState(base)).toEqual({ kind: "saved", at: base.lastPushAt });
  });
  it("실패가 남아 있고 못 올린 변경이 있으면 실패(재시도 버튼)", () => {
    const failed = { lastCheckAt: null, consecutiveFailures: 1, lastError: "Lock timeout" };
    expect(deriveGasSaveState({ ...base, dirty: true, health: failed })).toEqual({ kind: "error", message: "Lock timeout" });
    // 다 올라갔으면 지난 실패는 숨긴다
    expect(deriveGasSaveState({ ...base, health: failed }).kind).toBe("saved");
  });
  it("자동 저장 꺼짐", () => {
    expect(deriveGasSaveState({ ...base, autoSyncEnabled: false }).kind).toBe("off");
  });
  it("저장 시각 표기 — 1분 이내 방금, 오늘은 시:분", () => {
    const now = new Date("2026-11-10T03:00:30.000Z");
    expect(formatSavedAt("2026-11-10T03:00:00.000Z", now)).toBe("방금");
    expect(formatSavedAt("2026-11-10T01:05:00.000Z", now)).toMatch(/10:05/);
    expect(formatSavedAt(null, now)).toBe("");
  });
});

describe("사진 처리 전 수", () => {
  beforeEach(() => undefined);
  it("목록 실패·미조회면 null(배지·칩 숨김), 아니면 처리 전 개수", () => {
    expect(selectPendingPhotoCount({ photos: null, listError: null })).toBeNull();
    expect(selectPendingPhotoCount({ photos: [], listError: "x" })).toBeNull();
    expect(
      selectPendingPhotoCount({
        photos: [
          { id: "1", name: "a", uploadedAt: "", status: "처리 전" },
          { id: "2", name: "b", uploadedAt: "", status: "처리 완료" },
        ],
        listError: null,
      })
    ).toBe(1);
  });
});
