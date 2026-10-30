import type * as THREE from "three";
import type { FrameOptions, PreviewOrbit } from "@/three/previewOrbit";
import type { PreviewFloor } from "@/three/previewFloor";

export interface VizRendererStage {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: PreviewOrbit;
  readonly floor: PreviewFloor;
  resize(): void;
  render(): void;
  frame(bounds: THREE.Box3, options?: FrameOptions): void;
  setFloorPosition(x: number, y: number, z: number): void;
  setViewDistance(distance: number): void;
}