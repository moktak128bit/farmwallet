import type { StockPreset } from "../../types";

interface Props {
  presets: StockPreset[];
  onClose: () => void;
  onSaveCurrent: () => void;
  onApplyPreset: (preset: StockPreset) => void;
  onDeletePreset: (id: string) => void;
}

export function PresetModal({
  presets,
  onClose,
  onSaveCurrent,
  onApplyPreset,
  onDeletePreset,
}: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ margin: 0 }}>프리셋 관리</h3>
          <button type="button" className="secondary" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="modal-body">
          <div style={{ marginBottom: 16 }}>
            <button
              type="button"
              className="primary"
              onClick={() => {
                onSaveCurrent();
                onClose();
              }}
            >
              새 프리셋 추가
            </button>
          </div>
          <div style={{ maxHeight: 400, overflowY: "auto" }}>
            {presets.length === 0 ? (
              <p className="hint">저장된 프리셋이 없습니다.</p>
            ) : (
              <table className="data-table">
                <colgroup>
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "16%" }} />
                  <col style={{ width: "10%" }} />
                  <col style={{ width: "12%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "12%" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>계좌</th>
                    <th>티커</th>
                    <th>종목명</th>
                    <th>수량</th>
                    <th>수수료</th>
                    <th>마지막 사용</th>
                    <th>작업</th>
                  </tr>
                </thead>
                <tbody>
                  {presets.map((preset) => (
                    <tr key={preset.id}>
                      <td>{preset.name}</td>
                      <td>{preset.accountId}</td>
                      <td>{preset.ticker}</td>
                      <td>{preset.stockName || "-"}</td>
                      <td className="number">{preset.quantity ? preset.quantity : "-"}</td>
                      <td className="number">{preset.fee ? Math.round(preset.fee).toLocaleString() : "-"}</td>
                      <td>{preset.lastUsed ? new Date(preset.lastUsed).toLocaleDateString() : "-"}</td>
                      <td>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            onApplyPreset(preset);
                            onClose();
                          }}
                          style={{ marginRight: 6, fontSize: 13, padding: "6px 12px" }}
                        >
                          적용
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => onDeletePreset(preset.id)}
                          style={{ fontSize: 13, padding: "6px 12px" }}
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
