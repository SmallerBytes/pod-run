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
  glow: THREE.MeshBasicMaterial;
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
    guard: new THREE.MeshStandardMaterial({ color: 0xdfe2e6, roughness: 0.35, metalness: 0.5 }),
    glow: new THREE.MeshBasicMaterial({ color: 0xff8c2a })
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

  buildCable(visual, build.bricks.cableL, -1, engL.length, mats);
  buildCable(visual, build.bricks.cableR, 1, engR.length, mats);

  const tetherLen = 4.6 - 0.3;
  const tether = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, tetherLen, 6),
    new THREE.MeshBasicMaterial({ color: 0xb8e6ff, transparent: true, opacity: 0.85 })
  );
  tether.rotation.z = Math.PI / 2;
  tether.position.set(0, 0.9, -6.2);
  visual.add(tether);

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

  // Windscreen arches over and BEHIND the console — see-through, frames the view
  const canopyMat = new THREE.MeshStandardMaterial({
    color: 0xbfe2ec,
    transparent: true,
    opacity: 0.25,
    roughness: 0.15,
    metalness: 0.1,
    side: THREE.DoubleSide
  });
  const screen = new THREE.Mesh(
    new THREE.SphereGeometry(0.62, 14, 8, 0, Math.PI * 2, 0, Math.PI / 3.4),
    canopyMat
  );
  screen.rotation.x = -0.3;
  screen.scale.set(1.2, 0.9, 1);
  screen.position.set(0, 1.0, -0.85);
  hull.add(screen);

  // Thin canopy hoop so the arch reads as a frame, not a solid tunnel
  const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.018, 6, 20, Math.PI), mats.guard);
  hoop.rotation.y = Math.PI / 2;
  hoop.rotation.z = -0.12;
  hoop.position.set(0, 0.95, -0.8);
  hull.add(hoop);
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
): { group: THREE.Group; exhaust: THREE.Mesh; length: number } {
  const dims =
    kitId === 'torque' ? { r: 0.8, len: 3.6 } : kitId === 'spike' ? { r: 0.5, len: 5.4 } : { r: 0.64, len: 4.4 };

  const g = new THREE.Group();
  g.position.set(side * 2.3, 0.9, -6.2);

  const body = new THREE.Mesh(new THREE.CylinderGeometry(dims.r, dims.r * 0.88, dims.len, 14), mats.primary);
  body.rotation.x = Math.PI / 2;
  g.add(body);

  // layered ring stack for that segmented turbine look
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(dims.r * 1.04, 0.06, 6, 18), mats.secondary);
    ring.position.z = -dims.len * 0.32 + i * dims.len * 0.22;
    g.add(ring);
  }

  const intake = new THREE.Mesh(new THREE.ConeGeometry(dims.r, dims.r * 2.1, 14), mats.secondary);
  intake.rotation.x = -Math.PI / 2;
  intake.position.z = -(dims.len / 2 + dims.r);
  g.add(intake);

  // rear vane cluster (yellow slats fanning off the tail)
  for (let i = -1; i <= 1; i++) {
    const vane = new THREE.Mesh(new THREE.BoxGeometry(0.07, dims.r * 1.5, dims.r * 1.2), mats.stripe);
    vane.position.set(i * dims.r * 0.55, dims.r * 0.75, dims.len * 0.36);
    vane.rotation.z = i * 0.35;
    g.add(vane);
  }

  // side scoop
  const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.12, dims.r * 0.8, dims.len * 0.4), mats.secondary);
  scoop.position.set(side * dims.r * 1.02, 0, -dims.len * 0.1);
  g.add(scoop);

  addStuds(g, mats.stripe, {
    cols: 1,
    rows: 3,
    dx: 0,
    dz: dims.len * 0.18,
    x0: 0,
    z0: -dims.len * 0.2,
    y: dims.r * 1.0
  });

  const exhaust = new THREE.Mesh(new THREE.ConeGeometry(dims.r * 0.7, 1.7, 10), mats.glow.clone());
  exhaust.rotation.x = Math.PI / 2;
  exhaust.position.z = dims.len / 2 + 0.85;
  g.add(exhaust);

  return { group: g, exhaust, length: dims.len };
}

// ============================== cable kits ==============================

function buildCable(parent: THREE.Group, kitId: string, side: -1 | 1, engineLen: number, mats: Mats): void {
  const from = new THREE.Vector3(side * 0.45, 0.55, -0.7);
  const to = new THREE.Vector3(side * 2.3 - side * 0.2, 0.9, -6.2 + engineLen * 0.42);

  const makeTube = (offset: number, radius: number, sag: number) => {
    const mid = from.clone().add(to).multiplyScalar(0.5);
    mid.y -= sag;
    mid.x += side * 0.25;
    const shifted = (v: THREE.Vector3) => v.clone().add(new THREE.Vector3(0, offset, 0));
    const curve =
      sag > 0.01
        ? new THREE.CatmullRomCurve3([shifted(from), shifted(mid), shifted(to)])
        : new THREE.CatmullRomCurve3([shifted(from), shifted(from.clone().lerp(to, 0.5)), shifted(to)]);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 22, radius, 6), mats.cable);
    parent.add(tube);
  };

  if (kitId === 'twin') {
    makeTube(0.05, 0.035, 0.3);
    makeTube(-0.05, 0.035, 0.3);
  } else if (kitId === 'taut') {
    makeTube(0, 0.06, 0);
  } else {
    // 'slack' — drooping power line like the reference
    makeTube(0, 0.065, 0.5);
  }
}

// ============================== cockpit fittings ==============================

/**
 * Raised steering console (reference-style): a support column rises from the
 * cowling to a head unit at chest height, directly in front of the pilot.
 * The diegetic HUD panel mounts on its pilot-facing face (dashboardAnchor).
 */
function buildDashConsole(parent: THREE.Group, mats: Mats): void {
  const consolePod = new THREE.Group();
  consolePod.position.set(0, 0, -0.6);
  parent.add(consolePod);

  // support column from the tub floor up to the head unit
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.65, 8), mats.dark);
  column.position.set(0, 0.45, 0.04);
  column.rotation.x = 0.1;
  consolePod.add(column);

  // corrugated boot where the column meets the floor
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.Mesh(new THREE.TorusGeometry(0.09 - i * 0.008, 0.02, 6, 12), mats.cable);
    seg.rotation.x = Math.PI / 2;
    seg.position.set(0, 0.14 + i * 0.045, 0.06);
    consolePod.add(seg);
  }

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
  // Pulled in tight beside the seat so VR hands don't have to reach forward
  const x = side * 0.28;
  const homeZ = -0.02;

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
  const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.034, 0.5, 8), mats.dark);
  lower.position.set(0, 0.27, 0);
  lever.add(lower);

  const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 6), mats.guard);
  elbow.position.set(0, 0.52, 0);
  lever.add(elbow);

  // upper arm — leans up, outward, and back toward the pilot
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.46, 8), mats.dark);
  upper.position.set(side * 0.03, 0.72, 0.08);
  upper.rotation.set(0.28, 0, side * -0.15);
  lever.add(upper);

  // handlebar grip at chest height, close to the hands
  const gripGroup = new THREE.Group();
  gripGroup.position.set(side * 0.06, 0.9, 0.18);
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
