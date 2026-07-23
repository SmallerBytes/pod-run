import * as THREE from 'three';
import { Loadout, CAGES, THRUSTERS } from '../garage/Loadout';

/**
 * Builds the visual skiff from a loadout using procedural placeholder meshes.
 * Layout (craft local space, forward = -Z):
 *   - pilot cage around the origin (seat at ~y0.45)
 *   - twin thrusters ahead at z = -6, x = +-2.2
 *   - link armature beams + energy tether connecting them
 */
export interface SkiffRig {
  group: THREE.Group;
  /** Sub-group that banks/pitches for visual feel without affecting the camera rig. */
  visual: THREE.Group;
  leftThruster: THREE.Group;
  rightThruster: THREE.Group;
  leftExhaust: THREE.Mesh;
  rightExhaust: THREE.Mesh;
  leftYoke: THREE.Group;
  rightYoke: THREE.Group;
  dashboardAnchor: THREE.Group;
  seatPosition: THREE.Vector3;
  shadowBlob: THREE.Mesh;
}

export function buildSkiff(loadout: Loadout, opts: { withCockpitFittings?: boolean } = {}): SkiffRig {
  const cage = CAGES[loadout.cageId];
  const thr = THRUSTERS[loadout.thrusterId];
  const paint = loadout.paint;

  const primary = new THREE.MeshStandardMaterial({ color: paint.primary, roughness: 0.55, metalness: 0.35 });
  const secondary = new THREE.MeshStandardMaterial({ color: paint.secondary, roughness: 0.7, metalness: 0.5 });
  const stripe = new THREE.MeshStandardMaterial({ color: paint.stripe, roughness: 0.4, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1a17, roughness: 0.9, metalness: 0.2 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xff8c2a });

  const group = new THREE.Group();
  const visual = new THREE.Group();
  group.add(visual);

  // ---------- pilot cage ----------
  const cageScale = cage.profile;
  const cageGroup = new THREE.Group();
  cageGroup.scale.setScalar(cageScale);
  visual.add(cageGroup);

  // hull tub
  const tub = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.42, 1.7, 10), primary);
  tub.rotation.x = Math.PI / 2;
  tub.position.set(0, 0.55, 0.2);
  cageGroup.add(tub);

  // nose cone
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.9, 10), stripe);
  nose.rotation.x = -Math.PI / 2;
  nose.position.set(0, 0.55, -0.85);
  cageGroup.add(nose);

  // seat back
  const seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.12), dark);
  seatBack.position.set(0, 0.85, 0.62);
  cageGroup.add(seatBack);

  // roll hoops (cage look)
  const hoopGeo = new THREE.TorusGeometry(0.62, 0.045, 6, 14, Math.PI);
  for (const z of [-0.25, 0.35]) {
    const hoop = new THREE.Mesh(hoopGeo, secondary);
    hoop.position.set(0, 0.6, z);
    cageGroup.add(hoop);
  }

  // cage-specific flavor
  if (loadout.cageId === 'bruiser') {
    for (const x of [-0.62, 0.62]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 1.4), secondary);
      plate.position.set(x, 0.6, 0.1);
      cageGroup.add(plate);
    }
  } else if (loadout.cageId === 'scout') {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.6), stripe);
    fin.position.set(0, 1.1, 0.5);
    cageGroup.add(fin);
  } else {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.28), stripe);
    spoiler.position.set(0, 1.0, 0.66);
    cageGroup.add(spoiler);
  }

  // ---------- thrusters ----------
  // size varies by type: torque = short/fat, surge = medium, spike = long/thin
  const dims =
    loadout.thrusterId === 'torque'
      ? { r: 0.75, len: 3.4 }
      : loadout.thrusterId === 'spike'
        ? { r: 0.48, len: 5.2 }
        : { r: 0.6, len: 4.2 };

  const makeThruster = (side: -1 | 1) => {
    const t = new THREE.Group();
    t.position.set(side * 2.2, 0.85, -6);

    const body = new THREE.Mesh(new THREE.CylinderGeometry(dims.r, dims.r * 0.85, dims.len, 12), primary);
    body.rotation.x = Math.PI / 2;
    t.add(body);

    const noseCone = new THREE.Mesh(new THREE.ConeGeometry(dims.r, dims.r * 2.0, 12), secondary);
    noseCone.rotation.x = -Math.PI / 2;
    noseCone.position.z = -(dims.len / 2 + dims.r);
    t.add(noseCone);

    const intake = new THREE.Mesh(new THREE.TorusGeometry(dims.r * 1.05, 0.08, 6, 16), secondary);
    intake.position.z = -dims.len * 0.32;
    t.add(intake);

    const stripeBand = new THREE.Mesh(new THREE.CylinderGeometry(dims.r * 1.02, dims.r * 1.02, 0.3, 12), stripe);
    stripeBand.rotation.x = Math.PI / 2;
    stripeBand.position.z = dims.len * 0.18;
    t.add(stripeBand);

    // exhaust glow disc (scaled with thrust at runtime)
    const exhaust = new THREE.Mesh(new THREE.ConeGeometry(dims.r * 0.7, 1.6, 10), glow.clone());
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.z = dims.len / 2 + 0.8;
    t.add(exhaust);

    // steering vane
    const vane = new THREE.Mesh(new THREE.BoxGeometry(0.06, dims.r * 1.8, dims.r * 1.6), stripe);
    vane.position.set(side * dims.r * 0.9, 0, dims.len * 0.3);
    t.add(vane);

    return { t, exhaust };
  };

  const left = makeThruster(-1);
  const right = makeThruster(1);
  visual.add(left.t, right.t);

  // ---------- link armature ----------
  const beamMat = secondary;
  for (const side of [-1, 1] as const) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 6.3, 6), beamMat);
    const from = new THREE.Vector3(0, 0.6, -0.6);
    const to = new THREE.Vector3(side * 2.2, 0.85, -6 + dims.len / 2);
    beam.position.copy(from).add(to).multiplyScalar(0.5);
    beam.lookAt(to);
    beam.rotateX(Math.PI / 2);
    visual.add(beam);
  }
  // energy tether between thrusters
  const tether = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 4.4, 6),
    new THREE.MeshBasicMaterial({ color: 0x9fd8ff })
  );
  tether.rotation.z = Math.PI / 2;
  tether.position.set(0, 0.85, -6);
  visual.add(tether);

  // ---------- cockpit fittings (yokes + dashboard anchor) ----------
  const leftYoke = new THREE.Group();
  const rightYoke = new THREE.Group();
  const dashboardAnchor = new THREE.Group();

  if (opts.withCockpitFittings !== false) {
    const yokeMat = dark;
    const gripMat = new THREE.MeshStandardMaterial({ color: 0x333a40, roughness: 0.45, metalness: 0.6 });
    const buildYoke = (yoke: THREE.Group, x: number) => {
      yoke.position.set(x, 0.5, -0.45);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.24, 8), yokeMat);
      stem.position.y = 0.12;
      yoke.add(stem);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.14, 8), gripMat);
      grip.position.y = 0.3;
      yoke.add(grip);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.038, 10, 8), stripe);
      knob.position.y = 0.39;
      yoke.add(knob);
      visual.add(yoke);
    };
    buildYoke(leftYoke, -0.3);
    buildYoke(rightYoke, 0.3);

    dashboardAnchor.position.set(0, 0.86, -0.78);
    dashboardAnchor.rotation.x = -0.42;
    visual.add(dashboardAnchor);
  }

  // ---------- fake blob shadow ----------
  const shadowBlob = new THREE.Mesh(
    new THREE.CircleGeometry(4.2, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })
  );
  shadowBlob.rotation.x = -Math.PI / 2;
  shadowBlob.position.set(0, -1.1, -3);
  shadowBlob.scale.set(1, 1.6, 1);
  group.add(shadowBlob);

  // small tuning so heavier thrusters read visually
  void thr;

  return {
    group,
    visual,
    leftThruster: left.t,
    rightThruster: right.t,
    leftExhaust: left.exhaust,
    rightExhaust: right.exhaust,
    leftYoke,
    rightYoke,
    dashboardAnchor,
    // rig origin = cage floor; with 'local-floor' XR space a seated player's
    // real head height puts their eyes naturally above the seat
    seatPosition: new THREE.Vector3(0, 0.05, 0.15),
    shadowBlob
  };
}

/** Random rival loadout + livery for AI racers. */
export function randomRivalLoadout(seedIndex: number): Loadout {
  const cageIds = Object.keys(CAGES);
  const thrusterIds = Object.keys(THRUSTERS);
  const liveries = [
    { primary: '#7a3030', secondary: '#2e2a26', stripe: '#e8d8b0' },
    { primary: '#33556b', secondary: '#4a3720', stripe: '#ff8c2a' },
    { primary: '#5b6d3a', secondary: '#3d4a52', stripe: '#f3e6d0' },
    { primary: '#6b4d8a', secondary: '#26222e', stripe: '#ffd23e' },
    { primary: '#8a7430', secondary: '#403a2c', stripe: '#9fd8ff' }
  ];
  return {
    cageId: cageIds[seedIndex % cageIds.length],
    thrusterId: thrusterIds[(seedIndex * 2 + 1) % thrusterIds.length],
    paint: liveries[seedIndex % liveries.length]
  };
}
