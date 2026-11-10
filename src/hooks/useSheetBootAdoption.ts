/**
 * GAS 백그라운드 시트 채택 — store/sheetBootStore가 받아 둔 시트 장부를 앱 데이터가 준비되면 한 번 적용한다.
 *
 * 규칙(v7 부팅 채택과 같음, CLAUDE.md 운영 방식):
 *  - 시트가 원본. 화면 장부와 시트의 '내용'이 다르면 시트로 맞춘다.
 *  - 이 기기에 시트에 안 올라간 편집이 있었으면 그때만 안전 스냅샷을 먼저 남긴다.
 * 판정은 '내용' 기준(payloadContentHash — 최상위 키 순서·자동 적립 시계열 무시)이고, 기준선은 이 기기가 마지막으로
 * 시트와 맞춘 내용 해시(GasSheetInfo.contentHash)다. 예전엔 문자열·해시를 그대로 비교해 재직렬화·환율 적립만으로도
 * '미저장 편집'으로 보여 부팅마다 스냅샷이 쌓였다(하루 한도 5개를 2분 만에 채움).
 * 자동 적립 시계열은 버리지 않고 시트 ∪ 기기로 합친다. 적용 뒤 동기화 표식을 시트 기준으로 맞춘 다음에야
 * 자동 저장이 풀린다(App이 isSheetBootPending 동안 useGistSync를 disabled로 둔다).
 */
import { useEffect } from "react";
import { toast } from "react-hot-toast";
import { useAppStore } from "../store/appStore";
import { isSheetBootPending, useSheetBootStore } from "../store/sheetBootStore";
import { toUserDataJson } from "../services/dataService";
import { saveSafetySnapshot } from "../services/backupService";
import { getGasSheetInfo, recordGasSheetInfo } from "../services/gas";
import {
  hashGistPayload,
  payloadContentHash,
  setGistLastPullAt,
  setGistLastPushAt,
  setGistLastPushedHash,
} from "../services/gistSync";
import { mergeGistPayloadTimeSeries } from "../utils/timeSeriesMerge";

type SheetAdoptionOutcome =
  /** 내용 같음 — 시계열만 합친다(필요하면) */
  | "same"
  /** 다른 기기가 시트를 바꿈, 이 기기 편집 없음 — 조용히 시트로 */
  | "sheet-newer"
  /** 이 기기에 시트에 안 올라간 편집 — 스냅샷 후 시트로 */
  | "local-unsynced";

/**
 * 순수 판정. baselineContentHash = 이 기기가 마지막으로 시트와 맞춘 내용 해시(없으면 첫 실행 — 판단 불가라
 * 내용이 다르면 편집이 있었다고 보수적으로 본다: 스냅샷이 남을 뿐 데이터는 잃지 않는다).
 */
export function decideSheetAdoption(currentJson: string, sheetJson: string, baselineContentHash: string | null): SheetAdoptionOutcome {
  if (currentJson === sheetJson) return "same";
  const cur = payloadContentHash(currentJson);
  const sheet = payloadContentHash(sheetJson);
  if (cur === sheet) return "same";
  if (baselineContentHash != null && cur === baselineContentHash) return "sheet-newer";
  return "local-unsynced";
}

export function useSheetBootAdoption(
  ready: boolean,
  applyPulled: (dataJson: string, remoteUpdatedAt: string, opts?: { skipSnapshot?: boolean }) => void
): boolean {
  const status = useSheetBootStore((s) => s.status);

  useEffect(() => {
    if (status === "failed") {
      const error = useSheetBootStore.getState().error;
      useSheetBootStore.setState({ status: "done" });
      toast.error(`시트를 불러오지 못해 이 기기에 저장된 사본을 보여 줍니다${error ? ` (${error})` : ""}`, { id: "sheet-boot-failed" });
      return;
    }
    if (!ready || status !== "loaded") return;
    const result = useSheetBootStore.getState().result;
    // 한 번만 소비 — StrictMode 이중 실행에도 status가 바뀌어 다시 적용하지 않는다
    useSheetBootStore.setState({ status: "done", result: null });
    if (!result?.dataJson) return;

    const current = useAppStore.getState().data;
    const currentJson = toUserDataJson(current);
    const outcome = decideSheetAdoption(currentJson, result.dataJson, getGasSheetInfo().contentHash);
    // 시트 장부 + 이 기기 자동 적립 시계열(환율·지수·스냅샷) — 어느 쪽 적립도 버리지 않는다
    const merged = mergeGistPayloadTimeSeries(result.dataJson, currentJson).json;

    if (outcome === "same") {
      // 내용 같음 — 시트에만 있는 시계열 점이 있을 때만 합쳐 넣는다(없으면 화면을 건드리지 않음)
      if (mergeGistPayloadTimeSeries(currentJson, result.dataJson).filledFromOther > 0) applyPulled(merged, result.updatedAt, { skipSnapshot: true });
    } else {
      if (outcome === "local-unsynced") {
        void saveSafetySnapshot(current, "시트 장부로 덮기 직전(기기 미저장 편집)");
      }
      applyPulled(merged, result.updatedAt, { skipSnapshot: true });
      if (outcome === "sheet-newer") toast.success("시트 최신으로 갱신됨", { id: "sheet-boot-adopted" });
      else toast("이 기기에서 시트에 안 올라간 편집은 안전 스냅샷으로 보관하고 시트 장부로 맞췄습니다", { id: "sheet-boot-adopted", duration: 6000 });
    }
    setGistLastPullAt(result.updatedAt);
    setGistLastPushAt(result.updatedAt);
    setGistLastPushedHash(hashGistPayload(result.dataJson));
    recordGasSheetInfo("load", result, payloadContentHash(result.dataJson));
  }, [ready, status, applyPulled]);

  return isSheetBootPending(status);
}
