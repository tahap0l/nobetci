// Pieces of the island for Claude's own interactive tools and for what a session
// did: the question form (AskUserQuestion), the plan (ExitPlanMode), the list of
// changed files with their diffs, and context and plan-limit meters.
//
// Every string here comes from Claude, a file or a tool: text nodes only, never
// innerHTML. The plan's Markdown is read line by line into plain elements.

import type { FileChange, LimitWindow, SessionUsage } from "../core/state";
import { getLang } from "../i18n/core";
import { t } from "../i18n/island";
import { lastPathComponent } from "../island/hooks";
import { h } from "./dom";

// ── Questions ─────────────────────────────────────────────────────────────────

interface QuestionOption {
  label: string;
  description: string;
}

interface Question {
  /**
   * The question exactly as Claude sent it, spaces and all: the answer is filed
   * under it, and Rust looks it up the same way.
   */
  key: string;
  /** What the card shows. */
  text: string;
  header: string;
  options: QuestionOption[];
  multi: boolean;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * The questions in an AskUserQuestion input. Every entry whose `question` is a
 * string is one: Rust wants an answer for each of them (pipe.rs), so none may be
 * left off the card, however odd it looks.
 */
export function questionsOf(input: Record<string, unknown>): Question[] {
  const list = Array.isArray(input.questions) ? input.questions : [];
  const out: Question[] = [];
  for (const q of list) {
    if (!q || typeof q !== "object" || Array.isArray(q)) continue;
    const r = q as Record<string, unknown>;
    if (typeof r.question !== "string") continue;
    const options = (Array.isArray(r.options) ? r.options : [])
      .map((o) => {
        const x = (o ?? {}) as Record<string, unknown>;
        return { label: str(x.label).trim(), description: str(x.description).trim() };
      })
      .filter((o) => o.label);
    out.push({ key: r.question, text: r.question.trim(), header: str(r.header).trim(), options, multi: r.multiSelect === true });
  }
  return out;
}

export interface QuestionForm {
  el: HTMLElement;
  /** Question (as sent) → answer; null while any question is unanswered. */
  answers(): Record<string, string> | null;
  /** How far along the form is, and the first question still without an answer. */
  progress(): { answered: number; total: number; open: HTMLElement | null };
}

export interface QuestionFormHooks {
  /** An answer changed. */
  changed(): void;
  /** Enter in the last open answer box: keys cannot send, so the card says how. */
  enter(): void;
}

/**
 * One block per question: the options as toggle buttons (one or several, as the
 * question allows) and a box for an answer of your own. Which answer goes out is
 * always the one on screen: for a single choice, typing clears the highlighted
 * option and picking one clears the typed text; for several, the typed answer is
 * added to the picks, as Claude Code's own "Other" does, and the form says so.
 */
export function questionForm(input: Record<string, unknown>, hooks: QuestionFormHooks): QuestionForm {
  const questions = questionsOf(input);
  const picks = questions.map(() => new Set<string>());
  const others: HTMLInputElement[] = [];
  const blocks: HTMLElement[] = [];
  const syncs: (() => void)[] = [];
  const el = h("div", { class: "q-form" });

  const answerOf = (i: number): string => {
    const own = others[i].value.trim();
    const chosen = questions[i].options.map((o) => o.label).filter((l) => picks[i].has(l));
    if (questions[i].multi) return [...chosen, own].filter(Boolean).join(", ");
    return own || chosen[0] || "";
  };

  questions.forEach((q, i) => {
    const buttons: HTMLButtonElement[] = [];
    const other = h("input", {
      class: "q-other",
      type: "text",
      maxlength: 500,
      placeholder: t(q.multi ? "q.otherMulti" : "q.other"),
      "aria-label": t(q.multi ? "q.otherMulti" : "q.other"),
      "data-typing": "",
    }) as HTMLInputElement;
    const added = h("div", { class: "q-note", text: t("q.ownAdded") });
    const block = h("div", { class: "q-block" });
    others.push(other);
    blocks.push(block);

    const sync = () => {
      for (const b of buttons) {
        const on = picks[i].has(b.dataset.label ?? "");
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", String(on));
      }
      added.hidden = !(q.multi && picks[i].size > 0 && other.value.trim());
      block.classList.toggle("answered", !!answerOf(i));
    };
    syncs.push(sync);

    other.addEventListener("input", () => {
      // One answer at a time for a single choice: the typed one wins and the
      // highlight goes, so the card never shows two.
      if (!q.multi && other.value.trim()) picks[i].clear();
      sync();
      hooks.changed();
    });
    other.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      // Keys never send (Rust wants a real click); Enter moves to the next open question.
      const next = questions.findIndex((_, j) => j > i && !answerOf(j));
      if (next >= 0) others[next].focus();
      else hooks.enter();
    });

    for (const o of q.options) {
      const b = h(
        "button",
        { class: "q-opt", type: "button", "data-label": o.label, title: o.description, "aria-pressed": "false" },
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
          other.value = "";
        }
        sync();
        hooks.changed();
      });
      buttons.push(b);
    }

    block.append(
      h(
        "div",
        { class: "q-head" },
        q.header ? h("span", { class: "q-tag", text: q.header }) : null,
        q.multi ? h("span", { class: "q-multi", text: t("q.multi") }) : null,
      ),
      h("div", { class: `q-text${q.text ? "" : " q-empty"}`, text: q.text || t("q.emptyText") }),
    );
    if (buttons.length) block.append(h("div", { class: "q-opts", role: "group" }, ...buttons));
    block.append(other, added);
    el.append(block);
    sync();
  });

  return {
    el,
    answers() {
      if (!questions.length) return null;
      const out: Record<string, string> = {};
      for (let i = 0; i < questions.length; i++) {
        const answer = answerOf(i);
        if (!answer) return null;
        out[questions[i].key] = answer;
      }
      return out;
    },
    progress() {
      const open = questions.findIndex((_, i) => !answerOf(i));
      const answered = questions.filter((_, i) => answerOf(i)).length;
      return { answered, total: questions.length, open: open >= 0 ? blocks[open] : null };
    },
  };
}

// ── Plan (Markdown, read safely) ──────────────────────────────────────────────

const WORD = /[\p{L}\p{N}]/u;

/** `**bold**`, `__bold__`, `*italic*`, `_italic_` or `~~struck~~` starting at `i`. */
function emphasis(text: string, i: number): { node: Node; end: number } | null {
  for (const [mark, tag] of [["**", "strong"], ["__", "strong"], ["~~", "del"], ["*", "em"], ["_", "em"]] as const) {
    if (!text.startsWith(mark, i)) continue;
    const first = text[i + mark.length];
    // The mark has to hug the text it opens, and `snake_case` stays text.
    if (!first || /\s/.test(first) || (mark.length === 1 && first === mark)) continue;
    if (mark[0] === "_" && i > 0 && WORD.test(text[i - 1])) continue;
    let j = i + mark.length + 1;
    for (;;) {
      j = text.indexOf(mark, j);
      if (j < 0) break;
      const single = mark.length === 1 && (text[j - 1] === mark || text[j + 1] === mark);
      if (!/\s/.test(text[j - 1]) && !single && !(mark[0] === "_" && WORD.test(text[j + mark.length] ?? ""))) break;
      j += 1;
    }
    if (j < 0) continue;
    return { node: h(tag, {}, ...inline(text.slice(i + mark.length, j))), end: j + mark.length };
  }
  return null;
}

/** A link is shown as its text and where it points; nothing on the card opens it. */
function linkText(label: string, url: string): Node[] {
  const nodes: Node[] = [];
  if (label && label !== url) nodes.push(h("span", { class: "plan-link" }, ...inline(label)), document.createTextNode(" "));
  if (url) nodes.push(h("span", { class: "plan-url", text: label && label !== url ? `(${url})` : url }));
  return nodes.length ? nodes : [document.createTextNode(label)];
}

/**
 * Inline Markdown — code, bold, italics, strike-through, links and autolinks —
 * as text nodes in plain elements. Anything it does not know stays text.
 */
function inline(text: string): Node[] {
  const out: Node[] = [];
  let plain = "";
  const flush = () => {
    if (plain) out.push(document.createTextNode(plain));
    plain = "";
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\" && /[\\`*_{}[\]()#+\-.!>~|<]/.test(text[i + 1] ?? "")) {
      plain += text[i + 1];
      i += 2;
      continue;
    }
    if (c === "`") {
      const run = /^`+/.exec(text.slice(i))![0];
      const end = text.indexOf(run, i + run.length);
      if (end > i) {
        flush();
        const code = text.slice(i + run.length, end);
        out.push(h("code", { text: /^ .* $/.test(code) ? code.slice(1, -1) : code }));
        i = end + run.length;
      } else {
        plain += run;
        i += run.length;
      }
      continue;
    }
    if (c === "[" || (c === "!" && text[i + 1] === "[")) {
      const m = /^!?\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/.exec(text.slice(i));
      if (m) {
        flush();
        out.push(...linkText(m[1], m[2]));
        i += m[0].length;
        continue;
      }
    }
    if (c === "<") {
      const m = /^<((?:https?|mailto|ftp):[^\s<>]+)>/i.exec(text.slice(i));
      if (m) {
        flush();
        out.push(h("span", { class: "plan-url", text: m[1] }));
        i += m[0].length;
        continue;
      }
    }
    const em = c === "*" || c === "_" || c === "~" ? emphasis(text, i) : null;
    if (em) {
      flush();
      out.push(em.node);
      i = em.end;
      continue;
    }
    plain += c;
    i++;
  }
  flush();
  return out;
}

/** Columns a line is indented by (a tab counts as four). */
function indentOf(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === " ") n++;
    else if (ch === "\t") n += 4 - (n % 4);
    else break;
  }
  return n;
}

const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const TABLE_RULE = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/** A table row's cells; `\|` is a pipe inside a cell. */
function cellsOf(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const out: string[] = [];
  let cell = "";
  for (let k = 0; k < s.length; k++) {
    if (s[k] === "\\" && s[k + 1] === "|") {
      cell += "|";
      k++;
    } else if (s[k] === "|") {
      out.push(cell.trim());
      cell = "";
    } else {
      cell += s[k];
    }
  }
  out.push(cell.trim());
  return out;
}

interface ListFrame {
  indent: number;
  ordered: boolean;
  el: HTMLElement;
  item: HTMLElement | null;
}

/**
 * A plan's Markdown as headings, lists (nested, numbered from where the plan
 * starts them), quotes, tables, rules, code blocks and paragraphs. Read line by
 * line into plain elements: nothing is ever parsed as HTML.
 */
export function planView(markdown: string): HTMLElement {
  const root = h("div", { class: "plan" });
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let lists: ListFrame[] = [];
  let quote: HTMLElement | null = null;
  // The paragraph the line before made: a "---" or "===" under it makes it a heading.
  let para: HTMLElement | null = null;
  let blank = false;

  const top = () => lists[lists.length - 1];
  /** Closes the lists a line indented by `indent` is no longer inside. */
  const leave = (indent: number) => {
    while (lists.length && indent < top().indent + 2) lists.pop();
  };
  const heading = (level: number, content: Node[]) =>
    h(level <= 1 ? "h3" : level === 2 ? "h4" : level === 3 ? "h5" : "h6", {}, ...content);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const indent = indentOf(raw);
    const line = raw.trim();

    const fence = /^(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const close = new RegExp(`^[ \\t]*${fence[1][0] === "`" ? "`" : "~"}{${fence[1].length},}[ \\t]*$`);
      const body: string[] = [];
      let j = i + 1;
      for (; j < lines.length && !close.test(lines[j]); j++) body.push(lines[j]);
      const pre = h("pre", { class: "plan-code", text: body.join("\n") });
      // Indented under a list item, the code belongs to that item.
      leave(indent);
      (lists.length && top().item ? top().item! : root).append(pre);
      i = j;
      para = quote = null;
      blank = false;
      continue;
    }

    if (!line) {
      blank = true;
      para = quote = null;
      continue;
    }

    const setext = para && !blank && /^(=+|-+)$/.test(line) ? line[0] : "";
    if (setext && para) {
      para.replaceWith(heading(setext === "=" ? 1 : 2, [...para.childNodes]));
      para = null;
      continue;
    }

    const atx = /^(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (atx && indent < 4) {
      lists = [];
      root.append(heading(atx[1].length, inline(atx[2] ?? "")));
      para = quote = null;
      blank = false;
      continue;
    }

    // "---", "***", "- - -": a rule (it wins over a list item, as in CommonMark).
    if (/^([-*_])(?:[ \t]*\1){2,}$/.test(line) && indent < 4) {
      lists = [];
      root.append(h("hr"));
      para = quote = null;
      blank = false;
      continue;
    }

    // A table: a row of cells, then a rule row such as "| --- | :-: |".
    const rule = lines[i + 1] ?? "";
    if (line.includes("|") && TABLE_RULE.test(rule) && rule.includes("-") && rule.includes("|")) {
      const head = cellsOf(line);
      const align = cellsOf(rule).map((c) =>
        c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "",
      );
      const row = (cells: string[], tag: "th" | "td") =>
        h(
          "tr",
          {},
          ...head.map((_, k) => {
            const cell = h(tag, {}, ...inline(cells[k] ?? ""));
            if (align[k]) cell.style.textAlign = align[k];
            return cell;
          }),
        );
      const tbody = h("tbody");
      let j = i + 2;
      for (; j < lines.length && lines[j].trim() && lines[j].includes("|"); j++) tbody.append(row(cellsOf(lines[j]), "td"));
      lists = [];
      root.append(h("div", { class: "plan-table" }, h("table", {}, h("thead", {}, row(head, "th")), tbody)));
      i = j - 1;
      para = quote = null;
      blank = false;
      continue;
    }

    const q = /^>[ \t]?(.*)$/.exec(line);
    if (q && indent < 4) {
      lists = [];
      if (quote) quote.append(h("br"), ...inline(q[1]));
      else {
        quote = h("blockquote", {}, ...inline(q[1]));
        root.append(quote);
      }
      para = null;
      blank = false;
      continue;
    }
    quote = null;

    const item = LIST_ITEM.exec(raw);
    if (item) {
      const ordered = /\d/.test(item[2]);
      // Lists this item sits to the left of are over (a column either way is the same level).
      while (lists.length && indent < top().indent - 1) lists.pop();
      let frame: ListFrame | undefined = lists.length ? top() : undefined;
      if (frame && indent >= frame.indent + 2 && frame.item) {
        // Indented under the item before: a list of its own inside that item.
        const el = h(ordered ? "ol" : "ul");
        frame.item.append(el);
        frame = { indent, ordered, el, item: null };
        lists.push(frame);
      } else if (!frame || frame.ordered !== ordered) {
        // The first item, or a numbered list right after bullets (or the other way
        // round): a new list where the old one was.
        if (frame) lists.pop();
        const el = h(ordered ? "ol" : "ul");
        (lists.length && top().item ? top().item! : root).append(el);
        frame = { indent, ordered, el, item: null };
        lists.push(frame);
      }
      if (ordered && !frame.el.childElementCount) {
        // Numbered from where the plan starts it ("5) …" is 5, not 1).
        const start = parseInt(item[2], 10);
        if (start !== 1) frame.el.setAttribute("start", String(start));
      }
      const content = item[3] ?? "";
      const task = /^\[( |x|X)\][ \t]+(.*)$/.exec(content);
      const li = task
        ? h("li", { class: task[1] === " " ? "task" : "task done" }, ...inline(task[2]))
        : h("li", {}, ...inline(content));
      frame.el.append(li);
      frame.item = li;
      para = null;
      blank = false;
      continue;
    }

    // More text for a list item: indented under it, or a line that runs straight on.
    if (lists.length) {
      if (blank) leave(indent);
      if (lists.length && top().item) {
        const li = top().item!;
        if (blank) li.append(h("p", {}, ...inline(line)));
        else li.append(h("br"), ...inline(line));
        para = null;
        blank = false;
        continue;
      }
    }

    lists = [];
    para = h("p", {}, ...inline(line));
    root.append(para);
    blank = false;
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

/**
 * When a plan window resets: the clock time today, "tomorrow 17:14", the
 * weekday within a week ("Tue 17:14"), else the date — a weekly window can be
 * days away (dashboard#30).
 */
function resetNote(ms: number, now = new Date()): string {
  const at = hm(ms);
  const d = new Date(ms);
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(d) - midnight(now)) / 86_400_000);
  if (days <= 0) return t("use.resets", { at });
  if (days === 1) return t("use.resetsOn", { day: t("use.tomorrow"), at });
  const day = new Intl.DateTimeFormat(getLang(), days < 7 ? { weekday: "long" } : { day: "numeric", month: "short" }).format(d);
  return t("use.resetsOn", { day, at });
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
    const note = w.resetsAt ? resetNote(w.resetsAt) : "";
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
