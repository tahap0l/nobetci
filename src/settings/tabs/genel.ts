// Genel: the UI language first, then an at-a-glance strip, startup, where the
// island lives and how long it stays.

import { drawOwlMini } from "../../baykus/mini";
import { applyMascotPalette, MASCOT_THEMES, type MascotTheme } from "../../core/mascot-theme";
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
import { button, card, fmtMinutes, fmtNum, fmtPct, row, segmented, slider, toast, toggle } from "../ui";

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
    { type: "button", class: `glance${o.tone ? ` tone-${o.tone}` : ""}`, "data-fk": `glance:${o.to}` },
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
    { class: "glance-grid" },
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

function render(): HTMLElement {
  const s = settings();
  const preview = screenPreview(s.position);
  const lang = getLang();
  const weather = h("select", {
    "aria-label": t("genel.widgets.weather"),
    "data-fk": "islandWeatherCity",
    class: "mascot-theme-picker",
  }, h("option", { value: "", text: t("genel.widgets.off") }));
  for (const [id, name] of Object.entries(WEATHER_CITIES)) weather.append(h("option", { value: id, text: name }));
  weather.value = s.islandWeatherCity;
  weather.addEventListener("change", () => update((x) => (x.islandWeatherCity = weather.value)));
  const appearance = t("genel.appearance");
  const themeLabel = t("genel.mascotTheme");
  const picker = h("div", { class: "mascot-gallery", role: "group", "aria-label": themeLabel });
  for (const theme of Object.keys(MASCOT_THEMES) as MascotTheme[]) {
    const canvas = h("canvas", { width: 88, height: 88, "aria-hidden": "true" });
    const ctx = canvas.getContext("2d");
    if (ctx) drawOwlMini(ctx, 44, 44, 72, "idle", null, 0, theme);
    const button = h("button", {
      type: "button", class: "mascot-choice", "aria-pressed": theme === s.mascotTheme,
      "data-theme": theme, "data-fk": "mascotTheme-" + theme,
      onclick: () => {
        update((x) => (x.mascotTheme = theme));
        applyMascotPalette(theme);
        for (const choice of picker.querySelectorAll<HTMLButtonElement>(".mascot-choice")) {
          choice.setAttribute("aria-pressed", String(choice.dataset.theme === theme));
        }
      },
    }, canvas, MASCOT_THEMES[theme][lang]);
    button.setAttribute("aria-pressed", String(theme === s.mascotTheme));
    picker.append(button);
  }

  return h(
    "div",
    { class: "tab-body" },
    card(
      { title: t("genel.langTitle"), icon: "globe", desc: t("genel.langDesc"), cls: "card-lang" },
      languagePicker("lang"),
    ),
    card(
      { title: appearance, icon: "eye" },
      row(themeLabel, t("genel.mascotThemeHint"), picker),
    ),
    card(
      { title: t("genel.buddy.title"), icon: "eye", desc: t("genel.buddy.desc") },
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
          format: (v) => `%${v}`,
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
      { title: t("genel.widgets.title"), icon: "eye" },
      row(
        t("genel.widgets.media"),
        t("genel.widgets.mediaHint"),
        toggle(s.islandMedia, (v) => update((x) => (x.islandMedia = v)), {
          label: t("genel.widgets.media"), fk: "islandMedia",
        }),
      ),
      row(t("genel.widgets.weather"), t("genel.widgets.weatherHint"), weather),
    ),
    glance(),
    card(
      { title: t("genel.startup"), icon: "genel" },
      row(
        t("genel.autostart"),
        t("genel.autostartHint"),
        toggle(s.autostart, (v) => update((x) => (x.autostart = v)), { label: t("genel.autostart"), fk: "autostart" }),
      ),
    ),
    card(
      { title: t("genel.island"), icon: "eye", desc: t("genel.islandDesc") },
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
      { title: t("genel.sessions"), icon: "claude" },
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
};
