# Gist 기기 연결·편의 (A단계) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 새 기기를 QR/링크 한 번으로 Gist에 연결하고, 기기 간 반영을 분 단위로 당기며, 조용한 동기화 중단을 헤더에서 드러낸다.

**Architecture:** 연결 정보는 URL fragment(`#fw-connect=`)의 base64url JSON. 순수 로직은 `services/deviceConnect.ts`·`services/gistSyncStatus.ts`, 상태 변경(저장·불러오기·자동 동기화)은 기존 `useGistSync` 훅 안의 `connectDevice`로 모아 동기화 ref 갱신을 우회하지 않는다. 받는 쪽 확인 모달은 uiStore `pendingConnect`로 App 전역 모달 영역에서 띄운다.

**Tech Stack:** React 18 + TypeScript + Vite, zustand(uiStore), vitest + @testing-library/react(jsdom), 신규 의존성 `uqr`(QR 행렬 생성).

**Spec:** `docs/superpowers/specs/2026-10-02-gist-device-connect-design.md`

## Global Constraints

- 링크 기준 주소: `PUBLIC_APP_URL = "https://moktak128bit.github.io/farmwallet/"` (constants/config.ts). `location.origin` 사용 금지.
- fragment 키 `fw-connect`, 페이로드 JSON `{"v":1,"g":"<gistId>","t":"<token>"}` → UTF-8 → base64url(패딩 없음).
- 타이밍: `GIST_AUTO_PUSH_DEBOUNCE_MS = 60 * 1000`, `GIST_REMOTE_CHECK_THROTTLE_MS = 60 * 1000`, 신규 `GIST_REMOTE_POLL_MS = 3 * 60 * 1000`.
- 동기화 오류 경보: 연속 실패 **2회 이상**, 성공 1회로 리셋.
- 토큰을 `onLog`·appLog·토스트·console에 절대 출력하지 않는다.
- 인라인 hex/rgb 금지(`npm run check-conventions`가 잡음), 본문 이모지 금지(lucide 아이콘), 인라인 글자 11px 바닥.
- 모달: `useFocusTrap` + `useModalStackEntry`(최상위만 ESC) + `role="dialog"` + `aria-modal="true"` — `components/GistConflictModal.tsx`의 패턴을 따른다.
- App 자식 props 시그니처 유지: `SettingsPage`·`DashboardView`·`SyncActionBar`·`GistSyncCard`에 새 prop을 추가하지 않는다(카드는 uiStore·`GIST_CONFIG_CHANGE_EVENT`로 연결).
- 새 localStorage 키 없음(기존 `fw-gist-token`·`fw-gist-id`·자동 동기화 키 재사용).
- knip 클린 유지 — 새 export는 실제 사용처와 함께.
- 커밋하지 않는다(사용자가 요청할 때만). 각 Task 끝은 테스트 통과로 마무리.

## Review Focus

1. **빈 기기 + 원격 데이터 검증 실패**: 적용하지 않고 자동 동기화도 켜지 않아야 한다(켜지면 빈 데이터가 1분 뒤 원격을 덮음). → Task 4 테스트 `connectDevice: 원격 검증 실패 시 자동 동기화를 켜지 않음`.
2. **메신저·메모에서 복사한 링크**: 앞뒤 공백·줄바꿈, `#fw-connect=…&x=1`처럼 뒤에 다른 파라미터가 붙어도 해석돼야 한다. → Task 1 테스트 `decodeConnectPayload: 공백·뒤 파라미터 허용`.
3. **링크로 연 뒤 새로고침·뒤로가기**: 토큰이 주소에 남거나 확인 모달이 다시 뜨면 안 된다. → Task 1 테스트 `takeConnectPayloadFromLocation: 두 번째 호출은 none`.
4. **폴링 중 숨김 탭·충돌 모달**: 숨김 탭은 확인하지 않고, 충돌 모달이 열려 있으면 건너뛴다. → Task 2 테스트 `원격 폴링: 숨김 탭·충돌 모달 시 건너뜀`.
5. **연결 실패 경로의 토큰 유출**: 실패 메시지·로그에 토큰 문자열이 없어야 한다. → Task 4 테스트 `connectDevice: 실패 로그에 토큰 미포함`.

---

### Task 1: 연결 정보 서비스 + 자격증명 지정 조회

**Files:**
- Create: `src/services/deviceConnect.ts`
- Modify: `src/services/gistSync.ts` (getGistVersions 부근 ~L300)
- Modify: `src/constants/config.ts` (Gist 상수 부근 ~L143)
- Test: `src/__tests__/deviceConnect.test.ts` (jsdom 환경 주석 `// @vitest-environment jsdom`)

**Interfaces:**
- Produces:
  - `config.ts`: `export const PUBLIC_APP_URL = "https://moktak128bit.github.io/farmwallet/";`
  - `deviceConnect.ts`:
    - `export interface ConnectPayload { gistId: string; token: string }`
    - `export function buildConnectUrl(payload: ConnectPayload): string` → `${PUBLIC_APP_URL}#fw-connect=<base64url>`
    - `export function decodeConnectPayload(text: string): ConnectPayload | null`
    - `export type TakeConnectResult = { status: "none" } | { status: "invalid" } | { status: "ok"; payload: ConnectPayload }`
    - `export function takeConnectPayloadFromLocation(): TakeConnectResult`
    - `export function isEmptyLocalData(data: Pick<AppData, "ledger" | "accounts" | "trades">): boolean`
    - `export function describeConnectTarget(currentGistId: string, nextGistId: string): { shortId: string; currentShortId: string | null; replacesOther: boolean }`
  - `gistSync.ts`: `export async function getGistVersionsWithCredentials(token: string, gistId: string, maxCount = 5): Promise<GistVersion[]>` — 기존 `getGistVersions`는 저장된 토큰·ID 검사 후 이 함수에 위임(시그니처·에러 메시지 불변).

- [ ] **Step 1: 실패하는 테스트 작성** — `deviceConnect.test.ts`

```ts
const P = { gistId: "0123456789abcdef0123456789abcdef", token: "ghp_TESTTOKEN123" };

it("buildConnectUrl ↔ decodeConnectPayload 왕복", () => {
  const url = buildConnectUrl(P);
  expect(url.startsWith("https://moktak128bit.github.io/farmwallet/#fw-connect=")).toBe(true);
  expect(url).not.toContain("ghp_");            // 토큰이 평문으로 보이지 않음(base64url)
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
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  expect(decodeConnectPayload("")).toBeNull();
  expect(decodeConnectPayload("#fw-connect=%%%")).toBeNull();
  expect(decodeConnectPayload(b64({ v: 2, g: P.gistId, t: P.token }))).toBeNull();   // 모르는 버전
  expect(decodeConnectPayload(b64({ v: 1, g: P.gistId }))).toBeNull();               // 토큰 누락
  expect(decodeConnectPayload(b64({ v: 1, g: "not-hex!", t: P.token }))).toBeNull(); // ID 형식 오류
  expect(decodeConnectPayload(b64({ v: 1, g: P.gistId, t: "a b" }))).toBeNull();     // 토큰에 공백
});
it("takeConnectPayloadFromLocation: 해시 없으면 none", () => { /* replaceState로 "/farmwallet/?tab=dashboard" 세팅 → { status: "none" } */ });
it("takeConnectPayloadFromLocation: 유효하면 ok + 해시 제거, 쿼리 보존, 두 번째 호출은 none", () => {
  window.history.replaceState(null, "", `/farmwallet/?tab=dashboard#fw-connect=${buildConnectUrl(P).split("#fw-connect=")[1]}`);
  expect(takeConnectPayloadFromLocation()).toEqual({ status: "ok", payload: P });
  expect(window.location.hash).toBe("");
  expect(window.location.search).toBe("?tab=dashboard");
  expect(takeConnectPayloadFromLocation()).toEqual({ status: "none" });
});
it("takeConnectPayloadFromLocation: 깨졌으면 invalid + 해시 제거", () => { /* "#fw-connect=%%%" → { status: "invalid" }, hash "" */ });
it("isEmptyLocalData", () => { /* 세 배열 모두 [] → true; ledger 1건 → false; accounts 1건 → false */ });
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
  vi.unstubAllGlobals();
});
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/__tests__/deviceConnect.test.ts` → Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**
  - 검증 규칙: `v === 1`, `g`는 `/^[0-9a-f]{20,}$/i`, `t`는 비어 있지 않고 공백 없음(`/^\S+$/`). base64url 디코드는 `-`→`+`, `_`→`/`, 패딩 복원 후 `atob` → `TextDecoder`. 실패는 전부 null(throw 금지).
  - 입력 파싱 순서: trim → `fw-connect=` 위치가 있으면 그 뒤부터 `&`/공백 전까지, 없으면 전체를 값으로.
  - `takeConnectPayloadFromLocation`: `location.hash`에 `fw-connect=`가 없으면 none. 있으면 **먼저** `history.replaceState(history.state, "", location.pathname + location.search)`로 해시 제거 후 디코드 → ok/invalid.
  - `shortId`는 끝 6자리. `currentGistId`가 빈 문자열이면 `currentShortId: null`.

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/__tests__/deviceConnect.test.ts` → Expected: PASS

---

### Task 2: 동기화 타이밍 단축 + 탭 표시 중 원격 폴링

**Files:**
- Modify: `src/constants/config.ts:142-146` (주석의 "5분"·"15분" 갱신 포함)
- Modify: `src/hooks/useGistSync.ts` — `UseGistSyncOptions`(L88), 옵션 구조분해(L136), Effect 3(L596-631), 상단 doc 주석 "5분 뒤"(L129)
- Modify: `src/App.tsx:317-321` (useGistSync 호출 옵션)
- Modify: `src/features/settings/GistSyncCard.tsx` 자동 동기화 문구 "데이터 변경 후 5분 뒤" → "데이터 변경 후 1분 뒤"
- Test: `src/__tests__/useGistSync.test.tsx`

**Interfaces:**
- Produces: `config.ts`: `export const GIST_REMOTE_POLL_MS = 3 * 60 * 1000;` / `UseGistSyncOptions.remotePollMs?: number` — 주어질 때만 `window.setInterval(remotePollMs)`로 `document.visibilityState === "visible"`일 때 `checkRemoteOnResume()` 호출(정리 함수에서 clearInterval). App은 `{ onLog: addAppLog, remotePollMs: GIST_REMOTE_POLL_MS }`를 넘긴다.
- 폴링을 옵션으로 둔 이유: 기존 테스트의 `flush()`가 `vi.runAllTimersAsync()`를 쓰므로 상시 interval이 있으면 무한 타이머로 중단된다. 새 폴링 테스트는 `flush()` 대신 `advanceTimersByTimeAsync`만 쓴다.

- [ ] **Step 1: 기존 테스트를 상수 기반으로 수정 + 폴링 테스트 추가**
  - `"debounce 내 연속 변경 시 마지막 값 1번만 push"`: `advanceTimersByTimeAsync(60_000)` 두 곳 → `GIST_AUTO_PUSH_DEBOUNCE_MS / 2`.
  - `"visible 복귀: … 15분 throttle"`: 테스트 이름의 "15분" → "throttle". "1분 뒤" 단계 → `GIST_REMOTE_CHECK_THROTTLE_MS - 1000` 진행 후 조회 1회 유지, 다음 단계 `15 * 60 * 1000` → `2000` 진행 후 조회 2회. `GIST_REMOTE_CHECK_THROTTLE_MS` import 추가.
  - 새 describe `"useGistSync — 탭 표시 중 원격 폴링"` (훅을 `useGistSync(d, onApply, { remotePollMs: 180_000 })`로 마운트, 초기 settle은 `advanceTimersByTimeAsync(GIST_AUTO_PUSH_DEBOUNCE_MS + 1000)`로 첫 자동 push까지 소진 — `flush()` 금지 — 후 `getGistVersions` mockClear. 마운트 t=0 기준 첫 폴링은 t=180s):
    - `원격 폴링: 표시 중 3분마다 확인` — 마운트 settle 후 `getGistVersions` mockClear → `advanceTimersByTimeAsync(180_000)` → 1회, 다시 180_000 → 2회.
    - `원격 폴링: 숨김 탭·충돌 모달 시 건너뜀` — visibilityState "hidden"(quiet 설정)에서 180_000 → 0회; visible + `setGistConflict({...})`에서 180_000 → 0회.
    - `원격 폴링: 옵션 없으면 interval 없음` — 옵션 없이 마운트, 600_000 진행 → 마운트 이후 추가 조회 0회.

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/__tests__/useGistSync.test.tsx` → Expected: 새 폴링 테스트 FAIL, 수정한 기존 테스트는 상수 변경 전이라 일부 FAIL 가능

- [ ] **Step 3: 구현** — 상수 3개 변경/추가, 옵션·interval 추가, App·카드 문구 갱신.

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/__tests__/useGistSync.test.tsx` → Expected: 전부 PASS

---

### Task 3: 동기화 건강 상태 + 헤더 표시

**Files:**
- Create: `src/services/gistSyncStatus.ts`
- Modify: `src/hooks/useGistSync.ts` — `UseGistSyncReturn`에 `syncHealth` 추가, `getGistVersions(1).catch(() => [])` 4곳(Effect 1 L177, runAutoPush L255, manualPush L342, checkRemoteOnResume L505)을 훅 내부 헬퍼로 교체, push·pull 성공/실패 지점에 기록
- Modify: `src/App.tsx` — appStatus(L332-342), 상태 팝오버 Gist 영역(L930 부근 gistStaleWarning 블록 옆)
- Test: `src/__tests__/gistSyncStatus.test.ts`, `src/__tests__/useGistSync.test.tsx`

**Interfaces:**
- Produces (`gistSyncStatus.ts`):
  - `export interface GistSyncHealth { lastCheckAt: string | null; consecutiveFailures: number; lastError: string | null }`
  - `export type GistSyncStatusKind = "ok" | "off" | "disconnected" | "error"`
  - `export function deriveGistSyncStatus(input: { autoSyncEnabled: boolean; hasToken: boolean; hasGistId: boolean; health: GistSyncHealth }): { kind: GistSyncStatusKind; message: string | null }`
  - 판정 순서: ① `hasGistId && autoSyncEnabled && !hasToken` → disconnected, message `"토큰이 없어 동기화가 멈췄어요. PC에서 연결 QR을 다시 찍거나 설정에서 토큰을 입력하세요."` ② `!autoSyncEnabled || !hasToken || !hasGistId` → off(null) ③ `consecutiveFailures >= 2` → error, message `` `동기화 오류: ${lastError ?? "알 수 없는 오류"}` `` ④ ok(null).
- Produces (`useGistSync`): 반환값 `syncHealth: GistSyncHealth`. 훅 내부 기록 함수 `recordSyncOk(): void`·`recordSyncFail(message: string): void`(Task 4가 재사용). 내부 헬퍼 `fetchLatestVersion(): Promise<GistVersion | undefined>` — 성공 시 기록 OK(`lastCheckAt = new Date().toISOString()`, 실패 0, 오류 null), 실패 시 실패+1·오류 메시지 기록 후 `undefined`(기존 `.catch(() => [])`와 같은 흐름 유지). push 성공(runAutoPush·manualPush·force-push)·pull 성공(Effect 1·manualPull·checkRemoteOnResume)은 OK 기록, 그 catch들은 실패 기록.
- App: `gistSyncStatus = useMemo(() => deriveGistSyncStatus({ autoSyncEnabled, hasToken: !!getGistToken(), hasGistId: !!getGistId(), health: syncHealth }), [autoSyncEnabled, gistConfigured, syncHealth])` (gistConfigured는 설정 변경 이벤트로 바뀌므로 재계산 트리거).
  - appStatus: `gistStaleWarning?.type === "critical"` 다음 줄에 `disconnected` → `{ tone: "warn", summary: "연결 끊김" }`, `error` → `{ tone: "warn", summary: "동기화 오류" }`.
  - 팝오버: message가 있으면 `<div className="pill warning">{message}</div>`; 토큰·ID가 있으면 `<div className="pill muted">최신 확인 {formatTimeAgo(syncHealth.lastCheckAt)} · 마지막 저장 {formatTimeAgo(gistLastPushAt)}</div>`.

- [ ] **Step 1: 실패하는 테스트 작성**
  - `gistSyncStatus.test.ts`: `off`(자동 동기화 꺼짐), `disconnected`(ID+자동동기화+토큰 없음 → 위 메시지 정확히), `실패 1회는 ok`, `실패 2회는 error`(message `"동기화 오류: 네트워크 연결을 확인해주세요."`), `disconnected가 error보다 우선`(토큰 없음 + 실패 5회 → disconnected).
  - `useGistSync.test.tsx` 새 describe `"동기화 건강 상태"`:
    - `마운트 확인 실패는 1회로 기록` — `getGistVersions` reject(`new Error("네트워크 연결을 확인해주세요.")`)로 마운트 후 마이크로태스크만 비움(타이머 진행 금지 — 진행하면 자동 push 성공이 카운트를 리셋) → `consecutiveFailures === 1`, `lastError` 일치.
    - `연속 실패 누적과 성공 시 리셋` — 기존 `mountSettled` 패턴으로 settle(초기 push 소진) 후 reject로 전환 → throttle+1초 → visible → 1 → throttle+1초 → visible → 2 → resolve `[]`로 전환 → throttle+1초 → visible → 0, `lastCheckAt !== null`.

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/__tests__/gistSyncStatus.test.ts src/__tests__/useGistSync.test.tsx` → Expected: FAIL

- [ ] **Step 3: 구현** — 위 Interfaces대로. 헬퍼 교체 후에도 기존 테스트 흐름(실패 시 빈 버전으로 계속)이 바뀌지 않아야 한다.

- [ ] **Step 4: 통과 확인** — 같은 명령 → Expected: PASS (기존 useGistSync 테스트 포함 전부)

---

### Task 4: 받는 쪽 연결 — connectDevice + 확인 모달 + fragment 처리

**Files:**
- Modify: `src/hooks/useGistSync.ts` — `connectDevice` 추가(`setAutoSyncEnabled` 정의 뒤), 반환 타입에 추가
- Create: `src/components/ConnectConfirmModal.tsx`
- Modify: `src/App.tsx` — 마운트 effect(fragment), 전역 모달 영역(L1353 `GistConflictModal` 옆)
- Test: `src/__tests__/useGistSync.test.tsx` (vi.mock 팩토리에 `getGistVersionsWithCredentials: vi.fn()` 추가)

**Interfaces:**
- Consumes: Task 1의 `ConnectPayload`, `getGistVersionsWithCredentials`, `isEmptyLocalData`, `describeConnectTarget`, `takeConnectPayloadFromLocation`; Task 3의 `recordSyncOk()`; Task 5의 uiStore `pendingConnect`·`setPendingConnect`.
- Produces:
  - useGistSync: `connectDevice: (payload: ConnectPayload) => Promise<"connected" | "cancelled" | "failed">`
  - `ConnectConfirmModal` props: `{ payload: ConnectPayload | null; currentGistId: string; onConfirm: () => Promise<void>; onCancel: () => void }`

**connectDevice 순서 (스펙 §3-4 그대로):**
1. 업로드 중이거나 충돌 모달이 열려 있으면 `toast.error("동기화 작업이 끝난 뒤 다시 시도하세요.")` → `"failed"`.
2. `getGistVersionsWithCredentials(token, gistId, 1)` 실패 → `toast.error(err.message)`, onLog에는 토큰 없이 기록 → `"failed"`(아무것도 저장 안 함).
3. `setGistToken(token, { persist: true })`, `setGistId(gistId)`.
4. `loadFromGist()` → `normalizeImportedData(JSON.parse(...))` 실패 시 `toast.error("원격 데이터가 올바르지 않아 불러오지 않았어요.")` → `"failed"`(자동 동기화 OFF 유지).
5. `remoteAt = versions[0]?.committedAt ?? updatedAt`. `commit()` = `onApplyPulledData(dataJson, remoteAt)` → lastPullAt(저장소+state)·`knownRemoteCommitRef`=remoteAt·`lastPushedPayloadRef`=dataJson·`setGistLastPushedHash(hash)`·`restoredRef=false`·OK 기록 → `hasMountedRef.current = true` → `setAutoSyncEnabled(true)` → `toast.success("이 기기를 연결했어요")`.
6. `isEmptyLocalData(dataRef.current)`면 즉시 commit → `"connected"`. 아니면 `requestApply({ title: "연결한 Gist에서 불러오기", before: dataRef.current, after, onConfirm: commit 후 resolve("connected"), onCancel: toast("불러오기를 취소했어요. 자동 동기화는 꺼져 있어요.") 후 resolve("cancelled") })`.

**ConnectConfirmModal 문구:** 제목 `"이 기기 연결"`, 본문 `` `이 기기를 Gist(…${shortId})에 연결할까요?` ``, replacesOther면 경고 `` `현재 연결된 Gist(…${currentShortId})와 다릅니다. 연결하면 이후 동기화 대상이 바뀝니다.` ``, 버튼 [연결]/[취소], 진행 중 `"연결 중..."`(버튼 disabled). ESC=취소.

**App:** 마운트 effect에서 `takeConnectPayloadFromLocation()` — ok → `setPendingConnect(payload)`, invalid → `toast.error("연결 링크가 올바르지 않아요")`. 모달 onConfirm: `loadFailed`면 `toast.error("데이터 로드에 실패한 상태에서는 연결할 수 없어요")` 후 중단, 아니면 `await connectDevice(pendingConnect)` 후 `setPendingConnect(null)`.

- [ ] **Step 1: 실패하는 테스트 작성** — 새 describe `"useGistSync — connectDevice"` (getGistAutoSync=false, getGistToken="" 로 마운트; `P = { gistId: "0123456789abcdef0123456789abcdef", token: "ghp_SECRET999" }`; `REMOTE = JSON.stringify(makeData(5))`):
  - `connectDevice: 연결 테스트 실패 시 아무것도 저장 안 함` — `getGistVersionsWithCredentials` reject(`new Error("Gist 불러오기 실패: 토큰이 유효하지 않습니다.")`) → `"failed"`, `localStorage.getItem("fw-gist-token")`·`("fw-gist-id")` null, `setGistAutoSync` 미호출, `loadFromGist` 미호출.
  - `connectDevice: 실패 로그에 토큰 미포함` — 위 실패 시 `onLog`의 모든 호출 인자에 `"ghp_SECRET999"` 미포함.
  - `connectDevice: 빈 기기는 미리보기 없이 적용 + 토큰 영속 + 자동 동기화 ON + 이중 불러오기 없음` — 마운트 데이터 `getEmptyData()`; versions `[{ sha: "v", committedAt: "2026-10-02T01:00:00Z", url: "u" }]`, loadFromGist `{ dataJson: REMOTE, updatedAt: "2026-10-02T00:59:59Z" }` → `"connected"`, `onApply`가 `(REMOTE, "2026-10-02T01:00:00Z")`로 1회, `localStorage.getItem("fw-gist-token") === "ghp_SECRET999"`, `setGistAutoSync`가 `true`로 호출, `useUIStore.getState().pendingApply` null, 이후 `flush()` 뒤에도 `loadFromGist` 호출 1회.
  - `connectDevice: 데이터 있는 기기는 미리보기, 취소하면 자동 동기화 OFF` — 마운트 데이터 `makeData(1)` → 호출(await 하지 않고 promise 보관) → 마이크로태스크 flush 후 `pendingApply` 존재 → `pendingApply.onCancel()` → promise `"cancelled"`, `onApply` 미호출, `setGistAutoSync` 미호출.
  - `connectDevice: 원격 검증 실패 시 자동 동기화를 켜지 않음` — 빈 기기, loadFromGist `{ dataJson: "not json", ... }` → `"failed"`, `onApply` 미호출, `setGistAutoSync` 미호출.

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/__tests__/useGistSync.test.tsx` → Expected: 새 테스트 FAIL

- [ ] **Step 3: 구현** — `connectDevice`, `ConnectConfirmModal`(`describeConnectTarget` 사용), App 배선.

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/__tests__/useGistSync.test.tsx src/__tests__/deviceConnect.test.ts` → Expected: PASS

---

### Task 5: PC 쪽 — 연결 QR 모달 + 링크 붙여넣기 + Gist 카드

**Files:**
- Modify: `package.json` (dependencies에 `uqr` ^0.1.3 — `npm install uqr@^0.1.3`)
- Modify: `src/store/uiStore.ts` (gistConflict 필드 부근 L194-199, L281-285) — `pendingConnect` 필드(Task 4가 소비)
- Create: `src/utils/qrPath.ts`
- Create: `src/components/DeviceConnectModal.tsx`
- Create: `src/features/settings/ConnectLinkPasteField.tsx`
- Modify: `src/features/settings/GistSyncCard.tsx` (Gist ID 입력 아래, 저장/불러오기 위)
- Modify: `src/styles.css` (`:root`·`:root.dark`에 `--qr-bg`·`--qr-fg`, `.qr-code` 규칙)
- Test: `src/__tests__/qrPath.test.ts`

**Interfaces:**
- Consumes: Task 1 `ConnectPayload`·`buildConnectUrl`·`decodeConnectPayload`.
- Produces:
  - uiStore: `pendingConnect: ConnectPayload | null; setPendingConnect: (p: ConnectPayload | null) => void` (초기값 null)
  - `export function qrPathData(modules: boolean[][]): string` — 검은 칸 (행 y, 열 x)마다 `M{x} {y}h1v1h-1z`를 이어 붙인 SVG path.
  - `DeviceConnectModal` props `{ isOpen: boolean; onClose: () => void }` — 열릴 때 `getGistToken()`·`getGistId()`로 URL 생성, `import("uqr")`의 `encode(url, { ecc: "M", border: 2 }).data`로 `<svg className="qr-code" viewBox="0 0 n n" width={240} height={240} role="img" aria-label="기기 연결 QR 코드" shapeRendering="crispEdges"><path d={qrPathData(modules)} /></svg>`. 로딩 중엔 "QR 만드는 중...".
  - `ConnectLinkPasteField` (props 없음) — `type="password"` 입력 + [연결] 버튼. 디코드 실패 `toast.error("연결 링크가 올바르지 않아요")`, 성공 시 `setPendingConnect(payload)` 후 입력 비움.
- 문구: 모달 제목 `"다른 기기 연결"`, 안내 `"폰 카메라로 찍으면 FarmWallet이 열리고 연결 확인 창이 떠요."`, 경고(`var(--warning)`) `"이 QR·링크에는 토큰이 들어 있어요. 다른 사람에게 보여주거나 보내지 마세요."`, [링크 복사] 성공 `toast.success("연결 링크를 복사했어요. 다른 사람에게 보내지 마세요.")` / 실패 `toast.error("복사에 실패했어요. QR을 이용하세요.")`, [닫기].
- 카드 섹션: 소제목 `"다른 기기 연결"`, 힌트 `"폰·다른 PC를 이 Gist에 연결합니다. QR을 찍거나 링크를 붙여넣으면 토큰·Gist ID가 자동으로 들어가요."`, [연결 QR 보기](토큰·ID 둘 다 있을 때만 활성) + `<ConnectLinkPasteField />`.
- 카드는 `GIST_CONFIG_CHANGE_EVENT`를 구독해 `gistToken`·`gistTokenPersist`·`gistId` 로컬 state를 다시 읽는다(연결 후 카드 표시 갱신).
- QR 색: `--qr-bg`(흰색)·`--qr-fg`(검정)을 styles.css에 정의, 다크모드에서도 같은 값(스캔 대비). TSX에는 hex 없음.

- [ ] **Step 1: 실패하는 테스트 작성** — `qrPath.test.ts`: `qrPathData([[true,false],[false,true]]) === "M0 0h1v1h-1zM1 1h1v1h-1z"`, `qrPathData([[false]]) === ""`.
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/__tests__/qrPath.test.ts` → Expected: FAIL
- [ ] **Step 3: 구현** — 의존성 설치, 위 파일들 작성.
- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/__tests__/qrPath.test.ts && npx tsc --noEmit` → Expected: PASS, 타입 오류 없음

---

### Task 6: 데이터 없는 새 기기 안내 카드

**Files:**
- Create: `src/components/ConnectOnboardingCard.tsx`
- Modify: `src/App.tsx:1099-1101` (`tab === "dashboard"` 블록)

**Interfaces:**
- Consumes: Task 1 `isEmptyLocalData`, Task 5 `ConnectLinkPasteField`.
- Produces: `ConnectOnboardingCard` props `{ onGoSettings: () => void }`.
- 표시 조건(App): `tab === "dashboard" && !isLoading && !loadFailed && !gistConfigured && isEmptyLocalData(data)` — `DashboardView` 위에 렌더.
- 문구: lucide `Smartphone` 아이콘 + 제목 `"이 기기에는 아직 데이터가 없어요"`, 본문 `"PC의 설정 → 동기화 → '다른 기기 연결'에서 QR을 찍거나, 연결 링크를 붙여넣으세요."`(설정 하위 탭 실제 라벨을 `SettingsPage`에서 확인해 맞춘다), `<ConnectLinkPasteField />`, [설정으로] → `onGoSettings`(App은 `handleTabChange("settings")`).

- [ ] **Step 1: 구현** (표시 로직은 Task 1에서 테스트한 `isEmptyLocalData`와 기존 `gistConfigured` 조합뿐이라 별도 단위 테스트 없음 — Task 7 화면 확인으로 검증)
- [ ] **Step 2: 확인** — Run: `npx tsc --noEmit` → Expected: 오류 없음

---

### Task 7: 전체 검증 + 실화면 확인

- [ ] **Step 1: 품질 게이트** — Run: `npm run check-text && npm run check-conventions && npm run lint && npm test && npm run knip && npm run build` → Expected: 전부 성공(테스트 수는 기존 이상, knip 신규 미사용 export 0, conventions 신규 위반 0).
- [ ] **Step 2: 실화면 확인** (dev 서버 5174 `/farmwallet/`, playwright — 메모 `ui-screenshot-harness` 방식). **실제 토큰 사용 금지** — 가짜 값만.
  - 깨끗한 브라우저 컨텍스트로 대시보드 → 안내 카드 표시.
  - `/farmwallet/#fw-connect=%%%` 열기 → "연결 링크가 올바르지 않아요" 토스트, 주소에서 해시 제거.
  - `buildConnectUrl({ gistId: "0123456789abcdef0123456789abcdef", token: "ghp_FAKE" })`의 해시를 붙여 열기 → 확인 모달("…abcdef") 표시, [취소]로 닫음(연결 시도 안 함).
  - localStorage에 가짜 토큰·ID 주입 후 설정 → 동기화 → [연결 QR 보기] → QR 렌더(라이트/다크 둘 다 흰 바탕) 스크린샷.
- [ ] **Step 3: 보고** — 변경 파일 목록·테스트 결과를 정리하고, main push(배포) 여부를 사용자에게 묻는다(로컬 main이 origin보다 2커밋 앞섬).
