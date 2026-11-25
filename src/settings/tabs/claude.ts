// Claude Code: hook status, an end-to-end health check, which events to listen
// to, and install / update / removal — always through a reviewed diff. The
// preview flow and the health view are shared with the first-run wizard.

import { ALL_EVENTS } from "../../core/settings-model";
import { h } from "../../ui/dom";
import { api, errCode, errText, type HealthReport, type HookPreview, type HookStatus } from "../api";
import { cache, loadHookStatus } from "../data";
import { t, type MsgKey } from "../i18n";
import { icon } from "../icons";
import { app, devParam, refreshBadges, rerender, type Tab } from "../nav";
import { reviewDialog } from "../review";
import { flush, onExternalChange, onLocalChange, same, settings, update } from "../store";
import { button, card, checkbox, notice, pill, row, toggle } from "../ui";

let health: HealthReport | null = null;
let healthRunning = false;
/**
 * Text is a function so the message follows a language switch. `rust` marks
 * text Rust wrote in the old language: it is dropped on a switch instead.
 * `installed`: what a "written" / "removed" message says the hooks are now; a
 * status read later that disagrees (hooks removed outside this window) drops it.
 */
let message: { kind: "ok" | "error"; text: () => string; rust?: boolean; installed?: boolean } | null = null;
let busy = false;

/** The message and the health report describe hooks as they no longer are: drop them. */
function dropStale() {
  const hs = cache.hookStatus;
  if (!hs) return;
  if (message?.installed !== undefined && message.installed !== hs.installed) message = null;
  if (health && health.installed !== hs.installed) health = null;
}

async function refresh() {
  await loadHookStatus();
  refreshBadges();
  rerender("claude");
}

/** Runs the end-to-end check (after saving, since Rust compares with the saved events). */
export async function checkHealth(): Promise<HealthReport | null> {
  await flush();
  const report = await api.hooksHealth();
  await loadHookStatus();
  refreshBadges();
  return report;
}

async function runHealth() {
  healthRunning = true;
  health = null;
  rerender("claude");
  health = await checkHealth();
  healthRunning = false;
  rerender("claude");
}

/** A preview or write error as a message: codes in the UI language, Rust's own text as is. */
function errorMessage(err: unknown): NonNullable<typeof message> {
  const coded = !!errCode(err);
  const text = errText(err);
  return { kind: "error", text: () => (coded ? errText(err) : text), rust: !coded };
}

export interface PreviewHooks {
  /** After the write landed and the status was reread. */
  onApplied?: () => void;
  /** The preview could not be made; without it the error shows on the Claude Code tab. */
  onError?: (text: string) => void;
}

/**
 * Preview → diff → "Onayla ve yaz". Nothing is written without that click, and
 * Rust writes exactly what was previewed, refusing if settings.json changed.
 */
export async function openPreview(install: boolean, hooks: PreviewHooks = {}): Promise<void> {
  if (busy) return;
  busy = true;
  message = null;
  let p: HookPreview;
  try {
    await flush();
    p = await api.hooksPreview(install);
  } catch (err) {
    busy = false;
    const m = errorMessage(err);
    if (hooks.onError) hooks.onError(m.text());
    else {
      message = m;
      rerender("claude");
    }
    return;
  }
  busy = false;
  // The diff was made from the saved event selection: if that changes while the
  // dialog is up (another window, an import), the diff is no longer the change.
  const previewed = [...settings().hookEvents];
  reviewDialog({
    title: install ? t("claude.reviewInstall") : t("claude.reviewRemove"),
    intro: install ? t("claude.reviewInstallText") : t("claude.reviewRemoveText"),
    preview: p,
    confirmLabel: install ? t("claude.approveWrite") : t("claude.approveRemove"),
    danger: !install,
    apply: (fingerprint) => api.hooksApply(install, fingerprint),
    onApplied: async (backup) => {
      const key: MsgKey = install
        ? backup
          ? "claude.written"
          : "claude.writtenNoBackup"
        : backup
          ? "claude.removed"
          : "claude.removedNoBackup";
      message = { kind: "ok", text: () => t(key, { backup: backup ?? "" }), installed: install };
      // The old report described the hooks as they were.
      health = null;
      if (install) app.hooksLost = false;
      await refresh();
      hooks.onApplied?.();
    },
    again: () => void openPreview(install, hooks),
    watch: install
      ? (invalidate) => {
          const check = () => {
            if (!same(settings().hookEvents, previewed)) invalidate();
          };
          const offA = onExternalChange(check);
          const offB = onLocalChange(check);
          return () => {
            offA();
            offB();
          };
        }
      : undefined,
  });
}

/** Hooks were installed once but someone rewrote settings.json without them. */
export function hooksLost(): boolean {
  return app.hooksLost && cache.hookStatusLoaded && !cache.hookStatus?.installed;
}

/** The relay is not where the hooks would point: installing would only write dead entries. */
function relayMissing(): boolean {
  return cache.hookStatusLoaded && !!cache.hookStatus && !cache.hookStatus.hookReady;
}

function lostWarning(): HTMLElement | null {
  if (!hooksLost()) return null;
  return h(
    "div",
    { class: "lost" },
    notice("error", t("claude.lost")),
    h(
      "div",
      { class: "btn-row" },
      button(t("claude.btn.reinstall"), {
        kind: "primary",
        icon: "reset",
        fk: "hooks:reinstall-lost",
        disabled: relayMissing(),
        onClick: () => void openPreview(true),
      }),
    ),
  );
}

function statusBlock(): HTMLElement {
  const s = cache.hookStatus;
  if (!cache.hookStatusLoaded) return h("div", { class: "muted", text: t("claude.readingStatus") });
  if (!s) return notice("warn", t("claude.statusFailed"));
  const pills = h(
    "div",
    { class: "pill-row" },
    s.installed ? pill("ok", t("claude.pill.installed"), "check") : pill("warn", t("claude.pill.notInstalled"), "warn"),
    s.hookReady
      ? pill("ok", t("claude.pill.relayReady"), "check")
      : pill("bad", t("claude.pill.relayMissing"), "cross"),
    s.stale ? pill("bad", t("claude.pill.stale"), "warn") : null,
  );
  const chips = h("div", { class: "event-chips" });
  if (s.events.length) for (const e of s.events) chips.append(h("span", { class: "ev-chip mono", text: e }));
  else chips.append(h("span", { class: "muted", text: t("claude.noEntries") }));

  return h(
    "div",
    { class: "status-block" },
    pills,
    h(
      "dl",
      { class: "kv" },
      h("dt", { text: t("claude.kv.settings") }),
      h("dd", {}, h("code", { class: "mono path", text: s.settingsPath })),
      h("dt", { text: t("claude.kv.relay") }),
      h("dd", {}, h("code", { class: "mono path", text: s.hookPath })),
      h("dt", { text: t("claude.kv.events") }),
      h("dd", {}, chips),
    ),
    s.hookReady ? null : notice("error", t("err.relayMissing")),
    gitBashNote(s),
  );
}

/**
 * Windows: no spelling of the relay's path runs in both Git Bash and PowerShell,
 * so the hooks are quoted for Git Bash, and a hook Claude Code runs in
 * PowerShell never reaches Nobi (hooks.rs git_bash_only). Shared with the wizard.
 */
export function gitBashNote(s: HookStatus | null): HTMLElement | null {
  if (!s?.gitBashOnly) return null;
  return notice("warn", h("strong", { text: t("claude.gitBashOnly") }), " ", t("claude.gitBashOnlyText"));
}

export function healthRunningView(): HTMLElement {
  return h(
    "div",
    { class: "health running" },
    h("span", { class: "spinner" }),
    h("span", { text: t("claude.health.running") }),
  );
}

/** Which of the two events approvals depend on are switched off in the settings. */
function approvalGaps(): { permission: boolean; preTool: boolean } {
  const ev = new Set(settings().hookEvents);
  return { permission: !ev.has("PermissionRequest"), preTool: !ev.has("PreToolUse") };
}

/**
 * Whether a health report is all good — what the checklist's head says, and
 * what ticks the wizard's Health step: the hooks, the relay, the round trip,
 * the click guard, and both routes approvals take (PermissionRequest and
 * PreToolUse selected).
 */
export function healthPasses(r: HealthReport): boolean {
  const gaps = approvalGaps();
  return (
    r.relayExists &&
    r.installed &&
    !r.eventsMissing.length &&
    !r.stale &&
    r.roundtripMs != null &&
    r.inputGuard &&
    !gaps.permission &&
    !gaps.preTool &&
    !r.error
  );
}

/** The ✓/✗ checklist for a health report; `error` is Rust's own text, shown as is. */
export function healthView(r: HealthReport): HTMLElement {
  const line = (state: "ok" | "bad" | "note", title: string, detail?: string | Node) =>
    h(
      "li",
      { class: state },
      h("span", { class: "hc-ic" }, icon(state === "ok" ? "check" : state === "bad" ? "cross" : "hakkinda", 14)),
      h(
        "span",
        { class: "hc-text" },
        h("span", { class: "hc-title", text: title }),
        detail ? h("span", { class: "hc-detail" }, detail) : null,
      ),
    );
  const ok = (b: boolean) => (b ? "ok" : "bad");
  // Approvals reach the island through PermissionRequest; questions, plans and
  // every approval in the Claude desktop app come through PreToolUse.
  const gaps = approvalGaps();
  const routes = !gaps.permission && !gaps.preTool;
  const pass = healthPasses(r);
  return h(
    "div",
    { class: `health ${pass ? "pass" : "fail"}` },
    h(
      "div",
      { class: "health-head" },
      icon(pass ? "check" : "warn", 16),
      h("strong", { text: pass ? t("claude.health.pass") : t("claude.health.fail") }),
    ),
    h(
      "ul",
      { class: "checklist" },
      line(
        ok(r.relayExists),
        r.relayExists ? t("claude.health.relayOk") : t("claude.health.relayMissing"),
        h("code", { class: "mono", text: r.relayPath }),
      ),
      line(
        ok(r.installed),
        r.installed ? t("claude.health.entriesOk", { n: r.eventsInstalled.length }) : t("claude.health.entriesMissing"),
        h("code", { class: "mono", text: r.settingsPath }),
      ),
      line(
        ok(!r.eventsMissing.length),
        r.eventsMissing.length
          ? t("claude.health.missing", { list: r.eventsMissing.join(", ") })
          : t("claude.health.allEvents"),
      ),
      line(
        ok(routes),
        gaps.permission
          ? t("claude.health.noPermission")
          : gaps.preTool
            ? t("claude.health.noPreTool")
            : t("claude.health.routesOk"),
      ),
      r.statusLine === "ours"
        ? line("ok", t("claude.health.statusLineOurs"))
        : r.statusLine === "foreign"
          ? line("note", t("claude.health.statusLineForeign"))
          : null,
      line(ok(!r.stale), r.stale ? t("claude.pill.stale") : t("claude.health.noStale")),
      line(
        ok(r.roundtripMs != null),
        r.roundtripMs != null ? t("claude.health.ping", { ms: r.roundtripMs }) : t("claude.health.noPing"),
      ),
      line(
        ok(r.inputGuard),
        r.inputGuard ? t("claude.health.guardOk") : t("claude.health.guardFail"),
        r.inputGuard ? undefined : t("claude.health.guardFailText"),
      ),
    ),
    r.error ? notice("error", h("span", { class: "verbatim", text: r.error })) : null,
  );
}

function healthBlock(): HTMLElement | null {
  if (healthRunning) return healthRunningView();
  return health ? healthView(health) : null;
}

function eventsCard(): HTMLElement {
  const s = settings();
  const hs = cache.hookStatus;
  const chosen = new Set(s.hookEvents);
  const grid = h("div", { class: "event-grid" });
  for (const ev of ALL_EVENTS) {
    const tag =
      ev === "PermissionRequest"
        ? t("claude.required")
        : ev === "PreToolUse"
          ? t("claude.requiredPreTool")
          : null;
    grid.append(
      checkbox(
        chosen.has(ev),
        h("span", { class: "mono", text: ev }),
        (on) => {
          update((x) => {
            const set = new Set(x.hookEvents);
            if (on) set.add(ev);
            else set.delete(ev);
            x.hookEvents = ALL_EVENTS.filter((e) => set.has(e));
          });
          rerender("claude");
        },
        {
          desc: t(`claude.ev.${ev}` as MsgKey),
          fk: `ev:${ev}`,
          tag: tag ? h("span", { class: "tag tag-accent", text: tag }) : null,
        },
      ),
    );
  }
  // Someone else's status line stays theirs, so ticking ours changes nothing there.
  const foreign = !!hs?.foreignStatusLine;
  const counted = (e: string) => !(foreign && e === "StatusLine");
  const installedSorted = hs ? ALL_EVENTS.filter((e) => hs.events.includes(e) && counted(e)) : [];
  const differs =
    !!hs?.installed &&
    !same(
      installedSorted,
      ALL_EVENTS.filter((e) => chosen.has(e) && counted(e)),
    );
  return card(
    {
      title: t("claude.eventsTitle"),
      icon: "pulse",
      desc: t("claude.eventsDesc"),
      actions: [
        button(t("claude.selectAll"), {
          kind: "subtle",
          small: true,
          disabled: chosen.size === ALL_EVENTS.length,
          onClick: () => {
            update((x) => (x.hookEvents = [...ALL_EVENTS]));
            rerender("claude");
          },
        }),
      ],
    },
    !chosen.has("PermissionRequest")
      ? notice("warn", h("strong", { text: t("claude.noPermission") }), t("claude.noPermissionText"))
      : null,
    !chosen.has("PreToolUse")
      ? notice("warn", h("strong", { text: t("claude.noPreTool") }), t("claude.noPreToolText"))
      : null,
    grid,
    foreign && chosen.has("StatusLine") ? notice("info", t("claude.statusLineTaken")) : null,
    differs
      ? h(
          "div",
          { class: "update-prompt" },
          icon("warn", 16),
          h("span", { text: t("claude.differs") }),
          button(t("claude.btn.update"), {
            kind: "primary",
            small: true,
            disabled: relayMissing(),
            onClick: () => void openPreview(true),
          }),
        )
      : !hs?.installed
        ? h("p", { class: "fine", text: t("claude.onlySelected") })
        : null,
  );
}

function render(): HTMLElement {
  dropStale();
  const hs = cache.hookStatus;
  const installed = !!hs?.installed;
  const noRelay = relayMissing();
  const actions = h(
    "div",
    { class: "btn-row" },
    installed
      ? button(hs?.stale ? t("claude.btn.reinstall") : t("claude.btn.update"), {
          kind: "primary",
          icon: "reset",
          disabled: noRelay,
          onClick: () => void openPreview(true),
          fk: "hooks:update",
        })
      : hooksLost()
        ? null // the warning above carries the reinstall button
        : button(t("claude.btn.install"), {
            kind: "primary",
            icon: "download",
            disabled: noRelay,
            onClick: () => void openPreview(true),
            fk: "hooks:install",
          }),
    button(t("claude.btn.health"), {
      kind: "ghost",
      icon: "pulse",
      onClick: () => void runHealth(),
      disabled: healthRunning,
      fk: "hooks:health",
    }),
    button(t("claude.btn.show"), { kind: "ghost", icon: "folder", onClick: () => void api.openLocation("claude") }),
    h("span", { class: "spacer" }),
    installed
      ? button(t("claude.btn.remove"), {
          kind: "subtle",
          icon: "trash",
          onClick: () => void openPreview(false),
          fk: "hooks:remove",
        })
      : null,
  );
  const s = settings();
  return h(
    "div",
    { class: "tab-body" },
    card(
      { title: t("claude.connection"), icon: "claude", desc: t("claude.connectionDesc") },
      lostWarning(),
      statusBlock(),
      actions,
      message
        ? notice(message.kind === "ok" ? "ok" : "error", h("span", { class: "verbatim", text: message.text() }))
        : null,
      healthBlock(),
      h("p", { class: "fine" }, icon("lock", 13), h("span", { text: t("claude.never") })),
    ),
    card(
      { title: t("claude.interactive"), icon: "question" },
      row(
        t("claude.questions"),
        t("claude.questionsHint"),
        toggle(s.islandQuestions, (v) => {
          update((x) => (x.islandQuestions = v));
          rerender("claude");
        }, {
          label: t("claude.questions"),
          fk: "islandQuestions",
        }),
      ),
      s.islandQuestions && !s.hookEvents.includes("PreToolUse")
        ? notice("warn", t("claude.questionsNeedPreTool"))
        : null,
    ),
    eventsCard(),
  );
}

let devDone = false;

export const claudeTab: Tab = {
  id: "claude",
  title: () => t("claude.title"),
  subtitle: () => t("claude.subtitle"),
  icon: "claude",
  render,
  onShow: () => {
    void refresh();
    if (!devDone) {
      devDone = true;
      if (devParam("preview")) window.setTimeout(() => void openPreview(true), 200);
      if (devParam("health")) void runHealth();
    }
  },
  // The report's error line and Rust-worded messages are in the old language:
  // drop them (run the check again when wanted); our own messages re-translate.
  onLang: () => {
    health = null;
    if (message?.rust) message = null;
  },
};
