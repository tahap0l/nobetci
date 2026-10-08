// Thin wrapper over the Tauri commands/events. Every call is a no-op when the
// page is opened in a plain browser, so the UI can be iterated on with
// `npm run dev` alone.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Settings } from "./settings-model";

export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!IS_TAURI) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    console.error(`[nobetci] ${cmd} failed`, err);
    return null;
  }
}

/** Same as `call`, but surfaces the error so the UI can show what went wrong. */
async function callOrThrow<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI) throw new Error("Nöbetçi içinde çalışmıyor");
  return invoke<T>(cmd, args);
}

// ── Types (mirror the Rust structs, camelCase) ────────────────────────────────

export interface BootInfo {
  settings: Settings;
  /** The system's display language, as Rust reads it. */
  systemLang: "tr" | "en";
  /** Hooks were installed before but are gone from ~/.claude/settings.json now. */
  hooksLost: boolean;
  /** Logical screen rect of the monitor the island lives on. */
  screen: { x: number; y: number; width: number; height: number; scale: number };
  version: string;
  hookPath: string;
  /** Which OS this is; a few labels differ ("Start with Windows" / "Start at login"). */
  platform: "windows" | "macos";
  /** Whether "quiet in full screen" can work here (not on macOS yet). */
  fullscreenSupported: boolean;
}

export interface HookStatus {
  installed: boolean;
  settingsPath: string;
  hookPath: string;
  hookReady: boolean;
  /** Events that currently have a Nöbetçi entry in ~/.claude/settings.json. */
  events: string[];
  /** Some entry points at an old relay path. */
  stale: boolean;
}

export interface HookPreview {
  diff: string;
  backup: string;
  settingsPath: string;
  /** Hand back to hooksApply so only the reviewed diff is ever written. */
  fingerprint: string;
}

export interface HealthReport {
  installed: boolean;
  relayPath: string;
  relayExists: boolean;
  settingsPath: string;
  eventsInstalled: string[];
  eventsMissing: string[];
  stale: boolean;
  /** Ping through the real relay and pipe; null when it never arrived. */
  roundtripMs: number | null;
  /** The physical-click guard could register for raw mouse input. */
  inputGuard: boolean;
  error: string | null;
}

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskFinding {
  category: string;
  level: RiskLevel;
  label: string;
  excerpt: string;
}

/** Computed in Rust (src-tauri/src/risk.rs) for every permission request. */
export interface RiskAssessment {
  level: RiskLevel;
  kind: "command" | "write" | "read" | "web" | "mcp" | "other";
  target: string;
  preview: string | null;
  findings: RiskFinding[];
  truncated: boolean;
}

export interface CategoryInfo {
  id: string;
  label: string;
  level: RiskLevel;
  group: "command" | "write" | "read" | "web" | "other";
  /** Cannot be switched off. */
  locked: boolean;
}

/** What the rules make of a request (src-tauri/src/rules.rs). */
export interface Evaluation {
  assessment: RiskAssessment;
  outcome: "ask" | "allow" | "deny";
  by: "rule" | "trusted" | "session" | null;
  rule: string | null;
  note: string | null;
  message: string | null;
  policy: "trusted" | "normal" | "strict";
}

export interface AuditEntry {
  /** ms since epoch */
  ts: number;
  id: string;
  session: string;
  project: string;
  cwd: string;
  tool: string;
  kind: string;
  target: string;
  level: RiskLevel;
  labels: string[];
  decision: "allow" | "deny" | "none";
  /** user, hotkey, rule, trusted, session, timeout, terminal, paused, busy, unseen, resolved */
  by: string;
  rule: string;
  message: string;
  ms: number;
}

export interface AuditFilter {
  text?: string;
  /** Minimum level. */
  level?: "" | RiskLevel;
  decision?: "" | "allow" | "deny" | "none";
  by?: string;
  project?: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
}

export interface AuditPage {
  entries: AuditEntry[];
  total: number;
}

export interface AuditStats {
  total: number;
  allowed: number;
  denied: number;
  unanswered: number;
  automatic: number;
  low: number;
  medium: number;
  high: number;
  critical: number;
  topProjects: [string, number][];
  topTools: [string, number][];
  topLabels: [string, number][];
  days: { date: string; allow: number; deny: number; none: number }[];
  medianMs: number;
}

export interface HotkeyStatus {
  action: "toggle" | "deny" | "allow" | "dnd";
  accel: string;
  ok: boolean;
  error: string | null;
}

export type Decision = "allow" | "allow_confirmed" | "deny";

export interface DecisionOptions {
  /** Told to Claude when denying. */
  message?: string;
  /** Deny and end Claude's turn. */
  stop?: boolean;
  /** Don't ask again for this exact request in this session (≤ medium only). */
  remember?: boolean;
  via?: "user" | "hotkey";
  /**
   * The Allow button's rectangle (window CSS pixels). Rust requires the last
   * physical mouse press to have landed inside it.
   */
  anchor?: { x: number; y: number; w: number; h: number };
}

export type NotifyKind = "approval" | "finished" | "error" | "waiting";
export type QuietReason = "dnd" | "hours" | "fullscreen" | null;

// ── Commands ──────────────────────────────────────────────────────────────────

export const Bridge = {
  boot: () => call<BootInfo>("boot"),

  /** Saves and returns the sanitised settings Rust actually kept. */
  saveSettings: (settings: Settings) => call<Settings>("save_settings", { settings }),
  setDnd: (on: boolean) => call<void>("set_dnd", { on }),
  quietState: () => call<QuietReason>("quiet_state"),

  /** Shrink the window down to the invisible wake strip (hidden) or back to full. */
  setCollapsed: (collapsed: boolean) => call<void>("set_collapsed", { collapsed }),
  /** Pushes the island shape in window coordinates; Rust decides click-through. */
  setIslandRect: (x: number, y: number, width: number, height: number) =>
    call<void>("set_island_rect", { x, y, width, height }),
  reposition: () => call<void>("reposition"),

  /** Opens a session folder in VS Code (or Explorer / Finder). */
  openFolder: (path: string | null) => call<boolean>("open_folder", { path }),
  /** Raises the terminal/editor window of a session from its process chain. */
  focusSession: (pids: number[]) => call<boolean>("focus_session", { pids }),
  /** "log" | "audit" | "settings" | "claude" | "data" — shown in Explorer / Finder. */
  openLocation: (what: string) => call<boolean>("open_location", { what }),

  quit: () => call<void>("quit_app"),
  /** Opens the settings window, optionally on a tab (genel, claude, guvenlik, kurallar, bildirimler, gecmis, hakkinda). */
  openSettingsWindow: (tab?: string) => call<void>("open_settings_window", { tab: tab ?? null }),
  /** Native folder picker; null when cancelled. */
  pickFolder: (start?: string) => call<string | null>("pick_folder", { start: start ?? null }),
  closeSettingsWindow: () => call<void>("close_settings_window"),

  /** Writes to nobetci.log in Nöbetçi's data folder, next to the Rust lines. */
  log: (message: string) => call<void>("log_line", { message }),

  // ── Claude Code hooks ─────────────────────────────────────────────────────
  hooksStatus: () => call<HookStatus>("hooks_status"),
  /** Diff to show before anything is written. `install: false` previews removal. */
  hooksPreview: (install: boolean) => callOrThrow<HookPreview>("hooks_preview", { install }),
  /** Writes ~/.claude/settings.json — only after an explicit click on a reviewed diff. */
  hooksApply: (install: boolean, fingerprint: string) =>
    callOrThrow<string>("hooks_apply", { install, fingerprint }),
  /** End-to-end check: settings.json entries, relay on disk, and a real ping. */
  hooksHealth: () => call<HealthReport>("hooks_health"),

  // ── Permission requests ───────────────────────────────────────────────────
  /**
   * Rejects with an error code when Rust refuses the decision:
   * `not_pending` (the relay gave up), `hold_required` (plain allow on high risk),
   * `input_not_physical` (no real mouse click behind it), `unknown_decision`.
   */
  approvalDecision: (requestId: string, decision: Decision, opts: DecisionOptions = {}) =>
    callOrThrow<void>("approval_decision", {
      requestId,
      decision,
      opts: {
        message: opts.message ?? null,
        stop: opts.stop ?? false,
        remember: opts.remember ?? false,
        via: opts.via ?? "user",
        anchor: opts.anchor ?? null,
      },
    }),
  /** "The card is up or queued" — until this lands the relay only waits a moment. */
  approvalAck: (requestId: string) => call<void>("approval_ack", { requestId }),
  /** Nobody will act on this here — Claude Code asks in the terminal right away. */
  approvalDecline: (requestId: string, reason: "terminal" | "paused" | "busy" | "resolved" = "terminal") =>
    call<void>("approval_decline", { requestId, reason }),

  // ── Risk & rules ──────────────────────────────────────────────────────────
  /** Scores and rule-checks a request; `draft` tests unsaved settings. */
  rulesTest: (tool: string, input: Record<string, unknown>, cwd: string, draft?: Settings) =>
    call<Evaluation>("rules_test", { tool, input, cwd, draft: draft ?? null }),
  riskCategories: () => call<CategoryInfo[]>("risk_categories"),

  // ── History ───────────────────────────────────────────────────────────────
  auditQuery: (filter: AuditFilter) => call<AuditPage>("audit_query", { filter }),
  auditStats: (days: number) =>
    call<AuditStats>("audit_stats", { days, tzOffsetMin: new Date().getTimezoneOffset() }),
  auditClear: () => callOrThrow<void>("audit_clear"),
  /** Every project in the history with its request count, most frequent first. */
  auditProjects: () => call<[string, number][]>("audit_projects"),
  /** Opens a save dialog; exports everything matching (no page cap). Resolves to the path, or null if cancelled. */
  auditExport: (filter: AuditFilter, format: "csv" | "json") =>
    callOrThrow<string | null>("audit_export", { filter, format, tzOffsetMin: new Date().getTimezoneOffset() }),

  // ── Settings file ─────────────────────────────────────────────────────────
  settingsExport: () => callOrThrow<string | null>("settings_export"),
  settingsImport: () => callOrThrow<Settings | null>("settings_import"),
  settingsReset: () => call<Settings>("settings_reset"),

  // ── Notifications & hotkeys ───────────────────────────────────────────────
  /** A desktop notification, if settings allow it right now. */
  notify: (kind: NotifyKind, title: string, body: string, islandVisible: boolean) =>
    call<boolean>("notify", { kind, title, body, islandVisible }),
  hotkeysStatus: () => call<HotkeyStatus[]>("hotkeys_status"),
};

export async function onEvent<T>(name: string, handler: (payload: T) => void) {
  if (!IS_TAURI) return () => {};
  return listen<T>(name, (e) => handler(e.payload));
}
