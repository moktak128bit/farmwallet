import React, { useMemo, useState } from "react";
import type { Account, CategoryPresets, LedgerEntry } from "../types";
import { formatKRW } from "../utils/formatter";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, Tooltip, XAxis, YAxis } from "recharts";
import { DeferredResponsiveContainer as ResponsiveContainer } from "../components/charts/DeferredResponsiveContainer";

type SpendRow = { category: string; amount: number };
type SpendMidRow = { main: string; mid: string; amount: number };
type DailySpendRow = { date: string; amount: number; count: number };

function monthOf(dateStr: string): string {
  return (dateStr || "").slice(0, 7);
}

function pickDefaultMonth(ledger: LedgerEntry[]): string {
  const months = ledger
    .filter((l) => l?.kind === "expense" && l.date)
    .map((l) => monthOf(l.date))
    .filter(Boolean)
    .sort();
  return months.length ? months[months.length - 1] : new Date().toISOString().slice(0, 7);
}

export const SpendView: React.FC<{
  accounts: Account[];
  ledger: LedgerEntry[];
  categoryPresets: CategoryPresets;
}> = ({ accounts, ledger }) => {
  const [month, setMonth] = useState<string>(() => pickDefaultMonth(ledger));
  const [selectedMain, setSelectedMain] = useState<string | null>(null);

  const spendEntries = useMemo(
    () =>
      ledger.filter(
        (l) =>
          l.kind === "expense" &&
          l.date &&
          monthOf(l.date) === month &&
          Number(l.amount) > 0 &&
          l.category !== "신용결제" &&
          l.category !== "재테크"
      ),
    [ledger, month]
  );

  const totalSpend = useMemo(() => spendEntries.reduce((s, e) => s + (e.amount ?? 0), 0), [spendEntries]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of spendEntries) {
      const key = (e.category || "기타").trim() || "기타";
      map.set(key, (map.get(key) ?? 0) + (e.amount ?? 0));
    }
    const rows: SpendRow[] = Array.from(map.entries()).map(([category, amount]) => ({ category, amount }));
    rows.sort((a, b) => b.amount - a.amount);
    return rows;
  }, [spendEntries]);

  const byMid = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of spendEntries) {
      const main = (e.category || "기타").trim() || "기타";
      const mid = (e.subCategory || "미분류").trim() || "미분류";
      const key = `${main}::${mid}`;
      map.set(key, (map.get(key) ?? 0) + (e.amount ?? 0));
    }
    const rows: SpendMidRow[] = Array.from(map.entries()).map(([key, amount]) => {
      const [main, mid] = key.split("::");
      return { main, mid, amount };
    });
    rows.sort((a, b) => b.amount - a.amount);
    return rows;
  }, [spendEntries]);

  const mainPieData = useMemo(() => {
    const data = byCategory
      .filter((r) => r.amount > 0)
      .map((r) => ({ name: r.category, value: r.amount, fullName: r.category }));
    return data;
  }, [byCategory]);

  const midBarData = useMemo(() => {
    const list = selectedMain ? byMid.filter((r) => r.main === selectedMain) : byMid;
    const top = list.slice(0, 12);
    return top.map((r) => ({
      name: r.mid.length > 18 ? `${r.mid.slice(0, 18)}...` : r.mid,
      value: r.amount,
      fullName: r.mid,
      main: r.main
    }));
  }, [byMid, selectedMain]);

  const byDay = useMemo(() => {
    const map = new Map<string, { amount: number; count: number }>();
    for (const e of spendEntries) {
      const key = e.date;
      const prev = map.get(key) ?? { amount: 0, count: 0 };
      map.set(key, { amount: prev.amount + (e.amount ?? 0), count: prev.count + 1 });
    }
    const rows: DailySpendRow[] = Array.from(map.entries()).map(([date, v]) => ({ date, amount: v.amount, count: v.count }));
    rows.sort((a, b) => b.date.localeCompare(a.date));
    return rows;
  }, [spendEntries]);

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    ledger.forEach((l) => {
      if (l.kind === "expense" && l.date) set.add(monthOf(l.date));
    });
    const months = Array.from(set).sort((a, b) => b.localeCompare(a));
    return months.length ? months : [new Date().toISOString().slice(0, 7)];
  }, [ledger]);

  const colors = ["#0ea5e9", "#6366f1", "#f43f5e", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ margin: "0 0 4px 0" }}>소비</h2>

      <div className="card" style={{ padding: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ color: "var(--muted)" }}>기간:</span>
        <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ padding: "6px 10px", borderRadius: 6 }}>
          {monthOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <span style={{ marginLeft: "auto", fontWeight: 700 }}>
          총지출: <span className="negative">{formatKRW(Math.round(totalSpend))}</span>
        </span>
      </div>

      <div className="card" style={{ padding: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>한눈에 보기 (대분류/중분류)</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="hint" style={{ fontSize: 12 }}>
              대분류 파이를 클릭하면 중분류가 필터됩니다.
            </span>
            <button
              type="button"
              className={selectedMain == null ? "primary" : "secondary"}
              onClick={() => setSelectedMain(null)}
              style={{ padding: "6px 10px", fontSize: 12 }}
            >
              전체
            </button>
            {selectedMain && (
              <span className="pill" style={{ fontSize: 12 }}>
                선택됨: {selectedMain}
              </span>
            )}
          </div>
        </div>

        {spendEntries.length === 0 ? (
          <div className="hint" style={{ padding: 12 }}>
            선택한 기간에 지출이 없습니다.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, marginTop: 12 }}>
            <div className="card" style={{ padding: 12, boxShadow: "none", border: "1px solid var(--border)" }}>
              <h4 style={{ margin: "0 0 10px 0", textAlign: "center" }}>대분류 비중</h4>
              <div style={{ width: "100%", height: 320, minHeight: 320, minWidth: 0 }}>
                <ResponsiveContainer width="100%" height="100%" minHeight={320} minWidth={0}>
                  <PieChart>
                    <Pie
                      data={mainPieData}
                      cx="50%"
                      cy="50%"
                      outerRadius={95}
                      dataKey="value"
                      label={({ percent }) => (percent ? `${(percent * 100).toFixed(1)}%` : "0%")}
                      labelLine={false}
                      onClick={(data: any) => {
                        const name = String(data?.name ?? "");
                        if (!name) return;
                        setSelectedMain((prev) => (prev === name ? null : name));
                      }}
                    >
                      {mainPieData.map((_, index) => (
                        <Cell key={`main-${index}`} fill={colors[index % colors.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: any, _name: any, item: any) => [
                        formatKRW(Math.round(Number(value ?? 0))),
                        item?.payload?.fullName ?? item?.payload?.name ?? "대분류"
                      ]}
                    />
                    <Legend
                      formatter={(value: any, entry: any) => entry?.payload?.fullName ?? value}
                      wrapperStyle={{ fontSize: 11 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card" style={{ padding: 12, boxShadow: "none", border: "1px solid var(--border)" }}>
              <h4 style={{ margin: "0 0 10px 0", textAlign: "center" }}>
                중분류 Top {selectedMain ? `(대분류: ${selectedMain})` : ""}
              </h4>
              <div style={{ width: "100%", height: 320, minHeight: 320, minWidth: 0 }}>
                <ResponsiveContainer width="100%" height="100%" minHeight={320} minWidth={0}>
                  <BarChart data={midBarData} margin={{ top: 10, right: 16, left: 8, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="name"
                      interval={0}
                      angle={-20}
                      textAnchor="end"
                      height={60}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tickFormatter={(v) => `${Math.round(Number(v) / 10000)}만`}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={42}
                    />
                    <Tooltip
                      formatter={(value: any, _name: any, item: any) => [
                        formatKRW(Math.round(Number(value ?? 0))),
                        `${item?.payload?.main ?? ""} / ${item?.payload?.fullName ?? item?.payload?.name ?? "중분류"}`
                      ]}
                    />
                    <Bar dataKey="value" name="지출" radius={[6, 6, 0, 0]}>
                      {midBarData.map((_, index) => (
                        <Cell key={`mid-${index}`} fill={colors[index % colors.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
        <div className="card" style={{ padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>대분류별 지출</h3>
          {byCategory.length === 0 ? (
            <div className="hint" style={{ padding: 12 }}>
              선택한 기간에 지출이 없습니다.
            </div>
          ) : (
            <table className="data-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>대분류</th>
                  <th className="number">금액</th>
                </tr>
              </thead>
              <tbody>
                {byCategory.slice(0, 20).map((r) => (
                  <tr key={r.category}>
                    <td>{r.category}</td>
                    <td className="number negative" style={{ fontWeight: 600 }}>
                      {formatKRW(Math.round(r.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card" style={{ padding: 12 }}>
          <h3 style={{ marginTop: 0 }}>일자별 지출</h3>
          {byDay.length === 0 ? (
            <div className="hint" style={{ padding: 12 }}>
              선택한 기간에 지출이 없습니다.
            </div>
          ) : (
            <table className="data-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>날짜</th>
                  <th className="number">건수</th>
                  <th className="number">금액</th>
                </tr>
              </thead>
              <tbody>
                {byDay.slice(0, 31).map((r) => (
                  <tr key={r.date}>
                    <td>{r.date}</td>
                    <td className="number">{r.count}</td>
                    <td className="number negative" style={{ fontWeight: 600 }}>
                      {formatKRW(Math.round(r.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>지출 내역</h3>
        {spendEntries.length === 0 ? (
          <div className="hint" style={{ padding: 12 }}>
            선택한 기간에 지출이 없습니다.
          </div>
        ) : (
          <table className="data-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>날짜</th>
                <th style={{ width: 110 }}>계좌</th>
                <th style={{ width: 140 }}>대분류</th>
                <th style={{ width: 160 }}>중분류</th>
                <th>상세내역</th>
                <th className="number" style={{ width: 140 }}>
                  금액
                </th>
              </tr>
            </thead>
            <tbody>
              {spendEntries
                .slice()
                .sort((a, b) => (a.date !== b.date ? b.date.localeCompare(a.date) : a.id.localeCompare(b.id)))
                .slice(0, 200)
                .map((e) => {
                  const accId = e.fromAccountId || e.toAccountId || "";
                  const accName = accounts.find((a) => a.id === accId)?.name ?? accId;
                  const main = (e.category || "기타").trim() || "기타";
                  const mid = (e.subCategory || "미분류").trim() || "미분류";
                  return (
                    <tr key={e.id}>
                      <td>{e.date}</td>
                      <td title={accId}>{accName}</td>
                      <td>{main}</td>
                      <td>{mid}</td>
                      <td style={{ color: "var(--text-muted)" }}>{e.description}</td>
                      <td className="number negative" style={{ fontWeight: 600 }}>
                        {formatKRW(Math.round(e.amount))}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        )}
        {spendEntries.length > 200 && (
          <div className="hint" style={{ marginTop: 8 }}>
            최근 200건만 표시 중 (총 {spendEntries.length}건)
          </div>
        )}
      </div>
    </div>
  );
};

