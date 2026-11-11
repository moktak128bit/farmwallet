# gas/ — FarmWallet Google Apps Script 운영 프로젝트

원본 장부는 Drive의 "FarmWallet 데이터" 시트. 이 폴더가 운영 GAS 프로젝트의 로컬 사본이다(`clasp`).

| 파일 | git | 설명 |
|---|---|---|
| `Code.js` | 추적 | 서버 원본. loadData/saveData/listVersions/loadVersion/backupNow/proxyFetch/사진 API |
| `appsscript.json` | 추적 | 매니페스트 (웹앱: 나만 접근, 배포자 권한) |
| `index.html` | 제외 | 화면 — `npm run build:gas`가 `src/`로 생성(단일 HTML). 직접 고치지 않는다 |
| `Config.js` | 제외 | Drive 데이터·사진 폴더 ID |
| `Seed.html` | 제외 | **실제 장부 JSON**(이관용 초기 데이터, 시트가 비었을 때만 쓰임). 절대 커밋·공유 금지 |
| `Inbox.html` | 제외 | **Claude 받은 편지함** — 변경분(farmwallet-delta-v1) 배열 `[{id,title,delta}]`. 앱이 열릴 때 시트 채택 뒤 자동 반영(hooks/useGasInbox), 시트에 들어간 게 확인되면 서버가 적용 완료로 기억. 실장부 거래라 커밋 금지 |
| `.clasp.json` | 제외 | 운영 스크립트 ID |

## 화면 소스
화면은 저장소 `src/` 그대로다. GAS 전용 부분:
- `src/services/gas.ts` — `isGas()`/`runServer()`/`remoteText()`(문구의 Gist→시트)
- `src/services/gistSync.ts` — `isGas()`일 때 저장·불러오기·버전 목록을 서버 함수로(충돌 감지·자동 동기화는 Gist와 공용)
- `src/main.tsx` — 부팅 시 시트 장부 채택(기기 미저장 편집은 안전 스냅샷 후 덮음)
- `src/yahooFinanceApi.ts` — 시세는 서버 `proxyFetch` 우선
- 설정: `GasPhotosCard`(사진 올리기) · `LedgerFileImportCard`(Claude 변경분 `farmwallet-delta-v1` 적용, `utils/ledgerDelta.ts`) · `GasStorageCard`(저장 위치)
- 빌드: `scripts/build-gas.mjs` — 워커 끔(`VITE_GAS_BUILD=1`), PWA 스텁, JS·CSS 인라인

## 배포 순서
1. `npm test` · `npm run lint` 통과
2. `npm run build:gas` → `gas/index.html`
2-1. **안정성 점검(필수)**: `npm run stress:gas -- <장부.json>` — 가짜 서버로 지연·실패·무응답 9가지 조건에서 12개 탭 순회·편집 저장·2분 방치를 돌려 렌더 루프·호출 루프·무한 로딩·저장 누락을 잰다. 하나라도 걸리면(종료 코드 1) 배포하지 않는다. 장부 JSON은 로컬 경로로만(실장부 커밋 금지). 결과·스크린샷은 `node_modules/.gas-stress/`. 빠른 확인은 `--quick`, 특정 조건만은 `normal,hang-save`처럼.
3. 운영이 이 폴더와 같은지 확인: scratch 폴더에 `clasp pull` 해서 `Code.js` 비교 (다른 기기에서 고쳤을 수 있다)
4. `cd gas && clasp push` → `clasp create-version "설명"` → 기존 웹앱 배포 ID에 `clasp deploy -i <배포ID> -V <버전>` (URL 유지)
5. 문제가 있으면 같은 배포 ID를 이전 버전 번호로 되돌린다(`clasp deploy -i <배포ID> -V <이전버전>`)
