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
export type IslandView = "greeting" | "overview" | "empty" | "approval" | "session";

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
  tools: number;
  approved: number;
  denied: number;
  automatic: number;
}

export interface Approval {
  requestId: string;
  sessionId: string;
  tool: string;
  risk: RiskAssessment;
  /** Why the rules sent it to a person (a rule wanting to allow, a strict project…). */
  note: string | null;
  policy: "trusted" | "normal" | "strict";
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
const MAX_STEPS = 40;

const ACCENTS = ["#60A5FA", "#34D399", "#F472B6", "#FBBF24", "#A78BFA", "#22D3EE", "#FB923C", "#A3E635"];

export const LEVEL_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function needsHold(level: RiskLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER.high;
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
        tools: 0,
        approved: 0,
        denied: 0,
        automatic: 0,
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

  removeApproval(requestId: string) {
    this.approvals = this.approvals.filter((a) => a.requestId !== requestId);
  }

  // ── Derived ───────────────────────────────────────────────────────────────

  /** The main owl's mood, from everything that is going on. */
  get mood(): OwlMood {
    const a = this.currentApproval;
    if (a) return needsHold(a.risk.level) ? "danger" : "approval";
    const recent = (s: Session) => Date.now() - s.stateSince < 6000;
    if (this.sessions.some((s) => s.state === "error" && recent(s))) return "error";
    if (this.sessions.some((s) => s.state === "question" || s.state === "ratelimit")) return "question";
    if (this.sessions.some((s) => s.state === "finished" && recent(s))) return "finished";
    if (this.sessions.some((s) => s.state === "working")) return "working";
    if (this.sessions.some((s) => s.state === "thinking")) return "thinking";
    if (this.paused || this.settings.dnd) return "sleeping";
    return performance.now() - this.lastActivity > 180_000 ? "sleeping" : "idle";
  }

  defaultView(): IslandView {
    if (this.approvals.length) return "approval";
    if (this.detailId && this.session(this.detailId)) return "session";
    return this.sessions.length ? "overview" : "empty";
  }
}

export const State = new AppState();
