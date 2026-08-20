// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import type { AppData, LedgerEntry, RecurringExpense } from "../types";

// react-hot-toast 모킹 — 반영 후 showDeleteUndoToast 호출 여부 검사
vi.mock("react-hot-toast", () => {
  const success = vi.fn();
  const error = vi.fn();
  const dismiss = vi.fn();
  const toast = Object.assign(vi.fn(), { success, error, dismiss });
  return { toast, default: toast };
});
// 오늘을 고정 — findOverdueRecurring 기본 refDate
vi.mock("../utils/date", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../utils/date")>();
  return { ...mod, getTodayKST: () => "2026-06-20" };
});

import { toast } from "react-hot-toast";
import { useAppStore } from "../store/appStore";
import { getEmptyData } from "../services/dataService";
import { RecurringDueBadge } from "../components/RecurringDueBadge";

function rec(o: Partial<RecurringExpense> & { id: string; title: string; amount: number }): RecurringExpense {
  return { category: "구독비", frequency: "monthly", startDate: "2026-01-15", ...o } as RecurringExpense;
}
function entry(o: Partial<LedgerEntry> & { id: string; amount: number; date: string }): LedgerEntry {
  return { kind: "expense", category: "지출", description: "", ...o } as LedgerEntry;
}

let changeCalls: LedgerEntry[][] = [];
const goBudget = vi.fn();

/** App.tsx 배선 흉내 — onChangeLedger가 store를 갱신하고(setDataWithHistory 대역) 호출 횟수를 센다 */
function Harness() {
  const data = useAppStore((s) => s.data);
  const onChangeLedger = (next: LedgerEntry[]) => {
    changeCalls.push(next);
    useAppStore.setState((s) => ({ data: { ...s.data, ledger: next } }));
  };
  return (
    <RecurringDueBadge
      recurring={data.recurringExpenses}
      ledger={data.ledger}
      onClick={() => goBudget()}
      onChangeLedger={onChangeLedger}
    />
  );
}

function setup(recurring: RecurringExpense[], ledger: LedgerEntry[]) {
  const data: AppData = {
    ...getEmptyData(),
    recurringExpenses: recurring,
    ledger,
    categoryPresets: { income: [], expense: ["재테크", "식비"], transfer: [] }
  };
  useAppStore.setState({ data });
  return render(<Harness />);
}

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};

beforeEach(() => {
  changeCalls = [];
  goBudget.mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe("RecurringDueBadge — 원클릭 반영 팝오버", () => {
  it("미등록 없으면 렌더하지 않는다", () => {
    setup([], []);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("배지 클릭 → 다이얼로그(체크리스트, 기본 전체 체크, 금액 표시)", async () => {
    const netflix = rec({ id: "r1", title: "넷플릭스", amount: 17_000 });
    const rent = rec({ id: "r2", title: "월세", amount: 500_000, startDate: "2026-01-05", category: "주거" });
    setup([netflix, rent], []);
    fireEvent.click(screen.getByRole("button", { name: /반복지출 2건 미등록/ }));
    await flush();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("17,000원")).toBeTruthy();
    expect(screen.getByText("500,000원")).toBeTruthy();
    const boxes = screen.getAllByRole("checkbox").filter((el) => el.getAttribute("aria-label"));
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => (b as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole("button", { name: "가계부에 반영 (2건)" })).toBeTruthy();
  });

  it("'가계부에 반영' → 생성기 스키마로 onChangeLedger 1회(prepend) + undo 토스트", async () => {
    const netflix = rec({ id: "r1", title: "넷플릭스", amount: 17_000, fromAccountId: "A1" });
    const other = entry({ id: "L0", date: "2026-06-01", amount: 5_000, subCategory: "식비" });
    setup([netflix], [other]);
    fireEvent.click(screen.getByRole("button", { name: /미등록/ }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "가계부에 반영 (1건)" }));
    await flush();

    expect(changeCalls).toHaveLength(1);
    const next = changeCalls[0];
    expect(next).toHaveLength(2);
    const created = next[0];
    expect(created.id.startsWith("L")).toBe(true);
    expect(created.date).toBe("2026-06-15");
    expect(created.kind).toBe("expense");
    expect(created.category).toBe("지출");
    expect(created.subCategory).toBe("구독비");
    expect(created.detailCategory).toBe("넷플릭스");
    expect(created.description).toBe("넷플릭스");
    expect(created.amount).toBe(17_000);
    expect(created.fromAccountId).toBe("A1");
    expect(created.isFixedExpense).toBe(true);
    expect(next[1].id).toBe("L0");
    // 반영 후 배지·다이얼로그 사라짐
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /미등록/ })).toBeNull();
    // undo 토스트 1회
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().data.ledger.map((l) => l.id)).toEqual([created.id, "L0"]);
  });

  it("배지는 미등록이라도 같은 달 dedup(±100원·날짜 무관)에 걸리면 생성 불가로 비활성 — 배지 목록 직접 삽입 금지 검증", async () => {
    // 6/3에 17,050원(소분류 넷플릭스)으로 기록 → 배지(±1원, 마감일~오늘 윈도우)는 미등록으로 보지만
    // 생성 dedup(같은 달 + 소분류 + ±100원)은 중복으로 본다 → 반영하면 이중 생성이므로 차단돼야 함
    const netflix = rec({ id: "r1", title: "넷플릭스", amount: 17_000 });
    const logged = entry({ id: "L1", date: "2026-06-03", amount: 17_050, subCategory: "구독비", detailCategory: "넷플릭스" });
    setup([netflix], [logged]);
    fireEvent.click(screen.getByRole("button", { name: /반복지출 1건 미등록/ }));
    await flush();
    const box = screen.getByRole("checkbox", { name: "넷플릭스 반영" }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);
    expect(screen.getByText(/같은 달에 이미 반영됨/)).toBeTruthy();
    const apply = screen.getByRole("button", { name: "가계부에 반영 (0건)" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(changeCalls).toHaveLength(0);
  });

  it("체크 해제한 항목은 반영되지 않는다", async () => {
    const netflix = rec({ id: "r1", title: "넷플릭스", amount: 17_000 });
    const rent = rec({ id: "r2", title: "월세", amount: 500_000, startDate: "2026-01-05", category: "주거" });
    setup([netflix, rent], []);
    fireEvent.click(screen.getByRole("button", { name: /미등록/ }));
    await flush();
    fireEvent.click(screen.getByRole("checkbox", { name: "넷플릭스 반영" }));
    fireEvent.click(screen.getByRole("button", { name: "가계부에 반영 (1건)" }));
    await flush();
    expect(changeCalls).toHaveLength(1);
    expect(changeCalls[0].filter((l) => l.isFixedExpense).map((l) => l.description)).toEqual(["월세"]);
    // 넷플릭스는 여전히 미등록 → 배지 1건
    expect(screen.getByRole("button", { name: /반복지출 1건 미등록/ })).toBeTruthy();
  });

  it("연간 grace로 전월 기념일이 떠 있으면 그 달 기준으로 생성(현재 달 아님)", async () => {
    // 오늘 6/20, 5/25 기념일(연간) → 배지 due=2026-05-25 → 생성 월 2026-05, 날짜 5/25
    const insurance = rec({ id: "r1", title: "자동차보험", amount: 800_000, frequency: "yearly", startDate: "2024-05-25", category: "보험" });
    setup([insurance], []);
    fireEvent.click(screen.getByRole("button", { name: /미등록/ }));
    await flush();
    expect(screen.getByText(/2026-05-25/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "가계부에 반영 (1건)" }));
    await flush();
    expect(changeCalls[0][0].date).toBe("2026-05-25");
  });

  it("주간: 마감일(가장 최근 요일)의 발생만 반영 — 같은 달의 다른 주는 건드리지 않음", async () => {
    // 6/20(토) 기준, 수요일 시작 주간 → due 6/17; 6/3·6/10도 미등록이지만 배지 항목은 6/17 하나
    const gym = rec({ id: "r1", title: "헬스", amount: 10_000, frequency: "weekly", startDate: "2026-05-20", category: "운동" });
    setup([gym], []);
    fireEvent.click(screen.getByRole("button", { name: /미등록/ }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "가계부에 반영 (1건)" }));
    await flush();
    expect(changeCalls).toHaveLength(1);
    expect(changeCalls[0].map((l) => l.date)).toEqual(["2026-06-17"]);
  });

  it("미리보기 후 다른 경로로 이미 반영됐으면 후보가 무효화돼 삽입하지 않는다", async () => {
    const netflix = rec({ id: "r1", title: "넷플릭스", amount: 17_000 });
    setup([netflix], []);
    fireEvent.click(screen.getByRole("button", { name: /미등록/ }));
    await flush();
    // 팝오버 열린 사이 예산 탭/수동 입력으로 같은 달 같은 항목이 들어옴 (배지 ±1원 기준엔 안 잡히게 17,050원)
    act(() => {
      useAppStore.setState((s) => ({
        data: {
          ...s.data,
          ledger: [entry({ id: "Lx", date: "2026-06-02", amount: 17_050, subCategory: "구독비", detailCategory: "넷플릭스" })]
        }
      }));
    });
    await flush();
    const apply = screen.getByRole("button", { name: /가계부에 반영/ }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    expect(changeCalls).toHaveLength(0);
  });

  it("'예산 탭에서 자세히' → onClick 호출 + 닫힘", async () => {
    setup([rec({ id: "r1", title: "넷플릭스", amount: 17_000 })], []);
    fireEvent.click(screen.getByRole("button", { name: /미등록/ }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "예산 탭에서 자세히" }));
    expect(goBudget).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ESC로 닫힌다", async () => {
    setup([rec({ id: "r1", title: "넷플릭스", amount: 17_000 })], []);
    fireEvent.click(screen.getByRole("button", { name: /미등록/ }));
    await flush();
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("onChangeLedger 없이는 기존 동작(클릭 → onClick만, 다이얼로그 없음)", async () => {
    useAppStore.setState({ data: getEmptyData() });
    const spy = vi.fn();
    render(
      <RecurringDueBadge
        recurring={[rec({ id: "r1", title: "넷플릭스", amount: 17_000 })]}
        ledger={[]}
        onClick={spy}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /미등록/ }));
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
