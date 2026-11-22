// Mascot palettes are independent of the approval risk colors.
export const MASCOT_THEMES = {
  owl: { tr: "Baykuş", en: "Owl", bg: "", accent: "", face: "" },
  wolf: { tr: "Kurt", en: "Wolf", bg: "#16191e", accent: "#b9c7d7", face: "#738396" },
  hawk: { tr: "Şahin", en: "Hawk", bg: "#221711", accent: "#eca777", face: "#9c5837" },
  octopus: { tr: "Ahtapot", en: "Octopus", bg: "#20182c", accent: "#61ddcb", face: "#a775d2" },
  lion: { tr: "Aslan", en: "Lion", bg: "#251b10", accent: "#ffc775", face: "#a95c29" },
  canary: { tr: "Kanarya", en: "Canary", bg: "#1d1e17", accent: "#f1e465", face: "#c49d37" },
  eagle: { tr: "Kartal", en: "Eagle", bg: "#121e30", accent: "#a0d5ff", face: "#748ead" },
} as const;

export type MascotTheme = keyof typeof MASCOT_THEMES;

type RGB = readonly [number, number, number];

const WHITE: RGB = [255, 255, 255];
/** The owl's panel and the dashboard's accent: the stylesheet's own defaults (style.css). */
const OWL_PANEL = "#141418";
const OWL_ACCENT = "#aebcff";

function parseHex(hex: string): RGB {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as unknown as RGB;
}

function toHex(c: RGB): string {
  return `#${c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
}

/** `b` mixed into `a` by `t` (0 = a, 1 = b) in sRGB, as color-mix(in srgb, a, b t) does. */
function mixRGB(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function mix(a: RGB, b: RGB, t: number): string {
  return toHex(mixRGB(a, b, t));
}

/** `c` at `alpha`, as color-mix(in srgb, c alpha, transparent) does. */
function alpha(c: RGB, a: number): string {
  return `rgba(${c.join(", ")}, ${a})`;
}

/**
 * The island's colours for a mascot theme. Every value is a plain hex or rgba
 * string worked out here: WebKit before Safari 16.2 (macOS 11 and 12 without
 * Safari updates) has no color-mix(), and a background that uses one is
 * dropped there, rows and cards and all (settings-shell#12). The owl keeps
 * the stylesheet's own panel and accent; the derived shades are set for every
 * theme, the owl included.
 */
export function mascotPalette(theme: MascotTheme): Record<string, string> {
  const { bg, accent } = MASCOT_THEMES[theme] ?? MASCOT_THEMES.owl;
  // Unrounded, so the shades below are worked out the way color-mix() would.
  const panel = bg ? mixRGB(parseHex(bg), WHITE, 0.07) : parseHex(OWL_PANEL);
  const panelHex = toHex(panel);
  const tint = parseHex(accent || OWL_ACCENT);
  return {
    "--bg": bg,
    "--panel": bg ? panelHex : "",
    "--card": bg ? panelHex : "",
    "--accent": accent,
    "--accent-soft": accent ? alpha(parseHex(accent), 0.14) : "",
    // A row under the cursor, and the search field while it has the focus.
    "--panel-hover": mix(panel, WHITE, 0.06),
    "--panel-focus": mix(panel, WHITE, 0.03),
    // The dashboard's cards: the panel with a touch of the accent, and the
    // glow the owl's cards carry (the other themes draw their own).
    "--dash-surface": mix(panel, tint, 0.06),
    "--dash-glow": alpha(tint, 0.17),
    // The accent's own shades, for style.css's stand-ins where color-mix() is
    // missing: tints (rgba(var(--dash-accent-rgb), a)), today in the calendar,
    // the weekend's weekday names.
    "--dash-accent-rgb": tint.join(", "),
    "--dash-accent-light": mix(tint, WHITE, 18 / 118),
    "--dash-weekday": mix(parseHex("#c7c7d3"), tint, 0.6),
  };
}

export function applyMascotPalette(theme: MascotTheme): void {
  const style = document.documentElement.style;
  for (const [key, value] of Object.entries(mascotPalette(theme))) {
    if (value) style.setProperty(key, value);
    else style.removeProperty(key);
  }
}
