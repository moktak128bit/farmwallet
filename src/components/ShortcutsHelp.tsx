import React, { useEffect } from "react";

interface ShortcutsHelpProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutGroup {
  title: string;
  shortcuts: { key: string; description: string }[];
}

const shortcutGroups: ShortcutGroup[] = [
  {
    title: "편집",
    shortcuts: [
      { key: "Ctrl+Z", description: "실행 취소" },
      { key: "Ctrl+Y / Ctrl+Shift+Z", description: "다시 실행" },
      { key: "Ctrl+S", description: "백업" },
      { key: "Ctrl+N", description: "가계부 추가 (가계부 탭으로 이동 후 금액 입력란 포커스)" },
      { key: "Ctrl+Enter", description: "폼 제출" }
    ]
  },
  {
    title: "네비게이션",
    shortcuts: [
      { key: "Alt+←", description: "이전 탭" },
      { key: "Alt+→", description: "다음 탭" },
      { key: "Tab", description: "다음 필드" },
      { key: "Shift+Tab", description: "이전 필드" }
    ]
  },
  {
    title: "검색",
    shortcuts: [
      { key: "Ctrl+K", description: "전역 검색 열기" },
      { key: "Ctrl+F", description: "현재 탭 검색" }
    ]
  },
  {
    title: "기타",
    shortcuts: [
      { key: "Esc", description: "모달/폼 닫기" },
      { key: "Ctrl+/", description: "단축키 도움말" }
    ]
  }
];

export const ShortcutsHelp: React.FC<ShortcutsHelpProps> = ({ isOpen, onClose }) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-help-title"
    >
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 id="shortcuts-help-title" style={{ margin: 0 }}>
            키보드 단축키
          </h3>
          <button type="button" className="secondary" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="modal-body">
          {shortcutGroups.map((group, idx) => (
            <div key={idx} style={{ marginBottom: 24 }}>
              <h4 style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: 600, color: "var(--text-secondary)" }}>
                {group.title}
              </h4>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 16px", alignItems: "start" }}>
                {group.shortcuts.map((shortcut, sIdx) => (
                  <React.Fragment key={sIdx}>
                    <kbd
                      style={{
                        padding: "4px 8px",
                        backgroundColor: "var(--surface-hover)",
                        border: "1px solid var(--border)",
                        borderRadius: "4px",
                        fontSize: 12,
                        fontFamily: "monospace",
                        whiteSpace: "nowrap"
                      }}
                    >
                      {shortcut.key}
                    </kbd>
                    <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                      {shortcut.description}
                    </span>
                  </React.Fragment>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};







