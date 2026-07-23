import * as THREE from 'three';
import { CraftStats } from '../garage/Loadout';
import { Track, wrap01 } from './TrackProgress';

export interface ThrustInput {
  left: number; // 0..1
  right: number; // 0..1
  /** -1 (lean left) .. 1 (lean right); primary steering signal. */
  lean: number;
  overdrive: boolean;
}

export interface CollisionEvent {
  side: -1 | 1;
  impact: number; // 0..1 severity
}

const IDLE_FLOOR = 0.12;
const OVERDRIVE_MAX = 4; // seconds of charge
const OVERDRIVE_RECHARGE = 0.45; // charge per second
const OVERDRIVE_HEAT = 0.22; // extra heat per second

/**
 * Player skiff simulation: differential thrust drives speed and yaw, heat caps
 * power when abused, walls damage the hull and shove you back onto the track.
 */
export class CraftController {
  position = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  yawRate = 0;

  heat = 0;
  hull: number;
  stability = 1;
  overdriveCharge = OVERDRIVE_MAX;
  overdriveActive = false;

  /** Smoothed effective thrust per side, for gauges/exhaust/audio. */
  effLeft = 0;
  effRight = 0;

  trackT = 0;
  inSoftSand = false;
  limpMode = false;

  private collisionShake = 0;
  private onCollision: ((e: CollisionEvent) => void) | null = null;

  constructor(public stats: CraftStats, private track: Track) {
    this.hull = stats.hullMax;
  }

  setCollisionHandler(fn: (e: CollisionEvent) => void): void {
    this.onCollision = fn;
  }

  reset(startT: number, lateralOffset = 0): void {
    const p = this.track.posAt(startT);
    const side = this.track.sideAt(startT);
    this.position.copy(p).addScaledVector(side, lateralOffset);
    const dir = this.track.tangentAt(startT);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.speed = 0;
    this.yawRate = 0;
    this.heat = 0;
    this.hull = this.stats.hullMax;
    this.stability = 1;
    this.overdriveCharge = OVERDRIVE_MAX;
    this.trackT = startT;
    this.limpMode = false;
    this.effLeft = 0;
    this.effRight = 0;
  }

  update(dt: number, input: ThrustInput, frozen = false): void {
    const raw = frozen
      ? { left: 0, right: 0, lean: 0, overdrive: false }
      : input;

    // gentle response curve on lever position so small nudges stay calm
    const shape = (v: number) => {
      const c = Math.max(0, Math.min(1, v));
      return Math.max(IDLE_FLOOR * (frozen ? 0 : 1), Math.pow(c, 1.2));
    };
    let inL = shape(raw.left);
    let inR = shape(raw.right);

    // overdrive
    this.overdriveActive = false;
    if (raw.overdrive && this.overdriveCharge > 0.15 && !this.limpMode && !frozen) {
      this.overdriveActive = true;
      this.overdriveCharge = Math.max(0, this.overdriveCharge - dt);
    } else {
      this.overdriveCharge = Math.min(OVERDRIVE_MAX, this.overdriveCharge + OVERDRIVE_RECHARGE * dt);
    }

    // heat model
    const load = (inL * inL + inR * inR) / 2;
    this.heat += (load * this.stats.heatRate + (this.overdriveActive ? OVERDRIVE_HEAT : 0)) * dt;
    this.heat -= this.stats.coolRate * (1.2 - load) * dt;
    this.heat = Math.max(0, Math.min(1, this.heat));

    // overheating caps power; a wrecked hull limps
    let powerCap = this.heat > 0.85 ? 1 - (this.heat - 0.85) * 4.5 : 1;
    powerCap = Math.max(0.3, powerCap);
    if (this.limpMode) powerCap = Math.min(powerCap, 0.25);

    const odBoost = this.overdriveActive ? 1.28 : 1;
    const effL = inL * powerCap;
    const effR = inR * powerCap;
    this.effLeft = THREE.MathUtils.lerp(this.effLeft, effL, 1 - Math.exp(-dt * 10));
    this.effRight = THREE.MathUtils.lerp(this.effRight, effR, 1 - Math.exp(-dt * 10));

    // longitudinal
    const avg = (effL + effR) / 2;
    const sandDrag = this.inSoftSand ? 0.55 : 1;
    const targetSpeed = this.stats.topSpeed * avg * odBoost * sandDrag;
    const accel = this.stats.accel * (this.overdriveActive ? 1.5 : 1);
    if (this.speed < targetSpeed) {
      this.speed = Math.min(targetSpeed, this.speed + accel * dt);
    } else {
      this.speed = Math.max(targetSpeed, this.speed - (accel * 0.9 + (this.inSoftSand ? 14 : 0)) * dt);
    }

    // Pure differential-thrust steering:
    // more LEFT-engine throttle turns RIGHT; more RIGHT turns LEFT.
    // Controller roll/handle lean has no steering effect.
    const differential = effL - effR;
    const speedFactor = 0.45 + 0.55 * Math.min(1, this.speed / this.stats.topSpeed);
    const targetYawRate = -differential * this.stats.turnRate * 1.05 * speedFactor;
    this.yawRate = THREE.MathUtils.lerp(this.yawRate, targetYawRate, 1 - Math.exp(-dt * 4));
    this.yaw += this.yawRate * dt;

    // integrate position
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.position.addScaledVector(forward, this.speed * dt);

    // track query: hover height, sand, wall clamp
    this.trackT = this.track.nearestT(this.position, this.trackT);
    const center = this.track.posAt(this.trackT);
    const sideVec = this.track.sideAt(this.trackT);
    const hw = this.track.halfWidthAt(this.trackT);
    const offset = this.position.clone().sub(center);
    const lateral = offset.dot(sideVec);

    // Open-desert layout: no invisible lane clamp, wall collision, or off-track
    // drag. Ground texture is visual-only and never affects the vehicle.
    void hw;
    void lateral;
    this.inSoftSand = false;
    this.collisionShake = Math.max(0, this.collisionShake - dt * 2.2);

    // hover height follows the canyon floor
    this.position.y = center.y + 1.15;

    // stability: heat + imbalance + recent hits
    const imbalance = Math.abs(this.effRight - this.effLeft);
    const targetStability = Math.max(
      0,
      1 - (this.heat * 0.55 + imbalance * 0.25 + this.collisionShake * 0.45)
    );
    this.stability = THREE.MathUtils.lerp(this.stability, targetStability, 1 - Math.exp(-dt * 4));
  }

  applyDamage(amount: number): void {
    if (this.limpMode) return;
    this.hull = Math.max(0, this.hull - amount);
    if (this.hull <= 0) this.limpMode = true;
  }

  /** Full engine/hull repair — clears limp mode and restores capacity. */
  repairEngines(): void {
    this.hull = this.stats.hullMax;
    this.limpMode = false;
    this.heat = Math.min(this.heat, 0.4);
  }

  /** Push from another racer bumping us. */
  shove(sideSign: -1 | 1, strength: number): void {
    const sideVec = this.track.sideAt(this.trackT);
    this.position.addScaledVector(sideVec, sideSign * strength);
    this.yawRate += sideSign * strength * 0.5;
    this.applyDamage(strength * 4);
    this.onCollision?.({ side: sideSign, impact: Math.min(1, strength * 0.4) });
  }

  get overdriveFraction(): number {
    return this.overdriveCharge / OVERDRIVE_MAX;
  }

  get hullFraction(): number {
    return this.hull / this.stats.hullMax;
  }

  get lateralT(): number {
    return wrap01(this.trackT);
  }
}
