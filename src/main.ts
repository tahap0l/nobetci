// Entry point: boot the bridge, wire the island, start the greeting.

import "./style.css";
import { Bridge, IS_TAURI, onEvent } from "./core/bridge";
import { Sound } from "./core/sound";
import { State, type Settings } from "./core/state";
import { getLang, resolveLang, setLang, setPlatform, setSystemLang, type Lang } from "./i18n/core";
import { t } from "./i18n/island";
import { Island } from "./island/island";
import { injectHook, registerHookHandlers } from "./island/hooks";

async function main() {
  const root = document.getElementById("root");
  if (!root) return;

  const island = new Island(root);

  // `?lang=tr|en` forces a language in the browser preview (README screenshots).
  const forced = import.meta.env.DEV ? new URLSearchParams(location.search).get("lang") : null;
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
  });

  // Global shortcuts (registered in Rust).
  await onEvent<string>("hotkey", (action) => island.onHotkey(action));

  registerHookHandlers(island);

  // Hooks that were installed but have disappeared: say so once the greeting is done.
  if (boot?.hooksLost) window.setTimeout(() => island.flash(t("fl.hooksLost"), "warn"), 4500);

  const demo = import.meta.env.DEV && !IS_TAURI ? new URLSearchParams(location.search).get("demo") : null;
  if (demo) {
    const { runDemo } = await import("./demo");
    runDemo(island, demo);
  } else {
    island.launch();
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
