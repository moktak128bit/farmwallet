/**
 * 헤더 왼쪽 위 "사진 올리기" — GAS 웹앱에서만. 누르면 바로 파일 선택(여러 장) → 업로드 → 화면 아래 진행 패널.
 * 처리 전 사진 수는 작은 배지로. 목록·업로드 상태는 설정 사진 카드·대시보드 칩과 공유(store/gasPhotoStore).
 */
import React, { useEffect, useRef } from "react";
import { Camera, Loader2 } from "lucide-react";
import { isGas } from "../services/gas";
import { selectPendingPhotoCount, useGasPhotoStore } from "../store/gasPhotoStore";

export const GasPhotoButton: React.FC = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const uploading = useGasPhotoStore((s) => s.uploading);
  const items = useGasPhotoStore((s) => s.items);
  const refresh = useGasPhotoStore((s) => s.refresh);
  const uploadFiles = useGasPhotoStore((s) => s.uploadFiles);
  const pending = useGasPhotoStore(selectPendingPhotoCount);
  const gas = isGas();

  useEffect(() => {
    if (gas) void refresh();
  }, [gas, refresh]);

  if (!gas) return null;

  const done = items.filter((x) => x.state === "완료" || x.state === "실패").length;
  // 올리는 동안엔 휴대폰에서도 보이게 짧게 (자세한 진행은 화면 아래 PhotoUploadPanel)
  const label = uploading ? `${done}/${items.length}` : "사진 올리기";
  const title = pending != null && pending > 0 ? `사진 올리기 · 처리 전 ${pending}장` : "사진 올리기 (토스·카톡 캡처)";

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void uploadFiles(files);
        }}
      />
      <button
        type="button"
        className={uploading ? "header-action photo-upload-btn is-uploading" : "header-action photo-upload-btn"}
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        title={title}
        aria-label={title}
      >
        {uploading ? <Loader2 size={14} className="spin" aria-hidden /> : <Camera size={14} aria-hidden />}
        <span>{label}</span>
        {pending != null && pending > 0 && !uploading && (
          <b className="photo-upload-badge" aria-hidden>{pending}</b>
        )}
      </button>
    </>
  );
};
