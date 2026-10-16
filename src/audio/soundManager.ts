/**
 * Web Audio API procedural sound synthesizer
 * 100% zero-dependency, zero-404 audio synthesis for martial arts combat
 */

type Variation = { pitch: number; level: number };

type NoiseSpec = {
  type: BiquadFilterType;
  freq: number;
  sweepTo?: number;
  q: number;
  dur: number;
  peak: number;
};

type ToneSpec = {
  type: OscillatorType;
  from: number;
  to: number;
  dur: number;
  peak: number;
  formant?: number;
};

type HitProfile = {
  noise: NoiseSpec;
  thump: ToneSpec;
  sub?: ToneSpec;
  click: number;
};

type SwingSpec = { from: number; to: number; q: number; dur: number };

type HurtProfile = { f0: number; formant: number; dur: number; peak: number; crunch: number };

const HIT_PROFILES: Readonly<Record<string, HitProfile>> = {
  jab: {
    noise: { type: 'bandpass', freq: 2800, q: 1.2, dur: 0.03, peak: 0.5 },
    thump: { type: 'sine', from: 190, to: 80, dur: 0.09, peak: 0.35 },
    click: 0.22,
  },
  cross: {
    noise: { type: 'bandpass', freq: 1800, q: 1, dur: 0.045, peak: 0.55 },
    thump: { type: 'sine', from: 140, to: 48, dur: 0.16, peak: 0.65 },
    click: 0.18,
  },
  uppercut: {
    noise: { type: 'bandpass', freq: 1100, sweepTo: 2600, q: 0.9, dur: 0.05, peak: 0.5 },
    thump: { type: 'sine', from: 110, to: 55, dur: 0.22, peak: 0.65 },
    click: 0.14,
  },
  low_kick: {
    noise: { type: 'bandpass', freq: 900, q: 0.9, dur: 0.05, peak: 0.5 },
    thump: { type: 'sine', from: 120, to: 50, dur: 0.17, peak: 0.6 },
    click: 0.12,
  },
  roundhouse: {
    noise: { type: 'bandpass', freq: 700, q: 0.8, dur: 0.06, peak: 0.55 },
    thump: { type: 'sine', from: 100, to: 40, dur: 0.26, peak: 0.75 },
    sub: { type: 'sine', from: 55, to: 26, dur: 0.25, peak: 0.35 },
    click: 0.1,
  },
  axe_kick: {
    noise: { type: 'bandpass', freq: 500, q: 0.7, dur: 0.07, peak: 0.6 },
    thump: { type: 'sine', from: 80, to: 28, dur: 0.42, peak: 0.9 },
    sub: { type: 'sine', from: 45, to: 22, dur: 0.45, peak: 0.6 },
    click: 0.08,
  },
};

const SWING_PROFILES: Readonly<Record<string, SwingSpec>> = {
  jab: { from: 1600, to: 700, q: 1.5, dur: 0.08 },
  cross: { from: 1300, to: 500, q: 1.2, dur: 0.11 },
  uppercut: { from: 500, to: 1800, q: 1.2, dur: 0.14 },
  low_kick: { from: 900, to: 350, q: 1, dur: 0.16 },
  roundhouse: { from: 700, to: 250, q: 0.9, dur: 0.2 },
  axe_kick: { from: 500, to: 180, q: 0.8, dur: 0.22 },
};

const HURT_PROFILES: Readonly<Record<string, HurtProfile>> = {
  jab: { f0: 280, formant: 1000, dur: 0.08, peak: 0.26, crunch: 0.14 },
  cross: { f0: 250, formant: 900, dur: 0.1, peak: 0.28, crunch: 0.16 },
  low_kick: { f0: 220, formant: 800, dur: 0.11, peak: 0.3, crunch: 0.18 },
  uppercut: { f0: 170, formant: 650, dur: 0.14, peak: 0.34, crunch: 0.22 },
  roundhouse: { f0: 150, formant: 600, dur: 0.15, peak: 0.36, crunch: 0.24 },
  axe_kick: { f0: 120, formant: 520, dur: 0.16, peak: 0.38, crunch: 0.26 },
};

// Unknown attack ids fall back to the cross profile
function pickProfile<T>(table: Readonly<Record<string, T>>, id: string | undefined, fallback: T): T {
  return id !== undefined && Object.prototype.hasOwnProperty.call(table, id) ? table[id] : fallback;
}

class SoundManager {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  public enabled: boolean = true;
  public volume: number = 0.7;

  private initContext() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // Returns the context when a sound should play, null when muted or unavailable
  private acquireContext(): AudioContext | null {
    if (!this.enabled) return null;
    this.initContext();
    return this.ctx;
  }

  // Random variation per playback: +-8% pitch, +-10% level
  private variation(): Variation {
    return {
      pitch: 1 + (Math.random() * 2 - 1) * 0.08,
      level: this.volume * (1 + (Math.random() * 2 - 1) * 0.1),
    };
  }

  // One second of white noise, created once and reused by every noise layer
  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuffer) {
      const length = ctx.sampleRate;
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buffer;
    }
    return this.noiseBuffer;
  }

  // Exponential envelope. exponentialRampToValueAtTime cannot reach 0, so it bottoms out at 0.001
  private envelope(param: AudioParam, t: number, peak: number, attack: number, release: number): void {
    param.setValueAtTime(0.001, t);
    param.exponentialRampToValueAtTime(Math.max(peak, 0.001), t + attack);
    param.exponentialRampToValueAtTime(0.001, t + attack + release);
  }

  private noiseLayer(ctx: AudioContext, t: number, v: Variation, spec: NoiseSpec): void {
    const source = ctx.createBufferSource();
    source.buffer = this.getNoiseBuffer(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = spec.type;
    filter.Q.setValueAtTime(spec.q, t);
    filter.frequency.setValueAtTime(spec.freq * v.pitch, t);
    if (spec.sweepTo !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(spec.sweepTo * v.pitch, t + spec.dur);
    }

    const gain = ctx.createGain();
    this.envelope(gain.gain, t, spec.peak * v.level, 0.002, spec.dur);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(t);
    source.stop(t + spec.dur + 0.02);
  }

  private toneLayer(ctx: AudioContext, t: number, v: Variation, spec: ToneSpec): void {
    const osc = ctx.createOscillator();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.from * v.pitch, t);
    osc.frequency.exponentialRampToValueAtTime(spec.to * v.pitch, t + spec.dur);

    const gain = ctx.createGain();
    this.envelope(gain.gain, t, spec.peak * v.level, 0.004, spec.dur);

    osc.connect(gain);
    if (spec.formant !== undefined) {
      const formant = ctx.createBiquadFilter();
      formant.type = 'bandpass';
      formant.Q.setValueAtTime(2.5, t);
      formant.frequency.setValueAtTime(spec.formant * v.pitch, t);
      gain.connect(formant);
      formant.connect(ctx.destination);
    } else {
      gain.connect(ctx.destination);
    }
    osc.start(t);
    osc.stop(t + spec.dur + 0.02);
  }

  // Layered impact: noise slap, pitched thump, short transient click
  public playHit(attackId: string): void {
    const ctx = this.acquireContext();
    if (!ctx) return;

    const profile = pickProfile(HIT_PROFILES, attackId, HIT_PROFILES.cross);
    const t = ctx.currentTime;
    const v = this.variation();

    this.noiseLayer(ctx, t, v, profile.noise);
    this.noiseLayer(ctx, t, v, { type: 'highpass', freq: 3500, q: 0.7, dur: 0.006, peak: profile.click });
    this.toneLayer(ctx, t, v, profile.thump);
    if (profile.sub) {
      this.toneLayer(ctx, t, v, profile.sub);
    }
  }

  // Air whoosh: bandpass noise sweeping across frequency
  public playSwing(attackId: string): void {
    const ctx = this.acquireContext();
    if (!ctx) return;

    const swing = pickProfile(SWING_PROFILES, attackId, SWING_PROFILES.cross);
    this.noiseLayer(ctx, ctx.currentTime, this.variation(), {
      type: 'bandpass',
      freq: swing.from,
      sweepTo: swing.to,
      q: swing.q,
      dur: swing.dur,
      peak: 0.18,
    });
  }

  // Dull lowpass thud with a short wood/glove rebound, scaled by the attack weight
  public playBlock(attackId?: string): void {
    const ctx = this.acquireContext();
    if (!ctx) return;

    const weight = pickProfile(HIT_PROFILES, attackId, HIT_PROFILES.cross).thump.peak / HIT_PROFILES.cross.thump.peak;
    const t = ctx.currentTime;
    const v = this.variation();

    this.noiseLayer(ctx, t, v, { type: 'lowpass', freq: 600, q: 0.7, dur: 0.06, peak: 0.5 * weight });
    this.toneLayer(ctx, t, v, { type: 'sine', from: 150, to: 90, dur: 0.12, peak: 0.45 * weight });
    this.toneLayer(ctx, t + 0.035, v, { type: 'triangle', from: 380, to: 300, dur: 0.07, peak: 0.12 });
  }

  // Short vocal grunt with a falling pitch through a formant, plus a cloth/bone crunch
  public playHurt(attackId: string): void {
    const ctx = this.acquireContext();
    if (!ctx) return;

    const hurt = pickProfile(HURT_PROFILES, attackId, HURT_PROFILES.cross);
    const t = ctx.currentTime;
    const v = this.variation();

    this.toneLayer(ctx, t, v, {
      type: 'sawtooth',
      from: hurt.f0,
      to: hurt.f0 * 0.6,
      dur: hurt.dur,
      peak: hurt.peak,
      formant: hurt.formant,
    });
    this.noiseLayer(ctx, t, v, { type: 'bandpass', freq: 2400, q: 0.9, dur: 0.03, peak: hurt.crunch });
  }

  // Blocked / deflected hit. Replaces the old metallic ring with a dull thud
  public playParry() {
    this.playBlock();
  }

  public playJab() {
    this.playHit('jab');
  }

  public playKick() {
    this.playHit('roundhouse');
  }

  public playUppercut() {
    this.playHit('uppercut');
  }

  // 360 Finisher: deep impact with a short decaying tail
  public playFinisher() {
    const ctx = this.acquireContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const v = this.variation();

    this.toneLayer(ctx, t, v, { type: 'sine', from: 90, to: 24, dur: 0.7, peak: 0.8 });
    this.toneLayer(ctx, t, v, { type: 'sine', from: 120, to: 38, dur: 0.35, peak: 0.7 });
    this.noiseLayer(ctx, t, v, { type: 'bandpass', freq: 800, q: 1, dur: 0.08, peak: 0.5 });
    // Reverb-like tail: low-passed noise decaying exponentially, ends before 1 s
    this.noiseLayer(ctx, t + 0.02, v, { type: 'lowpass', freq: 1200, q: 0.5, dur: 0.85, peak: 0.25 });
  }

  // Elimination kill confirmation tone
  public playElimination() {
    if (!this.enabled) return;
    this.initContext();
    if (!this.ctx) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(523.25, t); // C5
    osc.frequency.setValueAtTime(659.25, t + 0.08); // E5
    osc.frequency.setValueAtTime(783.99, t + 0.16); // G5
    osc.frequency.setValueAtTime(1046.5, t + 0.24); // C6

    gain.gain.setValueAtTime(0.35 * this.volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.48);
  }

  // Victory Fanfare
  public playVictory() {
    if (!this.enabled) return;
    this.initContext();
    if (!this.ctx) return;

    const notes = [440, 554.37, 659.25, 880, 1108.73];
    notes.forEach((freq, idx) => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + idx * 0.1;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.3 * this.volume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.38);
    });
  }
}

export const soundManager = new SoundManager();
