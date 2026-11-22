import type { OwlEmote } from "../baykus/owl";
import { addDays, Agenda, dayKey, parseDay } from "../core/agenda";
import { Bridge, type AgendaItem, type IslandMedia, type IslandStats, type IslandWeather, type MediaAction } from "../core/bridge";
import { WEATHER_CITIES } from "../core/island-widgets";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import { getLang } from "../i18n/core";
import { h, icon } from "./dom";
import { weatherIcon, weatherLabel } from "./weather-icon";

const local = (tr: string, en: string) => getLang() === "tr" ? tr : en;
const SVG_NS = "http://www.w3.org/2000/svg";
const MEDIA_ICONS = {
  previous: "M4 4h2v12H4zm3 6 9-6v12z",
  play: "M6 3.5v13l11-6.5z",
  pause: "M5 4h4v12H5zm6 0h4v12h-4z",
  next: "M4 4l9 6-9 6zm10 0h2v12h-2z",
} as const;
// Stroked 24×24 paths for `icon()`. Drawn here rather than typed as symbol
// characters, whose shape, size and colour depend on the fonts installed.
const LINE_ICONS = {
  music: "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  calendar: "M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM8 3v4M16 3v4M3 10h18",
  agenda: "M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2",
  sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  chip: "M8 8h8v8H8zM5 5h14v14H5zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3",
  sliders: "M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5",
  reset: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
  previous: "M15 18l-6-6 6-6",
  next: "M9 18l6-6-6-6",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  wind: "M3 8h11a3 3 0 1 0-3-3M3 16h15a3 3 0 1 1-3 3M3 12h8",
  close: "M18 6 6 18M6 6l12 12",
  check: "M5 12.5l4.5 4.5L19 7.5",
} as const;
const DASHBOARD_TABS = [
  ["media", "Medya", "Media", LINE_ICONS.music],
  ["agenda", "Ajanda", "Agenda", LINE_ICONS.agenda],
  ["calendar", "Takvim", "Calendar", LINE_ICONS.calendar],
  ["weather", "Hava", "Weather", LINE_ICONS.sun],
  ["system", "Sistem", "System", LINE_ICONS.chip],
] as const;
type PageKey = (typeof DASHBOARD_TABS)[number][0];

function mediaIcon(name: keyof typeof MEDIA_ICONS): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", MEDIA_ICONS[name]);
  svg.append(path);
  return svg;
}

/** A ring gauge: a track and an arc, both SVG circles, the arc drawn by dash offset. */
function ring(size: number, stroke: number, cls: string) {
  const r = (size - stroke) / 2;
  const length = 2 * Math.PI * r;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("class", `ring ${cls}`);
  svg.setAttribute("aria-hidden", "true");
  const make = (c: string) => {
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(size / 2));
    circle.setAttribute("cy", String(size / 2));
    circle.setAttribute("r", String(r));
    circle.setAttribute("stroke-width", String(stroke));
    circle.setAttribute("class", c);
    return circle;
  };
  const arc = make("ring-arc");
  arc.setAttribute("stroke-dasharray", String(length));
  arc.setAttribute("stroke-dashoffset", String(length));
  svg.append(make("ring-track"), arc);
  return {
    svg,
    /** 0–1 */
    set(fraction: number) {
      const f = Math.max(0, Math.min(1, fraction));
      arc.setAttribute("stroke-dashoffset", String(length * (1 - f)));
    },
  };
}

export function widgetHeight(): number {
  return 144;
}

export function compactWidgetSummary(redraw: () => void) {
  let city = "";
  let temperature: number | undefined;
  let track = "";
  let weatherAfter = 0;
  let mediaAfter = 0;
  // One read at a time: a player that hangs must not pile up calls (widgets#9).
  let weatherPending = false;
  let mediaPending = false;
  let timer: number | undefined;
  Agenda.load();

  // Called only while the pill shows this line (views.ts), so the player is
  // never read for a line nobody sees (island-ui#11).
  return () => {
    if (State.mode !== "compact") return "";
    if (timer === undefined) {
      timer = window.setTimeout(() => {
        timer = undefined;
        if (State.mode === "compact") redraw();
      }, 5_000);
    }
    const now = Date.now();
    const settings = State.settings;
    if (city !== settings.islandWeatherCity) {
      city = settings.islandWeatherCity;
      temperature = undefined;
      weatherAfter = 0;
    }
    if (city && now >= weatherAfter && !weatherPending) {
      const requestedCity = city;
      weatherAfter = now + 60_000;
      weatherPending = true;
      void Bridge.islandWeather(requestedCity).then((result) => {
        weatherPending = false;
        if (city !== requestedCity) return;
        temperature = result?.temperature;
        if (result) weatherAfter = Date.now() + 600_000;
        redraw();
      }, () => { weatherPending = false; });
    }
    const mediaOn = settings.islandMedia;
    if (!mediaOn) track = "";
    else if (now >= mediaAfter && !mediaPending) {
      mediaAfter = now + 5_000;
      mediaPending = true;
      void Bridge.islandMedia().then((result) => {
        mediaPending = false;
        if (State.mode !== "compact" || !State.settings.islandMedia) return;
        track = result?.playing ? result.title : "";
        redraw();
      }, () => { mediaPending = false; });
    }
    const date = new Intl.DateTimeFormat(getLang(), { weekday: "short", day: "numeric", month: "short" }).format(now);
    const weather = temperature === undefined ? "" : `${Math.round(temperature)} °C`;
    const next = Agenda.next();
    const summaries = [date, weather, next && `${next.time} · ${next.text}`, track && `♪ ${track}`].filter(Boolean);
    return summaries[Math.floor(now / 5_000) % summaries.length];
  };
}

// ── Focus timer ──────────────────────────────────────────────────────────────

/** The timer's length in minutes: 5–180 here, in Settings and in Rust alike (S-22). */
const FOCUS_MIN = 5;
const FOCUS_MAX = 180;
const clampFocus = (m: number) => Math.max(FOCUS_MIN, Math.min(FOCUS_MAX, Math.round(m)));

let focusRemaining = 0;
let focusUntil = 0;
let focusLength = 0;
/** When the last run ended: the card says so until it has been seen. */
let focusDoneAt = 0;
/** Since when the card has been on screen showing that end. */
let focusDoneSeenAt = 0;
let focusTimer: number | undefined;
/** The mascot's reaction to a run ending (set by the dashboards). */
let focusReact: ((e: OwlEmote) => void) | undefined;
const focusMinutes = () => clampFocus(State.settings.focusMinutes || 25);
/** How long the end stays on the card once it is on screen. */
const FOCUS_DONE_SHOWN_MS = 6_000;

/**
 * Wakes up when a run is due to end, whatever the island is doing: folded and
 * asleep, it draws no frames that would notice (dashboard#5).
 */
function armFocusEnd() {
  window.clearTimeout(focusTimer);
  focusTimer = undefined;
  if (focusUntil) focusTimer = window.setTimeout(checkFocusEnd, Math.max(0, focusUntil - Date.now()) + 30);
}

/**
 * A run is over: said once — a chime, the pill, the mascot — and the card keeps
 * showing it until it has been seen. Quiet hours and do-not-disturb keep it
 * silent (the sound engine and the pill both stay quiet then).
 */
function checkFocusEnd() {
  if (!focusUntil) return;
  if (Date.now() < focusUntil) {
    armFocusEnd(); // early: the clock moved
    return;
  }
  focusUntil = 0;
  focusRemaining = 0;
  focusLength = 0;
  focusDoneAt = Date.now();
  focusDoneSeenAt = 0;
  armFocusEnd();
  Sound.play("finish");
  focusReact?.("happy");
  if (!State.isQuiet) {
    State.flash = { text: local("⏱ Odak süresi doldu", "⏱ Focus time is up"), tone: "ok", until: Date.now() + 6_000 };
    window.setTimeout(() => State.notify(), 6_100);
  }
  State.notify();
}

/**
 * Starts the focus timer for `minutes` (the assistant's /focus command), held
 * to the same 5–180 as everywhere else. Returns the minutes it runs for.
 */
export function startFocusTimer(minutes: number): number {
  const m = clampFocus(minutes);
  focusLength = m * 60_000;
  focusRemaining = focusLength;
  focusUntil = Date.now() + focusRemaining;
  focusDoneAt = 0;
  armFocusEnd();
  State.notify();
  return m;
}

function buildFocus() {
  const gauge = ring(64, 5, "focus-ring");
  const time = h("strong", { class: "focus-time" });
  const toggle = h("button", { type: "button", class: "focus-play" });
  const minus = h("button", { type: "button", class: "focus-step", title: local("5 dk azalt", "5 min less"),
    "aria-label": local("5 dk azalt", "5 min less") }, icon(LINE_ICONS.minus, 11));
  const plus = h("button", { type: "button", class: "focus-step", title: local("5 dk artır", "5 min more"),
    "aria-label": local("5 dk artır", "5 min more") }, icon(LINE_ICONS.plus, 11));
  const length = h("span", { class: "focus-length", "aria-live": "polite" });
  const reset = h("button", { type: "button", class: "focus-step", title: local("Sayacı sıfırla", "Reset timer"),
    "aria-label": local("Sayacı sıfırla", "Reset timer") }, icon(LINE_ICONS.reset, 11));
  // The button comes after the dial: it sits on top of the ring's corner, and
  // a click anywhere on it is its own (G-3).
  const el = h("div", { class: "island-card island-card-focus" },
    h("span", { class: "island-card-label", text: local("Odak", "Focus") }),
    h("div", { class: "focus-dial" }, gauge.svg, time),
    h("div", { class: "focus-row" }, minus, length, plus, reset),
    toggle);
  let glyph = "";

  const idleLength = () => focusMinutes() * 60_000;
  const setMinutes = (m: number) => {
    const next = clampFocus(m);
    if (next === focusMinutes()) return;
    State.settings.focusMinutes = next;
    void Bridge.saveSettings({ ...State.settings, focusMinutes: next });
    focusRemaining = 0;
    refresh(false);
  };

  /** `onScreen`: the card is in view on an open island, so a finished run counts as seen. */
  function refresh(onScreen: boolean) {
    if (focusUntil && Date.now() >= focusUntil) checkFocusEnd();
    if (focusDoneAt) {
      if (!onScreen) focusDoneSeenAt = 0;
      else if (!focusDoneSeenAt) focusDoneSeenAt = Date.now();
      else if (Date.now() - focusDoneSeenAt > FOCUS_DONE_SHOWN_MS) focusDoneAt = 0;
    }
    const done = focusDoneAt > 0;
    const running = focusUntil > 0;
    const total = focusLength || idleLength();
    const left = running ? focusUntil - Date.now() : focusRemaining || idleLength();
    const seconds = Math.ceil(left / 1_000);
    const clock = done ? "00:00" : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    if (time.textContent !== clock) time.textContent = clock;
    gauge.set(done ? 0 : running || focusRemaining ? left / total : 1);
    el.classList.toggle("running", running);
    el.classList.toggle("done", done);
    const paused = !running && focusRemaining > 0 && focusRemaining < total;
    el.classList.toggle("paused", paused);
    minus.hidden = plus.hidden = running || paused || done;
    reset.hidden = !(running || paused || done);
    const status = done
      ? local("süre doldu", "time's up")
      : running ? local("odakta", "focusing") : paused ? local("duraklatıldı", "paused") : local(`${focusMinutes()} dk`, `${focusMinutes()} min`);
    if (length.textContent !== status) length.textContent = status;
    const next = running ? "pause" : "play";
    if (glyph !== next) {
      glyph = next;
      toggle.replaceChildren(mediaIcon(next));
    }
    const action = running ? local("Sayacı duraklat", "Pause timer") : paused ? local("Sayaca devam et", "Resume timer") : local("Sayacı başlat", "Start timer");
    toggle.title = action;
    toggle.setAttribute("aria-label", action);
  }

  toggle.addEventListener("click", () => {
    focusDoneAt = 0;
    if (focusUntil) {
      focusRemaining = Math.max(0, focusUntil - Date.now());
      focusUntil = 0;
    } else {
      if (!focusRemaining) {
        focusLength = idleLength();
        focusRemaining = focusLength;
      }
      focusUntil = Date.now() + focusRemaining;
    }
    armFocusEnd();
    refresh(false);
  });
  reset.addEventListener("click", () => {
    focusRemaining = 0;
    focusUntil = 0;
    focusLength = 0;
    focusDoneAt = 0;
    armFocusEnd();
    refresh(false);
  });
  minus.addEventListener("click", () => setMinutes(focusMinutes() - 5));
  plus.addEventListener("click", () => setMinutes(focusMinutes() + 5));
  return { el, refresh };
}

// ── Agenda ───────────────────────────────────────────────────────────────────

/** What Rust said when it refused an agenda change, in the island's language (C-10). */
function agendaError(err: unknown): string {
  const raw = (err instanceof Error ? err.message : String(err ?? "")).replace(/^Error:\s*/, "").trim();
  if (raw === "agenda_full") {
    return local("Ajanda dolu: önce eski ya da bitmiş kayıtları sil.", "The agenda is full: delete old or finished items first.");
  }
  if (!raw || raw.startsWith("save_failed")) return local("Ajanda kaydedilemedi.", "Couldn't save the agenda.");
  // Rust's own messages already come in the app's language.
  return raw;
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

function buildAgenda(openDay: { day: string }) {
  const title = h("strong", { class: "agenda-day" });
  const count = h("span", { class: "agenda-count", "aria-live": "polite" });
  const move = (step: number, label: string) => h("button", {
    type: "button", class: "island-calendar-button", title: label, "aria-label": label,
    onclick: () => { openDay.day = addDays(openDay.day, step); draw(); },
  }, icon(step < 0 ? LINE_ICONS.previous : LINE_ICONS.next, 12));
  const list = h("ul", { class: "agenda-list", "aria-live": "polite" });
  // Text fields (and everything else in the editor) are "typing": a click there
  // gives the island the keyboard, and it keeps it while the focus stays inside.
  const text = h("input", {
    type: "text", class: "agenda-input", maxlength: 200, "data-typing": "", enterkeyhint: "done",
    placeholder: local("Yeni not ya da görev…", "New note or task…"),
    "aria-label": local("Not", "Note"),
  });
  const clock = h("input", { type: "time", class: "agenda-time", "data-typing": "", "aria-label": local("Saat (isteğe bağlı)", "Time (optional)") });
  const note = h("span", { class: "agenda-note", role: "status" });
  const save = h("button", { type: "submit", class: "agenda-save", title: local("Kaydet (Enter)", "Save (Enter)") },
    icon(LINE_ICONS.check, 13), h("span", { text: local("Kaydet", "Save") }));
  const cancel = h("button", { type: "button", class: "agenda-cancel", title: local("Vazgeç (Esc)", "Cancel (Esc)"),
    "aria-label": local("Vazgeç", "Cancel") }, icon(LINE_ICONS.close, 12));
  const editorTitle = h("span", { class: "agenda-editor-title" });
  // The editor covers the whole card, so the note and its time get the room
  // they need (dashboard#8); it adds a note or changes one (dashboard#21).
  const form = h("form", { class: "agenda-editor", "data-typing": "", hidden: true },
    h("div", { class: "agenda-editor-head" }, editorTitle, cancel),
    text,
    h("div", { class: "agenda-editor-row" }, clock, note, save));
  const add = h("button", { type: "button", class: "agenda-new", "data-typing": "", title: local("Not ya da görev ekle", "Add a note or task") },
    icon(LINE_ICONS.plus, 12), h("span", { text: local("Ekle", "Add") }));
  const el = h("div", { class: "island-agenda" },
    h("div", { class: "agenda-side" },
      h("div", { class: "agenda-head" }, move(-1, local("Önceki gün", "Previous day")), title, move(1, local("Sonraki gün", "Next day"))),
      count,
      add),
    list,
    form);

  /** The item being changed; null while adding a new one. */
  let editing: AgendaItem | null = null;
  let busy = false;
  let countNote = "";
  let countNoteTimer: number | undefined;

  const dayName = (key: string) => {
    const today = dayKey(new Date());
    if (key === today) return local("Bugün", "Today");
    if (key === addDays(today, 1)) return local("Yarın", "Tomorrow");
    if (key === addDays(today, -1)) return local("Dün", "Yesterday");
    return new Intl.DateTimeFormat(getLang(), { weekday: "short", day: "numeric", month: "short" }).format(parseDay(key));
  };

  /** A failed tick or delete says so on the card for a while (island-ui#21). */
  const showCountError = (message: string) => {
    countNote = message;
    window.clearTimeout(countNoteTimer);
    countNoteTimer = window.setTimeout(() => { countNote = ""; draw(); }, 6_000);
    draw();
  };

  /** A time already gone by on the day being edited: its reminder can never come. */
  const pastTime = () => {
    if (!clock.value) return false;
    const today = dayKey(new Date());
    return openDay.day < today || (openDay.day === today && clock.value < hhmm(new Date()));
  };
  const paintNote = (error = "") => {
    note.classList.toggle("error", !!error);
    note.classList.toggle("warn", !error && pastTime());
    note.textContent = error || (pastTime()
      ? local("Bu saat geçti: hatırlatma gelmez.", "That time has passed: no reminder.")
      : clock.value ? local("O saatte hatırlatırım.", "I'll remind you then.") : "");
  };

  function openEditor(item: AgendaItem | null) {
    editing = item;
    text.value = item?.text ?? text.value;
    clock.value = item?.time ?? (item ? "" : clock.value);
    editorTitle.textContent = `${dayName(openDay.day)} · ${item ? local("düzenle", "edit") : local("yeni not", "new note")}`;
    save.lastElementChild!.textContent = item ? local("Kaydet", "Save") : local("Ekle", "Add");
    form.hidden = false;
    el.classList.add("editing");
    paintNote();
    // The press that opened the editor may still hand the focus to what was
    // pressed (the island takes the keyboard on it); the text box gets it last.
    const focusText = () => {
      if (form.hidden) return;
      text.focus();
      text.setSelectionRange(text.value.length, text.value.length);
    };
    focusText();
    window.setTimeout(() => { if (!form.contains(document.activeElement)) focusText(); }, 90);
  }

  function closeEditor(keepDraft = false) {
    const wasEditing = editing;
    editing = null;
    if (!keepDraft || wasEditing) {
      text.value = "";
      clock.value = "";
    }
    // Typing is over: the focus leaves the editor, so the island gives the
    // keyboard back and may fold again.
    if (form.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    form.hidden = true;
    el.classList.remove("editing");
    note.textContent = "";
  }

  function row(item: AgendaItem, index: number) {
    const check = h("button", {
      type: "button", class: "agenda-check", role: "checkbox", "aria-checked": String(item.done),
      "aria-label": item.done ? local("Yapılmadı say", "Mark as not done") : local("Yapıldı", "Mark as done"),
      onclick: () => void Agenda.put({ ...item, done: !item.done }).catch((err: unknown) => showCountError(agendaError(err))),
    });
    const remove = h("button", {
      type: "button", class: "agenda-remove", title: local("Sil", "Delete"), "aria-label": local("Sil", "Delete"),
      onclick: () => void Agenda.remove(item.id).catch((err: unknown) => showCountError(agendaError(err))),
    }, icon(LINE_ICONS.trash, 11));
    const body = h("button", {
      type: "button", class: "agenda-text", "data-typing": "",
      title: `${item.text}\n${local("Düzenlemek için tıkla", "Click to edit")}`,
      onclick: () => openEditor(item),
    }, item.time ? h("time", { class: "agenda-at", text: item.time }) : null, h("span", { class: "agenda-label", text: item.text }));
    return h("li", { class: `agenda-item${item.done ? " done" : ""}`, style: `--i:${index}` }, check, body, remove);
  }

  function draw() {
    title.textContent = dayName(openDay.day);
    title.title = new Intl.DateTimeFormat(getLang(), { dateStyle: "full" }).format(parseDay(openDay.day));
    const items = Agenda.on(openDay.day);
    const open = items.filter((i) => !i.done).length;
    count.classList.toggle("error", !!countNote);
    count.textContent = countNote || (items.length
      ? local(`${open} açık · ${items.length - open} bitti`, `${open} open · ${items.length - open} done`)
      : local("Boş gün", "Nothing planned"));
    list.replaceChildren(...(items.length
      ? items.map(row)
      : [h("li", { class: "agenda-empty", text: local("Ekle'ye bas, yaz, Enter ile kaydet. Saat verirsen hatırlatırım.", "Press Add, type, save with Enter. Give it a time and I'll remind you.") })]));
    // An item changed elsewhere while being edited here: let go of the old copy.
    if (editing && !Agenda.all().some((i) => i.id === editing!.id)) closeEditor();
  }

  async function submit() {
    const value = text.value.trim();
    if (!value) {
      paintNote(local("Önce bir şey yaz.", "Type something first."));
      text.focus();
      return;
    }
    if (busy) return;
    busy = true;
    form.setAttribute("aria-busy", "true");
    const item: AgendaItem = editing
      ? { ...editing, text: value, time: clock.value || null }
      : { id: Agenda.newId(), text: value, date: openDay.day, time: clock.value || null, done: false };
    try {
      await Agenda.put(item);
      closeEditor();
    } catch (err) {
      // Nothing is lost: the editor stays open with what was typed (C-10).
      paintNote(agendaError(err));
    } finally {
      busy = false;
      form.removeAttribute("aria-busy");
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submit();
  });
  // Enter saves from either field, whatever the engine thinks of implicit
  // submission with a time field in the form (island-ui#21).
  for (const field of [text, clock]) {
    field.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        void submit();
      }
    });
  }
  form.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeEditor(true);
    }
  });
  clock.addEventListener("input", () => paintNote());
  text.addEventListener("input", () => { if (note.classList.contains("error")) paintNote(); });
  cancel.addEventListener("click", () => closeEditor(true));
  add.addEventListener("click", () => openEditor(null));
  Agenda.subscribe(draw);
  return { el, draw };
}

// ── Calendar ─────────────────────────────────────────────────────────────────

/**
 * The first day of the week, 1 (Monday) … 7 (Sunday): Monday in Turkish; in
 * English whatever the system's locale says (Sunday in the US), else Monday.
 */
function firstWeekday(): number {
  if (getLang() === "tr") return 1;
  try {
    type WeekInfo = { firstDay?: number };
    const locale = new Intl.Locale(navigator.language || "en") as Intl.Locale & { getWeekInfo?(): WeekInfo; weekInfo?: WeekInfo };
    const day = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    if (day && day >= 1 && day <= 7) return day;
  } catch {
    // An engine without week data: Monday.
  }
  return 1;
}

function buildCalendar(pickDay: (day: string) => void) {
  const caption = h("strong", { class: "island-calendar-month", "aria-live": "polite" });
  const week = h("div", { class: "cal-week", role: "grid", "aria-label": local("Haftalık takvim", "Weekly calendar") });
  let offset = 0;
  let lastKey = "";
  let direction = 0;
  /** The day the arrow keys are on (0–6), kept across a week change. */
  let cursor = -1;
  let focusAfter = false;
  const refresh = (force = false) => {
    const today = new Date();
    const start = firstWeekday() % 7;
    const key = `${getLang()}/${start}/${today.toDateString()}/${offset}/${Agenda.all().length}`;
    if (key === lastKey && !force) return;
    lastKey = key;
    const first = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (today.getDay() - start + 7) % 7 + offset * 7, 12);
    const weekday = new Intl.DateTimeFormat(getLang(), { weekday: "short" });
    const full = new Intl.DateTimeFormat(getLang(), { dateStyle: "full" });
    const days = Array.from({ length: 7 }, (_, index) =>
      new Date(first.getFullYear(), first.getMonth(), first.getDate() + index, 12));
    // A week across two months names both: "Kas – Ara 2026", "Dec 2026 – Jan 2027" (dashboard#25).
    const last = days[6];
    const monthYear = new Intl.DateTimeFormat(getLang(), { month: "long", year: "numeric" });
    const short = new Intl.DateTimeFormat(getLang(), { month: "short" });
    const shortYear = new Intl.DateTimeFormat(getLang(), { month: "short", year: "numeric" });
    caption.textContent = first.getMonth() === last.getMonth()
      ? monthYear.format(first)
      : first.getFullYear() === last.getFullYear()
        ? `${short.format(first)} – ${shortYear.format(last)}`
        : `${shortYear.format(first)} – ${shortYear.format(last)}`;
    const todayIndex = days.findIndex((date) => date.toDateString() === today.toDateString());
    const tabStop = cursor >= 0 ? cursor : todayIndex >= 0 ? todayIndex : 0;
    const buttons = days.map((date, i) => {
      const k = dayKey(date);
      const current = i === todayIndex;
      const items = Agenda.on(k);
      const open = items.filter((x) => !x.done).length;
      const dots = h("span", { class: "cal-dots", "aria-hidden": "true" },
        ...items.slice(0, 3).map((x) => h("i", { class: x.done ? "done" : "" })));
      const label = `${full.format(date)}${items.length ? local(` · ${open} açık iş`, ` · ${open} open`) : ""}`;
      // One day in the Tab order; the arrow keys move between them.
      return h("button", {
        type: "button", role: "gridcell", class: `cal-day${current ? " today" : ""}${date.getDay() % 6 === 0 ? " weekend" : ""}`,
        style: `--i:${i}`, "aria-current": current ? "date" : undefined, title: label, "aria-label": label,
        tabindex: i === tabStop ? 0 : -1,
        onclick: () => pickDay(k),
      }, h("span", { class: "cal-weekday", text: weekday.format(date) }), h("strong", { text: String(date.getDate()) }), dots);
    });
    week.replaceChildren(...buttons);
    if (focusAfter) {
      focusAfter = false;
      buttons[tabStop]?.focus();
    }
    if (direction) {
      week.dataset.slide = direction > 0 ? "next" : "prev";
      // Restart the slide animation.
      void week.offsetWidth;
      direction = 0;
    } else {
      delete week.dataset.slide;
    }
  };
  const goWeek = (step: number) => {
    offset += step;
    direction = step;
    refresh();
  };
  week.addEventListener("keydown", (event) => {
    const buttons = [...week.querySelectorAll<HTMLButtonElement>(".cal-day")];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    let target: number;
    switch (event.key) {
      case "ArrowLeft": target = at - 1; break;
      case "ArrowRight": target = at + 1; break;
      case "Home": target = 0; break;
      case "End": target = 6; break;
      case "PageUp": target = at - 7; break;
      case "PageDown": target = at + 7; break;
      default: return;
    }
    event.preventDefault();
    if (target >= 0 && target <= 6) {
      cursor = target;
      buttons.forEach((b, i) => { b.tabIndex = i === target ? 0 : -1; });
      buttons[target].focus();
      return;
    }
    // Past either end: the week before or after, on the matching day.
    cursor = (target + 7) % 7;
    focusAfter = true;
    goWeek(target < 0 ? -1 : 1);
  });
  const move = (step: number, label: string) => h("button", {
    type: "button", class: "island-calendar-button", title: label, "aria-label": label,
    onclick: () => goWeek(step),
  }, icon(step < 0 ? LINE_ICONS.previous : LINE_ICONS.next, 13));
  const todayButton = h("button", { type: "button", class: "cal-today", text: local("Bugün", "Today"),
    onclick: () => { direction = -offset; offset = 0; cursor = -1; refresh(); } });
  const header = h("div", { class: "island-calendar-head" }, caption, todayButton,
    move(-1, local("Önceki hafta", "Previous week")), move(1, local("Sonraki hafta", "Next week")));
  Agenda.subscribe(() => refresh(true));
  return { el: h("div", { class: "island-calendar" }, header, week), refresh };
}

// ── Weather ──────────────────────────────────────────────────────────────────

function buildWeather(openSettings: (tab: string) => void) {
  const art = h("div", { class: "wx-art" });
  const temp = h("strong", { class: "wx-temp" });
  const condition = h("span", { class: "wx-cond" });
  const place = h("span", { class: "wx-place" });
  const range = h("span", { class: "wx-range" });
  const extra = h("span", { class: "wx-extra" });
  const hours = h("div", { class: "wx-hours" });
  // Metric only (°C, km/h): said where the source is credited (dashboard#22).
  const data = h("div", { class: "wx", hidden: true },
    art,
    h("div", { class: "wx-main" }, temp, condition, h("span", { class: "wx-meta" }, h("span", {}, place, range), extra)),
    hours,
    h("small", { class: "wx-source", text: local("Open-Meteo · °C, km/sa", "Open-Meteo · °C, km/h") }));
  const setup = h("div", { class: "island-weather-setup" },
    h("span", { text: local("Hava durumunu görmek için bir şehir seç.", "Choose a city to see its weather.") }),
    h("button", { type: "button", class: "btn btn-small", text: local("Şehir seç", "Choose city"),
      onclick: () => openSettings("genel") }));
  const el = h("div", { class: "island-weather" }, data, setup);
  let shownKey = "";

  function draw(city: string, w: IslandWeather | null, failed = false) {
    setup.hidden = !!city;
    data.hidden = !city;
    place.textContent = WEATHER_CITIES[city as keyof typeof WEATHER_CITIES] ?? "";
    if (!w) {
      temp.textContent = "—";
      condition.textContent = !city ? "" : failed ? local("Veri alınamadı", "Weather unavailable") : local("Yükleniyor…", "Loading…");
      range.textContent = "";
      extra.textContent = "";
      hours.replaceChildren();
      art.replaceChildren();
      shownKey = "";
      return;
    }
    const tr = getLang() === "tr";
    const isDay = w.isDay ?? true;
    const key = `${w.code}/${isDay}`;
    if (key !== shownKey) {
      shownKey = key;
      art.replaceChildren(weatherIcon(w.code, isDay, 58));
    }
    el.dataset.kind = `${weatherLabel(w.code, false).toLowerCase().replace(/\s+/g, "-")}${isDay ? "" : " night"}`;
    temp.textContent = `${Math.round(w.temperature)}°`;
    condition.textContent = weatherLabel(w.code, tr);
    range.textContent = w.high != null && w.low != null ? ` · ↑${Math.round(w.high)}° ↓${Math.round(w.low)}°` : "";
    extra.textContent = [
      w.feelsLike != null ? local(`Hissedilen ${Math.round(w.feelsLike)}°`, `Feels like ${Math.round(w.feelsLike)}°`) : "",
      // "km/s" reads as kilometres per second in Turkish; per hour is "km/sa".
      w.wind != null ? local(`Rüzgâr ${Math.round(w.wind)} km/sa`, `Wind ${Math.round(w.wind)} km/h`) : "",
    ].filter(Boolean).join(" · ");
    hours.replaceChildren(...(w.hours ?? []).map((hour, i) => h("div", { class: "wx-hour", style: `--i:${i}` },
      h("span", { text: hour.time }),
      weatherIcon(hour.code, Number(hour.time.slice(0, 2)) >= 6 && Number(hour.time.slice(0, 2)) < 19, 24),
      h("strong", { text: `${Math.round(hour.temperature)}°` }))));
  }
  return { el, draw };
}

// ── System ───────────────────────────────────────────────────────────────────

function buildSystem() {
  const gauge = (name: string, cls: string) => {
    // The ring takes its colour from the gauge, so the gauge's "hot" can change
    // it (the class on the ring itself used to pin it, dashboard#4).
    const g = ring(56, 6, "sys-ring");
    const value = h("strong", { class: "sys-value", text: "—" });
    const sub = h("span", { class: "sys-sub" });
    const el = h("div", { class: `sys-gauge ${cls}` },
      h("div", { class: "sys-dial" }, g.svg, value),
      h("span", { class: "sys-name", text: name }), sub);
    return {
      el, sub,
      set(percent: number | null, detail = "") {
        g.set(percent == null ? 0 : percent / 100);
        const shown = percent == null ? "—" : `${Math.round(percent)}%`;
        value.textContent = shown;
        // "100%" needs a smaller size to stay inside its ring.
        value.classList.toggle("wide", shown.length > 3);
        sub.textContent = detail;
        el.classList.toggle("hot", (percent ?? 0) >= 85);
        el.classList.toggle("off", percent == null);
      },
    };
  };
  const cpu = gauge("CPU", "sys-cpu");
  const ram = gauge("RAM", "sys-ram");
  const gpu = gauge("GPU", "sys-gpu");
  const spark = document.createElementNS(SVG_NS, "svg");
  spark.setAttribute("viewBox", "0 0 100 40");
  spark.setAttribute("preserveAspectRatio", "none");
  spark.setAttribute("class", "sys-spark");
  spark.setAttribute("aria-hidden", "true");
  const area = document.createElementNS(SVG_NS, "path");
  area.setAttribute("class", "sys-spark-area");
  const line = document.createElementNS(SVG_NS, "path");
  line.setAttribute("class", "sys-spark-line");
  spark.append(area, line);
  // The latest reading, as a dot at the right end: there from the first reading
  // on, when a single point draws no line yet (dashboard#24).
  const now = h("span", { class: "sys-spark-now", hidden: true });
  const sparkBox = h("div", { class: "sys-spark-box" }, spark, now);
  const sparkLabel = h("span", { class: "sys-spark-label", text: local("CPU · son 1 dk", "CPU · last minute") });
  const name = h("span", { class: "sys-model" });
  const el = h("div", { class: "island-system" },
    cpu.el, ram.el, gpu.el,
    h("div", { class: "sys-history" }, sparkLabel, sparkBox, name));
  const history: number[] = [];
  const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1);

  function drawHistory() {
    const pts = history.map((v, i) => [history.length === 1 ? 100 : (i / (history.length - 1)) * 100, 38 - (v / 100) * 34]);
    const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
    line.setAttribute("d", history.length > 1 ? d : "");
    area.setAttribute("d", history.length > 1 ? `${d} L100 40 L${pts[0][0].toFixed(1)} 40 Z` : "");
    now.hidden = !history.length;
    if (history.length) now.style.top = `${(pts[pts.length - 1][1] / 40) * 100}%`;
  }

  function draw(s: IslandStats | null) {
    if (!s) {
      // Nothing to show: no stale line or name from before either.
      cpu.set(null);
      ram.set(null);
      gpu.set(null, local("yok", "n/a"));
      history.length = 0;
      drawHistory();
      name.textContent = local("Okunamadı", "Unavailable");
      name.title = "";
      return;
    }
    cpu.set(s.cpu, local(`${s.cores} çekirdek`, `${s.cores} cores`));
    ram.set(s.memTotal ? (s.memUsed / s.memTotal) * 100 : null, `${gb(s.memUsed)}/${gb(s.memTotal)} GB`);
    gpu.set(s.gpu, s.gpu == null ? local("okunamadı", "unavailable") : "3D");
    name.textContent = s.cpuName;
    name.title = s.cpuName;
    history.push(s.cpu);
    if (history.length > 30) history.shift();
    drawHistory();
  }
  return { el, draw };
}

// ── The dashboard ────────────────────────────────────────────────────────────

export interface WidgetHooks {
  /** The mascot's reaction (a focus run ending). */
  react?(e: OwlEmote): void;
}

export function buildWidgets(view: "overview" | "empty", openSettings: (tab: string) => void, hooks: WidgetHooks = {}) {
  Agenda.load();
  if (hooks.react) focusReact = hooks.react;
  const label = (tr: string, en: string) => h("span", { class: "island-card-label", text: local(tr, en) });
  const value = () => h("strong", { class: "island-card-value" });
  const focus = buildFocus();
  const openDay = { day: dayKey(new Date()) };
  const agenda = buildAgenda(openDay);
  const weather = buildWeather(openSettings);
  const system = buildSystem();

  const mediaHeading = label("Müzik", "Music");
  const equalizer = h("span", { class: "media-equalizer", "aria-hidden": "true" },
    h("i"), h("i"), h("i"), h("i"));
  const artwork = h("img", { class: "media-artwork", alt: "", hidden: true });
  // The same picture, blurred, behind the whole card.
  const backdrop = h("img", { class: "media-backdrop", alt: "", "aria-hidden": "true", hidden: true });
  artwork.addEventListener("error", () => { artwork.hidden = true; backdrop.hidden = true; });
  // A note while nothing plays; the bars only move to a track (dashboard#20).
  const noteIcon = icon(LINE_ICONS.music, 18);
  noteIcon.classList.add("media-note");
  const cover = h("div", { class: "media-cover", "aria-hidden": "true" }, artwork, equalizer, noteIcon);
  const mediaLabel = value();
  const mediaValue = h("span", { class: "island-card-hint" });
  const setupText = h("span", { class: "island-card-action-text" });
  const mediaSetup = h("button", {
    type: "button", class: "island-card-action", title: local("Medya ayarları", "Media settings"),
    "aria-label": local("Medya ayarları", "Media settings"), onclick: () => openSettings("genel"),
  }, icon(LINE_ICONS.sliders, 13), setupText);
  const elapsed = h("span", { class: "media-time" });
  const total = h("span", { class: "media-time" });
  const fill = h("span", { class: "media-progress-fill" });
  const bar = h("div", {
    class: "media-progress-bar", role: "slider", tabindex: 0,
    "aria-label": local("Parçadaki konum", "Position in track"), "aria-valuemin": 0,
  }, fill);
  const progress = h("div", { class: "media-progress", hidden: true }, elapsed, bar, total);
  const media = h("div", { class: "island-card island-card-media" },
    backdrop, cover, h("div", { class: "media-track" }, mediaHeading, mediaLabel, mediaValue), mediaSetup, progress);
  const home = h("div", { class: "island-dashboard-media" }, media, focus.el);
  const calendar = buildCalendar((day) => {
    openDay.day = day;
    agenda.draw();
    selectPage(DASHBOARD_TABS.findIndex(([k]) => k === "agenda"));
  });
  const contents: Record<PageKey, HTMLElement> = {
    media: home, agenda: agenda.el, calendar: calendar.el, weather: weather.el, system: system.el,
  };
  const panels = DASHBOARD_TABS.map(([key]) => {
    const id = `${view}-${key}`;
    return h("div", { class: "island-dashboard-page", role: "tabpanel", id: `${id}-panel`, tabindex: 0, "aria-labelledby": `${id}-tab` },
      h("div", { class: "island-dashboard-content" }, contents[key]));
  });
  const viewport = h("div", { class: "island-widget-slides" }, ...panels);
  const tabs = DASHBOARD_TABS.map(([key, tr, en, path], i) => {
    const id = `${view}-${key}`;
    return h("button", { type: "button", class: "island-widget-tab", role: "tab", id: `${id}-tab`,
      "aria-controls": `${id}-panel`, onclick: () => selectPage(i) },
      icon(path, 13), h("span", { text: local(tr, en) }));
  });
  const indicator = h("span", { class: "island-widget-indicator", "aria-hidden": "true" });
  const navigation = h("div", { class: "island-widget-tabs", role: "tablist",
    "aria-label": local("Ada kartları", "Island cards") }, indicator, ...tabs);
  const el = h("div", { class: "island-widgets", hidden: true }, navigation, viewport);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let activePage = 0;
  let scrollTimer: number | undefined;

  function markPage(index: number) {
    if (index !== activePage && panels[activePage].contains(document.activeElement)) {
      tabs[index].focus({ preventScroll: true });
    }
    activePage = index;
    navigation.style.setProperty("--tab", String(index));
    tabs.forEach((tab, i) => {
      const active = i === index;
      tab.tabIndex = active ? 0 : -1;
      tab.setAttribute("aria-selected", String(active));
      panels[i].inert = !active;
      panels[i].dataset.active = String(active);
    });
    // The new page wants fresh data now, not at the next tick.
    statsAt = 0;
    refresh();
  }

  function selectPage(index: number) {
    markPage(index);
    viewport.scrollTo({
      top: index * viewport.clientHeight,
      behavior: reducedMotion.matches || document.documentElement.dataset.still ? "instant" : "smooth",
    });
  }

  navigation.addEventListener("keydown", (event) => {
    let index: number;
    switch (event.key) {
      case "ArrowLeft": index = (activePage + tabs.length - 1) % tabs.length; break;
      case "ArrowRight": index = (activePage + 1) % tabs.length; break;
      case "Home": index = 0; break;
      case "End": index = tabs.length - 1; break;
      default: return;
    }
    event.preventDefault();
    selectPage(index);
    tabs[index].focus({ preventScroll: true });
  });
  viewport.addEventListener("scroll", () => {
    window.clearTimeout(scrollTimer);
    scrollTimer = window.setTimeout(() => {
      if (!viewport.clientHeight) return;
      const index = Math.max(0, Math.min(panels.length - 1, Math.round(viewport.scrollTop / viewport.clientHeight)));
      if (index !== activePage) markPage(index);
    }, 100);
  }, { passive: true });
  // Step through one card per touch swipe. Wheel and trackpad scrolling still use native snap.
  let swipeStart: Touch | undefined;
  viewport.addEventListener("touchstart", (event) => {
    swipeStart = event.touches.length === 1 ? event.touches[0] : undefined;
  }, { passive: true });
  viewport.addEventListener("touchcancel", () => { swipeStart = undefined; }, { passive: true });
  viewport.addEventListener("touchend", (event) => {
    const start = swipeStart;
    swipeStart = undefined;
    const end = event.changedTouches[0];
    if (!start || !end || end.identifier !== start.identifier) return;
    const dy = start.clientY - end.clientY;
    if (Math.abs(dy) < 26 || Math.abs(dy) <= Math.abs(start.clientX - end.clientX)) return;
    event.preventDefault();
    const index = activePage + Math.sign(dy);
    if (index >= 0 && index < panels.length) selectPage(index);
  }, { passive: false });

  let currentMedia: IslandMedia | null = null;
  let city = "";
  let weatherAt = 0;
  let mediaAt = 0;
  let statsAt = 0;
  let busy = false;
  let weatherVersion = 0;
  let mediaVersion = 0;
  let wake: number | undefined;
  let mediaEnabled: boolean | undefined;

  /** The last reading, so the bar can move every second between polls. */
  let snapshot: { position: number; duration: number; at: number } | null = null;
  const clock = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    const hh = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const pad = (n: number) => String(n).padStart(2, "0");
    return hh ? `${hh}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
  };
  const position = () => {
    if (!snapshot) return 0;
    const moved = currentMedia?.playing ? Date.now() - snapshot.at : 0;
    return Math.min(snapshot.duration, snapshot.position + moved);
  };
  function drawProgress() {
    progress.hidden = !snapshot;
    if (!snapshot) return;
    const at = position();
    fill.style.width = `${(at / snapshot.duration) * 100}%`;
    elapsed.textContent = clock(at);
    total.textContent = clock(snapshot.duration);
    bar.setAttribute("aria-valuemax", String(Math.round(snapshot.duration / 1000)));
    bar.setAttribute("aria-valuenow", String(Math.round(at / 1000)));
    bar.setAttribute("aria-valuetext", `${clock(at)} / ${clock(snapshot.duration)}`);
    bar.classList.toggle("can-seek", Boolean(currentMedia?.canSeek));
    bar.setAttribute("aria-disabled", String(!currentMedia?.canSeek));
  }

  async function send(name: MediaAction, positionMs?: number) {
    if (!currentMedia || busy) return;
    const source = currentMedia.source;
    busy = true;
    mediaVersion++;
    controls.setAttribute("aria-busy", "true");
    let ok = false;
    try {
      ok = Boolean(await Bridge.islandMediaControl(source, name, positionMs));
      if (!ok && currentMedia?.source === source) {
        mediaValue.textContent = local("Medya komutu uygulanamadı", "Media command unavailable");
      }
    } finally {
      busy = false;
      controls.removeAttribute("aria-busy");
      mediaAt = ok ? 0 : Date.now() + 2_000;
      refresh();
    }
  }
  const seek = (ms: number) => {
    if (!snapshot || !currentMedia?.canSeek) return;
    const target = Math.max(0, Math.min(snapshot.duration - 1_000, ms));
    snapshot = { ...snapshot, position: target, at: Date.now() };
    drawProgress();
    void send("seek", target);
  };
  bar.addEventListener("click", (event) => {
    if (!snapshot) return;
    const rect = bar.getBoundingClientRect();
    seek(((event.clientX - rect.left) / rect.width) * snapshot.duration);
  });
  bar.addEventListener("keydown", (event) => {
    const step = event.key === "ArrowRight" ? 10_000 : event.key === "ArrowLeft" ? -10_000 : 0;
    if (!step) return;
    event.preventDefault();
    seek(position() + step);
  });

  const action = (glyph: keyof typeof MEDIA_ICONS, text: string, name: "previous" | "toggle" | "next") => {
    const button = h("button", {
      type: "button", class: name === "toggle" ? "media-button media-toggle" : "media-button",
      title: text, "aria-label": text,
    }, mediaIcon(glyph));
    button.addEventListener("click", () => void send(name));
    return button;
  };
  const back = action("previous", local("Önceki parça", "Previous track"), "previous");
  const play = action("play", local("Oynat", "Play"), "toggle");
  const next = action("next", local("Sonraki parça", "Next track"), "next");
  const controls = h("div", { class: "island-media-buttons", hidden: true }, back, play, next);
  media.append(controls);

  function drawMedia(result: IslandMedia | null) {
    currentMedia = result;
    const spotify = result?.source.toLowerCase().includes("spotify") ?? false;
    const on = State.settings.islandMedia;
    media.classList.toggle("is-spotify", spotify);
    media.classList.toggle("is-playing", result?.playing ?? false);
    media.classList.toggle("has-track", !!result);
    media.classList.toggle("is-off", !on);
    const provider = spotify ? "Spotify" : local("Müzik", "Music");
    const playback = result?.playing ? local("Çalıyor", "Playing") : local("Duraklatıldı", "Paused");
    mediaHeading.textContent = result ? `${provider} · ${playback}` : provider;
    // Off, or on with nothing playing: the card says which, never "Now playing".
    mediaLabel.textContent = result
      ? result.title || local("Adsız parça", "Untitled track")
      : on ? local("Çalan bir şey yok", "Nothing playing") : local("Müzik kartı kapalı", "Music card is off");
    mediaLabel.title = result?.title || "";
    mediaValue.textContent = result
      ? result.artist || ""
      : on ? local("Bir çalar başlatınca burada görünür", "Start a player and it shows up here")
        : local("Çalan parçayı görmek için aç", "Turn it on to see what's playing");
    mediaValue.title = result?.artist || "";
    // Off: the settings button says what it is for.
    setupText.textContent = on ? "" : local("Aç", "Turn on");
    mediaSetup.classList.toggle("labelled", !on);
    mediaSetup.title = on ? local("Medya ayarları", "Media settings") : local("Müzik kartını Ayarlar'dan aç", "Turn the music card on in Settings");
    if (result?.artwork) {
      if (artwork.getAttribute("src") !== result.artwork) {
        artwork.src = result.artwork;
        backdrop.src = result.artwork;
        artwork.hidden = false;
        backdrop.hidden = false;
      }
    } else {
      artwork.hidden = true;
      backdrop.hidden = true;
      artwork.removeAttribute("src");
      backdrop.removeAttribute("src");
    }
    media.classList.toggle("has-art", Boolean(result?.artwork));
    snapshot = result && result.durationMs && result.positionMs !== null
      ? { position: result.positionMs, duration: result.durationMs, at: Date.now() }
      : null;
    drawProgress();
    if (play.dataset.playing !== String(Boolean(result?.playing))) {
      play.dataset.playing = String(Boolean(result?.playing));
      play.replaceChildren(mediaIcon(result?.playing ? "pause" : "play"));
    }
    const playLabel = result?.playing ? local("Duraklat", "Pause") : local("Oynat", "Play");
    play.title = playLabel;
    play.setAttribute("aria-label", playLabel);
    back.disabled = !result?.canPrevious;
    play.disabled = !result?.canToggle;
    next.disabled = !result?.canNext;
    controls.hidden = !result;
  }

  const page = () => DASHBOARD_TABS[activePage][0];
  // One read of each at a time: a player that hangs must not pile up calls.
  let mediaPending = false;
  let statsPending = false;

  function refresh() {
    const nextCity = State.settings.islandWeatherCity;
    const mediaOn = State.settings.islandMedia;
    if (city !== nextCity) {
      city = nextCity;
      weatherAt = 0;
      weatherVersion++;
      weather.draw(city, null);
    }
    if (mediaEnabled !== mediaOn) {
      mediaVersion++;
      mediaAt = 0;
      mediaEnabled = mediaOn;
      drawMedia(null);
    }
    calendar.refresh();
    el.dataset.mascotTheme = State.settings.mascotTheme;
    el.hidden = false;
    const shown = State.mode === "expanded" && State.view === view && el.isConnected;
    focus.refresh(shown && page() === "media");
    drawProgress();
    if (!shown) return;
    if (wake === undefined) {
      wake = window.setTimeout(() => {
        wake = undefined;
        refresh();
      }, 1_000);
    }
    const now = Date.now();
    if (city && now >= weatherAt) {
      const version = ++weatherVersion;
      weatherAt = now + 60_000;
      void Bridge.islandWeather(city).then((result) => {
        if (weatherVersion !== version) return;
        weather.draw(city, result, !result);
        if (result) weatherAt = Date.now() + 600_000;
      });
    }
    // Media and system numbers are read only while their card is on screen.
    if (page() === "media" && mediaOn && !busy && !mediaPending && now >= mediaAt) {
      const version = ++mediaVersion;
      mediaAt = now + 4_000;
      mediaPending = true;
      void Bridge.islandMedia(true).then((result) => {
        mediaPending = false;
        if (mediaVersion === version) drawMedia(result);
      }, () => { mediaPending = false; });
    }
    if (page() === "system" && !statsPending && now >= statsAt) {
      statsAt = now + 2_000;
      statsPending = true;
      void Bridge.islandStats().then((result) => {
        statsPending = false;
        system.draw(result);
      }, () => { statsPending = false; });
    }
  }

  agenda.draw();
  markPage(0);
  return { el, refresh };
}
