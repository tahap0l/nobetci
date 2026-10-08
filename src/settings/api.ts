// The settings window talks to Rust through `api`, which is the real Bridge
// inside Nöbetçi. In a plain browser under `npm run dev` it is swapped for an
// in-memory mock (dynamic import, so production builds never contain it).

import { Bridge, IS_TAURI, onEvent } from "../core/bridge";

export type Api = typeof Bridge & {
  onEvent: typeof onEvent;
  /** True when running against the browser mock. */
  mock: boolean;
};

export let api: Api = { ...Bridge, onEvent, mock: false };

export async function initApi(): Promise<void> {
  if (import.meta.env.DEV && !IS_TAURI) {
    const { createMockApi } = await import("./mock");
    api = createMockApi();
  }
}

/** Error text as Rust wrote it, without the "Error: " a JS Error adds. */
export function errText(err: unknown): string {
  const s = err instanceof Error ? err.message : String(err);
  return s.replace(/^Error:\s*/, "");
}
