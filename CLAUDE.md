# FarmWallet — Claude 작업 지도

한국어 개인 재무 앱 (가계부·계좌·주식·예산·운동). React 18 + TypeScript + Vite + Zustand + recharts + react-hot-toast.

## 운영 방식 (2026-11-08~, Google Apps Script)

- **원본 = Drive의 "FarmWallet 데이터" 시트**(GAS 웹앱 v7). 기기 localStorage는 원본이 아니라 시트의 캐시다 — 앱을 열면 시트로 덮는다(기기 미저장 편집은 안전 스냅샷 후). Gist·PC 장부 파일은 더 이상 원본이 아니다.
- **v7은 의도된 배포다.** apps-script-poc/의 safe 서버(v5·v6, 기기 장부 보존 설계)는 현재 방침과 다른 실험이므로 다시 배포하지 않는다.
- **GAS 프로젝트는 `gas/`에서 관리한다**(gas/README.md). 서버 `Code.js`는 여기가 소스. `Seed.html`(실장부)·`Config.js`·`.clasp.json`·`index.html`은 gitignore — 공개 저장소라 절대 커밋 금지.
- **화면은 `npm run build:gas`로 `src/`에서 빌드**(2026-11-09 v7 번들에서 GAS 계층을 `src/`로 역복원 — 목록은 gas/README.md). GAS 전용 분기는 `services/gas.ts`의 `isGas()` 한 곳으로만 가른다. push·배포 전에는 scratch에 `clasp pull`해 운영이 gas/와 같은지 확인하고, 배포는 기존 웹앱 배포 ID를 새 버전으로 갱신(URL 유지).
- 서버 `saveData`는 revision을 검증하지 않는다(앱이 저장 직전 시트 최신 시각만 비교). 두 기기 동시 저장은 늦은 쪽이 이긴다.
- 기기 화면의 데이터·Gist만 보고 장부 상태를 판단하지 말 것 — 시트 `_meta`(revision·updatedAt·ledgerCount)가 기준.

## 명령어

```
npm run dev          # 개발 서버 (predev: check-text + kr-names 생성)
npm run lint         # tsc --noEmit + eslint src/
npm test             # vitest run (src/__tests__/)
npm run ci           # check-text + lint + build + smoke
npm run knip         # 미사용 파일/export 검사 (클린 상태 유지할 것)
```

## 아키텍처 한 장

### 스크린샷 거래 입력 완료 기준

흐름: 사용자가 GAS 웹앱 **설정 → 사진 올리기**로 토스·카톡 캡처를 올린다(Drive 사진 폴더의 날짜별 폴더) → 나중에 Claude에게 입력을 맡긴다.

1. Drive 사진 폴더에서 **미처리** 사진만 읽는다.
2. **시트의 최신 장부**(`_meta` revision 포함)를 먼저 읽고 중복·취소·계좌 매핑을 확인한 거래를 만든다. 금액·계좌가 불확실하면 추정하지 말고 묻는다.
3. **변경분 파일**(`farmwallet-delta-v1`, utils/ledgerDelta.ts)을 만든다: `{format, ledger:{add,update,remove}, trades:{add,remove}, accounts:{patch}, sourcePhotos:[Drive 사진 파일 이름]}`. id는 `newIdWithPrefix` 규칙과 같은 형식. 사용자가 **설정 → 백업 / 복원 → 가계부 파일 불러오기**로 적용(미리보기 확인)하면 자동 동기화가 시트에 저장하고 sourcePhotos가 처리 완료로 옮겨진다. **Claude가 직접 반영할 때(기본)**: `gas/Inbox.html`(gitignore, `[{id,title,delta}]`)에 넣고 `npm run build:gas` 후 clasp push·새 버전 배포 → 앱이 열릴 때 시트 채택 뒤 자동 적용(hooks/useGasInbox, 안전 스냅샷)·자동 저장, 다음 열기에서 시트에 다 들어간 게 확인되면 서버가 적용 완료로 기억(pendingDeltas/markDeltaApplied). 사용자가 채팅에 스크린샷을 직접 붙이면 sourcePhotos는 비운다. `_data`/`_meta` 셀을 Sheets API로 직접 쓰지 않는다(잠금·보기용 탭·일일 백업 우회).
4. 적용 후 시트를 **다시 읽어** 추가 건수·revision 증가·기존 건수 보존을 확인한다(Drive 접근이 없으면 사용자 화면의 적용 결과 토스트 "추가 N · 건너뜀 M"으로 확인).

파일 작성이나 JSON 준비만으로 완료 처리하지 않는다. 인증정보·폴더/스크립트 ID는 코드·장부·로그·이 저장소(공개)에 넣지 않는다. (`npm run ledger:sync`의 Gist 경로는 이전 방식 — 원본이 아니므로 쓰지 않는다.)

```
main.tsx → App.tsx (탭 셸·전역 모달·콜백 허브, 자식 props 시그니처 바꾸지 말 것)
  데이터:  AppData(types.ts) → useAppStore(store/appStore.ts, zustand)
  저장:    services/dataService.ts  loadData()/saveData() — 스키마 v12 마이그레이션 포함
           ⚠ AppData에 필드 추가 시 loadData()의 parsedData 구성에도 반드시 추가 (누락=영구 유실)
           ⚠ utils/tableDataBackup.ts(테이블 백업)에도 같은 필드 추가
  자동저장: hooks/useBackup.ts — 500ms 디바운스, 드래프트 슬롯(크래시 복구), loadFailed 중 차단
  백업:    services/backupService.ts — 일별 5개×4일 보존, 위험 작업 전 saveSafetySnapshot() 필수
  동기화:  services/gistSync.ts + hooks/useGistSync.ts (충돌 모달), services/tabSync.ts (멀티탭)
  키:      constants/config.ts STORAGE_KEYS — localStorage 키는 반드시 여기 상수로
  워커:    workers/portfolioWorker.ts·reportWorker.ts (requestId로 stale 응답 폐기)
```

탭 12개(constants/tabs.ts): dashboard·accounts·ledger·stocks·insights·dividends·debt·budget·workout·categories·reports·settings → `pages/XxxPage.tsx` + `features/<탭>/` 에 1:1 대응.

## 기능 → 파일

| 기능 | 위치 | 비고 |
|---|---|---|
| 가계부 | pages/LedgerPage + features/ledger/ | 폼 검증 validateLedgerForm.ts, 주식거래 가상 행은 `_tradeId`로 식별 |
| 계좌 | pages/AccountsPage + features/accounts/sections/ | 잔액 계산은 calculations.ts(computeAccountBalances) |
| 부채 | pages/DebtPage + features/debt/ | 상환 매칭: description↔loanName (정확>최장 일치) |
| 주식 | pages/StocksPage + features/stocks/ | 시세 useQuoteRefresh, USD 판정 finance.ts isUSDStock(1~5자 영문) |
| 배당/이자 | pages/DividendsPage + features/dividends/ | 배당율은 **KRW 원가(totalBuyAmountKRW)** 기준 |
| 예산/반복 | features/budget/ + utils/recurringAlert.ts | 반복 생성은 generateOccurrencesForMonthFromRecurring 단일 경로 |
| 인사이트 | pages/InsightsPage + features/insights/ (탭 9개) | 데이터 허브 useInsightsData.ts, 내부 조인은 YYYY-MM 키(라벨 "N월" 금지) |
| 보고서 | pages/ReportPage + features/reports/ + utils/reportGenerator.ts | 내보내기 reportExport/csvExport/excelExport/pdfExport |
| 운동 | pages/WorkoutPage + features/workout/ | 통계 utils/workoutStats.ts — done=true 세트만 집계 |
| 설정/백업 | pages/SettingsPage + features/settings/ | 위젯 숨김 features/dashboard/dashboardWidgets.ts |
| 검색 | components/SearchModal + hooks/useSearch | Ctrl+K |
| 데이트 정산 | features/dating/SettlementView + utils/dateAccounting.ts | 정산 입금 = kind:"income"+toAccountId |

## 분류 단일 소스 (집계 수정 시 여기만)

- **utils/categoryUtils.ts** — `isCreditPayment`(레거시 신용결제 이중계상 방지), `isSavingsExpenseEntry`(저축성지출). 모든 지출 집계는 이 둘을 먼저 거른다. 순서 주의: isSavingsExpenseEntry를 `cat==="재테크"` 분기보다 먼저.
- **features/dashboard/summaryMath.ts** — `classifyLedgerFlow`/`toKrw`/`isWealthBuildingEntry`("재테크"=저축·투자이체 transfer + 레거시 저축성지출). 대시보드 카드 간 수치는 반드시 이 헬퍼로 통일.
- **utils/categoryMatch.ts** — 배당/이자 판정 단일 진입점 (`includes("배당")` 직접 사용 금지).
- **calculations.ts computeBalanceSheet** — 총자산·총부채·순자산·유동자산의 단일 소스 (계좌 탭·대시보드·인사이트·부채 탭 공용, 표시는 components/BalanceSheetStrip). 계좌 순가치 부호로 자산/부채를 가르므로 마이너스 통장·카드 부채는 부채, 자산에 음수 없음. 카드 "지금 갚을 돈"은 `computeCardDebts`(잔액 엔진 기준 — ledger 재스캔 금지). 총자산=빚 빼기 전, 순자산=뺀 후 — 두 이름을 섞어 쓰지 말 것.

## 필수 컨벤션

1. **날짜는 KST**: `getTodayKST()`/`getThisMonthKST()`/`parseIsoLocal()`/`formatIsoLocal()` (utils/date.ts). `new Date().toISOString().slice(0,10)`(UTC)와 `new Date("YYYY-MM-DD")`(UTC 파싱) **금지**. 월 가산은 말일 클램프.
2. **스타일**: Tailwind 없음. 인라인 스타일 + styles.css CSS 변수. 다크모드 = `:root.dark`가 변수 덮어쓰기 → **인라인 hex/rgb 하드코딩 금지**. 틴트 배경: `--danger-light`/`--warning-light`/`--accent-light`/`--warning-bg`/`--primary-light`.
3. **recharts**: 모든 시리즈에 `isAnimationActive={false}` (사용자가 차트 애니메이션 싫어함). 기본 툴팁 다크 대응은 styles.css에 있음.
4. **색 의미**(국내 관례): 수입/상승/이익/매수 = 빨강(`--chart-income`,`--danger`), 지출/하락/손실/매도 = 파랑(`--chart-expense`,`--accent`). 상태 좋음/나쁨 = `--success`/`--danger`.
5. **USD**: 항목에 `currency:"USD"` 표기, **합산 시 반드시 toKrw 환산**(FxRateContext 환율). 환율 미로드 시 USD 입력 저장 차단.
6. **id**: utils/id.ts `newIdWithPrefix("L"|"T"|...)`. `Date.now()` 직접 조합 금지.
7. **모달**: `useFocusTrap` + `useModalStackEntry`(utils/modalStack.ts — 최상위만 ESC) + `role="dialog"`/`aria-modal`.
8. **삭제**: confirm + `showDeleteUndoToast`(utils/undoToast.tsx, restore-by-id) 패턴.
9. **위험 작업**(복원·초기화·가져오기·일괄 변경): `window.confirm` + 직전 `saveSafetySnapshot()`.
10. **단축키 계약**: Ctrl+S=저장(로컬 백업+Gist, 헤더 [저장]과 동일), Ctrl+Enter=가계부 폼 제출, Alt+N=새 항목, Ctrl+K=검색, Ctrl+Shift+K=빠른 입력, Alt+←/→=탭. 전역 등록은 utils/shortcuts.ts(shortcutManager) + hooks/useKeyboardShortcuts.ts — 입력 필드 포커스 중 오발동 가드 유지. window keydown 리스너 직접 추가 금지(중복 발화 이력 있음).
11. **텍스트 입력 + undo**: 글자마다 setDataWithHistory 금지 — blur 커밋(components/ui/CommitInput.tsx) 사용.
12. **부호 있는 금액 입력**: parseAmount는 부호를 버림 → 음수 허용 입력은 parseSignedAmount/sanitizeSignedNumericInput.
13. **진행 중인 달의 비교(MoM 등)**: 완료된 전월 전체와 비교 금지(월급 25일이면 월중 내내 -90%대) — 전월·전년도 **같은 기간(1~오늘 일)**만 합산하고 라벨에 "동기(1~N일)" 명시. compareMonths의 dayCap 옵션, useInsightsData의 partialDay 패턴 참조.
14. **금액 표기**: 히어로/KPI 숫자는 `components/ui/Money.tsx` — 단위 "원"은 `.money-unit`로 한 단계 작게. 잔액·평가액처럼 시세 따라 흔들리는 **스톡**은 `compact`(만·억, `formatKrwCompact`), 이번 달 수입·지출처럼 가계부와 대조하는 **흐름**은 원 단위 그대로. 표·보조 텍스트는 formatKRW 유지.
15. **디자인 규율**: 색은 데이터에만(행 반복 동작은 `.icon-action` 중립 아이콘, hover에서만 빨강 · 헤더 상시 경보 금지) · 본문 이모지 아이콘 금지(lucide 라인 아이콘) · 인라인 글자 크기 바닥 11px(12=캡션, 13=본문) · 대시보드 첫 화면 = `DashboardGlance` 질문 3열(이번 달 얼마 썼나 · 내 자산은 · 투자·배당은 — 기둥마다 큰 숫자 1 + 보조 2~3줄, 기둥 클릭=가계부/계좌/주식 탭) + 확인할 일 칩(미등록 반복지출·카드 갚을 돈·기록 공백 3일+·처리 전 사진), 값은 부모가 `glanceMath`로 1회 계산(상세 카드와 같은 정의), 이번 달 비교 기준일은 마지막 기록일(`ledgerFreshness`), 나머지는 `DashboardSection` 접이식(접힌 줄에 대표 숫자 3개, 순서는 dashboardWidgets.ts와 동기) · 급여 전 판정은 `summaryMath.isBeforePayday` 단일 소스(요약·전월 대비·인사이트 성장률 공용) · 인사이트는 분석만(대시보드 KPI 재노출 금지, 탭 5개) · 가계부 입력 폼은 기본 접힘(`STORAGE_KEYS.LEDGER_FORM_OPEN`, Alt+N·복사 시 자동 펼침). · **표 숫자 열은 th·td 모두 `.number`**(머리글이 값과 같은 오른쪽 정렬 — `.data-table th.number`).

## 레거시 데이터 함정 (사용자 실데이터에 3세대 공존)

- **지출 스키마(현행)**: `category="지출"`, `subCategory=대분류(식비…)`, `detailCategory=소분류`. 레거시: category에 대분류 직접. 집계 시 categoryMerge.ts `expenseMainName` 사용.
- **신용결제**: 레거시 expense(category="신용결제")는 이중계상 → isCreditPayment로 제외. 현행은 transfer(카드결제이체).
- **재테크**: 레거시 expense(category="재테크") vs 현행 transfer(저축이체/투자이체). isWealthBuildingEntry로 통일.
- **대출 이자상환**: 2세대는 subCategory="이자상환", 3세대는 detailCategory — calculations.ts isInterestRepayment가 둘 다 처리.
- **StockTrade.fxRateAtTrade**: 매입 당시 환율 — 편집 시 **보존**(현재 환율로 덮어쓰면 과거 손익 왜곡).
- 스키마 버전 v12 (dataService migrateBySchema). 가져오기는 파일의 schemaVersion 기준 마이그레이션.

## 검수/품질 이력

- docs/feature-audit-2026-06-11.md — 전 기능 검수 결과(~120건, 전부 수정 완료). 유사 작업 시 패턴 참조.
- knip 클린 상태 — 새 export는 실제 사용처와 함께 추가.
- 테스트 42파일 547+개 — 금액 계산·날짜 경계·스키마 왕복은 회귀 테스트 필수.
