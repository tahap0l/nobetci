// The Windows installer's pictures, drawn with the island's own owl engine:
// the dark sidebar of the welcome and finish pages, the header strip, and the
// owl's animation frames (a wave on the welcome page, a cheer on the finish
// page) that the installer plays over the sidebar.
//
// scripts/installer-art.mjs opens `?demo=installer-art` in headless Chrome and
// reads the result from the page: every picture as a 24-bit BMP (the only
// format NSIS shows), base64-encoded, in <pre id="art">. Nothing here runs in
// the app itself.

import { OwlEngine, type OwlEmote } from "./owl";

/** Everything is drawn at twice the installer's 96-DPI size, for sharp high-DPI screens. */
const S = 2;
/** MUI2's welcome/finish sidebar and header sizes, in 96-DPI pixels. */
export const SIDEBAR = { w: 164, h: 314 };
export const HEADER = { w: 150, h: 57 };
/** Where the owl tile sits on the sidebar, in 96-DPI pixels (installer-ui.nsh uses the same numbers). */
export const TILE = { x: 22, y: 58, w: 120, h: 150 };
/** The owl's body size inside the tile. */
const OWL = 96;

const BG_TOP = "#0b0b0e";
const BG_BOTTOM = "#16131f";
const GLOW = "245, 165, 36";

function canvas(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement("canvas");
  c.width = w * S;
  c.height = h * S;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.scale(S, S);
  return ctx;
}

/** The sidebar without the owl: background, glow, a small island, the name. */
function sidebarBackground(ctx: CanvasRenderingContext2D) {
  const { w, h } = SIDEBAR;
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, BG_TOP);
  bg.addColorStop(1, BG_BOTTOM);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // A warm glow behind the owl.
  const cx = TILE.x + TILE.w / 2;
  const cy = TILE.y + TILE.h * 0.55;
  const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, 92);
  glow.addColorStop(0, `rgba(${GLOW}, 0.22)`);
  glow.addColorStop(0.55, `rgba(${GLOW}, 0.07)`);
  glow.addColorStop(1, `rgba(${GLOW}, 0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // A violet haze at the bottom.
  const haze = ctx.createRadialGradient(w * 0.2, h + 10, 4, w * 0.2, h + 10, 170);
  haze.addColorStop(0, "rgba(139, 92, 246, 0.20)");
  haze.addColorStop(1, "rgba(139, 92, 246, 0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, w, h);

  // The island itself: a black pill at the top edge, as on the screen.
  const pw = 74;
  const ph = 18;
  const px = (w - pw) / 2;
  ctx.beginPath();
  ctx.roundRect(px, -ph / 2, pw, ph + 8, 12);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px + pw - 12, 7, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = "#34d399";
  ctx.fill();

  // A few faint stars.
  const stars: [number, number, number][] = [
    [18, 30, 0.9], [140, 44, 0.7], [30, 232, 0.6], [138, 210, 0.8], [112, 26, 0.5], [52, 18, 0.6], [150, 262, 0.5],
  ];
  for (const [x, y, r] of stars) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    ctx.fill();
  }

  // The name, and a thin line under it.
  ctx.textAlign = "center";
  ctx.fillStyle = "#f2f2f5";
  ctx.font = "700 21px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText("Nöbetçi", w / 2, 246);
  const line = ctx.createLinearGradient(w / 2 - 34, 0, w / 2 + 34, 0);
  line.addColorStop(0, "rgba(245, 165, 36, 0)");
  line.addColorStop(0.5, "rgba(245, 165, 36, 0.8)");
  line.addColorStop(1, "rgba(245, 165, 36, 0)");
  ctx.fillStyle = line;
  ctx.fillRect(w / 2 - 34, 256, 68, 1.5);
}

/** The owl into a tile-sized box at (x, y). */
function drawOwl(ctx: CanvasRenderingContext2D, engine: OwlEngine, x: number, y: number) {
  ctx.save();
  ctx.translate(x + (TILE.w - OWL) / 2, y + (TILE.h - OWL * 1.3) / 2 + 6);
  engine.draw(ctx, OWL, OWL * 1.3);
  ctx.restore();
}

/** The disk image window, in points, and where Finder puts the two icons' centres. */
export const DMG = { w: 660, h: 400, app: { x: 180, y: 196 }, folder: { x: 480, y: 196 } };

/**
 * The background of the macOS disk image window: the same night as the
 * installer, the island at the top, a soft arrow from the app to Applications,
 * and the instruction in both languages (Finder cannot switch a picture).
 */
function dmgBackground(ctx: CanvasRenderingContext2D) {
  const { w, h, app, folder } = DMG;
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, BG_TOP);
  bg.addColorStop(1, BG_BOTTOM);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const glow = (x: number, y: number, r: number, rgb: string, a: number) => {
    const g = ctx.createRadialGradient(x, y, 4, x, y, r);
    g.addColorStop(0, `rgba(${rgb}, ${a})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
  glow(app.x, app.y, 150, GLOW, 0.2);
  glow(folder.x, folder.y, 130, "59, 158, 255", 0.1);
  glow(w * 0.85, h + 20, 260, "139, 92, 246", 0.16);

  // Stars.
  const stars: [number, number, number][] = [
    [40, 40, 0.9], [120, 92, 0.6], [598, 58, 0.8], [520, 30, 0.6], [628, 140, 0.5], [70, 300, 0.6],
    [610, 320, 0.7], [330, 120, 0.5], [262, 46, 0.6], [400, 332, 0.5],
  ];
  for (const [x, y, r] of stars) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    ctx.fill();
  }

  // The island at the top edge.
  const pw = 120;
  const ph = 22;
  const px = (w - pw) / 2;
  ctx.beginPath();
  ctx.roundRect(px, -ph / 2, pw, ph + 10, 15);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.10)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px + pw - 16, 8.5, 3, 0, Math.PI * 2);
  ctx.fillStyle = "#34d399";
  ctx.fill();

  // Name.
  ctx.textAlign = "center";
  ctx.fillStyle = "#f2f2f5";
  ctx.font = "700 24px -apple-system, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif";
  ctx.fillText("Nöbetçi", w / 2, 68);
  const line = ctx.createLinearGradient(w / 2 - 40, 0, w / 2 + 40, 0);
  line.addColorStop(0, "rgba(245, 165, 36, 0)");
  line.addColorStop(0.5, "rgba(245, 165, 36, 0.8)");
  line.addColorStop(1, "rgba(245, 165, 36, 0)");
  ctx.fillStyle = line;
  ctx.fillRect(w / 2 - 40, 80, 80, 1.5);

  // The arrow from the app to Applications: dashed, gently arched.
  const x0 = app.x + 84;
  const x1 = folder.x - 84;
  const y = app.y - 4;
  const grad = ctx.createLinearGradient(x0, 0, x1, 0);
  grad.addColorStop(0, "rgba(245, 165, 36, 0.35)");
  grad.addColorStop(1, "rgba(245, 165, 36, 0.95)");
  ctx.strokeStyle = grad;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  ctx.setLineDash([2, 9]);
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.quadraticCurveTo((x0 + x1) / 2, y - 34, x1 - 6, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(245, 165, 36, 0.95)";
  ctx.beginPath();
  ctx.moveTo(x1 + 6, y + 1);
  ctx.lineTo(x1 - 8, y - 9);
  ctx.lineTo(x1 - 5, y + 7);
  ctx.closePath();
  ctx.fill();

  // Plates under Finder's icon labels: Finder writes them black in Light Mode
  // and white in Dark Mode, and this grey keeps both readable.
  for (const x of [app.x, folder.x]) {
    ctx.beginPath();
    ctx.roundRect(x - 62, app.y + 77, 124, 22, 11);
    ctx.fillStyle = "#8f8f9a";
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // The instruction, in both languages. (The window's title bar takes about
  // 28 points off the bottom, so this sits above that.)
  ctx.fillStyle = "rgba(242, 242, 245, 0.88)";
  ctx.font = "600 14px -apple-system, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif";
  ctx.fillText("Kurmak için Nöbetçi'yi Applications klasörüne sürükle", w / 2, 322);
  ctx.fillStyle = "rgba(242, 242, 245, 0.5)";
  ctx.font = "400 12.5px -apple-system, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif";
  ctx.fillText("Drag Nöbetçi to Applications to install", w / 2, 342);
}

/** One tile: the sidebar's own background under that rectangle, then the owl. */
function tile(engine: OwlEngine): CanvasRenderingContext2D {
  const ctx = canvas(TILE.w, TILE.h);
  ctx.save();
  ctx.translate(-TILE.x, -TILE.y);
  sidebarBackground(ctx);
  ctx.restore();
  drawOwl(ctx, engine, 0, 0);
  return ctx;
}

/**
 * Frames of one animation: the owl settles, then `act` starts it, and frames
 * are taken every `every` steps (60 steps a second) until it is calm again.
 */
function frames(act: (e: OwlEngine) => void, count: number, every: number): CanvasRenderingContext2D[] {
  const engine = new OwlEngine(7);
  engine.setSkin("owl");
  engine.setMood("idle");
  for (let i = 0; i < 240; i++) engine.update(1 / 60);
  const out = [tile(engine)];
  act(engine);
  for (let f = 1; f < count; f++) {
    for (let i = 0; i < every; i++) engine.update(1 / 60);
    out.push(tile(engine));
  }
  return out;
}

/** 24-bit bottom-up BMP, the format NSIS loads. */
function bmp(ctx: CanvasRenderingContext2D): string {
  const { width: w, height: h } = ctx.canvas;
  const px = ctx.getImageData(0, 0, w, h).data;
  const row = Math.ceil((w * 3) / 4) * 4;
  const size = 54 + row * h;
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x42;
  buf[1] = 0x4d;
  dv.setUint32(2, size, true);
  dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, w, true);
  dv.setInt32(22, h, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(34, row * h, true);
  dv.setInt32(38, 3780, true);
  dv.setInt32(42, 3780, true);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;
    const dst = 54 + y * row;
    for (let x = 0; x < w; x++) {
      buf[dst + x * 3] = px[src + x * 4 + 2];
      buf[dst + x * 3 + 1] = px[src + x * 4 + 1];
      buf[dst + x * 3 + 2] = px[src + x * 4];
    }
  }
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Renders every picture and puts them, as JSON of name → base64 BMP, in <pre id="art">. */
export async function renderInstallerArt(): Promise<void> {
  await document.fonts.ready;
  const art: Record<string, string> = {};

  const side = canvas(SIDEBAR.w, SIDEBAR.h);
  sidebarBackground(side);
  // The still sidebar carries a resting owl too, for the moment before the frames start.
  const still = new OwlEngine(7);
  still.setSkin("owl");
  still.setMood("idle");
  for (let i = 0; i < 240; i++) still.update(1 / 60);
  drawOwl(side, still, TILE.x, TILE.y);
  art["sidebar.bmp"] = bmp(side);

  const head = canvas(HEADER.w, HEADER.h);
  head.fillStyle = BG_TOP;
  head.fillRect(0, 0, HEADER.w, HEADER.h);
  const hg = head.createRadialGradient(HEADER.w - 30, 30, 2, HEADER.w - 30, 30, 46);
  hg.addColorStop(0, `rgba(${GLOW}, 0.22)`);
  hg.addColorStop(1, `rgba(${GLOW}, 0)`);
  head.fillStyle = hg;
  head.fillRect(0, 0, HEADER.w, HEADER.h);
  head.save();
  head.translate(HEADER.w - 54, 3);
  still.draw(head, 46, 46 * 1.12);
  head.restore();
  art["header.bmp"] = bmp(head);

  const sequences: [string, OwlEmote | "wave"][] = [
    ["wave", "wave"],
    ["cheer", "approve"],
  ];
  for (const [name, act] of sequences) {
    const list = frames((e) => (act === "wave" ? e.wave() : e.triggerEmote(act)), 22, 5);
    list.forEach((f, i) => (art[`${name}-${String(i).padStart(2, "0")}.bmp`] = bmp(f)));
  }

  // The macOS disk image window, at 1x and 2x (a Retina TIFF is made from both on a Mac).
  for (const scale of [1, 2]) {
    const c = document.createElement("canvas");
    c.width = DMG.w * scale;
    c.height = DMG.h * scale;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.scale(scale, scale);
    dmgBackground(ctx);
    art[scale === 1 ? "dmg.png" : "dmg@2x.png"] = c.toDataURL("image/png").split(",")[1];
  }

  const pre = document.createElement("pre");
  pre.id = "art";
  pre.textContent = JSON.stringify(art);
  document.body.append(pre);
}
