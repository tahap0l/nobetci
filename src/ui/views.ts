// Island views: header, session overview and detail, empty state and the
// approval card. Plain DOM, rebuilt only when what it shows actually changed.
//
// The card shows text an attacker may control (a prompt-injected command), in a
// window that can approve that command. So nothing here goes through innerHTML:
// every piece is a text node, and a bug in this file cannot become script.

import { drawOwlMini } from "../baykus/mini";
import type { OwlMood } from "../baykus/owl";
import type { DecisionOptions, RiskAssessment, RiskLevel } from "../core/bridge";
import { Sound } from "../core/sound";
import {
  LEVEL_ORDER, State, needsHold, type Approval, type IslandView, type Session, type SessionState,
} from "../core/state";
import { t } from "../i18n/island";
import { toolLabel } from "../island/hooks";
import { HEADER_H } from "../island/layout";
import { clear, h } from "./dom";
import { LEVEL_LABEL } from "./labels";

export interface ViewHost {
  el: HTMLElement;
  sync(): void;
  /** Height the island should have while this view is up. */
  height(): number;
  tick?(now: number): void;
}

export interface ViewActions {
  /** `allow_confirmed` is only ever sent after a completed hold. */
  decide(requestId: string, decision: "allow" | "allow_confirmed" | "deny", opts?: DecisionOptions): void;
  handToTerminal(requestId: string): void;
  openFolder(cwd: string): void;
  focusSession(id: string): void;
  showSession(id: string): void;
  back(): void;
  forgetSession(id: string): void;
  openSettings(tab?: string): void;
  collapse(): void;
  togglePause(): void;
  toggleDnd(): void;
}

// ── Labels ────────────────────────────────────────────────────────────────────

function stateLabel(s: SessionState): string {
  return t(`state.${s}`);
}

const STATE_MOOD: Record<SessionState, OwlMood> = {
  idle: "idle",
  thinking: "thinking",
  working: "working",
  approval: "approval",
  question: "question",
  finished: "finished",
  error: "error",
  ratelimit: "question",
};

function quietLabel(why: string): string {
  return why === "dnd" || why === "hours" || why === "fullscreen" ? t(`quiet.${why}`) : why;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return t("time.s", { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return t("time.min", { n: m });
  return t("time.h", { n: Math.round(m / 60) });
}

function duration(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return t("time.s", { n: Math.max(0, Math.round(ms / 1000)) });
  if (m < 60) return t("time.min", { n: m });
  return t("time.hmin", { h: Math.floor(m / 60), m: m % 60 });
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function clock(t: number): string {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ── Icons (24×24 paths) ───────────────────────────────────────────────────────

function icon(path: string, size = 14): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const el = document.createElementNS(NS, "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("width", String(size));
  el.setAttribute("height", String(size));
  el.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", path);
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", "currentColor");
  p.setAttribute("stroke-width", "2");
  p.setAttribute("stroke-linecap", "round");
  p.setAttribute("stroke-linejoin", "round");
  el.append(p);
  return el;
}

const ICON = {
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  close: "M18 6 6 18M6 6l12 12",
  pause: "M10 4H6v16h4zM18 4h-4v16h4z",
  play: "M6 4l14 8-14 8z",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  window: "M3 5h18v14H3zM3 9h18",
  back: "M15 18l-6-6 6-6",
  trash: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14",
  terminal: "M4 17l6-5-6-5M12 19h8",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  info: "M12 16v-4M12 8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z",
  chevron: "M6 9l6 6 6-6",
  stop: "M6 6h12v12H6z",
  rule: "M4 6h16M4 12h10M4 18h6",
};

// ── Mini owls (session rows and the compact island) ───────────────────────────

const minis = new Set<{ canvas: HTMLCanvasElement; session: Session }>();

function miniCanvas(session: Session, size: number): HTMLCanvasElement {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = h("canvas", { class: "mini-owl" });
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const m = { canvas, session };
  minis.add(m);
  // Drawn right away: the frame loop may already be asleep when a row is rebuilt.
  paintMini(m, performance.now() / 1000);
  return canvas;
}

function paintMini(m: { canvas: HTMLCanvasElement; session: Session }, t: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const ctx = m.canvas.getContext("2d");
  if (!ctx) return;
  const size = m.canvas.width / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  drawOwlMini(ctx, size / 2, size / 2, size, STATE_MOOD[m.session.state], m.session.accent, t);
}

/** Redraws every mini owl still in the document; forgets the detached ones. */
export function drawMinis(t: number) {
  for (const m of minis) {
    if (!m.canvas.isConnected) {
      // Built but not attached yet is fine; only forget canvases that were dropped.
      if (m.canvas.dataset.attached) minis.delete(m);
      continue;
    }
    m.canvas.dataset.attached = "1";
    paintMini(m, t);
  }
}

// ── Header ────────────────────────────────────────────────────────────────────

function buildHeader(actions: ViewActions): ViewHost {
  const status = h("span", { class: "hdr-status" });
  const dndBtn = h("button", { class: "icon-btn", onclick: () => actions.toggleDnd() }, icon(ICON.moon));
  const pauseBtn = h("button", { class: "icon-btn", onclick: () => actions.togglePause() });
  const el = h(
    "div",
    { id: "header" },
    h("span", { class: "hdr-title", text: "Nöbetçi" }),
    status,
    h("span", { class: "grow" }),
    dndBtn,
    pauseBtn,
    h("button", { class: "icon-btn", title: t("hdr.settings"), onclick: () => actions.openSettings() }, icon(ICON.gear)),
    h("button", { class: "icon-btn", title: t("hdr.close"), onclick: () => actions.collapse() }, icon(ICON.close)),
  );
  let key = "";
  return {
    el,
    height: () => HEADER_H,
    sync() {
      const n = State.sessions.length;
      const waiting = State.approvals.length;
      const quiet = State.settings.dnd ? "dnd" : State.quiet;
      const next = `${n}|${waiting}|${State.paused}|${quiet}`;
      if (next === key) return;
      key = next;
      const parts: string[] = [n === 0 ? t("hdr.noSessions") : t("hdr.sessions", { n })];
      if (waiting) parts.push(t("hdr.waiting", { n: waiting }));
      if (State.paused) parts.push(t("hdr.paused"));
      if (quiet) parts.push(t("hdr.quiet", { why: quietLabel(quiet) }));
      status.textContent = parts.join(" · ");
      status.classList.toggle("warn", waiting > 0);
      dndBtn.classList.toggle("on", State.settings.dnd);
      dndBtn.title = State.settings.dnd ? t("hdr.dndOn") : t("hdr.dnd");
      clear(pauseBtn);
      pauseBtn.append(icon(State.paused ? ICON.play : ICON.pause));
      pauseBtn.title = State.paused ? t("hdr.resume") : t("hdr.pause");
    },
  };
}

// ── Overview ──────────────────────────────────────────────────────────────────

const MAX_ROWS = 5;
const ROW_H = 44;

function buildOverview(actions: ViewActions): ViewHost {
  const list = h("div", { class: "sessions" });
  const el = h("div", { class: "view view-overview" }, list);
  let key = "";

  const row = (s: Session) =>
    h(
      "button",
      { class: `session state-${s.state}`, title: t("ov.details"), onclick: () => actions.showSession(s.id) },
      miniCanvas(s, 20),
      h(
        "span",
        { class: "session-main" },
        h(
          "span",
          { class: "session-top" },
          h("span", { class: "session-name", text: s.name }),
          h("span", { class: "session-state", text: stateLabel(s.state) }),
          h("span", { class: "session-age", "data-since": s.stateSince }),
        ),
        h("span", { class: "session-step", text: State.lastStep(s) || "—" }),
      ),
    );

  return {
    el,
    height: () => {
      const rows = Math.min(MAX_ROWS, State.sessions.length) + (State.sessions.length > MAX_ROWS ? 0.5 : 0);
      return Math.max(150, HEADER_H + 14 + rows * ROW_H + 12);
    },
    sync() {
      const shown = State.sessions.slice(0, MAX_ROWS);
      const next =
        shown.map((s) => `${s.id}:${s.state}:${s.name}:${s.steps.length}:${State.lastStep(s)}`).join("|") +
        `#${State.sessions.length}`;
      if (next === key) return;
      key = next;
      list.replaceChildren(...shown.map(row));
      if (State.sessions.length > MAX_ROWS) {
        list.append(h("div", { class: "more", text: t("ov.more", { n: State.sessions.length - MAX_ROWS }) }));
      }
    },
    tick() {
      const now = Date.now();
      for (const age of el.querySelectorAll<HTMLElement>(".session-age")) {
        const text = ago(now - Number(age.dataset.since));
        if (age.textContent !== text) age.textContent = text;
      }
    },
  };
}

// ── Session detail ────────────────────────────────────────────────────────────

const TIMELINE_ROWS = 7;

function buildSession(actions: ViewActions): ViewHost {
  const owlSlot = h("span", { class: "detail-mini" });
  const name = h("span", { class: "detail-name" });
  const state = h("span", { class: "session-state" });
  const meta = h("div", { class: "detail-meta" });
  const timeline = h("ol", { class: "timeline" });
  const goBtn = h("button", { class: "btn btn-small" }, icon(ICON.window, 13), ` ${t("sd.goto")}`);
  const folderBtn = h("button", { class: "btn btn-small btn-ghost" }, icon(ICON.folder, 13), ` ${t("sd.folder")}`);
  const forgetBtn = h("button", { class: "btn btn-small btn-ghost", title: t("sd.forget") }, icon(ICON.trash, 13));
  const el = h(
    "div",
    { class: "view view-session" },
    h(
      "div",
      { class: "detail-head" },
      h("button", { class: "icon-btn", title: t("sd.back"), onclick: () => actions.back() }, icon(ICON.back)),
      owlSlot,
      name,
      state,
      h("span", { class: "grow" }),
      goBtn,
      folderBtn,
      forgetBtn,
    ),
    meta,
    timeline,
  );
  let shownId = "";
  let key = "";

  goBtn.addEventListener("click", () => shownId && actions.focusSession(shownId));
  folderBtn.addEventListener("click", () => {
    const s = State.session(shownId);
    if (s?.cwd) actions.openFolder(s.cwd);
  });
  forgetBtn.addEventListener("click", () => shownId && actions.forgetSession(shownId));

  return {
    el,
    height: () => Math.max(170, HEADER_H + 12 + 34 + 22 + Math.min(TIMELINE_ROWS, State.session(shownId)?.steps.length ?? 1) * 22 + 16),
    sync() {
      const s = State.detailId ? State.session(State.detailId) : undefined;
      if (!s) return;
      if (s.id !== shownId) {
        shownId = s.id;
        owlSlot.replaceChildren(miniCanvas(s, 22));
        key = "";
      }
      name.textContent = s.name;
      name.title = s.cwd;
      state.textContent = stateLabel(s.state);
      state.className = `session-state st-${s.state}`;
      goBtn.style.display = s.parents.length ? "" : "none";
      goBtn.title = s.terminal ? t("sd.gotoTitle", { terminal: s.terminal }) : t("sd.gotoTitleAny");

      const next = `${s.steps.length}:${State.lastStep(s)}:${s.tools}:${s.approved}:${s.denied}`;
      if (next === key) return;
      key = next;
      const bits = [
        s.terminal || null,
        t("sd.tools", { n: s.tools }),
        t("sd.allowed", { n: s.approved }),
        t("sd.denied", { n: s.denied }),
        s.automatic ? t("sd.auto", { n: s.automatic }) : null,
      ].filter(Boolean);
      meta.replaceChildren(
        h("span", { class: "detail-cwd", text: s.cwd || "—" }),
        h("span", { class: "detail-stats", text: bits.join(" · ") }),
        h("span", { class: "detail-age", "data-started": s.startedAt }),
      );
      timeline.replaceChildren(
        ...s.steps
          .slice(-TIMELINE_ROWS)
          .reverse()
          .map((st) =>
            h("li", {}, h("span", { class: "tl-time", text: clock(st.t) }), h("span", { class: "tl-text", text: st.text })),
          ),
      );
    },
    tick() {
      const age = el.querySelector<HTMLElement>(".detail-age");
      if (age) {
        const text = t("sd.started", { d: duration(Date.now() - Number(age.dataset.started)) });
        if (age.textContent !== text) age.textContent = text;
      }
    },
  };
}

// ── Empty ─────────────────────────────────────────────────────────────────────

function buildEmpty(actions: ViewActions): ViewHost {
  const hint = h("p", { class: "empty-hint" });
  const setup = h("button", { class: "btn btn-primary", text: t("empty.install"), onclick: () => actions.openSettings("claude") });
  const el = h("div", { class: "view view-empty" }, h("p", { class: "empty-title", text: t("empty.title") }), hint, setup);
  return {
    el,
    height: () => 150,
    sync() {
      const hooked = State.settings.hooksInstalled;
      hint.textContent = hooked ? t("empty.hooked") : t("empty.unhooked");
      setup.style.display = hooked ? "none" : "";
    },
  };
}

// ── Approval card ─────────────────────────────────────────────────────────────

/**
 * Invisible/bidi characters, and runs of blank lines or spaces long enough to push
 * the rest of a command out of sight.
 */
const HIDDEN = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]|(?:\r?\n[ \t]*){4,}|[ \t]{40,}/g;

/** Appends `text`, making what would hide something visible. */
function appendRevealed(parent: Node, text: string) {
  let i = 0;
  for (const m of text.matchAll(HIDDEN)) {
    parent.appendChild(document.createTextNode(text.slice(i, m.index)));
    const run = m[0];
    let marker: string;
    if (run.includes("\n")) {
      // Keep one line break so the text stays readable, and say how many there were.
      marker = t("ap.blankLines", { n: (run.match(/\n/g) ?? []).length });
      parent.appendChild(document.createTextNode("\n"));
    } else if (run.length > 1) {
      marker = t("ap.spaces", { n: run.length });
    } else {
      marker = `⟦U+${run.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}⟧`;
    }
    parent.appendChild(h("span", { class: "hidden-char", title: t("ap.hiddenChar"), text: marker }));
    if (run.includes("\n")) parent.appendChild(document.createTextNode("\n"));
    i = m.index + run.length;
  }
  parent.appendChild(document.createTextNode(text.slice(i)));
}

/** The target text with every finding's excerpt marked in its level's colour. */
function highlighted(risk: RiskAssessment): DocumentFragment {
  const text = risk.target;
  const marks: { start: number; end: number; level: RiskLevel }[] = [];
  const lower = text.toLowerCase();
  for (const f of risk.findings) {
    const needle = f.excerpt.replace(/…$/, "").trim().toLowerCase();
    if (needle.length < 2) continue;
    const at = lower.indexOf(needle);
    if (at < 0) continue;
    const end = at + needle.length;
    if (marks.some((m) => at < m.end && end > m.start)) continue;
    marks.push({ start: at, end, level: f.level });
  }
  marks.sort((a, b) => a.start - b.start);
  const out = document.createDocumentFragment();
  let i = 0;
  for (const m of marks) {
    appendRevealed(out, text.slice(i, m.start));
    const mark = h("mark", { class: `lvl-${m.level}` });
    appendRevealed(mark, text.slice(m.start, m.end));
    out.appendChild(mark);
    i = m.end;
  }
  appendRevealed(out, text.slice(i));
  return out;
}

function kindTitle(kind: RiskAssessment["kind"]): string {
  return t(`ap.kind.${kind}`);
}

function holdFor(level: RiskLevel): number {
  return level === "critical" ? State.settings.holdCriticalMs : State.settings.holdMs;
}

function buildApproval(actions: ViewActions): ViewHost {
  const chip = h("span", { class: "risk-chip" });
  const who = h("span", { class: "appr-who" });
  const queue = h("span", { class: "appr-queue" });
  const timer = h("span", { class: "appr-timer" });
  const kind = h("div", { class: "appr-kind" });
  const target = h("pre", { class: "appr-target" });
  const overflow = h("div", { class: "appr-overflow", text: t("ap.overflow") });
  const preview = h("pre", { class: "appr-preview" });
  const findings = h("ul", { class: "appr-findings" });
  const ruleNote = h("div", { class: "appr-rule" });
  const warning = h("div", { class: "appr-warning" });
  const note = h("div", { class: "appr-note" });

  const remember = h("input", { type: "checkbox", id: "appr-remember" });
  const rememberRow = h(
    "label",
    { class: "appr-remember", for: "appr-remember" },
    remember,
    h("span", { text: t("ap.remember") }),
  );

  const holdFill = h("span", { class: "hold-fill" });
  const allowLabel = h("span", { class: "hold-label" });
  const allowBtn = h("button", { class: "btn btn-allow" }, holdFill, allowLabel);
  const denyBtn = h("button", { class: "btn btn-deny split-main", text: t("ap.deny") });
  const denyMore = h("button", { class: "btn btn-deny split-more", title: t("ap.denyMore") }, icon(ICON.chevron, 13));
  const denyMenu = h("div", { class: "deny-menu" });
  const denyGroup = h("span", { class: "split" }, denyBtn, denyMore, denyMenu);
  const termBtn = h("button", { class: "btn btn-ghost", title: t("ap.toTerminalTitle") }, icon(ICON.terminal, 13), ` ${t("ap.toTerminal")}`);

  const el = h(
    "div",
    { class: "view view-approval" },
    h("div", { class: "appr-head" }, chip, who, h("span", { class: "grow" }), queue, timer),
    warning,
    ruleNote,
    kind,
    target,
    overflow,
    preview,
    findings,
    note,
    rememberRow,
    h("div", { class: "appr-actions" }, termBtn, h("span", { class: "grow" }), denyGroup, allowBtn),
  );

  let shown: Approval | null = null;

  // ── Deny menu ─────────────────────────────────────────────────────────────
  const closeMenu = () => denyMenu.classList.remove("open");
  const deny = (opts: DecisionOptions) => {
    closeMenu();
    if (shown) actions.decide(shown.requestId, "deny", opts);
  };
  denyBtn.addEventListener("click", () => deny({}));
  denyMore.addEventListener("click", (e) => {
    e.stopPropagation();
    denyMenu.replaceChildren(
      h("div", { class: "menu-title", text: t("ap.menuTitle") }),
      ...State.settings.denyReasons.map((reason) =>
        h("button", { class: "menu-item", text: reason, onclick: () => deny({ message: reason }) }),
      ),
      h("div", { class: "menu-sep" }),
      h(
        "button",
        { class: "menu-item danger", onclick: () => deny({ stop: true, message: t("ap.stopMessage") }) },
        icon(ICON.stop, 12),
        ` ${t("ap.denyStop")}`,
      ),
    );
    denyMenu.classList.toggle("open");
  });
  document.addEventListener("mousedown", (e) => {
    if (!denyGroup.contains(e.target as Node)) closeMenu();
  });

  // ── Hold to confirm ───────────────────────────────────────────────────────
  let holdStart = 0;
  let holdMs = 0;
  let holdRaf = 0;
  let lastQuarter = 0;

  const holdReset = () => {
    cancelAnimationFrame(holdRaf);
    holdStart = 0;
    holdFill.style.transform = "scaleX(0)";
    allowBtn.classList.remove("holding");
  };

  /** Where the Allow button is, for the physical-click check in Rust. */
  const anchor = () => {
    const r = allowBtn.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };

  const holdStep = () => {
    if (!holdStart || !shown) return;
    const p = Math.min(1, (performance.now() - holdStart) / holdMs);
    holdFill.style.transform = `scaleX(${p})`;
    const q = Math.floor(p * 4);
    if (q > lastQuarter && q < 4) {
      lastQuarter = q;
      Sound.play("tick");
    }
    if (p >= 1) {
      const id = shown.requestId;
      holdReset();
      actions.decide(id, "allow_confirmed", { anchor: anchor() });
      return;
    }
    holdRaf = requestAnimationFrame(holdStep);
  };

  allowBtn.addEventListener("pointerdown", (e) => {
    if (!shown || e.button !== 0) return;
    Sound.resume();
    if (!needsHold(shown.risk.level)) return;
    holdMs = holdFor(shown.risk.level);
    holdStart = performance.now();
    lastQuarter = 0;
    allowBtn.classList.add("holding");
    allowBtn.setPointerCapture(e.pointerId);
    holdRaf = requestAnimationFrame(holdStep);
  });
  for (const ev of ["pointerup", "pointercancel", "lostpointercapture"] as const) {
    allowBtn.addEventListener(ev, () => {
      if (holdStart) holdReset();
    });
  }
  allowBtn.addEventListener("click", () => {
    if (!shown || needsHold(shown.risk.level)) return;
    actions.decide(shown.requestId, "allow", { remember: remember.checked, anchor: anchor() });
  });
  termBtn.addEventListener("click", () => shown && actions.handToTerminal(shown.requestId));

  const render = (a: Approval) => {
    const r = a.risk;
    const session = State.session(a.sessionId);
    el.dataset.level = r.level;
    chip.className = `risk-chip lvl-${r.level}`;
    chip.textContent = LEVEL_LABEL[r.level];
    who.textContent = `${session?.name ?? t("ap.session")} · ${toolLabel(a.tool)}`;
    kind.textContent = `${kindTitle(r.kind)}:`;
    target.replaceChildren(highlighted(r));
    target.scrollTop = 0;
    // Say so when the command box scrolls: the part that matters may be below.
    requestAnimationFrame(() => {
      overflow.style.display = target.scrollHeight > target.clientHeight + 2 ? "" : "none";
    });

    preview.style.display = r.preview ? "" : "none";
    preview.replaceChildren();
    if (r.preview) appendRevealed(preview, r.preview);

    const policyNote = a.policy === "strict" ? t("ap.strict") : a.policy === "trusted" ? t("ap.trusted") : "";
    const ruleText = [policyNote, a.note].filter(Boolean).join(" · ");
    ruleNote.replaceChildren();
    if (ruleText) ruleNote.append(icon(ICON.rule, 12), document.createTextNode(` ${ruleText}`));
    ruleNote.style.display = ruleText ? "" : "none";

    findings.replaceChildren(
      ...r.findings.map((f) =>
        h(
          "li",
          { class: `lvl-${f.level}` },
          icon(LEVEL_ORDER[f.level] >= LEVEL_ORDER.high ? ICON.alert : ICON.info, 13),
          h("span", { text: f.label }),
        ),
      ),
    );
    if (!r.findings.length) {
      findings.append(h("li", { class: "lvl-low" }, icon(ICON.shield, 13), h("span", { text: t("ap.noRisk") })));
    }

    const hold = needsHold(r.level);
    const keys = State.settings.hotkeys;
    const hints: string[] = [];
    if (hold) hints.push(t("ap.holdHint", { s: (holdFor(r.level) / 1000).toFixed(1) }));
    else hints.push(t("ap.heuristic"));
    if (keys.deny) hints.push(t("ap.keyDeny", { key: keys.deny }));
    // The allow hotkey only ever covers low risk.
    if (keys.allow && r.level === "low") hints.push(t("ap.keyAllow", { key: keys.allow }));
    note.textContent = hints.join(" · ");

    allowLabel.textContent = hold ? t("ap.holdAllow") : t("ap.allow");
    allowBtn.classList.toggle("needs-hold", hold);
    remember.checked = false;
    // A session grant is an automatic approval: offer it only within the ceiling.
    const ceiling = State.settings.autoAllowMax;
    const grantable = r.level === "low" ? ceiling !== "none" : r.level === "medium" && ceiling === "medium";
    rememberRow.style.display = grantable ? "" : "none";
    closeMenu();
    holdReset();
  };

  return {
    el,
    // Measured from the content, so a one-line command gets a small card and a
    // long script a tall one (capped by the panel; the command box scrolls).
    height: () => Math.max(200, HEADER_H + el.scrollHeight + 12),
    sync() {
      const a = State.currentApproval;
      if (!a) {
        shown = null;
        return;
      }
      if (a !== shown) {
        shown = a;
        render(a);
      }
      queue.textContent = State.approvals.length > 1 ? `1/${State.approvals.length}` : "";
      const w = State.cardWarning && State.cardWarning.requestId === a.requestId ? State.cardWarning.text : "";
      if (warning.textContent !== w) {
        warning.replaceChildren();
        // The icon already says "warning"; drop a leading ⚠ from the message.
        if (w) warning.append(icon(ICON.alert, 14), document.createTextNode(` ${w.replace(/^⚠\s*/, "")}`));
      }
      warning.style.display = w ? "" : "none";
    },
    tick() {
      if (!shown) return;
      const left = shown.expiresAt - Date.now();
      const text = mmss(left);
      if (timer.textContent !== text) timer.textContent = text;
      timer.classList.toggle("urgent", left < 20_000);
    },
  };
}

// ── Greeting placeholder (the canvas lives in the island) ────────────────────

function buildGreeting(): ViewHost {
  const el = h("div", { class: "view view-greeting" });
  return { el, height: () => 150, sync() {} };
}

export function buildViews(actions: ViewActions): { header: ViewHost; views: Map<IslandView, ViewHost> } {
  return {
    header: buildHeader(actions),
    views: new Map<IslandView, ViewHost>([
      ["greeting", buildGreeting()],
      ["overview", buildOverview(actions)],
      ["session", buildSession(actions)],
      ["empty", buildEmpty(actions)],
      ["approval", buildApproval(actions)],
    ]),
  };
}

// ── Compact island content ────────────────────────────────────────────────────

export function buildCompact(): { el: HTMLElement; sync(): void } {
  const text = h("span", { class: "compact-text" });
  const quiet = h("span", { class: "compact-quiet", title: t("cp.quiet") }, icon(ICON.moon, 12));
  const row = h("span", { class: "compact-minis" });
  const el = h("div", { id: "compact" }, text, quiet, row);
  let key = "";
  return {
    el,
    sync() {
      const flash = State.flash && State.flash.until > Date.now() ? State.flash : null;
      const waiting = State.approvals.length;
      let msg: string;
      let tone = "";
      if (waiting) {
        // A waiting request outranks any passing message.
        msg = waiting === 1 ? t("cp.waitingOne") : t("cp.waitingMany", { n: waiting });
        tone = needsHold(State.approvals[0].risk.level) ? "error" : "warn";
      } else if (flash) {
        msg = flash.text;
        tone = flash.tone;
      } else if (State.paused) {
        msg = t("cp.paused");
      } else if (State.sessions.length === 0) {
        msg = t("cp.idle");
      } else {
        const working = State.sessions.filter((s) => s.state === "working" || s.state === "thinking").length;
        msg = working ? t("cp.working", { w: working, n: State.sessions.length }) : t("cp.sessions", { n: State.sessions.length });
      }
      if (text.textContent !== msg) text.textContent = msg;
      text.dataset.tone = tone;
      quiet.style.display = State.isQuiet ? "" : "none";

      const shown = State.sessions.slice(0, 4);
      const next = shown.map((s) => s.id).join("|");
      if (next !== key) {
        key = next;
        row.replaceChildren(...shown.map((s) => miniCanvas(s, 16)));
      }
    },
  };
}
