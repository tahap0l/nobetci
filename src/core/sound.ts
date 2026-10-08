// Synthesised sounds. No audio files: every cue is a few oscillators and an
// envelope, so the app ships nothing it did not make itself and each sound can
// be tuned in code.
//
// The AudioContext is suspended whenever the island goes quiet — a running one
// keeps an audio thread busy even when silent.

export type SoundName =
  | "hoot"
  | "peek"
  | "open"
  | "close"
  | "approval"
  | "danger"
  | "allow"
  | "deny"
  | "finish"
  | "error"
  | "tick"
  | "poke"
  | "dizzy"
  | "blip";

type Wave = OscillatorType;

interface Note {
  /** Start offset, seconds. */
  at: number;
  freq: number;
  /** Frequency to glide to by the end of the note. */
  to?: number;
  dur: number;
  wave?: Wave;
  gain?: number;
  /** Vibrato depth in Hz (owl hoots wobble a little). */
  vibrato?: number;
}

const SOUNDS: Record<SoundName, Note[]> = {
  // Two soft, breathy notes: "hu — huuu".
  hoot: [
    { at: 0, freq: 392, to: 370, dur: 0.22, wave: "sine", gain: 0.9, vibrato: 4 },
    { at: 0.3, freq: 370, to: 330, dur: 0.5, wave: "sine", gain: 1, vibrato: 6 },
  ],
  peek: [{ at: 0, freq: 620, to: 880, dur: 0.09, wave: "sine", gain: 0.5 }],
  open: [
    { at: 0, freq: 440, to: 660, dur: 0.12, wave: "triangle", gain: 0.45 },
  ],
  close: [
    { at: 0, freq: 620, to: 400, dur: 0.12, wave: "triangle", gain: 0.4 },
  ],
  approval: [
    { at: 0, freq: 659, dur: 0.14, wave: "triangle", gain: 0.7 },
    { at: 0.16, freq: 880, dur: 0.22, wave: "triangle", gain: 0.7 },
  ],
  danger: [
    { at: 0, freq: 880, dur: 0.11, wave: "square", gain: 0.25 },
    { at: 0.16, freq: 880, dur: 0.11, wave: "square", gain: 0.25 },
    { at: 0.32, freq: 698, dur: 0.24, wave: "square", gain: 0.25 },
  ],
  allow: [
    { at: 0, freq: 523, dur: 0.08, wave: "sine", gain: 0.6 },
    { at: 0.08, freq: 784, dur: 0.16, wave: "sine", gain: 0.6 },
  ],
  deny: [{ at: 0, freq: 330, to: 220, dur: 0.22, wave: "triangle", gain: 0.6 }],
  finish: [
    { at: 0, freq: 523, dur: 0.12, wave: "sine", gain: 0.55 },
    { at: 0.1, freq: 659, dur: 0.12, wave: "sine", gain: 0.55 },
    { at: 0.2, freq: 784, dur: 0.12, wave: "sine", gain: 0.55 },
    { at: 0.3, freq: 1047, dur: 0.3, wave: "sine", gain: 0.5 },
  ],
  error: [
    { at: 0, freq: 196, dur: 0.18, wave: "sawtooth", gain: 0.22 },
    { at: 0.2, freq: 165, dur: 0.3, wave: "sawtooth", gain: 0.22 },
  ],
  tick: [{ at: 0, freq: 1400, dur: 0.025, wave: "sine", gain: 0.25 }],
  poke: [{ at: 0, freq: 900, to: 1300, dur: 0.07, wave: "sine", gain: 0.5 }],
  dizzy: [
    { at: 0, freq: 500, to: 900, dur: 0.25, wave: "sine", gain: 0.4, vibrato: 30 },
    { at: 0.25, freq: 900, to: 400, dur: 0.35, wave: "sine", gain: 0.4, vibrato: 30 },
  ],
  blip: [{ at: 0, freq: 740, dur: 0.05, wave: "sine", gain: 0.35 }],
};

class SoundEngine {
  enabled = true;
  volume = 0.35;
  /** Cues switched off one by one in Settings. */
  private muted = new Set<string>();
  /** Do-not-disturb, quiet hours or a full-screen app: stay silent. */
  quiet = false;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private idleTimer: number | null = null;

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = window.AudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    const master = ctx.createGain();
    // Synth cues are louder than recorded ones would be; keep the ceiling low.
    master.gain.value = this.volume * 0.5;
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    return ctx;
  }

  /** WebView2 can hand us a suspended context; call after any user input. */
  resume() {
    this.cancelIdle();
    void this.ctx?.resume();
  }

  /** The island went quiet: suspend after the tail of whatever just played. */
  idle() {
    if (!this.ctx || this.ctx.state !== "running" || this.idleTimer != null) return;
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      void this.ctx?.suspend();
    }, 1500);
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume * 0.5;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
  }

  setMuted(names: string[]) {
    this.muted = new Set(names);
  }

  play(name: SoundName) {
    if (!this.enabled || this.quiet || this.volume <= 0 || this.muted.has(name)) return;
    this.force(name);
  }

  /** Plays regardless of mute and quiet — the preview buttons in Settings. */
  force(name: SoundName) {
    const ctx = this.ensure();
    const master = this.master;
    if (!ctx || !master) return;
    this.cancelIdle();
    if (ctx.state === "suspended") void ctx.resume();

    const t0 = ctx.currentTime + 0.01;
    for (const n of SOUNDS[name]) this.note(ctx, master, t0, n);
  }

  private note(ctx: AudioContext, out: AudioNode, t0: number, n: Note) {
    const start = t0 + n.at;
    const end = start + n.dur;
    const osc = ctx.createOscillator();
    osc.type = n.wave ?? "sine";
    osc.frequency.setValueAtTime(n.freq, start);
    if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, end);

    const env = ctx.createGain();
    const peak = n.gain ?? 0.5;
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.02, n.dur / 3));
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    let lfo: OscillatorNode | null = null;
    if (n.vibrato) {
      lfo = ctx.createOscillator();
      lfo.frequency.value = 7;
      const depth = ctx.createGain();
      depth.gain.value = n.vibrato;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(start);
      lfo.stop(end + 0.02);
    }

    osc.connect(env).connect(out);
    osc.start(start);
    osc.stop(end + 0.02);
  }

  private cancelIdle() {
    if (this.idleTimer != null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

export const Sound = new SoundEngine();
