# FarmWallet — Claude 작업 지도

한국어 개인 재무 PWA (가계부·계좌·주식·예산·운동). React 18 + TypeScript + Vite + Zustand + recharts + react-hot-toast. **서버 없음** — 모든 데이터는 localStorage(+IndexedDB 캐시), 동기화는 GitHub Gist.

## 명령어

```
npm run dev          # 개발 서버 (predev: check-text + kr-names 생성)
npm run lint         # tsc --noEmit + eslint src/
npm test             # vitest run (src/__tests__/)
npm run ci           # check-text + lint + build + smoke
npm run knip         # 미사용 파일/export 검사 (클린 상태 유지할 것)
```

## 아키텍처 한 장

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
10. **단축키 계약**: Ctrl+S=백업, Ctrl+Enter=가계부 폼 제출, Alt+N=새 항목, Ctrl+K=검색, Ctrl+Shift+K=빠른 입력, Alt+←/→=탭. 전역 등록은 utils/shortcuts.ts(shortcutManager) + hooks/useKeyboardShortcuts.ts — 입력 필드 포커스 중 오발동 가드 유지. window keydown 리스너 직접 추가 금지(중복 발화 이력 있음).
11. **텍스트 입력 + undo**: 글자마다 setDataWithHistory 금지 — blur 커밋(components/ui/CommitInput.tsx) 사용.
12. **부호 있는 금액 입력**: parseAmount는 부호를 버림 → 음수 허용 입력은 parseSignedAmount/sanitizeSignedNumericInput.

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
