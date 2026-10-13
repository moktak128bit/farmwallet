import type { Account, CategoryPresets, LedgerEntry } from "../types";
import { classifyLedgerFlow, toKrwAmount } from "../features/dashboard/summaryMath";
import { classifyExpenseNature } from "./fixedExpense";
import { expenseMainName } from "./categoryMerge";
import { getTodayKST, parseIsoLocal, shiftMonth } from "./date";
import { computeIncomeNatureKeys } from "./incomeClassification";
import { isInvestmentPnlEntry } from "./category";

export const VEHICLE_COST_LABELS = {
  fuel: "주유·충전", maintenance: "정비·수리·용품", insurance: "차량 보험", tax: "자동차세",
  parking: "주차", toll: "통행료", wash: "세차", other: "기타 차량 운영비",
  finance: "차량 할부·대출", purchase: "차량 구입",
} as const;
export type VehicleCostKind = keyof typeof VEHICLE_COST_LABELS;
export type VehicleOverride = VehicleCostKind | "exclude";
export interface LifestyleAssumptions {
  replacementMonthly: number | null;
  depreciationMonthly: number | null;
  plannedInvestmentMonthly: number;
  reductionPct: number;
  vehicleOverrides: Record<string, VehicleOverride>;
}
export const DEFAULT_LIFESTYLE_ASSUMPTIONS: LifestyleAssumptions = {
  replacementMonthly: null, depreciationMonthly: null, plannedInvestmentMonthly: 2_000_000,
  reductionPct: 10, vehicleOverrides: {},
};

export function parseLifestyleAssumptions(raw: string | null): LifestyleAssumptions {
  const fallback = { ...DEFAULT_LIFESTYLE_ASSUMPTIONS, vehicleOverrides: {} };
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
    const settings = value as Record<string, unknown>;
    const amount = (v: unknown, defaultValue: number | null): number | null =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1_000_000_000 ? v : defaultValue;
    const overrides = settings.vehicleOverrides;
    return {
      replacementMonthly: amount(settings.replacementMonthly, null),
      depreciationMonthly: amount(settings.depreciationMonthly, null),
      plannedInvestmentMonthly: amount(settings.plannedInvestmentMonthly, fallback.plannedInvestmentMonthly)!,
      reductionPct: typeof settings.reductionPct === "number" && Number.isFinite(settings.reductionPct)
        ? Math.max(0, Math.min(100, settings.reductionPct)) : fallback.reductionPct,
      vehicleOverrides: overrides && typeof overrides === "object" && !Array.isArray(overrides)
        ? Object.fromEntries(Object.entries(overrides).filter(([, kind]) => typeof kind === "string"
          && (kind === "exclude" || Object.hasOwn(VEHICLE_COST_LABELS, kind)))) as Record<string, VehicleOverride> : {},
    };
  } catch { return fallback; }
}

/** Keyword hints only; the UI exposes the underlying records and per-record corrections. */
export function classifyVehicleCost(entry: LedgerEntry): VehicleCostKind | null {
  const categoryText = [entry.category, entry.subCategory, entry.detailCategory].join(" ").replace(/\s/g, "");
  if (/주차/.test(categoryText)) return "parking";
  if (/자동차보험|차량보험|운전자보험|차보험/.test(categoryText)) return "insurance";
  const text = [entry.category, entry.subCategory, entry.detailCategory, entry.description].join(" ").replace(/\s/g, "");
  if (/버스|지하철|택시|기차|항공|KTX|SRT|대중교통|휴대폰충전|선불충전/i.test(text)) return null;
  if (/자동차할부|차량할부|차량대출|자동차대출|자동차리스|차량리스|장기렌트/.test(text)) return "finance";
  if (/차량구입|자동차구입|차량구매|자동차구매|중고차구매|차량취득세|자동차취득세/.test(text)) return "purchase";
  if (/자동차보험|차량보험|운전자보험|차보험/.test(text)) return "insurance";
  if (/자동차세|차량세/.test(text)) return "tax";
  if (/주차/.test(text)) return "parking";
  if (/하이패스|톨비|톨게이트|통행료/.test(text)) return "toll";
  if (/세차/.test(text)) return "wash";
  if (/교통범칙금|교통과태료|차량과태료|자동차과태료/.test(text)) return "other";
  if (/주유|휘발유|휘발류|경유|유류|LPG|전기차충전|급속충전|완속충전/i.test(text)
    && !/유류교통비기타교통/.test(text)) {
    // A broad transport category alone is not proof of a fuel purchase.
    const detail = [entry.detailCategory, entry.description, entry.category !== "지출" ? entry.category : "",
      entry.subCategory !== "유류교통비" ? entry.subCategory : ""].join(" ");
    if (/주유|휘발유|휘발류|경유|유류비|유류·충전|LPG|충전비|전기차충전|급속충전|완속충전/i.test(detail)) return "fuel";
  }
  if (/차량유지|자동차수리|차량수리|엔진오일|타이어|자동차용품|차량용품|차량정비/.test(text)
    || (/유류교통|차량|자동차/.test(text) && /수리비|정비|유지보수|소모품/.test(text))) return "maintenance";
  if (/^(차량|자동차|차량유지비)$/.test(entry.subCategory || entry.category)) return "other";
  return null;
}

interface Totals { amount: number; count: number }
interface ExpenseRecord { entry: LedgerEntry; amount: number; main: string; detail: string; vehicle: VehicleCostKind | null; subscription: boolean }
interface MonthBucket {
  income: number; expense: number; investmentTransfers: number;
  fixed: number; variable: number; discretionary: number;
  fuel: number; vehicleOperating: number; vehicleCapital: number; subscription: number;
  categories: Map<string, Totals>; vehicle: Record<VehicleCostKind, number>;
  records: ExpenseRecord[];
}
const emptyMonth = (): MonthBucket => ({ income: 0, expense: 0, investmentTransfers: 0, fixed: 0, variable: 0, discretionary: 0,
  fuel: 0, vehicleOperating: 0, vehicleCapital: 0, subscription: 0, categories: new Map(),
  vehicle: Object.fromEntries(Object.keys(VEHICLE_COST_LABELS).map(kind => [kind, 0])) as Record<VehicleCostKind, number>, records: [] });

export function buildLifestyleInsights({ ledger, accounts = [], categoryPresets, fxRate, targetMonth,
  assumptions = DEFAULT_LIFESTYLE_ASSUMPTIONS, today = getTodayKST(), holdings = [] }: {
  ledger: LedgerEntry[]; accounts?: Account[]; categoryPresets?: CategoryPresets; fxRate: number | null;
  targetMonth: string; assumptions?: LifestyleAssumptions; today?: string;
  holdings?: { name: string; valueKRW: number; costKRW: number }[];
}) {
  const valid = ledger.filter(entry => /^\d{4}-\d{2}-\d{2}$/.test(entry.date ?? "") && parseIsoLocal(entry.date)
    && entry.date <= today && entry.date.slice(0, 7) <= targetMonth && Number.isFinite(Number(entry.amount)) && Number(entry.amount) > 0);
  const { salaryKeys } = computeIncomeNatureKeys(valid, accounts, categoryPresets?.categoryTypes);
  const byMonth = new Map<string, MonthBucket>();
  let missingFx = false;
  for (const entry of valid) {
    const month = entry.date.slice(0, 7);
    if (month < shiftMonth(targetMonth, -12)) continue;
    const bucket = byMonth.get(month) ?? emptyMonth();
    byMonth.set(month, bucket);
    if (entry.currency === "USD" && !(fxRate != null && Number.isFinite(fxRate) && fxRate > 0)) { missingFx = true; continue; }
    const amount = toKrwAmount(entry, fxRate);
    const flow = classifyLedgerFlow(entry, categoryPresets);
    if (flow === "income" && classifyLedgerFlow(entry, categoryPresets, salaryKeys) === "income") bucket.income += amount;
    if (flow === "investing" && !isInvestmentPnlEntry(entry)) bucket.investmentTransfers += amount;
    if (flow !== "expense") continue;
    const main = expenseMainName(entry) || "기타";
    const detail = entry.detailCategory || entry.description || main;
    const override = Object.hasOwn(assumptions.vehicleOverrides, entry.id) ? assumptions.vehicleOverrides[entry.id] : undefined;
    const vehicle = override === "exclude" ? null : override ?? classifyVehicleCost(entry);
    const subscription = [entry.category, entry.subCategory, entry.detailCategory].some(name => /구독/.test(name ?? ""));
    bucket.expense += amount;
    const nature = classifyExpenseNature(entry, categoryPresets);
    if (nature) bucket[nature] += amount;
    const category = bucket.categories.get(main) ?? { amount: 0, count: 0 };
    category.amount += amount; category.count++;
    bucket.categories.set(main, category);
    if (vehicle) {
      bucket.vehicle[vehicle] += amount;
      if (vehicle === "finance" || vehicle === "purchase") bucket.vehicleCapital += amount;
      else bucket.vehicleOperating += amount;
      if (vehicle === "fuel") bucket.fuel += amount;
    }
    if (subscription) bucket.subscription += amount;
    bucket.records.push({ entry, amount, main, detail, vehicle, subscription });
  }
  const partialDay = targetMonth === today.slice(0, 7) ? Number(today.slice(8, 10)) : null;
  const current = byMonth.get(targetMonth) ?? emptyMonth();
  // Monthly headline costs must describe a finished calendar month, never MTD spending.
  const completedMonth = targetMonth < today.slice(0, 7) ? targetMonth : shiftMonth(today.slice(0, 7), -1);
  const completed = byMonth.get(completedMonth) ?? emptyMonth();
  const fuelReferenceMonths = [0, -1, -2].map(offset => shiftMonth(completedMonth, offset));
  const fuelReferenceCount = fuelReferenceMonths.filter(month => byMonth.has(month)).length;
  const fuelAverage3 = fuelReferenceCount === 3 && !missingFx
    ? fuelReferenceMonths.reduce((sum, month) => sum + byMonth.get(month)!.fuel, 0) / 3 : null;
  const latestRecord = valid.filter(entry => entry.date.slice(0, 7) === targetMonth).map(entry => entry.date).sort().at(-1) ?? null;
  const daysSinceLastRecord = partialDay != null && latestRecord ? partialDay - Number(latestRecord.slice(8, 10)) : null;
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(targetMonth, i - 11));
  const monthly = months.map(month => ({ month, recorded: byMonth.has(month), partial: month === today.slice(0, 7), ...byMonth.get(month) ?? emptyMonth() }));
  // Planning references use only prior calendar months with records, never the partial current month.
  const baselineMonths = Array.from({ length: 12 }, (_, i) => shiftMonth(targetMonth, -i - 1)).filter(month => month < today.slice(0, 7) && byMonth.has(month));
  const reference = baselineMonths.map(month => byMonth.get(month)!);
  const avg = (get: (bucket: MonthBucket) => number): number | null => reference.length && !missingFx
    ? reference.reduce((sum, bucket) => sum + get(bucket), 0) / reference.length : null;
  const allNames = new Set([...current.categories.keys(), ...reference.flatMap(bucket => [...bucket.categories.keys()])]);
  const categories = [...allNames].map(name => ({ name, amount: current.categories.get(name)?.amount ?? 0,
    count: current.categories.get(name)?.count ?? 0, monthlyAverage: avg(bucket => bucket.categories.get(name)?.amount ?? 0),
    reductionMonthly: avg(bucket => (bucket.categories.get(name)?.amount ?? 0) * assumptions.reductionPct / 100) }))
    .sort((a, b) => (b.monthlyAverage ?? b.amount) - (a.monthlyAverage ?? a.amount));
  const detailName = (record: ExpenseRecord) => `${record.main} / ${record.detail}`;
  const detailNames = new Set([...current.records, ...reference.flatMap(bucket => bucket.records)].map(detailName));
  const detailCategories = [...detailNames].map(name => {
    const currentRows = current.records.filter(record => detailName(record) === name);
    const average = avg(bucket => bucket.records.filter(record => detailName(record) === name).reduce((sum, record) => sum + record.amount, 0));
    return { name, amount: currentRows.reduce((sum, record) => sum + record.amount, 0), count: currentRows.length,
      monthlyAverage: average, reductionMonthly: average == null ? null : average * assumptions.reductionPct / 100 };
  }).sort((a, b) => (b.monthlyAverage ?? b.amount) - (a.monthlyAverage ?? a.amount));
  const subscriptions = new Map<string, { name: string; amount: number; months: Set<string> }>();
  const occasional = new Map<string, { name: string; amount: number; months: Set<string>; max: number }>();
  for (const month of baselineMonths) for (const record of byMonth.get(month)!.records) {
    if (record.subscription) {
      const name = record.entry.detailCategory || record.entry.description || record.main;
      const row = subscriptions.get(name) ?? { name, amount: 0, months: new Set<string>() };
      row.amount += record.amount; row.months.add(month); subscriptions.set(name, row);
    }
    const name = `${record.main} · ${record.detail}`;
    const row = occasional.get(name) ?? { name, amount: 0, months: new Set<string>(), max: 0 };
    row.amount += record.amount; row.months.add(month); row.max = Math.max(row.max, record.amount); occasional.set(name, row);
  }
  const operatingAverage = avg(bucket => bucket.vehicleOperating);
  const carlessCashMonthly = operatingAverage != null && assumptions.replacementMonthly != null
    ? operatingAverage - assumptions.replacementMonthly : null;
  const averageIncome = reference.some(bucket => bucket.income > 0) ? avg(bucket => bucket.income) : null;
  const averageExpense = avg(bucket => bucket.expense);
  const freeBeforeInvestment = averageIncome != null && averageExpense != null ? averageIncome - averageExpense : null;
  const afterPlannedInvestment = freeBeforeInvestment != null ? freeBeforeInvestment - assumptions.plannedInvestmentMonthly : null;
  const sanitizedHoldings = holdings.filter(holding => Number.isFinite(holding.valueKRW) && holding.valueKRW > 0).sort((a, b) => b.valueKRW - a.valueKRW);
  const investmentValue = sanitizedHoldings.reduce((sum, holding) => sum + holding.valueKRW, 0);
  return { targetMonth, partialDay, hasCurrent: byMonth.has(targetMonth), current, monthly, baselineMonths, missingFx, latestRecord, daysSinceLastRecord,
    completedMonth, completed, hasCompleted: byMonth.has(completedMonth),
    completedFuelCount: completed.records.filter(record => record.vehicle === "fuel").length,
    fuelAverage3, fuelReferenceCount,
    categories, detailCategories, averageIncome, averageExpense, freeBeforeInvestment, afterPlannedInvestment,
    fuelCount: current.records.filter(record => record.vehicle === "fuel").length,
    averages: { fuel: avg(bucket => bucket.fuel), vehicleOperating: operatingAverage, vehicleCapital: avg(bucket => bucket.vehicleCapital),
      subscription: avg(bucket => bucket.subscription), fixed: avg(bucket => bucket.fixed), variable: avg(bucket => bucket.variable), discretionary: avg(bucket => bucket.discretionary) },
    vehicleBreakdown: Object.entries(VEHICLE_COST_LABELS).map(([kind, label]) => ({ kind: kind as VehicleCostKind, label,
      amount: current.vehicle[kind as VehicleCostKind], monthlyAverage: avg(bucket => bucket.vehicle[kind as VehicleCostKind]) })),
    carless: { monthly: carlessCashMonthly, annual: carlessCashMonthly == null ? null : carlessCashMonthly * 12,
      fiveYears: carlessCashMonthly == null ? null : carlessCashMonthly * 60,
      withDepreciationMonthly: carlessCashMonthly != null && assumptions.depreciationMonthly != null ? carlessCashMonthly + assumptions.depreciationMonthly : null },
    subscriptions: [...subscriptions.values()].map(row => ({ name: row.name, amount: row.amount, activeMonths: row.months.size,
      monthlyAverage: missingFx ? null : row.amount / reference.length })).sort((a, b) => b.amount - a.amount),
    occasional: reference.length < 3 || missingFx ? [] : [...occasional.values()]
      .filter(row => row.months.size <= Math.max(1, Math.floor(reference.length / 2)) && row.amount >= 50_000)
      .map(row => ({ name: row.name, amount: row.amount, activeMonths: row.months.size, largest: row.max, monthlyReserve: row.amount / reference.length }))
      .sort((a, b) => b.amount - a.amount).slice(0, 12),
    investmentValue, holdings: sanitizedHoldings.map(holding => ({ ...holding, share: holding.valueKRW / investmentValue * 100 })),
  };
}
