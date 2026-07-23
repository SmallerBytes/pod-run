import * as THREE from 'three';
import { LEVER_IDLE_FRACTION, thrustForLeverZ } from './CraftFactory';
import { ThrustInput } from './CraftController';

const GRAB_RADIUS = 0.26;
const ROLL_DEADZONE = THREE.MathUtils.degToRad(6);
const ROLL_MAX = THREE.MathUtils.degToRad(35);

interface HandState {
  controller: THREE.XRTargetRaySpace;
  grip: THREE.XRGripSpace;
  inputSource: XRInputSource | null;
  handedness: XRHandedness;
  holding: boolean;
  /** Hand z (in lever-parent space) and lever z captured at grab time. */
  grabHandZ: number;
  grabLeverZ: number;
  grabHandX: number;
  visual: THREE.Group;
}

/**
 * VR throttle hands. Squeeze (grip button) near a motorcycle-style grip to
 * latch onto it; while held, PUSHING the lever forward feeds that thruster
 * and PULLING back eases off. Leaning the controllers left/right (roll, plus
 * a little lateral drift) steers — slowly. Release and the lever settles back
 * to idle.
 */
export class GrabSystem {
  private hands: HandState[] = [];
  private leftLever: THREE.Group;
  private rightLever: THREE.Group;
  private leftGripPoint: THREE.Object3D;
  private rightGripPoint: THREE.Object3D;

  private thrustLeft = 0;
  private thrustRight = 0;
  private lean = 0;

  aButtonPressed = false;
  /** True once either hand's A/X went down this frame (edge), for restart. */
  aButtonJustPressed = false;
  private aWasDown = false;

  private tmpVec = new THREE.Vector3();
  private tmpVec2 = new THREE.Vector3();

  constructor(
    renderer: THREE.WebGLRenderer,
    rig: THREE.Group,
    leftLever: THREE.Group,
    rightLever: THREE.Group,
    leftGripPoint: THREE.Object3D,
    rightGripPoint: THREE.Object3D
  ) {
    this.leftLever = leftLever;
    this.rightLever = rightLever;
    this.leftGripPoint = leftGripPoint;
    this.rightGripPoint = rightGripPoint;

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
        holding: false,
        grabHandZ: 0,
        grabLeverZ: 0,
        grabHandX: 0,
        visual
      };

      controller.addEventListener('connected', (e) => {
        const src = (e as unknown as { data: XRInputSource }).data;
        state.inputSource = src;
        state.handedness = src.handedness;
      });
      controller.addEventListener('disconnected', () => {
        state.inputSource = null;
        state.holding = false;
      });
      controller.addEventListener('squeezestart', () => {
        this.tryGrab(state);
      });
      controller.addEventListener('squeezeend', () => {
        state.holding = false;
      });

      this.hands.push(state);
    }
  }

  /** Point at the new craft's levers after a garage rebuild (system is created once). */
  setLevers(
    leftLever: THREE.Group,
    rightLever: THREE.Group,
    leftGripPoint: THREE.Object3D,
    rightGripPoint: THREE.Object3D
  ): void {
    this.leftLever = leftLever;
    this.rightLever = rightLever;
    this.leftGripPoint = leftGripPoint;
    this.rightGripPoint = rightGripPoint;
    for (const hand of this.hands) hand.holding = false;
  }

  private leverFor(hand: HandState): { lever: THREE.Group; gripPoint: THREE.Object3D } | null {
    if (hand.handedness === 'left') return { lever: this.leftLever, gripPoint: this.leftGripPoint };
    if (hand.handedness === 'right') return { lever: this.rightLever, gripPoint: this.rightGripPoint };
    return null;
  }

  private tryGrab(hand: HandState): void {
    const target = this.leverFor(hand);
    if (!target || !target.lever.parent) return;
    const handWorld = hand.grip.getWorldPosition(this.tmpVec);
    const gripWorld = target.gripPoint.getWorldPosition(this.tmpVec2);
    if (handWorld.distanceTo(gripWorld) > GRAB_RADIUS) return;

    const local = target.lever.parent.worldToLocal(handWorld.clone());
    hand.holding = true;
    hand.grabHandZ = local.z;
    hand.grabHandX = local.x;
    hand.grabLeverZ = target.lever.position.z;
    this.pulse(hand, 0.6, 60);
  }

  /** Drive levers from held hands, ease released levers, read roll lean. */
  update(dt: number): void {
    let aDown = false;
    let leanSum = 0;
    let leanCount = 0;

    const heldSides = { left: false, right: false };

    for (const hand of this.hands) {
      const gp = hand.inputSource?.gamepad;
      if (gp && gp.buttons[4]?.pressed) aDown = true;

      const target = this.leverFor(hand);
      const mat = (hand.visual.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = hand.holding ? 0.9 : 0.15;

      if (!hand.holding || !target || !target.lever.parent) continue;
      if (hand.handedness === 'left') heldSides.left = true;
      if (hand.handedness === 'right') heldSides.right = true;

      // --- push/pull: hand z displacement drives the lever along its rail ---
      const handWorld = hand.grip.getWorldPosition(this.tmpVec);
      const local = target.lever.parent.worldToLocal(handWorld.clone());
      const { homeZ, travel } = target.lever.userData as { homeZ: number; travel: number };
      const desired = hand.grabLeverZ + (local.z - hand.grabHandZ);
      target.lever.position.z = THREE.MathUtils.clamp(desired, homeZ - travel, homeZ + travel);

      // --- lean: controller roll (grip is parented to the upright rig) ---
      const up = this.tmpVec2.set(0, 1, 0).applyQuaternion(hand.grip.quaternion);
      let roll = Math.atan2(up.x, Math.max(0.001, up.y));
      roll = applyDeadzone(roll, ROLL_DEADZONE);
      let lean = THREE.MathUtils.clamp(roll / ROLL_MAX, -1, 1);
      // light lateral drift assist: shifting the held hand sideways adds lean
      const drift = THREE.MathUtils.clamp((local.x - hand.grabHandX) * 2.2, -0.4, 0.4);
      lean = THREE.MathUtils.clamp(lean + drift, -1, 1);
      leanSum += lean;
      leanCount++;
    }

    // released levers settle back toward idle
    const easeBack = (lever: THREE.Group, held: boolean) => {
      if (held) return;
      const { homeZ, travel } = lever.userData as { homeZ: number; travel: number };
      const idleZ = homeZ + travel * LEVER_IDLE_FRACTION; // ~0.14 thrust

      lever.position.z = THREE.MathUtils.lerp(lever.position.z, idleZ, 1 - Math.exp(-dt * 3));
    };
    easeBack(this.leftLever, heldSides.left);
    easeBack(this.rightLever, heldSides.right);

    this.thrustLeft = thrustForLeverZ(this.leftLever, this.leftLever.position.z);
    this.thrustRight = thrustForLeverZ(this.rightLever, this.rightLever.position.z);

    // lean only applies while gripping; ease it out otherwise
    const targetLean = leanCount > 0 ? leanSum / leanCount : 0;
    this.lean = THREE.MathUtils.lerp(this.lean, targetLean, 1 - Math.exp(-dt * 5));

    this.aButtonJustPressed = aDown && !this.aWasDown;
    this.aWasDown = aDown;
    this.aButtonPressed = aDown;
  }

  getInput(): ThrustInput & { leftHeld: boolean; rightHeld: boolean } {
    let leftHeld = false;
    let rightHeld = false;
    let overdrive = false;
    for (const hand of this.hands) {
      if (!hand.holding) continue;
      if (hand.handedness === 'left') leftHeld = true;
      if (hand.handedness === 'right') rightHeld = true;
      if (hand.inputSource?.gamepad?.buttons[4]?.pressed) overdrive = true;
    }
    return {
      left: this.thrustLeft,
      right: this.thrustRight,
      lean: this.lean,
      overdrive,
      leftHeld,
      rightHeld
    };
  }

  /** Thruster-load rumble; call at ~10 Hz from the session. */
  rumbleThrust(left: number, right: number): void {
    for (const hand of this.hands) {
      if (!hand.holding) continue;
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

function applyDeadzone(value: number, deadzone: number): number {
  if (Math.abs(value) < deadzone) return 0;
  return value - Math.sign(value) * deadzone;
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
