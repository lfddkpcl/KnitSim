import * as THREE from "three";

export interface PreviewFloorOptions {
  y?: number;
}

export const PREVIEW_FLOOR_SIZE = 2000;
export const PREVIEW_FLOOR_DIVISIONS = 2000;
export const PREVIEW_BACKGROUND = 0xe8fff9;

export const applyPreviewEnvironment = (scene: THREE.Scene, viewDistance = 11) => {
  scene.background = new THREE.Color(PREVIEW_BACKGROUND);
  scene.fog = new THREE.Fog(
    PREVIEW_BACKGROUND,
    Math.max(viewDistance * 1.4, 12),
    Math.max(viewDistance * 3.6, 40),
  );
};

export class PreviewFloor {
  readonly group = new THREE.Group();
  readonly grid: THREE.GridHelper;

  constructor(options: PreviewFloorOptions = {}) {
    this.grid = new THREE.GridHelper(
      PREVIEW_FLOOR_SIZE,
      PREVIEW_FLOOR_DIVISIONS,
      0xbfd3cc,
      0xd6e6e0,
    );
    this.grid.position.y = 0.003;
    this.group.add(this.grid);
    this.group.position.y = options.y ?? 0;
  }

  dispose() {
    this.grid.geometry.dispose();
    const gridMaterials = Array.isArray(this.grid.material)
      ? this.grid.material
      : [this.grid.material];
    gridMaterials.forEach((material) => material.dispose());
  }
}

export const createPreviewFloor = (options: PreviewFloorOptions = {}) =>
  new PreviewFloor(options);
