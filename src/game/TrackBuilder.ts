import * as THREE from 'three';
import { Track } from './TrackProgress';

/**
 * Builds all static visuals for Rustmere Cut: track ribbon, layered canyon
 * cliff walls, scrap arches, start gate, checkpoint pylons, desert floor,
 * and distant mesas/spires (Mos Espa flats look).
 */
export function buildTrackScenery(scene: THREE.Scene, track: Track): void {
  scene.add(buildRibbon(track));
  scene.add(buildCanyonWalls(track));
  scene.add(buildArchesAndGates(track));
  scene.add(buildDesert());
}

function buildRibbon(track: Track): THREE.Mesh {
  const segs = 420;
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];

  const packed = new THREE.Color('#b4885a');
  const soft = new THREE.Color('#c99a63');

  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = track.posAt(t);
    const side = track.sideAt(t);
    const hw = track.halfWidthAt(t);
    // slightly wider than raceable so walls sit on sand
    const l = p.clone().addScaledVector(side, -(hw + 6));
    const r = p.clone().addScaledVector(side, hw + 6);
    positions.push(l.x, l.y + 0.05, l.z, r.x, r.y + 0.05, r.z);
    const c = i % 2 === 0 ? packed : soft;
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    if (i < segs) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  return new THREE.Mesh(geo, mat);
}

function buildCanyonWalls(track: Track): THREE.Group {
  const group = new THREE.Group();
  group.add(buildCliffRibbon(track, -1, 1337));
  group.add(buildCliffRibbon(track, 1, 7331));
  return group;
}

/**
 * One continuous stratified cliff wall following the track on one side.
 * The cross-section steps outward at each rock layer (ledges) and ends in a
 * plateau cap, so it reads as an eroded canyon escarpment instead of a row
 * of separate boulders. Height and setback drift with low-frequency noise;
 * everything is rooted below the sand.
 */
function buildCliffRibbon(track: Track, s: -1 | 1, seed: number): THREE.Mesh {
  const rng = mulberry32(seed);
  const ph = [0, 0, 0, 0, 0, 0].map(() => rng() * Math.PI * 2);
  const segs = 360;

  // (heightFraction, outward offset m, stratum color) from sand foot to plateau
  const strata: { f: number; out: number; color: THREE.Color }[] = [
    { f: 0.0, out: 0.0, color: new THREE.Color('#c99a63') },
    { f: 0.14, out: 0.6, color: new THREE.Color('#a86a3e') },
    { f: 0.17, out: 2.0, color: new THREE.Color('#8a5530') },
    { f: 0.4, out: 2.5, color: new THREE.Color('#b07a4a') },
    { f: 0.43, out: 3.8, color: new THREE.Color('#7e4e2c') },
    { f: 0.7, out: 4.2, color: new THREE.Color('#a86a3e') },
    { f: 0.73, out: 5.4, color: new THREE.Color('#8a5530') },
    { f: 1.0, out: 6.2, color: new THREE.Color('#b8865a') },
    // short rim shelf only — a long plateau can bridge over neighboring track segments
    { f: 1.04, out: 9, color: new THREE.Color('#b4794a') }
  ];
  const stride = strata.length;

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const tau = Math.PI * 2;
  const col = new THREE.Color();

  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = track.posAt(t);
    const side = track.sideAt(t);
    const hw = track.halfWidthAt(t);

    // Cliff face stays well outside the raceable lane — never pulls inward
    const h = THREE.MathUtils.clamp(
      14 + 7 * Math.sin(tau * 3 * t + ph[0]) + 4 * Math.sin(tau * 7 * t + ph[1]),
      8,
      28
    );
    const dist = hw + 28 + Math.max(0, 6 * Math.sin(tau * 2 * t + ph[3]));
    // subtle per-ring shade variation so long walls don't look extruded-flat
    const shade = 0.9 + 0.14 * Math.sin(tau * 11 * t + ph[5]);

    for (const layer of strata) {
      const v = p.clone().addScaledVector(side, s * (dist + layer.out));
      positions.push(v.x, -0.6 + layer.f * h, v.z);
      col.copy(layer.color).multiplyScalar(shade);
      colors.push(col.r, col.g, col.b);
    }

    if (i < segs) {
      for (let j = 0; j < stride - 1; j++) {
        const a = i * stride + j;
        indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}

function buildArchesAndGates(track: Track): THREE.Group {
  const group = new THREE.Group();
  const rust = new THREE.MeshLambertMaterial({ color: 0x8c4a1e });
  const bannerMat = new THREE.MeshBasicMaterial({ color: 0xff8c2a, side: THREE.DoubleSide });

  // Start/finish only — racing surface stays clear (no side pylons / checkpoint cones)
  {
    const t = 0;
    const p = track.posAt(t);
    const side = track.sideAt(t);
    const hw = track.halfWidthAt(t) + 4;
    for (const s of [-1, 1]) {
      const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 18, 8), rust);
      pylon.position.copy(p).addScaledVector(side, s * hw);
      pylon.position.y += 9;
      group.add(pylon);
    }
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 3), bannerMat);
    banner.position.copy(p);
    banner.position.y += 16;
    banner.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), side);
    group.add(banner);
  }

  return group;
}

function buildDesert(): THREE.Group {
  const group = new THREE.Group();
  const rng = mulberry32(42);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(4000, 48),
    new THREE.MeshLambertMaterial({ color: 0xc99a63 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.4;
  group.add(floor);

  const mesaMats = [
    new THREE.MeshLambertMaterial({ color: 0xa86a3e }),
    new THREE.MeshLambertMaterial({ color: 0x9a6238 }),
    new THREE.MeshLambertMaterial({ color: 0x8a5530 })
  ];

  // broad flat-topped mesas hugging the horizon haze
  for (let i = 0; i < 12; i++) {
    const ang = rng() * Math.PI * 2;
    const dist = 750 + rng() * 900;
    const w = 140 + rng() * 240;
    const h = 55 + rng() * 70;
    const mesa = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 1, 1, 9), mesaMats[i % 3]);
    mesa.position.set(Math.cos(ang) * dist, h * 0.5 - 6, Math.sin(ang) * dist);
    mesa.scale.set(w, h, w * (0.6 + rng() * 0.5));
    mesa.rotation.y = rng() * Math.PI;
    group.add(mesa);
  }

  // tall monument spires standing out of the flats
  for (let i = 0; i < 8; i++) {
    const ang = rng() * Math.PI * 2;
    const dist = 850 + rng() * 950;
    const w = 28 + rng() * 45;
    const h = 130 + rng() * 140;
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1, 1, 7), mesaMats[(i + 1) % 3]);
    spire.position.set(Math.cos(ang) * dist, h * 0.5 - 8, Math.sin(ang) * dist);
    spire.scale.set(w, h, w * (0.7 + rng() * 0.5));
    spire.rotation.y = rng() * Math.PI;
    group.add(spire);
  }

  // soft dune mounds between the rock formations
  const duneMat = new THREE.MeshLambertMaterial({ color: 0xb4794a });
  for (let i = 0; i < 14; i++) {
    const ang = rng() * Math.PI * 2;
    const dist = 1000 + rng() * 1400;
    const dune = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), duneMat);
    dune.position.set(Math.cos(ang) * dist, -2, Math.sin(ang) * dist);
    dune.scale.set(180 + rng() * 320, 35 + rng() * 60, 180 + rng() * 320);
    group.add(dune);
  }

  return group;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
