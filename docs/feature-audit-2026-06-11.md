# 전체 기능 점검 보고서 (2026-06-11)

> **✅ 2026-06-12: 본 보고서의 전 항목 수정 완료.** 검증: tsc·eslint 클린, vitest 42파일/547테스트 통과, 프로덕션 빌드·스모크 테스트 통과. 설계 선택이 필요했던 항목의 결정 사항은 각 수정 커밋/코드 주석 참조.

8개 영역(가계부 / 계좌·부채 / 대시보드 / 인사이트·예산 / 주식·배당 / 보고서·내보내기 / 설정·백업·동기화 / 운동·검색·공통)을 병렬 검수한 결과.
모든 항목은 실제 코드를 읽고 호출부까지 추적해 확인된 것만 수록. 심각도: **높음**(데이터 유실·손상·잘못된 금액) / **중간**(기능 오동작·눈에 띄는 UX 결함) / **낮음**(폴리시·일관성).

요약: **높음 21건 / 중간 약 45건 / 낮음 약 55건**

---

## 0. 교차 주제 (여러 영역에 반복되는 패턴)

### A. 미정의 CSS 변수 (styles.css에 정의 없음 — 전역 grep으로 확인)
- `--muted` — **앱 전역 40여 곳** 사용 (NetWorthTrendChart, AccountBalanceTrendCard, CmaBalanceTrendCard, InvestmentSummaryCard 다수, SearchModal:135, GistSyncCard:68, reports 다수 등). 보조 텍스트가 본문색으로 렌더. 올바른 변수는 `--text-muted`.
- `--card-bg` — BudgetDashboardSection.tsx:46,160 / RecurringListSection.tsx:301. 폴백 `#1e1e2e`(어두운색) 고정 → **라이트 모드에서 검정 배경 + 검정 글씨**.
- `--warning-bg` — TaxReportSection.tsx:50, GitVersionModal.tsx:113. 다크모드에서 밝은 배경 + 밝은 글씨.
- `--hover-bg` — Autocomplete.tsx:167. 다크모드에서 하이라이트 항목이 **흰 글자 + 흰 배경**.
- `--surface-alt` — CardPaymentSection.tsx:48. `--primary-muted` — RepayLoanModal.tsx:111, RepaymentHistorySection.tsx:174. 배경 투명 렌더.
- `--positive`, `--negative`, `--chart-secondary` — features/reports/* 25곳 (InvestmentRecordCard 활성 탭이 라이트모드에서 흰 글씨/흰 배경, 양·음수 색상 미적용).
- `--danger-light`/`--warning-light`/`--accent-light` — DataIntegrityPage.tsx:353-360. 또 `` `${색}15` `` 패턴은 `var(--danger)15`가 되어 무효 CSS (:405).

### B. UTC 날짜 사용 (`new Date().toISOString().slice(0,10)`) — KST 00:00~08:59에 전날로 기록
`getTodayKST()`(utils/date.ts:18)가 있는데 미사용인 곳:
- QuickEntryModal.tsx:66 (빠른 입력 저장 날짜)
- CardPaymentSection.tsx:30, RepayLoanModal.tsx:42·48·106, EditRepaymentModal.tsx:55, LoanFormSection.tsx:36, LoanCardsSection.tsx:119
- stockHelpers.ts:38, TradeFormSection.tsx:304·537, DividendFormSection.tsx:52·208·286, InterestFormSection.tsx:30·63, FxFormSection.tsx:19·212, StockDetailModal.tsx:51·301
- RecurringFormCard.tsx:20 (반복 시작일 기본값)
- ReportPage.tsx:48·50 (보고서 기본 endDate — **오전 9시 이전에 당일 항목이 보고서 범위에서 빠짐**), buildReportBlocks.ts:70, csvExport.ts:54, ExportToolsCards.tsx:111
- dataIntegrity.ts:186 (오전 9시 이전 '오늘' 항목을 미래 날짜로 오탐)
- BudgetAlertWidget.tsx:16-19 (로컬 타임존 월 키 — 나머지 위젯은 getThisMonthKST)
- InsightsPage.tsx:59-61 (기간 cutoff UTC + setMonth 월말 오버플로)

### C. 신용결제(`isCreditPayment`) 제외 불일치 — 레거시 데이터 보유 시 카드 간 숫자 불일치/이중계상
- monthComparison.ts:27-33 (ExpenseIncomeCompareCard — USD 미환산도 겹침) **[높음]**
- SpendingCalendarCard.tsx:143-159
- reportGenerator.ts:504-509 (generateDailyReport → 정산 보고서로 전파)
- anomaly.ts:34 (신용결제·재테크 미제외 → "주목할 한 가지" 오탐)
- LedgerSummarySection.tsx:108-115 (월별 비교 카드 vs 요약 카드 기준 차이)

### D. USD 금액 무환산 합산
- LedgerPage.tsx:417-429 + LedgerTable.tsx:531 + LedgerSummarySection.tsx:107 — 가계부 요약/일별 소계/선택 합계 **[높음]**
- monthComparison.ts (위 C 항목)
- BudgetAlertWidget.tsx:36-47, SalaryTimerCard.tsx:100-114 (급여 추정)
- useSearch.ts:100-101 (금액 필터)
- DividendFormSection.tsx:247-261 / StockDetailModal.tsx:268-280 (환율 미로드 시 USD 그대로 저장, currency 필드도 없음)

### E. recharts `isAnimationActive={false}` 누락 (사용자 정책: 차트 애니메이션 전부 OFF)
- ExerciseProgressionChart.tsx:65-87 `<Line>`
- PortfolioChartsSection.tsx:96-109, 161-174, 225-239 — Pie 3개
- TargetPortfolioSection.tsx:472-489, 511-528 — Pie 2개
- 그 외 전 영역(대시보드·인사이트·보고서) 전수 확인 — 누락 없음.

### F. 모달 접근성 (ESC 닫기 / 포커스 트랩 / role="dialog" 누락)
- LedgerTemplateManageModal, TransactionHistoryModal(ESC 전혀 없음), RepayLoanModal, EditRepaymentModal, AdjustmentModal(입력 포커스 시에만 ESC), PresetModal, StockDetailModal, ExerciseHistoryModal, ThemeCustomizer(role도 없음), ShortcutsHelp, ReceiptScanner, GistConflictModal, TabConflictModal
- ESC 리스너 중첩: ShortcutsHelp/ConfirmModal/SearchModal 동시 열림 시 ESC 한 번에 모두 닫힘 (모달 스택 처리 없음)

### G. 삭제 확인/실행취소 불일관
- 거래 삭제(TradeHistorySection.tsx:419-456): confirm도 undo도 없이 원클릭 삭제 + usdBalance 보정 즉시 실행
- 대출 삭제(LoanCardsSection.tsx:95-99): confirm만, undo 없음
- 운동 종목 삭제(DayWorkoutEditor.tsx:346-353): 확인·undo 모두 없음 / 날짜 기록 삭제: confirm만
- 계좌 삭제: confirm **2번 중복** + 문구 모순 (AccountTablesSection.tsx:500-512 + 71-99)
- 카테고리 삭제: confirm 2번 중복 (CategoriesPage.tsx:719→725→227)
- TargetPortfolioSection.tsx:165: confirm 없음

---

## 1. 높음 (21건)

### 데이터 유실 위험 (설정·백업·동기화)
1. **dataService.ts:926-958 — `loadData()`가 `dailyBudget` 필드 누락** → 하루 예산 설정이 새로고침마다 영구 유실 (자동저장이 유실 상태를 디스크에 굳힘).
2. **App.tsx:472-484 — 데이터 손상 시 복구 화면이 막다른 길.** "설정 탭으로 이동"이 `setTab`만 호출, `loadFailed`가 안 풀려 화면 그대로 → UI로는 백업 복원 불가.
3. **App.tsx:310-333 — 드래프트 복구 실패 시에도 `finally`가 드래프트 삭제.** 복구 실패 시 유일한 사본 소실.
4. **AppErrorBoundary.tsx:172-179 — 오류 화면 "데이터 초기화" 버튼이 confirm 없이 즉시 전체 삭제.**
5. **backupService.ts:26,72-100 — 백업 보존 정책(일별 1개×4일)이 같은 날 안전 백업을 파괴.** 실수 후 30분 내 자동백업이 당일 정상 백업을 대체. 복원·초기화·가져오기 직전 스냅샷도 없음.
6. **App.tsx:244-257 + GistSyncCard.tsx:128-136 — Gist 수신 JSON을 `normalizeImportedData` 없이 그대로 적용.** 잘못된 Gist면 깨진 구조가 들어가고 500ms 후 자동저장이 덮어씀.

### 잘못된 금액·데이터 생성
7. **LedgerEntryForm.tsx:425-426 — 지출 항목 복사(startCopy) 시 카테고리 매핑 오류.** 그대로 저장하면 `subCategory="지출"`, `detailCategory="식비"`인 오염 데이터 생성. 올바른 매핑: `mainCategory=entry.subCategory, subCategory=entry.detailCategory`.
8. **LedgerPage.tsx:417-429 외 — USD 금액을 KRW와 구분 없이 합산** (요약 카드·선택 합계·일별 소계·월별 비교).
9. **calculations.ts:448-450 — 레거시 이자 상환(`subCategory="이자상환"`)이 원금 상환으로 집계** → 잔금·순자산 과소 표시. `detailCategory`만 검사하는 비대칭이 원인.
10. **AccountTablesSection.tsx:196-202 — 계좌 드래그 순서변경이 완전 no-op.** 드롭 대상이 아닌 드래그 항목 자신의 인덱스를 찾아 항상 조기 return.
11. **AccountTablesSection.tsx:574-576 — 증권 합계 행 USD 합계가 행 표시값과 불일치** (`usdTransferNet` 미포함).
12. **BalanceBreakdownSection.tsx:37-43 — 음수 시작금액이 셀 클릭+블러만으로 양수로 반전 저장** (`parseAmount`가 부호 제거).
13. **monthComparison.ts:27-33 — ExpenseIncomeCompareCard 집계가 신용결제 이중계상 + USD 미환산.**
14. **RecurringListSection.tsx:121-163 — "이번 달 반복 지출 생성"이 frequency 완전 무시.** 매년 항목이 매달 생성, 매주 항목이 월 1회 전액, 미래 시작일도 생성.
15. **RecurringListSection.tsx:264-274 — 체크박스 반영 경로도 monthly/yearly 시작일 검사 누락** (미래 시작 반복이 이번 달에 생성됨).
16. **useInsightsData.ts:171-183 + DateTab.tsx:12,19 — 특정 월 선택 시 데이트 KPI가 전체 기간 총액으로 계산** (건당 평균 수배 부풀려짐, 비중 100% 초과 가능).
17. **finance.ts:123-127 — 5글자 미국 티커(GOOGL, BRK.B)가 USD 주식으로 인식 안 됨** (`length <= 4` 기준). 실현손익 1/1400 과소, 폼이 KRW 모드로 렌더, 소수점 수량 거부 등 파급.
18. **DividendFormSection.tsx:152-153 — USD 종목 배당율이 환율 배수(~1400배)로 과대** (KRW 배당금 ÷ USD 매입원가). 평단 "$53.42"가 "53 원"으로 표시되는 문제 동반(:458).
19. **StockDetailModal.tsx:233-249 — 동일한 USD 배당율 버그** (올바른 `avgPriceKRW`가 :374에 있는데 미사용).
20. **TradeHistorySection.tsx:367,392 — 인라인 수정 시 역사적 환율(fxRateAtTrade)을 현재 환율로 무조건 덮어씀** → 과거 USD 거래 날짜만 고쳐도 원화 실현손익이 소급 변경.
21. **reportGenerator.ts:644 — 주간/월간 정산의 "부채"가 부호 반전**(`netWorth - asset` = −debt) → 표·차트·CSV/Excel/PDF 전부 음수 부채.

### 입력 충돌
22. **Ctrl+S 1회에 핸들러 3개 동시 발화** (useKeyboardShortcuts.ts:31 + shortcuts.ts:73,109 + LedgerEntryForm.tsx:551,571). 가계부 폼 이중 제출 + 수동 백업 동시 실행, **undo 스택에 유령 항목** (Ctrl+Z 시 입력한 적 없는 항목 부활). ※ 7번대 항목과 동일 근원 — 가계부·공통 양쪽에서 독립 확인됨.

---

## 2. 중간 (영역별)

### 가계부
- LedgerTable.tsx:523,614 vs LedgerPage.tsx:650-683 — 페이지네이션과 Shift+드래그 합계의 인덱스 체계 불일치 (2페이지 이상에서 엉뚱한 행 토글).
- validateLedgerForm.ts:104-110 — 지출 할인이 금액 초과해도 통과 → 음수 금액 저장 (인라인 할인 편집도 동일).
- QuickEntryModal.tsx:22 — 금액 파싱이 본문 첫 숫자를 잡음 ("GS25 떡볶이 3000" → amount=25). transfer 파싱 시 toAccountId=undefined 저장 등 검증 우회.
- LedgerPage.tsx:409-411,435 — "전월 대비"가 선택 월과 무관하게 항상 실제-오늘 기준 전월. 현재/전월 계산 기준도 비대칭(trade 가상 행 포함 여부).
- LedgerEntryForm.tsx:288-291 — 일일 예산 사전 경고가 입력 날짜 무시(daily 모드만 실제 오늘 기준).
- LedgerPage.tsx:743 — CSV 내보내기 trade 행 제외 필터가 no-op (`"id" in l` — 가상 행도 id 있음). `!l._tradeId` 필요.
- TaxiSplitWizard.tsx:127-220 — 다크모드에서 깨지는 하드코딩 라이트 색상 다수.
- LedgerTable.tsx:206-207 — 인라인 날짜 편집 무검증 (빈 날짜 저장 가능).

### 계좌·부채
- AccountTablesSection.tsx:541-560 — 증권/암호화폐 테이블 헤더 11열 vs 바디 10열 (한 칸 밀림).
- AccountsPage.tsx:211 — typeSummary가 `effectiveFxRate` 대신 `fxRate` prop 사용 (USD 현금 0 처리 vs 주식은 환산 — 비일관).
- AccountsPage.tsx:194-217 — `other` 유형 계좌가 순자산 합계에서 누락 (대시보드 순자산과 불일치).
- LoanCardsSection.tsx:31-59 — 거치기간 이자 누락으로 총 대출이자 과소 (bullet은 거치 n년치 통째 누락).
- DebtPage.tsx:63-66 — 대출 매칭이 `description.includes(loanName)` 부분 문자열 ("주택대출"/"주택대출2" 혼선, 설명 편집 시 무경고 미매칭).
- AdjustmentModal.tsx:249·259 — 카드 부채 직접 설정에서 음수 입력 부호 소실.

### 대시보드
- DashboardWidgetSettings.tsx — **위젯 표시/숨김·순서 설정이 대시보드에 전혀 적용 안 되는 죽은 기능.** 위젯 ID 목록도 실제 위젯과 불일치. "동일하게 적용됩니다" 문구는 거짓.
- DashboardInlineCharts.tsx:140 등 — 합계선·ReferenceLine·activeDot `#0f172a` 고정 → 다크모드에서 안 보임.
- DashboardInlineCharts.tsx — recharts Tooltip 다크모드 미대응 (기본 흰 배경, 6곳).
- BudgetAlertWidget.tsx:149-151 — 하드코딩 라이트 알림 박스 (다크모드 깨짐).
- SpendingCalendarCard.tsx:106-115 — 데이터 창(−365일~+89일) 밖 달로 이동하면 기록이 있어도 0 표시, 안내 없음.
- MonthlyTrendCard vs summaryMath — 같은 라벨 "재테크"가 카드마다 다른 정의 (expense형 vs transfer형 — 교집합 없음).
- TotalAssetTrendCard.tsx:286 — USD 종목 + 환율 없음 → 평가액 0원 처리 (자매 카드는 원가 처리 — 불일치).
- monthComparison.ts:41-42 — 전월 0일 때 "▲ 0.0%" 모순 표시.

### 인사이트·예산
- recurringAlert.ts:46-47 — alreadyLogged 판정이 실제 저장 스키마와 불일치 → **기록해도 배지가 계속 표시**.
- recurringAlert.ts:17-19 — 매월 29/30/31일 반복은 짧은 달에 알림 안 뜸 (존재하지 않는 날짜 생성, 클램프 없음).
- forecast.ts:61-64 — lookback에 진행 중인 현재 월 포함 → 예측 체계적 과소.
- useInsightsData.ts:977-998 — patternStats가 미래 날짜를 무지출일로 카운트 (같은 탭의 zeroDays와 모순).
- 월 라벨("6월") 연도 없는 역조회 — IncomeTab:46, InvestTab:23-25, SubTab:41,46 — 13개월 이상 기간에서 엉뚱한 해의 값 반환.
- useInsightsData.ts:473-478 — 지출·재테크 중분류 MoM이 진행 중인 달 포함 → 월초엔 전부 "급감" (수입 쪽만 보정돼 있음).
- insightsShared.tsx:130-137 Insight + 각 탭의 하드코딩 라이트 bg — 다크모드에서 본문 읽기 불가 (OverviewTab:444-493 외 다수).
- ExpenseTab.tsx:214-229 — Row 하드코딩 다크 텍스트 + `var(--bg)` 배경 → 다크모드에서 검정 on 검정.
- SettlementView.tsx:33 — 정산 경계일 포함(>=) → 정산 당일 지출 이중 정산 가능.
- SettlementView.tsx:72-82 vs dateAccounting.ts:155-158 — 정산 입금(transfer)이 자금 흐름 표에서 "내 이체"로 분류, partner_low 이상감지 왜곡.
- FunTab.tsx:17-20 — "전월 대비"가 선택월 전월 vs 기간 마지막 월 비교 (엉뚱한 두 달).

### 주식·배당
- TradeFormSection.tsx:230-242,998 — **전량 매도한 거래는 수정 불가** (본인 거래가 반영된 positions 기준 검증 → 저장 버튼 영구 비활성).
- useQuoteRefresh.ts:249 — 시세 갱신 race condition (시작 시점 prices 클로저 베이스 + 동시 실행 가드 없음 → lost update).
- TradeFormSection.tsx:434,474 / TradeHistorySection.tsx:409-411,446-448 — accounts 전체 배열을 setTimeout으로 교체 (함수형 업데이트 아님 → 병행 변경 유실 가능).
- DividendFormSection.tsx:392,449 — "티커 비우면 이자 등록" 안내가 거짓 (빈 티커 거부, "이자" 입력 시 무음 return — dead-end).
- FxFormSection.tsx:86-101 — 환율 입력이 직전 키 입력 값(stale closure)으로 도착 금액 계산.
- PortfolioChartsSection.tsx:283 — 손익 색상 컨벤션 정반대 (전역: 이익=빨강/손실=파랑인데 여기만 이익=녹/손실=적).
- PortfolioChartsSection.tsx:277-279 — 종목 20개 이하면 top10/bottom10 겹쳐 같은 종목 막대 중복.
- IncomeRecordsSection.tsx:163 — 보유주수 수정 시 note 교체로 배당락일 메타 소실.
- DividendFormSection.tsx:86-95 — effect가 사용자가 고친 보유 수량을 덮어씀 (deps에 selectedPosition 객체).
- TradeHistorySection.tsx:334-352 — 인라인 매도 수량 수정에 보유 초과 검증 없음 → 실현손익 과대.
- StocksPage.tsx:472-483 — `presets.sort()` in-place — zustand 스토어 직접 변형.
- 다크모드 하드코딩: StockStatsCard 카드 전체, DividendFormSection·IncomeRecordsSection·StockDetailModal·TradeFormSection 다수 (보고서 본문 참조).

### 보고서·카테고리
- reportGenerator.ts:1416-1419 — 종합 월간이 구버전 재테크 저축성지출을 생활소비로 오분류 (`isSavingsExpenseEntry`보다 먼저 분기 — 같은 화면 내 다른 보고서와 모순). ledgerMarkdownReport.ts:40-44 동일.
- CategoriesPage.tsx:277,284-285 — 사용 통계가 현행 스키마와 불일치 → **실사용 카테고리가 "사용하지 않음"으로 표시되고 삭제 유도**.
- CategoriesPage.tsx:18-53 — presets prop 변경 시 로컬 표 미동기화 (Ctrl+Z 복원과 충돌, stale 덮어쓰기 가능).
- useReportWorker.ts:44,200 + ReportPage.tsx:58-79 — `isComputing` 미사용 → 기간 변경 직후 내보내기가 **새 기간 제목 + 이전 기간 데이터** 합성 파일 생성.
- buildReportBlocks.ts:182-188 — "수입 상세" 블록이 실제로는 배당·이자만 포함 (라벨 오해).

### 설정·백업·동기화
- dataService.ts:842 — 가져오기 시 스키마 마이그레이션 사실상 비활성 (버전 12 선기록 후 migrate 호출 → no-op). 구버전 백업 복원 시 금액·분류 어긋남.
- dataService.ts:836-855 — normalizeImportedData의 임시 localStorage 쓰기 부작용 (CACHE·IndexedDB 오염 + 타 탭 storage 이벤트 race).
- useGistSync.ts:99-121 — 부팅 자동 pull이 로컬 미push 변경을 충돌 검사 없이 덮어씀.
- useGistSync.ts:85-88,270,299 — 토큰 미설정 부팅 시 자동 동기화 영구 비활성 (hasMountedRef 순서) — sessionStorage 기본 정책이라 일상 발생.
- GistSyncCard.tsx:100-114 — 카드 "Gist에 저장"이 충돌 감지·상태 갱신 우회 (다음 자동 push 때 가짜 충돌 모달).
- tableDataBackup.ts:397-425,517-538 — 테이블 백업에 5개 필드 누락 (workoutRoutines, customExercises, marketEnvSnapshots, investmentGoals, dailyBudget) — "테이블 백업만으로 복구" 안내와 모순.
- 위험 작업 confirm 부재: BackupHistoryTable 복원, DataBackupCard 파일 복원, JsonImportSection, GistSyncCard 불러오기, SavingsMigrationPage 일괄 3종, DataIntegrityPage 중복 제거 — 전부 즉시 실행.
- DataIntegrityPage.tsx:294-295,337-338 — 자동 수정 직후 stale data로 재검사. detectDuplicateTrades가 정상적인 동일 거래 2건도 중복 판정.
- DataResetCard.tsx:23-36 — 초기화 직전 스냅샷 없음 + Gist 자동 push로 빈 데이터 전파 미고지.
- SavingsMigrationPage.tsx:93-106 — "재테크로 전환" 결과가 v8 이전 형식 생성 (마이그레이션 재실행 안 됨).

### 운동·검색·공통
- useKeyboardShortcuts.ts:45-49 — 입력 필드 포커스 검사 없음: **텍스트 입력 중 Ctrl+Z가 앱 데이터 전체 undo로 발동.** Alt+←/→, Ctrl+N/K도 동일.
- helpers.ts:57-62 — 볼륨 통계가 미수행(done=false) 계획 세트까지 합산 (루틴 적용만 해도 월간 볼륨 발생, 이력 통계와 모순).
- SearchModal.tsx:165-177 — "뷰 저장" 버튼 클릭 무동작 (activeElement가 버튼 자신).
- ThemeCustomizer.tsx:71-92 — 저장된 커스텀 테마·폰트가 재시작 시 미적용 + 인라인 변수가 다크모드 팔레트 고정 파괴.
- ShortcutsHelp.tsx:21,37 — 미구현 단축키 안내 (Ctrl+Enter, Ctrl+F — register 호출처 없음), 실존 Ctrl+Shift+K는 누락.

---

## 3. 낮음 (영역별 발췌 — 상세는 각 절)

### 가계부
- formatter.ts:25 — formatShortDate UTC 파싱 (음수 타임존에서 하루 밀림).
- validateLedgerForm.ts:51 + validation.ts:121 — 미래 날짜 에러 메시지가 하루 어긋남 ("06-10 이전만…" 실제 허용 06-11).
- LedgerPage.tsx:122 — `isBatchEditMode` setter 없음 → 배치 편집 UI 도달 불가 (dead). LedgerEntryForm `formExpanded`도 동일.
- LedgerEntryForm.tsx:768-772 — JSX 속성 안 useCallback (rules-of-hooks 위반 패턴).
- LedgerEntryForm.tsx:380-393 — keepContext 주석과 달리 카테고리 클리어.
- 색상 의미 충돌: 일별 소계(수입=빨강)와 요약 카드(수입=초록)가 같은 화면에서 반대.
- LedgerSummarySection.tsx:190 — 재테크 금액 `#d97706` 하드코딩.
- 용어 불일치: "저축성지출"/"재테크" 혼용. 스테일 주석 4건 (LedgerPage.tsx:17,96-97,123, LedgerEntryForm.tsx:658).
- USD 항목 빠른 복사 시 소수점 입력 불가 (LedgerPage.tsx:133).
- QuickEntryModal id가 `qe-${Date.now()}` (타 경로는 newIdWithPrefix).
- 드래그 핸들 표시 조건과 draggable 조건 불일치 (LedgerTable.tsx:609,696-698).

### 계좌·부채
- AccountForm.tsx:128 — 부채 placeholder "-100000"이 음수 입력 안내 (실제로는 부호 소실).
- AdjustmentModal.tsx:329-331 — USD 음수 증감 힌트가 양수 환산 표시. :142-144 — 일반 계좌 조정 후 모달 안 닫히고 토스트 없음.
- 숨김 계좌가 일부 드롭다운(AdjustmentModal:183, DebtPage:84, InitialReversePanel:431-432)에서 미제외 — 안내 문구와 모순.
- debtShared.ts:10-14 — graceEndDate setMonth 월말 오버플로 + UTC/로컬 혼용.
- formatter.ts:13-19 — 음수 USD "$-5.500" 표기.
- InitialReversePanel.tsx:127-249 — 일회성 마이그레이션 버튼 상시 노출.
- App.tsx:757-758 — 인라인 콜백이 memo 무력화 (성능).
- AccountTablesSection·BalanceBreakdownSection — 호출부 없는 편집 필드 dead code.
- RepayLoanModal/EditRepaymentModal — 날짜 비움 허용, 잔금 초과 상환 무경고.

### 대시보드
- DividendCoverageCard.tsx:110,122 — "해당 금액"(→배당 오타), "예정"(→고정비) 라벨 오류. null 커버리지가 빨간 "-".
- DividendCoverageCard.tsx:37 — 3개월 평균에 진행 중인 달 포함.
- SalaryTimerCard.tsx:133-136 — `paddayNum` 오타, 진행 바 aria 없음, 급여 추정 USD 미환산.
- InvestmentSummaryCard — 부모 계산 재계산 (헤더 주석 위반), 12개월 컷오프 UTC.
- NetWorthTrendChart — 데이터 <2면 카드 소멸(빈 상태 없음), yTicks 중복 key, "−0만원".
- MonthPaceCard.tsx:98,116 — 상태색으로 차트색 사용 ("절약"이 수입-빨강).
- MonthlyTrendCard — 0건일 때 빈 상태 없이 범례만.
- CmaBalanceChart YAxis 라벨 잘림 가능 (포맷 불일치).
- DashboardPage.tsx:81-82 — today/currentMonth 빈 deps 고정 (자정 넘겨 켜두면 미갱신).
- DashboardWidgetSettings — console.warn 태그 구명칭, placeholder에 리터럴 `\t\n`.

### 인사이트·예산
- ForecastView — 미반올림 값 소수점 표시 가능. forecast.ts:69 — weekly 반복이 고정지출 합에서 누락.
- RecurringFormCard.tsx:39-66 — 수정 모드 UI 도달 불가 (dead).
- useInsightsData:818-821 — 월평균 성장률 분모 오류(length vs length-1). :305 — divTrend subCategory 폴백 누락.
- OverviewTab:12 — 순현금흐름 차트가 마지막 월 무조건 제외. :18,105 — "현금성 자산" 라벨인데 증권·코인 평가액 포함.
- InvestTab:16 — 청산 손익 평균단가 vs KPI FIFO 혼용.
- SettlementView:61 — 빈 상태 안내가 미구현 설정(비율) 언급, 정산금 0.5원 단위 저장 가능.
- RecurringListSection:175,294-296 — alert() 사용, 터치 환경 힌트 "더블클릭" 고정.
- 접근성: 인라인 편집 셀 키보드 진입 불가, InsightsHeader select aria 없음.

### 주식·배당
- yahooFinanceApi.ts:369-375 — RateLimitError dead code (429 구분 불가).
- PositionListSection:382-393 — colgroup 10 vs 컬럼 11 (폭 밀림). :65-77 — toDisplayValue 주석/동작 불일치.
- 계좌 select가 `a.id` 표시 (4곳) vs `acc.name || acc.id` (1곳) — 비일관.
- DividendFormSection:124 — 로컬 formatUSD가 센트 절사.
- finance.ts:162-168 — extractTickerFromText가 "2024"를 티커로 오인 가능.
- DividendsPage:177 — getCostBasisAtDate가 현재 환율만 사용 (타처는 fxRateAtTrade 우선).
- StocksPage:159-161 dead conditional, :173 USD 평단 달러 단위 반올림.
- TradeHistorySection:825·855·885 — 단가/수수료 셀이 항상 빨강 (>=0 positive 클래스). :408-411 — Enter 시 저장 2회 가능.
- IncomeRecordsSection:332,370 — Enter 포커스 이동 셀렉터 매칭 불가 (무동작).
- StockDetailModal:489 — 매수=청/매도=적 (국내 관례 반대).
- TargetPortfolioSection:174-194 — 비중 100% 초과 무음 거부.
- FxFormSection:45-64 — 계좌명 휴리스틱("usd"/"달러")으로 통화 결정 → 일부 환전 항상 거부.
- useQuoteRefresh:156,224 — fxRate stale 클로저로 암호화폐 환산.
- 티커 정확 일치 매칭 vs canonical 매칭 혼재.

### 보고서·카테고리
- reportGenerator.ts:1495-1511 — reportToCSV 따옴표 이스케이프 누락 (현재 미사용 dead code).
- reportExport.ts:18-30 — 숫자에 천단위 쉼표 포함 ("1,234" → Excel 텍스트 인식), `\n` vs csvExport `\r\n`.
- excelExport.ts:30 — 이스케이프 후 31자 절단 (엔티티 중간 절단 위험).
- unifiedCsvExport.ts:95-100 — FIFO 매칭 실패 시 매도대금 전액을 손익으로 기록, 수익 매도 kind=expense.
- InvestmentRecordCard:130-153 — CSV 빈 데이터 가드·토스트 없음.
- reportGenerator.ts:690-693 — 정산 코멘트 영어 문장 노출.
- 배당 판정 기준 불일치 (categoryMatch vs includes("배당") 혼재) — 보고서 간 배당 수치 상이 가능.
- reportGenerator.ts:1423-1426 — 대출상환이 loanRepayment+livingExpense 이중 가산.
- pdfExport — title 미이스케이프 (현재 고정 문자열이라 무해).
- ledgerMarkdownReport:150-161 — 표 셀 `|` 미이스케이프.
- BasicReportTables — 빈 상태 없음, null IRR에 빨간 "-".
- ComprehensiveMonthlySection:61-64 — month input 비우면 "NaN-NaN" 노출.

### 설정·백업·동기화
- BackupHistoryTable:97 — server 소스 "로컬 파일" 표기 + server 분기 dead code.
- uiStore:70,234 — appLogIdCounter 세션 재시작 시 React key 중복 가능.
- useAppData:92 — STORAGE_KEYS 대신 문자열 하드코딩 (SettingsPage:212-215도).
- useGistSync:380-385 — force-push 실패 시 toast 없이 모달 닫힘.
- useBackup:104-133 — unload flush가 full payload 기록 (정책 불일치), 실패 시 무음 유실.
- App.tsx:929-932 — 저장 전인데 "저장 완료" 로그.
- 프로덕션 백업 API 부재 → 배포 환경 수동 백업마다 "파일 저장 실패" 노이즈. 용량 초과 메시지 영어.
- Gist: secret gist 열람 한계 미고지, 토큰 keystroke마다 storage 기록.
- tabSync:86,94-100 — 150ms dedup 드롭, hashHint 재시도 상태 미갱신.

### 운동·검색·공통
- useSearch:100-101 — 금액 필터 USD 미환산.
- ReceiptScanner — objectURL 누수, 진행률 출렁임, 날짜 범위 무검증, 모달 접근성.
- ExerciseProgressionChart:58 — CartesianGrid `#eee` 하드코딩 (`--chart-grid` 미사용).
- defaultWorkoutRoutines — 시드 종목명 표기 불일치 3건 → 이력 분절. 유산소 reps=분 컨벤션 UI 미반영.
- dataService:900-901 — 루틴 전체 삭제가 리로드 시 시드 재주입으로 무효.
- WorkoutPage/RoutineManager — 키스트로크 단위 undo 오염 (스택 50 소진).
- formatter — formatNumber(-0.4)→"-0", 음수 USD 부호 위치.
- helpers.ts:48-50 — makeId 자체 구현 (저엔트로피 이중 체계).
- SearchModal:135,195-228 — 미정의 변수 + 미정의 CSS 클래스 (결과 리스트 무스타일).
- SetDetailRow:35-47 — 과거 기록 열람 시에도 휴식 카운트다운 동작.
- DayWorkoutEditor:159-161 — 장식용 primary 버튼이 클릭 가능해 보임.
- MonthCalendar:74-98 — 날짜 셀 aria-label 없음.
- styles.css:999-1001 — `.pill.success/...` 라이트 전용 배경, .dark 오버라이드 없음.
- shortcuts.ts:73 — 입력 포커스 중 ESC allowlist 차단 (manager 경로 사실상 dead).

---

## 4. 이상 없음으로 확인된 영역

- **계산 유틸**: parseAmount/formatAmount, taxiSplit(멱등성), dailyBudget(월말·윤년·streak 상한), irr(Newton-Raphson·가드), tradeCashImpact, dividend, investmentRecord FIFO, 1RM·PR(Epley), KST 날짜 유틸(getTodayKST/shiftMonth/buildHalfMonthSnapshotDates), anomaly 수식 자체, insightsHelpers, expenseClassification, descriptionGrouping(levenshtein), categoryMerge(U+001F 구분자), 세금 세율(15.4%·2천만 기준).
- **인프라**: cacheStore(IndexedDB), dataSanitize, gistSync.ts 자체(타임아웃·백오프·상태코드별 메시지), portfolioWorker/usePortfolioWorker(requestId race 방어), reportWorker race 방어, useFxRate(캐시+stale+재시도), tickerService, krNameResolver, useFocusTrap, utils/id, undoToast(restore-by-id).
- **UX 양호**: 가계부 빈 상태 3종·삭제 undo, 계좌/대출/배당 빈 상태, 보유·매매·배당 빈 상태, EmptyState/Tabs/ChartSkeleton/에러 바운더리 복구 UX, QuoteRefreshProgress aria, SaveStatusPill/DraftRecoveryBanner/PWA 관련.
- **recharts 애니메이션**: 운동 1곳 + 주식 Pie 5곳 제외 전 영역 `isAnimationActive={false}` 적용 확인.
- **console.log 잔재**: 전 영역 0건 (warn/error는 의도적 로깅).
