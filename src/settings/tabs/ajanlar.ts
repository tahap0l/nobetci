// Global Codex and Cursor hook connections. Each install is shown as a diff,
// backed up and written only after the user confirms it — the same reviewed
// dialog as Claude Code's (review.ts).

import type { AgentHookStatus, AgentProvider } from "../../core/bridge";
import { getPlatform, locale } from "../../i18n/core";
import { h } from "../../ui/dom";
import { api, errCode, errText, type HealthReport, type HookPreview } from "../api";
import { t, type MsgKey } from "../i18n";
import { icon } from "../icons";
import { rerender, type Tab, type TabId } from "../nav";
import { reviewDialog } from "../review";
import { button, card, notice, pill } from "../ui";

/** A message for the card. Our own wording re-translates; Rust's (`rust`) is dropped on a language switch. */
interface Message {
  ok: boolean;
  text: () => string;
  rust?: boolean;
}

interface ProviderState {
  provider: AgentProvider;
  tab: TabId;
  status: AgentHookStatus | null;
  loaded: boolean;
  testing: boolean;
  /** The last health check; drawn (and so translated) at render time. */
  health: HealthReport | null;
  /** The check itself failed to run. */
  healthFailed: boolean;
  busy: boolean;
  message: Message | null;
  /** Reads of the status in flight: only the newest one lands. */
  seq: number;
}

const fresh = (provider: AgentProvider, tab: TabId): ProviderState => ({
  provider,
  tab,
  status: null,
  loaded: false,
  testing: false,
  health: null,
  healthFailed: false,
  busy: false,
  message: null,
  seq: 0,
});

const desktop = fresh("codex", "chatgpt");
const cursor = fresh("cursor", "ajanlar");

function providerTitle(provider: AgentProvider): string {
  return t(provider === "codex" ? "agents.codex" : "agents.cursor");
}

/** What a message or a health report was about: the connection as it was read then. */
function statusKey(s: AgentHookStatus | null): string {
  return s ? JSON.stringify([s.installed, s.stale, s.hookReady, s.events]) : "";
}

/**
 * Reads the connection again. When it changed meanwhile (the hooks were removed
 * with `nobi --remove-hooks`, or edited by hand), the last message and
 * health report describe a connection that is gone: "Connected." next to a
 * "Not connected" pill. They are dropped.
 */
async function refresh(state: ProviderState) {
  const my = ++state.seq;
  const status = await api.agentHooksStatus(state.provider);
  if (my !== state.seq) return;
  if (state.loaded && statusKey(status) !== statusKey(state.status)) {
    state.message = null;
    state.health = null;
    state.healthFailed = false;
  }
  state.status = status;
  state.loaded = true;
}

function errorMessage(prefix: MsgKey | null, err: unknown): Message {
  const coded = !!errCode(err);
  const text = errText(err);
  return {
    ok: false,
    text: () => `${prefix ? t(prefix) : ""}${coded ? errText(err) : text}`,
    rust: !coded,
  };
}

async function openPreview(state: ProviderState, install: boolean) {
  if (state.busy) return;
  state.busy = true;
  state.message = null;
  rerender(state.tab);
  let preview: HookPreview;
  try {
    preview = await api.agentHooksPreview(state.provider, install);
  } catch (err) {
    // Clear busy before drawing, or the buttons would come back disabled for good.
    state.busy = false;
    state.message = errorMessage("agents.previewFailed", err);
    rerender(state.tab);
    return;
  }
  state.busy = false;
  rerender(state.tab);
  const update = install && !!state.status?.installed;
  reviewDialog({
    title: t(!install ? "agents.reviewRemove" : update ? "agents.reviewUpdate" : "agents.reviewInstall"),
    intro: install ? t("agents.installText") : t("agents.removeText"),
    preview,
    confirmLabel: t(!install ? "agents.confirmRemove" : update ? "agents.confirmUpdate" : "agents.confirmInstall"),
    danger: !install,
    apply: (fingerprint) => api.agentHooksApply(state.provider, install, fingerprint),
    onApplied: async (backup) => {
      // Read the new state first: the message below is about it.
      await refresh(state);
      state.health = null;
      state.healthFailed = false;
      const key: MsgKey = install
        ? backup
          ? "agents.written"
          : "agents.writtenNoBackup"
        : backup
          ? "agents.removed"
          : "agents.removedNoBackup";
      state.message = { ok: true, text: () => t(key, { backup: backup ?? "" }) };
      rerender(state.tab);
    },
    again: () => void openPreview(state, install),
  });
}

async function checkHealth(state: ProviderState) {
  state.testing = true;
  state.health = null;
  state.healthFailed = false;
  rerender(state.tab);
  try {
    state.health = await api.hooksHealth(state.provider);
    state.healthFailed = !state.health;
  } finally {
    state.testing = false;
    rerender(state.tab);
  }
}

/** The health check as a ✓/✗ list, like Claude Code's. */
function healthView(state: ProviderState): HTMLElement | null {
  if (state.testing)
    return h("div", { class: "health running" }, h("span", { class: "spinner" }), h("span", { text: t("agents.testing") }));
  if (state.healthFailed) return notice("warn", t("agents.testFailed"));
  const r = state.health;
  if (!r) return null;
  const line = (st: "ok" | "bad" | "note", title: string) =>
    h(
      "li",
      { class: st },
      h("span", { class: "hc-ic" }, icon(st === "ok" ? "check" : st === "bad" ? "cross" : "hakkinda", 14)),
      h("span", { class: "hc-text" }, h("span", { class: "hc-title", text: title })),
    );
  const codex = state.provider === "codex";
  const activity = r.codexActivity;
  const pass =
    r.roundtripMs != null && r.installed && !r.stale && !r.eventsMissing.length && (!codex || !!activity);
  return h(
    "div",
    { class: `health ${pass ? "pass" : "fail"}` },
    h(
      "div",
      { class: "health-head" },
      icon(pass ? "check" : "warn", 16),
      h("strong", { text: pass ? t("claude.health.pass") : t("agents.health.attention") }),
    ),
    h(
      "ul",
      { class: "checklist" },
      line(
        r.roundtripMs != null ? "ok" : "bad",
        r.roundtripMs != null ? t("agents.testRelay", { ms: r.roundtripMs }) : r.error || t("agents.testFailed"),
      ),
      line(
        r.installed && !r.eventsMissing.length ? "ok" : "bad",
        !r.installed
          ? t("agents.statusMissing")
          : r.eventsMissing.length
            ? `${t("claude.health.missing", { list: r.eventsMissing.join(", ") })}.`
            : t("agents.health.entriesOk", { n: r.eventsInstalled.length }),
      ),
      r.stale ? line("bad", t("agents.testUpdate")) : null,
      codex
        ? activity
          ? line(
              "ok",
              t("agents.testCodexEvent", {
                event: activity.event,
                time: new Date(activity.at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }),
              }),
            )
          : line("note", t("agents.testCodexWaiting"))
        : null,
    ),
  );
}

function providerCard(state: ProviderState): HTMLElement {
  const status = state.status;
  const controls = h("div", { class: "btn-row" });
  if (status?.installed) {
    controls.append(
      button(t("agents.update"), {
        kind: "primary",
        icon: "reset",
        disabled: state.busy || !status.hookReady,
        fk: `agent:${state.provider}:update`,
        onClick: () => void openPreview(state, true),
      }),
    );
  } else {
    controls.append(
      button(t("agents.install"), {
        kind: "primary",
        icon: "download",
        disabled: state.busy || !status?.hookReady,
        fk: `agent:${state.provider}:install`,
        onClick: () => void openPreview(state, true),
      }),
    );
  }
  controls.append(
    button(t("claude.btn.health"), {
      kind: "ghost",
      icon: "pulse",
      disabled: state.testing || state.busy || !status?.hookReady,
      fk: `agent:${state.provider}:health`,
      onClick: () => void checkHealth(state),
    }),
  );
  if (status?.installed) {
    controls.append(
      h("span", { class: "spacer" }),
      button(t("agents.remove"), {
        kind: "subtle",
        icon: "trash",
        disabled: state.busy,
        fk: `agent:${state.provider}:remove`,
        onClick: () => void openPreview(state, false),
      }),
    );
  }

  const codex = state.provider === "codex";
  return card(
    { title: providerTitle(state.provider), icon: codex ? "agents" : "cursor", desc: t(codex ? "agents.codexDesc" : "agents.intro") },
    !state.loaded
      ? notice("info", t("agents.loading"))
      : !status
        ? notice("warn", t("agents.readFailed"))
        : h(
            "div",
            { class: "agent-hook-status" },
            h(
              "div",
              { class: "pill-row" },
              pill(
                status.installed ? "ok" : "warn",
                status.installed ? t("agents.statusInstalled") : t("agents.statusMissing"),
                status.installed ? "check" : "warn",
              ),
              pill(
                status.hookReady ? "ok" : "bad",
                status.hookReady ? t("agents.relayReady") : t("agents.relayMissing"),
                status.hookReady ? "check" : "cross",
              ),
              status.stale ? pill("bad", t("agents.pill.stale"), "warn") : null,
            ),
            h(
              "dl",
              { class: "kv" },
              h("dt", { text: t("agents.path") }),
              h("dd", {}, h("code", { class: "mono path", text: status.settingsPath })),
              h("dt", { text: t("agents.events") }),
              h("dd", { text: status.events.length ? status.events.join(", ") : t("agents.empty") }),
            ),
            // One "relay missing" is enough as a pill; this says what to do about it.
            !status.hookReady ? notice("error", t("err.relayMissing")) : null,
          ),
    codex
      ? notice(status?.stale ? "warn" : "info", t(status?.stale ? "agents.codexRepair" : "agents.codexTrust"))
      : notice("warn", t("agents.cursorApproval")),
    controls,
    state.message
      ? notice(state.message.ok ? "ok" : "error", h("span", { class: "verbatim", text: state.message.text() }))
      : null,
    healthView(state),
    codex ? h("p", { class: "fine" }, icon("hakkinda", 13), h("span", { text: t("agents.hooksEmpty") })) : null,
  );
}

/** The ChatGPT Web bridge: a browser extension plus a native host only Windows can register today. */
function chatGptWebCard(): HTMLElement {
  const windows = getPlatform() === "windows";
  return card(
    { title: t("agents.web.title"), icon: "globe", desc: t("agents.web.desc") },
    windows ? null : notice("info", t("agents.web.windowsOnly")),
    h(
      "div",
      { class: "btn-row" },
      button(t("agents.web.guide"), {
        kind: "ghost",
        icon: "external",
        title: t("agents.web.guideTitle"),
        fk: "chatgpt-web:guide",
        onClick: () => void api.openLocation("chatgpt-web"),
      }),
    ),
  );
}

function clearRustText(state: ProviderState) {
  // The checklist is drawn from the report in the current language; only Rust's
  // own words (a report's error line, an error message) stay in the old one.
  if (state.health?.error) state.health = null;
  if (state.message?.rust) state.message = null;
}

export const chatgptTab: Tab = {
  id: "chatgpt",
  title: () => "ChatGPT",
  subtitle: () => t("agents.chatgptSubtitle"),
  icon: "agents",
  render: () => h("div", { class: "tab-body" }, providerCard(desktop), chatGptWebCard()),
  onShow: () => {
    void refresh(desktop).then(() => rerender("chatgpt"));
  },
  onLang: () => clearRustText(desktop),
};

export const ajanlarTab: Tab = {
  id: "ajanlar",
  title: () => t("agents.title"),
  subtitle: () => t("agents.subtitle"),
  icon: "cursor",
  render: () => h("div", { class: "tab-body" }, providerCard(cursor)),
  onShow: () => {
    void refresh(cursor).then(() => rerender("ajanlar"));
  },
  onLang: () => clearRustText(cursor),
};
