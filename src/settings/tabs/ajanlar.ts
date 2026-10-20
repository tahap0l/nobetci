// Global Codex and Cursor hook connections. Each install is shown as a diff,
// backed up and written only after the user confirms it.

import type { AgentHookStatus, AgentProvider } from "../../core/bridge";
import { h } from "../../ui/dom";
import { api, errText } from "../api";
import { t } from "../i18n";
import { icon } from "../icons";
import type { Tab } from "../nav";
import { button, card, modal, notice, pill } from "../ui";

interface ProviderState {
  provider: AgentProvider;
  status: AgentHookStatus | null;
  loaded: boolean;
  busy: boolean;
  message: { ok: boolean; text: string } | null;
}

const states: ProviderState[] = [
  { provider: "codex", status: null, loaded: false, busy: false, message: null },
  { provider: "cursor", status: null, loaded: false, busy: false, message: null },
];

function providerTitle(provider: AgentProvider): string {
  return t(provider === "codex" ? "agents.codex" : "agents.cursor");
}

async function refresh(state: ProviderState) {
  state.status = await api.agentHooksStatus(state.provider);
  state.loaded = true;
}

function diffView(diff: string): HTMLElement {
  const pre = h("pre", { class: "diff", tabindex: "0", "aria-label": t("claude.diffAria") });
  for (const line of diff.replace(/\n$/, "").split("\n")) {
    const cls = line.startsWith("+++") || line.startsWith("---")
      ? "meta"
      : line.startsWith("@@")
        ? "hunk"
        : line.startsWith("+")
          ? "add"
          : line.startsWith("-")
            ? "del"
            : "ctx";
    pre.append(h("span", { class: `dl dl-${cls}`, text: line || " " }));
  }
  return pre;
}

async function openPreview(state: ProviderState, install: boolean) {
  if (state.busy) return;
  state.busy = true;
  state.message = null;
  try {
    const preview = await api.agentHooksPreview(state.provider, install);
    const error = h("div", { class: "modal-msg" });
    const confirm = button(install ? t("agents.confirmInstall") : t("agents.confirmRemove"), {
      kind: install ? "primary" : "danger",
      icon: "check",
      onClick: async () => {
        confirm.disabled = true;
        error.replaceChildren();
        try {
          const backup = await api.agentHooksApply(state.provider, install, preview.fingerprint);
          dialog.close();
          state.message = { ok: true, text: t(install ? "agents.written" : "agents.removed", { backup }) };
          await refresh(state);
          renderTab();
        } catch (err) {
          error.replaceChildren(notice("error", errText(err)));
          confirm.disabled = false;
        }
      },
    });
    const dialog = modal({
      title: install ? t("agents.reviewInstall") : t("agents.reviewRemove"),
      subtitle: preview.settingsPath,
      wide: true,
      cls: "modal-diff",
      body: [
        h("p", { class: "modal-text" }, install ? t("agents.installText") : t("agents.removeText")),
        diffView(preview.diff),
        h("div", { class: "backup-line" }, icon("copy", 15), h("span", { text: t("agents.backup") }), h("code", { class: "mono", text: preview.backup })),
        error,
      ],
      foot: [button(t("common.cancel"), { kind: "subtle", onClick: () => dialog.close() }), confirm],
    });
  } catch (err) {
    state.message = { ok: false, text: `${t("agents.previewFailed")}${errText(err)}` };
    renderTab();
  } finally {
    state.busy = false;
  }
}

function providerCard(state: ProviderState): HTMLElement {
  const status = state.status;
  const controls = h("div", { class: "btn-row" });
  if (status?.installed) {
    controls.append(
      button(t("agents.update"), { kind: "primary", icon: "reset", disabled: state.busy, onClick: () => void openPreview(state, true) }),
      button(t("agents.remove"), { kind: "subtle", icon: "trash", disabled: state.busy, onClick: () => void openPreview(state, false) }),
    );
  } else {
    controls.append(button(t("agents.install"), { kind: "primary", icon: "download", disabled: state.busy || !status?.hookReady, onClick: () => void openPreview(state, true) }));
  }

  return card(
    { title: providerTitle(state.provider), icon: state.provider === "codex" ? "claude" : "cursor" },
    !state.loaded
      ? notice("info", t("agents.loading"))
      : !status
        ? notice("warn", t("agents.readFailed"))
        : h(
            "div",
            { class: "agent-hook-status" },
            h("div", { class: "pill-row" },
              pill(status.installed ? "ok" : "warn", status.installed ? t("agents.statusInstalled") : t("agents.statusMissing"), status.installed ? "check" : "warn"),
              pill(status.hookReady ? "ok" : "bad", status.hookReady ? t("agents.relayReady") : t("agents.relayMissing"), status.hookReady ? "check" : "cross"),
              status.stale ? pill("bad", t("claude.pill.stale"), "warn") : null,
            ),
            h("dl", { class: "kv" },
              h("dt", { text: t("agents.path") }),
              h("dd", {}, h("code", { class: "mono path", text: status.settingsPath })),
              h("dt", { text: t("agents.events") }),
              h("dd", { text: status.events.length ? status.events.join(", ") : t("agents.empty") }),
            ),
            !status.hookReady ? notice("error", t("agents.relayMissing")) : null,
          ),
    state.provider === "codex" ? notice("info", t("agents.codexTrust")) : notice("warn", t("agents.cursorApproval")),
    state.message ? notice(state.message.ok ? "ok" : "error", state.message.text) : null,
    controls,
  );
}

let root: HTMLElement | null = null;

function renderTab(): HTMLElement {
  const next = h(
    "div",
    { class: "tab-body" },
    notice("info", t("agents.intro")),
    notice("warn", t("agents.promptLimit")),
    providerCard(states[0]),
    providerCard(states[1]),
  );
  if (root?.isConnected) root.replaceWith(next);
  root = next;
  return next;
}

export const ajanlarTab: Tab = {
  id: "ajanlar",
  title: () => t("agents.title"),
  subtitle: () => t("agents.subtitle"),
  icon: "agents",
  render: renderTab,
  onShow: () => {
    void Promise.all(states.map(refresh)).then(() => renderTab());
  },
};
