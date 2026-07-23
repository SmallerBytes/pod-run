import * as THREE from 'three';
import { ThrustInput } from './CraftController';

interface HandState {
  controller: THREE.XRTargetRaySpace;
  grip: THREE.XRGripSpace;
  inputSource: XRInputSource | null;
  handedness: XRHandedness;
  holdingYoke: boolean;
  visual: THREE.Group;
}

/**
 * VR hands: squeeze (grip button) near a yoke to grab it; while held, the
 * trigger on that hand feeds the matching thruster. A/X pressed on either
 * held hand fires overdrive. Haptics scale with thruster load and impacts.
 */
export class GrabSystem {
  private hands: HandState[] = [];
  private leftYokeWorld = new THREE.Vector3();
  private rightYokeWorld = new THREE.Vector3();

  aButtonPressed = false;
  /** True once either hand's A/X went down this frame (edge), for restart. */
  aButtonJustPressed = false;
  private aWasDown = false;

  private leftYoke: THREE.Object3D;
  private rightYoke: THREE.Object3D;

  constructor(
    renderer: THREE.WebGLRenderer,
    rig: THREE.Group,
    leftYoke: THREE.Object3D,
    rightYoke: THREE.Object3D
  ) {
    this.leftYoke = leftYoke;
    this.rightYoke = rightYoke;
    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      rig.add(controller, grip);

      const visual = buildHandVisual();
      grip.add(visual);

      const state: HandState = {
        controller,
        grip,
        inputSource: null,
        handedness: 'none',
        holdingYoke: false,
        visual
      };

      controller.addEventListener('connected', (e) => {
        const src = (e as unknown as { data: XRInputSource }).data;
        state.inputSource = src;
        state.handedness = src.handedness;
      });
      controller.addEventListener('disconnected', () => {
        state.inputSource = null;
        state.holdingYoke = false;
      });
      controller.addEventListener('squeezestart', () => {
        const yoke = state.handedness === 'left' ? this.leftYokeWorld : this.rightYokeWorld;
        const handPos = new THREE.Vector3();
        state.grip.getWorldPosition(handPos);
        if (handPos.distanceTo(yoke) < 0.22) {
          state.holdingYoke = true;
          this.pulse(state, 0.6, 60);
        }
      });
      controller.addEventListener('squeezeend', () => {
        state.holdingYoke = false;
      });

      this.hands.push(state);
    }
  }

  /** Point at the new craft's yokes after a garage rebuild (system is created once). */
  setYokes(left: THREE.Object3D, right: THREE.Object3D): void {
    this.leftYoke = left;
    this.rightYoke = right;
    for (const hand of this.hands) hand.holdingYoke = false;
  }

  /** Read triggers/buttons; call once per frame before using getInput(). */
  update(): void {
    this.leftYoke.getWorldPosition(this.leftYokeWorld);
    this.rightYoke.getWorldPosition(this.rightYokeWorld);

    let aDown = false;
    for (const hand of this.hands) {
      const gp = hand.inputSource?.gamepad;
      if (gp && gp.buttons[4]?.pressed) aDown = true;

      // held hands glow slightly
      const mat = (hand.visual.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = hand.holdingYoke ? 0.9 : 0.15;
    }
    this.aButtonJustPressed = aDown && !this.aWasDown;
    this.aWasDown = aDown;
    this.aButtonPressed = aDown;
  }

  getInput(): ThrustInput & { leftHeld: boolean; rightHeld: boolean } {
    let left = 0;
    let right = 0;
    let leftHeld = false;
    let rightHeld = false;
    let overdrive = false;

    for (const hand of this.hands) {
      if (!hand.holdingYoke) continue;
      const gp = hand.inputSource?.gamepad;
      const trigger = gp?.buttons[0]?.value ?? 0;
      if (hand.handedness === 'left') {
        left = trigger;
        leftHeld = true;
      } else if (hand.handedness === 'right') {
        right = trigger;
        rightHeld = true;
      }
      if (gp?.buttons[4]?.pressed) overdrive = true;
    }

    return { left, right, overdrive, leftHeld, rightHeld };
  }

  /** Thruster-load rumble; call at ~10 Hz from the session. */
  rumbleThrust(left: number, right: number): void {
    for (const hand of this.hands) {
      if (!hand.holdingYoke) continue;
      const v = hand.handedness === 'left' ? left : right;
      if (v > 0.05) this.pulse(hand, Math.min(1, 0.08 + v * 0.35), 40);
    }
  }

  crashRumble(): void {
    for (const hand of this.hands) this.pulse(hand, 1, 180);
  }

  private pulse(hand: HandState, intensity: number, ms: number): void {
    const actuator = hand.inputSource?.gamepad?.hapticActuators?.[0] as
      | { pulse?: (i: number, ms: number) => void }
      | undefined;
    actuator?.pulse?.(intensity, ms);
  }
}

function buildHandVisual(): THREE.Group {
  const g = new THREE.Group();
  const palm = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 10, 8),
    new THREE.MeshStandardMaterial({
      color: 0xd8c3a0,
      roughness: 0.6,
      emissive: 0xff8c2a,
      emissiveIntensity: 0.15
    })
  );
  g.add(palm);
  const knuckle = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.02, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x3d4a52, roughness: 0.5 })
  );
  knuckle.position.set(0, 0.02, -0.03);
  g.add(knuckle);
  return g;
}
