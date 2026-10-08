// Nöbetçi's night-watch owl — a small Canvas 2D character engine.
//
// Geometry is authored in "owl units": the body box is 100 × 100 units centred
// on the origin (y grows downwards) and draw() maps it onto the caller's w × w
// area. Expression is a vector of pose parameters, each chased by its own
// spring, so moods, emotes and pokes blend into one another without hard cuts.
// update() owns all time; draw() is a pure function of the current state.

import { Ease, Spring, clamp, lerp, seg } from "../core/anim";

export type OwlMood =
  | "idle"
  | "working"
  | "thinking"
  | "approval"
  | "danger"
  | "question"
  | "error"
  | "finished"
  | "sleeping"
  | "dizzy";

export type OwlEmote = "happy" | "love" | "annoyed" | "surprised" | "hoot";

const TAU = Math.PI * 2;

// ── Palette ─────────────────────────────────────────────────────────────────

export const OWL_COLORS = {
  headTop: "#6E4428",
  headBottom: "#8E5C36",
  bodyTop: "#7C4D2D",
  bodyBottom: "#C08952",
  belly: "#D8AC72",
  bellyMark: "#9B683B",
  wing: "#5E3921",
  wingTip: "#7A4B2B",
  wingEdge: "#A87647",
  tuftInner: "#4A2B17",
  disc: "#F3E3C6",
  discRim: "#A9753F",
  lid: "#D9BE93",
  line: "#34200F",
  irisRim: "#2A170B",
  iris: "#F7B52F",
  irisAmber: "#FF9116",
  irisRed: "#FF4550",
  pupil: "#140B05",
  beak: "#DE8C45",
  beakDark: "#8A4A1E",
  mouth: "#3A1B0C",
  feet: "#D7934C",
  blush: "#FF8FA6",
} as const;

const FX = {
  z: "#B9C5FF",
  bang: "#FF4F5C",
  question: "#F6F1E6",
  dots: "#C6B4FF",
  sweat: "#8BCBFF",
  star: "#FFD65A",
  heart: "#FF6B8E",
  sound: "#FFE9C8",
} as const;

/** Parse "#rgb", "#rrggbb" or "#rrggbbaa" (the "#" is optional). Invalid input yields black. */
export function hexToRGB(hex: string): [number, number, number] {
  let s = hex.trim();
  if (s.charCodeAt(0) === 35) s = s.slice(1);
  if (/^[0-9a-f]{3,4}$/i.test(s)) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (!/^[0-9a-f]{6}/i.test(s)) return [0, 0, 0];
  const n = parseInt(s.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgb(r: number, g: number, b: number): string {
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

// Iris colours are quantised to a small grid so tint blends never allocate
// a new colour string per frame.
const IRIS_STEPS = 16;
const irisCache: string[] = [];
const [IR0, IG0, IB0] = hexToRGB(OWL_COLORS.iris);
const [IR1, IG1, IB1] = hexToRGB(OWL_COLORS.irisAmber);
const [IR2, IG2, IB2] = hexToRGB(OWL_COLORS.irisRed);

function irisColor(amber: number, red: number): string {
  const ai = Math.round(clamp(amber, 0, 1) * IRIS_STEPS);
  const ri = Math.round(clamp(red, 0, 1) * IRIS_STEPS);
  const key = ai * (IRIS_STEPS + 1) + ri;
  let c = irisCache[key];
  if (c === undefined) {
    const a = ai / IRIS_STEPS;
    const r = ri / IRIS_STEPS;
    c = rgb(
      lerp(lerp(IR0, IR1, a), IR2, r),
      lerp(lerp(IG0, IG1, a), IG2, r),
      lerp(lerp(IB0, IB1, a), IB2, r),
    );
    irisCache[key] = c;
  }
  return c;
}

// ── Geometry (owl units) ────────────────────────────────────────────────────

const GROUND = 48; // feet line; squash and breathing are anchored here
const NECK_Y = 8; // head pivot
const HEAD_CY = -15;
const HEAD_A = 36; // head half-width (also the yaw projection radius)
const HEAD_B = 27; // head half-height
const HEAD_N = 2.4; // superellipse exponent: a wide, slightly boxy owl head
const BODY_CY = 16;
const BODY_A = 30.5;
const BODY_B = 32;
const BODY_EGG = 0.1; // widens the lower half into an egg
const EYE_X = 13.8;
const EYE_Y = -15;
const EYE_R = 10.4;
const DISC_R = 16.6;
const PHI_EYE = Math.asin(EYE_X / HEAD_A);
const COS_EYE = Math.cos(PHI_EYE);
const PHI_TUFT = 0.74;
const SIN_TUFT = Math.sin(PHI_TUFT);
const WING_X = 25;
const WING_Y = 12;

const DIZZY_EP = 2.4; // one swivel + wobble after three quick pokes
const BLINK_DUR = 0.3;
const POKE_DUR = 0.45;
const WAVE_DUR = 1.1;

// Scratch buffer for sampled outlines (shared: drawing is synchronous).
const PTS = new Float32Array(2 * 72);

function headTopY(x: number): number {
  const u = Math.min(1, Math.abs(x) / HEAD_A);
  return HEAD_CY - HEAD_B * Math.pow(1 - Math.pow(u, HEAD_N), 1 / HEAD_N);
}

/** Closed quadratic B-spline through the first n points of PTS. */
function tracePts(ctx: CanvasRenderingContext2D, n: number): void {
  const p = PTS;
  ctx.moveTo((p[2 * n - 2] + p[0]) / 2, (p[2 * n - 1] + p[1]) / 2);
  for (let i = 0; i < n; i++) {
    const j = i + 1 < n ? i + 1 : 0;
    const x = p[2 * i];
    const y = p[2 * i + 1];
    ctx.quadraticCurveTo(x, y, (x + p[2 * j]) / 2, (y + p[2 * j + 1]) / 2);
  }
  ctx.closePath();
}

/** Attack/release envelope over a one-shot of length `dur`. */
function envelope(t: number, dur: number, attack: number, release: number): number {
  return Ease.inOut(seg(t, 0, attack)) * (1 - Ease.inOut(seg(t, dur - release, dur)));
}

/** Half-sine bump over [a, b]. */
function bump(t: number, a: number, b: number): number {
  return t <= a || t >= b ? 0 : Math.sin((Math.PI * (t - a)) / (b - a));
}

// ── Pose vector ─────────────────────────────────────────────────────────────

const P = {
  open: 0, // eyelid openness (1 open … 0 shut)
  squint: 1, // extra closure of the left eye only
  slant: 2, // lid slant: + stern (inner corners low), − sad (outer corners low)
  eye: 3, // eye size multiplier
  pupil: 4, // pupil size multiplier
  happy: 5, // 0..1 morph to ^ ^ eyes
  spiral: 6, // 0..1 morph to spiral eyes
  tuft: 7, // ear tufts: −1 drooped · 0 rest · 1 fully raised
  puff: 8, // feather puff
  tilt: 9, // head roll (rad)
  nod: 10, // head lowered (units)
  wingL: 11, // left wing raise
  wingR: 12, // right wing raise
  amber: 13, // iris tint → amber
  red: 14, // iris tint → red
  gazeX: 15, // gaze bias (−1 left … 1 right)
  gazeY: 16, // gaze bias (−1 down … 1 up)
  blush: 17, // cheek blush
} as const;
type Param = keyof typeof P;
const NP = 18;
const PARAMS = Object.keys(P) as Param[];

const REST: Record<Param, number> = {
  open: 1, squint: 0, slant: 0, eye: 1, pupil: 1, happy: 0, spiral: 0, tuft: 0, puff: 0,
  tilt: 0, nod: 0, wingL: 0, wingR: 0, amber: 0, red: 0, gazeX: 0, gazeY: 0, blush: 0,
};

/** Spring feel per parameter: [response s, damping ratio]. */
const FEEL: Record<Param, readonly [number, number]> = {
  open: [0.2, 0.85], squint: [0.3, 0.9], slant: [0.3, 0.85], eye: [0.3, 0.5],
  pupil: [0.25, 0.7], happy: [0.22, 1], spiral: [0.3, 1], tuft: [0.36, 0.42],
  puff: [0.36, 0.5], tilt: [0.5, 0.62], nod: [0.6, 0.8], wingL: [0.36, 0.55],
  wingR: [0.36, 0.55], amber: [0.4, 1], red: [0.4, 1], gazeX: [0.4, 0.9],
  gazeY: [0.4, 0.9], blush: [0.4, 1],
};

function fullPose(o: Partial<Record<Param, number>>): Float32Array {
  const a = new Float32Array(NP);
  for (const k of PARAMS) a[P[k]] = o[k] ?? REST[k];
  return a;
}

/** Partial pose: unset parameters are NaN and leave the mood pose untouched. */
function overlayPose(o: Partial<Record<Param, number>>): Float32Array {
  const a = new Float32Array(NP).fill(NaN);
  for (const k of PARAMS) {
    const v = o[k];
    if (v !== undefined) a[P[k]] = v;
  }
  return a;
}

const MOODS: readonly OwlMood[] = [
  "idle", "working", "thinking", "approval", "danger",
  "question", "error", "finished", "sleeping", "dizzy",
];
const M_WORK = 1;
const M_THINK = 2;
const M_APPROVAL = 3;
const M_DANGER = 4;
const M_QUESTION = 5;
const M_ERROR = 6;
const M_FINISHED = 7;
const M_SLEEP = 8;
const M_DIZZY = 9;

const MOOD_POSE: Record<OwlMood, Float32Array> = {
  idle: fullPose({}),
  working: fullPose({ open: 0.93, pupil: 0.9, tuft: 0.25 }),
  thinking: fullPose({ open: 0.92, squint: 0.42, tilt: -0.17, gazeX: 0.45, gazeY: 0.75, tuft: 0.1 }),
  approval: fullPose({ eye: 1.12, pupil: 1.06, tuft: 0.7, wingR: 1, amber: 1 }),
  danger: fullPose({
    open: 0.58, slant: 0.62, eye: 1.04, pupil: 0.58, tuft: 1, puff: 1,
    wingL: 0.3, wingR: 0.3, red: 1,
  }),
  question: fullPose({ eye: 1.06, tilt: 0.3, tuft: 0.35, gazeX: -0.3, gazeY: 0.35 }),
  error: fullPose({ open: 0.5, slant: -0.7, tuft: -1, nod: 3, gazeY: -0.75, pupil: 0.95 }),
  finished: fullPose({ happy: 1, tuft: 0.45 }),
  sleeping: fullPose({ open: 0, tuft: -0.35, nod: 4.5, tilt: 0.07 }),
  dizzy: fullPose({ spiral: 1, tuft: -0.25 }),
};

interface EmoteDef {
  dur: number;
  pose: Float32Array;
}

const EMOTES: Record<OwlEmote, EmoteDef> = {
  happy: { dur: 1.2, pose: overlayPose({ happy: 1, tuft: 0.55, spiral: 0 }) },
  love: {
    dur: 1.6,
    pose: overlayPose({ open: 0.8, slant: -0.15, pupil: 1.42, blush: 1, happy: 0, spiral: 0, gazeY: 0 }),
  },
  annoyed: {
    dur: 1.2,
    pose: overlayPose({ open: 0.48, slant: 0, tuft: -0.7, puff: 0.55, happy: 0, gazeX: 0, gazeY: 0 }),
  },
  surprised: {
    dur: 1.1,
    pose: overlayPose({ open: 1, slant: 0, eye: 1.3, pupil: 0.52, tuft: 1, puff: 0.8, happy: 0, squint: 0 }),
  },
  hoot: { dur: 1.4, pose: overlayPose({ open: 0.78, slant: 0, tuft: 0.25, happy: 0, squint: 0 }) },
};

let seedCounter = 0x2f6b1;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Engine ──────────────────────────────────────────────────────────────────

export class OwlEngine {
  /** Where the cursor is horizontally, −1..1 (right = +). */
  lookX = 0;
  /** Where the cursor is vertically, −1..1 (up = +). */
  lookY = 0;
  /** Extra canvas height (px) split above/below the body for particles. */
  overhang = 40;
  /** Called when three pokes land within ~1.2 s. */
  onDizzy: (() => void) | null = null;
  /** Flight pose used by the greeting: 0 perched … 1 wings spread and flapping. */
  flight = 0;

  private _accent: string | null = null;
  private accentDark = "";

  private mood: OwlMood = "idle";
  private t = 0;
  private readonly rnd: () => number;

  private readonly springs: Spring[] = [];
  private readonly target = new Float32Array(NP);
  private readonly moodW = new Float32Array(MOODS.length);

  private readonly yaw = new Spring(0, 0.55, 0.78);
  private readonly pitch = new Spring(0, 0.6, 0.85);
  private readonly pupilX = new Spring(0, 0.14, 0.82);
  private readonly pupilY = new Spring(0, 0.14, 0.82);
  private readonly squash = new Spring(0, 0.34, 0.3); // + squash / − stretch
  private readonly ruffle = new Spring(0, 0.42, 0.4); // transient feather puff
  private readonly jolt = new Spring(0, 0.34, 0.42); // transient head roll

  private emote: OwlEmote | null = null;
  private emoteT = 0;
  private blinkT = -1; // 0..1 progress, −1 idle
  private blinkSide = 0; // 0 both eyes, −1 left only, 1 right only
  private blinkLen = BLINK_DUR;
  private nextBlink = 2.5;
  private hopT = -1;
  private hopDur = 0.35;
  private hopH = 0;
  private hopN = 1;
  private flapT = -1;
  private flapDur = 0.6;
  private flapN = 1;
  private waveT = -1;
  private pokeT = -1;
  private readonly pokes = [-9, -9, -9];
  private pokeI = 0;
  private dizzyT = -1; // poke-triggered dizzy episode
  private spinT = 0; // time spent in the dizzy mood
  private dangerT = 0;
  private breathPh = 0;

  // Per-frame derived values shared by the draw helpers.
  private fYaw = 0;
  private fDizzy = 0;
  private fBeak = 0;
  private fSmall = 0; // 1 at island size, 0 from ~30 px: blends the small-size tweaks

  private cacheCtx: CanvasRenderingContext2D | null = null;
  private gHead: CanvasGradient | string = OWL_COLORS.headBottom;
  private gBody: CanvasGradient | string = OWL_COLORS.bodyBottom;
  private gWing: CanvasGradient | string = OWL_COLORS.wing;

  constructor(seed?: number) {
    this.rnd = mulberry32(seed ?? (seedCounter = (seedCounter * 1103515245 + 12345) >>> 0));
    const rest = MOOD_POSE.idle;
    for (const k of PARAMS) {
      const [resp, damp] = FEEL[k];
      this.springs.push(new Spring(rest[P[k]], resp, damp));
    }
    this.moodW[0] = 1;
    this.nextBlink = 1.5 + this.rnd() * 3;
    this.breathPh = this.rnd() * TAU;
  }

  /** Optional session colour, drawn as a collar band; null = none. */
  get accent(): string | null {
    return this._accent;
  }

  set accent(v: string | null) {
    if (v === this._accent) return;
    this._accent = v;
    if (v !== null) {
      const [r, g, b] = hexToRGB(v);
      this.accentDark = rgb(r * 0.62, g * 0.62, b * 0.62);
    }
  }

  // ── Inputs ──────────────────────────────────────────────────────────────

  setMood(m: OwlMood): void {
    if (m === this.mood || !MOOD_POSE[m]) return;
    this.mood = m;
    switch (m) {
      case "finished":
        this.startHop(7, 0.36, 1);
        this.flapT = 0;
        this.flapDur = 0.62;
        this.flapN = 1;
        break;
      case "danger":
        this.dangerT = this.t;
        this.ruffle.velocity += 7;
        break;
      case "approval":
        this.squash.velocity -= 3.5;
        break;
      case "question":
        this.squash.velocity -= 2;
        break;
      case "error":
        this.squash.velocity += 2.5;
        break;
      case "dizzy":
        this.spinT = 0;
        break;
      default:
        break;
    }
  }

  triggerEmote(e: OwlEmote): void {
    if (!EMOTES[e]) return;
    this.emote = e;
    this.emoteT = 0;
    switch (e) {
      case "happy":
        this.startHop(6, 0.32, 2);
        break;
      case "surprised":
        this.startHop(4, 0.26, 1);
        this.ruffle.velocity += 9;
        break;
      case "annoyed":
        this.ruffle.velocity += 4;
        break;
      case "love":
        this.squash.velocity -= 2.5;
        break;
      case "hoot":
        break;
    }
  }

  blink(): void {
    if (this.blinkT >= 0) return;
    this.blinkT = 0;
    this.blinkSide = 0;
    this.blinkLen = BLINK_DUR;
  }

  poke(): void {
    const t = this.t;
    this.pokes[this.pokeI] = t;
    this.pokeI = (this.pokeI + 1) % this.pokes.length;
    this.pokeT = 0;
    this.squash.velocity += 7;
    this.ruffle.velocity += 10;
    this.jolt.velocity += this.rnd() < 0.5 ? -3 : 3;
    if (this.dizzyT >= 0) return;
    const oldest = Math.min(this.pokes[0], this.pokes[1], this.pokes[2]);
    if (t - oldest <= 1.2) {
      this.dizzyT = 0;
      this.pokes[0] = this.pokes[1] = this.pokes[2] = -9;
      this.emote = null;
      this.onDizzy?.();
    } else {
      this.triggerEmote("annoyed");
    }
  }

  /** Landing squash (greeting). */
  land(strength = 1): void {
    this.squash.velocity += 9 * strength;
    this.ruffle.velocity += 3 * strength;
  }

  /** One-shot wave of the right wing (greeting / hover). */
  wave(): void {
    this.waveT = 0;
  }

  get busy(): boolean {
    if (this.mood !== "sleeping") return true;
    if (
      this.emote !== null || this.blinkT >= 0 || this.hopT >= 0 || this.flapT >= 0 ||
      this.waveT >= 0 || this.pokeT >= 0 || this.dizzyT >= 0 || this.flight > 0
    ) {
      return true;
    }
    if (this.moodW[M_SLEEP] < 0.995) return true;
    for (let i = 0; i < NP; i++) if (!this.springs[i].settled) return true;
    return !(
      this.yaw.settled && this.pitch.settled && this.pupilX.settled && this.pupilY.settled &&
      this.squash.settled && this.ruffle.settled && this.jolt.settled
    );
  }

  // ── Simulation ──────────────────────────────────────────────────────────

  update(dt: number): void {
    if (!(dt > 0)) return; // also rejects NaN
    dt = Math.min(dt, 0.05);
    const t = (this.t += dt);

    const kw = 1 - Math.exp(-dt * 7);
    for (let i = 0; i < MOODS.length; i++) {
      const w = this.moodW[i];
      this.moodW[i] = w + ((MOODS[i] === this.mood ? 1 : 0) - w) * kw;
    }

    // One-shot timers.
    if (this.emote !== null) {
      this.emoteT += dt;
      if (this.emoteT >= EMOTES[this.emote].dur) this.emote = null;
    }
    if (this.dizzyT >= 0) {
      this.dizzyT += dt;
      if (this.dizzyT >= DIZZY_EP) this.dizzyT = -1;
    }
    if (this.mood === "dizzy") this.spinT += dt;
    if (this.pokeT >= 0 && (this.pokeT += dt) > POKE_DUR) this.pokeT = -1;
    if (this.waveT >= 0 && (this.waveT += dt) > WAVE_DUR) this.waveT = -1;
    if (this.flapT >= 0 && (this.flapT += dt) > this.flapDur) this.flapT = -1;
    this.stepHop(dt);
    this.stepBlink(dt);

    const sleepW = this.moodW[M_SLEEP];
    this.breathPh = (this.breathPh + dt * lerp(2.25, 1.55, sleepW)) % TAU;

    // Pose targets: mood, then emote overlay, then transient overrides.
    const tg = this.target;
    tg.set(MOOD_POSE[this.mood]);
    if (this.emote !== null) {
      const def = EMOTES[this.emote];
      const env = envelope(this.emoteT, def.dur, 0.12, 0.3);
      for (let i = 0; i < NP; i++) {
        const v = def.pose[i];
        if (v === v) tg[i] = lerp(tg[i], v, env);
      }
    }
    const ep = this.dizzyT >= 0 ? envelope(this.dizzyT, DIZZY_EP, 0.08, 0.45) : 0;
    if (ep > 0) {
      tg[P.spiral] = lerp(tg[P.spiral], 1, ep);
      tg[P.happy] *= 1 - ep;
      tg[P.open] = lerp(tg[P.open], 1, ep);
      tg[P.slant] *= 1 - ep;
      tg[P.tuft] = lerp(tg[P.tuft], -0.25, ep);
    }
    if (this.pokeT >= 0) tg[P.open] *= 1 - 0.75 * bump(this.pokeT, 0, POKE_DUR);
    tg[P.tuft] += 0.12 * this.moodW[M_APPROVAL] * (0.5 - 0.5 * Math.cos((TAU * t) / 1.3));

    for (let i = 0; i < NP; i++) {
      const s = this.springs[i];
      s.target = tg[i];
      s.step(dt);
    }

    // Gaze: the head follows the cursor slowly, the pupils quickly.
    const awake = 1 - sleepW;
    const wk = this.moodW[M_WORK];
    const lx = clamp(this.lookX, -1, 1) * awake;
    const ly = clamp(this.lookY, -1, 1) * awake;
    this.yaw.target = lx * 0.44 + Math.sin(t * 1.25) * 0.12 * wk;
    this.pitch.target = ly;
    this.pupilX.target = clamp(lx + this.springs[P.gazeX].value + Math.sin(t * 2.6) * 0.8 * wk, -1, 1);
    this.pupilY.target = clamp(ly + this.springs[P.gazeY].value, -1, 1);
    this.yaw.step(dt);
    this.pitch.step(dt);
    this.pupilX.step(dt);
    this.pupilY.step(dt);
    this.squash.step(dt);
    this.ruffle.step(dt);
    this.jolt.step(dt);
  }

  private startHop(height: number, dur: number, count: number): void {
    this.hopT = 0;
    this.hopH = height;
    this.hopDur = dur;
    this.hopN = count;
    this.squash.velocity -= 3;
  }

  private stepHop(dt: number): void {
    if (this.hopT < 0) return;
    const before = Math.floor(this.hopT / this.hopDur);
    this.hopT += dt;
    const after = Math.floor(this.hopT / this.hopDur);
    if (after > before) {
      this.squash.velocity += 0.9 * this.hopH;
      if (after >= this.hopN) this.hopT = -1;
    }
  }

  private stepBlink(dt: number): void {
    if (this.blinkT >= 0) {
      this.blinkT += dt / this.blinkLen;
      if (this.blinkT >= 1) this.blinkT = -1;
      return;
    }
    if (this.mood === "sleeping" || this.mood === "finished" || this.mood === "dizzy") return;
    this.nextBlink -= dt;
    if (this.nextBlink > 0) return;
    this.nextBlink = 2.4 + this.rnd() * 4;
    this.blinkT = 0;
    // Owls sometimes blink one eye at a time.
    const one = this.rnd() < 0.18;
    this.blinkSide = one ? (this.rnd() < 0.5 ? -1 : 1) : 0;
    this.blinkLen = one ? BLINK_DUR * 1.6 : BLINK_DUR;
  }

  private blinkClose(side: number): number {
    if (this.blinkT < 0 || (this.blinkSide !== 0 && this.blinkSide !== side)) return 0;
    const p = this.blinkT;
    return p < 0.4 ? Ease.inOut(p / 0.4) : 1 - Ease.inOut((p - 0.4) / 0.6);
  }

  private hopY(): number {
    if (this.hopT < 0) return 0;
    const p = (this.hopT % this.hopDur) / this.hopDur;
    return -this.hopH * 4 * p * (1 - p);
  }

  /** Full 360° swivel then a wobble, alternating direction each cycle. */
  private static spin(tt: number): number {
    const cyc = 2.4;
    const n = Math.floor(tt / cyc);
    const u = tt - n * cyc;
    const dir = n % 2 === 0 ? 1 : -1;
    if (u < 1.1) return dir * Ease.inOut(u / 1.1) * TAU;
    const v = u - 1.1;
    return dir * (TAU + Math.sin(v * 9) * 0.38 * Math.exp(-v * 2.4));
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  private buildCache(ctx: CanvasRenderingContext2D): void {
    this.cacheCtx = ctx;
    const C = OWL_COLORS;
    const gh = ctx.createLinearGradient(0, -44, 0, 12);
    gh.addColorStop(0, C.headTop);
    gh.addColorStop(1, C.headBottom);
    this.gHead = gh;
    const gb = ctx.createLinearGradient(0, -2, 0, GROUND);
    gb.addColorStop(0, C.bodyTop);
    gb.addColorStop(1, C.bodyBottom);
    this.gBody = gb;
    const gw = ctx.createLinearGradient(0, 0, 0, 30);
    gw.addColorStop(0, C.wing);
    gw.addColorStop(1, C.wingTip);
    this.gWing = gw;
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!(w > 0)) return;
    if (ctx !== this.cacheCtx) this.buildCache(ctx);
    const s = w / 100;
    const px = 1 / s; // one CSS pixel in owl units
    const lod = w <= 24 ? 0 : w <= 64 ? 1 : 2;
    const sp = this.springs;
    const W = this.moodW;
    const t = this.t;

    // Transients.
    const ep = this.dizzyT >= 0 ? envelope(this.dizzyT, DIZZY_EP, 0.08, 0.45) : 0;
    const dz = Math.max(W[M_DIZZY], ep);
    const spin = ep > 0 ? OwlEngine.spin(this.dizzyT) * ep : OwlEngine.spin(this.spinT) * W[M_DIZZY];
    this.fDizzy = dz;
    this.fYaw = this.yaw.value + spin;

    let beak = 0;
    if (this.emote === "hoot") beak = bump(this.emoteT, 0.12, 0.48) + bump(this.emoteT, 0.6, 1.0);
    this.fBeak = beak;
    this.fSmall = clamp((30 - w) / 8, 0, 1);

    const breath = Math.sin(this.breathPh) * lerp(1, 1.8, W[M_SLEEP]);
    const pulse = W[M_APPROVAL] * (0.5 - 0.5 * Math.cos((TAU * t) / 1.3));
    const sq = this.squash.value;
    const puff = Math.max(0, sp[P.puff].value) + Math.max(0, this.ruffle.value) * 0.07;

    let shakeX = Math.sin(t * 3.1) * 1.4 * dz;
    const dW = W[M_DANGER];
    let quiver = 0;
    if (dW > 0.01) {
      const c = (t - this.dangerT) % 1.5;
      if (c < 0.36) {
        const a = Math.sin((c / 0.36) * Math.PI) * dW;
        shakeX += Math.sin(t * 64) * 1.8 * a;
        quiver = Math.sin(t * 51) * 0.1 * a;
      }
    }
    if (this.pokeT >= 0) shakeX += Math.sin(this.pokeT * 75) * 2.2 * (1 - this.pokeT / POKE_DUR);

    const sx = (1 + 0.075 * sq) * (1 + 0.05 * puff + 0.022 * pulse);
    const sy = (1 - 0.09 * sq) * (1 + 0.013 * breath) * (1 + 0.03 * puff + 0.022 * pulse);

    // Wings: pose raise + finish flap + greeting flight + wave.
    let flap = 0;
    if (this.flapT >= 0) {
      const u = ((this.flapT / this.flapDur) * this.flapN) % 1;
      flap = Math.sin(Math.PI * u) * 0.95;
    }
    const fl = clamp(this.flight, 0, 1);
    const flightRaise = fl * (0.95 + 0.42 * Math.sin(t * TAU * 3.3));
    let waveRaise = 0;
    let waveWiggle = 0;
    if (this.waveT >= 0) {
      const env = envelope(this.waveT, WAVE_DUR, 0.18, 0.28);
      waveRaise = 1.0 * env;
      waveWiggle = Math.sin(this.waveT * 17) * 0.28 * env;
    }
    const wiggleR = Math.sin(t * 3.4) * 0.07 * W[M_APPROVAL];
    const wingL = Math.max(sp[P.wingL].value, 0) + flap + flightRaise;
    const wingR = Math.max(sp[P.wingR].value, 0) + flap + flightRaise + waveRaise;

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(s, s);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.save();
    ctx.translate(shakeX, this.hopY());
    ctx.translate(0, GROUND);
    ctx.scale(sx, sy);
    ctx.translate(0, -GROUND);

    this.drawBody(ctx, lod, px, puff);
    this.drawWing(ctx, -1, wingL, 0, lod, px);
    this.drawWing(ctx, 1, wingR, waveWiggle + wiggleR, lod, px);

    // Head.
    const workBob = -Math.abs(Math.sin(t * 3.6)) * 1.2 * W[M_WORK];
    const headDy = sp[P.nod].value - 0.75 * breath - beak * 2.2 + workBob;
    const roll =
      sp[P.tilt].value + this.jolt.value * 0.12 + this.yaw.value * 0.12 +
      Math.sin(t * 5.2) * 0.13 * dz + Math.sin(t * 2) * 0.04 * W[M_FINISHED];
    ctx.save();
    ctx.translate(0, NECK_Y + headDy);
    ctx.rotate(roll);
    ctx.translate(0, -NECK_Y);
    this.drawHead(ctx, lod, px, puff, sp[P.tuft].value, quiver);
    ctx.restore();

    if (this._accent !== null) this.drawCollar(ctx, lod, px, headDy);
    ctx.restore();

    this.drawParticles(ctx, s, h / s, lod);
    ctx.restore();
  }

  private drawBody(ctx: CanvasRenderingContext2D, lod: number, px: number, puff: number): void {
    const C = OWL_COLORS;
    const n = lod === 0 ? 32 : lod === 1 ? 48 : 64;
    const spikes = n / 4;
    const amp = 0.09 * puff;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const lower = Math.max(0, sn);
      const f = 1 + amp * (1 - lower * lower * lower) * (1 - Math.abs(Math.sin((a * spikes) / 2)));
      PTS[2 * i] = BODY_A * c * (1 + BODY_EGG * sn) * f;
      PTS[2 * i + 1] = BODY_CY + BODY_B * sn * (sn < 0 ? f : 1);
    }
    ctx.beginPath();
    tracePts(ctx, n);
    ctx.fillStyle = this.gBody;
    ctx.fill();

    // Belly patch and chevron feather marks.
    ctx.beginPath();
    ctx.ellipse(0, 31, 19.5, 15.5, 0, 0, TAU);
    ctx.fillStyle = C.belly;
    ctx.globalAlpha = lod === 0 ? 0.55 : 0.8;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (lod >= 1) {
      ctx.beginPath();
      const rows = lod === 2 ? 3 : 2;
      for (let r = 0; r < rows; r++) {
        const y = lod === 2 ? 23.5 + r * 7.5 : 26 + r * 9;
        const cnt = r % 2 === 0 ? 3 : 4;
        const gap = lod === 2 ? 8 : 10;
        for (let k = 0; k < cnt; k++) {
          const x = (k - (cnt - 1) / 2) * gap;
          ctx.moveTo(x - 2.6, y - 1.3);
          ctx.lineTo(x, y + 1.1);
          ctx.lineTo(x + 2.6, y - 1.3);
        }
      }
      ctx.strokeStyle = C.bellyMark;
      ctx.lineWidth = Math.max(1.3, 0.8 * px);
      ctx.stroke();

      // Feet.
      ctx.beginPath();
      for (let side = -1; side <= 1; side += 2) {
        for (let k = -1; k <= 1; k++) {
          const x = side * 10 + k * 3.6;
          ctx.moveTo(x + 2.5, GROUND);
          ctx.ellipse(x, GROUND, 2.5, 2.1, 0, 0, TAU);
        }
      }
      ctx.fillStyle = C.feet;
      ctx.fill();
    }
  }

  private drawWing(
    ctx: CanvasRenderingContext2D, side: number, raise: number, wiggle: number, lod: number, px: number,
  ): void {
    const C = OWL_COLORS;
    const r = clamp(raise, 0, 1.5);
    const ang = 0.12 + r * 2.05 + wiggle;
    const len = 1 - 0.24 * Math.min(r, 1); // raised wings foreshorten
    ctx.save();
    ctx.translate(side * WING_X, WING_Y);
    if (side > 0) ctx.scale(-1, 1);
    ctx.rotate(ang);
    ctx.scale(1, len);
    ctx.beginPath();
    ctx.moveTo(0, -3);
    ctx.bezierCurveTo(-9.5, 1, -10, 19, -1.5, 30.5);
    ctx.bezierCurveTo(4.5, 22, 6, 5, 0, -3);
    ctx.closePath();
    ctx.fillStyle = this.gWing;
    ctx.fill();
    if (lod >= 1) {
      // Light leading edge separates the wing from the body.
      ctx.beginPath();
      ctx.moveTo(-1.5, -1);
      ctx.bezierCurveTo(-8.5, 3, -8.8, 18, -1.8, 28.5);
      ctx.strokeStyle = C.wingEdge;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = Math.max(1.2, 0.7 * px);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (lod === 2) {
        ctx.beginPath();
        ctx.moveTo(-5.5, 13);
        ctx.quadraticCurveTo(-2, 15.5, 1.8, 13.5);
        ctx.moveTo(-5.2, 19);
        ctx.quadraticCurveTo(-2, 21.5, 1.2, 19.5);
        ctx.strokeStyle = C.wingTip;
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawHead(
    ctx: CanvasRenderingContext2D, lod: number, px: number, puff: number, tuft: number, quiver: number,
  ): void {
    const C = OWL_COLORS;
    const yaw = this.fYaw;

    // Ear tufts sit behind the head and slide with its yaw.
    const up = Math.max(0, tuft);
    const down = Math.max(0, -tuft);
    const L = 15 * (1 + 0.26 * up - 0.18 * down) * (1 + 0.22 * this.fSmall);
    const lean0 = 0.42 - 0.3 * up + 1.08 * down + quiver;
    for (let side = -1; side <= 1; side += 2) {
      const phi = side * PHI_TUFT + yaw;
      const sn = Math.sin(phi);
      const bx = HEAD_A * sn;
      const by = headTopY(bx) + 3;
      const lean = lean0 * Math.min(1.4, Math.abs(sn) / SIN_TUFT);
      const hw = 7.4 * (0.55 + 0.45 * Math.abs(Math.cos(phi)));
      ctx.save();
      ctx.translate(bx, by);
      if (sn < 0) ctx.scale(-1, 1);
      ctx.rotate(lean);
      ctx.beginPath();
      ctx.moveTo(-hw, 4);
      ctx.quadraticCurveTo(-hw * 0.3, -L * 0.5, hw * 0.15, -L);
      ctx.quadraticCurveTo(hw * 0.95, -L * 0.42, hw, 4);
      ctx.closePath();
      ctx.fillStyle = C.headTop;
      ctx.fill();
      if (lod >= 1) {
        ctx.beginPath();
        ctx.moveTo(-hw * 0.05, 1);
        ctx.quadraticCurveTo(hw * 0.05, -L * 0.5, hw * 0.13, -L * 0.9);
        ctx.quadraticCurveTo(hw * 0.62, -L * 0.42, hw * 0.55, 1);
        ctx.closePath();
        ctx.fillStyle = C.tuftInner;
        ctx.fill();
      }
      ctx.restore();
    }

    // Head silhouette.
    const n = lod === 0 ? 32 : 48;
    const spikes = n / 4;
    const amp = 0.035 * puff;
    const e = 2 / HEAD_N;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const f = 1 + amp * (1 - Math.abs(Math.sin((a * spikes) / 2)));
      PTS[2 * i] = HEAD_A * Math.sign(c) * Math.pow(Math.abs(c), e) * f;
      PTS[2 * i + 1] = HEAD_CY + HEAD_B * Math.sign(sn) * Math.pow(Math.abs(sn), e) * f;
    }
    ctx.beginPath();
    tracePts(ctx, n);
    ctx.fillStyle = this.gHead;
    ctx.fill();

    ctx.save();
    ctx.clip();
    this.drawFace(ctx, lod, px);
    ctx.restore();
  }

  private discPath(
    ctx: CanvasRenderingContext2D,
    xL: number, fL: number, xR: number, fR: number, x0: number, y: number, R: number,
  ): void {
    ctx.beginPath();
    if (fL > 0) {
      ctx.moveTo(xL + R * fL, y);
      ctx.ellipse(xL, y, R * fL, R, 0, 0, TAU);
    }
    if (fR > 0) {
      ctx.moveTo(xR + R * fR, y);
      ctx.ellipse(xR, y, R * fR, R, 0, 0, TAU);
    }
    if (fL > 0 && fR > 0) {
      // Heart-shaped chin: same winding as the ellipses so the union fills.
      ctx.moveTo(xR - R * fR * 0.62, y + R * 0.78);
      ctx.lineTo(x0, y + R + 4.5);
      ctx.lineTo(xL + R * fL * 0.62, y + R * 0.78);
      ctx.closePath();
    }
  }

  private drawFace(ctx: CanvasRenderingContext2D, lod: number, px: number): void {
    const C = OWL_COLORS;
    const sp = this.springs;
    const yaw = this.fYaw;
    const py = -this.pitch.value * 3.2;
    const aL = -PHI_EYE + yaw;
    const aR = PHI_EYE + yaw;
    const cL = Math.cos(aL);
    const cR = Math.cos(aR);
    const c0 = Math.cos(yaw);
    const fL = Math.min(1, cL / COS_EYE);
    const fR = Math.min(1, cR / COS_EYE);
    const xL = HEAD_A * Math.sin(aL);
    const xR = HEAD_A * Math.sin(aR);
    const x0 = HEAD_A * Math.sin(yaw);
    const ey = EYE_Y + py;

    // Facial disc with a darker rim.
    if (lod >= 1) {
      this.discPath(ctx, xL, fL, xR, fR, x0, ey, DISC_R + 1.8);
      ctx.fillStyle = C.discRim;
      ctx.fill();
    }
    this.discPath(ctx, xL, fL, xR, fR, x0, ey, DISC_R);
    ctx.fillStyle = C.disc;
    ctx.fill();

    const blush = sp[P.blush].value;
    if (blush > 0.02) {
      ctx.globalAlpha = 0.55 * Math.min(1, blush);
      ctx.fillStyle = C.blush;
      ctx.beginPath();
      if (fL > 0.1) {
        ctx.moveTo(xL - 3 + 5 * fL, ey + 11.5);
        ctx.ellipse(xL - 3, ey + 11.5, 5 * fL, 2.6, 0, 0, TAU);
      }
      if (fR > 0.1) {
        ctx.moveTo(xR + 3 + 5 * fR, ey + 11.5);
        ctx.ellipse(xR + 3, ey + 11.5, 5 * fR, 2.6, 0, 0, TAU);
      }
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Eyes.
    const r = EYE_R * clamp(sp[P.eye].value, 0.6, 1.5);
    const open = clamp(sp[P.open].value, 0, 1);
    const squint = clamp(sp[P.squint].value, 0, 1);
    if (fL > 0.02) {
      ctx.save();
      ctx.translate(xL, ey);
      ctx.scale(fL, 1);
      this.drawEye(ctx, -1, r, open * (1 - squint) * (1 - this.blinkClose(-1)), lod, px);
      ctx.restore();
    }
    if (fR > 0.02) {
      ctx.save();
      ctx.translate(xR, ey);
      ctx.scale(fR, 1);
      this.drawEye(ctx, 1, r, open * (1 - this.blinkClose(1)), lod, px);
      ctx.restore();
    }

    // Beak.
    if (c0 > 0.05) {
      ctx.save();
      ctx.translate(x0, py);
      ctx.scale(c0, 1);
      this.drawBeak(ctx, this.fBeak, lod, px);
      ctx.restore();
    } else if (c0 < -0.25 && lod >= 1) {
      // Back of the head during a swivel: a small dark feather chevron.
      const xb = -x0;
      ctx.beginPath();
      ctx.moveTo(xb - 6 * -c0, -26);
      ctx.lineTo(xb, -20);
      ctx.lineTo(xb + 6 * -c0, -26);
      ctx.moveTo(xb - 4 * -c0, -15);
      ctx.lineTo(xb, -10);
      ctx.lineTo(xb + 4 * -c0, -15);
      ctx.strokeStyle = C.tuftInner;
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }
  }

  private drawEye(
    ctx: CanvasRenderingContext2D, side: number, r: number, openIn: number, lod: number, px: number,
  ): void {
    const C = OWL_COLORS;
    const sp = this.springs;
    const happy = clamp(sp[P.happy].value, 0, 1);
    const spiral = Math.max(clamp(sp[P.spiral].value, 0, 1), this.fDizzy);
    const slant = sp[P.slant].value;
    // At island size a heavy rim merges both eyes into one band; keep it hairline.
    const rim = lerp(Math.max(1.5, 0.6 * px), 1, this.fSmall);
    const lidColor = lod === 0 ? C.disc : C.lid;
    const o = openIn * (happy < 0.5 ? 1 - 2 * happy : 0);
    const lineW = Math.max(2.1, (lod === 0 ? 1.15 : 0.9) * px);

    if (happy >= 0.5) {
      // ^ eye: a soft lid dome fading out under a bold arc.
      const k = (happy - 0.5) * 2;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = lidColor;
      ctx.beginPath();
      ctx.arc(0, 0, r + rim, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = k;
      ctx.beginPath();
      const hw = lod === 0 ? 0.95 : 0.78;
      ctx.moveTo(-hw * r, 0.3 * r);
      ctx.quadraticCurveTo(0, (lod === 0 ? -0.9 : -0.72) * r, hw * r, 0.3 * r);
      ctx.strokeStyle = C.line;
      ctx.lineWidth = Math.max(2.6, (lod === 0 ? 1.3 : 1.05) * px);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }

    ctx.fillStyle = C.irisRim;
    ctx.beginPath();
    ctx.arc(0, 0, r + rim, 0, TAU);
    ctx.fill();
    ctx.fillStyle = irisColor(sp[P.amber].value, sp[P.red].value);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();

    if (spiral < 0.98) {
      // Pupil follows the gaze, shrinking away as the spiral takes over.
      const pr = r * 0.54 * clamp(sp[P.pupil].value, 0.4, 1.5) * (1 - spiral) * (1 + 0.12 * this.fSmall);
      const reach = Math.max(0, r - pr - 0.6);
      let ox = this.pupilX.value * r * 0.34;
      let oy = -this.pupilY.value * r * 0.34;
      const d = Math.hypot(ox, oy);
      if (d > reach) {
        ox *= reach / d;
        oy *= reach / d;
      }
      ctx.fillStyle = C.pupil;
      ctx.beginPath();
      ctx.arc(ox, oy, pr, 0, TAU);
      ctx.fill();
      if (lod >= 1 || r * 0.22 > 0.45 * px) {
        ctx.fillStyle = "#FFFFFF";
        ctx.beginPath();
        ctx.arc(ox * 0.4 - r * 0.27, oy * 0.4 - r * 0.3, r * (lod === 0 ? 0.26 : 0.21), 0, TAU);
        ctx.fill();
        if (lod === 2) {
          ctx.globalAlpha = 0.8;
          ctx.beginPath();
          ctx.arc(ox * 0.4 + r * 0.2, oy * 0.4 + r * 0.22, r * 0.09, 0, TAU);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
    if (spiral > 0.02) {
      ctx.globalAlpha = spiral;
      ctx.beginPath();
      const rot = this.t * 7 * side;
      const turns = lod === 0 ? 1.6 : 2.4;
      const N = lod === 0 ? 18 : 36;
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const a = u * turns * TAU + rot;
        const rr = (0.12 + 0.76 * u) * r;
        const x = Math.cos(a) * rr;
        const y = Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = C.pupil;
      ctx.lineWidth = Math.max(1.6, 0.7 * px);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Eyelid: feathered lid coming down from the top, optionally slanted.
    const y0 = -r + (1 - o) * 2 * r;
    const ds = slant * r * 0.55;
    const R = r + rim;
    const xin = -side * R;
    const xout = side * R;
    const yin = y0 + ds;
    const yout = y0 - ds;
    if (Math.max(yin, yout) > -R + 0.3) {
      const curve = r * 0.22 * (1 - Math.min(1, Math.abs(slant)));
      const cy = (yin + yout) / 2 + curve;
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(xout, -R - 1);
      ctx.lineTo(xin, -R - 1);
      ctx.lineTo(xin, yin);
      ctx.quadraticCurveTo(0, cy, xout, yout);
      ctx.closePath();
      ctx.fillStyle = lidColor;
      ctx.fill();
      if (o > 0.03) {
        ctx.beginPath();
        ctx.moveTo(xin, yin);
        ctx.quadraticCurveTo(0, cy, xout, yout);
        ctx.strokeStyle = C.line;
        ctx.lineWidth = Math.max(1.8, 0.75 * px);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (o < 0.14) {
      // Closed: a relaxed lash line.
      ctx.globalAlpha = 1 - o / 0.14;
      ctx.beginPath();
      const tilt = -slant * r * 0.25 * side;
      ctx.moveTo(-0.78 * r, -tilt);
      ctx.quadraticCurveTo(0, 0.5 * r, 0.78 * r, tilt);
      ctx.strokeStyle = C.line;
      ctx.lineWidth = lineW;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawBeak(ctx: CanvasRenderingContext2D, open: number, lod: number, px: number): void {
    const C = OWL_COLORS;
    if (open > 0.02) {
      const my = -1.6 + 3 * open;
      const mh = 1 + 4.4 * open;
      ctx.fillStyle = C.mouth;
      ctx.beginPath();
      ctx.ellipse(0, my, 4.2, mh, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = C.beak;
      ctx.beginPath();
      ctx.ellipse(0, my + mh * 0.78, 2.6, 1.3 * open + 0.3, 0, 0, TAU);
      ctx.fill();
    }
    const tip = 1.2 - 2.6 * open;
    const hw = lod === 0 ? 5 : 4.5;
    ctx.beginPath();
    ctx.moveTo(-hw, -9);
    ctx.quadraticCurveTo(0, -11.4, hw, -9);
    ctx.quadraticCurveTo(hw * 0.78, -3.4, 0, tip);
    ctx.quadraticCurveTo(-hw * 0.78, -3.4, -hw, -9);
    ctx.closePath();
    ctx.fillStyle = C.beak;
    ctx.fill();
    if (lod >= 1) {
      ctx.strokeStyle = C.beakDark;
      ctx.lineWidth = Math.max(0.9, 0.45 * px);
      ctx.stroke();
      if (lod === 2) {
        ctx.beginPath();
        ctx.moveTo(-2.2, -8.6);
        ctx.quadraticCurveTo(-1.6, -5.5, -0.5, -3.5);
        ctx.strokeStyle = "rgba(255,230,190,0.55)";
        ctx.lineWidth = 0.9;
        ctx.stroke();
      }
    }
  }

  /** Session colour as a slim collar along the neck line (plus a scarf tail when large). */
  private drawCollar(ctx: CanvasRenderingContext2D, lod: number, px: number, headDy: number): void {
    const y = 14 + headDy * 0.6; // lowest point of the band
    if (lod >= 1) {
      ctx.beginPath();
      ctx.moveTo(8, y - 1);
      ctx.quadraticCurveTo(13, y + 5, 11.5, y + 11);
      ctx.lineTo(16, y + 10);
      ctx.quadraticCurveTo(16.5, y + 4, 13, y - 2);
      ctx.closePath();
      ctx.fillStyle = this.accentDark;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(0, y - 9, 22, 9, 0, 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.strokeStyle = this._accent as string;
    ctx.lineWidth = Math.max(4.2, 2 * px);
    ctx.stroke();
  }

  // ── Particles ───────────────────────────────────────────────────────────

  private drawParticles(ctx: CanvasRenderingContext2D, s: number, hUnits: number, lod: number): void {
    const W = this.moodW;
    const t = this.t;
    // Particles keep a minimum on-screen size in the compact island.
    const k = clamp(0.36 / s, 1, 1.9);
    const top = -hUnits / 2; // canvas top edge in owl units
    const lw = Math.max(1.6 * k, 0.9 / s);

    // Sleeping: z's drifting up and to the right.
    const zw = W[M_SLEEP];
    if (zw > 0.02) {
      ctx.strokeStyle = FX.z;
      ctx.lineWidth = lw;
      const rise = Math.min(30, -34 - top - 4);
      for (let i = 0; i < 3; i++) {
        const q = (t / 2.6 + i / 3) % 1;
        const a = Math.sin(Math.PI * q) * zw;
        if (a < 0.02) continue;
        const sz = (3.6 + 4 * q) * k;
        const x = 20 + q * 15 + Math.sin(q * 5 + i) * 2;
        const y = -34 - q * rise;
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.moveTo(x - sz / 2, y - sz / 2);
        ctx.lineTo(x + sz / 2, y - sz / 2);
        ctx.lineTo(x - sz / 2, y + sz / 2);
        ctx.lineTo(x + sz / 2, y + sz / 2);
        ctx.stroke();
      }
    }

    // Danger: a bold red "!" beside the right tuft, beating with the shake.
    const dw = W[M_DANGER];
    if (dw > 0.02) {
      const c = (t - this.dangerT) % 1.5;
      const beat = 1 + 0.18 * bump(c, 0, 0.36);
      const sz = 17 * k * beat;
      const x = 40;
      const y = -40 - (k - 1) * 4;
      ctx.globalAlpha = dw;
      ctx.fillStyle = FX.bang;
      ctx.beginPath();
      ctx.moveTo(x - sz * 0.13, y - sz * 0.46);
      ctx.quadraticCurveTo(x, y - sz * 0.56, x + sz * 0.13, y - sz * 0.46);
      ctx.lineTo(x + sz * 0.06, y + sz * 0.14);
      ctx.lineTo(x - sz * 0.06, y + sz * 0.14);
      ctx.closePath();
      ctx.moveTo(x + sz * 0.1, y + sz * 0.36);
      ctx.arc(x, y + sz * 0.36, sz * 0.1, 0, TAU);
      ctx.fill();
    }

    // Question: a "?" bobbing above the raised side of the tilted head.
    const qw = W[M_QUESTION];
    if (qw > 0.02) {
      const sz = 15 * k;
      const x = -38;
      const y = -40 + Math.sin(t * 2.4) * 1.6 - (k - 1) * 4;
      ctx.globalAlpha = qw;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(t * 1.7) * 0.12 - 0.12);
      ctx.beginPath();
      ctx.arc(0, -sz * 0.2, sz * 0.24, Math.PI * 1.08, Math.PI * 2.28);
      ctx.quadraticCurveTo(0, -sz * 0.02, 0, sz * 0.14);
      ctx.strokeStyle = FX.question;
      ctx.lineWidth = Math.max(sz * 0.14, 0.9 / s);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, sz * 0.4, sz * 0.085 + 0.25 / s, 0, TAU);
      ctx.fillStyle = FX.question;
      ctx.fill();
      ctx.restore();
    }

    // Thinking: a trail of thought dots lighting up in turn.
    const tw = W[M_THINK];
    if (tw > 0.02) {
      const q = (t / 1.6) % 1;
      ctx.fillStyle = FX.dots;
      for (let i = 0; i < 3; i++) {
        const on = clamp((q - i * 0.22) * 6, 0, 1) * (1 - seg(q, 0.86, 1));
        ctx.globalAlpha = tw * (0.45 + 0.55 * on);
        const rr = (1.6 + i * 0.7) * k;
        ctx.beginPath();
        ctx.arc(31 + i * 6.5, -46 - i * 6 - (k - 1) * 3, rr, 0, TAU);
        ctx.fill();
      }
    }

    // Error: a sweat drop sliding down the side of the head.
    const ew = W[M_ERROR];
    if (ew > 0.02) {
      const q = (t / 2.2) % 1;
      const a = ew * Math.min(1, q * 5) * (1 - seg(q, 0.7, 1));
      if (a > 0.01) {
        const sz = 7.5 * k;
        const x = 36;
        const y = -30 + q * 9;
        ctx.globalAlpha = a;
        ctx.fillStyle = FX.sweat;
        ctx.beginPath();
        ctx.moveTo(x, y - sz * 0.55);
        ctx.bezierCurveTo(x + sz * 0.12, y - sz * 0.25, x + sz * 0.36, y - sz * 0.02, x + sz * 0.36, y + sz * 0.18);
        ctx.arc(x, y + sz * 0.18, sz * 0.36, 0, Math.PI);
        ctx.bezierCurveTo(x - sz * 0.36, y - sz * 0.02, x - sz * 0.12, y - sz * 0.25, x, y - sz * 0.55);
        ctx.fill();
      }
    }

    // Dizzy: little stars circling above the head.
    const dz = this.fDizzy;
    if (dz > 0.02) {
      ctx.fillStyle = FX.star;
      for (let i = 0; i < 3; i++) {
        const a = t * 3.6 + (i * TAU) / 3;
        const front = Math.sin(a);
        const x = Math.cos(a) * 25;
        const y = -47 + front * 5 - (k - 1) * 3;
        const sz = (3.6 + 0.9 * front) * k;
        ctx.globalAlpha = dz * (0.75 + 0.25 * front);
        ctx.beginPath();
        ctx.moveTo(x, y - sz);
        ctx.quadraticCurveTo(x, y, x + sz, y);
        ctx.quadraticCurveTo(x, y, x, y + sz);
        ctx.quadraticCurveTo(x, y, x - sz, y);
        ctx.quadraticCurveTo(x, y, x, y - sz);
        ctx.fill();
      }
    }

    // Emote particles.
    if (this.emote === "love") {
      const u = this.emoteT;
      ctx.fillStyle = FX.heart;
      for (let i = 0; i < 3; i++) {
        const q = (u - i * 0.22) / 1.05;
        if (q <= 0 || q >= 1) continue;
        const x = (i - 1) * 22 + Math.sin(q * 6 + i * 2) * 3;
        const y = -30 - q * 26 - (k - 1) * 3;
        const sz = 11 * k * (0.6 + 0.4 * Ease.out(Math.min(1, q * 3)));
        ctx.globalAlpha = seg(q, 0, 0.12) * (1 - seg(q, 0.65, 1));
        ctx.beginPath();
        ctx.moveTo(x, y + sz * 0.38);
        ctx.bezierCurveTo(x - sz * 0.6, y - sz * 0.02, x - sz * 0.32, y - sz * 0.52, x, y - sz * 0.2);
        ctx.bezierCurveTo(x + sz * 0.32, y - sz * 0.52, x + sz * 0.6, y - sz * 0.02, x, y + sz * 0.38);
        ctx.fill();
      }
    } else if (this.emote === "hoot") {
      const u = this.emoteT;
      ctx.strokeStyle = FX.sound;
      ctx.lineWidth = lw;
      for (let p = 0; p < 2; p++) {
        const q = (u - (p === 0 ? 0.12 : 0.6)) / 0.6;
        if (q <= 0 || q >= 1) continue;
        ctx.globalAlpha = (1 - q) * 0.9;
        for (let side = -1; side <= 1; side += 2) {
          for (let j = 0; j < (lod === 0 ? 1 : 2); j++) {
            const rr = 36 + q * 8 + j * 5;
            const c = side > 0 ? 0 : Math.PI;
            ctx.beginPath();
            ctx.arc(0, -8, rr, c - 0.32, c + 0.32);
            ctx.stroke();
          }
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}
