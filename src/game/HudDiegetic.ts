import * as THREE from 'three';
import { Track, wrap01 } from './TrackProgress';

/**
 * Diegetic dashboard mounted inside the cage (no stereo screen overlays):
 * speed readout, twin thrust bars, stability + hull bars, overdrive meter,
 * place/lap plate, nav mini-map, and a center message strip.
 */
export class HudDiegetic {
  readonly group: THREE.Group;

  private speedCanvas = new CanvasPanel(256, 128);
  private raceCanvas = new CanvasPanel(256, 128);
  private navCanvas = new CanvasPanel(256, 256);
  private messageCanvas = new CanvasPanel(512, 128);

  private barLeft: Bar;
  private barRight: Bar;
  private barStability: Bar;
  private barHull: Bar;
  private barOverdrive: Bar;

  private trackOutline: { x: number; z: number }[] = [];
  private navBounds = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
  private shakeTime = 0;
  private basePosition = new THREE.Vector3();

  private messageText = '';
  private messageColor = '#ffd9a0';
  private messageUntil = 0;

  constructor(private track: Track) {
    this.group = new THREE.Group();

    const panelMat = new THREE.MeshStandardMaterial({ color: 0x16130f, roughness: 0.85, metalness: 0.3 });
    const backing = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.30, 0.03), panelMat);
    this.group.add(backing);

    // speed (left), race info (right), nav (center-top), message (above panel)
    this.group.add(this.speedCanvas.mesh(0.17, 0.085, { x: -0.24, y: 0.045, z: 0.017 }));
    this.group.add(this.raceCanvas.mesh(0.17, 0.085, { x: 0.24, y: 0.045, z: 0.017 }));
    this.group.add(this.navCanvas.mesh(0.16, 0.16, { x: 0, y: 0.055, z: 0.017 }));
    this.group.add(this.messageCanvas.mesh(0.6, 0.15, { x: 0, y: 0.26, z: 0.0 }));

    // bars along the bottom of the panel
    this.barLeft = new Bar(0.13, '#ff8c2a', 'L');
    this.barRight = new Bar(0.13, '#ff8c2a', 'R');
    this.barStability = new Bar(0.13, '#ffd23e', 'STB');
    this.barHull = new Bar(0.13, '#6fce6f', 'HULL');
    this.barOverdrive = new Bar(0.13, '#9fd8ff', 'OD');

    const bars = [this.barLeft, this.barRight, this.barOverdrive, this.barStability, this.barHull];
    bars.forEach((bar, i) => {
      bar.group.position.set(-0.29 + i * 0.145, -0.095, 0.017);
      this.group.add(bar.group);
    });

    this.computeTrackOutline();
  }

  attachTo(anchor: THREE.Object3D): void {
    anchor.add(this.group);
    this.basePosition.copy(this.group.position);
  }

  showMessage(text: string, seconds: number, color = '#ffd9a0'): void {
    this.messageText = text;
    this.messageColor = color;
    this.messageUntil = performance.now() / 1000 + seconds;
    this.drawMessage();
  }

  update(
    dt: number,
    data: {
      speed: number;
      thrustL: number;
      thrustR: number;
      stability: number;
      hull: number;
      overdrive: number;
      place: number;
      racerCount: number;
      lap: number;
      lapsTotal: number;
      raceTime: number;
      playerT: number;
      playerYaw: number;
      aiTs: number[];
      nextCheckpointT: number;
      leftHeld: boolean;
      rightHeld: boolean;
      overheated: boolean;
    }
  ): void {
    this.barLeft.set(data.thrustL, data.leftHeld ? '#ff8c2a' : '#5a4326');
    this.barRight.set(data.thrustR, data.rightHeld ? '#ff8c2a' : '#5a4326');
    this.barStability.set(data.stability, data.stability < 0.35 ? '#ff4a3a' : '#ffd23e');
    this.barHull.set(data.hull, data.hull < 0.3 ? '#ff4a3a' : '#6fce6f');
    this.barOverdrive.set(data.overdrive, '#9fd8ff');

    // low stability rattles the whole panel
    if (data.stability < 0.4) {
      this.shakeTime += dt * (1 + (0.4 - data.stability) * 8);
      const amp = (0.4 - data.stability) * 0.012;
      this.group.position.set(
        this.basePosition.x + Math.sin(this.shakeTime * 47) * amp,
        this.basePosition.y + Math.cos(this.shakeTime * 61) * amp,
        this.basePosition.z
      );
    } else {
      this.group.position.copy(this.basePosition);
    }

    // throttled canvas redraws
    this.redrawTimer += dt;
    if (this.redrawTimer >= 0.1) {
      this.redrawTimer = 0;
      this.drawSpeed(data.speed, data.overheated);
      this.drawRace(data.place, data.racerCount, data.lap, data.lapsTotal, data.raceTime);
      this.drawNav(data.playerT, data.playerYaw, data.aiTs, data.nextCheckpointT);
      if (this.messageText && performance.now() / 1000 > this.messageUntil) {
        this.messageText = '';
        this.drawMessage();
      }
    }
  }

  private redrawTimer = 0;

  private drawSpeed(speed: number, overheated: boolean): void {
    const { ctx, w, h } = this.speedCanvas;
    ctx.clearRect(0, 0, w, h);
    paintPanelBg(ctx, w, h);
    ctx.fillStyle = overheated ? '#ff4a3a' : '#ffd9a0';
    ctx.font = 'bold 64px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(Math.round(speed)), w / 2, 76);
    ctx.fillStyle = '#8f795a';
    ctx.font = '20px monospace';
    ctx.fillText(overheated ? 'OVERHEAT' : 'M/S', w / 2, 108);
    this.speedCanvas.commit();
  }

  private drawRace(place: number, count: number, lap: number, lapsTotal: number, time: number): void {
    const { ctx, w, h } = this.raceCanvas;
    ctx.clearRect(0, 0, w, h);
    paintPanelBg(ctx, w, h);
    ctx.fillStyle = '#ffd9a0';
    ctx.font = 'bold 52px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`P${place}/${count}`, w / 2, 56);
    ctx.fillStyle = '#b89b74';
    ctx.font = '24px monospace';
    const mins = Math.floor(time / 60);
    const secs = (time % 60).toFixed(1).padStart(4, '0');
    ctx.fillText(`LAP ${Math.min(lap + 1, lapsTotal)}/${lapsTotal}  ${mins}:${secs}`, w / 2, 102);
    this.raceCanvas.commit();
  }

  private drawNav(playerT: number, playerYaw: number, aiTs: number[], nextCpT: number): void {
    const { ctx, w, h } = this.navCanvas;
    ctx.clearRect(0, 0, w, h);
    paintPanelBg(ctx, w, h);

    const toPx = (p: { x: number; z: number }) => {
      const { minX, maxX, minZ, maxZ } = this.navBounds;
      const pad = 20;
      return {
        x: pad + ((p.x - minX) / (maxX - minX)) * (w - pad * 2),
        y: pad + ((p.z - minZ) / (maxZ - minZ)) * (h - pad * 2)
      };
    };

    // track ribbon
    ctx.strokeStyle = '#8f795a';
    ctx.lineWidth = 5;
    ctx.beginPath();
    this.trackOutline.forEach((p, i) => {
      const q = toPx(p);
      if (i === 0) ctx.moveTo(q.x, q.y);
      else ctx.lineTo(q.x, q.y);
    });
    ctx.closePath();
    ctx.stroke();

    // next checkpoint
    const cp = this.track.posAt(nextCpT);
    const cpPx = toPx({ x: cp.x, z: cp.z });
    ctx.fillStyle = '#9fd8ff';
    ctx.beginPath();
    ctx.arc(cpPx.x, cpPx.y, 6, 0, Math.PI * 2);
    ctx.fill();

    // AI dots
    ctx.fillStyle = '#ff6a5a';
    for (const t of aiTs) {
      const p = this.track.posAt(wrap01(t));
      const px = toPx({ x: p.x, z: p.z });
      ctx.beginPath();
      ctx.arc(px.x, px.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // player wedge (rotated by yaw)
    const pp = this.track.posAt(wrap01(playerT));
    const ppx = toPx({ x: pp.x, z: pp.z });
    ctx.save();
    ctx.translate(ppx.x, ppx.y);
    ctx.rotate(-playerYaw + Math.PI);
    ctx.fillStyle = '#ffd23e';
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    this.navCanvas.commit();
  }

  private drawMessage(): void {
    const { ctx, w, h } = this.messageCanvas;
    ctx.clearRect(0, 0, w, h);
    if (this.messageText) {
      ctx.fillStyle = 'rgba(12, 9, 6, 0.72)';
      roundRect(ctx, 8, 8, w - 16, h - 16, 18);
      ctx.fill();
      ctx.fillStyle = this.messageColor;
      ctx.font = 'bold 72px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.messageText, w / 2, h / 2 + 4);
    }
    this.messageCanvas.commit();
  }

  private computeTrackOutline(): void {
    const n = 96;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = this.track.posAt(i / n);
      this.trackOutline.push({ x: p.x, z: p.z });
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    this.navBounds = { minX, maxX, minZ, maxZ };
  }
}

/** A labelled fill bar built from two boxes + a tiny canvas label. */
class Bar {
  group = new THREE.Group();
  private fill: THREE.Mesh;
  private fillMat: THREE.MeshBasicMaterial;
  private width: number;

  constructor(width: number, color: string, label: string) {
    this.width = width;
    const back = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.028, 0.008),
      new THREE.MeshBasicMaterial({ color: 0x241a10 })
    );
    this.group.add(back);

    this.fillMat = new THREE.MeshBasicMaterial({ color });
    this.fill = new THREE.Mesh(new THREE.BoxGeometry(width, 0.022, 0.01), this.fillMat);
    this.fill.position.z = 0.002;
    this.group.add(this.fill);

    const labelPanel = new CanvasPanel(128, 40);
    labelPanel.ctx.fillStyle = '#b89b74';
    labelPanel.ctx.font = 'bold 30px monospace';
    labelPanel.ctx.textAlign = 'center';
    labelPanel.ctx.fillText(label, 64, 32);
    labelPanel.commit();
    this.group.add(labelPanel.mesh(0.09, 0.028, { x: 0, y: -0.034, z: 0 }));
  }

  set(value: number, color?: string): void {
    const v = Math.max(0.001, Math.min(1, value));
    this.fill.scale.x = v;
    this.fill.position.x = -this.width * (1 - v) * 0.5;
    if (color) this.fillMat.color.set(color);
  }
}

class CanvasPanel {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  readonly w: number;
  readonly h: number;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  mesh(width: number, height: number, pos: { x: number; y: number; z: number }): THREE.Mesh {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true })
    );
    m.position.set(pos.x, pos.y, pos.z);
    return m;
  }

  commit(): void {
    this.texture.needsUpdate = true;
  }
}

function paintPanelBg(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = 'rgba(20, 14, 8, 0.9)';
  roundRect(ctx, 2, 2, w - 4, h - 4, 10);
  ctx.fill();
  ctx.strokeStyle = '#4a3720';
  ctx.lineWidth = 3;
  roundRect(ctx, 2, 2, w - 4, h - 4, 10);
  ctx.stroke();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
