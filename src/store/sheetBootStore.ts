/**
 * GAS 시작 시 시트 장부 확인(백그라운드) 상태.
 *
 * 예전(v7)엔 main.tsx가 서버 loadData를 끝까지 기다린 뒤 첫 화면을 그렸다 — 시트 왕복(1~3초)만큼 매번 빈 화면.
 * 이제 기기에 사본(캐시)이 있으면 바로 그리고, 시트는 여기서 백그라운드로 받아 hooks/useSheetBootAdoption이
 * 채택 규칙(시트가 원본, 기기 미저장 편집은 안전 스냅샷 후 덮기)을 그대로 적용한다. 확인이 끝날 때까지
 * 자동 저장은 멈춘다(오래된 사본이 시트를 덮지 않게). 캐시가 없으면 main.tsx가 예전처럼 기다린다.
 */
import { create } from "zustand";
import { loadSheetForBoot, recordGasSheetInfo, type GasLoadResult } from "../services/gas";

type SheetBootStatus = "idle" | "checking" | "loaded" | "failed" | "done";

interface SheetBootState {
  status: SheetBootStatus;
  result: GasLoadResult | null;
  error: string | null;
}

export const useSheetBootStore = create<SheetBootState>(() => ({ status: "idle", result: null, error: null }));

/** main.tsx — 캐시로 첫 화면을 그리기 직전에 호출. 서버 왕복을 렌더와 겹친다. */
export function startBackgroundSheetCheck(): void {
  useSheetBootStore.setState({ status: "checking", result: null, error: null });
  loadSheetForBoot().then(
    (result) => {
      recordGasSheetInfo("load", result);
      useSheetBootStore.setState({ status: "loaded", result });
    },
    (err) => useSheetBootStore.setState({ status: "failed", error: err instanceof Error ? err.message : String(err) })
  );
}

/** 시트 확인이 끝나지 않아 자동 저장을 멈춰야 하는가 */
export function isSheetBootPending(status: SheetBootStatus): boolean {
  return status === "checking" || status === "loaded";
}
