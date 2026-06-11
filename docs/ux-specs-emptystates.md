# emptystates 최종 스펙

# 빈 화면(Empty State) 정비 — 최종 구현 스펙

원칙: **새 props 0개, 새 콜백 0개** — 모든 분기는 기존 props/내부 state만 사용. React.memo·헤더 주석 계약 변경 없음. 모든 파일은 BOM 없는 UTF-8로 저장.

---

## 1. src/features/stocks/PositionListSection.tsx (일반 FC — memo 아님)

1-1. `</h3>`(226행) 직후, `{sortedPositionsByAccount.map(...)}`(227행) 앞에 추가:
```tsx
{positionsByAccount.length === 0 && (
  <p className=\"hint\" style={{ textAlign: \"center\", padding: 20 }}>
    아직 보유 종목이 없습니다 — 위 거래 입력 폼에서 첫 매수를 기록해 보세요.
  </p>
)}
```
1-2. h3 안의 \"계좌순서 바꾸기\" `<label>`(214~225행)을 `{positionsByAccount.length > 0 && ( ... )}`로 감싸 0건 시 숨김.

CTA 버튼 없음 — TradeFormSection이 같은 stocks 탭 바로 위에 상시 마운트(StocksPage.tsx:553).

## 2. src/features/stocks/TradeHistorySection.tsx (일반 FC — memo 아님)

2-1. **빈 행 추가**: tbody 안 `{visibleTrades.map(...)}` 닫힌 직후(957행 `})}` 와 958행 `</tbody>` 사이)에 추가:
```tsx
{sortedTrades.length === 0 && (
  <tr>
    <td colSpan={columnWidths.length} style={{ textAlign: \"center\", padding: 20, color: \"var(--text-muted)\" }}>
      {trades.length === 0 ? (
        \"아직 매매 내역이 없습니다 — 위 거래 입력 폼에서 첫 거래를 기록해 보세요.\"
      ) : (
        <span style={{ display: \"inline-flex\", alignItems: \"center\", gap: 8, flexWrap: \"wrap\", justifyContent: \"center\" }}>
          선택한 계좌에 표시할 거래가 없습니다.
          <button
            type=\"button\"
            className=\"secondary\"
            style={{ fontSize: 13, padding: \"6px 12px\" }}
            onClick={() => setFilterAccountId(null)}
          >
            전체 보기
          </button>
        </span>
      )}
    </td>
  </tr>
)}
```
- 두 메시지 구분 필수: `trades.length === 0` = 원래 없음 / 그 외 = filterAccountId로 인한 0건(필터 상태에서 마지막 거래 삭제·인라인 편집으로 계좌 이동 시 발생, 필터 자동 해제 없음).
- **'전체 보기' 버튼은 필수** — 이 시나리오에서는 계좌 필터 버튼 줄(516행, `accountIdsWithTrades.length > 1` 조건)이 함께 사라질 수 있어, 버튼이 없으면 사용자가 필터를 해제할 방법이 없다. setFilterAccountId는 컴포넌트 내부 state setter라 memo 계약과 무관.
- colSpan은 반드시 `columnWidths.length`(현재 12) 사용 — 숫자 하드코딩 금지.

2-2. **빈 요약 카드 숨김**: 542행 `<div className=\"card\" style={{ marginBottom: 16, padding: 12 }}>` ~ 589행 `</div>` 전체를 `{tradesFiltered.length > 0 && ( ... )}`로 감싼다. 내부 내용 변경 없음.

## 3. src/features/dividends/IncomeRecordsSection.tsx (React.memo — props 변경 없음)

3-1. 모듈 스코프(컴포넌트 밖, import 아래)에 헬퍼 추가 — 60행 인라인 필터와 동일 술어:
```tsx
const isDividendRow = (r: DividendRow) => !r.isInterest && (!!r.ticker || r.source.includes(\"배당\"));
```
3-2. 컴포넌트 본문(return 전)에 추가:
```tsx
const hasDividendRows = byMonthSource.some(([, rows]) => rows.some(isDividendRow));
```
3-3. 54행 분기 조건을 `byMonthSource.length === 0` → `!hasDividendRows`로 교체하고 문구 교체:
\"아직 배당 기록이 없습니다 — 위 배당 입력 폼에서 첫 배당을 기록해 보세요.\"
3-4. 60행을 헬퍼 사용으로 교체: `const dividendRowsInMonth = rows.filter(isDividendRow);` 그리고 그 직후에 이자-전용 월 스킵 추가: `if (dividendRowsInMonth.length === 0) return null;` (\"배당 합계: 0원\" 빈 월 헤더 제거)
3-5. 600~603행(이자 탭) 문구 교체: \"아직 이자 기록이 없습니다 — 위 이자 입력 폼에서 첫 이자를 기록해 보세요.\"

**주의: 3-3과 3-4는 반드시 함께 적용** — 3-4만 적용하면 이자 기록만 있는 사용자의 배당 탭이 h3만 남고 완전히 비는 버그가 생긴다(byMonthSource.length > 0이라 기존 빈 분기를 타지 않음). 부모 DividendsPage의 byMonthSource memo(241행)는 절대 건드리지 않는다(다른 소비처 영향 방지).

## 4. src/features/debt/LoanCardsSection.tsx:101~103 (React.memo — 문구 강화만)
```tsx
if (loans.length === 0) {
  return (
    <p className=\"hint\" style={{ textAlign: \"center\", padding: 20 }}>
      등록된 대출이 없습니다 — 위 '새 대출 추가' 버튼으로 첫 대출을 등록해 보세요.
    </p>
  );
}
```
버튼 CTA 미적용 확정 — 새 콜백 prop이 필요해지고, DebtPage 헤더(110행)에 '새 대출 추가' 버튼이 상시 노출되므로 이득이 없음.

## 5. src/features/budget/BudgetGoalsTable.tsx:211~217 (React.memo — 문구만)
빈 행(colSpan 7 유지) 문구 교체: \"설정된 예산이 없습니다 — 위 '예산/목표 추가' 폼에서 첫 예산을 만들어 보세요.\" (폼 제목 'h3 예산/목표 추가' 확인됨, BudgetFormCard.tsx:47)

## 6. src/features/budget/RecurringListSection.tsx (React.memo)
6-1. 584~590행 빈 행(colSpan 9 유지) 문구 교체: \"등록된 고정 지출이 없습니다 — 위 폼에서 구독·고정 지출을 추가해 보세요.\"
6-2. 하단 액션 바(594~607행 `<div style={{ marginTop: 8, ... }}>` 전체)를 `{recurring.length > 0 && ( ... )}`로 감싸 0건 시 \"반영할 항목을 선택하세요\"+비활성 버튼 숨김.

## 7. src/features/ledger/LedgerTable.tsx:1156~1162 (React.memo — 3단 분기 정밀화)
원본 `ledger` prop(39행)을 이미 받으므로 새 prop 없이:
```tsx
{filteredLedger.length === 0 && (
  <p>
    {ledger.length === 0
      ? \"아직 거래가 없습니다. 위 폼에서 첫 거래를 입력해 보세요.\"
      : viewMode === \"monthly\"
        ? \"이 달에는 내역이 없습니다.\"
        : \"현재 탭·필터 조건에 표시할 내역이 없습니다.\"}
  </p>
)}
```
- `ledger.length === 0` 분기를 **최우선**으로(monthly 기본 모드에서도 진짜 빈 데이터면 온보딩 문구가 뜨도록 개선).
- 세 번째 분기 문구는 반드시 탭·필터 중립으로 — filteredLedger는 kind 탭(ledgerByTab, LedgerPage.tsx:230)을 먼저 거치므로 \"필터를 해제해 보세요\" 류의 문구는 필터를 안 건 사용자(예: 지출만 있는데 수입 탭 열람)에게 오안내가 된다. LedgerTable에 탭 정보 prop 추가 금지.

## 8. 변경 금지 (검증 완료 — 이미 충분)
- AccountsPage:276~283 — EmptyState+CTA 존재. AccountTablesSection의 유형별 `return null`(506행)도 유지.
- workout 전체: DayWorkoutEditor(81~93행 대형 CTA), RoutineManager:80~83, MonthStats, MonthCalendar, ExerciseHistoryModal:79, ExerciseProgressionChart:42 — 모두 커버됨.

---

## 금지 사항 (위반 시 반려)
1. 빈 안내 행/문구/셀에 `cell-editable` 클래스, `onClick`(위 2-1의 명시적 버튼 제외)·`onDoubleClick`·`title=\"더블클릭하여 수정\"`, **`draggable` 속성·드래그 핸들러** 부착 금지 — isCoarsePointer 탭 편집(단일 탭=편집 진입) 및 행 드래그 정렬과의 간섭 차단. 해제 버튼은 반드시 `<button type=\"button\">` 요소로만.
2. 새 props·새 콜백 추가 금지(모든 항목이 기존 props/내부 state로 구현됨). React.memo 래핑 추가/제거 금지. 각 feature 파일 헤더의 콜백 안정성 계약 주석 수정 금지.
3. 색상은 `.hint` 클래스 또는 `var(--text-muted)`만 사용. **`var(--muted)` 사용 금지** — styles.css에 정의되지 않은 변수(기존 요약 카드 코드에 남아 있는 버그이니 복사하지 말 것). 라이트/다크/고대비 4테마 모두 --text-muted 정의 확인됨.
4. 부모 memo(byMonthSource·positionsByAccount·filteredLedger·budgetUsage 등) 및 부모 페이지 파일 수정 금지 — 이번 변경은 7개 feature 파일만 건드린다.
5. TradeHistorySection의 filterAccountId를 useEffect로 자동 해제하는 코드 금지(편집 중 화면 급변 부작용) — 해제는 2-1의 '전체 보기' 버튼으로만.
6. colSpan 숫자 하드코딩 신규 작성 금지(2-1은 columnWidths.length). 기존 7/9는 문구만 바꾸고 유지.
7. 파일 저장은 BOM 없는 UTF-8 — PowerShell Out-File/Set-Content로 파일 쓰기 금지(기본 UTF-16). check-text 게이트가 BOM·깨진 문자를 빌드에서 차단한다.

## 검증 (전부 PowerShell에서 실행 — bash에서 vitest는 모듈 러너 오류로 오탐)
```powershell
npx tsc --noEmit          # 기준: exit 0 (현재 통과 확인됨)
npm test                  # 기준: 26 files / 352 passed (현재 통과 확인됨, 문구 단언 테스트 없음)
npm run check-text        # 기준: tracked issues: 0 (현재 0 확인됨)
npm run lint              # tsc + eslint
```
수동 QA 체크리스트:
1. 데이터 0건 상태에서 주식 탭: 보유 종목 빈 문구 + '계좌순서 바꾸기' 숨김, 매매 내역 thead+빈 행, 요약 카드 박스 미표시, '총 N건' footer 미표시.
2. 계좌 2개에 거래 입력 → 한 계좌 필터 → 그 계좌 거래 전부 삭제: \"선택한 계좌에 표시할 거래가 없습니다\" + '전체 보기' 버튼 클릭 시 나머지 거래 표시(계좌 필터 버튼 줄이 사라진 상태에서도 탈출 가능해야 함).
3. 이자 기록만 있는 상태에서 배당 탭: \"아직 배당 기록이 없습니다...\" 표시(빈 월 헤더 0개), 이자 탭은 정상 표 표시.
4. 배당+이자 혼재: 이자만 있는 월의 \"배당 합계: 0원\" 헤더가 사라지고 배당 있는 월만 표시.
5. 가계부: 데이터 0건+monthly 기본 모드에서 \"아직 거래가 없습니다...\", 지출만 있는 상태의 수입 탭(전체보기)에서 \"현재 탭·필터 조건에...\" 표시.
6. 라이트/다크 테마 토글로 빈 문구 대비 확인, 모바일(또는 DevTools 터치 에뮬레이션)에서 빈 행 탭 시 아무 동작 없음 확인.