import * as THREE from 'three';
import { CraftBuild, computeStats } from '../garage/Loadout';
import { AiRacer } from './AiRacer';
import { AudioEngine } from './AudioEngine';
import { CraftController, ThrustInput } from './CraftController';
import { leverZForThrust, SkiffRig } from './CraftFactory';
import { DustField } from './Effects';
import { GrabSystem } from './GrabSystem';
import { HudDiegetic } from './HudDiegetic';
import { Track, ProgressTracker } from './TrackProgress';

export type RaceState = 'idle' | 'countdown' | 'racing' | 'finished';

// Solo testing for now; restore rivals by raising this count.
const AI_COUNT = 0;

interface InputProvider {
  getInput(): ThrustInput & { leftHeld: boolean; rightHeld: boolean };
  xHoldSeconds?: number;
  xHoldCompleted?: boolean;
}

/**
 * Orchestrates one race on Rustmere Cut: countdown, player physics, AI pack,
 * place calculation, HUD feed, audio, haptics, and results.
 */
export class RaceSession {
  state: RaceState = 'idle';

  readonly controller: CraftController;
  readonly tracker: ProgressTracker;
  readonly rivals: AiRacer[] = [];
  readonly dust: DustField;

  private countdownRemaining = 0;
  private countdownStep = -1;
  private raceTime = 0;
  private lastPlace = 0;
  private lastLap = 0;
  private rumbleTimer = 0;
  private finishPlace = 0;
  private bumpCooldown = 0;

  constructor(
    private scene: THREE.Scene,
    private skiff: SkiffRig,
    build: CraftBuild,
    private track: Track,
    private hud: HudDiegetic,
    private audio: AudioEngine,
    private grab: GrabSystem | null
  ) {
    this.controller = new CraftController(computeStats(build), track);
    this.tracker = new ProgressTracker(track, 0.995);

    this.controller.setCollisionHandler((e) => {
      this.audio.crash(e.impact);
      this.grab?.crashRumble();
    });

    for (let i = 0; i < AI_COUNT; i++) {
      const gridT = 0.995 - (i + 1) * 0.0035;
      const lateral = (i % 2 === 0 ? -1 : 1) * 6;
      const rival = new AiRacer(track, i, gridT, lateral);
      this.rivals.push(rival);
      scene.add(rival.group);
    }

    this.dust = new DustField();
    scene.add(this.dust.points);

    this.resetPlayer();
  }

  /** Remove everything this session added to the scene (garage rebuild). */
  dispose(): void {
    for (const rival of this.rivals) this.scene.remove(rival.group);
    this.scene.remove(this.dust.points);
  }

  begin(): void {
    if (this.state === 'countdown' || this.state === 'racing') return;
    this.restart();
  }

  restart(): void {
    this.state = 'countdown';
    this.countdownRemaining = 3.8;
    this.countdownStep = -1;
    this.raceTime = 0;
    this.lastPlace = 0;
    this.lastLap = 0;
    this.finishPlace = 0;
    this.resetPlayer();

    for (let i = 0; i < this.rivals.length; i++) {
      const old = this.rivals[i];
      this.scene.remove(old.group);
      const gridT = 0.995 - (i + 1) * 0.0035;
      const rival = new AiRacer(this.track, i, gridT, (i % 2 === 0 ? -1 : 1) * 6);
      this.rivals[i] = rival;
      this.scene.add(rival.group);
    }
  }

  private resetPlayer(): void {
    this.controller.reset(0.995, 0);
    this.tracker.t = 0.995;
    this.tracker.unwrapped = -0.005;
    this.syncSkiffTransform();
  }

  update(dt: number, input: InputProvider, restartPressed: boolean, isVR: boolean): void {
    if (this.state === 'idle') return;

    const rawInput = input.getInput();

    if (this.state === 'countdown') {
      this.countdownRemaining -= dt;
      const step = Math.ceil(this.countdownRemaining);
      if (step !== this.countdownStep && step >= 1 && step <= 3) {
        this.countdownStep = step;
        this.hud.showMessage(String(step), 1, '#ffd9a0');
        this.audio.countdownBeep();
      }
      if (this.countdownRemaining <= 0) {
        this.state = 'racing';
        this.hud.showMessage('GO', 1.2, '#6fce6f');
        this.audio.goBeep();
      }
    }

    const racing = this.state === 'racing';
    const frozen = this.state === 'countdown' || this.state === 'finished';

    if (racing) this.raceTime += dt;

    // player physics
    this.controller.update(dt, rawInput, frozen);
    this.syncSkiffTransform();
    this.tracker.update(this.controller.position);

    // AI pack
    for (const rival of this.rivals) {
      rival.update(dt, this.tracker.progress, this.raceTime, racing || this.state === 'finished');
    }

    // rival bumps
    this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);
    if (racing && this.bumpCooldown === 0) this.resolveRivalBumps();

    // lap + finish events
    if (racing) {
      if (this.tracker.lap > this.lastLap) {
        this.lastLap = this.tracker.lap;
        if (this.tracker.lap >= this.track.laps) {
          this.finishRace();
        } else {
          this.hud.showMessage(`LAP ${this.tracker.lap + 1}`, 1.6, '#9fd8ff');
          this.audio.lapDing();
        }
      }
    }

    // place
    const place = this.currentPlace();
    if (racing && this.lastPlace !== 0 && place !== this.lastPlace) {
      this.audio.placeChirp(place < this.lastPlace);
    }
    this.lastPlace = place;

    // limp-mode / repair (hold X for 5s)
    const xHold = input.xHoldSeconds ?? 0;
    const xDone = !!input.xHoldCompleted;
    if (racing && xDone) {
      this.controller.repairEngines();
      this.hud.showMessage('ENGINES REPAIRED', 2, '#6fce6f');
      this.audio.lapDing();
    } else if (racing && xHold > 0.15 && (this.controller.limpMode || this.controller.hullFraction < 1)) {
      const secs = Math.min(5, Math.ceil(5 - xHold));
      this.hud.showMessage(`REPAIR ${secs}s`, 0.35, '#9fd8ff');
    } else if (racing && this.controller.limpMode) {
      this.hud.showMessage('HULL CRITICAL — HOLD X 5s', 1.2, '#ff4a3a');
    }

    // FX + audio + haptics
    const speedFactor = this.controller.speed / Math.max(1, this.controller.stats.topSpeed);
    this.dust.update(dt, this.controller.position, this.controller.yaw, this.controller.speed);
    this.audio.setThrust(this.controller.effLeft, this.controller.effRight, speedFactor);
    this.audio.setOverheatWarning(this.controller.heat > 0.85);

    this.rumbleTimer += dt;
    if (this.rumbleTimer > 0.1) {
      this.rumbleTimer = 0;
      this.grab?.rumbleThrust(this.controller.effLeft, this.controller.effRight);
    }

    // exhaust glow scales with thrust
    const scaleL = 0.4 + this.controller.effLeft * 1.1 + (this.controller.overdriveActive ? 0.5 : 0);
    const scaleR = 0.4 + this.controller.effRight * 1.1 + (this.controller.overdriveActive ? 0.5 : 0);
    this.skiff.leftExhaust.scale.set(scaleL, scaleL, scaleL);
    this.skiff.rightExhaust.scale.set(scaleR, scaleR, scaleR);

    // desktop: animate the levers from the keyboard ramps (VR hands drive
    // them directly through GrabSystem)
    if (!isVR) {
      this.skiff.leftLever.position.z = leverZForThrust(this.skiff.leftLever, rawInput.left);
      this.skiff.rightLever.position.z = leverZForThrust(this.skiff.rightLever, rawInput.right);
    }

    // HUD
    this.hud.update(dt, {
      speed: this.controller.speed,
      thrustL: this.controller.effLeft,
      thrustR: this.controller.effRight,
      stability: this.controller.stability,
      hull: this.controller.hullFraction,
      overdrive: this.controller.overdriveFraction,
      place,
      racerCount: this.rivals.length + 1,
      lap: this.tracker.lap,
      lapsTotal: this.track.laps,
      raceTime: this.raceTime,
      playerT: this.tracker.t,
      playerYaw: this.controller.yaw,
      aiTs: this.rivals.map((r) => r.tracker.t),
      nextCheckpointT: this.track.checkpointT(this.tracker.nextCheckpoint),
      leftHeld: rawInput.leftHeld,
      rightHeld: rawInput.rightHeld,
      overheated: this.controller.heat > 0.85
    });

    // restart after finish
    if (this.state === 'finished' && restartPressed) {
      this.restart();
    }
  }

  private finishRace(): void {
    this.state = 'finished';
    this.finishPlace = this.currentPlace();
    const suffix = ['', 'st', 'nd', 'rd'][this.finishPlace] ?? 'th';
    this.hud.showMessage(`FINISH  P${this.finishPlace}${suffix}`, 8, this.finishPlace === 1 ? '#ffd23e' : '#ffd9a0');
    this.audio.lapDing();
    setTimeout(() => {
      if (this.state === 'finished') this.hud.showMessage('A / R TO RERUN', 30, '#8f795a');
    }, 4500);
  }

  private currentPlace(): number {
    if (this.state === 'finished' && this.finishPlace > 0) return this.finishPlace;
    let place = 1;
    for (const rival of this.rivals) {
      const rivalProgress = rival.finished ? this.track.laps + 1 : rival.tracker.progress;
      if (rivalProgress > this.tracker.progress) place++;
    }
    return place;
  }

  private resolveRivalBumps(): void {
    for (const rival of this.rivals) {
      const d = rival.group.position.distanceTo(this.controller.position);
      if (d < 5.5) {
        const toPlayer = this.controller.position.clone().sub(rival.group.position);
        const side = this.track.sideAt(this.controller.trackT);
        const sign = (toPlayer.dot(side) >= 0 ? 1 : -1) as 1 | -1;
        this.controller.shove(sign, 0.4 + rival.profile.aggression * 0.5);
        this.bumpCooldown = 0.9;
        break;
      }
    }
  }

  private syncSkiffTransform(): void {
    this.skiff.group.position.copy(this.controller.position);
    this.skiff.group.rotation.y = this.controller.yaw;

    // visual bank into turns + speed pitch, camera rig unaffected
    const bank = THREE.MathUtils.clamp(this.controller.yawRate * 0.5, -0.35, 0.35);
    this.skiff.visual.rotation.z = THREE.MathUtils.lerp(this.skiff.visual.rotation.z, -bank, 0.12);
    const pitch = (this.controller.speed / Math.max(1, this.controller.stats.topSpeed)) * 0.05;
    this.skiff.visual.rotation.x = THREE.MathUtils.lerp(this.skiff.visual.rotation.x, -pitch, 0.08);
  }
}
