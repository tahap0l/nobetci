// The reviewed-diff dialog shared by Claude Code, ChatGPT/Codex and Cursor:
// what will be written, how many lines change, the dated backup, and one
// Approve button. Nothing is written without that click. Rust keeps the exact
// content it previewed under the fingerprint and writes only that, refusing if
// the file changed in between (`stale_preview`). While the dialog is up the page
// behind it is inert, so the selection it was made from cannot change under it;
// a change from elsewhere still invalidates it (`watch`).

import { h } from "../ui/dom";
import { errCode, errText, type HookPreview } from "./api";
import { t } from "./i18n";
import { icon } from "./icons";
import { button, modal, notice, type ModalHandle } from "./ui";

export function diffView(diff: string): { el: HTMLElement; added: number; removed: number } {
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

/** A refused write because the file changed after the preview (also the wording older builds used). */
export function isStale(err: unknown): boolean {
  return (
    errCode(err)?.code === "stale_preview" ||
    /changed since the preview|önizlemeden sonra değişti/i.test(errText(err))
  );
}

export interface ReviewOptions {
  title: string;
  intro: string;
  preview: HookPreview;
  confirmLabel: string;
  danger?: boolean;
  /** Writes the previewed content; resolves to the backup path (null: there was no file). */
  apply: (fingerprint: string) => Promise<string | null>;
  /** After a successful write (the dialog is already closed). */
  onApplied: (backup: string | null) => void | Promise<void>;
  /** Opens a fresh preview (after a stale write, or when the selection changed). */
  again: () => void;
  /** Calls `invalidate` when what was previewed is no longer what would be written; returns a stop. */
  watch?: (invalidate: () => void) => () => void;
}

export function reviewDialog(o: ReviewOptions): ModalHandle {
  const { el: diff, added, removed } = diffView(o.preview.diff);
  const nothing = added === 0 && removed === 0;
  const status = h("div", { class: "modal-msg", "aria-live": "polite" });
  let stale = false;

  const fresh = () => {
    m.close();
    o.again();
  };
  const staleNotice = (text: string) =>
    notice(
      "warn",
      h("span", { text }),
      h(
        "div",
        { class: "notice-actions" },
        button(t("review.again"), { kind: "ghost", small: true, icon: "reset", onClick: fresh, fk: "review:again" }),
      ),
    );

  const confirm = button(o.confirmLabel, {
    kind: o.danger ? "danger" : "primary",
    icon: "check",
    disabled: nothing,
    fk: "review:confirm",
  });
  confirm.addEventListener("click", async () => {
    if (stale) return;
    confirm.disabled = true;
    status.replaceChildren();
    try {
      const backup = await o.apply(o.preview.fingerprint);
      m.close();
      await o.onApplied(backup);
    } catch (err) {
      if (isStale(err)) {
        stale = true;
        status.replaceChildren(staleNotice(t("review.staleWrite")));
      } else {
        status.replaceChildren(notice("error", h("strong", { text: t("claude.writeFailed") }), errText(err)));
        confirm.disabled = false;
      }
      status.scrollIntoView({ block: "nearest" });
    }
  });

  // Said as Rust will do it: a dated backup of the file as it is, or none
  // because there is no file yet. With nothing to change nothing is written,
  // so there is no backup either (Rust sends null then too) and no line.
  const backupLine = nothing
    ? null
    : o.preview.backup
      ? h(
          "div",
          { class: "backup-line" },
          icon("copy", 15),
          h("span", { text: t("claude.backupFirst") }),
          h("code", { class: "mono", text: o.preview.backup }),
        )
      : h("div", { class: "backup-line" }, icon("file", 15), h("span", { text: t("review.noBackup") }));

  const m = modal({
    title: o.title,
    subtitle: o.preview.settingsPath,
    wide: true,
    cls: "modal-diff",
    body: [
      h("p", { class: "modal-text" }, o.intro),
      h(
        "div",
        { class: "diff-stats" },
        h("span", { class: "ds-add", text: `+${added}` }),
        h("span", { class: "ds-del", text: `−${removed}` }),
        h("span", { class: "muted", text: t("claude.lines") }),
      ),
      nothing ? notice("info", t("claude.noChange")) : diff,
      backupLine,
      nothing ? null : notice("info", t("claude.fileChangedNote")),
    ],
    status,
    foot: [button(t("common.cancel"), { kind: "subtle", onClick: () => m.close() }), confirm],
    onClose: () => stop?.(),
  });
  const stop = o.watch?.(() => {
    if (stale) return;
    stale = true;
    confirm.disabled = true;
    status.replaceChildren(staleNotice(t("review.selectionChanged")));
  });
  return m;
}
