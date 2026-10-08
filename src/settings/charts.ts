// History charts in inline SVG: a stacked daily bar chart (allow / deny / none)
// and a risk distribution bar. Labels are text nodes; nothing is parsed.
//
// Colours: allow and deny take categorical slots 1–2 (blue, orange — validated
// on the #141418 card surface: CVD ΔE 26.8, contrast ≥ 4.7:1). "No answer" is a
// deliberate neutral gray (nobody decided), separated from both by ΔE ≥ 12.6.
// Risk levels keep the island's status colours and always carry a text label.

import type { AuditStats, RiskLevel } from "../core/bridge";
import { locale } from "../i18n/core";
import { h } from "../ui/dom";
import { decisionLabel } from "./data";
import { t, tn } from "./i18n";
import { fmtNum, fmtPct, hideTip, levelLabel, showTip } from "./ui";

const NS = "http://www.w3.org/2000/svg";

/** Decision series; labels come from `decisionLabel(key)` in the current language. */
export const SERIES = [
  { key: "allow", color: "#3987e5" },
  { key: "deny", color: "#d95926" },
  { key: "none", color: "#74747f" },
] as const;

type Day = AuditStats["days"][number];

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function niceMax(v: number): { max: number; step: number } {
  if (v <= 4) return { max: 4, step: 1 };
  const raw = v / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const s = step < 1 ? 1 : step;
  return { max: Math.ceil(v / s) * s, step: s };
}

function parseDay(d: string): Date {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(y, (m || 1) - 1, dd || 1);
}

export function longDate(d: string): string {
  return parseDay(d).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" });
}

/** Axis label: "Pzt 29" / "Mon 29" for a week, "6 Eyl" / "Sep 6" otherwise. */
function shortLabel(d: string, n: number): string {
  const dt = parseDay(d);
  if (n <= 7) return `${dt.toLocaleDateString(locale(), { weekday: "short" })} ${dt.getDate()}`;
  return dt.toLocaleDateString(locale(), { day: "numeric", month: "short" });
}

/** Rect with rounded top corners only (data end), square at the baseline. */
function topRounded(x: number, y: number, w: number, hh: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, hh));
  return `M${x},${y + hh}V${y + rr}A${rr},${rr} 0 0 1 ${x + rr},${y}H${x + w - rr}A${rr},${rr} 0 0 1 ${x + w},${y + rr}V${y + hh}Z`;
}

function tipBody(d: Day): Node[] {
  const total = d.allow + d.deny + d.none;
  const rows = SERIES.map((s) =>
    h(
      "div",
      { class: "tip-row" },
      h("span", { class: "tip-key", style: `background:${s.color}` }),
      h("strong", { text: fmtNum(d[s.key]) }),
      h("span", { class: "tip-name", text: decisionLabel(s.key) }),
    ),
  );
  return [
    h("div", { class: "tip-title", text: longDate(d.date) }),
    ...rows,
    h("div", { class: "tip-total", text: t("chart.total", { n: fmtNum(total) }) }),
  ];
}

/** Draws into `host` and redraws on resize. */
export function dailyChart(host: HTMLElement, days: Day[]): void {
  const draw = (width: number) => {
    const W = Math.max(280, Math.floor(width));
    const H = 190;
    const m = { l: 34, r: 6, t: 10, b: 26 };
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const n = Math.max(1, days.length);
    const peak = Math.max(0, ...days.map((d) => d.allow + d.deny + d.none));
    const { max, step } = niceMax(peak);
    const band = pw / n;
    const bw = Math.max(2, Math.min(24, band - Math.max(2, band * 0.28)));
    const y = (v: number) => m.t + ph - (v / max) * ph;

    const svg = el("svg", {
      width: W,
      height: H,
      viewBox: `0 0 ${W} ${H}`,
      role: "img",
      "aria-label": t("chart.aria"),
      class: "chart-svg",
    });

    // Grid + y ticks.
    for (let v = 0; v <= max + 1e-9; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      svg.append(el("line", { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: v === 0 ? "axis" : "grid" }));
      const tick = el("text", { x: m.l - 8, y: yy + 3.5, "text-anchor": "end", class: "tick" });
      tick.textContent = fmtNum(v);
      svg.append(tick);
    }

    const hover = el("rect", { x: 0, y: m.t, width: band, height: ph, class: "col-hover", rx: 4 });
    hover.style.display = "none";
    svg.append(hover);

    // X labels: every `every`-th day counting back from today, so today is labelled.
    const every = n <= 7 ? 1 : n <= 31 ? 5 : 15;
    days.forEach((d, i) => {
      const cx = m.l + band * i + band / 2;
      const x = cx - bw / 2;
      let base = y(0);
      const parts = SERIES.map((s) => ({ s, v: d[s.key] })).filter((p) => p.v > 0);
      parts.forEach((p, j) => {
        const full = (p.v / max) * ph;
        const gap = j > 0 ? 2 : 0;
        const hh = Math.max(1.5, full - gap);
        const top = base - gap - hh;
        const isTop = j === parts.length - 1;
        const shape = isTop
          ? el("path", { d: topRounded(x, top, bw, hh, 4), fill: p.s.color })
          : el("rect", { x, y: top, width: bw, height: hh, fill: p.s.color });
        shape.setAttribute("class", "bar");
        svg.append(shape);
        base = top;
      });
      if ((n - 1 - i) % every === 0) {
        const tick = el("text", {
          x: cx,
          y: H - 8,
          "text-anchor": "middle",
          class: `tick${i === n - 1 ? " today" : ""}`,
        });
        tick.textContent = i === n - 1 ? t("chart.today") : shortLabel(d.date, n);
        svg.append(tick);
      }
      // Hit target: the whole column, not just the painted bar.
      const hit = el("rect", { x: m.l + band * i, y: m.t, width: band, height: ph, fill: "transparent", class: "hit" });
      hit.addEventListener("pointermove", (e) => {
        hover.setAttribute("x", String(m.l + band * i + (band - Math.min(band, bw + 8)) / 2));
        hover.setAttribute("width", String(Math.min(band, bw + 8)));
        hover.style.display = "";
        showTip(e.clientX, e.clientY, ...tipBody(d));
      });
      hit.addEventListener("pointerleave", () => {
        hover.style.display = "none";
        hideTip();
      });
      svg.append(hit);
    });
    host.replaceChildren(svg);
  };

  // Only one daily chart exists at a time; drop the previous observer.
  chartObserver?.disconnect();
  let last = -1;
  chartObserver = new ResizeObserver((entries) => {
    const w = Math.floor(entries[0].contentRect.width);
    if (w > 0 && w !== last) {
      last = w;
      draw(w);
    }
  });
  chartObserver.observe(host);
}

let chartObserver: ResizeObserver | null = null;

export function legend(): HTMLElement {
  return h(
    "div",
    { class: "legend" },
    ...SERIES.map((s) =>
      h(
        "span",
        { class: "lg-item" },
        h("span", { class: "lg-swatch", style: `background:${s.color}` }),
        decisionLabel(s.key),
      ),
    ),
  );
}

/** Plain table twin of the daily chart. */
export function dailyTable(days: Day[]): HTMLElement {
  const tbody = h("tbody", {});
  for (const d of [...days].reverse()) {
    const total = d.allow + d.deny + d.none;
    if (!total) continue;
    tbody.append(
      h(
        "tr",
        {},
        h("td", { text: longDate(d.date) }),
        h("td", { class: "num", text: fmtNum(d.allow) }),
        h("td", { class: "num", text: fmtNum(d.deny) }),
        h("td", { class: "num", text: fmtNum(d.none) }),
        h("td", { class: "num", text: fmtNum(total) }),
      ),
    );
  }
  return h(
    "table",
    { class: "mini-table" },
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        h("th", { text: t("chart.day") }),
        h("th", { class: "num", text: decisionLabel("allow") }),
        h("th", { class: "num", text: decisionLabel("deny") }),
        h("th", { class: "num", text: decisionLabel("none") }),
        h("th", { class: "num", text: t("hist.kpi.total") }),
      ),
    ),
    tbody,
  );
}

const LEVELS: RiskLevel[] = ["low", "medium", "high", "critical"];

/** 100 % bar of risk levels with a labelled legend (never colour alone). */
export function riskBar(stats: AuditStats): HTMLElement {
  const total = stats.low + stats.medium + stats.high + stats.critical;
  const bar = h("div", {
    class: "risk-bar",
    role: "img",
    "aria-label": LEVELS.map((l) => `${levelLabel(l)} ${stats[l]}`).join(", "),
  });
  const leg = h("div", { class: "risk-legend" });
  for (const l of LEVELS) {
    const v = stats[l];
    if (v > 0 && total > 0) {
      const seg = h("span", { class: `rb-seg lvl-bg-${l}` });
      seg.style.flexGrow = String(v);
      seg.addEventListener("pointermove", (e) =>
        showTip(
          e.clientX,
          e.clientY,
          h("div", { class: "tip-title", text: levelLabel(l) }),
          h("div", { text: tn(v, "chart.requestsOne", "chart.requestsOther", { pct: fmtPct(v, total) }) }),
        ),
      );
      seg.addEventListener("pointerleave", hideTip);
      bar.append(seg);
    }
    leg.append(
      h(
        "span",
        { class: "rl-item" },
        h("span", { class: `rl-dot lvl-bg-${l}` }),
        h("span", { class: "rl-label", text: levelLabel(l) }),
        h("strong", { text: fmtNum(v) }),
        h("span", { class: "muted", text: fmtPct(v, total) }),
      ),
    );
  }
  if (!total) bar.append(h("span", { class: "rb-empty" }));
  return h("div", { class: "risk-dist" }, bar, leg);
}

/** Ranked list with thin single-hue bars (one series: no legend needed). */
export function rankList(items: [string, number][], empty: string, mono = false): HTMLElement {
  if (!items.length) return h("p", { class: "muted empty-line", text: empty });
  const top = Math.max(...items.map((i) => i[1]));
  const list = h("ol", { class: "rank" });
  for (const [name, n] of items) {
    const fill = h("span", { class: "rank-fill" });
    fill.style.width = `${Math.max(2, (n / top) * 100)}%`;
    list.append(
      h(
        "li",
        {},
        h("span", { class: `rank-name${mono ? " mono" : ""}`, title: name, text: name }),
        h("span", { class: "rank-val", text: fmtNum(n) }),
        h("span", { class: "rank-track" }, fill),
      ),
    );
  }
  return list;
}
