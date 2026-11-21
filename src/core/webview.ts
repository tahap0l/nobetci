// Browser habits that do not belong in an app window. The webview's own
// right-click menu offers "Reload", and F5 / Ctrl+R do the same: a reloaded
// island drops every card on screen while Claude Code still waits on it.
// Text fields keep their native menu (copy, paste); nothing else gets one.

/** Elements whose native context menu stays: the ones text is typed into. */
const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

/** F5, Ctrl+R, Ctrl+Shift+R, and Cmd+R / Cmd+Shift+R on a Mac. */
export function isReloadKey(e: KeyboardEvent): boolean {
  if (e.key === "F5" || e.key === "BrowserRefresh") return true;
  return (e.ctrlKey || e.metaKey) && !e.altKey && (e.key.toLowerCase() === "r" || e.code === "KeyR");
}

/** Whether a right-click on `target` may open the native menu. */
export function keepsContextMenu(target: EventTarget | null): boolean {
  return !!(target as Element | null)?.closest?.(EDITABLE);
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
