// The island's agenda, shared by the agenda card, the calendar's dots and the
// compact island's "next up" line. Rust keeps the file; this keeps a copy and
// listens for changes. Outside the app (the browser demo) it lives in memory.

import { Bridge, IS_TAURI, onEvent, type AgendaItem } from "./bridge";

let items: AgendaItem[] = [];
let loaded = false;
const listeners = new Set<() => void>();
/**
 * agenda.json is there but Nöbetçi cannot read it (C-23): the card says so
 * rather than show an empty day, and Rust saves nothing over the file.
 */
let unreadable = false;
let askedAt = 0;
/** How often a card on screen asks again whether the file can be read now. */
const RECHECK_MS = 10_000;

function set(next: AgendaItem[] | null) {
  if (!next) return;
  unreadable = false;
  items = [...next].sort((a, b) => `${a.date} ${a.time ?? ""}`.localeCompare(`${b.date} ${b.time ?? ""}`));
  for (const fn of listeners) fn();
}

/** Asks Rust for the list; `agenda_unreadable` is not an empty day. */
function fetchList() {
  askedAt = Date.now();
  void Bridge.agendaList().then(set, (err: unknown) => {
    const code = (err instanceof Error ? err.message : String(err ?? "")).replace(/^Error:\s*/, "").trim();
    if (code !== "agenda_unreadable" || unreadable) return;
    unreadable = true;
    items = [];
    for (const fn of listeners) fn();
  });
}

/** "YYYY-MM-DD" for a local date. */
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDay(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

export function addDays(key: string, days: number): string {
  const d = parseDay(key);
  d.setDate(d.getDate() + days);
  return dayKey(d);
}

export const Agenda = {
  load() {
    if (loaded) return;
    loaded = true;
    if (!IS_TAURI) {
      // `?agenda=unreadable` in the browser preview: the card as it looks when
      // agenda.json cannot be read.
      if (new URLSearchParams(location.search).get("agenda") === "unreadable") {
        unreadable = true;
        return;
      }
      set(demoItems());
      return;
    }
    fetchList();
    void onEvent<AgendaItem[]>("agenda-changed", set);
  },
  /** agenda.json is there but cannot be read (C-23). */
  unreadable: () => unreadable,
  /**
   * While the file cannot be read, a card on screen asks again now and then:
   * a lock let go, a permission fixed, and the agenda is back.
   */
  recheck() {
    if (unreadable && IS_TAURI && Date.now() - askedAt > RECHECK_MS) fetchList();
  },
  all: () => items,
  on: (day: string) => items.filter((i) => i.date === day),
  /** The next unfinished item today that has a time still ahead. */
  next(now = new Date()): AgendaItem | undefined {
    const today = dayKey(now);
    const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    return items.find((i) => i.date === today && !i.done && i.time && i.time >= clock);
  },
  async put(item: AgendaItem) {
    if (!IS_TAURI) {
      if (unreadable) throw new Error(demoRefusal());
      set([...items.filter((i) => i.id !== item.id), item]);
      return;
    }
    set(await Bridge.agendaPut(item));
  },
  async remove(id: string) {
    if (!IS_TAURI) {
      if (unreadable) throw new Error(demoRefusal());
      set(items.filter((i) => i.id !== id));
      return;
    }
    set(await Bridge.agendaDelete(id));
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  newId: () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
};

/** What Rust answers a change while agenda.json cannot be read (agenda.rs), for the browser preview. */
function demoRefusal(): string {
  return document.documentElement.lang === "en" || location.search.includes("lang=en")
    ? "Nöbetçi couldn't read agenda.json, so it doesn't save over it. Check the file, then try again."
    : "Nöbetçi agenda.json dosyasını okuyamadı, bu yüzden üzerine kaydetmiyor. Dosyayı kontrol edip yeniden dene.";
}

function demoItems(): AgendaItem[] {
  const today = dayKey(new Date());
  const tr = document.documentElement.lang !== "en" && !location.search.includes("lang=en");
  const L = (a: string, b: string) => (tr ? a : b);
  return [
    { id: "d1", text: L("Haftalık ekip toplantısı", "Weekly team sync"), date: today, time: "10:00", done: true },
    { id: "d2", text: L("PR #27'yi incele", "Review PR #27"), date: today, time: "14:30", done: false },
    { id: "d3", text: L("Spor salonu", "Gym"), date: today, time: "19:00", done: false },
    { id: "d4", text: L("Annemi ara", "Call mum"), date: addDays(today, 1), time: null, done: false },
    { id: "d5", text: L("Sunum provası", "Rehearse the talk"), date: addDays(today, 3), time: "11:00", done: false },
  ];
}
