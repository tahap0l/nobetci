// Geçmiş: history settings, stats with charts, and a filterable, paginated table
// of every permission decision with a detail drawer and export.
//
// Every string in an entry may have been chosen by a hostile prompt: it is only
// ever set as textContent.

import type { AuditFilter, AuditStats, RiskLevel } from "../../core/bridge";
import { locale } from "../../i18n/core";
import { h } from "../../ui/dom";
import { api, errText, type CsvSeparator, type HistoryEntry, type HistoryPage } from "../api";
import { SERIES, dailyChart, dailyTable, legend, rankList, riskBar } from "../charts";
import { BY_KEYS, byLabel, cache, decisionLabel, findingLabel, findingLabels, loadCategories } from "../data";
import { countedFrom, localDayStarts } from "../days";
import { t, type MsgKey } from "../i18n";
import { icon } from "../icons";
import { currentTab, devParam, rerender, type Tab } from "../nav";
import { settings, update } from "../store";
import { kindLabel } from "../tester";
import {
  button,
  card,
  debounce,
  fmtDuration,
  fmtNum,
  fmtPct,
  iconButton,
  inlineConfirm,
  levelChip,
  levelLabel,
  notice,
  pushLayer,
  row,
  segmented,
  select,
  slider,
  textInput,
  toggle,
} from "../ui";

const PAGE = 50;

type Range = "7" | "30" | "90";

/** A message is either one of ours or a Rust error, both put in words on render (so a language switch follows). */
type Msg = { kind: "ok" | "error" | "info"; key?: MsgKey; vars?: Record<string, string>; err?: unknown };

const SEP_KEY = "nobi.settings.csvSeparator";

function storedSeparator(): CsvSeparator {
  try {
    return localStorage.getItem(SEP_KEY) === ";" ? ";" : ",";
  } catch {
    return ",";
  }
}

const st = {
  range: "30" as Range,
  stats: null as AuditStats | null,
  page: null as HistoryPage | null,
  loading: false,
  filter: {
    text: "",
    level: "" as "" | RiskLevel,
    decision: "" as "" | "allow" | "deny" | "none",
    by: "",
    project: "",
  },
  offset: 0,
  showTable: false,
  exportMsg: null as Msg | null,
  stale: true,
  // Stats and pages load on their own counters: a page asked for while the
  // stats are still loading must not throw the stats away.
  statsSeq: 0,
  pageSeq: 0,
  /** The whole history (any range) is empty: asked only when a page with no filter comes back empty. */
  historyEmpty: null as boolean | null,
  /** The next page lands with its first rows in view (the pager sits at the bottom). */
  scrollToEntries: false,
  separator: storedSeparator(),
};

/** Fallback project names (pages and top-6 stats) when auditProjects is unavailable. */
const knownProjects = new Set<string>();
/** Every project in the history with its count, busiest first. */
let allProjects: [string, number][] | null = null;

/**
 * The range's day boundaries for audit_stats (C-18: the real local midnights,
 * so a day before a daylight-saving change keeps its own hours) and where the
 * list starts: the first instant audit_stats counts. The entries listed are
 * then exactly the ones counted.
 */
function rangeBounds(): { starts: number[]; since: number } {
  const days = Number(st.range);
  const starts = localDayStarts(days);
  return { starts, since: countedFrom(starts, days, new Date().getTimezoneOffset()) };
}

function filterActive(): boolean {
  const f = st.filter;
  return !!(f.text.trim() || f.level || f.decision || f.by || f.project);
}

function currentFilter(since = rangeBounds().since): AuditFilter {
  const f = st.filter;
  return { text: f.text.trim(), level: f.level, decision: f.decision, by: f.by, project: f.project, since };
}

/** An empty page with no filter: is the history empty, or only this range? */
async function checkEmpty(page: HistoryPage | null) {
  if (!page) return;
  if (page.total > 0) st.historyEmpty = false;
  else if (!filterActive()) st.historyEmpty = ((await api.auditQuery({ limit: 1 }))?.total ?? 1) === 0;
}

/** Stats, the current page and (unless only a new decision came in) the project list. */
async function loadAll(withProjects = true) {
  const my = ++st.statsSeq;
  const myPage = ++st.pageSeq;
  st.loading = true;
  paintLoading();
  // One set of boundaries for both, so the list and the totals agree.
  const { starts, since } = rangeBounds();
  const [stats, page, projects] = await Promise.all([
    api.auditStats(Number(st.range), starts),
    api.auditQuery({ ...currentFilter(since), limit: PAGE, offset: st.offset }),
    withProjects || !allProjects ? api.auditProjects() : Promise.resolve(allProjects),
    // Findings are named by their category in the UI language (C-24).
    loadCategories(),
  ]);
  if (my !== st.statsSeq) return;
  st.stats = stats;
  allProjects = projects;
  st.stale = false;
  for (const [p] of stats?.topProjects ?? []) knownProjects.add(p);
  // A page asked for meanwhile (a filter, the search) is newer than this one.
  if (myPage === st.pageSeq) {
    await checkEmpty(page);
    if (myPage !== st.pageSeq) return;
    st.page = page;
    st.loading = false;
    for (const e of page?.entries ?? []) if (e.project) knownProjects.add(e.project);
  }
  rerender("gecmis");
  maybeDevDetail();
}

async function loadPage() {
  const my = ++st.pageSeq;
  st.loading = true;
  paintLoading();
  const page = await api.auditQuery({ ...currentFilter(), limit: PAGE, offset: st.offset });
  if (my !== st.pageSeq) return;
  await checkEmpty(page);
  if (my !== st.pageSeq) return;
  st.page = page;
  st.loading = false;
  for (const e of page?.entries ?? []) if (e.project) knownProjects.add(e.project);
  rerender("gecmis");
  if (st.scrollToEntries) {
    st.scrollToEntries = false;
    document.querySelector<HTMLElement>("[data-hist-entries]")?.scrollIntoView({ block: "start" });
  }
}

// A new decision changes the stats and the page; the project list can wait for
// the next time the tab is shown (one full read of the log fewer per decision).
const reloadSoon = debounce(() => void loadAll(false), 400);
const searchSoon = debounce(() => {
  st.offset = 0;
  void loadPage();
}, 280);

function paintLoading() {
  document.querySelectorAll(".hist-live").forEach((el) => el.classList.toggle("loading", st.loading));
}

function msgView(m: Msg): HTMLElement {
  const text = m.key ? t(m.key, m.vars) : errText(m.err);
  return notice(m.kind, h("span", { class: "verbatim", text }));
}

// ── Formatting ────────────────────────────────────────────────────────────────

function when(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" });
  const dayDiff = Math.round(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86_400_000,
  );
  if (dayDiff === 0) return t("hist.today", { time });
  if (dayDiff === 1) return t("hist.yesterday", { time });
  return `${d.toLocaleDateString(locale(), { day: "numeric", month: "short" })} ${time}`;
}

function fullWhen(ts: number): string {
  return new Date(ts).toLocaleString(locale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function decisionChip(d: string): HTMLElement {
  const s = SERIES.find((x) => x.key === d);
  return h(
    "span",
    { class: `dec dec-${d}` },
    h("span", { class: "dec-dot", style: `background:${s?.color ?? "#74747f"}` }),
    decisionLabel(d),
  );
}

function asLevel(l: string): RiskLevel {
  return l === "medium" || l === "high" || l === "critical" ? l : "low";
}

const RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/** The risk engine's own level when a rule changed it (C-22), else null. */
function engineOf(e: HistoryEntry): RiskLevel | null {
  if (!e.engineLevel) return null;
  const engine = asLevel(e.engineLevel);
  return engine === asLevel(e.level) ? null : engine;
}

function engineTitle(e: HistoryEntry, engine: RiskLevel): string {
  return t("hist.engineLevelTitle", { engine: levelLabel(engine), level: levelLabel(asLevel(e.level)) });
}

/**
 * The tool as the table names it. An MCP tool reads "server › tool" (the
 * island's wording) instead of `mcp__server__tool`, and when even that is too
 * long for its half of the cell the server's name gives way before the tool's.
 */
function toolChip(tool: string): HTMLElement {
  if (!tool.startsWith("mcp__")) return h("span", { class: "t-tool", text: tool });
  const rest = tool.slice(5);
  const cut = rest.indexOf("__");
  const server = cut < 0 ? rest : rest.slice(0, cut);
  const name = cut < 0 ? "" : rest.slice(cut + 2) || "?";
  return h(
    "span",
    { class: "t-tool t-mcp" },
    h("span", { class: "t-srv", text: server }),
    name ? h("span", { class: "t-act", text: ` › ${name}` }) : null,
  );
}

/**
 * Top findings in the UI language (C-24). Rust names each finding it can by its
 * category in the language of the day; an id that comes through as it is gets
 * its label here, and labels that turn out the same are counted together.
 */
function topFindings(s: AuditStats | null): [string, number][] {
  const merged = new Map<string, number>();
  for (const [key, n] of s?.topLabels ?? []) {
    const id = cache.categories?.some((c) => c.id === key) ? key : undefined;
    const label = findingLabel(id, key);
    merged.set(label, (merged.get(label) ?? 0) + n);
  }
  return [...merged.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], locale()));
}

/** Rust's note that stands in for a missing target, or "". Only a request too
 *  large to read (pipe.rs `too_long`) has one: it was never scored, so it has no
 *  kind and no target, and with no answer (decision none) its message is
 *  Nobi's note on why. Any other message is what Claude was told, or a note
 *  on the decision, never a target: only the drawer shows it, under its label. */
function oversizeNote(e: HistoryEntry): string {
  return !e.target && !e.kind && e.decision === "none" ? e.message : "";
}

// ── Detail drawer ─────────────────────────────────────────────────────────────

let closeDrawer: (() => void) | null = null;

function openDetail(index: number) {
  const entries = st.page?.entries ?? [];
  const e = entries[index];
  if (!e) return;
  closeDrawer?.();

  const copyBtn = button(t("hist.copy"), {
    kind: "subtle",
    small: true,
    icon: "copy",
    // No target (a request too large to read, or one sent with no arguments):
    // nothing to copy.
    disabled: !e.target,
    onClick: async () => {
      try {
        await navigator.clipboard.writeText(e.target);
        copyBtn.querySelector("span")!.textContent = t("hist.copied");
      } catch {
        copyBtn.querySelector("span")!.textContent = t("hist.copyFailed");
      }
    },
  });

  const facts = h("dl", { class: "kv" });
  const fact = (k: string, v: string | Node | null | undefined, mono = false) => {
    if (v == null || v === "") return;
    facts.append(
      h("dt", { text: k }),
      h("dd", {}, typeof v === "string" ? h("span", { class: mono ? "mono sel" : "sel", text: v }) : v),
    );
  };
  fact(t("hist.f.time"), fullWhen(e.ts));
  fact(t("hist.f.project"), e.project);
  fact(t("hist.f.folder"), e.cwd, true);
  fact(t("hist.f.tool"), e.tool, true);
  fact(t("hist.f.kind"), kindLabel(e.kind));
  fact(t("hist.f.by"), byLabel(e.by));
  fact(t("hist.f.rule"), e.rule, true);
  // With no answer delivered (timed out, handed to the terminal, too large,
  // undelivered…) Claude was told nothing: the text is Nobi's note on why.
  fact(e.decision === "none" ? t("hist.f.note") : t("hist.f.message"), e.message);
  fact(t("hist.f.duration"), e.ms ? fmtDuration(e.ms) : null);
  fact(t("hist.f.session"), e.session, true);
  fact(t("hist.f.id"), e.id, true);

  // Named in the UI language where the entry kept its finding ids (C-24); older
  // entries keep the words of the day they were recorded.
  const names = findingLabels(e);
  const labels = h("ul", { class: "findings" });
  for (const l of names) labels.append(h("li", {}, h("span", { class: "f-label", text: l })));
  if (!names.length) labels.append(h("li", { class: "f-none" }, h("span", { text: t("hist.noFindings") })));
  const engine = engineOf(e);

  const prev = iconButton("left", t("hist.prev"), () => openDetail(index - 1), { disabled: index === 0 });
  const next = iconButton("right", t("hist.next"), () => openDetail(index + 1), {
    disabled: index >= entries.length - 1,
  });

  const panel = h(
    "aside",
    { class: "drawer", role: "dialog", "aria-modal": "true", "aria-label": t("hist.detail") },
    h(
      "div",
      { class: "drawer-head" },
      h(
        "div",
        {},
        h("h2", { class: "modal-title", text: t("hist.detail") }),
        h("p", { class: "modal-sub", text: when(e.ts) }),
      ),
      h(
        "div",
        { class: "drawer-nav" },
        prev,
        next,
        iconButton("close", t("common.closeEsc"), () => close(), { cls: "modal-x" }),
      ),
    ),
    h(
      "div",
      { class: "drawer-body" },
      h(
        "div",
        { class: "eval-head" },
        levelChip(asLevel(e.level)),
        // A rule changed the level: what the risk engine itself found (C-22).
        engine
          ? h(
              "span",
              { class: "engine-level", title: engineTitle(e, engine) },
              h("span", { class: "muted", text: t("hist.engineLevel") }),
              levelChip(engine, true),
            )
          : null,
        decisionChip(e.decision),
        h("span", { class: "muted", text: byLabel(e.by) }),
      ),
      h("div", { class: "target-head" }, h("span", { class: "field-label", text: t("hist.targetFull") }), copyBtn),
      // The drawer body scrolls; the full target, the point of the drawer, is
      // never the part that gives way (.target-full does not shrink).
      h("pre", { class: "target-full mono", tabindex: "0", text: e.target || "—" }),
      h("div", { class: "field-label", text: t("hist.findings") }),
      labels,
      facts,
    ),
  );
  const overlay = h("div", { class: "drawer-overlay" }, panel);
  overlay.addEventListener("mousedown", (ev) => {
    if (ev.target === overlay) close();
  });
  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    pop();
    closeDrawer = null;
    overlay.classList.add("leaving");
    window.setTimeout(() => overlay.remove(), 140);
  };
  const pop = pushLayer(close);
  closeDrawer = close;
  document.body.append(overlay);
  panel.querySelector<HTMLElement>(".modal-x")?.focus();
}

let devDetailDone = false;
function maybeDevDetail() {
  const d = devParam("detail");
  if (d == null || devDetailDone) return;
  devDetailDone = true;
  window.setTimeout(() => openDetail(Number(d) || 0), 50);
}

// ── Sections ──────────────────────────────────────────────────────────────────

function kpis(s: AuditStats | null): HTMLElement {
  const tile = (label: string, value: string, sub: string, key?: string) =>
    h(
      "div",
      { class: "kpi" },
      h(
        "span",
        { class: "kpi-label" },
        key ? h("span", { class: "kpi-key", style: `background:${key}` }) : null,
        label,
      ),
      h("span", { class: "kpi-value", text: value }),
      h("span", { class: "kpi-sub", text: sub }),
    );
  const labels = [
    t("hist.kpi.total"),
    t("hist.kpi.allowed"),
    t("hist.kpi.denied"),
    t("hist.kpi.none"),
    t("hist.kpi.auto"),
    t("hist.kpi.median"),
  ];
  if (!s) return h("div", { class: "kpi-grid" }, ...labels.map((l) => tile(l, "—", " ")));
  return h(
    "div",
    { class: "kpi-grid" },
    tile(labels[0], fmtNum(s.total), t("hist.kpi.lastDays", { n: st.range })),
    tile(labels[1], fmtNum(s.allowed), fmtPct(s.allowed, s.total), SERIES[0].color),
    tile(labels[2], fmtNum(s.denied), fmtPct(s.denied, s.total), SERIES[1].color),
    tile(labels[3], fmtNum(s.unanswered), fmtPct(s.unanswered, s.total), SERIES[2].color),
    tile(labels[4], fmtNum(s.automatic), t("hist.kpi.withoutYou", { pct: fmtPct(s.automatic, s.total) })),
    tile(labels[5], s.medianMs ? fmtDuration(s.medianMs) : "—", t("hist.kpi.yourDecisions")),
  );
}

function statsSection(): HTMLElement {
  const s = st.stats;
  const chartHost = h("div", { class: "chart-host" });
  const hasData = !!s && s.total > 0;
  if (hasData) window.setTimeout(() => dailyChart(chartHost, s.days), 0);
  const tableToggle = button(st.showTable ? t("hist.showChart") : t("hist.showTable"), {
    kind: "subtle",
    small: true,
    icon: st.showTable ? "chart" : "kurallar",
    onClick: () => {
      st.showTable = !st.showTable;
      rerender("gecmis");
    },
  });
  return h(
    "div",
    { class: "hist-live" },
    kpis(s),
    card(
      { title: t("hist.daily"), icon: "chart", actions: hasData ? [legend(), tableToggle] : [] },
      !s
        ? h("p", { class: "muted empty-line", text: t("common.loading") })
        : !hasData
          ? h("p", { class: "muted empty-line", text: t("hist.noData") })
          : st.showTable
            ? dailyTable(s.days)
            : chartHost,
    ),
    h(
      "div",
      { class: "stat-grid" },
      card(
        { title: t("hist.riskMix"), icon: "guvenlik", cls: "span-all" },
        s ? riskBar(s) : h("p", { class: "muted", text: "…" }),
      ),
      card({ title: t("hist.projects"), icon: "folder" }, rankList(s?.topProjects ?? [], t("hist.noRecords"))),
      card({ title: t("hist.topFindings"), icon: "warn" }, rankList(topFindings(s), t("hist.noFindings"))),
      card({ title: t("hist.tools"), icon: "claude" }, rankList(s?.topTools ?? [], t("hist.noRecords"), true)),
    ),
  );
}

function filterBar(): HTMLElement {
  const f = st.filter;
  const refilter = () => {
    st.offset = 0;
    void loadPage();
  };
  const search = h(
    "div",
    { class: "search grow" },
    icon("search", 15),
    textInput({
      value: f.text,
      placeholder: t("hist.searchPh"),
      fk: "histSearch",
      label: t("hist.searchAria"),
      onInput: (v) => {
        f.text = v;
        searchSoon();
      },
    }),
  );
  const projects: (readonly [string, string])[] = allProjects
    ? allProjects.map(([p, n]) => [p, `${p} (${fmtNum(n)})`] as const)
    : [...knownProjects].sort((a, b) => a.localeCompare(b, locale())).map((p) => [p, p] as const);
  if (f.project && !projects.some(([p]) => p === f.project)) projects.unshift([f.project, f.project]);
  const active = !!(f.text || f.level || f.decision || f.by || f.project);
  return h(
    "div",
    { class: "filter-bar" },
    search,
    h(
      "div",
      { class: "filter-selects" },
      select(
        [
          ["", t("hist.anyLevel")],
          ["medium", t("hist.minMedium")],
          ["high", t("hist.minHigh")],
          ["critical", t("hist.onlyCritical")],
        ] as const,
        f.level,
        (v) => ((f.level = v), refilter()),
        { fk: "fLevel", label: t("hist.minLevelAria") },
      ),
      select(
        [
          ["", t("hist.anyDecision")],
          ["allow", decisionLabel("allow")],
          ["deny", decisionLabel("deny")],
          ["none", decisionLabel("none")],
        ] as const,
        f.decision,
        (v) => ((f.decision = v), refilter()),
        { fk: "fDecision", label: t("hist.decisionAria") },
      ),
      select(
        [["", t("hist.anyBy")] as const, ...BY_KEYS.map((k) => [k, byLabel(k)] as const)],
        f.by,
        (v) => ((f.by = v), refilter()),
        { fk: "fBy", label: t("hist.byAria") },
      ),
      select([["", t("hist.anyProject")] as const, ...projects], f.project, (v) => ((f.project = v), refilter()), {
        fk: "fProject",
        label: t("hist.projectAria"),
      }),
      active
        ? button(t("hist.reset"), {
            kind: "subtle",
            small: true,
            icon: "reset",
            onClick: () => {
              st.filter = { text: "", level: "", decision: "", by: "", project: "" };
              refilter();
            },
          })
        : null,
    ),
  );
}

function table(): HTMLElement {
  const page = st.page;
  if (!page)
    return h("p", { class: "muted empty-line", text: st.loading ? t("common.loading") : t("hist.readFailed") });
  if (!page.entries.length) {
    // Say why there is nothing: filters, the range, or an empty history.
    const [title, text]: [MsgKey, MsgKey] = filterActive()
      ? ["hist.noMatch", "hist.noMatchText"]
      : st.historyEmpty
        ? settings().auditEnabled
          ? ["hist.emptyTitle", "hist.emptyText"]
          : ["hist.offTitle", "hist.offText"]
        : ["hist.noRangeTitle", "hist.noRangeText"];
    return h(
      "div",
      { class: "empty" },
      icon("gecmis", 26),
      h("strong", { text: t(title) }),
      h("span", { text: t(text) }),
    );
  }
  const tbody = h("tbody", {});
  page.entries.forEach((e: HistoryEntry, i) => {
    const note = oversizeNote(e);
    const level = asLevel(e.level);
    const engine = engineOf(e);
    const by = byLabel(e.by);
    // The whole tool name and target on hover; the cell shows what fits.
    const full = [e.tool, (e.target || note).slice(0, 400)].filter(Boolean).join("\n");
    const tr = h(
      "tr",
      { tabindex: "0", "data-fk": `hrow:${e.id}` },
      h("td", { class: "t-when", title: fullWhen(e.ts), text: when(e.ts) }),
      h("td", { class: "t-proj", title: e.cwd, text: e.project || "—" }),
      // A rule moved the level: an arrow says which way, the title from what (C-22).
      h(
        "td",
        { class: "t-risk", title: engine ? engineTitle(e, engine) : undefined },
        levelChip(level, true),
        engine
          ? h("span", {
              class: "t-moved",
              role: "img",
              text: RANK[level] < RANK[engine] ? "↓" : "↑",
              "aria-label": engineTitle(e, engine),
            })
          : null,
      ),
      // Who decided rides with the decision: the target gets the room (and the
      // columns stay the same below 920 px, where only the "by" part gives way).
      h(
        "td",
        { class: "t-dec", title: `${decisionLabel(e.decision)} · ${by}` },
        decisionChip(e.decision),
        h("span", { class: "t-by", text: by }),
      ),
      // The target; for a request too large to read, Rust's note on why there is
      // none. A message to Claude never shows here (see oversizeNote).
      h(
        "td",
        { class: "t-target", title: full || undefined },
        e.tool ? toolChip(e.tool) : null,
        e.target
          ? h("span", { class: "mono", text: e.target })
          : note
            ? h("span", { class: "t-note", text: note })
            : h("span", { class: "muted", text: "—" }),
      ),
    );
    tr.addEventListener("click", () => openDetail(i));
    tr.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        openDetail(i);
      }
    });
    tbody.append(tr);
  });
  const from = st.offset + 1;
  const to = st.offset + page.entries.length;
  return h(
    "div",
    {},
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        { class: "hist-table" },
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", { text: t("hist.col.time") }),
            h("th", { text: t("hist.col.project") }),
            h("th", { text: t("hist.col.risk") }),
            h("th", { text: t("hist.col.decisionBy") }),
            h("th", { text: t("hist.col.target") }),
          ),
        ),
        tbody,
      ),
    ),
    h(
      "div",
      { class: "pager" },
      h("span", {
        class: "muted",
        text: t("hist.pager", { from: fmtNum(from), to: fmtNum(to), total: fmtNum(page.total) }),
      }),
      h("span", { class: "spacer" }),
      button(t("hist.prevPage"), {
        kind: "subtle",
        small: true,
        icon: "left",
        disabled: st.offset === 0,
        fk: "pg:prev",
        onClick: () => {
          st.offset = Math.max(0, st.offset - PAGE);
          st.scrollToEntries = true;
          void loadPage();
        },
      }),
      button(t("hist.nextPage"), {
        kind: "subtle",
        small: true,
        icon: "right",
        disabled: to >= page.total,
        fk: "pg:next",
        onClick: () => {
          st.offset += PAGE;
          st.scrollToEntries = true;
          void loadPage();
        },
      }),
    ),
  );
}

function entriesCard(): HTMLElement {
  // Nothing matches: there is nothing to export either.
  const none = st.page?.total === 0;
  const sep = select(
    [
      [",", t("hist.sepComma")],
      [";", t("hist.sepSemicolon")],
    ] as const,
    st.separator,
    (v) => {
      st.separator = v;
      try {
        localStorage.setItem(SEP_KEY, v);
      } catch {
        /* storage unavailable: the choice lasts until the window closes */
      }
    },
    // Sized like the small export buttons next to it.
    { fk: "csvSep", label: t("hist.sepAria"), cls: "select-sm" },
  );
  sep.title = t("hist.sepTitle");
  const entries = card(
    {
      title: t("hist.entries"),
      icon: "gecmis",
      desc: t("hist.entriesDesc"),
      actions: [
        sep,
        button(t("hist.exportCsv"), {
          kind: "ghost",
          small: true,
          icon: "download",
          title: t("hist.exportCsvTitle"),
          disabled: none,
          onClick: () => void doExport("csv"),
        }),
        button("JSON", {
          kind: "ghost",
          small: true,
          icon: "download",
          title: t("hist.exportJsonTitle"),
          disabled: none,
          onClick: () => void doExport("json"),
        }),
      ],
    },
    st.exportMsg ? msgView(st.exportMsg) : null,
    filterBar(),
    h("div", { class: `hist-live${st.loading ? " loading" : ""}` }, table()),
  );
  entries.setAttribute("data-hist-entries", "");
  return entries;
}

async function doExport(fmt: "csv" | "json") {
  try {
    const path = await api.auditExport(currentFilter(), fmt, st.separator);
    st.exportMsg = path
      ? { kind: "ok", key: "common.savedPath", vars: { path } }
      : { kind: "info", key: "hist.exportCancelled" };
  } catch (err) {
    st.exportMsg = { kind: "error", err };
  }
  rerender("gecmis");
}

function render(): HTMLElement {
  const s = settings();
  return h(
    "div",
    { class: "tab-body" },
    card(
      {
        title: t("hist.recording"),
        icon: "file",
        desc: t("hist.recordingDesc"),
        actions: [
          button(t("hist.showFile"), {
            kind: "subtle",
            small: true,
            icon: "folder",
            onClick: () => void api.openLocation("audit"),
          }),
        ],
      },
      row(
        t("hist.keep"),
        s.auditEnabled ? null : t("hist.keepOff"),
        toggle(
          s.auditEnabled,
          (v) => {
            update((x) => (x.auditEnabled = v));
            rerender("gecmis");
          },
          { label: t("hist.keep"), fk: "auditEnabled" },
        ),
      ),
      row(
        t("hist.maxSize"),
        t("hist.maxSizeHint"),
        slider({
          value: s.auditMaxMb,
          min: 1,
          max: 200,
          step: 1,
          format: (v) => t("unit.mb", { n: v }),
          onChange: (v) => update((x) => (x.auditMaxMb = v)),
          fk: "auditMaxMb",
          label: t("hist.maxSize"),
          ends: true,
        }),
      ),
    ),
    h(
      "div",
      { class: "range-bar" },
      h("span", { class: "range-label", text: t("hist.range") }),
      segmented(
        [
          ["7", t("hist.range7")],
          ["30", t("hist.range30")],
          ["90", t("hist.range90")],
        ] as const,
        st.range,
        (v) => {
          st.range = v;
          st.offset = 0;
          void loadAll();
        },
        { fk: "range", label: t("hist.range") },
      ),
      h("span", { class: "range-note muted", text: t("hist.rangeNote") }),
    ),
    statsSection(),
    entriesCard(),
    h(
      "div",
      { class: "danger-zone" },
      h(
        "div",
        { class: "row-text" },
        h("div", { class: "row-label", text: t("hist.clear") }),
        h("div", { class: "row-hint", text: t("hist.clearHint") }),
      ),
      inlineConfirm({
        label: t("hist.clearBtn"),
        icon: "trash",
        disabled: st.historyEmpty === true,
        question: t("hist.clearQ"),
        confirmLabel: t("hist.clearYes"),
        onConfirm: async () => {
          try {
            await api.auditClear();
            st.offset = 0;
            st.exportMsg = { kind: "ok", key: "hist.cleared" };
            await loadAll();
          } catch (err) {
            st.exportMsg = { kind: "error", err };
            rerender("gecmis");
          }
        },
      }),
    ),
  );
}

export function historyChanged() {
  if (currentTab() === "gecmis" && document.visibilityState === "visible") reloadSoon();
  else st.stale = true;
}

export const gecmisTab: Tab = {
  id: "gecmis",
  title: () => t("hist.title"),
  subtitle: () => t("hist.subtitle"),
  icon: "gecmis",
  render,
  onShow: () => {
    const q = devParam("q");
    if (q && !st.stats) st.filter.text = q;
    if (st.stale || !st.stats) void loadAll();
  },
  onHide: () => closeDrawer?.(),
  onLang: () => {
    st.stale = true;
    closeDrawer?.();
  },
};
