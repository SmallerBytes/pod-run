import * as THREE from 'three';
import trackData from '../data/track-rustmere.json';

export interface TrackPointDef {
  x: number;
  y: number;
  z: number;
  width: number;
}

export interface JumpFeature {
  /** Arc-length parameter where the ramp launches the craft. */
  launchT: number;
  /** Open track interval occupied by the pit. */
  pitStartT: number;
  pitEndT: number;
  /** Upward launch speed in metres/second. */
  launchVelocity: number;
  rampLength: number;
  rampHeight: number;
}

/**
 * Jump features are disabled for now. Keeping the typed feature list makes
 * it easy to reintroduce tested ramps later without changing physics/rendering.
 */
export const TRACK_JUMPS: readonly JumpFeature[] = [];

export interface TrackObstacle {
  /** Position around the closed course. */
  t: number;
  /** Lane position from -1 (left edge) to +1 (right edge). */
  laneOffset: number;
  radius: number;
  height: number;
}

/** Large, isolated boulders with enough open lane remaining to dodge them. */
export const TRACK_OBSTACLES: readonly TrackObstacle[] = [
  { t: 0.06, laneOffset: -0.36, radius: 2.8, height: 5.2 },
  { t: 0.14, laneOffset: 0.4, radius: 3.1, height: 5.8 },
  { t: 0.22, laneOffset: -0.28, radius: 2.6, height: 4.9 },
  { t: 0.34, laneOffset: 0.34, radius: 3.4, height: 6.2 },
  { t: 0.42, laneOffset: -0.42, radius: 2.9, height: 5.5 },
  { t: 0.5, laneOffset: 0.22, radius: 3.2, height: 6 },
  { t: 0.58, laneOffset: -0.32, radius: 2.7, height: 5.1 },
  { t: 0.66, laneOffset: 0.38, radius: 3.5, height: 6.4 },
  { t: 0.74, laneOffset: -0.24, radius: 2.8, height: 5.3 },
  { t: 0.82, laneOffset: 0.36, radius: 3.3, height: 6.1 },
  { t: 0.9, laneOffset: -0.4, radius: 2.9, height: 5.4 },
  { t: 0.96, laneOffset: 0.26, radius: 3.1, height: 5.9 }
];

export function tInRange(t: number, start: number, end: number): boolean {
  const wrapped = wrap01(t);
  return start <= end
    ? wrapped >= start && wrapped <= end
    : wrapped >= start || wrapped <= end;
}

export function crossedTrackT(previous: number, current: number, target: number): boolean {
  const prev = wrap01(previous);
  const curr = wrap01(current);
  return curr >= prev
    ? target > prev && target <= curr
    : target > prev || target <= curr;
}

/**
 * Wraps the closed track spline with arc-length sampling so gameplay code can
 * ask "where am I along the loop" and "how wide is the canyon here" cheaply.
 */
export class Track {
  readonly name: string = trackData.name;
  readonly laps: number = trackData.laps;
  readonly checkpointCount: number = trackData.checkpoints;
  readonly curve: THREE.CatmullRomCurve3;
  readonly lapLength: number;

  private readonly samples: THREE.Vector3[] = [];
  private readonly sampleCount = 1024;
  private readonly widths: number[];
  private readonly controlCount: number;

  constructor() {
    const pts = (trackData.points as TrackPointDef[]).map((p) => new THREE.Vector3(p.x, p.y, p.z));
    this.widths = (trackData.points as TrackPointDef[]).map((p) => p.width);
    this.controlCount = pts.length;
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal', 0.5);
    this.lapLength = this.curve.getLength();
    for (let i = 0; i < this.sampleCount; i++) {
      this.samples.push(this.curve.getPointAt(i / this.sampleCount));
    }
  }

  posAt(t: number): THREE.Vector3 {
    return this.curve.getPointAt(wrap01(t));
  }

  tangentAt(t: number): THREE.Vector3 {
    return this.curve.getTangentAt(wrap01(t)).normalize();
  }

  /** Rightward vector across the track (perpendicular to tangent, horizontal). */
  sideAt(t: number): THREE.Vector3 {
    const tan = this.tangentAt(t);
    return new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0)).normalize().negate();
  }

  /** Half-width of the raceable canyon at t (linear interp over control points). */
  halfWidthAt(t: number): number {
    const u = wrap01(t) * this.controlCount;
    const i0 = Math.floor(u) % this.controlCount;
    const i1 = (i0 + 1) % this.controlCount;
    const f = u - Math.floor(u);
    return (this.widths[i0] * (1 - f) + this.widths[i1] * f) / 2;
  }

  /**
   * Nearest spline parameter to a world position. When hintT is given, only a
   * local window is searched (fast + avoids snapping across the loop).
   */
  nearestT(pos: THREE.Vector3, hintT?: number): number {
    const n = this.sampleCount;
    let bestI = 0;
    let bestD = Infinity;
    if (hintT === undefined) {
      for (let i = 0; i < n; i++) {
        const d = this.samples[i].distanceToSquared(pos);
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
    } else {
      const center = Math.round(wrap01(hintT) * n);
      const win = 40;
      for (let o = -win; o <= win; o++) {
        const i = ((center + o) % n + n) % n;
        const d = this.samples[i].distanceToSquared(pos);
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
    }
    return bestI / n;
  }

  checkpointT(index: number): number {
    return (index % this.checkpointCount) / this.checkpointCount;
  }
}

/**
 * Per-racer continuous progress tracker. Progress = laps + t, unwrapped so
 * crossing the start line increments cleanly and place sorting is trivial.
 */
export class ProgressTracker {
  t = 0;
  unwrapped = 0;

  constructor(private track: Track, startT = 0) {
    this.t = startT;
    this.unwrapped = startT > 0.5 ? startT - 1 : startT; // grid slots just behind the line count as lap -1 fraction
  }

  update(pos: THREE.Vector3): void {
    const newT = this.track.nearestT(pos, this.t);
    let delta = newT - this.t;
    if (delta < -0.5) delta += 1;
    else if (delta > 0.5) delta -= 1;
    this.unwrapped += delta;
    this.t = newT;
  }

  /** Full laps completed (0-based). */
  get lap(): number {
    return Math.max(0, Math.floor(this.unwrapped));
  }

  get progress(): number {
    return this.unwrapped;
  }

  get nextCheckpoint(): number {
    const frac = ((this.unwrapped % 1) + 1) % 1;
    return Math.ceil(frac * this.track.checkpointCount) % this.track.checkpointCount;
  }
}

export function wrap01(t: number): number {
  return ((t % 1) + 1) % 1;
}
