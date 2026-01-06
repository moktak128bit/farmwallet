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

class ShortcutManager {
  private handlers: Map<string, ShortcutHandler[]> = new Map();
  private isEnabled = true;

  register(handler: ShortcutHandler) {
    const key = this.getShortcutKey(handler.action);
    if (!this.handlers.has(key)) {
      this.handlers.set(key, []);
    }
    this.handlers.get(key)!.push(handler);
  }

  unregister(handler: ShortcutHandler) {
    const key = this.getShortcutKey(handler.action);
    const handlers = this.handlers.get(key);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  private getShortcutKey(action: ShortcutAction): string {
    const shortcuts: Record<ShortcutAction, string> = {
      "new-entry": "ctrl+n",
      "save-entry": "ctrl+s",
      "open-search": "ctrl+f",
      "close-modal": "escape",
      "undo": "ctrl+z",
      "redo": "ctrl+y",
      "focus-form": "ctrl+e",
      "global-search": "ctrl+k",
      "submit-form": "ctrl+enter",
      "show-help": "ctrl+/",
    };
    return shortcuts[action] || "";
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
      // 입력 필드에 포커스가 있을 때는 저장/실행취소만 허용
      if (isInputFocused && !["ctrl+s", "ctrl+z", "ctrl+y"].includes(key)) {
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

