import * as THREE from 'three';
import { CraftStats } from '../garage/Loadout';
import {
  crossedTrackT,
  TRACK_JUMPS,
  Track,
  tInRange,
  wrap01
} from './TrackProgress';

export interface ThrustInput {
  left: number; // 0..1
  right: number; // 0..1
  /** Reserved; steering currently comes entirely from differential thrust. */
  lean: number;
  overdrive: boolean;
  /** Toggleable high-output engine burner (Y button). */
  burner: boolean;
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
  engineHealthLeft = 100;
  engineHealthRight = 100;
  leftEngineExploded = false;
  rightEngineExploded = false;
  stability = 1;
  overdriveCharge = OVERDRIVE_MAX;
  overdriveActive = false;
  burnerActive = false;

  /** Smoothed effective thrust per side, for gauges/exhaust/audio. */
  effLeft = 0;
  effRight = 0;

  trackT = 0;
  inSoftSand = false;
  limpMode = false;
  airborne = false;

  private collisionShake = 0;
  private onCollision: ((e: CollisionEvent) => void) | null = null;
  private verticalVelocity = 0;
  private pitRecoveryCooldown = 0;

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
    this.engineHealthLeft = 100;
    this.engineHealthRight = 100;
    this.leftEngineExploded = false;
    this.rightEngineExploded = false;
    this.stability = 1;
    this.overdriveCharge = OVERDRIVE_MAX;
    this.burnerActive = false;
    this.trackT = startT;
    this.limpMode = false;
    this.airborne = false;
    this.verticalVelocity = 0;
    this.pitRecoveryCooldown = 0;
    this.effLeft = 0;
    this.effRight = 0;
  }

  update(dt: number, input: ThrustInput, frozen = false): void {
    const raw = frozen
      ? { left: 0, right: 0, lean: 0, overdrive: false, burner: false }
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
    this.burnerActive =
      raw.burner &&
      !frozen &&
      (!this.leftEngineExploded || !this.rightEngineExploded);
    this.heat += (
      load * this.stats.heatRate +
      (this.overdriveActive ? OVERDRIVE_HEAT : 0) +
      (this.burnerActive ? 0.14 : 0)
    ) * dt;
    this.heat -= this.stats.coolRate * (1.2 - load) * dt;
    this.heat = Math.max(0, Math.min(1, this.heat));
    if (this.burnerActive) {
      const burnerDamage = (2.2 + load * 2.0) * dt;
      if (!this.leftEngineExploded) this.applyEngineDamage(-1, burnerDamage);
      if (!this.rightEngineExploded) this.applyEngineDamage(1, burnerDamage);
    }

    // overheating caps power; a wrecked hull limps
    let powerCap = this.heat > 0.85 ? 1 - (this.heat - 0.85) * 4.5 : 1;
    powerCap = Math.max(0.3, powerCap);
    if (this.limpMode) powerCap = Math.min(powerCap, 0.25);

    const odBoost =
      (this.overdriveActive ? 1.28 : 1) *
      (this.burnerActive ? 1.68 : 1);
    const leftEnginePower = this.leftEngineExploded
      ? 0
      : THREE.MathUtils.lerp(0.35, 1, this.engineHealthLeft / 100);
    const rightEnginePower = this.rightEngineExploded
      ? 0
      : THREE.MathUtils.lerp(0.35, 1, this.engineHealthRight / 100);
    const effL = inL * powerCap * leftEnginePower;
    const effR = inR * powerCap * rightEnginePower;
    this.effLeft = THREE.MathUtils.lerp(this.effLeft, effL, 1 - Math.exp(-dt * 10));
    this.effRight = THREE.MathUtils.lerp(this.effRight, effR, 1 - Math.exp(-dt * 10));

    // longitudinal
    const avg = (effL + effR) / 2;
    const sandDrag = this.inSoftSand ? 0.55 : 1;
    const targetSpeed = this.stats.topSpeed * avg * odBoost * sandDrag;
    const accel =
      this.stats.accel *
      (this.overdriveActive ? 1.5 : 1) *
      (this.burnerActive ? 2.1 : 1);
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
    const yawTorque = -differential * this.stats.turnRate * 2.15 * speedFactor;
    this.yawRate += yawTorque * dt;
    // Low damping preserves heavy rotational momentum. Counter-throttle is
    // the quickest way to stop a turn; simply matching throttles coasts out.
    this.yawRate *= Math.exp(-dt * 0.55);
    this.yawRate = THREE.MathUtils.clamp(
      this.yawRate,
      -this.stats.turnRate * 1.25,
      this.stats.turnRate * 1.25
    );
    this.yaw += this.yawRate * dt;

    // integrate position
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.position.addScaledVector(forward, this.speed * dt);

    // Track query + shared ramp/pit features.
    const previousTrackT = this.trackT;
    this.trackT = this.track.nearestT(this.position, this.trackT);
    let center = this.track.posAt(this.trackT);
    const sideVec = this.track.sideAt(this.trackT);
    const hw = this.track.halfWidthAt(this.trackT);
    const offset = this.position.clone().sub(center);
    const lateral = offset.dot(sideVec);
    this.pitRecoveryCooldown = Math.max(0, this.pitRecoveryCooldown - dt);

    for (const jump of TRACK_JUMPS) {
      if (
        !this.airborne &&
        this.speed >= 28 &&
        crossedTrackT(previousTrackT, this.trackT, jump.launchT)
      ) {
        this.airborne = true;
        this.verticalVelocity = jump.launchVelocity;
      }
    }

    // Visible barrier collision. The clamp accounts for the engine span, so
    // contact happens when an outer engine reaches the rendered barricade.
    const barrierMargin = hw - 2.8;
    this.inSoftSand = false;
    if (Math.abs(lateral) > barrierMargin) {
      const overshoot = Math.abs(lateral) - barrierMargin;
      const sideSign = (lateral > 0 ? 1 : -1) as 1 | -1;
      this.position.addScaledVector(sideVec, -sideSign * overshoot);
      const impact = Math.min(
        1,
        (this.speed / this.stats.topSpeed) * (0.28 + overshoot * 0.35)
      );
      if (impact > 0.06 && this.collisionShake < 0.35) {
        const speedRatio = this.speed / Math.max(1, this.stats.topSpeed);
        this.applyDamage(impact * 12);
        // The outside engine takes the direct barrier strike. A meaningful
        // impact at near-full speed is catastrophic rather than survivable.
        const catastrophic = speedRatio > 0.9 && impact > 0.42;
        this.applyEngineDamage(sideSign, catastrophic ? 110 : impact * 52);
        this.speed *= 1 - impact * 0.42;
        this.yawRate += sideSign * impact * 1.1;
        this.collisionShake = 1;
        this.onCollision?.({ side: sideSign, impact });
      }
    }
    this.collisionShake = Math.max(0, this.collisionShake - dt * 2.2);

    const activePit = TRACK_JUMPS.find((jump) =>
      tInRange(this.trackT, jump.pitStartT, jump.pitEndT)
    );
    let rampLift = 0;
    if (!this.airborne) {
      for (const jump of TRACK_JUMPS) {
        const rampStartT = jump.launchT - jump.rampLength / this.track.lapLength;
        if (tInRange(this.trackT, rampStartT, jump.launchT)) {
          const progress = THREE.MathUtils.clamp(
            (this.trackT - rampStartT) / (jump.launchT - rampStartT),
            0,
            1
          );
          rampLift = Math.max(rampLift, progress * jump.rampHeight);
        }
      }
    }
    const hoverHeight = center.y + 1.15 + rampLift;

    if (this.airborne) {
      this.verticalVelocity -= 21 * dt;
      this.position.y += this.verticalVelocity * dt;

      // Land only after clearing the open pit.
      if (!activePit && this.verticalVelocity < 0 && this.position.y <= hoverHeight) {
        this.position.y = hoverHeight;
        this.verticalVelocity = 0;
        this.airborne = false;
      }
    } else {
      this.position.y = hoverHeight;
    }

    // Missing a jump (or dropping below its floor while airborne) costs hull
    // and respawns the craft just beyond the landing edge.
    if (
      activePit &&
      this.pitRecoveryCooldown <= 0 &&
      (!this.airborne || this.position.y < center.y - 3.5)
    ) {
      const recoveryT = wrap01(activePit.pitEndT + 0.004);
      center = this.track.posAt(recoveryT);
      const recoveryDir = this.track.tangentAt(recoveryT);
      this.position.copy(center);
      this.position.y = center.y + 1.15;
      this.trackT = recoveryT;
      this.yaw = Math.atan2(-recoveryDir.x, -recoveryDir.z);
      this.yawRate = 0;
      this.speed *= 0.3;
      this.verticalVelocity = 0;
      this.airborne = false;
      this.pitRecoveryCooldown = 1.5;
      this.applyDamage(35);
      this.applyEngineDamage(-1, 48);
      this.applyEngineDamage(1, 48);
      this.collisionShake = 1;
      this.onCollision?.({ side: 1, impact: 1 });
    }

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

  applyEngineDamage(side: -1 | 1, amount: number): void {
    if (side < 0 && !this.leftEngineExploded) {
      this.engineHealthLeft = Math.max(0, this.engineHealthLeft - amount);
      if (this.engineHealthLeft <= 0) this.leftEngineExploded = true;
    } else if (side > 0 && !this.rightEngineExploded) {
      this.engineHealthRight = Math.max(0, this.engineHealthRight - amount);
      if (this.engineHealthRight <= 0) this.rightEngineExploded = true;
    }
    if (this.leftEngineExploded && this.rightEngineExploded) this.limpMode = true;
  }

  /** Full engine/hull repair — clears limp mode and restores capacity. */
  repairEngines(): void {
    this.hull = this.stats.hullMax;
    this.engineHealthLeft = 100;
    this.engineHealthRight = 100;
    this.leftEngineExploded = false;
    this.rightEngineExploded = false;
    this.limpMode = false;
    this.heat = Math.min(this.heat, 0.4);
  }

  get leftEngineHealthFraction(): number {
    return this.engineHealthLeft / 100;
  }

  get rightEngineHealthFraction(): number {
    return this.engineHealthRight / 100;
  }

  /** Push from another racer bumping us. */
  shove(sideSign: -1 | 1, strength: number): void {
    const sideVec = this.track.sideAt(this.trackT);
    this.position.addScaledVector(sideVec, sideSign * strength);
    this.yawRate += sideSign * strength * 0.5;
    this.applyDamage(strength * 4);
    this.applyEngineDamage(sideSign, strength * 9);
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
