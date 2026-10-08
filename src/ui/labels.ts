// User-facing names for risk levels, shared by the island and the settings window.
// Read through getters, so they always follow the current language.

import type { RiskLevel } from "../core/bridge";
import { getLang } from "../i18n/core";

const NAMES: Record<"tr" | "en", Record<RiskLevel, string>> = {
  tr: { low: "DÜŞÜK", medium: "ORTA", high: "YÜKSEK", critical: "KRİTİK" },
  en: { low: "LOW", medium: "MEDIUM", high: "HIGH", critical: "CRITICAL" },
};

export const LEVEL_LABEL = {} as Record<RiskLevel, string>;
for (const level of ["low", "medium", "high", "critical"] as const) {
  Object.defineProperty(LEVEL_LABEL, level, { get: () => NAMES[getLang()][level], enumerable: true });
}
