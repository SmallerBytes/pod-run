import * as THREE from 'three';

/**
 * Speed dust: a recycled particle cloud that streams past the pilot so the
 * canyon feels fast even on placeholder art.
 */
export class DustField {
  readonly points: THREE.Points;
  private velocities: Float32Array;
  private readonly count = 360;
  private readonly range = 60;

  constructor() {
    const positions = new Float32Array(this.count * 3);
    this.velocities = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      positions[i * 3] = (Math.random() * 2 - 1) * this.range;
      positions[i * 3 + 1] = Math.random() * 14;
      positions[i * 3 + 2] = (Math.random() * 2 - 1) * this.range;
      this.velocities[i] = 0.6 + Math.random() * 0.8;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xe8cfa0,
      size: 0.35,
      transparent: true,
      opacity: 0.55,
      depthWrite: false
    });
    this.points = new THREE.Points(geo, mat);
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

    for (let i = 0; i < this.count; i++) {
      arr[i * 3] += backX * drift * this.velocities[i];
      arr[i * 3 + 2] += backZ * drift * this.velocities[i];
      // recycle particles that fall behind
      const dx = arr[i * 3];
      const dz = arr[i * 3 + 2];
      if (dx * dx + dz * dz > this.range * this.range) {
        // respawn ahead of the craft
        const spread = (Math.random() * 2 - 1) * this.range * 0.8;
        arr[i * 3] = -backX * this.range * 0.9 + backZ * spread * 0.5;
        arr[i * 3 + 2] = -backZ * this.range * 0.9 - backX * spread * 0.5;
        arr[i * 3 + 1] = Math.random() * 14;
      }
    }
    attr.needsUpdate = true;

    const mat = this.points.material as THREE.PointsMaterial;
    mat.opacity = THREE.MathUtils.clamp(0.15 + (speed / 60) * 0.55, 0.15, 0.7);
  }
}
