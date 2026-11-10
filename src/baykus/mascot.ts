import { MASCOT_THEMES, type MascotTheme } from "../core/mascot-theme";
import type { OwlMood } from "./owl";

const SILHOUETTES = {
  wolf: "M7 27Q3 8 7 5Q11 3 21 15Q30 12 39 15Q49 3 53 5Q57 8 53 27Q61 39 49 48Q41 57 30 57Q19 57 11 48Q-1 39 7 27Z",
  hawk: "M5 31Q5 18 16 12Q25 6 43 12L56 5 51 23Q58 32 52 41L42 50 30 56 13 48Q6 43 5 31Z",
  octopus: "M12 33C4 3 55 2 48 32Q63 33 58 44T48 43Q49 60 39 58Q34 56 35 46Q30 64 24 55L24 46Q15 63 10 52L14 43Q0 51 2 41Q3 35 12 33Z",
  lion: "M30 2 41 7 51 6 54 16 59 24 56 34 58 45 48 49 40 57 30 55 20 58 12 50 3 45 5 34 1 24 7 16 10 7 21 8Z",
  canary: "M7 38Q4 12 25 11Q29 6 38 7L36 13Q53 17 54 34Q55 54 30 55Q11 55 7 38Z",
  eagle: "M4 28Q5 13 17 8Q33 0 47 11Q57 18 56 33L54 42 47 50 39 47 31 57 24 49 14 51 8 42Z",
} as const;

const shapes = Object.fromEntries(
  Object.entries(SILHOUETTES).map(([key, shape]) => [key, new Path2D(shape)]),
);
const faces = {
  wolf: new Path2D("M8 35Q13 21 23 24Q27 25 30 31Q33 25 37 24Q47 21 52 35Q50 51 30 54Q10 51 8 35Z"),
  hawk: new Path2D("M9 30Q18 16 30 25Q43 15 52 29L45 42 33 50 30 41 22 47 14 41Z"),
  octopus: new Path2D("M13 30Q12 14 30 13Q48 14 47 30Q43 40 30 39Q17 40 13 30Z"),
  lion: new Path2D("M13 24Q12 15 21 15L30 21 39 15Q48 15 47 24L47 39 39 48 30 53 21 48 13 39Z"),
  canary: new Path2D("M11 35Q12 23 28 20Q45 18 49 34Q45 50 30 52Q15 51 11 35Z"),
  eagle: new Path2D("M8 30 14 17Q24 11 34 13L49 19 53 34 45 46 37 42 32 53 22 46 15 49Z"),
};

const wolfEars = new Path2D("M9 9 18 18 11 24ZM51 9 42 18 49 24Z");
const muzzle = new Path2D("M15 36Q30 42 45 36Q42 49 30 51Q18 49 15 36Z");
const beak = new Path2D("M21 34Q30 29 39 34L30 46Z");
const hookedBeak = new Path2D("M19 34Q32 27 43 35Q43 43 33 47L34 40 24 42Z");
const featherCrests = {
  hawk: new Path2D("M14 17Q27 9 43 15L49 12 44 20Q30 15 14 17Z"),
  canary: new Path2D("M11 24Q18 12 33 13L29 18Q18 18 11 24Z"),
  eagle: new Path2D("M9 21Q18 7 34 10Q46 11 51 22Q35 13 9 21Z"),
};

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
  const coat = ctx.createLinearGradient(10, 4, 48, 57);
  coat.addColorStop(0, accent);
  coat.addColorStop(.37, face);
  coat.addColorStop(1, "#202333");
  ctx.fillStyle = coat;
  ctx.fill(shapes[theme]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#ffffff54";
  ctx.stroke(shapes[theme]);
  const mask = ctx.createLinearGradient(0, 17, 0, 54);
  mask.addColorStop(0, accent);
  mask.addColorStop(1, face);
  ctx.fillStyle = mask;
  ctx.fill(faces[theme]);
  if (theme === "hawk" || theme === "eagle" || theme === "canary") {
    ctx.fillStyle = "#fff9e790";
    ctx.fill(featherCrests[theme]);
  }
  if (theme === "wolf") {
    ctx.fillStyle = "#3c475c";
    ctx.fill(wolfEars);
  }
  const wolf = theme === "wolf";
  const gazeX = alert ? 1 : Math.max(-1, Math.min(1, lookX));
  const gazeY = alert ? 0 : Math.max(-1, Math.min(1, lookY));
  for (const x of [20, 40]) {
    if (wolf && !sleeping) {
      ctx.fillStyle = "#fff8ec";
      ctx.beginPath();
      ctx.ellipse(x, 32, 7.1, 7.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const pupilX = x + gazeX * (wolf ? 2.8 : 1.7);
    const pupilY = (wolf ? 32 : 29) + gazeY * 2.2;
    ctx.fillStyle = "#181a21";
    ctx.beginPath();
    ctx.ellipse(pupilX, pupilY, wolf ? 4.4 : 3.6, sleeping ? 0.8 : alert ? 5.2 : 4, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!sleeping && size >= 30) {
      ctx.fillStyle = "#fff9ee";
      ctx.beginPath();
      ctx.arc(pupilX - 1.2, pupilY - 1.5, 1.15, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (theme === "wolf" || theme === "lion") {
    ctx.fillStyle = "#eee4d7";
    ctx.fill(muzzle);
    ctx.fillStyle = "#181a21";
    ctx.beginPath();
    ctx.ellipse(30, 39, 4.5, 2.7, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (theme !== "octopus") {
    const bill = ctx.createLinearGradient(0, 32, 0, 47);
    bill.addColorStop(0, "#ffd486");
    bill.addColorStop(1, "#d68c36");
    ctx.fillStyle = bill;
    ctx.fill(theme === "canary" ? beak : hookedBeak);
  } else {
    ctx.fillStyle = "#fff8ee84";
    for (const x of [14, 24, 36, 46]) {
      ctx.beginPath();
      ctx.arc(x, 43, 1.65, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  return true;
}
