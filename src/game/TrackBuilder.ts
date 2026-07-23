import * as THREE from 'three';
import { Track } from './TrackProgress';

/**
 * Builds all static visuals for Rustmere Cut: a clearly contrasting textured
 * track ribbon, start gate, and open desert floor. Large canyon formations
 * are disabled until they can be placed with guaranteed track clearance.
 */
export function buildTrackScenery(scene: THREE.Scene, track: Track): void {
  scene.add(buildRibbon(track));
  scene.add(buildTrackBarricades(track));
  scene.add(buildArchesAndGates(track));
  scene.add(buildDesert());
}

function buildRibbon(track: Track): THREE.Group {
  const group = new THREE.Group();
  const segs = 420;
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];

  // Compacted race surface is deliberately darker than the open desert.
  const packed = new THREE.Color('#765139');
  const soft = new THREE.Color('#8b6242');

  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = track.posAt(t);
    const side = track.sideAt(t);
    const hw = track.halfWidthAt(t);
    const l = p.clone().addScaledVector(side, -hw);
    const r = p.clone().addScaledVector(side, hw);
    positions.push(l.x, l.y + 0.08, l.z, r.x, r.y + 0.08, r.z);
    uvs.push(l.x / 18, l.z / 18, r.x / 18, r.z / 18);
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
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: makeTrackTexture()
  });
  group.add(new THREE.Mesh(geo, mat));
  group.add(buildTrackEdge(track, -1));
  group.add(buildTrackEdge(track, 1));
  group.add(buildCenterDashes(track));
  return group;
}

/** Flat painted edge strip; visual-only and always follows the lane boundary. */
function buildTrackEdge(track: Track, sign: -1 | 1): THREE.Mesh {
  const segs = 420;
  const width = 0.85;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = track.posAt(t);
    const side = track.sideAt(t);
    const edge = p.clone().addScaledVector(side, sign * track.halfWidthAt(t));
    const inner = edge.clone().addScaledVector(side, -sign * width);
    positions.push(edge.x, edge.y + 0.11, edge.z, inner.x, inner.y + 0.11, inner.z);
    if (i < segs) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: 0xe2b36c, side: THREE.DoubleSide })
  );
}

/** Repeated center markers make direction and speed obvious without collision. */
function buildCenterDashes(track: Track): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: 0xd29a58,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide
  });
  const dashGeometry = new THREE.PlaneGeometry(0.45, 5);
  dashGeometry.rotateX(-Math.PI / 2);
  const count = Math.floor(track.lapLength / 18);

  for (let i = 0; i < count; i++) {
    const t = i / count;
    const p = track.posAt(t);
    const tangent = track.tangentAt(t);
    const dash = new THREE.Mesh(dashGeometry, material);
    dash.position.copy(p);
    dash.position.y += 0.12;
    dash.rotation.y = Math.atan2(tangent.x, tangent.z);
    group.add(dash);
  }
  return group;
}

/**
 * Low segmented safety barriers following both outer track lines. They sit
 * just outside the painted edge strips, leaving the full racing ribbon clear.
 * Instance colors alternate for strong visibility at racing speed.
 */
function buildTrackBarricades(track: Track): THREE.InstancedMesh {
  const spacing = 9;
  const countPerSide = Math.max(1, Math.floor(track.lapLength / spacing));
  const total = countPerSide * 2;
  const geometry = new THREE.BoxGeometry(0.55, 0.9, spacing * 0.88);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.72,
    metalness: 0.28
  });
  const barriers = new THREE.InstancedMesh(geometry, material, total);
  const dummy = new THREE.Object3D();
  const orange = new THREE.Color('#d87824');
  const dark = new THREE.Color('#332d27');

  let instance = 0;
  for (const sign of [-1, 1] as const) {
    for (let i = 0; i < countPerSide; i++) {
      const t = (i + 0.5) / countPerSide;
      const p = track.posAt(t);
      const side = track.sideAt(t);
      const tangent = track.tangentAt(t);
      dummy.position.copy(p).addScaledVector(side, sign * (track.halfWidthAt(t) + 0.5));
      dummy.position.y += 0.5;
      dummy.rotation.set(0, Math.atan2(tangent.x, tangent.z), 0);
      dummy.updateMatrix();
      barriers.setMatrixAt(instance, dummy.matrix);
      barriers.setColorAt(instance, (i + (sign > 0 ? 1 : 0)) % 2 === 0 ? orange : dark);
      instance++;
    }
  }
  barriers.instanceMatrix.needsUpdate = true;
  if (barriers.instanceColor) barriers.instanceColor.needsUpdate = true;
  return barriers;
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

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(8000, 8000),
    new THREE.MeshLambertMaterial({
      color: 0xc99a63,
      map: makeSandTexture(320, 320)
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.4;
  group.add(floor);

  return group;
}

/** Darker tire-worn texture for the racing ribbon. */
function makeTrackTexture(): THREE.CanvasTexture {
  const texture = makeSandTexture(1, 1);
  const canvas = texture.image as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  const rng = mulberry32(97531);

  // Long, subtle racing grooves.
  for (let i = 0; i < 42; i++) {
    const x = rng() * canvas.width;
    ctx.strokeStyle = `rgba(45,28,18,${0.08 + rng() * 0.1})`;
    ctx.lineWidth = 1 + rng() * 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (rng() - 0.5) * 18, canvas.height);
    ctx.stroke();
  }
  texture.needsUpdate = true;
  return texture;
}

/**
 * Cheap procedural sand detail: fine grains, darker pebbles, and wind streaks.
 * This is material-only and has no collision geometry.
 */
function makeSandTexture(repeatX: number, repeatY: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rng = mulberry32(2468);

  ctx.fillStyle = '#c99a63';
  ctx.fillRect(0, 0, size, size);

  // Wind-combed streaks.
  ctx.lineWidth = 1;
  for (let i = 0; i < 34; i++) {
    const y = rng() * size;
    const x = rng() * size;
    const length = 25 + rng() * 85;
    ctx.strokeStyle = rng() > 0.5 ? 'rgba(238,190,126,0.22)' : 'rgba(116,72,39,0.15)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + length * 0.5, y + 2 + rng() * 5, x + length, y);
    ctx.stroke();
  }

  // Small grain/pebble flecks that make speed visible without obstructing play.
  for (let i = 0; i < 900; i++) {
    const shade = Math.floor(105 + rng() * 100);
    ctx.fillStyle = `rgba(${shade},${Math.floor(shade * 0.72)},${Math.floor(shade * 0.45)},${0.12 + rng() * 0.2})`;
    const r = 0.35 + rng() * 1.1;
    ctx.fillRect(rng() * size, rng() * size, r, r);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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
