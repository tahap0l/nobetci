// A provider-backed message editor that can be used before sending a prompt to
// any agent. It never sends a message to the selected agent itself.

import { api, errText } from "../api";
import { settings, update } from "../store";
import { t } from "../i18n";
import { h } from "../../ui/dom";
import { rerender, type Tab } from "../nav";
import { button, card, field, notice, select, textInput } from "../ui";

type Agent = "general" | "claude" | "codex" | "cursor" | "chatgpt" | "gemini" | "other";
type Provider = "ollama" | "openai";

let draftText = "";
let revisedText = "";
let selectedAgent: Agent = "general";
let keyStored = false;
let keyStatusKnown = false;
let busy = false;
let feedback: { kind: "error" | "ok"; text: string } | null = null;
let resultPanel: HTMLElement | null = null;
let feedbackPanel: HTMLElement | null = null;

function clearResult() {
  revisedText = "";
  feedback = null;
  if (resultPanel) resultPanel.hidden = true;
  feedbackPanel?.replaceChildren();
}

async function refreshKeyStatus() {
  try {
    const result = await api.openAiKeyStatus();
    keyStored = result;
    keyStatusKnown = true;
    if (settings().promptProvider === "openai") rerender("prompts");
  } catch (err) {
    keyStatusKnown = true;
    keyStored = false;
    feedback = { kind: "error", text: errText(err) };
    if (settings().promptProvider === "openai") rerender("prompts");
  }
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

function render(): HTMLElement {
  const current = settings();
  const provider = current.promptProvider as Provider;
  const model = textInput({
    value: provider === "ollama" ? current.ollamaModel : current.openaiModel,
    placeholder: provider === "ollama" ? "gemma4" : "gpt-6-luna",
    mono: true,
    label: t("prompts.model"),
    fk: "prompt-model",
    onInput: (value) => {
      clearResult();
      update((s) => {
        if (provider === "ollama") s.ollamaModel = value;
        else s.openaiModel = value;
      });
    },
  });

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
  model.disabled = busy;

  let reviewButton: HTMLButtonElement | null = null;
  const source = textarea(
    draftText,
    t("prompts.draft"),
    t("prompts.placeholder"),
    "prompt-draft",
    (value) => {
      draftText = value;
      clearResult();
      if (reviewButton) reviewButton.disabled = !draftText.trim() || busy;
    },
  );
  source.maxLength = 30_000;
  source.disabled = busy;

  const output = textarea(
    revisedText,
    t("prompts.result"),
    t("prompts.emptyResult"),
    "prompt-revised",
    (value) => (revisedText = value),
  );
  const status = h("div", { class: "prompt-feedback", "aria-live": "polite" });
  feedbackPanel = status;
  if (feedback) status.append(notice(feedback.kind, feedback.text));
  const outputCard = card(
    {
      title: t("prompts.result"),
      icon: "check",
      actions: [
        button(t("prompts.copy"), {
          icon: "copy",
          small: true,
          disabled: !revisedText.trim(),
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(revisedText);
              feedback = { kind: "ok", text: t("prompts.copied") };
              rerender("prompts");
            } catch {
              feedback = { kind: "error", text: t("prompts.copyFailed") };
              rerender("prompts");
            }
          },
        }),
      ],
      cls: "prompt-result-card",
    },
    output,
  );
  resultPanel = outputCard;
  outputCard.hidden = !revisedText;

  reviewButton = button(t(busy ? "prompts.busy" : "prompts.review"), {
    kind: "primary",
    icon: busy ? undefined : "sparkle",
    disabled: busy || !draftText.trim(),
    fk: "prompt-review",
    onClick: async () => {
      if (!draftText.trim()) {
        feedback = { kind: "error", text: t("prompts.errEmpty") };
        rerender("prompts");
        return;
      }
      const modelName = model.value.trim();
      busy = true;
      clearResult();
      rerender("prompts");
      try {
        revisedText = await api.rewritePrompt(draftText, selectedAgent, provider, modelName);
        feedback = null;
      } catch (err) {
        const detail = errText(err);
        const isKeyError = /API key|anahtar|credential store|parola kasası/i.test(detail);
        feedback = {
          kind: "error",
          text: isKeyError
            ? t("prompts.keyRequired")
            : detail || t(provider === "ollama" ? "prompts.errLocal" : "prompts.errOpenai"),
        };
      } finally {
        busy = false;
        rerender("prompts");
      }
    },
  });

  const modelCard = card(
    { title: t("prompts.provider"), icon: provider === "ollama" ? "cursor" : "globe" },
    h(
      "div",
      { class: "prompt-top-grid" },
      field(t("prompts.agent"), agent),
      field(t("prompts.provider"), providerControl),
    ),
    field(t("prompts.model"), model, t(provider === "ollama" ? "prompts.localHint" : "prompts.openaiHint")),
    provider === "openai" ? keyControls() : null,
  );

  return h(
    "div",
    { class: "prompt-studio" },
    modelCard,
    card(
      { title: t("prompts.draft"), desc: t("prompts.draftHint"), icon: "edit" },
      field(t("prompts.draft"), source),
      h("div", { class: "prompt-actions" }, reviewButton),
      status,
    ),
    outputCard,
    card(
      { title: t("prompts.privacyTitle"), icon: "lock", cls: "prompt-privacy-card" },
      notice("info", t("prompts.manual")),
      provider === "openai" ? notice("warn", t("prompts.openaiHint")) : notice("ok", t("prompts.localHint")),
    ),
  );
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
  const save = button(t("prompts.keySave"), {
    kind: "primary",
    icon: "key",
    onClick: async () => {
      if (!keyInput.value.trim()) {
        keyInput.focus();
        return;
      }
      save.disabled = true;
      feedback = null;
      try {
        await api.saveOpenAiKey(keyInput.value);
        keyInput.value = "";
        keyStored = true;
        keyStatusKnown = true;
        feedback = { kind: "ok", text: t("prompts.keySaved") };
      } catch (err) {
        feedback = { kind: "error", text: errText(err) };
      } finally {
        save.disabled = false;
        rerender("prompts");
      }
    },
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
        onClick: async () => {
          try {
            await api.deleteOpenAiKey();
            keyStored = false;
            feedback = { kind: "ok", text: t("prompts.keyDeleted") };
          } catch (err) {
            feedback = { kind: "error", text: errText(err) };
          }
          rerender("prompts");
        },
      })
    : null;
  return h("div", { class: "prompt-key-block" }, info, field(t("prompts.key"), controls), actions);
}

export const promptsTab: Tab = {
  id: "prompts",
  title: () => t("prompts.title"),
  subtitle: () => t("prompts.subtitle"),
  icon: "prompts",
  render,
  onShow: () => void refreshKeyStatus(),
};
