// Building blocks for the settings window. Everything is plain DOM through
// `h()`; text that may come from a request (history, rule patterns) is only
// ever a text node.

import type { RiskLevel } from "../core/bridge";
import { getPlatform, locale } from "../i18n/core";
import { h } from "../ui/dom";
import { t } from "./i18n";
import { icon, type IconName } from "./icons";

type Child = Node | string | null | undefined | false;

// ── Esc layers (modals, menus, drawers), topmost last ─────────────────────────

const layers: { close: () => void; alive?: () => boolean }[] = [];

/**
 * Registers something Esc closes, topmost last. `alive` tells whether it is
 * still on the page: a layer whose element a redraw replaced is dropped instead
 * of swallowing an Esc.
 */
export function pushLayer(close: () => void, alive?: () => boolean): () => void {
  const layer = { close, alive };
  layers.push(layer);
  return () => {
    const i = layers.indexOf(layer);
    if (i >= 0) layers.splice(i, 1);
  };
}

/** Closes the topmost layer; false when there is none. */
export function closeTopLayer(): boolean {
  for (let i = layers.length - 1; i >= 0; i--) if (layers[i].alive && !layers[i].alive!()) layers.splice(i, 1);
  const top = layers[layers.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

export function hasLayers(): boolean {
  return layers.length > 0;
}

// ── Overlays hold the keyboard ────────────────────────────────────────────────
// A modal, a drawer or the wizard takes the keyboard: everything behind it is
// made inert (no focus, no clicks) and Tab cycles inside it, so nothing under a
// dialog can change while the dialog is up (a reviewed diff stays the diff that
// gets written). Overlays are children of <body> appended in opening order: the
// last one that is not fading out is on top, and what comes before it in <body>
// is behind it. Closing one gives the focus back to whatever opened it.
//
// modal() and the wizard register themselves; overlays built elsewhere (the
// history drawer) are picked up by a MutationObserver from their class names.

const OVERLAY_SELECTOR = ".overlay, .drawer-overlay, .wz-overlay";

interface Trap {
  el: HTMLElement;
  opener: HTMLElement | null;
  openerFk: string | null;
}

const traps: Trap[] = [];
/** Recently focused elements, newest last: where an overlay was opened from. */
const recentFocus: HTMLElement[] = [];

function syncInert() {
  const top = traps[traps.length - 1];
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const behind = !!top && child !== top.el && !!(child.compareDocumentPosition(top.el) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (behind) {
      if (!child.hasAttribute("inert")) {
        child.setAttribute("inert", "");
        child.dataset.trapInert = "1";
      }
    } else if (child.dataset.trapInert) {
      child.removeAttribute("inert");
      delete child.dataset.trapInert;
    }
  }
}

/** What Tab can reach inside `root`, in order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  const all = root.querySelectorAll<HTMLElement>(
    'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex], [contenteditable="true"]',
  );
  return Array.from(all).filter(
    (el) =>
      el.tabIndex >= 0 &&
      !(el as HTMLButtonElement).disabled &&
      !el.closest("[inert], [hidden]") &&
      el.getClientRects().length > 0,
  );
}

function pickOpener(el: HTMLElement): HTMLElement | null {
  for (let i = recentFocus.length - 1; i >= 0; i--) {
    const c = recentFocus[i];
    if (c.isConnected && !el.contains(c) && !c.closest(".leaving")) return c;
  }
  return null;
}

/** Makes `el` (already in <body>) hold the keyboard until the returned function runs. */
export function holdKeyboard(el: HTMLElement): () => void {
  if (!traps.some((t) => t.el === el)) {
    const opener = pickOpener(el);
    traps.push({ el, opener, openerFk: opener?.getAttribute("data-fk") ?? null });
    syncInert();
  }
  return () => releaseKeyboard(el);
}

function releaseKeyboard(el: HTMLElement) {
  const i = traps.findIndex((t) => t.el === el);
  if (i < 0) return;
  const [trap] = traps.splice(i, 1);
  syncInert();
  const active = document.activeElement;
  if (active && active !== document.body && !el.contains(active)) return;
  // The focus was inside the overlay that closed: hand it back to its opener
  // (found again by data-fk when a re-render replaced it), else into the overlay
  // that is now on top.
  let target: HTMLElement | null = trap.opener?.isConnected ? trap.opener : null;
  if (!target && trap.openerFk) target = document.querySelector<HTMLElement>(`[data-fk="${CSS.escape(trap.openerFk)}"]`);
  if (target && !target.closest("[inert]")) {
    target.focus({ preventScroll: true });
    if (document.activeElement === target) return;
  }
  const top = traps[traps.length - 1];
  if (top) focusables(top.el)[0]?.focus({ preventScroll: true });
}

let trapsInstalled = false;

/** Once, at start: Tab cycling, focus history, and overlays made elsewhere. */
export function installKeyboardTraps() {
  if (trapsInstalled) return;
  trapsInstalled = true;
  document.addEventListener(
    "focusin",
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      const i = recentFocus.indexOf(el);
      if (i >= 0) recentFocus.splice(i, 1);
      recentFocus.push(el);
      if (recentFocus.length > 16) recentFocus.shift();
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Tab" || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const top = traps[traps.length - 1];
      if (!top) return;
      const list = focusables(top.el);
      if (!list.length) {
        e.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (!active || !top.el.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    true,
  );
  const watchLeaving = (el: HTMLElement) => {
    const mo = new MutationObserver(() => {
      if (el.classList.contains("leaving")) {
        mo.disconnect();
        releaseKeyboard(el);
      }
    });
    mo.observe(el, { attributes: true, attributeFilter: ["class"] });
  };
  new MutationObserver((records) => {
    for (const r of records) {
      for (const n of Array.from(r.addedNodes)) {
        if (n instanceof HTMLElement && n.matches(OVERLAY_SELECTOR) && !traps.some((t) => t.el === n)) {
          holdKeyboard(n);
          watchLeaving(n);
        }
      }
      for (const n of Array.from(r.removedNodes)) {
        if (n instanceof HTMLElement && traps.some((t) => t.el === n)) releaseKeyboard(n);
      }
    }
  }).observe(document.body, { childList: true });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let t: number | null = null;
  return (...args: A) => {
    if (t != null) window.clearTimeout(t);
    t = window.setTimeout(() => {
      t = null;
      fn(...args);
    }, ms);
  };
}

// Numbers, percentages and durations follow the UI language (Intl + locale()).

export function fmtNum(n: number, digits = 0): string {
  return new Intl.NumberFormat(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

/** "%51" in Turkish, "51%" in English; one decimal under 10 %. */
export function fmtPct(part: number, total: number): string {
  const p = total ? part / total : 0;
  const digits = p > 0 && p < 0.1 ? 1 : 0;
  return new Intl.NumberFormat(locale(), { style: "percent", maximumFractionDigits: digits }).format(p);
}

/** Seconds with one decimal: "1,2 sn" / "1.2 s". */
export function fmtSec(sec: number): string {
  return t("unit.sec", { n: fmtNum(sec, 1) });
}

/**
 * "850 ms", "1.2 s", "42 s", "1 min 5 s". Rounded once, at the precision shown,
 * so no value ever reads "1000 ms", "60 s" or "1 min 60 s".
 */
export function fmtDuration(ms: number): string {
  const whole = Math.round(ms);
  if (whole < 1000) return t("unit.ms", { n: Math.max(0, whole) });
  const tenths = Math.round(ms / 100);
  if (tenths < 100) return t("unit.sec", { n: fmtNum(tenths / 10, 1) });
  const total = Math.round(ms / 1000);
  if (total < 60) return t("unit.sec", { n: fmtNum(total) });
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s ? t("unit.minSec", { m, s }) : t("unit.min", { n: m });
}

export function fmtMinutes(min: number): string {
  if (min < 60) return t("unit.min", { n: min });
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  return mm ? t("unit.hourMin", { h: hh, m: mm }) : t("unit.hour", { n: hh });
}

export function levelLabel(level: RiskLevel): string {
  return t(`lvl.${level}`);
}

// ── Layout ────────────────────────────────────────────────────────────────────

export interface CardOpts {
  title?: string;
  desc?: Child;
  icon?: IconName;
  actions?: Child[];
  cls?: string;
}

export function card(opts: CardOpts, ...children: Child[]): HTMLElement {
  const head =
    opts.title || opts.actions
      ? h(
          "div",
          { class: "card-head" },
          h(
            "div",
            { class: "card-title-wrap" },
            opts.title ? h("h2", { class: "card-title" }, opts.icon ? icon(opts.icon, 17) : null, opts.title) : null,
            opts.desc ? h("p", { class: "card-desc" }, opts.desc) : null,
          ),
          opts.actions ? h("div", { class: "card-actions" }, ...opts.actions) : null,
        )
      : null;
  return h("section", { class: `card${opts.cls ? ` ${opts.cls}` : ""}` }, head, ...children);
}

export function row(label: Child, hint: Child, control: Child, cls = ""): HTMLElement {
  return h(
    "div",
    { class: `row${cls ? ` ${cls}` : ""}` },
    h(
      "div",
      { class: "row-text" },
      h("div", { class: "row-label" }, label),
      hint ? h("div", { class: "row-hint" }, hint) : null,
    ),
    control ? h("div", { class: "row-ctl" }, control) : null,
  );
}

export function field(label: string, control: Node, hint?: Child, cls = ""): HTMLElement {
  return h(
    "label",
    { class: `field${cls ? ` ${cls}` : ""}` },
    h("span", { class: "field-label", text: label }),
    control,
    hint ? h("span", { class: "field-hint" }, hint) : null,
  );
}

export function notice(kind: "info" | "warn" | "error" | "ok", ...children: Child[]): HTMLElement {
  const ic: IconName = kind === "ok" ? "check" : kind === "info" ? "hakkinda" : "warn";
  return h(
    "div",
    { class: `notice notice-${kind}`, role: kind === "error" ? "alert" : "note" },
    icon(ic, 16),
    h("div", { class: "notice-body" }, ...children),
  );
}

// ── Controls ──────────────────────────────────────────────────────────────────

export interface BtnOpts {
  kind?: "primary" | "ghost" | "danger" | "subtle" | "plain";
  icon?: IconName;
  small?: boolean;
  title?: string;
  disabled?: boolean;
  fk?: string;
  onClick?: (ev: MouseEvent) => void;
}

export function button(text: string, opts: BtnOpts = {}): HTMLButtonElement {
  const b = h(
    "button",
    {
      type: "button",
      class: `btn btn-${opts.kind ?? "plain"}${opts.small ? " btn-sm" : ""}`,
      title: opts.title,
      disabled: opts.disabled,
      "data-fk": opts.fk,
    },
    opts.icon ? icon(opts.icon, opts.small ? 15 : 16) : null,
    text ? h("span", { text }) : null,
  );
  if (opts.onClick) b.addEventListener("click", opts.onClick);
  return b;
}

export function iconButton(
  name: IconName,
  title: string,
  onClick: (ev: MouseEvent) => void,
  opts: { disabled?: boolean; fk?: string; cls?: string } = {},
): HTMLButtonElement {
  const b = h(
    "button",
    {
      type: "button",
      class: `icon-btn${opts.cls ? ` ${opts.cls}` : ""}`,
      title,
      "aria-label": title,
      disabled: opts.disabled,
      "data-fk": opts.fk,
    },
    icon(name, 16),
  );
  b.addEventListener("click", onClick);
  return b;
}

export function toggle(
  value: boolean,
  onChange: (v: boolean) => void,
  opts: { label?: string; fk?: string; disabled?: boolean } = {},
): HTMLButtonElement {
  const el = h("button", {
    type: "button",
    class: `switch${value ? " on" : ""}`,
    role: "switch",
    "aria-checked": String(value),
    "aria-label": opts.label,
    disabled: opts.disabled,
    "data-fk": opts.fk,
  });
  el.append(h("span", { class: "switch-knob" }));
  el.addEventListener("click", () => {
    const next = !el.classList.contains("on");
    el.classList.toggle("on", next);
    el.setAttribute("aria-checked", String(next));
    onChange(next);
  });
  return el;
}

/**
 * A radio group drawn as one pill. Like any radio group it is a single Tab stop
 * (the chosen option); the arrow keys, Home and End move and choose.
 */
export function segmented<T extends string>(
  options: readonly (readonly [T, string])[],
  value: T,
  onChange: (v: T) => void,
  opts: { fk?: string; label?: string; cls?: string } = {},
): HTMLElement {
  const wrap = h("div", {
    class: `seg${opts.cls ? ` ${opts.cls}` : ""}`,
    role: "radiogroup",
    "aria-label": opts.label,
  });
  const buttons: HTMLButtonElement[] = [];
  const stops = () => {
    const chosen = buttons.findIndex((b) => b.classList.contains("on"));
    buttons.forEach((b, i) => (b.tabIndex = i === (chosen < 0 ? 0 : chosen) ? 0 : -1));
  };
  for (const [v, label] of options) {
    const b = h("button", {
      type: "button",
      class: `seg-btn${v === value ? " on" : ""}`,
      role: "radio",
      "aria-checked": String(v === value),
      "data-fk": opts.fk ? `${opts.fk}:${v}` : undefined,
      text: label,
    });
    b.addEventListener("click", () => {
      for (const o of buttons) {
        const on = o === b;
        o.classList.toggle("on", on);
        o.setAttribute("aria-checked", String(on));
      }
      stops();
      onChange(v);
    });
    buttons.push(b);
    wrap.append(b);
  }
  stops();
  wrap.addEventListener("keydown", (e) => {
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const n = buttons.length;
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
    buttons[j].focus();
    buttons[j].click();
  });
  return wrap;
}

export interface SliderOpts {
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  fk?: string;
  label?: string;
  /** Show min/max under the track. */
  ends?: boolean;
}

export function slider(o: SliderOpts): HTMLElement & { setMin: (m: number) => void; setValue: (v: number) => void } {
  const out = h("output", { class: "slider-value", text: o.format(o.value) });
  const input = h("input", {
    type: "range",
    min: o.min,
    max: o.max,
    step: o.step,
    value: o.value,
    "aria-label": o.label,
    "data-fk": o.fk,
  });
  const paint = () => {
    const min = Number(input.min);
    const max = Number(input.max);
    const p = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 0;
    input.style.setProperty("--p", `${p}%`);
    out.textContent = o.format(Number(input.value));
  };
  input.addEventListener("input", () => {
    paint();
    o.onChange(Number(input.value));
  });
  paint();
  const minEnd = h("span", { text: o.format(o.min) });
  const wrap = h(
    "div",
    { class: "slider" },
    h("div", { class: "slider-track" }, input, out),
    o.ends ? h("div", { class: "slider-ends" }, minEnd, h("span", { text: o.format(o.max) })) : null,
  );
  return Object.assign(wrap, {
    /** A new lower bound; the end label under the track follows it. */
    setMin: (m: number) => {
      input.min = String(m);
      if (Number(input.value) < m) input.value = String(m);
      minEnd.textContent = o.format(m);
      paint();
    },
    setValue: (v: number) => {
      input.value = String(v);
      paint();
    },
  });
}

export function textInput(o: {
  value: string;
  placeholder?: string;
  mono?: boolean;
  fk?: string;
  type?: string;
  label?: string;
  cls?: string;
  onInput?: (v: string, el: HTMLInputElement) => void;
  onChange?: (v: string, el: HTMLInputElement) => void;
  onEnter?: (v: string, el: HTMLInputElement) => void;
}): HTMLInputElement {
  const el = h("input", {
    type: o.type ?? "text",
    class: `input${o.mono ? " mono" : ""}${o.cls ? ` ${o.cls}` : ""}`,
    placeholder: o.placeholder,
    spellcheck: "false",
    autocomplete: "off",
    "aria-label": o.label,
    "data-fk": o.fk,
  });
  el.value = o.value;
  if (o.onInput) el.addEventListener("input", () => o.onInput!(el.value, el));
  if (o.onChange) el.addEventListener("change", () => o.onChange!(el.value, el));
  if (o.onEnter)
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        o.onEnter!(el.value, el);
      }
    });
  return el;
}

export function select<T extends string>(
  options: readonly (readonly [T, string])[],
  value: T,
  onChange: (v: T) => void,
  opts: { fk?: string; label?: string; cls?: string } = {},
): HTMLSelectElement {
  const el = h("select", {
    class: `select${opts.cls ? ` ${opts.cls}` : ""}`,
    "aria-label": opts.label,
    "data-fk": opts.fk,
  });
  for (const [v, label] of options) el.append(h("option", { value: v, text: label }));
  el.value = value;
  el.addEventListener("change", () => onChange(el.value as T));
  return el;
}

export function checkbox(
  checked: boolean,
  label: Child,
  onChange: (v: boolean) => void,
  opts: { desc?: Child; fk?: string; tag?: Child; disabled?: boolean } = {},
): HTMLElement {
  const input = h("input", { type: "checkbox", "data-fk": opts.fk, disabled: opts.disabled });
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  return h(
    "label",
    { class: `check${opts.disabled ? " disabled" : ""}` },
    input,
    h("span", { class: "check-box" }, icon("check", 13)),
    h(
      "span",
      { class: "check-text" },
      h("span", { class: "check-label" }, label, opts.tag ?? null),
      opts.desc ? h("span", { class: "check-desc" }, opts.desc) : null,
    ),
  );
}

export function levelChip(level: RiskLevel, small = false): HTMLElement {
  return h(
    "span",
    { class: `chip lvl-${level}${small ? " chip-sm" : ""}` },
    h("span", { class: "chip-dot" }),
    levelLabel(level),
  );
}

export function pill(kind: "ok" | "warn" | "bad" | "muted", text: string, ic?: IconName): HTMLElement {
  return h("span", { class: `pill pill-${kind}` }, ic ? icon(ic, 14) : h("span", { class: "pill-dot" }), text);
}

/** What a modifier is called on this keyboard: Super is Win on a PC, ⌘ on a Mac. */
function keyName(part: string): string {
  if (getPlatform() === "macos") {
    const mac: Record<string, string> = { Ctrl: "⌃ Control", Alt: "⌥ Option", Shift: "⇧ Shift", Super: "⌘ Command" };
    return mac[part] ?? part;
  }
  if (part === "Super") return getPlatform() === "linux" ? "Super" : "Win";
  return part;
}

export function kbd(accel: string): HTMLElement {
  const wrap = h("span", { class: "kbd-combo" });
  const parts = accel.split("+").filter(Boolean);
  parts.forEach((p, i) => {
    if (i) wrap.append(h("span", { class: "kbd-plus", text: "+" }));
    wrap.append(h("kbd", { text: keyName(p) }));
  });
  return wrap;
}

// ── Inline confirm (no window.confirm) ────────────────────────────────────────

export function inlineConfirm(o: {
  label: string;
  icon?: IconName;
  kind?: BtnOpts["kind"];
  question: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
  /** Nothing to do (e.g. the history is already empty). */
  disabled?: boolean;
}): HTMLElement {
  const wrap = h("div", { class: "confirm" });
  /** While asking, Esc cancels the question (not the whole window). */
  let pop: (() => void) | null = null;
  const idle = (refocus = false) => {
    pop?.();
    pop = null;
    wrap.classList.remove("asking");
    const trigger = button(o.label, { kind: o.kind ?? "ghost", icon: o.icon, disabled: o.disabled, onClick: ask });
    wrap.replaceChildren(trigger);
    if (refocus && wrap.isConnected) trigger.focus();
  };
  const ask = () => {
    wrap.classList.add("asking");
    const yes = button(o.confirmLabel, {
      kind: "danger",
      onClick: async () => {
        yes.disabled = true;
        try {
          await o.onConfirm();
        } finally {
          idle();
        }
      },
    });
    const no = button(t("common.cancel"), { kind: "subtle", onClick: () => idle(true) });
    wrap.replaceChildren(h("span", { class: "confirm-q" }, icon("warn", 15), o.question), yes, no);
    pop = pushLayer(
      () => idle(true),
      () => wrap.isConnected,
    );
    no.focus();
  };
  idle();
  return wrap;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export interface ModalHandle {
  /** Closes at once (Save, an explicit Cancel). */
  close: () => void;
  /** Closes like Esc does: asks first when there are unsaved edits. */
  requestClose: () => void;
  root: HTMLElement;
  body: HTMLElement;
  foot: HTMLElement;
}

export function modal(o: {
  title: string;
  subtitle?: string;
  body: Child[];
  foot?: Child[];
  /** Shown between the scrolling body and the footer, so it is always in view (errors). */
  status?: HTMLElement;
  wide?: boolean;
  onClose?: () => void;
  cls?: string;
  /**
   * Unsaved edits: Esc, ✕ and a click beside the dialog ask before throwing
   * them away instead of closing straight off.
   */
  isDirty?: () => boolean;
}): ModalHandle {
  const body = h("div", { class: "modal-body" }, ...o.body);
  const foot = h("div", { class: "modal-foot" }, ...(o.foot ?? []));
  let closed = false;
  /** The footer's own content while it asks about unsaved edits. */
  let footBefore: Node[] | null = null;
  let popAsk: (() => void) | null = null;
  let focusBefore: HTMLElement | null = null;
  const close = () => {
    if (closed) return;
    closed = true;
    popAsk?.();
    pop();
    overlay.classList.add("leaving");
    window.setTimeout(() => overlay.remove(), 120);
    o.onClose?.();
    // Gives the page back and the focus to whatever opened the dialog.
    release();
  };
  const keepEditing = () => {
    popAsk?.();
    popAsk = null;
    if (!footBefore) return;
    foot.replaceChildren(...footBefore);
    footBefore = null;
    if (!foot.childElementCount) foot.remove();
    (focusBefore?.isConnected ? focusBefore : focusables(dialog)[0])?.focus();
  };
  const requestClose = () => {
    if (closed) return;
    if (!o.isDirty?.()) return close();
    if (footBefore) {
      foot.querySelector<HTMLElement>("[data-keep]")?.focus();
      return;
    }
    const active = document.activeElement;
    focusBefore = active instanceof HTMLElement && dialog.contains(active) ? active : null;
    footBefore = Array.from(foot.childNodes);
    const keep = button(t("common.keepEditing"), { kind: "subtle", onClick: keepEditing });
    keep.setAttribute("data-keep", "");
    foot.replaceChildren(
      h("span", { class: "confirm-q", role: "alert" }, icon("warn", 15), t("common.discardQ")),
      h("span", { class: "spacer" }),
      keep,
      button(t("common.discard"), { kind: "danger", onClick: close }),
    );
    if (!foot.isConnected) dialog.append(foot);
    // Esc now answers "keep editing"; Discard is a deliberate click.
    popAsk = pushLayer(keepEditing);
    keep.focus();
  };
  const dialog = h(
    "div",
    {
      class: `modal${o.wide ? " modal-wide" : ""}${o.cls ? ` ${o.cls}` : ""}`,
      role: "dialog",
      "aria-modal": "true",
      "aria-label": o.title,
    },
    h(
      "div",
      { class: "modal-head" },
      h(
        "div",
        {},
        h("h2", { class: "modal-title", text: o.title }),
        o.subtitle ? h("p", { class: "modal-sub", text: o.subtitle }) : null,
      ),
      iconButton("close", t("common.closeEsc"), () => requestClose(), { cls: "modal-x" }),
    ),
    body,
    o.status ?? null,
    o.foot && o.foot.length ? foot : null,
  );
  o.status?.classList.add("modal-status");
  const overlay = h("div", { class: "overlay" }, dialog);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target !== overlay) return;
    // Keep the press from moving the focus to <body>: it goes back to the opener.
    e.preventDefault();
    requestClose();
  });
  const pop = pushLayer(requestClose);
  document.body.append(overlay);
  const release = holdKeyboard(overlay);
  window.setTimeout(() => {
    const first =
      dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.querySelector<HTMLElement>(".modal-x");
    first?.focus();
  }, 0);
  return { close, requestClose, root: dialog, body, foot };
}

// ── Popover menu ──────────────────────────────────────────────────────────────

export interface MenuItem {
  label: string;
  hint?: string;
  icon?: IconName;
  onClick: () => void;
}

/** Open menus by the button that opened them: a second press closes, never stacks a copy. */
const openMenus = new Map<HTMLElement, () => void>();

/**
 * A popover menu under `anchor`. Its button toggles it; the arrow keys, Home
 * and End move between items; Tab, Esc or a press elsewhere closes it (that
 * press does nothing else), and the focus goes back to the button.
 */
export function openMenu(anchor: HTMLElement, items: MenuItem[], title?: string): void {
  const already = openMenus.get(anchor);
  if (already) {
    already();
    return;
  }
  const menu = h("div", { class: "menu", role: "menu" }, title ? h("div", { class: "menu-title", text: title }) : null);
  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    const hadFocus = menu.contains(document.activeElement);
    pop();
    menu.remove();
    document.removeEventListener("mousedown", outside, true);
    anchor.setAttribute("aria-expanded", "false");
    openMenus.delete(anchor);
    if (hadFocus && anchor.isConnected) anchor.focus({ preventScroll: true });
  };
  const swallow = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  const outside = (e: MouseEvent) => {
    if (menu.contains(e.target as Node) || anchor.contains(e.target as Node)) return;
    close();
    // The press that dismissed the menu stops there: it would otherwise also
    // click whatever lies under it (a rule row opening its editor).
    document.addEventListener("click", swallow, true);
    document.addEventListener(
      "mouseup",
      () => window.setTimeout(() => document.removeEventListener("click", swallow, true), 0),
      { capture: true, once: true },
    );
  };
  const buttons: HTMLButtonElement[] = [];
  for (const it of items) {
    const b = h(
      "button",
      { type: "button", class: "menu-item", role: "menuitem", tabindex: "-1" },
      it.icon ? icon(it.icon, 16) : null,
      h(
        "span",
        { class: "menu-text" },
        h("span", { class: "menu-label", text: it.label }),
        it.hint ? h("span", { class: "menu-hint", text: it.hint }) : null,
      ),
    );
    b.addEventListener("click", () => {
      close();
      it.onClick();
    });
    buttons.push(b);
    menu.append(b);
  }
  menu.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      // Leaves with the focus on the button, so Tab carries on from there.
      close();
      return;
    }
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const n = buttons.length;
    const j =
      e.key === "ArrowDown"
        ? (i + 1) % n
        : e.key === "ArrowUp"
          ? (i - 1 + n) % n
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : -1;
    if (j < 0 || !n) return;
    e.preventDefault();
    buttons[j].focus();
  });
  menu.addEventListener("focusout", (e) => {
    const next = e.relatedTarget as Node | null;
    if (next && (menu.contains(next) || anchor.contains(next))) return;
    // Focus went elsewhere (a shortcut, another window): the menu goes too.
    window.setTimeout(() => {
      if (!menu.contains(document.activeElement)) close();
    }, 0);
  });
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = Math.min(r.left, window.innerWidth - mw - 12);
  left = Math.max(12, left);
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 12) top = Math.max(12, r.top - mh - 6);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  anchor.setAttribute("aria-expanded", "true");
  const pop = pushLayer(close, () => menu.isConnected);
  openMenus.set(anchor, close);
  window.setTimeout(() => document.addEventListener("mousedown", outside, true), 0);
  buttons[0]?.focus();
}

// ── Tooltip (one for the whole window) ───────────────────────────────────────

let tipEl: HTMLElement | null = null;

export function showTip(x: number, y: number, ...content: Child[]) {
  if (!tipEl) {
    tipEl = h("div", { class: "tip", role: "tooltip" });
    document.body.append(tipEl);
  }
  tipEl.replaceChildren(...content.filter((c): c is Node | string => !!c));
  tipEl.style.display = "block";
  const w = tipEl.offsetWidth;
  const hh = tipEl.offsetHeight;
  let left = x + 14;
  if (left + w > window.innerWidth - 8) left = x - w - 14;
  let top = y - hh - 12;
  if (top < 8) top = y + 16;
  tipEl.style.left = `${Math.max(8, left)}px`;
  tipEl.style.top = `${top}px`;
}

export function hideTip() {
  if (tipEl) tipEl.style.display = "none";
}

/** Short-lived message at the bottom of the window. */
export function toast(text: string, kind: "ok" | "error" | "info" = "ok") {
  const el = h(
    "div",
    { class: `toast toast-${kind}`, role: "status" },
    icon(kind === "error" ? "warn" : kind === "ok" ? "check" : "hakkinda", 15),
    h("span", { text }),
  );
  document.body.append(el);
  window.setTimeout(() => el.classList.add("leaving"), 3200);
  window.setTimeout(() => el.remove(), 3600);
}
