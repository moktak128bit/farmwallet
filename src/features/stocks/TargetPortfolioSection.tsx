import React, { useMemo, useState, useRef, useEffect } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid
} from "recharts";
import type { TargetPortfolio, TargetPortfolioItem, Account } from "../../types";
import type { StockPrice } from "../../types";
import type { TickerInfo } from "../../types";
import { formatKRW, formatUSD } from "../../utils/formatter";
import { isUSDStock, canonicalTickerForMatch } from "../../utils/finance";

const CHART_COLORS = ["#0ea5e9", "#6366f1", "#f43f5e", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#64748b"];

export interface PositionWithPrice {
  accountId: string;
  accountName: string;
  ticker: string;
  name: string;
  quantity: number;
  marketValue: number;
  displayMarketPrice: number;
  currency?: string;
}

interface TargetPortfolioSectionProps {
  positionsWithPrice: PositionWithPrice[];
  positionsByAccount: Array<{ accountId: string; accountName: string; rows: PositionWithPrice[] }>;
  accounts: Account[];
  prices: StockPrice[];
  tickerDatabase?: TickerInfo[];
  targetPortfolios: TargetPortfolio[];
  onChangeTargetPortfolios: (next: TargetPortfolio[]) => void;
  fxRate: number | null;
}

/** 목표/보유 비교용 티커 정규화 (한국형 4~5자 → 6자 통일 포함) */
function normTicker(t: string): string {
  return canonicalTickerForMatch(t);
}

export const TargetPortfolioSection: React.FC<TargetPortfolioSectionProps> = ({
  positionsWithPrice,
  positionsByAccount,
  accounts,
  prices,
  tickerDatabase = [],
  targetPortfolios,
  onChangeTargetPortfolios,
  fxRate
}) => {
  const securitiesAccounts = useMemo(
    () => accounts.filter((a) => a.type === "securities"),
    [accounts]
  );

  const [scopeAccountId, setScopeAccountId] = useState<string | "all">("all");
  const [selectedTargetId, setSelectedTargetId] = useState<string | "">(
    targetPortfolios[0]?.id ?? ""
  );
  const [editingTarget, setEditingTarget] = useState<TargetPortfolio | null>(null);

  const positionsInScope = useMemo(() => {
    if (scopeAccountId === "all") return positionsWithPrice;
    return positionsWithPrice.filter((p) => p.accountId === scopeAccountId);
  }, [positionsWithPrice, scopeAccountId]);

  const totalMarketValueKRW = useMemo(() => {
    const rate = fxRate ?? 0;
    return positionsInScope.reduce((sum, p) => {
      const isUSD = p.currency === "USD" || isUSDStock(p.ticker);
      return sum + (isUSD ? p.marketValue * rate : p.marketValue);
    }, 0);
  }, [positionsInScope, fxRate]);

  const selectedTarget = useMemo(
    () => targetPortfolios.find((t) => t.id === selectedTargetId) ?? null,
    [targetPortfolios, selectedTargetId]
  );

  const targetMatchesScope = useMemo(() => {
    if (!selectedTarget) return true;
    if (selectedTarget.accountId === null) return scopeAccountId === "all";
    return selectedTarget.accountId === scopeAccountId;
  }, [selectedTarget, scopeAccountId]);

  const achievementData = useMemo(() => {
    if (!selectedTarget || selectedTarget.items.length === 0 || totalMarketValueKRW <= 0) {
      return { rows: [], overallPercent: 0 };
    }
    const rate = fxRate ?? 0;
    const rows = selectedTarget.items.map((item) => {
      const targetValueKRW = (totalMarketValueKRW * item.targetPercent) / 100;
      const currentValue = positionsInScope
        .filter((p) => normTicker(p.ticker) === normTicker(item.ticker))
        .reduce((s, p) => s + p.marketValue, 0);
      const isUSD = isUSDStock(item.ticker);
      const currentValueKRW = isUSD ? currentValue * rate : currentValue;
      const priceInfo = prices.find((x) => normTicker(x.ticker) === normTicker(item.ticker));
      const tickerInfo = tickerDatabase.find((x) => normTicker(x.ticker) === normTicker(item.ticker));
      const currentPrice = priceInfo?.price ?? 0;
      const achievement = targetValueKRW > 0 ? (currentValueKRW / targetValueKRW) * 100 : 0;
      const diffKRW = targetValueKRW - currentValueKRW;
      const priceKRW = isUSD ? currentPrice * rate : currentPrice;
      const sharesToTrade = priceKRW > 0 ? Math.abs(diffKRW) / priceKRW : 0;
      const baseName = priceInfo?.name ?? tickerInfo?.name ?? item.ticker;
      const displayName = item.alias?.trim() || baseName;
      return {
        ticker: item.ticker,
        name: baseName,
        displayName,
        targetPercent: item.targetPercent,
        targetValueKRW,
        currentValueKRW,
        currentValue,
        isUSD,
        achievement,
        diffKRW,
        sharesToTrade,
        currentPrice
      };
    });
    const totalTargetKRW = rows.reduce((s, r) => s + r.targetValueKRW, 0);
    const totalCurrentKRW = rows.reduce((s, r) => s + r.currentValueKRW, 0);
    const overallPercent = totalTargetKRW > 0 ? (totalCurrentKRW / totalTargetKRW) * 100 : 0;
    return { rows, overallPercent };
  }, [
    selectedTarget,
    positionsInScope,
    totalMarketValueKRW,
    prices,
    tickerDatabase,
    fxRate
  ]);

  const handleAddTarget = () => {
    const id = `TP${Date.now()}`;
    const newTarget: TargetPortfolio = {
      id,
      name: "새 목표 포트폴리오",
      accountId: scopeAccountId === "all" ? null : scopeAccountId,
      items: [],
      updatedAt: new Date().toISOString()
    };
    onChangeTargetPortfolios([...targetPortfolios, newTarget]);
    setSelectedTargetId(id);
    setEditingTarget(newTarget);
  };

  const handleSaveTarget = (updated: TargetPortfolio) => {
    onChangeTargetPortfolios(
      targetPortfolios.map((t) => (t.id === updated.id ? { ...updated, updatedAt: new Date().toISOString() } : t))
    );
    setEditingTarget(null);
  };

  const handleDeleteTarget = (id: string) => {
    onChangeTargetPortfolios(targetPortfolios.filter((t) => t.id !== id));
    if (selectedTargetId === id) setSelectedTargetId(targetPortfolios[0]?.id ?? "");
    setEditingTarget(null);
  };

  const handleAddItem = (ticker: string, targetPercent: number) => {
    if (!editingTarget) return;
    const newItems = [...editingTarget.items, { ticker: ticker.trim().toUpperCase(), targetPercent }];
    const sum = newItems.reduce((s, i) => s + i.targetPercent, 0);
    if (sum > 100) return;
    setEditingTarget({ ...editingTarget, items: newItems });
  };

  const handleRemoveItem = (index: number) => {
    if (!editingTarget) return;
    setEditingTarget({
      ...editingTarget,
      items: editingTarget.items.filter((_, i) => i !== index)
    });
  };

  const handleUpdateItemPercent = (index: number, targetPercent: number) => {
    if (!editingTarget) return;
    const next = editingTarget.items.map((item, i) =>
      i === index ? { ...item, targetPercent } : item
    );
    const sum = next.reduce((s, i) => s + i.targetPercent, 0);
    if (sum > 100) return;
    setEditingTarget({ ...editingTarget, items: next });
  };

  const handleUpdateItemAlias = (index: number, alias: string) => {
    if (!editingTarget) return;
    const next = editingTarget.items.map((item, i) =>
      i === index ? { ...item, alias: alias.trim() || undefined } : item
    );
    setEditingTarget({ ...editingTarget, items: next });
  };

  const accountWeights = useMemo(() => {
    if (scopeAccountId !== "all" || totalMarketValueKRW <= 0) return [];
    const rate = fxRate ?? 0;
    const byAccount = new Map<string, { accountName: string; valueKRW: number }>();
    for (const p of positionsInScope) {
      const isUSD = p.currency === "USD" || isUSDStock(p.ticker);
      const valueKRW = isUSD ? p.marketValue * rate : p.marketValue;
      const cur = byAccount.get(p.accountId) ?? { accountName: p.accountName, valueKRW: 0 };
      byAccount.set(p.accountId, { accountName: cur.accountName, valueKRW: cur.valueKRW + valueKRW });
    }
    return Array.from(byAccount.entries())
      .map(([accountId, { accountName, valueKRW }]) => ({
        accountId,
        accountName,
        valueKRW,
        percent: (valueKRW / totalMarketValueKRW) * 100
      }))
      .sort((a, b) => b.valueKRW - a.valueKRW);
  }, [scopeAccountId, positionsInScope, totalMarketValueKRW, fxRate]);

  // 차트용 데이터: 목표 원그래프, 현재 원그래프, 목표 vs 현재 막대그래프
  const targetPieData = useMemo(() => {
    if (!selectedTarget || selectedTarget.items.length === 0) return [];
    return selectedTarget.items.map((item) => {
      const priceInfo = prices.find((x) => normTicker(x.ticker) === normTicker(item.ticker));
      const tickerInfo = tickerDatabase.find((x) => normTicker(x.ticker) === normTicker(item.ticker));
      const baseName = priceInfo?.name ?? tickerInfo?.name ?? item.ticker;
      const fullName = baseName !== item.ticker ? `${item.ticker} · ${baseName}` : item.ticker;
      const alias = item.alias?.trim();
      return {
        name: alias || baseName,
        value: item.targetPercent,
        alias: alias || undefined,
        fullName
      };
    });
  }, [selectedTarget, prices, tickerDatabase]);

  const currentPieData = useMemo(() => {
    if (achievementData.rows.length === 0 || totalMarketValueKRW <= 0) return [];
    return achievementData.rows.map((r) => {
      const currentPercent = (r.currentValueKRW / totalMarketValueKRW) * 100;
      const alias = selectedTarget?.items.find((i) => normTicker(i.ticker) === normTicker(r.ticker))?.alias?.trim();
      const fullName = r.name !== r.ticker ? `${r.ticker} · ${r.name}` : r.ticker;
      const labelInPie = alias || r.name || r.ticker;
      return {
        name: labelInPie,
        value: Math.round(currentPercent * 10) / 10,
        alias: alias || undefined,
        fullName
      };
    }).filter((d) => d.value > 0);
  }, [achievementData.rows, totalMarketValueKRW, selectedTarget]);

  const barChartData = useMemo(() => {
    if (!selectedTarget || selectedTarget.items.length === 0) return [];
    if (achievementData.rows.length === 0) {
      return selectedTarget.items.map((item) => {
        const priceInfo = prices.find((x) => normTicker(x.ticker) === normTicker(item.ticker));
        const baseName = priceInfo?.name ?? item.ticker;
        const displayName = item.alias?.trim() || baseName;
        return {
          name: displayName.length > 12 ? displayName.slice(0, 11) + "…" : displayName,
          ticker: item.ticker,
          target: item.targetPercent,
          actual: 0
        };
      });
    }
    return achievementData.rows.map((r) => {
      const currentPercent = totalMarketValueKRW > 0 ? (r.currentValueKRW / totalMarketValueKRW) * 100 : 0;
      const displayName = r.displayName || r.name || r.ticker;
      return {
        name: displayName.length > 12 ? displayName.slice(0, 11) + "…" : displayName,
        ticker: r.ticker,
        target: r.targetPercent,
        actual: Math.round(currentPercent * 10) / 10
      };
    });
  }, [selectedTarget, achievementData.rows, totalMarketValueKRW, prices]);

  return (
    <div className="card" style={{ padding: 16, marginTop: 24 }}>
      <h2 style={{ margin: "0 0 8px 0" }}>목표 포트폴리오</h2>
      <p style={{ margin: "0 0 16px 0", fontSize: 13, color: "var(--text-muted)" }}>
        목표와 현재 포트폴리오를 비교해 어떻게 조정할지 확인하고, 전체 계좌 비중을 볼 수 있습니다.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>범위</span>
          <select
            value={scopeAccountId}
            onChange={(e) => setScopeAccountId(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 13 }}
          >
            <option value="all">전체</option>
            {securitiesAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.id}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>목표 포트폴리오</span>
          <select
            value={selectedTargetId}
            onChange={(e) => {
              setSelectedTargetId(e.target.value);
              setEditingTarget(null);
            }}
            style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 13, minWidth: 160 }}
          >
            <option value="">선택</option>
            {targetPortfolios
              .filter((t) => t.accountId === null || t.accountId === scopeAccountId || scopeAccountId === "all")
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} {t.accountId ? `(${accounts.find((a) => a.id === t.accountId)?.name ?? t.accountId})` : "(전체)"}
                </option>
              ))}
            <option value="__new__">+ 새로 만들기</option>
          </select>
        </label>
        {selectedTargetId === "__new__" && (
          <button type="button" className="primary" onClick={handleAddTarget} style={{ padding: "6px 12px", fontSize: 13 }}>
            추가
          </button>
        )}
        {selectedTarget && selectedTargetId !== "__new__" && (
          <button
            type="button"
            className="secondary"
            onClick={() => setEditingTarget(editingTarget ? null : selectedTarget)}
            style={{ padding: "6px 12px", fontSize: 13 }}
          >
            {editingTarget ? "편집 완료" : "목표 편집"}
          </button>
        )}
      </div>

      {scopeAccountId === "all" && accountWeights.length > 0 && (
        <div style={{ marginBottom: 20, padding: 12, border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface)" }}>
          <h4 style={{ margin: "0 0 10px 0", fontSize: 14 }}>전체 계좌 비중</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "8px 16px", alignItems: "center", fontSize: 13 }}>
            <span style={{ fontWeight: 600 }}>계좌</span>
            <span style={{ fontWeight: 600, textAlign: "right" }}>평가액</span>
            <span style={{ fontWeight: 600, textAlign: "right", minWidth: 56 }}>비중</span>
            {accountWeights.map((a) => (
              <React.Fragment key={a.accountId}>
                <span>{a.accountName || a.accountId}</span>
                <span style={{ textAlign: "right" }}>{formatKRW(Math.round(a.valueKRW))}</span>
                <span style={{ textAlign: "right" }}>{a.percent.toFixed(1)}%</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {selectedTargetId === "__new__" && !editingTarget && (
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>위에서 &quot;추가&quot;를 누르면 새 목표 포트폴리오가 생성됩니다.</p>
      )}

      {editingTarget && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, marginBottom: 16, background: "var(--surface)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <input
              type="text"
              value={editingTarget.name}
              onChange={(e) => setEditingTarget({ ...editingTarget, name: e.target.value })}
              placeholder="목표 이름"
              style={{ padding: "6px 10px", fontSize: 14, border: "1px solid var(--border)", borderRadius: 6, flex: 1, maxWidth: 200 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="primary" onClick={() => handleSaveTarget(editingTarget)} style={{ padding: "6px 12px", fontSize: 13 }}>
                저장
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => handleDeleteTarget(editingTarget.id)}
                style={{ padding: "6px 12px", fontSize: 13, color: "var(--danger)" }}
              >
                삭제
              </button>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
            범위: {editingTarget.accountId ? (accounts.find((a) => a.id === editingTarget.accountId)?.name ?? editingTarget.accountId) : "전체"}
          </div>
          <ul style={{ margin: "0 0 8px 0", paddingLeft: 20 }}>
            {editingTarget.items.map((item, i) => {
              const itemName =
                prices.find((x) => normTicker(x.ticker) === normTicker(item.ticker))?.name ??
                tickerDatabase.find((x) => normTicker(x.ticker) === normTicker(item.ticker))?.name;
              return (
              <li key={`${item.ticker}-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                <span style={{ minWidth: 80 }}>
                  {item.ticker}
                  {itemName && itemName !== item.ticker ? ` · ${itemName}` : ""}
                </span>
                <input
                  type="text"
                  placeholder="별칭 (그래프 표시)"
                  value={item.alias ?? ""}
                  onChange={(e) => handleUpdateItemAlias(i, e.target.value)}
                  maxLength={15}
                  title="그래프에 표시할 별칭 (예: 삼성, 내 애플)"
                  style={{ width: 100, padding: "4px 6px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 4 }}
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={item.targetPercent}
                  onChange={(e) => handleUpdateItemPercent(i, Number(e.target.value) || 0)}
                  style={{ width: 64, padding: "4px 6px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 4 }}
                />
                <span style={{ fontSize: 12 }}>%</span>
                <button type="button" onClick={() => handleRemoveItem(i)} style={{ padding: "2px 8px", fontSize: 11, color: "var(--danger)" }}>
                  제거
                </button>
              </li>
              );
            })}
          </ul>
          <AddItemForm onAdd={handleAddItem} existingTickers={editingTarget.items.map((i) => i.ticker)} prices={prices} tickerDatabase={tickerDatabase} />
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
            합계: {editingTarget.items.reduce((s, i) => s + i.targetPercent, 0).toFixed(1)}%
          </div>
        </div>
      )}

      {selectedTarget && !editingTarget && selectedTarget.items.length > 0 && (
        <>
          <h4 style={{ margin: "0 0 8px 0", fontSize: 14 }}>목표 vs 현재 · 어떻게 할지</h4>
          <p style={{ margin: "0 0 12px 0", fontSize: 12, color: "var(--text-muted)" }}>
            목표 비중과 현재 비중을 비교하고, &quot;달성을 위해&quot;에서 매수/매도 예시를 참고해 조정하세요.
          </p>
          <div style={{ marginBottom: 12, fontSize: 14 }}>
            <strong>범위 내 총 평가액 (주식)</strong>: {formatKRW(Math.round(totalMarketValueKRW))}
            {!targetMatchesScope && (
              <span style={{ marginLeft: 8, color: "var(--warning)", fontSize: 12 }}>
                (선택한 목표는 {selectedTarget.accountId ? "해당 계좌" : "전체"} 기준입니다)
              </span>
            )}
          </div>
          <div style={{ marginBottom: 12 }}>
            <strong>전체 달성도</strong>:{" "}
            <span style={{ color: achievementData.overallPercent >= 95 ? "var(--success)" : "var(--text)" }}>
              {achievementData.overallPercent.toFixed(1)}%
            </span>
          </div>

          {/* 원그래프 + 막대그래프: 목표 vs 현재 비교 */}
          <div style={{ marginBottom: 24 }}>
            <h4 style={{ margin: "0 0 12px 0", fontSize: 14 }}>비중 비교 (원그래프 · 막대그래프)</h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20, alignItems: "start" }}>
              {/* 목표 비중 원그래프 */}
              <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, background: "var(--surface)" }}>
                <h5 style={{ margin: "0 0 8px 0", fontSize: 13, textAlign: "center", color: "var(--text-muted)" }}>목표 비중</h5>
                <div style={{ width: "100%", height: 240, minHeight: 240 }}>
                  {targetPieData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={targetPieData}
                          cx="50%"
                          cy="50%"
                          outerRadius={70}
                          fill="#8884d8"
                          dataKey="value"
                          label={({ percent, payload }) => {
                            const text = payload?.alias || payload?.name;
                            const pct = percent ? ` ${(percent * 100).toFixed(1)}%` : "";
                            return text ? `${text}${pct}` : pct;
                          }}
                          labelLine={false}
                        >
                          {targetPieData.map((_, index) => (
                            <Cell key={`target-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: unknown) => [`${Number(value ?? 0)}%`, ""]} />
                        <Legend formatter={(_: string, entry: unknown) => (entry as { payload?: { fullName?: string } })?.payload?.fullName ?? ""} wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", color: "var(--text-muted)", fontSize: 12 }}>데이터 없음</div>
                  )}
                </div>
              </div>
              {/* 현재 비중 원그래프 */}
              <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, background: "var(--surface)" }}>
                <h5 style={{ margin: "0 0 8px 0", fontSize: 13, textAlign: "center", color: "var(--text-muted)" }}>현재 비중</h5>
                <div style={{ width: "100%", height: 240, minHeight: 240 }}>
                  {currentPieData.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={currentPieData}
                          cx="50%"
                          cy="50%"
                          outerRadius={70}
                          fill="#8884d8"
                          dataKey="value"
                          label={({ percent, payload }) => {
                            const text = payload?.alias || payload?.name;
                            const pct = percent ? ` ${(percent * 100).toFixed(1)}%` : "";
                            return text ? `${text}${pct}` : pct;
                          }}
                          labelLine={false}
                        >
                          {currentPieData.map((_, index) => (
                            <Cell key={`current-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: unknown) => [`${Number(value ?? 0)}%`, ""]} />
                        <Legend formatter={(_: string, entry: unknown) => (entry as { payload?: { fullName?: string } })?.payload?.fullName ?? ""} wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", color: "var(--text-muted)", fontSize: 12 }}>
                      {totalMarketValueKRW <= 0 ? "보유 종목 없음" : "목표 종목 보유 없음"}
                    </div>
                  )}
                </div>
              </div>
            </div>
            {/* 목표 vs 현재 막대그래프 */}
            <div style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: 8, padding: 12, background: "var(--surface)" }}>
              <h5 style={{ margin: "0 0 8px 0", fontSize: 13, textAlign: "center", color: "var(--text-muted)" }}>목표 vs 현재 (종목별)</h5>
              <div style={{ width: "100%", height: Math.max(200, barChartData.length * 28), minHeight: 200 }}>
                {barChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barChartData} layout="vertical" margin={{ left: 50, right: 20, top: 5, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                      <XAxis type="number" domain={[0, "auto"]} tickFormatter={(v) => `${v}%`} fontSize={11} />
                      <YAxis dataKey="name" type="category" width={90} fontSize={11} tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(value: number | undefined) => [`${value ?? 0}%`, ""]}
                        labelFormatter={(_, payload) => (payload?.[0]?.payload?.ticker ? `${payload[0].payload.ticker}` : "")}
                      />
                      <Legend />
                      <Bar dataKey="target" name="목표" fill="#94a3b8" radius={[0, 4, 4, 0]} barSize={12} />
                      <Bar dataKey="actual" name="현재" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={12} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", color: "var(--text-muted)", fontSize: 12 }}>데이터 없음</div>
                )}
              </div>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="data-table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>종목</th>
                  <th>목표 비중</th>
                  <th>현재 비중</th>
                  <th>목표 금액</th>
                  <th>현재 금액</th>
                  <th>달성도</th>
                  <th>달성을 위해</th>
                </tr>
              </thead>
              <tbody>
                {achievementData.rows.map((r) => {
                  const currentPercent = totalMarketValueKRW > 0 ? (r.currentValueKRW / totalMarketValueKRW) * 100 : 0;
                  return (
                    <tr key={r.ticker}>
                      <td>
                        {r.ticker}
                        {r.name && r.name !== r.ticker ? ` · ${r.name}` : ""}
                      </td>
                      <td>{r.targetPercent.toFixed(1)}%</td>
                      <td>{currentPercent.toFixed(1)}%</td>
                      <td>{formatKRW(Math.round(r.targetValueKRW))}</td>
                      <td>{formatKRW(Math.round(r.currentValueKRW))}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <div
                            style={{
                              width: 60,
                              height: 8,
                              background: "var(--border-light)",
                              borderRadius: 4,
                              overflow: "hidden"
                            }}
                          >
                            <div
                              style={{
                                width: `${Math.min(100, r.achievement)}%`,
                                height: "100%",
                                background: r.achievement >= 100 ? "var(--success)" : "var(--primary)",
                                borderRadius: 4
                              }}
                            />
                          </div>
                          <span>{r.achievement.toFixed(0)}%</span>
                        </div>
                      </td>
                      <td style={{ whiteSpace: "nowrap", fontSize: 12, minWidth: 120 }}>
                        {r.currentPrice > 0 && r.diffKRW > 1000 && (
                          <span style={{ color: "var(--primary)" }}>
                            매수 약 {Math.ceil(r.sharesToTrade)}주
                          </span>
                        )}
                        {r.currentPrice > 0 && r.diffKRW < -1000 && (
                          <span style={{ color: "var(--danger)" }}>
                            매도 약 {Math.floor(r.sharesToTrade)}주
                          </span>
                        )}
                        {r.currentPrice > 0 && Math.abs(r.diffKRW) <= 1000 && (
                          <span style={{ color: "var(--text-muted)" }}>유지</span>
                        )}
                        {r.currentPrice <= 0 && Math.abs(r.diffKRW) > 1000 && (
                          <span style={{ color: "var(--text-muted)" }}>시세 갱신 필요</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selectedTarget && !editingTarget && selectedTarget.items.length === 0 && (
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>목표 편집에서 종목과 비중을 추가하세요.</p>
      )}

      {!selectedTarget && !editingTarget && selectedTargetId !== "__new__" && (
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>목표 포트폴리오를 선택하거나 새로 만드세요.</p>
      )}
    </div>
  );
};

const MAX_SEARCH_RESULTS = 80;

function AddItemForm({
  onAdd,
  existingTickers,
  prices,
  tickerDatabase
}: {
  onAdd: (ticker: string, targetPercent: number) => void;
  existingTickers: string[];
  prices: StockPrice[];
  tickerDatabase: TickerInfo[];
}) {
  const [ticker, setTicker] = useState("");
  const [percent, setPercent] = useState("10");
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const normalized = (t: string) => normTicker(t);
  const exists = existingTickers.some((t) => normalized(t) === normalized(ticker));

  const searchPool = useMemo(() => {
    const byTicker = new Map<string, { ticker: string; name: string }>();
    tickerDatabase.forEach((t) => {
      if (!t.ticker) return;
      const name = prices.find((p) => normTicker(p.ticker) === normTicker(t.ticker))?.name ?? t.name ?? t.ticker;
      byTicker.set(normTicker(t.ticker), { ticker: t.ticker, name });
    });
    prices.forEach((p) => {
      if (!p.ticker) return;
      const key = normTicker(p.ticker);
      const existing = byTicker.get(key);
      const name = p.name ?? existing?.name ?? p.ticker;
      byTicker.set(key, { ticker: p.ticker, name });
    });
    return Array.from(byTicker.values()).filter(
      (t) => !existingTickers.some((e) => normTicker(e) === normTicker(t.ticker))
    );
  }, [tickerDatabase, prices, existingTickers]);

  const filteredSuggestions = useMemo(() => {
    const q = (ticker || "").trim().toLowerCase();
    if (!q) return searchPool.slice(0, MAX_SEARCH_RESULTS);
    const qNorm = q.toUpperCase().replace(/\.(KS|KQ|KO|K|KSQ)$/i, "");
    return searchPool
      .filter(
        (t) =>
          normTicker(t.ticker).includes(qNorm) ||
          (t.name && t.name.toLowerCase().includes(q))
      )
      .slice(0, MAX_SEARCH_RESULTS);
  }, [searchPool, ticker]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = Number(percent) || 0;
    if (!ticker.trim() || p <= 0 || p > 100 || exists) return;
    const chosen = searchPool.find((t) => normTicker(t.ticker) === normalized(ticker)) ?? { ticker: ticker.trim(), name: "" };
    onAdd(chosen.ticker, p);
    setTicker("");
    setPercent("10");
    setShowDropdown(false);
  };

  const handleSelect = (t: { ticker: string; name: string }) => {
    setTicker(t.ticker);
    setShowDropdown(false);
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <div ref={containerRef} style={{ position: "relative", display: "inline-block" }}>
        <input
          type="text"
          value={ticker}
          onChange={(e) => {
            setTicker(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          placeholder="티커 또는 종목명 검색"
          style={{ padding: "6px 10px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6, width: 220 }}
          autoComplete="off"
        />
        {showDropdown && (
          <ul
            style={{
              position: "absolute",
              left: 0,
              top: "100%",
              margin: 0,
              padding: "4px 0",
              listStyle: "none",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              boxShadow: "var(--shadow)",
              maxHeight: 280,
              overflowY: "auto",
              zIndex: 50,
              minWidth: 220
            }}
          >
            {filteredSuggestions.length === 0 ? (
              <li style={{ padding: "8px 12px", fontSize: 13, color: "var(--text-muted)" }}>검색 결과 없음</li>
            ) : (
              filteredSuggestions.map((t) => (
                <li
                  key={t.ticker}
                  role="button"
                  tabIndex={0}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(t);
                  }}
                  style={{
                    padding: "8px 12px",
                    fontSize: 13,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--primary-light)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  {t.ticker}
                  {t.name && t.name !== t.ticker ? ` · ${t.name}` : ""}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      <input
        type="number"
        min={0.5}
        max={100}
        step={0.5}
        value={percent}
        onChange={(e) => setPercent(e.target.value)}
        style={{ width: 56, padding: "6px 8px", fontSize: 13, border: "1px solid var(--border)", borderRadius: 6 }}
      />
      <span style={{ fontSize: 13 }}>%</span>
      <button type="submit" className="secondary" disabled={!ticker.trim() || exists} style={{ padding: "6px 12px", fontSize: 13 }}>
        종목 추가
      </button>
    </form>
  );
}
