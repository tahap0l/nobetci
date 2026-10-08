// Tiny owl head for session pills (13–18 px): ear tufts, two eyes, a beak and
// a mood-tinted ring. Stateless; `t` (seconds) only drives small pulses.

import { OWL_COLORS, type OwlMood } from "./owl";

const TAU = Math.PI * 2;

const RING: Record<OwlMood, string> = {
  idle: "#6E7280",
  sleeping: "#5A5E6A",
  working: "#3B9EFF",
  thinking: "#A78BFA",
  approval: "#F5A524",
  danger: "#F4505E",
  question: "#F5A524",
  error: "#F4505E",
  finished: "#34D399",
  dizzy: "#A78BFA",
};

/** Ring pulse rate (rad/s) for moods that ask for attention; 0 = steady. */
const PULSE: Record<OwlMood, number> = {
  idle: 0,
  sleeping: 0,
  working: 3.2,
  thinking: 2.4,
  approval: 4.2,
  danger: 7.5,
  question: 4.2,
  error: 0,
  finished: 0,
  dizzy: 0,
};

export function drawOwlMini(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  mood: OwlMood,
  accent: string | null,
  t: number,
): void {
  const C = OWL_COLORS;
  const R = size / 2;
  const lw = Math.max(1, size * 0.075);
  const rr = R - lw / 2;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Mood ring, with the session accent as a short base arc.
  const rate = PULSE[mood] ?? 0;
  ctx.globalAlpha = rate > 0 ? 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * rate)) : 0.9;
  ctx.strokeStyle = RING[mood] ?? RING.idle;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(cx, cy, rr, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 1;
  if (accent !== null) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = lw * 1.4;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, Math.PI * 0.3, Math.PI * 0.7);
    ctx.stroke();
  }

  // Head in units of u (u = 1 reaches the inside of the ring).
  const u = R - lw;
  ctx.translate(cx, cy + u * 0.12);
  const tilt =
    mood === "question" ? 0.26 : mood === "thinking" ? -0.14 : mood === "dizzy" ? Math.sin(t * 5) * 0.25 : 0;
  if (tilt !== 0) ctx.rotate(tilt);

  // Tufts: points rising well clear of a low, wide head so the notch between
  // them stays visible (raised when alarmed, drooped when low).
  const up = mood === "danger" || mood === "approval" || mood === "question";
  const low = mood === "error" || mood === "sleeping";
  ctx.fillStyle = C.headBottom;
  ctx.beginPath();
  for (let side = -1; side <= 1; side += 2) {
    const tipX = side * u * (low ? 1.04 : up ? 0.6 : 0.72);
    const tipY = -u * (low ? 0.4 : up ? 1.1 : 1.0);
    ctx.moveTo(side * u * 0.26, -u * 0.5);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(side * u * 0.86, -u * 0.16);
    ctx.closePath();
  }
  ctx.ellipse(0, 0, u * 0.86, u * 0.64, 0, 0, TAU);
  ctx.fill();

  // Facial disc: two cream circles.
  const ex = u * 0.4;
  const ey = -u * 0.06;
  const dr = u * 0.41;
  ctx.fillStyle = C.disc;
  ctx.beginPath();
  ctx.moveTo(-ex + dr, ey);
  ctx.arc(-ex, ey, dr, 0, TAU);
  ctx.moveTo(ex + dr, ey);
  ctx.arc(ex, ey, dr, 0, TAU);
  ctx.fill();

  // Eyes.
  const er = u * 0.27;
  const stroke = Math.max(0.9, u * 0.17);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = stroke;
  for (let side = -1; side <= 1; side += 2) {
    const x = side * ex;
    switch (mood) {
      case "finished":
        ctx.beginPath();
        ctx.moveTo(x - er, ey + er * 0.4);
        ctx.quadraticCurveTo(x, ey - er * 1.05, x + er, ey + er * 0.4);
        ctx.stroke();
        break;
      case "sleeping":
        ctx.beginPath();
        ctx.moveTo(x - er, ey);
        ctx.quadraticCurveTo(x, ey + er * 0.8, x + er, ey);
        ctx.stroke();
        break;
      case "dizzy": {
        ctx.beginPath();
        ctx.arc(x, ey, er * 0.72, 0, TAU);
        ctx.stroke();
        const a = t * 6 * side;
        ctx.fillStyle = C.pupil;
        ctx.beginPath();
        ctx.arc(x + Math.cos(a) * er * 0.3, ey + Math.sin(a) * er * 0.3, er * 0.32, 0, TAU);
        ctx.fill();
        break;
      }
      default: {
        const iris =
          mood === "danger" ? C.irisRed : mood === "approval" || mood === "question" ? C.irisAmber : C.iris;
        const big = mood === "approval" || mood === "question" ? 1.1 : 1;
        const ir = er * big;
        ctx.fillStyle = iris;
        ctx.beginPath();
        ctx.arc(x, ey, ir, 0, TAU);
        ctx.fill();
        let px = 0;
        let py = 0;
        if (mood === "working") px = Math.sin(t * 2.6) * er * 0.3;
        else if (mood === "thinking") {
          px = er * 0.2;
          py = -er * 0.25;
        } else if (mood === "error") py = er * 0.25;
        ctx.fillStyle = C.pupil;
        ctx.beginPath();
        ctx.arc(x + px, ey + py, er * (mood === "danger" ? 0.48 : 0.62), 0, TAU);
        ctx.fill();

        // Lids for the moods that need them: + stern, − sad.
        let lid = 0;
        let slant = 0;
        if (mood === "danger") {
          lid = 0.42;
          slant = 0.7;
        } else if (mood === "error") {
          lid = 0.45;
          slant = -0.6;
        } else if (mood === "thinking" && side < 0) lid = 0.5;
        if (lid > 0) {
          const R2 = ir + stroke * 0.3;
          const y0 = ey - R2 + lid * 2 * R2;
          const d = slant * R2 * 0.6;
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, ey, R2, 0, TAU);
          ctx.clip();
          ctx.fillStyle = C.disc;
          ctx.beginPath();
          ctx.moveTo(x - R2, ey - R2 - 1);
          ctx.lineTo(x + R2, ey - R2 - 1);
          ctx.lineTo(x + R2, y0 - side * d);
          ctx.lineTo(x - R2, y0 + side * d);
          ctx.closePath();
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(x + R2, y0 - side * d);
          ctx.lineTo(x - R2, y0 + side * d);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }

  // Beak.
  ctx.fillStyle = C.beak;
  ctx.beginPath();
  ctx.moveTo(-u * 0.14, ey + u * 0.16);
  ctx.lineTo(u * 0.14, ey + u * 0.16);
  ctx.lineTo(0, ey + u * 0.48);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}
