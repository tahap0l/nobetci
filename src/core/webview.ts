// Browser habits that do not belong in an app window. The webview's own
// right-click menu offers "Reload", and F5 / Ctrl+R do the same: a reloaded
// island drops every card on screen while Claude Code still waits on it.
// Fields text is typed into keep their native menu (copy, paste); nothing else
// gets one — not a checkbox, a slider or a list, whose menu offers Reload too.

/** Input types text is typed into: their native menu stays. */
const TEXT_INPUTS = new Set(["text", "search", "url", "email", "password", "number", "tel"]);

/** F5, Ctrl+R, Ctrl+Shift+R, and Cmd+R / Cmd+Shift+R on a Mac. */
export function isReloadKey(e: KeyboardEvent): boolean {
  if (e.key === "F5" || e.key === "BrowserRefresh") return true;
  return (e.ctrlKey || e.metaKey) && !e.altKey && (e.key.toLowerCase() === "r" || e.code === "KeyR");
}

/** Whether a right-click on `target` may open the native menu: only on a field text is typed into. */
export function keepsContextMenu(target: EventTarget | null): boolean {
  const field = (target as Element | null)?.closest?.("input, textarea, [contenteditable]");
  if (!field) return false;
  if (field instanceof HTMLTextAreaElement) return true;
  // `type` reads back as "text" for an input with none or with an unknown one.
  if (field instanceof HTMLInputElement) return TEXT_INPUTS.has(field.type);
  return (field as HTMLElement).isContentEditable;
}

/** Suppresses the native context menu (except on text fields) and the reload keys. */
export function guardWebview(doc: Document = document) {
  doc.addEventListener("contextmenu", (e) => {
    if (!keepsContextMenu(e.target)) e.preventDefault();
  });
  doc.addEventListener(
    "keydown",
    (e) => {
      if (isReloadKey(e)) e.preventDefault();
    },
    true,
  );
}
