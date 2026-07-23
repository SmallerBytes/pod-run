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
  group.add(buildScree(track));
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
    { f: 1.04, out: 20, color: new THREE.Color('#b4794a') }
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

    // low-frequency drift; integer wave counts keep the loop seamless
    const h = THREE.MathUtils.clamp(
      13 + 8 * Math.sin(tau * 3 * t + ph[0]) + 5 * Math.sin(tau * 7 * t + ph[1]) + 3 * Math.sin(tau * 13 * t + ph[2]),
      6,
      26
    );
    const dist = hw + 9 + 5 * Math.sin(tau * 2 * t + ph[3]) + 2.5 * Math.sin(tau * 5 * t + ph[4]);
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

/** Small grounded boulders at the cliff base — rubble, not floating rocks. */
function buildScree(track: Track): THREE.InstancedMesh {
  const rng = mulberry32(9001);
  const spacingT = 16 / track.lapLength;
  const count = Math.floor(1 / spacingT) * 2;

  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const mesh = new THREE.InstancedMesh(geo, mat, count);

  const dummy = new THREE.Object3D();
  const rockA = new THREE.Color('#8a5a34');
  const rockB = new THREE.Color('#6e4526');
  const col = new THREE.Color();

  let idx = 0;
  for (let i = 0; i < count / 2; i++) {
    const t = i * spacingT;
    const p = track.posAt(t);
    const side = track.sideAt(t);
    const hw = track.halfWidthAt(t);
    for (const sgn of [-1, 1]) {
      if (idx >= count) break;
      const size = 0.6 + rng() * 1.4;
      dummy.position.copy(p).addScaledVector(side, sgn * (hw + 4 + rng() * 5));
      // sink a third of the rock into the sand so it reads as grounded
      dummy.position.y += size * 0.35 - 0.45;
      dummy.rotation.set(rng() * 0.25, rng() * Math.PI * 2, rng() * 0.25);
      dummy.scale.set(size, size * (0.7 + rng() * 0.4), size * (0.7 + rng() * 0.6));
      dummy.updateMatrix();
      mesh.setMatrixAt(idx, dummy.matrix);
      col.lerpColors(rockA, rockB, rng());
      mesh.setColorAt(idx, col);
      idx++;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function buildArchesAndGates(track: Track): THREE.Group {
  const group = new THREE.Group();
  const metal = new THREE.MeshLambertMaterial({ color: 0x4a4238 });
  const rust = new THREE.MeshLambertMaterial({ color: 0x8c4a1e });
  const bannerMat = new THREE.MeshBasicMaterial({ color: 0xff8c2a, side: THREE.DoubleSide });

  // scrap arches every 1/12 of the loop
  for (let i = 0; i < 12; i++) {
    const t = i / 12 + 0.02;
    const p = track.posAt(t);
    const side = track.sideAt(t);
    const hw = track.halfWidthAt(t) + 2;
    const tan = track.tangentAt(t);

    const arch = new THREE.Group();
    for (const s of [-1, 1]) {
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(1.2, 14, 1.2), i % 3 === 0 ? rust : metal);
      pylon.position.copy(p).addScaledVector(side, s * hw);
      pylon.position.y += 7;
      arch.add(pylon);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 + 1.2, 1.0, 1.0), metal);
    beam.position.copy(p);
    beam.position.y += 13.5;
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), side);
    arch.add(beam);
    void tan;
    group.add(arch);
  }

  // start/finish gate with banner
  {
    const t = 0;
    const p = track.posAt(t);
    const side = track.sideAt(t);
    const hw = track.halfWidthAt(t) + 1;
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

  // checkpoint pylons (subtle glow markers used by the nav plate arrow)
  const cpMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff });
  for (let i = 0; i < track.checkpointCount; i++) {
    const t = track.checkpointT(i);
    const p = track.posAt(t);
    const side = track.sideAt(t);
    const hw = track.halfWidthAt(t) + 0.5;
    for (const s of [-1, 1]) {
      const pylon = new THREE.Mesh(new THREE.ConeGeometry(0.5, 3.2, 6), cpMat);
      pylon.position.copy(p).addScaledVector(side, s * hw);
      pylon.position.y += 1.6;
      group.add(pylon);
    }
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
