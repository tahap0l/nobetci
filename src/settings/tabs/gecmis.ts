// Geçmiş: history settings, stats with charts, and a filterable, paginated table
// of every permission decision with a detail drawer and export.
//
// Every string in an entry may have been chosen by a hostile prompt: it is only
// ever set as textContent.

import type { AuditEntry, AuditFilter, AuditPage, AuditStats, RiskLevel } from "../../core/bridge";
import { locale } from "../../i18n/core";
import { h } from "../../ui/dom";
import { api, errText } from "../api";
import { SERIES, dailyChart, dailyTable, legend, rankList, riskBar } from "../charts";
import { BY_KEYS, byLabel, decisionLabel } from "../data";
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

/** A message is either one of ours (re-translated on render) or Rust's own text. */
type Msg = { kind: "ok" | "error" | "info"; key?: MsgKey; vars?: Record<string, string>; raw?: string };

const st = {
  range: "30" as Range,
  stats: null as AuditStats | null,
  page: null as AuditPage | null,
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
  seq: 0,
};

/** Fallback project names (pages and top-6 stats) when auditProjects is unavailable. */
const knownProjects = new Set<string>();
/** Every project in the history with its count, busiest first. */
let allProjects: [string, number][] | null = null;

function since(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - Number(st.range) + 1);
  return d.getTime();
}

function currentFilter(): AuditFilter {
  const f = st.filter;
  return { text: f.text.trim(), level: f.level, decision: f.decision, by: f.by, project: f.project, since: since() };
}

async function loadAll() {
  const my = ++st.seq;
  st.loading = true;
  paintLoading();
  const [stats, page, projects] = await Promise.all([
    api.auditStats(Number(st.range)),
    api.auditQuery({ ...currentFilter(), limit: PAGE, offset: st.offset }),
    api.auditProjects(),
  ]);
  if (my !== st.seq) return;
  st.stats = stats;
  allProjects = projects;
  st.page = page;
  st.loading = false;
  st.stale = false;
  for (const [p] of stats?.topProjects ?? []) knownProjects.add(p);
  for (const e of page?.entries ?? []) if (e.project) knownProjects.add(e.project);
  rerender("gecmis");
  maybeDevDetail();
}

async function loadPage() {
  const my = ++st.seq;
  st.loading = true;
  paintLoading();
  const page = await api.auditQuery({ ...currentFilter(), limit: PAGE, offset: st.offset });
  if (my !== st.seq) return;
  st.page = page;
  st.loading = false;
  for (const e of page?.entries ?? []) if (e.project) knownProjects.add(e.project);
  rerender("gecmis");
}

const reloadSoon = debounce(() => void loadAll(), 400);
const searchSoon = debounce(() => {
  st.offset = 0;
  void loadPage();
}, 280);

function paintLoading() {
  document.querySelectorAll(".hist-live").forEach((el) => el.classList.toggle("loading", st.loading));
}

function msgView(m: Msg): HTMLElement {
  const text = m.key ? t(m.key, m.vars) : (m.raw ?? "");
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
  fact(t("hist.f.message"), e.message);
  fact(t("hist.f.duration"), e.ms ? fmtDuration(e.ms) : null);
  fact(t("hist.f.session"), e.session, true);
  fact(t("hist.f.id"), e.id, true);

  const labels = h("ul", { class: "findings" });
  for (const l of e.labels) labels.append(h("li", {}, h("span", { class: "f-label", text: l })));
  if (!e.labels.length) labels.append(h("li", { class: "f-none" }, h("span", { text: t("hist.noFindings") })));

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
        decisionChip(e.decision),
        h("span", { class: "muted", text: byLabel(e.by) }),
      ),
      h("div", { class: "target-head" }, h("span", { class: "field-label", text: t("hist.targetFull") }), copyBtn),
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
      card({ title: t("hist.topFindings"), icon: "warn" }, rankList(s?.topLabels ?? [], t("hist.noFindings"))),
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
  if (!page.entries.length)
    return h(
      "div",
      { class: "empty" },
      icon("gecmis", 26),
      h("strong", { text: t("hist.noMatch") }),
      h("span", { text: t("hist.noMatchText") }),
    );
  const tbody = h("tbody", {});
  page.entries.forEach((e: AuditEntry, i) => {
    const tr = h(
      "tr",
      { tabindex: "0", "data-fk": `hrow:${e.id}` },
      h("td", { class: "t-when", text: when(e.ts) }),
      h("td", { class: "t-proj", title: e.cwd, text: e.project || "—" }),
      h("td", {}, levelChip(asLevel(e.level), true)),
      h("td", {}, decisionChip(e.decision)),
      h("td", { class: "t-by", text: byLabel(e.by) }),
      h(
        "td",
        { class: "t-target", title: e.target.slice(0, 400) },
        h("span", { class: "t-tool", text: e.tool }),
        h("span", { class: "mono", text: e.target }),
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
            h("th", { text: t("hist.col.decision") }),
            h("th", { text: t("hist.col.by") }),
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
          void loadPage();
        },
      }),
    ),
  );
}

async function doExport(fmt: "csv" | "json") {
  try {
    const path = await api.auditExport(currentFilter(), fmt);
    st.exportMsg = path
      ? { kind: "ok", key: "common.savedPath", vars: { path } }
      : { kind: "info", key: "hist.exportCancelled" };
  } catch (err) {
    st.exportMsg = { kind: "error", raw: errText(err) };
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
    card(
      {
        title: t("hist.entries"),
        icon: "gecmis",
        desc: t("hist.entriesDesc"),
        actions: [
          button(t("hist.exportCsv"), {
            kind: "ghost",
            small: true,
            icon: "download",
            title: t("hist.exportCsvTitle"),
            onClick: () => void doExport("csv"),
          }),
          button("JSON", {
            kind: "ghost",
            small: true,
            icon: "download",
            title: t("hist.exportJsonTitle"),
            onClick: () => void doExport("json"),
          }),
        ],
      },
      st.exportMsg ? msgView(st.exportMsg) : null,
      filterBar(),
      h("div", { class: `hist-live${st.loading ? " loading" : ""}` }, table()),
    ),
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
        question: t("hist.clearQ"),
        confirmLabel: t("hist.clearYes"),
        onConfirm: async () => {
          try {
            await api.auditClear();
            st.offset = 0;
            st.exportMsg = { kind: "ok", key: "hist.cleared" };
            await loadAll();
          } catch (err) {
            st.exportMsg = { kind: "error", raw: errText(err) };
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
