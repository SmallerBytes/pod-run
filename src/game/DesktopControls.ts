import * as THREE from 'three';
import { ThrustInput } from './CraftController';

/**
 * Desktop fallback for iterating without a headset:
 * hold Q = push left throttle / turn right, P = push right throttle / turn left,
 * hold both for straight-line power (release to ease off), Shift = overdrive,
 * Y toggles engine burner, hold X for 5s = repair engines,
 * mouse (pointer lock) = look around the pod, R = restart after finish.
 * During pre-race arming, click aims from the camera to ignite engines.
 */
export class DesktopControls {
  private keys = new Set<string>();
  private lookYaw = 0;
  private lookPitch = 0;
  private leftRamp = 0;
  private rightRamp = 0;
  private burnerEnabled = false;
  private clickPending = false;

  restartRequested = false;
  /** Seconds X has been held; RaceSession uses this for engine repair. */
  xHoldSeconds = 0;
  xHoldCompleted = false;
  private xWasHeldLong = false;

  constructor(private camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase());
      if (e.key.toLowerCase() === 'r') this.restartRequested = true;
      if (e.key.toLowerCase() === 'y' && !e.repeat) {
        this.burnerEnabled = !this.burnerEnabled;
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));

    domElement.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== domElement) return;
      this.lookYaw -= e.movementX * 0.0022;
      this.lookPitch -= e.movementY * 0.0022;
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch, -1.2, 1.2);
      this.lookYaw = THREE.MathUtils.clamp(this.lookYaw, -2.4, 2.4);
    });

    domElement.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.clickPending = true;
    });
  }

  update(dt: number): void {
    const ramp = (held: boolean, v: number) =>
      THREE.MathUtils.clamp(v + (held ? dt * 1.8 : -dt * 2.4), 0, 1);
    this.leftRamp = ramp(this.keys.has('q'), this.leftRamp);
    this.rightRamp = ramp(this.keys.has('p'), this.rightRamp);

    if (this.keys.has('x')) this.xHoldSeconds += dt;
    else this.xHoldSeconds = 0;
    const heldLong = this.xHoldSeconds >= 5;
    this.xHoldCompleted = heldLong && !this.xWasHeldLong;
    this.xWasHeldLong = heldLong;

    this.camera.rotation.set(this.lookPitch, this.lookYaw, 0, 'YXZ');
  }

  getInput(): ThrustInput & { leftHeld: boolean; rightHeld: boolean } {
    return {
      left: this.leftRamp,
      right: this.rightRamp,
      lean: 0,
      overdrive: this.keys.has('shift'),
      burner: this.burnerEnabled,
      leftHeld: this.leftRamp > 0.01,
      rightHeld: this.rightRamp > 0.01
    };
  }

  consumeRestart(): boolean {
    const r = this.restartRequested;
    this.restartRequested = false;
    return r;
  }

  /** Camera-forward tap rays from left-clicks (pre-race ignition). */
  consumeIgnitionRays(): { origin: THREE.Vector3; direction: THREE.Vector3 }[] {
    if (!this.clickPending) return [];
    this.clickPending = false;
    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3();
    this.camera.getWorldPosition(origin);
    this.camera.getWorldDirection(direction);
    return [{ origin, direction: direction.normalize() }];
  }
}
