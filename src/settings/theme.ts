// The settings window's colours, worked out from the chosen mascot theme so the
// whole window follows it: background glow, sidebar, header, active states,
// focus ring, dialogs, primary buttons. Every value is a plain hex or rgb string
// computed here — no color-mix(), which older WebKit (macOS 11/12) lacks and
// would then drop the background altogether — and the text on accent-coloured
// buttons is picked for contrast: at least 4.5:1 against both ends of the
// gradient, in every theme.

import { MASCOT_THEMES, type MascotTheme } from "../core/mascot-theme";

type RGB = readonly [number, number, number];

const WHITE: RGB = [255, 255, 255];
const INK: RGB = [11, 11, 14];
const BLACK: RGB = [0, 0, 0];

/** The default (owl) look of the 2.3 refresh. */
const OWL = { bg: "#09090d", accent: "#8b7bff", accent2: "#c18bff" };

function parseHex(hex: string): RGB {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as unknown as RGB;
}

function toHex(c: RGB): string {
  return `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

function rgbList(c: RGB): string {
  return c.map((v) => Math.round(v)).join(", ");
}

/** `b` mixed into `a` by `t` (0 = a, 1 = b), in sRGB like color-mix(in srgb). */
function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function luminance(c: RGB): number {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio. */
export function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Moves `c` toward `to` in small steps until `ok` holds (or it gets there). */
function nudge(c: RGB, to: RGB, ok: (c: RGB) => boolean): RGB {
  let out = c;
  for (let i = 0; i < 40 && !ok(out); i++) out = mix(c, to, (i + 1) / 40);
  return out;
}

export interface SettingsPalette {
  /** CSS custom property → value. */
  vars: Record<string, string>;
  /** Contrast of the button text against the lighter and darker gradient end. */
  buttonContrast: number;
}

/**
 * The palette for one theme. Text on the primary gradient is white when white
 * reads well enough on it, otherwise near-black; if neither reaches 4.5:1 at
 * both ends, the gradient itself is nudged until it does.
 */
export function settingsPalette(theme: MascotTheme): SettingsPalette {
  const def = MASCOT_THEMES[theme] ?? MASCOT_THEMES.owl;
  const owl = !def.accent;
  const accent = parseHex(owl ? OWL.accent : def.accent);
  // The second gradient stop keeps the accent's hue: the owl's orchid is part of
  // its look; the other themes get a lighter step of their own colour.
  const accent2 = owl ? parseHex(OWL.accent2) : mix(accent, WHITE, 0.24);
  // A calm, dark window base that still carries the theme's tint.
  const base = owl ? parseHex(OWL.bg) : mix(parseHex(def.bg), BLACK, 0.3);

  const worst = (text: RGB, a: RGB, b: RGB) => Math.min(contrast(text, a), contrast(text, b));
  const onAccent = worst(WHITE, accent, accent2) >= worst(INK, accent, accent2) ? WHITE : INK;
  const away = onAccent === WHITE ? BLACK : WHITE;
  const g1 = nudge(accent, away, (c) => contrast(onAccent, c) >= 4.6);
  const g2 = nudge(accent2, away, (c) => contrast(onAccent, c) >= 4.6);
  // The switch knob sits on the accent track: it only has to stand out (3:1).
  const knob = contrast(WHITE, accent) >= 3 ? WHITE : INK;

  // Surfaces. Cards stay glassy over the window's glow; dialogs, the drawer and
  // the wizard get an opaque surface so nothing behind them shows through.
  const card = mix(mix(base, WHITE, 0.06), accent, 0.025);
  const surface = mix(mix(base, WHITE, 0.055), accent, 0.03);
  const raised = mix(mix(base, WHITE, 0.12), accent, 0.04);
  const deep = mix(base, BLACK, 0.25);

  const vars: Record<string, string> = {
    "--bg": toHex(base),
    "--accent": toHex(accent),
    "--accent-rgb": rgbList(accent),
    "--accent-2": toHex(accent2),
    "--accent-soft": `rgba(${rgbList(accent)}, 0.15)`,
    "--accent-text": toHex(mix(accent, WHITE, 0.45)),
    "--accent-grad": `linear-gradient(135deg, ${toHex(accent)}, ${toHex(accent2)})`,
    "--btn-grad": `linear-gradient(135deg, ${toHex(g1)}, ${toHex(g2)})`,
    "--on-accent": toHex(onAccent === WHITE ? WHITE : INK),
    "--knob-on": toHex(knob === WHITE ? [242, 242, 244] : INK),
    "--card": `rgba(${rgbList(card)}, 0.72)`,
    "--surface": toHex(surface),
    "--raised": `rgba(${rgbList(raised)}, 0.85)`,
    "--sunk": `rgba(${rgbList(deep)}, 0.7)`,
    "--side-bg": `rgba(${rgbList(mix(base, BLACK, 0.12))}, 0.55)`,
    "--head-bg": `rgba(${rgbList(mix(base, BLACK, 0.05))}, 0.6)`,
    "--glow": `rgba(${rgbList(accent)}, 0.13)`,
    "--glow-2": `rgba(${rgbList(accent2)}, 0.06)`,
  };
  return { vars, buttonContrast: Math.min(contrast(onAccent, g1), contrast(onAccent, g2)) };
}

/** Applies the theme to the settings window (<html> custom properties). */
export function applySettingsTheme(theme: MascotTheme): void {
  const style = document.documentElement.style;
  for (const [k, v] of Object.entries(settingsPalette(theme).vars)) style.setProperty(k, v);
  document.documentElement.dataset.mascotTheme = theme;
}
