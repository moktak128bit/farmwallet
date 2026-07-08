# 현 상태 정밀 재감사 — 2026-06-29

> **실행 상태**: 명확한 돈-계산 수정 4건 + 데이터유실 수정 + 대형파일 분해 1건 완료. 세금 산식은 사용자 결정으로 보류.
> 검증 = lint·knip 클린, **774 테스트 통과**(+17), prod build OK. 상세는 맨 아래 [실행 결과](#실행-결과-2차).


로드맵(docs/roadmap-2026-06-22.md, 일주일 전) 이후 실제 구현 상태를 코드 기준으로 4개 영역 병렬 재감사. 돈 계산 정확성과 서버 없는 앱의 데이터 내구성에 집중.

## 한 줄 진단

**로드맵 Track A(성과·리스크)·B1·B3(세금)·C1(선행배당)·D2·D3 대부분 구현 완료.** 골격은 견고하나, 돈 계산 정밀도 버그 2건 + 데이터-유실 경로 1건 + 로드맵 꼬리 미구현(A4·B2·B4) + FIFO 4중복이 남음.

## 구현 현황 (검증됨)

| 영역 | 상태 | 근거 |
|---|---|---|
| A0 일별 평가액 시계열 | ✅ | portfolioHistory.ts, dailyFx.ts, useDailyFxRecorder |
| A1 벤치마크 | ✅ (USD 환산 버그) | portfolioBenchmark.ts, useBenchmarkRecorder |
| A2 진짜 TWR | ✅ 일별 chain-link (가짜 아님) | twr.ts |
| A3 리스크(변동성·MDD·샤프·베타) | ✅ | riskMetrics.ts |
| B1 종합과세 YTD | ✅ (추가세 산식 버그) | ComprehensiveTaxCard, taxCalculator.ts |
| B3 미국 양도세 | ✅ FIFO·환율보존·250만공제·손실수확 | usCapitalGainsTax.ts |
| C1 선행 배당 | ⚠️ 과거실적 복붙(보유 미반영) | forwardDividends.ts |
| D1 복원 해시검증 | ⚠️→✅ 부팅 경로 수정함 | main.tsx (이번 수정) |
| D2 Gist 스냅샷 | ✅ | useGistSync, App handleGistPulledData |
| D4 필드 커버리지 | ✅ 27필드 양경로 round-trip | dataService/tableDataBackup |
| E1 리밸런싱 원클릭 | ✅ "이대로 입력"→prefillTrade | TargetPortfolioSection:660 |
| A4 자산배분 X-ray | ❌ 미구현 | TickerInfo에 sector/region 없음 |
| B2 ISA/연금 한도 | ❌ 미구현 | — |
| B4 절세 액션 카드 | ❌ 미구현 | B1·B3 흩어짐 |

---

## 🔴 즉시 처리 (돈 계산·데이터)

### 1. 데이터 유실 경로 — ✅ 이번에 수정
[main.tsx:28](src/main.tsx#L28) 에러 화면 "최신 백업 복원"이 `loadBackupData`(검증 없음)+안전스냅샷 없이 덮어쓰던 것 → `loadBackupDataVerified`(SHA-256)+손상 시 confirm+직전 안전스냅샷으로 교체. **D1 완전 폐쇄.**

### 2. 종합과세 추가세 산식 — 제품 결정 필요
[taxCalculator.ts:51-54](src/utils/taxCalculator.ts#L51) `amountOverThreshold * (0.24 - 0.154)` — 한계세율 24% 고정 가정. 실제 종합과세는 타 종합소득과 합산 누진(6~45%)+비교과세라, 타 소득 큰 사용자에게 추가세를 **심각하게 과소평가**. 보고서([TaxReportSection.tsx:55](src/features/reports/TaxReportSection.tsx#L55))에 구체 금액으로 노출. **"개략" 주석은 있으나 단일 금액이 오판 유도.**
→ 선택지: (a) 사용자 한계세율 입력 1칸 받아 `(한계세율−15.4%)×초과분`, (b) 단일 금액 제거하고 정성 안내("타 소득에 따라 달라짐"). `taxCalculator.test.ts:111`이 틀린 산식 고정 중 → 함께 갱신.

### 3. 벤치마크 USD 지수 환율 미반영
[portfolioBenchmark.ts:80-87](src/utils/portfolioBenchmark.ts#L80) `^GSPC`/QQQ(USD 지수)를 로컬 수익률로만 100-정규화. KRW 포트와 비교 시 환율 변동폭만큼 α 왜곡(KOSPI는 무관). → `buildBenchmarkComparison`에 FX 이력 주입, USD 지수일 때 `close × fxAsOf(date)`로 KRW-정규화. 회귀 테스트 부재(가장 시급한 테스트 공백).

---

## 🟠 정밀도·구조

- **C1 선행배당 보유 미반영** — [forwardDividends.ts:34](src/utils/forwardDividends.ts#L34) 과거 12개월 실적을 같은 달 복붙. 매도 종목도 계속 투영(과대), 신규 매수 미반영(과소), 지급예정일 캘린더 없음. → "현재 보유 × 직전 주당배당"으로 전환.
- **FIFO lot 소비 4중 재구현** — usCapitalGainsTax:93·investmentRecord:142·StockDetailModal:200·computePositions. 공유 `consumeFifoLots()` 유틸로 통합 시 머니매스 버그면 축소. **먼저 부분-lot 분할/oversell 회귀 테스트**(현재 단일 full-lot만 검증) → 통합 → StockDetailModal 분해.
- **벤치마크 베타 휴장일-0 왜곡** — portfolioPerformance:130. 벤치 carry-forward로 휴장일 수익률 0 섞여 베타 과대. 실제 종가 변동일만 페어링.
- **Track A 환율 fallback-to-0** — twr.ts buildDailyNetFlowKRW `?? 0`: FX 전무 USD 매수가 flow 0이 되어 입금이 수익으로 잡힐 수 있음(과거 import 데이터 한정).

## 🔵 테스트 공백 (머니매스)
- USD 지수 벤치마크 + 환율변동 (#3 가드) — 전무
- FIFO 부분-lot 분할/oversell — 전무
- `saveData→loadData` 27필드 round-trip — 부재(신규 필드 누락 회귀 차단용)
- cross-year TWR·연율화·FX 갭 carry-forward

## 🟢 로드맵 꼬리·미래 (미구현)
- A4 자산배분 X-ray(섹터/지역/통화) — TickerInfo 메타 추가 필요
- B2 ISA/연금/IRP 한도·세액공제 / B4 절세 액션 카드(B1+B3+B2 통합)
- G1 통합 현금흐름 예측 / 순자산·FIRE 시뮬레이터 (A0 시계열 재활용)

## 대형 파일 분해 우선순위
1. dataService.ts(1198) — 마이그레이션 체인+필드 어셈블리(유실위험). 순수파트(migrations/normalizers/presets) 먼저 추출.
2. reportGenerator.ts(1527) — 순수함수·테스트 탄탄, 저위험 고이득.
3. LedgerPage.tsx(1054) — churn 높음, 드래그선택 리스너 추출 위험.
4. StockDetailModal.tsx(905) — 탭 분리 + FIFO 통합.

---

## 권장 실행 순서
1. **(완료) 데이터-유실 수정** + `saveData→loadData` round-trip 테스트
2. **벤치마크 USD 환율 수정 (#3)** + 회귀 테스트 — 명확한 돈-수학 버그
3. **FIFO 테스트 → 공유 유틸 통합** — 머니매스 버그면 축소
4. **세금 산식 (#2)** — 제품 결정 후(한계세율 입력 vs 정성 안내)
5. 그 위에 미래 기능 1개(통합 현금흐름/FIRE) 또는 로드맵 꼬리(A4/B2/B4)

---

## 실행 결과 (2차)

사용자 결정: 명확한 돈-계산 수정 4건 진행 → 세금 보류 → 대형파일 분해. 모두 적용·검증(774 테스트, build OK).

- **데이터 유실 🔴** — [main.tsx:28](src/main.tsx#L28) 에러화면 복원을 `loadBackupDataVerified`(SHA-256)+손상 시 confirm+직전 `saveSafetySnapshot`로 교체. **D1 완전 폐쇄.**
- **벤치마크 USD 환율 🔴** — [portfolioBenchmark.ts](src/utils/portfolioBenchmark.ts)에 `benchmarkCurrency`+`fxHistory` 파라미터 추가, USD 지수는 `close × fxAsOf(date)`로 KRW 환산 후 비교. 호출부([portfolioPerformance.ts](src/utils/portfolioPerformance.ts) `benchmarkCurrencyOf`: ^KS/^KQ=KRW, 그 외 USD)에서 FX 주입. 회귀 테스트 4건(환율 21% 케이스 등).
- **FIFO 4중복 🟠** — 공유 [`consumeFifoLots`](src/utils/fifoLots.ts)(onConsume 콜백 지원) 신설 + 부분lot/oversell 테스트 7건. usCapitalGainsTax·investmentRecord·StockDetailModal 3사이트 통합(computePositions 정식본은 보존).
- **round-trip 가드 🔵** — [dataService.test.ts](src/__tests__/dataService.test.ts) `save→load` 신규 옵션필드 일괄 보존 테스트(필드 누락 트랩 영구 차단).
- **C1 선행배당 보유반영 🟠** — [forwardDividends.ts](src/utils/forwardDividends.ts)에 `currentQtyByTicker` 옵션. 매도 종목(보유 0) 미래 제외 + (현재/배당당시) 비례 스케일. [DividendsPage](src/pages/DividendsPage.tsx)→[DividendCalendarCard](src/features/dividends/DividendCalendarCard.tsx) positions 주입. 테스트 5건.
- **대형파일 분해** — dataService 순수 정규화 8함수를 [dataNormalizers.ts](src/services/dataNormalizers.ts)로 분리(dataService 1198→947줄). round-trip+마이그레이션 테스트가 안전망.

**보류**: 세금 종합과세 추가세 24% 고정 산식([taxCalculator.ts:51](src/utils/taxCalculator.ts#L51)) — 사용자 결정 대기.
**미진행(다음 후보)**: 대형파일 분해 잔여(reportGenerator 1527·LedgerPage 1054·StockDetailModal 905), 로드맵 꼬리(A4 X-ray·B2 한도·B4 절세카드), 미래(G1 현금흐름/FIRE), Track A 잔여(베타 휴장일-0·weekly endDate).
