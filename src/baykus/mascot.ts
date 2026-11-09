import { MASCOT_THEMES, type MascotTheme } from "../core/mascot-theme";
import type { OwlMood } from "./owl";

const SILHOUETTES = {
  wolf: "M6 30 5 3 21 15 39 15 55 3 54 30 48 47 30 58 12 47Z",
  hawk: "M5 31 9 16 22 9 44 11 56 5 51 23 55 37 43 49 30 56 13 48Z",
  octopus: "M12 33C4 3 55 2 48 32Q63 33 58 44T48 43Q49 60 39 58Q34 56 35 46Q30 64 24 55L24 46Q15 63 10 52L14 43Q0 51 2 41Q3 35 12 33Z",
  lion: "M30 2 41 7 51 6 54 16 59 24 56 34 58 45 48 49 40 57 30 55 20 58 12 50 3 45 5 34 1 24 7 16 10 7 21 8Z",
  canary: "M7 38Q4 12 25 11Q29 6 38 7L36 13Q53 17 54 34Q55 54 30 55Q11 55 7 38Z",
  eagle: "M4 28 9 13 24 5 42 7 55 18 56 38 48 49 38 47 31 57 24 49 13 51 8 42Z",
} as const;

const shapes = Object.fromEntries(
  Object.entries(SILHOUETTES).map(([key, shape]) => [key, new Path2D(shape)]),
);
const muzzle = new Path2D("M15 36Q30 42 45 36Q42 49 30 51Q18 49 15 36Z");
const beak = new Path2D("M21 34Q30 29 39 34L30 46Z");
const hookedBeak = new Path2D("M19 34Q32 27 43 35Q43 43 33 47L34 40 24 42Z");

export function drawMascot(
  ctx: CanvasRenderingContext2D,
  theme: MascotTheme,
  cx: number,
  cy: number,
  size: number,
  mood: OwlMood,
  time: number,
): boolean {
  if (theme === "owl" || !Object.prototype.hasOwnProperty.call(shapes, theme)) return false;
  const { accent, face } = MASCOT_THEMES[theme];
  const alert = mood === "approval" || mood === "danger" || mood === "question";
  const sleeping = mood === "sleeping";
  const bounce = alert && !matchMedia("(prefers-reduced-motion: reduce)").matches
    ? Math.sin(time * 6) * size * 0.035
    : 0;
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2 + bounce);
  ctx.scale(size / 60, size / 60);
  ctx.fillStyle = face;
  ctx.fill(shapes[theme]);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.ellipse(30, 32, theme === "lion" ? 18 : 20, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#181a21";
  for (const x of [21, 39]) {
    ctx.beginPath();
    ctx.ellipse(x, 29, 3.3, sleeping ? 0.8 : alert ? 5.2 : 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  if (theme === "wolf" || theme === "lion") {
    ctx.fillStyle = "#eee4d7";
    ctx.fill(muzzle);
    ctx.fillStyle = "#181a21";
    ctx.beginPath();
    ctx.ellipse(30, 39, 4.5, 2.7, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (theme !== "octopus") {
    ctx.fillStyle = "#874924";
    ctx.fill(theme === "canary" ? beak : hookedBeak);
  }
  ctx.restore();
  return true;
}
