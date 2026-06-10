/**
 * 배당 입력 폼 + 빠른 입력(이전 배당 내역) 카드.
 * DividendsPage에서 분리 — dividendForm/showUSD 상태를 이 컴포넌트가 소유해
 * 폼 타이핑이 부모(DividendsPage)를 재렌더하지 않는다.
 * React.memo로 감싸 폼과 무관한 부모 상태 변경 시 재렌더를 건너뛴다.
 * 부모가 넘기는 콜백은 모두 안정적(setState 또는 useCallback)이어야 memo가 효과를 가진다.
 *
 * 탭 전환(배당/이자) 시에도 폼 상태가 유지되도록 부모는 이 컴포넌트를 항상 마운트하고,
 * visible=false면 null을 렌더한다 (상태 보존 + DOM 제거 — 분리 전 동작과 동일).
 *
 * positions/latestPriceByCanonicalTicker는 부모 memo — 여기서 재계산하지 않는다.
 */
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { Autocomplete } from "../../components/ui/Autocomplete";
import type { Account, LedgerEntry, PositionRow, StockPrice, StockTrade, TickerInfo } from "../../types";
import { formatKRW } from "../../utils/formatter";
import { isKRWStock, isUSDStock, canonicalTickerForMatch, extractTickerFromText } from "../../utils/finance";
import { buildDividendNote } from "../../utils/dividend";
import { getKrNames } from "../../storage";

interface Props {
  /** 배당 탭에서만 표시 — false면 null 렌더 (폼 상태는 유지) */
  visible: boolean;
  accounts: Account[];
  ledger: LedgerEntry[];
  trades: StockTrade[];
  tickerDatabase: TickerInfo[];
  /** 부모 memo (computePositions) — 자식은 재계산하지 않음 */
  positions: PositionRow[];
  /** 부모 memo — canonical 티커별 최신 시세 (updatedAt 기준) */
  latestPriceByCanonicalTicker: Map<string, StockPrice>;
  fxRate: number | null;
  onChangeLedger: (ledger: LedgerEntry[]) => void;
}

export const DividendFormSection: React.FC<Props> = React.memo(function DividendFormSection({
  visible,
  accounts,
  ledger,
  trades,
  tickerDatabase,
  positions,
  latestPriceByCanonicalTicker,
  fxRate,
  onChangeLedger
}) {
  const [showUSD, setShowUSD] = useState(false);

  // 배당 입력 폼 (date = 수령일, exDate = 배당락일, 배당율은 락일 기준 주가 사용)
  const [dividendForm, setDividendForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    exDate: "", // 배당락일 (선택, 있으면 배당율 계산에 락일 기준 주가 사용)
    accountId: "",
    ticker: "",
    name: "",
    dividendPerShare: "",
    amount: "",
    quantity: "",
    tax: "",
    fee: ""
  });

  // 티커 자동완성 옵션 — 보유 종목만. 이자는 별도 이자 탭에서 입력.
  const tickerOptions = useMemo(() => {
    const options: Array<{ value: string; label: string; subLabel?: string }> = [];
    positions.forEach((pos) => {
      if (pos.quantity > 0) {
        options.push({
          value: pos.ticker,
          label: pos.name,
          subLabel: `보유: ${pos.quantity}주, 평균단가: ${Math.round(pos.avgPrice).toLocaleString()}원`
        });
      }
    });
    return options.sort((a, b) => a.value.localeCompare(b.value));
  }, [positions]);

  // 선택한 티커의 보유 정보 (주식 탭과 동일: 원화 기준)
  const selectedPosition = useMemo(() => {
    if (!dividendForm.ticker) return null;
    return positions.find((p) => canonicalTickerForMatch(p.ticker) === canonicalTickerForMatch(dividendForm.ticker) && p.quantity > 0);
  }, [positions, dividendForm.ticker]);

  // 티커 선택 시 보유 수량을 폼 기본값으로 채움 (수정 가능하므로 사용자가 바꿀 수 있음)
  useEffect(() => {
    if (selectedPosition) {
      setDividendForm((prev) => ({
        ...prev,
        quantity: String(selectedPosition.quantity)
      }));
    } else {
      setDividendForm((prev) => ({ ...prev, quantity: "" }));
    }
  }, [selectedPosition?.ticker, selectedPosition?.quantity, selectedPosition]);

  // 선택한 티커의 통화 정보 (StocksView와 동일한 방식)
  const selectedTickerCurrency = useMemo(() => {
    if (!dividendForm.ticker) return undefined;

    // 1. 원본 prices에서 통화 정보 가져오기 (최신 시세 기준)
    const originalPriceInfo = latestPriceByCanonicalTicker.get(canonicalTickerForMatch(dividendForm.ticker));
    if (originalPriceInfo?.currency) {
      return originalPriceInfo.currency;
    }

    // 2. prices에 없으면 tickerDatabase에서 market 정보로 판단
    const tickerInfo = tickerDatabase.find((t) => canonicalTickerForMatch(t.ticker) === canonicalTickerForMatch(dividendForm.ticker));
    if (tickerInfo?.market === "US") {
      return "USD";
    }
    if (tickerInfo?.market === "KR") {
      return "KRW";
    }

    // 3. tickerDatabase에도 없으면 티커 유틸로 판단 (4자 이하=USD, 6자 이상=KRW)
    const ticker = dividendForm.ticker;
    if (isKRWStock(ticker)) return "KRW";
    if (isUSDStock(ticker)) return "USD";

    return undefined;
  }, [latestPriceByCanonicalTicker, tickerDatabase, dividendForm.ticker]);

  const formatUSD = (value: number) => Math.round(value).toLocaleString("en-US");

  // 배당율 계산 (주식 탭과 동일: 항상 원화 기준, 순 배당금 기준. 수량은 폼 값 우선)
  const dividendYield = useMemo(() => {
    if (!selectedPosition) return null;
    const quantity = dividendForm.quantity !== "" ? Number(dividendForm.quantity) || 0 : selectedPosition.quantity;
    const dividendPerShare = dividendForm.dividendPerShare ? Number(dividendForm.dividendPerShare) : 0;
    let amount = dividendPerShare > 0 && quantity > 0 ? dividendPerShare * quantity : 0;
    const tax = dividendForm.tax ? Number(dividendForm.tax) : 0;
    const fee = dividendForm.fee ? Number(dividendForm.fee) : 0;

    if (amount <= 0 || selectedPosition.avgPrice <= 0 || quantity <= 0) return null;

    // USD 종목이고 USD로 입력받았으면 원화로 변환
    if (selectedTickerCurrency === "USD" && showUSD && fxRate) {
      amount = amount * fxRate;
      if (tax > 0) {
        const taxKRW = tax * fxRate;
        amount = amount - taxKRW;
      }
      if (fee > 0) {
        const feeKRW = fee * fxRate;
        amount = amount - feeKRW;
      }
    } else {
      amount = amount - tax - fee;
    }

    const totalCost = selectedPosition.avgPrice * quantity;
    return (amount / totalCost) * 100;
  }, [dividendForm.dividendPerShare, dividendForm.tax, dividendForm.fee, dividendForm.quantity, selectedPosition, selectedTickerCurrency, showUSD, fxRate]);

  // 이전 배당 입력 내역 (빠른 재입력용)
  const recentDividends = useMemo(() => {
    const isDividend = (l: LedgerEntry) =>
      l.kind === "income" && (l.category === "배당" || (l.category === "수입" && l.subCategory === "배당") || (l.description ?? "").includes("배당"));

    const tickerMap = new Map<string, { ticker: string; name: string; amount: number; accountId: string; date: string }>();

    // 최근 배당 내역을 티커별로 추출 (최신 것만)
    for (const l of ledger) {
      if (!isDividend(l)) continue;
      const ticker = (extractTickerFromText(l.description ?? "") ?? extractTickerFromText(l.category ?? ""))?.toUpperCase();
      if (!ticker) continue;
      const ct = canonicalTickerForMatch(ticker);
      const desc = l.description ?? "";
      // description에서 "TICKER - Name 배당" 형식으로 종목명 추출
      const nameMatch = desc.match(/\s-\s([^-]+?)(?:\s배당|$)/);
      let name = nameMatch ? nameMatch[1].trim() : "";
      if (!name && isKRWStock(ct)) {
        const krName = getKrNames()[ct];
        if (krName) name = krName;
      }
      if (!name) {
        name = latestPriceByCanonicalTicker.get(ct)?.name ||
          trades.find((t) => canonicalTickerForMatch(t.ticker) === ct)?.name ||
          tickerDatabase.find((t) => canonicalTickerForMatch(t.ticker) === ct)?.name ||
          "";
      }

      // 같은 티커가 이미 있으면 날짜가 더 최신인 것만 유지
      const existing = tickerMap.get(ct);
      if (!existing || (l.date && existing.date < l.date)) {
        tickerMap.set(ct, {
          ticker,
          name,
          amount: l.amount,
          accountId: l.toAccountId || "",
          date: l.date || ""
        });
      }
    }

    return Array.from(tickerMap.values())
      .filter((d) => positions.some((p) => canonicalTickerForMatch(p.ticker) === canonicalTickerForMatch(d.ticker) && p.quantity > 0)) // 보유 종목만
      .sort((a, b) => b.date.localeCompare(a.date)); // 최신순 정렬
  }, [ledger, latestPriceByCanonicalTicker, trades, positions, tickerDatabase]);

  // 빠른 입력: 이전 배당 내역 적용 (수정 가능)
  const applyRecentDividend = (recent: { ticker: string; name: string; amount: number; accountId: string }) => {
    const matchedPosition = positions.find((p) => canonicalTickerForMatch(p.ticker) === canonicalTickerForMatch(recent.ticker) && p.quantity > 0);
    const quantity = matchedPosition?.quantity ?? 0;
    const dividendPerShare = quantity > 0 ? String(Math.round((recent.amount / quantity) * 100) / 100) : "";
    setDividendForm({
      date: new Date().toISOString().slice(0, 10),
      exDate: "",
      accountId: recent.accountId || dividendForm.accountId,
      ticker: recent.ticker,
      name: recent.name,
      dividendPerShare,
      amount: "",
      quantity: "",
      tax: "",
      fee: ""
    });
  };

  const handleDividendSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let amount = Number(dividendForm.amount);
    const tax = dividendForm.tax ? Number(dividendForm.tax) : 0;
    const fee = dividendForm.fee ? Number(dividendForm.fee) : 0;

    if (!dividendForm.date || !dividendForm.accountId) {
      return;
    }

    const tickerTrimmed = dividendForm.ticker?.trim() ?? "";

    // 이자 입력은 이자 탭으로 — 배당 폼은 티커 필수
    if (!tickerTrimmed) {
      toast.error("종목을 선택하세요. 이자는 이자 탭에서 입력합니다.");
      return;
    }
    const quantityForCalc = dividendForm.quantity !== "" ? Number(dividendForm.quantity) || 0 : selectedPosition?.quantity ?? 0;
    const dividendPerShare = dividendForm.dividendPerShare ? Number(dividendForm.dividendPerShare) : 0;
    if (quantityForCalc <= 0 || dividendPerShare <= 0) {
      return;
    }
    amount = dividendPerShare * quantityForCalc;

    // 주식 탭과 동일: 항상 원화(KRW) 기준으로 저장
    // USD 종목이고 USD로 입력받았으면 원화로 변환
    if (selectedTickerCurrency === "USD" && showUSD && fxRate) {
      amount = amount * fxRate; // USD → KRW 변환
      // 세금과 수수료도 USD로 입력받았으면 원화로 변환
      if (tax > 0) {
        const taxKRW = tax * fxRate;
        amount = amount - taxKRW;
      }
      if (fee > 0) {
        const feeKRW = fee * fxRate;
        amount = amount - feeKRW;
      }
    } else {
      // 원화로 입력받았으면 그대로 사용하고 세금/수수료 차감
      amount = amount - tax - fee;
    }

    // 순 배당금 (세금, 수수료 제외)
    const netAmount = amount;

    const description = `${dividendForm.ticker}${dividendForm.name ? ` - ${dividendForm.name}` : ""} 배당${tax > 0 ? `, 세금: ${Math.round(tax).toLocaleString()}원` : ""}${fee > 0 ? `, 수수료: ${Math.round(fee).toLocaleString()}원` : ""}`;
    const qtyForNote = dividendForm.quantity !== "" ? parseInt(dividendForm.quantity, 10) : selectedPosition?.quantity;
    const quantityToSave = typeof qtyForNote === "number" && !Number.isNaN(qtyForNote) && qtyForNote >= 0 ? qtyForNote : undefined;
    const note = buildDividendNote(quantityToSave, dividendForm.exDate?.trim());
    const entry: LedgerEntry = {
      id: `D${Date.now()}`,
      date: dividendForm.date,
      kind: "income",
      category: "수입",
      subCategory: "배당",
      description: description,
      toAccountId: dividendForm.accountId,
      amount: netAmount,
      note
    };

    const newLedger = [entry, ...ledger];
    onChangeLedger(newLedger);

    setDividendForm({
      date: new Date().toISOString().slice(0, 10),
      exDate: "",
      accountId: dividendForm.accountId,
      ticker: dividendForm.ticker,
      name: dividendForm.name ?? "",
      dividendPerShare: "",
      amount: "",
      quantity: dividendForm.quantity,
      tax: "",
      fee: ""
    });
  };

  if (!visible) return null;

  return (
    <>
      {/* 빠른 입력: 이전 배당 내역 */}
      {recentDividends.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 16, backgroundColor: "#f8fafc" }}>
          <h4 style={{ marginTop: 0, marginBottom: 12, fontSize: 16, fontWeight: 600 }}>빠른 입력 (이전 배당 내역)</h4>
          <p className="hint" style={{ marginBottom: 12, fontSize: 13 }}>
            이전에 입력한 배당 내역을 클릭하면 자동으로 폼이 채워집니다. 모든 필드를 수정할 수 있습니다.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {recentDividends.map((recent, idx) => {
              const pos = positions.find((p) => canonicalTickerForMatch(p.ticker) === canonicalTickerForMatch(recent.ticker));
              // 통화 정보 가져오기 (최신 시세 기준)
              const originalPriceInfo = latestPriceByCanonicalTicker.get(canonicalTickerForMatch(recent.ticker));
              let currency = originalPriceInfo?.currency;
              if (!currency) {
                const tickerInfo = tickerDatabase.find((t) => canonicalTickerForMatch(t.ticker) === canonicalTickerForMatch(recent.ticker));
                if (tickerInfo?.market === "US") {
                  currency = "USD";
                } else if (tickerInfo?.market === "KR") {
                  currency = "KRW";
                } else {
                  if (isKRWStock(recent.ticker)) currency = "KRW";
                  else if (isUSDStock(recent.ticker)) currency = "USD";
                }
              }
              return (
                <button
                  key={`${recent.ticker}-${idx}`}
                  type="button"
                  onClick={() => applyRecentDividend(recent)}
                  style={{
                    padding: "8px 12px",
                    fontSize: 13,
                    border: "1px solid var(--border, #ddd)",
                    borderRadius: 6,
                    backgroundColor: "white",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 2,
                    minWidth: "140px"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "#eef2ff";
                    e.currentTarget.style.borderColor = "#2563eb";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "white";
                    e.currentTarget.style.borderColor = "var(--border, #ddd)";
                  }}
                >
                  <div style={{ fontWeight: 600, color: "#1e40af" }}>
                    {recent.ticker}
                  </div>
                  {recent.name && (
                    <div style={{ fontSize: 12, color: "#666" }}>
                      {recent.name.length > 15 ? recent.name.slice(0, 15) + "..." : recent.name}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: "#2563eb", fontWeight: 500 }}>
                    {formatKRW(Math.round(recent.amount))}
                  </div>
                  {pos && (
                    <div style={{ fontSize: 11, color: "#888" }}>
                      보유: {pos.quantity}주
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ marginTop: 0, marginBottom: 0 }}>배당 입력</h3>
          {selectedTickerCurrency && selectedTickerCurrency !== "KRW" && (
            <button
              type="button"
              className={showUSD ? "primary" : "secondary"}
              onClick={() => setShowUSD((v) => !v)}
              style={{ padding: "6px 12px", fontSize: 13 }}
            >
              {showUSD ? "USD 표시" : "원화 표시"}
            </button>
          )}
        </div>
        <p className="hint" style={{ marginBottom: 12 }}>
          받은 배당금을 입력하세요. 주식 배당은 <strong>주당배당금과 보유주식수</strong>를 입력하면 총 배당금이 자동 계산됩니다. <strong>티커를 비우면 이자(은행이자)로 등록됩니다.</strong>
        </p>
        <form onSubmit={handleDividendSubmit}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px 12px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>날짜 (수령일)</span>
            <input
              type="date"
              value={dividendForm.date}
              onChange={(e) => setDividendForm({ ...dividendForm, date: e.target.value })}
              style={{ padding: "6px 8px", fontSize: 14 }}
              required
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>배당락일 <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(선택, 배당율 계산용)</span></span>
            <input
              type="date"
              value={dividendForm.exDate}
              onChange={(e) => setDividendForm({ ...dividendForm, exDate: e.target.value })}
              style={{ padding: "6px 8px", fontSize: 14 }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>계좌</span>
            <select
              value={dividendForm.accountId}
              onChange={(e) => setDividendForm({ ...dividendForm, accountId: e.target.value })}
              style={{ padding: "6px 8px", fontSize: 14 }}
              required
            >
              <option value="">선택</option>
              {accounts
                .filter((acc) => !acc.archived || acc.id === dividendForm.accountId)
                .map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.id}
                  </option>
                ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, gridColumn: "1 / -1" }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>티커 <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(비우거나 '이자' 입력 시 이자)</span></span>
            <Autocomplete
              value={dividendForm.ticker}
              onChange={(val) => setDividendForm({ ...dividendForm, ticker: val.toUpperCase(), name: "", dividendPerShare: "", amount: "" })}
              options={tickerOptions}
              onSelect={(option) => {
                const isInterest = option.value === "" || option.value === "이자";
                setDividendForm({
                  ...dividendForm,
                  ticker: option.value,
                  name: isInterest ? "" : (option.label || ""),
                  dividendPerShare: "",
                  amount: ""
                });
              }}
              placeholder="티커 입력 / 비우기 또는 '이자' = 이자로 저장"
            />
          </label>
          {selectedPosition && (
            <>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>평균 단가</span>
                <input
                  type="text"
                  value={formatKRW(Math.round(selectedPosition.avgPrice))}
                  disabled
                  style={{ padding: "6px 8px", fontSize: 14, backgroundColor: "#f5f5f5" }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>보유 수량 <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>(기본: 해당 종목 보유, 수정 가능)</span></span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={dividendForm.quantity}
                  onChange={(e) => setDividendForm({ ...dividendForm, quantity: e.target.value })}
                  placeholder={String(selectedPosition.quantity)}
                  style={{ padding: "6px 8px", fontSize: 14 }}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>총 매입 금액</span>
                <input
                  type="text"
                  value={formatKRW(Math.round(selectedPosition.avgPrice * selectedPosition.quantity))}
                  disabled
                  style={{ padding: "6px 8px", fontSize: 14, backgroundColor: "#f5f5f5" }}
                />
              </label>
            </>
          )}
          {dividendForm.ticker && dividendForm.ticker !== "이자" ? (
            <>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>
                  주당 배당금
                  {selectedTickerCurrency === "USD" && showUSD && " (USD)"}
                  {selectedTickerCurrency === "USD" && !showUSD && " (원화)"}
                </span>
                <input
                  type="number"
                  min={0}
                  step={0.0001}
                  value={dividendForm.dividendPerShare}
                  onChange={(e) => setDividendForm({ ...dividendForm, dividendPerShare: e.target.value })}
                  placeholder={selectedTickerCurrency === "USD" && showUSD ? "USD로 입력" : "원화로 입력"}
                  style={{ padding: "6px 8px", fontSize: 14 }}
                  required
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>총 배당금 (자동 계산)</span>
                <input
                  type="text"
                  value={(() => {
                    const q = dividendForm.quantity !== "" ? Number(dividendForm.quantity) || 0 : selectedPosition?.quantity ?? 0;
                    const dps = dividendForm.dividendPerShare ? Number(dividendForm.dividendPerShare) : 0;
                    const total = q > 0 && dps > 0 ? q * dps : 0;
                    if (total <= 0) return "-";
                    if (selectedTickerCurrency === "USD" && showUSD) {
                      return `${formatUSD(total)} USD${fxRate ? ` (약 ${formatKRW(Math.round(total * fxRate))})` : ""}`;
                    }
                    return formatKRW(Math.round(total));
                  })()}
                  disabled
                  style={{ padding: "6px 8px", fontSize: 14, backgroundColor: "#f5f5f5" }}
                />
              </label>
            </>
          ) : (
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                이자 금액
                {selectedTickerCurrency === "USD" && showUSD && " (USD)"}
                {selectedTickerCurrency === "USD" && !showUSD && " (원화)"}
              </span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={dividendForm.amount}
                onChange={(e) => setDividendForm({ ...dividendForm, amount: e.target.value })}
                placeholder={selectedTickerCurrency === "USD" && showUSD ? "USD로 입력" : "원화로 입력"}
                style={{ padding: "6px 8px", fontSize: 14 }}
                required
              />
            </label>
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              세금
              {selectedTickerCurrency === "USD" && showUSD && " (USD)"}
              {selectedTickerCurrency === "USD" && !showUSD && " (원화)"}
            </span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={dividendForm.tax}
              onChange={(e) => setDividendForm({ ...dividendForm, tax: e.target.value })}
              placeholder="선택사항"
              style={{ padding: "6px 8px", fontSize: 14 }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              수수료
              {selectedTickerCurrency === "USD" && showUSD && " (USD)"}
              {selectedTickerCurrency === "USD" && !showUSD && " (원화)"}
            </span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={dividendForm.fee}
              onChange={(e) => setDividendForm({ ...dividendForm, fee: e.target.value })}
              placeholder="선택사항"
              style={{ padding: "6px 8px", fontSize: 14 }}
            />
          </label>
          {dividendYield != null && (
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500 }}>배당율</span>
              <input
                type="text"
                value={`${dividendYield.toFixed(2)}%`}
                disabled
                style={{ padding: "6px 8px", fontSize: 14, backgroundColor: "#f5f5f5", color: "#2563eb", fontWeight: 600 }}
              />
            </label>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
          <button type="submit" className="primary" style={{ padding: "8px 16px", fontSize: 14 }}>
            추가
          </button>
        </div>
      </form>
    </div>
    </>
  );
});
