import { BrickSlot, CraftBuild, KIT_CATALOG, SLOT_LABELS } from './Loadout';

const SLOT_ORDER: BrickSlot[] = [
  'hull',
  'seat',
  'nose',
  'finL',
  'finR',
  'engineL',
  'engineR',
  'cableL',
  'cableR'
];

/**
 * LEGO-style snap builder UI: a grid of slot chips; picking a slot shows its
 * kit options; picking a kit snaps it onto the build and notifies the studio.
 */
export class BrickBuilder {
  private activeSlot: BrickSlot = 'hull';

  constructor(
    private build: CraftBuild,
    private slotContainer: HTMLElement,
    private kitContainer: HTMLElement,
    private onSnap: () => void
  ) {
    this.renderSlots();
    this.renderKits();
  }

  setBuild(build: CraftBuild): void {
    this.build = build;
    this.renderSlots();
    this.renderKits();
  }

  private renderSlots(): void {
    this.slotContainer.innerHTML = '';
    for (const slot of SLOT_ORDER) {
      const btn = document.createElement('button');
      btn.className = 'slot-chip' + (slot === this.activeSlot ? ' selected' : '');
      const kitName = KIT_CATALOG[slot][this.build.bricks[slot]]?.name ?? '?';
      btn.innerHTML = `${SLOT_LABELS[slot]}<small>${kitName}</small>`;
      btn.addEventListener('click', () => {
        this.activeSlot = slot;
        this.renderSlots();
        this.renderKits();
      });
      this.slotContainer.appendChild(btn);
    }
  }

  private renderKits(): void {
    this.kitContainer.innerHTML = '';
    const kits = KIT_CATALOG[this.activeSlot];
    for (const [id, kit] of Object.entries(kits)) {
      const btn = document.createElement('button');
      btn.className = 'part-btn' + (this.build.bricks[this.activeSlot] === id ? ' selected' : '');
      btn.innerHTML = `${kit.name}<small>${kit.desc}</small>`;
      btn.addEventListener('click', () => {
        this.build.bricks[this.activeSlot] = id;
        this.renderSlots();
        this.renderKits();
        this.onSnap();
      });
      this.kitContainer.appendChild(btn);
    }
  }
}
