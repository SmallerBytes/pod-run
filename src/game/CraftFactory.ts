import * as THREE from 'three';
import { CraftBuild, DEFAULT_BUILD, ENGINE_KITS, HULL_KITS } from '../garage/Loadout';

/**
 * Assembles the skiff from a brick build (LEGO-style kits per slot).
 * Layout (craft local space, forward = -Z), matching the classic twin-engine
 * cable-linked open-cockpit racer silhouette:
 *   - open gondola bathtub (no sealed cylinder deck blocking the FOV)
 *   - motorcycle-style twin throttle grips between seat and dash
 *   - twin engines far ahead at x = +-2.3, hung on flexible power cables
 *   - glowing energy tether between the engines
 */
export interface SkiffRig {
  group: THREE.Group;
  /** Sub-group that banks/pitches for visual feel without affecting the camera rig. */
  visual: THREE.Group;
  leftEngine: THREE.Group;
  rightEngine: THREE.Group;
  leftExhaust: THREE.Mesh;
  rightExhaust: THREE.Mesh;
  /** Visual-only spring motion for loose engines, cables, and energy tether. */
  updateEngineDynamics: (
    dt: number,
    speed: number,
    yawRate: number,
    thrustLeft: number,
    thrustRight: number,
    leftHealth: number,
    rightHealth: number,
    leftExploded: boolean,
    rightExploded: boolean
  ) => void;
  /** Sliding throttle lever groups; userData = { homeZ, travel }. */
  leftLever: THREE.Group;
  rightLever: THREE.Group;
  /** Empty objects at the T-grip heads, for grab proximity checks. */
  leftGripPoint: THREE.Object3D;
  rightGripPoint: THREE.Object3D;
  dashboardAnchor: THREE.Group;
  seatPosition: THREE.Vector3;
  shadowBlob: THREE.Mesh;
}

export const LEVER_TRAVEL = 0.14; // metres of push/pull from neutral
/** Lever z fraction the lever rests at when released (~idle thrust). */
export const LEVER_IDLE_FRACTION = 0.72;

export function leverZForThrust(lever: THREE.Object3D, thrust: number): number {
  const { homeZ, travel } = lever.userData as { homeZ: number; travel: number };
  return homeZ + travel - thrust * travel * 2;
}

export function thrustForLeverZ(lever: THREE.Object3D, z: number): number {
  const { homeZ, travel } = lever.userData as { homeZ: number; travel: number };
  return THREE.MathUtils.clamp((homeZ + travel - z) / (travel * 2), 0, 1);
}

interface Mats {
  primary: THREE.MeshStandardMaterial;
  secondary: THREE.MeshStandardMaterial;
  stripe: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  cable: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  guard: THREE.MeshStandardMaterial;
}

export function buildSkiffFromBuild(
  build: CraftBuild,
  opts: { withCockpitFittings?: boolean } = {}
): SkiffRig {
  const paint = build.paint;
  const mats: Mats = {
    primary: new THREE.MeshStandardMaterial({ color: paint.primary, roughness: 0.45, metalness: 0.55 }),
    secondary: new THREE.MeshStandardMaterial({ color: paint.secondary, roughness: 0.55, metalness: 0.4 }),
    stripe: new THREE.MeshStandardMaterial({ color: paint.stripe, roughness: 0.4, metalness: 0.25 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1c1a17, roughness: 0.9, metalness: 0.2 }),
    cable: new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.8, metalness: 0.3 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x7a4a2a, roughness: 0.85, metalness: 0.05 }),
    guard: new THREE.MeshStandardMaterial({ color: 0xdfe2e6, roughness: 0.35, metalness: 0.5 })
  };

  const group = new THREE.Group();
  const visual = new THREE.Group();
  group.add(visual);

  // ---------- pilot pod ----------
  buildHull(visual, build.bricks.hull, mats);
  buildSeat(visual, build.bricks.seat, mats);
  buildNose(visual, build.bricks.nose, mats);
  buildFin(visual, build.bricks.finL, -1, mats);
  buildFin(visual, build.bricks.finR, 1, mats);

  // ---------- engines + cables + tether ----------
  const engL = buildEngine(build.bricks.engineL, -1, mats);
  const engR = buildEngine(build.bricks.engineR, 1, mats);
  visual.add(engL.group, engR.group);

  const cableL = buildCable(visual, build.bricks.cableL, -1, engL.group, engL.length, mats);
  const cableR = buildCable(visual, build.bricks.cableR, 1, engR.group, engR.length, mats);
  const updateTether = buildEnergyTether(
    visual,
    engL.group,
    engR.group,
    engL.emitterAnchor,
    engR.emitterAnchor
  );
  const updateEngineDynamics = createEngineDynamics(
    engL.group,
    engR.group,
    engL.turbineRotor,
    engR.turbineRotor,
    cableL,
    cableR,
    updateTether,
    engL.updateDamage,
    engR.updateDamage
  );

  // ---------- cockpit fittings ----------
  const leftLever = new THREE.Group();
  const rightLever = new THREE.Group();
  const leftGripPoint = new THREE.Object3D();
  const rightGripPoint = new THREE.Object3D();
  const dashboardAnchor = new THREE.Group();

  if (opts.withCockpitFittings !== false) {
    buildDashConsole(visual, mats);
    buildThrottle(visual, leftLever, leftGripPoint, -1, mats);
    buildThrottle(visual, rightLever, rightGripPoint, 1, mats);
  }
  // Diegetic HUD is the face of the raised steering console — chest height,
  // directly in the pilot's forward view (matches the reference cockpit)
  dashboardAnchor.position.set(0, 0.97, -0.42);
  dashboardAnchor.rotation.x = -0.35;
  visual.add(dashboardAnchor);

  // ---------- fake blob shadow ----------
  const shadowBlob = new THREE.Mesh(
    new THREE.CircleGeometry(4.4, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })
  );
  shadowBlob.rotation.x = -Math.PI / 2;
  shadowBlob.position.set(0, -1.1, -3);
  shadowBlob.scale.set(1, 1.6, 1);
  group.add(shadowBlob);

  return {
    group,
    visual,
    leftEngine: engL.group,
    rightEngine: engR.group,
    leftExhaust: engL.exhaust,
    rightExhaust: engR.exhaust,
    updateEngineDynamics,
    leftLever,
    rightLever,
    leftGripPoint,
    rightGripPoint,
    dashboardAnchor,
    // rig origin = pod floor; with 'local-floor' XR space a seated player's
    // real head height puts their eyes naturally above the cockpit rim
    seatPosition: new THREE.Vector3(0, 0.05, 0.15),
    shadowBlob
  };
}

// ============================== hull kits ==============================

function buildHull(parent: THREE.Group, kitId: string, mats: Mats): void {
  const hull = new THREE.Group();
  parent.add(hull);

  if (kitId === 'brick') {
    // Open brick tub — walls only on the sides/rear so the forward FOV stays clear
    const floor = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.18, 2.2), mats.primary);
    floor.position.set(0, 0.18, 0.1);
    hull.add(floor);
    for (const x of [-0.58, 0.58]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 1.9), mats.secondary);
      plate.position.set(x, 0.42, 0.15);
      hull.add(plate);
    }
    const rear = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.7, 0.14), mats.primary);
    rear.position.set(0, 0.5, 1.12);
    hull.add(rear);
    // Low front lip (not a bulkhead)
    const lip = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.14, 0.22), mats.primary);
    lip.position.set(0, 0.32, -0.95);
    hull.add(lip);
    addStuds(hull, mats.stripe, { cols: 4, rows: 2, dx: 0.26, dz: 0.3, x0: -0.39, z0: 0.65, y: 0.3 });
  } else if (kitId === 'dart') {
    buildOpenGondola(hull, mats, {
      width: 0.9,
      length: 2.0,
      bellyY: 0.22,
      rimY: 0.52,
      stripeBand: true,
      studs: true
    });
  } else {
    // 'speeder' — open gondola bathtub (classic twin-engine cable racer), not a sealed capsule
    buildOpenGondola(hull, mats, {
      width: 1.05,
      length: 2.15,
      bellyY: 0.2,
      rimY: 0.55,
      stripeBand: true,
      studs: true,
      teardrop: true
    });
  }

  // Shared cockpit floor + low side rails (hip-height, never blocking the dash)
  const floorPlate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 1.05), mats.dark);
  floorPlate.position.set(0, 0.12, 0.05);
  hull.add(floorPlate);
  for (const x of [-0.32, 0.32]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.95), mats.dark);
    rail.position.set(x, 0.28, 0.08);
    hull.add(rail);
  }

  // Angled side button panels flanking the seat (reference-style consoles)
  const buttonColors = [0xff4a3a, 0xffd23e, 0x4a90ff, 0x6fce6f, 0xff8c2a, 0x69e6e0];
  for (const side of [-1, 1] as const) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.55), mats.dark);
    panel.position.set(side * 0.34, 0.42, -0.1);
    panel.rotation.z = side * -0.35;
    hull.add(panel);
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 0.012, 0.05),
        new THREE.MeshBasicMaterial({ color: buttonColors[i] })
      );
      b.position.set(side * 0.34, 0.435, -0.32 + i * 0.09);
      b.rotation.z = side * -0.35;
      hull.add(b);
    }
  }
}

/**
 * Open bathtub pod: belly + side flanks + rear bulkhead + low front cowling.
 * No sealed top deck — dash and throttles sit in the clear forward FOV.
 */
function buildOpenGondola(
  hull: THREE.Group,
  mats: Mats,
  opts: {
    width: number;
    length: number;
    bellyY: number;
    rimY: number;
    stripeBand?: boolean;
    studs?: boolean;
    teardrop?: boolean;
  }
): void {
  const halfW = opts.width * 0.5;
  const halfL = opts.length * 0.5;

  // Flat belly slab — the tub floor from the outside
  const belly = new THREE.Mesh(new THREE.BoxGeometry(opts.width * 0.92, 0.22, opts.length), mats.primary);
  belly.position.set(0, opts.bellyY, 0.1);
  hull.add(belly);

  // Rounded undercarriage (half-pipe opening upward)
  const under = new THREE.Mesh(
    new THREE.CylinderGeometry(halfW * 0.9, halfW * 0.8, opts.length * 0.95, 14, 1, false, Math.PI * 1.5, Math.PI),
    mats.primary
  );
  under.rotation.x = Math.PI / 2;
  under.position.set(0, opts.bellyY - 0.02, 0.1);
  hull.add(under);

  // Side flanks — hip-height rails, open above so you look out over them
  for (const side of [-1, 1] as const) {
    const flank = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, opts.rimY - 0.1, opts.length * 0.72),
      mats.primary
    );
    flank.position.set(side * (halfW * 0.9), (opts.rimY + 0.1) * 0.5, 0.22);
    hull.add(flank);

    // Forward rail drops toward the cowling (no high nose wall)
    const taper = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.5), mats.primary);
    taper.position.set(side * (halfW * 0.72), 0.3, -halfL * 0.5);
    taper.rotation.x = 0.4;
    hull.add(taper);
  }

  // Rear bulkhead behind the seat
  const rear = new THREE.Mesh(new THREE.BoxGeometry(opts.width * 0.92, opts.rimY + 0.2, 0.14), mats.primary);
  rear.position.set(0, (opts.rimY + 0.2) * 0.5 + 0.05, halfL * 0.82);
  hull.add(rear);

  // Low front cowling — a lip you look OVER, with the dash sitting on top
  const cowl = new THREE.Mesh(new THREE.BoxGeometry(opts.width * 0.75, 0.14, 0.4), mats.primary);
  cowl.position.set(0, 0.36, -halfL * 0.68);
  cowl.rotation.x = 0.22;
  hull.add(cowl);
  const cowlCap = new THREE.Mesh(new THREE.BoxGeometry(opts.width * 0.68, 0.05, 0.22), mats.guard);
  cowlCap.position.set(0, 0.46, -halfL * 0.75);
  cowlCap.rotation.x = 0.22;
  hull.add(cowlCap);

  if (opts.stripeBand) {
    for (const z of [-0.3, 0.55]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(opts.width * 0.96, 0.12, 0.1), mats.secondary);
      band.position.set(0, opts.bellyY + 0.05, z);
      hull.add(band);
    }
  }

  if (opts.teardrop) {
    const tail = new THREE.Mesh(new THREE.ConeGeometry(halfW * 0.72, 0.9, 12), mats.primary);
    tail.rotation.x = Math.PI / 2;
    tail.position.set(0, opts.bellyY + 0.02, halfL + 0.3);
    hull.add(tail);
  }

  if (opts.studs) {
    addStuds(hull, mats.secondary, {
      cols: 2,
      rows: 2,
      dx: 0.22,
      dz: 0.24,
      x0: -0.11,
      z0: 0.7,
      y: opts.rimY + 0.02
    });
  }
}

// ============================== seat kits ==============================

function buildSeat(parent: THREE.Group, kitId: string, mats: Mats): void {
  const seat = new THREE.Group();
  parent.add(seat);

  if (kitId === 'bench') {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.1, 0.55), mats.secondary);
    plate.position.set(0, 0.34, 0.18);
    seat.add(plate);
    addStuds(seat, mats.stripe, { cols: 3, rows: 3, dx: 0.16, dz: 0.16, x0: -0.16, z0: 0.02, y: 0.41 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.08), mats.secondary);
    back.position.set(0, 0.62, 0.46);
    seat.add(back);
  } else if (kitId === 'racing') {
    const bucket = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), mats.dark);
    bucket.position.set(0, 0.34, 0.18);
    seat.add(bucket);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.66, 0.1), mats.dark);
    back.position.set(0, 0.7, 0.46);
    seat.add(back);
    for (const x of [-0.28, 0.28]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.3), mats.stripe);
      wing.position.set(x, 0.72, 0.42);
      seat.add(wing);
    }
  } else {
    // 'padded' — stitched leather bucket like the reference cockpit
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.52), mats.leather);
    cushion.position.set(0, 0.34, 0.18);
    seat.add(cushion);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.14), mats.leather);
    back.position.set(0, 0.68, 0.48);
    back.rotation.x = 0.12;
    seat.add(back);
    const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.12), mats.leather);
    headrest.position.set(0, 1.05, 0.52);
    seat.add(headrest);
    // stitch seams
    for (const y of [0.5, 0.68, 0.86]) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.51, 0.015, 0.02), mats.dark);
      seam.position.set(0, y, 0.41);
      seam.rotation.x = 0.12;
      seat.add(seam);
    }
  }
}

// ============================== nose kits ==============================

function buildNose(parent: THREE.Group, kitId: string, mats: Mats): void {
  const nose = new THREE.Group();
  // Sit ahead of the low cowling — kept low so it doesn't eat the forward FOV
  nose.position.set(0, 0.32, -1.25);
  parent.add(nose);

  if (kitId === 'ram') {
    const wedge = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.28, 0.55), mats.secondary);
    wedge.rotation.x = 0.35;
    wedge.position.z = -0.12;
    nose.add(wedge);
    addStuds(nose, mats.stripe, { cols: 2, rows: 1, dx: 0.28, dz: 0, x0: -0.14, z0: -0.08, y: 0.14 });
  } else if (kitId === 'sensor') {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), mats.secondary);
    ball.position.z = -0.15;
    nose.add(ball);
    for (const [x, ry] of [
      [-0.1, 0.4],
      [0.1, -0.4],
      [0, 0]
    ] as const) {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.45, 5), mats.dark);
      rod.position.set(x, 0.28, -0.15);
      rod.rotation.z = ry;
      nose.add(rod);
    }
  } else {
    // 'cone' — classic point with twin antennas
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 12), mats.primary);
    cone.rotation.x = -Math.PI / 2;
    cone.position.z = -0.25;
    nose.add(cone);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.07, 12), mats.stripe);
    ring.rotation.x = Math.PI / 2;
    ring.position.z = 0.08;
    nose.add(ring);
    for (const x of [-0.1, 0.1]) {
      const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, 0.5, 5), mats.dark);
      antenna.position.set(x, 0.36, 0);
      nose.add(antenna);
    }
  }
}

// ============================== fin kits ==============================

function buildFin(parent: THREE.Group, kitId: string, side: -1 | 1, mats: Mats): void {
  const fin = new THREE.Group();
  fin.position.set(side * 0.5, 0.6, 1.15);
  parent.add(fin);

  if (kitId === 'stub') {
    const stub = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.35), mats.secondary);
    fin.add(stub);
    addStuds(fin, mats.stripe, { cols: 1, rows: 2, dx: 0, dz: 0.14, x0: 0, z0: -0.07, y: 0.1 });
  } else if (kitId === 'wing') {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.45), mats.secondary);
    wing.position.x = side * 0.25;
    wing.rotation.z = side * -0.15;
    fin.add(wing);
    addStuds(fin, mats.stripe, { cols: 2, rows: 1, dx: 0.2, dz: 0, x0: side * 0.15 - 0.1, z0: 0, y: 0.06 });
  } else {
    // 'blade' — swept race fin like the reference tail
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.75), mats.secondary);
    blade.position.set(side * 0.12, 0.12, 0.1);
    blade.rotation.set(0, side * 0.35, side * 0.5);
    fin.add(blade);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.14, 0.5), mats.stripe);
    tip.position.set(side * 0.24, 0.3, 0.18);
    tip.rotation.set(0, side * 0.35, side * 0.5);
    fin.add(tip);
  }
}

// ============================== engine kits ==============================

function buildEngine(
  kitId: string,
  side: -1 | 1,
  mats: Mats
): {
  group: THREE.Group;
  exhaust: THREE.Mesh;
  length: number;
  emitterAnchor: THREE.Object3D;
  turbineRotor: THREE.Group;
  updateDamage: (health: number, exploded: boolean, dt: number, time: number) => void;
} {
  const dims =
    kitId === 'torque' ? { r: 0.8, len: 3.6 } : kitId === 'spike' ? { r: 0.5, len: 5.4 } : { r: 0.64, len: 4.4 };

  const g = new THREE.Group();
  g.position.set(side * 2.3, 0.9, -6.2);
  const model = new THREE.Group();
  g.add(model);

  const body = new THREE.Mesh(new THREE.CylinderGeometry(dims.r, dims.r * 0.88, dims.len, 14), mats.primary);
  body.rotation.x = Math.PI / 2;
  model.add(body);

  // layered ring stack for that segmented turbine look
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(dims.r * 1.04, 0.06, 6, 18), mats.secondary);
    ring.position.z = -dims.len * 0.32 + i * dims.len * 0.22;
    model.add(ring);
  }

  const intake = new THREE.Mesh(new THREE.ConeGeometry(dims.r, dims.r * 2.1, 14), mats.secondary);
  intake.rotation.x = -Math.PI / 2;
  intake.position.z = -(dims.len / 2 + dims.r);
  model.add(intake);

  // rear vane cluster (yellow slats fanning off the tail)
  for (let i = -1; i <= 1; i++) {
    const vane = new THREE.Mesh(new THREE.BoxGeometry(0.07, dims.r * 1.5, dims.r * 1.2), mats.stripe);
    vane.position.set(i * dims.r * 0.55, dims.r * 0.75, dims.len * 0.36);
    vane.rotation.z = i * 0.35;
    model.add(vane);
  }

  // side scoop
  const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.12, dims.r * 0.8, dims.len * 0.4), mats.secondary);
  scoop.position.set(side * dims.r * 1.02, 0, -dims.len * 0.1);
  model.add(scoop);

  addStuds(model, mats.stripe, {
    cols: 1,
    rows: 3,
    dx: 0,
    dz: dims.len * 0.18,
    x0: 0,
    z0: -dims.len * 0.2,
    y: dims.r * 1.0
  });

  // Inner-side energy tether emitter: armored socket, luminous lens, and a
  // precise anchor point used by the animated beam.
  const innerDirection = -side;
  const emitterX = innerDirection * (dims.r + 0.08);
  const emitterHousing = new THREE.Mesh(
    new THREE.CylinderGeometry(dims.r * 0.16, dims.r * 0.21, dims.r * 0.32, 10),
    mats.secondary
  );
  emitterHousing.rotation.z = Math.PI / 2;
  emitterHousing.position.x = emitterX;
  model.add(emitterHousing);

  const emitterRim = new THREE.Mesh(
    new THREE.TorusGeometry(dims.r * 0.13, dims.r * 0.035, 6, 14),
    mats.guard
  );
  emitterRim.rotation.y = Math.PI / 2;
  emitterRim.position.x = emitterX + innerDirection * dims.r * 0.16;
  model.add(emitterRim);

  const emitterLens = new THREE.Mesh(
    new THREE.SphereGeometry(dims.r * 0.105, 10, 8),
    new THREE.MeshBasicMaterial({
      color: 0xaeeeff,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  emitterLens.position.x = emitterX + innerDirection * dims.r * 0.18;
  model.add(emitterLens);

  const emitterAnchor = new THREE.Object3D();
  emitterAnchor.position.copy(emitterLens.position);
  g.add(emitterAnchor);

  // Layered jet/afterburner nozzle instead of a flat engine cap.
  const nozzleLength = dims.r * 0.78;
  const nozzleZ = dims.len / 2 + nozzleLength * 0.5;

  // Tapered outer shroud: narrower at the engine, flared at the exhaust lip.
  const nozzle = new THREE.Mesh(
    new THREE.CylinderGeometry(
      dims.r * 0.82,
      dims.r * 0.57,
      nozzleLength,
      16,
      2,
      true
    ),
    mats.dark
  );
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.z = nozzleZ;
  model.add(nozzle);

  // Metallic collar where the nozzle joins the engine body.
  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(dims.r * 0.62, dims.r * 0.075, 8, 20),
    mats.secondary
  );
  collar.position.z = dims.len / 2 + 0.03;
  model.add(collar);

  // Thick heat-darkened rim around the nozzle exit.
  const lipZ = dims.len / 2 + nozzleLength;
  const lip = new THREE.Mesh(
    new THREE.TorusGeometry(dims.r * 0.82, dims.r * 0.09, 8, 24),
    new THREE.MeshStandardMaterial({
      color: 0x24201d,
      roughness: 0.48,
      metalness: 0.85
    })
  );
  lip.position.z = lipZ;
  model.add(lip);

  // Recessed glowing combustion chamber visible behind the vanes.
  const chamber = new THREE.Mesh(
    new THREE.CircleGeometry(dims.r * 0.72, 24),
    new THREE.MeshBasicMaterial({
      color: 0xff7a18,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    })
  );
  chamber.position.z = lipZ - 0.035;
  model.add(chamber);

  // Afterburner/turbine rotor: petals and hub spin together with throttle.
  const turbineRotor = new THREE.Group();
  turbineRotor.position.z = lipZ;
  model.add(turbineRotor);
  const vaneMat = new THREE.MeshStandardMaterial({
    color: 0x39342f,
    roughness: 0.42,
    metalness: 0.8,
    emissive: 0x3a1406,
    emissiveIntensity: 0.45
  });
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    const vane = new THREE.Mesh(
      new THREE.BoxGeometry(dims.r * 0.09, dims.r * 0.56, dims.r * 0.055),
      vaneMat
    );
    vane.position.set(
      Math.cos(angle) * dims.r * 0.38,
      Math.sin(angle) * dims.r * 0.38,
      0.015
    );
    vane.rotation.z = angle - Math.PI / 2;
    turbineRotor.add(vane);
  }

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(dims.r * 0.16, dims.r * 0.21, dims.r * 0.24, 12),
    mats.secondary
  );
  hub.rotation.x = Math.PI / 2;
  hub.position.z = dims.r * 0.08;
  turbineRotor.add(hub);

  const exhaust = buildAnimatedExhaust(dims.r * 0.7);
  exhaust.rotation.x = Math.PI / 2;
  // Cone base and nozzle bloom begin just outside the visible exhaust lip.
  exhaust.position.z = lipZ + 1.15;
  model.add(exhaust);

  const updateDamage = buildEngineDamageEffects(g, model, dims.r);
  return {
    group: g,
    exhaust,
    length: dims.len,
    emitterAnchor,
    turbineRotor,
    updateDamage
  };
}

/**
 * Local smoke, flash, shock ring, and spark burst for one engine. The engine
 * model disappears after detonation and is restored when repaired.
 */
function buildEngineDamageEffects(
  engine: THREE.Group,
  model: THREE.Group,
  radius: number
): (health: number, exploded: boolean, dt: number, time: number) => void {
  const smokeCount = 22;
  const smokePositions = new Float32Array(smokeCount * 3);
  const smokeSeeds = new Float32Array(smokeCount * 3);
  for (let i = 0; i < smokeCount; i++) {
    smokeSeeds[i * 3] = (Math.random() - 0.5) * radius * 0.7;
    smokeSeeds[i * 3 + 1] = Math.random();
    smokeSeeds[i * 3 + 2] = (Math.random() - 0.5) * radius * 0.8;
  }
  const smokeGeometry = new THREE.BufferGeometry();
  smokeGeometry.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
  const smokeMaterial = new THREE.PointsMaterial({
    color: 0x332b25,
    size: radius * 0.28,
    transparent: true,
    opacity: 0,
    depthWrite: false
  });
  const smoke = new THREE.Points(smokeGeometry, smokeMaterial);
  smoke.visible = false;
  smoke.frustumCulled = false;
  engine.add(smoke);

  const explosion = new THREE.Group();
  explosion.visible = false;
  engine.add(explosion);

  const flashMaterial = new THREE.MeshBasicMaterial({
    color: 0xffb12f,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const flash = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.65, 14, 10), flashMaterial);
  explosion.add(flash);

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xff6a18,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide
  });
  const shockRing = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.72, 0.045, 6, 24), ringMaterial);
  shockRing.rotation.x = Math.PI / 2;
  explosion.add(shockRing);

  const sparkCount = 42;
  const sparkPositions = new Float32Array(sparkCount * 3);
  const sparkVelocities: THREE.Vector3[] = [];
  for (let i = 0; i < sparkCount; i++) {
    sparkVelocities.push(
      new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.35,
        Math.random() - 0.5
      )
        .normalize()
        .multiplyScalar(2.5 + Math.random() * 5)
    );
  }
  const sparkGeometry = new THREE.BufferGeometry();
  const sparkAttribute = new THREE.BufferAttribute(sparkPositions, 3);
  sparkGeometry.setAttribute('position', sparkAttribute);
  const sparkMaterial = new THREE.PointsMaterial({
    color: 0xffd36a,
    size: radius * 0.12,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
  sparks.frustumCulled = false;
  explosion.add(sparks);

  let wasExploded = false;
  let explosionAge = -1;
  return (health, exploded, dt, time) => {
    const damage = 1 - THREE.MathUtils.clamp(health, 0, 1);
    smoke.visible = damage > 0.35 && !exploded;
    smokeMaterial.opacity = THREE.MathUtils.clamp((damage - 0.35) * 1.1, 0, 0.65);
    if (smoke.visible) {
      for (let i = 0; i < smokeCount; i++) {
        const cycle = (smokeSeeds[i * 3 + 1] + time * (0.35 + damage * 0.4)) % 1;
        smokePositions[i * 3] =
          smokeSeeds[i * 3] + Math.sin(time * 2.2 + i) * radius * 0.08 * cycle;
        smokePositions[i * 3 + 1] = cycle * radius * 2.5;
        smokePositions[i * 3 + 2] = smokeSeeds[i * 3 + 2] + cycle * radius * 0.5;
      }
      (smokeGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }

    if (exploded && !wasExploded) {
      explosionAge = 0;
      explosion.visible = true;
      model.visible = false;
      flash.scale.setScalar(1);
      flashMaterial.opacity = 1;
      shockRing.scale.setScalar(1);
      ringMaterial.opacity = 1;
      sparkMaterial.opacity = 1;
      sparkPositions.fill(0);
      sparkAttribute.needsUpdate = true;
    } else if (!exploded) {
      explosionAge = -1;
      explosion.visible = false;
      model.visible = true;
    }
    wasExploded = exploded;

    if (explosionAge >= 0) {
      explosionAge += dt;
      const expansion = 1 + explosionAge * 5.5;
      flash.scale.setScalar(expansion);
      flashMaterial.opacity = Math.max(0, 1 - explosionAge * 1.45);
      shockRing.scale.setScalar(1 + explosionAge * 7);
      ringMaterial.opacity = Math.max(0, 1 - explosionAge * 1.1);
      for (let i = 0; i < sparkCount; i++) {
        const velocity = sparkVelocities[i];
        sparkPositions[i * 3] = velocity.x * explosionAge;
        sparkPositions[i * 3 + 1] =
          velocity.y * explosionAge - 2.8 * explosionAge * explosionAge;
        sparkPositions[i * 3 + 2] = velocity.z * explosionAge;
      }
      sparkAttribute.needsUpdate = true;
      sparkMaterial.opacity = Math.max(0, 1 - explosionAge * 0.65);
      if (explosionAge > 1.7) explosion.visible = false;
    }
  };
}

/**
 * Layered additive flame with a hot white core, orange edge, animated
 * distortion, and flickering length. Animation is driven during rendering,
 * so player and AI engines share it without another update system.
 */
function buildAnimatedExhaust(radius: number): THREE.Mesh {
  const makeFlameMaterial = (
    core: THREE.ColorRepresentation,
    edge: THREE.ColorRepresentation,
    opacity: number,
    phase: number
  ) => {
    const uniforms = {
      uTime: { value: 0 },
      uCore: { value: new THREE.Color(core) },
      uEdge: { value: new THREE.Color(edge) },
      uOpacity: { value: opacity }
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        varying vec2 vUv;
        uniform float uTime;
        void main() {
          vUv = uv;
          vec3 p = position;
          float along = clamp(uv.y, 0.0, 1.0);
          float flicker = 1.0 + 0.10 * sin(uTime * 15.0 + along * 12.0)
                              + 0.045 * sin(uTime * 29.0 + along * 25.0);
          p.y *= flicker;
          float wave = sin(uTime * 12.0 + p.y * 9.0) * (0.018 + along * 0.035);
          p.x += wave;
          p.z += cos(uTime * 10.0 + p.y * 8.0) * (0.012 + along * 0.025);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform vec3 uCore;
        uniform vec3 uEdge;
        uniform float uOpacity;
        void main() {
          float radial = abs(vUv.x - 0.5) * 2.0;
          float edgeFade = smoothstep(1.0, 0.15, radial);
          float lengthFade = smoothstep(0.02, 0.18, vUv.y)
                           * smoothstep(1.0, 0.48, vUv.y);
          float pulse = 0.82 + 0.18 * sin(uTime * 18.0 + vUv.y * 20.0);
          vec3 color = mix(uCore, uEdge, radial * 0.78 + vUv.y * 0.22);
          gl_FragColor = vec4(color, edgeFade * lengthFade * pulse * uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    return { material, uniforms, phase };
  };

  const outerShader = makeFlameMaterial(0xfff2b0, 0xff4a08, 0.82, 0);
  const exhaust = new THREE.Mesh(
    new THREE.ConeGeometry(radius, 2.35, 16, 1, true),
    outerShader.material
  );
  exhaust.onBeforeRender = () => {
    outerShader.uniforms.uTime.value = performance.now() * 0.001 + outerShader.phase;
  };

  const innerShader = makeFlameMaterial(0xffffff, 0x69d8ff, 0.95, 1.7);
  const inner = new THREE.Mesh(
    new THREE.ConeGeometry(radius * 0.48, 1.65, 12, 1, true),
    innerShader.material
  );
  inner.position.y = -0.08;
  inner.onBeforeRender = () => {
    innerShader.uniforms.uTime.value = performance.now() * 0.001 + innerShader.phase;
  };
  exhaust.add(inner);

  // Bright nozzle bloom at the flame root.
  const bloom = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 0.62, 12, 8),
    new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    })
  );
  bloom.position.y = -1.08;
  bloom.scale.y = 0.35;
  exhaust.add(bloom);

  return exhaust;
}

/**
 * Animated energy coupler that continuously stretches between the two moving
 * engines. Returns an updater used by the visual spring simulation.
 */
function buildEnergyTether(
  parent: THREE.Group,
  leftEngine: THREE.Group,
  rightEngine: THREE.Group,
  leftEmitter: THREE.Object3D,
  rightEmitter: THREE.Object3D
): (time: number, enabled: boolean) => void {
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xc9f4ff,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });
  // Unit cylinder; updater positions, rotates, and stretches it between engines.
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8), coreMat);
  parent.add(core);

  const points = 32;
  const arcs: {
    line: THREE.Line;
    attr: THREE.BufferAttribute;
    material: THREE.LineBasicMaterial;
    phase: number;
  }[] = [];
  for (let arcIndex = 0; arcIndex < 3; arcIndex++) {
    const geometry = new THREE.BufferGeometry();
    const attr = new THREE.BufferAttribute(new Float32Array(points * 3), 3);
    geometry.setAttribute('position', attr);
    const material = new THREE.LineBasicMaterial({
      color: arcIndex === 1 ? 0x76cfff : 0xe2fbff,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    parent.add(line);
    arcs.push({ line, attr, material, phase: arcIndex * 2.17 });
  }

  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  const delta = new THREE.Vector3();
  const midpoint = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const update = (time: number, enabled: boolean) => {
    core.visible = enabled;
    for (const arc of arcs) arc.line.visible = enabled;
    if (!enabled) return;

    // Follow the actual emitter sockets as the engines swing and rotate.
    leftEngine.updateMatrix();
    rightEngine.updateMatrix();
    start.copy(leftEmitter.position).applyMatrix4(leftEngine.matrix);
    end.copy(rightEmitter.position).applyMatrix4(rightEngine.matrix);
    delta.subVectors(end, start);
    const length = Math.max(0.1, delta.length());
    midpoint.copy(start).addScaledVector(delta, 0.5);

    core.position.copy(midpoint);
    core.quaternion.setFromUnitVectors(up, delta.clone().normalize());
    const pulse = 0.9 + Math.sin(time * 23) * 0.12;
    core.scale.set(pulse, length, pulse);
    coreMat.opacity = 0.72 + Math.sin(time * 18) * 0.18;

    arcs.forEach(({ attr, material, phase }, arcIndex) => {
      const arr = attr.array as Float32Array;
      for (let i = 0; i < points; i++) {
        const u = i / (points - 1);
        const envelope = Math.sin(Math.PI * u);
        arr[i * 3] = THREE.MathUtils.lerp(start.x, end.x, u);
        arr[i * 3 + 1] =
          THREE.MathUtils.lerp(start.y, end.y, u) +
          envelope *
            (Math.sin(u * 31 + time * (15 + arcIndex * 2) + phase) * 0.065 +
              Math.sin(u * 67 - time * 21 + phase) * 0.03);
        arr[i * 3 + 2] =
          THREE.MathUtils.lerp(start.z, end.z, u) +
          envelope *
            (Math.cos(u * 27 - time * (13 + arcIndex) + phase) * 0.06 +
              Math.sin(u * 53 + time * 17 + phase) * 0.028);
      }
      attr.needsUpdate = true;
      material.opacity = 0.5 + 0.4 * Math.abs(Math.sin(time * 11 + phase));
    });
  };
  update(0, true);
  return update;
}

// ============================== cable kits ==============================

function buildCable(
  parent: THREE.Group,
  kitId: string,
  side: -1 | 1,
  engine: THREE.Group,
  engineLen: number,
  mats: Mats
): (detached: boolean, time: number) => void {
  const from = new THREE.Vector3(side * 0.45, 0.55, -0.7);
  const strands =
    kitId === 'twin'
      ? [
          { offset: 0.055, radius: 0.035, sag: 0.34 },
          { offset: -0.055, radius: 0.035, sag: 0.34 }
        ]
      : kitId === 'taut'
        ? [{ offset: 0, radius: 0.055, sag: 0.08 }]
        : [{ offset: 0, radius: 0.065, sag: 0.58 }];
  const segments = 18;
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 6);
  const cable = new THREE.InstancedMesh(geometry, mats.cable, strands.length * segments);
  cable.frustumCulled = false;
  parent.add(cable);

  const attachLocal = new THREE.Vector3(-side * 0.2, 0, engineLen * 0.42);
  const to = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const midpoint = new THREE.Vector3();
  const delta = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const dummy = new THREE.Object3D();

  const pointAt = (out: THREE.Vector3, u: number, offset: number, sag: number) => {
    out.copy(from).lerp(to, u);
    const envelope = 4 * u * (1 - u);
    out.y += offset - sag * envelope;
    out.x += side * 0.25 * envelope;
  };

  const update = (detached: boolean, time: number) => {
    if (detached) {
      // The engine-side connector has torn free. Keep the cable attached to
      // the cockpit and let its loose end hang, swing, and trail behind.
      to.set(
        side * (1.25 + Math.sin(time * 1.8) * 0.22),
        -0.5 + Math.sin(time * 2.5 + side) * 0.18,
        -3.0 + Math.cos(time * 1.55 + side) * 0.42
      );
    } else {
      engine.updateMatrix();
      to.copy(attachLocal).applyMatrix4(engine.matrix);
    }
    let instance = 0;
    for (const strand of strands) {
      for (let i = 0; i < segments; i++) {
        const sag = strand.sag + (detached ? 1.25 : 0);
        pointAt(a, i / segments, strand.offset, sag);
        pointAt(b, (i + 1) / segments, strand.offset, sag);
        delta.subVectors(b, a);
        midpoint.copy(a).addScaledVector(delta, 0.5);
        dummy.position.copy(midpoint);
        dummy.quaternion.setFromUnitVectors(up, delta.clone().normalize());
        dummy.scale.set(strand.radius, delta.length(), strand.radius);
        dummy.updateMatrix();
        cable.setMatrixAt(instance++, dummy.matrix);
      }
    }
    cable.instanceMatrix.needsUpdate = true;
  };
  update(false, 0);
  return update;
}

/**
 * Loose-coupled visual suspension for the engines. Spring/damper motion makes
 * them lag behind acceleration and turns, while independent thrust and engine
 * vibration keep the pair from moving like one rigid object.
 */
function createEngineDynamics(
  leftEngine: THREE.Group,
  rightEngine: THREE.Group,
  leftTurbine: THREE.Group,
  rightTurbine: THREE.Group,
  updateLeftCable: (detached: boolean, time: number) => void,
  updateRightCable: (detached: boolean, time: number) => void,
  updateTether: (time: number, enabled: boolean) => void,
  updateLeftDamage: (health: number, exploded: boolean, dt: number, time: number) => void,
  updateRightDamage: (health: number, exploded: boolean, dt: number, time: number) => void
): SkiffRig['updateEngineDynamics'] {
  const engines = [leftEngine, rightEngine] as const;
  const bases = engines.map((engine) => engine.position.clone());
  const offsets = [new THREE.Vector3(), new THREE.Vector3()];
  const velocities = [new THREE.Vector3(), new THREE.Vector3()];
  const targets = [new THREE.Vector3(), new THREE.Vector3()];
  const turbines = [leftTurbine, rightTurbine] as const;
  const turbineSpeeds = [0, 0];
  let lastSpeed = 0;
  let time = 0;

  const update: SkiffRig['updateEngineDynamics'] = (
    dt,
    speed,
    yawRate,
    thrustLeft,
    thrustRight,
    leftHealth,
    rightHealth,
    leftExploded,
    rightExploded
  ) => {
    const step = Math.min(dt, 0.05);
    time += step;
    const acceleration =
      step > 0.0001 ? THREE.MathUtils.clamp((speed - lastSpeed) / step, -45, 65) : 0;
    lastSpeed = speed;
    const thrusts = [thrustLeft, thrustRight];

    engines.forEach((engine, index) => {
      const side = index === 0 ? -1 : 1;
      const phase = index === 0 ? 0 : 2.4;
      const ownThrust = thrusts[index];
      const otherThrust = thrusts[1 - index];
      const exploded = index === 0 ? leftExploded : rightExploded;

      // Turbine has its own rotational inertia: throttle spins it up quickly,
      // while release lets it coast down instead of stopping instantly.
      const targetTurbineSpeed = exploded ? 0 : 1.4 + ownThrust * 34;
      const turbineResponse = ownThrust > turbineSpeeds[index] / 34 ? 7 : 2.2;
      turbineSpeeds[index] = THREE.MathUtils.lerp(
        turbineSpeeds[index],
        targetTurbineSpeed,
        1 - Math.exp(-step * turbineResponse)
      );
      turbines[index].rotation.z += turbineSpeeds[index] * step * (index === 0 ? 1 : -1);

      targets[index].set(
        // Both engines swing outward/opposite the pod's turn, with a little
        // independent spread from differential thrust.
        yawRate * 1.15 + side * (ownThrust - otherThrust) * 0.12,
        Math.sin(time * 3.4 + phase) * (0.055 + ownThrust * 0.045) +
          Math.sin(time * 8.7 + phase) * 0.018,
        // Acceleration pulls the engines back toward the cockpit; stronger
        // individual thrust tugs that engine slightly farther forward.
        acceleration * 0.011 - ownThrust * 0.11 +
          Math.sin(time * 2.7 + phase) * 0.035
      );

      // Spring-damper integration: loose enough to visibly overshoot, stable
      // enough to avoid VR-unfriendly snapping.
      velocities[index].addScaledVector(
        targets[index].clone().sub(offsets[index]),
        10.5 * step
      );
      velocities[index].multiplyScalar(Math.exp(-4.2 * step));
      offsets[index].addScaledVector(velocities[index], step);
      offsets[index].x = THREE.MathUtils.clamp(offsets[index].x, -0.55, 0.55);
      offsets[index].y = THREE.MathUtils.clamp(offsets[index].y, -0.24, 0.24);
      offsets[index].z = THREE.MathUtils.clamp(offsets[index].z, -0.5, 0.6);

      engine.position.copy(bases[index]).add(offsets[index]);
      engine.rotation.x = THREE.MathUtils.lerp(
        engine.rotation.x,
        -velocities[index].y * 0.16 + Math.sin(time * 5 + phase) * 0.012,
        1 - Math.exp(-step * 7)
      );
      engine.rotation.y = THREE.MathUtils.lerp(
        engine.rotation.y,
        -yawRate * 0.24 - side * (ownThrust - otherThrust) * 0.05,
        1 - Math.exp(-step * 6)
      );
      engine.rotation.z = THREE.MathUtils.lerp(
        engine.rotation.z,
        -velocities[index].x * 0.14 + side * Math.sin(time * 4.1 + phase) * 0.015,
        1 - Math.exp(-step * 6)
      );
    });

    updateLeftCable(leftExploded, time);
    updateRightCable(rightExploded, time);
    updateTether(time, !leftExploded && !rightExploded);
    updateLeftDamage(leftHealth, leftExploded, step, time);
    updateRightDamage(rightHealth, rightExploded, step, time);
  };

  // Initialize all flexible links before the first rendered frame.
  update(0, 0, 0, 0, 0, 1, 1, false, false);
  return update;
}

// ============================== cockpit fittings ==============================

/**
 * Raised steering console head unit at chest height — no center pillar
 * (that blocked the FOV). The diegetic HUD mounts on its pilot-facing face.
 */
function buildDashConsole(parent: THREE.Group, mats: Mats): void {
  const consolePod = new THREE.Group();
  consolePod.position.set(0, 0, -0.6);
  parent.add(consolePod);

  // head unit — the HUD panel sits on its pilot-facing side
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.32, 0.18), mats.dark);
  head.position.set(0, 0.95, 0.06);
  head.rotation.x = -0.35;
  consolePod.add(head);

  // rounded top roll across the head unit
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.6, 10), mats.dark);
  roll.rotation.z = Math.PI / 2;
  roll.position.set(0, 1.1, 0.01);
  consolePod.add(roll);

  // side pods where the throttle arms pass the console (visual sockets)
  for (const s of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.16, 8), mats.guard);
    pod.rotation.z = s * (Math.PI / 2 - 0.35);
    pod.position.set(s * 0.34, 1.06, 0.04);
    consolePod.add(pod);
  }
}

/**
 * Reference-style throttle: an arm rises beside the console to a handlebar
 * grip at chest height, angled up-and-outward — you reach up and grab it like
 * Anakin. The whole lever still slides along Z for push/pull thrust.
 */
function buildThrottle(
  parent: THREE.Group,
  lever: THREE.Group,
  gripPoint: THREE.Object3D,
  side: -1 | 1,
  mats: Mats
): void {
  // Beside the seat, slightly forward — close enough to grab, not crowding the lap
  const x = side * 0.28;
  const homeZ = -0.18;

  // Slide rail on the floor (shows the push/pull travel)
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.025, LEVER_TRAVEL * 2 + 0.12), mats.dark);
  rail.position.set(x, 0.11, homeZ);
  parent.add(rail);

  // Sliding lever assembly
  lever.position.set(x, 0.14, homeZ);
  lever.userData = { homeZ, travel: LEVER_TRAVEL };
  parent.add(lever);

  // corrugated boot at the base
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.Mesh(new THREE.TorusGeometry(0.05 - i * 0.004, 0.016, 6, 10), mats.cable);
    seg.rotation.x = Math.PI / 2;
    seg.position.y = i * 0.04;
    lever.add(seg);
  }

  // lower arm — straight riser
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.034, 0.55, 8), mats.dark);
  lower.position.set(0, 0.3, 0);
  lever.add(lower);

  const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6), mats.guard);
  elbow.position.set(0, 0.58, 0);
  lever.add(elbow);

  // upper arm — leans up, outward, and slightly back toward the pilot
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.48, 8), mats.dark);
  upper.position.set(side * 0.03, 0.8, 0.05);
  upper.rotation.set(0.2, 0, side * -0.15);
  lever.add(upper);

  // handlebar grip raised a bit higher, eased back from the lap
  const gripGroup = new THREE.Group();
  gripGroup.position.set(side * 0.06, 1.02, 0.1);
  gripGroup.rotation.z = -side * (Math.PI / 2 - 0.35);
  lever.add(gripGroup);

  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.19, 10), mats.cable);
  gripGroup.add(grip);

  // rubber grip rings
  for (const gy of [-0.05, 0, 0.05]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 12), mats.leather);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = gy;
    gripGroup.add(ring);
  }

  // knuckle guard plate in front of the grip
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.15, 0.035), mats.guard);
  guard.position.set(0, 0, -0.075);
  gripGroup.add(guard);

  // outer end cap + inner thumb-button cluster (red, like the reference)
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.036, 8, 6), mats.stripe);
  cap.position.y = 0.105;
  gripGroup.add(cap);
  const thumb = new THREE.Mesh(
    new THREE.BoxGeometry(0.045, 0.03, 0.02),
    new THREE.MeshBasicMaterial({ color: 0xff4a3a })
  );
  thumb.position.set(0, -0.08, 0.03);
  gripGroup.add(thumb);

  gripPoint.position.set(0, 0, 0);
  gripGroup.add(gripPoint);
}

// ============================== helpers ==============================

function addStuds(
  parent: THREE.Group,
  mat: THREE.Material,
  layout: { cols: number; rows: number; dx: number; dz: number; x0: number; z0: number; y: number }
): void {
  const geo = new THREE.CylinderGeometry(0.048, 0.048, 0.035, 10);
  for (let c = 0; c < layout.cols; c++) {
    for (let r = 0; r < layout.rows; r++) {
      const stud = new THREE.Mesh(geo, mat);
      stud.position.set(layout.x0 + c * layout.dx, layout.y, layout.z0 + r * layout.dz);
      parent.add(stud);
    }
  }
}

/** Random rival build + livery for AI racers. */
export function randomRivalBuild(seedIndex: number): CraftBuild {
  const pick = <T>(arr: T[], salt: number) => arr[(seedIndex * 3 + salt) % arr.length];
  const hulls = Object.keys(HULL_KITS);
  const engines = Object.keys(ENGINE_KITS);
  const liveries = [
    { primary: '#7a3030', secondary: '#2e2a26', stripe: '#e8d8b0' },
    { primary: '#33556b', secondary: '#4a3720', stripe: '#ff8c2a' },
    { primary: '#5b6d3a', secondary: '#3d4a52', stripe: '#f3e6d0' },
    { primary: '#6b4d8a', secondary: '#26222e', stripe: '#ffd23e' },
    { primary: '#8a7430', secondary: '#403a2c', stripe: '#9fd8ff' }
  ];
  const build = structuredClone(DEFAULT_BUILD);
  build.bricks.hull = pick(hulls, 0);
  build.bricks.engineL = pick(engines, 1);
  build.bricks.engineR = build.bricks.engineL;
  build.bricks.nose = pick(Object.keys({ cone: 1, ram: 1, sensor: 1 }), 2);
  build.bricks.finL = pick(Object.keys({ blade: 1, stub: 1, wing: 1 }), 1);
  build.bricks.finR = build.bricks.finL;
  build.paint = liveries[seedIndex % liveries.length];
  return build;
}
