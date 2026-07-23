/**
 * Brick-kit build model: the craft is assembled from snap-together kits per
 * slot (LEGO-style). Engine kits carry thrust stats, hull kits carry
 * mass/armor. Everything persists to localStorage.
 */

export type BrickSlot =
  | 'hull'
  | 'seat'
  | 'nose'
  | 'finL'
  | 'finR'
  | 'engineL'
  | 'engineR'
  | 'cableL'
  | 'cableR';

export const SLOT_LABELS: Record<BrickSlot, string> = {
  hull: 'Hull',
  seat: 'Seat',
  nose: 'Nose',
  finL: 'Left Fin',
  finR: 'Right Fin',
  engineL: 'Left Engine',
  engineR: 'Right Engine',
  cableL: 'Left Cable',
  cableR: 'Right Cable'
};

export interface KitMeta {
  name: string;
  desc: string;
}

export interface HullKit extends KitMeta {
  mass: number;
  hull: number;
  profile: number; // drag/size multiplier
}

export interface EngineKit extends KitMeta {
  accel: number; // m/s^2 at full twin thrust (before mass)
  topSpeed: number; // m/s
  heatRate: number; // heat per second at full thrust
  turn: number; // yaw authority multiplier
}

export const HULL_KITS: Record<string, HullKit> = {
  speeder: { name: 'Speeder', desc: 'Sleek teardrop pod', mass: 1.0, hull: 100, profile: 1.0 },
  dart: { name: 'Dart', desc: 'Light frame, fragile', mass: 0.85, hull: 70, profile: 0.9 },
  brick: { name: 'Brick', desc: 'Armored block, heavy', mass: 1.3, hull: 150, profile: 1.12 }
};

export const ENGINE_KITS: Record<string, EngineKit> = {
  torque: { name: 'Torque', desc: 'Strong low-end pull', accel: 34, topSpeed: 52, heatRate: 0.09, turn: 1.3 },
  surge: { name: 'Surge', desc: 'Mid-range all-rounder', accel: 27, topSpeed: 60, heatRate: 0.12, turn: 1.05 },
  spike: { name: 'Spike', desc: 'Blistering top end, runs hot', accel: 21, topSpeed: 70, heatRate: 0.18, turn: 0.85 }
};

export const SEAT_KITS: Record<string, KitMeta> = {
  padded: { name: 'Padded', desc: 'Stitched leather bucket' },
  bench: { name: 'Bench', desc: 'Flat studded plate' },
  racing: { name: 'Racing', desc: 'Winged race shell' }
};

export const NOSE_KITS: Record<string, KitMeta> = {
  cone: { name: 'Cone', desc: 'Classic point + antennas' },
  ram: { name: 'Ram', desc: 'Blunt wedge plow' },
  sensor: { name: 'Sensor', desc: 'Scanner ball array' }
};

export const FIN_KITS: Record<string, KitMeta> = {
  blade: { name: 'Blade', desc: 'Swept race fin' },
  stub: { name: 'Stub', desc: 'Short brick stub' },
  wing: { name: 'Wing', desc: 'Broad stud wing' }
};

export const CABLE_KITS: Record<string, KitMeta> = {
  slack: { name: 'Slack', desc: 'Drooping power line' },
  taut: { name: 'Taut', desc: 'Straight tensioned line' },
  twin: { name: 'Twin', desc: 'Double thin lines' }
};

export const KIT_CATALOG: Record<BrickSlot, Record<string, KitMeta>> = {
  hull: HULL_KITS,
  seat: SEAT_KITS,
  nose: NOSE_KITS,
  finL: FIN_KITS,
  finR: FIN_KITS,
  engineL: ENGINE_KITS,
  engineR: ENGINE_KITS,
  cableL: CABLE_KITS,
  cableR: CABLE_KITS
};

export interface PaintJob {
  primary: string;
  secondary: string;
  stripe: string;
}

export interface CraftBuild {
  bricks: Record<BrickSlot, string>;
  paint: PaintJob;
}

/** Anakin-layout default: silver teardrop, blue trim, yellow accents. */
export const DEFAULT_BUILD: CraftBuild = {
  bricks: {
    hull: 'speeder',
    seat: 'padded',
    nose: 'cone',
    finL: 'blade',
    finR: 'blade',
    engineL: 'surge',
    engineR: 'surge',
    cableL: 'slack',
    cableR: 'slack'
  },
  paint: { primary: '#c8ccd2', secondary: '#2a4fae', stripe: '#ffd23e' }
};

const STORAGE_KEY = 'podrun.build.v1';

export function loadBuild(): CraftBuild {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_BUILD);
    const parsed = JSON.parse(raw) as CraftBuild;
    if (!parsed.bricks || !parsed.paint) return structuredClone(DEFAULT_BUILD);
    // fill any missing/unknown slots from the default so old saves stay valid
    const build = structuredClone(DEFAULT_BUILD);
    for (const slot of Object.keys(build.bricks) as BrickSlot[]) {
      const kitId = parsed.bricks[slot];
      if (kitId && KIT_CATALOG[slot][kitId]) build.bricks[slot] = kitId;
    }
    build.paint = { ...build.paint, ...parsed.paint };
    return build;
  } catch {
    return structuredClone(DEFAULT_BUILD);
  }
}

export function saveBuild(build: CraftBuild): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(build));
  } catch {
    // localStorage unavailable (private mode) — build just won't persist
  }
}

/** Physics-facing numbers derived from a build. */
export interface CraftStats {
  topSpeed: number;
  accel: number;
  turnRate: number; // yaw authority (lean + differential scale)
  hullMax: number;
  heatRate: number;
  coolRate: number;
}

export function computeStats(build: CraftBuild): CraftStats {
  const hull = HULL_KITS[build.bricks.hull];
  const eL = ENGINE_KITS[build.bricks.engineL];
  const eR = ENGINE_KITS[build.bricks.engineR];
  const avg = (k: (e: EngineKit) => number) => (k(eL) + k(eR)) / 2;
  return {
    topSpeed: avg((e) => e.topSpeed) / hull.profile,
    accel: avg((e) => e.accel) / hull.mass,
    turnRate: (1.35 * avg((e) => e.turn)) / hull.mass,
    hullMax: hull.hull,
    heatRate: avg((e) => e.heatRate),
    coolRate: 0.08
  };
}

/** Normalized 0..1 values for the garage spec-sheet bars. */
export function statBars(build: CraftBuild): { label: string; value: number }[] {
  const s = computeStats(build);
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
