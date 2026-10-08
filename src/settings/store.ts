// Settings state for the window: local edits, a debounced auto-save, and a
// three-way merge so Rust's sanitised answer and changes made elsewhere (the
// island toggling DND, an import) land without clobbering what is being typed.

import { DEFAULT_SETTINGS, type Settings } from "../core/settings-model";
import { api } from "./api";

type Key = keyof Settings;
export type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 300;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

let local: Settings = clone(DEFAULT_SETTINGS);
/** Last state Rust confirmed. */
let base: Settings = clone(DEFAULT_SETTINGS);
/** What the save in flight sent, if any. */
let sent: Settings | null = null;
let timer: number | null = null;
let inflight: Promise<void> | null = null;

const changeListeners = new Set<() => void>();
const saveListeners = new Set<(s: SaveState) => void>();
const savedListeners = new Set<() => void>();

/** The live settings. Mutate only through `update`. */
export function settings(): Settings {
  return local;
}

export function initSettings(s: Settings) {
  local = clone({ ...DEFAULT_SETTINGS, ...s });
  base = clone(local);
}

/** Fires when settings changed from outside (Rust sanitising, another window). */
export function onExternalChange(fn: () => void) {
  changeListeners.add(fn);
}

export function onSaveState(fn: (s: SaveState) => void) {
  saveListeners.add(fn);
}

/** Fires after every successful save. */
export function onSaved(fn: () => void) {
  savedListeners.add(fn);
  return () => savedListeners.delete(fn);
}

function emitState(s: SaveState) {
  for (const fn of saveListeners) fn(s);
}

export function update(mut: (s: Settings) => void) {
  mut(local);
  schedule();
}

function schedule() {
  if (timer != null) window.clearTimeout(timer);
  emitState("pending");
  timer = window.setTimeout(() => {
    timer = null;
    void save();
  }, DEBOUNCE_MS);
}

async function save(): Promise<void> {
  if (inflight) {
    // One save at a time; the latest local state follows once it lands.
    await inflight;
  }
  const payload = clone(local);
  sent = payload;
  emitState("saving");
  const run = (async () => {
    const result = await api.saveSettings(payload);
    sent = null;
    if (!result) {
      emitState("error");
      return;
    }
    // Keys edited since sending stay local (another save is already queued).
    const merged = clone(local);
    let changed = false;
    for (const k of Object.keys(result) as Key[]) {
      if (same(local[k], payload[k]) && !same(local[k], result[k])) {
        (merged as unknown as Record<string, unknown>)[k] = clone(result[k]);
        changed = true;
      }
    }
    base = clone(result);
    local = merged;
    emitState(timer != null ? "pending" : "saved");
    for (const fn of savedListeners) fn();
    if (changed) for (const fn of changeListeners) fn();
  })();
  inflight = run;
  try {
    await run;
  } finally {
    if (inflight === run) inflight = null;
  }
}

/** Saves now (e.g. before a hook preview, which reads the stored settings). */
export async function flush(): Promise<void> {
  if (timer != null) {
    window.clearTimeout(timer);
    timer = null;
    await save();
  } else if (inflight) {
    await inflight;
  }
}

/** A `settings-changed` event: apply what changed there, keep what is being edited here. */
export function applyIncoming(incoming: Settings) {
  let changed = false;
  for (const k of Object.keys(incoming) as Key[]) {
    const external = !same(incoming[k], base[k]) && !(sent && same(incoming[k], sent[k]));
    if (external && !same(local[k], incoming[k])) {
      (local as unknown as Record<string, unknown>)[k] = clone(incoming[k]);
      changed = true;
    }
  }
  base = clone(incoming);
  if (changed) for (const fn of changeListeners) fn();
}

/** Replace everything (import / reset), no save. */
export function replaceAll(s: Settings) {
  if (timer != null) {
    window.clearTimeout(timer);
    timer = null;
  }
  local = clone(s);
  base = clone(s);
  emitState("saved");
  for (const fn of changeListeners) fn();
}
