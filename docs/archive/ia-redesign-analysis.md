# 리포트/대시보드/인사이트 IA 분석

## 겹침 지도
- 월별 수입/지출 추이가 4곳에 존재: 대시보드 MonthlyTrendCard(최근 6개월 누적 가로바), 보고서 '월별' 탭(BarChart+표), 보고서 '종합 월간'의 최근 추이 차트(6개월), 인사이트 overview 장기 트렌드(순 현금흐름 area + 누적 수입vs지출 line)
- 저축률이 3곳·3가지 정의로 존재: 대시보드 SavingsRatioCard(재테크 이체/수입, 저번달), 보고서 종합 월간 핵심지표(실질 순수입/근로소득), 인사이트 overview KPI '실질 저축률' + 누적 저축률 추이 + pattern/FunTab '최고 저축률 달' — 같은 이름의 지표가 탭마다 다른 숫자를 보여줌
- 순자산/총자산 추이가 6개 위젯·3~4가지 계산법으로 존재: 대시보드 NetWorthTrendChart(useAccountTimelineRows 월별), TotalAssetTrendCard(반월 박제 시세), AccountBalanceTrendCard(반월 스냅샷), 보고서 '일별'(일 단위 누적 재계산) + '주간/월간 정산' 월간 스냅샷 차트, 인사이트 asset 추이(현금흐름 누적 근사 — 시세·환율 미반영이라 다른 값) 
- 투자 실현손익(FIFO)·승률·손익비가 3중: 대시보드 InvestmentRecordCard(실현손익·승률·손익비·IRR·5탭·Excel), 보고서 '투자 정산'(실현 이익/손실 분해·월별 실현손익 차트·확정 거래 목록 2종), 인사이트 invest 손익 분해 4분할 + '수익·매매 성과'(승률·수익:손실 배수·청산 종목 목록) — buildClosedTradeRecords/computeRealizedPnl 호출이 코드상 3계층(dashboard/reportGenerator/useInsightsData)에 분산 확인됨
- IRR(XIRR)이 4곳: 대시보드 InvestmentRecordCard(연환산 IRR), 보고서 '주식 성과'(종목별 XIRR), '투자 정산'(전체 XIRR), '성과 분석'(계좌별 XIRR+TTWR)
- 지출 이상치 감지(detectSpendAnomalies z≥2)가 2곳: 대시보드 ExpenseIncomeCompareCard 배지와 인사이트 overview 이상치 배너가 동일 함수·동일 6개월 lookback 사용 + 인사이트 expense '단건 이상치 TOP10'까지 3중
- 전월 비교가 4곳: 대시보드 ExpenseIncomeCompareCard(compareMonths), 보고서 '기간 비교' 탭(이번달vs지난달 고정), 보고서 종합 월간의 모든 행 전월 delta, 인사이트 종합 인사이트 '전월 대비 변화' + FunTab '전월 대비 변화'
- 배당이 6곳: 대시보드 DividendCoverageCard(배당/고정비) + InvestmentSummaryCard 연간 배당 목표, 보고서 투자 정산 배당 행 + 세금 탭 + 내보내기 전용 '월별 수입 상세' 숨은 블록, 인사이트 invest 배당·이자 월별 bar + income 패시브 수입 추이
- 포트폴리오 구성이 5곳: 대시보드 PortfolioDashboardCharts(종목·계좌 파이 2종) + AssetCompositionCard(Treemap), 보고서 '주식 성과' 표, 인사이트 invest 자산배분 도넛 + 포트폴리오 분산 KPI + asset 자산 유형별 도넛
- 카테고리별 지출 랭킹이 3곳: 대시보드 TopExpensesCard(이번달 Top5), 보고서 '카테고리별'(기간 합계 표), 인사이트 expense 중분류 Top20 + 드릴다운 트리 + 월평균 Top10
- 예산 진행률이 2곳 완전 중복: 대시보드 BudgetAlertWidget과 인사이트 expense '예산 vs 실적'이 동일 budgetGoals·동일 이번달 소진율·동일 색상 단계(80%/100%)
- 월말 지출 예측이 2곳: 대시보드 MonthPaceCard(일할 예측 vs 직전 3개월 평균)와 인사이트 ForecastView '이번 달 진행 현황'(일할 추정 vs 다음달 예측)이 사실상 같은 계산
- 계좌별 잔액/성과가 4곳: 대시보드 AccountBalanceTrendCard·CmaBalanceTrendCard, 보고서 '계좌별' 요약 표 + '성과 분석' IRR·TTWR 표 + 투자 정산 계좌별 정산 표, 인사이트 asset 계좌별 잔액 목록
- 투자 목표 진행률이 2곳: 대시보드 InvestmentSummaryCard의 3개 목표 바와 인사이트 overview '저축률 목표'(annualDepositTarget 공유)·asset '목표 달성률'(finalTotalAssetTarget 공유)이 같은 investmentGoals를 다른 화면에서 중복 표시
- 고정비vs변동비가 4곳: 대시보드 DividendCoverageCard(고정비 분모), 인사이트 overview 핵심 재무 지표 + expense 고정비vs변동비 도넛 + 종합 인사이트 텍스트
- 구조적 역설 1건: 보고서 상단에 '실현 손익·승률·보유기간은 대시보드 → 투자 기록 카드' 안내 힌트가 고정 표시됨 — '정산' 콘텐츠가 대시보드에 있다고 보고서가 자인하는 코드 수준의 증거(ReportPage.tsx)

## 근본 원인
근본 원인은 시간축·질문유형·소유권 세 축이 전부 무너진 '누적 기능 추가(accretion)'다. (1) 탭이 질문 유형이 아니라 '추가된 시점'으로 나뉘어 있다 — 대시보드는 19개 위젯으로 비대해지며 현재 상태 요약을 넘어 전체 기간 추이 차트 5종(NetWorth·TotalAsset·AccountBalance·CostVsMarket·CMA), 이상치 진단, Excel 내보내기까지 갖춘 InvestmentRecordCard(사실상 보고서급 정산 도구)를 흡수했다. 보고서는 ReportPage.tsx 상단에 '실현 손익은 대시보드로 가라'는 힌트를 박아 자기 영역 상실을 자인하고, 인사이트는 진단이 본령인데 예산 진행·순자산 추이·KPI 누계 같은 상태/기록 위젯을 다시 가진다. (2) 더 치명적인 건 계산 엔진 3원화 — summaryMath(대시보드)·reportGenerator 워커(보고서)·useInsightsData(인사이트)가 같은 지표를 각자 다른 정의로 계산한다. 저축률이 3가지 정의, 순자산 추이가 3~4가지 계산법(특히 인사이트 asset은 시세 미반영 현금흐름 근사라서 대시보드 NetWorthTrendChart와 같은 질문에 다른 숫자를 답함)이다. 사용자가 느끼는 '다르면서 겹친다'는 정확히 이것: 같은 질문이 여러 탭에 있는데(겹침), 답하는 숫자와 시간창(6개월 고정/워커 12개월/기간 필터)이 제각각(다름)이라 어느 탭을 믿어야 할지 모르게 된 상태다. (3) 시간축 기준 불일치가 이를 증폭: 대시보드는 '이번 달+전체 누계 혼합', 보고서는 '기본 12개월', 인사이트는 '가변 필터'라서 동일 위젯도 탭마다 다른 기간을 보여준다.

## A안 — 보수안: 중복 제거와 문패 달기 (탭 구조 유지)
원칙: 한 질문에는 한 탭만 답한다 — 탭과 위젯 배치는 유지하되, 같은 질문에 두 번 답하는 위젯만 제거·이동한다

- 대시보드: 역할: '오늘 열어서 5초 안에 보는 내 돈 현황'. 유지: MonthlySummaryCards, SalaryTimer, MonthPace, BudgetAlert, TopExpenses, SpendingCalendar, NetWorthTrendChart, InvestmentSummaryCard, 포트폴리오 차트. 제거: InvestmentRecordCard(보고서로), ExpenseIncomeCompareCard의 이상치 배지(인사이트로 일원화), 자산 추이 3종 중 2종(TotalAssetTrendCard·AccountBalanceTrendCard는 NetWorthTrendChart 하나로 대표하고 나머지는 접힘/링크)
- 리포트: 역할: '확정 숫자의 장부 + 내보내기'. InvestmentRecordCard를 '투자 정산' 탭에 병합해 상단의 '대시보드로 가라' 힌트를 제거(역방향 부채 해소). '기간 비교' 탭 삭제 — 종합 월간의 전월 delta와 대시보드 비교 카드가 이미 커버. 나머지 탭 유지
- 인사이트: 역할: '패턴·진단·예측'. asset 탭의 순자산 추이(현금흐름 근사 — 대시보드와 다른 숫자를 내는 주범) 제거 후 대시보드 차트로 딥링크. expense '예산 vs 실적' 제거(BudgetAlertWidget 단일화). ForecastView '이번 달 진행 현황' 블록 제거(MonthPaceCard와 중복). 나머지 유지

이동 목록:
- 삭제: src/features/dashboard/DividendTrendCard.tsx (데드 코드, import 0건 확인)
- 이동: InvestmentRecordCard → 보고서 '투자 정산' 탭 내부 섹션으로 병합, ReportPage.tsx 상단 안내 힌트 제거
- 제거: ExpenseIncomeCompareCard의 detectSpendAnomalies 배지 (인사이트 overview 이상치 배너로 일원화, 카드 자체는 전월·전년 비교만 유지)
- 제거: 인사이트 asset 탭 '순자산 추이 area'(시세 미반영 근사치) — 대시보드 NetWorthTrendChart로 딥링크 대체
- 제거: 인사이트 expense '예산 vs 실적' 섹션 (대시보드 BudgetAlertWidget으로 단일화)
- 제거: 보고서 '기간 비교' 탭 전체 (워커 buildPeriodCompare 포함)
- 제거: 인사이트 ForecastView '이번 달 진행 현황' 블록 (대시보드 MonthPaceCard 유지)
- 축소: 대시보드 자산 추이 3종(NetWorth/TotalAsset/AccountBalance) → NetWorthTrendChart만 기본 노출, 나머지 2종은 '상세 보기' 접힘

규모: 소(1~2일). 렌더 제거·이동 위주, 신규 계산 없음. 내보내기 블록(buildReportBlocks)에서 periodCompare 케이스 제거 정도가 부수 작업
트레이드오프: 장점: 익숙한 위치 변화가 최소(제거 위주)라 매일 쓰는 사용자 학습 비용이 거의 없고 즉시 체감되는 중복 해소. 단점: 근본 원인(계산 엔진 3원화, 저축률 3정의, 보고서 11탭 과밀)은 그대로 남아 '같은 이름 다른 숫자' 문제가 잔존하고, 다음 기능 추가 때 재발할 구조적 기반이 유지됨. InvestmentRecordCard를 매일 보던 습관이 있다면 보고서까지 한 클릭 추가. 자기비판: 이 안은 증상 치료다 — 3개월 뒤 같은 불만이 돌아올 확률이 높다

## B안 — 중도안: 시간축 3분할 재편 (지금 / 닫힌 기간 / 행동과 미래)
원칙: 대시보드=지금(현재 상태와 이번 달 진행), 보고서=확정 기록·정산·세금(닫힌 과거 기간), 인사이트=패턴·진단·예측(내 행동과 미래)

- 대시보드: 역할: '현재 시점 + 이번 달'만. 유지: MonthlySummaryCards, SalaryTimer, MonthPace, BudgetAlert, TopExpenses, InvestmentBreakdown, SpendingCalendar, AssetComposition·PortfolioCharts(현재 시점 스냅샷이므로 잔류), InvestmentSummaryCard(현재 평가액+목표). 추가: 순자산 헤드라인 한 줄(현재값+전월 delta+미니 스파크라인) — 전체 기간 추이 차트들의 자리 보상. 알림 스트립(이상치·예산초과 → 인사이트 딥링크)
- 리포트: 역할: '닫힌 기간의 장부'. 12탭 → 6그룹 재편: ①종합 월간 ②투자 정산(+InvestmentRecordCard 병합+주식 성과+성과 분석의 계좌 IRR·TTWR 표) ③자산 추이(신설 — 대시보드에서 온 NetWorth/TotalAsset/AccountBalance/CostVsMarket/CMA 추이 + 기존 일별·주간/월간 스냅샷 통합) ④카테고리·계좌 ⑤세금 ⑥연간. '기간 비교' 삭제, '성과 분석'의 소비→투자여력은 인사이트로
- 인사이트: 역할: '진단·패턴·예측 전용'. ForecastView 유지·강화(예측의 단일 소유자, 단 이번 달 진행현황은 대시보드 MonthPace로 위임). 이상치 감지 단일 소유. asset 탭 축소: 자산 구성·추이는 대시보드/보고서에 위임하고 건강 체크리스트·부채 진단·집중도 경고만 유지. 보고서에서 온 소비→투자여력 분석 수용. SettlementView는 '데이트 정산'으로 명칭 구분해 유지(보고서의 '주간/월간 정산'과 성격이 다름 — 상대방과의 정산 행위)

이동 목록:
- 이동: NetWorthTrendChart·AccountBalanceTrendCard·TotalAssetTrendCard·StockCostVsMarketCard·CmaBalanceTrendCard(전체 기간 추이 5종) → 보고서 신설 '자산 추이' 탭, 기존 '일별'·'주간/월간 정산' 스냅샷과 통합
- 추가: 대시보드 상단에 순자산 헤드라인(현재값+전월 delta+스파크라인, useAccountTimelineRows 재사용) — 이동 보상
- 이동: InvestmentRecordCard → 보고서 '투자 정산' 병합, '주식 성과' 표·'성과 분석' 계좌 IRR/TTWR 표도 같은 그룹으로
- 이동: 보고서 '성과 분석'의 월별 소비→투자여력 차트·표 → 인사이트 expense/invest 탭
- 제거: 보고서 '기간 비교' 탭, 인사이트 ForecastView '이번 달 진행 현황', 인사이트 asset '순자산 추이(근사)'·'자산 유형 도넛'(대시보드 AssetComposition과 중복)
- 제거: ExpenseIncomeCompareCard 이상치 배지 → 대시보드 알림 스트립(인사이트 딥링크)으로 대체
- 제거: 인사이트 expense '예산 vs 실적'(BudgetAlertWidget 단일화), 삭제: DividendTrendCard.tsx 데드 코드
- 재편: ReportPage 탭 12개 → 6그룹, buildReportBlocks 매핑 수정

규모: 중(2~4일). 위젯 이동과 보고서 탭 그룹핑, 내보내기 블록 재매핑. 신규 계산 로직 없음 — props 배선과 lazy-load 경계 재정리가 주 작업
트레이드오프: 장점: '한 줄 구분 원칙'이 사용자 머릿속 모델과 일치(지금/과거/미래)하고 보고서 과밀까지 해소. 단점: 매일 보던 순자산 추이 차트가 보고서로 가는 익숙한 위치 비용 — 헤드라인 스파크라인+딥링크로 완화하지만 수 주간 어색함은 불가피. 자기비판 1: '이번 달'이 세 탭 모두에 걸침(대시보드 진행, 보고서 종합 월간, 인사이트 현재월 분석) — 종합 월간을 '완결된 월 기본'으로 바꿔야 원칙이 완성됨. 자기비판 2: 계산 엔진 3원화를 건드리지 않으므로 저축률 3정의 같은 '같은 이름 다른 숫자' 문제가 위치만 바뀐 채 잔존할 수 있음

## C안 — 적극안: 전면 재배치 + 단일 지표 엔진
원칙: 한 지표는 한 곳에서 계산되고 한 곳에서만 산다 — 대시보드=5초 체크, 보고서=인쇄 가능한 닫힌 장부, 인사이트=질문에 답하는 분석실

- 대시보드: 역할: 7±2 위젯의 '오늘 화면'으로 축소. 남길 것: MonthlySummaryCards, SalaryTimer, MonthPace, BudgetAlert, TopExpenses(또는 SpendingCalendar 중 택1), 순자산 헤드라인(스파크라인), 투자 헤드라인(InvestmentSummaryCard 축약판). 추가: 알림 스트립 — 이상치·예산 초과·구독 급증·정산 지연을 한 줄씩, 클릭 시 인사이트 해당 섹션 딥링크. 나머지 12개 위젯은 전부 이동
- 리포트: 역할: '닫힌 기간 전용 장부 + 내보내기 센터'로 재정의, 4그룹: ①종합 월간(허브, 완결 월 기본) ②투자 정산(InvestmentRecord·주식 성과·계좌 성과 흡수) ③연간·세금 ④내보내기 센터(카테고리·계좌·일별 표는 화면 탭에서 빼고 내보내기 옵션으로 격하 — 이 표들은 보는 용도보다 추출 용도). '기간 비교'·'성과 분석' 진단부는 인사이트로
- 인사이트: 역할: 유일한 탐색·진단 공간. 기간 필터·드릴다운·예측·이상치·패턴의 단일 소유자. 대시보드에서 온 PortfolioCharts·AssetComposition은 asset/invest 탭에, SavingsRatio·DividendCoverage는 overview/income KPI로 병합(별도 카드 소멸), MonthlyTrendCard·ExpenseIncomeCompare는 overview 장기 트렌드에 흡수. asset 탭의 근사 순자산 계산은 폐기하고 공용 타임라인 사용

이동 목록:
- 신설: src/selectors/ 공유 계층 — summaryMath·reportGenerator·useInsightsData에 분산된 저축률(1정의로 통일)·순자산 타임라인(useAccountTimelineRows 공용화)·FIFO 실현손익(buildClosedTradeRecords 결과 캐시 공유)·고정비 판정을 단일 소스로 통합
- 폐기: useInsightsData의 현금흐름 근사 netWorthByMonth → 공용 타임라인으로 교체 (같은 질문·다른 숫자 문제의 근원 제거)
- 이동(대시보드→보고서): InvestmentRecordCard, AccountBalanceTrendCard, TotalAssetTrendCard, StockCostVsMarketCard, CmaBalanceTrendCard, NetWorthTrendChart(헤드라인 스파크라인으로 대체)
- 이동(대시보드→인사이트): PortfolioDashboardCharts·AssetCompositionCard → asset/invest 탭, SavingsRatioCard → overview KPI 병합, DividendCoverageCard → income 패시브 수입 섹션 병합, MonthlyTrendCard·ExpenseIncomeCompareCard → overview 트렌드 흡수
- 이동(보고서→인사이트): '기간 비교' 로직·'성과 분석' 소비→투자여력
- 격하: 보고서 '카테고리별'·'계좌별'·'일별' 화면 탭 → 내보내기 센터의 데이터셋 옵션
- 추가: 대시보드 알림 스트립(이상치·예산·구독·정산 → 인사이트 딥링크)
- 삭제: DividendTrendCard.tsx, buildPeriodCompare 워커 케이스, 중복 집계 코드 일괄

규모: 대(1~2주+). selector 통합은 저축률·순자산 정의가 바뀌므로 기존 __tests__ 갱신과 회귀 테스트 필수. UI 이동보다 계산 통합이 공수의 절반 이상
트레이드오프: 장점: 유일하게 근본 원인(계산 분산+정체성 혼합)을 모두 해소 — '겹치는데 숫자가 다르다'가 구조적으로 불가능해짐. 향후 위젯 추가 시 둘 곳이 자명해져 재발 방지. 단점: 매일 쓰는 앱에서 19개 중 12개 위젯이 사라지거나 이동 — 익숙한 위치 비용이 최대이고 수 주간 '내 차트 어디 갔지' 마찰 확실. 정의 통일로 과거에 보던 저축률·순자산 값 자체가 달라져 '버그인가?' 하는 자기 불신 구간 발생. 자기비판: 1인용 PWA에 풀 재배치는 과잉 설계 위험 — 다만 selector 통합(1단계)과 UI 재배치(2단계)로 분할 실행하면 위험을 절반으로 줄일 수 있음

## 추천
추천: B안을 골격으로 하되 C안의 1단계(지표 계산 통합)를 선행하는 'B+' 단계 실행. 순서 — (0) A안의 무비용 항목 즉시 실행: DividendTrendCard 삭제, 보고서 '기간 비교' 탭 제거, 예산 위젯 단일화, ReportPage의 '대시보드로 가라' 힌트 해소(InvestmentRecordCard를 투자 정산에 병합). (1) C안에서 가장 값싼 두 가지 계산 통일만 선행: 인사이트 asset의 현금흐름 근사 순자산을 useAccountTimelineRows 공용 타임라인으로 교체, 저축률 정의를 summaryMath 1곳으로 통일 — 사용자 불만의 핵심인 '다르면서 겹친다'는 위치 중복(겹침)보다 같은 질문에 다른 숫자(다름)가 신뢰를 깎는 문제라서, 위치 재배치만 하는 순수 B안으로는 절반만 해결되기 때문. (2) 그 위에 B안의 시간축 3분할(지금/닫힌 기간/행동과 미래)을 적용해 전체 기간 추이 5종을 보고서 '자산 추이' 그룹으로 이동하고 대시보드에 순자산 헤드라인+알림 스트립을 보상으로 추가. C안 전면 재배치를 지금 하지 않는 근거: 매일 쓰는 개인 앱에서 12개 위젯 동시 이동은 습관 비용이 효익을 초과하고, B+ 이후에도 대시보드가 여전히 비대하다고 느껴지면 그때 C안 2단계로 점진 확장하면 된다(B+는 C로 가는 경로를 막지 않음). 총 공수 약 3~5일, 단계별로 배포 가능해 되돌리기도 쉽다.