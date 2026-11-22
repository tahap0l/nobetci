// Animated weather icons, drawn as SVG (no icon font, no images). The motion is
// in style.css under `.wi-*` and stops with prefers-reduced-motion.

export type WeatherKind =
  | "clear" | "mostly" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm";

/** WMO weather code (Open-Meteo) → icon kind. */
export function weatherKind(code: number): WeatherKind {
  if (code === 0) return "clear";
  // 1 is "mainly clear": mostly sky, not the same as partly cloudy (dashboard#23).
  if (code === 1) return "mostly";
  if (code === 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "rain";
}

export function weatherLabel(code: number, tr: boolean): string {
  const L = (a: string, b: string) => (tr ? a : b);
  switch (weatherKind(code)) {
    case "clear": return L("Açık", "Clear");
    case "mostly": return L("Az bulutlu", "Mainly clear");
    case "partly": return L("Parçalı bulutlu", "Partly cloudy");
    case "cloudy": return L("Bulutlu", "Cloudy");
    case "fog": return L("Sisli", "Foggy");
    case "drizzle": return L("Çisenti", "Drizzle");
    case "snow": return L("Kar yağışlı", "Snow");
    case "storm": return L("Fırtına", "Thunderstorm");
    default: return L("Yağmurlu", "Rain");
  }
}

const NS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const CLOUD = "M19 47h27a10.5 10.5 0 0 0 1.2-20.9A14 14 0 0 0 20.4 24 11.5 11.5 0 0 0 19 47z";

function sun(cx: number, cy: number, r: number): SVGGElement {
  const g = el("g", { class: "wi-sun" });
  const rays = el("g", { class: "wi-rays", style: `transform-origin:${cx}px ${cy}px` });
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    rays.append(el("line", {
      x1: cx + Math.cos(a) * (r + 4), y1: cy + Math.sin(a) * (r + 4),
      x2: cx + Math.cos(a) * (r + 9), y2: cy + Math.sin(a) * (r + 9),
    }));
  }
  g.append(rays, el("circle", { cx, cy, r, class: "wi-sun-disc" }));
  return g;
}

function moon(cx: number, cy: number, r: number): SVGGElement {
  const g = el("g", { class: "wi-moon" });
  g.append(
    el("path", {
      class: "wi-moon-disc",
      d: `M${cx + r * 0.35} ${cy - r} A${r} ${r} 0 1 0 ${cx + r} ${cy + r * 0.45} A${r * 0.8} ${r * 0.8} 0 0 1 ${cx + r * 0.35} ${cy - r}z`,
    }),
    el("circle", { cx: cx + r + 6, cy: cy - r + 2, r: 1.4, class: "wi-star" }),
    el("circle", { cx: cx - r - 2, cy: cy - r - 2, r: 1.1, class: "wi-star", style: "animation-delay:.8s" }),
  );
  return g;
}

/** An animated weather icon for a WMO code. */
export function weatherIcon(code: number, isDay: boolean, size: number): SVGSVGElement {
  const kind = weatherKind(code);
  const svg = el("svg", { viewBox: "0 0 64 64", width: size, height: size, class: `wi wi-${kind}`, "aria-hidden": "true" });
  const sky = (cx: number, cy: number, r: number) => (isDay ? sun(cx, cy, r) : moon(cx, cy, r));
  if (kind === "clear") {
    svg.append(sky(32, 32, isDay ? 12 : 14));
    return svg;
  }
  if (kind === "mostly") {
    // The sky, with one small cloud passing in front of it.
    svg.append(sky(isDay ? 28 : 27, isDay ? 27 : 26, isDay ? 11 : 13));
    const small = el("g", { class: "wi-cloud" });
    small.append(el("path", { d: CLOUD, transform: "translate(22 22) scale(.62)" }));
    svg.append(small);
    return svg;
  }
  // The moon sits higher and further out than the sun: a crescent has no rays
  // to show past the cloud's edge (dashboard#23).
  if (kind === "partly") svg.append(isDay ? sky(24, 22, 9) : sky(19, 16, 10));
  const cloud = el("g", { class: kind === "storm" || kind === "rain" ? "wi-cloud wi-cloud-dark" : "wi-cloud" });
  cloud.append(el("path", { d: CLOUD }));
  if (kind === "cloudy") {
    const back = el("g", { class: "wi-cloud wi-cloud-back" });
    back.append(el("path", { d: CLOUD, transform: "translate(9 -9) scale(.8)" }));
    svg.append(back);
  }
  svg.append(cloud);
  const fall = (cls: string, make: (x: number) => SVGElement) => {
    const g = el("g", { class: cls });
    [24, 33, 42].forEach((x, i) => {
      const drop = make(x);
      drop.setAttribute("style", `animation-delay:${i * 0.28}s`);
      g.append(drop);
    });
    svg.append(g);
  };
  switch (kind) {
    case "drizzle":
      fall("wi-rain wi-drizzle", (x) => el("line", { x1: x, y1: 51, x2: x - 1.5, y2: 55 }));
      break;
    case "rain":
      fall("wi-rain", (x) => el("line", { x1: x, y1: 50, x2: x - 3, y2: 58 }));
      break;
    case "snow":
      // Flakes big enough to read as snow at 24 px (style.css never fades them out).
      fall("wi-snow", (x) => el("circle", { cx: x, cy: 53, r: 3 }));
      break;
    case "storm": {
      const bolt = el("path", { class: "wi-bolt", d: "M34 44l-7 10h6l-3 9 9-12h-6l4-7z" });
      svg.append(bolt);
      break;
    }
    case "fog": {
      const g = el("g", { class: "wi-fog" });
      [50, 55, 60].forEach((y, i) => g.append(el("line", { x1: 14 + i * 3, y1: y, x2: 50 - i * 2, y2: y, style: `animation-delay:${i * 0.4}s` })));
      svg.append(g);
      break;
    }
  }
  return svg;
}
