// First-run wizard ("hosgeldin"): five calm steps with a progress rail and a way
// out at every step. Finishing or skipping sets `onboarded` (auto-saved), so it
// does not come back on its own; Hakkında can reopen it.
//
// It reuses the real controls: the reviewed-diff hook install from the Claude
// Code tab and the ceiling / hold / click-guard controls from Güvenlik.

import { mountMascot, type EmbeddedMascot } from "../baykus/embed";
import { onLangChange } from "../i18n/core";
import { h } from "../ui/dom";
import type { HealthReport } from "./api";
import { cache, loadHookStatus } from "./data";
import { t, tn, type MsgKey } from "./i18n";
import { icon, owlMark, type IconName } from "./icons";
import { languagePicker } from "./lang";
import { devParam, go } from "./nav";
import { settings, update } from "./store";
import {
  checkHealth,
  gitBashNote,
  healthPasses,
  healthRunningView,
  healthView,
  hooksLost,
  openPreview,
} from "./tabs/claude";
import { ceilingControl, guardControls, holdControls } from "./tabs/guvenlik";
import { button, holdKeyboard, kbd, notice, pushLayer } from "./ui";

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
  /** Steps that have been on screen. */
  seen: new Set<Step>(),
  /** Why the last hook preview could not be made (shown in the Connect step). */
  connectError: null as string | null,
  pop: null as (() => void) | null,
  release: null as (() => void) | null,
  unlisten: null as (() => void) | null,
  /** The user's own mascot on the welcome step, alive while the wizard is open. */
  mascot: null as EmbeddedMascot | null,
  mascotHost: null as HTMLElement | null,
};

/** The wizard is on screen. */
export function wizardOpen(): boolean {
  return !!w.overlay;
}

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
  w.seen = new Set();
  w.connectError = null;
  w.panel = h("div", { class: "wz", role: "dialog", "aria-modal": "true" });
  w.overlay = h("div", { class: "wz-overlay" }, w.panel);
  document.body.append(w.overlay);
  // The settings page behind is inert until the wizard closes; Tab stays inside.
  w.release = holdKeyboard(w.overlay);
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
  w.mascot?.destroy();
  const overlay = w.overlay;
  w.overlay = null;
  w.panel = null;
  w.pop = null;
  w.unlisten = null;
  w.mascot = null;
  w.mascotHost = null;
  overlay.classList.add("leaving");
  window.setTimeout(() => overlay.remove(), 160);
  if (then) go(then);
  // The page comes back to life, and the focus to where it was before.
  w.release?.();
  w.release = null;
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

/** The user's mascot, waving hello; one canvas for the whole wizard. */
function heroMascot(): HTMLElement {
  if (!w.mascotHost) {
    w.mascotHost = h("div", { class: "wz-mascot", "aria-hidden": "true" });
    try {
      w.mascot = mountMascot(w.mascotHost, settings().mascotTheme);
      w.mascot.wave();
    } catch {
      // No canvas (very old webview): the static mark still says hello.
      w.mascotHost.replaceChildren(owlMark(64));
    }
  }
  return w.mascotHost;
}

function welcome(): HTMLElement {
  return h(
    "div",
    { class: "wz-step wz-welcome" },
    h(
      "div",
      { class: "wz-hero" },
      heroMascot(),
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
  const reload = () => {
    w.connectError = null;
    void loadHookStatus().then(() => paint());
  };
  // A preview that could not be made (settings.json is not valid JSON, the relay
  // is missing…) is said here, in the wizard — not on a tab hidden behind it.
  const preview = () => {
    w.connectError = null;
    paint();
    void openPreview(true, {
      onApplied: reload,
      onError: (text) => {
        w.connectError = text;
        paint();
      },
    });
  };
  const error = w.connectError
    ? notice(
        "error",
        h("strong", { text: t("wz.connect.previewFailed") }),
        " ",
        h("span", { class: "verbatim", text: w.connectError }),
      )
    : null;
  if (!cache.hookStatusLoaded)
    return h(
      "div",
      { class: "wz-status" },
      h("span", { class: "spinner" }),
      h("span", { text: t("claude.readingStatus") }),
    );
  if (!hs) return notice("warn", t("claude.statusFailed"));
  const relay = hs.hookReady ? null : notice("error", t("wz.connect.noRelay"));
  // Said before the install too: on this Windows profile the hooks run in Git Bash only.
  const gitBash = gitBashNote(hs);
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
      gitBash,
    );
  if (hs.stale)
    return h(
      "div",
      { class: "wz-connect-box" },
      notice("warn", t("wz.connect.stale")),
      button(t("claude.btn.reinstall"), {
        kind: "primary",
        icon: "reset",
        fk: "wz:reinstall",
        disabled: !hs.hookReady,
        onClick: preview,
      }),
      error,
      relay,
      gitBash,
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
      disabled: !hs.hookReady,
      onClick: preview,
    }),
    error,
    relay,
    gitBash,
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

/** Whether a step's job is actually done — a tick means done, not merely passed. */
function completed(s: Step): boolean {
  const hs = cache.hookStatus;
  switch (s) {
    case "welcome":
      return w.seen.has("welcome");
    case "connect":
      return !!hs?.installed && !hs.stale;
    case "health":
      // Ticked only when the step itself says "All good" (the same test).
      return !!w.health && healthPasses(w.health);
    case "safety":
      return w.seen.has("safety");
    case "done":
      return false;
  }
}

function rail(): HTMLElement {
  const list = h("ol", { class: "wz-steps" });
  STEPS.forEach((s, i) => {
    const now = i === w.step;
    const ok = !now && completed(s);
    // Left behind without being done: a plain number, marked as skipped.
    const skipped = !now && !ok && i < w.step;
    const state = now ? "now" : ok ? "past" : skipped ? "skipped" : "next";
    const item = h(
      "li",
      { class: `wz-step-item ${state}` },
      h(
        "button",
        {
          type: "button",
          class: "wz-step-btn",
          "aria-current": now ? "step" : undefined,
          "data-fk": `wz-step:${s}`,
          title: ok ? t("wz.rail.done") : skipped ? t("wz.rail.skipped") : undefined,
        },
        h("span", { class: "wz-dot" }, ok ? icon("check", 13) : String(i + 1)),
        h("span", { class: "wz-step-label", text: t(STEP_LABEL[s]) }),
        ok || skipped ? h("span", { class: "sr-only", text: ok ? t("wz.rail.done") : t("wz.rail.skipped") }) : null,
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
  w.seen.add(step);
  if (step !== "welcome" && w.mascot) {
    // Off screen: no frame loop for a canvas nobody sees.
    w.mascot.destroy();
    w.mascot = null;
    w.mascotHost = null;
  }
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
    w.step > 0
      ? button(t("wz.back"), { kind: "ghost", icon: "left", fk: "wz:back", onClick: () => goStep(w.step - 1) })
      : null,
    last
      ? button(t("wz.done.rules"), { kind: "ghost", icon: "kurallar", fk: "wz:rules", onClick: () => close("kurallar") })
      : null,
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
      button("", {
        kind: "subtle",
        small: true,
        icon: "close",
        title: t("wz.closeTitle"),
        fk: "wz:close",
        onClick: () => close(null),
      }),
    ),
    h("div", { class: "wz-body" }, body),
    foot,
  );

  const scroll = w.panel.querySelector(".wz-body")?.scrollTop ?? 0;
  const sameStep = w.painted === w.step;
  // A repaint of the same step (language, health result) keeps the focus where it was.
  const focused = document.activeElement as HTMLElement | null;
  const fk = sameStep && focused && w.panel.contains(focused) ? focused.getAttribute("data-fk") : null;
  w.panel.setAttribute("aria-label", t("wz.aria"));
  w.panel.replaceChildren(rail(), main);
  w.painted = w.step;
  const newBody = w.panel.querySelector<HTMLElement>(".wz-body");
  if (sameStep && newBody) newBody.scrollTop = scroll;
  if (fk) w.panel.querySelector<HTMLElement>(`[data-fk="${CSS.escape(fk)}"]`)?.focus({ preventScroll: true });
  else if (!sameStep)
    window.setTimeout(() => w.panel?.querySelector<HTMLElement>(".wz-title")?.focus({ preventScroll: true }), 0);
}
