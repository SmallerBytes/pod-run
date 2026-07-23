import * as THREE from 'three';

/**
 * Speed dust: a recycled particle cloud that streams past the pilot so the
 * canyon feels fast even on placeholder art.
 */
export class DustField {
  readonly points: THREE.LineSegments;
  private velocities: Float32Array;
  private readonly count = 260;
  private readonly range = 75;

  constructor() {
    // Two vertices per particle: a tiny point-like segment at low speed that
    // stretches into a motion streak as velocity rises.
    const positions = new Float32Array(this.count * 2 * 3);
    this.velocities = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const x = (Math.random() * 2 - 1) * this.range;
      const y = 0.15 + Math.random() * 9;
      const z = (Math.random() * 2 - 1) * this.range;
      const base = i * 6;
      positions[base] = x;
      positions[base + 1] = y;
      positions[base + 2] = z;
      positions[base + 3] = x;
      positions[base + 4] = y;
      positions[base + 5] = z + 0.02;
      this.velocities[i] = 0.6 + Math.random() * 0.8;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xe8cfa0,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.points = new THREE.LineSegments(geo, mat);
    this.points.frustumCulled = false;
  }

  /** craftPos/craftYaw in world space; dust drifts opposite the motion. */
  update(dt: number, craftPos: THREE.Vector3, craftYaw: number, speed: number): void {
    this.points.position.copy(craftPos);
    const attr = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;

    const backX = Math.sin(craftYaw);
    const backZ = Math.cos(craftYaw);
    const drift = speed * dt;
    const speedRatio = THREE.MathUtils.clamp(speed / 125, 0, 1.4);
    const baseStreak = 0.025 + Math.pow(speedRatio, 1.35) * 2.5;

    for (let i = 0; i < this.count; i++) {
      const base = i * 6;
      arr[base] += backX * drift * this.velocities[i];
      arr[base + 2] += backZ * drift * this.velocities[i];
      const streak = baseStreak * this.velocities[i];
      arr[base + 3] = arr[base] - backX * streak;
      arr[base + 4] = arr[base + 1];
      arr[base + 5] = arr[base + 2] - backZ * streak;
      // recycle particles that fall behind
      const dx = arr[base];
      const dz = arr[base + 2];
      if (dx * dx + dz * dz > this.range * this.range) {
        // respawn ahead of the craft
        const spread = (Math.random() * 2 - 1) * this.range * 0.8;
        arr[base] = -backX * this.range * 0.9 + backZ * spread * 0.5;
        arr[base + 2] = -backZ * this.range * 0.9 - backX * spread * 0.5;
        arr[base + 1] = 0.15 + Math.random() * 9;
      }
    }
    attr.needsUpdate = true;

    const mat = this.points.material as THREE.LineBasicMaterial;
    mat.opacity = THREE.MathUtils.clamp(0.08 + speedRatio * 0.34, 0.08, 0.5);
  }
}
