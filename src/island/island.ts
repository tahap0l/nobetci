// The island: DOM shell, open/close animation, owl placement, input and the
// frame loop. The loop only runs while something is moving, and never while the
// island is hidden — a sleeping Nöbetçi costs no CPU.

import { OwlEngine } from "../baykus/owl";
import { OwlGreeting } from "../baykus/greeting";
import { Spring, Tracked } from "../core/anim";
import { Bridge, IS_TAURI, type DecisionOptions } from "../core/bridge";
import { Sound } from "../core/sound";
import { State, type FlashTone, type IslandMode, type IslandView } from "../core/state";
import { t } from "../i18n/island";
import { h } from "../ui/dom";
import { buildCompact, buildViews, drawMinis, type ViewActions, type ViewHost } from "../ui/views";
import { IslandStateMachine } from "./fsm";
import {
  COMPACT_CORNER, EXPANDED_CORNER, EXPANDED_W, GREETING_H, HIDDEN_W, HIT_MARGIN,
  OWL_OVERHANG, PANEL_W, islandSize, owlPlacement,
} from "./layout";

const modeOrder = (m: IslandMode) => (m === "hidden" ? 0 : m === "compact" ? 1 : 2);

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
  private owlX = new Spring(26);
  private owlY = new Spring(12);
  private owlSize = new Spring(8);

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
  }

  // ── DOM ─────────────────────────────────────────────────────────────────────

  private build() {
    this.viewActions = {
      decide: (id, d, opts) => this.decide(id, d, opts),
      handToTerminal: (id) => this.handToTerminal(id),
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
          this.setMode("hidden");
          break;
        case "petit":
          if (from === "selam") this.greeting.interrupt();
          else if (from === "hidden") Sound.play("peek");
          this.setMode("compact");
          if (!this.wasInIsland) this.fsm.mouseLeft();
          break;
        case "home":
          this.expand(State.defaultView());
          if (!this.wasInIsland) this.fsm.mouseLeft();
          break;
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
    if (prev === "expanded" && mode !== "expanded") Sound.play("close");
    this.updateWindowCollapsed();
    this.animateGeometry(modeOrder(mode) < modeOrder(prev));
    State.notify();
  }

  private expand(view: IslandView) {
    State.view = view;
    if (State.mode !== "expanded") this.setMode("expanded");
    else this.animateGeometry(false);
    State.notify();
  }

  setView(view: IslandView) {
    if (State.mode !== "expanded") {
      State.view = view;
      this.fsm.forceHome();
      return;
    }
    State.view = view;
    this.dirty = true;
    this.ensureRunning();
  }

  collapse() {
    // A waiting request keeps the island open; closing would hide the card while
    // Claude Code waits on it. Hand it to the terminal instead if that is meant.
    if (State.approvals.length) return;
    this.fsm.pinned = false;
    this.fsm.forcePetit();
  }

  reveal() {
    this.fsm.reveal();
  }

  /** Another Nöbetçi window needs the top of the screen; a waiting card stays. */
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
    if (State.mode === "expanded") this.setView("approval");
    else if (State.isQuiet) {
      State.view = "approval";
      this.reveal();
    } else {
      State.view = "approval";
      this.fsm.forceHome();
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

  backToOverview() {
    State.detailId = null;
    this.setView(State.defaultView());
    State.notify();
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
      case "allow":
        if (!a) break;
        if (a.risk.level !== "low") {
          // Keystrokes can be synthesised, so the hotkey only covers low risk. Rust
          // would refuse it anyway; say so rather than failing silently.
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
    this.fsm.pinned = false;
    if (State.mode === "expanded" && State.view === "approval") {
      this.setView(State.defaultView());
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
      for (const a of State.approvals) void Bridge.approvalDecline(a.requestId);
      State.approvals = [];
      this.fsm.pinned = false;
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
        this.owl.triggerEmote(denied ? "annoyed" : "happy");
        const s = State.session(a.sessionId);
        if (s) {
          if (denied) s.denied++;
          else s.approved++;
        }
        const note = denied
          ? opts.stop
            ? t("out.denyStopped")
            : opts.message
              ? t("out.deniedWhy", { why: opts.message })
              : t("out.denied")
          : opts.remember
            ? t("out.allowedRemember")
            : t("out.allowed");
        this.finishApproval(requestId, note);
      })
      .catch((err: unknown) => {
        const code = String(err).replace(/^Error:\s*/, "").trim();
        switch (code) {
          case "not_pending":
            // The relay already gave up; the terminal is asking instead.
            this.finishApproval(requestId, t("out.fellBack"));
            return;
          case "input_not_physical":
            // Something tried to approve without a real click. Keep the card, say
            // it loudly, on the card itself: this is exactly what the guard exists for.
            this.owl.triggerEmote("surprised");
            State.cardWarning = { requestId, text: t("fl.notPhysical") };
            this.flash(t("fl.notPhysical"), "error");
            this.showApprovals();
            void Bridge.log(`card warning shown for req=${requestId}`);
            break;
          case "hold_required":
            this.flash(t("fl.holdRequired"), "error");
            break;
          case "hotkey_low_only":
            this.flash(t("fl.hotkeyLowOnly"), "error");
            break;
          default:
            if (!IS_TAURI) {
              this.finishApproval(requestId, t("out.fellBack"));
              return;
            }
            this.flash(code, "error");
        }
        Sound.play("error");
      });
  }

  private handToTerminal(requestId: string) {
    void Bridge.approvalDecline(requestId);
    Sound.play("blip");
    this.finishApproval(requestId, t("out.toTerminal"));
  }

  private finishApproval(requestId: string, note: string) {
    const a = State.approvals.find((x) => x.requestId === requestId);
    State.removeApproval(requestId);
    if (State.cardWarning?.requestId === requestId) State.cardWarning = null;
    const s = a && State.session(a.sessionId);
    if (s) {
      State.step(s, `${note} · ${a.tool}`);
      if (!State.approvals.some((x) => x.sessionId === s.id)) State.setState(s, "working");
    }
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
    if (shrinking) {
      this.width.curveTowards(w);
      this.height.curveTowards(hh);
      this.radius.curveTowards(r);
    } else {
      this.width.springTo(w);
      this.height.springTo(hh);
      this.radius.springTo(r);
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

  // ── Input ───────────────────────────────────────────────────────────────────

  private wireInput() {
    this.wakeStrip.addEventListener("mouseenter", () => {
      Sound.resume();
      if (State.mode === "hidden") this.fsm.mouseEntered();
    });

    this.islandEl.addEventListener("mousedown", (e) => {
      Sound.resume();
      State.lastActivity = performance.now();
      if (State.mode !== "expanded") {
        this.fsm.click();
        return;
      }
      if (this.isOwlHit(e.clientX, e.clientY)) {
        this.owl.poke();
        Sound.play("poke");
      }
    });

    if (!IS_TAURI) {
      window.addEventListener("mousemove", (e) => this.onCursor(e.clientX, e.clientY));
    }
  }

  /** Cursor in window-logical coordinates (from the Rust poll). */
  onCursor(x: number, y: number) {
    State.mouse = { x, y };
    const rect = this.islandRect();
    const inIsland =
      x >= rect.x - HIT_MARGIN && x <= rect.x + rect.w + HIT_MARGIN &&
      y >= rect.y - HIT_MARGIN && y <= rect.y + rect.h + HIT_MARGIN;

    if (inIsland && !this.wasInIsland) {
      if (this.fsm.state === "selam") this.greeting.hover();
      this.fsm.mouseEntered();
      State.lastActivity = performance.now();
    }
    if (!inIsland && this.wasInIsland) this.fsm.mouseLeft();
    this.wasInIsland = inIsland;
    this.ensureRunning();
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
    this.owlCanvas.style.opacity = place.visible && !greetingOn ? "1" : "0";
    if (place.visible && State.mode !== "hidden") this.drawOwl(dt);
    this.updateGlow(place.visible && State.mode === "expanded" && !greetingOn);

    // Once a second is plenty for clocks and mini owls.
    if (nowMs - this.lastTick > 250) {
      this.lastTick = nowMs;
      if (State.mode === "expanded") this.views.get(State.view)?.tick?.(nowMs);
      if (State.mode === "compact") this.compact.sync();
      if (State.mode !== "hidden") drawMinis(nowMs / 1000);
    }

    const settling = this.width.animating || this.height.animating || this.radius.animating;
    const busy =
      State.mode === "hidden"
        ? settling
        : settling ||
          !this.owlX.settled || !this.owlY.settled || !this.owlSize.settled ||
          greetingOn || this.owl.busy ||
          // Countdown and hold progress need the clock while a card is up.
          State.approvals.length > 0;

    if (busy) {
      requestAnimationFrame(this.frame);
    } else {
      this.running = false;
      Sound.idle();
    }
  };

  private drawOwl(dt: number) {
    const size = this.owlSize.value;
    const w = Math.max(1, Math.round(size));
    const hCss = w + OWL_OVERHANG;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvasPx !== w) {
      this.canvasPx = w;
      this.owlCanvas.width = Math.round(w * dpr);
      this.owlCanvas.height = Math.round(hCss * dpr);
      this.owlCanvas.style.width = `${w}px`;
      this.owlCanvas.style.height = `${hCss}px`;
    }
    this.owlCanvas.style.left = `${this.owlX.value - w / 2}px`;
    this.owlCanvas.style.top = `${this.owlY.value - hCss / 2}px`;

    const ctx = this.owlCanvas.getContext("2d");
    if (!ctx) return;
    const rect = this.islandRect();
    this.owl.lookX = Math.tanh((State.mouse.x - (rect.x + this.owlX.value)) / 260);
    this.owl.lookY = -Math.tanh((State.mouse.y - this.owlY.value) / 200);
    this.owl.update(dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hCss);
    this.owl.draw(ctx, w, hCss);
  }

  private updateGlow(on: boolean) {
    if (!on) {
      this.owlGlow.style.opacity = "0";
      return;
    }
    const mood = State.mood;
    const color =
      mood === "danger" || mood === "error" ? "#F4505E"
      : mood === "approval" || mood === "question" ? "#F5A524"
      : mood === "working" ? "#3B9EFF"
      : mood === "thinking" ? "#A78BFA"
      : mood === "finished" ? "#34D399"
      : "#FFFFFF";
    const d = this.owlSize.value * 2.1;
    this.owlGlow.style.width = `${d}px`;
    this.owlGlow.style.height = `${d}px`;
    this.owlGlow.style.left = `${this.owlX.value - d / 2}px`;
    this.owlGlow.style.top = `${this.owlY.value - d / 2}px`;
    this.owlGlow.style.background = `radial-gradient(circle, ${color} 0%, transparent 62%)`;
    this.owlGlow.style.opacity = mood === "idle" || mood === "sleeping" ? "0.12" : "0.5";
  }

  // ── DOM sync ────────────────────────────────────────────────────────────────

  private syncDom() {
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
    drawMinis(performance.now() / 1000);

    const mood = State.mood;
    if (mood !== this.lastMood) {
      this.lastMood = mood;
      this.owl.setMood(mood);
    }
    const a = State.currentApproval;
    this.owl.accent = a ? State.session(a.sessionId)?.accent ?? null : null;
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
