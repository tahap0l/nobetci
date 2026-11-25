// Kurallar: ordered user rules (first match wins) with an editor and a live
// tester, per-project trust, and the ready-made deny reasons.

import type { Evaluation } from "../../core/bridge";
import { newRule, type ProjectPolicy, type RuleAction, type RuleMode, type UserRule } from "../../core/settings-model";
import { h } from "../../ui/dom";
import { api, errText } from "../api";
import { ceilingLabel } from "../data";
import { t, type MsgKey } from "../i18n";
import { icon } from "../icons";
import { devParam, refreshBadges, rerender, type Tab } from "../nav";
import { settings, update } from "../store";
import { buildInput, evaluationView } from "../tester";
import {
  button,
  card,
  debounce,
  field,
  iconButton,
  levelChip,
  levelLabel,
  modal,
  notice,
  openMenu,
  segmented,
  textInput,
  toast,
  toggle,
} from "../ui";

const MODES: RuleMode[] = ["contains", "prefix", "exact", "glob", "regex"];

function actionLabel(a: RuleAction): string {
  return a === "allow" || a === "deny" || a === "ask"
    ? t(`rules.act.${a}`)
    : t("rules.act.level", { level: levelLabel(a) });
}

const COMMON_TOOLS = [
  "*",
  "Bash",
  "PowerShell",
  "Bash, PowerShell",
  "Write",
  "Edit",
  "MultiEdit",
  "Read",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
  "mcp__*",
];

interface Template {
  title: string;
  hint: string;
  rule: Partial<UserRule>;
}

/** Built on demand so names and messages come out in the current language. */
function templates(): Template[] {
  const tpl = (id: string, rule: Partial<UserRule>): Template => ({
    title: t(`tpl.${id}.title` as MsgKey),
    hint: t(`tpl.${id}.hint` as MsgKey),
    rule,
  });
  return [
    tpl("npm", { name: "npm test", tool: "Bash, PowerShell", mode: "prefix", pattern: "npm test", action: "allow" }),
    tpl("cargo", {
      name: "cargo test",
      tool: "Bash, PowerShell",
      mode: "prefix",
      pattern: "cargo test",
      action: "allow",
    }),
    tpl("git", {
      name: t("tpl.git.name"),
      tool: "Bash, PowerShell",
      mode: "regex",
      pattern: "^git (status|diff|log|show)\\b",
      action: "allow",
    }),
    tpl("force", {
      name: t("tpl.force.name"),
      tool: "Bash, PowerShell",
      mode: "contains",
      pattern: "git push --force",
      action: "deny",
      message: t("tpl.force.msg"),
    }),
    tpl("env", {
      name: t("tpl.env.name"),
      tool: "Read",
      mode: "glob",
      pattern: "*.env*",
      action: "deny",
      message: t("tpl.env.msg"),
    }),
    tpl("rm", { name: t("tpl.rm.name"), tool: "Bash", mode: "contains", pattern: "rm -rf", action: "critical" }),
    tpl("mcp", { name: t("tpl.mcp.name"), tool: "mcp__*", mode: "contains", pattern: "", action: "ask" }),
    tpl("publish", {
      name: t("tpl.publish.name"),
      tool: "Bash, PowerShell",
      mode: "regex",
      pattern: "\\b(npm|pnpm|yarn|cargo) publish\\b",
      action: "deny",
      message: t("tpl.publish.msg"),
    }),
  ];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Name of the stand-in rule the editor's tester uses to see if the draft matches. */
const PROBE = "__nobi_probe__";

function toolMatches(spec: string, tool: string): boolean {
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((s) =>
      s === "*"
        ? true
        : s.endsWith("*")
          ? tool.toLowerCase().startsWith(s.slice(0, -1).toLowerCase())
          : s.toLowerCase() === tool.toLowerCase(),
    );
}

function toolText(spec: string): string {
  const s = spec.trim();
  return !s || s === "*" ? t("rules.allTools") : s;
}

function ruleTitle(r: UserRule): string {
  return r.name.trim() || r.pattern.trim() || t("rules.untitled");
}

function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function actionBadge(a: RuleAction): HTMLElement {
  if (a === "low" || a === "medium" || a === "high" || a === "critical") {
    return h("span", { class: "act act-level" }, h("span", { text: t("rules.riskArrow") }), levelChip(a, true));
  }
  const ic = a === "allow" ? "check" : a === "deny" ? "cross" : "hand";
  return h("span", { class: `act act-${a}` }, icon(ic, 13), actionLabel(a));
}

/** A long pattern shows two lines at most in the list; the whole of it is in the tooltip. */
const LONG_PATTERN = 60;

function summary(r: UserRule): HTMLElement {
  const folder = r.project.trim();
  const pattern = r.pattern.trim();
  const long = pattern.length > LONG_PATTERN;
  // A long pattern gets a line of its own, cut after two (.rs-pat-long).
  const pat = h("code", { class: `rs-pat mono${long ? " rs-pat-long" : ""}`, text: `“${pattern}”`, title: pattern });
  // Every separator travels with what follows it ("· starts with “…”",
  // "→ Auto-allow"), so a wrap never leaves a lone · or → at the end of a line.
  return h(
    "span",
    { class: "rule-sum" },
    h("span", { class: "rs-tool", text: toolText(r.tool) }),
    h(
      "span",
      { class: "rs-group" },
      h("span", { class: "rs-sep", text: "·" }),
      "\u00A0",
      pattern
        ? h("span", { class: "rs-mode", text: `${t(`rules.sum.${r.mode}`)} ` })
        : h("span", { class: "rs-mode", text: t("rules.everyRequest") }),
      pattern && !long ? pat : null,
    ),
    long ? pat : null,
    folder
      ? h("span", { class: "rs-proj", title: folder }, icon("folder", 12), h("span", { text: folderName(folder) }))
      : null,
    h("span", { class: "rs-keep" }, h("span", { class: "rs-arrow", text: "→" }), "\u00A0", actionBadge(r.action)),
  );
}

// ── Pattern checks ────────────────────────────────────────────────────────────
// Rules run on Rust's regex crate, where a pattern that does not compile
// matches nothing: a deny rule would silently never deny. So the editor asks
// Rust (rule_pattern_check compiles exactly as rules.rs does) and only falls
// back to the browser's RegExp when that command can't be reached.

/** Rust's own answer (English, with a caret under the spot), or the browser's guess as a message key. */
type Problem = { raw: string } | { key: MsgKey };

/** The regex crate's message → what to tell the user (checked in order). */
const REGEX_MESSAGES: [RegExp, MsgKey][] = [
  [/exceeds size limit/, "editor.re.tooBig"],
  [/look-?around/, "editor.regexLook"],
  [/backreference/, "editor.regexBackref"],
  [/unclosed group/, "editor.re.unclosedGroup"],
  [/unopened group/, "editor.re.unopenedGroup"],
  [/unclosed character class/, "editor.re.unclosedClass"],
  [/invalid escape sequence found in character class/, "editor.re.classEscape"],
  [/hexadecimal/, "editor.re.hex"],
  [/incomplete escape|reached end of pattern/, "editor.re.trailing"],
  [/unrecognized escape/, "editor.re.escape"],
  [/repetition quantifier expects|unclosed counted repetition|decimal literal/, "editor.re.braces"],
  [/repetition operator missing/, "editor.re.nothingToRepeat"],
  [/repetition count range/, "editor.re.countOrder"],
  [/character class range/, "editor.re.rangeOrder"],
  [/range boundary/, "editor.re.rangeBoundary"],
  [/flag/, "editor.re.flag"],
  [/capture group name|capture group character/, "editor.re.groupName"],
  [/unicode/i, "editor.re.unicode"],
  [/nested|maximum number/, "editor.re.tooDeep"],
];

/** The user-facing text of a pattern problem, in the current language. */
function problemText(p: Problem): string {
  if ("key" in p) return t("editor.regexBad", { err: t(p.key) });
  // Only the engine's last line names the problem; the lines above quote the
  // pattern itself, whose words must not be mistaken for the message.
  const what = /\nerror:\s*([^\n]*)\s*$/.exec(p.raw)?.[1] ?? p.raw;
  const key = REGEX_MESSAGES.find(([re]) => re.test(what))?.[1] ?? "editor.re.generic";
  // A one-line pattern comes back as "    <pattern>" then "    ^^" under the spot.
  const lines = p.raw.split("\n");
  const caret = lines.findIndex((l) => /^ {4}\s*\^+\s*$/.test(l));
  if (caret > 0 && /^ {4}/.test(lines[caret - 1]) && !lines.some((l) => /^~+$/.test(l))) {
    const chars = [...lines[caret - 1].slice(4)];
    let start = lines[caret].indexOf("^") - 4;
    const end = start + (lines[caret].trim().length || 1);
    // A bad hex digit is marked alone ("s" of C:\Users): show it with its \U.
    if (key === "editor.re.hex") {
      const slash = chars.lastIndexOf("\\", start);
      if (slash >= 0 && start - slash <= 9) start = slash;
    }
    const at = chars.slice(Math.max(0, start), Math.max(start + 1, end)).join("");
    if (at.trim()) return t("editor.regexBadAt", { at, err: t(key) });
  }
  return t("editor.regexBad", { err: t(key) });
}

/**
 * The browser's guess, used only where Rust can't be asked: JS syntax errors
 * plus what JS accepts but Rust refuses (lookaround, backreferences).
 */
function browserGuess(pattern: string): Problem | null {
  if (/\(\?<?[=!]/.test(pattern)) return { key: "editor.regexLook" };
  if (/\\[1-9]|\\k</.test(pattern)) return { key: "editor.regexBackref" };
  try {
    new RegExp(pattern.replace(/\(\?[imsxU-]+\)/g, ""), "i");
    return null;
  } catch {
    return { key: "editor.re.generic" };
  }
}

/** Why `pattern` can't work in `mode` (null when it compiles), as Rust's rules would compile it. */
async function patternProblem(mode: RuleMode, pattern: string): Promise<Problem | null> {
  const p = pattern.trim();
  if (!p || (mode !== "regex" && mode !== "glob")) return null;
  try {
    await api.rulePatternCheck(mode, p);
    return null;
  } catch (err) {
    const raw = errText(err);
    if (/^regex parse error|exceeds size limit/i.test(raw)) return { raw };
    // The check itself is unavailable (a plain browser): the browser's guess.
    return mode === "regex" ? browserGuess(p) : null;
  }
}

/** Results for the patterns in the list, by [mode, pattern]: a broken rule is marked there. */
const listChecks = new Map<string, Problem | null>();
const listChecking = new Set<string>();

function listProblem(r: UserRule): Problem | null {
  const pattern = r.pattern.trim();
  if (!pattern || (r.mode !== "regex" && r.mode !== "glob")) return null;
  const key = JSON.stringify([r.mode, pattern]);
  if (listChecks.has(key)) return listChecks.get(key) ?? null;
  if (!listChecking.has(key)) {
    listChecking.add(key);
    void patternProblem(r.mode, pattern).then((p) => {
      listChecking.delete(key);
      listChecks.set(key, p);
      if (p) rerender("kurallar");
    });
  }
  return null;
}

// ── Paths ─────────────────────────────────────────────────────────────────────

/**
 * A folder path as typed or pasted, ready to compare: no surrounding spaces and
 * no surrounding quotes (Explorer's "Copy as path" adds them). Rust compares
 * paths as they are, so `"C:\work"` would never match anything.
 */
function cleanPath(raw: string): string {
  let s = raw.trim();
  for (;;) {
    const m = /^(["'])([\s\S]*)\1$/.exec(s);
    if (!m) return s;
    s = m[2].trim();
  }
}

/** Native folder picker that fills `input` (and fires its input and change handlers); true when a folder was picked. */
async function pickInto(input: HTMLInputElement): Promise<boolean> {
  const picked = await api.pickFolder(input.value.trim() || undefined);
  if (!picked) return false;
  input.value = picked;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function pickButton(input: HTMLInputElement): HTMLButtonElement {
  return button(t("common.choose"), {
    kind: "ghost",
    small: true,
    icon: "folder",
    title: t("common.chooseFolder"),
    onClick: () => void pickInto(input),
  });
}

// ── Undo slots ────────────────────────────────────────────────────────────────

interface Undo {
  /** A function, so the bar follows a language switch. */
  text: () => string;
  restore: () => void;
  timer: number;
}

let ruleUndo: Undo | null = null;
let projectUndo: Undo | null = null;

function makeUndo(text: () => string, restore: () => void, clear: () => void): Undo {
  return {
    text,
    restore,
    timer: window.setTimeout(() => {
      clear();
      rerender("kurallar");
    }, 9000),
  };
}

function undoBar(u: Undo, clear: () => void): HTMLElement {
  return h(
    "div",
    { class: "undo-bar", role: "status" },
    icon("trash", 15),
    h("span", { text: u.text() }),
    button(t("common.undo"), {
      kind: "subtle",
      small: true,
      icon: "reset",
      fk: "undo",
      onClick: () => {
        window.clearTimeout(u.timer);
        u.restore();
        clear();
        rerender("kurallar");
      },
    }),
  );
}

// ── Rules list ────────────────────────────────────────────────────────────────

function move(i: number, d: -1 | 1) {
  update((x) => {
    const j = i + d;
    if (j < 0 || j >= x.rules.length) return;
    [x.rules[i], x.rules[j]] = [x.rules[j], x.rules[i]];
  });
  rerender("kurallar");
}

function removeRule(i: number) {
  const r = settings().rules[i];
  if (!r) return;
  if (ruleUndo) window.clearTimeout(ruleUndo.timer);
  update((x) => x.rules.splice(i, 1));
  ruleUndo = makeUndo(
    () => t("rules.deleted", { name: ruleTitle(r) }),
    () =>
      update((x) => {
        if (!x.rules.some((o) => o.id === r.id)) x.rules.splice(Math.min(i, x.rules.length), 0, r);
      }),
    () => (ruleUndo = null),
  );
  refreshBadges();
  rerender("kurallar");
}

function rulesCard(): HTMLElement {
  const rules = settings().rules;
  const list = h("div", { class: "rule-list" });
  rules.forEach((r, i) => {
    const broken = listProblem(r);
    list.append(
      h(
        "div",
        { class: `rule-row${r.enabled ? "" : " disabled"}` },
        h("span", { class: "rule-idx", text: String(i + 1) }),
        toggle(
          r.enabled,
          (on) => {
            update((x) => {
              const found = x.rules.find((o) => o.id === r.id);
              if (found) found.enabled = on;
            });
            refreshBadges();
            rerender("kurallar");
          },
          { label: t("rules.enabledAria", { name: ruleTitle(r) }), fk: `rule-on:${r.id}` },
        ),
        h(
          "button",
          {
            type: "button",
            class: "rule-main",
            title: t("common.edit"),
            "data-fk": `rule-edit-main:${r.id}`,
            onclick: () => openEditor(r, i),
          },
          h("span", { class: "rule-name", text: ruleTitle(r) }),
          summary(r),
          broken
            ? h(
                "span",
                { class: "field-hint bad", title: problemText(broken) },
                icon("warn", 13),
                " ",
                t("rules.brokenPattern"),
              )
            : null,
        ),
        h(
          "div",
          { class: "rule-btns" },
          iconButton("up", t("common.moveUp"), () => move(i, -1), { disabled: i === 0, fk: `rule-up:${r.id}` }),
          iconButton("down", t("common.moveDown"), () => move(i, 1), {
            disabled: i === rules.length - 1,
            fk: `rule-down:${r.id}`,
          }),
          iconButton("edit", t("common.edit"), () => openEditor(r, i), { fk: `rule-edit:${r.id}` }),
          iconButton("trash", t("common.delete"), () => removeRule(i), { fk: `rule-del:${r.id}`, cls: "danger" }),
        ),
      ),
    );
  });

  const tplBtn = button(t("rules.fromTemplate"), { kind: "ghost", icon: "sparkle", fk: "rules:tpl" });
  tplBtn.setAttribute("aria-haspopup", "menu");
  tplBtn.addEventListener("click", () =>
    openMenu(
      tplBtn,
      templates().map((tp) => ({
        label: tp.title,
        hint: tp.hint,
        onClick: () => openEditor({ ...newRule(), ...tp.rule }, -1),
      })),
      t("rules.templatesTitle"),
    ),
  );

  return card(
    {
      title: t("rules.title"),
      icon: "kurallar",
      desc: t("rules.cardDesc"),
      actions: [
        tplBtn,
        button(t("rules.add"), {
          kind: "primary",
          icon: "plus",
          fk: "rules:add",
          onClick: () => openEditor(newRule(), -1),
        }),
      ],
    },
    ruleUndo ? undoBar(ruleUndo, () => (ruleUndo = null)) : null,
    rules.length
      ? list
      : h(
          "div",
          { class: "empty" },
          icon("kurallar", 26),
          h("strong", { text: t("rules.empty") }),
          h("span", { text: t("rules.emptyText") }),
        ),
  );
}

// ── Rule editor ───────────────────────────────────────────────────────────────

/** Lower case, forward slashes, no trailing slash, Git Bash's /c/ as c: — as risk.rs compares paths. */
function normPath(path: string): string {
  let s = path.replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "");
  const m = /^\/([a-z])(\/|$)/.exec(s);
  if (m) s = `${m[1]}:${s.slice(2)}`;
  return s;
}

/** `path` is `folder` or inside it (rules.rs `within`). */
function inside(path: string, folder: string): boolean {
  const p = normPath(path);
  const f = normPath(folder);
  return !!f && (p === f || p.startsWith(`${f}/`));
}

/** Tools whose target is a file path: rules.rs matches those where the path really leads. */
const PATH_TOOLS = new Set(["write", "edit", "multiedit", "notebookedit", "read", "notebookread", "ls", "glob", "grep"]);

function toolSpecs(tool: string): string[] {
  return tool
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** The rule is about file paths: it names a path tool, or (for any tool) its pattern reads as a path. */
function pathRule(tool: string, pattern: string): boolean {
  const p = pattern.trim();
  if (!p) return false;
  const specs = toolSpecs(tool);
  if (specs.some((s) => PATH_TOOLS.has(s))) return true;
  const anyTool = !specs.length || specs.includes("*");
  return anyTool && /^(~|\.{1,2}[\\/]|[a-z]:[\\/]|[\\/]|\$home\b|\$\{home\}|%userprofile%)/i.test(p);
}

/** The rule names file-path tools only: it never sees a command, so the chain check (rules.rs) passes it by. */
function pathToolsOnly(tool: string): boolean {
  const specs = toolSpecs(tool);
  return specs.length > 0 && specs.every((s) => PATH_TOOLS.has(s));
}

/** What Rust calls a rule: its name, or its pattern when unnamed. */
function reportedName(r: UserRule): string {
  return r.name.trim() || r.pattern.trim();
}

function openEditor(original: UserRule, index: number) {
  const draft: UserRule = { ...original };
  const isNew = index < 0;
  const ceiling = settings().autoAllowMax;
  /** What saving would store; differs from the start when the dialog holds unsaved edits. */
  const stored = (r: UserRule) =>
    JSON.stringify({
      ...r,
      name: r.name.trim(),
      tool: r.tool.trim() || "*",
      pattern: r.pattern.trim(),
      project: cleanPath(r.project),
    });
  const initial = stored(original);
  let gone = false;

  const name = textInput({
    value: draft.name,
    placeholder: t("editor.namePh"),
    label: t("editor.name"),
    onInput: (v) => ((draft.name = v), changed()),
  });
  name.setAttribute("data-autofocus", "");

  const listId = "tool-list";
  const toolIn = textInput({
    value: draft.tool,
    mono: true,
    placeholder: "*",
    label: t("editor.tool"),
    onInput: (v) => ((draft.tool = v), changed()),
  });
  toolIn.setAttribute("list", listId);
  const datalist = h("datalist", { id: listId });
  for (const tool of COMMON_TOOLS) datalist.append(h("option", { value: tool }));

  const modeSel = segmented(
    MODES.map((m) => [m, t(`rules.mode.${m}`)] as const),
    draft.mode,
    (v) => {
      draft.mode = v;
      changed();
    },
    { label: t("editor.match"), cls: "seg-sm" },
  );

  const patIn = textInput({
    value: draft.pattern,
    mono: true,
    placeholder: "npm test",
    label: t("editor.pattern"),
    onInput: (v) => ((draft.pattern = v), changed()),
  });
  const patHint = h("span", { class: "field-hint", "aria-live": "polite" });

  const projIn = textInput({
    value: draft.project,
    mono: true,
    placeholder: t("editor.projectPh"),
    label: t("editor.project"),
    onInput: (v) => ((draft.project = v), changed()),
    // A pasted "C:\work" (quotes and all) would never match: cleaned once typed.
    onChange: (v, el) => {
      const clean = cleanPath(v);
      if (clean === v) return;
      el.value = clean;
      draft.project = clean;
      toast(t("proj.cleaned"), "info");
      changed();
    },
  });

  // Action picker: three decisions, then four re-scores.
  const actionWrap = h("div", { class: "action-pick", role: "radiogroup", "aria-label": t("editor.action") });
  const actBtns: [RuleAction, HTMLButtonElement][] = [];
  const addAct = (a: RuleAction, parent: HTMLElement, content: (Node | string)[]) => {
    const b = h(
      "button",
      {
        type: "button",
        class: `ap-btn ap-${a}${draft.action === a ? " on" : ""}`,
        role: "radio",
        "aria-checked": String(draft.action === a),
      },
      ...content,
    );
    b.addEventListener("click", () => {
      draft.action = a;
      for (const [k, el] of actBtns) {
        el.classList.toggle("on", k === a);
        el.setAttribute("aria-checked", String(k === a));
      }
      changed();
    });
    actBtns.push([a, b]);
    parent.append(b);
  };
  const decide = h("div", { class: "ap-row" });
  addAct("allow", decide, [icon("check", 15), t("rules.act.allow")]);
  addAct("deny", decide, [icon("cross", 15), t("rules.act.deny")]);
  addAct("ask", decide, [icon("hand", 15), t("rules.act.ask")]);
  const rescore = h(
    "div",
    { class: "ap-row ap-levels" },
    h("span", { class: "ap-caption", text: t("editor.setRiskTo") }),
  );
  for (const l of ["low", "medium", "high", "critical"] as const) addAct(l, rescore, [levelChip(l, true)]);
  actionWrap.append(decide, rescore);

  const actionNote = h("div", { class: "action-note" });
  const msgIn = h("textarea", {
    class: "input",
    rows: 2,
    placeholder: t("editor.messagePh"),
    "aria-label": t("editor.message"),
  });
  msgIn.value = draft.message;
  msgIn.addEventListener("input", () => {
    draft.message = msgIn.value;
  });
  const msgField = field(t("editor.message"), msgIn, t("editor.messageHint"));

  // Mini tester.
  const specs = draft.tool
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const prefixSpec = specs.find((s) => s.endsWith("*") && s !== "*");
  const firstTool =
    specs.find((s) => !s.includes("*")) ??
    (prefixSpec ? `${prefixSpec.slice(0, -1)}${prefixSpec.endsWith("__*") ? "" : "__"}example` : null);
  const test = { tool: firstTool ?? "Bash", target: "", cwd: draft.project };
  const testTool = textInput({
    value: test.tool,
    mono: true,
    label: t("editor.testTool"),
    onInput: (v) => ((test.tool = v), runTest()),
  });
  testTool.setAttribute("list", listId);
  const testTarget = textInput({
    value: "",
    mono: true,
    placeholder: t("editor.samplePh"),
    label: t("editor.sampleAria"),
    onInput: (v) => ((test.target = v), runTest()),
  });
  const testCwd = textInput({
    value: test.cwd,
    mono: true,
    placeholder: t("tester.cwdPh"),
    label: t("tester.cwdAria"),
    onInput: (v) => ((test.cwd = v), runTest()),
  });
  const testOut = h("div", { class: "rule-test-out", "aria-live": "polite" });
  let seq = 0;

  // The draft runs under the PROBE name in both evaluations, so the result can
  // tell it apart from every other rule (an unnamed one, or one with the same
  // name) and the names Rust reports are put back afterwards.
  const draftRules = (): UserRule[] => {
    const rules = settings().rules.map((r) => ({ ...r }));
    const probe = { ...draft, name: PROBE };
    if (isNew) rules.push(probe);
    else rules[index] = probe;
    return rules;
  };
  /** What Rust calls the rule once saved: its name, or its pattern when unnamed. */
  const savedName = () => draft.name.trim() || draft.pattern.trim();
  const named = (ev: Evaluation): Evaluation => {
    const fix = (s: string | null) => (s == null ? s : s.split(PROBE).join(savedName()));
    return { ...ev, rule: fix(ev.rule), note: fix(ev.note), message: fix(ev.message) };
  };

  const runTest = debounce(async () => {
    const my = ++seq;
    const target = test.target;
    if (!target.trim()) {
      testOut.replaceChildren(h("p", { class: "muted empty-line", text: t("editor.tryEmpty") }));
      return;
    }
    const tool = test.tool.trim() || "Bash";
    const input = buildInput(tool, target);
    // No folder typed: none sent (see the Safety tab's tester).
    const cwd = cleanPath(test.cwd);
    const s = settings();
    // The draft alone: tells "does not match" apart from "an earlier rule wins".
    const probeRule: UserRule = { ...draft, enabled: true, name: PROBE };
    const [probe, full] = await Promise.all([
      api.rulesTest(tool, input, cwd, { ...s, rules: [probeRule] }),
      api.rulesTest(tool, input, cwd, { ...s, rules: draftRules() }),
    ]);
    if (my !== seq) return;
    if (!probe || !full) {
      testOut.replaceChildren(notice("info", t("editor.tryOnlyInApp")));
      return;
    }
    testOut.replaceChildren(testResult(probe, full, tool, cwd));
  }, 250);

  const testResult = (probe: Evaluation, full: Evaluation, tool: string, cwd: string): HTMLElement => {
    const matched = probe.rule === PROBE;
    const why: string[] = [];
    if (!matched) {
      if (!toolMatches(draft.tool, tool)) why.push(t("editor.whyTool", { tool }));
      const folder = cleanPath(draft.project);
      if (folder && !inside(cwd, folder)) why.push(t("editor.whyFolder"));
      if (!why.length) why.push(t("editor.whyPattern"));
    }
    const other = matched && draft.enabled && full.rule && full.rule !== PROBE ? full.rule : null;
    // Another rule decided. Usually it comes first; the one exception (rules.rs
    // `deciding_rule`) is a deny rule further down, when this rule matched a
    // path only where it leads: say which, by their places in the list.
    let decidedBy: HTMLElement | null = null;
    if (other) {
      const rules = draftRules();
      const at = rules.findIndex((r) => r.name === PROBE);
      const places = rules.flatMap((r, j) => (j !== at && r.enabled && reportedName(r) === other ? [j] : []));
      const below = places.length > 0 && places.every((j) => j > at);
      decidedBy = notice("warn", t(below ? "editor.below" : "editor.earlier", { name: other }));
    }
    return h(
      "div",
      { class: "rule-test-res" },
      h(
        "div",
        { class: `match-line ${matched ? "yes" : "no"}` },
        icon(matched ? "check" : "cross", 15),
        h("strong", { text: matched ? t("editor.matches") : t("editor.noMatch") }),
        !matched ? h("span", { class: "muted", text: `— ${why.join(", ")}` }) : null,
        matched && !draft.enabled ? h("span", { class: "muted", text: t("editor.butDisabled") }) : null,
      ),
      decidedBy,
      h("div", { class: "rt-caption", text: t("editor.result") }),
      evaluationView(named(full), { compact: true }),
      cwd ? null : h("p", { class: "fine", text: t("tester.noCwd") }),
    );
  };

  // Pattern check: Rust's answer for the pattern as it now reads. Until it
  // comes, the previous verdict stays (no flicker while typing); Save asks once
  // more before it stores anything.
  let problem: Problem | null = null;
  let checkSeq = 0;
  const checkPattern = debounce(async () => {
    const my = ++checkSeq;
    const p = await patternProblem(draft.mode, draft.pattern);
    if (my !== checkSeq || gone) return;
    problem = p;
    paintPattern();
  }, 200);

  const paintPattern = () => {
    const p = draft.pattern.trim();
    let text: string;
    if (!p) text = t("editor.emptyPattern");
    else if (problem) text = problemText(problem);
    else if (draft.mode === "regex") text = t("editor.regexOk");
    else if (draft.mode === "glob") text = t("editor.globHint");
    else if (draft.mode === "prefix") text = t("editor.prefixHint");
    else text = t("editor.patternHint");
    // Rust trims a pattern before it matches; say so rather than let "git " look like a word boundary.
    if (p && p !== draft.pattern) text += ` ${t("editor.edgeSpaces")}`;
    patHint.textContent = text;
    patHint.classList.toggle("bad", !!problem);
    saveBtn.disabled = !!problem;
  };

  const changed = () => {
    if ((draft.mode === "regex" || draft.mode === "glob") && draft.pattern.trim()) checkPattern();
    else {
      checkSeq++;
      problem = null;
    }
    paintPattern();

    // Action notes. A rule with no pattern for every tool applies to every
    // request (on purpose: "always ask for MCP tools" relies on an empty
    // pattern), so it says what that means for its action.
    actionNote.replaceChildren();
    const everything = !draft.pattern.trim() && (!draft.tool.trim() || draft.tool.trim() === "*");
    // The chain check is about commands (rules.rs `command_of`): a Write or Read
    // rule has none to chain.
    const loose =
      (!draft.pattern.trim() || (draft.mode !== "exact" && draft.mode !== "regex")) && !pathToolsOnly(draft.tool);
    const chainNote = h("p", { class: "fine", text: t("editor.chainNote") });
    const a = draft.action;
    if (a === "allow") {
      actionNote.append(
        ceiling === "none"
          ? notice("warn", t("editor.allowOff"))
          : notice("info", t("editor.allowCeiling", { ceiling: ceilingLabel(ceiling) })),
      );
      if (everything) actionNote.append(notice("warn", t("editor.allowEverything")));
      else if (loose) actionNote.append(chainNote);
    } else if (a === "deny") {
      actionNote.append(notice("info", t("editor.denyNote")));
      if (everything) actionNote.append(notice("warn", t("editor.denyEverything")));
    } else if (a === "ask") {
      if (everything) actionNote.append(notice("warn", t("editor.askEverything")));
    } else {
      if (a === "low" || a === "medium") actionNote.append(notice("info", t("editor.rescoreNote")));
      if (everything) actionNote.append(notice("warn", t("editor.rescoreEverything", { level: levelLabel(a) })));
      else if (loose && (a === "low" || a === "medium")) actionNote.append(chainNote);
    }
    // On a file path the matching is lopsided (rules.rs `covers`): a rule that
    // lets a request through or lowers its risk applies only where the path
    // really leads; one that denies, asks or raises catches it however spelled.
    if (pathRule(draft.tool, draft.pattern)) {
      const loosens = a === "allow" || a === "low" || a === "medium";
      actionNote.append(h("p", { class: "fine", text: t(loosens ? "editor.pathLoose" : "editor.pathCatch") }));
    }
    msgField.hidden = a !== "deny";
    runTest();
  };

  const saveBtn = button(isNew ? t("editor.addRule") : t("common.save"), {
    kind: "primary",
    icon: "check",
    onClick: async () => {
      saveBtn.disabled = true;
      // The last word on the pattern comes from Rust, right before it is stored.
      const p = await patternProblem(draft.mode, draft.pattern);
      if (gone) return;
      if (p) {
        problem = p;
        paintPattern();
        patIn.focus();
        return;
      }
      const clean: UserRule = {
        ...draft,
        name: draft.name.trim(),
        tool: draft.tool.trim() || "*",
        pattern: draft.pattern.trim(),
        project: cleanPath(draft.project),
      };
      update((x) => {
        if (isNew) x.rules.push(clean);
        else {
          const i = x.rules.findIndex((r) => r.id === original.id);
          if (i >= 0) x.rules[i] = clean;
          else x.rules.push(clean);
        }
      });
      m.close();
      refreshBadges();
      rerender("kurallar");
    },
  });

  const m = modal({
    title: isNew ? t("editor.newTitle") : t("editor.editTitle"),
    subtitle: isNew ? t("editor.newSub") : t("editor.position", { n: index + 1 }),
    wide: true,
    cls: "modal-rule",
    // A stray click beside the dialog, or Esc, never throws the edits away unasked.
    isDirty: () => stored(draft) !== initial,
    onClose: () => {
      gone = true;
    },
    body: [
      h(
        "div",
        { class: "rule-editor" },
        h(
          "div",
          { class: "form-grid" },
          field(t("editor.name"), name),
          field(
            t("editor.tool"),
            toolIn,
            h(
              "span",
              {},
              h("code", { text: "*" }),
              t("editor.toolHint1"),
              h("code", { text: "Bash, PowerShell" }),
              t("editor.toolHint2"),
              h("code", { text: "mcp__github__*" }),
              ")",
            ),
          ),
          h(
            "div",
            { class: "field span-2" },
            h("div", { class: "field-row" }, h("span", { class: "field-label", text: t("editor.pattern") }), modeSel),
            patIn,
            patHint,
          ),
          h(
            "div",
            { class: "field span-2" },
            h("span", { class: "field-label", text: t("editor.project") }),
            h("div", { class: "path-pick" }, projIn, pickButton(projIn)),
            h("span", { class: "field-hint", text: t("editor.projectHint") }),
          ),
          h(
            "div",
            { class: "field span-2" },
            h("span", { class: "field-label", text: t("editor.action") }),
            actionWrap,
            actionNote,
          ),
          h("div", { class: "span-2" }, msgField),
          datalist,
        ),
        h(
          "div",
          { class: "rule-test" },
          h(
            "div",
            { class: "rt-head" },
            icon("sparkle", 15),
            h("strong", { text: t("editor.tryTitle") }),
            h("span", { class: "muted", text: t("editor.tryDesc") }),
          ),
          h("div", { class: "rt-inputs" }, testTarget, testTool, testCwd),
          testOut,
        ),
      ),
    ],
    foot: [
      h(
        "label",
        { class: "inline-toggle" },
        toggle(draft.enabled, (v) => ((draft.enabled = v), changed()), { label: t("editor.enabledAria") }),
        h("span", { text: t("editor.enabled") }),
      ),
      h("span", { class: "spacer" }),
      button(t("common.cancel"), { kind: "subtle", onClick: () => m.close() }),
      saveBtn,
    ],
  });
  changed();
  const devTarget = devParam("test");
  if (devTarget) {
    testTarget.value = devTarget;
    test.target = devTarget;
    runTest();
  }
}

// ── Project trust ─────────────────────────────────────────────────────────────

/** Folders seen in the history, busiest project first: full path + request count. */
let recentFolders: { path: string; count: number }[] | null = null;
let focusNewProject = false;

async function loadRecent() {
  // auditProjects ranks folder *names*; the full paths come from the entries' cwd.
  const [page, ranked] = await Promise.all([api.auditQuery({ limit: 1000 }), api.auditProjects()]);
  const byName = new Map<string, string>();
  const order: string[] = [];
  for (const e of page?.entries ?? []) {
    const cwd = e.cwd.trim();
    if (!cwd) continue;
    const name = (e.project || folderName(cwd)).toLowerCase();
    if (!byName.has(name)) {
      byName.set(name, cwd);
      order.push(name);
    }
  }
  const counts = new Map((ranked ?? []).map(([n, c]) => [n.toLowerCase(), c] as const));
  const names = ranked?.length ? ranked.map(([n]) => n.toLowerCase()).filter((n) => byName.has(n)) : order;
  recentFolders = names.slice(0, 8).map((n) => ({ path: byName.get(n) ?? n, count: counts.get(n) ?? 0 }));
  rerender("kurallar");
}

/** Another row already holds `path` (compared as Rust compares folders). */
function duplicatePath(path: string, except = -1): boolean {
  const n = normPath(path);
  return !!n && settings().projects.some((p, i) => i !== except && normPath(cleanPath(p.path)) === n);
}

function addProject(path: string, mode: ProjectPolicy["mode"] = "normal") {
  const clean = cleanPath(path);
  if (clean && duplicatePath(clean)) {
    toast(t("proj.duplicate"), "info");
    return;
  }
  update((x) => x.projects.push({ path: clean, mode, note: "" }));
  focusNewProject = !clean;
  refreshBadges();
  rerender("kurallar");
}

async function pickProject() {
  const picked = await api.pickFolder();
  if (picked) addProject(picked);
}

/**
 * A row's path while it is being typed. It takes effect only when it is
 * finished (Enter, leaving the field, a folder pick, leaving the tab or the
 * window), never letter by letter: a trusted row retyped from scratch would
 * otherwise trust "C:\Users\" for as long as you paused there.
 *
 * The draft belongs to the row by the path it had (`from`; an empty, new row
 * by its place), not by its place alone: a row removed above it, or an Undo,
 * must not hand it to another folder. A redraw (an Undo bar running out, a
 * change from the island, a save landing) rebuilds the field from it.
 */
let pathDraft: { index: number; from: string; value: string } | null = null;

/** The row the draft belongs to now, or -1 when that row is gone. */
function draftRow(): number {
  const d = pathDraft;
  if (!d) return -1;
  const projects = settings().projects;
  if (d.from) return projects.findIndex((p) => p.path === d.from);
  return projects[d.index]?.path === "" ? d.index : -1;
}

/**
 * Stores `raw` as row `i`'s path (trimmed, unquoted) unless another row has it
 * already; returns what the field should show afterwards.
 */
function commitPath(i: number, raw: string): string {
  if (pathDraft && draftRow() === i) pathDraft = null;
  const current = settings().projects[i];
  if (!current) return raw;
  const clean = cleanPath(raw);
  if (clean && duplicatePath(clean, i)) {
    toast(t("proj.duplicate"), "info");
    return current.path;
  }
  if (clean !== raw) toast(t("proj.cleaned"), "info");
  if (current.path !== clean)
    update((x) => {
      if (x.projects[i]) x.projects[i].path = clean;
    });
  return clean;
}

/** Settles a draft whose field is gone (the tab or the window was left mid-typing). */
function commitPathDraft() {
  const d = pathDraft;
  if (!d) return;
  const i = draftRow();
  pathDraft = null;
  if (i >= 0) commitPath(i, d.value);
}

function projectsCard(): HTMLElement {
  const projects = settings().projects;
  const list = h("div", { class: "proj-list" });
  const drafted = draftRow();
  projects.forEach((p, i) => {
    const settle = (el: HTMLInputElement) => {
      const shown = commitPath(i, el.value);
      if (el.value !== shown) el.value = shown;
    };
    const pathIn = textInput({
      value: drafted === i && pathDraft ? pathDraft.value : p.path,
      mono: true,
      placeholder: t("proj.pathPh"),
      label: t("proj.pathAria"),
      fk: `proj-path:${i}`,
      onInput: (v) => {
        const from = pathDraft && draftRow() === i ? pathDraft.from : (settings().projects[i]?.path ?? p.path);
        pathDraft = { index: i, from, value: v };
      },
      onEnter: (_v, el) => settle(el),
    });
    // Leaving the field stores the path. A field a redraw took away was not
    // left by the user: Chromium fires its change as it goes, WebKit nothing at
    // all. So the store waits a turn and only counts a field still on the page;
    // the draft lives on in the field drawn in its place, whose own blur stores
    // it (its value was set by script, so it would fire no change). Nor is the
    // window losing focus a leave (the field keeps it: switching to a file
    // manager to look up the rest of the path must not trust "C:\Users\").
    const leave = () =>
      window.setTimeout(() => {
        if (pathIn.isConnected && document.activeElement !== pathIn) settle(pathIn);
      }, 0);
    pathIn.addEventListener("change", leave);
    pathIn.addEventListener("blur", leave);
    if (focusNewProject && i === projects.length - 1) {
      focusNewProject = false;
      window.setTimeout(() => pathIn.focus(), 0);
    }
    list.append(
      h(
        "div",
        { class: `proj-row mode-${p.mode}` },
        h(
          "div",
          { class: "proj-path" },
          // A picked folder is a finished path: stored at once, focus or not.
          iconButton(
            "folder",
            t("proj.pick"),
            () =>
              void pickInto(pathIn).then((picked) => {
                if (picked && pathIn.isConnected) settle(pathIn);
              }),
            { fk: `proj-pick:${i}` },
          ),
          pathIn,
        ),
        segmented(
          [
            ["trusted", t("policy.trusted")],
            ["normal", t("policy.normal")],
            ["strict", t("policy.strict")],
          ] as const,
          p.mode,
          (v) => {
            update((x) => (x.projects[i].mode = v));
            rerender("kurallar");
          },
          { fk: `proj-mode:${i}`, label: t("proj.trustAria"), cls: "seg-sm" },
        ),
        textInput({
          value: p.note,
          placeholder: t("proj.notePh"),
          label: t("proj.noteAria"),
          fk: `proj-note:${i}`,
          cls: "proj-note",
          onInput: (v) => update((x) => (x.projects[i].note = v)),
        }),
        iconButton(
          "trash",
          t("common.remove"),
          () => {
            // The row as it is now: saves replace the store's objects, so the
            // one this list was drawn from may be an older copy.
            const live = settings().projects[i];
            if (!live) return;
            // A path half-typed into the row being removed goes with it (Undo
            // brings back the row as it was stored).
            if (pathDraft && draftRow() === i) pathDraft = null;
            const removed: ProjectPolicy = { ...live };
            if (projectUndo) window.clearTimeout(projectUndo.timer);
            update((x) => x.projects.splice(i, 1));
            projectUndo = makeUndo(
              () => t("proj.removed", { path: removed.path || t("proj.unnamed") }),
              () => update((x) => x.projects.splice(Math.min(i, x.projects.length), 0, { ...removed })),
              () => (projectUndo = null),
            );
            refreshBadges();
            rerender("kurallar");
          },
          { cls: "danger", fk: `proj-del:${i}` },
        ),
      ),
    );
  });

  const known = new Set(projects.map((p) => p.path.trim().toLowerCase()));
  const suggestions = (recentFolders ?? []).filter((f) => !known.has(f.path.toLowerCase()));

  return card(
    {
      title: t("proj.title"),
      icon: "folder",
      desc: t("proj.desc"),
      actions: [
        button(t("proj.manual"), { kind: "subtle", small: true, fk: "proj:manual", onClick: () => addProject("") }),
        button(t("proj.addFolder"), {
          kind: "ghost",
          icon: "folder",
          fk: "proj:add",
          onClick: () => void pickProject(),
        }),
      ],
    },
    h(
      "div",
      { class: "mode-explain" },
      h(
        "div",
        { class: "me me-trusted" },
        h("strong", { text: t("policy.trusted") }),
        h("span", { text: t("proj.trustedText") }),
      ),
      h(
        "div",
        { class: "me me-normal" },
        h("strong", { text: t("policy.normal") }),
        h("span", { text: t("proj.normalText") }),
      ),
      h(
        "div",
        { class: "me me-strict" },
        h("strong", { text: t("policy.strict") }),
        h("span", { text: t("proj.strictText") }),
      ),
    ),
    projectUndo ? undoBar(projectUndo, () => (projectUndo = null)) : null,
    projects.length ? list : h("p", { class: "muted empty-line", text: t("proj.empty") }),
    suggestions.length
      ? h(
          "div",
          { class: "suggest" },
          h("span", { class: "muted", text: t("proj.suggest") }),
          ...suggestions.map((f) =>
            button(f.count ? `${folderName(f.path)} · ${f.count}` : folderName(f.path), {
              kind: "subtle",
              small: true,
              icon: "plus",
              title: f.count ? t("proj.suggestTitle", { path: f.path, n: f.count }) : f.path,
              onClick: () => addProject(f.path),
            }),
          ),
        )
      : null,
  );
}

// ── Deny reasons ──────────────────────────────────────────────────────────────

const MAX_REASONS = 12;

function reasonsCard(): HTMLElement {
  const reasons = settings().denyReasons;
  const list = h("div", { class: "reason-list" });
  reasons.forEach((r, i) => {
    const input = textInput({
      value: r,
      label: t("reasons.aria", { n: i + 1 }),
      fk: `reason:${i}`,
      onInput: (v) => {
        // An empty reason would be dropped by Rust mid-typing; wait for text.
        if (v.trim()) update((x) => (x.denyReasons[i] = v));
      },
      onChange: (v) => {
        if (!v.trim()) {
          update((x) => x.denyReasons.splice(i, 1));
          rerender("kurallar");
        }
      },
    });
    const mv = (d: -1 | 1) => {
      update((x) => {
        const j = i + d;
        if (j < 0 || j >= x.denyReasons.length) return;
        [x.denyReasons[i], x.denyReasons[j]] = [x.denyReasons[j], x.denyReasons[i]];
      });
      rerender("kurallar");
    };
    list.append(
      h(
        "div",
        { class: "reason-row" },
        h("span", { class: "rule-idx", text: String(i + 1) }),
        input,
        iconButton("up", t("common.up"), () => mv(-1), { disabled: i === 0, fk: `reason-up:${i}` }),
        iconButton("down", t("common.down"), () => mv(1), {
          disabled: i === reasons.length - 1,
          fk: `reason-down:${i}`,
        }),
        iconButton(
          "close",
          t("common.delete"),
          () => {
            update((x) => x.denyReasons.splice(i, 1));
            rerender("kurallar");
          },
          { cls: "danger", fk: `reason-del:${i}` },
        ),
      ),
    );
  });

  const full = reasons.length >= MAX_REASONS;
  const add = (el: HTMLInputElement) => {
    const v = el.value.trim();
    if (!v || settings().denyReasons.length >= MAX_REASONS) return;
    update((x) => x.denyReasons.push(v));
    el.value = "";
    rerender("kurallar");
  };
  const newIn = textInput({
    value: "",
    placeholder: full ? t("reasons.full") : t("reasons.newPh"),
    label: t("reasons.newAria"),
    fk: "reason:new",
    onEnter: (_v, el) => add(el),
  });
  newIn.disabled = full;

  return card(
    {
      title: t("reasons.title"),
      icon: "cross",
      desc: t("reasons.desc"),
      actions: [h("span", { class: `count-badge${full ? " warn" : ""}`, text: `${reasons.length}/${MAX_REASONS}` })],
    },
    list,
    h(
      "div",
      { class: "reason-add" },
      newIn,
      button(t("common.add"), { kind: "ghost", icon: "plus", disabled: full, onClick: () => add(newIn) }),
    ),
  );
}

function render(): HTMLElement {
  return h("div", { class: "tab-body" }, rulesCard(), projectsCard(), reasonsCard());
}

let devDone = false;

export const kurallarTab: Tab = {
  id: "kurallar",
  title: () => t("rules.title"),
  subtitle: () => t("rules.subtitle"),
  icon: "kurallar",
  render,
  // Leaving the tab (or the window, main.ts) mid-typing leaves the field too.
  onHide: commitPathDraft,
  onShow: () => {
    if (!recentFolders) void loadRecent();
    if (!devDone) {
      devDone = true;
      const edit = devParam("edit");
      if (edit != null) {
        window.setTimeout(() => {
          const rules = settings().rules;
          if (edit === "new") openEditor(newRule(), -1);
          else if (edit.startsWith("tpl"))
            openEditor({ ...newRule(), ...templates()[Number(edit.slice(3)) || 0].rule }, -1);
          else if (rules[Number(edit)]) openEditor(rules[Number(edit)], Number(edit));
        }, 150);
      }
    }
  },
};
