import * as THREE from 'three';
import { Track } from './TrackProgress';

/**
 * Builds all static visuals for Rustmere Cut: track ribbon, canyon rock walls,
 * scrap arches, start gate, checkpoint pylons, desert floor and dunes.
 */
export function buildTrackScenery(scene: THREE.Scene, track: Track): void {
  scene.add(buildRibbon(track));
  scene.add(buildRockWalls(track));
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

function buildRockWalls(track: Track): THREE.InstancedMesh {
  const rng = mulberry32(1337);
  const spacingT = 12 / track.lapLength; // a rock roughly every 12 m per side
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
    for (const s of [-1, 1]) {
      if (idx >= count) break;
      const dist = hw + 3.5 + rng() * 7;
      const h = 5 + rng() * 11;
      const w = 2.5 + rng() * 4;
      dummy.position.copy(p).addScaledVector(side, s * dist);
      dummy.position.y += h * 0.35 - 0.5;
      dummy.rotation.set(rng() * 0.4, rng() * Math.PI * 2, rng() * 0.4);
      dummy.scale.set(w, h, w * (0.7 + rng() * 0.6));
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

  // distant dunes/mesas
  const duneMat = new THREE.MeshLambertMaterial({ color: 0xb4794a });
  for (let i = 0; i < 26; i++) {
    const ang = rng() * Math.PI * 2;
    const dist = 1200 + rng() * 1800;
    const dune = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), duneMat);
    dune.position.set(Math.cos(ang) * dist, -2, Math.sin(ang) * dist);
    dune.scale.set(180 + rng() * 320, 40 + rng() * 90, 180 + rng() * 320);
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
