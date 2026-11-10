/**
 * 사진 올리기 — 토스·카톡 캡처를 Drive 사진 폴더(오늘 날짜 폴더)에 올린다. GAS 웹앱에서만 동작.
 * 나중에 Claude가 사진을 읽어 변경분 파일을 만들고, 그 파일을 적용하면 사진이 처리 완료로 옮겨진다
 * (LedgerFileImportCard). 여기서는 수동으로 처리 전/완료를 바꿀 수도 있다.
 */
import React, { useEffect, useRef, useState } from "react";
import { Check, ImageUp, RotateCcw, Undo2 } from "lucide-react";
import { isGas, PHOTO_PROCESSED, type GasPhoto } from "../../services/gas";
import { useGasPhotoStore } from "../../store/gasPhotoStore";

const PROCESSED = PHOTO_PROCESSED;

const formatUploadedAt = (iso: string): string =>
  iso
    ? new Date(iso).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" })
    : "";

export const GasPhotosCard: React.FC = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  // 업로드·목록은 헤더 버튼·대시보드 칩과 공유(store/gasPhotoStore)
  const items = useGasPhotoStore((s) => s.items);
  const uploading = useGasPhotoStore((s) => s.uploading);
  const photos = useGasPhotoStore((s) => s.photos);
  const listError = useGasPhotoStore((s) => s.listError);
  const refresh = useGasPhotoStore((s) => s.refresh);
  const uploadFiles = useGasPhotoStore((s) => s.uploadFiles);
  const retryFailed = useGasPhotoStore((s) => s.retryFailed);
  const setProcessed = useGasPhotoStore((s) => s.setProcessed);
  const [showProcessed, setShowProcessed] = useState(false);

  useEffect(() => {
    if (isGas()) void refresh();
  }, [refresh]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length) void uploadFiles(files);
  };

  const toggleProcessed = (photo: GasPhoto) => setProcessed(photo, photo.status !== PROCESSED);

  if (!isGas()) {
    return (
      <div className="card">
        <div className="card-title">사진 올리기</div>
        <p className="hint" style={{ margin: 0 }}>
          Google 웹앱(GAS)에서 열었을 때만 쓸 수 있습니다 — 사진은 Drive 사진 폴더에 저장됩니다.
        </p>
      </div>
    );
  }

  const doneCount = items.filter((x) => x.state === "완료").length;
  const failed = items.filter((x) => x.state === "실패");
  const pending = (photos ?? []).filter((p) => p.status !== PROCESSED);
  const processed = (photos ?? []).filter((p) => p.status === PROCESSED);
  const shown = showProcessed ? processed : pending;

  return (
    <div className="card">
      <div className="card-title">사진 올리기</div>
      <p className="hint" style={{ marginBottom: 12 }}>
        토스·카톡 캡처를 여러 장 골라 올리면 Drive 사진 폴더의 오늘 날짜 폴더에 저장됩니다. 나중에 Claude에게 가계부 정리를 맡기면 됩니다.
      </p>
      <input ref={inputRef} type="file" accept="image/*" multiple onChange={onPick} style={{ display: "none" }} />
      <button
        type="button"
        className="primary"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 22px", fontSize: 14 }}
      >
        <ImageUp size={16} aria-hidden /> {uploading ? `올리는 중 ${doneCount}/${items.length}` : "사진 고르기"}
      </button>

      {items.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          <div className="hint" style={{ marginBottom: 4 }}>
            {doneCount}/{items.length}장 완료{failed.length ? ` · 실패 ${failed.length}장` : ""}
          </div>
          {failed.length > 0 && !uploading && (
            <button
              type="button"
              className="secondary"
              onClick={() => void retryFailed()}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <RotateCcw size={14} aria-hidden /> 실패한 {failed.length}장 다시 올리기
            </button>
          )}
          {failed.map((x) => (
            <div key={x.key} className="hint" style={{ color: "var(--danger)" }}>
              {x.file.name}: {x.error}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button type="button" className={showProcessed ? "" : "primary"} onClick={() => setShowProcessed(false)}>
            처리 전 {pending.length}
          </button>
          <button type="button" className={showProcessed ? "primary" : ""} onClick={() => setShowProcessed(true)}>
            처리 완료 {processed.length}
          </button>
        </div>
        {photos === null ? (
          <div className="hint">{listError ? `사진 목록을 불러오지 못했습니다: ${listError}` : "불러오는 중…"}</div>
        ) : shown.length === 0 ? (
          <div className="hint">{showProcessed ? "처리 완료된 사진이 없습니다." : "처리할 사진이 없습니다."}</div>
        ) : (
          <table className="data-table compact">
            <thead>
              <tr>
                <th>이름</th>
                <th>올린 시각</th>
                <th aria-label="상태 바꾸기" />
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const label = p.status === PROCESSED ? "처리 전으로 되돌리기" : "처리 완료로 표시";
                return (
                  <tr key={p.id}>
                    <td style={{ wordBreak: "break-all" }}>{p.name}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{formatUploadedAt(p.uploadedAt)}</td>
                    <td>
                      <button type="button" className="icon-action" onClick={() => void toggleProcessed(p)} title={label} aria-label={label}>
                        {p.status === PROCESSED ? <Undo2 size={14} aria-hidden /> : <Check size={14} aria-hidden />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
