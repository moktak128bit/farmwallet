# FarmWallet 전체 재구축 계획 (v5)

목표: 기능 전체를 깨끗한 구조로 재구축하고, 기존 데이터가 반영된 상태로
https://moktak128bit.github.io/farmwallet/ 에서 동작하게 한다.

## 핵심 원칙

1. **데이터 연속성 최우선.** localStorage 키(`farmwallet-data-v1`)와 스키마(v12)를 유지한다.
   같은 브라우저에서는 새 버전 배포 즉시 기존 데이터가 그대로 보이고,
   다른 기기는 설정 탭의 JSON 가져오기 또는 Gist 동기화로 이전한다.
   도메인별 추출본은 `data/extracted/*.json` (scripts/extract-domains.mjs).
2. **검증된 도메인 로직은 재사용.** types.ts, calculations.ts(FIFO/IRR/세금), utils/,
   services/(저장·백업·Gist), workers/ 는 테스트 352개로 검증되어 있으므로 그대로 쓴다.
   재작성 대상은 **거대 페이지 UI**다.
3. **스트랭글러(점진 교체) 방식.** 별도 앱을 병렬로 만들지 않고 이 저장소에서
   페이지 단위로 교체한다. 매 커밋이 배포 가능한 상태를 유지하고,
   main 푸시 → GitHub Actions → Pages 배포 파이프라인을 그대로 쓴다.
4. **페이지 구조 표준.** 각 도메인은 `src/features/<domain>/` 아래
   `sections/`(memo된 표시 구역), `hooks/`(상태·로직), 폼/모달 컴포넌트로 분해하고
   `src/pages/<Domain>Page.tsx`는 200~400줄의 조립자(orchestrator)로만 남긴다.
   (선례: features/ledger/LedgerSummarySection.tsx, LedgerFilterCard.tsx)

## 단계

### Phase 0 — 데이터 추출·기반 (완료)
- [x] 도메인별 데이터 추출 스크립트 + data/extracted/*.json
- [x] LedgerPage 1차 분해 (요약/필터 카드 → React.memo 분리)
- [x] 린트 경고 0건, git push --force-with-lease, 저장 경로 최적화

### Phase 1 — 가계부(ledger) 완성 (완료)
- [x] 거래 테이블 + 인라인 편집/드래그합계/페이지네이션 → `features/ledger/LedgerTable.tsx` (1,158줄)
- [x] 입력 폼 + form 상태 → `features/ledger/LedgerEntryForm.tsx` (1,123줄, memo+forwardRef,
      외부 접점은 `LedgerEntryFormHandle.patchForm` ref API)
- [x] LedgerPage.tsx 3,503 → 1,001줄 조립자화 (목표 400줄은 Phase 5에서 잔여 모달·배너 정리로 추가 축소)

### Phase 2 — 주식(stocks)·계좌(accounts) (완료)
- [x] StocksPage 2,037 → 689줄: `TradeFormSection`(1,079줄, 폼 상태 자식 소유 + `TradeFormSectionHandle` ref API),
      `useQuoteRefresh`(395줄, 시세 갱신 상태머신), `StocksHeaderSection`(108줄)
- [x] AccountsPage 1,395 → 313줄: `AccountTablesSection`(619줄, 인라인 셀 편집 자식 소유) 신설,
      기존 AdjustmentModal/InitialReversePanel/BalanceBreakdownSection에 전용 상태·핸들러 이전 + memo 계약 적용

### Phase 3 — 배당·대출·예산 (완료)
- [x] DividendsPage 1,918 → 420줄: features/dividends/ 5개 모듈 (배당/이자 폼 — 폼 상태 자식 소유,
      요약, 내역 표 — 인라인 편집 자식 소유)
- [x] DebtPage 1,230 → 176줄: features/debt/ 6개 모듈 (대출 폼 ref API, 카드 그리드,
      상환 내역, 상환/수정 모달)
- [x] BudgetRecurringView 1,451 → 140줄: features/budget/ 6개 모듈 (반복지출 목록·폼,
      예산 대시보드·폼·테이블, 하루예산)
- Phase 5 정리 메모: incomeRows의 미사용 priceKrwByTicker 제거, package.json "type": "module" 추가 검토

### Phase 4 — 리포트·인사이트·대시보드 (완료)
- [x] ReportPage 1,559 → 201줄: features/reports/ 9개 모듈 (보고서 섹션 6종 + 내보내기 블록 빌더)
- [x] InsightsPage 1,139 → 109줄: useInsightsData 훅(998줄) 추출 + 탭 7개 React.lazy 분할
      → InsightsPage 청크 204KB → 45KB (첫 진입 ~85KB만 로드)
- [x] DashboardPage 993 → 391줄: 위젯 19개 전부 React.memo화, 위젯 전용 상태·집계 자식 이동,
      summaryMath/useAccountTimelineRows 추출
- [x] 차트 애니메이션 정책 일괄 적용: reports/insights/stocks 59개 시리즈 isAnimationActive={false}

### Phase 5 — 설정·마무리 (완료 — 재구축 전체 완료)
- [x] SettingsPage 1,594 → 240줄: features/settings/ 12개 모듈 (백업/복원, Gist, 내보내기,
      마이그레이션, 초기화, 대시보드 위젯 설정 등 — 위험 흐름의 confirm/토스트 문구·순서 보존)
- [x] package.json `"type": "module"` 추가 (node 도구 경고 제거 — check-text/kr-names/smoke 재검증 완료)
- [x] DividendsPage 죽은 코드 제거 (미사용 priceKrwByTicker 맵 + 불필요 memo 의존성)
- 정리하지 않기로 한 것 (의도적 보존):
  - PRICE_API_ENABLED — 미사용으로 보고됐었으나 실제로 자동 시세 갱신 토글이 사용 중
  - OCR ReceiptScanner 스텁 — 가계부 폼에 노출된 버튼이라 제거 시 가시적 변화. 기능 구현 또는 제거는 사용자 결정 사항
  - knip가 보고하는 미사용 export 타입 ~45건 — 훅/모듈 API 계약을 문서화하는 타입이라 보존

### 각 Phase 공통 완료 조건
- `npm run ci` (check-text + lint + build + smoke) 통과, vitest 352+ 통과
- 해당 페이지 수동 동작 확인 후 main 푸시 → Pages 자동 배포

## 데이터 이전 체크리스트 (다른 기기/브라우저에서 새 앱 쓸 때)
1. 기존 앱 설정 탭 → 데이터 내보내기(JSON) (또는 data/farmwallet-data.json 사용)
2. 새 URL 접속 → 설정 탭 → 데이터 가져오기
3. Gist 동기화 사용자라면 토큰 입력만 하면 자동 풀
