import * as THREE from 'three';
import { buildSkiff, randomRivalLoadout } from './CraftFactory';
import { Track, ProgressTracker, wrap01 } from './TrackProgress';

export interface RivalProfile {
  name: string;
  baseSpeed: number; // m/s cruising pace
  aggression: number; // 0..1 — how hard they cut lines / bump
  wobble: number; // lateral noise amplitude (m)
}

const ROSTER: RivalProfile[] = [
  { name: 'Vex Marrow', baseSpeed: 46, aggression: 0.85, wobble: 1.2 },
  { name: 'Junker Yil', baseSpeed: 43, aggression: 0.45, wobble: 2.2 },
  { name: 'Rasp Okko', baseSpeed: 44.5, aggression: 0.65, wobble: 1.6 },
  { name: 'Tin Whistle', baseSpeed: 41.5, aggression: 0.3, wobble: 2.8 }
];

/**
 * Kinematic rival: follows the racing line at a profile pace with lateral
 * wander, slows for narrow cuts, and rubber-bands lightly toward the player
 * (disabled on the final lap so podium fights stay honest).
 */
export class AiRacer {
  readonly group: THREE.Group;
  readonly profile: RivalProfile;
  readonly tracker: ProgressTracker;
  finished = false;
  finishTime = 0;

  private speed = 0;
  private lateral = 0;
  private lateralTarget = 0;
  private noisePhase: number;
  private exhausts: THREE.Mesh[];

  constructor(private track: Track, index: number, startT: number, startLateral: number) {
    this.profile = ROSTER[index % ROSTER.length];
    const rig = buildSkiff(randomRivalLoadout(index), { withCockpitFittings: false });
    this.group = rig.group;
    this.exhausts = [rig.leftExhaust, rig.rightExhaust];
    this.tracker = new ProgressTracker(track, startT);
    this.lateral = startLateral;
    this.lateralTarget = startLateral;
    this.noisePhase = index * 12.9898;

    this.placeAt(startT, startLateral, 0);
  }

  update(dt: number, playerProgress: number, elapsed: number, racing: boolean): void {
    if (this.finished) return;

    // pace: narrow sections slow rivals down like they slow the player
    const t = wrap01(this.tracker.t);
    const hw = this.track.halfWidthAt(t);
    const narrowFactor = THREE.MathUtils.clamp(hw / 14, 0.62, 1);

    // light rubber-band, off on final lap
    const finalLap = this.tracker.lap >= this.track.laps - 1;
    const gap = playerProgress - this.tracker.progress; // + means player ahead
    const band = finalLap ? 1 : THREE.MathUtils.clamp(1 + gap * 0.35, 0.9, 1.12);

    const target = racing ? this.profile.baseSpeed * narrowFactor * band : 0;
    this.speed = THREE.MathUtils.lerp(this.speed, target, 1 - Math.exp(-dt * 1.4));

    // advance along the loop
    const newT = t + (this.speed * dt) / this.track.lapLength;

    // lateral wander, clamped to canyon
    this.noisePhase += dt;
    if (Math.sin(this.noisePhase * 0.4 + this.profile.aggression * 9) > 0.995) {
      this.lateralTarget = (Math.random() * 2 - 1) * (hw - 4) * (0.3 + this.profile.aggression * 0.5);
    }
    const wobble = Math.sin(this.noisePhase * 1.3) * this.profile.wobble;
    this.lateral = THREE.MathUtils.lerp(this.lateral, this.lateralTarget + wobble, 1 - Math.exp(-dt * 1.2));
    this.lateral = THREE.MathUtils.clamp(this.lateral, -(hw - 3), hw - 3);

    this.placeAt(newT, this.lateral, elapsed);
    this.tracker.update(this.group.position);

    if (racing && this.tracker.lap >= this.track.laps) {
      this.finished = true;
      this.finishTime = elapsed;
    }

    // exhaust glow follows pace
    const glow = THREE.MathUtils.clamp(this.speed / this.profile.baseSpeed, 0.2, 1.2);
    for (const e of this.exhausts) e.scale.set(glow, glow, glow);
  }

  private placeAt(t: number, lateral: number, elapsed: number): void {
    const tw = wrap01(t);
    const p = this.track.posAt(tw);
    const side = this.track.sideAt(tw);
    const dir = this.track.tangentAt(tw);

    this.group.position.copy(p).addScaledVector(side, lateral);
    this.group.position.y = p.y + 1.15 + Math.sin(elapsed * 3 + this.noisePhase) * 0.07;
    this.group.rotation.y = Math.atan2(-dir.x, -dir.z);
  }
}

export function rosterName(index: number): string {
  return ROSTER[index % ROSTER.length].name;
}
