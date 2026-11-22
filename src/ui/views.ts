// Island views: header, session overview and detail, empty state and the
// approval card. Plain DOM, rebuilt only when what it shows actually changed.
//
// The card shows text an attacker may control (a prompt-injected command), in a
// window that can approve that command. So nothing here goes through innerHTML:
// every piece is a text node, and a bug in this file cannot become script.

import { drawOwlMini } from "../baykus/mini";
import type { OwlEmote, OwlMood } from "../baykus/owl";
import {
  IslandBridge, type Anchor, type DecisionOptions, type InteractiveResponse, type RiskAssessment, type RiskLevel,
} from "../core/bridge";
import { Sound } from "../core/sound";
import {
  LEVEL_ORDER, SESSION_QUIET_MS, State, isPlainLow, needsHold,
  type Approval, type FlashTone, type IslandView, type Session, type SessionState,
} from "../core/state";
import { t } from "../i18n/island";
import { HEADER_H, PANEL_H } from "../island/layout";
import { clear, h, icon } from "./dom";
import { LEVEL_LABEL } from "./labels";
import { SPARK_ICON, buildAssistant } from "./assistant";
import { changeList, limitSummary, planView, questionForm, usageView, type QuestionForm } from "./interactive";
import { buildWidgets, compactWidgetSummary, widgetHeight } from "./widgets";

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
  /** Answers a question or a plan (`anchor`: the button pressed). */
  respond(requestId: string, response: InteractiveResponse, anchor: Anchor): void;
  /** Allows, with one click, exactly the low-risk requests the batch tray listed (C-2). */
  allowLow(anchor: Anchor, ids: string[]): void;
  openFolder(cwd: string): void;
  focusSession(id: string): void;
  showSession(id: string): void;
  back(): void;
  forgetSession(id: string): void;
  openSettings(tab?: string): void;
  collapse(): void;
  togglePause(): void;
  toggleDnd(): void;
  /** The assistant view, with the keyboard. */
  openAssistant(): void;
  /** Hold a mood on the mascot while the assistant works; null lets go. */
  assistantMood(m: OwlMood | null): void;
  react(e: OwlEmote): void;
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
  forward: "M9 18l6-6-6-6",
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
  drawOwlMini(ctx, size / 2, size / 2, size, sessionMood(m.session, Date.now()), m.session.accent, t);
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
  const assistantBtn = h(
    "button",
    { class: "icon-btn hdr-assistant", title: t("hdr.assistant"), onclick: () => actions.openAssistant() },
    icon(SPARK_ICON),
  );
  const closeBtn = h("button", { class: "icon-btn", title: t("hdr.close"), onclick: () => actions.collapse() }, icon(ICON.close));
  const el = h(
    "div",
    { id: "header" },
    h("span", { class: "hdr-title", text: "Nöbetçi" }),
    status,
    h("span", { class: "grow" }),
    assistantBtn,
    dndBtn,
    pauseBtn,
    h("button", { class: "icon-btn", title: t("hdr.settings"), onclick: () => actions.openSettings() }, icon(ICON.gear)),
    closeBtn,
  );
  let key = "";
  return {
    el,
    height: () => HEADER_H,
    sync() {
      // The assistant's coloured top edge lives on the header: the assistant
      // view scrolls, and would clip a bar drawn above itself.
      el.classList.toggle("asst-on", State.view === "assistant");
      const n = State.sessions.length;
      const waiting = State.approvals.length;
      const quiet = State.settings.dnd ? "dnd" : State.quiet;
      const limit = limitSummary(State.limits);
      const next = `${n}|${waiting}|${State.paused}|${quiet}|${limit}`;
      if (next === key) return;
      key = next;
      const parts: string[] = [n === 0 ? t("hdr.noSessions") : t("hdr.sessions", { n })];
      if (waiting) parts.push(t("hdr.waiting", { n: waiting }));
      if (limit) parts.push(limit);
      if (State.paused) parts.push(t("hdr.paused"));
      if (quiet) parts.push(t("hdr.quiet", { why: quietLabel(quiet) }));
      status.textContent = parts.join(" · ");
      status.classList.toggle("warn", waiting > 0);
      dndBtn.classList.toggle("on", State.settings.dnd);
      dndBtn.title = State.settings.dnd ? t("hdr.dndOn") : t("hdr.dnd");
      clear(pauseBtn);
      pauseBtn.append(icon(State.paused ? ICON.play : ICON.pause));
      pauseBtn.title = State.paused ? t("hdr.resume") : t("hdr.pause");
      // While a request waits the island stays open, and the assistant waits its
      // turn: the two buttons say so instead of looking as if they would act (A-13).
      const held = waiting > 0;
      closeBtn.classList.toggle("blocked", held);
      closeBtn.setAttribute("aria-disabled", String(held));
      closeBtn.title = held ? t("ap.closeBlocked") : t("hdr.close");
      assistantBtn.classList.toggle("deferred", held);
      assistantBtn.title = held ? t("ap.assistantLater") : t("hdr.assistant");
    },
  };
}

// ── Overview ──────────────────────────────────────────────────────────────────

/** A session row (.session) and the gap between rows (.sessions). */
const ROW_H = 40;
const ROW_GAP = 4;
/** The list's padding above its first row. */
const LIST_PAD = 6;
/** The "+3 more" line under a list that scrolls (.sessions-more-row). */
const MORE_ROW_H = 24;
/** The view's padding under the list. */
const VIEW_PAD_BOTTOM = 12;
/** Everything above the list when it cannot be measured yet: widgets, search. */
const LIST_TOP_GUESS = 190;

/** Working or thinking, but nothing heard for a while (a closed terminal, a hung tool). */
function isStale(session: Session, now: number): boolean {
  const active = session.state === "working" || session.state === "thinking";
  return active && now - session.lastEventAt >= SESSION_QUIET_MS;
}

function sessionLabel(session: Session, now: number): string {
  // Paused, nothing is being watched: what a row last said may no longer hold.
  if (State.paused) return t("ov.notWatched");
  return isStale(session, now) ? t("ov.noRecentEvents") : stateLabel(session.state);
}

/** The small mascot of a row: asleep while paused, calm once a session went quiet. */
function sessionMood(session: Session, now: number): OwlMood {
  if (State.paused) return "sleeping";
  return isStale(session, now) ? "idle" : STATE_MOOD[session.state];
}

const SESSION_PRIORITY: Record<SessionState, number> = {
  approval: 0, question: 1, error: 2, ratelimit: 3,
  thinking: 4, working: 4, finished: 5, idle: 5,
};

/**
 * The ways a name can be lower-cased for a search: by Turkish rules (İ → i,
 * I → ı) and by the default ones (I → i, with İ's combining dot dropped). A
 * match under either counts, so "İzmir", "IŞIK" and "Inventory" all find what
 * they should whatever the island's language.
 */
function searchForms(text: string): [string, string] {
  return [text.toLocaleLowerCase("tr"), text.toLowerCase().replace(/\u0307/g, "")];
}

function matchesSearch(session: Session, query: [string, string]): boolean {
  return [session.name, session.cwd, session.terminal].some((field) => {
    const forms = searchForms(field);
    return forms[0].includes(query[0]) || forms[1].includes(query[1]);
  });
}

interface SessionRow {
  el: HTMLButtonElement;
  session: Session;
  name: HTMLElement;
  state: HTMLElement;
  age: HTMLElement;
  step: HTMLElement;
}

function buildOverview(actions: ViewActions): ViewHost {
  const list = h("div", { class: "sessions" });
  const widgets = buildWidgets("overview", actions.openSettings, { react: actions.react });
  const search = h("input", {
    class: "session-search", type: "search", placeholder: t("ov.search"),
    "aria-label": t("ov.search"), autocomplete: "off", spellcheck: "false",
    // A text field: the island takes the keyboard for it on a click (it never
    // does on its own), and lets it go when the field loses the focus.
    "data-typing": "",
  });
  const resume = h("button", { class: "btn btn-small", type: "button", text: t("hdr.resume"), onclick: () => actions.togglePause() });
  const pausedNote = h("div", { class: "paused-note", role: "status", hidden: true },
    icon(ICON.pause, 13), h("span", { class: "paused-text", text: t("ov.pausedNote") }), resume);
  // "+3 more ↓" on its own line under a list that scrolls: the sessions below
  // the fold, a click away, never covering a row.
  const moreText = h("span");
  const moreCue = h("button", { class: "sessions-more", type: "button", tabindex: -1 }, moreText, icon(ICON.chevron, 11));
  const moreRow = h("div", { class: "sessions-more-row", hidden: true }, moreCue);
  const el = h("div", { class: "view view-overview" }, widgets.el, search, pausedNote, list, moreRow);
  const rows = new Map<string, SessionRow>();
  const empty = h("p", { class: "more", role: "status" });
  let results: Session[] = [];

  /**
   * Whole rows only: as many as the panel leaves room for under the widgets and
   * the search; past that the list scrolls and the "+N more" line shows (G-2).
   */
  const layout = () => {
    const fixed = HEADER_H + (list.offsetTop || LIST_TOP_GUESS) + LIST_PAD + VIEW_PAD_BOTTOM;
    const room = PANEL_H - 8 - fixed;
    const all = Math.max(1, results.length);
    const fitsAll = all * ROW_H + (all - 1) * ROW_GAP <= room;
    const fit = fitsAll ? all : Math.max(1, Math.floor((room - MORE_ROW_H + ROW_GAP) / (ROW_H + ROW_GAP)));
    return { fixed, rows: fit, more: !fitsAll };
  };

  search.addEventListener("input", () => State.notify());
  search.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter" && results[0]) {
      event.preventDefault();
      const session = results[0];
      if (session.parents.length) actions.focusSession(session.id);
      else actions.showSession(session.id);
    } else if (event.key === "ArrowDown") {
      const first = rowButtons()[0];
      if (first) {
        event.preventDefault();
        // The rows are part of the search while the keys walk them: the island
        // keeps the keyboard (it lets it go when the focus leaves both).
        list.setAttribute("data-typing", "");
        first.focus();
      }
    }
  });

  const rowButtons = () => [...list.querySelectorAll<HTMLButtonElement>(".session")];
  list.addEventListener("keydown", (event) => {
    const buttons = rowButtons();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    let next: HTMLElement | undefined;
    switch (event.key) {
      case "ArrowDown": next = buttons[Math.min(buttons.length - 1, at + 1)]; break;
      case "ArrowUp": next = at === 0 ? search : buttons[at - 1]; break;
      case "Home": next = buttons[0]; break;
      case "End": next = buttons[buttons.length - 1]; break;
      case "Escape": next = search; break;
      default: return;
    }
    event.preventDefault();
    next?.focus();
  });
  list.addEventListener("focusout", (event) => {
    if (!list.contains(event.relatedTarget as Node | null)) list.removeAttribute("data-typing");
  });

  el.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      search.focus();
      search.select();
    }
  });

  // One element per session, updated in place: a click whose press and release
  // straddle a hook event still lands on the row it began on (island-ui#18).
  const makeRow = (s: Session): SessionRow => {
    const name = h("span", { class: "session-name" });
    const state = h("span", { class: "session-state" });
    const age = h("span", { class: "session-age" });
    const step = h("span", { class: "session-step" });
    const button = h(
      "button",
      { class: "session", type: "button", "data-session-id": s.id, title: t("ov.details"), onclick: () => actions.showSession(s.id) },
      miniCanvas(s, 20),
      h("span", { class: "session-main" }, h("span", { class: "session-top" }, name, state, age), step),
    );
    return { el: button, session: s, name, state, age, step };
  };

  const paintRow = (r: SessionRow, now: number) => {
    const s = r.session;
    const cls = `session state-${s.state}${State.paused ? " paused" : isStale(s, now) ? " stale" : ""}`;
    if (r.el.className !== cls) r.el.className = cls;
    if (r.name.textContent !== s.name) r.name.textContent = s.name;
    r.name.title = s.cwd;
    const label = sessionLabel(s, now);
    if (r.state.textContent !== label) r.state.textContent = label;
    const since = ago(now - s.lastEventAt);
    if (r.age.textContent !== since) r.age.textContent = since;
    r.age.title = t("ov.lastEvent", { age: since });
    const step = State.lastStep(s) || "—";
    if (r.step.textContent !== step) {
      r.step.textContent = step;
      r.step.title = step;
    }
  };

  /** How many rows are below what the list shows right now. */
  const updateMore = () => {
    // The line keeps its place while the list overflows (no jump when scrolled
    // to the end); only its button comes and goes.
    moreRow.hidden = !layout().more;
    const count = rowButtons().length;
    const seen = list.scrollTop + list.clientHeight - LIST_PAD;
    const fully = Math.max(0, Math.floor((seen + ROW_GAP + 1) / (ROW_H + ROW_GAP)));
    const below = list.clientHeight ? Math.max(0, count - fully) : 0;
    moreCue.style.visibility = below ? "" : "hidden";
    if (below) moreText.textContent = t("ov.more", { n: below });
  };
  list.addEventListener("scroll", updateMore, { passive: true });
  moreCue.addEventListener("click", () => {
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    list.scrollBy({ top: Math.max(ROW_H, list.clientHeight - ROW_H), behavior: smooth ? "smooth" : "auto" });
  });

  return {
    el,
    height: () => {
      const { fixed, rows: n, more } = layout();
      return fixed + n * ROW_H + (n - 1) * ROW_GAP + (more ? MORE_ROW_H : 0);
    },
    sync() {
      widgets.refresh();
      const now = Date.now();
      pausedNote.hidden = !State.paused;
      const raw = search.value.trim();
      const query = searchForms(raw);
      results = State.sessions
        .filter((session) => !raw || matchesSearch(session, query))
        .sort((a, b) => SESSION_PRIORITY[a.state] - SESSION_PRIORITY[b.state] || b.lastEventAt - a.lastEventAt);

      const wanted: HTMLElement[] = [];
      const live = new Set<string>();
      for (const s of results) {
        let r = rows.get(s.id);
        // A session that ended and came back under the same id is a new object.
        if (!r || r.session !== s) {
          r = makeRow(s);
          rows.set(s.id, r);
        }
        paintRow(r, now);
        live.add(s.id);
        wanted.push(r.el);
      }
      for (const id of [...rows.keys()]) if (!live.has(id)) rows.delete(id);
      if (!results.length) {
        // An empty search with no session at all is not "no match".
        const text = raw ? t("ov.noMatches") : t("empty.hooked");
        if (empty.textContent !== text) empty.textContent = text;
        wanted.push(empty);
      }
      const current = [...list.children];
      if (current.length !== wanted.length || current.some((node, i) => node !== wanted[i])) {
        const focused = list.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
        list.replaceChildren(...wanted);
        if (focused && document.activeElement !== focused) (focused.isConnected ? focused : search).focus();
      }
      updateMore();
    },
    tick() {
      widgets.refresh();
      const now = Date.now();
      for (const r of rows.values()) paintRow(r, now);
      updateMore();
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
  const usageSlot = h("div", { class: "detail-usage" });
  const changesSlot = h("div", { class: "detail-changes" });
  const timeline = h("ol", { class: "timeline" });
  const openDiffs = new Set<string>();
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
    usageSlot,
    changesSlot,
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

  // Esc goes back, as it does from the assistant. Wherever the focus is on the
  // page (a click on the view leaves it on the body); a later relocalised copy
  // of this view has its own listener, and this one goes quiet with its element.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented || !el.isConnected) return;
    if (State.mode !== "expanded" || State.view !== "session") return;
    if ((e.target as Element | null)?.closest?.("input, textarea, select, [contenteditable]")) return;
    e.preventDefault();
    actions.back();
  });

  return {
    el,
    // Measured, like the approval card: meters, changed files and an open diff
    // all add height. The view is as tall as what it holds, up to the panel's
    // cap (style.css), where it scrolls; it never stretches to the island, so
    // measuring it can never feed the island's own height back (G-2).
    height: () => Math.max(170, HEADER_H + el.offsetHeight + 12),
    sync() {
      const s = State.detailId ? State.session(State.detailId) : undefined;
      if (!s) return;
      if (s.id !== shownId) {
        shownId = s.id;
        owlSlot.replaceChildren(miniCanvas(s, 22));
        openDiffs.clear();
        key = "";
      }
      name.textContent = s.name;
      name.title = s.cwd;
      state.textContent = sessionLabel(s, Date.now());
      state.className = `session-state st-${s.state}`;
      goBtn.style.display = s.parents.length ? "" : "none";
      goBtn.title = s.terminal ? t("sd.gotoTitle", { terminal: s.terminal }) : t("sd.gotoTitleAny");

      const next = `${s.steps.length}:${State.lastStep(s)}:${s.tools}:${s.approved}:${s.denied}:${s.subagents.size}:${s.usage?.at ?? 0}:${State.limits?.at ?? 0}:${s.changes[0]?.t ?? 0}:${[...openDiffs].join("|")}`;
      if (next === key) return;
      key = next;
      const usage = usageView(s.usage, State.limits);
      usageSlot.replaceChildren(...(usage ? [usage] : []));
      changesSlot.replaceChildren(
        ...(s.changes.length
          ? [
              h("div", { class: "detail-sub", text: t("ch.title", { n: s.changes.length }) }),
              changeList(s.changes, openDiffs, (file) => {
                if (openDiffs.has(file)) openDiffs.delete(file);
                else openDiffs.add(file);
                State.notify();
              }),
            ]
          : []),
      );
      const bits = [
        s.terminal || null,
        t("sd.tools", { n: s.tools }),
        s.subagents.size ? t("sd.subagents", { n: s.subagents.size }) : null,
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
      const session = State.session(shownId);
      if (session) {
        const label = sessionLabel(session, Date.now());
        if (state.textContent !== label) state.textContent = label;
        state.title = t("ov.lastEvent", { age: ago(Date.now() - session.lastEventAt) });
      }
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
  const hint = h("span", { class: "empty-hint" });
  const setup = h("button", { class: "btn btn-primary", text: t("empty.install"), onclick: () => actions.openSettings("claude") });
  const widgets = buildWidgets("empty", actions.openSettings, { react: actions.react });
  const status = h("div", { class: "empty-status" }, h("strong", { text: t("empty.title") }), hint, setup);
  const el = h("div", { class: "view view-empty" }, status, widgets.el);
  return {
    el,
    // The status line is taller while it carries the setup button.
    height: () => HEADER_H + 24 + Math.max(28, status.offsetHeight) + widgetHeight(),
    tick: widgets.refresh,
    sync() {
      widgets.refresh();
      const hooked = State.settings.hooksInstalled;
      hint.textContent = hooked ? t("empty.hooked") : t("empty.unhooked");
      setup.style.display = hooked ? "none" : "";
    },
  };
}

// ── Approval card ─────────────────────────────────────────────────────────────

/**
 * How long a card — or a control on it that has just moved — ignores presses,
 * so a click meant for what was there before never lands on it (C-1). Rust
 * refuses an allow within 350 ms of the card coming up; the card waits a little
 * longer, so its own wait always covers Rust's.
 */
const ARM_MS = 400;
/** A decision is on its way to Rust: the card takes no second one meanwhile. */
const SENDING_MS = 1500;
/** The card's tallest: the island's cap (layout.ts) less the header and the gap under the card. */
const CARD_MAX_H = PANEL_H - 8 - HEADER_H - 12;

/**
 * What would hide something on the card: runs of blank lines or spaces long
 * enough to push the rest of a command out of sight, a Windows line break (shown
 * as a plain one), and every character that draws nothing — or nothing like
 * itself — but still reaches the program: controls other than tab and newline,
 * format characters (bidi controls, zero-width spaces and joiners, the soft
 * hyphen, tag characters…), variation selectors, blank-looking letters, line and
 * paragraph separators, and every space that is not a plain one.
 */
const HIDDEN =
  /(?:\r?\n[ \t]*){4,}|[ \t]{40,}|\r\n|[\u0000-\u0008\u000B-\u001F\u007F-\u009F\p{Cf}\u00A0\u034F\u115F\u1160\u1680\u17B4\u17B5\u180B-\u180F\u2000-\u200A\u2028\u2029\u202F\u205F\u2800\u3000\u3164\uFE00-\uFE0F\uFFA0\u{E0100}-\u{E01EF}]/gu;
const BIDI = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
const ODD_SPACE = /[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/;
/**
 * Emoji, by block. Spelled out rather than \p{Extended_Pictographic}, which the
 * oldest WebKit the app runs on (Safari 14) may not know: a regex it cannot
 * parse would stop the whole island. Missing one only marks a joiner.
 */
const PICTOGRAPH = /^[\u00A9\u00AE\u203C\u2049\u2122\u2139\u2194-\u21FF\u2300-\u23FF\u24C2\u25A0-\u27BF\u2900-\u297F\u2B00-\u2BFF\u3030\u303D\u3297\u3299\u{1F000}-\u{1FAFF}]$/u;
const SKIN_TONE = /^[\u{1F3FB}-\u{1F3FF}]$/u;

/** The character — a whole code point — that ends at `end`. */
function charBefore(text: string, end: number): string {
  if (end <= 0) return "";
  const lo = text.charCodeAt(end - 1);
  const hi = end >= 2 ? text.charCodeAt(end - 2) : 0;
  return lo >= 0xdc00 && lo <= 0xdfff && hi >= 0xd800 && hi <= 0xdbff ? text.slice(end - 2, end) : text[end - 1];
}

/**
 * A joiner or presentation selector inside an emoji (woman + ZWJ + laptop, a heart
 * with VS16, the keycap 1) is how the emoji is drawn, not something hidden: it stays.
 */
function emojiGlue(text: string, at: number, ch: string): boolean {
  if (ch === "\uFE0F" || ch === "\uFE0E") {
    const prev = charBefore(text, at);
    return PICTOGRAPH.test(prev) || /^[0-9#*]$/.test(prev);
  }
  if (ch !== "\u200D") return false;
  let prev = charBefore(text, at);
  if (prev === "\uFE0F" || SKIN_TONE.test(prev)) prev = charBefore(text, at - prev.length);
  const next = text.codePointAt(at + 1);
  return PICTOGRAPH.test(prev) && next !== undefined && PICTOGRAPH.test(String.fromCodePoint(next));
}

function hiddenMarker(text: string, title: string): HTMLElement {
  return h("span", { class: "hidden-char", title, text });
}

/**
 * Appends `text`, making what would hide something visible: every invisible,
 * direction-changing or control character becomes a ⟦U+XXXX⟧ marker (the
 * boxes also lay text out strictly left to right, so nothing can reorder it).
 */
function appendRevealed(parent: Node, text: string) {
  let i = 0;
  for (const m of text.matchAll(HIDDEN)) {
    const run = m[0];
    const at = m.index;
    if (emojiGlue(text, at, run)) continue;
    parent.appendChild(document.createTextNode(text.slice(i, at)));
    i = at + run.length;
    if (run === "\r\n") {
      parent.appendChild(document.createTextNode("\n"));
    } else if (run.includes("\n")) {
      // Keep one line break either side so the text stays readable, and say how
      // many blank lines there were.
      const blank = Math.max(1, (run.match(/\n/g) ?? []).length - 1);
      parent.appendChild(document.createTextNode("\n"));
      parent.appendChild(hiddenMarker(t("ap.blankLines", { n: blank }), t("ap.hiddenChar")));
      parent.appendChild(document.createTextNode("\n"));
    } else if (/^[ \t]{2,}$/.test(run)) {
      parent.appendChild(hiddenMarker(t("ap.spaces", { n: run.length }), t("ap.hiddenChar")));
    } else {
      const code = run.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
      const title = BIDI.test(run)
        ? t("ap.bidiChar")
        : CONTROL.test(run)
          ? t("ap.controlChar")
          : ODD_SPACE.test(run)
            ? t("ap.oddSpace")
            : t("ap.hiddenChar");
      parent.appendChild(hiddenMarker(`⟦U+${code}⟧`, title));
    }
  }
  parent.appendChild(document.createTextNode(text.slice(i)));
}

/** A target as its box shows it, and where each character of the original went. */
interface Shown {
  text: string;
  /** Index in `text` of each character of the original; null when nothing moved. */
  map: number[] | null;
}

/**
 * JSON arguments laid out one value per line, for reading. Only whitespace is
 * added: every token stays exactly as sent (a long number is never rounded
 * through JSON.parse), so what the box shows is still what runs.
 */
function prettyJson(src: string): Shown | null {
  if (!/^[[{]/.test(src) || src.length > 200_000) return null;
  try {
    JSON.parse(src);
  } catch {
    return null;
  }
  let out = "";
  let depth = 0;
  let inString = false;
  const map: number[] = new Array(src.length + 1);
  const newline = () => {
    out += `\n${"  ".repeat(Math.max(0, depth))}`;
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      map[i] = out.length;
      out += c;
      if (c === "\\" && i + 1 < src.length) {
        map[++i] = out.length;
        out += src[i];
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      map[i] = out.length;
      continue;
    }
    if (c === "}" || c === "]") {
      depth--;
      newline();
    }
    map[i] = out.length;
    out += c;
    if (c === '"') {
      inString = true;
    } else if (c === ":") {
      out += " ";
    } else if (c === ",") {
      newline();
    } else if (c === "{" || c === "[") {
      let k = i + 1;
      while (k < src.length && /\s/.test(src[k])) k++;
      if (src[k] === (c === "{" ? "}" : "]")) {
        // {} and [] stay on one line.
        for (let s = i + 1; s < k; s++) map[s] = out.length;
        map[k] = out.length;
        out += src[k];
        i = k;
      } else {
        depth++;
        newline();
      }
    }
  }
  map[src.length] = out.length;
  return { text: out, map };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Where a finding's excerpt is in `text`: case-insensitive, but matched on the
 * text itself, so the offsets are right even after a dotted İ (which lower-cases
 * to two characters). In JSON a string's quotes and backslashes are escaped.
 */
function locate(text: string, needle: string, json: boolean): [number, number] | null {
  const forms = json ? [needle, JSON.stringify(needle).slice(1, -1)] : [needle];
  for (const form of forms) {
    const m = new RegExp(escapeRe(form), "iu").exec(text);
    if (m) return [m.index, m.index + m[0].length];
  }
  return null;
}

/** The target as its box shows it, with every finding's excerpt marked in its level's colour. */
function highlighted(risk: RiskAssessment, shown: Shown): DocumentFragment {
  const marks: { start: number; end: number; level: RiskLevel }[] = [];
  for (const f of risk.findings) {
    const needle = f.excerpt.replace(/…$/, "").trim();
    if (needle.length < 2) continue;
    const at = locate(risk.target, needle, shown.map !== null);
    if (!at) continue;
    const start = shown.map ? shown.map[at[0]] : at[0];
    const end = shown.map ? shown.map[at[1] - 1] + 1 : at[1];
    if (marks.some((m) => start < m.end && end > m.start)) continue;
    marks.push({ start, end, level: f.level });
  }
  marks.sort((a, b) => a.start - b.start);
  const text = shown.text;
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

/** `mcp__server__tool` → which server, which tool. */
function mcpParts(tool: string): { server: string; name: string } | null {
  if (!tool.startsWith("mcp__")) return null;
  const rest = tool.slice(5);
  const cut = rest.indexOf("__");
  return cut < 0 ? { server: rest, name: "" } : { server: rest.slice(0, cut), name: rest.slice(cut + 2) };
}

/** A MultiEdit's edits one by one, when Rust sends them apart (`risk.edits`). */
function editsOf(risk: RiskAssessment): { before: string; after: string }[] {
  const list = (risk as RiskAssessment & { edits?: unknown }).edits;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (e): e is { before: string; after: string } =>
      !!e && typeof e === "object" && typeof (e as { after?: unknown }).after === "string" &&
      typeof (e as { before?: unknown }).before === "string",
  );
}

/** Messages the island raises when Rust or the hotkey refuses something on the card (A-7). */
const REFUSALS = ["fl.holdRequired", "fl.hotkeyLowOnly", "fl.noHotkey", "fl.answerOnCard"] as const;

/** When each waiting request arrived: the pager's order (the queue itself is reordered by it). */
const arrival = new WeakMap<Approval, number>();
let arrivals = 0;

function inArrivalOrder(): Approval[] {
  for (const a of State.approvals) if (!arrival.has(a)) arrival.set(a, arrivals++);
  return [...State.approvals].sort((x, y) => arrival.get(x)! - arrival.get(y)!);
}

/**
 * What one batch click may allow: the requests low by every count (C-2), in the
 * order they arrived, so the tray's list stays put while the cards are paged.
 */
function batchable(): Approval[] {
  const low = new Set(State.lowApprovals);
  return inArrivalOrder().filter((a) => low.has(a));
}

/**
 * Brings a waiting request to the front without answering anything (A-5). The
 * card, the hotkeys and the mascot all follow the front of the queue, so the
 * deny shortcut always denies what is on screen.
 */
function bringToFront(id: string) {
  const a = State.approvals.find((x) => x.requestId === id);
  if (!a || a === State.approvals[0]) return;
  inArrivalOrder();
  State.approvals = [a, ...State.approvals.filter((x) => x !== a)];
  State.notify();
}

/** The "↓ there's more" cue of a box that scrolls: shown while part of it is below. */
function scrollCue(box: HTMLElement): { el: HTMLElement; update(): void } {
  const cue = h("button", { class: "more-cue", type: "button", tabindex: -1, text: t("ap.overflow") });
  cue.hidden = true;
  const update = () => {
    const below = box.scrollHeight - box.clientHeight - box.scrollTop > 2;
    cue.hidden = !below;
    box.classList.toggle("fade-end", below);
  };
  box.addEventListener("scroll", update, { passive: true });
  cue.addEventListener("click", () => {
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    box.scrollBy({ top: Math.max(24, box.clientHeight * 0.8), behavior: smooth ? "smooth" : "auto" });
  });
  return { el: cue, update };
}

function buildApproval(actions: ViewActions): ViewHost {
  // ── Head: the level, who asks for which tool, the queue and the countdown ──
  const chip = h("span", { class: "risk-chip" });
  const whoName = h("span", { class: "appr-name" });
  const whoTool = h("span", { class: "appr-tool" });
  const who = h("span", { class: "appr-who" }, whoName, whoTool);
  const prevBtn = h("button", { class: "pager-btn", type: "button", title: t("ap.prev"), "aria-label": t("ap.prev") }, icon(ICON.back, 12));
  const nextBtn = h("button", { class: "pager-btn", type: "button", title: t("ap.next"), "aria-label": t("ap.next") }, icon(ICON.forward, 12));
  const pagePos = h("span", { class: "pager-pos" });
  const pager = h("span", { class: "appr-pager" }, prevBtn, pagePos, nextBtn);
  const timer = h("span", { class: "appr-timer" });
  const head = h("div", { class: "appr-head" }, chip, who, pager, timer);

  // ── Above the body: the click-guard warning, and a request that came cut ──
  const warning = h("div", { class: "appr-warning", role: "alert" });
  let warningText = "";
  const cutBanner = h("div", { class: "appr-cut", role: "alert" }, icon(ICON.alert, 14), h("span", { text: t("ap.cutBanner") }));

  // ── Body: what is being asked; it scrolls when it is taller than the panel ─
  const ruleNote = h("div", { class: "appr-rule" });
  const project = h("div", { class: "appr-project" });
  const kind = h("div", { class: "appr-kind" });
  const target = h("pre", { class: "appr-target" });
  const targetCue = scrollCue(target);
  const preview = h("pre", { class: "appr-preview" });
  const previewCue = scrollCue(preview);
  const previewBox = h("div", { class: "appr-box appr-preview-box" }, preview, previewCue.el);
  const findings = h("ul", { class: "appr-findings" });
  const standard = h(
    "div",
    { class: "appr-standard" },
    ruleNote,
    project,
    kind,
    h("div", { class: "appr-box" }, target, targetCue.el),
    previewBox,
    findings,
  );
  // Claude's questions and plans: their own body and buttons on the same card.
  const special = h("div", { class: "appr-special" });
  const body = h("div", { class: "appr-body" }, standard, special);
  const bodyCue = scrollCue(body);
  const scroller = h("div", { class: "appr-scroll" }, body, bodyCue.el);
  let planBox: HTMLElement | null = null;
  let planCue: ReturnType<typeof scrollCue> | null = null;
  let planText = "";
  /** The boxes' heights from the stylesheet, and whether new content needs them again. */
  const baseHeight = new Map<HTMLElement, number>();
  let refit = true;

  // ── Foot: the hints, or why something did not go through; the session grant
  const status = h("div", { class: "appr-status", role: "status", "aria-live": "polite" });
  // Not a <label>: its pass-on click would be a second click the guard below
  // would have to tell apart. The text toggles the box itself.
  const rememberText = h("span", { id: "appr-remember-text" });
  const remember = h("input", { type: "checkbox", class: "check", "aria-labelledby": "appr-remember-text" }) as HTMLInputElement;
  const rememberRow = h("div", { class: "appr-remember", "data-decision": "modifier" }, remember, rememberText);
  const foot = h("div", { class: "appr-foot" }, status, rememberRow);

  // ── The decisions ────────────────────────────────────────────────────────────
  const holdFill = h("span", { class: "hold-fill" });
  const allowLabel = h("span", { class: "hold-label" });
  const allowBtn = h("button", { class: "btn btn-allow", type: "button", "data-decision": "allow" }, holdFill, allowLabel);
  const denyBtn = h("button", { class: "btn btn-deny split-main", type: "button", text: t("ap.deny"), "data-decision": "deny" });
  const denyMore = h(
    "button",
    {
      class: "btn btn-deny split-more", type: "button", title: t("ap.denyMore"), "aria-label": t("ap.denyMore"),
      "aria-haspopup": "menu", "aria-expanded": "false",
    },
    icon(ICON.chevron, 13),
  );
  const denyMenu = h("div", { class: "deny-menu", role: "menu", "aria-label": t("ap.menuTitle") });
  const denyGroup = h("span", { class: "split" }, denyBtn, denyMore, denyMenu);
  const termIcon = h("span", { class: "btn-icon" });
  const termLabel = h("span");
  const termBtn = h("button", { class: "btn btn-ghost", type: "button", "data-decision": "deny" }, termIcon, termLabel);
  const sendBtn = h("button", { class: "btn btn-allow", type: "button", text: t("q.send"), "data-decision": "allow" });
  const reviseBtn = h("button", { class: "btn btn-deny", type: "button", text: t("plan.revise"), "data-decision": "deny" });
  const approvePlanBtn = h("button", { class: "btn btn-allow", type: "button", text: t("plan.approve"), "data-decision": "allow" });
  const feedback = h("textarea", {
    class: "plan-feedback",
    rows: 2,
    maxlength: 2000,
    placeholder: t("plan.feedback"),
    "aria-label": t("plan.feedback"),
    "data-typing": "",
  }) as HTMLTextAreaElement;
  let form: QuestionForm | null = null;
  const actionsRow = h(
    "div",
    { class: "appr-actions" },
    termBtn,
    h("span", { class: "grow" }),
    denyGroup,
    allowBtn,
    reviseBtn,
    approvePlanBtn,
    sendBtn,
  );

  // ── Batch tray: every waiting low-risk request, listed, for one click ─────
  // Below the action row: when it appears the buttons above it stay where they
  // were (approvals#2), and its own button sits on the tray's first line.
  const batchTitle = h("span", { class: "batch-title" });
  const batchBtn = h("button", { class: "btn btn-small btn-batch", type: "button", "data-decision": "allow" });
  const batchList = h("div", { class: "batch-list" });
  const batchNote = h("div", { class: "batch-note" });
  const batchRow = h(
    "div",
    { class: "appr-batch", role: "group" },
    h("div", { class: "batch-head" }, icon(ICON.shield, 13), batchTitle, batchBtn),
    batchList,
    batchNote,
  );

  const el = h("div", { class: "view view-approval" }, head, warning, cutBanner, scroller, foot, actionsRow, batchRow);

  let shown: Approval | null = null;
  /** The request on screen that a person can act on (C-1); null while the island is not open on it. */
  let front: string | null = null;
  /** Presses count only when they start at or after this (performance.now()). */
  let armedAt = 0;
  let armTimer = 0;
  /** Where the controls were at the last look: if one moved, they wait again. */
  let layoutKey = "";
  /** The press a click may complete: on which card and control, when, from the keyboard or not. */
  let press: { id: string; el: Element; at: number; key: boolean } | null = null;
  /** A decision on its way to Rust: its request id, or "batch". */
  let sending: string | null = null;
  let sendingTimer = 0;
  /** State.flash and State.cardWarning when it went out: a newer one is its refusal. */
  let flashAtSend: unknown = null;
  let warningAtSend: unknown = null;
  let lastFlash: unknown = null;
  /** What the foot line says instead of the hints for a while. */
  let note: { text: string; tone: FlashTone; until: number } | null = null;
  let noteTimer = 0;
  /** The low-risk requests the tray lists: exactly what its button allows. */
  let batchIds: string[] = [];
  let batchKey = "";

  // ── Hold to confirm ───────────────────────────────────────────────────────
  let holdStart = 0;
  let holdMs = 0;
  let holdRaf = 0;
  let lastQuarter = 0;
  let holdPointer = -1;

  const holdReset = () => {
    cancelAnimationFrame(holdRaf);
    const pointer = holdPointer;
    holdStart = 0;
    holdPointer = -1;
    if (pointer >= 0 && allowBtn.hasPointerCapture(pointer)) allowBtn.releasePointerCapture(pointer);
    holdFill.style.transform = "scaleX(0)";
    allowBtn.classList.remove("holding");
  };

  const setNote = (text: string, tone: FlashTone, ms: number) => {
    note = { text, tone, until: Date.now() + ms };
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => State.notify(), ms + 50);
    State.notify();
  };

  /** Restarts a fade-in: the class comes off and back on, so its animation runs again. */
  const restart = (node: HTMLElement, cls: string) => {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  };

  /**
   * The whole card takes no press for a moment: it has just come up (C-1). Its
   * controls fade in meanwhile.
   */
  const arm = () => {
    armedAt = performance.now() + ARM_MS;
    press = null;
    if (holdStart) holdReset();
    restart(el, "arming");
    window.clearTimeout(armTimer);
    armTimer = window.setTimeout(() => el.classList.remove("arming"), ARM_MS);
  };

  const controls: HTMLElement[] = [termBtn, denyBtn, denyMore, allowBtn, reviseBtn, approvePlanBtn, sendBtn, batchBtn, rememberRow];
  /** Until when each control takes no press: it has just appeared or moved. */
  const controlArmedAt = new Map<HTMLElement, number>();
  const controlTimers = new Map<HTMLElement, number>();
  /** Whether `control` may take a press that starts now. */
  const ready = (control: HTMLElement | null) =>
    !!control && performance.now() >= armedAt && performance.now() >= (controlArmedAt.get(control) ?? 0);

  /**
   * A control that has appeared or moved since the last look takes no press
   * for a moment (approvals#2): a click aimed at what was under the pointer
   * before must not land on it. The others stay ready.
   */
  const watchLayout = () => {
    const keys = controls.map((c) => {
      const r = c.getBoundingClientRect();
      return `${Math.round(r.left)}:${Math.round(r.top)}:${Math.round(r.width)}`;
    });
    const key = keys.join("|");
    if (key === layoutKey) return;
    const before = layoutKey ? layoutKey.split("|") : null;
    layoutKey = key;
    if (!before || !shown) return;
    controls.forEach((c, i) => {
      if (keys[i] === before[i] || c.getBoundingClientRect().width === 0) return;
      controlArmedAt.set(c, performance.now() + ARM_MS);
      if (press?.el === c) press = null;
      if (c === allowBtn && holdStart) {
        holdReset();
        setNote(t("ap.holdMoved"), "warn", 4000);
      }
      restart(c, "arming");
      window.clearTimeout(controlTimers.get(c));
      controlTimers.set(c, window.setTimeout(() => c.classList.remove("arming"), ARM_MS));
    });
  };

  const endSending = () => {
    sending = null;
    window.clearTimeout(sendingTimer);
    el.classList.remove("sending");
    allowBtn.classList.remove("held");
    if (!holdStart) holdFill.style.transform = "scaleX(0)";
  };
  /** Sends a decision; until Rust answers (or a moment passes) the card takes no other. */
  const send = (key: string, go: () => void) => {
    sending = key;
    flashAtSend = State.flash;
    warningAtSend = State.cardWarning;
    el.classList.add("sending");
    window.clearTimeout(sendingTimer);
    sendingTimer = window.setTimeout(() => {
      if (sending === key) endSending();
    }, SENDING_MS);
    go();
  };

  /** Where the Allow button is, for the physical-click check in Rust. */
  const rect = (b: HTMLElement): Anchor => {
    const r = b.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };

  // ── Which press may answer the card ─────────────────────────────────────────
  const decisionOf = (target: EventTarget | null) => (target as Element | null)?.closest?.<HTMLElement>("[data-decision]") ?? null;
  el.addEventListener(
    "pointerdown",
    (e) => {
      watchLayout();
      const control = decisionOf(e.target);
      press = shown && control && e.button === 0 && ready(control)
        ? { id: shown.requestId, el: control, at: performance.now(), key: false }
        : null;
    },
    true,
  );
  el.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const control = decisionOf(e.target);
      if (!control) return;
      press = shown && !e.repeat && ready(control)
        ? { id: shown.requestId, el: control, at: performance.now(), key: true }
        : null;
    },
    true,
  );

  /**
   * Whether a click on `control` may answer the card: the press began on this
   * very control, on this card, once it was ready (C-1, Y-2) — so neither the
   * second half of a double click nor the release that ends a hold can answer
   * the card that came up next. Keys may deny but never approve: Rust would take
   * a keyboard approval for a program and raise the alarm (A-11).
   */
  const verdict = (e: MouseEvent, control: HTMLElement): "act" | "keys" | "ignore" => {
    watchLayout();
    const p = press;
    press = null;
    const since = Math.max(armedAt, controlArmedAt.get(control) ?? 0);
    if (!shown || !p || p.id !== shown.requestId || p.el !== control || p.at < since || sending) return "ignore";
    const keyboard = e.detail === 0;
    if (keyboard !== p.key) return "ignore";
    if (keyboard && control.dataset.decision === "allow") return "keys";
    return "act";
  };

  // The grant is no decision, but it changes what Allow does: it too takes only
  // a press that began on this card, once the card was ready.
  rememberRow.addEventListener("click", (e) => {
    const v = verdict(e, rememberRow);
    if (e.target === remember) {
      if (v === "ignore") e.preventDefault();
    } else if (v !== "ignore") {
      remember.checked = !remember.checked;
    }
  });

  // ── Deny menu ─────────────────────────────────────────────────────────────
  const menuOpen = () => denyMenu.classList.contains("open");
  const closeMenu = (focusButton: boolean) => {
    if (!menuOpen()) return;
    denyMenu.classList.remove("open");
    denyMore.setAttribute("aria-expanded", "false");
    if (focusButton) denyMore.focus();
  };
  const deny = (e: MouseEvent, control: HTMLElement, opts: DecisionOptions) => {
    if (verdict(e, control) !== "act" || !shown) return;
    closeMenu(false);
    const id = shown.requestId;
    send(id, () => actions.decide(id, "deny", opts));
  };
  const menuItem = (text: string, opts: DecisionOptions, danger = false) => {
    const b = h(
      "button",
      { class: `menu-item${danger ? " danger" : ""}`, type: "button", role: "menuitem", tabindex: -1, "data-decision": "deny" },
      danger ? icon(ICON.stop, 12) : null,
      danger ? ` ${text}` : text,
    );
    b.addEventListener("click", (e) => deny(e, b, opts));
    return b;
  };
  const openMenu = () => {
    denyMenu.replaceChildren(
      h("div", { class: "menu-title", text: t("ap.menuTitle") }),
      ...State.settings.denyReasons.map((reason) => menuItem(reason, { message: reason })),
      h("div", { class: "menu-sep", role: "separator" }),
      menuItem(t("ap.denyStop"), { stop: true, message: t("ap.stopMessage") }, true),
    );
    // Never past the top of the screen (A-8): as tall as the room above the
    // button allows; the reasons scroll past that.
    const room = Math.floor(denyGroup.getBoundingClientRect().top) - 6 - 8;
    denyMenu.style.maxHeight = `${Math.max(96, Math.min(300, room))}px`;
    denyMenu.scrollTop = 0;
    denyMenu.classList.add("open");
    denyMore.setAttribute("aria-expanded", "true");
    menuFade();
  };
  /** A menu taller than its room fades out at the bottom while more is below. */
  const menuFade = () =>
    denyMenu.classList.toggle("fade-end", denyMenu.scrollHeight - denyMenu.clientHeight - denyMenu.scrollTop > 2);
  denyMenu.addEventListener("scroll", menuFade, { passive: true });
  denyBtn.addEventListener("click", (e) => deny(e, denyBtn, {}));
  denyMore.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menuOpen()) {
      closeMenu(false);
      return;
    }
    openMenu();
    // Opened from the keyboard: the first reason takes the focus.
    if (e.detail === 0) denyMenu.querySelector<HTMLElement>(".menu-item")?.focus();
  });
  denyMenu.addEventListener("keydown", (e) => {
    const items = [...denyMenu.querySelectorAll<HTMLElement>(".menu-item")];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu(true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (e.key === "Tab") {
      closeMenu(false);
    }
  });
  denyMore.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu(true);
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      if (!menuOpen()) openMenu();
      const items = [...denyMenu.querySelectorAll<HTMLElement>(".menu-item")];
      items[e.key === "ArrowUp" ? items.length - 1 : 0]?.focus();
    }
  });
  document.addEventListener("mousedown", (e) => {
    if (!denyGroup.contains(e.target as Node)) closeMenu(false);
  });

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
      const anchor = rect(allowBtn);
      holdReset();
      // Held all the way: the button stays full until the card changes, and the
      // release that follows answers nothing — it belongs to this card only.
      allowBtn.classList.add("held");
      holdFill.style.transform = "scaleX(1)";
      press = null;
      send(id, () => actions.decide(id, "allow_confirmed", { anchor }));
      return;
    }
    holdRaf = requestAnimationFrame(holdStep);
  };

  allowBtn.addEventListener("pointerdown", (e) => {
    if (!shown || e.button !== 0) return;
    Sound.resume();
    if (!needsHold(shown.risk.level)) return;
    // Only a press the card counts (on it, once it is ready) starts a hold.
    if (press?.el !== allowBtn || press.key || sending) return;
    holdMs = holdFor(shown.risk.level);
    holdStart = performance.now();
    holdPointer = e.pointerId;
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
  allowBtn.addEventListener("click", (e) => {
    const v = verdict(e, allowBtn);
    if (v === "keys") {
      setNote(t("ap.useMouse"), "warn", 5000);
      return;
    }
    if (v !== "act" || !shown || needsHold(shown.risk.level)) return;
    const id = shown.requestId;
    const opts: DecisionOptions = { remember: remember.checked, anchor: rect(allowBtn) };
    send(id, () => actions.decide(id, "allow", opts));
  });
  termBtn.addEventListener("click", (e) => {
    if (verdict(e, termBtn) !== "act" || !shown) return;
    const id = shown.requestId;
    send(id, () => actions.handToTerminal(id));
  });

  // ── Questions and plans ───────────────────────────────────────────────────
  /** Says on the buttons what they would need before they can send. */
  const syncSpecial = () => {
    const ready = !!form?.answers();
    sendBtn.setAttribute("aria-disabled", String(!ready));
    sendBtn.title = ready ? "" : t("q.sendTitle");
    const written = !!feedback.value.trim();
    reviseBtn.setAttribute("aria-disabled", String(!written));
    reviseBtn.title = written ? "" : t("plan.reviseTitle");
    approvePlanBtn.setAttribute("aria-disabled", String(!planText));
    approvePlanBtn.title = planText ? "" : t("plan.approveEmpty");
  };
  feedback.addEventListener("input", () => {
    syncSpecial();
    State.notify();
  });
  sendBtn.addEventListener("click", (e) => {
    const v = verdict(e, sendBtn);
    if (v === "keys") {
      setNote(t("q.enterHint"), "info", 5000);
      return;
    }
    if (v !== "act" || !shown) return;
    const answers = form?.answers();
    if (!answers) {
      setNote(t("q.sendTitle"), "warn", 4000);
      return;
    }
    const id = shown.requestId;
    const anchor = rect(sendBtn);
    send(id, () => actions.respond(id, { kind: "answers", answers }, anchor));
  });
  approvePlanBtn.addEventListener("click", (e) => {
    const v = verdict(e, approvePlanBtn);
    if (v === "keys") {
      setNote(t("ap.useMouse"), "warn", 5000);
      return;
    }
    if (v !== "act" || !shown) return;
    if (!planText) {
      // Nothing on the card to approve: the terminal or the app has the plan.
      setNote(t("plan.approveEmpty"), "warn", 5000);
      return;
    }
    const id = shown.requestId;
    const anchor = rect(approvePlanBtn);
    send(id, () => actions.respond(id, { kind: "approvePlan" }, anchor));
  });
  reviseBtn.addEventListener("click", (e) => {
    if (verdict(e, reviseBtn) !== "act" || !shown) return;
    const text = feedback.value.trim();
    if (!text) {
      setNote(t("plan.reviseTitle"), "warn", 4000);
      return;
    }
    const id = shown.requestId;
    const anchor = rect(reviseBtn);
    send(id, () => actions.respond(id, { kind: "revise", feedback: text }, anchor));
  });

  // ── Pager and batch tray ──────────────────────────────────────────────────
  const page = (step: number) => {
    const list = inArrivalOrder();
    const next = list[list.indexOf(State.approvals[0]) + step];
    if (next) bringToFront(next.requestId);
  };
  prevBtn.addEventListener("click", () => page(-1));
  nextBtn.addEventListener("click", () => page(1));

  batchBtn.addEventListener("click", (e) => {
    const v = verdict(e, batchBtn);
    if (v === "keys") {
      setNote(t("ap.useMouse"), "warn", 5000);
      return;
    }
    if (v !== "act") return;
    // Exactly what the tray lists — and only while that is still what waits.
    if (batchable().map((a) => a.requestId).join("|") !== batchIds.join("|")) return;
    const ids = [...batchIds];
    const anchor = rect(batchBtn);
    send("batch", () => actions.allowLow(anchor, ids));
  });

  const renderBatch = (lows: Approval[], lowered: number) => {
    batchIds = lows.map((a) => a.requestId);
    batchTitle.textContent = t("ap.batchTitle", { n: lows.length });
    batchBtn.textContent = t("ap.allowLow", { n: lows.length });
    batchList.replaceChildren(
      ...lows.map((a) => {
        const isFront = a === State.approvals[0];
        const cmd = h("span", { class: "batch-cmd" });
        appendRevealed(cmd, a.risk.target);
        const item = h(
          "button",
          { class: `batch-item${isFront ? " front" : ""}`, type: "button", title: isFront ? "" : t("ap.batchShow") },
          h("span", { class: "batch-who", text: State.session(a.sessionId)?.name ?? t("ap.session") }),
          cmd,
          isFront ? h("span", { class: "batch-here", text: t("ap.batchHere") }) : null,
        );
        item.addEventListener("click", () => bringToFront(a.requestId));
        return item;
      }),
    );
    batchNote.textContent = lowered ? t("ap.batchLowered", { n: lowered }) : "";
  };

  // ── Rendering ─────────────────────────────────────────────────────────────
  /** The hints under the card, when nothing more pressing is said there. */
  const hintsFor = (a: Approval): string => {
    if (a.kind === "question") {
      const p = form?.progress();
      return p && p.total > 1 ? t("q.progress", { a: p.answered, n: p.total }) : "";
    }
    if (a.kind === "plan") return "";
    const r = a.risk;
    const keys = State.settings.hotkeys;
    const hints: string[] = [];
    if (needsHold(r.level)) hints.push(t("ap.holdHint", { s: (holdFor(r.level) / 1000).toFixed(1) }));
    else hints.push(t(r.level === "low" ? "ap.heuristic" : "ap.heuristicMedium"));
    if (keys.deny) hints.push(t("ap.keyDeny", { key: keys.deny }));
    // The allow hotkey only ever covers what is low by every count (C-2).
    if (keys.allow && isPlainLow(a)) hints.push(t("ap.keyAllow", { key: keys.allow }));
    return hints.join(" · ");
  };

  const renderFoot = (a: Approval) => {
    if (note && note.until <= Date.now()) note = null;
    const text = note ? note.text : hintsFor(a);
    if (status.textContent !== text) status.textContent = text;
    status.dataset.tone = note ? note.tone : "";
    status.hidden = !text;
  };

  /**
   * A refusal for this card (A-7): the island says it in a passing message that
   * the open card would otherwise never show. Shown on the card's own foot line.
   */
  const watchRefusals = (a: Approval) => {
    if (sending && sending === a.requestId && State.cardWarning !== warningAtSend) endSending();
    const f = State.flash;
    if (f === lastFlash) return;
    lastFlash = f;
    if (!f || f.until <= Date.now()) return;
    const known = REFUSALS.some((k) => t(k) === f.text);
    const answer = !!sending && f !== flashAtSend && (f.tone === "error" || f.tone === "warn");
    if (!known && !answer) return;
    // The click-guard alarm has its own banner on the card: not twice.
    if (State.cardWarning?.requestId === a.requestId && State.cardWarning.text === f.text) {
      if (answer) endSending();
      return;
    }
    // A bare error code ("unknown_decision") says little on its own.
    const text = /^[a-z][a-z0-9_]*$/.test(f.text) ? t("ap.refused", { code: f.text }) : f.text;
    note = { text, tone: f.tone, until: f.until };
    if (answer) endSending();
  };

  /** Lays the edits of a write out: what goes in first, then what it replaces. */
  const renderPreview = (r: RiskAssessment) => {
    preview.replaceChildren();
    const pair = (after: string, before: string | null | undefined, label = "") => {
      const a = h("span", { class: "edit-after" }, label ? `${label} · ${t("ap.after")}` : t("ap.after"), "\n");
      appendRevealed(a, after);
      preview.append(a);
      if (before != null) {
        const b = h("span", { class: "edit-before" }, label ? `${label} · ${t("ap.before")}` : t("ap.before"), "\n");
        appendRevealed(b, before);
        preview.append("\n\n", b);
      }
    };
    const edits = editsOf(r);
    if (edits.length > 1) {
      edits.forEach((e, i) => {
        if (i) preview.append("\n\n");
        pair(e.after, e.before, `${i + 1}/${edits.length}`);
      });
    } else if (r.preview != null && r.previewBefore != null) {
      pair(r.preview, r.previewBefore);
    } else if (r.preview != null) {
      appendRevealed(preview, r.preview);
    }
  };

  /** The card for a question or a plan; false for a permission request. */
  const renderSpecial = (a: Approval): boolean => {
    const isPermission = a.kind === "permission";
    standard.hidden = !isPermission;
    special.hidden = isPermission;
    denyGroup.hidden = !isPermission;
    allowBtn.hidden = !isPermission;
    sendBtn.hidden = a.kind !== "question";
    reviseBtn.hidden = a.kind !== "plan";
    approvePlanBtn.hidden = a.kind !== "plan";
    rememberRow.hidden = !(isPermission && a.grantable);
    cutBanner.hidden = !(isPermission && a.risk.truncated);
    planBox = null;
    planCue = null;
    planText = "";
    form = null;
    if (isPermission) return false;

    el.dataset.level = "low";
    chip.className = `risk-chip kind-${a.kind}`;
    chip.textContent = t(a.kind === "question" ? "q.chip" : "plan.chip");
    whoTool.textContent = t(a.kind === "question" ? "q.title" : "plan.title");
    feedback.value = "";
    if (a.kind === "question") {
      form = questionForm(a.input, {
        changed: () => {
          syncSpecial();
          State.notify();
        },
        enter: () => setNote(t("q.enterHint"), "info", 5000),
      });
      special.replaceChildren(form.el);
    } else {
      const plan = typeof a.input.plan === "string" ? a.input.plan : "";
      planText = plan.trim();
      planBox = h("div", { class: "plan-box" }, planView(plan));
      planCue = scrollCue(planBox);
      special.replaceChildren(h("div", { class: "appr-box" }, planBox, planCue.el), feedback);
    }
    syncSpecial();
    return true;
  };

  const render = (a: Approval, handOver: boolean) => {
    refit = true;
    endSending();
    closeMenu(false);
    holdReset();
    note = null;
    press = null;
    body.scrollTop = 0;
    const session = State.session(a.sessionId);
    whoName.textContent = session?.name ?? t("ap.session");
    // A session from the Claude desktop app asks in its own window, not a
    // terminal: its button says so, with the app's icon rather than a prompt.
    const inApp = session?.terminal === "Claude";
    termIcon.replaceChildren(icon(inApp ? ICON.window : ICON.terminal, 13));
    termLabel.textContent = t(inApp ? "ap.toApp" : "ap.toTerminal");
    termBtn.title = t(inApp ? "ap.toAppTitle" : "ap.toTerminalTitle");
    // The next request comes in with a short fade, so the hand-over is seen (approvals#12).
    if (handOver) {
      el.classList.remove("card-in");
      void el.offsetWidth;
      el.classList.add("card-in");
    }
    if (renderSpecial(a)) {
      who.title = `${whoName.textContent} · ${whoTool.textContent}`;
      return;
    }

    const r = a.risk;
    el.dataset.level = r.level;
    chip.className = `risk-chip lvl-${r.level}`;
    chip.textContent = LEVEL_LABEL[r.level];
    // The tool's own name: a waiting request is not "running" yet (A-22), and an
    // MCP tool says which server it belongs to (A-1).
    const mcp = mcpParts(a.tool);
    whoTool.textContent = mcp ? `MCP · ${mcp.server}` : a.tool;
    who.title = `${whoName.textContent} · ${a.tool}`;
    project.replaceChildren();
    project.hidden = !session?.cwd;
    if (session?.cwd) appendRevealed(project, session.cwd);

    kind.replaceChildren(document.createTextNode(`${kindTitle(r.kind)}:`));
    if (mcp) {
      const id = h("span", { class: "appr-tool-id", title: a.tool });
      appendRevealed(id, mcp.server);
      id.append(" › ");
      appendRevealed(id, mcp.name || "?");
      kind.append(" ", id);
    }

    // Arguments as JSON are laid out for reading; every character stays as sent.
    const shownText = (r.kind === "mcp" || r.kind === "other" ? prettyJson(r.target) : null) ?? { text: r.target, map: null };
    target.replaceChildren(highlighted(r, shownText));
    // Cut on the way here: the box says where (A-3); a write's content is what gets cut.
    const cutInPreview = r.truncated && r.kind === "write" && r.preview != null;
    if (r.truncated && !cutInPreview) target.append(h("span", { class: "cut-marker", text: t("ap.cut") }));
    target.scrollTop = 0;

    previewBox.hidden = r.preview == null && editsOf(r).length < 2;
    renderPreview(r);
    if (cutInPreview) preview.append(h("span", { class: "cut-marker", text: t("ap.cut") }));
    preview.scrollTop = 0;

    const policyNote = a.policy === "strict" ? t("ap.strict") : a.policy === "trusted" ? t("ap.trusted") : "";
    // A rule re-scored it: say what the engine itself found (Y-11, C-2).
    const engine = r.engineLevel && r.engineLevel !== r.level
      ? t("ap.rescored", { engine: LEVEL_LABEL[r.engineLevel], level: LEVEL_LABEL[r.level] })
      : "";
    const ruleText = [policyNote, a.note, engine].filter(Boolean).join(" · ");
    ruleNote.replaceChildren();
    if (ruleText) ruleNote.append(icon(ICON.rule, 12), document.createTextNode(` ${ruleText}`));
    ruleNote.hidden = !ruleText;

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
    allowLabel.textContent = hold ? t("ap.holdAllow") : t("ap.allow");
    allowBtn.classList.toggle("needs-hold", hold);
    // A session grant is an automatic approval: offer it only where Rust would
    // honour one, and say what it covers — for a write, the file (A-6).
    remember.checked = false;
    rememberText.textContent = t(`ap.remember.${r.kind}`);
    rememberRow.title = t(r.kind === "write" ? "ap.rememberWriteTitle" : "ap.rememberTitle");
  };

  /**
   * Lets the boxes that scroll grow into the room the panel has left (A-21) —
   * the command first, then a file's content or the plan — and decides every
   * "there's more" cue in the same frame, before the island measures the card
   * (A-18: no cue that flashes, no island a size too tall).
   */
  const fit = () => {
    const boxes = [target, preview, planBox].filter((b): b is HTMLElement => !!b && b.offsetParent !== null);
    if (refit) {
      // New content: start from the stylesheet's heights.
      refit = false;
      for (const b of boxes) {
        b.style.maxHeight = "";
        baseHeight.set(b, parseFloat(getComputedStyle(b).maxHeight) || 0);
      }
    }
    let room = CARD_MAX_H - (el.offsetHeight - body.clientHeight + body.scrollHeight);
    if (room < -0.5) {
      // Something else on the card grew: give room back, the last box first,
      // never below its own height (only what was added moves, so a box being
      // read keeps its scroll position).
      for (const b of [...boxes].reverse()) {
        const give = Math.min(b.offsetHeight - (baseHeight.get(b) ?? 0), -room);
        if (give > 0.5) {
          b.style.maxHeight = `${b.offsetHeight - give}px`;
          room += give;
        }
        if (room >= -0.5) break;
      }
    } else {
      for (const b of boxes) {
        if (room <= 0.5) break;
        const hidden = b.scrollHeight - b.clientHeight;
        if (hidden <= 1) continue;
        const grow = Math.min(room, hidden);
        b.style.maxHeight = `${b.offsetHeight + grow}px`;
        room -= grow;
      }
    }
    targetCue.update();
    previewCue.update();
    planCue?.update();
    bodyCue.update();
  };

  return {
    el,
    // The card's own height: up to the panel's cap, where its body scrolls and
    // the buttons stay in view (Y-13).
    height: () => Math.max(200, HEADER_H + el.offsetHeight + 12),
    sync() {
      const a = State.currentApproval;
      if (!a) {
        // Answered: nothing here can act any more while the island moves on.
        shown = null;
        front = null;
        el.classList.add("over");
        return;
      }
      el.classList.remove("over");
      if (a !== shown) {
        const handOver = shown !== null;
        shown = a;
        render(a, handOver);
      }

      // The queue: where this one is, and arrows to look at the others (A-5).
      const list = inArrivalOrder();
      const pos = list.indexOf(a);
      pager.hidden = list.length < 2;
      pagePos.textContent = `${pos + 1}/${list.length}`;
      pager.title = t("ap.pagerTitle", { n: list.length });
      prevBtn.disabled = pos <= 0;
      nextBtn.disabled = pos >= list.length - 1;

      // The batch tray lists what its one click would allow — low by every
      // count (C-2) — and says what a rule lowered is left out (Y-11).
      const lows = batchable();
      const lowered = State.approvals.filter((x) => x.kind === "permission" && x.risk.level === "low" && !isPlainLow(x)).length;
      const key = `${lows.map((x) => x.requestId).join("|")}#${a.requestId}#${lowered}`;
      if (key !== batchKey) {
        if (sending === "batch") endSending();
        batchKey = key;
        if (lows.length >= 2) renderBatch(lows, lowered);
        else batchIds = [];
      }
      batchRow.hidden = lows.length < 2;

      const w = State.cardWarning && State.cardWarning.requestId === a.requestId ? State.cardWarning.text : "";
      if (w !== warningText) {
        warningText = w;
        warning.replaceChildren();
        // The icon already says "warning"; drop a leading ⚠ from the message.
        if (w) warning.append(icon(ICON.alert, 14), document.createTextNode(` ${w.replace(/^⚠\s*/, "")}`));
      }
      warning.hidden = !w;

      watchRefusals(a);
      renderFoot(a);
      fit();

      // The card a person can see and act on: tell Rust (C-1), and take no
      // press for a moment — it may have come up under a moving pointer.
      const visible = State.mode === "expanded" && State.view === "approval";
      const nowFront = visible ? a.requestId : null;
      if (nowFront !== front) {
        front = nowFront;
        if (nowFront) {
          void IslandBridge.approvalShown(nowFront);
          arm();
        }
      }
      watchLayout();
    },
    tick() {
      if (!shown) return;
      const left = shown.expiresAt - Date.now();
      const text = mmss(left);
      if (timer.textContent !== text) timer.textContent = text;
      timer.classList.toggle("urgent", left < 20_000);
      if (note && note.until <= Date.now()) State.notify();
      watchLayout();
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
      [
        "assistant",
        buildAssistant({
          back: () => actions.back(),
          togglePause: () => actions.togglePause(),
          toggleDnd: () => actions.toggleDnd(),
          openSettings: (tab) => actions.openSettings(tab),
          mood: (m) => actions.assistantMood(m),
          react: (e) => actions.react(e),
        }),
      ],
    ]),
  };
}

// ── Compact island content ────────────────────────────────────────────────────

/** Mini mascots the pill has room for; a "+N" says how many more there are. */
const PILL_MINIS = 4;

export function buildCompact(): { el: HTMLElement; sync(): void } {
  const text = h("span", { class: "compact-text" });
  const quiet = h("span", { class: "compact-quiet", title: t("cp.quiet") }, icon(ICON.moon, 12));
  const row = h("span", { class: "compact-minis" });
  const more = h("span", { class: "compact-more", hidden: true });
  const el = h("div", { id: "compact" }, text, quiet, row, more);
  let key = "";
  const summary = compactWidgetSummary(() => { if (el.isConnected) compact.sync(); });
  const compact = {
    el,
    sync() {
      const now = Date.now();
      const flash = State.flash && State.flash.until > now ? State.flash : null;
      const waiting = State.approvals.length;
      // Live work only: a session silent for minutes no longer counts as working,
      // as on its row and for the mascot.
      const working = State.sessions.filter((s) => (s.state === "working" || s.state === "thinking") && !isStale(s, now)).length;
      let msg: string;
      let tone = "";
      // The widget line (date, weather, agenda, music) is asked for only when it
      // is what the pill shows: the media player is read for nothing otherwise.
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
        msg = summary() || t("cp.idle");
      } else if (working) {
        msg = t("cp.working", { w: working, n: State.sessions.length });
      } else {
        msg = summary() || t("cp.sessions", { n: State.sessions.length });
      }
      if (text.textContent !== msg) text.textContent = msg;
      // A long message is cut at the pill's edge: the whole of it on hover.
      if (text.title !== msg) text.title = msg;
      text.dataset.tone = tone;
      quiet.style.display = State.isQuiet ? "" : "none";

      const shown = State.sessions.slice(0, PILL_MINIS);
      const next = shown.map((s) => s.id).join("|");
      if (next !== key) {
        key = next;
        row.replaceChildren(...shown.map((s) => miniCanvas(s, 16)));
      }
      const extra = State.sessions.length - shown.length;
      more.hidden = extra <= 0;
      if (extra > 0) {
        more.textContent = `+${extra}`;
        more.title = t("cp.sessions", { n: State.sessions.length });
      }
    },
  };
  return compact;
}
