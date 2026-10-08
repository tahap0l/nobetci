// First-run wizard ("hosgeldin"): five calm steps with a progress rail and a way
// out at every step. Finishing or skipping sets `onboarded` (auto-saved), so it
// does not come back on its own; Hakkında can reopen it.
//
// It reuses the real controls: the reviewed-diff hook install from the Claude
// Code tab and the ceiling / hold / click-guard controls from Güvenlik.

import type { HealthReport } from "../core/bridge";
import { onLangChange } from "../i18n/core";
import { h } from "../ui/dom";
import { cache, loadHookStatus } from "./data";
import { t, tn, type MsgKey } from "./i18n";
import { icon, owlMark, type IconName } from "./icons";
import { languagePicker } from "./lang";
import { devParam, go } from "./nav";
import { settings, update } from "./store";
import { checkHealth, healthRunningView, healthView, hooksLost, openPreview } from "./tabs/claude";
import { ceilingControl, guardControls, holdControls } from "./tabs/guvenlik";
import { button, kbd, notice, pushLayer } from "./ui";

const STEPS = ["welcome", "connect", "health", "safety", "done"] as const;
type Step = (typeof STEPS)[number];

const STEP_LABEL: Record<Step, MsgKey> = {
  welcome: "wz.s.welcome",
  connect: "wz.s.connect",
  health: "wz.s.health",
  safety: "wz.s.safety",
  done: "wz.s.done",
};

const w = {
  step: 0,
  /** Step shown by the last paint: a repaint of the same step keeps its scroll. */
  painted: -1,
  overlay: null as HTMLElement | null,
  panel: null as HTMLElement | null,
  health: null as HealthReport | null,
  healthRunning: false,
  healthRan: false,
  pop: null as (() => void) | null,
  unlisten: null as (() => void) | null,
};

export function openWizard(step?: number) {
  const dev = Number(devParam("wiz"));
  const start = step ?? (dev >= 1 && dev <= STEPS.length ? dev - 1 : 0);
  if (w.overlay) {
    w.step = start;
    paint();
    return;
  }
  w.step = start;
  w.painted = -1;
  w.health = null;
  w.healthRan = false;
  w.panel = h("div", { class: "wz", role: "dialog", "aria-modal": "true" });
  w.overlay = h("div", { class: "wz-overlay" }, w.panel);
  document.body.append(w.overlay);
  w.pop = pushLayer(() => close(null));
  w.unlisten = onLangChange(() => paint());
  paint();
  if (!cache.hookStatusLoaded) void loadHookStatus().then(() => paint());
}

/** Leaves the wizard; either way it counts as seen. `then` opens a tab afterwards. */
function close(then: "kurallar" | null) {
  if (!w.overlay) return;
  update((x) => (x.onboarded = true));
  w.pop?.();
  w.unlisten?.();
  const overlay = w.overlay;
  w.overlay = null;
  w.panel = null;
  w.pop = null;
  w.unlisten = null;
  overlay.classList.add("leaving");
  window.setTimeout(() => overlay.remove(), 160);
  if (then) go(then);
}

function goStep(i: number) {
  w.step = Math.max(0, Math.min(STEPS.length - 1, i));
  paint();
}

async function runHealth() {
  w.healthRunning = true;
  w.healthRan = true;
  paint();
  w.health = await checkHealth();
  w.healthRunning = false;
  paint();
}

// ── Steps ─────────────────────────────────────────────────────────────────────

function bullet(ic: IconName, text: string): HTMLElement {
  return h("li", {}, h("span", { class: "wz-bullet-ic" }, icon(ic, 17)), h("span", { text }));
}

function welcome(): HTMLElement {
  return h(
    "div",
    { class: "wz-step wz-welcome" },
    h(
      "div",
      { class: "wz-hero" },
      owlMark(64),
      h(
        "div",
        {},
        h("h2", { class: "wz-title", tabindex: "-1", text: t("wz.welcome.title") }),
        h("p", { class: "wz-tagline", text: t("wz.welcome.tagline") }),
      ),
    ),
    h(
      "ul",
      { class: "wz-bullets" },
      bullet("eye", t("wz.welcome.b1")),
      bullet("guvenlik", t("wz.welcome.b2")),
      bullet("lock", t("wz.welcome.b3")),
    ),
    h(
      "div",
      { class: "wz-lang" },
      h("span", { class: "wz-label" }, icon("globe", 15), t("wz.welcome.lang")),
      languagePicker("wz-lang"),
    ),
  );
}

function connectStatus(): HTMLElement {
  const hs = cache.hookStatus;
  const reload = () => void loadHookStatus().then(() => paint());
  if (!cache.hookStatusLoaded)
    return h(
      "div",
      { class: "wz-status" },
      h("span", { class: "spinner" }),
      h("span", { text: t("claude.readingStatus") }),
    );
  if (!hs) return notice("warn", t("claude.statusFailed"));
  const relay = hs.hookReady ? null : notice("error", t("wz.connect.noRelay"));
  if (hs.installed && !hs.stale)
    return h(
      "div",
      {},
      h(
        "div",
        { class: "wz-ok" },
        h("span", { class: "wz-ok-ic" }, icon("check", 22)),
        h(
          "div",
          {},
          h("strong", { text: tn(hs.events.length, "wz.connect.okOne", "wz.connect.okOther") }),
          h("span", { text: t("wz.connect.okSub") }),
        ),
      ),
      relay,
    );
  if (hs.stale)
    return h(
      "div",
      {},
      notice("warn", t("wz.connect.stale")),
      h(
        "div",
        { class: "btn-row" },
        button(t("claude.btn.reinstall"), {
          kind: "primary",
          icon: "reset",
          onClick: () => void openPreview(true, reload),
        }),
      ),
      relay,
    );
  return h(
    "div",
    { class: "wz-connect-box" },
    hooksLost()
      ? notice("error", t("claude.lost"))
      : h("div", { class: "wz-status" }, icon("claude", 18), h("span", { text: t("wz.connect.none") })),
    button(hooksLost() ? t("claude.btn.reinstall") : t("claude.btn.install"), {
      kind: "primary",
      icon: hooksLost() ? "reset" : "download",
      fk: "wz:install",
      onClick: () => void openPreview(true, reload),
    }),
    relay,
  );
}

function connect(): HTMLElement {
  return h(
    "div",
    { class: "wz-step" },
    h("h2", { class: "wz-title", tabindex: "-1", text: t("wz.connect.title") }),
    h("p", { class: "wz-text", text: t("wz.connect.p1") }),
    h("p", { class: "wz-text", text: t("wz.connect.p2") }),
    connectStatus(),
  );
}

function health(): HTMLElement {
  const hs = cache.hookStatus;
  const body: (HTMLElement | null)[] = [];
  if (!hs?.installed) {
    body.push(
      notice("info", t("wz.health.needHooks")),
      h(
        "div",
        { class: "btn-row" },
        button(t("wz.health.backToConnect"), { kind: "ghost", icon: "left", onClick: () => goStep(1) }),
      ),
    );
  } else if (w.healthRunning) {
    body.push(healthRunningView());
  } else if (w.health) {
    body.push(
      healthView(w.health),
      h(
        "div",
        { class: "btn-row" },
        button(t("wz.health.again"), { kind: "ghost", icon: "pulse", onClick: () => void runHealth() }),
      ),
    );
  }
  return h(
    "div",
    { class: "wz-step" },
    h("h2", { class: "wz-title", tabindex: "-1", text: t("wz.health.title") }),
    h("p", { class: "wz-text", text: t("wz.health.p") }),
    ...body,
  );
}

function safety(): HTMLElement {
  const ceilingText = h("p", { class: "wz-hint" });
  const paintCeiling = () => {
    const c = settings().autoAllowMax;
    ceilingText.textContent = t(
      c === "none" ? "wz.safety.ceilingNone" : c === "low" ? "wz.safety.ceilingLow" : "wz.safety.ceilingMedium",
    );
  };
  paintCeiling();
  return h(
    "div",
    { class: "wz-step" },
    h("h2", { class: "wz-title", tabindex: "-1", text: t("wz.safety.title") }),
    h("p", { class: "wz-text", text: t("wz.safety.p") }),
    h(
      "section",
      { class: "wz-section" },
      h("h3", { class: "wz-h3" }, icon("guvenlik", 15), t("guv.ceilingTitle")),
      ceilingControl(() => paintCeiling()),
      ceilingText,
      h("p", { class: "fine" }, icon("lock", 13), h("span", { text: t("wz.safety.never") })),
    ),
    h(
      "section",
      { class: "wz-section" },
      h("h3", { class: "wz-h3" }, icon("hand", 15), t("guv.holdTitle")),
      holdControls(),
    ),
    h(
      "section",
      { class: "wz-section" },
      h("h3", { class: "wz-h3" }, icon("cursor", 15), t("guv.guardTitle")),
      h("p", { class: "wz-hint", text: t("guv.guardDesc") }),
      guardControls(() => paint()),
    ),
  );
}

function tip(ic: IconName, ...content: (Node | string)[]): HTMLElement {
  return h("li", {}, h("span", { class: "wz-bullet-ic" }, icon(ic, 17)), h("span", {}, ...content));
}

function done(): HTMLElement {
  const toggleKey = settings().hotkeys.toggle.trim();
  return h(
    "div",
    { class: "wz-step wz-done" },
    h(
      "div",
      { class: "wz-hero" },
      h("span", { class: "wz-done-ic" }, icon("check", 28)),
      h(
        "div",
        {},
        h("h2", { class: "wz-title", tabindex: "-1", text: t("wz.done.title") }),
        h("p", { class: "wz-tagline", text: t("wz.done.p") }),
      ),
    ),
    h(
      "ul",
      { class: "wz-bullets" },
      toggleKey
        ? tip("keyboard", t("wz.tip.keyBefore"), kbd(toggleKey), t("wz.tip.keyAfter"))
        : tip("keyboard", t("wz.tip.tray")),
      tip("eye", t("wz.tip.row")),
      tip("hand", t("wz.tip.hold")),
      tip("kurallar", t("wz.tip.rules")),
    ),
  );
}

// ── Frame ─────────────────────────────────────────────────────────────────────

function rail(): HTMLElement {
  const list = h("ol", { class: "wz-steps" });
  STEPS.forEach((s, i) => {
    const state = i < w.step ? "past" : i === w.step ? "now" : "next";
    const item = h(
      "li",
      { class: `wz-step-item ${state}` },
      h(
        "button",
        { type: "button", class: "wz-step-btn", "aria-current": i === w.step ? "step" : undefined },
        h("span", { class: "wz-dot" }, i < w.step ? icon("check", 13) : String(i + 1)),
        h("span", { class: "wz-step-label", text: t(STEP_LABEL[s]) }),
      ),
    );
    item.querySelector("button")!.addEventListener("click", () => goStep(i));
    list.append(item);
  });
  return h(
    "aside",
    { class: "wz-rail" },
    h(
      "div",
      { class: "wz-brand" },
      owlMark(28),
      h("div", { class: "brand-text" }, h("strong", { text: "Nöbetçi" }), h("span", { text: t("wz.setup") })),
    ),
    list,
  );
}

function paint() {
  if (!w.panel) return;
  const step = STEPS[w.step];
  if (step === "health" && cache.hookStatus?.installed && !w.healthRan && !w.healthRunning) {
    // Entering the step runs the check once; "Run again" repeats it.
    void runHealth();
    return;
  }
  const last = w.step === STEPS.length - 1;
  const body =
    step === "welcome"
      ? welcome()
      : step === "connect"
        ? connect()
        : step === "health"
          ? health()
          : step === "safety"
            ? safety()
            : done();
  const bar = h("span", { class: "wz-bar-fill" });
  bar.style.width = `${((w.step + 1) / STEPS.length) * 100}%`;

  const foot = h(
    "div",
    { class: "wz-foot" },
    last
      ? null
      : button(t("wz.skip"), { kind: "subtle", title: t("wz.skipTitle"), fk: "wz:skip", onClick: () => close(null) }),
    h("span", { class: "spacer" }),
    w.step > 0 ? button(t("wz.back"), { kind: "ghost", icon: "left", onClick: () => goStep(w.step - 1) }) : null,
    last ? button(t("wz.done.rules"), { kind: "ghost", icon: "kurallar", onClick: () => close("kurallar") }) : null,
    last
      ? button(t("wz.finish"), { kind: "primary", icon: "check", fk: "wz:finish", onClick: () => close(null) })
      : button(t("wz.next"), { kind: "primary", fk: "wz:next", onClick: () => goStep(w.step + 1) }),
  );

  const main = h(
    "div",
    { class: "wz-main" },
    h(
      "div",
      { class: "wz-head" },
      h(
        "div",
        { class: "wz-progress" },
        h("span", { class: "wz-kicker", text: t("wz.step", { n: w.step + 1, total: STEPS.length }) }),
        h("span", { class: "wz-bar" }, bar),
      ),
      button("", { kind: "subtle", small: true, icon: "close", title: t("wz.closeTitle"), onClick: () => close(null) }),
    ),
    h("div", { class: "wz-body" }, body),
    foot,
  );

  const scroll = w.panel.querySelector(".wz-body")?.scrollTop ?? 0;
  const sameStep = w.painted === w.step;
  w.panel.setAttribute("aria-label", t("wz.aria"));
  w.panel.replaceChildren(rail(), main);
  w.painted = w.step;
  const newBody = w.panel.querySelector<HTMLElement>(".wz-body");
  if (sameStep && newBody) newBody.scrollTop = scroll;
  else window.setTimeout(() => w.panel?.querySelector<HTMLElement>(".wz-title")?.focus({ preventScroll: true }), 0);
}
