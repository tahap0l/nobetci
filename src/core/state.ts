// App state: Claude Code sessions, the approval queue and preferences.
//
// Every session is tracked on its own (keyed by session_id), so three parallel
// Claude Code windows show up as three rows rather than one blurred status.
// Permission requests queue up instead of bouncing to the terminal.

import type { OwlMood } from "../baykus/owl";
import type { QuietReason, RiskAssessment, RiskLevel } from "./bridge";
import { DEFAULT_SETTINGS, type Settings } from "./settings-model";

export type { Settings } from "./settings-model";

export type IslandMode = "hidden" | "compact" | "expanded";
export type IslandView = "greeting" | "overview" | "empty" | "approval" | "session" | "assistant";

export type SessionState =
  | "idle"
  | "thinking"
  | "working"
  | "approval"
  | "question"
  | "finished"
  | "error"
  | "ratelimit";

export interface Step {
  /** ms since epoch */
  t: number;
  text: string;
}

export interface Session {
  id: string;
  name: string;
  cwd: string;
  accent: string;
  state: SessionState;
  /** Latest steps, newest last. */
  steps: Step[];
  startedAt: number;
  lastEventAt: number;
  /** When `state` last changed, for "finished 12 s ago" style labels. */
  stateSince: number;
  /** Parent-process chain from the relay, nearest first — for "go to window". */
  parents: number[];
  /** Terminal program the session runs in, when the relay could tell. */
  terminal: string;
  /** The agent other than Claude Code that sent it ("Codex", "Cursor"), or "". */
  agent: string;
  tools: number;
  subagents: Set<string>;
  approved: number;
  denied: number;
  automatic: number;
  /** Files changed this session, newest first (kept short). */
  changes: FileChange[];
  usage: SessionUsage | null;
}

/** What identifies the tool call behind a request, to recognise the event that resolves it. */
export interface CallSignature {
  /** Claude Code's id for the call; empty when the event carries none. */
  toolUseId: string;
  /** Tool name and input, whole. */
  content: string;
  /** Tool name and input with every string clipped, for when the relay cut one side. */
  prefix: string;
}

/** A file a session changed, newest first in `Session.changes`. */
export interface FileChange {
  file: string;
  added: number;
  removed: number;
  created: boolean;
  /** Unified-diff lines, possibly cut (`cut`). */
  diff: string;
  cut: boolean;
  t: number;
}

/** What Claude Code's status line last said about a session. */
export interface SessionUsage {
  model: string;
  /** Context window used, percent; null early in a session. */
  context: number | null;
  costUsd: number | null;
  at: number;
}

/** A claude.ai plan window: percent used and when it resets (ms). */
export interface LimitWindow {
  used: number;
  resetsAt: number | null;
}

export interface Approval {
  /** A permission request, or one of Claude's own questions or plans. */
  kind: "permission" | "question" | "plan";
  /** The tool input, for a question's options or a plan's text. */
  input: Record<string, unknown>;
  requestId: string;
  sessionId: string;
  tool: string;
  risk: RiskAssessment;
  /** Why the rules sent it to a person (a rule wanting to allow, a strict project…). */
  note: string | null;
  policy: "trusted" | "normal" | "strict";
  /** Whether "don't ask again in this session" can take effect, as Rust decided. */
  grantable: boolean;
  /** Lives and dies with the card, so nothing is kept for answered requests. */
  signature: CallSignature;
  receivedAt: number;
  /** When the relay gives up and the terminal takes over. */
  expiresAt: number;
}

export type FlashTone = "ok" | "warn" | "error" | "info";

export interface Flash {
  text: string;
  tone: FlashTone;
  until: number;
}

export { DEFAULT_SETTINGS };

/** Matches the Rust side: the relay waits 110 s, Rust answers within 108 s. */
export const DECISION_WINDOW_MS = 108_000;
/** More than this many waiting requests and the rest go straight to the terminal. */
export const MAX_QUEUE = 6;
/** Files kept per session in the change list. */
export const MAX_CHANGES = 12;
const MAX_STEPS = 40;

/** How long a session's "finished" or "error" shows on the mascot. */
export const MOOD_FLASH_MS = 6_000;
/**
 * A working, thinking or waiting session with no event for this long no longer
 * keeps the mascot busy (the overview calls it "no recent events"): a closed
 * terminal must not keep the island animating until the session is pruned.
 */
export const SESSION_QUIET_MS = 3 * 60_000;
/** Calm for this long and the mascot falls asleep (the frame loop then stops). */
export const IDLE_SLEEP_MS = 180_000;

const ACCENTS = ["#60A5FA", "#34D399", "#F472B6", "#FBBF24", "#A78BFA", "#22D3EE", "#FB923C", "#A3E635"];

export const LEVEL_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function needsHold(level: RiskLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER.high;
}

/**
 * Whether a waiting request is low risk in every sense: as the engine scored it
 * and as the rules left it. Only these may go through the allow hotkey or a
 * batch click (Rust checks the same, C-2).
 */
export function isPlainLow(a: Approval): boolean {
  return a.kind === "permission" && a.risk.level === "low" && (a.risk.engineLevel ?? a.risk.level) === "low";
}

type Listener = () => void;

class AppState {
  mode: IslandMode = "hidden";
  view: IslandView = "overview";
  paused = false;
  /** Why it is quiet, as Rust last reported with an event. */
  quiet: QuietReason = null;
  /** Session shown in the detail view. */
  detailId: string | null = null;

  sessions: Session[] = [];
  approvals: Approval[] = [];
  /** claude.ai plan limits from the newest status line, when Claude Code sent them. */
  limits: { fiveHour: LimitWindow | null; sevenDay: LimitWindow | null; at: number } | null = null;
  flash: Flash | null = null;
  /** A warning shown inside the card of one request (e.g. a refused synthetic click). */
  cardWarning: { requestId: string; text: string } | null = null;

  settings: Settings = { ...DEFAULT_SETTINGS };
  version = "";

  /** Cursor in window-logical pixels. */
  mouse = { x: 0, y: 0 };
  lastActivity = performance.now();

  private listeners = new Set<Listener>();
  private accentCursor = 0;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Marks the UI dirty; the island re-renders on the next frame. */
  notify() {
    for (const fn of this.listeners) fn();
  }

  get isQuiet(): boolean {
    return this.settings.dnd || this.quiet !== null;
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  session(id: string): Session | undefined {
    return this.sessions.find((s) => s.id === id);
  }

  /** Finds or creates the session an event belongs to. */
  touch(id: string, cwd: string, name: string): Session {
    const now = Date.now();
    let s = this.session(id);
    if (!s) {
      s = {
        id,
        name,
        cwd,
        accent: this.nextAccent(cwd),
        state: "idle",
        steps: [],
        startedAt: now,
        lastEventAt: now,
        stateSince: now,
        parents: [],
        terminal: "",
        agent: "",
        tools: 0,
        subagents: new Set(),
        approved: 0,
        denied: 0,
        automatic: 0,
        changes: [],
        usage: null,
      };
      this.sessions.push(s);
    }
    if (cwd) s.cwd = cwd;
    if (name) s.name = name;
    s.lastEventAt = now;
    return s;
  }

  setState(s: Session, state: SessionState) {
    if (s.state === state) return;
    s.state = state;
    s.stateSince = Date.now();
  }

  step(s: Session, text: string) {
    const t = text.replace(/\s+/g, " ").trim();
    if (!t) return;
    s.steps.push({ t: Date.now(), text: t });
    if (s.steps.length > MAX_STEPS) s.steps.shift();
  }

  lastStep(s: Session): string {
    return s.steps[s.steps.length - 1]?.text ?? "";
  }

  endSession(id: string) {
    this.sessions = this.sessions.filter((s) => s.id !== id);
    if (this.detailId === id) this.detailId = null;
  }

  /** Drops sessions that went quiet without a SessionEnd (closed terminals). */
  pruneStale() {
    const cutoff = Date.now() - this.settings.staleMinutes * 60_000;
    const before = this.sessions.length;
    this.sessions = this.sessions.filter(
      (s) => s.lastEventAt > cutoff || this.approvals.some((a) => a.sessionId === s.id),
    );
    if (this.detailId && !this.session(this.detailId)) this.detailId = null;
    return this.sessions.length !== before;
  }

  private nextAccent(cwd: string): string {
    // The same project keeps its colour across restarts when it can.
    let hash = 0;
    for (let i = 0; i < cwd.length; i++) hash = (hash * 31 + cwd.charCodeAt(i)) | 0;
    const preferred = ACCENTS[Math.abs(hash) % ACCENTS.length];
    if (!cwd || !this.sessions.some((s) => s.accent === preferred)) return preferred;
    const free = ACCENTS.find((c) => !this.sessions.some((s) => s.accent === c));
    return free ?? ACCENTS[this.accentCursor++ % ACCENTS.length];
  }

  // ── Approvals ─────────────────────────────────────────────────────────────

  get currentApproval(): Approval | null {
    return this.approvals[0] ?? null;
  }

  /** Records a file change on a session, newest first; one row per file. */
  addChange(s: Session, c: FileChange) {
    const prev = s.changes.find((x) => x.file === c.file);
    if (prev) {
      c = { ...c, added: c.added + prev.added, removed: c.removed + prev.removed, created: prev.created || c.created };
    }
    s.changes = [c, ...s.changes.filter((x) => x.file !== c.file)].slice(0, MAX_CHANGES);
  }

  /**
   * Waiting low-risk permission requests: what one batch click may allow. Low
   * as the engine scored it too — a rule that re-scored a request down to low
   * does not make it batchable.
   */
  get lowApprovals(): Approval[] {
    return this.approvals.filter(isPlainLow);
  }

  removeApproval(requestId: string) {
    this.approvals = this.approvals.filter((a) => a.requestId !== requestId);
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  /**
   * The main owl's mood, from everything that is going on. Part of it depends on
   * the clock (a finish shows for a few seconds, calm turns into sleep), so it
   * can change with nothing happening: `moodChangeIn` says when to look again.
   */
  get mood(): OwlMood {
    const a = this.currentApproval;
    // Claude asking something itself (a question, a plan) is a question, not a
    // request for leave.
    if (a) return a.kind !== "permission" ? "question" : needsHold(a.risk.level) ? "danger" : "approval";
    // Paused: nobody is on watch, whatever the sessions were last seen doing.
    if (this.paused) return "sleeping";
    const now = Date.now();
    const recent = (s: Session) => now - s.stateSince < MOOD_FLASH_MS;
    const live = (s: Session) => now - s.lastEventAt < SESSION_QUIET_MS;
    if (this.sessions.some((s) => s.state === "error" && recent(s))) return "error";
    if (this.sessions.some((s) => (s.state === "question" || s.state === "ratelimit") && live(s))) return "question";
    if (this.sessions.some((s) => s.state === "finished" && recent(s))) return "finished";
    if (this.sessions.some((s) => s.state === "working" && live(s))) return "working";
    if (this.sessions.some((s) => s.state === "thinking" && live(s))) return "thinking";
    if (this.settings.dnd) return "sleeping";
    return performance.now() - this.lastActivity > IDLE_SLEEP_MS ? "sleeping" : "idle";
  }

  /**
   * Milliseconds until `mood` may change on its own (a finish or an error
   * fading, a session going quiet, calm turning into sleep); null when only an
   * event can change it.
   */
  moodChangeIn(): number | null {
    if (this.currentApproval || this.paused) return null;
    const now = Date.now();
    let next = Infinity;
    const until = (left: number) => {
      if (left > 0) next = Math.min(next, left);
    };
    for (const s of this.sessions) {
      if (s.state === "error" || s.state === "finished") until(s.stateSince + MOOD_FLASH_MS - now);
      else if (s.state !== "idle" && s.state !== "approval") until(s.lastEventAt + SESSION_QUIET_MS - now);
    }
    if (!this.settings.dnd) until(this.lastActivity + IDLE_SLEEP_MS - performance.now());
    return Number.isFinite(next) ? next : null;
  }

  defaultView(): IslandView {
    if (this.approvals.length) return "approval";
    if (this.detailId && this.session(this.detailId)) return "session";
    return this.sessions.length ? "overview" : "empty";
  }
}

export const State = new AppState();
