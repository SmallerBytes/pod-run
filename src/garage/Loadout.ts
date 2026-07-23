import partsData from '../data/parts.json';

export interface CageSpec {
  name: string;
  desc: string;
  mass: number;
  hull: number;
  profile: number; // drag/size multiplier
}

export interface ThrusterSpec {
  name: string;
  desc: string;
  accel: number; // m/s^2 at full twin thrust (before mass)
  topSpeed: number; // m/s
  heatRate: number; // heat per second at full thrust
  turn: number; // yaw authority multiplier
}

export interface PaintJob {
  primary: string;
  secondary: string;
  stripe: string;
}

export interface Loadout {
  cageId: string;
  thrusterId: string;
  paint: PaintJob;
}

export const CAGES = partsData.cages as Record<string, CageSpec>;
export const THRUSTERS = partsData.thrusters as Record<string, ThrusterSpec>;

const STORAGE_KEY = 'podrun.loadout.v1';

export const DEFAULT_LOADOUT: Loadout = {
  cageId: 'racer',
  thrusterId: 'surge',
  paint: { primary: '#c96a1e', secondary: '#3d4a52', stripe: '#ffd23e' }
};

export function loadLoadout(): Loadout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_LOADOUT);
    const parsed = JSON.parse(raw) as Loadout;
    if (!CAGES[parsed.cageId] || !THRUSTERS[parsed.thrusterId] || !parsed.paint) {
      return structuredClone(DEFAULT_LOADOUT);
    }
    return parsed;
  } catch {
    return structuredClone(DEFAULT_LOADOUT);
  }
}

export function saveLoadout(loadout: Loadout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(loadout));
  } catch {
    // localStorage unavailable (private mode) — loadout just won't persist
  }
}

/** Physics-facing numbers derived from a loadout. */
export interface CraftStats {
  topSpeed: number;
  accel: number;
  turnRate: number; // rad/s at full differential
  hullMax: number;
  heatRate: number;
  coolRate: number;
}

export function computeStats(loadout: Loadout): CraftStats {
  const cage = CAGES[loadout.cageId];
  const thr = THRUSTERS[loadout.thrusterId];
  return {
    topSpeed: thr.topSpeed / cage.profile,
    accel: thr.accel / cage.mass,
    turnRate: 1.35 * thr.turn / cage.mass,
    hullMax: cage.hull,
    heatRate: thr.heatRate,
    coolRate: 0.08
  };
}

/** Normalized 0..1 values for the garage spec-sheet bars. */
export function statBars(loadout: Loadout): { label: string; value: number }[] {
  const s = computeStats(loadout);
  return [
    { label: 'Top Speed', value: clamp01((s.topSpeed - 40) / 45) },
    { label: 'Thrust', value: clamp01((s.accel - 12) / 30) },
    { label: 'Handling', value: clamp01((s.turnRate - 0.7) / 1.4) },
    { label: 'Hull', value: clamp01(s.hullMax / 160) },
    { label: 'Heat Load', value: clamp01(s.heatRate / 0.2) }
  ];
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
