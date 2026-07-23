import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { AudioEngine } from './game/AudioEngine';
import { buildSkiff, SkiffRig } from './game/CraftFactory';
import { DesktopControls } from './game/DesktopControls';
import { GrabSystem } from './game/GrabSystem';
import { HudDiegetic } from './game/HudDiegetic';
import { RaceSession } from './game/RaceSession';
import { buildTrackScenery } from './game/TrackBuilder';
import { Track } from './game/TrackProgress';
import { Loadout, loadLoadout } from './garage/Loadout';
import { PaintStudio } from './garage/PaintStudio';

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.domElement.classList.add('game-canvas');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#e8b87a');
scene.fog = new THREE.Fog('#e0aa6a', 120, 1400);

scene.add(new THREE.HemisphereLight(0xffe0b0, 0x8a5a34, 1.0));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
sun.position.set(300, 500, 200);
scene.add(sun);

// ---------- track ----------
const track = new Track();
buildTrackScenery(scene, track);

// ---------- player skiff + seated rig ----------
let currentLoadout: Loadout = loadLoadout();
let skiff: SkiffRig = buildSkiff(currentLoadout);
scene.add(skiff.group);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 4000);
const rig = new THREE.Group(); // seated camera rig, parented into the cage
rig.position.copy(skiff.seatPosition);
skiff.group.add(rig);
rig.add(camera);
camera.position.set(0, 1.25, 0); // desktop eye height; XR overrides with real head pose

// ---------- systems ----------
const audio = new AudioEngine();
const hud = new HudDiegetic(track);
hud.attachTo(skiff.dashboardAnchor);

const grab = new GrabSystem(renderer, rig, skiff.leftYoke, skiff.rightYoke);
const desktop = new DesktopControls(camera, renderer.domElement);

let session = new RaceSession(scene, skiff, currentLoadout, track, hud, audio, grab);

// ---------- garage ----------
const garageEl = document.getElementById('garage')!;
let inGarage = true;

const studio = new PaintStudio((loadout) => {
  rebuildPlayerSkiff(loadout);
});

/** Swap the whole craft when parts/paint change in the garage. */
function rebuildPlayerSkiff(loadout: Loadout): void {
  currentLoadout = loadout;
  const oldGroup = skiff.group;
  skiff = buildSkiff(loadout);
  scene.remove(oldGroup);
  scene.add(skiff.group);

  skiff.group.add(rig);
  rig.position.copy(skiff.seatPosition);
  hud.attachTo(skiff.dashboardAnchor);
  grab.setYokes(skiff.leftYoke, skiff.rightYoke);

  session.dispose();
  session = new RaceSession(scene, skiff, loadout, track, hud, audio, grab);
}

// ---------- launch flow ----------
const vrButton = VRButton.createButton(renderer);
document.getElementById('vr-button-slot')!.appendChild(vrButton);

renderer.xr.addEventListener('sessionstart', () => {
  enterRace();
});
renderer.xr.addEventListener('sessionend', () => {
  exitToGarage();
});

document.getElementById('desktop-start')!.addEventListener('click', () => {
  enterRace();
  renderer.domElement.requestPointerLock();
});

function enterRace(): void {
  inGarage = false;
  garageEl.classList.add('hidden');
  studio.setVisible(false);
  audio.start();
  session.begin();
}

function exitToGarage(): void {
  inGarage = true;
  garageEl.classList.remove('hidden');
  studio.setVisible(true);
  session.state = 'idle';
  audio.setThrust(0, 0, 0);
  audio.setOverheatWarning(false);
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !inGarage && !renderer.xr.isPresenting) {
    exitToGarage();
  }
});

// ---------- resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- main loop ----------
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (inGarage) {
    studio.render(dt);
    return;
  }

  const inVR = renderer.xr.isPresenting;
  if (inVR) {
    grab.update();
  } else {
    desktop.update(dt);
  }

  const provider = inVR ? grab : desktop;
  const restart = inVR ? grab.aButtonJustPressed : desktop.consumeRestart();
  session.update(dt, provider, restart);

  renderer.render(scene, camera);
});
