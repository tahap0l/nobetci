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

export function applyMascotPalette(theme: MascotTheme): void {
  const { bg, accent } = MASCOT_THEMES[theme] ?? MASCOT_THEMES.owl;
  const style = document.documentElement.style;
  for (const [key, value] of Object.entries({
    "--bg": bg,
    "--panel": bg && `color-mix(in srgb, ${bg}, white 7%)`,
    "--card": bg && `color-mix(in srgb, ${bg}, white 7%)`,
    "--accent": accent,
    "--accent-soft": accent && `color-mix(in srgb, ${accent} 14%, transparent)`,
  })) {
    if (value) style.setProperty(key, value);
    else style.removeProperty(key);
  }
}
