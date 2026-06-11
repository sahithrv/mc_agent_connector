import { useEffect } from "react";

export type StudioShortcutAction = "pauseAll" | "markClip" | "focusChat";

export const STUDIO_SHORTCUTS: Record<
  StudioShortcutAction,
  { label: string; key: string; display: string }
> = {
  pauseAll: { label: "Pause all", key: "p", display: "Alt+Shift+P" },
  markClip: { label: "Mark clip", key: "m", display: "Alt+Shift+M" },
  focusChat: { label: "Focus chat", key: "c", display: "Alt+Shift+C" },
};

export interface StudioShortcutHandlers {
  enabled?: boolean;
  chatTargetSelector?: string;
  onPauseAll?: () => void | Promise<void>;
  onMarkClip?: () => void | Promise<void>;
  onFocusChat?: () => void | Promise<void>;
}

export function useStudioShortcuts(handlers: StudioShortcutHandlers): void {
  const enabled = handlers.enabled ?? true;

  useEffect(() => {
    if (!enabled) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      const action = matchStudioShortcut(event);
      if (!action) return;

      const handler = handlerForAction(action, handlers);
      if (!handler) return;

      event.preventDefault();
      void handler();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    enabled,
    handlers.chatTargetSelector,
    handlers.onFocusChat,
    handlers.onMarkClip,
    handlers.onPauseAll,
  ]);
}

export function shortcutTooltip(action: StudioShortcutAction): string {
  const shortcut = STUDIO_SHORTCUTS[action];
  return `${shortcut.label} (${shortcut.display})`;
}

export function matchStudioShortcut(event: Pick<KeyboardEvent, "altKey" | "shiftKey" | "ctrlKey" | "metaKey" | "key">): StudioShortcutAction | undefined {
  if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return undefined;
  const key = event.key.toLowerCase();
  return (Object.entries(STUDIO_SHORTCUTS).find(([, shortcut]) => shortcut.key === key)?.[0] ??
    undefined) as StudioShortcutAction | undefined;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

function handlerForAction(
  action: StudioShortcutAction,
  handlers: StudioShortcutHandlers,
): (() => void | Promise<void>) | undefined {
  if (action === "pauseAll") return handlers.onPauseAll;
  if (action === "markClip") return handlers.onMarkClip;
  return handlers.onFocusChat ?? (() => focusChat(handlers.chatTargetSelector));
}

function focusChat(selector = "[data-studio-chat-input]"): void {
  const target = document.querySelector<HTMLElement>(selector);
  target?.focus();
}
