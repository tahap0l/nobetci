// Line icons for the settings window, drawn here (24×24, stroked) so nothing is
// borrowed. Built with createElementNS — never from markup strings.

const NS = "http://www.w3.org/2000/svg";

type Shape =
  | { d: string; fill?: boolean }
  | { c: [number, number, number]; fill?: boolean }
  | { r: [number, number, number, number, number] };

const ICONS = {
  genel: [
    { d: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" },
    { c: [15, 6, 2] },
    { c: [9, 12, 2] },
    { c: [17, 18, 2] },
  ],
  claude: [{ r: [3, 4.5, 18, 15, 3] }, { d: "M7.5 9.5l3 2.5-3 2.5M12.5 15H16.5" }],
  guvenlik: [
    { d: "M12 3l7.5 3v5.2c0 4.4-3.1 8.2-7.5 9.8-4.4-1.6-7.5-5.4-7.5-9.8V6L12 3z" },
    { d: "M9 12l2.2 2.2L15.5 10" },
  ],
  kurallar: [{ d: "M10 6.5h10M10 12h10M10 17.5h10M4 6.5l1.2 1.2L7.5 5.3M4 12l1.2 1.2L7.5 10.8M4.5 17.5h2" }],
  bildirimler: [{ d: "M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15L6 16.5zM10 20.5a2 2 0 0 0 4 0" }],
  gecmis: [{ c: [12, 12, 8.5] }, { d: "M12 7.5V12l3 2" }],
  hakkinda: [{ c: [12, 12, 8.5] }, { d: "M12 11v5.5M12 7.8v.2" }],
  close: [{ d: "M6.5 6.5l11 11M17.5 6.5l-11 11" }],
  up: [{ d: "M6.5 14.5L12 9l5.5 5.5" }],
  down: [{ d: "M6.5 9.5L12 15l5.5-5.5" }],
  right: [{ d: "M9.5 6.5L15 12l-5.5 5.5" }],
  left: [{ d: "M14.5 6.5L9 12l5.5 5.5" }],
  edit: [{ d: "M4.5 19.5h4L19 9l-4-4L4.5 15.5v4zM13 7l4 4" }],
  trash: [{ d: "M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10.2 10.5v5.5M13.8 10.5v5.5" }],
  plus: [{ d: "M12 5v14M5 12h14" }],
  play: [{ d: "M8.5 6v12l9.5-6-9.5-6z", fill: true }],
  lock: [{ r: [5, 10.5, 14, 9.5, 2.2] }, { d: "M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" }],
  check: [{ d: "M5 12.5l4.5 4.5L19 7.5" }],
  cross: [{ d: "M7 7l10 10M17 7L7 17" }],
  warn: [{ d: "M12 4.5l8.5 15h-17L12 4.5zM12 10v4.5M12 17v.2" }],
  folder: [{ d: "M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9.5z" }],
  file: [{ d: "M6.5 3.5h7l4 4v13h-11v-17zM13.5 3.5v4h4" }],
  download: [{ d: "M12 4.5v10M7.5 10.5l4.5 4.5 4.5-4.5M5 19.5h14" }],
  upload: [{ d: "M12 19.5v-10M7.5 13.5L12 9l4.5 4.5M5 4.5h14" }],
  reset: [{ d: "M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4.5 4.5v4.5H9" }],
  search: [{ c: [10.5, 10.5, 6] }, { d: "M15 15l4.5 4.5" }],
  moon: [{ d: "M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z" }],
  keyboard: [{ r: [3, 6.5, 18, 11, 2.2] }, { d: "M7 10.5h.2M10.5 10.5h.2M14 10.5h.2M17 10.5h.2M8 14h8" }],
  pulse: [{ d: "M3 12h4l2.5-6 5 12 2.5-6h4" }],
  sparkle: [
    {
      d: "M12 4l1.7 4.3L18 10l-4.3 1.7L12 16l-1.7-4.3L6 10l4.3-1.7L12 4zM18 16l.7 1.3L20 18l-1.3.7L18 20l-.7-1.3L16 18l1.3-.7L18 16z",
    },
  ],
  speaker: [{ d: "M4.5 9.5h3.5L13 5.5v13l-5-4H4.5v-5zM16.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" }],
  mute: [{ d: "M4.5 9.5h3.5L13 5.5v13l-5-4H4.5v-5zM16.5 9.5l5 5M21.5 9.5l-5 5" }],
  eye: [{ d: "M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" }, { c: [12, 12, 2.8] }],
  wifiOff: [{ d: "M3 3l18 18M8.5 16a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.3M19 12.5a10 10 0 0 0-3.2-2M12 19.5v.2" }],
  key: [{ c: [8, 15, 3.5] }, { d: "M10.5 12.5L19 4M15.5 7.5l2.5 2.5M17.5 5.5l2 2" }],
  chart: [{ d: "M4.5 19.5h15M7.5 16.5v-5M12 16.5V7M16.5 16.5v-8" }],
  filter: [{ d: "M4 5.5h16l-6 7.5v5l-4 1.5v-6.5L4 5.5z" }],
  copy: [
    { r: [8.5, 8.5, 11, 11, 2] },
    { d: "M15.5 8.5V5.5a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3" },
  ],
  globe: [
    { c: [12, 12, 8.5] },
    { d: "M3.5 12h17M12 3.5c2.4 2.3 3.6 5.1 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.1-3.6-8.5s1.2-6.2 3.6-8.5z" },
  ],
  cursor: [{ d: "M6.5 3.5v14.2l3.9-3.7 2.6 6 2.6-1.1-2.6-5.9 5.4-.3L6.5 3.5z" }],
  hand: [
    {
      d: "M8 12.5V6a1.5 1.5 0 0 1 3 0v5.5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6 7-2.5 0-4-1.2-5.2-3.2L3.5 13a1.5 1.5 0 0 1 2.4-1.7L8 13.5",
    },
  ],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 18, cls = ""): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `ico${cls ? ` ${cls}` : ""}`);
  for (const s of ICONS[name] as Shape[]) {
    let el: SVGElement;
    if ("d" in s) {
      el = document.createElementNS(NS, "path");
      el.setAttribute("d", s.d);
    } else if ("c" in s) {
      el = document.createElementNS(NS, "circle");
      el.setAttribute("cx", String(s.c[0]));
      el.setAttribute("cy", String(s.c[1]));
      el.setAttribute("r", String(s.c[2]));
    } else {
      el = document.createElementNS(NS, "rect");
      const [x, y, w, hh, rx] = s.r;
      el.setAttribute("x", String(x));
      el.setAttribute("y", String(y));
      el.setAttribute("width", String(w));
      el.setAttribute("height", String(hh));
      el.setAttribute("rx", String(rx));
    }
    if ("fill" in s && s.fill) el.setAttribute("fill", "currentColor");
    svg.append(el);
  }
  return svg;
}

/** The owl mark: an original little glyph, not the island's animated owl. */
export function owlMark(size = 30): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "owl-mark");
  const add = (tag: string, attrs: Record<string, string | number>) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    svg.append(el);
  };
  add("path", {
    d: "M6.5 11L8.5 4.5L13 8.2Q16 7.4 19 8.2L23.5 4.5L25.5 11V19.5A9.5 9.5 0 0 1 6.5 19.5Z",
    fill: "#1c1c22",
    stroke: "rgba(242,242,244,.55)",
    "stroke-width": 1.2,
    "stroke-linejoin": "round",
  });
  add("circle", { cx: 12, cy: 15.5, r: 4.1, fill: "#f2f2f4" });
  add("circle", { cx: 20, cy: 15.5, r: 4.1, fill: "#f2f2f4" });
  add("circle", { cx: 12.6, cy: 15.8, r: 1.9, fill: "#0b0b0e" });
  add("circle", { cx: 19.4, cy: 15.8, r: 1.9, fill: "#0b0b0e" });
  add("path", { d: "M14.8 20.2H17.2L16 22.6Z", fill: "#f5a524" });
  return svg;
}
