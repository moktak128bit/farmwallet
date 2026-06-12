export type ShortcutAction =
  | "new-entry"
  | "save-entry"
  | "open-search"
  | "close-modal"
  | "undo"
  | "redo"
  | "focus-form"
  | "global-search"
  | "submit-form"
  | "show-help";

export interface ShortcutHandler {
  action: ShortcutAction;
  handler: () => void;
  enabled?: () => boolean;
}

/**
 * 액션 → 키 조합 매핑.
 * - save-entry(ctrl+s): 제거 — Ctrl+S는 App의 useKeyboardShortcuts(수동 백업) 전용.
 * - open-search(ctrl+f): 제거 — 미구현 안내만 있던 매핑 (브라우저 찾기와 충돌).
 * - new-entry: Ctrl+N은 브라우저 예약키(새 창)라 동작 불가 → Alt+N으로 재매핑.
 * - submit-form(ctrl+enter): 가계부 폼 제출 (입력 포커스 중에도 허용 — 핵심 시나리오).
 */
const DEFAULT_KEYMAP: Partial<Record<ShortcutAction, string[]>> = {
  "new-entry": ["alt+n"],
  "close-modal": ["escape"],
  "undo": ["ctrl+z"],
  "redo": ["ctrl+y"],
  "focus-form": ["ctrl+e"],
  "global-search": ["ctrl+k"],
  "submit-form": ["ctrl+enter"],
  "show-help": ["ctrl+/"],
};

/** 입력 필드(INPUT/TEXTAREA/contentEditable) 포커스 중에도 허용하는 키 조합 */
const INPUT_FOCUS_ALLOWLIST = ["ctrl+enter", "ctrl+s", "escape"];

class ShortcutManager {
  private handlers: Map<string, ShortcutHandler[]> = new Map();
  private isEnabled = true;

  register(handler: ShortcutHandler) {
    for (const key of this.getShortcutKeys(handler.action)) {
      if (!this.handlers.has(key)) {
        this.handlers.set(key, []);
      }
      this.handlers.get(key)!.push(handler);
    }
  }

  unregister(handler: ShortcutHandler) {
    for (const key of this.getShortcutKeys(handler.action)) {
      const handlers = this.handlers.get(key);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    }
  }

  private getShortcutKeys(action: ShortcutAction): string[] {
    return DEFAULT_KEYMAP[action] ?? [];
  }

  handleKeyDown(event: KeyboardEvent) {
    if (!this.isEnabled) return;

    // 입력 필드에 포커스가 있으면 일부 단축키만 작동
    const target = event.target as HTMLElement;
    const isInputFocused =
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable;

    const key = this.getKeyString(event);
    const handlers = this.handlers.get(key);

    if (handlers && handlers.length > 0) {
      // 입력 필드 포커스 중에는 폼 제출(Ctrl+Enter)·백업(Ctrl+S)·ESC만 허용
      if (isInputFocused && !INPUT_FOCUS_ALLOWLIST.includes(key)) {
        return;
      }

      // 마지막으로 등록된 핸들러 실행
      const handler = handlers[handlers.length - 1];
      if (!handler.enabled || handler.enabled()) {
        event.preventDefault();
        handler.handler();
      }
    }
  }

  private getKeyString(event: KeyboardEvent): string {
    const parts: string[] = [];
    if (event.ctrlKey || event.metaKey) parts.push("ctrl");
    if (event.altKey) parts.push("alt");
    if (event.shiftKey) parts.push("shift");

    const key = event.key.toLowerCase();
    if (key === "escape") parts.push("escape");
    else if (key.length === 1) parts.push(key);
    else if (key.startsWith("arrow")) parts.push(key.replace("arrow", ""));
    else parts.push(key);

    return parts.join("+");
  }

  setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
  }
}

export const shortcutManager = new ShortcutManager();

// 전역 키보드 이벤트 리스너
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    shortcutManager.handleKeyDown(e);
  });
}
