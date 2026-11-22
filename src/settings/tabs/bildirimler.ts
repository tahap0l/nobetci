// Bildirimler: sounds (with previews), Windows notifications, do-not-disturb and
// quiet hours, and global shortcuts recorded from the keyboard.

import type { HotkeyStatus } from "../../core/bridge";
import type { Hotkeys } from "../../core/settings-model";
import { Sound, type SoundName } from "../../core/sound";
import { getPlatform, locale, type Platform } from "../../i18n/core";
import { h } from "../../ui/dom";
import { api } from "../api";
import { t, type MsgKey } from "../i18n";
import { icon } from "../icons";
import { app, rerender, type Tab } from "../nav";
import { onSaved, settings, update } from "../store";
import { button, card, checkbox, fmtMinutes, fmtPct, kbd, notice, row, select, slider, toggle } from "../ui";

const SOUNDS: SoundName[] = ["approval", "danger", "finish", "error", "hoot", "allow", "deny", "peek", "open", "close"];

const TOAST_EVENTS = ["approval", "finished", "error", "waiting"] as const;

const HOTKEYS: (keyof Hotkeys)[] = ["toggle", "assistant", "deny", "allow", "dnd"];

// ── Hotkey status after saves ─────────────────────────────────────────────────

let statuses: HotkeyStatus[] | null = null;
let hotkeysDirty = false;
/** Key of the last test-notification result, so it follows a language switch. */
let testResult: MsgKey | null = null;

async function loadStatuses() {
  statuses = await api.hotkeysStatus();
  rerender("bildirimler");
}

onSaved(() => {
  if (!hotkeysDirty) return;
  hotkeysDirty = false;
  window.setTimeout(() => void loadStatuses(), 300);
});

// ── Recorder ──────────────────────────────────────────────────────────────────
//
// What is recorded has to be what Rust registers. hotkeys.rs hands the
// accelerator ("Ctrl+Alt+Z") to global-hotkey 0.8, which turns the key into a
// `Code` and registers it per OS:
// - Windows: RegisterHotKey with a virtual key (Code::KeyZ → VK_Z). Letter VKs
//   follow the active layout's labels: on German QWERTZ, VK_Z is the key
//   labelled Z, where a US keyboard has Y.
// - Linux (X11): a grab on the first key whose keysyms include the letter
//   (Code::KeyZ → XK_Z): again the key labelled Z.
// - macOS: the physical key code (Code::KeyZ → kVK_ANSI_Z), the key in the US
//   Z position whatever is printed on it.
// So on Windows and Linux a letter is recorded by its label in the current
// layout (the key pressed is the key shown is the key that fires), and on macOS
// by its position (KeyboardEvent.code). Digits, F-keys, arrows and the numpad
// are positional everywhere (VK_1…, the top row's keysyms…), and so is a key
// whose label is no Latin letter (Cyrillic, ö, ü…): those layouts keep the US
// letter names in place. Turkish layouts are the one twist: the key that types
// "ı" is the OS's I (its capital is I), and the key that types "i" (capital İ)
// has no letter name at all.

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "OS", "AltGraph", "Hyper", "Super"]);

type LayoutMap = ReadonlyMap<string, string>;

/**
 * The active layout's unshifted character for each physical key, where the
 * webview can tell (Chromium's Keyboard Map API: WebView2 on Windows). Without
 * it the typed character stands in, which Shift and AltGr may have changed.
 */
let layoutMap: LayoutMap | null = null;

async function loadLayoutMap(): Promise<void> {
  const kb = (navigator as Navigator & { keyboard?: { getLayoutMap?: () => Promise<Iterable<[string, string]>> } })
    .keyboard;
  if (!kb?.getLayoutMap) return;
  try {
    layoutMap = new Map(await kb.getLayoutMap());
  } catch {
    layoutMap = null;
  }
}

/** Punctuation whose key global-hotkey finds by label on Windows (VK_OEM_COMMA…) and X11 (keysyms). */
const LABELLED_PUNCT: Record<string, string> = { ",": "Comma", ".": "Period", "-": "Minus" };

function hasLabel(map: LayoutMap, ch: string): boolean {
  for (const v of map.values()) if (v.toLowerCase() === ch) return true;
  return false;
}

/** A Turkish layout: it has a dotless ı (or, with no layout map, an "i" where only Turkish Q and F put one). */
function turkishLayout(map: LayoutMap | null, code: string): boolean {
  return map ? hasLabel(map, "ı") : code === "Quote" || code === "KeyS";
}

/**
 * The key name to record for a press of `code` that typed `key`, as Rust will
 * register it on `platform` (see above); null when no registered key would be
 * the one pressed.
 */
export function recordedKey(code: string, key: string, platform: Platform, map: LayoutMap | null): string | null {
  const positional = keyFromCode(code);
  if (platform === "macos") return positional;
  const label = (map?.get(code) ?? (key.length === 1 ? key : "")).toLowerCase();
  if (label === "ı") return "I";
  if (/^[a-z]$/.test(label)) {
    // The "i" of a Turkish layout is not the OS's I: keep it where it is, unless
    // that position is another letter's name (Turkish F), which would fire elsewhere.
    if (label === "i" && code !== "KeyI" && turkishLayout(map, code))
      return /^Key[A-Z]$/.test(code) ? null : positional;
    return label.toUpperCase();
  }
  if (LABELLED_PUNCT[label]) return LABELLED_PUNCT[label];
  // A letter position whose letter this layout types on another key (Turkish F's
  // ğ where US has E): registering the position's letter would pick that key.
  if (map && positional && /^Key[A-Z]$/.test(code) && hasLabel(map, positional.toLowerCase())) return null;
  return positional;
}

function keyFromCode(code: string): string | null {
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1];
  m = /^Digit(\d)$/.exec(code);
  if (m) return m[1];
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  if (/^Numpad(\d|Add|Subtract|Multiply|Divide|Decimal|Enter)$/.test(code)) return code;
  const named = [
    "Space",
    "Enter",
    "Tab",
    "Backspace",
    "Delete",
    "Insert",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Minus",
    "Equal",
    "BracketLeft",
    "BracketRight",
    "Backslash",
    "Semicolon",
    "Quote",
    "Backquote",
    "Comma",
    "Period",
    "Slash",
    "Pause",
    "PrintScreen",
    "ScrollLock",
  ];
  return named.includes(code) ? code : null;
}

function modsOf(e: KeyboardEvent): string[] {
  return [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(
    (x): x is string => !!x,
  );
}

function recorder(action: keyof Hotkeys, label: string): HTMLElement {
  const value = settings().hotkeys[action];
  const btn = h("button", {
    type: "button",
    class: "recorder",
    "data-fk": `hk:${action}`,
    "aria-label": t("hk.aria", { label }),
  });
  const err = h("span", { class: "rec-err", role: "alert" });
  const paintIdle = () => {
    btn.classList.remove("recording");
    const v = settings().hotkeys[action];
    btn.replaceChildren(
      v ? kbd(v) : h("span", { class: "muted", text: t("hk.notSet") }),
      h("span", { class: "rec-edit" }, icon("keyboard", 15)),
    );
  };
  let onKey: ((e: KeyboardEvent) => void) | null = null;
  const stop = () => {
    if (onKey) window.removeEventListener("keydown", onKey, true);
    onKey = null;
    window.removeEventListener("mousedown", outside, true);
    paintIdle();
  };
  const outside = (e: MouseEvent) => {
    if (!btn.contains(e.target as Node)) stop();
  };
  const set = (accel: string) => {
    err.textContent = "";
    hotkeysDirty = true;
    update((x) => (x.hotkeys = { ...x.hotkeys, [action]: accel }));
    stop();
    rerender("bildirimler");
  };
  btn.addEventListener("click", () => {
    if (onKey) return;
    err.textContent = "";
    // The layout may have changed since the last recording.
    void loadLayoutMap();
    btn.classList.add("recording");
    btn.replaceChildren(
      h("span", { class: "rec-live", text: t("hk.pressKeys") }),
      h("span", { class: "rec-help", text: t("hk.recHelp") }),
    );
    onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const mods = modsOf(e);
      if (e.key === "Escape" && !mods.length) return stop();
      if (e.key === "Backspace" && !mods.length) return set("");
      if (MODIFIER_KEYS.has(e.key)) {
        btn.replaceChildren(kbd([...mods, "…"].join("+")), h("span", { class: "rec-help", text: t("hk.recHelp") }));
        return;
      }
      const key = recordedKey(e.code, e.key, getPlatform(), layoutMap);
      if (!key) {
        err.textContent = t("hk.badKey", { key: e.key });
        return;
      }
      if (!mods.length && !/^F\d+$/.test(key)) {
        err.textContent = t("hk.needMod");
        return;
      }
      set([...mods, key].join("+"));
    };
    window.addEventListener("keydown", onKey, true);
    window.setTimeout(() => {
      if (onKey) window.addEventListener("mousedown", outside, true);
    }, 0);
  });
  paintIdle();
  return h(
    "div",
    { class: "rec-wrap" },
    btn,
    value
      ? button("", { kind: "subtle", small: true, icon: "close", title: t("hk.clear"), onClick: () => set("") })
      : null,
    err,
  );
}

function hotkeysCard(): HTMLElement {
  const hk = settings().hotkeys;
  const label = (a: keyof Hotkeys) => t(`hk.${a}`);
  const rows = HOTKEYS.map((action) => {
    const accel = hk[action].trim();
    const st = statuses?.find((s) => s.action === action);
    const dup = accel && HOTKEYS.find((o) => o !== action && hk[o].trim().toLowerCase() === accel.toLowerCase());
    let status: HTMLElement | null = null;
    if (dup) status = h("span", { class: "hk-status bad" }, icon("warn", 13), t("hk.same", { name: label(dup) }));
    else if (st && st.accel.toLowerCase() === accel.toLowerCase() && accel) {
      status = st.ok
        ? h("span", { class: "hk-status ok" }, icon("check", 13), t("hk.registered"))
        : h(
            "span",
            { class: "hk-status bad", title: st.error ?? "" },
            icon("warn", 13),
            h("span", { class: "verbatim", text: st.error ?? t("hk.failed") }),
          );
    } else if (accel && hotkeysDirty) status = h("span", { class: "hk-status muted" }, t("common.saving"));
    return h(
      "div",
      { class: `hk-row${action === "allow" ? " hk-allow" : ""}` },
      h(
        "div",
        { class: "row-text" },
        h("div", { class: "row-label", text: label(action) }),
        h("div", { class: "row-hint", text: t(`hk.${action}Desc`) }),
      ),
      h("div", { class: "hk-ctl" }, recorder(action, label(action)), status),
      action === "allow" ? notice("warn", h("strong", { text: t("hk.allowWarnLead") }), t("hk.allowWarn")) : null,
    );
  });
  return card({ title: t("hk.title"), icon: "keyboard", desc: t("hk.desc") }, h("div", { class: "hk-list" }, ...rows));
}

// ── Quiet hours ───────────────────────────────────────────────────────────────
// Times are stored as 24-hour "HH:MM" and shown in the UI language's clock
// (23:00 in Turkish, 11:00 PM in English) everywhere in the card. The pickers
// are selects, not <input type="time">, which would follow the OS locale and
// could be left empty.

function toMin(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return 0;
  return (Number(m[1]) % 24) * 60 + (Number(m[2]) % 60);
}

function hhmm(min: number): string {
  const v = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
}

/** Whether the UI language reads the clock in 12 hours (English: en-US). */
function twelveHour(): boolean {
  const cycle = new Intl.DateTimeFormat(locale(), { hour: "numeric" }).resolvedOptions().hourCycle;
  return cycle === "h12" || cycle === "h11";
}

function at(min: number): Date {
  return new Date(2000, 0, 1, Math.floor(min / 60), min % 60);
}

/** "23:00" / "11:00 PM". */
function fmtClock(min: number): string {
  if (!twelveHour()) return hhmm(min);
  return new Intl.DateTimeFormat(locale(), { hour: "numeric", minute: "2-digit" }).format(at(min));
}

/** Axis label for a whole hour (0…24): "06" / "6 AM"; the day's end reads 24 or 12 AM. */
function fmtHourTick(hour: number): string {
  if (!twelveHour()) return String(hour).padStart(2, "0");
  return new Intl.DateTimeFormat(locale(), { hour: "numeric" }).format(at((hour % 24) * 60));
}

/** "AM" / "PM" in the UI language. */
function dayPeriod(pm: boolean): string {
  const parts = new Intl.DateTimeFormat(locale(), { hour: "numeric", hourCycle: "h12" }).formatToParts(
    at(pm ? 13 * 60 : 60),
  );
  return parts.find((p) => p.type === "dayPeriod")?.value ?? (pm ? "PM" : "AM");
}

/**
 * Hour and minute selects (plus AM/PM in a 12-hour language) for one end of the
 * quiet window. Minutes go in steps of five; a stored minute in between stays
 * selectable.
 */
function timePicker(value: string, label: string, fk: string, onChange: (v: string) => void): HTMLElement {
  const total = toMin(value);
  const h12 = twelveHour();
  const minute = total % 60;
  const hour24 = Math.floor(total / 60);
  const minutes = Array.from({ length: 12 }, (_, i) => i * 5);
  if (!minutes.includes(minute)) minutes.push(minute);
  minutes.sort((x, y) => x - y);

  const hourOpts = h12
    ? Array.from({ length: 12 }, (_, i) => [String(i), String(i === 0 ? 12 : i)] as const)
    : Array.from({ length: 24 }, (_, i) => [String(i), String(i).padStart(2, "0")] as const);
  const emit = () => {
    let hr = Number(hourSel.value);
    if (periodSel) hr = (hr % 12) + (periodSel.value === "pm" ? 12 : 0);
    onChange(hhmm(hr * 60 + Number(minSel.value)));
  };
  const hourSel = select(hourOpts, String(h12 ? hour24 % 12 : hour24), emit, {
    fk: `${fk}-h`,
    label: t("quiet.hourAria", { field: label }),
  });
  const minSel = select(
    minutes.map((m) => [String(m), String(m).padStart(2, "0")] as const),
    String(minute),
    emit,
    { fk: `${fk}-m`, label: t("quiet.minuteAria", { field: label }) },
  );
  const periodSel = h12
    ? select(
        [
          ["am", dayPeriod(false)],
          ["pm", dayPeriod(true)],
        ] as const,
        hour24 >= 12 ? "pm" : "am",
        emit,
        { fk: `${fk}-p`, label: t("quiet.periodAria", { field: label }) },
      )
    : null;
  return h(
    "div",
    { class: "time-field", role: "group", "aria-label": label },
    h("span", { text: label }),
    // One line: hour : minute [AM/PM].
    h("span", { class: "time-pick" }, hourSel, " : ", minSel, periodSel ? " " : null, periodSel),
  );
}

function quietStrip(from: string, to: string, on: boolean): HTMLElement {
  const a = toMin(from);
  const b = toMin(to);
  const strip = h("div", { class: `quiet-strip${on ? "" : " off"}`, "aria-hidden": "true" });
  const seg = (start: number, end: number) => {
    const s = h("span", { class: "qs-seg" });
    s.style.left = `${(start / 1440) * 100}%`;
    s.style.width = `${((end - start) / 1440) * 100}%`;
    strip.append(s);
  };
  // Equal ends are an empty window: Rust's quiet::in_window is never true for it.
  if (a < b) seg(a, b);
  else if (a > b) {
    seg(a, 1440);
    seg(0, b);
  }
  const now = new Date();
  const mark = h("span", { class: "qs-now", title: t("quiet.now") });
  mark.style.left = `${((now.getHours() * 60 + now.getMinutes()) / 1440) * 100}%`;
  strip.append(mark);
  const ticks = h("div", { class: "qs-ticks" });
  for (const hour of [0, 6, 12, 18, 24]) ticks.append(h("span", { text: fmtHourTick(hour) }));
  return h("div", { class: "quiet-vis" }, strip, ticks);
}

/** What the window does, in words; equal ends mean no quiet hours at all (D1). */
function quietSummary(fromHhmm: string, toHhmm: string): HTMLElement {
  const a = toMin(fromHhmm);
  const b = toMin(toHhmm);
  if (a === b) return notice("warn", t("quiet.same"));
  const dur = fmtMinutes((b - a + 1440) % 1440);
  const from = fmtClock(a);
  const to = fmtClock(b);
  return h("p", {
    class: "fine",
    text: a > b ? t("quiet.wraps", { dur, from, to }) : t("quiet.range", { dur, from, to }),
  });
}

// ── Render ────────────────────────────────────────────────────────────────────

function render(): HTMLElement {
  const s = settings();

  const soundList = h("div", { class: `sound-list${s.soundEnabled ? "" : " dim"}` });
  for (const name of SOUNDS) {
    const muted = s.mutedSounds.includes(name);
    const label = t(`snd.${name}` as MsgKey);
    const soundRow = h(
      "div",
      { class: `sound-row${muted ? " muted-row" : ""}` },
      h(
        "button",
        {
          type: "button",
          class: "play-btn",
          title: t("sounds.play", { label }),
          "aria-label": t("sounds.play", { label }),
          "data-fk": `play:${name}`,
          onclick: () => {
            Sound.setVolume(settings().soundVolume);
            Sound.force(name);
          },
        },
        icon("play", 14),
      ),
      h(
        "div",
        { class: "row-text" },
        h("div", { class: "row-label", text: label }),
        h("div", { class: "row-hint", text: t(`snd.${name}Desc` as MsgKey) }),
      ),
      toggle(
        !muted,
        (on) => {
          update((x) => {
            const set = new Set(x.mutedSounds);
            if (on) set.delete(name);
            else set.add(name);
            x.mutedSounds = [...set];
          });
          // The label dims with its switch, without redrawing the tab.
          soundRow.classList.toggle("muted-row", !on);
        },
        { label: t("sounds.muteAria", { label }), fk: `mute:${name}` },
      ),
    );
    soundList.append(soundRow);
  }

  const toastOn = new Set(s.toastEvents);
  const toastGrid = h("div", { class: `toast-grid${s.toastEnabled ? "" : " dim"}` });
  for (const id of TOAST_EVENTS) {
    toastGrid.append(
      checkbox(
        toastOn.has(id),
        t(`toastEv.${id}`),
        (on) =>
          update((x) => {
            const set = new Set(x.toastEvents);
            if (on) set.add(id);
            else set.delete(id);
            x.toastEvents = TOAST_EVENTS.filter((e) => set.has(e));
          }),
        { desc: t(`toastEv.${id}Desc`), fk: `toast:${id}` },
      ),
    );
  }

  // Repainted in place when a time changes, so the pickers keep their focus.
  const quietVis = h("div", {});
  const quietText = h("div", {});
  const paintQuiet = () => {
    const q = settings();
    quietVis.replaceChildren(quietStrip(q.quietFrom, q.quietTo, q.quietEnabled));
    quietText.replaceChildren(quietSummary(q.quietFrom, q.quietTo));
  };
  paintQuiet();

  const fromPick = timePicker(s.quietFrom, t("quiet.from"), "quietFrom", (v) => {
    update((x) => (x.quietFrom = v));
    paintQuiet();
  });
  const toPick = timePicker(s.quietTo, t("quiet.to"), "quietTo", (v) => {
    update((x) => (x.quietTo = v));
    paintQuiet();
  });

  return h(
    "div",
    { class: "tab-body" },
    card(
      { title: t("quiet.title"), icon: "moon", desc: t("quiet.desc") },
      row(
        h("span", { class: "dnd-label" }, icon("moon", 16), t("quiet.dnd")),
        s.dnd ? t("quiet.dndOnHint") : t("quiet.dndOffHint"),
        toggle(
          s.dnd,
          (v) => {
            update((x) => (x.dnd = v));
            rerender("bildirimler");
          },
          { label: t("quiet.dnd"), fk: "dnd" },
        ),
        `row-dnd${s.dnd ? " on" : ""}`,
      ),
      row(
        t("quiet.hours"),
        t("quiet.hoursHint"),
        toggle(
          s.quietEnabled,
          (v) => {
            update((x) => (x.quietEnabled = v));
            rerender("bildirimler");
          },
          { label: t("quiet.hours"), fk: "quietEnabled" },
        ),
      ),
      h(
        "div",
        { class: `quiet-box${s.quietEnabled ? "" : " dim"}` },
        h(
          "div",
          { class: "quiet-times" },
          fromPick,
          h("span", { class: "qt-arrow", text: "→", "aria-hidden": "true" }),
          toPick,
        ),
        quietVis,
        quietText,
      ),
      row(
        t("quiet.fullscreen"),
        t("quiet.fullscreenHint"),
        toggle(s.quietFullscreen && app.fullscreenSupported, (v) => update((x) => (x.quietFullscreen = v)), {
          label: t("quiet.fullscreen"),
          fk: "quietFullscreen",
          disabled: !app.fullscreenSupported,
        }),
      ),
    ),
    card(
      { title: t("sounds.title"), icon: "speaker", desc: t("sounds.desc") },
      row(
        t("sounds.title"),
        null,
        toggle(
          s.soundEnabled,
          (v) => {
            update((x) => (x.soundEnabled = v));
            rerender("bildirimler");
          },
          { label: t("sounds.title"), fk: "soundEnabled" },
        ),
      ),
      row(
        t("sounds.volume"),
        null,
        slider({
          value: Math.round(s.soundVolume * 100),
          min: 0,
          max: 100,
          step: 5,
          format: (v) => fmtPct(v, 100),
          onChange: (v) => update((x) => (x.soundVolume = v / 100)),
          fk: "volume",
          label: t("sounds.volume"),
        }),
      ),
      soundList,
    ),
    card(
      {
        title: t("toasts.title"),
        icon: "bildirimler",
        desc: t("toasts.desc"),
        actions: [
          button(t("toasts.test"), {
            kind: "subtle",
            small: true,
            icon: "play",
            onClick: async () => {
              const shown = await api.notify("approval", "Nöbetçi", t("toasts.testBody"), false);
              testResult = shown ? "toasts.sent" : shown === false ? "toasts.notShown" : "toasts.onlyInApp";
              rerender("bildirimler");
            },
          }),
        ],
      },
      row(
        t("toasts.title"),
        null,
        toggle(
          s.toastEnabled,
          (v) => {
            update((x) => (x.toastEnabled = v));
            rerender("bildirimler");
          },
          { label: t("toasts.title"), fk: "toastEnabled" },
        ),
      ),
      toastGrid,
      row(
        t("toasts.onlyHidden"),
        t("toasts.onlyHiddenHint"),
        toggle(s.toastOnlyWhenHidden, (v) => update((x) => (x.toastOnlyWhenHidden = v)), {
          label: t("toasts.onlyHidden"),
          fk: "toastOnlyWhenHidden",
        }),
      ),
      testResult ? notice("info", t(testResult)) : null,
    ),
    hotkeysCard(),
  );
}

export const bildirimlerTab: Tab = {
  id: "bildirimler",
  title: () => t("notif.title"),
  subtitle: () => t("notif.subtitle"),
  icon: "bildirimler",
  render,
  onShow: () => void loadStatuses(),
  // Registration errors are Rust's text: fetch them again in the new language.
  onLang: () => {
    statuses = null;
  },
};
