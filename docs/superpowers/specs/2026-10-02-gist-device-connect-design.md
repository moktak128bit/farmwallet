# Gist 기기 연결·편의 개선 (A단계) — 설계

- 작성일: 2026-10-02
- 상태: 설계 승인됨 → 구현 계획 대기
- 범위: Gist 동기화 개선 3단계 중 **A(연결·편의)**. B(자동 병합)·C(압축+암호화)는 별도 설계.

## 1. 배경과 목표

### 사용자 의도
- 폰 등 PC 외 기기의 웹(GitHub Pages, `https://moktak128bit.github.io/farmwallet/`)에서 데이터를 **확인**하고, **가끔 입력**도 한다.
- 지금은 "웹에서 들어가 확인하기가 너무 힘들다."
- Gist는 유지한다(서버 없음 원칙).

### 코드에서 확인한 원인
| # | 원인 | 위치 |
|---|---|---|
| 1 | 토큰이 기본적으로 sessionStorage에만 저장 → 탭을 닫으면 사라짐. 카드 문구도 "끄기 권장" | `services/gistSync.ts` setGistToken, `features/settings/GistSyncCard.tsx` |
| 2 | 새 기기마다 토큰(40자)·Gist ID(32자) 수동 입력. 토큰은 GitHub에서 재확인 불가 | `GistSyncCard.tsx` |
| 3 | 자동 동기화가 기기별 기본 OFF → 앱을 열어도 자동으로 불러오지 않음 | `hooks/useGistSync.ts` Effect 1 |
| 4 | 업로드 디바운스 5분 | `constants/config.ts` GIST_AUTO_PUSH_DEBOUNCE_MS |
| 5 | 복귀 시 원격 확인 throttle 15분, 탭을 띄워 둔 동안에는 확인 안 함 → PC가 폰의 입력을 늦게 알아채 충돌 창 | `useGistSync.ts` checkRemoteOnResume, GIST_REMOTE_CHECK_THROTTLE_MS |
| 6 | 원격 확인 실패·토큰 분실이 로그에만 남아 조용히 동기화가 멈춤 | `useGistSync.ts`, `App.tsx` appStatus |

### 성공 기준
1. 새 폰에서 **QR 한 번 찍기 → 확인 1번**으로 최신 데이터가 보인다. 토큰·ID 타이핑 없음.
2. 연결된 기기는 탭을 닫았다 열어도 **다시 연결할 필요가 없다.**
3. PC 입력은 폰에서 앱을 열거나 돌아올 때 반영되고, 폰 입력은 PC 탭이 열려 있어도 **약 3분 안에** 반영된다(PC에 미업로드 변경이 없을 때).
4. 동기화가 멈추면(토큰 무효·분실, 연속 실패) 헤더 상태 점이 알려준다.

### 비목표 (이번 단계에서 하지 않음)
- 충돌 시 자동 병합 → **B단계**
- 페이로드 압축·암호화 → **C단계** (단, 연결 정보에 버전 필드를 넣어 C에서 암호 키를 추가할 자리를 만든다)
- 토큰 없는 보기 전용 모드 (사용자가 '보기 + 가끔 입력'을 선택 → 토큰 필요)
- 앱 내부 카메라 QR 스캔 (폰 기본 카메라로 충분)

## 2. 연결 정보 형식

```
https://moktak128bit.github.io/farmwallet/#fw-connect=<base64url(JSON)>
JSON = { "v": 1, "g": "<gistId>", "t": "<token>" }
```

- 링크 기준 주소는 **항상 배포 주소** `PUBLIC_APP_URL = "https://moktak128bit.github.io/farmwallet/"`(constants/config.ts 상수). PC는 주로 dev 서버(localhost)에서 쓰므로 `location.origin`을 쓰면 폰이 열 수 없는 localhost 주소가 QR에 담긴다.
- `#` 뒤(fragment)는 서버로 전송되지 않는다. `?` 쿼리는 서버 로그에 남으므로 쓰지 않는다.
- `v`는 형식 버전. 모르는 버전·필드 누락·디코딩 실패는 "잘못된 링크"로 처리한다. C단계에서 `v:2`에 암호 키 `k`를 추가한다.
- 붙여넣기 칸은 전체 URL과 `fw-connect=` 이후 값만 붙여넣은 경우 둘 다 받는다.
- 앱의 다른 곳에서 `location.hash`를 쓰지 않음을 확인함(탭 라우팅은 `?tab=`).

## 3. 연결 흐름

### PC (토큰·Gist ID가 설정된 기기)
1. 설정 → Gist 카드에 **"다른 기기 연결"** 영역 추가. 토큰과 Gist ID가 모두 있을 때만 활성.
2. **[연결 QR 보기]** → 모달(useFocusTrap + useModalStackEntry + role="dialog"/aria-modal):
   - QR 코드, **[링크 복사]** 버튼
   - 경고: "이 QR·링크에는 토큰이 들어 있어요. 다른 사람에게 보여주거나 보내지 마세요."
3. QR 라이브러리는 **`uqr`**(MIT, 의존성 0, ESM)를 이 모달에서만 동적 import. `encode()`로 행렬을 받아 React `<svg>`로 직접 그린다(innerHTML 미사용). QR은 스캔 대비를 위해 다크모드에서도 밝은 배경 — 색은 styles.css의 전용 변수/클래스로 정의(인라인 hex 금지 규칙 준수).

### 받는 기기 (폰 등)
1. **부팅 시 fragment 처리**: `#fw-connect=`가 있으면 값을 읽고 **즉시 `history.replaceState`로 주소에서 제거**(방문 기록·북마크에 토큰이 남지 않게).
2. **확인 모달**: "이 기기를 Gist(…끝 6자리)에 연결할까요?"
   - 이미 **다른** Gist ID에 연결된 기기면 경고 문구 추가: "현재 연결된 Gist(…xxxx)와 다릅니다. 연결하면 이후 동기화 대상이 바뀝니다."
   - 확인 모달이 필수인 이유: 타인이 자기 토큰·Gist가 든 링크를 보내면, 확인 없이 연결될 경우 **내 데이터가 그 사람 Gist로 업로드**될 수 있다.
3. **연결 테스트**: 확인 시 저장 전에 `getGistVersions(1)`을 주어진 토큰·ID로 호출. 실패하면 기존 `parseApiError` 메시지로 이유를 보여주고 **아무것도 저장하지 않는다**.
4. **성공 시**: 토큰 저장(**persist=true**, localStorage) → Gist ID 저장 → **즉시 불러오기** → 적용 확정 후 **자동 동기화 ON**.
   - 로컬 데이터가 비어 있으면(가계부·계좌·거래 0건) 미리보기 없이 바로 적용.
   - 데이터가 있으면 기존 `manualPull`과 같은 변경 미리보기(`requestApply`, 적용 시 안전 스냅샷)를 거친다. 취소하면 토큰·ID는 저장된 채 자동 동기화는 꺼 둔다.
   - 원격 데이터가 검증(`normalizeImportedData`)을 통과하지 못하면 적용하지 않고 **자동 동기화도 켜지 않는다**(빈 기기가 빈 데이터를 원격에 덮어쓰는 사고 방지).
   - 자동 동기화를 켤 때 부팅용 자동 불러오기(Effect 1)가 다시 돌지 않게 마운트 플래그를 세운다(이중 불러오기 방지).
   - 불러오기 후 동기화 상태(lastPullAt·known commit·lastPushed 해시)는 기존 정식 경로와 동일하게 갱신 — 다음 자동 업로드가 가짜 충돌을 내지 않도록.
5. **붙여넣기 경로**: Gist 카드와 미연결 안내 카드에 **"연결 링크 붙여넣기"** 입력 → 위 2~4단계와 동일.
   - 목적: iOS에서 홈 화면 앱(PWA)과 Safari가 저장소를 따로 쓰는 경우, QR로 Safari만 연결되고 홈 화면 앱은 미연결로 남는 문제 대응.

### 구현 단위
- `services/deviceConnect.ts` (신규, 순수 함수 위주)
  - `buildConnectUrl(payload) → string` (PUBLIC_APP_URL 기준)
  - `decodeConnectPayload(text) → ConnectPayload | null` (전체 URL·값만 둘 다 허용, 공백 trim)
  - `takeConnectPayloadFromLocation()` (읽고 주소에서 제거, none/invalid/ok 구분)
  - `isEmptyLocalData(data)`, `describeConnectTarget(currentGistId, nextGistId)`
- `gistSync.ts`: `getGistVersionsWithCredentials(token, gistId, maxCount)` 추가 — 저장 전 연결 테스트용. 기존 `getGistVersions`는 이것을 호출하도록 바꾸고 시그니처는 유지.
- `components/DeviceConnectModal.tsx` (QR·링크 복사), `components/ConnectConfirmModal.tsx` (받는 쪽 확인)
- 연결 적용(저장 → 자동 동기화 ON → 불러오기)은 `useGistSync`가 노출하는 함수로 둔다(예: `connectDevice(payload)`) — 동기화 상태 ref 갱신을 훅 밖에서 우회하지 않기 위해.
- App.tsx 자식 props 시그니처는 바꾸지 않는다(CLAUDE.md 규칙). 새 모달은 App의 전역 모달 영역에 추가.

## 4. 동기화 타이밍

| 항목 | 현재 | 변경 |
|---|---|---|
| 업로드 디바운스 `GIST_AUTO_PUSH_DEBOUNCE_MS` | 5분 | **1분** (탭 숨김·pagehide 즉시 flush 유지) |
| 복귀 시 원격 확인 throttle `GIST_REMOTE_CHECK_THROTTLE_MS` | 15분 | **1분** |
| 탭 표시 중 주기 확인 `GIST_REMOTE_POLL_MS` (신규) | 없음 | **3분** |

- 주기 확인은 `checkRemoteOnResume`를 그대로 재사용 → 기존 가드(자동 동기화 OFF·미설정·업로드 중·충돌 모달 열림·버전 복원 직후·재진입·throttle) 자동 적용.
- `document.visibilityState === "visible"`일 때만 실행. 숨겨진 탭은 확인하지 않는다(배터리·요청 수).
- 결과 처리는 현행 그대로: 로컬 미업로드 변경 없음 → 자동 불러오기 + "다른 기기 변경 반영됨" / 미업로드 변경 있음(시계열만 차이 제외) → 충돌 모달(B단계에서 자동 병합으로 대체).
- 요청량: 열린 기기 1대당 시간당 약 20회 + 업로드. GitHub 인증 요청 한도 시간당 5,000회 대비 여유.
- `GIST_AUTO_PUSH_DEBOUNCE_MS` 주석·설정 카드 문구("5분 뒤 자동 저장")도 갱신.

## 5. 상태 표시

### 동기화 상태 판정 (순수 함수, 예: `deriveGistSyncStatus`)
입력: 자동 동기화 ON 여부, 토큰 유무, Gist ID 유무, 마지막 원격 확인/불러오기/업로드의 성공 시각·연속 실패 횟수·마지막 오류 메시지.

| 상태 | 조건 | 헤더 점 |
|---|---|---|
| 정상 | 설정 완료, 최근 실패 없음 | 기존대로 "정상" (경보 없음) |
| 연결 끊김 | Gist ID 있음 + 자동 동기화 ON + **토큰 없음** | 주황, "연결 끊김" |
| 동기화 오류 | 원격 확인·불러오기·업로드가 **연속 2회 이상** 실패(1회는 일시 오류로 보고 무시) | 주황, "동기화 오류" |

- 기존 `appStatus` 우선순위에 끼워 넣는다: 저장 실패·백업 불일치(빨강) > Gist stale critical > **연결 끊김/동기화 오류** > 기존 warn들.
- 상태 메뉴 팝오버의 Gist 영역에 "**최신 확인 N분 전 · 마지막 저장 N분 전**"과 오류 이유 표시.
- 성공 1회로 연속 실패 카운트 리셋.

### 미연결 새 기기 안내
- 조건: Gist 미설정(토큰 또는 ID 없음) **AND** 데이터 비어 있음(ledger·accounts 0건).
- 대시보드 최상단 카드: "이 기기에는 아직 데이터가 없어요. PC의 설정 → Gist → '다른 기기 연결'에서 QR을 찍거나 연결 링크를 붙여넣으세요." + **[연결 링크 붙여넣기]** **[설정으로]**.
- 데이터가 있는 기기에는 표시하지 않는다.
- 디자인 규율: 이모지 금지(lucide 아이콘), 색 하드코딩 금지, 글자 11px 바닥.

## 6. 보안 고려

- 토큰은 연결 정보(QR·링크)와 localStorage에만 존재. 로그(`onLog`/appLog)·토스트에 토큰 출력 금지.
- fragment는 읽자마자 제거. 링크 복사는 사용자의 명시적 행동이며 경고 문구로 위험을 알린다.
- 받는 쪽 확인 모달 + 다른 Gist 경고로 링크 하이재킹 방지.
- 연결로 들어온 토큰은 이 기기에 영속 저장(사용자가 원하는 "다시 연결 안 함"의 전제). 기존 "이 기기에서 기억" 체크박스로 끌 수 있다.

## 7. 테스트

- `deviceConnect`: 인코드↔디코드 왕복, 전체 URL·값만 붙여넣기, 깨진 base64·JSON·모르는 버전·필드 누락 → null, fragment 읽고 제거(replaceState 호출 확인).
- 연결 적용: 테스트 실패 시 저장 안 함 / 성공 시 토큰 persist·ID·자동 동기화 ON·불러오기 호출 순서, 빈 기기는 미리보기 생략.
- `deriveGistSyncStatus`: 정상·연결 끊김·동기화 오류 경계(실패 1회 무시, 2회 경보, 성공 시 리셋).
- `useGistSync` 주기 확인(가짜 타이머): 표시 중 3분마다 확인, 숨김 탭은 확인 안 함, 충돌 모달 열림 시 건너뜀.
- 기존 `useGistSync.test.tsx`는 디바운스 상수를 참조하므로 값 변경에 그대로 통과해야 한다.
- 완료 기준: `npm run lint`, `npm test`, `npm run knip`(클린 유지), `npm run build` 통과.

## 8. 배포

- 폰에서 쓰려면 main push → GitHub Pages 배포가 필요하다. 현재 로컬 main이 origin보다 2커밋 앞서 있음(9/30·10/1 save). push는 사용자 확인 후 진행.
