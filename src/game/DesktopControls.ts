import * as THREE from 'three';
import { ThrustInput } from './CraftController';

/**
 * Desktop fallback for iterating without a headset:
 * hold Q = push left throttle, P = push right throttle (release to ease off),
 * A / D = lean left / right (slow steer), Shift = overdrive,
 * mouse (pointer lock) = look around the pod, R = restart after finish.
 */
export class DesktopControls {
  private keys = new Set<string>();
  private lookYaw = 0;
  private lookPitch = 0;
  private leftRamp = 0;
  private rightRamp = 0;
  private leanRamp = 0;

  restartRequested = false;

  constructor(private camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase());
      if (e.key.toLowerCase() === 'r') this.restartRequested = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));

    domElement.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== domElement) return;
      this.lookYaw -= e.movementX * 0.0022;
      this.lookPitch -= e.movementY * 0.0022;
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch, -1.2, 1.2);
      this.lookYaw = THREE.MathUtils.clamp(this.lookYaw, -2.4, 2.4);
    });
  }

  update(dt: number): void {
    const ramp = (held: boolean, v: number) =>
      THREE.MathUtils.clamp(v + (held ? dt * 1.8 : -dt * 2.4), 0, 1);
    this.leftRamp = ramp(this.keys.has('q'), this.leftRamp);
    this.rightRamp = ramp(this.keys.has('p'), this.rightRamp);

    // lean builds up slowly and recenters when released
    const leanTarget = (this.keys.has('d') ? 1 : 0) - (this.keys.has('a') ? 1 : 0);
    this.leanRamp = THREE.MathUtils.lerp(this.leanRamp, leanTarget, 1 - Math.exp(-dt * 3.5));

    this.camera.rotation.set(this.lookPitch, this.lookYaw, 0, 'YXZ');
  }

  getInput(): ThrustInput & { leftHeld: boolean; rightHeld: boolean } {
    return {
      left: this.leftRamp,
      right: this.rightRamp,
      lean: this.leanRamp,
      overdrive: this.keys.has('shift'),
      leftHeld: this.leftRamp > 0.01,
      rightHeld: this.rightRamp > 0.01
    };
  }

  consumeRestart(): boolean {
    const r = this.restartRequested;
    this.restartRequested = false;
    return r;
  }
}
