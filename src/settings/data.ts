// Small shared caches for data several tabs show, and the labels for values that
// come from Rust (outcome, who decided, policy, decision).

import type { CategoryInfo, Evaluation } from "../core/bridge";
import { api, type HookStatus } from "./api";
import { t, type MsgKey } from "./i18n";

export const cache: {
  hookStatus: HookStatus | null;
  hookStatusLoaded: boolean;
  categories: CategoryInfo[] | null;
} = { hookStatus: null, hookStatusLoaded: false, categories: null };

export async function loadHookStatus(): Promise<HookStatus | null> {
  cache.hookStatus = await api.hooksStatus();
  cache.hookStatusLoaded = true;
  return cache.hookStatus;
}

export async function loadCategories(): Promise<CategoryInfo[]> {
  if (!cache.categories) cache.categories = (await api.riskCategories()) ?? [];
  return cache.categories;
}

export function outcomeLabel(o: Evaluation["outcome"]): string {
  return t(`outcome.${o}`);
}

/**
 * Who decided (audit.rs `by`): user, hotkey, batch, rule, trusted, session,
 * timeout, terminal, paused, busy, unseen, resolved — undelivered, an answer
 * given here that never reached Claude Code (the request had already ended) —
 * and, for a request handed back or left undecided, what took it over instead
 * of the terminal: Cursor's own prompt or the Claude app's dialog (pipe.rs
 * `host_of`).
 */
export const BY_KEYS = [
  "user",
  "hotkey",
  "batch",
  "rule",
  "trusted",
  "session",
  "timeout",
  "terminal",
  "cursor",
  "app",
  "paused",
  "busy",
  "unseen",
  "resolved",
  "undelivered",
] as const;

export function byLabel(by: string): string {
  return (BY_KEYS as readonly string[]).includes(by) ? t(`by.${by}` as MsgKey) : by;
}

/**
 * A finding's name in the UI language (C-24): by its category id through
 * `risk_categories` when the history recorded one, else the label as it was
 * recorded (in the language of that day). An id the engine no longer knows
 * keeps its recorded label too.
 */
export function findingLabel(category: string | undefined, recorded: string): string {
  if (!category) return recorded;
  return cache.categories?.find((c) => c.id === category)?.label ?? (recorded || category);
}

/**
 * Every finding of a history entry, named in the UI language where it can be,
 * each once (as audit.rs `findings_now` counts them). The ids are used only when
 * there is one per label, in the labels' order.
 */
export function findingLabels(e: { labels: string[]; categories?: string[] }): string[] {
  const ids = e.categories && e.categories.length === e.labels.length ? e.categories : null;
  const out: string[] = [];
  e.labels.forEach((recorded, i) => {
    const name = findingLabel(ids?.[i], recorded);
    if (!out.includes(name)) out.push(name);
  });
  return out;
}

export function policyLabel(p: string): string {
  return p === "trusted" || p === "normal" || p === "strict" ? t(`policy.${p}`) : p;
}

export function decisionLabel(d: string): string {
  return d === "allow" || d === "deny" || d === "none" ? t(`decision.${d}`) : d;
}

export function ceilingLabel(c: "none" | "low" | "medium"): string {
  return t(`ceiling.${c}`);
}
