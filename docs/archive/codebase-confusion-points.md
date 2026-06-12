# 코드베이스 내 헷갈릴 수 있는 항목 정리

코드베이스에서 네이밍·데이터 정의·타입 중복·데이터 소스·유틸 분산 등으로 인해 혼동되기 쉬운 지점을 정리한 문서입니다. **수정 계획이 아니라 참고용 정리**이며, 리팩터링·문서화·온보딩 시 참고하면 됩니다.

### 코드에서 정리된 항목 (적용 완료)

- **AccountBalanceRow / PositionRow / MonthlyNetWorthRow 중복**: `calculations.ts`에서 로컬 정의 제거, `types.ts`에서만 정의하고 `calculations.ts`는 re-export.
- **balances 전달 불일치**: App에서 LedgerView에도 `balances` 전달하도록 수정.
- **totalBalance(합계 행)**: 변수명을 `sumCurrentBalanceByType`으로 변경, 합계 금액은 `formatKRW` 사용.
- **formatNumber vs formatKRW**: AccountsView의 카드 부채 합계·입출금·저축 합계에 `formatKRW` 사용으로 통일.
- **티커 유틸 중복**: `tickerUtils.ts`는 `finance.ts` re-export + `@deprecated` 주석으로 단일 소스(finance) 유지.

---

## 1. 네이밍 (Naming)

### balance 관련

- **balance / currentBalance / totalBalance / initialBalance / initialCashBalance / usdBalance / krwBalance**
  - `AccountBalanceRow.currentBalance`: ledger+trades 기준 **계산된 현재 잔액**.
  - `Account.usdBalance` / `krwBalance`: 증권 계좌 **수동 입력** USD/KRW 보유.
  - `Account.initialBalance` / `initialCashBalance`: **초기(개설) 잔액** (증권은 `initialCashBalance` 별도).
  - UI/코드에서 "balance"만 쓰면 **계산 잔액 vs 초기 잔액 vs 수동 입력** 구분이 어렵습니다.
  - **참고**: `src/types.ts`, `src/calculations.ts`, `src/components/AccountsView.tsx`

### totalBalance (AccountsView 합계 행) — 정리됨

- **정리**: 변수명을 `sumCurrentBalanceByType`으로 변경함. 해당 유형의 `row.currentBalance` 합계임을 드러냄.
- 이전: `totalBalance` = 해당 유형의 잔액 합계였으나 이름이 "전체 총잔액"처럼 오해될 수 있음.

### account vs accountId

- `account`: `Account` 객체.
- `accountId`: 계좌 id 문자열.
- `LedgerEntry.fromAccountId`/`toAccountId`, `StockTrade.accountId`, `PositionRow.accountId` 등 **id만 쓰는 곳**과 **객체를 쓰는 곳**이 섞여 있어, 같은 이름이 id인지 객체인지 문맥 없이는 헷갈립니다.
- **참고**: LedgerView, StocksView, dataService, reportGenerator 등 전역.

### ledger vs "거래"

- 데이터/타입은 **ledger**(가계부 원장), UI/메시지는 **"거래"**를 많이 사용.
- LedgerView에서 `ledgerTab === "all"`일 때 라벨이 "거래" (`summaryTabLabel`).
- "가계부 항목"과 "거래"를 같은 의미로 쓰는지, ledger만 거래인지(주식 거래 제외) 문맥에 따라 다릅니다.
- **참고**: `src/components/LedgerView.tsx`, DataIntegrityView, AccountsView 등.

### category vs mainCategory vs subCategory

- `LedgerEntry`에는 `category`, `subCategory`만 있음.
- LedgerView 폼/UI는 **mainCategory**를 쓰고, 저장 시 `form.mainCategory` → `entry.category`로 매핑.
- "대분류" = mainCategory = entry.category, "세부" = subCategory 로 혼용됩니다.
- **참고**: `src/types.ts` (LedgerEntry), `src/components/LedgerView.tsx` (form 타입/필드).

### 리포트 타입 vs 화면 이름

- `AccountReport`, `MonthlyReport`, `DailyReport`는 **데이터 행/집계 타입**인데, 탭 이름이 "리포트"(ReportView)라서 "리포트 화면 전체"와 "리포트 한 건 타입"이 이름만으로 구분되기 어렵습니다.
- **참고**: `src/utils/reportGenerator.ts`, `src/components/ReportView.tsx`.

---

## 2. 데이터/상태 (Data / State)

### 잔액의 여러 정의

- **계산 잔액**: `computeAccountBalances()` → `AccountBalanceRow.currentBalance`.
- **기대 잔액(검증용)**: dataIntegrity의 `expectedBalance` = `account.initialBalance + (account.initialCashBalance ?? 0) + (account.cashAdjustment ?? 0)`.
- **리포트용 "초기"**: `AccountReport.initialBalance` = `account.initialBalance + (account.cashAdjustment ?? 0) + (account.initialCashBalance ?? 0)` (합산값).
- 같은 "초기/잔액"이 **계좌 모델 / 검증 / 리포트**에서 서로 다른 식으로 정의됩니다.
- **참고**: `src/utils/dataIntegrity.ts` (122–147행), `src/utils/reportGenerator.ts` (231–254행), `src/types.ts`.

### 단일 데이터 소스 vs 접근 경로

- 실제 소스는 **Zustand `appStore`** 하나.
- 대부분은 **`useAppData()`**로 `data`/`setData` 사용.
- **DashboardView**만 **`useAppStore()`**를 직접 사용하고, props로 `accounts`/`ledger`/`trades`를 선택적으로 받아 store가 없으면 props 사용.
- "데이터는 어디서 오는가"가 뷰마다 다르게 보일 수 있습니다.
- **참고**: `src/hooks/useAppData.ts`, `src/store/appStore.ts`, `src/components/DashboardView.tsx`.

### balances 전달 불일치 — 정리됨

- **정리**: App에서 **LedgerView**에도 **balances**를 전달하도록 수정함. 세 탭(Accounts, Ledger, Stocks) 모두 동일한 balances를 받음.
- **참고**: `src/App.tsx`, `src/components/LedgerView.tsx`, `src/components/stocks/TradeHistorySection.tsx`.

### normalizeImportedData 부수 효과

- 내부에서 **localStorage에 임시 저장** 후 `loadData()`로 다시 읽고, finally에서 이전 값을 복원.
- "정규화 후 AppData 반환"처럼 보이지만, 실제로는 **전역 스토리지를 잠깐 바꾸는 동작**이라 예상과 다를 수 있습니다.
- **참고**: `src/services/dataService.ts` (710–731행).

---

## 3. 타입/상수 중복·다의

### AccountBalanceRow / PositionRow 중복 정의 — 정리됨

- **정리**: 단일 소스는 `src/types.ts`. `src/calculations.ts`에서는 로컬 정의를 제거하고 `types`에서 import 후 re-export만 함.

### AccountReport.initialBalance vs Account.initialBalance

- `Account.initialBalance`: 계좌의 **초기 잔액 필드 하나**.
- `AccountReport.initialBalance`: **합산값** (`account.initialBalance + cashAdjustment + initialCashBalance`).
- 같은 `initialBalance` 이름이 **원시 필드**와 **리포트용 집계값** 두 의미로 쓰입니다.
- **참고**: `src/types.ts` (Account), `src/utils/reportGenerator.ts` (51–52행, 240–248행).

### totalAsset 의미 차이

- **일반(totalAsset)**: 주식+현금+저축 합계 (Report/Daily, AccountsView 등).
- **Settings**: `totalAssetBuyAmount` / `totalAssetEvaluationAmount`는 **다른 개념**(매수금/평가금 설정용).
- **참고**: `src/components/SettingsView.tsx` (60–61행), `src/utils/reportGenerator.ts` (408행), `src/components/AccountsView.tsx` (688행).

---

## 4. 컴포넌트/뷰 구조

### Dashboard 진입점 이중화

- `DashboardView`는 `src/components/DashboardView.tsx`에 있고,
- `src/components/dashboard/index.tsx`는 `export { DashboardView } from "../DashboardView"`만 re-export.
- "대시보드" 코드가 `dashboard/` 폴더와 상위 `DashboardView.tsx` 두 곳에 나뉘어 있어, 진입점을 어디로 볼지 헷갈릴 수 있습니다.

### LedgerView / AccountsView 역할

- **LedgerView**: 이름은 "Ledger View"이지만, 가계부 입력 폼 + 필터/탭 + 테이블 + 계좌별 잔액 표시까지 한 컴포넌트에 포함.
- **AccountsView**: 계좌 목록·편집뿐 아니라 카드 청구/결제, 잔액 역산/조정, 계좌별 거래 내역 모달까지 포함해, "계좌 뷰"라는 이름보다 책임이 큼.

---

## 5. 서비스/유틸

### 티커 유틸 중복 — 정리됨

- **정리**: 구현은 **`src/utils/finance.ts`** 단일 소스. **`src/utils/tickerUtils.ts`**는 `finance`에서 re-export하고 `@deprecated` 주석으로 새 코드는 finance 사용 권장.

### 카테고리 유틸 분산

- `src/utils/category.ts`: `categoryUtils` / `categoryNormalize` / `categoryRecommendation` / `autoCategorization` 등을 re-export하고, `CategoryNormalizer`, `CategoryClassifier` 등 네임스페이스 객체도 export.
- 구현은 `categoryUtils`, `categoryNormalize`, `categoryRecommendation`, `autoCategorization`에 나뉘어 있어, "카테고리 관련은 category에서 가져온다"와 "구현 위치"가 달라 헷갈릴 수 있습니다.

### 데이터 로드/저장 진입점

- `loadData`, `saveData`, `normalizeImportedData`는 **dataService**에서 구현되고, **`src/storage.ts`**에서 re-export.
- `useAppData`는 **storage**의 `loadData`를 사용.
- "데이터 로드/저장의 진짜 진입점이 storage인가 dataService인가"가 한 번에 안 보입니다.

---

## 6. 포맷 함수 사용

### formatNumber vs formatKRW — 정리됨

- **정리**: AccountsView의 **카드 부채 합계**·**입출금·저축 합계**에도 **formatKRW**를 사용하도록 변경함. 금액 표시 포맷 통일.

---

## 요약

| 구분     | 대표 혼동 지점 |
|----------|----------------|
| **네이밍** | balance 용어 다의, account vs accountId, ledger vs 거래, mainCategory vs category. *(totalBalance 합계 행 → sumCurrentBalanceByType으로 정리됨)* |
| **데이터** | 잔액 정의 3종(계산/검증/리포트), useAppData vs useAppStore, normalizeImportedData 부수 효과. *(balances 전달 → LedgerView에도 전달하도록 정리됨)* |
| **타입**   | AccountReport.initialBalance vs Account.initialBalance, totalAsset 의미 차이. *(AccountBalanceRow/PositionRow 중복 → types 단일 정의로 정리됨)* |
| **구조**   | Dashboard 진입점 이중화, LedgerView/AccountsView 과다 책임 |
| **유틸**   | category re-export 분산, storage vs dataService 진입점. *(tickerUtils → finance re-export로 정리됨)* |
| **포맷**   | *(AccountsView 합계 행 formatKRW로 정리됨)* |

이 문서는 **수정 계획이 아니라 "헷갈릴 수 있는 것들" 목록**입니다. 리팩터링·문서화·온보딩 시 위 항목을 참고하면 됩니다.
