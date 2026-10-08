// Kurallar: ordered user rules (first match wins) with an editor and a live
// tester, per-project trust, and the ready-made deny reasons.

import type { Evaluation } from "../../core/bridge";
import { newRule, type ProjectPolicy, type RuleAction, type RuleMode, type UserRule } from "../../core/settings-model";
import { h } from "../../ui/dom";
import { api } from "../api";
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
const PROBE = "__nobetci_probe__";

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

function summary(r: UserRule): HTMLElement {
  const folder = r.project.trim();
  return h(
    "span",
    { class: "rule-sum" },
    h("span", { class: "rs-tool", text: toolText(r.tool) }),
    h("span", { class: "rs-sep", text: "·" }),
    r.pattern.trim()
      ? h(
          "span",
          {},
          h("span", { class: "rs-mode", text: `${t(`rules.sum.${r.mode}`)} ` }),
          h("code", { class: "rs-pat mono", text: `“${r.pattern}”` }),
        )
      : h("span", { class: "rs-mode", text: t("rules.everyRequest") }),
    folder
      ? h("span", { class: "rs-proj", title: folder }, icon("folder", 12), h("span", { text: folderName(folder) }))
      : null,
    h("span", { class: "rs-arrow", text: "→" }),
    actionBadge(r.action),
  );
}

/**
 * Why Rust's `regex` crate would reject `pattern`, as far as the browser can
 * tell: JS syntax errors, plus features JS accepts but Rust does not
 * (lookaround, backreferences). Rust-only inline flags like `(?i)` are fine.
 */
function regexError(pattern: string): string | null {
  if (/\(\?<?[=!]/.test(pattern)) return t("editor.regexLook");
  if (/\\[1-9]|\\k</.test(pattern)) return t("editor.regexBackref");
  try {
    new RegExp(pattern.replace(/\(\?[imsxU-]+\)/g, ""), "i");
    return null;
  } catch (err) {
    return err instanceof Error ? err.message.replace(/^Invalid regular expression: /, "") : String(err);
  }
}

/** Native folder picker that fills `input` (and fires its input handler). */
async function pickInto(input: HTMLInputElement): Promise<void> {
  const picked = await api.pickFolder(input.value.trim() || undefined);
  if (!picked) return;
  input.value = picked;
  input.dispatchEvent(new Event("input", { bubbles: true }));
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

function openEditor(original: UserRule, index: number) {
  const draft: UserRule = { ...original };
  const isNew = index < 0;
  const ceiling = settings().autoAllowMax;

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
  const patHint = h("span", { class: "field-hint" });

  const projIn = textInput({
    value: draft.project,
    mono: true,
    placeholder: t("editor.projectPh"),
    label: t("editor.project"),
    onInput: (v) => ((draft.project = v), changed()),
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
    placeholder: t("tester.defaultCwd"),
    label: t("tester.cwdAria"),
    onInput: (v) => ((test.cwd = v), runTest()),
  });
  const testOut = h("div", { class: "rule-test-out", "aria-live": "polite" });
  let seq = 0;

  const draftRules = (): UserRule[] => {
    const rules = settings().rules.map((r) => ({ ...r }));
    const clean = { ...draft, name: draft.name.trim() };
    if (isNew) rules.push(clean);
    else rules[index] = clean;
    return rules;
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
    const cwd = test.cwd.trim() || t("tester.defaultCwd");
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
      if (
        draft.project.trim() &&
        !cwd.toLowerCase().replace(/\\/g, "/").startsWith(draft.project.trim().toLowerCase().replace(/\\/g, "/"))
      )
        why.push(t("editor.whyFolder"));
      if (!why.length) why.push(t("editor.whyPattern"));
    }
    const selfName = draft.name.trim() || draft.pattern.trim();
    const earlier = matched && full.rule && full.rule !== selfName ? full.rule : null;
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
      earlier ? notice("warn", t("editor.earlier", { name: earlier })) : null,
      h("div", { class: "rt-caption", text: t("editor.result") }),
      evaluationView(full, { compact: true }),
    );
  };

  const changed = () => {
    // Pattern help and validation.
    patHint.classList.remove("bad");
    if (draft.mode === "regex" && draft.pattern.trim()) {
      const err = regexError(draft.pattern);
      if (err) {
        patHint.classList.add("bad");
        patHint.textContent = t("editor.regexBad", { err });
      } else patHint.textContent = t("editor.regexOk");
    } else if (draft.mode === "glob") patHint.textContent = t("editor.globHint");
    else if (!draft.pattern.trim()) patHint.textContent = t("editor.emptyPattern");
    else patHint.textContent = t("editor.patternHint");

    // Action notes.
    actionNote.replaceChildren();
    if (draft.action === "allow") {
      actionNote.append(
        ceiling === "none"
          ? notice("warn", t("editor.allowOff"))
          : notice("info", t("editor.allowCeiling", { ceiling: ceilingLabel(ceiling) })),
      );
      if (!draft.pattern.trim() && (!draft.tool.trim() || draft.tool.trim() === "*"))
        actionNote.append(notice("warn", t("editor.allowEverything")));
    } else if (draft.action === "low" || draft.action === "medium") {
      actionNote.append(notice("info", t("editor.rescoreNote")));
    } else if (draft.action === "deny") {
      actionNote.append(notice("info", t("editor.denyNote")));
    }
    msgField.hidden = draft.action !== "deny";
    saveBtn.disabled = draft.mode === "regex" && !!draft.pattern.trim() && !!regexError(draft.pattern);
    runTest();
  };

  const saveBtn = button(isNew ? t("editor.addRule") : t("common.save"), {
    kind: "primary",
    icon: "check",
    onClick: () => {
      const clean: UserRule = {
        ...draft,
        name: draft.name.trim(),
        tool: draft.tool.trim() || "*",
        project: draft.project.trim(),
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

function addProject(path: string, mode: ProjectPolicy["mode"] = "normal") {
  const clean = path.trim();
  if (clean && settings().projects.some((p) => p.path.trim().toLowerCase() === clean.toLowerCase())) {
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

function projectsCard(): HTMLElement {
  const projects = settings().projects;
  const list = h("div", { class: "proj-list" });
  projects.forEach((p, i) => {
    const pathIn = textInput({
      value: p.path,
      mono: true,
      placeholder: t("proj.pathPh"),
      label: t("proj.pathAria"),
      fk: `proj-path:${i}`,
      onInput: (v) => update((x) => (x.projects[i].path = v)),
    });
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
          iconButton("folder", t("proj.pick"), () => void pickInto(pathIn), { fk: `proj-pick:${i}` }),
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
            if (projectUndo) window.clearTimeout(projectUndo.timer);
            update((x) => x.projects.splice(i, 1));
            projectUndo = makeUndo(
              () => t("proj.removed", { path: p.path || t("proj.unnamed") }),
              () => update((x) => x.projects.splice(Math.min(i, x.projects.length), 0, p)),
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
