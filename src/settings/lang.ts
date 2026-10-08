// Which language the settings window speaks: the `language` setting resolved
// against the Windows display language Rust reports at boot. In dev, `?lang=tr|en`
// forces one (for README screenshots) until the setting is changed here.

import { resolveLang, setLang, setSystemLang, type Lang, type LangPref } from "../i18n/core";
import { t } from "./i18n";
import { app, devParam } from "./nav";
import { flush, settings, update } from "./store";
import { segmented } from "./ui";

let forced: Lang | null = null;

export function initLanguage(system: Lang) {
  setSystemLang(system);
  const q = devParam("lang");
  forced = q === "tr" || q === "en" ? q : null;
  applyLanguage();
}

/** Re-applies the setting; a no-op (no re-render) when the language is unchanged. */
export function applyLanguage() {
  setLang(forced ?? resolveLang(settings().language));
}

/**
 * Changes the preference. Rust localises its own strings (risk labels, notes,
 * errors) by the saved setting, so the save lands before anything is refetched.
 */
export async function setLanguagePref(pref: LangPref) {
  forced = null;
  update((x) => (x.language = pref));
  await flush();
  applyLanguage();
}

/** "Otomatik (sistem: Türkçe) · Türkçe · English" — language names stay in their own language. */
export function languagePicker(fk: string): HTMLElement {
  const system = t(`lang.${app.systemLang}`);
  return segmented<LangPref>(
    [
      ["auto", t("genel.langAuto", { lang: system })],
      ["tr", t("lang.tr")],
      ["en", t("lang.en")],
    ],
    settings().language,
    (v) => void setLanguagePref(v),
    { fk, label: t("genel.langTitle"), cls: "seg-lang" },
  );
}
