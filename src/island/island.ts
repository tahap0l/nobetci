// The island: DOM shell, open/close animation, owl placement, input and the
// frame loop. The loop only runs while something is moving, and never while the
// island is hidden — a sleeping Nobi costs no CPU.

import { OwlEngine, prefersReducedMotion, type OwlEmote, type OwlMood } from "../baykus/owl";
import { applyMascotPalette } from "../core/mascot-theme";
import { OwlGreeting } from "../baykus/greeting";
import { Spring, Tracked, clamp } from "../core/anim";
import { Bridge, IS_TAURI, IslandBridge, onEvent, type Anchor, type DecisionOptions, type InteractiveResponse } from "../core/bridge";
import { Sound } from "../core/sound";
import { State, handBackTo, isPlainLow, type FlashTone, type IslandMode, type IslandView, type Step } from "../core/state";
import { placed, t } from "../i18n/island";
import { h } from "../ui/dom";
import { buildCompact, buildViews, canStop, drawMinis, type ViewActions, type ViewHost } from "../ui/views";
import { IslandStateMachine } from "./fsm";
import {
  COMPACT_CORNER, COMPACT_H, EXPANDED_CORNER, EXPANDED_W, GREETING_H, HIDDEN_W, HIT_MARGIN,
  OWL_OVERHANG, PANEL_W, islandSize, owlPlacement, setMascotScale,
} from "./layout";

const modeOrder = (m: IslandMode) => (m === "hidden" ? 0 : m === "compact" ? 1 : 2);

/** Which of a session's counters an answer added to (taken back when it never arrived). */
type Counted = "approved" | "denied" | null;

/** How often the island asks Rust whether it is quiet (quiet hours start and end on their own). */
const QUIET_POLL_MS = 60_000;
/**
 * A blur this soon after the island gave the keyboard back is that hand-back
 * itself (the window stops being focusable), not the user going elsewhere.
 */
const RELEASE_BLUR_MS = 400;
/** Answered requests whose timeline line can still be corrected (C-21). */
const ANSWERED_KEPT = 40;

/** The mascot's position and size springs (Spring's defaults). */
const OWL_RESPONSE = 0.5;
const OWL_DAMPING = 0.72;

export class Island {
  readonly fsm = new IslandStateMachine();
  readonly owl = new OwlEngine();

  private root: HTMLElement;
  private islandEl!: HTMLElement;
  private contentEl!: HTMLElement;
  private viewsEl!: HTMLElement;
  private owlCanvas!: HTMLCanvasElement;
  private owlGlow!: HTMLElement;
  private greetingCanvas!: HTMLCanvasElement;
  private wakeStrip!: HTMLElement;
  private compact!: ReturnType<typeof buildCompact>;

  private header!: ViewHost;
  private viewActions!: ViewActions;
  private views!: Map<IslandView, ViewHost>;

  private width = new Tracked(HIDDEN_W);
  private height = new Tracked(0);
  private radius = new Tracked(COMPACT_CORNER);
  private owlX = new Spring(26, OWL_RESPONSE, OWL_DAMPING);
  private owlY = new Spring(12, OWL_RESPONSE, OWL_DAMPING);
  private owlSize = new Spring(8, OWL_RESPONSE, OWL_DAMPING);

  private greeting = new OwlGreeting();

  private running = false;
  private lastFrame = 0;
  private dirty = true;
  private canvasPx = 0;
  private lastTick = 0;

  // Rust starts the window at full size so the launch greeting has room.
  private collapsed = false;
  private collapseTimer: number | null = null;
  private wasInIsland = false;
  private pushedRect = { x: -1, y: -1, w: -1, h: -1 };
  private flashTimer: number | null = null;
  private lastMood = "";
  private lastAccent: string | null = null;
  /** A mood the assistant holds on the mascot while it waits for an answer. */
  private moodOverride: OwlMood | null = null;
  /** The island has the keyboard (the assistant's text box is up). */
  private keyboardOn = false;
  /** When the island last gave the keyboard back (performance.now()). */
  private keyboardOffAt = -Infinity;
  /** A text field on a card (the agenda) has the keyboard. */
  private typing = false;
  /** The field that asked for the keyboard, focused again once the window has it (C-20). */
  private typingField: HTMLElement | null = null;
  /**
   * The timeline line each answered request left, so an answer that never
   * reached the agent can say so instead (C-21); and the ids Rust reported
   * undelivered before the island had written that line.
   */
  private answered = new Map<string, { step: Step; sessionId: string; counted: Counted }>();
  private undelivered = new Set<string>();

  /** A view asked for while the island was not open: opening it shows that one. */
  private requestedView: IslandView | null = null;
  /** The assistant was opened from the pill (its hotkey): closing it folds back there. */
  private assistantFromPill = false;
  /** A card interrupted the assistant: it comes back once nothing waits. */
  private resumeAssistant = false;
  /** Wakes the loop when the mood can change with nothing happening (a finish fading, sleep). */
  private moodTimer: number | null = null;
  /** Clocks on an open island whose mascot sleeps (the frame loop is stopped). */
  private slowTimer: number | null = null;
  private quietTimer: number | null = null;
  private quietAt = -Infinity;
  /** A dead view (an answered card, a gone session) is being replaced. */
  private settleQueued = false;

  constructor(root: HTMLElement) {
    this.root = root;
    this.build();
    this.wireFsm();
    this.wireInput();
    this.owl.overhang = OWL_OVERHANG;
    this.owl.onDizzy = () => Sound.play("dizzy");
    this.greeting.onComplete = () => this.fsm.greetComplete();
    State.subscribe(() => {
      this.dirty = true;
      this.ensureRunning();
    });
    // An agenda item's time has come: a nudge from the owl (Rust shows the
    // notification). Quiet hours may have begun since the last hook event, so ask
    // Rust before making a sound.
    void onEvent<unknown>("agenda-due", () => {
      this.react("surprised");
      void this.refreshQuiet().then(() => Sound.play("blip"));
    });
    // The desktop mascot asks where things stand when it (re)loads.
    void onEvent<null>("buddy-ready", () => {
      void Bridge.toBuddy("buddy-mood", this.lastMood || State.mood);
      void Bridge.toBuddy("buddy-accent", this.lastAccent);
    });
    // An answer sent from here never reached the agent: the request was over
    // already (answered in the terminal, or the agent stopped waiting).
    void onEvent<{ requestId?: string }>("approval-undelivered", (p) => {
      if (typeof p?.requestId === "string") this.markUndelivered(p.requestId);
    });
  }

  /**
   * Says on the session's timeline that the answer to `requestId` did not
   * arrive, in place of the decision it named (C-21). Rust may report it before
   * the island has written that line: then the line says so when it is written.
   */
  markUndelivered(requestId: string) {
    const done = this.answered.get(requestId);
    if (!done) {
      if (State.approvals.some((a) => a.requestId === requestId)) this.undelivered.add(requestId);
      return;
    }
    this.answered.delete(requestId);
    const { step, sessionId, counted } = done;
    const tool = step.text.includes(" · ") ? step.text.slice(step.text.lastIndexOf(" · ")) : "";
    step.text = `${t("out.undelivered")}${tool}`;
    step.title = t("out.undeliveredTitle");
    // Nothing was allowed or denied after all.
    const s = State.session(sessionId);
    if (s && counted) s[counted] = Math.max(0, s[counted] - 1);
    State.notify();
  }

  /** A one-shot reaction, played by the island's mascot and the desktop one alike. */
  react(emote: OwlEmote) {
    this.owl.triggerEmote(emote);
    void Bridge.toBuddy("buddy-emote", emote);
    this.ensureRunning();
  }

  // ── DOM ─────────────────────────────────────────────────────────────────────

  private build() {
    this.viewActions = {
      decide: (id, d, opts) => this.decide(id, d, opts),
      handToTerminal: (id) => this.handToTerminal(id),
      respond: (id, r, anchor) => this.respond(id, r, anchor),
      allowLow: (anchor: Anchor, ids?: string[]) => this.allowLow(anchor, ids),
      openFolder: (cwd) => void Bridge.openFolder(cwd),
      focusSession: (id) => this.focusSession(id),
      showSession: (id) => this.showSession(id),
      back: () => this.backToOverview(),
      forgetSession: (id) => {
        State.endSession(id);
        this.backToOverview();
      },
      openSettings: (tab) => {
        this.yieldToSettings();
        void Bridge.openSettingsWindow(tab);
      },
      collapse: () => this.collapse(),
      togglePause: () => this.togglePause(),
      toggleDnd: () => void Bridge.setDnd(!State.settings.dnd),
      openAssistant: () => this.openAssistant(),
      assistantMood: (m) => {
        this.moodOverride = m;
        this.dirty = true;
        this.ensureRunning();
      },
      react: (e) => this.react(e),
    };
    const { header, views } = buildViews(this.viewActions);
    this.header = header;
    this.views = views;

    this.wakeStrip = h("div", { id: "wake-strip" });
    this.owlGlow = h("div", { id: "owl-glow" });
    this.owlCanvas = h("canvas", { id: "owl-canvas" });
    this.greetingCanvas = h("canvas", { id: "greeting-canvas" });
    this.compact = buildCompact();

    this.viewsEl = h("div", { id: "views" });
    for (const v of this.views.values()) this.viewsEl.append(v.el);
    this.contentEl = h("div", { id: "content" }, this.header.el, this.viewsEl);
    // Hidden from the start: the launch greeting opens an empty island, not a
    // header that fades out over it.
    this.contentEl.style.opacity = "0";
    this.owlCanvas.style.opacity = "0";

    this.islandEl = h(
      "div",
      { id: "island" },
      h("div", { id: "island-clip" }, this.greetingCanvas, this.contentEl, this.compact.el),
      this.owlGlow,
      this.owlCanvas,
    );

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.greetingCanvas.width = Math.round(EXPANDED_W * dpr);
    this.greetingCanvas.height = Math.round(GREETING_H * dpr);
    this.greetingCanvas.style.width = `${EXPANDED_W}px`;
    this.greetingCanvas.style.height = `${GREETING_H}px`;

    this.root.append(this.wakeStrip, this.islandEl);
    this.applyGeometry();
  }

  // ── State machine ───────────────────────────────────────────────────────────

  private wireFsm() {
    this.fsm.homeToPetitDelay = State.settings.autoCloseInterval;
    this.fsm.onTransition = (from, to) => {
      switch (to) {
        case "hidden":
          this.requestedView = null;
          this.setMode("hidden");
          break;
        case "petit":
          if (from === "selam") this.greeting.interrupt();
          else if (from === "hidden") Sound.play("peek");
          this.requestedView = null;
          this.setMode("compact");
          if (!this.wasInIsland) this.fsm.mouseLeft();
          break;
        case "home": {
          // A card or a view asked for during the greeting ends it.
          if (from === "selam") this.greeting.interrupt();
          const view = this.requestedView ?? State.defaultView();
          this.requestedView = null;
          this.expand(view);
          if (!this.wasInIsland) this.fsm.mouseLeft();
          break;
        }
        case "selam":
          this.expand("greeting");
          this.greeting.start();
          Sound.play("hoot");
          break;
      }
      State.notify();
    };
  }

  launch() {
    this.fsm.launch();
  }

  private setMode(mode: IslandMode) {
    const prev = State.mode;
    if (mode === prev) return;
    State.mode = mode;
    if (mode === "expanded" && prev !== "expanded") Sound.play("open");
    if (prev === "expanded" && mode !== "expanded") {
      Sound.play("close");
      this.resumeAssistant = false;
    }
    this.updateWindowCollapsed();
    this.animateGeometry(modeOrder(mode) < modeOrder(prev));
    this.syncKeyboard();
    this.syncQuietPoll();
    State.notify();
  }

  private expand(view: IslandView) {
    if (view !== State.view) this.endTypingOutside(view);
    State.view = view;
    if (State.mode !== "expanded") this.setMode("expanded");
    else this.animateGeometry(false);
    this.syncKeyboard();
    State.notify();
  }

  setView(view: IslandView) {
    if (this.fsm.state !== "home") {
      // Folded, hidden or still greeting: open through the state machine, so the
      // pin and the fold timer apply to what is on screen from now on.
      this.requestedView = view;
      this.fsm.forceHome();
      return;
    }
    if (view !== State.view) this.endTypingOutside(view);
    State.view = view;
    this.dirty = true;
    this.ensureRunning();
    this.syncKeyboard();
  }

  /** Opens the assistant and hands it the keyboard. */
  openAssistant() {
    if (!(State.mode === "expanded" && State.view === "assistant")) {
      // From the pill (its hotkey), closing the assistant folds back to the pill;
      // from the open island, it goes back to the overview.
      this.assistantFromPill = this.fsm.state !== "home";
    }
    // A request waiting for an answer comes first; the assistant follows it.
    if (State.approvals.length) {
      this.resumeAssistant = true;
      this.showApprovals();
      return;
    }
    this.fsm.pinned = true;
    this.setView("assistant");
    this.syncKeyboard();
    this.focusAssistant();
  }

  private focusAssistant() {
    (this.views.get("assistant") as (ViewHost & { focus?(): void }) | undefined)?.focus?.();
  }

  /**
   * Puts the caret back in the field that has the keyboard — the assistant's
   * box, or the card field that asked for it — unless the focus is already in
   * that view. Run once Rust has made the window the keyboard focus (C-20): a
   * field focused before that shows no caret and takes no key on Linux.
   */
  private refocusField() {
    if (!this.keyboardOn || State.mode !== "expanded") return;
    const active = document.activeElement;
    if (State.view === "assistant") {
      if (!this.views.get("assistant")?.el.contains(active)) this.focusAssistant();
    } else if (this.typing && this.typingField?.isConnected && (!active || active === document.body)) {
      this.typingField.focus();
    }
  }

  /**
   * No field the island stops showing keeps the focus (C-20): with the window
   * still focused, keys meant for the terminal would land in a hidden draft.
   */
  private releaseFields() {
    this.typingField = null;
    const active = document.activeElement as HTMLElement | null;
    if (!active || active === document.body || !this.root.contains(active)) return;
    if (active.isContentEditable || active.matches("input, textarea, select")) active.blur();
  }

  /**
   * The island takes the keyboard only while the assistant or a text field is
   * in use, and stays open meanwhile; anything else gives both back.
   */
  private syncKeyboard() {
    if (State.mode !== "expanded") this.typing = false;
    const on = State.mode === "expanded" && (State.view === "assistant" || this.typing);
    if (on === this.keyboardOn) return;
    this.keyboardOn = on;
    if (on) {
      // Rust makes the window the keyboard focus (C-20); the field takes it
      // once it has — here, and on the window's focus event.
      void Bridge.islandKeyboard(true).then(() => this.refocusField());
    } else {
      this.keyboardOffAt = performance.now();
      this.releaseFields();
      void Bridge.islandKeyboard(false);
    }
    if (!on) {
      this.moodOverride = null;
      this.dirty = true;
      if (!State.approvals.length) {
        this.fsm.pinned = false;
        // The pin held the island open; with the mouse already elsewhere, the
        // usual fold timer starts now rather than at the next hover.
        if (this.fsm.state === "home" && !this.wasInIsland) this.fsm.mouseLeft();
      }
    }
  }

  /** A text field the new view does not show cannot be typed into any more. */
  private endTypingOutside(view: IslandView) {
    if (!this.typing) return;
    const field = document.activeElement?.closest?.("[data-typing]");
    if (field && this.views.get(view)?.el.contains(field)) return;
    this.typing = false;
  }

  /** Typing is over (the field lost the focus, another app took it). */
  private endTyping() {
    if (!this.typing) return;
    this.typing = false;
    this.syncKeyboard();
  }

  collapse() {
    // A waiting request keeps the island open; closing would hide the card while
    // Claude Code waits on it. Hand it to the terminal instead if that is meant.
    if (State.approvals.length) return;
    this.fsm.pinned = false;
    this.assistantFromPill = false;
    this.resumeAssistant = false;
    this.fsm.forcePetit();
    // The state machine already counts the island as folded (it was opened some
    // other way): fold the island itself rather than leave it stuck open.
    if (this.fsm.state === "petit" && State.mode === "expanded") this.setMode("compact");
  }

  reveal() {
    this.fsm.reveal();
  }

  /** Another Nobi window needs the top of the screen; a waiting card stays. */
  yieldToSettings() {
    if (State.approvals.length || State.mode !== "expanded") return;
    this.collapse();
  }

  /**
   * Opens on the approval card and keeps the island open until it is answered.
   * While quiet it only peeks out: the compact island says a request is waiting.
   */
  showApprovals() {
    this.fsm.pinned = true;
    // The assistant comes back after the card only if it was in use when the
    // card came: it had the keyboard and the island the focus. If the user had
    // already gone back to the terminal or the browser, taking the keyboard
    // from them later would send their next keys into the assistant
    // (island-ui#0). Asked before the card takes the keyboard back.
    if (State.mode === "expanded" && State.view === "assistant") {
      this.resumeAssistant = this.keyboardOn && document.hasFocus();
    }
    if (State.mode === "expanded") this.setView("approval");
    else if (State.isQuiet) {
      State.view = "approval";
      this.reveal();
    } else {
      this.setView("approval");
    }
    State.notify();
  }

  /** Session detail: timeline, counters, go to window. */
  showSession(id: string) {
    if (!State.session(id)) return;
    State.detailId = id;
    this.setView(State.approvals.length ? "approval" : "session");
    State.notify();
  }

  /** Back from the session view or the assistant (its ← button, Esc, its hotkey). */
  backToOverview() {
    const fromAssistant = State.view === "assistant";
    State.detailId = null;
    if (fromAssistant && this.assistantFromPill && !State.approvals.length) {
      // Opened from the pill: closing it puts the island back the way it was.
      this.collapse();
      return;
    }
    this.setView(State.defaultView());
    State.notify();
  }

  /**
   * Replaces a view that has nothing left to show: an approval card answered
   * elsewhere, a session that ended, "waiting for a session" once one started
   * (or the session list once the last one ended).
   */
  settleView() {
    if (State.mode !== "expanded" || this.fsm.state !== "home") return;
    const view = State.view;
    if (view === "approval") {
      if (!State.currentApproval) this.afterApprovalChange();
      return;
    }
    // A waiting card comes first; showing it is afterApprovalChange's job.
    if (State.approvals.length) return;
    const gone = view === "session" && !(State.detailId && State.session(State.detailId));
    if (view === "session" && !gone) return;
    if (view !== "session" && view !== "overview" && view !== "empty") return;
    // Text being typed on the empty view's cards (the agenda) is not taken away.
    if (view !== "session" && this.typing) return;
    const next: IslandView = State.sessions.length ? "overview" : "empty";
    if (gone) State.detailId = null;
    if (next !== view) this.setView(next);
  }

  private focusSession(id: string) {
    const s = State.session(id);
    if (!s) return;
    const fallback = () => {
      if (s.cwd) void Bridge.openFolder(s.cwd);
    };
    if (!s.parents.length) {
      fallback();
      return;
    }
    void Bridge.focusSession(s.parents).then((ok) => {
      if (ok) this.collapse();
      else {
        this.flash(t("fl.noWindow"), "warn");
        fallback();
      }
    });
  }

  /** Global shortcuts, registered in Rust. */
  onHotkey(action: string) {
    const a = State.currentApproval;
    switch (action) {
      case "toggle":
        if (State.mode === "expanded") this.collapse();
        else this.setView(State.defaultView());
        break;
      case "deny":
        if (a) this.decide(a.requestId, "deny", { via: "hotkey" });
        break;
      case "assistant":
        if (State.mode === "expanded" && State.view === "assistant") this.backToOverview();
        else this.openAssistant();
        break;
      case "allow":
        if (!a) break;
        if (a.kind !== "permission") {
          // A question or a plan needs its answer, not a keystroke.
          this.showApprovals();
          this.flash(t("fl.answerOnCard"), "warn");
        } else if (!isPlainLow(a)) {
          // Keystrokes can be synthesised, so the hotkey only covers low risk, as
          // the engine scored it too (a rule re-scoring a request down does not
          // count). Rust would refuse it anyway; say so rather than fail silently.
          this.showApprovals();
          this.flash(t("fl.hotkeyLowOnly"), "error");
          Sound.play("error");
        } else {
          this.decide(a.requestId, "allow", { via: "hotkey" });
        }
        break;
    }
  }

  /** The queue changed: show the next card, or let the island relax. */
  afterApprovalChange() {
    if (State.approvals.length) {
      if (State.view !== "approval") this.showApprovals();
      return;
    }
    // A text box on the answered card (a plan note) is gone with it.
    if (this.typing && !document.activeElement?.closest?.("[data-typing]")) this.endTyping();
    // The assistant or a text field may still hold the keyboard: that pin stays.
    this.fsm.pinned = this.keyboardOn;
    if (State.mode === "expanded" && State.view === "approval") {
      // Back to what the card interrupted: the assistant, or the default view.
      const resume = this.resumeAssistant;
      this.resumeAssistant = false;
      if (resume) this.fsm.pinned = true;
      this.setView(resume ? "assistant" : State.defaultView());
      if (resume) this.focusAssistant();
      // Nothing left to decide: fold back unless the mouse is on the island.
      if (!this.wasInIsland) this.fsm.mouseLeft();
    }
  }

  /** A short message in the compact island (✓ bitti, seni bekliyor…). */
  flash(text: string, tone: FlashTone) {
    State.flash = { text, tone, until: Date.now() + 6000 };
    if (State.mode === "hidden") this.reveal();
    if (this.flashTimer != null) window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.flashTimer = null;
      State.notify();
    }, 6100);
    State.notify();
  }

  togglePause() {
    State.paused = !State.paused;
    if (State.paused) {
      // Paused means nobody is watching: every waiting request goes back to the
      // terminal now rather than timing out on a card nobody reads.
      for (const a of State.approvals) {
        void Bridge.approvalDecline(a.requestId, "paused");
        const s = State.session(a.sessionId);
        if (s) {
          // Said on the session's timeline, so a request does not just vanish —
          // naming what asks instead (the terminal, Cursor, the Claude app).
          State.step(s, `${placed("step.paused", handBackTo(s))} · ${a.tool}`);
          // The terminal has the question now; the row must not keep saying
          // "waiting for approval" for as long as the pause lasts.
          if (s.state === "approval") State.setState(s, "working");
        }
      }
      State.approvals = [];
      if (State.cardWarning) State.cardWarning = null;
      this.fsm.pinned = this.keyboardOn;
      this.resumeAssistant = false;
      if (State.view === "approval") State.view = State.defaultView();
    }
    Sound.play("blip");
    State.notify();
  }

  // ── Decisions ───────────────────────────────────────────────────────────────

  private decide(requestId: string, decision: "allow" | "allow_confirmed" | "deny", opts: DecisionOptions = {}) {
    const a = State.approvals.find((x) => x.requestId === requestId);
    if (!a) return;
    void Bridge.log(`decide ${decision} req=${requestId} risk=${a.risk.level} via=${opts.via ?? "user"}`);
    Bridge.approvalDecision(requestId, decision, opts)
      .then(() => {
        const denied = decision === "deny";
        Sound.play(denied ? "deny" : "allow");
        this.react(denied ? "deny" : "approve");
        // "Denied and stopped" only where the agent can be stopped: Codex and
        // Cursor take a plain deny (relay#1), and the card does not offer it there.
        const note = denied
          ? opts.stop && canStop(a)
            ? t("out.denyStopped")
            : opts.message && !opts.stop
              ? t("out.deniedWhy", { why: opts.message })
              : t("out.denied")
          : opts.remember
            ? t("out.allowedRemember")
            : t("out.allowed");
        this.finishApproval(requestId, note, { counted: denied ? "denied" : "approved" });
      })
      .catch((err: unknown) => this.decisionFailed(requestId, err));
  }

  /** A question answered or a plan approved / sent back from its card. */
  private respond(requestId: string, response: InteractiveResponse, anchor: Anchor) {
    const a = State.approvals.find((x) => x.requestId === requestId);
    if (!a) return;
    void Bridge.log(`respond ${response.kind} req=${requestId}`);
    Bridge.approvalRespond(requestId, response, anchor)
      .then(() => {
        const back = response.kind === "revise";
        Sound.play(back ? "blip" : "allow");
        this.react(back ? "hoot" : "approve");
        const note =
          response.kind === "answers"
            ? t("out.answered", { answer: Object.values(response.answers).join(" · ").slice(0, 80) })
            : back
              ? t("out.planRevise")
              : t("out.planApproved");
        this.finishApproval(requestId, note, { counted: back ? null : "approved" });
      })
      .catch((err: unknown) => this.decisionFailed(requestId, err));
  }

  /**
   * One click for the waiting low-risk requests the batch row listed (`ids`; the
   * ones low right now when it does not say). Rust allows only those still
   * pending and low by both levels (C-2).
   */
  private allowLow(anchor: Anchor, ids?: string[]) {
    const listed = (ids ? State.approvals.filter((a) => ids.includes(a.requestId)) : State.lowApprovals).filter(isPlainLow);
    if (!listed.length) return;
    const listedIds = listed.map((a) => a.requestId);
    void Bridge.log(`allow-low n=${listed.length}`);
    Bridge.approvalAllowLow(anchor, listedIds)
      .then(async (count) => {
        // Fewer allowed than listed: one was answered or handed over meanwhile.
        // Keep the card of any request Rust still has waiting.
        let waiting = new Set<string>();
        if (IS_TAURI && typeof count === "number" && count < listedIds.length) {
          const pending = await IslandBridge.approvalPending();
          waiting = new Set((pending ?? []).map((p) => String(p.request_id ?? "")));
        }
        const done = listed.filter((a) => !waiting.has(a.requestId));
        if (!done.length) return;
        Sound.play("allow");
        this.react("approve");
        for (const a of done) this.finishApproval(a.requestId, t("out.allowedBatch"), { counted: "approved" });
      })
      .catch((err: unknown) => this.decisionFailed(listedIds[0], err));
  }

  private decisionFailed(requestId: string, err: unknown) {
    const code = String(err).replace(/^Error:\s*/, "").trim();
    const a = State.approvals.find((x) => x.requestId === requestId);
    // What asks instead: the terminal, Cursor's own prompt or the Claude app.
    const place = handBackTo(a && State.session(a.sessionId));
    switch (code) {
      case "not_pending":
        // The relay already gave up; the terminal (or Cursor, or the app) is asking instead.
        this.finishApproval(requestId, placed("out.fellBack", place));
        return;
      case "terminal_only":
        // This platform cannot vouch for a hold (D23, C-25): Rust allows nothing
        // that needs one from the island. The card loses its Allow and says
        // where to decide; the request still waits there.
        if (State.holdApprovals) {
          State.holdApprovals = false;
          void Bridge.log("terminal_only: this platform's island cannot allow HIGH or CRITICAL requests");
        }
        this.showApprovals();
        break;
      case "too_soon":
        // The card had only just appeared: the click was meant for what was there
        // before (C-1). Nothing to say; the card stays.
        return;
      case "input_not_physical":
        // Something tried to approve without a real click. Keep the card, say
        // it loudly, on the card itself: this is exactly what the guard exists for.
        this.react("surprised");
        State.cardWarning = { requestId, text: t("fl.notPhysical") };
        this.flash(t("fl.notPhysical"), "error");
        this.showApprovals();
        void Bridge.log(`card warning shown for req=${requestId}`);
        break;
      case "guard_unavailable":
        State.cardWarning = { requestId, text: t("fl.guardUnavailable") };
        this.showApprovals();
        break;
      case "hold_incomplete":
      case "hold_required":
        this.flash(t("fl.holdRequired"), "error");
        break;
      case "hotkey_low_only":
        this.flash(t("fl.hotkeyLowOnly"), "error");
        break;
      case "no_hotkey":
        // A "hotkey" decision with no real key press behind it (C-12).
        this.react("surprised");
        this.flash(t("fl.noHotkey"), "error");
        break;
      case "needs_answer":
      case "unanswered":
        this.flash(t("fl.answerOnCard"), "warn");
        break;
      default:
        if (!IS_TAURI) {
          this.finishApproval(requestId, placed("out.fellBack", place));
          return;
        }
        this.flash(code, "error");
    }
    Sound.play("error");
  }

  private handToTerminal(requestId: string) {
    // The note names the place the card's button named: Cursor, the Claude app or the terminal.
    const a = State.approvals.find((x) => x.requestId === requestId);
    const place = handBackTo(a && State.session(a.sessionId));
    void Bridge.approvalDecline(requestId);
    Sound.play("blip");
    this.finishApproval(requestId, t(place === "cursor" ? "out.toCursor" : place === "app" ? "out.toApp" : "out.toTerminal"));
  }

  /**
   * The card is done: its line goes on the session's timeline. `sent`: an
   * answer went to Rust, with the session counter it adds to; that line and
   * that count are taken back if Rust reports it never arrived (C-21).
   */
  private finishApproval(requestId: string, note: string, sent?: { counted: Counted }) {
    const a = State.approvals.find((x) => x.requestId === requestId);
    State.removeApproval(requestId);
    if (State.cardWarning?.requestId === requestId) State.cardWarning = null;
    const s = a && State.session(a.sessionId);
    if (s) {
      if (sent?.counted) s[sent.counted]++;
      State.step(s, `${note} · ${a.tool}`);
      const step = s.steps[s.steps.length - 1];
      if (sent && step) {
        this.answered.set(requestId, { step, sessionId: s.id, counted: sent.counted });
        // Only the latest answers can still turn out undelivered.
        if (this.answered.size > ANSWERED_KEPT) this.answered.delete(this.answered.keys().next().value!);
      }
      if (!State.approvals.some((x) => x.sessionId === s.id)) State.setState(s, "working");
    }
    if (this.undelivered.delete(requestId)) this.markUndelivered(requestId);
    this.afterApprovalChange();
    State.notify();
  }

  // ── Geometry ────────────────────────────────────────────────────────────────

  private viewHeight(): number {
    return this.views.get(State.view)?.height() ?? 150;
  }

  private animateGeometry(shrinking: boolean) {
    const { w, h: hh } = islandSize(State.mode, State.view, this.viewHeight());
    const r = State.mode === "expanded" ? EXPANDED_CORNER : COMPACT_CORNER;
    // Like a phone's island: opening, the width leads with a little overshoot
    // and the height follows a beat later; closing, the height goes first.
    // With the system's "reduce motion" it eases both ways, with no overshoot
    // and no bounce (M-5).
    if (shrinking || prefersReducedMotion()) {
      this.width.curveTowards(w, 360);
      this.height.curveTowards(hh, 270);
      this.radius.curveTowards(r, 320);
    } else {
      this.width.springTo(w, 0.4, 0.7);
      this.height.springTo(hh, 0.52, 0.8);
      this.radius.springTo(r, 0.46, 0.82);
    }
    this.ensureRunning();
  }

  /** Jumps straight to the target geometry (demo screenshots, no animation). */
  snap() {
    this.syncDom();
    const { w, h: hh } = islandSize(State.mode, State.view, this.viewHeight());
    this.width.jump(w);
    this.height.jump(hh);
    this.radius.jump(State.mode === "expanded" ? EXPANDED_CORNER : COMPACT_CORNER);
    const place = owlPlacement(State.mode, State.view, hh);
    this.owlX.set(place.cx);
    this.owlY.set(place.cy);
    this.owlSize.set(place.size);
    this.applyGeometry();
    this.ensureRunning();
  }

  /** Re-aims the geometry when a view's content height changes. */
  private retargetHeight() {
    if (State.mode !== "expanded") return;
    const { h: hh } = islandSize(State.mode, State.view, this.viewHeight());
    if (prefersReducedMotion()) {
      // An ease to the new height, started again only when that height moves:
      // a spring would overshoot it, as after an Allow (M-5).
      if (Math.abs(this.height.target - hh) > 0.5) this.height.curveTowards(hh, 270);
      return;
    }
    if (Math.abs(this.height.value - hh) > 0.5 && !this.height.animating) this.height.springTo(hh);
    else if (this.height.animating) this.height.springTo(hh);
  }

  /** Left edge of the island inside the panel, for the chosen position. */
  private islandX(w: number): number {
    switch (State.settings.position) {
      case "left":
        return 0;
      case "right":
        return PANEL_W - w;
      default:
        return (PANEL_W - w) / 2;
    }
  }

  private applyGeometry() {
    const w = this.width.value;
    const hh = this.height.value;
    const r = this.radius.value;
    this.islandEl.style.left = `${this.islandX(w)}px`;
    this.islandEl.style.width = `${w}px`;
    this.islandEl.style.height = `${hh}px`;
    this.islandEl.style.borderRadius = `0 0 ${r}px ${r}px`;
    this.greetingCanvas.style.left = `${(w - EXPANDED_W) / 2}px`;

    const rect = { x: this.islandX(w), y: 0, w, h: hh };
    const p = this.pushedRect;
    if (Math.abs(p.x - rect.x) > 0.5 || Math.abs(p.w - rect.w) > 0.5 || Math.abs(p.h - rect.h) > 0.5) {
      this.pushedRect = rect;
      void Bridge.setIslandRect(rect.x, rect.y, rect.w, rect.h);
    }
  }

  private islandRect() {
    const w = this.width.value;
    return { x: this.islandX(w), y: 0, w, h: this.height.value };
  }

  /** Hidden → shrink the window to the wake strip so the OS stops sending cursor events. */
  private updateWindowCollapsed() {
    if (this.collapseTimer != null) {
      window.clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }
    if (State.mode === "hidden") {
      this.collapseTimer = window.setTimeout(() => {
        this.collapseTimer = null;
        if (State.mode !== "hidden") return;
        this.collapsed = true;
        void Bridge.setCollapsed(true);
      }, 420);
    } else if (this.collapsed) {
      this.collapsed = false;
      void Bridge.setCollapsed(false);
    }
  }

  // ── Quiet ───────────────────────────────────────────────────────────────────

  /**
   * Asks Rust whether it is quiet right now. Hook events carry the answer too,
   * but quiet hours begin and end with no event at all (C-14).
   */
  async refreshQuiet(): Promise<void> {
    if (!IS_TAURI) return;
    this.quietAt = performance.now();
    let quiet: typeof State.quiet;
    try {
      quiet = await IslandBridge.quietNow();
    } catch {
      return; // Unknown is not "not quiet": keep what the last event said.
    }
    if (quiet === State.quiet) return;
    State.quiet = quiet;
    Sound.quiet = State.isQuiet;
    State.notify();
  }

  /** The quiet check runs every minute while the island shows, never while hidden. */
  private syncQuietPoll() {
    const want = IS_TAURI && State.mode !== "hidden";
    if (want && this.quietTimer == null) {
      if (performance.now() - this.quietAt > 5_000) void this.refreshQuiet();
      this.quietTimer = window.setInterval(() => void this.refreshQuiet(), QUIET_POLL_MS);
    } else if (!want && this.quietTimer != null) {
      window.clearInterval(this.quietTimer);
      this.quietTimer = null;
    }
  }

  // ── Input ───────────────────────────────────────────────────────────────────

  private wireInput() {
    // Text fields on the cards (data-typing) need the keyboard, which the island
    // never takes on its own: ask for it on the press, give it back on blur.
    this.islandEl.addEventListener("pointerdown", (e) => {
      const field = (e.target as Element | null)?.closest?.<HTMLElement>("[data-typing]");
      if (!field || this.typing || State.view === "assistant") return;
      this.typing = true;
      this.typingField = field;
      this.fsm.pinned = true;
      this.syncKeyboard();
      window.setTimeout(() => field.focus(), 60);
    });
    // A field the island does not show takes no key (C-20): the island folded
    // or hidden, or the field's view not the one on screen. Enter in a draft
    // nobody sees would send it; a key meant for the terminal would land in it.
    const offScreen = (e: Event) => {
      const field = (e.target as Element | null)?.closest?.<HTMLElement>("input, textarea, select, [contenteditable]");
      if (!field) return;
      const shown = State.mode === "expanded" && State.view !== "greeting" && this.views.get(State.view)?.el.contains(field);
      if (shown) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      field.blur();
    };
    this.root.addEventListener("keydown", offScreen, true);
    this.root.addEventListener("beforeinput", offScreen, true);
    this.islandEl.addEventListener("focusout", (e) => {
      if (!this.typing) return;
      const next = e.relatedTarget as Element | null;
      if (next?.closest?.("[data-typing]")) return;
      window.setTimeout(() => {
        // A click in another application leaves the field focused inside this
        // page, but the page itself has lost the focus: typing is over then too.
        if (document.hasFocus() && document.activeElement?.closest?.("[data-typing]")) return;
        this.endTyping();
      }, 120);
    });
    // The user went to another application.
    window.addEventListener("blur", () => {
      this.endTyping();
      // Gone elsewhere while a card waits over the assistant: the assistant
      // comes back after it without taking the keyboard (island-ui#0). A blur
      // just after the island gave the keyboard back is that hand-back itself.
      if (State.approvals.length && performance.now() - this.keyboardOffAt > RELEASE_BLUR_MS) {
        this.resumeAssistant = false;
      }
      // The assistant keeps its draft but no longer holds the island open: it
      // folds like any other view once the mouse is away.
      if (State.mode === "expanded" && State.view === "assistant" && !State.approvals.length) {
        this.fsm.pinned = false;
        if (this.fsm.state === "home" && !this.wasInIsland) this.fsm.mouseLeft();
      }
    });
    window.addEventListener("focus", () => {
      if (State.mode === "expanded" && State.view === "assistant") this.fsm.pinned = true;
      // The window has the keyboard now (Rust gave it, C-20): the field that
      // asked for it takes it, so the first key typed is not lost.
      this.refocusField();
      if (performance.now() - this.quietAt > 5_000) void this.refreshQuiet();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && State.mode !== "hidden") void this.refreshQuiet();
    });

    this.wakeStrip.addEventListener("mouseenter", () => {
      Sound.resume();
      if (State.mode === "hidden") this.fsm.mouseEntered();
    });

    this.islandEl.addEventListener("mousedown", (e) => {
      Sound.resume();
      this.noteActivity();
      // Only the main button opens the pill or pokes the mascot: a right-click
      // or a middle-click on the pill does nothing (live L-B).
      if (e.button !== 0) return;
      if (State.mode !== "expanded") {
        this.fsm.click();
        return;
      }
      if (this.isOwlHit(e.clientX, e.clientY)) {
        this.owl.poke();
        Sound.play("poke");
      }
    });
    // Typing on the island is being around too.
    this.islandEl.addEventListener("keydown", () => this.noteActivity());

    if (!IS_TAURI) {
      window.addEventListener("mousemove", (e) => this.onCursor(e.clientX, e.clientY));
    }
  }

  /** Someone is at the island: the mascot stays awake, or wakes up. */
  private noteActivity() {
    State.lastActivity = performance.now();
    if (this.lastMood === "sleeping" && State.mood !== "sleeping") {
      this.dirty = true;
      this.ensureRunning();
    }
  }

  /** Cursor in window-logical coordinates (from the Rust poll). */
  onCursor(x: number, y: number) {
    State.mouse = { x, y };
    const rect = this.islandRect();
    const inIsland =
      x >= rect.x - HIT_MARGIN && x <= rect.x + rect.w + HIT_MARGIN &&
      y >= rect.y - HIT_MARGIN && y <= rect.y + rect.h + HIT_MARGIN;

    if (inIsland) this.noteActivity();
    if (inIsland && !this.wasInIsland) {
      if (this.fsm.state === "selam") this.greeting.hover();
      this.fsm.mouseEntered();
    }
    if (!inIsland && this.wasInIsland) this.fsm.mouseLeft();
    this.wasInIsland = inIsland;
    // Awake, the mascot follows the cursor. Asleep its eyes are shut, so a cursor
    // moving elsewhere on the screen changes nothing: no frame for it.
    if (inIsland || this.lastMood !== "sleeping") this.ensureRunning();
  }

  private isOwlHit(x: number, y: number): boolean {
    const rect = this.islandRect();
    const cx = rect.x + this.owlX.value;
    const cy = rect.y + this.owlY.value;
    const r = this.owlSize.value / 2;
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  }

  // ── Frame loop ──────────────────────────────────────────────────────────────

  ensureRunning() {
    if (this.running) return;
    this.running = true;
    if (this.slowTimer != null) {
      window.clearTimeout(this.slowTimer);
      this.slowTimer = null;
    }
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (nowMs: number) => {
    const dt = Math.min(0.05, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;

    if (this.dirty) {
      this.dirty = false;
      this.syncDom();
      this.retargetHeight();
    }

    this.width.step(dt, nowMs);
    this.height.step(dt, nowMs);
    this.radius.step(dt, nowMs);
    this.applyGeometry();

    const place = owlPlacement(State.mode, State.view, this.height.value);
    this.owlX.target = place.cx;
    this.owlY.target = place.cy;
    this.owlSize.target = place.size;
    // With "reduce motion" the mascot glides into place without overshooting
    // (critically damped), like the island around it (M-5).
    const damping = prefersReducedMotion() ? 1 : OWL_DAMPING;
    if (this.owlX.zeta !== damping) {
      for (const s of [this.owlX, this.owlY, this.owlSize]) s.configure(OWL_RESPONSE, damping);
    }
    this.owlX.step(dt);
    this.owlY.step(dt);
    this.owlSize.step(dt);

    const greetingOn = State.mode === "expanded" && State.view === "greeting";
    if (greetingOn) {
      const g = this.greetingCanvas.getContext("2d");
      if (g) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.greeting.draw(g);
      }
    }
    // The mascot comes and goes with the island's height at the top edge: it
    // fades in and out with it, and while the island is thinner than the pill
    // it is cut at the island's lower edge, so it never hangs below a pill that
    // has not grown yet (a closing island is never thinner than the pill).
    const shown = greetingOn ? 0 : clamp((this.height.value - 14) / 16, 0, 1);
    const opacity = shown >= 1 ? "1" : shown.toFixed(3);
    if (this.owlCanvas.style.opacity !== opacity) this.owlCanvas.style.opacity = opacity;
    if (shown > 0) {
      this.drawOwl(dt);
      this.clipOwlToIsland();
    }
    this.updateGlow(place.visible && State.mode === "expanded" && !greetingOn);

    // The small mascots move at the frame rate while anything does; never while hidden.
    if (State.mode !== "hidden") drawMinis(nowMs / 1000);

    // Clocks and countdowns: four times a second is plenty.
    if (nowMs - this.lastTick > 250) {
      this.lastTick = nowMs;
      if (State.mode === "expanded") this.views.get(State.view)?.tick?.(nowMs);
      if (State.mode === "compact") this.compact.sync();
      // A deadline passed with no event (a finish fading, calm turning into sleep).
      if ((this.moodOverride ?? State.mood) !== this.lastMood) this.dirty = true;
    }

    const settling = this.width.animating || this.height.animating || this.radius.animating;
    const busy =
      this.dirty ||
      (State.mode === "hidden"
        ? settling
        : settling ||
          !this.owlX.settled || !this.owlY.settled || !this.owlSize.settled ||
          greetingOn || this.owl.busy ||
          // Countdown and hold progress need the clock while a card is up.
          State.approvals.length > 0);

    if (busy) {
      requestAnimationFrame(this.frame);
    } else {
      this.running = false;
      Sound.idle();
      this.scheduleSlowTick();
    }
  };

  /**
   * The loop has stopped (the mascot sleeps) but the island is open: its clocks
   * ("12 s ago") still tick, once a second, without drawing frames.
   */
  private scheduleSlowTick() {
    if (this.slowTimer != null || State.mode !== "expanded") return;
    this.slowTimer = window.setTimeout(() => {
      this.slowTimer = null;
      if (this.running || State.mode !== "expanded") return;
      this.views.get(State.view)?.tick?.(performance.now());
      this.scheduleSlowTick();
    }, 1000);
  }

  /** Wakes the loop when the mood can change with nothing happening (Y-4). */
  private scheduleMoodCheck() {
    if (this.moodTimer != null) window.clearTimeout(this.moodTimer);
    this.moodTimer = null;
    const wait = State.moodChangeIn();
    if (wait == null) return;
    this.moodTimer = window.setTimeout(() => {
      this.moodTimer = null;
      this.dirty = true;
      this.ensureRunning();
    }, Math.ceil(wait) + 40);
  }

  private drawOwl(dt: number) {
    const size = this.owlSize.value;
    const w = Math.max(1, Math.round(size));
    // The canvas is wider than the mascot (D15) so spread wings, tails, manes and
    // the deny huffs are not cut by its edges, and it has headroom in proportion
    // to the mascot for the badges and sparkles. It stays centred on the mascot,
    // which therefore sits exactly where it did; the canvas takes no clicks.
    const margin = Math.round(w * 0.2);
    const cw = w + 2 * margin;
    const hCss = w + Math.max(OWL_OVERHANG, Math.round(w * 0.7));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvasPx !== w) {
      this.canvasPx = w;
      this.owlCanvas.width = Math.round(cw * dpr);
      this.owlCanvas.height = Math.round(hCss * dpr);
      this.owlCanvas.style.width = `${cw}px`;
      this.owlCanvas.style.height = `${hCss}px`;
    }
    this.owlCanvas.style.left = `${this.owlX.value - cw / 2}px`;
    this.owlCanvas.style.top = `${this.owlY.value - hCss / 2}px`;

    const ctx = this.owlCanvas.getContext("2d");
    if (!ctx) return;
    const rect = this.islandRect();
    this.owl.lookX = Math.tanh((State.mouse.x - (rect.x + this.owlX.value)) / 260);
    this.owl.lookY = -Math.tanh((State.mouse.y - this.owlY.value) / 200);
    this.owl.update(dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, hCss);
    ctx.translate(margin, 0);
    this.owl.setSkin(State.settings.mascotTheme);
    this.owl.draw(ctx, w, hCss);
  }

  /** Cuts the mascot's canvas at the island's lower edge while the island is thinner than the pill. */
  private clipOwlToIsland() {
    const c = this.owlCanvas.style;
    let clip = "";
    if (State.mode !== "expanded" && this.height.value < COMPACT_H) {
      // Read back from the canvas's own placement, whatever size drawOwl gave it.
      const bottom = parseFloat(c.top) + parseFloat(c.height);
      const cut = bottom - this.height.value;
      if (cut > 0) clip = `inset(0 0 ${cut.toFixed(1)}px 0)`;
    }
    if (c.clipPath !== clip) c.clipPath = clip;
  }

  private updateGlow(on: boolean) {
    // It follows the mascot even while fading out, so closing shrinks it into the
    // pill instead of leaving it floating where the open island used to be.
    const d = this.owlSize.value * 2.1;
    const g = this.owlGlow.style;
    g.width = `${d}px`;
    g.height = `${d}px`;
    g.left = `${this.owlX.value - d / 2}px`;
    g.top = `${this.owlY.value - d / 2}px`;
    if (!on) {
      g.transitionDuration = "0.14s";
      g.opacity = "0";
      return;
    }
    const mood = this.moodOverride ?? State.mood;
    const color =
      mood === "danger" || mood === "error" ? "#F4505E"
      : mood === "approval" || mood === "question" ? "#F5A524"
      : mood === "working" ? "#3B9EFF"
      : mood === "thinking" ? "#A78BFA"
      : mood === "finished" ? "#34D399"
      : "#FFFFFF";
    g.transitionDuration = "";
    g.background = `radial-gradient(circle, ${color} 0%, transparent 62%)`;
    g.opacity = mood === "idle" || mood === "sleeping" ? "0.12" : "0.5";
  }

  // ── DOM sync ────────────────────────────────────────────────────────────────

  private syncDom() {
    setMascotScale(State.settings.islandMascotSize);
    const expanded = State.mode === "expanded";
    const greetingOn = expanded && State.view === "greeting";

    this.islandEl.dataset.mode = State.mode;
    this.islandEl.dataset.quiet = State.isQuiet ? "1" : "";
    this.contentEl.style.opacity = expanded && !greetingOn ? "1" : "0";
    this.contentEl.style.pointerEvents = expanded && !greetingOn ? "auto" : "none";
    this.greetingCanvas.style.display = greetingOn ? "block" : "none";
    this.compact.el.classList.toggle("on", State.mode === "compact");

    this.header.sync();
    for (const [name, view] of this.views) {
      const on = name === State.view;
      view.el.classList.toggle("on", on);
      if (on) view.sync();
    }
    this.compact.sync();
    if (State.mode !== "hidden") drawMinis(performance.now() / 1000);

    const mood = this.moodOverride ?? State.mood;
    if (mood !== this.lastMood) {
      this.lastMood = mood;
      this.owl.setMood(mood);
      void Bridge.toBuddy("buddy-mood", mood);
    }
    this.scheduleMoodCheck();
    const a = State.currentApproval;
    const accent = a ? State.session(a.sessionId)?.accent ?? null : null;
    this.owl.accent = accent;
    if (accent !== this.lastAccent) {
      this.lastAccent = accent;
      void Bridge.toBuddy("buddy-accent", accent);
    }

    // Never leave a dead view up: a card answered elsewhere (its buttons would do
    // nothing), a session that ended, "waiting for a session" once one started.
    if (expanded && this.fsm.state === "home" && !this.settleQueued && this.viewIsStale()) {
      this.settleQueued = true;
      queueMicrotask(() => {
        this.settleQueued = false;
        this.settleView();
      });
    }
  }

  private viewIsStale(): boolean {
    switch (State.view) {
      case "approval":
        return !State.currentApproval;
      case "session":
        return !State.approvals.length && !(State.detailId && State.session(State.detailId));
      case "overview":
        return !State.approvals.length && !this.typing && State.sessions.length === 0;
      case "empty":
        return !State.approvals.length && !this.typing && State.sessions.length > 0;
      default:
        return false;
    }
  }

  /**
   * Rebuilds every view in the current language. State is untouched: waiting
   * requests, sessions and the island's mode all carry over.
   */
  relocalize() {
    const { header, views } = buildViews(this.viewActions);
    this.header.el.replaceWith(header.el);
    for (const [name, view] of this.views) views.get(name) && view.el.replaceWith(views.get(name)!.el);
    this.header = header;
    this.views = views;
    const compact = buildCompact();
    this.compact.el.replaceWith(compact.el);
    this.compact = compact;
    this.dirty = true;
    this.ensureRunning();
  }

  /** Applies settings from Rust (boot, or the settings window). */
  applySettings() {
    applyMascotPalette(State.settings.mascotTheme);
    Sound.setEnabled(State.settings.soundEnabled);
    Sound.setVolume(State.settings.soundVolume);
    Sound.setMuted(State.settings.mutedSounds);
    Sound.quiet = State.isQuiet;
    this.fsm.homeToPetitDelay = State.settings.autoCloseInterval;
    this.wakeStrip.dataset.position = State.settings.position;
    this.pushedRect = { x: -1, y: -1, w: -1, h: -1 };
    this.applyGeometry();
    State.notify();
  }
}
