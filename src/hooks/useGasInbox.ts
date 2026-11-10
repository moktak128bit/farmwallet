/**
 * Claude 받은 편지함 (GAS) — Claude가 만든 변경분(farmwallet-delta-v1)을 사용자가 파일로 고르지 않아도
 * 앱이 열릴 때 평소 저장 경로로 반영한다.
 *
 *   Claude: 변경분을 gas/Inbox.html(JSON 배열, gitignore)에 넣고 clasp push → 서버 pendingDeltas()가 돌려줌
 *   앱:     시트 채택이 끝난 뒤 → 안전 스냅샷 → applyLedgerDelta → 자동 저장(5초)이 시트에 기록
 *
 * 적용 완료 표시(markDeltaApplied)는 "적용해도 바뀌는 게 없을 때" 한다 — 즉 시트에서 받은 장부에 이미 다 들어가
 * 있음이 확인된 다음 열기에서. 첫 적용 직후 바로 표시하면, 자동 저장 전에 앱을 닫았을 때 다음 열기의 시트 채택이
 * 기기 편집을 덮어 변경분이 사라져도 다시 적용되지 않는다. 같은 변경분을 다시 적용해도 applyLedgerDelta가
 * 같은 거래를 건너뛰므로 안전하다.
 * (사용자가 "니가 직접 반영해"로 맡긴 경로라 미리보기 확인 없이 적용하고 결과를 토스트로 알린다 — 되돌리기는
 *  Ctrl+Z 또는 안전 스냅샷.)
 */
import { useEffect, useRef } from "react";
import { toast } from "react-hot-toast";
import type { AppData } from "../types";
import { isGas, runServer } from "../services/gas";
import { mergeCurrentCaches, normalizeImportedData, saveSafetySnapshot } from "../storage";
import { useAppStore } from "../store/appStore";
import { applyLedgerDelta, formatDeltaReport, isLedgerDelta, type LedgerDelta, type LedgerDeltaReport } from "../utils/ledgerDelta";

export interface InboxDelta {
  id: string;
  title?: string;
  delta: LedgerDelta;
}

/** 순수 계획 — 지금 데이터에 변경분을 더한 결과와, 실제로 바뀌는 게 있는지 */
export function planInboxApply(current: AppData, delta: LedgerDelta): { after: AppData; report: LedgerDeltaReport; changed: boolean } {
  const { next, report } = applyLedgerDelta(current, delta);
  const changed =
    JSON.stringify(next.ledger) !== JSON.stringify(current.ledger) ||
    JSON.stringify(next.trades) !== JSON.stringify(current.trades) ||
    JSON.stringify(next.accounts) !== JSON.stringify(current.accounts);
  return { after: changed ? mergeCurrentCaches(normalizeImportedData(next), current) : current, report, changed };
}

async function markPhotosProcessed(names: string[]): Promise<void> {
  if (!names.length) return;
  const ids = await runServer<string[]>("photoIdsByName", names);
  await runServer("setPhotosProcessed", ids.filter(Boolean), true);
}

/** ready = 장부 로드·시트 채택이 끝나 저장이 열려 있는 상태. 세션당 한 번 확인한다. */
export function useGasInbox(ready: boolean, onChangeData: (next: AppData) => void): void {
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!ready || checkedRef.current || !isGas()) return;
    checkedRef.current = true;
    void (async () => {
      let list: InboxDelta[];
      try {
        list = await runServer<InboxDelta[]>("pendingDeltas");
      } catch {
        return; // 서버에 편지함 함수가 없거나(옛 배포) 일시 오류 — 다음 열기에 다시
      }
      for (const item of Array.isArray(list) ? list : []) {
        if (!item?.id || !isLedgerDelta(item.delta)) continue;
        const current = useAppStore.getState().data;
        const { after, report, changed } = planInboxApply(current, item.delta);
        const title = item.title || item.id;
        if (!changed) {
          // 시트 장부에 이미 다 들어 있음 → 완료 표시(사진도)
          try {
            await runServer("markDeltaApplied", item.id, formatDeltaReport(report));
            await markPhotosProcessed(item.delta.sourcePhotos ?? []);
          } catch {
            /* 다음 열기에 다시 */
          }
          continue;
        }
        try {
          await saveSafetySnapshot(current, `Claude 변경분 적용 직전 (${title})`);
        } catch {
          /* 스냅샷 실패해도 적용은 진행 — 되돌리기(Ctrl+Z)는 남는다 */
        }
        onChangeData(after);
        toast.success(`Claude가 보낸 변경분 — ${title}\n${formatDeltaReport(report)}`, { id: `inbox-${item.id}`, duration: 10000 });
      }
    })();
  }, [ready, onChangeData]);
}
