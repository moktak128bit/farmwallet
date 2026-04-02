/**
 * 앱 데이터를 "테이블"(행 배열) 묶음으로 직렬화/역직렬화.
 * 이 파일만으로도 JSON 백업·복구가 가능해야 함 (format: farmwallet-table-backup-v1).
 */

import type {
  AppData,
  AssetSnapshotPoint,
  CategoryPresets,
  LedgerEntry,
  TargetPortfolio,
  WorkoutWeek,
  WorkoutDayEntry,
  WorkoutExercise,
  IsaPortfolioItem
} from "../types";
import { DATA_SCHEMA_VERSION, DEFAULT_US_TICKERS, ISA_PORTFOLIO } from "../constants/config";

export const TABLE_BACKUP_FORMAT = "farmwallet-table-backup-v1" as const;

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function asObj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return v as Record<string, unknown>;
}

function sortBySortOrder<T extends { sort_order?: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

function ledgerToRow(entry: LedgerEntry): Record<string, unknown> {
  const { tags, ...rest } = entry;
  const row: Record<string, unknown> = { ...rest };
  if (tags && tags.length > 0) {
    row.tags_json = JSON.stringify(tags);
  }
  return row;
}

function rowToLedger(row: Record<string, unknown>): LedgerEntry {
  const { tags_json, ...rest } = row;
  const entry = { ...rest } as unknown as LedgerEntry;
  if (typeof tags_json === "string" && tags_json.trim()) {
    try {
      const t = JSON.parse(tags_json) as unknown;
      if (Array.isArray(t)) {
        entry.tags = t.map((x) => String(x));
      }
    } catch {
      /* ignore */
    }
  }
  return entry;
}

function buildCategoryTables(cp: CategoryPresets) {
  const category_preset_income = cp.income.map((value, sort_order) => ({ sort_order, value }));
  const category_preset_transfer = cp.transfer.map((value, sort_order) => ({ sort_order, value }));
  const expenseDetails = cp.expenseDetails ?? [];
  const expense_detail_groups = expenseDetails.map((g, i) => ({
    group_id: `g${i}`,
    sort_order: i,
    main: g.main
  }));
  const expense_detail_subs: { group_id: string; sort_order: number; value: string }[] = [];
  expenseDetails.forEach((g, i) => {
    const gid = `g${i}`;
    g.subs.forEach((sub, j) => {
      expense_detail_subs.push({ group_id: gid, sort_order: j, value: sub });
    });
  });
  const ct = cp.categoryTypes ?? {};
  const category_type_fixed = (ct.fixed ?? []).map((value, sort_order) => ({ sort_order, value }));
  const category_type_savings = (ct.savings ?? []).map((value, sort_order) => ({ sort_order, value }));
  const category_type_transfer = (ct.transfer ?? []).map((value, sort_order) => ({ sort_order, value }));
  return {
    category_preset_income,
    category_preset_transfer,
    expense_detail_groups,
    expense_detail_subs,
    category_type_fixed,
    category_type_savings,
    category_type_transfer
  };
}

function parseCategoryPresets(tables: Record<string, unknown>): CategoryPresets {
  const income = sortBySortOrder(asArray<{ sort_order?: number; value?: string }>(tables.category_preset_income))
    .map((r) => String(r.value ?? ""))
    .filter(Boolean);
  const transfer = sortBySortOrder(asArray<{ sort_order?: number; value?: string }>(tables.category_preset_transfer))
    .map((r) => String(r.value ?? ""))
    .filter(Boolean);

  const groups = sortBySortOrder(
    asArray<{ group_id?: string; sort_order?: number; main?: string }>(tables.expense_detail_groups)
  );
  const subsRaw = asArray<{ group_id?: string; sort_order?: number; value?: string }>(tables.expense_detail_subs);

  const expenseDetails = groups.map((g) => {
    const gid = String(g.group_id ?? "");
    const subs = sortBySortOrder(
      subsRaw.filter((x) => String(x.group_id ?? "") === gid)
    ).map((x) => String(x.value ?? ""));
    return { main: String(g.main ?? ""), subs };
  });

  const expense = expenseDetails.map((e) => e.main).filter(Boolean);

  const fixed = sortBySortOrder(asArray<{ sort_order?: number; value?: string }>(tables.category_type_fixed)).map((r) =>
    String(r.value ?? "")
  );
  const savings = sortBySortOrder(asArray<{ sort_order?: number; value?: string }>(tables.category_type_savings)).map(
    (r) => String(r.value ?? "")
  );
  const transferTypes = sortBySortOrder(
    asArray<{ sort_order?: number; value?: string }>(tables.category_type_transfer)
  ).map((r) => String(r.value ?? ""));

  return {
    income: income.length ? income : [],
    expense: expense.length ? expense : [],
    expenseDetails: expenseDetails.filter((e) => e.main),
    transfer: transfer.length ? transfer : [],
    categoryTypes: {
      fixed,
      savings,
      transfer: transferTypes
    }
  };
}

function buildWorkoutTables(weeks: WorkoutWeek[]) {
  const workout_weeks: { id: string; week_start: string }[] = [];
  const workout_day_entries: {
    id: string;
    week_id: string;
    sort_order: number;
    date: string;
    type: string;
    day_label?: string;
    cardio?: string;
    rest_notes?: string;
  }[] = [];
  const workout_exercises: { id: string; day_entry_id: string; sort_order: number; name: string; note?: string }[] =
    [];
  const workout_sets: {
    id: string;
    exercise_id: string;
    sort_order: number;
    weight_kg: number;
    reps: number;
  }[] = [];

  for (const w of weeks) {
    workout_weeks.push({ id: w.id, week_start: w.weekStart });
    w.entries.forEach((day: WorkoutDayEntry, di: number) => {
      workout_day_entries.push({
        id: day.id,
        week_id: w.id,
        sort_order: di,
        date: day.date,
        type: day.type,
        day_label: day.dayLabel,
        cardio: day.cardio,
        rest_notes: day.restNotes
      });
      const exercises = day.exercises ?? [];
      exercises.forEach((ex: WorkoutExercise, ei: number) => {
        workout_exercises.push({
          id: ex.id,
          day_entry_id: day.id,
          sort_order: ei,
          name: ex.name,
          note: ex.note
        });
        ex.sets.forEach((st, si) => {
          workout_sets.push({
            id: `${ex.id}-s${si}`,
            exercise_id: ex.id,
            sort_order: si,
            weight_kg: st.weightKg,
            reps: st.reps
          });
        });
      });
    });
  }

  return { workout_weeks, workout_day_entries, workout_exercises, workout_sets };
}

function parseWorkoutWeeks(tables: Record<string, unknown>): WorkoutWeek[] {
  const weekRows = asArray<{ id?: string; week_start?: string }>(tables.workout_weeks);
  type DayRow = {
    id?: string;
    week_id?: string;
    sort_order?: number;
    date?: string;
    type?: string;
    day_label?: string;
    cardio?: string;
    rest_notes?: string;
  };
  type ExRow = {
    id?: string;
    day_entry_id?: string;
    sort_order?: number;
    name?: string;
    note?: string;
  };
  const dayRows = asArray<DayRow>(tables.workout_day_entries);
  const exRows = asArray<ExRow>(tables.workout_exercises);
  const setRows = asArray<{
    exercise_id?: string;
    sort_order?: number;
    weight_kg?: number;
    reps?: number;
  }>(tables.workout_sets);

  const setsByEx = new Map<string, { weightKg: number; reps: number }[]>();
  const setRowsSorted = [...setRows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  for (const s of setRowsSorted) {
    const eid = String(s.exercise_id ?? "");
    if (!eid) continue;
    if (!setsByEx.has(eid)) setsByEx.set(eid, []);
    setsByEx.get(eid)!.push({
      weightKg: Number(s.weight_kg ?? 0),
      reps: Number(s.reps ?? 0)
    });
  }

  const exByDay = new Map<string, WorkoutExercise[]>();
  for (const er of sortBySortOrder(exRows)) {
    const dayId = String(er.day_entry_id ?? "");
    if (!dayId) continue;
    const exId = String(er.id ?? "").trim();
    const ex: WorkoutExercise = {
      id: exId || `wex-${dayId}-${exByDay.get(dayId)?.length ?? 0}`,
      name: String(er.name ?? ""),
      sets: exId ? (setsByEx.get(exId) ?? []) : [],
      note: er.note !== undefined ? String(er.note) : undefined
    };
    if (!exByDay.has(dayId)) exByDay.set(dayId, []);
    exByDay.get(dayId)!.push(ex);
  }

  const daysByWeek = new Map<string, WorkoutDayEntry[]>();
  for (const dr of sortBySortOrder(dayRows)) {
    const wid = String(dr.week_id ?? "");
    if (!wid) continue;
    const day: WorkoutDayEntry = {
      id: String(dr.id ?? ""),
      date: String(dr.date ?? ""),
      type: dr.type === "rest" ? "rest" : "workout",
      dayLabel: dr.day_label !== undefined ? String(dr.day_label) : undefined,
      exercises: exByDay.get(String(dr.id ?? "")),
      cardio: dr.cardio !== undefined ? String(dr.cardio) : undefined,
      restNotes: dr.rest_notes !== undefined ? String(dr.rest_notes) : undefined
    };
    if (!daysByWeek.has(wid)) daysByWeek.set(wid, []);
    daysByWeek.get(wid)!.push(day);
  }

  return weekRows.map((wr) => ({
    id: String(wr.id ?? ""),
    weekStart: String(wr.week_start ?? ""),
    entries: daysByWeek.get(String(wr.id ?? "")) ?? []
  }));
}

function buildTargetPortfolioTables(tps: TargetPortfolio[]) {
  const target_portfolios = tps.map((tp) => ({
    id: tp.id,
    name: tp.name,
    account_id: tp.accountId,
    updated_at: tp.updatedAt ?? null
  }));
  const target_portfolio_items: {
    portfolio_id: string;
    sort_order: number;
    ticker: string;
    target_percent: number;
    alias: string | null;
  }[] = [];
  for (const tp of tps) {
    tp.items.forEach((it, i) => {
      target_portfolio_items.push({
        portfolio_id: tp.id,
        sort_order: i,
        ticker: it.ticker,
        target_percent: it.targetPercent,
        alias: it.alias ?? null
      });
    });
  }
  return { target_portfolios, target_portfolio_items };
}

function parseTargetPortfolios(tables: Record<string, unknown>): TargetPortfolio[] {
  const pr = asArray<{ id?: string; name?: string; account_id?: string | null; updated_at?: string | null }>(
    tables.target_portfolios
  );
  const items = asArray<{
    portfolio_id?: string;
    sort_order?: number;
    ticker?: string;
    target_percent?: number;
    alias?: string | null;
  }>(tables.target_portfolio_items);
  const byP = new Map<string, typeof items>();
  for (const it of items) {
    const pid = String(it.portfolio_id ?? "");
    if (!pid) continue;
    if (!byP.has(pid)) byP.set(pid, []);
    byP.get(pid)!.push(it);
  }
  return pr.map((p) => {
    const pid = String(p.id ?? "");
    const rowItems = sortBySortOrder(byP.get(pid) ?? []);
    return {
      id: pid,
      name: String(p.name ?? ""),
      accountId: p.account_id === null || p.account_id === undefined || p.account_id === "" ? null : String(p.account_id),
      items: rowItems.map((r) => ({
        ticker: String(r.ticker ?? ""),
        targetPercent: Number(r.target_percent ?? 0),
        alias: r.alias ? String(r.alias) : undefined
      })),
      updatedAt: p.updated_at ? String(p.updated_at) : undefined
    };
  });
}

function defaultIsa(): IsaPortfolioItem[] {
  return ISA_PORTFOLIO.map((item) => ({
    ticker: item.ticker,
    name: item.name,
    weight: item.weight,
    label: item.label
  }));
}

/** 현재 AppData → 테이블 백업 JSON 루트 객체 */
export function buildTableBackupFile(data: AppData): {
  format: typeof TABLE_BACKUP_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  tables: Record<string, unknown>;
} {
  const cp = buildCategoryTables(data.categoryPresets);
  const wt = buildWorkoutTables(data.workoutWeeks ?? []);
  const tp = buildTargetPortfolioTables(data.targetPortfolios ?? []);

  const net_worth_curve = Object.entries(data.targetNetWorthCurve ?? {})
    .map(([date_key, amount], sort_order) => ({ sort_order, date_key, amount }))
    .sort((a, b) => a.date_key.localeCompare(b.date_key))
    .map((r, i) => ({ ...r, sort_order: i }));

  const asset_snapshots: Record<string, unknown>[] = [];
  const asset_snapshot_breakdowns: Record<string, unknown>[] = [];
  for (const pt of data.assetSnapshots ?? []) {
    const { accountBreakdown, ...scalars } = pt;
    asset_snapshots.push({ ...scalars });
    for (const b of accountBreakdown ?? []) {
      asset_snapshot_breakdowns.push({
        snapshot_date: pt.date,
        account_id: b.accountId,
        account_name: b.accountName,
        buy_amount: b.buyAmount,
        evaluation_amount: b.evaluationAmount
      });
    }
  }

  const meta_kv: { key: string; value: string }[] = [];
  if (data.dividendTrackingTicker !== undefined && data.dividendTrackingTicker !== null) {
    meta_kv.push({ key: "dividend_tracking_ticker", value: String(data.dividendTrackingTicker) });
  }

  const us_ticker_order = (data.usTickers ?? [...DEFAULT_US_TICKERS]).map((ticker, sort_order) => ({
    sort_order,
    ticker
  }));

  const isa_portfolio_items = (data.isaPortfolio ?? []).map((row, sort_order) => ({
    sort_order,
    ticker: row.ticker,
    name: row.name,
    weight: row.weight,
    label: row.label
  }));

  return {
    format: TABLE_BACKUP_FORMAT,
    schemaVersion: DATA_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    tables: {
      accounts: data.accounts ?? [],
      ledger_entries: (data.ledger ?? []).map(ledgerToRow),
      stock_trades: data.trades ?? [],
      stock_prices: data.prices ?? [],
      recurring_expenses: data.recurringExpenses ?? [],
      budget_goals: data.budgetGoals ?? [],
      custom_symbols: data.customSymbols ?? [],
      us_ticker_order,
      ticker_database: data.tickerDatabase ?? [],
      ledger_templates: data.ledgerTemplates ?? [],
      stock_presets: data.stockPresets ?? [],
      loans: data.loans ?? [],
      historical_daily_closes: data.historicalDailyCloses ?? [],
      ...cp,
      ...tp,
      ...wt,
      net_worth_curve,
      asset_snapshots,
      asset_snapshot_breakdowns,
      meta_kv,
      isa_portfolio_items
    }
  };
}

export function isTableBackupPayload(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;
  return o.format === TABLE_BACKUP_FORMAT && o.tables !== undefined && typeof o.tables === "object" && !Array.isArray(o.tables);
}

/**
 * 테이블 백업 JSON → 일반 AppData JSON과 동일한 키 구조 (normalizeImportedData에 넣을 수 있음)
 */
export function appDataFromTableBackupPayload(raw: unknown): AppData {
  if (!isTableBackupPayload(raw)) {
    throw new Error("Invalid table backup format");
  }
  const root = raw as Record<string, unknown>;
  const tables = asObj(root.tables);

  const metaRows = asArray<{ key?: string; value?: string }>(tables.meta_kv);
  const meta = new Map(metaRows.map((r) => [String(r.key ?? ""), String(r.value ?? "")]));
  const dividendTrackingTicker = meta.get("dividend_tracking_ticker") ?? "458730";

  const ledger = asArray<Record<string, unknown>>(tables.ledger_entries).map(rowToLedger);

  const usOrder = sortBySortOrder(asArray<{ sort_order?: number; ticker?: string }>(tables.us_ticker_order));
  const usTickers = usOrder.map((r) => String(r.ticker ?? "")).filter(Boolean);
  const usTickersFinal = usTickers.length > 0 ? usTickers : [...DEFAULT_US_TICKERS];

  type IsaRow = { sort_order?: number; ticker?: string; name?: string; weight?: number; label?: string };
  const isaRows = sortBySortOrder(asArray<IsaRow>(tables.isa_portfolio_items));
  const isaPortfolio: IsaPortfolioItem[] = isaRows.map((r) => ({
    ticker: String(r.ticker ?? ""),
    name: String(r.name ?? ""),
    weight: Number(r.weight ?? 0),
    label: String(r.label ?? "")
  }));
  const isaFinal = isaPortfolio.length > 0 ? isaPortfolio : defaultIsa();

  type CurveRow = { sort_order?: number; date_key?: string; amount?: number };
  const curveRows = sortBySortOrder(asArray<CurveRow>(tables.net_worth_curve));
  const targetNetWorthCurve: Record<string, number> = {};
  for (const r of curveRows) {
    const k = String(r.date_key ?? "");
    if (!k) continue;
    const n = Number(r.amount);
    if (Number.isFinite(n)) targetNetWorthCurve[k] = n;
  }

  const snapRows = asArray<Record<string, unknown>>(tables.asset_snapshots);
  const breakdownRows = asArray<{
    snapshot_date?: string;
    account_id?: string;
    account_name?: string;
    buy_amount?: number;
    evaluation_amount?: number;
  }>(tables.asset_snapshot_breakdowns);
  const bdByDate = new Map<string, typeof breakdownRows>();
  for (const b of breakdownRows) {
    const d = String(b.snapshot_date ?? "");
    if (!d) continue;
    if (!bdByDate.has(d)) bdByDate.set(d, []);
    bdByDate.get(d)!.push(b);
  }

  const assetSnapshots: AssetSnapshotPoint[] = snapRows.map((row) => {
    const date = String(row.date ?? "");
    const accountBreakdown = (bdByDate.get(date) ?? []).map((b) => ({
      accountId: String(b.account_id ?? ""),
      accountName: String(b.account_name ?? ""),
      buyAmount: Number(b.buy_amount ?? 0),
      evaluationAmount: Number(b.evaluation_amount ?? 0)
    }));
    const point: AssetSnapshotPoint = {
      date,
      installmentSavings: toNullableNum(row.installmentSavings),
      termDeposit: toNullableNum(row.termDeposit),
      pensionPrincipal: toNullableNum(row.pensionPrincipal),
      pensionEvaluation: toNullableNum(row.pensionEvaluation),
      investmentBuyAmount: toNullableNum(row.investmentBuyAmount),
      investmentEvaluationAmount: toNullableNum(row.investmentEvaluationAmount),
      cryptoAssets: toNullableNum(row.cryptoAssets),
      dividendInterestCumulative: toNullableNum(row.dividendInterestCumulative),
      totalAssetBuyAmount: toNullableNum(row.totalAssetBuyAmount),
      totalAssetEvaluationAmount: toNullableNum(row.totalAssetEvaluationAmount),
      investmentPerformance: toNullableNum(row.investmentPerformance)
    };
    if (accountBreakdown.length > 0) {
      point.accountBreakdown = accountBreakdown;
    }
    return point;
  });

  return {
    loans: asArray(tables.loans),
    accounts: asArray(tables.accounts),
    ledger,
    trades: asArray(tables.stock_trades),
    prices: asArray(tables.stock_prices),
    categoryPresets: parseCategoryPresets(tables),
    recurringExpenses: asArray(tables.recurring_expenses),
    budgetGoals: asArray(tables.budget_goals),
    customSymbols: asArray(tables.custom_symbols),
    usTickers: usTickersFinal,
    tickerDatabase: asArray(tables.ticker_database),
    ledgerTemplates: asArray(tables.ledger_templates),
    stockPresets: asArray(tables.stock_presets),
    targetPortfolios: parseTargetPortfolios(tables),
    workoutWeeks: parseWorkoutWeeks(tables),
    targetNetWorthCurve,
    assetSnapshots,
    historicalDailyCloses: asArray(tables.historical_daily_closes),
    dividendTrackingTicker,
    isaPortfolio: isaFinal
  } as AppData;
}

function toNullableNum(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
