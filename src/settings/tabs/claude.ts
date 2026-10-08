// Claude Code: hook status, an end-to-end health check, which events to listen
// to, and install / update / removal — always through a reviewed diff. The
// preview flow and the health view are shared with the first-run wizard.

import type { HealthReport, HookPreview } from "../../core/bridge";
import { ALL_EVENTS } from "../../core/settings-model";
import { h } from "../../ui/dom";
import { api, errText } from "../api";
import { cache, loadHookStatus } from "../data";
import { t, type MsgKey } from "../i18n";
import { icon } from "../icons";
import { app, devParam, refreshBadges, rerender, type Tab } from "../nav";
import { flush, same, settings, update } from "../store";
import { button, card, checkbox, modal, notice, pill } from "../ui";

let health: HealthReport | null = null;
let healthRunning = false;
/** Text is a function so the message follows a language switch. */
let message: { kind: "ok" | "error"; text: () => string } | null = null;
let busy = false;

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

function diffView(diff: string): { el: HTMLElement; added: number; removed: number } {
  const pre = h("pre", { class: "diff", tabindex: "0", "aria-label": t("claude.diffAria") });
  let added = 0;
  let removed = 0;
  for (const line of diff.replace(/\n$/, "").split("\n")) {
    let cls = "ctx";
    if (line.startsWith("+++") || line.startsWith("---")) cls = "meta";
    else if (line.startsWith("@@")) cls = "hunk";
    else if (line.startsWith("+")) {
      cls = "add";
      added++;
    } else if (line.startsWith("-")) {
      cls = "del";
      removed++;
    }
    pre.append(h("span", { class: `dl dl-${cls}`, text: line || " " }));
  }
  return { el: pre, added, removed };
}

/**
 * Preview → diff → "Onayla ve yaz". Nothing is written without that click, and
 * Rust refuses the write if settings.json changed after the preview.
 */
export async function openPreview(install: boolean, onApplied?: () => void) {
  if (busy) return;
  busy = true;
  message = null;
  let p: HookPreview;
  try {
    await flush();
    p = await api.hooksPreview(install);
  } catch (err) {
    busy = false;
    const text = errText(err);
    message = { kind: "error", text: () => text };
    rerender("claude");
    return;
  }
  busy = false;
  const { el: diff, added, removed } = diffView(p.diff);
  const nothing = added === 0 && removed === 0;
  const errBox = h("div", { class: "modal-msg" });
  const confirm = button(install ? t("claude.approveWrite") : t("claude.approveRemove"), {
    kind: install ? "primary" : "danger",
    icon: "check",
    disabled: nothing,
    onClick: async () => {
      confirm.disabled = true;
      errBox.replaceChildren();
      try {
        const backup = await api.hooksApply(install, p.fingerprint);
        m.close();
        message = { kind: "ok", text: () => t(install ? "claude.written" : "claude.removed", { backup }) };
        if (install) app.hooksLost = false;
        await refresh();
        onApplied?.();
      } catch (err) {
        errBox.replaceChildren(notice("error", h("strong", { text: t("claude.writeFailed") }), errText(err)));
        confirm.disabled = false;
      }
    },
  });
  const m = modal({
    title: install ? t("claude.reviewInstall") : t("claude.reviewRemove"),
    subtitle: p.settingsPath,
    wide: true,
    cls: "modal-diff",
    body: [
      h("p", { class: "modal-text" }, install ? t("claude.reviewInstallText") : t("claude.reviewRemoveText")),
      h(
        "div",
        { class: "diff-stats" },
        h("span", { class: "ds-add", text: `+${added}` }),
        h("span", { class: "ds-del", text: `−${removed}` }),
        h("span", { class: "muted", text: t("claude.lines") }),
      ),
      nothing ? notice("info", t("claude.noChange")) : diff,
      h(
        "div",
        { class: "backup-line" },
        icon("copy", 15),
        h("span", { text: t("claude.backupFirst") }),
        h("code", { class: "mono", text: p.backup }),
      ),
      notice("info", t("claude.fileChangedNote")),
      errBox,
    ],
    foot: [button(t("common.cancel"), { kind: "subtle", onClick: () => m.close() }), confirm],
  });
}

/** Hooks were installed once but someone rewrote settings.json without them. */
export function hooksLost(): boolean {
  return app.hooksLost && cache.hookStatusLoaded && !cache.hookStatus?.installed;
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
  );
}

export function healthRunningView(): HTMLElement {
  return h(
    "div",
    { class: "health running" },
    h("span", { class: "spinner" }),
    h("span", { text: t("claude.health.running") }),
  );
}

/** The ✓/✗ checklist for a health report; `error` is Rust's own text, shown as is. */
export function healthView(r: HealthReport): HTMLElement {
  const line = (ok: boolean, title: string, detail?: string | Node) =>
    h(
      "li",
      { class: ok ? "ok" : "bad" },
      h("span", { class: "hc-ic" }, icon(ok ? "check" : "cross", 14)),
      h(
        "span",
        { class: "hc-text" },
        h("span", { class: "hc-title", text: title }),
        detail ? h("span", { class: "hc-detail" }, detail) : null,
      ),
    );
  const pass =
    r.relayExists &&
    r.installed &&
    !r.eventsMissing.length &&
    !r.stale &&
    r.roundtripMs != null &&
    r.inputGuard &&
    !r.error;
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
        r.relayExists,
        r.relayExists ? t("claude.health.relayOk") : t("claude.health.relayMissing"),
        h("code", { class: "mono", text: r.relayPath }),
      ),
      line(
        r.installed,
        r.installed ? t("claude.health.entriesOk", { n: r.eventsInstalled.length }) : t("claude.health.entriesMissing"),
        h("code", { class: "mono", text: r.settingsPath }),
      ),
      line(
        !r.eventsMissing.length,
        r.eventsMissing.length
          ? t("claude.health.missing", { list: r.eventsMissing.join(", ") })
          : t("claude.health.allEvents"),
      ),
      line(!r.stale, r.stale ? t("claude.pill.stale") : t("claude.health.noStale")),
      line(
        r.roundtripMs != null,
        r.roundtripMs != null ? t("claude.health.ping", { ms: r.roundtripMs }) : t("claude.health.noPing"),
      ),
      line(
        r.inputGuard,
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
    const required = ev === "PermissionRequest";
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
          tag: required ? h("span", { class: "tag tag-accent", text: t("claude.required") }) : null,
        },
      ),
    );
  }
  const installedSorted = hs ? ALL_EVENTS.filter((e) => hs.events.includes(e)) : [];
  const differs =
    !!hs?.installed &&
    !same(
      installedSorted,
      ALL_EVENTS.filter((e) => chosen.has(e)),
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
    grid,
    differs
      ? h(
          "div",
          { class: "update-prompt" },
          icon("warn", 16),
          h("span", { text: t("claude.differs") }),
          button(t("claude.btn.update"), { kind: "primary", small: true, onClick: () => void openPreview(true) }),
        )
      : !hs?.installed
        ? h("p", { class: "fine", text: t("claude.onlySelected") })
        : null,
  );
}

function render(): HTMLElement {
  const hs = cache.hookStatus;
  const installed = !!hs?.installed;
  const actions = h(
    "div",
    { class: "btn-row" },
    installed
      ? button(hs?.stale ? t("claude.btn.reinstall") : t("claude.btn.update"), {
          kind: "primary",
          icon: "reset",
          onClick: () => void openPreview(true),
          fk: "hooks:update",
        })
      : hooksLost()
        ? null // the warning above carries the reinstall button
        : button(t("claude.btn.install"), {
            kind: "primary",
            icon: "download",
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
  // The report's error line is Rust's text in the old language: run it again when wanted.
  onLang: () => {
    health = null;
  },
};
