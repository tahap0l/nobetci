// Claude Code hook events → sessions, the approval queue and the owl.
//
// Work events (tools, prompts) only update state; the island opens on its own
// for the moments that need a person: a permission request, a session failing or
// waiting for input — and, if asked for, finishing. While quiet (do-not-disturb,
// quiet hours, a full-screen app) nothing pops open or makes a sound; requests
// still queue and wait on the compact island.

import { Bridge, onEvent, type NotifyKind, type QuietReason, type RiskAssessment, type RiskLevel } from "../core/bridge";
import { Sound } from "../core/sound";
import {
  DECISION_WINDOW_MS, MAX_QUEUE, State, needsHold, type Session,
} from "../core/state";
import { t } from "../i18n/island";
import type { Island } from "./island";

interface HookPayload {
  hook_event_name?: string;
  request_id?: string;
  session_id?: string;
  cwd?: string;
  message?: string;
  /** Notification only: permission_prompt, idle_prompt, agent_needs_input, quota_… */
  notification_type?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_use_id?: string;
  error?: string;
  term_program?: string;
  wt_session?: string;
  vscode_pid?: string;
  risk?: RiskAssessment;
  rule_note?: string | null;
  policy?: "trusted" | "normal" | "strict";
  nobetci_parents?: { pid: number; name: string }[];
  nobetci_quiet?: QuietReason;
}

/** Sent by Rust when a rule, a trusted project or a session grant decided. */
interface AutoDecision {
  sessionId: string;
  cwd: string;
  tool: string;
  target: string;
  level: RiskLevel;
  outcome: "allow" | "deny";
  by: "rule" | "trusted" | "session" | null;
  rule: string | null;
  note: string | null;
}

/** tool_use_id, or tool + input: lets a PostToolUse recognise the request it resolves. */
const signatures = new Map<string, string>();

function signature(p: HookPayload): string {
  return p.tool_use_id || `${p.tool_name ?? ""}\u0000${JSON.stringify(p.tool_input ?? {})}`;
}

export function lastPathComponent(p: string): string {
  const cleaned = p.replace(/[\\/]+$/, "");
  const idx = Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/"));
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

/** Tool name → message key for the step line. */
const TOOL_KEYS: Record<string, Parameters<typeof t>[0]> = {
  Bash: "tool.run",
  PowerShell: "tool.run",
  Read: "tool.read",
  Write: "tool.write",
  Edit: "tool.edit",
  MultiEdit: "tool.edit",
  NotebookEdit: "tool.notebook",
  Glob: "tool.search",
  Grep: "tool.search",
  LS: "tool.list",
  WebSearch: "tool.webSearch",
  WebFetch: "tool.fetch",
  TodoWrite: "tool.plan",
  Task: "tool.agent",
  Agent: "tool.agent",
};

export function toolLabel(tool: string): string {
  if (tool.startsWith("mcp__")) return `MCP · ${tool.split("__").pop() ?? tool}`;
  const key = TOOL_KEYS[tool];
  return key ? t(key) : tool;
}

function stepLabel(tool: string, input: Record<string, unknown>): string {
  const label = toolLabel(tool);
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : null);
  const cmd = str("command");
  if (cmd) return `${label} · ${cmd}`;
  const file = str("file_path") ?? str("path") ?? str("notebook_path");
  if (file) return `${label} · ${lastPathComponent(file)}`;
  const q = str("query") ?? str("pattern") ?? str("url") ?? str("description");
  if (q) return `${label} · ${q}`;
  return label;
}

/** TERM_PROGRAM values as macOS terminals set them, and how people call them. */
const TERM_PROGRAMS: Record<string, string> = {
  Apple_Terminal: "Terminal",
  "iTerm.app": "iTerm2",
  WezTerm: "WezTerm",
  ghostty: "Ghostty",
  WarpTerminal: "Warp",
  Hyper: "Hyper",
  Tabby: "Tabby",
};

function terminalName(p: HookPayload): string {
  if (p.wt_session) return "Windows Terminal";
  if (p.vscode_pid || p.term_program === "vscode") return "VS Code";
  const names = (p.nobetci_parents ?? []).map((x) => x.name.toLowerCase());
  if (names.includes("code.exe")) return "VS Code";
  if (names.includes("windowsterminal.exe")) return "Windows Terminal";
  if (names.some((n) => n.startsWith("cursor"))) return "Cursor";
  const program = p.term_program ?? "";
  return TERM_PROGRAMS[program] ?? program;
}

/** Two sessions in folders with the same name must still be told apart. */
function uniqueName(id: string, base: string): string {
  const taken = State.sessions.filter((s) => s.id !== id).map((s) => s.name);
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.includes(candidate)) return candidate;
  }
}

function sessionFor(p: HookPayload): Session {
  const cwd = p.cwd ?? "";
  const id = p.session_id || cwd || "oturum";
  const existing = State.session(id);
  const name = existing?.name ?? uniqueName(id, lastPathComponent(cwd) || t("session.generic"));
  const s = State.touch(id, cwd, name);
  if (p.nobetci_parents?.length) s.parents = p.nobetci_parents.map((x) => x.pid);
  const term = terminalName(p);
  if (term) s.terminal = term;
  return s;
}

/** Drops a session's cards: the request was answered somewhere else. */
function releaseApprovals(sessionId: string, match?: string) {
  for (const a of [...State.approvals]) {
    if (a.sessionId !== sessionId) continue;
    if (match && signatures.get(a.requestId) !== match) continue;
    State.removeApproval(a.requestId);
    signatures.delete(a.requestId);
    void Bridge.approvalDecline(a.requestId, "resolved");
  }
}

function toast(kind: NotifyKind, title: string, body: string) {
  void Bridge.notify(kind, title, body, State.mode !== "hidden");
}

function applyQuiet(p: HookPayload) {
  if (p.nobetci_quiet !== undefined) State.quiet = p.nobetci_quiet ?? null;
  Sound.quiet = State.isQuiet;
}

export function registerHookHandlers(island: Island) {
  void onEvent<HookPayload>("hook", (payload) => {
    handle(island, payload);
    State.notify();
  });
  void onEvent<AutoDecision>("auto-decision", (d) => {
    onAutoDecision(island, d);
    State.notify();
  });

  // Expire cards the relay has already given up on, and forget dead sessions.
  window.setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const a of [...State.approvals]) {
      if (now >= a.expiresAt) {
        State.removeApproval(a.requestId);
        signatures.delete(a.requestId);
        const s = State.session(a.sessionId);
        if (s && s.state === "approval") State.setState(s, "working");
        if (s) State.step(s, t("step.timeout"));
        changed = true;
      }
    }
    if (State.pruneStale()) changed = true;
    if (changed) {
      island.afterApprovalChange();
      State.notify();
    }
  }, 1000);
}

/** Browser preview only (`npm run dev`): feeds a fake event through the real handler. */
export function injectHook(island: Island, payload: HookPayload) {
  handle(island, payload);
  State.notify();
}

function handle(island: Island, p: HookPayload) {
  const event = p.hook_event_name ?? "";
  applyQuiet(p);

  if (event === "PermissionRequest") {
    onPermissionRequest(island, p);
    return;
  }
  if (State.paused) return;

  const known = !!State.session(p.session_id || p.cwd || "oturum");
  const s = sessionFor(p);
  const quiet = State.isQuiet;

  switch (event) {
    case "SessionStart":
      // Also sent on resume, /clear and auto-compaction: only a new session is news.
      if (known) break;
      State.setState(s, "idle");
      State.step(s, `${t("step.started")}${s.terminal ? ` · ${s.terminal}` : ""}`);
      if (!quiet) island.flash(t("fl.sessionStart", { name: s.name }), "info");
      break;

    case "UserPromptSubmit":
      releaseApprovals(s.id);
      State.setState(s, "thinking");
      if (p.prompt ?? p.message) State.step(s, `» ${p.prompt ?? p.message}`);
      break;

    case "PreToolUse": {
      const tool = p.tool_name ?? t("tool.generic");
      s.tools++;
      if (s.state !== "approval") State.setState(s, "working");
      State.step(s, stepLabel(tool, p.tool_input ?? {}));
      break;
    }

    case "PostToolUse":
    case "PostToolUseFailure": {
      releaseApprovals(s.id, signature(p));
      if (!State.approvals.some((a) => a.sessionId === s.id)) State.setState(s, "working");
      if (event === "PostToolUseFailure") State.step(s, t("step.toolFailed"));
      island.afterApprovalChange();
      break;
    }

    case "Notification": {
      const msg = (p.message ?? "").trim();
      const lower = msg.toLowerCase();
      // The type is what hook matchers filter on; the message text is the fallback.
      const type = p.notification_type ?? "";
      if (type === "permission_prompt" || (!type && lower.includes("permission"))) {
        break; // the PermissionRequest card covers it
      }
      if (type.startsWith("quota") || lower.includes("rate limit") || lower.includes("usage limit")) {
        State.setState(s, "ratelimit");
        if (!quiet) island.flash(t("fl.rateLimit", { name: s.name }), "warn");
        Sound.play("error");
      } else if (
        type === "idle_prompt" || type === "agent_needs_input" || type.startsWith("elicitation_dialog") ||
        (!type && (lower.includes("waiting for your input") || msg.endsWith("?")))
      ) {
        State.setState(s, "question");
        if (!quiet) island.flash(t("fl.waiting", { name: s.name }), "warn");
        Sound.play("hoot");
        toast("waiting", t("fl.waiting", { name: s.name }), msg || t("toast.waitingBody"));
      }
      if (msg) State.step(s, msg);
      break;
    }

    case "Stop":
      releaseApprovals(s.id);
      State.setState(s, "finished");
      State.step(s, t("step.turnDone"));
      island.owl.triggerEmote("happy");
      Sound.play("finish");
      toast("finished", t("fl.finished", { name: s.name }), State.lastStep(s));
      if (!quiet) {
        if (State.settings.expandOnFinish && !State.approvals.length) island.showSession(s.id);
        else island.flash(t("fl.finished", { name: s.name }), "ok");
      }
      island.afterApprovalChange();
      break;

    case "StopFailure":
      releaseApprovals(s.id);
      State.setState(s, "error");
      State.step(s, p.error ? `✗ ${p.error}` : t("step.error"));
      if (!quiet) island.flash(t("fl.failed", { name: s.name }), "error");
      Sound.play("error");
      toast("error", t("fl.failed", { name: s.name }), p.error ?? t("toast.errorBody"));
      island.afterApprovalChange();
      break;

    case "SubagentStart":
      State.step(s, t("step.subStart"));
      break;

    case "SubagentStop":
      State.step(s, t("step.subStop"));
      break;

    case "SessionEnd":
      releaseApprovals(s.id);
      State.endSession(s.id);
      island.afterApprovalChange();
      break;
  }
}

function onPermissionRequest(island: Island, p: HookPayload) {
  const requestId = p.request_id ?? "";
  if (!requestId) return;

  // Paused means paused: hand it to the terminal at once instead of letting the
  // relay wait for a card nobody will see.
  if (State.paused || !p.risk) {
    void Bridge.approvalDecline(requestId, "paused");
    return;
  }
  if (State.approvals.length >= MAX_QUEUE) {
    void Bridge.approvalDecline(requestId, "busy");
    return;
  }

  const s = sessionFor(p);
  const now = Date.now();
  State.approvals.push({
    requestId,
    sessionId: s.id,
    tool: p.tool_name ?? t("tool.generic"),
    risk: p.risk,
    note: p.rule_note ?? null,
    policy: p.policy ?? "normal",
    receivedAt: now,
    expiresAt: now + DECISION_WINDOW_MS,
  });
  signatures.set(requestId, signature(p));
  // Queued is as good as shown: a person can act on it, so the long wait begins.
  void Bridge.approvalAck(requestId);

  State.setState(s, "approval");
  const first = State.approvals.length === 1;
  const risky = needsHold(p.risk.level);
  if (first) {
    Sound.play(risky ? "danger" : "approval");
    island.owl.triggerEmote(risky ? "surprised" : "hoot");
  } else {
    Sound.play("blip");
  }
  toast(
    "approval",
    `${risky ? "⚠ " : ""}${t("toast.approval", { name: s.name })}`,
    `${toolLabel(p.tool_name ?? "")}: ${p.risk.target.slice(0, 160)}`,
  );
  island.showApprovals();
}

function onAutoDecision(island: Island, d: AutoDecision) {
  if (State.paused) return;
  const s = sessionFor({ session_id: d.sessionId, cwd: d.cwd });
  const who =
    d.by === "trusted"
      ? t("who.trusted")
      : d.by === "session"
        ? t("who.session")
        : d.rule
          ? t("who.ruleNamed", { rule: d.rule })
          : t("who.rule");
  if (d.outcome === "allow") {
    s.automatic++;
    s.approved++;
    State.step(s, t("step.autoAllow", { who, target: d.target }));
    if (!State.isQuiet && d.by === "rule") island.flash(t("fl.autoAllow", { who, target: d.target }), "ok");
  } else {
    s.automatic++;
    s.denied++;
    State.step(s, t("step.autoDeny", { who, target: d.target }));
    if (!State.isQuiet) island.flash(t("fl.autoDeny", { who, target: d.target }), "error");
    Sound.play("deny");
  }
}
