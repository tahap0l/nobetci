// Mascot heads for small places (session rows, the settings gallery), where the
// owl is a head too (mini.ts). The full characters are skins on the owl's engine
// (skins.ts, owl.ts). They are drawn in the owl's own
// language (see owl.ts / mini.ts): flat fills, one dark outline around the whole
// silhouette, big round eyes with a rimmed iris and a highlight, and the same
// mood expressions. Original artwork; nothing is imported.
//
// Every mascot lives in a 100 × 100 box (y down). Shapes are plain path strings
// turned into Path2D once.

import type { MascotTheme } from "../core/mascot-theme";
import { OWL_COLORS, type OwlMood } from "./owl";

type Theme = Exclude<MascotTheme, "owl">;
type Layer = readonly [fill: string, path: string];

interface Design {
  outline: string;
  /** Everything that makes up the silhouette, outlined together and filled back to front. */
  body: readonly Layer[];
  /** Markings painted on top of the body, under the eyes. */
  marks: readonly Layer[];
  /** Painted over the eyes: brows, beak, nose. */
  face: readonly Layer[];
  /** Thin outline-coloured strokes (mouth lines). */
  lines?: string;
  /** Open strokes in a colour of their own, like the owl's belly marks. */
  strokes?: Layer;
  eye: { x: number; y: number; r: number; white: string; iris: string; lid: string };
  blush?: readonly [x: number, y: number, r: number];
}

const TAU = Math.PI * 2;

/** A circle as a path string, so it can join a silhouette. */
const dot = (x: number, y: number, r: number) =>
  `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
/** The same shape on both sides of the centre line (x = 50). */
const mirror = (points: (side: 1 | -1) => string) => points(-1) + points(1);
const at = (side: number, dx: number) => 50 + side * dx;

const DESIGNS: Record<Theme, Design> = {
  wolf: {
    outline: "#1A1E27",
    body: [
      ["#8D99A9", mirror((s) => `M${at(s, 36)} 42L${at(s, 33)} 5L${at(s, 6)} 27Z`)],
      [
        "#8D99A9",
        "M50 19C72 19 87 33 90 51L97 63L86 67C80 84 65 93 50 93C35 93 20 84 14 67L3 63L10 51C13 33 28 19 50 19Z",
      ],
    ],
    marks: [
      ["#566273", mirror((s) => `M${at(s, 30)} 31L${at(s, 29)} 14L${at(s, 14)} 27Z`)],
      ["#566273", "M50 19C58 19 65 21 71 24C62 27 55 33 50 43C45 33 38 27 29 24C35 21 42 19 50 19Z"],
      ["#F4EFE7", "M50 47C57 55 72 53 82 60C77 80 63 89 50 89C37 89 23 80 18 60C28 53 43 55 50 47Z"],
    ],
    face: [["#1D2129", "M43 67Q50 63 57 67Q56 74 50 76Q44 74 43 67Z"]],
    lines: "M50 76V80M50 80Q45 86 39 82M50 80Q55 86 61 82",
    eye: { x: 19.5, y: 50, r: 15, white: "#FFF8EC", iris: OWL_COLORS.iris, lid: "#8D99A9" },
  },
  hawk: {
    outline: "#24130A",
    body: [["#A9653C", "M50 11C75 11 89 30 89 52C89 76 71 93 50 93C29 93 11 76 11 52C11 30 25 11 50 11Z"]],
    marks: [
      ["#F3E3C6", "M50 60C60 53 77 55 84 63C79 80 65 89 50 89C35 89 21 80 16 63C23 55 40 53 50 60Z"],
      ["#6E3E22", "M50 11C66 11 79 19 85 32C74 29 60 33 50 45C40 33 26 29 15 32C21 19 34 11 50 11Z"],
    ],
    strokes: ["#A9653C", "M36 80l4 4l4-4M46 84l4 4l4-4M56 80l4 4l4-4"],
    face: [
      ["#6E3E22", mirror((s) => `M${at(s, 37)} 37L${at(s, 4)} 47L${at(s, 4)} 53L${at(s, 34)} 44Z`)],
      ["#F2B544", "M41 62Q50 54 59 62Q60 73 50 83Q40 73 41 62Z"],
      ["#F9D77E", "M43 61Q50 56 57 61Q50 64 43 61Z"],
      ["#4A2C17", "M44.5 72Q50 76 55.5 72Q54 78 50 83Q46 78 44.5 72Z"],
    ],
    eye: { x: 19.5, y: 54, r: 14, white: "#FFF6DF", iris: OWL_COLORS.iris, lid: "#C98A5E" },
  },
  eagle: {
    outline: "#161B27",
    body: [
      ["#3A4560", "M12 72C18 58 82 58 88 72C90 88 72 97 50 97C28 97 10 88 12 72Z"],
      [
        "#F6F2E8",
        "M50 9C73 9 87 26 87 48C87 62 81 71 74 78L66 72L60 83L50 76L40 83L34 72L26 78C19 71 13 62 13 48C13 26 27 9 50 9Z",
      ],
    ],
    marks: [["#D3DDEA", "M50 9C65 9 77 16 83 28C71 22 60 23 50 32C40 23 29 22 17 28C23 16 35 9 50 9Z"]],
    face: [
      ["#3A4560", mirror((s) => `M${at(s, 35)} 30L${at(s, 4)} 41L${at(s, 4)} 47L${at(s, 32)} 37Z`)],
      ["#F5B82E", "M39 54Q50 46 61 54Q63 69 50 80Q37 69 39 54Z"],
      ["#FBDD86", "M41 54Q50 48 59 54Q50 58 41 54Z"],
      ["#B9781A", "M46 62a1.4 1.4 0 1 0 0.1 0ZM54 62a1.4 1.4 0 1 0 0.1 0Z"],
    ],
    eye: { x: 19, y: 47, r: 13.5, white: "#FFFBEF", iris: "#F7C93A", lid: "#DAD5C8" },
  },
  canary: {
    outline: "#2B2208",
    body: [
      ["#E2B22E", mirror((s) => `M${at(s, 33)} 52Q${at(s, 47)} 66 ${at(s, 34)} 80Q${at(s, 28)} 66 ${at(s, 33)} 52Z`)],
      ["#F6D643", "M45 20Q43 4 53 3Q50 9 54 14Q60 5 66 9Q59 14 58 22Z"],
      ["#F6D643", "M50 16C73 16 88 33 88 55C88 77 72 92 50 92C28 92 12 77 12 55C12 33 27 16 50 16Z"],
    ],
    marks: [["#FCEB95", "M50 54C64 54 74 62 74 72C74 82 64 88 50 88C36 88 26 82 26 72C26 62 36 54 50 54Z"]],
    face: [
      ["#EE8E3A", "M42 57Q50 53 58 57L50 69Z"],
      ["#C96A1E", "M44.5 61Q50 64 55.5 61L50 69Z"],
    ],
    eye: { x: 19, y: 44, r: 13.5, white: "#FFFBEA", iris: "#7A5220", lid: "#F6D643" },
    blush: [27, 61, 5],
  },
  lion: {
    outline: "#2A1608",
    body: [
      [
        "#B4631F",
        Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * TAU;
          return dot(
            Math.round((50 + Math.cos(a) * 34) * 10) / 10,
            Math.round((53 + Math.sin(a) * 34) * 10) / 10,
            12,
          );
        }).join("") + dot(50, 53, 36),
      ],
    ],
    marks: [
      ["#F2B95C", mirror((s) => dot(at(s, 24), 30, 9))],
      ["#8E4A16", mirror((s) => dot(at(s, 24), 30, 4.5))],
      ["#F2B95C", "M50 26C68 26 80 39 80 55C80 72 67 84 50 84C33 84 20 72 20 55C20 39 32 26 50 26Z"],
      ["#FBEBCB", dot(43, 70, 9) + dot(57, 70, 9) + "M40 72H60Q58 83 50 83Q42 83 40 72Z"],
    ],
    face: [["#5A2E14", "M43 62Q50 59 57 62Q56 68 50 71Q44 68 43 62Z"]],
    lines: "M50 71V75M50 75Q46 80 41 77M50 75Q54 80 59 77",
    eye: { x: 15.5, y: 48, r: 12, white: "#FFF8EC", iris: OWL_COLORS.iris, lid: "#F2B95C" },
  },
  octopus: {
    outline: "#1F1433",
    body: [
      [
        "#A775D2",
        dot(17, 76, 11) + dot(38, 83, 11) + dot(62, 83, 11) + dot(83, 76, 11) +
          "M50 8C75 8 89 27 89 49C89 65 82 76 72 82H28C18 76 11 65 11 49C11 27 25 8 50 8Z",
      ],
    ],
    marks: [
      ["#C8A2EA", dot(29, 22, 4.5) + dot(68, 17, 3.2) + dot(77, 29, 2.4) + dot(38, 14, 2)],
      ["#61DDCB", dot(17, 79, 2.6) + dot(38, 86, 2.6) + dot(62, 86, 2.6) + dot(83, 79, 2.6)],
    ],
    face: [],
    lines: "M44 66Q50 71 56 66",
    eye: { x: 19, y: 45, r: 14, white: "#FFFAF2", iris: "#5B3A8C", lid: "#A775D2" },
    blush: [29, 63, 4.5],
  },
};

interface Built {
  design: Design;
  silhouette: Path2D;
  body: [string, Path2D][];
  marks: [string, Path2D][];
  face: [string, Path2D][];
  lines?: Path2D;
  strokes?: [string, Path2D];
}

const built = new Map<Theme, Built>();

function build(theme: Theme): Built {
  let b = built.get(theme);
  if (!b) {
    const design = DESIGNS[theme];
    const paths = (layers: readonly Layer[]) =>
      layers.map(([fill, path]) => [fill, new Path2D(path)] as [string, Path2D]);
    b = {
      design,
      silhouette: new Path2D(design.body.map(([, path]) => path).join("")),
      body: paths(design.body),
      marks: paths(design.marks),
      face: paths(design.face),
      lines: design.lines ? new Path2D(design.lines) : undefined,
      strokes: design.strokes ? [design.strokes[0], new Path2D(design.strokes[1])] : undefined,
    };
    built.set(theme, b);
  }
  return b;
}

function isTheme(theme: MascotTheme): theme is Theme {
  return theme !== "owl" && Object.prototype.hasOwnProperty.call(DESIGNS, theme);
}

/** Draws a mascot other than the owl; returns false when the owl should be drawn instead. */
export function drawMascot(
  ctx: CanvasRenderingContext2D,
  theme: MascotTheme,
  cx: number,
  cy: number,
  size: number,
  mood: OwlMood,
  time: number,
  lookX = 0,
  lookY = 0,
): boolean {
  if (!isTheme(theme)) return false;
  const { design, silhouette, body, marks, face, lines, strokes } = build(theme);
  const alert = mood === "approval" || mood === "danger" || mood === "question";
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const bounce = alert && !still ? Math.sin(time * 6) * size * 0.035 : 0;
  const scale = size / 100;
  // Below this the outline, rims and highlights are thinner than a pixel and only blur the shape.
  const detailed = size >= 30;

  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2 + bounce);
  ctx.scale(scale, scale);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // One outline around the whole silhouette: stroke everything, then fill over the inner half.
  if (detailed) {
    ctx.strokeStyle = design.outline;
    ctx.lineWidth = 6;
    ctx.stroke(silhouette);
  }
  for (const [fill, path] of body) {
    ctx.fillStyle = fill;
    ctx.fill(path);
  }
  for (const [fill, path] of marks) {
    ctx.fillStyle = fill;
    ctx.fill(path);
  }
  if (strokes && detailed) {
    ctx.strokeStyle = strokes[0];
    ctx.lineWidth = 2.2;
    ctx.stroke(strokes[1]);
  }
  if (design.blush && detailed) {
    const [x, y, r] = design.blush;
    ctx.fillStyle = OWL_COLORS.blush;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.arc(100 - x, y, r, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  drawEyes(ctx, design, mood, time, detailed, alert ? 1 : lookX, alert ? 0 : lookY);

  for (const [fill, path] of face) {
    ctx.fillStyle = fill;
    ctx.fill(path);
  }
  if (lines && detailed) {
    ctx.strokeStyle = design.outline;
    ctx.lineWidth = 2.2;
    ctx.stroke(lines);
  }
  ctx.restore();
  return true;
}

/** The owl's eyes (mini.ts), on another face: same moods, same iris tints. */
function drawEyes(
  ctx: CanvasRenderingContext2D,
  design: Design,
  mood: OwlMood,
  t: number,
  detailed: boolean,
  lookX: number,
  lookY: number,
) {
  const C = OWL_COLORS;
  const { x: dx, y, r, white, lid: lidColor } = design.eye;
  const gazeX = Math.max(-1, Math.min(1, lookX));
  const gazeY = Math.max(-1, Math.min(1, lookY));
  const line = Math.max(2.4, r * 0.24);

  for (let side = -1; side <= 1; side += 2) {
    const x = 50 + side * dx;
    const closed = mood === "sleeping" || mood === "finished";
    ctx.fillStyle = mood === "sleeping" ? lidColor : white;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    if (detailed) {
      ctx.strokeStyle = design.outline;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
    ctx.strokeStyle = design.outline;
    ctx.lineWidth = line;

    if (closed) {
      // Happy arcs when finished, resting arcs when asleep.
      const bend = mood === "finished" ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.62, y + bend * -r * 0.12);
      ctx.quadraticCurveTo(x, y + bend * r * 0.62, x + r * 0.62, y + bend * -r * 0.12);
      ctx.stroke();
      continue;
    }
    if (mood === "dizzy") {
      ctx.beginPath();
      ctx.arc(x, y, r * 0.56, 0, TAU);
      ctx.stroke();
      const a = t * 6 * side;
      ctx.fillStyle = C.pupil;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r * 0.24, y + Math.sin(a) * r * 0.24, r * 0.24, 0, TAU);
      ctx.fill();
      continue;
    }

    const ir = r * (mood === "approval" || mood === "question" ? 0.8 : 0.74);
    const reach = r - ir;
    let px = gazeX * reach;
    let py = gazeY * reach;
    if (mood === "working") px = Math.sin(t * 2.6) * reach;
    else if (mood === "thinking") {
      px = reach * 0.7;
      py = -reach * 0.8;
    } else if (mood === "error") py = reach * 0.8;
    const ix = x + px;
    const iy = y + py;
    ctx.fillStyle =
      mood === "danger" ? C.irisRed : mood === "approval" || mood === "question" ? C.irisAmber : design.eye.iris;
    ctx.beginPath();
    ctx.arc(ix, iy, ir, 0, TAU);
    ctx.fill();
    if (detailed) {
      ctx.strokeStyle = C.irisRim;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    const pr = ir * (mood === "danger" ? 0.46 : 0.6);
    ctx.fillStyle = C.pupil;
    ctx.beginPath();
    ctx.arc(ix + px * 0.25, iy + py * 0.25, pr, 0, TAU);
    ctx.fill();
    if (detailed) {
      ctx.fillStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.arc(ix - ir * 0.34, iy - ir * 0.38, ir * 0.24, 0, TAU);
      ctx.arc(ix + ir * 0.3, iy + ir * 0.34, ir * 0.11, 0, TAU);
      ctx.fill();
    }

    // Lids for the moods that need them: + stern, − sad.
    let lid = 0;
    let slant = 0;
    if (mood === "danger") {
      lid = 0.4;
      slant = 0.7;
    } else if (mood === "error") {
      lid = 0.42;
      slant = -0.6;
    } else if (mood === "thinking" && side < 0) lid = 0.48;
    if (lid > 0) {
      const y0 = y - r + lid * 2 * r;
      const d = slant * r * 0.6;
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.clip();
      ctx.fillStyle = lidColor;
      ctx.beginPath();
      ctx.moveTo(x - r, y - r - 1);
      ctx.lineTo(x + r, y - r - 1);
      ctx.lineTo(x + r, y0 - side * d);
      ctx.lineTo(x - r, y0 + side * d);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = design.outline;
      ctx.lineWidth = line;
      ctx.beginPath();
      ctx.moveTo(x + r, y0 - side * d);
      ctx.lineTo(x - r, y0 + side * d);
      ctx.stroke();
      ctx.restore();
    }
  }
}
