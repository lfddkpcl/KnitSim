import * as THREE from "three";
import type { VizStatus } from "@/components/editor/editor.types";
import { Cloth, type ClothStepParams } from "@/simulate/cloth";
import {
  createFabricLayoutFromSettings,
  getCellsPerTextureTile,
  getFabricNodeCount,
  getStitchWidth,
  getTextureTileSize,
  MAX_FABRIC_NODES,
} from "@/simulate/fabricLayout";
import { FabricTextureComposer } from "@/simulate/fabricTexture";
import { FABRIC_MATERIALS } from "@/simulate/materials";
import { createSolidMaterial, disposeObject, enableShadows, SOLIDS } from "@/simulate/solids";
import type { FabricLayout, SimulateSettings, SolidKey } from "@/simulate/simulate.types";
import type { VizRendererStage } from "@/three/vizRendererStage";

const FRAME_TIME = 1 / 60;
const SUBSTEPS = 2;
const SUBSTEP_TIME = FRAME_TIME / SUBSTEPS;
const MAX_FRAME_GAP = 0.05;
const STATUS_INTERVAL_STEPS = 6;
const SETTLE_SPEED_LIMIT = 0.02;
const REQUIRED_SETTLED_FRAMES = 60;

export type FabricSimulationCallbacks = {
  onStatus: (status: VizStatus) => void;
  onError: (message: string) => void;
  onVisibilityChange: (isVisible: boolean) => void;
};

export class FabricSimulation {
  private readonly contentRoot = new THREE.Group();
  private readonly clothMaterial = new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide });
  private readonly springMaterial = new THREE.LineBasicMaterial({ color: 0x2c3e50, transparent: true, opacity: 0.35 });
  private readonly solidMaterial = createSolidMaterial();
  private readonly textureComposer = new FabricTextureComposer();

  private textures: { map: THREE.Texture; bump: THREE.Texture } | null = null;
  private cloth: Cloth | null = null;
  private clothMesh: THREE.Mesh | null = null;
  private springLines: THREE.LineSegments | null = null;
  private solidKey: SolidKey = "none";
  private solidMesh: THREE.Object3D | null = null;
  private generatedSettings: SimulateSettings | null = null;

  private isActive = false;
  private isPreviewVisible = false;
  private isRunning = false;
  private isDropResettable = false;
  private stepCount = 0;
  private frameId: number | null = null;
  private lastFrameTime = 0;
  private accumulator = 0;
  private settledFrameCount = 0;

  constructor(
    private readonly stage: VizRendererStage,
    private readonly settings: SimulateSettings,
    private readonly callbacks: FabricSimulationCallbacks,
  ) {
    this.contentRoot.name = "fabric-simulation-content";
    this.contentRoot.visible = false;
    stage.scene.add(this.contentRoot);
  }

  activate() {
    this.isActive = true;
    if (this.isPreviewVisible) {
      this.showContent();
    }
    this.emitStatus();
  }

  deactivate() {
    this.isActive = false;
    this.isRunning = false;
    this.stopLoop();
    this.contentRoot.visible = false;
  }

  generate() {
    try {
      const settings = { ...this.settings };
      const layout = this.getValidatedLayout(settings);
      if (!layout) return;
      this.setSolid(settings.solid);
      this.buildCloth(layout, settings);
      this.generatedSettings = settings;
      this.isDropResettable = false;
      this.resetSettling();
      this.isPreviewVisible = true;
      this.showContent();
      this.emitStatus();
    } catch (error) {
      console.error(error);
      this.callbacks.onError(error instanceof Error ? error.message : String(error));
    }
  }

  togglePreview() {
    if (!this.cloth) return;
    this.isPreviewVisible = !this.isPreviewVisible;
    if (this.isPreviewVisible) {
      this.showContent();
    } else {
      this.isRunning = false;
      this.stopLoop();
      this.contentRoot.visible = false;
      this.callbacks.onVisibilityChange(false);
    }
    this.emitStatus();
  }

  toggleSimulation() {
    if (!this.cloth || !this.isPreviewVisible) return;
    if (this.isDropResettable) {
      this.resetDrop();
      return;
    }
    this.isRunning = true;
    this.isDropResettable = true;
    this.resetSettling();
    this.startLoop();
    this.emitStatus();
  }

  dispose() {
    this.stopLoop();
    this.contentRoot.removeFromParent();
    this.disposeCloth();
    this.disposeSolid();
    this.textures?.map.dispose();
    this.textures?.bump.dispose();
    this.clothMaterial.dispose();
    this.springMaterial.dispose();
    this.solidMaterial.dispose();
    this.stage.setFloorPosition(0, 0, 0);
  }

  private resetDrop() {
    const settings = this.generatedSettings;
    if (!settings) return;
    const layout = createFabricLayoutFromSettings(settings);
    this.isRunning = false;
    this.isDropResettable = false;
    this.stopLoop();
    this.buildCloth(layout, settings);
    this.resetSettling();
    this.frame();
    this.emitStatus();
  }

  private showContent() {
    this.contentRoot.visible = true;
    this.callbacks.onVisibilityChange(true);
    this.frame();
  }

  private frame() {
    const bounds = new THREE.Box3();
    if (this.clothMesh) bounds.expandByObject(this.clothMesh);
    if (this.solidMesh) bounds.expandByObject(this.solidMesh);
    this.stage.setFloorPosition(0, 0, 0);
    this.stage.frame(bounds, { direction: new THREE.Vector3(0.35, 0.45, -0.85), padding: 1.05 });
  }

  private setSolid(key: SolidKey) {
    if (this.solidMesh && key === this.solidKey) return;
    this.disposeSolid();
    this.solidKey = key;
    this.solidMesh = enableShadows(SOLIDS[key].createMesh(this.solidMaterial));
    this.contentRoot.add(this.solidMesh);
  }

  private buildCloth(layout: FabricLayout, settings: SimulateSettings) {
    this.disposeCloth();
    const material = FABRIC_MATERIALS[settings.material];

    this.textureComposer.compose({
      print: settings.print,
      groundColor: settings.groundColor,
      patternColor: settings.patternColor,
      material: settings.material,
      cellsPerTile: getCellsPerTextureTile(settings),
    });
    this.textures?.map.dispose();
    this.textures?.bump.dispose();
    this.textures = this.textureComposer.createTextures();

    Object.assign(this.clothMaterial, {
      map: this.textures.map,
      bumpMap: this.textures.bump,
      bumpScale: material.bumpScale,
      roughness: material.roughness,
      metalness: material.metalness,
      transparent: material.opacity < 1,
      opacity: material.opacity,
      envMapIntensity: material.envMapIntensity,
      needsUpdate: true,
    });

    this.cloth = new Cloth({
      layout,
      stitchWidth: getStitchWidth(settings),
      textureTile: getTextureTileSize(settings),
      solidTop: SOLIDS[this.solidKey].topY,
    });
    this.clothMesh = enableShadows(new THREE.Mesh(this.cloth.geometry, this.clothMaterial));
    this.springLines = new THREE.LineSegments(this.cloth.springGeometry, this.springMaterial);
    this.springLines.visible = false;
    this.contentRoot.add(this.clothMesh, this.springLines);
    this.stepCount = 0;
  }

  private getValidatedLayout(settings: SimulateSettings) {
    const layout = createFabricLayoutFromSettings(settings);
    const nodeCount = getFabricNodeCount(layout);
    if (nodeCount <= MAX_FABRIC_NODES) return layout;

    this.callbacks.onError(
      `Fabric contains ${nodeCount.toLocaleString()} nodes. Reduce its width or length, or choose Wool, ` +
        `to stay within the ${MAX_FABRIC_NODES.toLocaleString()}-node limit.`,
    );
    this.emitStatus();
    return null;
  }

  private disposeCloth() {
    if (this.clothMesh) this.contentRoot.remove(this.clothMesh);
    if (this.springLines) this.contentRoot.remove(this.springLines);
    this.cloth?.dispose();
    this.cloth = null;
    this.clothMesh = null;
    this.springLines = null;
  }

  private disposeSolid() {
    if (!this.solidMesh) return;
    this.contentRoot.remove(this.solidMesh);
    disposeObject(this.solidMesh);
    this.solidMesh = null;
  }

  private getStepParams(): ClothStepParams {
    const settings = this.generatedSettings ?? this.settings;
    const material = FABRIC_MATERIALS[settings.material];
    return {
      stretch: settings.stretch,
      bend: settings.bend,
      friction: settings.friction,
      weight: material.weight,
      damping: material.damping,
      drag: material.drag,
      iterations: material.iterations,
    };
  }

  private startLoop() {
    if (this.frameId !== null) return;
    this.lastFrameTime = performance.now();
    this.accumulator = 0;
    this.frameId = requestAnimationFrame(this.tick);
  }

  private stopLoop() {
    if (this.frameId === null) return;
    cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  private readonly tick = (now: number) => {
    const cloth = this.cloth;
    if (!this.isRunning || !this.isActive || !cloth) {
      this.frameId = null;
      return;
    }
    this.frameId = requestAnimationFrame(this.tick);
    this.accumulator += Math.min((now - this.lastFrameTime) / 1000, MAX_FRAME_GAP);
    this.lastFrameTime = now;

    const params = this.getStepParams();
    const solid = SOLIDS[this.solidKey];
    let hasStepped = false;
    while (this.accumulator >= FRAME_TIME) {
      for (let s = 0; s < SUBSTEPS; s++) {
        cloth.step(SUBSTEP_TIME, params, solid);
        this.stepCount++;
      }
      this.accumulator -= FRAME_TIME;
      hasStepped = true;
    }
    cloth.updateGeometry();
    this.stage.render();
    if (hasStepped && this.updateSettlingState(cloth)) return;
    if (this.stepCount % STATUS_INTERVAL_STEPS === 0) this.emitStatus();
  };

  private updateSettlingState(cloth: Cloth) {
    this.settledFrameCount = cloth.isBelowSpeed(SETTLE_SPEED_LIMIT, SUBSTEP_TIME) ? this.settledFrameCount + 1 : 0;
    if (this.settledFrameCount < REQUIRED_SETTLED_FRAMES) return false;

    this.isRunning = false;
    this.stopLoop();
    this.emitStatus();
    return true;
  }

  private resetSettling() {
    this.settledFrameCount = 0;
  }

  private emitStatus() {
    this.callbacks.onStatus({
      isLoading: false,
      isReady: this.isPreviewVisible,
      isRunning: this.isRunning,
      isCancelling: false,
      isSimulationStopping: false,
      isDropResettable: this.isDropResettable,
      step: this.stepCount,
      accDelta: this.cloth?.accumulatedMovement ?? 0,
      nodes: this.cloth?.nodeCount ?? 0,
      springs: this.cloth?.springCount ?? 0,
    });
  }
}
