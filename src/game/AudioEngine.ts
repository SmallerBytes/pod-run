/**
 * Procedural audio: twin thruster voices (saw + filtered noise), UI beeps,
 * crash bursts, and an overheat warble. No licensed audio anywhere.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices: ThrusterVoice[] = [];
  private warnOsc: OscillatorNode | null = null;
  private warnGain: GainNode | null = null;

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

    // overheat warble (silent until enabled)
    this.warnOsc = this.ctx.createOscillator();
    this.warnOsc.type = 'square';
    this.warnOsc.frequency.value = 880;
    this.warnGain = this.ctx.createGain();
    this.warnGain.gain.value = 0;
    this.warnOsc.connect(this.warnGain).connect(this.master);
    this.warnOsc.start();
  }

  setThrust(left: number, right: number, speedFactor: number): void {
    this.voices[0]?.set(left, speedFactor);
    this.voices[1]?.set(right, speedFactor);
  }

  setOverheatWarning(active: boolean): void {
    if (!this.ctx || !this.warnGain || !this.warnOsc) return;
    const now = this.ctx.currentTime;
    if (active) {
      this.warnGain.gain.setTargetAtTime(0.05, now, 0.05);
      this.warnOsc.frequency.setValueAtTime(880, now);
      this.warnOsc.frequency.setValueAtTime(660, now + 0.15);
    } else {
      this.warnGain.gain.setTargetAtTime(0, now, 0.05);
    }
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

  constructor(ctx: AudioContext, out: AudioNode, pan: number) {
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

    this.ctx = ctx;
  }

  private ctx: AudioContext;

  set(thrust: number, speedFactor: number): void {
    const now = this.ctx.currentTime;
    const t = Math.max(0, Math.min(1, thrust));
    this.osc.frequency.setTargetAtTime(48 + t * 90 + speedFactor * 40, now, 0.06);
    this.oscGain.gain.setTargetAtTime(t * 0.09, now, 0.08);
    this.noiseGain.gain.setTargetAtTime(t * 0.06 + speedFactor * 0.05, now, 0.1);
    this.filter.frequency.setTargetAtTime(250 + t * 900 + speedFactor * 600, now, 0.08);
  }
}
