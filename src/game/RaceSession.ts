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

export type RaceState = 'idle' | 'arming' | 'countdown' | 'racing' | 'finished';

// Solo testing for now; restore rivals by raising this count.
const AI_COUNT = 0;

interface InputProvider {
  getInput(): ThrustInput & { leftHeld: boolean; rightHeld: boolean };
  xHoldSeconds?: number;
  xHoldCompleted?: boolean;
  ignitionTouchSides?: () => ('left' | 'right')[];
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
  private leftEngineWasExploded = false;
  private rightEngineWasExploded = false;
  private leftIgnited = false;
  private rightIgnited = false;
  private readonly handScratch: THREE.Vector3[] = [];
  private readonly leftTouch = new THREE.Vector3();
  private readonly rightTouch = new THREE.Vector3();
  private readonly engineWorld = new THREE.Vector3();
  private readonly ENGINE_TOUCH_RADIUS = 1.35;
  private readonly PANEL_TOUCH_RADIUS = 0.16;

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
    this.tracker = new ProgressTracker(track, 0);

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
    if (this.state === 'arming' || this.state === 'countdown' || this.state === 'racing') return;
    this.restart();
  }

  restart(): void {
    this.state = 'arming';
    this.countdownRemaining = 0;
    this.countdownStep = -1;
    this.raceTime = 0;
    this.lastPlace = 0;
    this.lastLap = 0;
    this.finishPlace = 0;
    this.leftEngineWasExploded = false;
    this.rightEngineWasExploded = false;
    this.leftIgnited = false;
    this.rightIgnited = false;
    this.resetPlayer();
    this.skiff.leftExhaust.visible = false;
    this.skiff.rightExhaust.visible = false;
    this.skiff.leftExhaust.scale.setScalar(0);
    this.skiff.rightExhaust.scale.setScalar(0);
    this.hud.showMessage('TOUCH ENGINES TO IGNITE', 8, '#ffd9a0');

    for (let i = 0; i < this.rivals.length; i++) {
      const old = this.rivals[i];
      this.scene.remove(old.group);
      const gridT = 0.995 - (i + 1) * 0.0035;
      const rival = new AiRacer(this.track, i, gridT, (i % 2 === 0 ? -1 : 1) * 6);
      this.rivals[i] = rival;
      this.scene.add(rival.group);
    }
  }

  private startCountdown(): void {
    this.state = 'countdown';
    this.countdownRemaining = 3.8;
    this.countdownStep = -1;
    this.hud.showMessage('ENGINES ONLINE', 1.1, '#6fce6f');
  }

  private resetPlayer(): void {
    // Start exactly on the start/finish gate and face its forward tangent.
    this.controller.reset(0, 0);
    this.tracker.t = 0;
    this.tracker.unwrapped = 0;
    // Park throttles at zero so the craft does not creep at GO.
    this.skiff.leftLever.position.z = leverZForThrust(this.skiff.leftLever, 0);
    this.skiff.rightLever.position.z = leverZForThrust(this.skiff.rightLever, 0);
    this.syncSkiffTransform();
  }

  update(dt: number, input: InputProvider, restartPressed: boolean, isVR: boolean): void {
    if (this.state === 'idle') return;

    const rawInput = input.getInput();

    if (this.state === 'arming') {
      this.resolveIgnitionTouches(input);
      if (this.leftIgnited && this.rightIgnited) {
        this.startCountdown();
      } else {
        const waiting =
          !this.leftIgnited && !this.rightIgnited
            ? 'TOUCH ENGINES TO IGNITE'
            : !this.leftIgnited
              ? 'TOUCH LEFT ENGINE'
              : 'TOUCH RIGHT ENGINE';
        this.hud.showMessage(waiting, 0.4, '#ffd9a0');
      }
    }

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
    const systemsLive = this.state !== 'arming' && this.leftIgnited && this.rightIgnited;
    const frozen =
      this.state === 'arming' || this.state === 'countdown' || this.state === 'finished';

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

    // limp-mode / repair — hold X to gradually restore hull + engines
    const xHold = input.xHoldSeconds ?? 0;
    const leftJustExploded =
      this.controller.leftEngineExploded && !this.leftEngineWasExploded;
    const rightJustExploded =
      this.controller.rightEngineExploded && !this.rightEngineWasExploded;
    const needsRepair =
      this.controller.limpMode ||
      this.controller.hullFraction < 1 ||
      this.controller.leftEngineHealthFraction < 1 ||
      this.controller.rightEngineHealthFraction < 1 ||
      this.controller.leftEngineExploded ||
      this.controller.rightEngineExploded;
    if (racing && xHold > 0 && needsRepair) {
      const justFinished = this.controller.repairTick(dt);
      if (justFinished) {
        this.hud.showMessage('ENGINES REPAIRED', 2, '#6fce6f');
        this.audio.lapDing();
      } else {
        const progress = Math.round(
          ((this.controller.hullFraction +
            this.controller.leftEngineHealthFraction +
            this.controller.rightEngineHealthFraction) /
            3) *
            100
        );
        this.hud.showMessage(`REPAIRING ${progress}%`, 0.35, '#9fd8ff');
      }
    } else if (racing && (leftJustExploded || rightJustExploded)) {
      const side = leftJustExploded && rightJustExploded
        ? 'BOTH ENGINES'
        : leftJustExploded
          ? 'LEFT ENGINE'
          : 'RIGHT ENGINE';
      this.hud.showMessage(`${side} DESTROYED`, 2.4, '#ff4a3a');
    } else if (
      racing &&
      (this.controller.leftEngineExploded || this.controller.rightEngineExploded)
    ) {
      this.hud.showMessage('ENGINE LOST — HOLD X TO REPAIR', 1.2, '#ff4a3a');
    } else if (racing && this.controller.limpMode) {
      this.hud.showMessage('HULL CRITICAL — HOLD X TO REPAIR', 1.2, '#ff4a3a');
    }
    this.leftEngineWasExploded = this.controller.leftEngineExploded;
    this.rightEngineWasExploded = this.controller.rightEngineExploded;

    // FX + audio + haptics
    const speedFactor = this.controller.speed / Math.max(1, this.controller.stats.topSpeed);
    this.dust.update(dt, this.controller.position, this.controller.yaw, this.controller.speed);
    this.audio.setThrust(
      systemsLive ? this.controller.effLeft : 0,
      systemsLive ? this.controller.effRight : 0,
      systemsLive ? speedFactor : 0
    );
    this.audio.setBurner(systemsLive && this.controller.burnerActive);
    this.audio.setOverheatWarning(systemsLive && this.controller.heat > 0.85);
    this.audio.update(dt);

    this.rumbleTimer += dt;
    if (this.rumbleTimer > 0.1) {
      this.rumbleTimer = 0;
      if (systemsLive) {
        this.grab?.rumbleThrust(this.controller.effLeft, this.controller.effRight);
      }
    }

    // Exhaust stays dark until each engine is ignited.
    const burnerFlame = systemsLive && this.controller.burnerActive ? 0.85 : 0;
    if (this.leftIgnited) {
      this.skiff.leftExhaust.visible = true;
      const scaleL =
        0.4 + this.controller.effLeft * 1.1 +
        (this.controller.overdriveActive ? 0.5 : 0) + burnerFlame;
      this.skiff.leftExhaust.scale.set(scaleL, scaleL, scaleL);
    } else {
      this.skiff.leftExhaust.visible = false;
      this.skiff.leftExhaust.scale.setScalar(0);
    }
    if (this.rightIgnited) {
      this.skiff.rightExhaust.visible = true;
      const scaleR =
        0.4 + this.controller.effRight * 1.1 +
        (this.controller.overdriveActive ? 0.5 : 0) + burnerFlame;
      this.skiff.rightExhaust.scale.set(scaleR, scaleR, scaleR);
    } else {
      this.skiff.rightExhaust.visible = false;
      this.skiff.rightExhaust.scale.setScalar(0);
    }
    this.skiff.updateEngineDynamics(
      dt,
      this.controller.speed,
      this.controller.yawRate,
      systemsLive ? this.controller.effLeft : 0,
      systemsLive ? this.controller.effRight : 0,
      this.controller.leftEngineHealthFraction,
      this.controller.rightEngineHealthFraction,
      this.controller.leftEngineExploded,
      this.controller.rightEngineExploded,
      systemsLive
    );

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
      overheated: this.controller.heat > 0.85,
      engineHealthL: this.controller.leftEngineHealthFraction,
      engineHealthR: this.controller.rightEngineHealthFraction,
      leftEngineExploded: this.controller.leftEngineExploded,
      rightEngineExploded: this.controller.rightEngineExploded,
      burnerActive: this.controller.burnerActive,
      leftIgnited: this.state === 'arming' ? this.leftIgnited : undefined,
      rightIgnited: this.state === 'arming' ? this.rightIgnited : undefined
    });

    // restart after finish
    if (this.state === 'finished' && restartPressed) {
      this.restart();
    }
  }

  private resolveIgnitionTouches(input: InputProvider): void {
    // Desktop: Q / P stand in for reaching out and touching each engine.
    for (const side of input.ignitionTouchSides?.() ?? []) {
      this.igniteSide(side);
    }

    // VR: just poke the engine (or its diagram on the dash). No trigger click.
    this.hud.enginePanelMesh.updateWorldMatrix(true, false);
    this.hud.getEngineTouchPoints(this.leftTouch, this.rightTouch);
    const hands = this.grab?.getHandWorldPositions(this.handScratch) ?? [];
    for (const hand of hands) {
      if (!this.leftIgnited && hand.distanceTo(this.leftTouch) < this.PANEL_TOUCH_RADIUS) {
        this.igniteSide('left');
      }
      if (!this.rightIgnited && hand.distanceTo(this.rightTouch) < this.PANEL_TOUCH_RADIUS) {
        this.igniteSide('right');
      }

      this.skiff.leftEngine.getWorldPosition(this.engineWorld);
      if (!this.leftIgnited && hand.distanceTo(this.engineWorld) < this.ENGINE_TOUCH_RADIUS) {
        this.igniteSide('left');
      }
      this.skiff.rightEngine.getWorldPosition(this.engineWorld);
      if (!this.rightIgnited && hand.distanceTo(this.engineWorld) < this.ENGINE_TOUCH_RADIUS) {
        this.igniteSide('right');
      }
    }
  }

  private igniteSide(side: 'left' | 'right'): void {
    if (side === 'left') {
      if (this.leftIgnited) return;
      this.leftIgnited = true;
      this.skiff.leftExhaust.visible = true;
      this.skiff.leftExhaust.scale.setScalar(0.55);
    } else {
      if (this.rightIgnited) return;
      this.rightIgnited = true;
      this.skiff.rightExhaust.visible = true;
      this.skiff.rightExhaust.scale.setScalar(0.55);
    }
    this.audio.engineIgnite();
    this.grab?.crashRumble();
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
