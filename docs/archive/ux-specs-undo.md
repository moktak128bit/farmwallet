# undo 최종 스펙

# 최종 구현 스펙 — 삭제 토스트 [실행 취소] 버튼 (항목 재삽입 방식)

## 설계 요약
삭제 토스트에 [실행 취소] 버튼을 추가한다. 메커니즘은 **풀 스냅샷 undo가 아니라 "삭제된 항목을 id로 재삽입"**:
- 삭제 직후 해당 항목 객체(+원래 인덱스)를 클로저로 캡처해 두고, 버튼 클릭 시 **클릭 시점의 최신 배열**(`useAppStore.getState()`)에 그 항목이 없으면 다시 끼워 넣는다.
- 삭제 후 시세 자동갱신·Gist pull·탭 동기화·다른 편집이 끼어들어도 그 변경을 보존한 채 삭제 항목만 복원된다.
- 복원은 기존 onChange* 콜백(→ App의 setDataWithHistory) 경유의 **새 히스토리 write**이므로 Ctrl+Z로 복원 자체를 다시 취소할 수 있고, redo 의미론도 기존 규칙 그대로다.
- onChange* 콜백은 조립자 계약상 안정적이므로 토스트 클로저가 캡처해도 안전하다(App의 inline arrow도 setDataWithHistory(useCallback [setData])만 닫아 과거 인스턴스 호출이 정확히 동작함 — App.tsx:750-816 확인됨).

전제(코드 주석에 명시할 것): zustand store의 setData는 동기(src/store/appStore.ts:18-21)이므로 getState() 재조회가 항상 최신이다.

## 1. 신규 파일: src/utils/undoToast.tsx
```tsx
/**
 * 삭제 토스트 + [실행 취소] 버튼.
 * 풀 스냅샷 undo가 아니라 \"삭제 항목 재삽입\" 복원:
 *  - 삭제 이후 다른 변경(시세 갱신·Gist pull·탭 동기화·다른 편집)이 있어도
 *    그 변경을 보존한 채 삭제된 항목만 되살린다.
 *  - 복원은 onChange*(→ setDataWithHistory) 경유의 새 히스토리 write라
 *    Ctrl+Z로 복원 자체를 다시 취소할 수 있다.
 * 전제: appStore.setData는 동기(zustand) — 클릭 시점 getState() 재조회가 항상 최신.
 * 호출부 계약: 부모가 넘기는 onChange*는 안정적(조립자 계약)이므로 클로저 캡처 안전.
 */
import { toast } from \"react-hot-toast\";

/** id 기준 재삽입 복원 함수 생성. 이미 존재하면 false(no-op). index 지정 시 그 위치로 splice. */
export function buildRestoreById<T extends { id: string }>(
  getList: () => T[] | undefined,
  apply: (next: T[]) => void,
  item: T,
  index?: number
): () => boolean {
  return () => {
    const list = getList() ?? [];
    if (list.some((x) => x.id === item.id)) return false;
    const next = [...list];
    if (index != null && index >= 0 && index <= next.length) next.splice(index, 0, item);
    else next.push(item);
    apply(next);
    return true;
  };
}

/** 삭제 직후 호출. message는 기존 토스트 문구 그대로 전달할 것. */
export function showDeleteUndoToast(message: string, restore: () => boolean): void {
  let handled = false; // 더블클릭/더블탭 가드
  toast.success(
    (t) => (
      <span style={{ display: \"flex\", alignItems: \"center\", gap: 12, flexWrap: \"wrap\" }}>
        <span>{message}</span>
        <button
          type=\"button\"
          className=\"primary\"
          style={{ padding: \"6px 14px\", fontSize: 13, flexShrink: 0 }}
          onClick={() => {
            if (handled) return;
            handled = true;
            toast.dismiss(t.id);
            if (restore()) {
              toast.success(\"삭제를 되돌렸습니다.\", { id: \"delete-undo-result\" });
            } else {
              toast.error(\"이미 복원되었거나 데이터가 변경되어 되돌릴 수 없습니다.\", { id: \"delete-undo-result\" });
            }
          }}
        >
          실행 취소
        </button>
      </span>
    ),
    { id: \"delete-undo\", duration: 7000 }
  );
}
```
주의:
- 버튼은 반드시 전역 `className=\"primary\"` 사용(styles.css:808 button.primary — light/dark/high-contrast/high-contrast.dark 4개 테마와 focus-visible 자동 대응). 색상 하드코딩·var(--accent) 인라인 금지.
- id `\"delete-undo\"` 고정: 연속 삭제 시 직전 토스트가 교체되어 **마지막 삭제만** 버튼으로 복원 가능(이전 것은 Ctrl+Z) — 의도된 동작, 파일 주석에 명시.
- 기존 Ctrl+Z 피드백 토스트 id `\"undo\"`(App.tsx:368)·`\"redo\"`와 분리됨.
- duration: Infinity 금지.

## 2. 호출부 6곳 수정 (기존 confirm 로직·메시지 문자열은 그대로, toast.success 한 줄만 교체/추가)
각 파일에 import 추가: `import { showDeleteUndoToast, buildRestoreById } from \"<상대경로>/utils/undoToast\";` 및 `import { useAppStore } from \"<상대경로>/store/appStore\";`
**useAppStore는 이벤트 핸들러 내부 `useAppStore.getState()`만 사용 — 훅으로 구독 금지(재렌더 유발·memo 무력화 방지). 선례: src/features/dashboard/InvestmentSummaryCard.tsx.**

### 2-1. src/features/ledger/LedgerTable.tsx (현재 :1134-1136 confirm 블록 내부)
`onChangeLedger(ledger.filter(...))` 직전에 원본 엔트리 캡처, 기존 toast.success 교체:
```tsx
const deletedEntry = ledger.find((entry) => entry.id === l.id);
onChangeLedger(ledger.filter((entry) => entry.id !== l.id));
if (deletedEntry) {
  showDeleteUndoToast(
    `삭제했습니다: ${l.date} ${amountText}`,
    buildRestoreById(() => useAppStore.getState().data.ledger, onChangeLedger, deletedEntry)
  );
} else {
  toast.success(`삭제했습니다: ${l.date} ${amountText}`);
}
```
주의: `l`은 LedgerDisplayRow(LedgerEntry & {_tradeId?}) — 반드시 ledger 배열에서 찾은 원본을 재삽입(_tradeId 행은 :1128-1131에서 이미 삭제 차단됨, 그 분기는 건드리지 말 것).

### 2-2. src/features/dividends/IncomeRecordsSection.tsx 배당 삭제 (현재 :553-557)
```tsx
onChangeLedger(newLedger);
showDeleteUndoToast(
  \"배당 기록이 삭제되었습니다.\",
  buildRestoreById(() => useAppStore.getState().data.ledger, onChangeLedger, ledgerEntry)
);
```

### 2-3. 같은 파일 이자 삭제 (현재 :756-759) — 동일 패턴, 메시지 \"이자 기록이 삭제되었습니다.\", item은 `ledgerEntry`.

### 2-4. src/features/debt/RepaymentHistorySection.tsx handleDeleteRepayment (현재 :110-120)
```tsx
onChangeLedger(ledger.filter((l) => l.id !== entry.id));
showDeleteUndoToast(
  \"상환 내역이 삭제되었습니다.\",
  buildRestoreById(() => useAppStore.getState().data.ledger, onChangeLedger, entry)
);
```
(함수 첫 줄 `if (!onChangeLedger) return;` 가드 유지 — 이후엔 non-null.)

### 2-5. src/features/budget/BudgetGoalsTable.tsx deleteBudget (현재 :31-35)
```tsx
const deleteBudget = (id: string, category: string) => {
  if (!window.confirm(`\"${category}\" 예산을 삭제하시겠습니까?`)) return;
  const index = budgets.findIndex((b) => b.id === id);
  const deleted = index >= 0 ? budgets[index] : undefined;
  onChangeBudgets(budgets.filter((b) => b.id !== id));
  if (deleted) {
    showDeleteUndoToast(
      `\"${category}\" 예산이 삭제되었습니다.`,
      buildRestoreById(() => useAppStore.getState().data.budgetGoals, onChangeBudgets, deleted, index)
    );
  } else {
    toast.success(`\"${category}\" 예산이 삭제되었습니다.`);
  }
};
```
(index 전달 — 예산 표는 배열 순서대로 렌더되므로 원래 위치로 복원.)

### 2-6. src/features/accounts/sections/AccountTablesSection.tsx handleDeleteAccount (현재 :60-78) — 토스트 신규 추가
함수 끝부분을 다음으로 교체:
```tsx
const index = safeAccounts.findIndex((a) => a.id === id);
const deleted = index >= 0 ? safeAccounts[index] : undefined;
onChangeAccounts(safeAccounts.filter((a) => a.id !== id));
if (deleted) {
  showDeleteUndoToast(
    `\"${deleted.name}\" 계좌가 삭제되었습니다.`,
    buildRestoreById(() => useAppStore.getState().data.accounts, onChangeAccounts, deleted, index)
  );
}
```
(index 전달 — 계좌는 드래그 순서가 의미 있음. 계좌 삭제는 참조 레코드를 보존하므로 재삽입만으로 완전 복원됨. 행 버튼 confirm(:478-492)과 내부 2차 confirm의 중복은 pre-existing — 이번에 건드리지 말 것.)

## 3. 테스트: 신규 src/__tests__/undoToast.test.tsx
※ 현재 vitest 하니스가 베이스라인부터 완파 상태(아래 5절) — 테스트는 **작성하되**, 실행 실패가 이 변경 탓이 아님을 인지할 것.
- buildRestoreById 단위 테스트(스토어 불필요 — getList/apply를 로컬 배열 클로저로 주입):
  1) 항목 없음 → append 복원, apply 1회 호출, true 반환
  2) index 지정 → 해당 위치 splice
  3) id 이미 존재 → false, apply 미호출 (더블클릭·Ctrl+Z 선복원·Gist 복원 케이스)
  4) getList가 undefined 반환 → 빈 배열 취급 후 append
  5) index가 범위 밖(음수/length 초과) → append 폴백
- showDeleteUndoToast 통합 테스트(jsdom): `<Toaster />` 렌더 후 호출 → \"실행 취소\" 버튼 클릭 → restore 1회 호출 확인, 연속 2회 클릭 → restore 여전히 1회(handled 가드).
- 기존 src/__tests__/useUndoRedo.test.tsx는 **수정 금지**.

## 4. 금지 사항
- src/hooks/useUndoRedo.ts, src/App.tsx, src/hooks/useKeyboardShortcuts.ts **수정 금지** (이번 변경은 이 파일들을 건드리지 않고 성립한다).
- 모듈 싱글턴 언두 버스, 세대(generation) 카운터, 히스토리 우회 경로(useAppData/useMarketEnvSnapshotRecorder/InvestmentSummaryCard 등) bump 주입 — **도입 금지**.
- feature 컴포넌트의 props 인터페이스 변경 금지 (React.memo 콜백 안정성 계약 — 각 파일 헤더 주석 참조). 이번 변경은 모듈 함수 import만 추가한다.
- useAppStore를 컴포넌트 본문에서 훅으로 구독 금지 — 핸들러 내 getState()만.
- 기존 confirm 문구·삭제 토스트 메시지 문자열 변경 금지(버튼만 추가).
- 적용 제외(손대지 말 것): src/features/stocks/TradeHistorySection.tsx 거래 삭제(trades 즉시 + accounts setTimeout(0) 2-write라 단일 재삽입으로 복원 불가 — 추후 단일 write로 합친 뒤 별도 적용), IncomeRecordsSection \"이자로 변환\"(:511, 삭제 아님), LoanCardsSection·RoutineManager(토스트 자체 없음), useSearch.ts:133 필터 삭제(localStorage — AppData 아님), BackupSnapshotCard.tsx:49(백업 정리 — AppData 아님).
- package.json 의존성 변경·vitest 버전 변경 금지(하니스 복구는 별도 작업). 토스트 duration: Infinity 금지. 색상 하드코딩 금지(테마 변수/전역 버튼 클래스만).

## 5. 검증 (반드시 이 순서로)
현재 베이스라인 상태(구현 전 확인된 사실): `npx tsc --noEmit` **그린**, `npx vitest run`은 **26/26 스위트가 describe 시점 `TypeError: Cannot read properties of undefined (reading 'config')`로 전부 실패(테스트 0개 수집)** — vitest 4.1.3 환경 문제로 이번 작업과 무관한 pre-existing. 이를 \"고치려고\" vitest를 올리거나 내리지 말고 결과 보고에 별도 이슈로 명기할 것.
1. `npx tsc --noEmit` — 그린 유지(필수 게이트).
2. `npm run lint` — eslint 포함.
3. `npm run build` — 번들 성공.
4. `npx vitest run src/__tests__/undoToast.test.tsx` — 환경 오류(위 TypeError)로 실패하면 허용(기존 26개와 동일 증상일 것). **다른 종류의 오류**면 테스트/구현 문제이므로 수정.
5. 수동 시나리오(`npm run dev`):
   a) 가계부·배당·이자·상환·예산·계좌 각각 삭제 → 토스트 [실행 취소] 클릭 → 항목 복원 확인(예산·계좌는 원래 위치).
   b) 삭제 → 다른 항목 수정 → [실행 취소] → 삭제 항목만 복원되고 수정은 보존.
   c) 삭제 → Ctrl+Z(스냅샷 복원) → [실행 취소] → \"이미 복원되었거나...\" 안내, 중복 삽입 없음.
   d) [실행 취소]로 복원 → Ctrl+Z → 다시 삭제됨(복원이 히스토리 1단계).
   e) 버튼 더블클릭 → 1회만 동작.
   f) 다크 모드·고대비 모드(.high-contrast)에서 버튼 가독성, 모바일 뷰포트(coarse pointer)에서 탭 동작.
6. `git diff --stat`으로 변경 파일이 정확히 7개(신규 undoToast.tsx + 테스트 1 + 호출부 5... 계좌 포함 6)+α인지 확인 — useUndoRedo.ts/App.tsx가 diff에 있으면 잘못된 것.

## 6. 후속 과제 (이번 범위 아님 — 보고에만 포함)
1) vitest 하니스 복구(베이스라인 26개 스위트 전부 환경 오류 — `npm ci` 재설치부터 시도).
2) useUndoRedo.ts 잠재 버그: handleUndo/handleRedo deps [data,setData] + redoStackRef.push(클로저 data) — 현재는 useKeyboardShortcuts가 매 렌더 재구독이라 미발현이지만, dataRef 패턴으로 안정화 권장(하니스 복구 후).
3) Ctrl+Z 풀 스냅샷 복원이 히스토리 우회 write(useAppData.ts:291·304 탭 동기화, InvestmentSummaryCard.tsx 투자목표, useMarketEnvSnapshotRecorder.ts 스냅샷)를 통째로 되돌리는 pre-existing 위험.
4) TradeHistorySection 거래 삭제의 2-write를 단일 setDataWithHistory로 합친 뒤 동일 토스트 적용.
5) 계좌 삭제의 이중 confirm(행 버튼 + handleDeleteAccount 내부) 정리.