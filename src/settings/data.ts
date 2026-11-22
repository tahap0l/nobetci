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
 * timeout, terminal, paused, busy, unseen, resolved — and undelivered, an answer
 * given here that never reached Claude Code (the request had already ended).
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
  "paused",
  "busy",
  "unseen",
  "resolved",
  "undelivered",
] as const;

export function byLabel(by: string): string {
  return (BY_KEYS as readonly string[]).includes(by) ? t(`by.${by}` as MsgKey) : by;
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
