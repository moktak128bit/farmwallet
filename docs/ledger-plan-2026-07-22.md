# 가계부 재감사 + 기획 — 2026-07-22

> 축: ①레거시 스키마 청산 ②G1 가계부↔투자 통합. 재감사 3건(스키마 실태 / 집계 정확성 / G1 준비도) 결과를 종합.
> 감사 결과는 전부 코드로 재확인함. 확인 못 한 건은 "미확인"으로 표시.

## 한 줄 진단

투자 쪽은 어드바이저가 됐는데 **가계부는 아직 기록기이고, 그 기록조차 화면마다 다른 숫자를 낸다.**
새 기능보다 **정의 통일**이 먼저다.

---

## ⚠ 전제 정정 — "3세대 부채 청산"은 틀린 프레임

CLAUDE.md는 `cat=지출/sub=대분류/det=소분류`를 "현행", `cat=대분류 직접`을 "레거시"라 적었다.
그러나 `utils/demoteSchema.ts:4-9`의 실측 주석은 정반대다:

| 형태 | demoteSchema의 명명 | 건수 |
|---|---|---|
| `cat="지출" sub="식비" det="시장"` | 옛 구조 (**사용자분 표준**) | **~700건** |
| `cat="식비" sub="시장"` | 새 구조 (**잘못 저장됨**) | **~16건** |

즉 `cat=대분류 직접`은 역사적 부채가 아니라 **폼 개편 중 잘못 저장된 최근 16건**이다.
**진짜 부채는 마이그레이션을 한 번도 거치지 않고 코드 방어로만 버티는 값들이다** — `재테크`·`환전`·`정산`·`신용카드`.

---

## 🔴 즉시 처리 (버그)

### 1. 설정의 "1단계" 버튼이 데이터를 망가뜨린다 — 확인
`utils/demoteSchema.ts:38-41`의 `needsDemote`는 `STANDARD_TOP_CATS`(지출·수입·이체·신용결제·재테크)에 **없는 모든 category를 무차별 강등**한다.

- 🔴 **정산**: `cat="정산"` → `cat="수입", sub="정산"` → `features/dating/SettlementView.tsx:72` 정산 히스토리가 **빈 목록**, `utils/dateAccounting.ts:160`의 `category.includes("정산")` 파트너 입금이 **0원**. 앱은 `SettlementView.tsx:117`에서 지금도 `category:"정산"`을 생산 중.
- 🔴 **환전**: 8곳(`useInsightsData.ts:110,316`, `forecast.ts:40,137`, `anomaly.ts:42`, `insightsTrends.ts:174`, `categoryUtils.ts:57`, `BudgetRecurringView.tsx:81`)이 `cat==="환전"`으로 지출에서 **제외**한다. 강등 후 8곳 전부 놓쳐 **환전이 실제 지출로 계상**된다.
- ✅ **대출상환은 안전**: 강등 결과 `cat="지출", sub="대출상환", det="이자상환"`이 `calculations.ts:456`의 **첫 분기와 정확히 일치**. `isInterestRepayment`도 `det.includes("이자")`로 통과. (감사 오탐을 코드로 정정함)

**조치**: `STANDARD_TOP_CATS`에 `환전`·`정산` 추가(1줄) → 버튼 안전화. 그 다음 v13 승격 논의.
**미확인**: 사용자가 이 버튼을 이미 눌렀는지. 눌렀다면 정산·환전 집계가 이미 어긋나 있음 — **데이터 점검 필요**.

### 2. 인사이트가 USD를 환산하지 않는다 — 확인
`features/insights/useInsightsData.ts` — `fxRate`를 인자로 받지만 `:43,65,67-73,92,103,114`가 전부 `Number(l.amount)` 원본. `fxRate`는 주식(`:210,328,437`)과 `computeMonthlyRealFlows(:76)`에만 전달된다.

재현: 증권계좌로 `$1,000` 투자이체(환율 1,400)
- 대시보드 "재테크" = **1,400,000원** / 인사이트 `pInvest` = **1,000원**
- 파생 오염: `OverviewTab.tsx:476` "근로소득 대비 투자 비율"이 1,400배 축소

### 3. 인사이트의 "지출" 정의가 대시보드와 다르다 — 확인
`useInsightsData.ts:60`이 `l.category !== "재테크"` **문자열 하드코딩** — 단일 소스 `isSavingsExpenseEntry` 미사용.
`:67-69`는 투자손실을 `pExpense`에 **명시적으로 가산**한다.

- `category="저축성지출"`이나 사용자가 `categoryTypes.savings`에 추가한 대분류가 인사이트에선 지출로 계상 → 대시보드와 갈림
- 투자손익 처리가 **확정 정책과 반대** — "투자수익·투자손실은 수입/지출이 아닌 재테크 순집계"(MEMORY 확정)인데 인사이트만 지출/수입에 넣는다

### 4. 전월 비교 기준이 당월과 다르다 — 확인
`useInsightsData.ts:385`(전월)는 `환전`·신용결제만 거르고 **재테크 제외가 통째로 없다**. 당월 `:60`은 재테크를 거른 뒤 투자손실만 재가산.
→ 전월 지출에 레거시 `expense/재테크/저축·투자` 항목이 그대로 포함 → `OverviewTab.tsx:19` 배지가 허위 개선률을 표시.

### 5. "예산 사용액"이 두 벌이고 **서로 다른 방향으로** 틀렸다 — 확인

| | 예산 탭 `BudgetRecurringView.tsx:77-93` | 대시보드 `BudgetAlertWidget.tsx:35-49` |
|---|---|---|
| 재테크·환전 제외 | ✅ `:81` | ❌ |
| 저축성지출 제외 | ✅ `:82` | ❌ |
| 대분류 매칭 | ✅ `expenseMainName` | ❌ `sub‖cat` + **양쪽 키 이중 등록**(`:45-47`) |
| USD 환산 | ❌ `:89,92` 원본 | ✅ `toKrwAmount` |

각자 상대가 가진 것을 빠뜨렸다. → 공용 `computeBudgetUsage` 추출로 한 번에 해소.

---

## 🟠 레거시 스키마 청산 — 재정의된 범위

마이그레이션 코어는 **이미 존재**한다(`demoteSchema.ts` + `MigrationToolsCards.tsx:32-84` UI). 새로 만들 일이 아니라 **안전화 후 v13 승격**이다.

**병목은 `category="재테크"` 단 하나.** 완전 통일을 막는 지점:
`demoteSchema.ts:27`(예외 목록) · `categoryUtils.ts:73,85,96,102`(단일소스 자체가 고정) · `summaryMath.ts:137` · `useInsightsData.ts:68,415` · **`LedgerEntryForm.tsx:52`(지금도 신규 생산 중)**

**단일 소스 우회 20개 파일**이 진짜 위험이다 — 타입 에러도 테스트 실패도 없이 **집계에서 항목만 조용히 사라진다.**
`expenseMainName`을 쓰는 파일이 **전체에서 5개뿐**(`anomaly` `forecast` `BudgetRecurringView` `CategoriesPage` `categoryMerge`).

기타 확인: `INVESTMENT_TRANSFER_SUBS` 복붙 4곳 · `isCreditPayment` 미사용 3곳 · `includes("이자")` substring 매칭 잔존(배당 쪽은 이미 정리됨) · `demoteSchema`/`transportCategoryMigration` **테스트 0건** · 임포트 경로(`dataService.ts:707-709`)가 `schemaVersion` 없는 파일을 v12로 간주해 마이그레이션을 건너뜀.

---

## 🔵 G1 — 가계부↔투자 통합

**이미 있음**: `portfolioHistory.ts:112`(A0 일별 평가액) · `portfolioPerformance.ts:86`(수익률·σ·MDD 파사드, **최대 재사용점**) · `reportGenerator.ts:1474`(월별 통합행 — **과거 절반은 이미 완성**) · `accountTimeline.ts:23`(현재 순자산, 대출 차감 포함) · `savingsRate.ts:70`(월 저축) · `forwardDividends.ts:33`(배당 t0)

**없음**: 장기 투영 엔진 · 인플레이션(전역 grep 0건) · 시나리오 민감도 · 목표 도달일/크로스오버 · 배당 성장률

**일부**: 고정비 산출이 `DividendCoverageCard.tsx:34-94`에 **인라인으로만** 존재 → 순수 모듈 추출 필요. `AppData.targetNetWorthCurve`는 읽는 화면이 없음 — G1 목표 저장소로 재사용 금지.

**이중계상 위험 (설계 계약으로 고정할 것)**
1. 재테크 이체 100만과 `buildDailyNetFlowKRW`의 매수 100만은 **같은 돈** → `netFlow`는 저축액에 절대 가산 금지(TWR 내부 전용)
2. 투자손익을 저축액에 넣으면 수익률 이중 계산 → `isInvestmentPnlEntry` 전량 제외
3. 배당은 반대로 **누락** 방향(valueSeries가 종가만 사용) → `기대수익률 = TWR + 배당수익률`이 현재는 정합. 배당 재투자를 valueSeries에 넣는 순간 뒤집힘
4. 대출 원금상환은 지출이자 자산증가 → 한 번만 셀 것

**5단계**: ①`fireBaseline.ts`(신규 필드 0개) → ②`fixedExpense.ts` 추출 → ③`fireProjection.ts`(순수·테스트 우선) → ④`AppData.firePlan` **배선 6곳**(`types.ts` `dataNormalizers.ts` `dataService.ts:799` `getEmptyData` `tableDataBackup.ts:438` `:582`) → ⑤UI

---

## 권장 실행 순서

- **P0 — 지혈** ✅ 완료(2026-07-22): "버튼 막기"가 아니라 **읽는 쪽을 세대 관용으로** 전환.
  `정산`·`대출`은 정식 대분류이기도 해서(dataService 기본 프리셋) 이름으로 차단 불가 — 강등 결과 자체는
  표준 형태이므로 읽는 쪽이 양쪽을 받으면 이미 눌렀어도 그 자체로 복구된다.
  `isCurrencyExchangeEntry`/`isSettlementEntry` 신설(cat·sub 양쪽), 환전 8곳·정산 2곳 교체.
  대출 판정은 `calculations.hasLoanRepaymentStructure` 단일화(+강등형 2종) — debtShared 중복 구현이 위임.
  ⚠ 잔존 손실: 3단계가 다 찬 항목의 demote는 det가 `[원래소소분류:]` 텍스트로 밀림 — 콘솔 점검 스니펫의
  "강등 마커" 수가 1 이상이면 복원 마이그레이션 필요(마커에 원본 보존됨).
- **P1 — 정의 통일** ✅ 완료(2026-07-22): 버그 2·3·4·5 전부 수정.
  - `useInsightsData`: 전 집계를 `classifyLedgerFlow` + `toKrwAmount`(amt) 기반으로 교체. 투자손익은
    재테크 순액(+수익 −손실), 전월 비교도 동일 기준. mTotalsFor에 amountOf 파라미터 추가.
  - 부수 발견·수정: **인사이트 "대분류"가 `l.category` 키라 표준 700건이 전부 "지출" 한 덩어리였음**
    → expenseMainName 키로 교체, "중분류"는 detailCategory 단계로 한 칸 내림(expSubName 공유 키).
    monthlyCatTrend의 신용결제 미필터(추이 이중계상)도 flowOf로 함께 해소.
  - **`classifyLedgerFlow`에 환전 제외 추가** — 대시보드만 환전을 지출로 세던 역방향 불일치 발견·수정.
  - `utils/budgetUsage.computeBudgetGoalSpent` 신설 — 예산 탭·대시보드 위젯 단일 소스
    (탭은 USD 환산 획득, 위젯은 제외 필터·expenseMainName 매칭 획득. fxRate는 FxRateContext로 —
    App props 시그니처 불변). 회귀 테스트 16개 추가, 829 통과.
- **P2 — 단일 소스 수렴**: 우회 잔여 파일을 `expenseMainName`/`isCreditPayment`/`INVESTMENT_TRANSFER_SUBS`로 모음. 스키마 통일의 **선행 조건**. (P0·P1이 환전·정산·대출·예산·인사이트를 이미 수렴 — 잔여: insightsTrends·insightsPatterns·ledgerMarkdownReport·reportGenerator 복붙 4곳·TopExpensesCard 등)
- **P3 — 스키마**: `LedgerEntryForm.tsx:52` 재테크 생산 차단 → `재테크`를 subCategory 세대로 이전 → demoteSchema v13 승격(+presets 동기화, 임포트 경로, 테스트 신규).
- **P4 — G1**: 위 5단계.

각 단계 끝에 lint+test+knip+build. 금액·날짜경계·스키마 왕복 회귀 테스트 필수(CLAUDE.md).

---

## 미조사 (정직 표기)

`RecurringListSection`(635줄) · 택시/톨 분할 위저드 · `discountAmount` 처리 · 인사이트 개별 탭 5개 내부 · `reportGenerator` 600~1200행 · csv/excel/pdf 내보내기 · `assetSnapshots` 적재 빈도.
`generateCategoryReport`(`reportGenerator.ts:355`)의 신용결제 미필터는 **의심**(소비처 미확인).
