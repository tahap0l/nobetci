// Shared by the risk tester (Güvenlik) and the rule editor's mini tester: how a
// typed target becomes a tool input, and how an Evaluation is shown.

import type { Evaluation } from "../core/bridge";
import { h } from "../ui/dom";
import { byLabel, outcomeLabel, policyLabel } from "./data";
import { t } from "./i18n";
import { icon } from "./icons";
import { levelChip } from "./ui";

export const TESTER_TOOLS = ["Bash", "PowerShell", "Write", "Edit", "Read", "WebFetch", "mcp"] as const;
export type TesterTool = (typeof TESTER_TOOLS)[number];

/** Select label and input placeholder per tester tool, in the current language. */
export function toolHint(tool: TesterTool): { label: string; placeholder: string } {
  switch (tool) {
    case "Bash":
      return { label: "Bash", placeholder: t("tester.ph.bash") };
    case "PowerShell":
      return { label: "PowerShell", placeholder: "Remove-Item -Recurse -Force $env:USERPROFILE" };
    case "Write":
      return { label: t("tester.tool.write"), placeholder: t("tester.ph.write") };
    case "Edit":
      return { label: t("tester.tool.edit"), placeholder: "C:\\src\\app\\.github\\workflows\\ci.yml" };
    case "Read":
      return { label: t("tester.tool.read"), placeholder: t("tester.ph.read") };
    case "WebFetch":
      return { label: "WebFetch", placeholder: "https://webhook.site/abc" };
    case "mcp":
      return { label: t("tester.tool.mcp"), placeholder: '{"repo": "acme/app"}' };
  }
}

/** Builds the tool input the risk engine reads for `tool`. */
export function buildInput(tool: string, target: string): Record<string, unknown> {
  const name = tool.trim().toLowerCase();
  if (name === "write") return { file_path: target, content: "" };
  if (name === "edit" || name === "multiedit") return { file_path: target, old_string: "", new_string: "" };
  if (name === "notebookedit") return { notebook_path: target };
  if (name === "read" || name === "notebookread") return { file_path: target };
  if (name === "glob" || name === "grep" || name === "ls") return { path: target };
  if (name === "webfetch" || name === "websearch") return { url: target };
  if (name.startsWith("mcp__")) {
    try {
      const v: unknown = JSON.parse(target);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* not JSON: pass as text */
    }
    return target.trim() ? { input: target } : {};
  }
  return { command: target };
}

export function outcomeBadge(outcome: Evaluation["outcome"]): HTMLElement {
  const ic = outcome === "allow" ? "check" : outcome === "deny" ? "cross" : "hand";
  return h("span", { class: `outcome outcome-${outcome}` }, icon(ic, 15), outcomeLabel(outcome));
}

export function evaluationView(ev: Evaluation, opts: { compact?: boolean } = {}): HTMLElement {
  const a = ev.assessment;
  const facts = h("dl", { class: "kv kv-tight" });
  const fact = (k: string, v: Node | string | null) => {
    if (!v) return;
    facts.append(h("dt", { text: k }), h("dd", {}, v));
  };
  fact(t("tester.fact.rule"), ev.rule ? h("span", { class: "mono", text: ev.rule }) : null);
  fact(t("tester.fact.by"), ev.by ? byLabel(ev.by) : null);
  fact(t("tester.fact.note"), ev.note);
  fact(t("tester.fact.message"), ev.message ? h("span", { class: "verbatim", text: ev.message }) : null);
  fact(t("tester.fact.policy"), policyLabel(ev.policy));

  const findings = h("ul", { class: "findings" });
  if (a.findings.length) {
    for (const f of a.findings) {
      findings.append(
        h(
          "li",
          {},
          levelChip(f.level, true),
          h("span", { class: "f-label", text: f.label }),
          h("span", { class: "f-id mono", text: f.category }),
          f.excerpt ? h("code", { class: "f-excerpt mono", text: f.excerpt }) : null,
        ),
      );
    }
  } else {
    findings.append(h("li", { class: "f-none" }, h("span", { text: t("tester.noFindings") })));
  }

  return h(
    "div",
    { class: `eval${opts.compact ? " eval-compact" : ""}` },
    h(
      "div",
      { class: "eval-head" },
      outcomeBadge(ev.outcome),
      levelChip(a.level),
      h("span", { class: "eval-kind muted", text: kindLabel(a.kind) }),
      ev.outcome === "ask" && (a.level === "high" || a.level === "critical")
        ? h("span", { class: "eval-hold" }, icon("lock", 13), t("tester.holdHint"))
        : null,
    ),
    facts.childElementCount ? facts : null,
    findings,
  );
}

export function kindLabel(kind: string): string {
  switch (kind) {
    case "command":
    case "write":
    case "read":
    case "web":
    case "mcp":
    case "other":
      return t(`kind.${kind}`);
    default:
      return kind;
  }
}
