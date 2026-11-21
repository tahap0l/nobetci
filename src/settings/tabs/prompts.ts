// A provider-backed message editor that can be used before sending a prompt to
// any agent. It never sends a message to the selected agent itself.

import { h } from "../../ui/dom";
import { api, errCode, errText } from "../api";
import { t, type MsgKey } from "../i18n";
import { rerender, type Tab } from "../nav";
import { settings, update } from "../store";
import { button, card, field, notice, select, textInput } from "../ui";

type Agent = "general" | "claude" | "codex" | "cursor" | "chatgpt" | "gemini" | "other";
type Provider = "ollama" | "openai";

/**
 * A status line. Our own wording is a key (it follows a language switch); text
 * Rust wrote is kept as is and dropped when the language changes.
 */
interface Feedback {
  kind: "error" | "ok";
  text: () => string;
  rust?: boolean;
}

/** Rust's model rule (settings.rs clean_model): 1–120 characters, no control characters. */
const MODEL_MAX = 120;

let draftText = "";
let revisedText = "";
let selectedAgent: Agent = "general";
let keyStored = false;
let keyStatusKnown = false;
let busy = false;
/** Under "Improve message": the rewrite itself. */
let rewriteFeedback: Feedback | null = null;
/** Under the key field: saving or removing the OpenAI key. */
let keyFeedback: Feedback | null = null;
/** Next to "Copy text". */
let copyFeedback: Feedback | null = null;
/** Bring the new result into view once it is drawn. */
let revealResult = false;
let resultPanel: HTMLElement | null = null;
let rewritePanel: HTMLElement | null = null;
let copyPanel: HTMLElement | null = null;

function own(kind: Feedback["kind"], key: MsgKey): Feedback {
  return { kind, text: () => t(key) };
}

function fromError(err: unknown): Feedback {
  const coded = !!errCode(err);
  const text = errText(err);
  return { kind: "error", text: () => (coded ? errText(err) : text), rust: !coded };
}

function clearResult() {
  revisedText = "";
  rewriteFeedback = null;
  copyFeedback = null;
  if (resultPanel) resultPanel.hidden = true;
  rewritePanel?.replaceChildren();
  copyPanel?.replaceChildren();
}

async function refreshKeyStatus() {
  try {
    keyStored = await api.openAiKeyStatus();
    keyStatusKnown = true;
  } catch (err) {
    keyStatusKnown = true;
    keyStored = false;
    keyFeedback = fromError(err);
  }
  if (settings().promptProvider === "openai") rerender("prompts");
}

function textarea(value: string, label: string, placeholder: string, fk: string, onInput: (value: string) => void) {
  const el = h("textarea", {
    class: "input prompt-textarea",
    rows: 8,
    maxlength: 30_000,
    spellcheck: "true",
    placeholder,
    "aria-label": label,
    "data-fk": fk,
  });
  el.value = value;
  el.addEventListener("input", () => onInput(el.value));
  return el;
}

function feedbackView(f: Feedback | null): HTMLElement | null {
  return f ? notice(f.kind, h("span", { class: "verbatim", text: f.text() })) : null;
}

/** Why a model name would not be kept, or null when it is fine. */
function modelProblem(name: string): MsgKey | null {
  const v = name.trim();
  if (!v) return "prompts.modelEmpty";
  if (v.length > MODEL_MAX) return "prompts.modelLong";
  if (/[\u0000-\u001f\u007f]/.test(v)) return "prompts.modelBad";
  return null;
}

/** The model the rewrite will use: what is in the field if it can be kept, else the saved one. */
let modelNow: () => string = () => "";
/** What is typed in the model field but not saved yet; survives a redraw of the tab. */
let pendingModel: string | null = null;
/** Saves a pending model-name edit at once (before a rewrite, on leaving the field). */
let commitModel: () => void = () => {};

function modelField(provider: Provider): HTMLElement {
  const saved = () => (provider === "ollama" ? settings().ollamaModel : settings().openaiModel);
  const hint = h("span", { class: "field-hint", "aria-live": "polite" });
  const paintHint = (problem: MsgKey | null) => {
    hint.classList.toggle("bad", !!problem);
    hint.textContent = problem
      ? t(problem, { model: saved(), max: MODEL_MAX })
      : t(provider === "ollama" ? "prompts.localHint" : "prompts.openaiHint");
  };
  // Only a name that can be kept is saved — trimmed, once typing pauses — so
  // Rust never has to replace it and nothing comes back to overwrite the field
  // while it is being typed in.
  let timer: number | null = null;
  const commit = () => {
    if (timer != null) window.clearTimeout(timer);
    timer = null;
    const v = input.value.trim();
    if (modelProblem(v)) return;
    pendingModel = null;
    if (v === saved()) return;
    update((s) => {
      if (provider === "ollama") s.ollamaModel = v;
      else s.openaiModel = v;
    });
  };
  const input = textInput({
    value: pendingModel ?? saved(),
    placeholder: provider === "ollama" ? "gemma4" : "gpt-6-luna",
    mono: true,
    label: t("prompts.model"),
    fk: "prompt-model",
    onInput: (value) => {
      clearResult();
      pendingModel = value;
      paintHint(modelProblem(value));
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(commit, 500);
    },
    onChange: (value, el) => {
      commit();
      // Leaving the field with a name that can't be kept puts the saved one back.
      if (modelProblem(value)) {
        pendingModel = null;
        el.value = saved();
        paintHint(null);
      }
    },
  });
  input.disabled = busy;
  modelNow = () => (modelProblem(input.value) ? saved() : input.value.trim());
  commitModel = commit;
  paintHint(pendingModel != null ? modelProblem(pendingModel) : null);
  return h(
    "label",
    { class: "field" },
    h("span", { class: "field-label", text: t("prompts.model") }),
    input,
    hint,
  );
}

function render(): HTMLElement {
  const current = settings();
  const provider = current.promptProvider as Provider;

  const agent = select<Agent>(
    [
      ["general", t("prompts.agent.general")],
      ["claude", t("prompts.agent.claude")],
      ["codex", t("prompts.agent.codex")],
      ["cursor", t("prompts.agent.cursor")],
      ["chatgpt", t("prompts.agent.chatgpt")],
      ["gemini", t("prompts.agent.gemini")],
      ["other", t("prompts.agent.other")],
    ],
    selectedAgent,
    (value) => {
      selectedAgent = value;
      clearResult();
      rerender("prompts");
    },
    { label: t("prompts.agent"), fk: "prompt-agent" },
  );
  agent.disabled = busy;

  const providerControl = select<Provider>(
    [
      ["ollama", t("prompts.local")],
      ["openai", t("prompts.openai")],
    ],
    provider,
    (value) => {
      clearResult();
      update((s) => (s.promptProvider = value));
      rerender("prompts");
    },
    { label: t("prompts.provider"), fk: "prompt-provider" },
  );
  providerControl.disabled = busy;
  const model = modelField(provider);

  let reviewButton: HTMLButtonElement | null = null;
  const source = textarea(draftText, t("prompts.draft"), t("prompts.placeholder"), "prompt-draft", (value) => {
    draftText = value;
    clearResult();
    if (reviewButton) reviewButton.disabled = !draftText.trim() || busy;
  });
  source.maxLength = 30_000;
  source.disabled = busy;

  const output = textarea(revisedText, t("prompts.result"), t("prompts.emptyResult"), "prompt-revised", (value) => {
    revisedText = value;
  });
  output.readOnly = busy;
  rewritePanel = h("div", { class: "prompt-feedback", "aria-live": "polite" }, feedbackView(rewriteFeedback));
  copyPanel = h("span", { class: "copy-feedback", "aria-live": "polite" });
  if (copyFeedback) copyPanel.append(copyFeedback.text());
  const copyButton = button(t("prompts.copy"), {
    icon: "copy",
    small: true,
    disabled: busy || !revisedText.trim(),
    fk: "prompt-copy",
    onClick: async () => {
      try {
        await navigator.clipboard.writeText(revisedText);
        copyFeedback = own("ok", "prompts.copied");
      } catch {
        copyFeedback = own("error", "prompts.copyFailed");
      }
      copyPanel?.classList.toggle("bad", copyFeedback.kind === "error");
      copyPanel?.replaceChildren(copyFeedback.text());
    },
  });
  const outputCard = card(
    {
      title: t("prompts.result"),
      icon: "check",
      actions: [copyPanel, copyButton],
      cls: `prompt-result-card${busy ? " is-busy" : ""}`,
    },
    busy
      ? h(
          "div",
          { class: "prompt-skeleton", "aria-hidden": "true" },
          h("span"),
          h("span"),
          h("span"),
        )
      : output,
  );
  resultPanel = outputCard;
  outputCard.hidden = !revisedText && !busy;

  reviewButton = button(t(busy ? "prompts.busy" : "prompts.review"), {
    kind: "primary",
    icon: busy ? undefined : "sparkle",
    disabled: busy || !draftText.trim(),
    fk: "prompt-review",
    onClick: async () => {
      if (!draftText.trim()) {
        rewriteFeedback = own("error", "prompts.errEmpty");
        rerender("prompts");
        return;
      }
      commitModel();
      const modelName = modelNow();
      busy = true;
      clearResult();
      rerender("prompts");
      try {
        revisedText = await api.rewritePrompt(draftText, selectedAgent, provider, modelName);
        rewriteFeedback = null;
        revealResult = true;
      } catch (err) {
        const detail = errText(err);
        const isKeyError = /API key|anahtar|credential store|parola kasası/i.test(detail);
        rewriteFeedback = isKeyError
          ? own("error", "prompts.keyRequired")
          : detail
            ? fromError(err)
            : own("error", provider === "ollama" ? "prompts.errLocal" : "prompts.errOpenai");
      } finally {
        busy = false;
        rerender("prompts");
      }
    },
  });
  if (busy) {
    // Working, not disabled: a spinner in a button at full strength.
    reviewButton.classList.add("is-busy");
    reviewButton.setAttribute("aria-busy", "true");
    reviewButton.prepend(h("span", { class: "spinner sm" }));
  }

  const modelCard = card(
    { title: t("prompts.setupTitle"), icon: provider === "ollama" ? "chip" : "globe" },
    h(
      "div",
      { class: "prompt-top-grid" },
      field(t("prompts.agent"), agent),
      field(t("prompts.provider"), providerControl),
    ),
    model,
    provider === "openai" ? keyControls() : null,
  );

  const body = h(
    "div",
    { class: "prompt-studio" },
    modelCard,
    card(
      { title: t("prompts.draft"), desc: t("prompts.draftHint"), icon: "edit" },
      source,
      h("div", { class: "prompt-actions" }, reviewButton),
      rewritePanel,
    ),
    outputCard,
    card(
      { title: t("prompts.privacyTitle"), icon: "lock", cls: "prompt-privacy-card" },
      notice("info", t("prompts.manual")),
      notice("warn", t(provider === "openai" ? "prompts.openaiPrivacy" : "prompts.localPrivacy")),
    ),
  );
  if (revealResult && revisedText) {
    revealResult = false;
    window.setTimeout(() => resultPanel?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 0);
  }
  return body;
}

function keyControls(): HTMLElement {
  const keyInput = textInput({
    value: "",
    type: "password",
    placeholder: t("prompts.keyPlaceholder"),
    label: t("prompts.key"),
    fk: "openai-key",
  });
  keyInput.autocomplete = "new-password";
  const status = h("div", { class: "key-feedback", "aria-live": "polite" }, feedbackView(keyFeedback));
  const save = button(t("prompts.keySave"), {
    kind: "primary",
    icon: "key",
    fk: "openai-key-save",
    onClick: async () => {
      if (!keyInput.value.trim()) {
        keyInput.focus();
        return;
      }
      save.disabled = true;
      keyFeedback = null;
      status.replaceChildren();
      try {
        await api.saveOpenAiKey(keyInput.value);
        keyStored = true;
        keyStatusKnown = true;
        keyFeedback = own("ok", "prompts.keySaved");
        // Saved: the field is emptied and the block redrawn with the new state.
        rerender("prompts");
      } catch (err) {
        // The typed key stays so it can be corrected; the reason shows right here.
        keyFeedback = fromError(err);
        status.replaceChildren(feedbackView(keyFeedback) ?? "");
        save.disabled = false;
        keyInput.focus();
      }
    },
  });
  keyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save.click();
    }
  });
  const controls = h("div", { class: "prompt-key-controls" }, keyInput, save);
  const info = keyStatusKnown
    ? notice(keyStored ? "ok" : "info", t(keyStored ? "prompts.keyStored" : "prompts.keyMissing"))
    : notice("info", t("common.loading"));
  const actions = keyStored
    ? button(t("prompts.keyDelete"), {
        kind: "subtle",
        icon: "trash",
        small: true,
        fk: "openai-key-delete",
        onClick: async () => {
          try {
            await api.deleteOpenAiKey();
            keyStored = false;
            keyFeedback = own("ok", "prompts.keyDeleted");
          } catch (err) {
            keyFeedback = fromError(err);
          }
          rerender("prompts");
        },
      })
    : null;
  return h(
    "div",
    { class: "prompt-key-block" },
    info,
    field(t("prompts.key"), controls),
    status,
    actions ? h("div", {}, actions) : null,
  );
}

export const promptsTab: Tab = {
  id: "prompts",
  title: () => t("prompts.title"),
  subtitle: () => t("prompts.subtitle"),
  icon: "prompts",
  render,
  onShow: () => void refreshKeyStatus(),
  // Our messages follow the language; whatever Rust or a provider wrote does not, so it goes.
  onLang: () => {
    if (rewriteFeedback?.rust) rewriteFeedback = null;
    if (keyFeedback?.rust) keyFeedback = null;
  },
};
