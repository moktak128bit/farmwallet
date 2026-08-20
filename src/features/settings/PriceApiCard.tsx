/**
 * 가격 API 카드 — 외부 API 주식 가격 배치 갱신 토글 + 시세 소스(CORS 프록시) 상태. SettingsPage에서 분리.
 * priceApiEnabled 토글 상태는 이 컴포넌트가 소유 — 백업 탭 진입(마운트) 시
 * localStorage에서 다시 읽는다 (기존 탭 전환 effect와 동일 동작).
 * 프록시 상태는 yahooFinanceApi의 외부 스토어(getProxyStatusSnapshot/subscribeProxyStatus)를
 * useSyncExternalStore로 읽기전용 구독 — 시세 갱신이 돌 때마다 카운트가 실시간으로 바뀐다.
 * React.memo로 감싸며 props가 없어 부모 재렌더 영향을 받지 않는다.
 */
import React, { useState, useSyncExternalStore } from "react";
import { toast } from "react-hot-toast";
import { STORAGE_KEYS } from "../../constants/config";
import { formatTimeAgo } from "../../utils/date";
import { getProxyStatusSnapshot, subscribeProxyStatus } from "../../yahooFinanceApi";

export const PriceApiCard: React.FC = React.memo(function PriceApiCard() {
  const [priceApiEnabled, setPriceApiEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEYS.PRICE_API_ENABLED) === "true";
  });
  const proxyStatus = useSyncExternalStore(subscribeProxyStatus, getProxyStatusSnapshot, getProxyStatusSnapshot);
  const anyAttempt = proxyStatus.proxies.some((p) => p.ok > 0 || p.fail > 0);

  return (
    <div className="card">
      <div className="card-title">가격 API</div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={priceApiEnabled}
          onChange={(e) => {
            const v = e.target.checked;
            setPriceApiEnabled(v);
            if (typeof window !== "undefined") {
              localStorage.setItem(STORAGE_KEYS.PRICE_API_ENABLED, v ? "true" : "false");
              toast.success(v ? "가격 API 사용을 켰습니다." : "가격 API 사용을 껐습니다.");
            }
          }}
        />
        <span>가격 API 사용 (외부 API로 주식 가격 배치 갱신)</span>
      </label>
      <p className="hint" style={{ marginTop: 4 }}>
        켜면 주식 탭에서 보유 종목 가격을 30분마다 자동으로 배치 갱신합니다 (탭이 보일 때만 동작).
      </p>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>시세 소스 상태</div>
        <p className="hint" style={{ marginBottom: 8 }}>
          Yahoo·Naver·Stooq 시세와 환율 이력은 공개 CORS 프록시를 거쳐 받습니다. 최근 성적이 좋은 프록시부터
          시도하며(연속 실패 적은 순), 아래 순서가 현재 시도 순서입니다.
        </p>
        <div style={{ marginBottom: 8 }}>
          마지막 성공:{" "}
          <span style={{ color: proxyStatus.lastSuccessAt ? "var(--success)" : "var(--text-muted)" }}>
            {proxyStatus.lastSuccessAt
              ? `${formatTimeAgo(proxyStatus.lastSuccessAt)} (${new Date(proxyStatus.lastSuccessAt).toLocaleString("ko-KR")})`
              : "기록 없음"}
          </span>
        </div>
        {anyAttempt ? (
          <div style={{ overflowX: "auto" }}>
            <table className="table compact" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>프록시</th>
                  <th style={{ textAlign: "right" }}>성공</th>
                  <th style={{ textAlign: "right" }}>실패</th>
                  <th style={{ textAlign: "right" }}>연속 실패</th>
                  <th style={{ textAlign: "right" }}>마지막 성공</th>
                </tr>
              </thead>
              <tbody>
                {proxyStatus.proxies.map((p) => (
                  <tr key={p.id}>
                    <td>{p.label}</td>
                    <td style={{ textAlign: "right", color: p.ok > 0 ? "var(--success)" : undefined }}>{p.ok}</td>
                    <td style={{ textAlign: "right", color: p.fail > 0 ? "var(--danger)" : undefined }}>{p.fail}</td>
                    <td style={{ textAlign: "right", color: p.streak > 0 ? "var(--warning)" : undefined }}>
                      {p.streak}
                    </td>
                    <td style={{ textAlign: "right", color: "var(--text-muted)" }}>
                      {p.lastOkAt ? formatTimeAgo(p.lastOkAt) : "없음"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="hint">아직 시세 요청 기록이 없습니다. 주식 탭에서 시세를 갱신하면 여기에 집계됩니다.</p>
        )}
      </div>
    </div>
  );
});
