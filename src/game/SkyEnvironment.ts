import * as THREE from 'three';
import { Track } from './TrackProgress';

interface CloudState {
  group: THREE.Group;
  base: THREE.Vector3;
  phase: number;
  drift: number;
}

interface BirdState {
  group: THREE.Group;
  leftWing: THREE.Mesh;
  rightWing: THREE.Mesh;
  center: THREE.Vector3;
  phase: number;
  radius: number;
  speed: number;
  heightOffset: number;
}

/**
 * Visual-only sky life: gradient atmosphere, drifting low-poly clouds, and
 * flapping bird silhouettes placed in flocks around the full race loop.
 */
export class SkyEnvironment {
  readonly group = new THREE.Group();

  private time = 0;
  private clouds: CloudState[] = [];
  private birds: BirdState[] = [];

  constructor(scene: THREE.Scene, track: Track) {
    this.buildSky();
    this.buildClouds(track);
    this.buildBirds(track);
    scene.add(this.group);
  }

  update(dt: number): void {
    this.time += Math.min(dt, 0.05);

    for (const cloud of this.clouds) {
      cloud.group.position.set(
        cloud.base.x + Math.sin(this.time * cloud.drift + cloud.phase) * 75,
        cloud.base.y + Math.sin(this.time * 0.08 + cloud.phase) * 5,
        cloud.base.z + Math.cos(this.time * cloud.drift * 0.7 + cloud.phase) * 35
      );
    }

    for (const bird of this.birds) {
      const angle = this.time * bird.speed + bird.phase;
      bird.group.position.set(
        bird.center.x + Math.cos(angle) * bird.radius,
        bird.center.y + bird.heightOffset + Math.sin(angle * 2.1) * 3,
        bird.center.z + Math.sin(angle) * bird.radius * 0.7
      );
      bird.group.rotation.y = -angle + Math.PI * 0.5;
      const flap = Math.sin(this.time * 8.5 + bird.phase * 3) * 0.48;
      bird.leftWing.rotation.z = flap;
      bird.rightWing.rotation.z = -flap;
    }
  }

  private buildSky(): void {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(7500, 32, 18),
      new THREE.ShaderMaterial({
        vertexShader: `
          varying vec3 vWorldPosition;
          void main() {
            vec4 world = modelMatrix * vec4(position, 1.0);
            vWorldPosition = world.xyz;
            gl_Position = projectionMatrix * viewMatrix * world;
          }
        `,
        fragmentShader: `
          varying vec3 vWorldPosition;
          void main() {
            vec3 direction = normalize(vWorldPosition - cameraPosition);
            float height = smoothstep(-0.08, 0.72, direction.y);
            vec3 horizon = vec3(0.93, 0.66, 0.38);
            vec3 upper = vec3(0.24, 0.55, 0.84);
            vec3 zenith = vec3(0.10, 0.29, 0.58);
            vec3 color = mix(horizon, upper, height);
            color = mix(color, zenith, smoothstep(0.55, 1.0, direction.y));
            float haze = pow(max(0.0, 1.0 - abs(direction.y)), 7.0);
            color += vec3(0.16, 0.09, 0.035) * haze;
            gl_FragColor = vec4(color, 1.0);
          }
        `,
        side: THREE.BackSide,
        depthWrite: false
      })
    );
    sky.frustumCulled = false;
    sky.renderOrder = -1000;
    this.group.add(sky);
  }

  private buildClouds(track: Track): void {
    const rng = mulberry32(8142);
    const puffGeometry = new THREE.SphereGeometry(1, 9, 6);
    const cloudMaterial = new THREE.MeshBasicMaterial({
      color: 0xfff0d4,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      fog: true
    });

    for (let i = 0; i < 22; i++) {
      const t = i / 22;
      const p = track.posAt(t);
      const side = track.sideAt(t);
      const sideSign = i % 2 === 0 ? -1 : 1;
      const base = p
        .clone()
        .addScaledVector(side, sideSign * (180 + rng() * 520));
      base.y = 190 + rng() * 260;

      const cloud = new THREE.Group();
      const puffCount = 4 + Math.floor(rng() * 4);
      for (let j = 0; j < puffCount; j++) {
        const puff = new THREE.Mesh(puffGeometry, cloudMaterial);
        puff.position.set(
          (j - puffCount * 0.5) * (24 + rng() * 14),
          rng() * 18,
          (rng() - 0.5) * 35
        );
        puff.scale.set(
          30 + rng() * 42,
          13 + rng() * 18,
          24 + rng() * 36
        );
        cloud.add(puff);
      }
      cloud.position.copy(base);
      this.group.add(cloud);
      this.clouds.push({
        group: cloud,
        base,
        phase: rng() * Math.PI * 2,
        drift: 0.018 + rng() * 0.022
      });
    }
  }

  private buildBirds(track: Track): void {
    const rng = mulberry32(1957);
    const bodyGeometry = new THREE.ConeGeometry(0.16, 1.15, 6);
    const leftWingGeometry = triangleGeometry([
      0, 0, 0,
      -2.2, 0, -0.55,
      -0.35, 0, 0.75
    ]);
    const rightWingGeometry = triangleGeometry([
      0, 0, 0,
      2.2, 0, -0.55,
      0.35, 0, 0.75
    ]);
    const birdMaterial = new THREE.MeshBasicMaterial({
      color: 0x241b17,
      side: THREE.DoubleSide
    });

    const flockTs = [0.08, 0.31, 0.55, 0.79];
    for (let flock = 0; flock < flockTs.length; flock++) {
      const center = track.posAt(flockTs[flock]);
      const side = track.sideAt(flockTs[flock]);
      center.addScaledVector(side, flock % 2 === 0 ? 85 : -85);
      center.y += 72 + rng() * 38;

      for (let i = 0; i < 6; i++) {
        const bird = new THREE.Group();
        const body = new THREE.Mesh(bodyGeometry, birdMaterial);
        body.rotation.x = Math.PI / 2;
        const leftWing = new THREE.Mesh(leftWingGeometry, birdMaterial);
        const rightWing = new THREE.Mesh(rightWingGeometry, birdMaterial);
        bird.add(body, leftWing, rightWing);
        bird.scale.setScalar(0.8 + rng() * 0.55);
        this.group.add(bird);
        this.birds.push({
          group: bird,
          leftWing,
          rightWing,
          center: center.clone(),
          phase: rng() * Math.PI * 2,
          radius: 20 + rng() * 35,
          speed: 0.22 + rng() * 0.18,
          heightOffset: (i - 2.5) * 2.5 + rng() * 4
        });
      }
    }
  }
}

function triangleGeometry(vertices: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(vertices, 3)
  );
  geometry.computeVertexNormals();
  return geometry;
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
