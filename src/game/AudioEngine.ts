/**
 * Procedural audio: twin thruster voices (saw + filtered noise), a dedicated
 * afterburner rumble, UI beeps, crash bursts, and an overheat beep-beep alert.
 * No licensed audio anywhere.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices: ThrusterVoice[] = [];
  private burner: BurnerVoice | null = null;
  private overheatActive = false;
  private overheatBeepTimer = 0;

  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);

    this.voices = [new ThrusterVoice(this.ctx, this.master, -0.5), new ThrusterVoice(this.ctx, this.master, 0.5)];
    this.burner = new BurnerVoice(this.ctx, this.master);
  }

  /** Call once per frame for repeating alerts (overheat beep pattern). */
  update(dt: number): void {
    if (!this.overheatActive) {
      this.overheatBeepTimer = 0;
      return;
    }
    this.overheatBeepTimer -= dt;
    if (this.overheatBeepTimer <= 0) {
      this.beep(880, 0.07, 0.2, 'square');
      this.overheatBeepTimer = 0.34;
    }
  }

  setThrust(left: number, right: number, speedFactor: number): void {
    this.voices[0]?.set(left, speedFactor);
    this.voices[1]?.set(right, speedFactor);
  }

  /** Deep explosion-style hum while Y-burner is engaged. */
  setBurner(active: boolean): void {
    this.burner?.set(active);
  }

  setOverheatWarning(active: boolean): void {
    this.overheatActive = active;
    if (!active) this.overheatBeepTimer = 0;
  }

  /** Short ignition blip when a cold engine is tapped on. */
  engineIgnite(): void {
    this.beep(120, 0.18, 0.22, 'sawtooth');
    setTimeout(() => this.beep(90, 0.28, 0.16, 'sawtooth'), 40);
  }

  beep(freq: number, duration = 0.12, volume = 0.2, type: OscillatorType = 'sine'): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    osc.connect(g).connect(this.master);
    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  countdownBeep(): void {
    this.beep(440, 0.18, 0.25, 'square');
  }

  goBeep(): void {
    this.beep(880, 0.4, 0.3, 'square');
  }

  lapDing(): void {
    this.beep(1320, 0.1, 0.2);
    setTimeout(() => this.beep(1760, 0.18, 0.2), 110);
  }

  placeChirp(up: boolean): void {
    if (up) {
      this.beep(660, 0.08, 0.15);
      setTimeout(() => this.beep(990, 0.1, 0.15), 90);
    } else {
      this.beep(990, 0.08, 0.15);
      setTimeout(() => this.beep(660, 0.1, 0.15), 90);
    }
  }

  crash(intensity: number): void {
    if (!this.ctx || !this.master) return;
    const dur = 0.25 + intensity * 0.2;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600 + intensity * 800;
    const g = this.ctx.createGain();
    g.gain.value = 0.25 + intensity * 0.35;
    src.connect(filter).connect(g).connect(this.master);
    src.start();
  }
}

class ThrusterVoice {
  private osc: OscillatorNode;
  private oscGain: GainNode;
  private noiseGain: GainNode;
  private filter: BiquadFilterNode;
  private ctx: AudioContext;

  constructor(ctx: AudioContext, out: AudioNode, pan: number) {
    this.ctx = ctx;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(out);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 300;
    this.filter.connect(panner);

    this.osc = ctx.createOscillator();
    this.osc.type = 'sawtooth';
    this.osc.frequency.value = 55;
    this.oscGain = ctx.createGain();
    this.oscGain.gain.value = 0;
    this.osc.connect(this.oscGain).connect(this.filter);
    this.osc.start();

    // looping noise for the "air roar"
    const noiseDur = 2;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * noiseDur, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    noise.connect(this.noiseGain).connect(this.filter);
    noise.start();
  }

  set(thrust: number, speedFactor: number): void {
    const now = this.ctx.currentTime;
    const t = Math.max(0, Math.min(1, thrust));
    this.osc.frequency.setTargetAtTime(48 + t * 90 + speedFactor * 40, now, 0.06);
    this.oscGain.gain.setTargetAtTime(t * 0.09, now, 0.08);
    this.noiseGain.gain.setTargetAtTime(t * 0.06 + speedFactor * 0.05, now, 0.1);
    this.filter.frequency.setTargetAtTime(250 + t * 900 + speedFactor * 600, now, 0.08);
  }
}

/**
 * Low afterburner voice: sub saw + slow amplitude pulse + heavily filtered
 * blast noise. Reads as a sustained explosion hum, not a warning chirp.
 */
class BurnerVoice {
  private ctx: AudioContext;
  private sub: OscillatorNode;
  private subGain: GainNode;
  private pulse: OscillatorNode;
  private pulseGain: GainNode;
  private noiseGain: GainNode;
  private filter: BiquadFilterNode;
  private masterGain: GainNode;
  private active = false;

  constructor(ctx: AudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0;
    this.masterGain.connect(out);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 140;
    this.filter.Q.value = 0.7;
    this.filter.connect(this.masterGain);

    this.sub = ctx.createOscillator();
    this.sub.type = 'sawtooth';
    this.sub.frequency.value = 38;
    this.subGain = ctx.createGain();
    this.subGain.gain.value = 0.55;
    this.sub.connect(this.subGain).connect(this.filter);
    this.sub.start();

    // Slow LFO gives the rumble a breathing "hum" instead of a flat tone.
    this.pulse = ctx.createOscillator();
    this.pulse.type = 'sine';
    this.pulse.frequency.value = 3.2;
    this.pulseGain = ctx.createGain();
    this.pulseGain.gain.value = 0;
    this.pulse.connect(this.pulseGain).connect(this.masterGain.gain);
    this.pulse.start();

    const noiseDur = 2.5;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * noiseDur, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      // Soften the blast with a gentle envelope so it feels explosive, not hissy.
      const envelope = 0.65 + 0.35 * Math.sin((i / data.length) * Math.PI * 14);
      data[i] = (Math.random() * 2 - 1) * envelope;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0.7;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 110;
    noiseFilter.Q.value = 0.85;
    noise.connect(this.noiseGain).connect(noiseFilter).connect(this.filter);
    noise.start();
  }

  set(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    const now = this.ctx.currentTime;
    if (active) {
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(Math.max(0.001, this.masterGain.gain.value), now);
      this.masterGain.gain.exponentialRampToValueAtTime(0.28, now + 0.12);
      this.pulseGain.gain.setTargetAtTime(0.08, now, 0.08);
      this.sub.frequency.setTargetAtTime(42, now, 0.1);
      this.filter.frequency.setTargetAtTime(165, now, 0.12);
    } else {
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(Math.max(0.001, this.masterGain.gain.value), now);
      this.masterGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      this.pulseGain.gain.setTargetAtTime(0, now, 0.1);
      this.sub.frequency.setTargetAtTime(34, now, 0.15);
      this.filter.frequency.setTargetAtTime(120, now, 0.15);
    }
  }
}
