// Settings window shell: sidebar navigation, a header that is always closable
// (✕ and Esc), auto-save status, deep links (?tab=…), the UI language, the
// first-run wizard and event sync with Rust.

import "./settings.css";
import type { QuietReason } from "../core/bridge";
import { DEFAULT_SETTINGS, type Settings } from "../core/settings-model";
import { onLangChange, setPlatform } from "../i18n/core";
import { h } from "../ui/dom";
import { api, initApi } from "./api";
import { cache, loadHookStatus } from "./data";
import { t } from "./i18n";
import { icon, owlMark } from "./icons";
import { applyLanguage, initLanguage } from "./lang";
import { TAB_IDS, WIZARD_ID, app, setNav, type Tab, type TabId } from "./nav";
import {
  applyIncoming,
  flush,
  initSettings,
  onExternalChange,
  onSaveState,
  settings,
  update,
  type SaveState,
} from "./store";
import { bildirimlerTab } from "./tabs/bildirimler";
import { claudeTab } from "./tabs/claude";
import { gecmisTab, historyChanged } from "./tabs/gecmis";
import { genelTab } from "./tabs/genel";
import { guvenlikTab } from "./tabs/guvenlik";
import { hakkindaTab } from "./tabs/hakkinda";
import { kurallarTab } from "./tabs/kurallar";
import { closeTopLayer, toast, toggle } from "./ui";
import { openWizard } from "./wizard";

const TABS: Record<TabId, Tab> = {
  genel: genelTab,
  claude: claudeTab,
  guvenlik: guvenlikTab,
  kurallar: kurallarTab,
  bildirimler: bildirimlerTab,
  gecmis: gecmisTab,
  hakkinda: hakkindaTab,
};

const LAST_TAB_KEY = "nobetci.settings.tab";

function isTab(v: string | null): v is TabId {
  return !!v && (TAB_IDS as readonly string[]).includes(v);
}

function storedTab(): TabId | null {
  try {
    const v = localStorage.getItem(LAST_TAB_KEY);
    return isTab(v) ? v : null;
  } catch {
    return null;
  }
}

function rememberTab(id: TabId) {
  try {
    localStorage.setItem(LAST_TAB_KEY, id);
  } catch {
    /* storage unavailable: not worth failing over */
  }
}

/** `?tab=` as the page was opened (go() rewrites the URL afterwards). */
const OPENED_WITH = new URLSearchParams(location.search).get("tab");

function initialTab(): TabId {
  return isTab(OPENED_WITH) ? OPENED_WITH : (storedTab() ?? "genel");
}

// ── Shell ─────────────────────────────────────────────────────────────────────

const root = document.getElementById("settings-root")!;
let active: TabId = "genel";

const titleEl = h("h1", { class: "head-title" });
const subEl = h("p", { class: "head-sub" });
const saveEl = h("span", { class: "save-state", role: "status", "aria-live": "polite" });
const content = h("div", { class: "content", id: "content" });
const inner = h("div", { class: "content-inner" });
content.append(inner);
const navButtons = new Map<TabId, { btn: HTMLButtonElement; label: HTMLElement; badge: HTMLElement }>();
const sideFoot = h("div", { class: "side-foot" });
const navEl = h("nav", { class: "nav" });
const brandSub = h("span");
const closeText = h("span", { class: "close-text" });
const closeBtn = h(
  "button",
  { type: "button", class: "close-btn" },
  h("kbd", { class: "close-kbd", text: "Esc" }),
  icon("close", 18),
  closeText,
);

function closeWindow() {
  void flush();
  void api.closeSettingsWindow();
  if (api.mock) toast(t("shell.previewClose"), "info");
}

function buildShell() {
  for (const id of TAB_IDS) {
    const tab = TABS[id];
    const badge = h("span", { class: "nav-badge" });
    const label = h("span", { class: "nav-label" });
    const btn = h("button", { type: "button", class: "nav-item", "data-tab": id }, icon(tab.icon, 18), label, badge);
    btn.addEventListener("click", () => go(id));
    navButtons.set(id, { btn, label, badge });
    navEl.append(btn);
  }
  closeBtn.addEventListener("click", closeWindow);

  root.replaceChildren(
    h(
      "div",
      { class: "app" },
      h(
        "aside",
        { class: "side" },
        h(
          "div",
          { class: "brand" },
          owlMark(30),
          h("div", { class: "brand-text" }, h("strong", { text: "Nöbetçi" }), brandSub),
        ),
        navEl,
        sideFoot,
      ),
      h(
        "main",
        { class: "main" },
        h(
          "header",
          { class: "head" },
          h("div", { class: "head-text" }, titleEl, subEl),
          h("div", { class: "head-right" }, saveEl, closeBtn),
        ),
        content,
      ),
    ),
  );
  paintShellTexts();
  paintSideFoot();
}

/** Everything in the shell that has words in it; repainted when the language changes. */
function paintShellTexts() {
  navEl.setAttribute("aria-label", t("shell.navLabel"));
  brandSub.textContent = t("shell.settings");
  closeBtn.title = t("shell.closeTitle");
  closeBtn.setAttribute("aria-label", t("shell.closeAria"));
  closeText.textContent = t("common.close");
  for (const [id, { btn, label }] of navButtons) {
    const title = TABS[id].title();
    label.textContent = title;
    btn.title = title;
  }
  const tab = TABS[active];
  titleEl.textContent = tab.title();
  subEl.textContent = tab.subtitle();
  document.title = t("shell.windowTitle", { tab: tab.title() });
}

// ── Sidebar footer: quick DND + quiet state ───────────────────────────────────

let quiet: QuietReason = null;

function paintSideFoot() {
  const s = settings();
  const sw = toggle(
    s.dnd,
    (v) => {
      update((x) => (x.dnd = v));
      quiet = v ? "dnd" : quiet === "dnd" ? null : quiet;
      paintSideFoot();
      if (active === "bildirimler" || active === "genel") rerenderActive();
    },
    { label: t("shell.dnd"), fk: "side-dnd" },
  );
  sideFoot.replaceChildren(
    h(
      "div",
      { class: `dnd-quick${s.dnd ? " on" : ""}` },
      h("span", { class: "dnd-ic" }, icon("moon", 16)),
      h("span", { class: "dnd-text", text: t("shell.dnd") }),
      sw,
    ),
    h(
      "div",
      { class: "side-meta" },
      quiet ? h("span", { class: "quiet-now", text: t(`shell.quiet.${quiet}`) }) : null,
      app.version ? h("span", { text: `v${app.version}` }) : null,
    ),
  );
}

async function refreshQuiet() {
  quiet = await api.quietState();
  paintSideFoot();
}

function paintBadges() {
  const s = settings();
  const rules = s.rules.filter((r) => r.enabled).length;
  const kb = navButtons.get("kurallar")?.badge;
  if (kb) {
    kb.textContent = rules ? String(rules) : "";
    kb.className = `nav-badge${rules ? " count" : ""}`;
  }
  const cb = navButtons.get("claude")?.badge;
  if (cb) {
    const hs = cache.hookStatus;
    const warn = cache.hookStatusLoaded && (!hs || !hs.installed || hs.stale || !hs.hookReady);
    cb.textContent = "";
    cb.className = `nav-badge${warn ? " warn" : ""}`;
    cb.title = warn ? t("shell.hookWarn") : "";
  }
}

// ── Save indicator ────────────────────────────────────────────────────────────

let saveTimer: number | null = null;
let lastSave: SaveState = "idle";

function paintSave(s: SaveState) {
  lastSave = s;
  if (saveTimer != null) window.clearTimeout(saveTimer);
  saveEl.className = `save-state ${s}`;
  saveEl.replaceChildren();
  if (s === "pending" || s === "saving") saveEl.append(h("span", { class: "spinner sm" }), t("common.saving"));
  else if (s === "saved") {
    saveEl.append(icon("check", 14), t("common.saved"));
    saveTimer = window.setTimeout(() => {
      saveEl.className = "save-state idle";
      lastSave = "idle";
    }, 1800);
  } else if (s === "error") saveEl.append(icon("warn", 14), t("common.saveFailed"));
}

// ── Routing ───────────────────────────────────────────────────────────────────

function rerenderActive() {
  const scroll = content.scrollTop;
  const focused = document.activeElement as HTMLElement | null;
  const fk = focused && inner.contains(focused) ? focused.getAttribute("data-fk") : null;
  let sel: [number | null, number | null] | null = null;
  if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) {
    try {
      sel = [focused.selectionStart, focused.selectionEnd];
    } catch {
      sel = null;
    }
  }
  inner.replaceChildren(TABS[active].render());
  content.scrollTop = scroll;
  if (fk) {
    const el = inner.querySelector<HTMLElement>(`[data-fk="${CSS.escape(fk)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (sel && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && sel[0] != null) {
        try {
          el.setSelectionRange(sel[0], sel[1] ?? sel[0]);
        } catch {
          /* type=time etc. have no selection */
        }
      }
    }
  }
  paintBadges();
}

function go(id: TabId) {
  if (id !== active) TABS[active].onHide?.();
  active = id;
  rememberTab(id);
  for (const [tid, { btn }] of navButtons) {
    btn.classList.toggle("on", tid === id);
    if (tid === id) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  }
  paintShellTexts();
  try {
    const url = new URL(location.href);
    url.searchParams.set("tab", id);
    history.replaceState(null, "", url);
  } catch {
    /* not critical */
  }
  inner.replaceChildren(TABS[id].render());
  content.scrollTop = 0;
  paintBadges();
  TABS[id].onShow?.();
}

/** `settings-tab` payloads and `?tab=`: a tab id, or the wizard. */
function openTarget(target: string) {
  if (target === WIZARD_ID) openWizard();
  else if (isTab(target)) go(target);
}

// ── Keys ──────────────────────────────────────────────────────────────────────

window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  e.preventDefault();
  if (closeTopLayer()) return;
  closeWindow();
});

// Ctrl+1…7 switches tabs.
window.addEventListener("keydown", (e) => {
  if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
  const n = Number(e.key);
  if (n >= 1 && n <= TAB_IDS.length) {
    e.preventDefault();
    go(TAB_IDS[n - 1]);
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
  await initApi();
  const boot = await api.boot();
  initSettings(boot?.settings ?? DEFAULT_SETTINGS);
  app.version = boot?.version ?? "";
  app.hookPath = boot?.hookPath ?? "";
  app.systemLang = boot?.systemLang ?? "en";
  app.hooksLost = boot?.hooksLost ?? false;
  app.fullscreenSupported = boot?.fullscreenSupported ?? true;
  if (boot?.platform) setPlatform(boot.platform);
  initLanguage(app.systemLang);

  setNav({ rerender: rerenderActive, go, current: () => active, badges: paintBadges });
  buildShell();
  onSaveState(paintSave);
  onExternalChange(() => {
    // An import, a reset or another window may have changed the language too.
    applyLanguage();
    paintSideFoot();
    rerenderActive();
  });
  onLangChange(() => {
    // Rust localises labels, notes and errors by the same setting: drop what it
    // sent in the old language, repaint, and let the visible tab refetch.
    cache.categories = null;
    for (const tab of Object.values(TABS)) tab.onLang?.();
    paintShellTexts();
    paintSideFoot();
    paintSave(lastSave);
    rerenderActive();
    TABS[active].onShow?.();
  });

  go(initialTab());
  void loadHookStatus().then(paintBadges);
  void refreshQuiet();

  if (OPENED_WITH === WIZARD_ID || !settings().onboarded) openWizard();

  void api.onEvent<Settings>("settings-changed", (s) => applyIncoming(s));
  void api.onEvent<null>("history-changed", () => historyChanged());
  // Rust sends a plain id whenever the (already created, hidden) window is opened
  // for something specific: a tab, or "hosgeldin" for the wizard. Unknown ids are ignored.
  void api.onEvent<string>("settings-tab", (target) => openTarget(target));

  // The window is hidden, not closed: refresh what may have changed meanwhile.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    void refreshQuiet();
    void loadHookStatus().then(paintBadges);
    TABS[active].onShow?.();
  });
  window.setInterval(() => {
    if (document.visibilityState === "visible") void refreshQuiet();
  }, 30_000);
}

void start();
