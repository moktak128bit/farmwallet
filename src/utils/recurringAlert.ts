import type { LedgerEntry, Recurrence, RecurringExpense } from "../types";
import { getTodayKST, getLastDayOfMonth, parseIsoLocal, formatIsoLocal, addDaysToIso, shiftMonth } from "./date";
import { latestRecordedDate } from "./ledgerFreshness";

interface RecurringDueItem {
  recurring: RecurringExpense;
  dueDate: string;
  alreadyLogged: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 마감일이 지난 뒤에도 '며칠'까지 미등록 알림을 유지할지.
 * 서버 없는 PWA라 푸시 보완이 불가능 — 마감 당일에만 알리면 하루만 안 열어도
 * 그 달 고정비가 조용히 누락된다. grace 윈도우로 '조용한 누락 방지'와
 * '과도한 알림' 사이를 잡는다. (월간은 다음 달이 되면 마감일이 미래가 되어 자연 종료)
 */
const OVERDUE_GRACE_DAYS: Record<Recurrence, number> = {
  monthly: 31, // 이번 달 내내
  weekly: 6, // 다음 발생 전까지
  yearly: 31 // 기념일 후 약 한 달
};

/**
 * refDate 기준 '이미 지났거나 오늘인' 가장 최근 마감일(YYYY-MM-DD). 알림 대상이 아니면 null.
 * - 마감일이 아직 안 왔거나(미래), 시작일 이전이거나, grace를 초과해 오래 지났으면 null.
 */
const computeDueDate = (r: RecurringExpense, refDate: string): string | null => {
  // UTC 파싱 함정 회피 — parseIsoLocal로 로컬 자정 기준 파싱
  const ref = parseIsoLocal(refDate);
  const start = parseIsoLocal(r.startDate);
  if (!ref || !start) return null;
  if (start > ref) return null;
  const end = r.endDate ? parseIsoLocal(r.endDate) : null;
  if (end && end < ref) return null;

  let due: string | null = null;
  if (r.frequency === "monthly") {
    // 29/30/31일 시작 반복은 짧은 달에 존재하지 않는 날짜가 됨 → 월말로 클램프
    // (RecurringListSection의 월 반영 경로와 동일 패턴)
    const lastDay = getLastDayOfMonth(ref.getFullYear(), ref.getMonth() + 1);
    const dueDay = Math.min(start.getDate(), lastDay);
    due = `${ref.getFullYear()}-${pad(ref.getMonth() + 1)}-${pad(dueDay)}`;
  } else if (r.frequency === "weekly") {
    // refDate 이전(또는 당일)의 가장 최근 같은 요일
    const diff = (ref.getDay() - start.getDay() + 7) % 7;
    const occ = new Date(ref);
    occ.setDate(ref.getDate() - diff);
    due = formatIsoLocal(occ);
  } else if (r.frequency === "yearly") {
    // 당해 연도 기념일이 미래면(예: 1월에 보는 12월 기념일) 전년도 기념일로 폴백 —
    // 당해 연도로만 계산하면 연말 기념일이 1월 1일에 즉시 미래가 돼 grace(31일)가 도달 불능이었다.
    const anniversaryFor = (year: number): string => {
      const lastDay = getLastDayOfMonth(year, start.getMonth() + 1);
      const dueDay = Math.min(start.getDate(), lastDay);
      return `${year}-${pad(start.getMonth() + 1)}-${pad(dueDay)}`;
    };
    const thisYear = anniversaryFor(ref.getFullYear());
    const thisYearDt = parseIsoLocal(thisYear);
    due = thisYearDt && thisYearDt <= ref ? thisYear : anniversaryFor(ref.getFullYear() - 1);
  }
  if (!due) return null;

  const dueDt = parseIsoLocal(due);
  if (!dueDt) return null;
  if (dueDt < start) return null; // 시작일 이전 기념일/마감일
  if (dueDt > ref) return null; // 아직 마감일이 안 옴 (미래)
  const overdueDays = Math.round((ref.getTime() - dueDt.getTime()) / DAY_MS);
  if (overdueDays > OVERDUE_GRACE_DAYS[r.frequency]) return null; // 너무 오래 지남 → 알림 종료
  return due;
};

/** 금액 허용 오차 — 실제 청구액은 환율·부가세·할인으로 조금씩 달라진다(실장부 학자금 4,059 등록 vs 3,928 결제) */
const AMOUNT_TOLERANCE = 0.1;

/**
 * ledger 엔트리가 반복지출 r의 생성 스키마와 일치하는지 — kind(transfer/expense)+금액(±10%)+분류/제목.
 * 기간(어느 사이클) 필터는 호출부 책임. recurringAlert(미등록 배지)와 cashFlowForecast(이미납부 차감)가 공유.
 */
export function matchesRecurringEntry(l: LedgerEntry, r: RecurringExpense): boolean {
  // kind="income"(정기 수입, 3-4)은 별도 스키마(kind=income) — 지출/이체 가정과 분리해 가드
  const expectedKind = r.kind === "income" ? "income" : r.toAccountId ? "transfer" : "expense";
  if (l.kind !== expectedKind) return false;
  const amount = Number(l.amount);
  if (!(amount > 0) || Math.abs(amount - r.amount) > Math.max(1, Math.abs(r.amount) * AMOUNT_TOLERANCE)) return false;
  const subMatch = !!r.category && l.subCategory === r.category;
  const titleMatch =
    !!r.title && (l.detailCategory === r.title || (l.description ?? "").includes(r.title));
  return subMatch || titleMatch;
}

/**
 * 등록되어야 할 반복지출 중 아직 가계부에 기록되지 않은 항목 목록.
 *
 * 마감일이 지나도 grace 윈도우 안이면 계속 알리며(하루 결근 시 영구 누락 방지),
 * alreadyLogged는 '마감일~오늘' 구간 전체를 검사한다(마감 당일에 기록했어도 인식).
 *
 * alreadyLogged 판정은 실제 생성 스키마와 일치시킨다:
 *  - kind: toAccountId 있으면 "transfer", 없으면 "expense"
 *  - subCategory = r.category, detailCategory = r.title (category는 "지출"/"이체" 대분류)
 *  - description은 r.title 또는 "[반복] {title}" 형태 → 포함 일치로 허용
 */
/** due 기준 n주기 전 날짜 */
function cyclesBefore(r: RecurringExpense, due: string, n: number): string {
  if (r.frequency === "weekly") return addDaysToIso(due, -7 * n);
  if (r.frequency === "yearly") return `${Number(due.slice(0, 4)) - n}${due.slice(4)}`;
  const m = shiftMonth(due.slice(0, 7), -n);
  const [y, mo] = m.split("-").map(Number);
  return `${m}-${pad(Math.min(Number(due.slice(8, 10)), getLastDayOfMonth(y, mo)))}`;
}

interface StoppedRecurringItem {
  recurring: RecurringExpense;
  /** 마지막으로 매칭된 결제일 */
  lastPaid: string;
}

/**
 * 중지 추정 — 예전엔 결제됐는데(매칭 기록 있음) 최근 2주기 동안 결제가 없는 반복지출.
 * 한 번도 매칭된 적 없는 항목은 증거가 없으므로 중지로 보지 않는다(새로 등록했거나 기록 방식이 다른 경우).
 */
function stoppedLastPaid(r: RecurringExpense, ledger: LedgerEntry[], due: string): string | null {
  const windowStart = cyclesBefore(r, due, 2);
  if (r.startDate > windowStart) return null; // 2주기가 아직 안 지남
  let last: string | null = null;
  for (const l of ledger) {
    if (!l.date || l.date > due || !matchesRecurringEntry(l, r)) continue;
    if (l.date >= windowStart) return null; // 최근 2주기 안에 결제 있음
    if (last == null || l.date > last) last = l.date;
  }
  return last;
}

/** 중지 추정 반복지출 목록 — 배지·원클릭 반영에서 빠지고, 반복 지출 목록에 "중지 추정"으로 표시된다 */
export function findStoppedRecurring(
  recurring: RecurringExpense[],
  ledger: LedgerEntry[],
  refDate: string = getTodayKST()
): StoppedRecurringItem[] {
  const out: StoppedRecurringItem[] = [];
  for (const r of recurring) {
    const due = computeDueDate(r, refDate) ?? refDate;
    if (r.endDate && r.endDate < refDate) continue;
    const lastPaid = stoppedLastPaid(r, ledger, due);
    if (lastPaid) out.push({ recurring: r, lastPaid });
  }
  return out;
}

/**
 * 제외 규칙(허위 "미등록" 방지 — 실장부에서 4건 중 3건이 허위였다):
 *  - 마감일이 마지막 기록일보다 뒤 → 아직 알 수 없음(캡처를 모아 입력하므로 기록이 오늘보다 늦다).
 *  - 중지 추정(findStoppedRecurring) → 해지했을 가능성이 커 원클릭 반영 시 유령 거래가 된다.
 */
export function findOverdueRecurring(
  recurring: RecurringExpense[],
  ledger: LedgerEntry[],
  refDate: string = getTodayKST()
): RecurringDueItem[] {
  const items: RecurringDueItem[] = [];
  const lastRecorded = latestRecordedDate(ledger, refDate);
  for (const r of recurring) {
    const due = computeDueDate(r, refDate);
    if (!due) continue;
    if (lastRecorded != null && due > lastRecorded) continue;
    if (stoppedLastPaid(r, ledger, due)) continue;
    // 마감일~오늘 구간의 기록을 검사 (당일만 보면 마감 당일 등록을 놓침)
    const windowEntries = ledger.filter((l) => l.date >= due && l.date <= refDate);
    const alreadyLogged = windowEntries.some((l) => matchesRecurringEntry(l, r));
    items.push({ recurring: r, dueDate: due, alreadyLogged });
  }
  return items;
}

interface ActualPayment {
  date: string;
  amount: number;
  accountId: string | undefined;
  /** 등록값과 다른 점 — 금액(±10% 초과)·결제일(3일 초과, 월간)·계좌. 비어 있으면 일치 */
  diffs: string[];
}

/**
 * 등록된 반복지출과 같은 항목(제목 일치 — detailCategory 또는 설명 포함)의 가장 최근 실제 결제.
 * 금액은 보지 않는다 — 등록값이 낡아 금액이 달라진 경우를 드러내는 게 목적(실장부 핸드폰 등록 13,770/24일/삼성페이
 * vs 실제 21,000/19일/NH). 데이터는 바꾸지 않는다.
 */
export function findLastActualPayment(r: RecurringExpense, ledger: LedgerEntry[], refDate: string = getTodayKST()): ActualPayment | null {
  if (!r.title) return null;
  const expectedKind = r.kind === "income" ? "income" : r.toAccountId ? "transfer" : "expense";
  let best: LedgerEntry | null = null;
  for (const l of ledger) {
    if (l.kind !== expectedKind || !l.date || l.date > refDate || !(Number(l.amount) > 0)) continue;
    if (!(l.detailCategory === r.title || (l.description ?? "").includes(r.title))) continue;
    if (!best || l.date > best.date) best = l;
  }
  if (!best) return null;
  const amount = Number(best.amount);
  const accountId = expectedKind === "income" ? best.toAccountId : best.fromAccountId;
  const diffs: string[] = [];
  if (r.amount > 0 && Math.abs(amount - r.amount) > r.amount * AMOUNT_TOLERANCE) {
    const pct = Math.round((amount / r.amount - 1) * 100);
    diffs.push(`금액 ${pct > 0 ? "+" : ""}${pct}%`);
  }
  if (r.frequency === "monthly" && r.startDate) {
    const regDay = Number(r.startDate.slice(8, 10));
    const paidDay = Number(best.date.slice(8, 10));
    if (Math.abs(regDay - paidDay) > 3) diffs.push(`결제일 ${paidDay}일(등록 ${regDay}일)`);
  }
  const regAccount = expectedKind === "income" ? r.toAccountId : r.fromAccountId;
  if (regAccount && accountId && regAccount !== accountId) diffs.push("계좌 다름");
  return { date: best.date, amount, accountId, diffs };
}
