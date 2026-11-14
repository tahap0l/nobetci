// The island's assistant view: write a prompt once and send it where you want.
//
//   * An AI app (ChatGPT, Claude, Gemini…): Rust opens it in the browser with the
//     prompt in its address where the app reads one; the prompt also goes on the
//     clipboard, so an app that ignores the address only needs a paste.
//   * "Ask here": the Prompt Studio provider answers right in the island.
//   * A slash command runs something on the spot: /pause, /dnd, /focus 25,
//     /play, /next, /settings…
//
// The answer is model output, so like everything else in the island it is only
// ever put on the page as text. Prompts and answers live in this module's memory
// and nowhere else.

import type { OwlEmote, OwlMood } from "../baykus/owl";
import { Bridge } from "../core/bridge";
import { State } from "../core/state";
import { getLang, getPlatform } from "../i18n/core";
import { t } from "../i18n/island";
import { HEADER_H } from "../island/layout";
import { h, icon } from "./dom";
import type { ViewHost } from "./views";
import { startFocusTimer } from "./widgets";

export interface AssistantActions {
  back(): void;
  togglePause(): void;
  toggleDnd(): void;
  openSettings(tab?: string): void;
  /** Hold a mood on the mascot while something is under way; null lets go. */
  mood(m: OwlMood | null): void;
  react(e: OwlEmote): void;
}

/** Every place a prompt can go. Rust has the matching table of addresses. */
export const ASSISTANT_TARGETS = [
  { id: "here", label: "" },
  { id: "chatgpt", label: "ChatGPT" },
  { id: "claude", label: "Claude" },
  { id: "gemini", label: "Gemini" },
  { id: "perplexity", label: "Perplexity" },
  { id: "copilot", label: "Copilot" },
  { id: "grok", label: "Grok" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "mistral", label: "Le Chat" },
] as const;

export type AssistantTarget = (typeof ASSISTANT_TARGETS)[number]["id"];

interface Command {
  /** The Turkish name first, then the English one, then other spellings. */
  names: string[];
  hint: () => string;
  run(arg: string, a: AssistantActions): Promise<string> | string;
}

async function media(action: "toggle" | "next" | "previous"): Promise<string> {
  const now = await Bridge.islandMedia();
  if (!now) return t("as.noMedia");
  const ok = await Bridge.islandMediaControl(now.source, action);
  return ok ? t("as.mediaDone", { title: now.title }) : t("as.mediaFailed");
}

const COMMANDS: Command[] = [
  {
    names: ["duraklat", "pause", "devam", "resume"],
    hint: () => t("as.cmd.pause"),
    run: (_arg, a) => {
      a.togglePause();
      return State.paused ? t("as.paused") : t("as.resumed");
    },
  },
  {
    names: ["sessiz", "dnd", "rahatsizetme", "rahatsız-etme"],
    hint: () => t("as.cmd.dnd"),
    run: (_arg, a) => {
      a.toggleDnd();
      return t("as.dndToggled");
    },
  },
  {
    names: ["odak", "focus"],
    hint: () => t("as.cmd.focus"),
    run: (arg) => {
      const minutes = Number.parseInt(arg, 10);
      const m = Number.isFinite(minutes) && minutes > 0 ? minutes : 25;
      startFocusTimer(m);
      return t("as.focusStarted", { n: Math.min(240, m) });
    },
  },
  { names: ["müzik", "play", "muzik", "oynat"], hint: () => t("as.cmd.play"), run: () => media("toggle") },
  { names: ["sonraki", "next"], hint: () => t("as.cmd.next"), run: () => media("next") },
  { names: ["önceki", "prev", "onceki", "previous"], hint: () => t("as.cmd.prev"), run: () => media("previous") },
  {
    names: ["ayarlar", "settings"],
    hint: () => t("as.cmd.settings"),
    run: (_arg, a) => {
      a.openSettings();
      return t("as.settingsOpened");
    },
  },
];

/** The command's name in the island's language. */
function shown(c: Command): string {
  return c.names[getLang() === "tr" ? 0 : 1];
}

function findCommand(text: string): { cmd: Command; arg: string } | null {
  const m = /^\/(\S+)\s*(.*)$/s.exec(text.trim());
  if (!m) return null;
  const name = m[1].toLocaleLowerCase("tr");
  const cmd = COMMANDS.find((c) => c.names.includes(name));
  return cmd ? { cmd, arg: m[2] } : null;
}

/** Commands whose name starts with what is typed after the slash. */
function suggestions(text: string): Command[] {
  const m = /^\/(\S*)$/.exec(text.trim());
  if (!m) return [];
  const typed = m[1].toLocaleLowerCase("tr");
  return COMMANDS.filter((c) => c.names.some((n) => n.startsWith(typed)));
}

function targetLabel(id: string): string {
  if (id === "here") return t("as.here");
  return ASSISTANT_TARGETS.find((x) => x.id === id)?.label ?? id;
}

/** Remembered for this run only, so a closed island keeps the draft. */
let draft = "";
const history: string[] = [];

export function buildAssistant(actions: AssistantActions): ViewHost & {
  focus(): void;
  setTarget(id: string): void;
} {
  const input = h("textarea", {
    class: "asst-input",
    rows: 2,
    maxlength: 30_000,
    spellcheck: "true",
    "aria-label": t("as.placeholder"),
    placeholder: t("as.placeholder"),
  });
  const chips = h("div", { class: "asst-targets", role: "radiogroup", "aria-label": t("as.targets") });
  const sendLabel = h("span");
  const send = h("button", { class: "btn btn-primary asst-send", type: "button" }, icon(SEND_ICON, 14), sendLabel);
  const status = h("div", { class: "asst-status", "aria-live": "polite" });
  const hints = h("div", { class: "asst-hints" });
  const answerText = h("div", { class: "asst-answer-text", tabindex: "0" });
  const copy = h("button", { class: "btn btn-small btn-ghost", type: "button" }, icon(COPY_ICON, 13), ` ${t("as.copy")}`);
  const answer = h("div", { class: "asst-answer", hidden: true }, answerText, h("div", { class: "asst-answer-actions" }, copy));
  const el = h(
    "div",
    { class: "view view-assistant" },
    h(
      "div",
      { class: "asst-head" },
      h("button", { class: "icon-btn", title: t("as.back"), onclick: () => actions.back() }, icon(BACK_ICON)),
      h("span", { class: "asst-title" }, icon(SPARK_ICON, 14), ` ${t("as.title")}`),
      h("span", { class: "grow" }),
      h("span", { class: "asst-keys", text: t("as.keys") }),
    ),
    input,
    hints,
    h("div", { class: "asst-row" }, chips, send),
    status,
    answer,
  );

  let target: string = State.settings.assistantTarget || "chatgpt";
  let busy = false;
  let historyAt = -1;

  const paintChips = () => {
    chips.replaceChildren(
      ...ASSISTANT_TARGETS.map((x) => {
        const on = x.id === target;
        return h(
          "button",
          {
            type: "button",
            class: `asst-chip${on ? " on" : ""}${x.id === "here" ? " here" : ""}`,
            role: "radio",
            "aria-checked": on ? "true" : "false",
            onclick: () => {
              target = x.id;
              void Bridge.setAssistantTarget(x.id);
              paintChips();
              paintSend();
              input.focus();
            },
          },
          targetLabel(x.id),
        );
      }),
    );
  };

  const paintSend = () => {
    const cmd = findCommand(input.value);
    sendLabel.textContent = ` ${cmd ? t("as.run") : target === "here" ? t("as.ask") : t("as.sendTo", { app: targetLabel(target) })}`;
    send.disabled = busy || !input.value.trim();
  };

  const paintHints = () => {
    const list = suggestions(input.value);
    hints.replaceChildren(
      ...list.map((c) =>
        h(
          "button",
          {
            type: "button",
            class: "asst-hint",
            onclick: () => {
              input.value = `/${shown(c)} `;
              paintHints();
              paintSend();
              input.focus();
            },
          },
          h("code", { text: `/${shown(c)}` }),
          ` ${c.hint()}`,
        ),
      ),
    );
    hints.hidden = list.length === 0;
    State.notify();
  };

  // Every change in size goes through State.notify, which lets the island
  // measure the view again and grow or shrink around it.
  const say = (text: string, kind: "ok" | "error" | "" = "") => {
    status.textContent = text;
    status.dataset.kind = kind;
    State.notify();
  };

  const submit = async () => {
    const text = input.value.trim();
    if (!text || busy) return;
    if (history[history.length - 1] !== text) history.push(text);
    if (history.length > 20) history.shift();
    historyAt = -1;

    const command = findCommand(text);
    if (command) {
      try {
        say(await command.cmd.run(command.arg, actions), "ok");
        actions.react("happy");
      } catch {
        say(t("as.failed"), "error");
      }
      input.value = draft = "";
      paintSend();
      paintHints();
      return;
    }
    if (text.startsWith("/")) {
      say(t("as.unknownCommand"), "error");
      return;
    }

    busy = true;
    paintSend();
    if (target === "here") {
      answer.hidden = true;
      say(t("as.thinking"));
      actions.mood("thinking");
      try {
        const reply = await Bridge.assistantAsk(text);
        answerText.textContent = reply;
        answer.hidden = false;
        State.notify();
        answerText.scrollTop = 0;
        say("");
        actions.react("happy");
        input.value = draft = "";
      } catch (err) {
        say(String(err), "error");
        actions.react("surprised");
      } finally {
        actions.mood(null);
      }
    } else {
      // On the clipboard first: an app that ignores the address only needs a paste.
      let copied = false;
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        copied = false;
      }
      try {
        const opened = await Bridge.assistantOpen(target, text);
        const app = targetLabel(target);
        const paste = getPlatform() === "macos" ? "⌘V" : "Ctrl+V";
        say(
          opened?.prefilled
            ? t("as.sent", { app })
            : copied
              ? t("as.pasteIt", { app, keys: paste })
              : t("as.openedOnly", { app }),
          "ok",
        );
        actions.react("approve");
        input.value = draft = "";
      } catch (err) {
        say(String(err), "error");
      }
    }
    busy = false;
    paintSend();
    paintHints();
  };

  input.addEventListener("input", () => {
    draft = input.value;
    paintSend();
    paintHints();
    // Grows with the text, up to six lines.
    input.style.height = "auto";
    input.style.height = `${Math.min(6 * 20 + 14, input.scrollHeight)}px`;
    State.notify();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      actions.back();
    } else if (e.key === "Tab" && suggestions(input.value).length === 1) {
      e.preventDefault();
      input.value = `/${shown(suggestions(input.value)[0])} `;
      paintHints();
      paintSend();
    } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !input.value.includes("\n") && history.length) {
      // Earlier prompts, like a shell.
      e.preventDefault();
      if (e.key === "ArrowUp") historyAt = historyAt < 0 ? history.length - 1 : Math.max(0, historyAt - 1);
      else historyAt = historyAt < 0 ? -1 : historyAt + 1;
      input.value = historyAt >= 0 && historyAt < history.length ? history[historyAt] : "";
      if (historyAt >= history.length) historyAt = -1;
      paintSend();
    }
  });
  send.addEventListener("click", () => void submit());
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(answerText.textContent ?? "").then(
      () => say(t("as.copied"), "ok"),
      () => say(t("as.failed"), "error"),
    );
  });

  paintChips();
  paintSend();
  paintHints();

  return {
    el,
    height: () => {
      const answerH = answer.hidden ? 0 : Math.min(180, answerText.scrollHeight + 44);
      const hintsH = hints.hidden ? 0 : hints.childElementCount * 24 + 6;
      const inputH = input.offsetHeight || 54;
      return HEADER_H + 40 + inputH + hintsH + 46 + (status.textContent ? 22 : 0) + answerH + 12;
    },
    sync() {
      if (input.value !== draft) input.value = draft;
      if ((State.settings.assistantTarget || "chatgpt") !== target && !busy) {
        target = State.settings.assistantTarget || "chatgpt";
        paintChips();
        paintSend();
      }
    },
    focus() {
      requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      });
    },
    setTarget(id: string) {
      target = id;
      paintChips();
      paintSend();
    },
  };
}

const SEND_ICON = "M5 12h13M13 6l6 6-6 6";
const COPY_ICON = "M9 9h10v10H9zM5 15V5h10";
const BACK_ICON = "M15 18l-6-6 6-6";
export const SPARK_ICON = "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 3v4M17 5h4";
