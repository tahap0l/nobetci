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

const layers: { close: () => void }[] = [];

export function pushLayer(close: () => void): () => void {
  const layer = { close };
  layers.push(layer);
  return () => {
    const i = layers.indexOf(layer);
    if (i >= 0) layers.splice(i, 1);
  };
}

/** Closes the topmost layer; false when there is none. */
export function closeTopLayer(): boolean {
  const top = layers[layers.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

export function hasLayers(): boolean {
  return layers.length > 0;
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

export function fmtDuration(ms: number): string {
  if (ms < 1000) return t("unit.ms", { n: Math.round(ms) });
  const s = ms / 1000;
  if (s < 60) return t("unit.sec", { n: fmtNum(s, s < 10 ? 1 : 0) });
  return t("unit.minSec", { m: Math.floor(s / 60), s: Math.round(s % 60) });
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
      onChange(v);
    });
    buttons.push(b);
    wrap.append(b);
  }
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
  const wrap = h(
    "div",
    { class: "slider" },
    h("div", { class: "slider-track" }, input, out),
    o.ends
      ? h("div", { class: "slider-ends" }, h("span", { text: o.format(o.min) }), h("span", { text: o.format(o.max) }))
      : null,
  );
  return Object.assign(wrap, {
    setMin: (m: number) => {
      input.min = String(m);
      if (Number(input.value) < m) input.value = String(m);
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
  return part === "Super" ? "Win" : part;
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
}): HTMLElement {
  const wrap = h("div", { class: "confirm" });
  const idle = () => {
    wrap.classList.remove("asking");
    wrap.replaceChildren(button(o.label, { kind: o.kind ?? "ghost", icon: o.icon, onClick: ask }));
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
    const no = button(t("common.cancel"), { kind: "subtle", onClick: idle });
    wrap.replaceChildren(h("span", { class: "confirm-q" }, icon("warn", 15), o.question), yes, no);
    no.focus();
  };
  idle();
  return wrap;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export interface ModalHandle {
  close: () => void;
  root: HTMLElement;
  body: HTMLElement;
  foot: HTMLElement;
}

export function modal(o: {
  title: string;
  subtitle?: string;
  body: Child[];
  foot?: Child[];
  wide?: boolean;
  onClose?: () => void;
  cls?: string;
}): ModalHandle {
  const prevFocus = document.activeElement as HTMLElement | null;
  const body = h("div", { class: "modal-body" }, ...o.body);
  const foot = h("div", { class: "modal-foot" }, ...(o.foot ?? []));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    pop();
    overlay.classList.add("leaving");
    window.setTimeout(() => overlay.remove(), 120);
    o.onClose?.();
    prevFocus?.focus?.();
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
      iconButton("close", t("common.closeEsc"), () => close(), { cls: "modal-x" }),
    ),
    body,
    o.foot && o.foot.length ? foot : null,
  );
  const overlay = h("div", { class: "overlay" }, dialog);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  const pop = pushLayer(close);
  document.body.append(overlay);
  window.setTimeout(() => {
    const first =
      dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.querySelector<HTMLElement>(".modal-x");
    first?.focus();
  }, 0);
  return { close, root: dialog, body, foot };
}

// ── Popover menu ──────────────────────────────────────────────────────────────

export interface MenuItem {
  label: string;
  hint?: string;
  icon?: IconName;
  onClick: () => void;
}

export function openMenu(anchor: HTMLElement, items: MenuItem[], title?: string): void {
  const menu = h("div", { class: "menu", role: "menu" }, title ? h("div", { class: "menu-title", text: title }) : null);
  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    pop();
    menu.remove();
    document.removeEventListener("mousedown", outside, true);
    anchor.setAttribute("aria-expanded", "false");
  };
  const outside = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) close();
  };
  for (const it of items) {
    const b = h(
      "button",
      { type: "button", class: "menu-item", role: "menuitem" },
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
    menu.append(b);
  }
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
  const pop = pushLayer(close);
  window.setTimeout(() => document.addEventListener("mousedown", outside, true), 0);
  menu.querySelector<HTMLElement>(".menu-item")?.focus();
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
