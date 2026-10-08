// Bildirimler: sounds (with previews), Windows notifications, do-not-disturb and
// quiet hours, and global shortcuts recorded from the keyboard.

import type { HotkeyStatus } from "../../core/bridge";
import type { Hotkeys } from "../../core/settings-model";
import { Sound, type SoundName } from "../../core/sound";
import { h } from "../../ui/dom";
import { api } from "../api";
import { t, type MsgKey } from "../i18n";
import { icon } from "../icons";
import { app, rerender, type Tab } from "../nav";
import { onSaved, settings, update } from "../store";
import { button, card, checkbox, fmtMinutes, fmtPct, kbd, notice, row, slider, textInput, toggle } from "../ui";

const SOUNDS: SoundName[] = ["approval", "danger", "finish", "error", "hoot", "allow", "deny", "peek", "open", "close"];

const TOAST_EVENTS = ["approval", "finished", "error", "waiting"] as const;

const HOTKEYS: (keyof Hotkeys)[] = ["toggle", "deny", "allow", "dnd"];

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

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "OS", "AltGraph", "Hyper", "Super"]);

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
      const key = keyFromCode(e.code);
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

// ── Quiet hours strip ─────────────────────────────────────────────────────────

function toMin(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return 0;
  return (Number(m[1]) % 24) * 60 + (Number(m[2]) % 60);
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
  if (a === b) seg(0, 1440);
  else if (a < b) seg(a, b);
  else {
    seg(a, 1440);
    seg(0, b);
  }
  const now = new Date();
  const mark = h("span", { class: "qs-now", title: t("quiet.now") });
  mark.style.left = `${((now.getHours() * 60 + now.getMinutes()) / 1440) * 100}%`;
  strip.append(mark);
  const ticks = h("div", { class: "qs-ticks" });
  for (const tick of ["00", "06", "12", "18", "24"]) ticks.append(h("span", { text: tick }));
  return h("div", { class: "quiet-vis" }, strip, ticks);
}

function quietSummary(from: string, to: string): string {
  const a = toMin(from);
  const b = toMin(to);
  if (a === b) return t("quiet.allDay");
  const dur = fmtMinutes((b - a + 1440) % 1440);
  return a > b ? t("quiet.wraps", { dur, from, to }) : t("quiet.range", { dur, from, to });
}

// ── Render ────────────────────────────────────────────────────────────────────

function render(): HTMLElement {
  const s = settings();

  const soundList = h("div", { class: `sound-list${s.soundEnabled ? "" : " dim"}` });
  for (const name of SOUNDS) {
    const muted = s.mutedSounds.includes(name);
    const label = t(`snd.${name}` as MsgKey);
    soundList.append(
      h(
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
          (on) =>
            update((x) => {
              const set = new Set(x.mutedSounds);
              if (on) set.delete(name);
              else set.add(name);
              x.mutedSounds = [...set];
            }),
          { label: t("sounds.muteAria", { label }), fk: `mute:${name}` },
        ),
      ),
    );
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

  // Updated in place while typing, so the time field keeps its caret.
  const quietVis = h("div", {});
  const quietText = h("p", { class: "fine" });
  const paintQuiet = () => {
    const q = settings();
    quietVis.replaceChildren(quietStrip(q.quietFrom, q.quietTo, q.quietEnabled));
    quietText.textContent = quietSummary(q.quietFrom, q.quietTo);
  };
  paintQuiet();

  const fromIn = textInput({
    type: "time",
    value: s.quietFrom,
    label: t("quiet.from"),
    fk: "quietFrom",
    cls: "time-input",
    onInput: (v) => {
      if (!v) return;
      update((x) => (x.quietFrom = v));
      paintQuiet();
    },
  });
  const toIn = textInput({
    type: "time",
    value: s.quietTo,
    label: t("quiet.to"),
    fk: "quietTo",
    cls: "time-input",
    onInput: (v) => {
      if (!v) return;
      update((x) => (x.quietTo = v));
      paintQuiet();
    },
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
          h("label", { class: "time-field" }, h("span", { text: t("quiet.from") }), fromIn),
          h("span", { class: "qt-arrow", text: "→" }),
          h("label", { class: "time-field" }, h("span", { text: t("quiet.to") }), toIn),
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
