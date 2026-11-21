// The settings window talks to Rust through `api`, which is the real Bridge
// inside Nöbetçi. In a plain browser under `npm run dev` it is swapped for an
// in-memory mock (dynamic import, so production builds never contain it).
//
// A few commands the settings window uses changed shape (hook previews that may
// have no backup, save errors that must be shown, the CSV separator, the rule
// pattern check…). They are declared here, for this window only, so the island's
// Bridge stays as it is and the mock in mock.ts implements exactly this surface.

import { invoke } from "@tauri-apps/api/core";
import {
  Bridge,
  IS_TAURI,
  onEvent,
  type AgentProvider,
  type AuditFilter,
  type BootInfo as CoreBootInfo,
  type HealthReport as CoreHealthReport,
  type HookPreview as CoreHookPreview,
} from "../core/bridge";
import type { RuleMode, Settings } from "../core/settings-model";
import { t } from "./i18n";

/**
 * A reviewed diff for ~/.claude/settings.json (or an agent's hooks.json). Rust
 * keeps exactly what was previewed under `fingerprint` and writes only that.
 * `backup` is null when there is no file yet, so nothing needs backing up.
 */
export type HookPreview = Omit<CoreHookPreview, "backup"> & { backup: string | null };

/** Who owns Claude Code's status line in settings.json. */
export type StatusLineOwner = "ours" | "foreign" | "none";

/** `statusLine` is set by Rust for Claude Code; a foreign one is never "missing". */
export type HealthReport = Omit<CoreHealthReport, "statusLine"> & { statusLine?: StatusLineOwner };

/** `settingsLoadError`: settings.json could not be read at start (defaults are in use). */
export type BootInfo = Omit<CoreBootInfo, "settingsLoadError"> & { settingsLoadError?: string | null };

/** Payload of the `settings-warning` event: something that did not apply (e.g. autostart). */
export interface SettingsWarning {
  code: string;
  detail?: string | null;
}

export type CsvSeparator = "," | ";";

async function invokeOrThrow<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI) throw new Error(t("common.onlyInApp"));
  return invoke<T>(cmd, args);
}

/** The commands whose shape differs from the Bridge, or that only this window uses. */
const settingsCommands = {
  /** Resolves to the settings Rust kept; rejects with `save_failed: …` or `settings_unreadable`. */
  saveSettings: (settings: Settings) => invokeOrThrow<Settings>("save_settings", { settings }),
  boot: () => Bridge.boot() as Promise<BootInfo | null>,
  /** Diff to show before anything is written. Rejects with `relay_missing` when installing without a relay. */
  hooksPreview: (install: boolean) => invokeOrThrow<HookPreview>("hooks_preview", { install }),
  /** Writes exactly the previewed content; resolves to the backup path (null: there was no file). */
  hooksApply: (install: boolean, fingerprint: string) =>
    invokeOrThrow<string | null>("hooks_apply", { install, fingerprint }),
  hooksHealth: (provider?: AgentProvider) => Bridge.hooksHealth(provider) as Promise<HealthReport | null>,
  agentHooksPreview: (provider: AgentProvider, install: boolean) =>
    invokeOrThrow<HookPreview>("agent_hooks_preview", { provider, install }),
  agentHooksApply: (provider: AgentProvider, install: boolean, fingerprint: string) =>
    invokeOrThrow<string | null>("agent_hooks_apply", { provider, install, fingerprint }),
  /** Opens a save dialog; exports everything matching. Resolves to the path, or null if cancelled. */
  auditExport: (filter: AuditFilter, format: "csv" | "json", separator: CsvSeparator = ",") =>
    invokeOrThrow<string | null>("audit_export", {
      filter,
      format,
      tzOffsetMin: new Date().getTimezoneOffset(),
      separator,
    }),
  /** Compiles a rule pattern exactly as rules.rs would; rejects with the error text. */
  rulePatternCheck: (mode: RuleMode, pattern: string) => invokeOrThrow<void>("rule_pattern_check", { mode, pattern }),
};

/** Bridge commands the settings window uses as they are. */
type BridgeUsed = Pick<
  typeof Bridge,
  | "openLocation"
  | "rulesTest"
  | "auditQuery"
  | "pickFolder"
  | "auditStats"
  | "auditProjects"
  | "settingsReset"
  | "settingsImport"
  | "settingsExport"
  | "saveOpenAiKey"
  | "riskCategories"
  | "rewritePrompt"
  | "quietState"
  | "openAiKeyStatus"
  | "notify"
  | "hotkeysStatus"
  | "hooksStatus"
  | "deleteOpenAiKey"
  | "closeSettingsWindow"
  | "buddyResetPosition"
  | "auditClear"
  | "agentHooksStatus"
>;

export type Api = BridgeUsed &
  typeof settingsCommands & {
    onEvent: typeof onEvent;
    /** True when running against the browser mock. */
    mock: boolean;
  };

export let api: Api = { ...Bridge, ...settingsCommands, onEvent, mock: false };

export async function initApi(): Promise<void> {
  if (import.meta.env.DEV && !IS_TAURI) {
    const { createMockApi } = await import("./mock");
    api = createMockApi();
  }
}

// ── Errors ────────────────────────────────────────────────────────────────────

/** Error codes Rust answers with (`code` or `code: detail`); everything else is Rust's own text. */
const CODES = [
  "stale_preview",
  "relay_missing",
  "settings_unreadable",
  "save_failed",
  "not_nobetci_settings",
] as const;
export type ErrCode = (typeof CODES)[number];

function rawText(err: unknown): string {
  const s = err instanceof Error ? err.message : String(err);
  return s.replace(/^Error:\s*/, "");
}

/** The code of a coded error, with what followed the colon. */
export function errCode(err: unknown): { code: ErrCode; detail: string } | null {
  const m = /^([a-z_]+)(?::\s*([\s\S]*))?$/.exec(rawText(err).trim());
  if (!m || !(CODES as readonly string[]).includes(m[1])) return null;
  return { code: m[1] as ErrCode, detail: (m[2] ?? "").trim() };
}

/**
 * Error text for the user: known codes in the UI language, anything else as
 * Rust wrote it (Rust localises its own messages), without the "Error: " a JS
 * Error adds.
 */
export function errText(err: unknown): string {
  const c = errCode(err);
  if (!c) return rawText(err);
  switch (c.code) {
    case "stale_preview":
      return t("err.stalePreview");
    case "relay_missing":
      return t("err.relayMissing");
    case "settings_unreadable":
      return t("err.settingsUnreadable");
    case "save_failed":
      return c.detail ? t("err.saveFailedDetail", { detail: c.detail }) : t("err.saveFailed");
    case "not_nobetci_settings":
      return t("err.notNobetci");
  }
}
