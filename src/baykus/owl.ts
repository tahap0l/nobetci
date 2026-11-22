// Nöbetçi's night-watch owl — a small Canvas 2D character engine. The owl is
// the default; the other mascots are skins (skins.ts) on the same engine, so
// they share every movement below.
//
// Geometry is authored in "owl units": the body box is 100 × 100 units centred
// on the origin (y grows downwards) and draw() maps it onto the caller's w × w
// area. Expression is a vector of pose parameters, each chased by its own
// spring, so moods, emotes and pokes blend into one another without hard cuts.
// update() owns all time; draw() is a pure function of the current state.
//
// Interruptions blend as well: a hop started in the air carries on from where
// the body is, a new reaction cross-fades from the one it replaces, and ears,
// tails, manes and tentacles trail the body. With the system's "reduce motion"
// setting nothing travels, shakes or spins: moods and reactions still show, as
// changes of expression and badges that fade in place.

import { Ease, Spring, clamp, lerp, seg } from "../core/anim";
import type { MascotTheme } from "../core/mascot-theme";
import { OWL_COLORS, SKINS, type Skin } from "./skins";

export { OWL_COLORS };

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

/**
 * One-shot reactions. `approve` and `deny` are what a person's decision on a
 * permission request looks like: a cheer with a nod, or a stern head shake.
 */
export type OwlEmote = "happy" | "love" | "annoyed" | "surprised" | "hoot" | "approve" | "deny";

const TAU = Math.PI * 2;

// ── Effects palette (the mascot palettes live in skins.ts) ─────────────────

const FX = {
  z: "#B9C5FF",
  bang: "#FF4F5C",
  question: "#F6F1E6",
  dots: "#C6B4FF",
  sweat: "#8BCBFF",
  star: "#FFD65A",
  heart: "#FF6B8E",
  sound: "#FFE9C8",
  ok: "#3DDC84",
  no: "#FF5A67",
  ink: "#FFFFFF",
  huff: "#E8ECF4",
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

// Blends of two palette colours, quantised like the iris so a blend that changes
// every frame never allocates a new string.
const mixCache = new Map<string, string>();

function mixColor(a: string, b: string, t: number): string {
  const q = Math.round(clamp(t, 0, 1) * 16);
  if (q === 0) return a;
  if (q === 16) return b;
  const key = `${a}${b}${q}`;
  let c = mixCache.get(key);
  if (c === undefined) {
    const [r0, g0, b0] = hexToRGB(a);
    const [r1, g1, b1] = hexToRGB(b);
    const u = q / 16;
    c = rgb(lerp(r0, r1, u), lerp(g0, g1, u), lerp(b0, b1, u));
    mixCache.set(key, c);
  }
  return c;
}

/** 0 at or below `a`, 1 at or above `b`, with an eased step in between. */
function smooth(t: number, a: number, b: number): number {
  const x = seg(t, a, b);
  return x * x * (3 - 2 * x);
}

/** An angle brought into (−π, π]: the same direction, without the whole turns. */
function wrapAngle(a: number): number {
  return a - TAU * Math.round(a / TAU);
}

let motionQuery: MediaQueryList | null | undefined;

/** The system's "reduce motion" setting; false where there is no window to ask. */
export function prefersReducedMotion(): boolean {
  if (motionQuery === undefined) {
    try {
      motionQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    } catch {
      motionQuery = null;
    }
  }
  return motionQuery?.matches ?? false;
}

// Iris colours are quantised to a small grid so tint blends never allocate
// a new colour string per frame. One grid per skin: each has its own iris.
const IRIS_STEPS = 16;
const irisCaches = new Map<Skin, string[]>();

function irisColor(skin: Skin, amber: number, red: number): string {
  let cache = irisCaches.get(skin);
  if (!cache) irisCaches.set(skin, (cache = []));
  const ai = Math.round(clamp(amber, 0, 1) * IRIS_STEPS);
  const ri = Math.round(clamp(red, 0, 1) * IRIS_STEPS);
  const key = ai * (IRIS_STEPS + 1) + ri;
  let c = cache[key];
  if (c === undefined) {
    const [r0, g0, b0] = hexToRGB(skin.colors.iris);
    const [r1, g1, b1] = hexToRGB(skin.colors.irisAmber);
    const [r2, g2, b2] = hexToRGB(skin.colors.irisRed);
    const a = ai / IRIS_STEPS;
    const r = ri / IRIS_STEPS;
    c = rgb(lerp(lerp(r0, r1, a), r2, r), lerp(lerp(g0, g1, a), g2, r), lerp(lerp(b0, b1, a), b2, r));
    cache[key] = c;
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
const PHI_EYE = Math.asin(EYE_X / HEAD_A);
const COS_EYE = Math.cos(PHI_EYE);
const PHI_TUFT = 0.74;
const SIN_TUFT = Math.sin(PHI_TUFT);
const WING_X = 25;
const TENTACLES = [-25, -8.5, 8.5, 25] as const; // the octopus's skirt, x of each lobe
const WING_Y = 12;

const DIZZY_EP = 2.4; // one swivel + wobble after three quick pokes
const BLINK_DUR = 0.3;
const POKE_DUR = 0.45;
const WAVE_DUR = 1.1;
const APPROVE_DUR = 1.8;
const DENY_DUR = 1.7;
/** The "no" head shake inside a deny, seconds. */
const SHAKE_DUR = 1.05;
/** How long a reaction takes to hand over to the one that replaces it, seconds. */
const XFADE = 0.18;
/** Anticipation: the crouch before a hop takes off, seconds. */
const CROUCH = 0.07;
/** Between two bounces the feet stay down this long, so the landing squash happens on the ground. */
const GROUND_HOLD = 0.075;
/** Silhouette samples and feather-puff spikes; the same at every size, so nothing jumps while resizing. */
const OUTLINE_N = 48;
const OUTLINE_SPIKES = 12;

// Scratch buffers (shared: drawing is synchronous).
const PTS = new Float32Array(2 * 72);
/** The octopus's skirt: x, y of each lobe this frame. */
const SKIRT = new Float32Array(2 * 4);

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

/** What a reaction does with the head, at `u` seconds into it. */
interface HeadMotion {
  yaw: number;
  nod: number;
  roll: number;
  beak: number;
}

const HEAD_NOW: HeadMotion = { yaw: 0, nod: 0, roll: 0, beak: 0 };
const HEAD_WAS: HeadMotion = { yaw: 0, nod: 0, roll: 0, beak: 0 };

/** Body language of a decision: a head shake for "no", two nods for "yes", an open beak for a hoot. */
function emoteHead(e: OwlEmote | null, u: number, still: boolean, out: HeadMotion): HeadMotion {
  out.yaw = out.nod = out.roll = out.beak = 0;
  if (e === "deny") {
    if (u < SHAKE_DUR && !still) {
      const env = envelope(u, SHAKE_DUR, 0.1, 0.4);
      out.yaw = Math.sin(u * 16) * 0.5 * env;
      out.roll = Math.sin(u * 16 + 0.6) * 0.06 * env;
    }
  } else if (e === "approve") {
    if (!still) {
      out.nod = 3.6 * (bump(u, 0.08, 0.4) + 0.8 * bump(u, 0.46, 0.78));
      out.roll = Math.sin(u * 7) * 0.08 * envelope(u, APPROVE_DUR, 0.15, 0.5);
    }
  } else if (e === "hoot") {
    out.beak = bump(u, 0.12, 0.48) + bump(u, 0.6, 1.0);
  }
  return out;
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
  // Delighted: smiling eyes, rosy cheeks, ears up, both wings in the air.
  approve: {
    dur: APPROVE_DUR,
    pose: overlayPose({
      happy: 1, blush: 0.85, tuft: 1, wingL: 1, wingR: 1, eye: 1.06, slant: 0, squint: 0,
      spiral: 0, red: 0, amber: 0, puff: 0.15, gazeY: 0.2,
    }),
  },
  // Stern: narrowed, frowning eyes, ears pinned back, feathers bristling.
  deny: {
    dur: DENY_DUR,
    pose: overlayPose({
      open: 0.52, slant: 0.85, tuft: -0.6, puff: 0.75, eye: 0.96, pupil: 0.8, happy: 0, spiral: 0,
      red: 0.5, amber: 0, blush: 0, gazeX: 0, gazeY: 0, wingL: 0.35, wingR: 0.35,
    }),
  },
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
  /**
   * Reduced motion: null follows the system's "reduce motion" setting, true or
   * false overrides it. When on, nothing hops, flaps, shakes or spins, nothing
   * moves on its own, and particles fade in place instead of flying.
   */
  reducedMotion: boolean | null = null;
  /**
   * Life of its own: breathing, random blinks and, when idle, the occasional
   * glance, head tilt or flick. Off for pictures that must come out the same on
   * every run (the installer's frames).
   */
  ambient = true;
  /** Idle glances, tilts and flicks (part of `ambient`; scripted scenes can switch just these off). */
  ambientIdle = true;

  private _accent: string | null = null;
  private accentDark = "";
  private skin: Skin = SKINS.owl;

  private mood: OwlMood = "idle";
  private moodI = 0;
  private t = 0;
  private readonly rnd: () => number;
  /** Idle behaviour has its own stream, so blinks and pokes stay as they were for a given seed. */
  private readonly rndIdle: () => number;

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
  /** Follow-through: + appendages trail downwards (the body rises or lands), − they float up (it falls). */
  private readonly lag = new Spring(0, 0.3, 0.32);
  /** A quick flick of one ear, tuft or crest (idle). */
  private readonly flick = new Spring(0, 0.16, 0.28);
  private flickSide = 1;
  /** A flick of the tail (idle). */
  private readonly tailFlick = new Spring(0, 0.24, 0.3);
  /** How far the right wing is up for a wave, eased in and out. */
  private readonly waveAmp = new Spring(0, 0.2, 1);

  private emote: OwlEmote | null = null;
  private emoteT = 0;
  /** The reaction being replaced, faded out over XFADE. */
  private prevEmote: OwlEmote | null = null;
  private prevEmoteT = 0;
  private xfadeT = 0;
  private blinkT = -1; // 0..1 progress, −1 idle
  private blinkSide = 0; // 0 both eyes, −1 left only, 1 right only
  private blinkLen = BLINK_DUR;
  private nextBlink = 2.5;
  // Hops: height above the ground (units) and its speed (units/s, + up) under the
  // current hop's gravity. A new hop kicks from wherever the body is.
  private lift = 0;
  private liftV = 0;
  private hopG = 0;
  private hopH = 0;
  private hopsLeft = 0;
  private crouchT = -1; // seconds of crouch left before the take-off
  private groundT = -1; // seconds left on the ground between two bounces
  private flapT = -1;
  private flapDur = 0.6;
  private flapN = 1;
  private flutter = false; // flap around the raised pose (approve) or one raise from rest (finished)
  private waveT = -1;
  private wavePh = 0;
  private pokeT = -1;
  private readonly pokes = [-9, -9, -9];
  private pokeI = 0;
  private dizzyT = -1; // poke-triggered dizzy episode
  private spinT = 0; // time spent in the dizzy mood
  private dangerT = 0;
  private breathPh = 0;
  /** 1 while the mascot moves on its own (breathing, sways), easing to 0 with reduced motion or ambient off. */
  private live = 1;
  // Idle micro-behaviours.
  private idleWait = 0;
  private nextIdle = 9;
  private idleT = -1;
  private idleLen = 0;
  private glanceX = 0;
  private glanceY = 0;
  private idleTilt = 0;

  // Per-frame derived values shared by the draw helpers.
  private fYaw = 0;
  private fDizzy = 0;
  private fBeak = 0;
  private fSmall = 0; // 1 at island size, 0 from ~30 px: blends the small-size tweaks
  private fStill = false;
  private fD2 = 1; // fine detail that shows from 68 px (fades in from 64 px)

  private cacheCtx: CanvasRenderingContext2D | null = null;
  private gHead: CanvasGradient | string = OWL_COLORS.headBottom;
  private gBody: CanvasGradient | string = OWL_COLORS.bodyBottom;
  private gWing: CanvasGradient | string = OWL_COLORS.wing;

  constructor(seed?: number) {
    const s = seed ?? (seedCounter = (seedCounter * 1103515245 + 12345) >>> 0);
    this.rnd = mulberry32(s);
    this.rndIdle = mulberry32(s ^ 0x5bd1e995);
    const rest = MOOD_POSE.idle;
    for (const k of PARAMS) {
      const [resp, damp] = FEEL[k];
      this.springs.push(new Spring(rest[P[k]], resp, damp));
    }
    this.moodW[0] = 1;
    this.nextBlink = 1.5 + this.rnd() * 3;
    this.breathPh = this.rnd() * TAU;
    this.nextIdle = 7 + this.rndIdle() * 8;
    this.fStill = this.stillNow();
    this.live = this.fStill ? 0 : 1;
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

  private stillNow(): boolean {
    return this.reducedMotion ?? prefersReducedMotion();
  }

  /** A transient kick; with reduced motion only feather puffs remain, and softer. */
  private kick(spring: Spring, v: number): void {
    if (!this.fStill) spring.velocity += v;
    else if (spring === this.ruffle) spring.velocity += v * 0.4;
  }

  // ── Inputs ──────────────────────────────────────────────────────────────

  /** Which mascot to draw. Movement, moods and emotes are the same for all of them. */
  setSkin(theme: MascotTheme): void {
    const skin = Object.prototype.hasOwnProperty.call(SKINS, theme) ? SKINS[theme] : SKINS.owl;
    if (skin === this.skin) return;
    this.skin = skin;
    this.cacheCtx = null; // gradients are per palette
  }

  setMood(m: OwlMood): void {
    if (m === this.mood || !MOOD_POSE[m]) return;
    this.mood = m;
    this.moodI = MOODS.indexOf(m);
    switch (m) {
      case "finished":
        this.startHop(7, 0.36, 1, true);
        this.startFlap(0.62, 1, false);
        break;
      case "danger":
        this.dangerT = this.t;
        this.kick(this.ruffle, 7);
        break;
      case "approval":
        this.kick(this.squash, -3.5);
        break;
      case "question":
        this.kick(this.squash, -2);
        break;
      case "error":
        this.kick(this.squash, 2.5);
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
    this.handOver();
    this.emote = e;
    this.emoteT = 0;
    switch (e) {
      case "happy":
        this.startHop(6, 0.32, 2, true);
        break;
      case "surprised":
        // A startle has no wind-up.
        this.startHop(4, 0.26, 1, false);
        this.kick(this.ruffle, 9);
        break;
      case "annoyed":
        this.kick(this.ruffle, 4);
        break;
      case "love":
        this.kick(this.squash, -2.5);
        break;
      case "hoot":
        break;
      case "approve":
        // Two little jumps for joy, flapping all the way.
        this.startHop(8, 0.34, 2, true);
        this.startFlap(0.95, 3, true);
        this.kick(this.ruffle, 3);
        break;
      case "deny":
        // Puffs up and plants its feet. A blink in progress finishes on its own.
        this.kick(this.squash, 4);
        this.kick(this.ruffle, 8);
        break;
    }
  }

  /** The reaction on screen hands over to the next one instead of vanishing. */
  private handOver(): void {
    if (this.emote === null) return;
    this.prevEmote = this.emote;
    this.prevEmoteT = this.emoteT;
    this.xfadeT = 0;
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
    this.kick(this.squash, 7);
    this.kick(this.ruffle, 10);
    this.kick(this.jolt, this.rnd() < 0.5 ? -3 : 3);
    if (this.dizzyT >= 0) return;
    const oldest = Math.min(this.pokes[0], this.pokes[1], this.pokes[2]);
    if (t - oldest <= 1.2) {
      this.dizzyT = 0;
      this.pokes[0] = this.pokes[1] = this.pokes[2] = -9;
      this.handOver();
      this.emote = null;
      this.onDizzy?.();
    } else {
      this.triggerEmote("annoyed");
    }
  }

  /** Landing squash (greeting). */
  land(strength = 1): void {
    this.kick(this.squash, 9 * strength);
    this.kick(this.ruffle, 3 * strength);
  }

  /** A wave of the right wing (greeting / hover). Waving again keeps the wing up. */
  wave(): void {
    this.waveT = 0;
  }

  /** Nothing is playing and every spring is at rest: the next frame would look like this one. */
  get calm(): boolean {
    if (
      this.emote !== null || this.prevEmote !== null || this.blinkT >= 0 || this.lift > 0 || this.liftV !== 0 ||
      this.crouchT >= 0 || this.groundT >= 0 || this.flapT >= 0 || this.waveT >= 0 || this.pokeT >= 0 ||
      this.dizzyT >= 0 || this.flight > 0 || this.idleT >= 0
    ) {
      return false;
    }
    if (this.moodW[this.moodI] < 0.995) return false;
    if (Math.abs(this.live - (this.ambient && !this.fStill ? 1 : 0)) > 0.002) return false;
    for (let i = 0; i < NP; i++) if (!this.springs[i].settled) return false;
    return (
      this.yaw.settled && this.pitch.settled && this.pupilX.settled && this.pupilY.settled &&
      this.squash.settled && this.ruffle.settled && this.jolt.settled && this.lag.settled &&
      this.flick.settled && this.tailFlick.settled && this.waveAmp.settled
    );
  }

  /**
   * Whether the next frame differs from this one. Awake, the mascot breathes and
   * some moods loop (the working sway, the thinking dots), so it is always busy;
   * asleep, or with reduced motion, it rests once it is calm.
   */
  get busy(): boolean {
    if (!this.calm) return true;
    return this.mood !== "sleeping" && !this.fStill;
  }

  // ── Simulation ──────────────────────────────────────────────────────────

  update(dt: number): void {
    if (!(dt > 0)) return; // also rejects NaN
    dt = Math.min(dt, 0.05);
    const t = (this.t += dt);
    const still = (this.fStill = this.stillNow());

    const kw = 1 - Math.exp(-dt * 7);
    for (let i = 0; i < MOODS.length; i++) {
      const w = this.moodW[i];
      this.moodW[i] = w + ((MOODS[i] === this.mood ? 1 : 0) - w) * kw;
    }
    // Breathing and sways fade out (and back in) rather than stopping dead.
    const liveTo = this.ambient && !still ? 1 : 0;
    this.live += (liveTo - this.live) * (1 - Math.exp(-dt * 3));
    if (Math.abs(this.live - liveTo) < 0.001) this.live = liveTo;

    // One-shot timers.
    if (this.emote !== null) {
      this.emoteT += dt;
      if (this.emoteT >= EMOTES[this.emote].dur) {
        this.emote = null;
        this.emoteT = 0;
      }
    }
    if (this.prevEmote !== null) {
      this.prevEmoteT += dt;
      this.xfadeT += dt;
      if (this.xfadeT >= XFADE || this.prevEmoteT >= EMOTES[this.prevEmote].dur) this.prevEmote = null;
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
    this.stepIdle(dt);

    const sleepW = this.moodW[M_SLEEP];
    if (this.live > 0) this.breathPh = (this.breathPh + dt * lerp(2.25, 1.55, sleepW)) % TAU;

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
    if (!still) tg[P.tuft] += 0.12 * this.moodW[M_APPROVAL] * (0.5 - 0.5 * Math.cos((TAU * t) / 1.3));
    // Wings: a cheer flutters around the raised pose, a finish lifts them once.
    // Both go through the wing springs, so each stroke eases and the last one
    // settles instead of stopping dead, and a new cheer never snaps them down.
    if (this.flapT >= 0) {
      const u = this.flapT / this.flapDur;
      const f = this.flutter
        ? 0.5 * Math.sin(Math.PI * u) * Math.sin(TAU * this.flapN * u)
        : 0.85 * Math.sin(Math.PI * u) ** 2;
      tg[P.wingL] += f;
      tg[P.wingR] += f;
    }
    tg[P.tilt] += this.idleTilt;

    for (let i = 0; i < NP; i++) {
      const s = this.springs[i];
      s.target = tg[i];
      s.step(dt);
    }

    // Gaze: the head follows the cursor slowly, the pupils quickly.
    const awake = 1 - sleepW;
    const wk = still ? 0 : this.moodW[M_WORK];
    const lx = clamp(clamp(this.lookX, -1, 1) + this.glanceX, -1, 1) * awake;
    const ly = clamp(clamp(this.lookY, -1, 1) + this.glanceY, -1, 1) * awake;
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
    // Ears, tails, manes and tentacles trail the body: they hang back while it
    // rises or lands and float up while it drops, then overshoot and settle.
    this.lag.target = still ? 0 : clamp(this.liftV * 0.0045 + this.squash.value * 0.55, -0.6, 0.6);
    this.lag.step(dt);
    this.flick.step(dt);
    this.tailFlick.step(dt);
    this.waveAmp.target = this.waveT >= 0 && this.waveT < WAVE_DUR - 0.28 ? 1 : 0;
    this.waveAmp.step(dt);
    if (this.waveAmp.value > 0.001) this.wavePh += dt * 17;
  }

  /** Starts `count` hops of `height` units, each `dur` seconds in the air. */
  private startHop(height: number, dur: number, count: number, crouch: boolean): void {
    if (this.fStill) return;
    this.hopH = height;
    this.hopG = (8 * height) / (dur * dur);
    this.hopsLeft = count - 1;
    if (this.lift > 0 || this.liftV > 0) {
      // Already in the air: a fresh kick from where the body is, never a drop to the ground.
      this.liftV = Math.max(this.liftV, Math.sqrt(2 * this.hopG * Math.max(0, height - this.lift)));
      this.squash.velocity -= 1.5;
    } else if (this.crouchT < 0 && this.groundT < 0) {
      if (crouch) {
        // Anticipation: the knees bend first, and the take-off comes at the bottom of the crouch.
        this.crouchT = CROUCH;
        this.squash.velocity += 2.6;
      } else {
        this.launch();
      }
    }
    // Crouching or between two bounces: the next take-off uses the new hop.
  }

  private launch(): void {
    this.liftV = Math.sqrt(2 * this.hopG * this.hopH);
    this.squash.velocity -= 3.4; // stretch on the way up
  }

  /** Hops in flight, integrated exactly, so 30, 60 and 144 Hz trace the same path. */
  private stepHop(dt: number): void {
    let rest = dt;
    for (let guard = 0; guard < 8 && rest > 1e-9; guard++) {
      if (this.crouchT >= 0 || this.groundT >= 0) {
        const left = this.crouchT >= 0 ? this.crouchT : this.groundT;
        if (left > rest) {
          if (this.crouchT >= 0) this.crouchT -= rest;
          else this.groundT -= rest;
          return;
        }
        rest -= left;
        this.crouchT = this.groundT = -1;
        this.launch();
        continue;
      }
      if (this.lift <= 0 && this.liftV <= 0) {
        this.lift = 0;
        this.liftV = 0;
        return;
      }
      const g = this.hopG;
      const touch = (this.liftV + Math.sqrt(Math.max(0, this.liftV * this.liftV + 2 * g * this.lift))) / g;
      if (touch > rest) {
        this.lift = Math.max(0, this.lift + this.liftV * rest - 0.5 * g * rest * rest);
        this.liftV -= g * rest;
        return;
      }
      rest -= touch;
      this.lift = 0;
      this.liftV = 0;
      // Contact: the squash starts as the feet touch, and the next bounce waits for it.
      this.squash.velocity += 0.9 * this.hopH;
      if (this.hopsLeft > 0) {
        this.hopsLeft--;
        this.groundT = GROUND_HOLD;
      }
    }
  }

  private startFlap(dur: number, n: number, flutter: boolean): void {
    if (this.fStill) return;
    this.flapT = 0;
    this.flapDur = dur;
    this.flapN = n;
    this.flutter = flutter;
  }

  private stepBlink(dt: number): void {
    if (this.blinkT >= 0) {
      this.blinkT += dt / this.blinkLen;
      if (this.blinkT >= 1) this.blinkT = -1;
      return;
    }
    if (!this.ambient || this.mood === "sleeping" || this.mood === "finished" || this.mood === "dizzy") return;
    this.nextBlink -= dt;
    if (this.nextBlink > 0) return;
    this.nextBlink = 2.4 + this.rnd() * 4;
    this.blinkT = 0;
    // Owls sometimes blink one eye at a time.
    const one = this.rnd() < 0.18;
    this.blinkSide = one ? (this.rnd() < 0.5 ? -1 : 1) : 0;
    this.blinkLen = one ? BLINK_DUR * 1.6 : BLINK_DUR;
  }

  /**
   * Now and then an idle mascot does something small on its own: a glance to
   * one side, a curious head tilt, an ear or tail flick, a wing shuffle. Only
   * when it is idle and nothing else is going on; never asleep, never with
   * reduced motion.
   */
  private stepIdle(dt: number): void {
    const quiet =
      this.ambient && this.ambientIdle && !this.fStill && this.mood === "idle" && this.moodW[0] > 0.98 &&
      this.emote === null && this.prevEmote === null && this.lift === 0 && this.crouchT < 0 &&
      this.groundT < 0 && this.pokeT < 0 && this.dizzyT < 0 && this.flight === 0 && this.flapT < 0 &&
      this.waveT < 0;
    if (this.idleT >= 0) {
      this.idleT += dt;
      if (quiet && this.idleT < this.idleLen) return;
      this.idleT = -1;
      this.glanceX = this.glanceY = this.idleTilt = 0;
      return;
    }
    if (!quiet) {
      this.idleWait = 0;
      return;
    }
    this.idleWait += dt;
    if (this.idleWait < this.nextIdle) return;
    this.idleWait = 0;
    this.nextIdle = 6 + this.rndIdle() * 9;
    const r = this.rndIdle();
    const side = this.rndIdle() < 0.5 ? -1 : 1;
    this.idleT = 0;
    if (r < 0.34) {
      // A look to one side, the pupils first and the head after.
      this.glanceX = side * (0.55 + 0.35 * this.rndIdle());
      this.glanceY = -0.15 + 0.45 * this.rndIdle();
      this.idleLen = 0.9 + 0.7 * this.rndIdle();
    } else if (r < 0.56) {
      this.idleTilt = side * (0.12 + 0.08 * this.rndIdle());
      this.idleLen = 1.2 + 0.6 * this.rndIdle();
    } else if (r < 0.78) {
      // An ear (tuft, crest, crown or mantle) twitches.
      this.flickSide = side;
      this.flick.velocity += 7 + 3 * this.rndIdle();
      this.idleLen = 0.5;
    } else if (r < 0.88 && this.skin.tail !== "none") {
      this.tailFlick.velocity += (5 + 2 * this.rndIdle()) * side;
      this.idleLen = 0.6;
    } else {
      // Settles its feathers: both wings lift a little, one more than the other.
      this.springs[P.wingL].velocity += 2.4;
      this.springs[P.wingR].velocity += 1.6;
      this.ruffle.velocity += 2.5;
      this.idleLen = 0.6;
    }
  }

  private blinkClose(side: number): number {
    if (this.blinkT < 0 || (this.blinkSide !== 0 && this.blinkSide !== side)) return 0;
    const p = this.blinkT;
    return p < 0.4 ? Ease.inOut(p / 0.4) : 1 - Ease.inOut((p - 0.4) / 0.6);
  }

  /** The body's offset from the ground, owl units (negative = up). */
  private hopY(): number {
    return -this.lift;
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
    const C = this.skin.colors;
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
    // Detail fades in with size instead of switching at one pixel: the compact
    // island's 24 px mascot stays the plainest, and the 64 px card mascot and the
    // 68 px overview one blend into each other while the island resizes.
    const d1 = smooth(w, 24, 30);
    const d2 = smooth(w, 64, 68);
    this.fD2 = d2;
    const still = this.fStill;
    const live = this.live;
    const sp = this.springs;
    const W = this.moodW;
    const t = this.t;

    // Transients. The dizzy swivel is a whole turn: its release only unwinds the
    // wobble that is left, never a second turn back.
    const ep = this.dizzyT >= 0 ? envelope(this.dizzyT, DIZZY_EP, 0.08, 0.45) : 0;
    const dz = Math.max(W[M_DIZZY], ep);
    let spin = 0;
    if (!still) {
      if (ep > 0) spin = wrapAngle(OwlEngine.spin(this.dizzyT)) * ep;
      else if (W[M_DIZZY] > 0.001) {
        spin = this.mood === "dizzy" ? OwlEngine.spin(this.spinT) : wrapAngle(OwlEngine.spin(this.spinT)) * W[M_DIZZY];
      }
    }
    this.fDizzy = dz;
    // A reaction's head motion, cross-faded from the one it replaced.
    const head = emoteHead(this.emote, this.emoteT, still, HEAD_NOW);
    if (this.prevEmote !== null) {
      const was = emoteHead(this.prevEmote, this.prevEmoteT, still, HEAD_WAS);
      const k = smooth(this.xfadeT, 0, XFADE);
      head.yaw = lerp(was.yaw, head.yaw, k);
      head.nod = lerp(was.nod, head.nod, k);
      head.roll = lerp(was.roll, head.roll, k);
      head.beak = lerp(was.beak, head.beak, k);
    }
    this.fYaw = this.yaw.value + spin + head.yaw;
    this.fBeak = head.beak;
    this.fSmall = clamp((30 - w) / 8, 0, 1);

    const breath = Math.sin(this.breathPh) * lerp(1, 1.8, W[M_SLEEP]) * live;
    const pulse = still ? 0 : W[M_APPROVAL] * (0.5 - 0.5 * Math.cos((TAU * t) / 1.3));
    const sq = this.squash.value;
    const puff = Math.max(0, sp[P.puff].value) + Math.max(0, this.ruffle.value) * 0.07;
    const lag = this.lag.value;

    let shakeX = still ? 0 : Math.sin(t * 3.1) * 1.4 * dz;
    const dW = W[M_DANGER];
    let quiver = 0;
    if (dW > 0.01 && !still) {
      const c = (t - this.dangerT) % 1.5;
      if (c < 0.36) {
        const a = Math.sin((c / 0.36) * Math.PI) * dW;
        shakeX += Math.sin(t * 64) * 1.8 * a;
        quiver = Math.sin(t * 51) * 0.1 * a;
      }
    }
    if (this.pokeT >= 0 && !still) shakeX += Math.sin(this.pokeT * 75) * 2.2 * (1 - this.pokeT / POKE_DUR);

    const sx = (1 + 0.075 * sq) * (1 + 0.05 * puff + 0.022 * pulse);
    const sy = (1 - 0.09 * sq) * (1 + 0.013 * breath) * (1 + 0.03 * puff + 0.022 * pulse);

    // Wings: pose raise (flaps included, through their springs) + greeting flight + wave.
    const fl = clamp(this.flight, 0, 1);
    const flightRaise = fl * (still ? 0.95 : 0.95 + 0.42 * Math.sin(t * TAU * 3.3));
    const wave = Math.max(0, this.waveAmp.value);
    const waveWiggle = still ? 0 : Math.sin(this.wavePh) * 0.28 * wave;
    const wiggleR = still ? 0 : Math.sin(t * 3.4) * 0.07 * W[M_APPROVAL];
    // A falling body lifts its wings a little, like a parachute.
    const lagWing = Math.max(0, -lag) * 0.35;
    const wingL = Math.max(sp[P.wingL].value, 0) + flightRaise + lagWing;
    const wingR = Math.max(sp[P.wingR].value, 0) + flightRaise + wave + lagWing;

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

    // A tail wags when the mascot is pleased (eased in and out with the joy and
    // the blush), sways a little otherwise, and trails the body on a hop.
    const pleased = clamp(sp[P.happy].value, 0, 1) + 0.8 * clamp(sp[P.blush].value, 0, 1);
    const wag = still ? 0 : Math.sin(t * 10) * 0.22 * Math.min(1, pleased) + Math.sin(t * 1.4) * 0.05 * live;
    this.drawTail(ctx, wag + lag * 0.45 + this.tailFlick.value, d1);
    this.drawBody(ctx, d1, d2, px, puff, lag);
    // Wings fold behind the head; arms would vanish behind a mane or cheek ruff, so they go in front.
    const armsInFront = this.skin.limbs === "arms";
    if (!armsInFront) {
      this.drawWing(ctx, -1, wingL, 0, d1, d2, px);
      this.drawWing(ctx, 1, wingR, waveWiggle + wiggleR, d1, d2, px);
    }

    // Head: it bobs on the neck a beat behind the body.
    const workBob = still ? 0 : -Math.abs(Math.sin(t * 3.6)) * 1.2 * W[M_WORK];
    const headDy = sp[P.nod].value - 0.75 * breath - this.fBeak * 2.2 + workBob + head.nod + lag * 1.1;
    const roll =
      head.roll + sp[P.tilt].value + this.jolt.value * 0.12 + this.yaw.value * 0.12 +
      (still ? 0 : Math.sin(t * 5.2) * 0.13 * dz + Math.sin(t * 2) * 0.04 * W[M_FINISHED]);
    ctx.save();
    ctx.translate(0, NECK_Y + headDy);
    ctx.rotate(roll);
    ctx.translate(0, -NECK_Y);
    this.drawHead(ctx, d1, px, puff, sp[P.tuft].value, quiver, lag);
    ctx.restore();
    if (armsInFront) {
      this.drawWing(ctx, -1, wingL, 0, d1, d2, px);
      this.drawWing(ctx, 1, wingR, waveWiggle + wiggleR, d1, d2, px);
    }

    if (this._accent !== null) this.drawCollar(ctx, d1, px, headDy);
    ctx.restore();

    this.drawParticles(ctx, s, h / s, d1);
    ctx.restore();
  }

  /** Behind the body: a wolf's brush, a lion's tufted tail, a bird's tail feathers. */
  private drawTail(ctx: CanvasRenderingContext2D, wag: number, d1: number): void {
    const C = this.skin.colors;
    switch (this.skin.tail) {
      case "bushy":
        ctx.save();
        ctx.translate(19, 41);
        ctx.rotate(wag);
        ctx.beginPath();
        ctx.moveTo(-2, 1);
        ctx.bezierCurveTo(11, 6, 27, 0, 27, -21);
        ctx.bezierCurveTo(21, -12, 9, -11, -3, -9);
        ctx.closePath();
        ctx.fillStyle = this.gWing;
        ctx.fill();
        if (d1 > 0.01) {
          ctx.globalAlpha = d1;
          ctx.beginPath();
          ctx.moveTo(27, -21);
          ctx.bezierCurveTo(27.5, -11, 22, -4, 15, -2.5);
          ctx.bezierCurveTo(20, -8, 23.5, -13, 27, -21);
          ctx.fillStyle = C.belly;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.restore();
        break;
      case "tuft":
        ctx.save();
        ctx.translate(20, 42);
        ctx.rotate(wag);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(17, 3, 22, -13);
        ctx.strokeStyle = C.bodyTop;
        ctx.lineWidth = 3.6;
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(22.6, -17, 4.4, 6.2, 0.22, 0, TAU);
        ctx.fillStyle = C.mark;
        ctx.fill();
        ctx.restore();
        break;
      case "fan":
        ctx.save();
        ctx.translate(0, 40);
        ctx.rotate(wag * 0.5);
        ctx.beginPath();
        ctx.moveTo(-8, 0);
        ctx.lineTo(8, 0);
        ctx.lineTo(11, 11);
        ctx.lineTo(4, 10);
        ctx.lineTo(0, 13);
        ctx.lineTo(-4, 10);
        ctx.lineTo(-11, 11);
        ctx.closePath();
        ctx.fillStyle = C.wing;
        ctx.fill();
        ctx.restore();
        break;
      default:
        break;
    }
  }

  /**
   * Where the octopus's four skirt lobes are this frame: each sways on its own
   * phase, they spread when it is startled or alert, curl up with joy, droop
   * when it is low and trail the body on a hop.
   */
  private layoutSkirt(puff: number, lag: number): void {
    const sp = this.springs;
    const happy = clamp(sp[P.happy].value, 0, 1);
    const tuft = sp[P.tuft].value;
    const up = Math.max(0, tuft);
    const down = Math.max(0, -tuft);
    const splay = 0.5 * Math.min(1.2, Math.max(0, puff)) + 0.5 * up;
    const live = this.live;
    const t = this.t;
    for (let i = 0; i < 4; i++) {
      const x0 = TENTACLES[i];
      const outer = Math.abs(x0) > 10;
      const side = Math.sign(x0);
      const ph = t * 1.7 + i * 1.9;
      SKIRT[2 * i] = x0 + side * splay * (outer ? 3.2 : 1.2) + Math.sin(ph) * 1.3 * live;
      SKIRT[2 * i + 1] =
        (outer ? 40.5 : 44) + lag * 2.6 + down * 1.8 - happy * (outer ? 3 : 1.4) + Math.cos(ph) * 0.6 * live;
    }
  }

  private drawBody(ctx: CanvasRenderingContext2D, d1: number, d2: number, px: number, puff: number, lag: number): void {
    const C = this.skin.colors;
    const skin = this.skin;
    if (skin.feet === "tentacles") {
      // A skirt of tentacles under the mantle.
      this.layoutSkirt(puff, lag);
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const x = SKIRT[2 * i];
        const y = SKIRT[2 * i + 1];
        ctx.moveTo(x + 9, y);
        ctx.arc(x, y, 9, 0, TAU);
      }
      ctx.fillStyle = this.gBody;
      ctx.fill();
    }
    const n = OUTLINE_N;
    const amp = 0.09 * puff;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const lower = Math.max(0, sn);
      const f = 1 + amp * (1 - lower * lower * lower) * (1 - Math.abs(Math.sin((a * OUTLINE_SPIKES) / 2)));
      PTS[2 * i] = BODY_A * c * (1 + BODY_EGG * sn) * f;
      PTS[2 * i + 1] = BODY_CY + BODY_B * sn * (sn < 0 ? f : 1);
    }
    ctx.beginPath();
    tracePts(ctx, n);
    ctx.fillStyle = this.gBody;
    ctx.fill();

    if (skin.feet === "tentacles") {
      if (d1 > 0.01) {
        ctx.globalAlpha = d1;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const x = SKIRT[2 * i];
          const y = SKIRT[2 * i + 1] + 4.2;
          ctx.moveTo(x + 1.9, y);
          ctx.arc(x, y, 1.9, 0, TAU);
        }
        ctx.fillStyle = C.feet;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      return;
    }

    // Belly patch and chevron feather marks.
    ctx.beginPath();
    ctx.ellipse(0, 31, 19.5, 15.5, 0, 0, TAU);
    ctx.fillStyle = C.belly;
    ctx.globalAlpha = lerp(0.55, 0.8, d1);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (d1 <= 0.01) return;
    ctx.globalAlpha = d1;
    if (skin.feet === "paws") {
      ctx.beginPath();
      for (let side = -1; side <= 1; side += 2) {
        ctx.moveTo(side * 10.5 + 6.8, GROUND - 0.6);
        ctx.ellipse(side * 10.5, GROUND - 0.6, 6.8, 3.8, 0, 0, TAU);
      }
      ctx.fillStyle = C.feet;
      ctx.fill();
      if (d2 > 0.01) {
        ctx.globalAlpha = d1 * d2;
        ctx.beginPath();
        for (let side = -1; side <= 1; side += 2) {
          for (let k = -1; k <= 1; k += 2) {
            ctx.moveTo(side * 10.5 + k * 2.2, GROUND - 1.6);
            ctx.lineTo(side * 10.5 + k * 2.2, GROUND + 1.6);
          }
        }
        ctx.strokeStyle = C.bellyMark;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    } else if (skin.belly !== "chevrons") {
      this.drawTalons(ctx);
    } else {
      // Two rows of chevrons, and a third that fades in on a big mascot; the rows
      // close up as it appears, so the pattern never jumps to new places.
      const y0 = lerp(26, 23.5, d2);
      const dy = lerp(9, 7.5, d2);
      const gap = lerp(10, 8, d2);
      ctx.strokeStyle = C.bellyMark;
      ctx.lineWidth = Math.max(1.3, 0.8 * px);
      for (let r = 0; r < 3; r++) {
        const a = r < 2 ? d1 : d1 * d2;
        if (a <= 0.01) continue;
        ctx.globalAlpha = a;
        ctx.beginPath();
        const y = y0 + r * dy;
        const cnt = r % 2 === 0 ? 3 : 4;
        for (let k = 0; k < cnt; k++) {
          const x = (k - (cnt - 1) / 2) * gap;
          ctx.moveTo(x - 2.6, y - 1.3);
          ctx.lineTo(x, y + 1.1);
          ctx.lineTo(x + 2.6, y - 1.3);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = d1;
      this.drawTalons(ctx);
    }
    ctx.globalAlpha = 1;
  }

  private drawTalons(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath();
    for (let side = -1; side <= 1; side += 2) {
      for (let k = -1; k <= 1; k++) {
        const x = side * 10 + k * 3.6;
        ctx.moveTo(x + 2.5, GROUND);
        ctx.ellipse(x, GROUND, 2.5, 2.1, 0, 0, TAU);
      }
    }
    ctx.fillStyle = this.skin.colors.feet;
    ctx.fill();
  }

  private drawWing(
    ctx: CanvasRenderingContext2D, side: number, raise: number, wiggle: number, d1: number, d2: number, px: number,
  ): void {
    const C = this.skin.colors;
    const limbs = this.skin.limbs;
    const r = clamp(raise, 0, 1.5);
    const ang = 0.12 + r * 2.05 + wiggle;
    const len = 1 - 0.24 * Math.min(r, 1); // raised wings foreshorten
    ctx.save();
    ctx.translate(side * WING_X, WING_Y);
    if (side > 0) ctx.scale(-1, 1);
    ctx.rotate(ang);
    ctx.scale(1, len);
    if (limbs === "arms") {
      // An arm ends in a paw.
      ctx.beginPath();
      ctx.moveTo(0, -3);
      ctx.bezierCurveTo(-8.5, 1, -9, 16, -4.6, 24);
      ctx.quadraticCurveTo(-1.6, 28.5, 1.6, 24.5);
      ctx.bezierCurveTo(4.6, 18, 5.4, 5, 0, -3);
      ctx.closePath();
      ctx.fillStyle = this.gWing;
      ctx.fill();
      if (d1 > 0.01) {
        ctx.globalAlpha = d1;
        ctx.beginPath();
        ctx.ellipse(-1.6, 23.6, 4.3, 3.9, 0, 0, TAU);
        ctx.fillStyle = C.feet;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      return;
    }
    if (limbs === "tentacles") {
      // A tentacle bends along its length: a slow sway of its own, a curl as it
      // is raised, and it trails the body on a hop.
      const b = this.live * Math.sin(this.t * 2.3 + side * 1.3) * 0.16 + r * 0.2 + this.lag.value * 0.35;
      const bx = (y: number) => b * (y / 30) * (y / 30) * 11;
      ctx.beginPath();
      ctx.moveTo(0, -3);
      ctx.bezierCurveTo(-8.5 + bx(1), 1, -9.5 + bx(19), 19, -4 + bx(28.5), 28.5);
      ctx.quadraticCurveTo(-1.5 + bx(32), 32, 1.2 + bx(29), 29);
      ctx.bezierCurveTo(4.4 + bx(22), 22, 5.4 + bx(5), 5, 0, -3);
      ctx.closePath();
      ctx.fillStyle = this.gWing;
      ctx.fill();
      if (d1 > 0.01) {
        // A light rim like a wing's leading edge, so it reads against the body.
        ctx.beginPath();
        ctx.moveTo(-1.5, -1);
        ctx.bezierCurveTo(-8 + bx(3), 3, -8.6 + bx(18), 18, -3.6 + bx(27), 27);
        ctx.strokeStyle = C.wingEdge;
        ctx.globalAlpha = 0.5 * d1;
        ctx.lineWidth = Math.max(1.2, 0.7 * px);
        ctx.stroke();
        ctx.globalAlpha = d1;
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const y = 11 + k * 6.6;
          const x = -1.4 + bx(y);
          ctx.moveTo(x + 1.5, y);
          ctx.arc(x, y, 1.5, 0, TAU);
        }
        ctx.fillStyle = C.feet;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(0, -3);
    ctx.bezierCurveTo(-9.5, 1, -10, 19, -1.5, 30.5);
    ctx.bezierCurveTo(4.5, 22, 6, 5, 0, -3);
    ctx.closePath();
    ctx.fillStyle = this.gWing;
    ctx.fill();
    if (d1 > 0.01) {
      // Light leading edge separates the wing from the body.
      ctx.beginPath();
      ctx.moveTo(-1.5, -1);
      ctx.bezierCurveTo(-8.5, 3, -8.8, 18, -1.8, 28.5);
      ctx.strokeStyle = C.wingEdge;
      ctx.globalAlpha = 0.55 * d1;
      ctx.lineWidth = Math.max(1.2, 0.7 * px);
      ctx.stroke();
      if (d2 > 0.01) {
        ctx.globalAlpha = d1 * d2;
        ctx.beginPath();
        ctx.moveTo(-5.5, 13);
        ctx.quadraticCurveTo(-2, 15.5, 1.8, 13.5);
        ctx.moveTo(-5.2, 19);
        ctx.quadraticCurveTo(-2, 21.5, 1.2, 19.5);
        ctx.strokeStyle = C.wingTip;
        ctx.lineWidth = 1.1;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  private drawHead(
    ctx: CanvasRenderingContext2D, d1: number, px: number, puff: number, tuft: number, quiver: number, lag: number,
  ): void {
    const C = this.skin.colors;
    const skin = this.skin;
    const ears = skin.ears;
    const yaw = this.fYaw;
    // An idle flick twitches one ear (tuft, crest feather) for a moment.
    const flick = this.flick.value;
    const flickOn = (side: number) => (side === this.flickSide ? flick : 0);

    // Ear tufts sit behind the head and slide with its yaw.
    const up = Math.max(0, tuft);
    const down = Math.max(0, -tuft);
    const L = 15 * (1 + 0.26 * up - 0.18 * down) * (1 + 0.22 * this.fSmall);
    const lean0 = 0.42 - 0.3 * up + 1.08 * down + quiver + lag * 0.6;

    if (skin.mane) {
      // A scalloped mane all round the head; it fluffs up with the feather puff
      // and sags a little behind a hop. Small mascots get fewer, bigger scallops,
      // and the two cross-fade between 24 and 30 px.
      const rr = 8.2 * (1 + 0.22 * puff);
      const dy = lag * 1.4;
      ctx.fillStyle = C.mark;
      for (const [lobes, a] of [[10, 1 - d1], [14, d1]] as const) {
        if (a <= 0.01) continue;
        ctx.globalAlpha = a;
        ctx.beginPath();
        for (let i = 0; i < lobes; i++) {
          const ang = ((i + 0.5) / lobes) * TAU;
          const x = Math.cos(ang) * (HEAD_A - 0.5);
          const y = HEAD_CY + Math.sin(ang) * (HEAD_B + 2.5) + dy * (0.5 + 0.5 * Math.sin(ang));
          ctx.moveTo(x + rr, y);
          ctx.arc(x, y, rr, 0, TAU);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (ears === "pointed") {
      // Cheek ruffs: two fur points either side of the jaw.
      ctx.beginPath();
      for (let side = -1; side <= 1; side += 2) {
        const k = side * (1 + 0.12 * puff);
        ctx.moveTo(side * 27, -13);
        ctx.lineTo(k * 43.5, -2 + lag * 1.5);
        ctx.lineTo(side * 33, 0);
        ctx.lineTo(k * 38, 8 + lag * 1.5);
        ctx.lineTo(side * 22, 10);
        ctx.closePath();
      }
      ctx.fillStyle = C.headBottom;
      ctx.fill();
    }
    if (ears === "crest") {
      // Three crest feathers on the crown: they stand up when alert and flatten when low.
      const bx = HEAD_A * Math.sin(yaw) * 0.55 + 3;
      const by = headTopY(bx) + 3.5;
      const CL = 10.5 * (1 + 0.4 * up - 0.3 * down) * (1 + 0.22 * this.fSmall);
      ctx.fillStyle = C.headTop;
      for (let k = -1; k <= 1; k++) {
        const l = CL * (k === 0 ? 1.18 : 1);
        ctx.save();
        ctx.translate(bx + k * 2.6, by);
        ctx.rotate(
          k * (0.5 - 0.22 * up + 0.35 * down) + 0.18 + 0.5 * down + quiver + lag * 0.5 + flick * (k === 0 ? 1 : 0.6),
        );
        ctx.beginPath();
        ctx.moveTo(-2.6, 2);
        ctx.quadraticCurveTo(-3.2, -l * 0.6, 0.8, -l);
        ctx.quadraticCurveTo(3.6, -l * 0.5, 2.6, 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
    if (ears === "none" && skin.brow) {
      // A raptor's hackles: a few crown feathers behind the head that rise when it
      // is alert and lie flat (out of sight) otherwise. They take the place of
      // the ears the other mascots move.
      const show = smooth(up + flick * 0.8, 0.08, 0.6);
      if (show > 0.01) {
        const bx0 = -HEAD_A * Math.sin(yaw) * 0.45;
        ctx.fillStyle = skin.marks === "cap" ? C.mark : C.headTop;
        for (let k = -1; k <= 1; k++) {
          const x = bx0 + k * 8.5;
          const len = (4 + 5 * up) * show * (k === 0 ? 1.15 : 1) * (1 + 0.22 * this.fSmall);
          ctx.save();
          ctx.translate(x, headTopY(x) + 5);
          ctx.rotate(k * 0.42 + quiver + lag * 0.4);
          ctx.beginPath();
          ctx.moveTo(-3, 2);
          ctx.quadraticCurveTo(-2.4, -len * 0.55, 0.4, -len - 3);
          ctx.quadraticCurveTo(2.8, -len * 0.5, 3, 2);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
    }
    for (let side = -1; side <= 1 && (ears === "pointed" || ears === "round"); side += 2) {
      const phi = side * PHI_TUFT + yaw;
      const sn = Math.sin(phi);
      const bx = HEAD_A * sn;
      const by = headTopY(bx) + 3;
      const facing = 0.55 + 0.45 * Math.abs(Math.cos(phi));
      ctx.save();
      ctx.translate(bx, by);
      if (sn < 0) ctx.scale(-1, 1);
      if (ears === "pointed") {
        // Tall triangular ears: pricked when alert, laid back when low.
        const EL = 19 * (1 + 0.16 * up - 0.2 * down) * (1 + 0.22 * this.fSmall);
        const hw = 10.5 * facing;
        ctx.rotate(
          (0.24 - 0.2 * up + 0.95 * down + quiver + lag * 0.5 + flickOn(side)) * Math.min(1.4, Math.abs(sn) / SIN_TUFT),
        );
        ctx.beginPath();
        ctx.moveTo(-hw, 6);
        ctx.quadraticCurveTo(-hw * 0.62, -EL * 0.5, hw * 0.08, -EL);
        ctx.quadraticCurveTo(hw * 0.86, -EL * 0.42, hw, 6);
        ctx.closePath();
        ctx.fillStyle = C.headTop;
        ctx.fill();
        if (d1 > 0.01) {
          ctx.globalAlpha = d1;
          ctx.beginPath();
          ctx.moveTo(-hw * 0.5, 4);
          ctx.quadraticCurveTo(-hw * 0.3, -EL * 0.4, hw * 0.1, -EL * 0.74);
          ctx.quadraticCurveTo(hw * 0.5, -EL * 0.34, hw * 0.56, 4);
          ctx.closePath();
          ctx.fillStyle = C.tuftInner;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      } else {
        // Round ears sitting on the mane.
        const er = 7.6 * (1 + 0.22 * this.fSmall);
        ctx.translate(1.5, -2.5 - 2.2 * up + 2.4 * down + lag * 2 + flickOn(side) * 4);
        ctx.rotate(quiver + flickOn(side) * 0.5);
        ctx.beginPath();
        ctx.ellipse(0, 0, er * facing, er, 0, 0, TAU);
        ctx.fillStyle = C.headTop;
        ctx.fill();
        if (d1 > 0.01) {
          ctx.globalAlpha = d1;
          ctx.beginPath();
          ctx.ellipse(0, 0.6, er * 0.52 * facing, er * 0.52, 0, 0, TAU);
          ctx.fillStyle = C.shade;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      ctx.restore();
    }
    for (let side = -1; side <= 1 && ears === "tufts"; side += 2) {
      const phi = side * PHI_TUFT + yaw;
      const sn = Math.sin(phi);
      const bx = HEAD_A * sn;
      const by = headTopY(bx) + 3;
      const lean = (lean0 + flickOn(side)) * Math.min(1.4, Math.abs(sn) / SIN_TUFT);
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
      if (d1 > 0.01) {
        ctx.globalAlpha = d1;
        ctx.beginPath();
        ctx.moveTo(-hw * 0.05, 1);
        ctx.quadraticCurveTo(hw * 0.05, -L * 0.5, hw * 0.13, -L * 0.9);
        ctx.quadraticCurveTo(hw * 0.62, -L * 0.42, hw * 0.55, 1);
        ctx.closePath();
        ctx.fillStyle = C.tuftInner;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    // Head silhouette. The octopus has no ears: its mantle rises when it is
    // alert, sags when it is low and twitches on a flick instead.
    const n = OUTLINE_N;
    const amp = 0.035 * puff;
    const e = 2 / HEAD_N;
    const crown = skin.feet === "tentacles" ? 1 + 0.1 * up - 0.08 * down + 0.06 * flick : 1;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const f = 1 + amp * (1 - Math.abs(Math.sin((a * OUTLINE_SPIKES) / 2)));
      PTS[2 * i] = HEAD_A * Math.sign(c) * Math.pow(Math.abs(c), e) * f;
      PTS[2 * i + 1] = HEAD_CY + HEAD_B * (sn < 0 ? crown : 1) * Math.sign(sn) * Math.pow(Math.abs(sn), e) * f;
    }
    ctx.beginPath();
    tracePts(ctx, n);
    ctx.fillStyle = this.gHead;
    ctx.fill();

    ctx.save();
    ctx.clip();
    this.drawFace(ctx, d1, px);
    ctx.restore();
  }

  private discPath(
    ctx: CanvasRenderingContext2D,
    xL: number, fL: number, xR: number, fR: number, x0: number, y: number, R: number, chin: boolean,
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
    if (chin && fL > 0 && fR > 0) {
      // Heart-shaped chin: same winding as the ellipses so the union fills.
      ctx.moveTo(xR - R * fR * 0.62, y + R * 0.78);
      ctx.lineTo(x0, y + R + 4.5);
      ctx.lineTo(xL + R * fL * 0.62, y + R * 0.78);
      ctx.closePath();
    }
  }

  private drawFace(ctx: CanvasRenderingContext2D, d1: number, px: number): void {
    const C = this.skin.colors;
    const skin = this.skin;
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

    this.drawMarks(ctx, x0, c0, ey, d1);

    // Facial disc with a darker rim.
    const disc = skin.disc;
    if (d1 > 0.01) {
      ctx.globalAlpha = d1;
      this.discPath(ctx, xL, fL, xR, fR, x0, ey, disc.r + disc.rim, disc.chin);
      ctx.fillStyle = C.discRim;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    this.discPath(ctx, xL, fL, xR, fR, x0, ey, disc.r, disc.chin);
    ctx.fillStyle = C.disc;
    ctx.fill();

    const blush = Math.max(sp[P.blush].value, skin.blush);
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
      this.drawEye(ctx, -1, r, open * (1 - squint) * (1 - this.blinkClose(-1)), d1, px);
      if (skin.brow) this.drawBrow(ctx, -1, r);
      ctx.restore();
    }
    if (fR > 0.02) {
      ctx.save();
      ctx.translate(xR, ey);
      ctx.scale(fR, 1);
      this.drawEye(ctx, 1, r, open * (1 - this.blinkClose(1)), d1, px);
      if (skin.brow) this.drawBrow(ctx, 1, r);
      ctx.restore();
    }

    // Beak.
    if (c0 > 0.05) {
      ctx.save();
      ctx.translate(x0, py);
      ctx.scale(c0, 1);
      this.drawBeak(ctx, this.fBeak, d1, px);
      ctx.restore();
    } else if (c0 < -0.25 && d1 > 0.01) {
      // Back of the head during a swivel: a small dark feather chevron.
      const xb = -x0;
      ctx.globalAlpha = d1;
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
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Head markings: they slide with the head's yaw like the face does, narrow as
   * it turns and fade out before the head shows its back, so a swivel never
   * shows a face patch on the back of the head.
   */
  private drawMarks(ctx: CanvasRenderingContext2D, x0: number, c0: number, ey: number, d1: number): void {
    const C = this.skin.colors;
    const top = HEAD_CY - HEAD_B - 4;
    const edge = HEAD_A + 3;
    const front = clamp(c0 * 4, 0, 1);
    const kx = Math.max(0, c0);
    switch (this.skin.marks) {
      case "blaze":
        if (front > 0.01) {
          // Pale cheeks and a dark blaze running down between the eyes.
          ctx.globalAlpha = front;
          ctx.beginPath();
          ctx.ellipse(x0, ey + 19, 31 * Math.max(0.6, kx), 17.5, 0, 0, TAU);
          ctx.fillStyle = C.shade;
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(x0 - 18 * kx, top);
          ctx.lineTo(x0 + 18 * kx, top);
          ctx.quadraticCurveTo(x0 + 9 * kx, ey - 17, x0, ey - 3);
          ctx.quadraticCurveTo(x0 - 9 * kx, ey - 17, x0 - 18 * kx, top);
          ctx.closePath();
          ctx.fillStyle = C.mark;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        if (c0 < -0.05) {
          // From behind: the dark saddle of fur on the back of the head.
          const xb = -x0;
          ctx.globalAlpha = clamp(-c0 * 4, 0, 1) * 0.9;
          ctx.beginPath();
          ctx.ellipse(xb, HEAD_CY - 6, 24 * -c0 + 4, 15, 0, 0, TAU);
          ctx.fillStyle = C.mark;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        break;
      case "cap":
      case "crown": {
        // A raptor's throat patch (hawk) and the cap over its brow. The cap covers
        // the back of the head too; only its dip towards the beak is a face mark.
        const cap = this.skin.marks === "cap";
        if (cap && front > 0.01) {
          ctx.globalAlpha = front;
          ctx.beginPath();
          ctx.ellipse(x0, HEAD_CY + HEAD_B - 3, 25 * Math.max(0.6, kx), 14.5, 0, 0, TAU);
          ctx.fillStyle = C.shade;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        const side = cap ? HEAD_CY - 7 : HEAD_CY - 13;
        const dip = lerp(side - 4, cap ? ey - 2 : ey - 9, front);
        const reach = 17 * Math.max(0.35, kx);
        ctx.beginPath();
        ctx.moveTo(-edge, top);
        ctx.lineTo(edge, top);
        ctx.lineTo(edge, side);
        ctx.quadraticCurveTo(x0 + reach, side - 9, x0, dip);
        ctx.quadraticCurveTo(x0 - reach, side - 9, -edge, side);
        ctx.closePath();
        ctx.fillStyle = cap ? C.mark : C.shade;
        ctx.fill();
        break;
      }
      case "spots":
        if (d1 <= 0.01 || c0 <= 0.05) break;
        ctx.globalAlpha = d1 * front;
        ctx.beginPath();
        for (const [dx, dy, r] of [[-17, -19, 3.4], [-9, -24, 1.9], [13, -22, 2.6], [21, -15, 1.7]] as const) {
          ctx.moveTo(x0 + dx * c0 + r * c0, HEAD_CY + dy);
          ctx.ellipse(x0 + dx * c0, HEAD_CY + dy, r * c0, r, 0, 0, TAU);
        }
        ctx.fillStyle = C.shade;
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      default:
        break;
    }
  }

  /**
   * A raptor's brow, drawn in the eye's own frame: a dark bar over the eye whose
   * angle and height follow the face. Keen at rest, a frown when stern, raised
   * and softened with joy, lifted in surprise, worried when sad, flat in sleep.
   */
  private drawBrow(ctx: CanvasRenderingContext2D, side: number, r: number): void {
    const sp = this.springs;
    const slant = sp[P.slant].value;
    const happy = clamp(sp[P.happy].value, 0, 1);
    const open = clamp(sp[P.open].value, 0, 1);
    const surprise = clamp((sp[P.eye].value - 1) / 0.3, 0, 1);
    const tuft = sp[P.tuft].value;
    const up = Math.max(0, tuft);
    const down = Math.max(0, -tuft);
    // + inner end low (stern), − inner end high (worried, or delighted).
    const tilt = (0.16 + 0.48 * slant) * (1 - 0.75 * happy) * lerp(0.35, 1, open) - 0.22 * happy - 0.1 * down;
    const lift = r * (0.32 * surprise + 0.16 * happy + 0.08 * up - 0.14 * (1 - open));
    const out = side * (r + 3.4);
    const inn = -side * r * 0.82;
    const base = -r - 2.3 - lift;
    const yo = base - tilt * r * 0.3;
    const yi = base + tilt * r * 0.95;
    ctx.beginPath();
    ctx.moveTo(out, yo - 1.1);
    ctx.lineTo(inn, yi);
    ctx.lineTo(inn, yi + 4);
    ctx.lineTo(out, yo + 2.5);
    ctx.closePath();
    ctx.fillStyle = this.skin.colors.mark;
    ctx.fill();
  }

  private drawEye(
    ctx: CanvasRenderingContext2D, side: number, r: number, openIn: number, d1: number, px: number,
  ): void {
    const C = this.skin.colors;
    const sp = this.springs;
    const happy = clamp(sp[P.happy].value, 0, 1);
    const spiral = Math.max(clamp(sp[P.spiral].value, 0, 1), this.fDizzy);
    const slant = sp[P.slant].value;
    // At island size a heavy rim merges both eyes into one band; keep it hairline.
    const rim = lerp(Math.max(1.5, 0.6 * px), 1, this.fSmall);
    const lidColor = mixColor(C.disc, C.lid, d1);
    const lineW = Math.max(2.1, lerp(1.15, 0.9, d1) * px);
    const R = r + rim;
    const o = openIn;
    // The happy ^: an arc whose shape the lower lid takes on its way up.
    const hw = lerp(0.95, 0.78, d1);
    const ctrl = lerp(-0.9, -0.72, d1);
    const arc = smooth(happy, 0.45, 0.75);

    // From 0.9 on the lower lid covers the whole eye in the colour of the face:
    // only the ^ is left to draw.
    if (happy < 0.9) {
      ctx.fillStyle = C.irisRim;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.fill();
      ctx.fillStyle = irisColor(this.skin, sp[P.amber].value, sp[P.red].value);
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
        const hl = Math.max(d1, r * 0.22 > 0.45 * px ? 1 : 0);
        if (hl > 0.01) {
          ctx.globalAlpha = hl;
          ctx.fillStyle = "#FFFFFF";
          ctx.beginPath();
          ctx.arc(ox * 0.4 - r * 0.27, oy * 0.4 - r * 0.3, r * lerp(0.26, 0.21, d1), 0, TAU);
          ctx.fill();
          if (this.fD2 > 0.01) {
            ctx.globalAlpha = 0.8 * this.fD2;
            ctx.beginPath();
            ctx.arc(ox * 0.4 + r * 0.2, oy * 0.4 + r * 0.22, r * 0.09, 0, TAU);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
      }
      if (spiral > 0.02) {
        ctx.globalAlpha = spiral;
        ctx.beginPath();
        const rot = this.fStill ? 0 : this.t * 7 * side;
        const turns = lerp(1.6, 2.4, d1);
        const N = 36;
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
      if (happy > 0.005) {
        // Joy closes the eye from below, as a smile pushes the cheeks up: the lower
        // lid rises in the shape of the ^, lands on it as the ^ takes over, then
        // covers the rest of the eye in the colour of the face. (A top lid coming
        // down instead read as bored for a few frames of every cheer.)
        const a2 = R + 1;
        const K = (a2 * a2 * (0.3 - ctrl)) / (2 * hw * hw * r);
        const arcApex = ((0.3 + ctrl) / 2) * r;
        const apex =
          happy < 0.6 ? lerp(R + 1, arcApex, smooth(happy, 0, 0.6)) : lerp(arcApex, -1.7 * R, smooth(happy, 0.6, 1));
        const ye = apex + K;
        const yc = apex - K;
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, R, 0, TAU);
        ctx.clip();
        ctx.beginPath();
        ctx.moveTo(-a2, R + 2);
        ctx.lineTo(-a2, ye);
        ctx.quadraticCurveTo(0, yc, a2, ye);
        ctx.lineTo(a2, R + 2);
        ctx.closePath();
        ctx.fillStyle = mixColor(C.disc, C.lid, d1 * (1 - smooth(happy, 0.55, 0.9)));
        ctx.fill();
        if (arc < 0.995) {
          ctx.globalAlpha = 1 - arc;
          ctx.beginPath();
          ctx.moveTo(-a2, ye);
          ctx.quadraticCurveTo(0, yc, a2, ye);
          ctx.strokeStyle = C.line;
          ctx.lineWidth = Math.max(1.8, 0.75 * px);
          ctx.stroke();
          ctx.globalAlpha = 1;
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

    if (arc > 0.005) {
      // ^ eye: a bold arc.
      ctx.globalAlpha = arc;
      ctx.beginPath();
      ctx.moveTo(-hw * r, 0.3 * r);
      ctx.quadraticCurveTo(0, ctrl * r, hw * r, 0.3 * r);
      ctx.strokeStyle = C.line;
      ctx.lineWidth = Math.max(2.6, lerp(1.3, 1.05, d1) * px);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawBeak(ctx: CanvasRenderingContext2D, open: number, d1: number, px: number): void {
    const C = this.skin.colors;
    const kind = this.skin.muzzle;
    const d2 = this.fD2;
    if (kind === "snout" || kind === "jowls") {
      // A soft muzzle with a nose; the mouth opens for a howl or a roar.
      ctx.beginPath();
      if (kind === "snout") {
        ctx.ellipse(0, -3.4, 8.6, 6.4, 0, 0, TAU);
      } else {
        ctx.ellipse(-4.3, -2.8, 5.6, 5.3, 0, 0, TAU);
        ctx.moveTo(4.3 + 5.6, -2.8);
        ctx.ellipse(4.3, -2.8, 5.6, 5.3, 0, 0, TAU);
      }
      ctx.fillStyle = C.muzzle;
      ctx.fill();
      if (open > 0.02) {
        ctx.beginPath();
        ctx.ellipse(0, -1.4 + 1.6 * open, 3 + 0.6 * open, 0.8 + 3 * open, 0, 0, TAU);
        ctx.fillStyle = C.mouth;
        ctx.fill();
      } else if (d1 > 0.01) {
        ctx.globalAlpha = d1;
        ctx.beginPath();
        ctx.moveTo(0, -5.2);
        ctx.lineTo(0, -2.6);
        ctx.moveTo(-3.8, -1.6);
        ctx.quadraticCurveTo(-1.8, -0.4, 0, -2.6);
        ctx.quadraticCurveTo(1.8, -0.4, 3.8, -1.6);
        ctx.strokeStyle = C.line;
        ctx.lineWidth = Math.max(1.1, 0.5 * px);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const nw = kind === "snout" ? 3.4 : 3.9;
      ctx.beginPath();
      ctx.moveTo(-nw, -8.6);
      ctx.quadraticCurveTo(0, -10, nw, -8.6);
      ctx.quadraticCurveTo(nw * 0.6, -5.4, 0, -4.9);
      ctx.quadraticCurveTo(-nw * 0.6, -5.4, -nw, -8.6);
      ctx.closePath();
      ctx.fillStyle = C.nose;
      ctx.fill();
      return;
    }
    if (kind === "smile") {
      ctx.beginPath();
      if (open > 0.02) {
        ctx.ellipse(0, -2.6, 2.2 + 0.8 * open, 0.9 + 2.8 * open, 0, 0, TAU);
        ctx.fillStyle = C.mouth;
        ctx.fill();
      } else {
        ctx.moveTo(-4.2, -3.6);
        ctx.quadraticCurveTo(0, 0.6, 4.2, -3.6);
        ctx.strokeStyle = C.line;
        ctx.lineWidth = Math.max(1.6, 0.7 * px);
        ctx.stroke();
      }
      return;
    }
    if (kind === "hooked") {
      // The same beak, heavier, with a dark hooked tip.
      ctx.translate(0, 2.2);
      ctx.scale(1.34, 1.36);
    }
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
    const hw = lerp(5, 4.5, d1);
    ctx.beginPath();
    ctx.moveTo(-hw, -9);
    ctx.quadraticCurveTo(0, -11.4, hw, -9);
    ctx.quadraticCurveTo(hw * 0.78, -3.4, 0, tip);
    ctx.quadraticCurveTo(-hw * 0.78, -3.4, -hw, -9);
    ctx.closePath();
    ctx.fillStyle = C.beak;
    ctx.fill();
    if (d1 > 0.01) {
      ctx.globalAlpha = d1;
      ctx.strokeStyle = C.beakDark;
      ctx.lineWidth = Math.max(0.9, 0.45 * px);
      ctx.stroke();
      if (d2 > 0.01) {
        ctx.globalAlpha = d1 * d2;
        ctx.beginPath();
        ctx.moveTo(-2.2, -8.6);
        ctx.quadraticCurveTo(-1.6, -5.5, -0.5, -3.5);
        ctx.strokeStyle = "rgba(255,230,190,0.55)";
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.globalAlpha = d1;
      }
      if (kind === "hooked") {
        ctx.beginPath();
        ctx.moveTo(-hw * 0.5, -3.3);
        ctx.quadraticCurveTo(0, -1.9, hw * 0.5, -3.3);
        ctx.quadraticCurveTo(hw * 0.3, -0.9, 0, tip);
        ctx.quadraticCurveTo(-hw * 0.3, -0.9, -hw * 0.5, -3.3);
        ctx.closePath();
        ctx.fillStyle = C.beakDark;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Session colour as a slim collar along the neck line (plus a scarf tail when large). */
  private drawCollar(ctx: CanvasRenderingContext2D, d1: number, px: number, headDy: number): void {
    const y = 14 + headDy * 0.6; // lowest point of the band
    if (d1 > 0.01) {
      ctx.globalAlpha = d1;
      ctx.beginPath();
      ctx.moveTo(8, y - 1);
      ctx.quadraticCurveTo(13, y + 5, 11.5, y + 11);
      ctx.lineTo(16, y + 10);
      ctx.quadraticCurveTo(16.5, y + 4, 13, y - 2);
      ctx.closePath();
      ctx.fillStyle = this.accentDark;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.ellipse(0, y - 9, 22, 9, 0, 0.12 * Math.PI, 0.88 * Math.PI);
    ctx.strokeStyle = this._accent as string;
    ctx.lineWidth = Math.max(4.2, 2 * px);
    ctx.stroke();
  }

  // ── Particles ───────────────────────────────────────────────────────────

  private drawParticles(ctx: CanvasRenderingContext2D, s: number, hUnits: number, d1: number): void {
    const W = this.moodW;
    const t = this.t;
    const still = this.fStill;
    // Particles keep a minimum on-screen size in the compact island.
    const k = clamp(0.36 / s, 1, 1.9);
    const top = -hUnits / 2; // canvas top edge in owl units
    const lw = Math.max(1.6 * k, 0.9 / s);

    // Sleeping: z's drifting up and to the right (three still ones with reduced motion).
    const zw = W[M_SLEEP];
    if (zw > 0.02) {
      ctx.strokeStyle = FX.z;
      ctx.lineWidth = lw;
      const rise = Math.min(30, -34 - top - 4);
      for (let i = 0; i < 3; i++) {
        const q = still ? 0.2 + 0.3 * i : (t / 2.6 + i / 3) % 1;
        const a = (still ? 0.85 : Math.sin(Math.PI * q)) * zw;
        if (a < 0.02) continue;
        const sz = (3.6 + 4 * q) * k;
        const x = 20 + q * 15 + (still ? 0 : Math.sin(q * 5 + i) * 2);
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
      const beat = still ? 1 : 1 + 0.18 * bump(c, 0, 0.36);
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
      const y = -40 + (still ? 0 : Math.sin(t * 2.4) * 1.6) - (k - 1) * 4;
      ctx.globalAlpha = qw;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((still ? 0 : Math.sin(t * 1.7) * 0.12) - 0.12);
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
        const on = still ? 0.6 : clamp((q - i * 0.22) * 6, 0, 1) * (1 - seg(q, 0.86, 1));
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
      const q = still ? 0.3 : (t / 2.2) % 1;
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
        const a = (still ? 0.5 : t * 3.6) + (i * TAU) / 3;
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

    // Reaction particles. The one being replaced keeps playing while it fades.
    if (this.prevEmote !== null) {
      const fade = 1 - smooth(this.xfadeT, 0, XFADE);
      if (fade > 0.01) this.drawEmoteFx(ctx, this.prevEmote, this.prevEmoteT, fade, k, lw, d1);
    }
    if (this.emote !== null) this.drawEmoteFx(ctx, this.emote, this.emoteT, 1, k, lw, d1);
    ctx.globalAlpha = 1;
  }

  private drawEmoteFx(
    ctx: CanvasRenderingContext2D, e: OwlEmote, u: number, alpha: number, k: number, lw: number, d1: number,
  ): void {
    const still = this.fStill;
    if (e === "love") {
      ctx.fillStyle = FX.heart;
      for (let i = 0; i < 3; i++) {
        const q = (u - i * 0.22) / 1.05;
        if (q <= 0 || q >= 1) continue;
        const x = (i - 1) * 22 + (still ? 0 : Math.sin(q * 6 + i * 2) * 3);
        const y = (still ? -40 : -30 - q * 26) - (k - 1) * 3;
        const sz = 11 * k * (still ? 1 : 0.6 + 0.4 * Ease.out(Math.min(1, q * 3)));
        ctx.globalAlpha = alpha * seg(q, 0, 0.12) * (1 - seg(q, 0.65, 1));
        ctx.beginPath();
        ctx.moveTo(x, y + sz * 0.38);
        ctx.bezierCurveTo(x - sz * 0.6, y - sz * 0.02, x - sz * 0.32, y - sz * 0.52, x, y - sz * 0.2);
        ctx.bezierCurveTo(x + sz * 0.32, y - sz * 0.52, x + sz * 0.6, y - sz * 0.02, x, y + sz * 0.38);
        ctx.fill();
      }
    } else if (e === "approve") {
      this.drawApproveFx(ctx, u, alpha, k, lw, d1);
    } else if (e === "deny") {
      this.drawDenyFx(ctx, u, alpha, k, lw, d1);
    } else if (e === "hoot") {
      ctx.strokeStyle = FX.sound;
      ctx.lineWidth = lw;
      for (let p = 0; p < 2; p++) {
        const q = (u - (p === 0 ? 0.12 : 0.6)) / 0.6;
        if (q <= 0 || q >= 1) continue;
        for (let side = -1; side <= 1; side += 2) {
          for (let j = 0; j < 2; j++) {
            // The second ring shows on a mascot big enough for it.
            const a = alpha * (1 - q) * 0.9 * (j === 0 ? 1 : d1);
            if (a <= 0.01) continue;
            ctx.globalAlpha = a;
            const rr = 36 + (still ? 4 : q * 8) + j * 5;
            const c = side > 0 ? 0 : Math.PI;
            ctx.beginPath();
            ctx.arc(0, -8, rr, c - 0.32, c + 0.32);
            ctx.stroke();
          }
        }
      }
    }
  }

  /** A green badge with a tick that draws itself, and sparkles bursting outwards. */
  private drawApproveFx(
    ctx: CanvasRenderingContext2D, u: number, alpha: number, k: number, lw: number, d1: number,
  ): void {
    const still = this.fStill;
    const fade = alpha * (1 - seg(u, APPROVE_DUR - 0.45, APPROVE_DUR)) * (still ? seg(u, 0, 0.15) : 1);
    const pop = still ? 1 : u < 0.32 ? Ease.back(seg(u, 0, 0.32)) : 1;
    const r = 9.5 * k * pop;
    const x = 0;
    const y = -55 - (k - 1) * 4 - (still ? 0 : 4 * Ease.out(seg(u, 0, 0.5)));
    if (r > 0.1) {
      ctx.globalAlpha = fade;
      ctx.fillStyle = FX.ok;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      // The tick draws itself in two strokes.
      const d = seg(u, 0.12, 0.5);
      ctx.strokeStyle = FX.ink;
      ctx.lineWidth = Math.max(lw * 1.25, r * 0.22);
      ctx.beginPath();
      const a = [x - r * 0.45, y + r * 0.02];
      const b = [x - r * 0.12, y + r * 0.34];
      const c = [x + r * 0.5, y - r * 0.32];
      const first = Math.min(1, d / 0.35);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(lerp(a[0], b[0], first), lerp(a[1], b[1], first));
      if (d > 0.35) {
        const second = (d - 0.35) / 0.65;
        ctx.lineTo(lerp(b[0], c[0], second), lerp(b[1], c[1], second));
      }
      ctx.stroke();
    }
    if (d1 <= 0.01 || still) return;
    // Sparkles: eight four-point stars flying out from the badge and twinkling
    // away. Those that fly upwards stop short of the canvas's top edge.
    ctx.fillStyle = FX.star;
    for (let i = 0; i < 8; i++) {
      const q = seg(u, 0.18 + (i % 2) * 0.06, 1.25 + (i % 3) * 0.1);
      if (q <= 0 || q >= 1) continue;
      const ang = (i / 8) * TAU + 0.3;
      const dist = (14 + 24 * Ease.out(q)) * k;
      const sn = Math.sin(ang);
      const sx = x + Math.cos(ang) * dist;
      const sy = y + sn * dist * (sn < 0 ? 0.5 : 0.8) + 8 * q * q;
      const sz = (i % 2 ? 2.6 : 3.6) * k * (1 - q) * (0.7 + 0.3 * Math.sin(u * 30 + i));
      ctx.globalAlpha = fade * d1 * (1 - q * 0.6);
      ctx.beginPath();
      ctx.moveTo(sx, sy - sz);
      ctx.quadraticCurveTo(sx, sy, sx + sz, sy);
      ctx.quadraticCurveTo(sx, sy, sx, sy + sz);
      ctx.quadraticCurveTo(sx, sy, sx - sz, sy);
      ctx.quadraticCurveTo(sx, sy, sx, sy - sz);
      ctx.fill();
    }
  }

  /** A red badge with a cross that shakes along with the head, and huffs of steam. */
  private drawDenyFx(ctx: CanvasRenderingContext2D, u: number, alpha: number, k: number, lw: number, d1: number): void {
    const still = this.fStill;
    const fade = alpha * (1 - seg(u, DENY_DUR - 0.4, DENY_DUR)) * (still ? seg(u, 0, 0.15) : 1);
    const pop = still ? 1 : u < 0.28 ? Ease.back(seg(u, 0, 0.28)) : 1;
    const r = 9.5 * k * pop;
    const shake = u < SHAKE_DUR && !still ? Math.sin(u * 16) * 3 * envelope(u, SHAKE_DUR, 0.1, 0.4) : 0;
    const x = shake;
    const y = -55 - (k - 1) * 4;
    if (r > 0.1) {
      ctx.globalAlpha = fade;
      ctx.fillStyle = FX.no;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      const d = seg(u, 0.1, 0.42);
      const arm = r * 0.4;
      ctx.strokeStyle = FX.ink;
      ctx.lineWidth = Math.max(lw * 1.25, r * 0.22);
      ctx.beginPath();
      const one = Math.min(1, d * 2);
      ctx.moveTo(x - arm, y - arm);
      ctx.lineTo(x - arm + 2 * arm * one, y - arm + 2 * arm * one);
      if (d > 0.5) {
        const two = (d - 0.5) * 2;
        ctx.moveTo(x + arm, y - arm);
        ctx.lineTo(x + arm - 2 * arm * two, y - arm + 2 * arm * two);
      }
      ctx.stroke();
    }
    if (d1 <= 0.01 || still) return;
    // Two huffs puffing out from either side of the head.
    ctx.fillStyle = FX.huff;
    for (let side = -1; side <= 1; side += 2) {
      for (let j = 0; j < 3; j++) {
        const q = seg(u, 0.25 + j * 0.12, 0.95 + j * 0.12);
        if (q <= 0 || q >= 1) continue;
        const px = side * (40 + 16 * Ease.out(q) + j * 2);
        const py = -12 - 10 * q - j * 3;
        ctx.globalAlpha = fade * d1 * 0.7 * (1 - q);
        ctx.beginPath();
        ctx.arc(px, py, (2.6 + 3.4 * q) * k * (1 - j * 0.18), 0, TAU);
        ctx.fill();
      }
    }
  }
}
