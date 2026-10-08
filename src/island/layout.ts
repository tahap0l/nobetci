// Island geometry, in logical pixels. The window is a fixed PANEL_W × PANEL_H
// transparent panel glued to the top edge of the screen; the island is drawn
// inside it, horizontally centred. Everything outside the island shape is
// click-through (decided in Rust from the rect we push).

import type { IslandMode, IslandView } from "../core/state";

/** Must match PANEL_W / PANEL_H in src-tauri/src/island.rs. */
export const PANEL_W = 720;
export const PANEL_H = 460;

/** Width the island retracts to before it slides into the top edge. */
export const HIDDEN_W = 184;
export const COMPACT_W = 300;
export const COMPACT_H = 34;
export const EXPANDED_W = 640;

export const COMPACT_CORNER = 16;
export const EXPANDED_CORNER = 22;

export const HEADER_H = 40;
export const GREETING_H = 150;
/** Room above/below the owl's body inside its canvas for particles. */
export const OWL_OVERHANG = 44;
/** Same margin as the Rust hit test. */
export const HIT_MARGIN = 14;

export function islandSize(mode: IslandMode, view: IslandView, viewHeight: number): { w: number; h: number } {
  switch (mode) {
    case "hidden":
      return { w: HIDDEN_W, h: 0 };
    case "compact":
      return { w: COMPACT_W, h: COMPACT_H };
    case "expanded":
      return { w: EXPANDED_W, h: view === "greeting" ? GREETING_H : Math.min(PANEL_H - 8, viewHeight) };
  }
}

export interface OwlPlacement {
  cx: number;
  cy: number;
  size: number;
  visible: boolean;
}

/** Where the owl sits, relative to the island's top-left corner. */
export function owlPlacement(mode: IslandMode, view: IslandView, islandH: number): OwlPlacement {
  switch (mode) {
    case "hidden":
      return { cx: 26, cy: 12, size: 8, visible: false };
    case "compact":
      return { cx: 24, cy: COMPACT_H / 2 + 1, size: 24, visible: true };
    case "expanded":
      if (view === "greeting") return { cx: EXPANDED_W / 2, cy: 80, size: 60, visible: false };
      if (view === "approval" || view === "session") return { cx: 64, cy: HEADER_H + 50, size: 64, visible: true };
      return { cx: 70, cy: HEADER_H + (islandH - HEADER_H) / 2, size: 68, visible: true };
  }
}
