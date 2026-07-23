import * as THREE from 'three';
import { CraftBuild, loadBuild, saveBuild, statBars } from './Loadout';
import { buildSkiffFromBuild, SkiffRig } from '../game/CraftFactory';
import { BrickBuilder } from './BrickBuilder';

/**
 * The garage: LEGO-style slot/kit builder + paint pickers on the left, a live
 * rotating 3D preview of the assembled skiff on the right. Changes persist to
 * localStorage and notify the game so the race skiff rebuilds.
 */
export class PaintStudio {
  build: CraftBuild;

  private previewRenderer: THREE.WebGLRenderer;
  private previewScene: THREE.Scene;
  private previewCamera: THREE.PerspectiveCamera;
  private previewRig: SkiffRig | null = null;
  private spin = 0;
  private onChange: (build: CraftBuild) => void;
  private visible = true;

  constructor(onChange: (build: CraftBuild) => void) {
    this.build = loadBuild();
    this.onChange = onChange;

    // --- preview renderer ---
    const canvas = document.getElementById('preview-canvas') as HTMLCanvasElement;
    this.previewRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.previewScene = new THREE.Scene();
    this.previewCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.previewCamera.position.set(7, 4.5, 9);
    this.previewCamera.lookAt(0, 0.6, -2.5);

    this.previewScene.add(new THREE.HemisphereLight(0xffe0b0, 0x6e4526, 1.1));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
    sun.position.set(6, 10, 4);
    this.previewScene.add(sun);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(14, 32),
      new THREE.MeshLambertMaterial({ color: 0x3a2c1c })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.6;
    this.previewScene.add(floor);

    new BrickBuilder(
      this.build,
      document.getElementById('slot-grid')!,
      document.getElementById('kit-row')!,
      () => this.commit()
    );
    this.bindPaint();
    this.refreshStats();
    this.rebuildPreview();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setVisible(v: boolean): void {
    this.visible = v;
  }

  /** Called from the main animation loop while the garage overlay is up. */
  render(dt: number): void {
    if (!this.visible || !this.previewRig) return;
    this.spin += dt * 0.4;
    this.previewRig.group.rotation.y = this.spin;
    this.previewRenderer.render(this.previewScene, this.previewCamera);
  }

  private commit(): void {
    saveBuild(this.build);
    this.rebuildPreview();
    this.refreshStats();
    this.onChange(this.build);
  }

  private rebuildPreview(): void {
    if (this.previewRig) {
      this.previewScene.remove(this.previewRig.group);
    }
    this.previewRig = buildSkiffFromBuild(this.build, { withCockpitFittings: true });
    this.previewRig.group.rotation.y = this.spin;
    this.previewRig.shadowBlob.position.y = -0.55;
    this.previewScene.add(this.previewRig.group);
  }

  private bindPaint(): void {
    const bindColor = (elId: string, key: keyof CraftBuild['paint']) => {
      const input = document.getElementById(elId) as HTMLInputElement;
      input.value = this.build.paint[key];
      input.addEventListener('input', () => {
        this.build.paint[key] = input.value;
        this.commit();
      });
    };
    bindColor('paint-primary', 'primary');
    bindColor('paint-secondary', 'secondary');
    bindColor('paint-stripe', 'stripe');
  }

  private refreshStats(): void {
    const wrap = document.getElementById('stat-bars')!;
    wrap.innerHTML = '';
    for (const bar of statBars(this.build)) {
      const line = document.createElement('div');
      line.className = 'stat-line';
      line.innerHTML = `<span>${bar.label}</span><div class="stat-track"><div class="stat-fill" style="width:${Math.round(
        bar.value * 100
      )}%"></div></div>`;
      wrap.appendChild(line);
    }
  }

  private resize(): void {
    const canvas = this.previewRenderer.domElement;
    const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 800;
    const h = canvas.clientHeight || canvas.parentElement?.clientHeight || 600;
    this.previewRenderer.setSize(w, h, false);
    this.previewCamera.aspect = w / h;
    this.previewCamera.updateProjectionMatrix();
  }
}
