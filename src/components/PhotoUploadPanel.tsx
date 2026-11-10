/**
 * 사진 업로드 진행 패널 — 화면 아래에 떠서 몇 장째 올리는지, 어느 사진이 왜 실패했는지, 서버에 실제로
 * 몇 장 들어갔는지(목록 대조)를 보여 준다. 휴대폰 헤더는 버튼 글자가 숨어 진행이 안 보였다(2026-11-10).
 * 상태는 store/gasPhotoStore 공용 — 헤더 버튼·설정 사진 카드 어디서 올려도 같은 패널.
 */
import React from "react";
import { Check, Loader2, RotateCcw, X, AlertTriangle } from "lucide-react";
import { useGasPhotoStore, type PhotoUploadItem } from "../store/gasPhotoStore";

function stateLabel(x: PhotoUploadItem): string {
  if (x.state === "다시 시도 중") return `다시 시도 중 (${x.attempt}/3)`;
  return x.state;
}

export const PhotoUploadPanel: React.FC = () => {
  const items = useGasPhotoStore((s) => s.items);
  const uploading = useGasPhotoStore((s) => s.uploading);
  const panelOpen = useGasPhotoStore((s) => s.panelOpen);
  const verify = useGasPhotoStore((s) => s.verify);
  const retryFailed = useGasPhotoStore((s) => s.retryFailed);
  const closePanel = useGasPhotoStore((s) => s.closePanel);

  if (!panelOpen || items.length === 0) return null;

  const total = items.length;
  const done = items.filter((x) => x.state === "완료").length;
  const failed = items.filter((x) => x.state === "실패");
  const finished = done + failed.length;
  const pct = Math.round((finished / total) * 100);

  let headline: string;
  let tone: "progress" | "ok" | "bad";
  if (uploading) {
    const reading = items.some((x) => x.state === "읽는 중");
    headline = reading ? `사진 ${total}장 준비 중…` : `사진 올리는 중 ${done}/${total}`;
    tone = "progress";
  } else if (failed.length === 0 && verify && !verify.missing && !verify.error) {
    headline = `${total}장 모두 올라갔어요 · Drive에서 ${verify.confirmed}장 확인`;
    tone = "ok";
  } else if (failed.length === 0 && verify?.error) {
    headline = `${done}장 올림 · 확인용 목록을 못 받았어요`;
    tone = "bad";
  } else if (failed.length === 0 && verify?.missing) {
    headline = `${done}장 올림 · 그중 ${verify.missing}장이 Drive 목록에 없어요`;
    tone = "bad";
  } else {
    headline = `${done}장 올림 · ${failed.length}장 실패`;
    tone = "bad";
  }

  return (
    <div className={`photo-upload-panel tone-${tone}`} role="status" aria-live="polite">
      <div className="photo-upload-panel-head">
        {tone === "progress" ? (
          <Loader2 size={16} className="spin" aria-hidden />
        ) : tone === "ok" ? (
          <Check size={16} aria-hidden />
        ) : (
          <AlertTriangle size={16} aria-hidden />
        )}
        <strong>{headline}</strong>
        {!uploading && (
          <button type="button" className="icon-action" onClick={closePanel} aria-label="닫기" title="닫기">
            <X size={16} />
          </button>
        )}
      </div>
      <div className="photo-upload-progress" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </div>
      {uploading && <div className="photo-upload-hint">다 올라갈 때까지 이 화면을 켜 두세요.</div>}
      <ol className="photo-upload-list">
        {items.map((x, i) => (
          <li key={x.key} className={`st-${x.state === "완료" ? "ok" : x.state === "실패" ? "bad" : "wait"}`}>
            <span className="photo-upload-name">
              {i + 1}. {x.file.name || "사진"}
            </span>
            <span className="photo-upload-state">{stateLabel(x)}</span>
            {x.error && <span className="photo-upload-error">{x.error}</span>}
          </li>
        ))}
      </ol>
      {!uploading && failed.length > 0 && (
        <button type="button" className="primary photo-upload-retry" onClick={() => void retryFailed()}>
          <RotateCcw size={14} aria-hidden /> 실패한 {failed.length}장 다시 올리기
        </button>
      )}
    </div>
  );
};
