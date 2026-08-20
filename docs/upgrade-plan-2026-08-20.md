# FarmWallet 무손상 업그레이드 기획 — 2026-08-20

> 질문: "데이터를 손상시키지 않으면서 이 가계부를 최고의 앱으로 업그레이드하려면?"
> 방법: 7개 차원(데이터 안전·가계부 입력·가계부 분석·투자/배당·아키텍처·UX/모바일·자동화/임포트)을 코드 기준으로 병렬 탐색(file:line 근거 필수) → 차원별 적대 검증(이미 있음/과장/위험 판정) → 상위 주장은 직접 재확인. 57개 후보 중 판정·보정을 거쳐 아래 플랜으로 압축.
> 선행 문서: docs/roadmap-2026-06-22.md(Track A~G), docs/ledger-plan-2026-07-22.md(P0~P4), docs/state-audit-2026-06-29.md.

## 한 줄 진단

**기록기와 투자 어드바이저는 거의 완성됐고, 데이터 복구망(스냅샷 19곳·해시 검증·드래프트 슬롯·충돌 모달)도 두텁다.** 남은 것은 세 가지다.

1. **지금 조용히 틀리고 있는 것** — 환율 stale 박제, PWA 무단 리로드, KST 위반, 세후 합산, 죽은 저장 키 등 *실제 버그* 10건. 전부 데이터 영향 없이 고칠 수 있다.
2. **"무손상 업그레이드"를 사람의 주의가 아니라 코드가 보장하게 만드는 것** — 필드 누락 자동 감지, 마이그레이션 직전 스냅샷+diff, 백업 저장소(현재 5MB localStorage 안에서 보존 정책이 물리적으로 성립 불가), CI에서 한 번도 안 도는 901개 테스트.
3. **그 위에 얹을 가치** — 가계부의 "미래 축"(현금흐름·목표 도달일·예산 페이스·월간 리뷰), 매일의 입력 마찰 제거(자동완성·드래프트·계산식), 투자 꼬리(ISA/연금·절세 카드·환율 밴드·조기상환 시뮬).

**원칙: 기능보다 프로토콜 먼저.** 2번이 깔리면 3번의 모든 항목이 안전해진다. 반대로 하면 새 기능마다 유실 공포를 반복한다.

---

## 0. 무손상 업그레이드 프로토콜 (이후 모든 작업의 규칙)

### 0-1. 데이터 영향 등급과 필수 절차

| 등급 | 뜻 | 필수 절차 |
|---|---|---|
| **none** | AppData를 읽지도 쓰지도 않음(테스트·UI·localStorage UI 키) | 일반 lint/test |
| **read-only** | AppData를 읽어 파생만 계산 | 순수함수 + 테스트(USD 환산·KST 경계·시세 미로드 중립) |
| **field-in-item** | 이미 배열로 통째 보존되는 항목 안의 **선택 필드** 추가(예: `Account.taxShelter`, `BudgetGoal.rollover`, `Loan.prepaymentFeeRate`) | 왕복 테스트에 필드 추가 + **화이트리스트 폼 수정**(AccountForm.tsx:53·AdjustmentModal.tsx:119·LoanForm.tsx:96-107은 객체를 새로 만들어 미지 필드를 드롭함) |
| **new-field** | AppData 최상위 필드 추가 | **배선 6곳**(types.ts / dataNormalizers / dataService parsedData :799-834 / getEmptyData :376 / tableDataBackup export :434-470 / import :570-590) + 계약 테스트(P1-1)가 자동 검출 |
| **migration** | 기존 항목의 형태를 바꿈(v13 등) | 직전 라벨 스냅샷 + diff 리포트 + 마스킹 실데이터 리플레이 테스트 + 멱등성(P1-3) — **최후 수단** |

### 0-2. 배포 사다리 (모든 기능이 이 순서로)

```
① 순수함수 + 테스트  →  ② 읽기전용 UI(섀도우: 숫자만 보여줌)  →  ③ 저장(필요할 때만, 등급별 절차)  →  ④ 마이그레이션(최후)
```

### 0-3. 쓰기 경로 단일화
같은 엔티티(가계부 항목·거래)를 쓰는 경로가 2개 이상이면 **순수 빌더 함수로 통일**한다. 근거: 폼 개편 중 16건이 틀린 스키마로 저장된 전례(ledger-plan:20-23), 빠른 입력이 detailCategory 없이 저장 중(QuickEntryModal.tsx:101-112), 거래 폼은 trades 외에 account.usdBalance·cashImpact·tickerDatabase까지 함께 쓴다(TradeFormSection.tsx:365-430). 세 번째 저장 경로(모바일 시트·임포트)는 빌더 추출 후에만.

### 0-4. 이미 결정된 것(재제안 금지)
종합과세 추가세 산식 자동화(사용자 직접 입력) · USD 비증권계좌 합산 누락(의도) · 서버/멀티유저 · 차트 애니메이션 · App.tsx 자식 props 시그니처 · 야후 섹터 데이터(703659d에서 신뢰도 문제로 제거) · 대시보드 위젯 순서 UI(의도 제거, DashboardWidgetSettings.tsx:6).

---

## Phase 0 — 지혈: 지금 깨져 있는 것 (전부 dataImpact none, 각 S)

| # | 항목 | 무엇이 틀렸나 (근거) | 고치면 |
|---|---|---|---|
| 0-1 | **환율 stale 박제** | `useFxRate.ts:52-62` 초기값이 localStorage 캐시(며칠 전 값) → `useDailyFxRecorder.ts:20-29`가 첫 effect에서 그 값을 **오늘 날짜**로 적립하고 `recordedTodayRef`로 당일 재기록 차단 → 신선 환율이 와도 반영 안 됨. 주말·휴가 후 첫 실행마다 발생, TWR(twr.ts:49-52)·양도세 환산·marketEnvBackfill까지 전파 | `fetchedAt`이 오늘(KST)일 때만 기록 / 당일 신선값 도착 시 1회 덮어쓰기. 테스트 0건 → 추가 |
| 0-2 | **PWA 무단 리로드 + 죽은 '새 버전' pill** | vite.config.ts:977 `registerType:"autoUpdate"` + PWAStatus 1시간 `update()` → vite-plugin-pwa react.js:41-44는 autoUpdate에서 `activated` 즉시 `window.location.reload()`, `onNeedRefresh` 미호출 → App.tsx:831 pill은 뜰 수 없음. 입력 중이던 폼·모달 유실(AppData는 unload flush로 보호) | `registerType:"prompt"`로 전환 → 기존 pill이 실제로 동작 |
| 0-3 | **KST 위반 2건 + 예측 필터 구형** | BudgetDashboardSection.tsx:23-28·useInsightsData.ts:391 `new Date()`로 '오늘' 계산(자정 전후 하루 어긋남); forecast.ts:40,137 구 필터 3종+USD 미환산(:43,:149) | `getTodayKST()` / `classifyLedgerFlow`+`toKrwAmount`로 교체 |
| 0-4 | **종합과세 트래커 세후 합산** | taxCalculator.ts:28-29 주석 자인: "amount는 세후 입금액일 가능성이 높지만 gross로 가정". 2,000만 임계는 **세전** → ~15% 과소, 경고가 늦게 울림 | `grossUp` 옵션(기본 off, 설정 토글): 국내 ÷0.846·해외 ÷0.85, 카드에 '세전 환산' 표기. ※산식 자동화가 아니라 입력값 정확도 |
| 0-5 | **죽은 DATA_TABLE_BACKUP 키** | dataService.ts:986 매 저장마다 풀데이터(tickerDatabase ~619KB 포함) 기록, 읽는 곳 0건. localStorage 5MB 중 ~1MB 순손실 | 쓰기 제거 + 부팅 1회 removeItem(상수 유지) |
| 0-6 | **스키마 마커 되감기** | dataService.ts:855 `schemaVersion !== DATA_SCHEMA_VERSION`이면 저장 → GitVersionModal로 구버전 앱을 띄우면 마커가 12→10으로 내려가고 복귀 시 마이그레이션 재실행(v3 할인차감은 비멱등). normalizeImportedData:707 `Math.min` 클램프도 미래 버전 파일을 조용히 현행 취급 | stored/imported > current면 **마커 쓰기 금지+경고 토스트**, 임포트는 초과 시 거부 |
| 0-7 | **드로어 접근성 + window.alert** | App.tsx:984-1003 드로어는 role=dialog지만 useFocusTrap/useModalStackEntry 없음, ESC가 aria-hidden 오버레이 onKeyDown에만(:990) → 키보드로 못 닫고 포커스 누수. window.alert 10곳(AccountForm 2·AccountTablesSection 2·AdjustmentModal 4·LoanFormSection 1·pdfExport 1), `<th scope="col">` 0건 | 훅 2개 적용, alert→toast/ConfirmModal, scope 일괄 |
| 0-8 | **죽은 설정 UI 2개** | DashboardWidgetSettings.tsx:430 targetNetWorthCurve 편집기·:312 'ISA 목표 포트폴리오' 안내 — 읽는 화면 0건(위젯 목록에 ISA 위젯 없음) | NetWorthTrendChart에 목표 곡선 오버레이로 살리거나(read-only S) 설정에서 제거 |
| 0-9 | **sanitize 폐기 시 원본 미보존** | dataService.ts:718-733 폐기 건수 토스트만 → 자동 백업 기본 off라 사본 없을 수 있고 다음 저장에서 영구 소멸 | `droppedLedger+droppedTrades>0`이면 raw 문자열을 '손상 항목 폐기 직전 원본' 라벨 스냅샷으로 |
| 0-10 | **BACKUPS 키 손상 시 전량 소실** | backupService.ts:143-147 파싱 실패→빈 목록→다음 저장이 덮어씀 | 파싱 실패 시 원본을 `BACKUPS__corrupt` 1슬롯으로 옮긴 뒤 새로 시작 |

---

## Phase 1 — 안전망을 코드로 (dataImpact none; v13·새 필드의 전제)

| # | 항목 | 내용 | effort | 출처 |
|---|---|---|---|---|
| 1-1 | **AppData 계약 테스트** | `src/__tests__/appDataContract.test.ts`: `const FULL: Required<AppData>` 픽스처(새 키 추가 시 **tsc 에러**로 즉시 실패) → saveData→loadData / 테이블 백업 왕복 / toUserDataJson→normalizeImportedData 3경로에서 `Object.keys(FULL)` 전수 대조(캐시 3키 등 의도된 제외는 allowlist에 사유). getEmptyData 누락 5키 보정. 지금은 16필드 수동 나열(dataService.test.ts:297-349)이라 investmentGoals·dailyBudget 유실 회귀가 실제로 2번 났다 | S | DS-1·AR-2 |
| 1-2 | **vitest 환경 분리 → CI 편입** | 901개 테스트가 `npm run ci`에서 **한 번도 안 돈다**(package.json:20, ci.yml). 원인은 jsdom 전역: 392초 중 환경 생성 300초, 테스트 자체 3.6초. DOM 필요 파일은 75개 중 8~9개뿐(검증자 실측 node 환경 44초). `environment:"node"` + 해당 파일 `// @vitest-environment jsdom` 프라그마 → ci 스크립트에 `npm test` 추가 | S | AR-1 |
| 1-3 | **마이그레이션 직전 스냅샷 + diff 리포트 + v13 리플레이 하네스** | (a) `services/migrationReport.ts` `diffAppData(before, after)` 순수함수: 컬렉션별 added/removed/changed·kind별 금액 합계·id 집합 차(demoteSchema preview의 일반화). (b) loadData: `fromVersion < DATA_SCHEMA_VERSION`이면 saveData 전에 raw를 `saveSafetySnapshot(…, '스키마 v{from}→v{to} 직전 원본')`(라벨 → 보존 보호) + 리포트를 소형 키에 기록. (c) 설정>백업 '마지막 마이그레이션' 카드(읽기전용). (d) 마스킹 실데이터 픽스처(`data/farmwallet-data.json`은 .gitignore — 금액·설명 마스킹 후 커밋)로 v13 리플레이 + 합계·건수 보존 단언. **⚠ '원클릭 롤백'은 그대로 구현 금지**: 원본을 normalizeImportedData로 복원하면 schemaVersion 없음→현행 간주→재마이그레이션 안 됨 + 마커는 이미 13 → 구형태가 영영 잔존. 롤백은 '원본 보존 + 수정된 마이그레이션 재실행용 복원'(복원 시 마커를 from으로 되감기)으로 재정의. ⚠ '버전 키 부재 시 현행 간주' 휴리스틱도 금지(v2~v11 데이터를 현행으로 오판). 레지스트리 리팩터(220줄 이동)는 불필요 — 현행 함수에 v13 단계 추가만 | M | DS-2(a)(b)·DS-6 축소 |
| 1-4 | **백업 저장소 IndexedDB 이전 + 자동 백업 기본 on** | 현 보존 정책 4일×5개(backupService.ts:30-36)는 **산수가 안 맞는다**: 백업 1개≈1.4MB(캐시 포함 풀 AppData, useBackup.ts:263-265) → 20개=28MB ≫ localStorage 5MB. user-only로 줄여도 750KB×20=15MB. quota 폴백(:239-256)이 조용히 1~2개로 축소하고 사용자는 모른다. **유일한 해법은 BACKUPS를 IndexedDB로**(cacheStore.ts의 openDB/put 패턴에 backups 스토어 추가). 이관은 복사 성공 확인 후에만 localStorage 키 제거, 실패 시 기존 경로 유지. 백업 payload는 user-only(toUserDataJson 기준, 해시도 같은 문자열) + 복원 3경로(BackupHistoryTable·main.tsx·useAppData)에 `mergeCurrentCaches` 헬퍼(prices 빈 배열이 캐시를 덮지 않게). 그 다음 BACKUP_ON_SAVE 기본 on + 간격 단축(상수 1곳) | M | DS missed#1·DS-4(b)·DS-8 대체 |
| 1-5 | **저장소 사용량 카드** | `utils/storageUsage.ts`: STORAGE_KEYS 키별 UTF-16 바이트·백업 개수/크기·5MB 대비 % → 설정>백업 읽기전용 막대. useStorageQuota(origin 전체, IDB 포함 수백MB 기준)는 localStorage 압박을 감지 못 한다(useStorageQuota.ts:16-20) → localStorage 합계 ≥80%면 헤더 경고 | S | DS-4(c) |
| 1-6 | **적용 게이트 diff 확인 모달** | Gist 충돌 모달만 건수·최신일·합계를 보여주고(GistConflictModal.tsx:26-50 summarizeJson), 백업 복원·JSON/파일 가져오기·드래프트 복구·수동 pull은 '덮어씁니다' confirm뿐. `ApplyConfirmModal`(useFocusTrap+modalStack): 현재 vs 적용될 데이터(정규화 후)의 컬렉션별 건수 차·kind별 합계 차·최신 가계부 날짜 → [적용]/[취소]. 6개 게이트의 window.confirm을 순차 교체(스냅샷→정규화→적용 순서·실패 시 미적용 계약 유지). 에러화면(main.tsx)은 confirm 유지 | M | DS-7 |
| 1-7 | **Gist 충돌 시 시계열 date-union 병합** | toUserDataJson(dataService.ts:941-944)은 historicalDailyFx·benchmarkDailyCloses·marketEnvSnapshots를 포함하고 각 기기의 자동 적립이 payload를 바꿔 push를 유발 → 두 기기가 다른 날 앱을 열면 충돌 → 선택지는 '원격 적용/로컬 강제/취소'뿐 → **어느 쪽이든 한 기기가 쌓은 append-only 시계열이 사라진다**. 날짜 키 시계열만 충돌 해소 직전 date-union 병합(id 키 배열 ledger/trades는 3-way 아니면 위험하므로 제외). 순수함수+테스트+스냅샷 필수 | M | AU missed#2 |
| 1-8 | **테스트 0건 모듈 행동 테스트** | demoteSchema(119줄, 설정 버튼으로 실데이터 변환)·transportCategoryMigration(194)·useBackup(441, 디바운스·드래프트·quota)·tabSync(155)·dataNormalizers·dataIntegrity — 전부 `__tests__` 0건. 3세대 혼재 픽스처로 '대상만 바뀌고 나머지 deep-equal'·멱등성·마커 보존 | M | AR-7 |
| 1-9 | **오류 리포팅 일원화** | 전역 onerror/unhandledrejection 0건, ErrorBoundary는 console.error만(TabErrorBoundary.tsx:26-29). 이미 영속되는 appLog(uiStore, 500건)+JSON 내보내기가 있으니 `reportError(scope, err)`로 연결(동일 메시지 N초 dedup 가드 — 렌더 에러→setState→재에러 루프 방지). APP_LOG_STORAGE_KEY가 STORAGE_KEYS 밖(uiStore.ts:69)인 것도 이관(문자열 유지) | S | AR-8 |
| 1-10 | **무결성 검사 게이트 연결(축소안)** | 설정 탭 진입 시 자동 실행·배지는 이미 있음(App.tsx:452-470). 새 가치는 ①6개 적용 게이트에서 호출 ②loanId·settledLedgerIds·fxRateAtTrade 참조 검사(현재 0건). **반드시 '현재 대비 새로 생기는 오류'만 프롬프트**(실데이터는 이미 경고를 가질 수 있어 매번 뜨면 습관적 [확인]으로 무력화) | S~M | DS-3 축소 |
| 1-11 | **(v13 배포 시점) schemaVersion 메타** | Gist JSON·DATA에 schemaVersion이 없어 PC만 v13이면 폰(v12)이 pull→필드 드롭→재push로 전 기기에서 유실. **⚠ 그대로 넣으면 사고**: toUserDataJson 문자열은 dirty·해시·충돌 판정의 단일 소스(useBackup.ts:73-75/:145, useAppData.ts:74, useGistSync.ts:134-137) → 배포 직후 내용이 같아도 가짜 충돌 모달. 안전안: schemaVersion**만**(appVersion 금지) + 비교·해시 전 메타 제거 정규화를 4개 비교 지점에 공통 적용 + lastPushedHash 1회 재계산 + normalizeImportedData의 Math.min 클램프를 '초과면 거부'로. 무버전 과거 Gist 복원 시 'v11·v12 멱등 마이그레이션 적용' 옵션 | S | DS-5 수정안·AR missed#2 |

---

## Phase 2 — 가계부 입력 마찰 제거 (폼·파생만, 저장 형태 불변)

| # | 항목 | 내용 | dataImpact | effort |
|---|---|---|---|---|
| 2-1 | **빠른 입력 저장 결함 + 추천 엔진 3단 스키마화 (선행)** | QuickEntryModal.tsx:101-112는 detailCategory를 **저장하지 않음**, categoryRecommendation.ts:50 키도 `category:subCategory`까지 → 현행 표준(~700건, cat=지출/sub=대분류/det=소분류)에서 소분류가 버려진다. 추천 소스가 잘못 저장된 16건(cat=대분류 직접)이면 그 형태를 재생산. → 키·결과에 detailCategory 포함, 추천값을 `expenseMainName`으로 현행 스키마 정규화, 상호 정규화(숫자·지점/점·(주) 제거), 전용 테스트(현재 0건) | none | S~M |
| 2-2 | **메인 폼 설명 자동완성 + 빈 필드 자동 채움** | 설명란은 맨 `<input>`(LedgerEntryForm.tsx:1160-1163), 추천은 빠른 입력 1곳만, 카테고리/계좌 버튼 전부 tabIndex=-1이라 키보드 완결 불가. `utils/ledgerSuggest.ts` 인덱스(빈도×최근성) → Autocomplete(기존 components/ui/Autocomplete) → 선택 시 **비어 있는 필드만** 채움(토스트 '지난 12회 식비>카페·신한 적용') + 추천 칩 3개. '폼 버튼=목록 필터' 설계는 그대로(applyTemplate과 같은 setForm-only, 명시) | read-only | M |
| 2-3 | **날짜 빠른 칩(어제·그제·−1일)** | 폼에 '어제' 0건. 밀린 기록을 다음날 몰아 쓰는 동선에서 달력 조작 매번 | none | XS |
| 2-4 | **폼 드래프트 보존** | 탭 전환 시 LedgerView 언마운트(App.tsx:1024)로 입력 중 내용 유실. sessionStorage(탭별, 멀티탭 충돌 없음) 300ms 디바운스, 마운트 시 복원 토스트 [비우기]. **수정 모드(form.id)는 제외**(stale edit 제출 위험), 필터 상태는 복원 안 함 | none | S |
| 2-5 | **최근 거래 칩 + 템플릿 lastUsed** | `LedgerTemplate.lastUsed`(types.ts:211)는 선언만, 가계부에서 기록 0건 → `getTodayKST()`로 기록(주식 프리셋은 toISOString 사용 중 — 통일) + 사용순 정렬. 2-2 인덱스로 '최근 30일 상위 6건' 칩(startCopy 재사용). 템플릿 적용이 undo 히스토리에 섞이지 않는지 확인 | none | S |
| 2-6 | **금액 계산식 + ÷N** | `12000+3500`, `45000/3` — 안전 파서(eval 금지), blur/Enter 직전 평가·치환, '= 15,500원' 미리보기. 모바일 numeric 키패드엔 연산자가 없으니 '÷N' 버튼이 모바일 경로 | none | S |
| 2-7 | **중복 의심 — 비차단 토스트** | 같은 날·같은 금액·같은 계좌는 커피 2잔처럼 일상적 → 차단 confirm은 연속 입력 흐름을 끊음. '같은 날 같은 금액 1건 있음 [보기]' 토스트, 설명까지 일치할 때만 confirm | none | S |
| 2-8 | **선택 항목 일괄 편집** | 선택은 합계 전용(LedgerPage.tsx:137-142). `applyBulkEdit(entries, patch)` 순수함수 → 미리보기(전→후) → saveSafetySnapshot → onChangeLedger 1회 → [되돌리기]. **제외 규칙**: kind 변경 금지, USD 금액 제외, 정산(settledLedgerIds)·환전·카드결제이체 transfer의 계좌 변경 제외, 재테크(투자수익/손실/배당/이자) 분류 변경 제외, 날짜 이동이 월 경계를 넘는 건수 경고, 레거시 항목은 현행 형태로 승격됨을 미리보기에 명시 | none | M |
| 2-9 | **반복지출 생성 모듈 추출 → 배지 원클릭 반영** | 생성기·dedup이 RecurringListSection.tsx:258/:223 컴포넌트 내부 클로저(export 0·테스트 0)라 헤더에서 호출 불가 → `utils/recurringGenerate.ts`로 동작 불변 추출+테스트(주기·말일 클램프·dedup — 과거에 깨진 영역) → 배지 클릭 팝오버 체크리스트 → 반영 + undo. 배지 판정(마감 윈도우)≠생성 스코프(월 전체)라 **반드시 추출된 generate+filterDuplicate 경로**를 거칠 것 | none | M |
| 2-10 | **카드 명세 임포트(축소안)** | 임포트 4경로 전부 '전체 덮어쓰기', 행 병합·명세 파서 0건(CSV 임포트는 5419fb6 구현→b989469 레이아웃 정리 커밋에서 함께 삭제 — 명시적 결정은 아니었던 것으로 보임, **재도입 전 확인**). 1차 범위는 **카드 계좌 명세로 한정**(거의 전부 expense) — 은행 명세의 '출금→expense' 일괄 매핑은 카드결제이체·저축/투자이체 transfer 체계와 충돌해 지출·재테크 집계가 조용히 부푼다. 행별 kind 지정, date+amount 일치는 **기본 제외**(수기 '스타벅스' vs 명세 '스타벅스커피(주)강남점'을 description 키로는 못 잡음), dry-run 기본, append-only, 계좌 필수, 스냅샷 + 태그 `import:YYYY-MM-DD`로 일괄 되돌리기. 2-1 선행(detailCategory) | none(대량 쓰기 — 절차 필수) | L |
| 보류 | 모바일 입력 시트(LI-7) — 세 번째 저장 경로(16건 사고 전례) → submitForm 빌더 추출 후에만, 실사용 기기 확인 후 · 카드 승인 문자 파서(IMP-2) — 포맷 샘플 없이는 정규식 부채 | | |

---

## Phase 3 — 가계부 어드바이저: "앞으로"를 말하게 (대부분 none, 일부 field/new-field)

| # | 항목 | 내용 | dataImpact | effort |
|---|---|---|---|---|
| 3-1 | **예산 페이스** | 현재 '속도 초과'는 선형(경과일/총일×한도, new Date())·위젯은 80/100% 문턱만. `computeBudgetPace` → 월말 예상·남은 하루 허용액·전월 동기(dayCap, 컨벤션 13) → '이 페이스면 월말 +12%, 남은 18일 하루 1.2만'. **effectiveLimit 소비처 4곳**(BudgetDashboardSection·BudgetAlertWidget·LedgerEntryForm:356-368·BudgetRecurringView:74) 동시 교체 — 아니면 9778bd3에서 고친 '화면마다 다른 예산' 회귀 | none | S |
| 3-2 | **목표 ETA(읽기전용)** | finalTotalAssetTarget 진행률%만(AssetTab.tsx:37) → `projectGoal`(trailing 6/12개월 순자산 델타) → 'ETA 2029-03 · 기한 맞추려면 월 +35만' | none | S |
| 3-3 | **고정비·변동비·재량 3분해 + 정의 단일화** | 고정비 정의 두 벌(expenseClassification.isFixedExpense vs DividendCoverageCard.tsx:54-64 인라인). `utils/fixedExpense.ts` classifyExpenseNature → fixed/variable/discretionary(1단계 휴리스틱, 2단계 `categoryTypes.discretionary`는 tableDataBackup.ts:75-81/:143-150 키 열거 **양쪽** 추가). DividendCoverageCard 숫자 불변 회귀 테스트 먼저 | none → field | M |
| 3-4 | **카드 청구 예정액 + 정기 수입 저장소 결정 (3-5 전제)** | `Account.paymentDay/billingCycleStart`(types.ts:19-22) 선언만, 사용 0건. 카드 계좌 expense는 결제일에 빠져나가므로 잔고 곡선은 '청구주기 카드 지출 합→결제일 유출'로 변환해야 맞다 → `computeCardBillForecast`. 월급 가정은 SalaryTimer localStorage(백업·Gist 미포함) → RecurringExpense에 `kind:'income'` 선택 필드(field-in-item, generate/alert가 expense 가정이라 가드) 또는 AppData 승격 중 결정 | none / field | M |
| 3-5 | **통합 현금흐름 12개월 잔고 곡선** | cashFlowForecast는 'v1 = RecurringExpense만·60일 합계'(주석 자인). `utils/loanSchedule.ts`(LoanCardsSection.tsx:43-80 산식 이관·월별 원리금) + `buildCashFlowProjection`(가용현금 + 반복 + 대출 + 카드청구 + 선행배당 + 월급 + 변동 기준선) → 최저 잔고·첫 마이너스 예상일. **이중계상 계약**: 대출 상환이 반복지출로도 있으면 스케줄 제외, 카드결제이체 반복과 변동지출 분리, 배당은 '가용 현금' 토글 | none | L |
| 3-6 | **월간 리뷰 내러티브** | 숫자 한 장은 ComprehensiveMonthlySection이 이미 함 → 그 위에 wins/warnings(예산 지킨 카테고리·무지출일·이상치 z·성장 TOP·구독 급증)+마크다운 내보내기. 진행 중인 달은 '1~N일 동기' 라벨 강제. (선택) 한 줄 회고 `monthlyReviewNotes`는 new-field 별도 PR | read-only → new-field | M |
| 3-7 | **이름 있는 저축 목표** | `AppData.savingsGoals` {name,targetAmount,targetDate,linkedAccountIds|linkedCategory} — 진행=연결 계좌 잔액 합(증권계좌는 USD·평가액 미포함이라 입출금/저축 한정) 또는 재테크 이체 누적. 배선 6곳+계약 테스트 | new-field | M |
| 3-8 | **구독·반복결제 감지 → 등록 제안** | 구독 판정이 문자열 '구독'뿐(useInsightsData.ts:234-239), SubTab.tsx:39 '신규/해지 미구현'. `detectRecurringCandidates`(≥3회·간격·금액 ±10%) → 신규/해지/금액변경 배지 → RecurringFormCard prefill(자동 생성 금지). alreadyRegistered는 matchesRecurringEntry(금액±1) 대신 느슨 매칭 | none | M |
| 3-9 | **FIRE 투영(결정론 3시나리오)** | ledger-plan G1 5단계 ①~③: fireBaseline(연 실질지출·고정비·월 저축·TWR+배당수익률) → fireProjection(인플레·SWR·크로스오버). 몬테카를로는 과잉, '가정 기반' 면책 필수(세금 24% 고정 교훈). ④firePlan은 사용 후 | none → new-field | L |
| 3-10 | **연말정산 미리보기** | 카드 25% 문턱·15/30%·급여구간 한도·의료비 3%·기부·월세. AccountType은 `'card'`(types.ts:3 — 'credit' 아님). 세법 상수 연도 태그+'개략' 면책, 총급여는 localStorage 입력 | none | M |
| 3-11 | **인앱 알림 센터(넛지)** | 헤더 pill 6~8종이 모바일에서 column 스택(styles.css:1309-1322). `buildNudges` 순수함수가 기존 계산(반복·예산페이스·종합과세·선행배당·환율 ±1.5% 급변·대출 상환일)을 호출만 → 벨+패널, 스누즈는 localStorage(기기별). **DraftRecoveryBanner·SaveStatusPill은 절대 패널로 숨기지 말 것**. 3-1~3-5 위에 얹으면 가치 큼 | none | M |
| 후순위 | 예산 이월/연간(BG-2, 전체 예산 excludeCategories 우회 있음) | field | M |

---

## Phase 4 — 투자·배당 꼬리 (로드맵 B2·B4·G2 + 신규)

| # | 항목 | 내용 | dataImpact | effort |
|---|---|---|---|---|
| 4-1 | **ISA/연금저축/IRP 세제 성격 + 납입한도·세액공제 + 종합과세 합산 제외** | Account.isPension은 표시용 boolean뿐. `Account.taxShelter?: 'isa'|'pension'|'irp'` + `buildShelterContributions`(transfer & toAccountId∈shelter, **환전·내부이체·배당 재투자 제외**) + 한도 상수(기준연도 주석) + taxCalculator `excludeAccountIds`(ISA·연금 계좌 수령 배당은 임계에 미합산 — 현재 과대 경고). **AccountForm.tsx:53·AdjustmentModal.tsx:119 화이트리스트 수정 필수** | field-in-item | M |
| 4-2 | **절세 액션 카드** | B1(배당탭)·B3(주식탭 포트폴리오 하단)·4-1이 3곳에 흩어짐, 대시보드 세금 위젯 0개. `buildTaxActions` → 우선순위 액션 목록 → 위젯 id 'taxActions'(연말 2개월 자동 노출이 위젯 피로 덜함). 4-1 없이 B1+B3만으로도 성립 | none | M |
| 4-3 | **환율 밴드** | 일별 환율 이력(180일+월말)이 있는데 '지금 환율이 1년 분포 어디'가 0건. `buildFxBand`(p25/p50/p75·percentile·MA) → 환율 pill 툴팁·환전 폼·USD 매수 힌트. 심볼은 앱 전역 `USDKRW=X`로 통일(제안의 KRW=X 금지), 압축 구간 가중 | read-only | S |
| 4-4 | **대출 조기상환 vs 투자 시뮬** | `simulatePrepayment`(이자 절감·단축 개월·수수료 손익분기) + TWR/배당수익률 비교('보장 아님'). `Loan.prepaymentFeeRate` 추가 시 LoanForm.tsx:96-107 화이트리스트 수정 | read-only → field | M |
| 4-5 | **배분 X-ray 1단계(통화·시장 2축)** | 자산군·현금·연금 축은 AssetCompositionCard·NetWorthTrendChart 토글·AssetTab에 이미 흩어져 있음 → 새 가치는 KRW/USD·KR/US/CRYPTO 2축 + 한 화면 통합. 섹터는 의도 제거 이력(703659d) → 수동 태그 재도입은 **사용자 확인 후**(tickerMeta 별도 맵, TickerInfo는 시세 갱신이 객체를 재구성해 유실) | read-only | M |
| 4-6 | **종합과세 연말 투영 — 선행배당 기반** | 선형 페이스(ytd÷경과일)를 buildForwardDividends 월별 예상으로 교체(옵션, 기존 동작 보존). 0-4 gross-up 후 | none | S |
| 후순위 | 배당 YoY 배지만(DV-2 축소, S) · 기간 기여도(PF-1, 포트 단위 시계열이라 L) · 미기록 배당 감지(AUTO-3, 보유종목×Yahoo 호출량·KR 누락 오탐) · 증권사 거래 임포트(IM-1 — usdBalance·cashImpact 델타가 폼 클로저에 있어 **헬퍼 추출 전 금지**, undo가 델타 역적용까지 해야 함, 최후순위) | | |

---

## Phase 5 — UX·모바일·구조 (전부 none)

| # | 항목 | 내용 | effort |
|---|---|---|---|
| 5-1 | **프라이버시 블러** | formatter 모듈 플래그(formatKRW/USD/Number → '••••'), 헤더 토글+Ctrl+Shift+H. 내보내기·저장 경로는 formatter 미사용 확인됨(오염 없음). **toLocaleString 직접 호출 91곳 전환 완료 전엔 기능 노출 금지**('반쯤 가려진' 화면). 앱 잠금은 localStorage 평문이라 보안 효과 없음·잠금 중 복구 경로 불성립 → 보류 | M |
| 5-2 | **모바일 하단 탭바 + FAB** | ≤768에서 탭 전환이 햄버거→드로어 2탭. 5개(대시보드·가계부·주식·배당·더보기)+safe-area+FAB(빠른 입력). 모달 열림 시 숨김·iOS 키보드 visualViewport 대응. 실사용 기기 미확인 → 0-7 드로어 수정 후 확인 | M |
| 5-3 | **뒤로가기·마지막 탭·딥링크·매니페스트** | popstate/pushState 0건 → Android PWA 뒤로가기가 앱 종료. pushState 더미+popstate로 '뒤로=모달 닫기/이전 탭'(modalStack 재사용). 최상위 탭 복원 키(현재 dashboard 고정). manifest shortcuts/share_target(Android 전용)·PNG 아이콘(iOS apple-touch-icon svg 깨짐)·dist에 manifest 링크 2개 공존 정리 | S~M |
| 5-4 | **hex→토큰 스윕 + 컨벤션 게이트** | 인사이트 탭 8파일 ~190라인 hex(ExpenseTab.tsx:168-173 '#fef3c7'/'#78350f' 등) → 다크모드 깨짐. 기존 토큰(--warning-light 등)·--chart-* 1:1 매핑(의도색 유지), series-c/d 추가. `scripts/check-conventions.mjs` 베이스라인 방식(UTC 날짜·style hex·isAnimationActive·includes("배당")·Date.now id) — hex 정규식은 style/fill/stroke 컨텍스트 한정 | M |
| 5-5 | **useInsightsData 분층** | 958줄 단일 useMemo(deps 11). 골든 스냅샷 테스트 선행 → buildInsightsBase + sliceForMonth. ※'Dashboard 중복 계산' 주장은 틀림(needsBalances가 대시보드 제외 — 유일한 계산) | M |
| 5-6 | **대형 파일 분해(순수 이동만)** | reportGenerator(테스트 보유, 저위험) → App.tsx 핸들러 훅(useSyncHandlers/useDataChangeHandlers, 자식 props 불변) → LedgerEntryForm 빌더/LedgerTable 행 → dataService는 1-1 통과 + `git diff --stat` 순수 이동 확인 + **saveDataSerialized 쓰기 순서 불변** 조건에서 최후 | L |
| 5-7 | **Gist 복귀 시 원격 확인** | visibilitychange:visible에 getGistVersions(1) 경량 조회 → 새 커밋이면 pull/충돌 경로. 자동 적립만으로 dirty가 잦아 **1-7 이후**에 | S |
| 5-8 | **환율 backfill + 프록시 상태 카드** | 180일 결번만 append(기존 값 불변), **과거 TWR/양도세 숫자가 소급 변동함을 고지**, Gist payload 변동(기기당 1회 충돌 가능). 2차 환율 소스(ECB)는 표시용만·적립 금지. fetchViaProxies 6곳 단일화 + 프록시 성공/실패 표시 | M |
| 보류 | 앱 잠금 · OS 알림(Android 페이지 Notification 미지원, periodicSync 비보장) · 위젯 순서(의도 제거) · 검색 확장/명령 팔레트 · AI 비서(all-or-nothing, 집계는 이미 인사이트가 제공, 프라이버시 토글 기본 off) | |

---

## 실행 순서 제안

| 스프린트 | 내용 | 기준 |
|---|---|---|
| **S0 지혈** | Phase 0 전부(10건, 각 S) | 버그이고 전부 none — 어떤 순서로도 안전 |
| **S1 안전망** | 1-2(테스트 CI) → 1-1(계약 테스트) → 1-3(마이그레이션 스냅샷/diff) → 1-4·1-5(백업 IDB·용량) → 1-6(게이트 모달) → 1-7(시계열 병합) → 1-8·1-9·1-10 | 이후 모든 필드 추가·v13의 전제 |
| **S2 입력** | 2-1 → 2-2 → 2-3·2-4·2-5·2-6·2-7 → 2-9 → 2-8 | 매일 체감, 전부 저장 형태 불변 |
| **S3 어드바이저 1** | 3-1 → 3-2 → 3-3 → 3-4 → 3-5 → 3-6 | 가계부가 처음으로 '앞으로'를 말함 |
| **S4 투자 꼬리** | 4-1 → 0-4/4-6 → 4-2 → 4-3 → 4-4 → 4-5 | 로드맵 B2·B4·G2 완결 |
| **S5 어드바이저 2 + UX** | 3-7 → 3-8 → 3-11(넛지) → 3-9 → 3-10 → 5-1 → 5-2·5-3 | new-field는 1-1 계약 테스트가 받쳐줌 |
| **S6 구조·임포트** | 5-4 → 5-5 → 5-6 → 2-10(확인 후) → 5-7·5-8 | 천장 올리기 |
| **v13 스키마 승격**(ledger-plan P3) | 1-3 리플레이 하네스 + 1-11 schemaVersion 메타 + 1-8 demote 테스트가 전부 그린인 상태에서만 | 유일한 migration 등급 작업 |

각 스프린트 끝: lint + test + knip + build, 금액·날짜경계·스키마 왕복 회귀 테스트(CLAUDE.md). 미커밋 작업(IncomeSummarySection 월별 배당 차트)은 먼저 커밋.

---

## 사용자 결정이 필요한 것

1. **CSV/명세 임포트 재도입**(2-10) — 2025-12 정리 커밋에서 딸려 삭제된 것으로 보이나 의도였다면 보류.
2. **섹터 수동 태그 재도입**(4-5 2단계) — 야후 섹터는 신뢰도 문제로 제거한 결정이 있음.
3. **모바일 실사용 비중** — 5-2 하단 탭바·LI-7 입력 시트·5-3 뒤로가기의 우선순위가 여기에 달림.
4. **AI 비서 착수 여부** — 로드맵 '선택' 항목, 유료 키·브라우저 직접 호출·all-or-nothing.
5. **세전 환산 토글 기본값**(0-4) — 입금액이 세후인지 확인.

---

## 부록 A — 후보 전체 판정표 (57건)

| ID | 후보 | 판정 | 보정 impact | dataImpact | 플랜 |
|---|---|---|---|---|---|
| DS-1 | AppData 키 전수 대조 테스트 | confirmed | 4 | none | 1-1 |
| DS-2 | 마이그레이션 직전 스냅샷+diff+롤백 | risky(롤백·휴리스틱) | 4 | none | 1-3 수정안 |
| DS-3 | 불변식 검사기 게이트 실행 | partially-exists | 3 | read-only | 1-10 축소 |
| DS-4 | 용량 대시보드+죽은 키+백업 user-only | overstated(산수) | 3 | none | 0-5·1-4·1-5 |
| DS-5 | payload schemaVersion 메타 | risky(해시 계약) | 3 | new-field(메타) | 1-11 수정안 |
| DS-6 | 마이그레이션 모듈화+리플레이 | overstated | 2 | none | 1-3 하네스만 |
| DS-7 | 적용 게이트 diff 모달 | confirmed | 3 | none | 1-6 |
| DS-8 | 직전 1슬롯 DATA_PREV | overstated | 2 | none | 1-4로 대체 |
| DS-missed | BACKUPS IDB 이전 / sanitize 원본 보존 / BACKUPS 손상 보존 | — | — | none | 1-4·0-9·0-10 |
| LI-1 | 설명 자동완성+자동 채움 | confirmed | 4 | read-only | 2-2 |
| LI-2 | 은행·카드 CSV 임포트 | confirmed(삭제 이력) | 3 | none | 2-10 |
| LI-3 | 제출 시 중복 경고 | confirmed | 2 | none | 2-7 비차단 |
| LI-4 | 최근 거래 칩+lastUsed | confirmed | 3 | none | 2-5 |
| LI-5 | 폼 드래프트 보존 | confirmed | 3 | none | 2-4 |
| LI-6 | 금액 계산식 | confirmed | 2 | none | 2-6 |
| LI-7 | 모바일 입력 시트 | **risky**(3번째 저장 경로) | 3 | none | 보류 |
| LI-8 | 반복 배지 원클릭 | overstated(클로저) | 2 | none | 2-9 |
| LI-9 | 일괄 편집 | confirmed | 3 | none | 2-8 |
| LI-missed | QuickEntry detailCategory / 날짜 칩 / CSV 삭제 이력 | — | — | none | 2-1·2-3 |
| CF-1 | 통합 현금흐름 | confirmed | 4 | none | 3-5 |
| BG-1 | 예산 페이스 | confirmed | 3 | none | 3-1 |
| FX-1(LA) | 고정비 3분해 | confirmed | 3 | none→field | 3-3 |
| RV-1 | 월간 리뷰 | partially-exists | 3 | read-only | 3-6 |
| GL-1(LA) | 목표 ETA+저축 목표 | confirmed | 4 | new-field | 3-2·3-7 |
| FIRE-1 | FIRE 투영 | confirmed | 4 | none | 3-9 |
| SUB-1 | 구독 감지 | confirmed | 3 | none | 3-8 |
| BG-2 | 예산 이월/연간 | confirmed | 2 | field | 후순위 |
| TX-1(LA) | 연말정산 | confirmed('card') | 3 | none | 3-10 |
| LA-missed | 카드 청구 예정액 / 정기 수입 저장소 / KST·forecast 버그 | — | — | none | 3-4·0-3 |
| AX-1 | 배분 X-ray | partially-exists(섹터 제거 이력) | 3 | new-field(2단계) | 4-5 1단계 |
| TX-1(IV) | ISA/연금 한도 | confirmed(화이트리스트) | 4 | field | 4-1 |
| TX-2 | 절세 액션 카드 | confirmed | 3 | none | 4-2 |
| DV-1 | 종합과세 선행배당 투영 | confirmed | 2 | none | 4-6 |
| DV-2 | 배당락 D-day+YoY | overstated | 2 | read-only | YoY만 후순위 |
| FX-1(IV) | 환율 밴드 | confirmed(심볼) | 3 | read-only | 4-3 |
| DB-1 | 조기상환 시뮬 | confirmed(LoanForm) | 3 | read-only | 4-4 |
| PF-1 | 기여도 분해 | partially-exists | 2 | read-only | 후순위 |
| GL-1(IV) | FIRE/크로스오버 | confirmed | 3 | new-field | 3-9 |
| IM-1 | 증권사 거래 임포트 | **risky**(usdBalance 델타) | 2 | none | 최후순위 |
| IV-missed | 세전 환산 gross-up / 죽은 설정 UI | — | — | none | 0-4·0-8 |
| AR-1 | vitest 환경 분리→CI | confirmed(실측) | 4 | none | 1-2 |
| AR-2 | 패리티+마이그레이션 테스트 | confirmed | 4 | none | 1-1·1-3 |
| AR-3 | 컨벤션 grep 게이트 | confirmed | 2 | none | 5-4 |
| AR-4 | 인사이트 hex 스윕 | confirmed(규모 더 큼) | 3 | none | 5-4 |
| AR-5 | useInsightsData 분층 | overstated(중복 아님) | 2 | none | 5-5 |
| AR-6 | 대형 파일 분해 | confirmed | 2 | none | 5-6 |
| AR-7 | 테스트 0건 모듈 | confirmed | 3 | none | 1-8 |
| AR-8 | 오류 리포팅 | confirmed | 2 | none | 1-9 |
| AR-missed | 스키마 마커 되감기 / Gist schemaVersion | — | — | none | 0-6·1-11 |
| UX-1 | 알림 센터 | confirmed | 4 | none | 3-11 |
| UX-2 | 블러+앱 잠금 | overstated(잠금) | 3 | none | 5-1 블러만 |
| UX-3 | 하단 탭바+FAB+드로어 a11y | confirmed | 3 | none | 0-7·5-2 |
| UX-4 | 위젯 순서 | overstated(의도 제거) | 2 | none | 보류 |
| UX-5 | 검색 확장 | confirmed | 2 | none | 보류 |
| UX-6 | hex+a11y 잔여 | partially-exists | 3 | none | 0-7·5-4 |
| UX-7 | 매니페스트·딥링크 | confirmed | 3 | none | 5-3 |
| UX-8 | SW 로컬 알림 | overstated(기술 전제) | 2 | none | 보류 |
| UX-missed | autoUpdate 강제 리로드 / 뒤로가기 / 마지막 탭 | — | — | none | 0-2·5-3 |
| IMP-1 | 명세 임포트 | **risky**(kind 매핑) | 4 | none | 2-10 축소 |
| IMP-2 | 카드 문자 파서 | overstated | 4 | none | 보류 |
| IMP-3 | 거래 임포트 | **risky** | 3 | none | 최후순위 |
| AUTO-1 | 폼 추천 배선 | confirmed(선행) | 4 | none | 2-1·2-2 |
| AUTO-2 | 환율 backfill·2차 소스 | overstated(영향 과소) | 3 | none(적립) | 5-8 |
| AUTO-3 | 미기록 배당 감지 | overstated | 3 | none | 후순위 |
| AUTO-4 | 반복 배지 원클릭 | confirmed | 3 | none | 2-9 |
| AUTO-5 | Gist 복귀 확인 | confirmed | 3 | none | 5-7 |
| AI-1 | AI 비서 | overstated | 2 | none | 보류 |
| AU-missed | 환율 stale 박제 / 시계열 union 병합 | — | — | none | 0-1·1-7 |

## 부록 B — 검증에서 바로잡힌 사실 (다음 세션이 같은 실수를 안 하도록)

- 무결성 검사는 설정 탭 진입 시 이미 자동 실행·배지 표시(App.tsx:452-470) — "버튼 눌러야만"은 오류.
- `Account.id`는 내부 ID가 아니라 사용자가 직접 입력·편집하는 '계좌 ID'(AccountForm.tsx:75) — 폼의 `{a.id}` 표기는 의도.
- AccountType은 `'card'`이지 `'credit'`이 아님(types.ts:3).
- DashboardPage의 computeAccountBalances는 워커와 중복이 아니라 유일한 계산(App.tsx:440 needsBalances가 대시보드 제외).
- 버전 키 부재 경로는 saveDataSerialized(:978)·useBackup(:153)이 매 저장마다 기록해 실질 발생 불가 — 이를 위한 휴리스틱은 오히려 손상 경로.
- Gist/GitVersionModal은 modalStack+ESC가 이미 있음(focus trap만 없음), StocksPage:726은 Suspense 폴백.
- Android Chrome은 페이지 컨텍스트 `new Notification()` 미지원(TypeError) — SW showNotification만.
- 반복지출 생성기·dedup은 utils가 아니라 RecurringListSection 컴포넌트 내부 클로저.
