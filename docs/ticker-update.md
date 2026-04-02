# 국내 종목 목록 갱신 및 신상장 반영

## 티커 관련 파일 역할

| 파일 | 역할 | 비고 |
|------|------|------|
| `data/ticker.json` | KR/US **마스터 목록**(티커+이름). 전체 시세·종목 불러오기·개발 서버 `GET/POST /api/ticker-json` | 저장소에 포함, 용량 큼 |
| `data/ticker.md` | (선택) 탭 구분 원본 리스트. 있으면 빌드 시 한글명이 `ticker.json` 기반 맵 **위에 덮어쓰기** | 없어도 동작 (`npm run ticker:gen-names`) |
| `src/data/krNames.json` | **생성물**(git 추적 안 함): 한국 티커→한글명 맵. 주식/배당/가져오기 등에서 import | 클론 후 `npm run build` 또는 `npm run ticker:gen-names`로 생성 |
| `data/ticker-backup.json` | (gitignore) 앱 `tickerDatabase` 스냅샷. dev만 `GET/POST /api/ticker-backup` | `ticker.json`과 스키마가 다름 → 한 파일로 합치지 않음 |
| `data/app-data.json` | (gitignore) 전체 앱 덤프에 `tickerDatabase` 포함 | 티커 전용 파일 아님 |
| `backups/**` | (gitignore) 로컬 수동 백업. 앱 코드에서 **참조 없음** | 불필요하면 로컬에서만 삭제 |

**클론 직후:** `npm install` 후 `npm run ticker:gen-names` 한 번 실행하거나, `npm run dev` / `npm run build`를 쓰면 `predev`/`prebuild`에서 자동 생성됩니다. `npm run lint`도 `krNames.json` 생성 후 타입 검사를 수행합니다.

## 개요

앱의 "종목 불러오기"와 검색/자동완성에 사용되는 국내 종목 목록은 `data/ticker.json`의 `KR` 배열에서 옵니다. 새로 상장한 종목을 이 목록에 반영하는 방법과, 목록에 없을 때 검색으로 추가하는 방법을 안내합니다.

## 1. 신상장·목록 반영 (마스터: `ticker.json`)

이 레포에는 예전 문서에 나오던 `npm run update-kr-tickers`, `npm run apply-ticker` 스크립트가 **없습니다**. KR/US 마스터 목록은 **`data/ticker.json`을 직접 편집**하거나, 별도 도구로 갱신한 뒤 저장소에 반영하는 방식을 씁니다.

한글 표시용 맵을 다시 만들려면:

```bash
npm run ticker:gen-names
```

(`node scripts/generate-kr-names.mjs`와 동일합니다.)

- `ticker.json`의 KR 항목 중 이름에 한글이 있는 것만 맵에 넣은 뒤,
- **`data/ticker.md` 파일이 있으면** 같은 스크립트가 탭 구분 행으로 이름을 **덮어씁니다** (선택 소스).
- `ticker.md`를 쓰지 않고 `ticker.json`만 관리해도 됩니다. 해당 파일을 두지 않거나 비워 두면 `ticker.json`만으로 `krNames.json`이 생성됩니다.

`data/app-data.json`의 `tickerDatabase`까지 맞추려면 앱 **백업/가져오기** 또는 주식 탭 **「종목 불러오기」**로 동기화합니다.

## 2. 목록에 없는 종목 추가하기 (검색)

새로 상장한 종목이 아직 `ticker.json`에 없어도, **종목코드** 또는 **회사명**으로 앱 내 검색을 하면 Yahoo Finance 검색 결과로 추가할 수 있습니다.

1. 주식 탭에서 거래 추가/종목 선택 시 **검색**에서 6자리 종목코드 또는 회사명 입력
2. 검색 결과에서 해당 종목 선택 후 거래 등록
3. **시세 조회 (보유)**를 하면 거래에 있는 티커만 시세가 갱신되고, 개발 서버(`npm run dev`) 사용 시 해당 종목이 `ticker.json`에도 자동 저장될 수 있습니다(보유 갱신 시 `persist` 동작).

Yahoo에 아직 반영되지 않은 직후 상장 종목은 검색/시세가 며칠 지연될 수 있습니다.

## 3. 주식 탭 시세 버튼: 보유 vs 전체

| 버튼 | 대상 | 반영 범위 | 비고 |
|------|------|-----------|------|
| **시세 조회 (보유)** | 거래 내역(`trades`)에 등장한 티커만 | `prices` + `tickerDatabase` 메타 | 코인은 `tickerDatabase.market === CRYPTO` 우선 |
| **시세 갱신 (전체)** | `data/ticker.json`의 **KR + US** 전 종목 | **`prices`만** (`tickerDatabase`·로컬 `ticker.json` POST 안 함) | **Vite 개발 서버**의 `GET /api/ticker-json` 필요. 정적 배포만이면 목록을 못 읽을 수 있음 |

전체 갱신은 종목 수가 매우 많아 시간이 오래 걸리고 레이트 제한(429)에 걸릴 수 있습니다. 확인 대화상자 후 실행됩니다.

## 4. 시세 조회 (한국 주식, Yahoo)

- **코스피** (00, 01, 02, 03으로 시작하는 6자리): `.KS` 심볼을 먼저 사용해 Yahoo에서 조회
- **코스닥** (그 외 6자리): `.KQ` 심볼을 먼저 사용해 Yahoo에서 조회

시세 갱신 시 배치 요청 실패한 종목은 종목별 Chart API로 재시도합니다.

## 5. 티커 DB 백업과 개발 전용 API

앱의 **`tickerDatabase`**(검색·자동완성·메타에 쓰는 종목 배열)는 다음 순서로 채워집니다.

| 단계 | 출처 | 비고 |
|------|------|------|
| 초기 로드 | `GET /api/ticker-backup` | **Vite 개발 서버**에서만 동작. 디스크의 `data/ticker-backup.json`(gitignore)과 연결됨 |
| 그다음 | `localStorage` 키 `ticker` | 동일 브라우저에서 이전에 저장된 목록 |
| 수동 | 주식 탭 **「종목 불러오기」** | `data/ticker.json` 등을 읽어 `buildInitialTickerDatabase`로 구성 후, 성공 시 `POST /api/ticker-backup`으로 `data/ticker-backup.json`에도 저장(개발 서버일 때) |

**`ticker.json`과의 역할 분리**

- **`data/ticker.json`**: KR/US **티커·이름 목록**(마스터). `GET/POST /api/ticker-json`으로 개발 서버에서 읽고, 시세 갱신 시 이름 반영 등으로 갱신할 수 있음.
- **`data/ticker-backup.json`**: 앱이 쓰는 **`tickerDatabase` 배열 전체**의 스냅샷. `종목 불러오기` 직후 등에 백업.

**정적 배포(프로덕션)**

- `/api/ticker-backup`, `/api/ticker-json`은 Vite 미들웨어라 **빌드 산출물만 서빙하는 환경에서는 없음**. 그 경우 초기 백업 단계는 건너뛰고 **localStorage**, 가져온 **`app-data`의 `tickerDatabase`**, 또는 **「종목 불러오기」**에 의존합니다.

국내 마스터 목록·한글 맵은 **§1**과 상단 표를 참고하세요.
