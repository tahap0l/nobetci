// Tab registry glue shared by the shell (main.ts) and the tabs, so tabs can ask
// for a re-render or jump elsewhere without importing the shell.

import type { IconName } from "./icons";

export type TabId = "genel" | "claude" | "guvenlik" | "kurallar" | "bildirimler" | "gecmis" | "hakkinda";

export const TAB_IDS: readonly TabId[] = [
  "genel",
  "claude",
  "guvenlik",
  "kurallar",
  "bildirimler",
  "gecmis",
  "hakkinda",
];

/** Not a tab: `settings-tab` / `?tab=` with this id opens the first-run wizard. */
export const WIZARD_ID = "hosgeldin";

export interface Tab {
  id: TabId;
  /** Evaluated on every render, so they follow the UI language. */
  title: () => string;
  subtitle: () => string;
  icon: IconName;
  render: () => HTMLElement;
  /** The tab became visible (or the window was shown again). */
  onShow?: () => void;
  onHide?: () => void;
  /** The UI language changed: drop anything Rust localised (it is refetched on show). */
  onLang?: () => void;
}

/** Facts from `boot()` the tabs show. */
export const app = {
  version: "",
  hookPath: "",
  systemLang: "en" as "tr" | "en",
  hooksLost: false,
  fullscreenSupported: true,
};

let impl = {
  rerender: () => {},
  go: (_tab: TabId) => {},
  current: (): TabId => "genel",
  badges: () => {},
};

export function setNav(i: typeof impl) {
  impl = i;
}

/** Rebuild the visible tab (only if it is `only`), keeping scroll and focus. */
export function rerender(only?: TabId) {
  if (!only || only === impl.current()) impl.rerender();
}

export function go(tab: TabId) {
  impl.go(tab);
}

export function currentTab(): TabId {
  return impl.current();
}

/** Refresh the sidebar badges (rule count, hook warnings). */
export function refreshBadges() {
  impl.badges();
}

/** Dev-only switches for screenshots (?edit=0, ?detail=0, ?preview=1, ?lang=en…). */
export function devParam(name: string): string | null {
  if (!import.meta.env.DEV) return null;
  return new URLSearchParams(location.search).get(name);
}
