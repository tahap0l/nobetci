// Thin wrapper over the Tauri commands/events. Every call is a no-op when the
// page is opened in a plain browser, so the UI can be iterated on with
// `npm run dev` alone.

import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { defineMessages } from "../i18n/core";
import type { Settings } from "./settings-model";

export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const msg = defineMessages(
  { notInApp: "Bu, yalnız masaüstü uygulamasında çalışır." },
  { notInApp: "This only works in the desktop app." },
);

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!IS_TAURI) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    console.error(`[nobi] ${cmd} failed`, err);
    return null;
  }
}

/**
 * Same as `call`, but surfaces the error so the UI can show what went wrong.
 * In a plain browser (the preview, the website's demo) it fails with a readable
 * message in the page's language.
 */
async function callOrThrow<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI) throw new Error(msg("notInApp"));
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
  platform: "windows" | "macos" | "linux";
  /** Whether "quiet in full screen" can work here (not on macOS yet). */
  fullscreenSupported: boolean;
  /**
   * Whether the island may approve a request that needs a hold (HIGH,
   * CRITICAL): false where the click guard cannot tell a program's click from a
   * hand's (Linux, D23). Rust then refuses any island allow for such a request
   * with `terminal_only` (C-25). Absent from older builds.
   */
  holdApprovals?: boolean;
}

export interface HookStatus {
  installed: boolean;
  settingsPath: string;
  hookPath: string;
  hookReady: boolean;
  /** Events that currently have a Nobi entry in ~/.claude/settings.json. */
  events: string[];
  /** Some entry points at an old relay path. */
  stale: boolean;
  /** settings.json has someone else's status line; Nobi leaves it alone. */
  foreignStatusLine?: boolean;
  /**
   * Windows only: no spelling of the relay's path runs in both Git Bash and
   * PowerShell, so the hooks run only where Claude Code uses Git Bash
   * (hooks.rs `git_bash_only`).
   */
  gitBashOnly?: boolean;
}

export interface HookPreview {
  diff: string;
  backup: string;
  settingsPath: string;
  /** Hand back to hooksApply so only the reviewed diff is ever written. */
  fingerprint: string;
}

export type AgentProvider = "codex" | "cursor";

export interface AgentHookStatus {
  provider: AgentProvider;
  installed: boolean;
  settingsPath: string;
  hookPath: string;
  hookReady: boolean;
  events: string[];
  stale: boolean;
}

export type AgentHookPreview = HookPreview;

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
  codexActivity: { event: string; at: number } | null;
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
  /**
   * The engine's own level, before a rule re-scored the request (C-2). The allow
   * hotkey and a batch click only cover requests that are low by both. Absent
   * from older payloads: then `level` is the engine's level.
   */
  engineLevel?: RiskLevel;
  kind: "command" | "write" | "read" | "web" | "mcp" | "other";
  target: string;
  preview: string | null;
  previewBefore?: string | null;
  /**
   * A MultiEdit's edits one by one (absent when there are none). `preview` and
   * `previewBefore` then hold all of them joined, for older readers.
   */
  edits?: { before: string; after: string }[];
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
  /** Whether "don't ask again in this session" could take effect for this request. */
  grantable: boolean;
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
  /** The level the request was decided at. */
  level: RiskLevel;
  /** The risk engine's own level, only where a user rule changed it (C-22). */
  engineLevel?: RiskLevel;
  /** The findings as the card showed them, in the language of that day. */
  labels: string[];
  /**
   * The findings' category ids (`risk_categories`), one per label in the same
   * order (C-24). Absent when there were no findings, and in older entries.
   */
  categories?: string[];
  decision: "allow" | "deny" | "none";
  /**
   * user, hotkey, batch, rule, trusted, session, timeout, terminal, cursor,
   * app, paused, busy, unseen, resolved or undelivered (pipe.rs).
   */
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
  action: "toggle" | "deny" | "allow" | "dnd" | "assistant";
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

/** The user's answer to one of Claude's questions, or a verdict on its plan. */
export type InteractiveResponse =
  | { kind: "answers"; answers: Record<string, string> }
  | { kind: "approvePlan" }
  | { kind: "revise"; feedback: string };

export type Anchor = { x: number; y: number; w: number; h: number };

/** `focus`: a focus timer run ended (gated by Rust like the others: toasts on, not quiet). */
export type NotifyKind = "approval" | "finished" | "error" | "waiting" | "focus";
export type QuietReason = "dnd" | "hours" | "fullscreen" | null;

// ── Commands ──────────────────────────────────────────────────────────────────

export interface IslandMedia {
  title: string;
  artist: string;
  source: string;
  playing: boolean;
  artwork: string | null;
  canPrevious: boolean;
  canToggle: boolean;
  canNext: boolean;
  /** Where the track was when it was read, and its length; null when unknown. */
  positionMs: number | null;
  durationMs: number | null;
  canSeek: boolean;
}

export type MediaAction = "previous" | "toggle" | "next" | "seek";

export interface IslandWeather {
  temperature: number;
  code: number;
  feelsLike?: number;
  isDay?: boolean;
  /** km/h */
  wind?: number;
  high?: number | null;
  low?: number | null;
  /** Every third hour from now. */
  hours?: { time: string; temperature: number; code: number }[];
}

export interface IslandStats {
  cpu: number;
  cores: number;
  cpuName: string;
  memUsed: number;
  memTotal: number;
  gpu: number | null;
}

export interface AgendaItem {
  id: string;
  text: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, or null for the whole day. */
  time: string | null;
  done: boolean;
}

export const Bridge = {
  // ── Desktop mascot ────────────────────────────────────────────────────────
  /**
   * The island tells the desktop mascot its mood, reactions and colour. Only
   * the island sends: the mascot's page has no right to emit events (C-13).
   */
  toBuddy: async (event: string, payload: unknown) => {
    if (!IS_TAURI) return;
    try {
      await emit(event, payload);
    } catch (err) {
      console.error(`[nobi] ${event} failed`, err);
    }
  },
  buddyOpenIsland: () => call<void>("buddy_open_island"),
  /**
   * The mascot's page is listening: Rust asks the island ("buddy-ready") to
   * send its mood and colour, so the mascot never emits an event itself.
   */
  buddyReady: () => call<void>("buddy_ready"),
  // ── Assistant ─────────────────────────────────────────────────────────────
  /**
   * Opens an AI app with the prompt; `prefilled` says it went in the address,
   * `maySendOnOpen` that the app may send it as it opens (absent from older
   * builds: then any prefilled prompt may be on its way).
   */
  assistantOpen: (target: string, prompt: string) =>
    callOrThrow<{ prefilled: boolean; maySendOnOpen?: boolean; app: string | null }>("assistant_open", { target, prompt }),
  /** Targets that have a desktop app on this computer. */
  assistantApps: () => call<{ target: string; name: string }[]>("assistant_apps"),
  /** Starts the system's dictation into the focused text box. */
  assistantDictate: () => callOrThrow<void>("assistant_dictate"),
  /** Answers with the Prompt Studio provider. Rejects with a readable message. */
  assistantAsk: (text: string) => callOrThrow<string>("assistant_ask", { text }),
  islandKeyboard: (on: boolean) => call<void>("island_keyboard", { on }),
  setAssistantTarget: (target: string) => call<void>("set_assistant_target", { target }),
  /** Grows (positive) or shrinks the desktop mascot by `step` percent. */
  buddyResizeBy: (step: number) => call<void>("buddy_resize_by", { step }),
  buddyResetPosition: () => call<void>("buddy_reset_position"),

  /**
   * The player that is playing (or paused). Read only while the music card is
   * on, unless `explicit`: the user typed /play, /next or /prev in the
   * assistant (C-19). Either way Rust only asks a player that already runs.
   */
  islandMedia: (includeArtwork = false, explicit = false) =>
    call<IslandMedia>("island_media", { includeArtwork, explicit }),
  /**
   * `positionMs` goes as whole milliseconds. Rust also takes a fraction and
   * rounds it; a value that is not a number, is negative or is past any track
   * makes it refuse the call (widgets.rs `seek_position`, shell-widgets#1).
   */
  islandMediaControl: (source: string, action: MediaAction, positionMs?: number, explicit = false) =>
    call<boolean>("island_media_control", {
      source,
      action,
      positionMs: positionMs == null || !Number.isFinite(positionMs) ? null : Math.max(0, Math.round(positionMs)),
      explicit,
    }),
  islandWeather: (cityId: string) => call<IslandWeather>("island_weather", { cityId }),
  islandStats: () => call<IslandStats>("island_stats"),
  /**
   * The agenda. Rejects with `agenda_unreadable` when agenda.json is there but
   * cannot be read (C-23): that is not an empty day.
   */
  agendaList: () => callOrThrow<AgendaItem[]>("agenda_list"),
  agendaPut: (item: AgendaItem) => callOrThrow<AgendaItem[]>("agenda_put", { item }),
  agendaDelete: (id: string) => callOrThrow<AgendaItem[]>("agenda_delete", { id }),
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
  /** Opens the settings window, optionally on a tab (genel, claude, prompts, guvenlik, kurallar, bildirimler, gecmis, hakkinda). */
  openSettingsWindow: (tab?: string) => call<void>("open_settings_window", { tab: tab ?? null }),
  /** Native folder picker; null when cancelled. */
  pickFolder: (start?: string) => call<string | null>("pick_folder", { start: start ?? null }),
  closeSettingsWindow: () => call<void>("close_settings_window"),

  /** Writes to nobi.log in Nobi's data folder, next to the Rust lines. */
  log: (message: string) => call<void>("log_line", { message }),

  // ── Claude Code hooks ─────────────────────────────────────────────────────
  hooksStatus: () => call<HookStatus>("hooks_status"),
  /** Diff to show before anything is written. `install: false` previews removal. */
  hooksPreview: (install: boolean) => callOrThrow<HookPreview>("hooks_preview", { install }),
  /** Writes ~/.claude/settings.json — only after an explicit click on a reviewed diff. */
  hooksApply: (install: boolean, fingerprint: string) =>
    callOrThrow<string>("hooks_apply", { install, fingerprint }),
  /** End-to-end check: settings.json entries, relay on disk, and a real ping. */
  hooksHealth: (provider?: AgentProvider) => call<HealthReport>("hooks_health", provider ? { provider } : undefined),
  agentHooksStatus: (provider: AgentProvider) => call<AgentHookStatus>("agent_hooks_status", { provider }),
  agentHooksPreview: (provider: AgentProvider, install: boolean) =>
    callOrThrow<AgentHookPreview>("agent_hooks_preview", { provider, install }),
  agentHooksApply: (provider: AgentProvider, install: boolean, fingerprint: string) =>
    callOrThrow<string>("agent_hooks_apply", { provider, install, fingerprint }),

  // ── Prompt review ────────────────────────────────────────────────────────
  rewritePrompt: (text: string, agent: string, provider: "ollama" | "openai", model: string) =>
    callOrThrow<string>("rewrite_prompt", { text, agent, provider, model }),
  openAiKeyStatus: () => callOrThrow<boolean>("openai_api_key_status"),
  saveOpenAiKey: (apiKey: string) => callOrThrow<void>("set_openai_api_key", { apiKey }),
  deleteOpenAiKey: () => callOrThrow<void>("delete_openai_api_key"),

  // ── Permission requests ───────────────────────────────────────────────────
  /**
   * Rejects with an error code when Rust refuses the decision:
   * `not_pending` (the relay gave up), `hold_required` (plain allow on high risk),
   * `input_not_physical` (no real mouse click behind it), `too_soon` (the card
   * had only just appeared), `hotkey_low_only`, `no_hotkey` (a "hotkey" decision
   * with no real key press behind it), `unknown_decision`.
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
  /** Answers a question or a plan; `anchor` is the button pressed. */
  approvalRespond: (requestId: string, response: InteractiveResponse, anchor?: Anchor) =>
    callOrThrow<void>("approval_respond", { requestId, response, anchor: anchor ?? null }),
  /**
   * Allows, with one click, the waiting requests the batch row listed (`ids`);
   * Rust skips any that are no longer pending or not low by both levels (C-2).
   * Resolves to how many it allowed.
   */
  approvalAllowLow: (anchor: Anchor | undefined, ids: string[]) =>
    callOrThrow<number>("approval_allow_low", { anchor: anchor ?? null, ids }),
  /**
   * "The card is up or queued" — until this lands the relay only waits a moment.
   * A repeat (a reloaded island putting its cards back) changes nothing.
   */
  approvalAck: (requestId: string) => call<void>("approval_ack", { requestId }),
  /**
   * Nobody will act on this here — Claude Code asks in the terminal right away.
   * `expired`: the card's countdown ran out on the island (C-6).
   */
  approvalDecline: (requestId: string, reason: "terminal" | "paused" | "busy" | "resolved" | "expired" = "terminal") =>
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
  /**
   * A desktop notification, if settings allow it right now. `islandVisible`:
   * the island is open (expanded) and so already shows it; the compact pill
   * does not count (D4).
   */
  notify: (kind: NotifyKind, title: string, body: string, islandVisible: boolean) =>
    call<boolean>("notify", { kind, title, body, islandVisible }),
  hotkeysStatus: () => call<HotkeyStatus[]>("hotkeys_status"),
};

/**
 * Commands only the island calls (the window permissions let no other window
 * call them, C-13). Kept off `Bridge`, which the settings window takes whole as
 * its own api (and mocks in the browser preview).
 */
export const IslandBridge = {
  /**
   * A card just became the front, clickable one (C-1). Rust refuses an allow
   * that comes too soon after this (`too_soon`), so a click meant for the card
   * before can never land on this one.
   */
  approvalShown: (requestId: string) => call<void>("approval_shown", { requestId }),
  /**
   * Every request still waiting for an answer, as the `hook` event carried it
   * (C-11): the island re-adds the cards when it (re)loads.
   */
  approvalPending: () => call<Record<string, unknown>[]>("approval_pending"),
  /**
   * Why it is quiet right now; rejects when Rust could not be asked, so a failed
   * call is never mistaken for "not quiet" (the island's 60 s check, C-14).
   */
  quietNow: () => callOrThrow<QuietReason>("quiet_state"),
};

export async function onEvent<T>(name: string, handler: (payload: T) => void) {
  if (!IS_TAURI) return () => {};
  return listen<T>(name, (e) => handler(e.payload));
}
