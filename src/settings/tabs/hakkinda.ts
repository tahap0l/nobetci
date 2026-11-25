// Hakkında: version, privacy, files, the setup wizard, settings backup / restore /
// reset, licence.

import { h } from "../../ui/dom";
import { api, errCode, errText } from "../api";
import { t, type MsgKey } from "../i18n";
import { icon, owlMark, type IconName } from "../icons";
import { app, refreshBadges, rerender, type Tab } from "../nav";
import { flush, replaceAll } from "../store";
import { button, card, inlineConfirm, notice } from "../ui";
import { openWizard } from "../wizard";

/**
 * Ours are re-translated on render, and so are Rust's coded errors (a file that
 * isn't Nobi's settings, say); Rust's own wording is shown as it came. With
 * both a key and an error, the key's sentence carries the error's text as {why}.
 */
let message: { kind: "ok" | "error" | "info" | "warn"; key?: MsgKey; path?: string; err?: unknown } | null = null;

/**
 * A reset or an import whose save failed is still in effect: Rust applies the
 * settings (and tells every window) before it writes them. Only a save error
 * means that; anything else (not a Nobi file, unreadable JSON) changed nothing.
 */
function appliedButUnsaved(err: unknown): boolean {
  const code = errCode(err)?.code;
  return code === "save_failed" || code === "settings_unreadable";
}

function promise(ic: IconName, title: string, text: string): HTMLElement {
  return h(
    "div",
    { class: "promise" },
    h("span", { class: "promise-ic" }, icon(ic, 18)),
    h("div", {}, h("strong", { text: title }), h("span", { text })),
  );
}

function messageView(): HTMLElement | null {
  if (!message) return null;
  const why = message.err === undefined ? "" : errText(message.err);
  const text = message.key ? t(message.key, { path: message.path ?? "", why }) : why;
  return notice(message.kind, h("span", { class: "verbatim", text }));
}

function render(): HTMLElement {
  return h(
    "div",
    { class: "tab-body" },
    h(
      "section",
      { class: "hero" },
      owlMark(64),
      h(
        "div",
        { class: "hero-text" },
        h(
          "h2",
          { class: "hero-title" },
          "Nobi",
          app.version ? h("span", { class: "version", text: `v${app.version}` }) : null,
        ),
        h("p", { text: t("about.tagline") }),
      ),
    ),
    card(
      { title: t("about.privacy"), icon: "lock" },
      h(
        "div",
        { class: "promise-grid" },
        promise("wifiOff", t("about.noNet"), t("about.noNetText")),
        promise("eye", t("about.noTelemetry"), t("about.noTelemetryText")),
        promise("key", t("about.noSecrets"), t("about.noSecretsText")),
      ),
    ),
    card(
      { title: t("about.setup"), icon: "sparkle", desc: t("about.setupDesc") },
      h(
        "div",
        { class: "btn-row" },
        button(t("about.reopenWizard"), {
          kind: "ghost",
          icon: "sparkle",
          fk: "wizard:open",
          onClick: () => openWizard(),
        }),
      ),
    ),
    card(
      { title: t("about.files"), icon: "folder", desc: t("about.filesDesc") },
      h(
        "div",
        { class: "btn-row" },
        button(t("about.log"), { kind: "ghost", icon: "file", onClick: () => void api.openLocation("log") }),
        button(t("about.data"), { kind: "ghost", icon: "folder", onClick: () => void api.openLocation("data") }),
        button(t("about.settingsFile"), {
          kind: "ghost",
          icon: "genel",
          onClick: () => void api.openLocation("settings"),
        }),
      ),
    ),
    card(
      { title: t("about.backup"), icon: "copy", desc: t("about.backupDesc") },
      h(
        "div",
        { class: "btn-row" },
        button(t("about.export"), {
          kind: "ghost",
          icon: "download",
          onClick: async () => {
            try {
              await flush();
              const path = await api.settingsExport();
              message = path
                ? { kind: "ok", key: "common.savedPath", path }
                : { kind: "info", key: "about.exportCancelled" };
            } catch (err) {
              message = { kind: "error", err };
            }
            rerender("hakkinda");
          },
        }),
        button(t("about.import"), {
          kind: "ghost",
          icon: "upload",
          onClick: async () => {
            try {
              await flush();
              const s = await api.settingsImport();
              if (s) {
                replaceAll(s);
                refreshBadges();
                message = { kind: "ok", key: "about.imported" };
              } else message = { kind: "info", key: "about.importCancelled" };
            } catch (err) {
              // In effect but not saved: the settings-changed Rust sent first has
              // already put them on screen.
              message = appliedButUnsaved(err)
                ? { kind: "warn", key: "about.importUnsaved", err }
                : { kind: "error", err };
            }
            rerender("hakkinda");
          },
        }),
        h("span", { class: "spacer" }),
        inlineConfirm({
          label: t("about.reset"),
          icon: "reset",
          question: t("about.resetQ"),
          confirmLabel: t("about.resetYes"),
          onConfirm: async () => {
            await flush();
            try {
              replaceAll(await api.settingsReset());
              refreshBadges();
              message = { kind: "ok", key: "about.resetDone" };
            } catch (err) {
              // A failed save still leaves the defaults in effect (Rust applies
              // first); anything else reset nothing.
              message = appliedButUnsaved(err)
                ? { kind: "warn", key: "about.resetUnsaved", err }
                : { kind: "error", key: "about.resetFailed", err };
            }
            rerender("hakkinda");
          },
        }),
      ),
      messageView(),
    ),
    card(
      { title: t("about.license"), icon: "file" },
      h("p", { class: "prose" }, t("about.lic1a"), h("strong", { text: "Coucou" }), t("about.lic1b")),
      h("p", { class: "prose", text: t("about.lic2") }),
      h("p", { class: "fine", text: t("about.heuristic") }),
    ),
  );
}

export const hakkindaTab: Tab = {
  id: "hakkinda",
  title: () => t("about.title"),
  subtitle: () => t("about.subtitle"),
  icon: "hakkinda",
  render,
};
