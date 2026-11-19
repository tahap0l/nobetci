// Pieces of the island for Claude's own interactive tools and for what a session
// did: the question form (AskUserQuestion), the plan (ExitPlanMode), the list of
// changed files with their diffs, and context and plan-limit meters.
//
// Every string here comes from Claude, a file or a tool: text nodes only, never
// innerHTML. The plan's Markdown is read line by line into plain elements.

import type { FileChange, LimitWindow, SessionUsage } from "../core/state";
import { t } from "../i18n/island";
import { lastPathComponent } from "../island/hooks";
import { h } from "./dom";

// ── Questions ─────────────────────────────────────────────────────────────────

interface QuestionOption {
  label: string;
  description: string;
}

interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multi: boolean;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The questions in an AskUserQuestion input; anything malformed is skipped. */
export function questionsOf(input: Record<string, unknown>): Question[] {
  const list = Array.isArray(input.questions) ? input.questions : [];
  return list
    .map((q): Question | null => {
      if (!q || typeof q !== "object") return null;
      const r = q as Record<string, unknown>;
      const question = str(r.question).trim();
      if (!question) return null;
      const options = (Array.isArray(r.options) ? r.options : [])
        .map((o) => {
          const x = (o ?? {}) as Record<string, unknown>;
          return { label: str(x.label).trim(), description: str(x.description).trim() };
        })
        .filter((o) => o.label);
      return { question, header: str(r.header).trim(), options, multi: r.multiSelect === true };
    })
    .filter((q): q is Question => q !== null)
    .slice(0, 4);
}

export interface QuestionForm {
  el: HTMLElement;
  /** Question text → answer; null while any question is unanswered. */
  answers(): Record<string, string> | null;
}

/**
 * One block per question: the options as toggle buttons (one or several, as the
 * question allows) and a box for an answer of your own, which replaces the
 * choice when filled.
 */
export function questionForm(input: Record<string, unknown>, changed: () => void): QuestionForm {
  const questions = questionsOf(input);
  const picks = questions.map(() => new Set<string>());
  const others: HTMLInputElement[] = [];
  const el = h("div", { class: "q-form" });

  questions.forEach((q, i) => {
    const buttons: HTMLButtonElement[] = [];
    const other = h("input", {
      class: "q-other",
      type: "text",
      maxlength: 500,
      placeholder: t("q.other"),
      "data-typing": "",
    }) as HTMLInputElement;
    others.push(other);
    other.addEventListener("input", changed);

    const sync = () => buttons.forEach((b) => b.classList.toggle("on", picks[i].has(b.dataset.label ?? "")));
    for (const o of q.options) {
      const b = h(
        "button",
        { class: "q-opt", type: "button", "data-label": o.label, title: o.description },
        h("span", { class: "q-opt-label", text: o.label }),
        o.description ? h("span", { class: "q-opt-desc", text: o.description }) : null,
      ) as HTMLButtonElement;
      b.addEventListener("click", () => {
        if (q.multi) {
          if (picks[i].has(o.label)) picks[i].delete(o.label);
          else picks[i].add(o.label);
        } else {
          picks[i].clear();
          picks[i].add(o.label);
        }
        sync();
        changed();
      });
      buttons.push(b);
    }

    el.append(
      h(
        "div",
        { class: "q-block" },
        h(
          "div",
          { class: "q-head" },
          q.header ? h("span", { class: "q-tag", text: q.header }) : null,
          q.multi ? h("span", { class: "q-multi", text: t("q.multi") }) : null,
        ),
        h("div", { class: "q-text", text: q.question }),
        h("div", { class: "q-opts" }, ...buttons),
        other,
      ),
    );
  });

  return {
    el,
    answers() {
      if (!questions.length) return null;
      const out: Record<string, string> = {};
      for (let i = 0; i < questions.length; i++) {
        const own = others[i].value.trim();
        const chosen = questions[i].options.map((o) => o.label).filter((l) => picks[i].has(l));
        const answer = own || chosen.join(", ");
        if (!answer) return null;
        out[questions[i].question] = answer;
      }
      return out;
    },
  };
}

// ── Plan (Markdown, read safely) ──────────────────────────────────────────────

/** `code` and **bold** inside a line, as text nodes in spans. */
function inline(text: string): Node[] {
  const out: Node[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));
    const tok = m[0];
    out.push(
      tok.startsWith("`")
        ? h("code", { text: tok.slice(1, -1) })
        : h("strong", { text: tok.slice(2, -2) }),
    );
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

/** A plan's Markdown as headings, lists, quotes, code blocks and paragraphs. */
export function planView(markdown: string): HTMLElement {
  const root = h("div", { class: "plan" });
  let list: HTMLElement | null = null;
  let code: HTMLElement | null = null;
  for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (code) {
      if (raw.trim().startsWith("```")) code = null;
      else code.append(`${raw}\n`);
      continue;
    }
    const line = raw.trimEnd();
    if (line.trim().startsWith("```")) {
      list = null;
      code = h("pre", { class: "plan-code" });
      root.append(code);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (heading) {
      list = null;
      root.append(h(heading[1].length <= 2 ? "h4" : "h5", {}, ...inline(heading[2])));
    } else if (bullet) {
      if (!list) {
        list = h(/^\s*\d/.test(line) ? "ol" : "ul", {});
        root.append(list);
      }
      const task = /^\[( |x|X)\]\s+(.*)$/.exec(bullet[1]);
      list.append(
        task
          ? h("li", { class: task[1] === " " ? "task" : "task done" }, ...inline(task[2]))
          : h("li", {}, ...inline(bullet[1])),
      );
    } else if (/^\s*>\s?/.test(line)) {
      list = null;
      root.append(h("blockquote", {}, ...inline(line.replace(/^\s*>\s?/, ""))));
    } else if (!line.trim()) {
      list = null;
    } else {
      list = null;
      root.append(h("p", {}, ...inline(line.trim())));
    }
  }
  if (!root.childNodes.length) root.append(h("p", { class: "plan-empty", text: t("plan.empty") }));
  return root;
}

// ── Changed files ─────────────────────────────────────────────────────────────

/** A diff as coloured lines. */
export function diffView(c: FileChange): HTMLElement {
  const pre = h("pre", { class: "diff" });
  for (const line of c.diff.split("\n")) {
    const cls = line.startsWith("@@") ? "d-hunk" : line.startsWith("+") ? "d-add" : line.startsWith("-") ? "d-del" : "d-ctx";
    pre.append(h("span", { class: cls, text: line || " " }), "\n");
  }
  if (c.cut) pre.append(h("span", { class: "d-cut", text: t("ch.cut") }));
  return pre;
}

/** The session's changed files; a click on one opens or closes its diff. */
export function changeList(changes: FileChange[], open: Set<string>, toggle: (file: string) => void): HTMLElement {
  const list = h("div", { class: "changes" });
  for (const c of changes) {
    const row = h(
      "button",
      { class: `change-row${open.has(c.file) ? " open" : ""}`, type: "button", title: c.file },
      h("span", { class: "change-file", text: lastPathComponent(c.file) }),
      c.created ? h("span", { class: "change-new", text: t("ch.new") }) : null,
      h("span", { class: "grow" }),
      h("span", { class: "change-add", text: `+${c.added}` }),
      h("span", { class: "change-del", text: `−${c.removed}` }),
    );
    row.addEventListener("click", () => toggle(c.file));
    list.append(row);
    if (open.has(c.file)) list.append(diffView(c));
  }
  return list;
}

// ── Usage ─────────────────────────────────────────────────────────────────────

function hm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function meter(label: string, pct: number, note: string): HTMLElement {
  const p = Math.max(0, Math.min(100, pct));
  const tone = p >= 90 ? "hot" : p >= 70 ? "warm" : "ok";
  const fill = h("span", { class: `meter-fill ${tone}` });
  fill.style.width = `${p}%`;
  return h(
    "div",
    { class: "meter", title: note },
    h("span", { class: "meter-label", text: label }),
    h("span", { class: "meter-bar" }, fill),
    h("span", { class: "meter-pct", text: `${Math.round(p)}%` }),
  );
}

/** Context use for a session and the plan's 5-hour and weekly windows. */
export function usageView(usage: SessionUsage | null, limits: { fiveHour: LimitWindow | null; sevenDay: LimitWindow | null } | null): HTMLElement | null {
  const rows: HTMLElement[] = [];
  if (usage?.context != null) rows.push(meter(t("use.context"), usage.context, usage.model));
  const win = (w: LimitWindow | null, key: "use.fiveHour" | "use.sevenDay") => {
    if (!w) return;
    const note = w.resetsAt ? t("use.resets", { at: hm(w.resetsAt) }) : "";
    rows.push(meter(t(key), w.used, note));
  };
  win(limits?.fiveHour ?? null, "use.fiveHour");
  win(limits?.sevenDay ?? null, "use.sevenDay");
  if (!rows.length) return null;
  const cost = usage?.costUsd != null && usage.costUsd > 0 ? t("use.cost", { usd: usage.costUsd.toFixed(2) }) : "";
  return h("div", { class: "usage" }, ...rows, cost ? h("div", { class: "usage-cost", text: cost }) : null);
}

/** The short form for the compact island: the highest plan window, if any. */
export function limitSummary(limits: { fiveHour: LimitWindow | null; sevenDay: LimitWindow | null } | null): string {
  const five = limits?.fiveHour?.used;
  if (five == null) return "";
  return t("use.short", { pct: Math.round(five) });
}
