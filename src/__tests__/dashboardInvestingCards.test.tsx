/**
 * 대시보드 카드 간 재테크·지출 수치 정합 회귀 — 카드마다 따로 집계하다 KPI와 어긋나던 문제.
 *  - 저축률(이체 기준): 분자는 저축이체+투자이체만 (투자수익·손실 순액 섞이면 60%/−10% 같은 허수)
 *  - 월별 추이·소비 캘린더: 투자손실·수수료는 재테크 순액에서 − (KPI computeLedgerSummary와 동일 부호)
 *  - 페이스 카드 '현재 지출' = KPI '이번 달 지출' (환전·투자손실·수수료 제외)
 * 노드 환경 SSR(renderToStaticMarkup)로 렌더 결과 텍스트만 확인한다.
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CategoryPresets, LedgerEntry } from "../types";
import { SavingsRatioCard } from "../features/dashboard/SavingsRatioCard";
import { MonthlyTrendCard } from "../features/dashboard/MonthlyTrendCard";
import { SpendingCalendarCard } from "../features/dashboard/SpendingCalendarCard";
import { MonthPaceCard } from "../features/dashboard/MonthPaceCard";
import { computeLedgerSummary } from "../features/dashboard/summaryMath";
import { formatKRW } from "../utils/formatter";

const presets = { income: [], expense: [], transfer: [] } as unknown as CategoryPresets;
let seq = 0;
const e = (o: Partial<LedgerEntry>): LedgerEntry =>
  ({ id: `d${++seq}`, date: "2026-06-10", kind: "expense", category: "지출", description: "", amount: 0, fromAccountId: "A1", ...o } as LedgerEntry);

const salary = (date: string) => e({ kind: "income", category: "수입", subCategory: "급여", amount: 3_000_000, date, toAccountId: "A1" });
const save = (amount: number, date = "2026-06-10") => e({ kind: "transfer", category: "이체", subCategory: "저축이체", amount, date, toAccountId: "S1" });
const loss = (amount: number, date = "2026-06-11") => e({ kind: "expense", category: "재테크", subCategory: "투자손실", amount, date });
const fee = (amount: number, date = "2026-06-12") => e({ kind: "expense", category: "재테크", subCategory: "수수료", amount, date });

describe("SavingsRatioCard — 저축률 분자는 재테크 이체만", () => {
  const render = (ledger: LedgerEntry[]) =>
    renderToStaticMarkup(<SavingsRatioCard ledger={ledger} fxRate={null} currentMonth="2026-07" categoryPresets={presets} />);
  const base = [
    salary("2026-06-25"),
    save(300_000),
    e({ kind: "transfer", category: "이체", subCategory: "투자이체", amount: 300_000, toAccountId: "S2" }),
  ];

  it("투자수익 1,200,000이 있어도 (300,000+300,000)/3,000,000 = 20%", () => {
    const html = render([...base, e({ kind: "income", category: "수입", subCategory: "투자수익", amount: 1_200_000, toAccountId: "A1" })]);
    expect(html).toContain("20.0%");
  });

  it("투자손실 900,000이 있어도 20% (음수 저축률 아님)", () => {
    const html = render([...base, loss(900_000, "2026-06-15")]);
    expect(html).toContain("20.0%");
  });
});

describe("재테크 순액 부호 — 월별 추이·캘린더가 KPI와 같다", () => {
  const ledger = [salary("2026-06-25"), save(500_000), loss(1_000_000), fee(10_000)];

  it("KPI 재테크 = 500,000 − 1,000,000 − 10,000 = −510,000", () => {
    expect(computeLedgerSummary(ledger, null, "2026-06", presets).investing).toBe(-510_000);
  });

  it("MonthlyTrendCard: 재테크 막대가 +1,510,000(50%)로 그려지지 않는다", () => {
    const html = renderToStaticMarkup(<MonthlyTrendCard ledger={ledger} categoryPresets={presets} fxRate={null} />);
    const widths = [...html.matchAll(/width:([\d.-]+)%/g)].map((m) => Number(m[1]));
    expect(widths).toEqual([100, 0, 0]); // 수입 100% · 지출 0 · 재테크(순액 음수) 0
  });

  it("SpendingCalendarCard: 월 재테크 합계가 KPI와 같은 −510,000", () => {
    const html = renderToStaticMarkup(
      <SpendingCalendarCard ledger={ledger} accounts={[]} categoryPresets={presets} fxRate={null} currentMonth="2026-06" today="2026-06-20" />
    ).replace(/<!-- -->/g, ""); // SSR이 인접 텍스트 노드 사이에 넣는 주석 제거
    expect(html).toContain(`재테크 ${formatKRW(-510_000)}`);
    expect(html).not.toContain(formatKRW(1_510_000));
  });
});

describe("MonthPaceCard — 현재 지출 = KPI 이번 달 지출", () => {
  it("환전·투자손실·수수료는 현재 지출에 들어가지 않는다", () => {
    const ledger = [
      e({ category: "지출", subCategory: "식비", amount: 200_000 }),
      e({ category: "환전", amount: 1_000_000 }),
      loss(500_000),
      fee(10_000),
    ];
    const kpi = computeLedgerSummary(ledger, null, "2026-06", presets).expense;
    expect(kpi).toBe(200_000);
    const html = renderToStaticMarkup(
      <MonthPaceCard currentMonth="2026-06" today="2026-06-20" ledger={ledger} accounts={[]} categoryPresets={presets} fxRate={null} />
    );
    expect(html).toContain(`현재 지출</div><div style="font-weight:700;font-size:22px">${formatKRW(200_000)}`);
  });
});
