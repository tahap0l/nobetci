// Tiny i18n core shared by both windows. Each area keeps its own messages
// (`defineMessages(tr, en)`); the English table must have every Turkish key, which
// the type system checks. `{name}` placeholders are filled from `vars`.
//
// A key may have a macOS wording next to it as `key@mac` ("Start with Windows" →
// "Start at login"); on a Mac that one wins.

export type Lang = "tr" | "en";
export type LangPref = "auto" | Lang;
export type Platform = "windows" | "macos";

let current: Lang = detectBrowserLang();
let system: Lang = current;
let platform: Platform = detectPlatform();
const listeners = new Set<() => void>();
markPlatform();

function detectPlatform(): Platform {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return /Macintosh|Mac OS X/.test(ua) ? "macos" : "windows";
}

function markPlatform() {
  if (typeof document !== "undefined") document.documentElement.dataset.platform = platform;
}

/** Rust says which OS this is; the user agent is only the first guess. */
export function setPlatform(p: Platform) {
  platform = p;
  markPlatform();
}

export function getPlatform(): Platform {
  return platform;
}

function detectBrowserLang(): Lang {
  const tag = (typeof navigator !== "undefined" && (navigator.languages?.[0] ?? navigator.language)) || "en";
  return tag.toLowerCase().startsWith("tr") ? "tr" : "en";
}

/** Rust knows the system UI language better than the webview does. */
export function setSystemLang(lang: Lang) {
  system = lang;
}

export function resolveLang(pref: LangPref | undefined): Lang {
  return pref === "tr" || pref === "en" ? pref : system;
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang) {
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  if (lang === current) return;
  current = lang;
  for (const fn of listeners) fn();
}

/** Re-render hooks; returns an unsubscribe function. */
export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export type Vars = Record<string, string | number>;

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/**
 * Builds a translator for one area. English must cover every Turkish key.
 *
 *   const t = defineMessages({ hi: "Merhaba {name}" }, { hi: "Hello {name}" });
 *   t("hi", { name: "Ada" })
 */
export function defineMessages<T extends Record<string, string>>(tr: T, en: { [K in keyof T]: string }) {
  return (key: keyof T & string, vars?: Vars): string => {
    const table: Record<string, string> = current === "tr" ? tr : en;
    const mac = platform === "macos" ? table[`${key}@mac`] : undefined;
    return fill(mac ?? table[key] ?? tr[key] ?? key, vars);
  };
}

/** Locale tag for Intl (dates, numbers). */
export function locale(): string {
  return current === "tr" ? "tr-TR" : "en-US";
}

/** "1 session" / "3 sessions" — Turkish never inflects the noun after a number. */
export function plural(n: number, one: string, other: string): string {
  return current === "tr" || n === 1 ? one : other;
}
