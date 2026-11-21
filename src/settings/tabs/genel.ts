// Genel: the UI language first, then an at-a-glance strip, the look (mascot
// theme with a live preview), the desktop mascot, island widgets, startup,
// where the island lives and how long it stays.

import { mountMascot, type EmbeddedMascot } from "../../baykus/embed";
import { OwlEngine } from "../../baykus/owl";
import { MASCOT_THEMES, type MascotTheme } from "../../core/mascot-theme";
import { WEATHER_CITIES } from "../../core/island-widgets";
import { getLang } from "../../i18n/core";
import type { AuditStats } from "../../core/bridge";
import type { Settings } from "../../core/settings-model";
import { h } from "../../ui/dom";
import { api } from "../api";
import { cache, ceilingLabel, loadHookStatus } from "../data";
import { t, tn } from "../i18n";
import { icon, type IconName } from "../icons";
import { languagePicker } from "../lang";
import { app, go, rerender, type Tab, type TabId } from "../nav";
import { settings, update } from "../store";
import { applySettingsTheme } from "../theme";
import { button, card, fmtMinutes, fmtNum, fmtPct, row, segmented, select, slider, toast, toggle } from "../ui";

let week: AuditStats | null = null;
let loading = false;

async function load() {
  if (loading) return;
  loading = true;
  const [, stats] = await Promise.all([loadHookStatus(), api.auditStats(7)]);
  week = stats;
  loading = false;
  rerender("genel");
}

function tile(o: {
  ic: IconName;
  label: string;
  value: string;
  sub: string;
  tone?: "ok" | "warn" | "bad" | "muted";
  to: TabId;
}): HTMLElement {
  const b = h(
    "button",
    { type: "button", class: `glance${o.tone ? ` tone-${o.tone}` : ""}`, "data-fk": `glance:${o.to}`, title: `${o.label}: ${o.value} · ${o.sub}` },
    h("span", { class: "glance-top" }, icon(o.ic, 15), h("span", { class: "glance-label", text: o.label })),
    h("span", { class: "glance-value", text: o.value }),
    h("span", { class: "glance-sub", text: o.sub }),
  );
  b.addEventListener("click", () => go(o.to));
  return b;
}

function hookTile(): HTMLElement {
  const hs = cache.hookStatus;
  const base = { ic: "claude" as const, label: t("genel.glance.claude"), to: "claude" as const };
  if (!cache.hookStatusLoaded) return tile({ ...base, value: "…", sub: t("genel.glance.checking") });
  if (!hs) return tile({ ...base, value: t("genel.glance.unknown"), sub: t("genel.glance.noStatus"), tone: "muted" });
  if (hs.stale) return tile({ ...base, value: t("genel.glance.reinstall"), sub: t("genel.glance.stale"), tone: "bad" });
  if (hs.installed)
    return tile({
      ...base,
      value: t("genel.glance.connected"),
      sub: tn(hs.events.length, "genel.glance.eventsOne", "genel.glance.eventsOther"),
      tone: "ok",
    });
  if (app.hooksLost)
    return tile({ ...base, value: t("genel.glance.notConnected"), sub: t("genel.glance.lost"), tone: "bad" });
  return tile({ ...base, value: t("genel.glance.notConnected"), sub: t("genel.glance.noHooks"), tone: "warn" });
}

function glance(): HTMLElement {
  const s = settings();
  const activeRules = s.rules.filter((r) => r.enabled).length;
  const quiet = s.dnd
    ? t("genel.glance.dndOn")
    : s.quietEnabled
      ? t("genel.glance.quietHours", { from: s.quietFrom, to: s.quietTo })
      : s.soundEnabled
        ? t("genel.glance.soundOn", { pct: fmtPct(s.soundVolume, 1) })
        : t("genel.glance.soundOff");
  return h(
    "div",
    { class: "glance-grid", role: "group", "aria-label": t("genel.glance.aria") },
    hookTile(),
    tile({
      ic: "guvenlik",
      label: t("genel.glance.autoAllow"),
      value: ceilingLabel(s.autoAllowMax),
      sub: t("genel.glance.highYou"),
      tone: s.autoAllowMax === "medium" ? "warn" : undefined,
      to: "guvenlik",
    }),
    tile({
      ic: "kurallar",
      label: t("genel.glance.rules"),
      value: tn(activeRules, "genel.glance.rulesOne", "genel.glance.rulesOther"),
      sub: s.projects.length
        ? tn(s.projects.length, "genel.glance.projectsOne", "genel.glance.projectsOther")
        : t("genel.glance.noProjects"),
      to: "kurallar",
    }),
    tile({
      ic: s.dnd ? "moon" : "bildirimler",
      label: t("genel.glance.notifications"),
      value: s.dnd ? t("genel.glance.quiet") : s.toastEnabled ? t("genel.glance.on") : t("genel.glance.off"),
      sub: quiet,
      tone: s.dnd ? "warn" : undefined,
      to: "bildirimler",
    }),
    tile({
      ic: "gecmis",
      label: t("genel.glance.week"),
      value: week ? tn(week.total, "genel.glance.requestsOne", "genel.glance.requestsOther") : "…",
      sub: week
        ? t("genel.glance.weekSub", { d: fmtNum(week.denied), a: fmtNum(week.automatic) })
        : t("genel.glance.loading"),
      to: "gecmis",
    }),
  );
}

function screenPreview(pos: Settings["position"]): HTMLElement {
  return h(
    "div",
    { class: `screen-preview pos-${pos}`, "aria-hidden": "true" },
    h("span", { class: "sp-island" }),
    h("span", { class: "sp-bar" }),
  );
}

// ── Mascot theme: a live preview and a portrait per theme ─────────────────────

/** The animated mascot of the chosen theme; kept across redraws, stopped when the tab hides. */
let stage: { host: HTMLElement; mascot: EmbeddedMascot | null } | null = null;

function liveStage(theme: MascotTheme): HTMLElement {
  if (!stage) {
    const host = h("div", { class: "mascot-stage-canvas" });
    let mascot: EmbeddedMascot | null = null;
    try {
      mascot = mountMascot(host, theme);
      mascot.wave();
    } catch {
      mascot = null; // no canvas here: the portraits below still show every theme
    }
    stage = { host, mascot };
  }
  // An import or another window may have changed the theme since the last redraw.
  stage.mascot?.setTheme(theme);
  return stage.host;
}

function stopStage() {
  stage?.mascot?.destroy();
  stage = null;
}

/** Still portraits drawn by the real engine (no mood ring), cached per theme and pixel ratio. */
const portraits = new Map<string, HTMLCanvasElement>();

function portrait(theme: MascotTheme): HTMLCanvasElement {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const key = `${theme}@${dpr}`;
  const cached = portraits.get(key);
  if (cached) return cached;
  const css = 52;
  const canvas = h("canvas", { width: Math.round(css * dpr), height: Math.round(css * dpr), "aria-hidden": "true" });
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const engine = new OwlEngine(7);
    engine.setSkin(theme);
    // Let the springs settle into the resting pose before the one drawing.
    for (let i = 0; i < 90; i++) engine.update(1 / 60);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const size = 44;
    ctx.translate((css - size) / 2, css - size - 1);
    engine.draw(ctx, size, size);
  }
  portraits.set(key, canvas);
  return canvas;
}

function appearanceCard(s: Settings): HTMLElement {
  const lang = getLang();
  const themeLabel = t("genel.mascotTheme");
  const live = liveStage(s.mascotTheme);
  const picker = h("div", { class: "mascot-gallery", role: "radiogroup", "aria-label": themeLabel });
  const name = h("span", { class: "mascot-stage-name", text: MASCOT_THEMES[s.mascotTheme][lang] });
  const preview = (theme: MascotTheme) => {
    stage?.mascot?.setTheme(theme);
    name.textContent = MASCOT_THEMES[theme][getLang()];
  };
  const choices: HTMLButtonElement[] = [];
  const choose = (theme: MascotTheme) => {
    if (settings().mascotTheme !== theme) {
      update((x) => (x.mascotTheme = theme));
      applySettingsTheme(theme);
      stage?.mascot?.emote("happy");
    }
    for (const c of choices) {
      const on = c.dataset.theme === theme;
      c.setAttribute("aria-checked", String(on));
      c.classList.toggle("on", on);
      c.tabIndex = on ? 0 : -1;
    }
    preview(theme);
  };
  for (const theme of Object.keys(MASCOT_THEMES) as MascotTheme[]) {
    const on = theme === s.mascotTheme;
    const b = h(
      "button",
      {
        type: "button",
        class: `mascot-choice${on ? " on" : ""}`,
        role: "radio",
        "aria-checked": String(on),
        tabindex: on ? "0" : "-1",
        "data-theme": theme,
        "data-fk": `mascotTheme-${theme}`,
      },
      portrait(theme),
      h("span", { class: "mascot-name", text: MASCOT_THEMES[theme][lang] }),
    );
    b.addEventListener("click", () => choose(theme));
    // Pointing at a theme (or tabbing to it) shows it moving in the stage.
    b.addEventListener("pointerenter", () => preview(theme));
    b.addEventListener("pointerleave", () => preview(settings().mascotTheme));
    choices.push(b);
    picker.append(b);
  }
  // One Tab stop; the arrow keys walk the themes, like any radio group.
  picker.addEventListener("keydown", (e) => {
    const i = choices.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const n = choices.length;
    const j =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (i + 1) % n
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (i - 1 + n) % n
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : -1;
    if (j < 0) return;
    e.preventDefault();
    choices[j].focus();
    choose(choices[j].dataset.theme as MascotTheme);
  });

  return card(
    { title: t("genel.appearance"), icon: "palette" },
    h(
      "div",
      { class: "mascot-theme" },
      h(
        "div",
        { class: "mascot-stage", title: t("genel.mascotStageTitle") },
        live,
        name,
      ),
      h(
        "div",
        { class: "mascot-theme-side" },
        h("div", { class: "row-label", text: themeLabel }),
        h("div", { class: "row-hint", text: t("genel.mascotThemeHint") }),
        picker,
      ),
    ),
    row(
      t("genel.islandMascot"),
      t("genel.islandMascotHint"),
      slider({
        value: s.islandMascotSize,
        min: 80,
        max: 130,
        step: 5,
        format: (v) => fmtPct(v, 100),
        onChange: (v) => update((x) => (x.islandMascotSize = v)),
        fk: "islandMascotSize",
        label: t("genel.islandMascot"),
        ends: true,
      }),
    ),
  );
}

function render(): HTMLElement {
  const s = settings();
  const preview = screenPreview(s.position);
  const weather = select<string>(
    [["", t("genel.widgets.off")], ...Object.entries(WEATHER_CITIES)],
    s.islandWeatherCity,
    (v) => update((x) => (x.islandWeatherCity = v)),
    { label: t("genel.widgets.weather"), fk: "islandWeatherCity", cls: "select-weather" },
  );

  return h(
    "div",
    { class: "tab-body" },
    card(
      { title: t("genel.langTitle"), icon: "globe", desc: t("genel.langDesc"), cls: "card-lang" },
      languagePicker("lang"),
    ),
    // The summary belongs at the top: that is what "at a glance" means.
    glance(),
    appearanceCard(s),
    card(
      { title: t("genel.buddy.title"), icon: "mascot", desc: t("genel.buddy.desc") },
      row(
        t("genel.buddy.show"),
        t("genel.buddy.showHint"),
        toggle(s.buddy, (v) => update((x) => (x.buddy = v)), { label: t("genel.buddy.show"), fk: "buddy" }),
      ),
      row(
        t("genel.buddy.size"),
        t("genel.buddy.sizeHint"),
        slider({
          value: s.buddySize,
          min: 60,
          max: 200,
          step: 10,
          format: (v) => fmtPct(v, 100),
          onChange: (v) => update((x) => (x.buddySize = v)),
          fk: "buddySize",
          label: t("genel.buddy.size"),
          ends: true,
        }),
      ),
      row(
        t("genel.buddy.reset"),
        t("genel.buddy.resetHint"),
        button(t("genel.buddy.resetButton"), {
          small: true,
          fk: "buddyReset",
          onClick: () => {
            void api.buddyResetPosition().then(() => toast(t("genel.buddy.resetDone")));
          },
        }),
      ),
    ),
    card(
      { title: t("genel.widgets.title"), icon: "widgets" },
      row(
        t("genel.widgets.media"),
        t("genel.widgets.mediaHint"),
        toggle(s.islandMedia, (v) => update((x) => (x.islandMedia = v)), {
          label: t("genel.widgets.media"),
          fk: "islandMedia",
        }),
      ),
      row(t("genel.widgets.weather"), t("genel.widgets.weatherHint"), weather),
      row(
        t("genel.widgets.focus"),
        t("genel.widgets.focusHint"),
        slider({
          value: s.focusMinutes,
          // The island's − / + go up to 180 and Rust keeps 5–180: the same range here.
          min: 5,
          max: 180,
          step: 5,
          format: (v) => fmtMinutes(v),
          onChange: (v) => update((x) => (x.focusMinutes = v)),
          fk: "focusMinutes",
          label: t("genel.widgets.focus"),
          ends: true,
        }),
      ),
    ),
    card(
      { title: t("genel.assistant.title"), icon: "assistant" },
      row(
        t("genel.assistant.apps"),
        t("genel.assistant.appsHint"),
        toggle(s.assistantUseApps, (v) => update((x) => (x.assistantUseApps = v)), {
          label: t("genel.assistant.apps"),
          fk: "assistantUseApps",
        }),
      ),
    ),
    card(
      { title: t("genel.startup"), icon: "power" },
      row(
        t("genel.autostart"),
        t("genel.autostartHint"),
        toggle(s.autostart, (v) => update((x) => (x.autostart = v)), { label: t("genel.autostart"), fk: "autostart" }),
      ),
    ),
    card(
      { title: t("genel.island"), icon: "island", desc: t("genel.islandDesc") },
      row(
        t("genel.screen"),
        t("genel.screenHint"),
        segmented(
          [
            ["primary", t("genel.screen.primary")],
            ["cursor", t("genel.screen.cursor")],
          ] as const,
          s.screen,
          (v) => update((x) => (x.screen = v)),
          { fk: "screen", label: t("genel.screen") },
        ),
      ),
      row(
        t("genel.position"),
        t("genel.positionHint"),
        h(
          "div",
          { class: "pos-ctl" },
          preview,
          segmented(
            [
              ["left", t("genel.pos.left")],
              ["center", t("genel.pos.center")],
              ["right", t("genel.pos.right")],
            ] as const,
            s.position,
            (v) => {
              preview.className = `screen-preview pos-${v}`;
              update((x) => (x.position = v));
            },
            { fk: "position", label: t("genel.position") },
          ),
        ),
      ),
      row(
        t("genel.autoClose"),
        t("genel.autoCloseHint"),
        slider({
          value: s.autoCloseInterval,
          min: 3,
          max: 120,
          step: 1,
          format: (v) => t("unit.sec", { n: v }),
          onChange: (v) => update((x) => (x.autoCloseInterval = v)),
          fk: "autoClose",
          label: t("genel.autoClose"),
          ends: true,
        }),
      ),
      row(
        t("genel.expandOnFinish"),
        t("genel.expandOnFinishHint"),
        toggle(s.expandOnFinish, (v) => update((x) => (x.expandOnFinish = v)), {
          label: t("genel.expandOnFinish"),
          fk: "expandOnFinish",
        }),
      ),
    ),
    card(
      { title: t("genel.sessions"), icon: "sessions" },
      row(
        t("genel.stale"),
        t("genel.staleHint"),
        slider({
          value: s.staleMinutes,
          min: 5,
          max: 240,
          step: 5,
          format: (v) => fmtMinutes(v),
          onChange: (v) => update((x) => (x.staleMinutes = v)),
          fk: "stale",
          label: t("genel.stale"),
          ends: true,
        }),
      ),
    ),
  );
}

export const genelTab: Tab = {
  id: "genel",
  title: () => t("genel.title"),
  subtitle: () => t("genel.subtitle"),
  icon: "genel",
  render,
  onShow: () => void load(),
  onHide: stopStage,
};
