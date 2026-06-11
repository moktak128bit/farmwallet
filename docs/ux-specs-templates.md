# templates 최종 스펙

## 최종 구현 스펙: 가계부 "자주 쓰는 거래" 템플릿 칩 (ledgerTemplates 부활)

### 0. 전제 (검증 완료 — 재확인 불필요)
- 데이터 마이그레이션 불필요: `data\farmwallet-data.json`에 `"ledgerTemplates": []` 이미 존재, `src\services\dataService.ts`(525/893/945행)와 `src\utils\tableDataBackup.ts`(411/529행)가 라운드트립 처리.
- `LedgerTemplate`(src\types.ts:184-195)은 폼 동형(form-shaped) 타입: mainCategory/subCategory/fromAccountId/toAccountId가 `LedgerFormState`(src\utils\ledgerHelpers.ts:63-77)와 동일 의미. **저장 스키마(category="지출")로 변환 금지.**
- 현재 테스트 352개(26파일) 전부 통과 상태 — 작업 후에도 동일해야 함.

### 1. src\types.ts — 주석만 추가 (코드 변경 없음)
`LedgerTemplate` 인터페이스(184행) 위에 의미 주석 추가:
```ts
/**
 * 자주 쓰는 거래 템플릿 — 필드는 LedgerFormState(폼 상태)와 동형.
 * 지출: mainCategory=중분류(예: 식비), subCategory=소분류 / 수입: subCategory=수입 중분류 /
 * 이체: mainCategory="이체", subCategory=이체 중분류.
 * 저장 스키마(LedgerEntry.category="지출")와 다름 — 변환 없이 폼에 직접 적재.
 * currency 필드 없음: USD 폼의 amount는 저장하지 않는다 (ledgerFormToTemplate 참조).
 */
```

### 2. src\utils\ledgerHelpers.ts — 순수 매핑 함수 2개 추가
import 보강: `Account`, `LedgerTemplate`을 타입 import에 추가, `import { formatAmount, parseAmount } from "./parseAmount";` 추가.

```ts
/** 템플릿 적용 결과 — 폼 상태 + 존재하지 않아 비운 계좌 id 목록 */
export interface TemplateApplyResult {
  form: LedgerFormState;
  clearedAccountIds: string[];
}

/**
 * LedgerTemplate → LedgerFormState (순수 함수).
 * 날짜=오늘(KST), id=undefined(새 항목). 존재하지 않는 계좌는 비우고 clearedAccountIds로 보고.
 * startCopy 경유 금지 — startCopy는 저장 스키마(category="지출")를 mainCategory에 넣는 다른 경로.
 */
export function ledgerTemplateToForm(
  t: LedgerTemplate,
  accounts: ReadonlyArray<Pick<Account, "id">>
): TemplateApplyResult {
  const exists = (id?: string) => !!id && accounts.some((a) => a.id === id);
  const clearedAccountIds: string[] = [];
  let fromAccountId = "";
  let toAccountId = "";
  if (t.kind !== "income" && t.fromAccountId) {
    if (exists(t.fromAccountId)) fromAccountId = t.fromAccountId;
    else clearedAccountIds.push(t.fromAccountId);
  }
  if (t.kind !== "expense" && t.toAccountId) {
    if (exists(t.toAccountId)) toAccountId = t.toAccountId;
    else clearedAccountIds.push(t.toAccountId);
  }
  return {
    form: {
      ...createDefaultLedgerForm(),
      kind: t.kind,
      mainCategory: t.kind === "transfer" ? "이체" : t.kind === "income" ? "" : (t.mainCategory ?? ""),
      subCategory: t.subCategory ?? "",
      description: t.description ?? "",
      fromAccountId,
      toAccountId,
      amount: t.amount && t.amount > 0 ? formatAmount(String(t.amount)) : ""
    },
    clearedAccountIds
  };
}

/**
 * 현재 폼 → LedgerTemplate (순수 함수). id는 호출 측이 newIdWithPrefix("LT")로 생성해 전달.
 * 템플릿에 currency 필드가 없으므로 USD 폼의 amount는 저장하지 않음 (적용 시 KRW 오해석 방지).
 */
export function ledgerFormToTemplate(
  form: LedgerFormState,
  kind: LedgerKind,
  name: string,
  id: string
): LedgerTemplate {
  const parsed = form.currency === "USD" ? 0 : parseAmount(form.amount);
  return {
    id,
    name: name.trim(),
    kind,
    mainCategory: kind === "income" ? undefined : (form.mainCategory || undefined),
    subCategory: form.subCategory || undefined,
    description: form.description.trim() || undefined,
    amount: parsed > 0 ? parsed : undefined,
    fromAccountId: kind !== "income" ? (form.fromAccountId || undefined) : undefined,
    toAccountId: kind !== "expense" ? (form.toAccountId || undefined) : undefined
  };
}
```

### 3. src\App.tsx — memo 계약 준수 핸들러
다른 useCallback 핸들러들 근처(예: handleQuickEntryAdd 388행 부근)에 추가. **top-level 타입 import를 추가하지 말고** 388행 선례대로 인라인 import 타입 사용:
```tsx
const handleChangeLedgerTemplates = useCallback(
  (ledgerTemplates: import("./types").LedgerTemplate[]) =>
    setDataWithHistory((prev) => ({ ...prev, ledgerTemplates })),
  [setDataWithHistory]  // useUndoRedo.ts:13의 useCallback — 안정 확인됨
);
```
766행 교체: `onChangeTemplates={handleChangeLedgerTemplates}`. 764행 `ledgerTemplates={data.ledgerTemplates ?? []}`은 그대로 둔다.

### 4. src\pages\LedgerPage.tsx — 언더스코어 해제 + 전달
- 74행: `ledgerTemplates: _ledgerTemplates = []` → `ledgerTemplates = []`
- 76행: `onChangeTemplates: _onChangeTemplates` → `onChangeTemplates`
- LedgerEntryForm JSX(832-846행)에 두 prop 추가: `ledgerTemplates={ledgerTemplates}` `onChangeTemplates={onChangeTemplates}`
- `LedgerTemplate` 타입은 23행에서 이미 import됨 — 추가 import 불필요.

### 5. 신규 src\features\ledger\LedgerTemplateChips.tsx
```tsx
/**
 * 자주 쓰는 거래(템플릿) 칩 행 — LedgerEntryForm 내부 전용.
 * React.memo — 부모가 넘기는 콜백은 안정적(useCallback)이어야 memo가 효과를 가진다.
 * 부모(폼)는 form을 deps에 넣지 않은(latest-ref) 콜백을 전달해 타이핑 중 재렌더를 막는다.
 */
import React from "react";
import type { LedgerTemplate } from "../../types";

const kindLabel: Record<LedgerTemplate["kind"], string> = { income: "수입", expense: "지출", transfer: "이체" };

interface Props {
  templates: LedgerTemplate[];
  onApply: (t: LedgerTemplate) => void;
  onSaveCurrent: () => void;
  onOpenManage: () => void;
}

export const LedgerTemplateChips = React.memo(function LedgerTemplateChips({
  templates, onApply, onSaveCurrent, onOpenManage
}: Props) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
      {templates.length > 0 && (
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>자주 쓰는 거래</span>
      )}
      {templates.map((t) => {
        const cat = [t.mainCategory, t.subCategory].filter(Boolean).join(" > ") || "-";
        const acct = [t.fromAccountId, t.toAccountId].filter(Boolean).join(" → ");
        return (
          <button
            key={t.id}
            type="button"
            tabIndex={-1}
            className="secondary"
            onClick={() => onApply(t)}
            title={`${kindLabel[t.kind]} / ${cat}${acct ? ` / ${acct}` : ""}`}
            style={{ fontSize: 12, padding: "6px 12px", maxWidth: 200 }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>
              {t.name}
            </span>
            {t.amount ? (
              <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>· {t.amount.toLocaleString()}원</span>
            ) : null}
          </button>
        );
      })}
      <button type="button" tabIndex={-1} className="secondary" onClick={onSaveCurrent} style={{ fontSize: 11, padding: "4px 8px" }}>
        템플릿으로 저장
      </button>
      {templates.length > 0 && (
        <button type="button" tabIndex={-1} className="secondary" onClick={onOpenManage} style={{ fontSize: 11, padding: "4px 8px" }}>
          관리
        </button>
      )}
    </div>
  );
});
```
주의: 모든 버튼에 `type="button"` + `tabIndex={-1}` **필수** — 폼 내부라 기본 type=submit이면 칩 클릭이 폼을 제출한다. 색상은 CSS 변수만(라이트/다크/고대비 자동 대응). `var(--muted)`는 styles.css에 정의돼 있지 않으므로(PresetSection의 잠재 버그) `var(--text-muted)` 사용.

### 6. 신규 src\features\ledger\LedgerTemplateManageModal.tsx
PresetModal.tsx(src\features\stocks) 구조 미러 — modal-backdrop(onClick=onClose) + modal(stopPropagation) + modal-header + 닫기 버튼.
```tsx
interface Props {
  templates: LedgerTemplate[];
  onClose: () => void;
  onApply: (t: LedgerTemplate) => void;   // 적용 후 모달 닫기는 이 컴포넌트가 onClose 호출
  onDelete: (t: LedgerTemplate) => void;  // confirm+toast는 부모(폼)의 deleteTemplate이 수행
}
```
- 테이블(`className="data-table"`) 컬럼: 이름 / 종류(수입·지출·이체) / 카테고리(`mainCategory > subCategory`) / 금액(`amount?.toLocaleString() ?? "-"`, `className="number"`) / 출금 / 입금 / 작업(적용·삭제).
- **'마지막 사용' 컬럼 넣지 말 것** — v1은 lastUsed 미갱신이라 항상 "-"인 죽은 컬럼.
- 적용 버튼: `onApply(t); onClose();`. 삭제 버튼: `className="danger"`, `onDelete(t)`.
- 0개일 때: `<p className="hint">저장된 템플릿이 없습니다.</p>`.
- 모든 버튼 `type="button"`.

### 7. src\features\ledger\LedgerEntryForm.tsx — 배선
**(a) import/Props/상태**
- import 추가: `LedgerTemplate` 타입, `ledgerTemplateToForm`/`ledgerFormToTemplate`(ledgerHelpers — 기존 import 줄에 병합), `LedgerTemplateChips`, `LedgerTemplateManageModal`.
- 모듈 스코프(컴포넌트 밖)에 `const EMPTY_TEMPLATES: LedgerTemplate[] = [];` 추가 — `?? []` 신규 배열 생성으로 인한 memo 무효화 방지.
- Props 추가(둘 다 optional — onChangeTemplates 부재 시 템플릿 UI 전체 미렌더):
```ts
/** 자주 쓰는 거래 템플릿 — onChangeTemplates가 없으면 칩 UI를 렌더하지 않음 */
ledgerTemplates?: LedgerTemplate[];
onChangeTemplates?: (next: LedgerTemplate[]) => void;
```
- 로컬 상태/ref (isCopyingRef 93행 근처에):
```tsx
const [showTemplateManage, setShowTemplateManage] = useState(false);
// form 최신값 미러 — 템플릿 콜백을 form 의존 없이 안정 참조로 유지 (memo 계약).
// form을 deps에 넣으면 키 입력마다 콜백 참조가 바뀌어 LedgerTemplateChips의 memo가 무효가 된다.
const latestFormRef = useRef(form);
useEffect(() => { latestFormRef.current = form; });
```

**(b) applyTemplate** — startCopy(393-438행)의 isCopyingRef + setTimeout(10ms/200ms) 가드 패턴 재사용. **startCopy 호출 금지**:
```tsx
const applyTemplate = useCallback((t: LedgerTemplate) => {
  if (latestFormRef.current.id) {
    if (!confirm(`수정 중인 항목이 있습니다. 템플릿 "${t.name}"을(를) 적용하면 수정 내용이 사라집니다. 계속할까요?`)) return;
  }
  const { form: nextForm, clearedAccountIds } = ledgerTemplateToForm(t, accounts);
  const nextTab: LedgerTab = t.kind; // income|expense|transfer ⊂ LedgerTab
  isCopyingRef.current = true;
  setFormKindWhenAll(t.kind); // "전체" 복귀 시 kind 유지 — 토글 버튼(556행)과 동일 규칙
  if (nextTab !== ledgerTab) {
    // kind가 바뀌면 하위 카테고리 필터 초기화 — 토글 버튼(558-561행)과 동일 규칙 (빈 목록 방지)
    setFilterMainCategory(undefined);
    setFilterSubCategory(undefined);
    setFilterDetailCategory(undefined);
  }
  setLedgerTab(nextTab);
  setTimeout(() => {
    setForm(nextForm);
    setTimeout(() => { isCopyingRef.current = false; }, 200);
  }, 10);
  for (const accountId of clearedAccountIds) {
    toast(`계좌 "${accountId}"가 없어 해당 항목을 비웠습니다.`);
  }
  toast.success(`템플릿 "${t.name}" 적용됨`);
}, [accounts, ledgerTab, setLedgerTab, setFilterMainCategory, setFilterSubCategory, setFilterDetailCategory]);
```
(setFormKindWhenAll·setForm·setShowTemplateManage는 로컬 setState라 deps 불필요. setLedgerTab/setFilter*는 부모 setState — 참조 안정.)

**(c) saveCurrentAsTemplate** — form은 latestFormRef로 읽음 (deps에 form 금지):
```tsx
const saveCurrentAsTemplate = useCallback(() => {
  if (!onChangeTemplates) return;
  const f = latestFormRef.current;
  const list = ledgerTemplates ?? EMPTY_TEMPLATES;
  if (list.length >= 20) { toast.error("템플릿은 최대 20개까지 저장할 수 있습니다."); return; }
  // 이체 탭은 mainCategory가 "이체"로 자동 설정되므로 검사에서 제외 (쓰레기 템플릿 방지)
  const meaningful = effectiveFormKind === "transfer"
    ? (f.subCategory || f.fromAccountId || f.toAccountId || f.description.trim())
    : (f.mainCategory || f.subCategory || f.fromAccountId || f.toAccountId || f.description.trim());
  if (!meaningful) { toast.error("저장할 내용이 없습니다 — 카테고리나 계좌를 먼저 선택하세요."); return; }
  const suggested = f.description.trim() || [f.mainCategory, f.subCategory].filter(Boolean).join("-");
  const name = prompt("템플릿 이름을 입력하세요:", suggested); // 선례: StocksPage.tsx:440
  if (!name || !name.trim()) return;
  const t = ledgerFormToTemplate(f, effectiveFormKind, name, newIdWithPrefix("LT"));
  onChangeTemplates([...list, t]);
  toast.success(`템플릿 "${t.name}" 저장됨`);
}, [ledgerTemplates, onChangeTemplates, effectiveFormKind]);
```

**(d) deleteTemplate** — LedgerTable.tsx:1134-1137의 confirm+성공 토스트 UX와 일치:
```tsx
const deleteTemplate = useCallback((t: LedgerTemplate) => {
  if (!onChangeTemplates) return;
  if (!confirm(`템플릿 "${t.name}"을(를) 삭제하시겠습니까?`)) return;
  onChangeTemplates((ledgerTemplates ?? EMPTY_TEMPLATES).filter((x) => x.id !== t.id));
  toast.success(`템플릿 "${t.name}" 삭제됨`);
}, [ledgerTemplates, onChangeTemplates]);

const openTemplateManage = useCallback(() => setShowTemplateManage(true), []);
const closeTemplateManage = useCallback(() => setShowTemplateManage(false), []);
```

**(e) 렌더 배치**
- 칩: 624행 `display: ledgerTab === "savingsExpense" ? "none" : "block"` 래퍼 **안쪽 최상단**, 날짜/금액 그리드(626행) 직전:
```tsx
{onChangeTemplates && (
  <LedgerTemplateChips
    templates={ledgerTemplates ?? EMPTY_TEMPLATES}
    onApply={applyTemplate}
    onSaveCurrent={saveCurrentAsTemplate}
    onOpenManage={openTemplateManage}
  />
)}
```
- 관리 모달: `</form>` 뒤 ReceiptScanner(1107행) 옆에 조건부 렌더:
```tsx
{onChangeTemplates && showTemplateManage && (
  <LedgerTemplateManageModal
    templates={ledgerTemplates ?? EMPTY_TEMPLATES}
    onClose={closeTemplateManage}
    onApply={applyTemplate}
    onDelete={deleteTemplate}
  />
)}
```
- lastUsed: **v1에서 갱신하지 않음** (칩 클릭마다 undo 스택 엔트리 + dirty 저장이 생기는 것 방지). 타입 필드는 보존.

### 8. 신규 src\__tests__\ledgerTemplates.test.ts
vitest, 기존 테스트 스타일(describe/it/expect) 따름. 최소 케이스:
- `ledgerTemplateToForm`: (1) expense 템플릿 → mainCategory/subCategory/fromAccountId/amount("12,000" 콤마 포맷) 매핑 + date=오늘 + id=undefined + toAccountId=""; (2) income → mainCategory=""·fromAccountId=""; (3) transfer → mainCategory="이체"; (4) 존재하지 않는 계좌 → 해당 필드 "" + clearedAccountIds 보고; (5) amount 없음 → "".
- `ledgerFormToTemplate`: (1) 빈 문자열 필드 → undefined; (2) income → mainCategory/fromAccountId 제거; (3) expense → toAccountId 제거; (4) currency="USD" → amount undefined; (5) name trim.

### 9. 금지 사항
1. **startCopy 경유 금지** — 저장 스키마(category="지출")를 mainCategory에 넣는 경로라 템플릿 오적재.
2. **props 배열 in-place sort/변이 금지** — StocksPage.tsx:472의 `presets.sort()` 버그 복제 금지. v1은 정렬 자체가 없음(생성순).
3. **`PRESET-${Date.now()}` ID 패턴 금지** — `newIdWithPrefix("LT")` 사용 (id.ts 헤더의 충돌 경고).
4. **lastUsed 갱신 금지** (v1) — 적용은 순수 폼 조작이어야 함. undo/저장 트리거 오염 금지.
5. **`var(--muted)` 사용 금지** (styles.css에 미정의) — `var(--text-muted)` 사용. 인라인 hex 색상 금지(다크/고대비 테마 깨짐).
6. **폼 내부 버튼에 `type="button"` 누락 금지** — 기본 submit이라 칩 클릭이 폼 제출됨.
7. **템플릿 콜백 deps에 `form` 넣기 금지** — latestFormRef로 읽을 것 (칩 memo 무효화 방지).
8. **isCopyingRef 가드/타이밍(10ms·200ms) 변경 금지**, 202-218행 리셋 effect 수정 금지.
9. 기존 인라인 콜백(App.tsx:765 onChangeLedger 등) 일괄 리팩터링 금지 — 범위 외. startCopy의 신형 3-level 매핑 버그(408행)·setFormKindWhenAll 미호출도 수정 금지(별도 과제).
10. 칩에 × 버튼·길게 누르기(long-press) 금지 — 삭제는 관리 모달에서만(터치 스크롤·tapEdit 관행과 충돌).
11. 스키마/마이그레이션 코드 추가 금지 — 이미 존재함. dataService/tableDataBackup 수정 금지.
12. window.alert 기반 신규 모달 라이브러리 도입 금지 — confirm/prompt/react-hot-toast 기존 관행 유지.

### 10. 검증
**명령:**
```
npm run lint     # tsc --noEmit + eslint (react-hooks deps 검증 포함)
npm test         # 기존 352개 + 신규 ledgerTemplates 테스트 전부 통과해야 함
npm run build    # vite build (prebuild의 check-text 포함 — 한글 문자열 무결성)
```
**수동 체크리스트 (npm run dev):**
1. 지출 폼 채우고 "템플릿으로 저장" → prompt 기본값 = description 또는 "식비-소분류" → 저장 토스트. **칩 클릭/저장 버튼 클릭 시 폼이 제출되지 않아야 함**(type=button 확인).
2. 이체 탭에서 지출 칩 클릭 → 지출 탭 자동 전환 + 카테고리/출금계좌/금액 채워짐 + 날짜=오늘. 탭 전환 직후 카테고리가 비워지면 isCopyingRef 가드 누락.
3. 적용 직후 "전체" 탭 클릭 → 채워진 값 유지(setFormKindWhenAll 동기화 확인).
4. 카테고리 필터를 건 상태에서 다른 kind 템플릿 적용 → 필터 초기화되어 목록이 비지 않음.
5. 금액 입력란 타이핑 중 React DevTools Profiler로 LedgerTemplateChips 재렌더 없음 확인(latest-ref 콜백 검증) + LedgerPage 재렌더 없음(기존 memo 유지).
6. 관리 모달: 삭제 → confirm → 성공 토스트 → Ctrl+Z로 템플릿 복원(언두 경로). 적용 → 모달 닫힘 + 폼 적재.
7. 템플릿의 계좌를 계좌 탭에서 삭제 후 적용 → "계좌 ... 비웠습니다" 토스트 + 해당 필드만 빈 채 적재.
8. 0개 상태: "템플릿으로 저장" 버튼만 보임(라벨·관리 숨김). 21번째 저장 시 에러 토스트.
9. 재테크 보기 탭에서 칩 미노출(래퍼 display:none), 신용결제 탭에서는 노출되며 적용 시 해당 kind 탭으로 전환.
10. 다크/라이트 토글 + 고대비에서 칩·라벨 대비 확인(CSS 변수만 사용했는지). 모바일 폭(DevTools 모바일 뷰)에서 칩 flexWrap 줄바꿈·터치 탭 동작 확인.
11. 새로고침 후 템플릿 유지, 설정 탭 백업 내보내기 JSON에 ledger_templates 포함.