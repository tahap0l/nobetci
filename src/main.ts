// Entry point: boot the bridge, wire the island, start the greeting.

import "./style.css";
import { Bridge, IS_TAURI, onEvent } from "./core/bridge";
import { DEFAULT_DENY_REASONS } from "./core/settings-model";
import { Sound } from "./core/sound";
import { State, type Settings } from "./core/state";
import { guardWebview } from "./core/webview";
import { getLang, resolveLang, setLang, setPlatform, setSystemLang, type Lang } from "./i18n/core";
import { t } from "./i18n/island";
import { Island } from "./island/island";
import { injectHook, registerHookHandlers, restorePending } from "./island/hooks";

async function main() {
  const root = document.getElementById("root");
  if (!root) return;

  // No "Reload" from the webview's own menu or keys: a reload would drop the
  // cards on screen while Claude Code waits on them.
  if (IS_TAURI) guardWebview();

  const island = new Island(root);

  // The website's live demo is this page, built with VITE_WEB_DEMO=1 (vite.config.ts);
  // the app's own build has neither flag, so the demo code is dropped from it.
  const demoBuild = import.meta.env.DEV || import.meta.env.VITE_WEB_DEMO === "1";
  // `?lang=tr|en` forces a language in the browser preview (README screenshots).
  const forced = demoBuild ? new URLSearchParams(location.search).get("lang") : null;
  const pickLang = (): Lang => (forced === "tr" || forced === "en" ? forced : resolveLang(State.settings.language));

  const boot = await Bridge.boot();
  if (boot) {
    State.settings = { ...State.settings, ...boot.settings };
    State.version = boot.version;
    setSystemLang(boot.systemLang);
    setPlatform(boot.platform);
  }
  if (pickLang() !== getLang()) {
    setLang(pickLang());
    island.relocalize();
  } else {
    setLang(pickLang());
  }
  // Without Rust (the browser preview, the website's demo) the deny reasons are
  // the built-in ones, in the page's language as Rust would pick them.
  if (!boot) State.settings.denyReasons = [...DEFAULT_DENY_REASONS[getLang()]];
  // Quiet hours or a full-screen app may already be on: ask before the greeting's hoot.
  await island.refreshQuiet();
  island.applySettings();

  await onEvent<{ x: number; y: number }>("cursor", ({ x, y }) => island.onCursor(x, y));

  await onEvent<string>("tray", (what) => {
    switch (what) {
      case "open":
        if (State.paused) island.togglePause();
        island.setView(State.defaultView());
        break;
      case "pause":
        island.togglePause();
        if (State.paused && !State.approvals.length) island.fsm.forceHidden();
        else if (!State.paused) island.reveal();
        break;
    }
  });

  await onEvent<null>("screen-changed", () => void Bridge.reposition());

  // The settings window is in use: fold away so its title bar is reachable.
  await onEvent<null>("settings-focused", () => island.yieldToSettings());

  // The settings window writes preferences; apply them here without a restart.
  await onEvent<Settings>("settings-changed", (s) => {
    const wasDnd = State.settings.dnd;
    State.settings = { ...State.settings, ...s };
    if (pickLang() !== getLang()) {
      setLang(pickLang());
      island.relocalize();
    }
    island.applySettings();
    if (wasDnd !== s.dnd) island.flash(s.dnd ? t("fl.dndOn") : t("fl.dndOff"), "info");
    // Quiet hours may have been switched on or moved.
    void island.refreshQuiet();
  });

  // Global shortcuts (registered in Rust).
  await onEvent<string>("hotkey", (action) => island.onHotkey(action));

  registerHookHandlers(island);

  // Hooks that were installed but have disappeared: say so once the greeting is done.
  if (boot?.hooksLost) window.setTimeout(() => island.flash(t("fl.hooksLost"), "warn"), 4500);

  const demo = demoBuild && !IS_TAURI
    ? new URLSearchParams(location.search).get("demo") ?? (import.meta.env.VITE_WEB_DEMO === "1" ? "overview" : null)
    : null;
  if (demo) {
    const { runDemo } = await import("./demo");
    runDemo(island, demo);
  } else {
    // Requests still waiting when the island (re)loaded come back first, without
    // the greeting: Claude Code is waiting on them (C-11).
    const restored = IS_TAURI ? await restorePending(island) : 0;
    if (!restored) island.launch();
  }

  if (!IS_TAURI) {
    // Plain browser (`npm run dev`): audio needs a gesture, and there is no Rust
    // to feed events — `nobetci.inject({...})` in the console fakes a hook event.
    document.addEventListener("click", () => Sound.resume(), { once: true });
    (window as unknown as { nobetci: unknown }).nobetci = {
      State,
      island,
      inject: (p: Parameters<typeof injectHook>[1]) => injectHook(island, p),
    };
  }
}

void main();
