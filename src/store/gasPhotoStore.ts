/**
 * GAS 사진 올리기 공용 상태 — 헤더 "사진 올리기" 버튼·업로드 진행 패널·대시보드 확인할 일 칩·설정 사진 카드가 같은 목록을 본다.
 * (각자 listPhotos를 부르면 서버 호출이 겹치고, 올린 직후 배지·칩 숫자가 서로 어긋난다.)
 * GAS 밖(로컬 개발)에서는 아무 서버 호출도 하지 않는다.
 *
 * 2026-11-10 휴대폰에서 7장을 골랐는데 4장만 올라가고 실패도 안 보이던 문제:
 *  - 고른 직후 모든 파일을 먼저 읽어 둔다 — 휴대폰은 파일 선택 뒤 시간이 지나면(앞 사진 업로드 동안)
 *    뒤쪽 파일 접근이 끊기는 경우가 있다(NotReadableError).
 *  - 한 장씩 올리고, 실패하면 잠깐 쉬었다 최대 3번까지 자동 재시도.
 *  - 끝나면 서버 사진 목록을 다시 받아 실제로 들어간 장수를 대조(verify)한다.
 *  - 진행·결과는 components/PhotoUploadPanel이 화면 아래에 띄운다(휴대폰 헤더는 글자가 숨는다).
 */
import { create } from "zustand";
import { toast } from "react-hot-toast";
import { isGas, PHOTO_PROCESSED, runServer, type GasPhoto } from "../services/gas";

type PhotoUploadState = "읽는 중" | "대기" | "올리는 중" | "다시 시도 중" | "완료" | "실패";
export interface PhotoUploadItem {
  key: string;
  file: File;
  state: PhotoUploadState;
  /** 몇 번째 시도 중인가(1부터) */
  attempt: number;
  error?: string;
  /** 서버가 돌려준 Drive 파일 id — 대조용 */
  photoId?: string;
}

/** 업로드 후 서버 목록 대조 결과 */
interface PhotoVerify {
  /** 서버 목록에서 확인된 장수 */
  confirmed: number;
  /** 올렸다고 응답받았는데 목록에 없는 장수 */
  missing: number;
  /** 목록 조회 자체가 실패했으면 메시지 */
  error?: string;
}

interface GasPhotoState {
  /** null = 아직 못 불러옴(또는 GAS 아님) */
  photos: GasPhoto[] | null;
  /** 직전 목록 조회 실패 메시지 — 칩·배지는 실패 시 숨긴다 */
  listError: string | null;
  items: PhotoUploadItem[];
  uploading: boolean;
  /** 진행 패널 표시 여부 — 업로드 시작 시 열리고, 사용자가 닫거나 전부 성공 후 잠시 뒤 닫힌다 */
  panelOpen: boolean;
  verify: PhotoVerify | null;
  refresh: () => Promise<void>;
  /** 새로 고른 파일 묶음 업로드 (이전 묶음 결과는 교체) */
  uploadFiles: (files: File[]) => Promise<void>;
  /** 실패한 항목만 다시 */
  retryFailed: () => Promise<void>;
  closePanel: () => void;
  setProcessed: (photo: GasPhoto, processed: boolean) => Promise<void>;
}

const MAX_ATTEMPTS = 3;
/** 이보다 큰 사진은 JPEG로 다시 저장해 서버 호출 크기를 줄인다(base64는 1.33배) */
const SHRINK_OVER_BYTES = 5 * 1024 * 1024;
const MAX_PIXELS = 16_000_000;

interface UploadPayload {
  name: string;
  mime: string;
  base64: string;
}

/** 고른 파일의 읽어 둔 본문 — 화면 상태(zustand)에 수 MB 문자열을 넣지 않으려고 따로 둔다 */
const payloads = new Map<string, UploadPayload>();

/** Blob → base64 본문(data URL 접두 제거) */
function readBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(blob);
  });
}

/** 아주 큰 사진만 JPEG로 다시 저장 — 실패하면(캔버스 미지원 등) 원본 그대로 */
async function shrinkIfHuge(file: File): Promise<{ blob: Blob; mime: string; name: string }> {
  const original = { blob: file as Blob, mime: file.type || "image/jpeg", name: file.name || "photo.jpg" };
  if (file.size <= SHRINK_OVER_BYTES || typeof createImageBitmap !== "function") return original;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, Math.sqrt(MAX_PIXELS / (bitmap.width * bitmap.height)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return original;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob || blob.size >= file.size) return original;
    return { blob, mime: "image/jpeg", name: original.name.replace(/\.[^.]+$/, "") + ".jpg" };
  } catch {
    return original;
  }
}

async function preparePayload(file: File): Promise<UploadPayload> {
  const { blob, mime, name } = await shrinkIfHuge(file);
  return { name, mime, base64: await readBase64(blob) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errorMessage(err: unknown): string {
  // GAS 서버 오류는 "Exception: …"으로 온다 — 사람이 읽을 부분만
  return (err instanceof Error ? err.message : String(err)).replace(/^(?:Script)?Exception:\s*/i, "");
}

let batchSeq = 0;
let refreshInFlight: Promise<void> | null = null;
let autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

export const useGasPhotoStore = create<GasPhotoState>((set, get) => {
  const patch = (key: string, next: Partial<PhotoUploadItem>) =>
    set((s) => ({ items: s.items.map((x) => (x.key === key ? { ...x, ...next } : x)) }));

  const uploadOne = async (item: PhotoUploadItem) => {
    let payload = payloads.get(item.key);
    if (!payload) {
      try {
        payload = await preparePayload(item.file);
        payloads.set(item.key, payload);
      } catch (err) {
        patch(item.key, { state: "실패", error: `사진을 읽지 못했습니다 — 다시 골라 주세요 (${errorMessage(err)})` });
        return;
      }
    }
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      patch(item.key, { state: attempt === 1 ? "올리는 중" : "다시 시도 중", attempt, error: undefined });
      try {
        const res = await runServer<GasPhoto>("uploadPhoto", payload.name, payload.mime, payload.base64);
        patch(item.key, { state: "완료", photoId: res && typeof res.id === "string" ? res.id : undefined });
        payloads.delete(item.key);
        return;
      } catch (err) {
        if (attempt === MAX_ATTEMPTS) {
          patch(item.key, { state: "실패", error: errorMessage(err) });
          return;
        }
        await sleep(1500 * attempt);
      }
    }
  };

  const runUpload = async (keys: string[]) => {
    if (autoCloseTimer) clearTimeout(autoCloseTimer);
    set({ uploading: true, panelOpen: true, verify: null });
    // 1) 전부 먼저 읽어 둔다 (휴대폰 파일 접근이 업로드 도중 끊겨도 본문은 이미 메모리에)
    await Promise.all(
      keys.map(async (key) => {
        const item = get().items.find((x) => x.key === key);
        if (!item || payloads.has(key)) return;
        try {
          payloads.set(key, await preparePayload(item.file));
          patch(key, { state: "대기" });
        } catch (err) {
          patch(key, { state: "실패", error: `사진을 읽지 못했습니다 — 다시 골라 주세요 (${errorMessage(err)})` });
        }
      })
    );
    // 2) 한 장씩 올린다 (서버 사진 기록 시트에 동시 쓰기를 피함)
    for (const key of keys) {
      const item = get().items.find((x) => x.key === key);
      if (!item || item.state === "완료" || (item.state === "실패" && !payloads.has(key))) continue;
      await uploadOne(item);
    }
    // 3) 서버 목록으로 대조
    await get().refresh();
    const { photos, listError, items } = get();
    const uploaded = items.filter((x) => x.state === "완료");
    if (listError || !photos) {
      set({ verify: { confirmed: 0, missing: 0, error: listError ?? "사진 목록을 받지 못했습니다" } });
    } else {
      const ids = new Set(photos.map((p) => p.id));
      const withId = uploaded.filter((x) => x.photoId);
      const confirmed = withId.filter((x) => ids.has(x.photoId!)).length;
      set({ verify: { confirmed, missing: withId.length - confirmed } });
    }
    set({ uploading: false });
    const after = get();
    const allOk = after.items.every((x) => x.state === "완료") && !after.verify?.missing && !after.verify?.error;
    if (allOk) autoCloseTimer = setTimeout(() => set({ panelOpen: false }), 6000);
  };

  return {
    photos: null,
    listError: null,
    items: [],
    uploading: false,
    panelOpen: false,
    verify: null,
    refresh: () => {
      if (!isGas()) return Promise.resolve();
      if (refreshInFlight) return refreshInFlight;
      refreshInFlight = runServer<GasPhoto[]>("listPhotos")
        .then((list) => set({ photos: Array.isArray(list) ? list : [], listError: null }))
        .catch((err) => set({ listError: errorMessage(err) }))
        .finally(() => { refreshInFlight = null; });
      return refreshInFlight;
    },
    uploadFiles: async (files) => {
      if (!files.length || get().uploading) return;
      payloads.clear();
      const batch = ++batchSeq;
      const next: PhotoUploadItem[] = files.map((file, i) => ({
        key: `${batch}-${i}-${file.name}`,
        file,
        state: "읽는 중",
        attempt: 0,
      }));
      set({ items: next });
      await runUpload(next.map((x) => x.key));
    },
    retryFailed: async () => {
      if (get().uploading) return;
      const failed = get().items.filter((x) => x.state === "실패");
      if (!failed.length) return;
      for (const x of failed) patch(x.key, { state: "대기", attempt: 0, error: undefined });
      await runUpload(failed.map((x) => x.key));
    },
    closePanel: () => {
      if (autoCloseTimer) clearTimeout(autoCloseTimer);
      set({ panelOpen: false });
    },
    setProcessed: async (photo, processed) => {
      try {
        await runServer("setPhotosProcessed", [photo.id], processed);
        await get().refresh();
      } catch (err) {
        toast.error(errorMessage(err));
      }
    },
  };
});

/** 처리 전 사진 수 — 목록을 못 불러왔으면 null(칩·배지 숨김) */
export function selectPendingPhotoCount(s: Pick<GasPhotoState, "photos" | "listError">): number | null {
  if (s.listError || !s.photos) return null;
  return s.photos.filter((p) => p.status !== PHOTO_PROCESSED).length;
}
