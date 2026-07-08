# 필터 기능 전수 점검 — 2026-06-29

> **실행 상태(2026-06-29 갱신)**: Tier 1·2·3 거의 전부 적용 완료. 검증 = tsc·eslint·knip 클린, 757 테스트 통과, prod build OK.
> 적용 요약은 문서 맨 아래 [## 실행 결과](#실행-결과) 참조.


가계부·주식·계좌·배당/이자·부채·인사이트·운동·전역검색의 모든 필터 UI/로직을 4개 영역으로 나눠 병렬 점검한 결과. 검증(✅)은 직접 grep/read로 사실 확인한 항목.

분류: 🔴 버그/정합성 · 🟠 불일치 · 🟡 UX · 🟢 기능누락 · 🔵 코드구조

---

## 헤드라인

1. **가계부 필터 4종이 "죽은 상태"** ✅ — 금액범위·태그·날짜범위·단일계좌(출금OR입금) 필터는 state + 활성칩 표시 + clearAll 배선이 다 있는데 **켜는 입력 UI가 없다**. 셋다 `undefined/null/{}/""`(초기화)로만 호출됨.
2. **공유 필터 프리미티브 부재** — 칩/필터 스타일이 6종, "선택 없음" 표현이 3종(`undefined`/`null`/`""`), 한 파일(LedgerPage) 안에서도 혼용.
3. **단일 소스 우회** ✅ — 배당 판별이 `includes("배당")`(categoryMatch 우회), 이자 판별이 subCategory 미검사, "재테크" 옵션 추출과 매처가 서로 다른 정의.

---

## Tier 1 — 버그·정합성 (먼저)

### A. 가계부: 도달 불가 필터 4종 ✅ 🔴🔵
- **위치**: [LedgerPage.tsx:115-118](src/pages/LedgerPage.tsx#L115), [LedgerFilterBar.tsx](src/features/ledger/LedgerFilterBar.tsx) 전체
- `setFilterAmountMin/Max`, `setFilterTagsInput`, `setDateFilter`(값으로), `setFilterAccountId`는 코드 전체에서 **초기화 호출만** 존재. FilterBar는 대/중/소·출금/입금 5개 칩 row만 렌더 → 금액범위·태그·날짜범위·단일계좌 필터는 활성화 경로가 없음.
- **결정 필요**: (a) 입력 UI를 붙여 살린다 vs (b) state·prop·칩 코드 삭제. 둘 중 하나로 정리해야 함(현재는 양쪽 미들).

### B. 가계부: 활성필터 칩이 두 군데서 따로 구현 → 불일치 🟠
- **위치**: [LedgerSummarySection.tsx:256-364](src/features/ledger/LedgerSummarySection.tsx#L256)(클릭 제거 칩) vs [LedgerFilterCard.tsx:69-82](src/features/ledger/LedgerFilterCard.tsx#L69)(카운트 배지용 activeChips 재구성)
- FilterCard는 `searchQuery`·`filterAccountId` 칩 포함, SummarySection은 둘 다 미표시. `hasFilter`가 searchQuery만으로 true가 되는데 요약바엔 해당 칩이 안 보임.
- **수정**: 활성필터 산출을 단일 소스로.

### C. 가계부: 테이블 리마운트 키가 필터 5개 누락 🟠
- **위치**: [LedgerPage.tsx:540-566](src/pages/LedgerPage.tsx#L540)
- `ledgerScrollKey`에 `filterDetailCategory`, `filterAmountMin/Max`, `filterAccountId`, `searchQuery` 빠짐 → 리마운트 부수효과가 필터별로 불균일.

### D. 가계부: `hasCategoryFilter`가 `filterDetailCategory` 누락 🔴
- **위치**: [LedgerPage.tsx:730](src/pages/LedgerPage.tsx#L730)
- 소분류만 활성일 때 `hasFilter`가 false → 요약바 숨김 + 요약 라벨이 "전체"로 오표기.

### E. 가계부: `clearAllFilters`가 폼 상태를 건드림 (불변식 위반) 🟠
- **위치**: [LedgerPage.tsx:193-208](src/pages/LedgerPage.tsx#L193) — `ledgerFormRef.patchForm(...)` 호출
- 파일 헤더 주석 "폼과 필터는 완전히 독립"과 모순. 초기화 클릭 시 작성 중 폼 카테고리/계좌가 지워짐.

### F. 배당/이자: 단일 소스(categoryMatch) 우회 ✅ 🔴
- **위치**: [IncomeRecordsSection.tsx:22](src/features/dividends/IncomeRecordsSection.tsx#L22), [DividendsPage.tsx:260](src/pages/DividendsPage.tsx#L260) — `r.source.includes("배당")`
- **위치**: [DividendsPage.tsx:227](src/pages/DividendsPage.tsx#L227) — `isInterest`가 `category`만 검사, `subCategory` 무시 → 현행 스키마(category="수입"+subCategory="이자") 이자가 **배당표로 노출**.
- **수정**: `isInterestEntry`/`categoryMatch` 단일 진입점 사용. 술어를 한 곳으로(현재 2파일 중복).

### G. 가계부: "재테크" 옵션 추출 ≠ 매처 🔴
- **위치**: [LedgerFilterBar.tsx:106-110](src/features/ledger/LedgerFilterBar.tsx#L106)(distinct `l.category`) vs [LedgerPage.tsx:296-301](src/pages/LedgerPage.tsx#L296)(`isInvestmentKind` 광의)
- 현행 스키마(transfer/저축이체)만 있으면 "재테크" 칩 자체가 안 뜨는데, 떠도 sub/detail 매칭이 transfer엔 일관되지 않음. 옵션과 매칭을 같은 분류 헬퍼로.

### H. 주식: 거래 통화요약이 행 표시와 다른 기준 ✅ 🔴
- **위치**: [TradeHistorySection.tsx:543](src/features/stocks/TradeHistorySection.tsx#L543) — 요약은 `isUSDStock(t.ticker)`만, 행은 `inferTradeCurrency`(L38)
- isUSDStock이 못 잡는 USD 거래(fxRateAtTrade/price.currency로만 USD)는 행엔 USD인데 **KRW 합계로 합산**됨. 요약 루프도 `inferTradeCurrency`로 통일하고 `useMemo`화.

### I. 계좌: 거래내역 모달 USD 합계 vs 잔액 불일치 🔴
- **위치**: [TransactionHistoryModal.tsx:143-149](src/features/accounts/sections/TransactionHistoryModal.tsx#L143) vs `:104-110`
- 환율 미로드 시 USD 행이 잔액 계산엔 제외되지만 inflow/outflow 요약엔 raw USD가 KRW로 합산됨. 동일 가드 적용.

### J. 부채: `daysBetween`가 ISO를 UTC로 파싱 (KST 위반) 🔴
- **위치**: [LoanCardsSection.tsx:16-20](src/features/debt/LoanCardsSection.tsx#L16) — `new Date("YYYY-MM-DD")`
- 만기/잔여기간이 KST 자정 경계에서 ±1일. `parseIsoLocal`(debtShared) 사용.

### K. (잠재) 가계부 금액필터가 USD를 원화로 환산 안 함 🔴
- **위치**: [LedgerPage.tsx:327-332](src/pages/LedgerPage.tsx#L327) — `l.amount` raw 비교
- A에서 UI를 살릴 경우 USD 항목 오필터. `toKrwByRate`로 환산 후 비교. (지금은 A 때문에 잠재.)

---

## Tier 2 — 코드구조 / 공유 프리미티브

### L. 공유 FilterChip 프리미티브 부재 🔵🟠
필터 컨트롤 스타일 6종, 재사용 컴포넌트 없음(LedgerFilterBar의 `ChipRow`만 사실상 표준이나 미export):

| 스타일 | 예시 | 활성 방식 |
|---|---|---|
| A 인라인 pill(radius16, --primary-light) | [LedgerFilterBar.tsx:40-46](src/features/ledger/LedgerFilterBar.tsx#L40) | inline style |
| B primary/secondary 버튼칩 | [TradeHistorySection.tsx:568-585](src/features/stocks/TradeHistorySection.tsx#L568) | CSS class |
| C 기간 서브탭 버튼 | InvestmentRecordCard.tsx:226 | inline |
| D 2-state 토글(원화/USD) | SearchModal.tsx:144, DividendFormSection.tsx:453 | CSS class |
| E 네이티브 `<select>` | SpendingCalendarCard.tsx:237, DayWorkoutEditor.tsx:105/187 | DOM value |
| F 비활성 운동 pill(필터처럼 보이나 클릭X) | MonthStats.tsx:37-44 | 없음 |

**권장**: `ChipRow`→`components/ui/FilterChipRow`로 승격, "선택없음"을 `string|undefined` 단일 컨벤션으로 통일. 어댑터: 주식 계좌칩, SpendingCalendar select, Reports 기간탭, 신규 운동 부위필터.

### M. "선택 없음" 센티넬 3종 혼용 🔵
- `string|undefined`: LedgerPage 카테고리/계좌 필터들
- `string|null`: [TradeHistorySection.tsx:133](src/features/stocks/TradeHistorySection.tsx#L133) **및** [LedgerPage.tsx:115](src/pages/LedgerPage.tsx#L115)(한 파일 안에서 혼용)
- `""`: filterTagsInput, SpendingCalendar, useSearch.keyword
- 동일 개념을 매번 다른 `clear`/`isActive` 체크로 처리.

### N. 가계부 필터 state 11개 산재 + 과도한 prop-drilling 🔵
- **위치**: [LedgerPage.tsx:109-119](src/pages/LedgerPage.tsx#L109); Summary(~30 props)·FilterCard(~25 props)로 양쪽 전달
- `useLedgerFilters()` 훅(`{filters,setFilter,clearAll,hasFilter,activeChips}`)으로 묶으면 B/C/D 드리프트 근본 제거. 필터 추가 시 현재 ~6곳 수정 필요.

### O. 분류 술어/옵션추출 중복 🔵
- 배당 술어 2파일 중복(F), 카테고리 옵션추출(FilterBar) vs 매칭(Page memo) 분리(G), done-set 필터 운동 5곳 중복([DayWorkoutEditor.tsx:213](src/features/workout/DayWorkoutEditor.tsx#L213) 등).

---

## Tier 3 — 기능 추가

### P. 배당/이자 레코드 필터 전무 🟢
- IncomeRecordsSection은 월별 그룹뿐 — 계좌/종목/연도 필터 없음. `byTicker`([DividendsPage.tsx:268](src/pages/DividendsPage.tsx#L268)) 이미 계산됨 → 칩 필터 시드로.

### Q. 운동 필터 공백 🟢
- ExercisePicker 텍스트 검색 없음 + `total` 카운트가 표시(`recentOnly.slice(0,10)`)보다 큼 — [ExercisePicker.tsx:77](src/features/workout/ExercisePicker.tsx#L77),`:132`.
- MonthStats 부위 pill이 필터처럼 보이나 비활성 — [MonthStats.tsx:36-44](src/features/workout/MonthStats.tsx#L36).
- 전역 검색(Ctrl+K)에 운동 데이터 부재 — [useSearch.ts:62-90](src/hooks/useSearch.ts#L62).

### R. 주식/계좌 필터 공백 🟢
- 매수/매도 side·날짜범위·종목·통화 필터 없음. TransactionHistoryModal·StockDetailModal 거래탭 필터 없음.

### S. 가계부 고급 기능 🟢
- 다중 선택, 저장된 필터 프리셋, 새로고침 후 필터 유지(현재 useState만, viewMode/showFilters는 영속).

### T. 기타 컨벤션 🔵
- ExercisePicker localStorage 키가 STORAGE_KEYS 밖 — [ExercisePicker.tsx:5](src/features/workout/ExercisePicker.tsx#L5).
- 부채: 카드 클릭 필터 + `<select>` 중복(같은 `repaymentFilterDebtId`) — [RepaymentHistorySection.tsx:199-219](src/features/debt/RepaymentHistorySection.tsx#L199).
- FxHistorySection FX 판별이 description 키워드 sniffing — [FxHistorySection.tsx:11-17](src/features/stocks/FxHistorySection.tsx#L11).
- 전역검색 clear-all 버튼 없음(필드별 수동 비우기) — [SearchModal.tsx](src/components/SearchModal.tsx).

---

## 검증 완료 (이슈 아님)
- 부채 대출 매칭(loanId→정확→최장) 정상.
- 인사이트 trend 인덱싱(YYYY-MM/positional, "N월" 라벨 조인 아님) 정상.
- 인사이트 기간필터 KST·partialDay(동기 1~N일) 정상.
- 주식 페이지네이션 리셋(sort+filterAccountId) 정상.
- 배당 USD `toKrwByRate` 환산·`fxRateAtTrade` 보존 정상.

---

## 실행 결과

**Tier 1 — 정합성 버그 (적용)**
- C/D: 리마운트키에 누락 5개 필터 추가, `hasCategoryFilter`에 detailCategory 추가 — [LedgerPage.tsx](src/pages/LedgerPage.tsx)
- G: "재테크" 옵션을 매처(`isInvestmentKind`)와 일치 — [LedgerFilterBar.tsx](src/features/ledger/LedgerFilterBar.tsx) `matchesMain`
- K: 가계부 금액필터 USD `toKrwByRate` 환산 — [LedgerPage.tsx:327](src/pages/LedgerPage.tsx#L327)
- F: 배당/이자 분류 `categoryMatch`(`isInterestEntry`+loose) 단일소스, `source.includes("배당")` 제거 — [DividendsPage.tsx:227](src/pages/DividendsPage.tsx#L227)·[IncomeRecordsSection.tsx](src/features/dividends/IncomeRecordsSection.tsx)
- H: 주식 거래 통화요약 `inferTradeCurrency` 통일 + `useMemo`화 — [TradeHistorySection.tsx](src/features/stocks/TradeHistorySection.tsx)
- I: 계좌 거래내역 모달 USD 요약을 잔액 가드와 일치 — [TransactionHistoryModal.tsx](src/features/accounts/sections/TransactionHistoryModal.tsx)
- J: 부채 `daysBetween` `parseIsoLocal`(KST) — [LoanCardsSection.tsx:16](src/features/debt/LoanCardsSection.tsx#L16)
- **E(clearAll 폼침범)은 버그 아님 — 파일 헤더 주석 "필터 일괄 초기화는 patchForm로 처리"가 의도 설계라 보존.**

**Tier 2 — 구조 (적용)**
- L/M: 공유 [`FilterChipRow`](src/components/ui/FilterChipRow.tsx)(개수 배지 지원) — 가계부·주식·배당이 채택. 센티넬 `string\|undefined`로 통일(주식 `filterAccountId` null→undefined).
- B: 활성필터 칩 단일소스 [`buildLedgerActiveChips`](src/features/ledger/ledgerActiveFilters.ts) — LedgerSummarySection(제거 칩)·LedgerFilterCard(개수·요약)가 같은 배열 소비, 드리프트 제거. LedgerSummarySection prop ~20개 감소.
- N(11 state→useLedgerFilters 훅)은 활성칩 단일소스로 실제 드리프트 버그를 해소했고, 무거운 memo 컴포넌트의 state 소유권 이전(순수 외관·고위험)은 **의도적 생략**.

**Tier 1-A — 죽은 필터 살리기 (적용)**
- 가계부 금액범위·기간·태그 입력 UI 추가(LedgerFilterCard "상세 필터"). 금액은 USD 환산 비교(K). 단일계좌(from-OR-to) 필터는 출금/입금 칩과 중복이라 입력 UI 미추가(descriptor엔 유지).

**Tier 3 — 기능 추가 (적용)**
- P: 배당/이자 레코드 계좌·종목 칩 필터 — [IncomeRecordsSection.tsx](src/features/dividends/IncomeRecordsSection.tsx)
- Q: ExercisePicker 전부위 검색 + 카운트/표시 정합("외 N개" 힌트) — [ExercisePicker.tsx](src/features/workout/ExercisePicker.tsx)
- R: 주식 거래 구분(매수/매도)·종목·기간 필터 + 초기화 + 재정렬 인덱스 정합 — [TradeHistorySection.tsx](src/features/stocks/TradeHistorySection.tsx)

**남은 백로그(미적용)**
- MonthStats 부위 pill 클릭 필터 — 캘린더 일자 하이라이트 연동 필요(비용 과다)로 보류.
- T 잔여: ExercisePicker localStorage 키 STORAGE_KEYS 이동, 부채 중복 필터 컨트롤 정리, FxHistorySection 키워드 sniffing, 전역검색 clear-all/운동 데이터 부재.
- 주식 계좌 카운트맵은 적용(매 렌더 O(N×계좌) 제거).
