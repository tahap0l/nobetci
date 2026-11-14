// The island's agenda, shared by the agenda card, the calendar's dots and the
// compact island's "next up" line. Rust keeps the file; this keeps a copy and
// listens for changes. Outside the app (the browser demo) it lives in memory.

import { Bridge, IS_TAURI, onEvent, type AgendaItem } from "./bridge";

let items: AgendaItem[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function set(next: AgendaItem[] | null) {
  if (!next) return;
  items = [...next].sort((a, b) => `${a.date} ${a.time ?? ""}`.localeCompare(`${b.date} ${b.time ?? ""}`));
  for (const fn of listeners) fn();
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
      set(demoItems());
      return;
    }
    void Bridge.agendaList().then(set);
    void onEvent<AgendaItem[]>("agenda-changed", set);
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
      set([...items.filter((i) => i.id !== item.id), item]);
      return;
    }
    set(await Bridge.agendaPut(item));
  },
  async remove(id: string) {
    if (!IS_TAURI) {
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
